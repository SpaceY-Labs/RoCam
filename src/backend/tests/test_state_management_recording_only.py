"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for StateManagementRecordingManagementOnly and control_process entry points.
"""
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# StateManagementRecordingManagementOnly
# ---------------------------------------------------------------------------

@pytest.fixture
def smro():
    mock_db = MagicMock()
    mock_db.space_usage_bytes.return_value = (100, 1000)
    mock_db.recording_duration_left_s.return_value = 3600
    mock_sys = MagicMock()
    mock_sys.get_cpu_utilization.return_value = 10.0
    mock_sys.get_gpu_utilization.return_value = 20.0
    mock_sys.get_core_temperature_celsius.return_value = 40.0
    mock_sys.get_system_power_w.return_value = 5.0
    mock_sys.get_memory_used_bytes.return_value = 512
    mock_sys.get_memory_total_bytes.return_value = 2048

    with patch("control_process.state_management_recording_management_only.RecordingDatabase", return_value=mock_db), \
         patch("control_process.state_management_recording_management_only.SystemStatusMonitor", return_value=mock_sys):
        from control_process.state_management_recording_management_only import (
            StateManagementRecordingManagementOnly,
        )
        instance = StateManagementRecordingManagementOnly()

    instance.database = mock_db
    instance._system_status = mock_sys
    return instance


class TestStateManagementRecordingOnly:
    def test_arm_is_noop(self, smro):
        smro.arm()  # should not raise

    def test_disarm_is_noop(self, smro):
        smro.disarm()

    def test_manual_move_is_noop(self, smro):
        smro.manual_move("up")

    def test_manual_move_to_is_noop(self, smro):
        smro.manual_move_to(30.0, -5.0)

    def test_start_recording_is_noop(self, smro):
        smro.start_recording()

    def test_stop_recording_is_noop(self, smro):
        smro.stop_recording()

    def test_on_download_start_is_noop(self, smro):
        smro.on_download_start()

    def test_on_download_end_is_noop(self, smro):
        smro.on_download_end()

    def test_status_returns_status_response(self, smro):
        from control_process.state_management import StatusResponse
        status = smro.status()
        assert isinstance(status, StatusResponse)

    def test_status_is_never_armed(self, smro):
        status = smro.status()
        assert status.armed is False

    def test_status_is_never_recording(self, smro):
        status = smro.status()
        assert status.is_recording is False

    def test_status_has_no_preview(self, smro):
        status = smro.status()
        assert status.preview is None

    def test_status_contains_system_metrics(self, smro):
        status = smro.status()
        assert status.cpu_utilization == 10.0
        assert status.memory_used_bytes == 512
        assert status.disk_used_bytes == 100
        assert status.disk_total_bytes == 1000

    def test_status_contains_recording_duration(self, smro):
        status = smro.status()
        assert status.recording_duration_left_s == 3600

    def test_status_timestamp_is_recent(self, smro):
        import time
        before = int(time.time() * 1000)
        status = smro.status()
        after = int(time.time() * 1000)
        assert before <= status.timestamp_ms <= after


# ---------------------------------------------------------------------------
# control_process/main.py  run_control_process / run_recording_management
# ---------------------------------------------------------------------------

class TestControlProcessMain:
    def test_run_control_process_starts_api_thread(self):
        with patch("control_process.main.set_scheduler_fifo"), \
             patch("control_process.main.StateManagement") as mock_sm_cls, \
             patch("control_process.main.Thread") as mock_thread_cls, \
             patch("control_process.main.run_api_gateway"):
            mock_sm = MagicMock()
            mock_sm_cls.return_value = mock_sm
            mock_thread = MagicMock()
            mock_thread_cls.return_value = mock_thread

            from control_process.main import run_control_process
            run_control_process()

        mock_thread.start.assert_called_once()
        mock_thread.join.assert_called_once()

    def test_run_recording_management_starts_api_thread(self):
        with patch("control_process.main.set_scheduler_other"), \
             patch("control_process.main.StateManagementRecordingManagementOnly") as mock_smro_cls, \
             patch("control_process.main.Thread") as mock_thread_cls, \
             patch("control_process.main.run_api_gateway"):
            mock_smro = MagicMock()
            mock_smro_cls.return_value = mock_smro
            mock_thread = MagicMock()
            mock_thread_cls.return_value = mock_thread

            from control_process.main import run_recording_management
            run_recording_management()

        mock_thread.start.assert_called_once()
        mock_thread.join.assert_called_once()
