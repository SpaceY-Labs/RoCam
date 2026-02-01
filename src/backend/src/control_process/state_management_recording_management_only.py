import logging
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
