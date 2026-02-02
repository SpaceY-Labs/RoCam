import logging
import time
from control_process.database import RecordingDatabase
from control_process.state_management import RECORDING_DATABASE_BASE_PATH

logger = logging.getLogger(__name__)


class StateManagementRecordingManagementOnly:
    def __init__(self):
        self.database = RecordingDatabase(base_path=RECORDING_DATABASE_BASE_PATH)

    def arm(self):
        pass

    def disarm(self):
        pass

    def status(self):
        timestamp_ms = int(time.time() * 1000)
        disk_usage_bytes = None
        recording_duration_left_ms = None
        try:
            disk_used, disk_total = self.database.space_usage_bytes()
            disk_usage_bytes = {"used": disk_used, "total": disk_total}
            bytes_per_second = self.database.estimate_recording_bytes_per_second()
            if bytes_per_second is not None and bytes_per_second > 0:
                free_bytes = max(0, disk_total - disk_used)
                recording_duration_left_ms = int(
                    free_bytes / bytes_per_second * 1000
                )
        except Exception as e:
            logger.error(f"Error reading disk usage: {e}")
        return {
            "armed": False,
            "tilt": 0,
            "pan": 0,
            "preview": None,
            "bbox": None,
            "average_fps": None,
            "cpu_utilization": None,
            "gpu_utilization": None,
            "core_temperature_celsius": None,
            "system_power_w": None,
            "memory_usage_bytes": None,
            "disk_usage_bytes": disk_usage_bytes,
            "recording_duration_left_ms": recording_duration_left_ms,
            "timestamp_ms": timestamp_ms,
            "in_progress_recording_id": None,
            "is_recording": False,
        }

    def manual_move(self, direction: str):
        pass

    def manual_move_to(self, tilt: float, pan: float):
        pass

    def start_recording(self):
        pass

    def stop_recording(self):
        pass
