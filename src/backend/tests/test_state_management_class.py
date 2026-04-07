"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for the StateManagement class with fully mocked hardware dependencies.
"""
import time
import pytest
from unittest.mock import MagicMock, patch, call
from common.ipc import BoundingBox, CVData, PreviewData, RecordingInfo, OSDData


# ---------------------------------------------------------------------------
# Fixture: create a fully-mocked StateManagement instance
# ---------------------------------------------------------------------------

@pytest.fixture
def sm():
    mock_gimbal = MagicMock()
    mock_gimbal.gimbal_info.return_value = ((0.0, 90.0), (-45.0, 45.0), (24.0, 24.0))
    mock_gimbal.get_deg.return_value = (10.0, 5.0)

    mock_db = MagicMock()
    mock_sys_status = MagicMock()
    mock_sys_status.get_cpu_utilization.return_value = 20.0
    mock_sys_status.get_gpu_utilization.return_value = 30.0
    mock_sys_status.get_core_temperature_celsius.return_value = 45.0
    mock_sys_status.get_system_power_w.return_value = 10.0
    mock_sys_status.get_memory_used_bytes.return_value = 1024
    mock_sys_status.get_memory_total_bytes.return_value = 4096
    mock_sys_status.get_device_ip_addresses.return_value = ["192.168.1.1"]
    mock_tracking = MagicMock()
    mock_cv_process = MagicMock()
    mock_livestream = MagicMock()

    mock_thread = MagicMock()

    with patch("control_process.state_management.RecordingDatabase", return_value=mock_db), \
         patch("control_process.state_management.SystemStatusMonitor", return_value=mock_sys_status), \
         patch("control_process.state_management.GimbalSerial", return_value=mock_gimbal), \
         patch("control_process.state_management.Tracking", return_value=mock_tracking), \
         patch("control_process.state_management.cleanup_shared_memory"), \
         patch("control_process.state_management.LivestreamProcessManagement", return_value=mock_livestream), \
         patch("control_process.state_management.CVProcessManagement", return_value=mock_cv_process), \
         patch("control_process.state_management.threading") as mock_threading, \
         patch("control_process.state_management.time.sleep"), \
         patch("control_process.state_management.set_scheduler_other"):

        mock_threading.Lock.return_value = MagicMock()
        mock_threading.Thread.return_value = mock_thread

        from control_process.state_management import StateManagement
        instance = StateManagement()

    # Replace internal objects with the mocks for easy inspection
    instance._gimbal = mock_gimbal
    instance._cv_process = mock_cv_process
    instance._system_status = mock_sys_status
    instance.database = mock_db
    instance._tracking = mock_tracking
    # Reset call history accumulated during __init__ (e.g. set_deg(0,0))
    mock_gimbal.reset_mock()
    mock_gimbal.get_deg.return_value = (10.0, 5.0)
    yield instance


# ---------------------------------------------------------------------------
# arm / disarm
# ---------------------------------------------------------------------------

class TestArmDisarm:
    def test_arm_sets_flag_and_led(self, sm):
        sm.arm()
        assert sm._armed is True
        sm._gimbal.set_arm_led.assert_called_with(True)

    def test_disarm_clears_flag_and_led(self, sm):
        sm._armed = True
        sm.disarm()
        assert sm._armed is False
        sm._gimbal.set_arm_led.assert_called_with(False)


# ---------------------------------------------------------------------------
# status()
# ---------------------------------------------------------------------------

class TestStatus:
    def test_status_returns_unarmed_by_default(self, sm):
        sm.database.space_usage_bytes.return_value = (100, 1000)
        sm.database.recording_duration_left_s.return_value = 3600
        sm._gimbal.get_deg.return_value = (0.0, 0.0)
        status = sm.status()
        assert status.armed is False
        assert status.is_recording is False
        assert status.preview is None
        assert status.bbox is None

    def test_status_includes_system_metrics(self, sm):
        sm.database.space_usage_bytes.return_value = (512, 2048)
        sm.database.recording_duration_left_s.return_value = 120
        status = sm.status()
        assert status.cpu_utilization == 20.0
        assert status.memory_used_bytes == 1024
        assert status.disk_used_bytes == 512
        assert status.disk_total_bytes == 2048

    def test_status_with_preview_frame(self, sm):
        import base64
        sm.database.space_usage_bytes.return_value = (0, 0)
        sm.database.recording_duration_left_s.return_value = 0
        frame_data = b"jpeg_data"
        preview = PreviewData(frame=frame_data, pts_ns=1_000_000_000)
        sm._last_preview_frame = preview
        status = sm.status()
        expected = base64.b64encode(frame_data).decode("ascii")
        assert status.preview == expected

    def test_status_is_recording_when_in_progress(self, sm):
        sm._in_progress_recording_id = "rec123"
        sm.database.space_usage_bytes.return_value = (0, 0)
        sm.database.recording_duration_left_s.return_value = 0
        status = sm.status()
        assert status.is_recording is True


# ---------------------------------------------------------------------------
# manual_move
# ---------------------------------------------------------------------------

class TestManualMove:
    def setup_method(self):
        pass

    def test_manual_move_ignored_when_armed(self, sm):
        sm._armed = True
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm.manual_move("up")
        sm._gimbal.set_deg.assert_not_called()

    def test_manual_move_up_increases_tilt(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(20.0, 0.0))
        sm.manual_move("up")
        sm._gimbal.set_deg.assert_called_with(30.0, 0.0)

    def test_manual_move_down_decreases_tilt(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(50.0, 0.0))
        sm.manual_move("down")
        tilt, pan = sm._gimbal.set_deg.call_args[0]
        assert tilt == 40.0

    def test_manual_move_left_decreases_pan(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 10.0))
        sm.manual_move("left")
        tilt, pan = sm._gimbal.set_deg.call_args[0]
        assert pan == 0.0

    def test_manual_move_right_increases_pan(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm.manual_move("right")
        tilt, pan = sm._gimbal.set_deg.call_args[0]
        assert pan == 10.0

    def test_manual_move_unknown_direction_does_nothing(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm.manual_move("diagonal")
        sm._gimbal.set_deg.assert_not_called()

    def test_manual_move_clamps_tilt_to_max(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(85.0, 0.0))
        sm.manual_move("up")
        tilt, _ = sm._gimbal.set_deg.call_args[0]
        assert tilt == 90.0

    def test_manual_move_clamps_tilt_to_min(self, sm):
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(5.0, 0.0))
        sm.manual_move("down")
        tilt, _ = sm._gimbal.set_deg.call_args[0]
        assert tilt == 0.0


# ---------------------------------------------------------------------------
# manual_move_to
# ---------------------------------------------------------------------------

class TestManualMoveTo:
    def test_manual_move_to_ignored_when_armed(self, sm):
        sm._armed = True
        sm.manual_move_to(30.0, -5.0)
        sm._gimbal.set_deg.assert_not_called()

    def test_manual_move_to_sets_clamped_values(self, sm):
        sm._armed = False
        sm.manual_move_to(45.0, -20.0)
        sm._gimbal.set_deg.assert_called_once_with(45.0, -20.0)

    def test_manual_move_to_clamps_tilt(self, sm):
        sm._armed = False
        sm.manual_move_to(200.0, 0.0)
        tilt, _ = sm._gimbal.set_deg.call_args[0]
        assert tilt == 90.0

    def test_manual_move_to_clamps_pan(self, sm):
        sm._armed = False
        sm.manual_move_to(0.0, 100.0)
        _, pan = sm._gimbal.set_deg.call_args[0]
        assert pan == 45.0


# ---------------------------------------------------------------------------
# start_recording / stop_recording
# ---------------------------------------------------------------------------

class TestRecording:
    def test_start_recording_allocates_and_starts(self, sm):
        rec = RecordingInfo(
            id="rec1", name="Test",
            start_timestamp_ms=0, duration_ms=0,
            video_path="/tmp/v.avi", log_path="/tmp/l.txt",
            size_bytes=0,
        )
        sm.database.allocate_recording.return_value = rec
        sm.start_recording()
        sm._cv_process.start_recording.assert_called_once_with(rec)
        assert sm._in_progress_recording_id == "rec1"

    def test_stop_recording_stops_and_clears_id(self, sm):
        sm._in_progress_recording_id = "rec1"
        sm.stop_recording()
        sm._cv_process.stop_recording.assert_called_once()
        assert sm._in_progress_recording_id is None


# ---------------------------------------------------------------------------
# on_download_start / on_download_end
# ---------------------------------------------------------------------------

class TestDownloadHandlers:
    def test_first_download_pauses_pipeline(self, sm):
        sm._download_lock = MagicMock()
        sm._download_lock.__enter__ = MagicMock(return_value=None)
        sm._download_lock.__exit__ = MagicMock(return_value=False)
        sm._download_count = 0
        sm.on_download_start()
        sm._cv_process.pause_pipeline.assert_called_once()

    def test_second_download_does_not_pause_again(self, sm):
        sm._download_lock = MagicMock()
        sm._download_lock.__enter__ = MagicMock(return_value=None)
        sm._download_lock.__exit__ = MagicMock(return_value=False)
        sm._download_count = 1  # already paused
        sm.on_download_start()
        sm._cv_process.pause_pipeline.assert_not_called()

    def test_last_download_end_resumes_pipeline(self, sm):
        sm._download_lock = MagicMock()
        sm._download_lock.__enter__ = MagicMock(return_value=None)
        sm._download_lock.__exit__ = MagicMock(return_value=False)
        sm._download_count = 1
        sm.on_download_end()
        sm._cv_process.resume_pipeline.assert_called_once()

    def test_download_end_negative_count_resets_to_zero(self, sm):
        sm._download_lock = MagicMock()
        sm._download_lock.__enter__ = MagicMock(return_value=None)
        sm._download_lock.__exit__ = MagicMock(return_value=False)
        sm._download_count = 0
        sm.on_download_end()
        assert sm._download_count == 0


# ---------------------------------------------------------------------------
# _on_cvdata
# ---------------------------------------------------------------------------

class TestOnCvdata:
    def test_on_cvdata_updates_last_cv_data(self, sm):
        cv_data = CVData(pts_ns=1_000_000, fps=30.0, bounding_box=None)
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm._on_cvdata(cv_data)
        assert sm._last_cv_data is cv_data

    def test_on_cvdata_sends_osd_data(self, sm):
        cv_data = CVData(pts_ns=1_000_000, fps=25.0, bounding_box=None)
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(10.0, -5.0))
        sm._on_cvdata(cv_data)
        sm._cv_process.send_osd_data.assert_called_once()

    def test_on_cvdata_tracking_when_armed_with_bbox(self, sm):
        bbox = BoundingBox(conf=0.9, left=0.1, top=0.2, width=0.3, height=0.4)
        cv_data = CVData(pts_ns=1_000_000, fps=30.0, bounding_box=bbox)
        sm._armed = True
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm._on_cvdata(cv_data)
        sm._tracking.on_detection.assert_called_once()

    def test_on_cvdata_no_tracking_when_disarmed(self, sm):
        bbox = BoundingBox(conf=0.9, left=0.1, top=0.2, width=0.3, height=0.4)
        cv_data = CVData(pts_ns=1_000_000, fps=30.0, bounding_box=bbox)
        sm._armed = False
        sm._gimbal_measure_deg_cached = MagicMock(return_value=(0.0, 0.0))
        sm._on_cvdata(cv_data)
        sm._tracking.on_detection.assert_not_called()


# ---------------------------------------------------------------------------
# _on_cv_process_restart_during_recording
# ---------------------------------------------------------------------------

class TestOnCvProcessRestart:
    def test_reallocates_recording_when_in_progress(self, sm):
        rec = RecordingInfo(
            id="rec2", name="New",
            start_timestamp_ms=0, duration_ms=0,
            video_path="/v.avi", log_path="/l.txt",
            size_bytes=0,
        )
        sm._in_progress_recording_id = "rec1"
        sm.database.allocate_recording.return_value = rec
        sm._on_cv_process_restart_during_recording()
        sm._cv_process.start_recording.assert_called_once_with(rec)
        assert sm._in_progress_recording_id == "rec2"

    def test_does_nothing_when_not_recording(self, sm):
        sm._in_progress_recording_id = None
        sm._on_cv_process_restart_during_recording()
        sm.database.allocate_recording.assert_not_called()
