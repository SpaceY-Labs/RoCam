import os
import logging
from multiprocessing.connection import Client, Listener
from dataclasses import dataclass
from typing import Literal, Optional

logger = logging.getLogger(__name__)

# coordinates are normalized (0.0 to 1.0)
@dataclass
class BoundingBox:
    conf: float
    left: float
    top: float
    width: float
    height: float

    def center(self) -> tuple[float, float]:
        cx = self.left + self.width / 2.0
        cy = self.top + self.height / 2.0
        return (cx, cy)

    def get_rotate_90_deg(self):
        return BoundingBox(
            conf=self.conf,
            left=1 - (self.top + self.height),
            top=self.left,
            width=self.height,
            height=self.width,
        )


@dataclass
class CVData:
    pts_ns: int
    fps: float
    bounding_box: Optional[BoundingBox]

@dataclass
class OSDData:
    pts_ns: int
    translate_x: float
    translate_y: float
    scale: float
    average_fps: float
    gimbal_tilt_deg: float
    gimbal_pan_deg: float
    gimbal_focal_length_mm: float
    device_ip_addresses: list[str]
    timestamp_ms: int
    tracking_state: Literal["idle", "armed", "tracking"]
    longitude: float
    latitude: float

@dataclass
class PreviewData:
    pts_ns: int
    frame: bytes

@dataclass
class RecordingInfo:
    video_path: str
    log_path: str

@dataclass
class StopRecording:
    pass

@dataclass
class RecoverLiveVideo:
    pass

def create_rocam_ipc_server(socket_path: str):
    # Clean up stale socket file from previous runs
    if os.path.exists(socket_path):
        os.remove(socket_path)
    return Listener(socket_path)


# Will block until connected to the server
def create_rocam_ipc_client(socket_path: str):
    try:
        return Client(socket_path)
    except Exception as e:
        logger.error(f"Failed to connect to IPC server: {e}")
        exit(1)
