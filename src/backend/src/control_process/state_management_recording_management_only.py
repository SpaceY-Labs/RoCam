import logging
import time
from control_process.database import RecordingDatabase
from control_process.state_management import (
    RECORDING_DATABASE_BASE_PATH,
    StatusResponse,
)
from common.system_status import SystemStatusMonitor

logger = logging.getLogger(__name__)


class StateManagementRecordingManagementOnly:
    _FOCAL_MIN_MM = 24.0
    _FOCAL_MAX_MM = 120.0

    def __init__(self):
        self.database = RecordingDatabase(base_path=RECORDING_DATABASE_BASE_PATH)
        self._system_status = SystemStatusMonitor()
        self._current_focal_length_mm = self._FOCAL_MIN_MM

    def arm(self):
        pass

    def disarm(self):
        pass

    def status(self):
        timestamp_ms = int(time.time() * 1000)
        disk_used_bytes, disk_total_bytes = self.database.space_usage_bytes()
        return StatusResponse(
            armed=False,
            tilt=0,
            pan=0,
            preview=None,
            bbox=None,
            average_fps=0,
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
            is_recording=False,
            longitude=None,
            latitude=None,
            focal_length_mm=self._current_focal_length_mm,
            focal_length_min_mm=self._FOCAL_MIN_MM,
            focal_length_max_mm=self._FOCAL_MAX_MM,
        )

    def set_focal_length(self, focal_length_mm: float):
        clamped = max(self._FOCAL_MIN_MM, min(self._FOCAL_MAX_MM, focal_length_mm))
        self._current_focal_length_mm = clamped

    def manual_move(self, direction: str):
        pass

    def manual_move_to(self, tilt: float, pan: float):
        pass

    def start_recording(self):
        pass

    def stop_recording(self):
        pass

    def on_download_start(self):
        pass

    def on_download_end(self):
        pass
