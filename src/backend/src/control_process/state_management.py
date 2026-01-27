import logging
import time
from common.ipc import BoundingBox, CVData, OSDData, PreviewData
from common.ipc_buffer import cleanup_shared_memory
from common.utils import ip4_addresses
from control_process.cv_process_management import CVProcessManagement
from control_process.livestream_process_management import LivestreamProcessManagement
from control_process.gimbal import GimbalSerial
from control_process.tracking import Tracking
import base64

from cv_process.main import HEIGHT, LIVE_STREAM_SHM_NAME, WIDTH



logger = logging.getLogger(__name__)


class BoundingBoxCollection:
    _cv_data_list: list[CVData]

    def __init__(self):
        self._cv_data_list = []

    def received_data(self, data: CVData):
        if not data.bounding_box:
            return

        self._cv_data_list.append(data)

        if len(self._cv_data_list) > 10:
            self._cv_data_list.pop(0)

    def get_bbox(self, pts_ns: int) -> BoundingBox | None:
        if not self._cv_data_list:
            return None

        # Find the CVData with the same pts_ns
        for cv_data in self._cv_data_list:
            if cv_data.pts_ns == pts_ns:
                return cv_data.bounding_box
        return None

    def get_latest_bbox(self) -> BoundingBox | None:
        if not self._cv_data_list:
            return None
        return self._cv_data_list[-1].bounding_box


class StateManagement:
    def __init__(self):
        # FIXME: need to refresh periodically
        self._device_ip_addresses = ip4_addresses()

        self._armed = False
        self._last_preview_frame: PreviewData | None = None

        self._gimbal = GimbalSerial(port="/dev/ttyTHS1", baudrate=115200, timeout=0.1)
        self._gimbal.move_deg(0,0)
        self._tracking = Tracking(gimbal=self._gimbal, width=1080, height=1920, k_p=0.003)

        self._bboxes = BoundingBoxCollection()

        cleanup_shared_memory(LIVE_STREAM_SHM_NAME)
        # Need to start live stream process before cv process, due to nvidia driver bug
        self._livestream_process = LivestreamProcessManagement()
        time.sleep(1)
        self._cv_process = CVProcessManagement(self._on_cvdata, self._on_preview)

    def _on_cvdata(self, data: CVData):
        self._bboxes.received_data(data)

        bbox = self._bboxes.get_latest_bbox()

        if bbox:
            cx = bbox.left + bbox.width / 2.0
            cy = bbox.top + bbox.height / 2.0

            tx = 0.5 - cx
            ty = 0.5 - cy
            s = max(bbox.width * WIDTH, bbox.height * HEIGHT)
        else:
            tx = 0.0
            ty = 0.0
            s = 1.0

        osd_data = OSDData(
            pts_ns=data.pts_ns,
            translate_x=tx,
            translate_y=ty,
            scale=s,
            average_fps=data.fps,
            gimbal_tilt_deg=0.0,
            gimbal_pan_deg=0.0,
            gimbal_focal_length_mm=0.0,
            device_ip_addresses=self._device_ip_addresses,
            timestamp_ms=0,
            tracking_state="idle",
            longitude=0.0,
            latitude=0.0,
        )

        self._cv_process.send_osd_data(osd_data)

        if self._armed and data.bounding_box:
            self._tracking.on_detection(data.bounding_box.center())

    def _on_preview(self, data: PreviewData):
        self._last_preview_frame = data

    def arm(self):
        self._armed = True
        # self._cv_pipeline.armed = True

    def disarm(self):
        self._armed = False
        # self._cv_pipeline.armed = False

    def status(self):
        latest_preview_frame = None
        bbox = None
        if self._last_preview_frame is not None:
            latest_preview_frame = base64.b64encode(self._last_preview_frame.frame).decode("ascii")
            bbox = self._bboxes.get_bbox(self._last_preview_frame.pts_ns)

        try:
            tilt, pan = self._gimbal.measure_deg()
            return {"armed": self._armed, "tilt": tilt, "pan": pan, "preview": latest_preview_frame, "bbox": bbox}
        except Exception as e:
            logger.error(f"Error reading status: {e}")
            return {"armed": self._armed, "tilt": None, "pan": None, "preview": latest_preview_frame, "bbox": bbox}

    def manual_move(self, direction: str):
        if self._armed:
            return
        try:
            current_tilt, current_pan = self._gimbal.measure_deg()
            delta = 10.0  # degrees per command

            if direction == "up":
                new_tilt = max(0.0, min(90.0, current_tilt + delta))
                new_pan = current_pan
            elif direction == "down":
                new_tilt = max(0.0, min(90.0, current_tilt - delta))
                new_pan = current_pan
            elif direction == "left":
                new_tilt = current_tilt
                new_pan = max(-45.0, min(45.0, current_pan - delta))
            elif direction == "right":
                new_tilt = current_tilt
                new_pan = max(-45.0, min(45.0, current_pan + delta))
            else:
                logger.warning(f"Unknown direction: {direction}")
                return

            self._gimbal.move_deg(new_tilt, new_pan)
        except Exception as e:
            logger.error(f"Error in manual_move: {e}")

    def manual_move_to(self, tilt: float, pan: float):
        if self._armed:
            return
        try:
            new_tilt = max(0.0, min(90.0, tilt))
            new_pan = max(-45.0, min(45.0, pan))
            self._gimbal.move_deg(new_tilt, new_pan)
        except Exception as e:
            logger.error(f"Error in manual_move_to: {e}")
