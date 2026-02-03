import logging
import time
import threading
from dataclasses import dataclass
from typing import Optional
from control_process.database import RecordingDatabase
from common.ipc import BoundingBox, CVData, OSDData, PreviewData
from common.ipc_buffer import cleanup_shared_memory
from common.system_status import SystemStatusMonitor
from common.utils import set_scheduler_other
from control_process.cv_process_management import CVProcessManagement
from control_process.livestream_process_management import LivestreamProcessManagement
from control_process.gimbal import GimbalSerial
from control_process.tracking import Tracking
import base64

from cv_process.main import LIVE_STREAM_SHM_NAME


logger = logging.getLogger(__name__)


@dataclass
class StatusResponse:
    armed: bool
    tilt: float
    pan: float
    preview: Optional[str]
    bbox: Optional[BoundingBox]
    average_fps: float
    cpu_utilization: float
    gpu_utilization: float
    core_temperature_celsius: float
    system_power_w: float
    memory_used_bytes: int
    memory_total_bytes: int
    disk_used_bytes: int
    disk_total_bytes: int
    recording_duration_left_s: int
    timestamp_ms: int
    is_recording: bool
    longitude: Optional[float]
    latitude: Optional[float]


class BoundingBoxCollection:
    _cv_data_list: list[CVData]

    def __init__(self):
        self._cv_data_list = []

    def received_data(self, data: CVData):
        self._cv_data_list.append(data)

        if len(self._cv_data_list) > 10:
            self._cv_data_list.pop(0)

    def get_bbox(self, pts_ns: int) -> BoundingBox | None:
        if not self._cv_data_list:
            return None

        # Find the latest CVData earlier than or equal to pts_ns, within 40ms
        for cv_data in reversed(self._cv_data_list):
            if cv_data.pts_ns <= pts_ns:
                if pts_ns - cv_data.pts_ns < 40_000_000:  # 40ms in ns
                    return cv_data.bounding_box
                break

        return None

    def get_latest_valid_bbox(self) -> BoundingBox | None:
        for cv_data in reversed(self._cv_data_list):
            if cv_data.bounding_box is not None:
                return cv_data.bounding_box
        return None

RECORDING_DATABASE_BASE_PATH = "/mnt/data/data"

class StateManagement:
    def __init__(self):
        self.database = RecordingDatabase(base_path=RECORDING_DATABASE_BASE_PATH)
        self._in_progress_recording_id = None

        self._download_count = 0
        self._download_lock = threading.Lock()

        self._gimbal_lock = threading.Lock()
        self._last_gimbal_measure_time = 0.0
        self._last_gimbal_measure = (0.0, 0.0)

        self._armed = False
        self._last_preview_frame: PreviewData | None = None
        self._last_cv_data: CVData | None = None
        self._system_status = SystemStatusMonitor()

        self._gimbal = GimbalSerial(port="/dev/ttyTHS1", baudrate=115200, timeout=0.1)
        self._gimbal.move_deg(0, 0)
        self._tracking = Tracking(
            gimbal=self._gimbal, width=1080, height=1920, k_p=0.005
        )

        self._bboxes = BoundingBoxCollection()

        self._status_led_thread = threading.Thread(
            target=self._blink_status_led, daemon=True
        )
        self._status_led_thread.start()

        cleanup_shared_memory(LIVE_STREAM_SHM_NAME)
        # Need to start live stream process before cv process, due to nvidia driver bug
        self._livestream_process = LivestreamProcessManagement()
        time.sleep(1)
        self._cv_process = CVProcessManagement(
            self._on_cvdata,
            self._on_preview,
            process_restart_callback=self._on_cv_process_restart_during_recording,
        )

    def _blink_status_led(self):
        set_scheduler_other()
        while True:
            time.sleep(0.5)
            self._gimbal.status_led(True)
            time.sleep(0.5)
            self._gimbal.status_led(False)

    def _gimbal_measure_deg_cached(self) -> tuple[float, float]:
        with self._gimbal_lock:
            now = time.perf_counter()
            if now - self._last_gimbal_measure_time < 0.02:  # 20ms
                return self._last_gimbal_measure

            try:
                self._last_gimbal_measure = self._gimbal.measure_deg()
                self._last_gimbal_measure_time = now
            except Exception as e:
                logger.warning(f"Error measuring gimbal: {e}")
            return self._last_gimbal_measure

    def _on_cvdata(self, data: CVData):
        self._last_cv_data = data
        self._bboxes.received_data(data)

        tracking_state = "idle"
        tx = 0.0
        ty = 0.0
        s = 1.0

        if self._armed:
            bbox = self._bboxes.get_latest_valid_bbox()

            if bbox:
                tracking_state = "tracking"

                # The calculation here is correct.
                # It looks weird because the shader's order of operation.
                cx = bbox.top + bbox.height / 2.0
                cy = bbox.left + bbox.width / 2.0

                tx = 0.5 - cx
                ty = cy - 0.5
                s = 0.7 / max(bbox.height, bbox.width * 9 / 16) / 16 * 9
            else:
                tracking_state = "armed"

        tilt, pan = self._gimbal_measure_deg_cached()

        osd_data = OSDData(
            pts_ns=data.pts_ns,
            translate_x=tx,
            translate_y=ty,
            scale=s,
            average_fps=data.fps,
            gimbal_tilt_deg=tilt,
            gimbal_pan_deg=pan,
            gimbal_focal_length_mm=24,  # Hardcoded for now
            device_ip_addresses=self._system_status.get_device_ip_addresses(),
            timestamp_ms=int(time.time() * 1000),
            tracking_state=tracking_state,
            longitude=None,
            latitude=None,
        )

        self._cv_process.send_osd_data(osd_data)

        if self._armed and data.bounding_box:
            self._tracking.on_detection(data.bounding_box.center())

    def _on_preview(self, data: PreviewData):
        self._last_preview_frame = data

    def arm(self):
        self._armed = True
        self._gimbal.arm_led(True)

    def disarm(self):
        self._armed = False
        self._gimbal.arm_led(False)

    def status(self):
        average_fps = (
            self._last_cv_data.fps if self._last_cv_data is not None else 0.0
        )
        latest_preview_frame = None
        bbox = None
        if self._last_preview_frame is not None:
            latest_preview_frame = base64.b64encode(
                self._last_preview_frame.frame
            ).decode("ascii")
            bbox = self._bboxes.get_bbox(self._last_preview_frame.pts_ns)

        disk_used_bytes, disk_total_bytes = self.database.space_usage_bytes()
        timestamp_ms = int(time.time() * 1000)

        tilt, pan = self._gimbal_measure_deg_cached()
        return StatusResponse(
            armed=self._armed,
            tilt=tilt,
            pan=pan,
            preview=latest_preview_frame,
            bbox=bbox,
            average_fps=average_fps,
            cpu_utilization=self._system_status.get_cpu_utilization(),
            gpu_utilization=self._system_status.get_gpu_utilization(),
            core_temperature_celsius=self._system_status.get_core_temperature_celsius(),
            system_power_w=self._system_status.get_system_power_w(),
            memory_used_bytes=self._system_status.get_memory_used_bytes(),
            memory_total_bytes=self._system_status.get_memory_total_bytes(),
            disk_used_bytes=disk_used_bytes,
            disk_total_bytes=disk_total_bytes,
            recording_duration_left_s=self.database.recording_duration_left_s(),
            timestamp_ms=timestamp_ms,
            is_recording=self._in_progress_recording_id is not None,
            longitude=None,
            latitude=None,
        )

    def manual_move(self, direction: str):
        if self._armed:
            return
        try:
            current_tilt, current_pan = self._gimbal_measure_deg_cached()
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

    def start_recording(self):
        recording_info = self.database.allocate_recording()
        self._cv_process.start_recording(recording_info)
        self._in_progress_recording_id = recording_info.id

    def stop_recording(self):
        self._cv_process.stop_recording()
        self._in_progress_recording_id = None

    def _on_cv_process_restart_during_recording(self):
        """Callback when CV process restarts during an active recording."""
        if self._in_progress_recording_id is not None:
            logger.info(
                f"CV process restarted during recording {self._in_progress_recording_id}, re-allocating new recording"
            )
            # Re-allocate a new recording and start it
            recording_info = self.database.allocate_recording()
            self._cv_process.start_recording(recording_info)
            self._in_progress_recording_id = recording_info.id

    def on_download_start(self):
        with self._download_lock:
            self._download_count += 1
            if self._download_count == 1:
                logger.info("Starting download/preview, pausing pipeline")
                self._cv_process.pause_pipeline()

    def on_download_end(self):
        with self._download_lock:
            self._download_count -= 1
            if self._download_count == 0:
                logger.info("All downloads/previews finished, resuming pipeline")
                self._cv_process.resume_pipeline()
            elif self._download_count < 0:
                logger.error("Download count went below 0!")
                self._download_count = 0
