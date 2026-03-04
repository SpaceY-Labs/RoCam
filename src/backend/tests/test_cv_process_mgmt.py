"""
Unit tests for src/control_process/cv_process_management.py

Covers:
  - CVProcessManagement.send_osd_data() - sends OSDData when connection is open
  - CVProcessManagement.start_recording() - sends RecordingInfo over IPC
  - CVProcessManagement.stop_recording() - sends StopRecording sentinel
  - CVProcessManagement.pause_pipeline() - sets paused flag, terminates process
  - CVProcessManagement.resume_pipeline() - clears paused flag, sets event
  - CVProcessManagement._on_cv_timeout() - terminates current process
  - CVProcessManagement._recv_loop() - dispatches CVData and PreviewData
"""
import threading
import pytest
from unittest.mock import MagicMock, patch, call

from common.ipc import OSDData, CVData, PreviewData, RecordingInfo, StopRecording
from control_process.cv_process_management import CVProcessManagement


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mgmt():
    """Construct CVProcessManagement with all blocking I/O mocked out."""
    mock_server = MagicMock()

    with patch("control_process.cv_process_management.create_rocam_ipc_server",
               return_value=mock_server), \
         patch("control_process.cv_process_management.Watchdog"), \
         patch("threading.Thread"):  # prevent background thread from starting
        mgmt = CVProcessManagement(
            cvdata_callback=MagicMock(),
            preview_callback=MagicMock(),
            process_restart_callback=MagicMock(),
        )
    return mgmt


def _make_osd():
    return OSDData(
        pts_ns=0, translate_x=0.0, translate_y=0.0, scale=1.0,
        average_fps=30.0, gimbal_tilt_deg=0.0, gimbal_pan_deg=0.0,
        gimbal_focal_length_mm=24.0, device_ip_addresses=[],
        timestamp_ms=0, tracking_state="idle",
        longitude=None, latitude=None,
    )


# ---------------------------------------------------------------------------
# send_osd_data
# ---------------------------------------------------------------------------

class TestSendOsdData:
    def test_sends_when_conn_open(self):
        mgmt = _make_mgmt()
        mock_conn = MagicMock()
        mgmt._conn = mock_conn
        osd = _make_osd()
        mgmt.send_osd_data(osd)
        mock_conn.send.assert_called_once_with(osd)

    def test_does_nothing_when_no_conn(self):
        mgmt = _make_mgmt()
        mgmt._conn = None
        osd = _make_osd()
        mgmt.send_osd_data(osd)  # should not raise

    def test_swallows_send_exception(self):
        mgmt = _make_mgmt()
        mock_conn = MagicMock()
        mock_conn.send.side_effect = OSError("broken pipe")
        mgmt._conn = mock_conn
        osd = _make_osd()
        mgmt.send_osd_data(osd)  # should not raise


# ---------------------------------------------------------------------------
# start_recording / stop_recording
# ---------------------------------------------------------------------------

class TestRecordingCommands:
    def test_start_recording_sends_info(self):
        mgmt = _make_mgmt()
        mock_conn = MagicMock()
        mgmt._conn = mock_conn
        info = RecordingInfo(id="abc", name="test", start_timestamp_ms=None,
                             duration_ms=None, video_path="/tmp/v.avi",
                             log_path="/tmp/l.txt", size_bytes=0)
        mgmt.start_recording(info)
        mock_conn.send.assert_called_once_with(info)

    def test_stop_recording_sends_sentinel(self):
        mgmt = _make_mgmt()
        mock_conn = MagicMock()
        mgmt._conn = mock_conn
        mgmt.stop_recording()
        args = mock_conn.send.call_args[0]
        assert isinstance(args[0], StopRecording)

    def test_start_recording_no_conn_is_safe(self):
        mgmt = _make_mgmt()
        mgmt._conn = None
        info = RecordingInfo(id="x", name="n", start_timestamp_ms=None,
                             duration_ms=None, video_path="", log_path="", size_bytes=0)
        mgmt.start_recording(info)  # should not raise

    def test_stop_recording_no_conn_is_safe(self):
        mgmt = _make_mgmt()
        mgmt._conn = None
        mgmt.stop_recording()  # should not raise


# ---------------------------------------------------------------------------
# pause_pipeline / resume_pipeline
# ---------------------------------------------------------------------------

class TestPauseResume:
    def test_pause_sets_flag(self):
        mgmt = _make_mgmt()
        mgmt.pause_pipeline()
        assert mgmt._paused is True

    def test_pause_terminates_current_process(self):
        mgmt = _make_mgmt()
        mock_proc = MagicMock()
        mgmt._current_process = mock_proc
        mgmt.pause_pipeline()
        mock_proc.terminate.assert_called_once()

    def test_pause_no_process_is_safe(self):
        mgmt = _make_mgmt()
        mgmt._current_process = None
        mgmt.pause_pipeline()  # should not raise

    def test_resume_clears_flag(self):
        mgmt = _make_mgmt()
        mgmt._paused = True
        mgmt.resume_pipeline()
        assert mgmt._paused is False

    def test_resume_sets_event(self):
        mgmt = _make_mgmt()
        mgmt._paused = True
        mgmt.resume_pipeline()
        assert mgmt._resume_event.is_set()


# ---------------------------------------------------------------------------
# _on_cv_timeout
# ---------------------------------------------------------------------------

class TestOnCvTimeout:
    def test_terminates_current_process_when_not_paused(self):
        mgmt = _make_mgmt()
        mock_proc = MagicMock()
        mgmt._current_process = mock_proc
        mgmt._paused = False
        mgmt._on_cv_timeout()
        mock_proc.terminate.assert_called_once()

    def test_does_not_terminate_when_paused(self):
        mgmt = _make_mgmt()
        mock_proc = MagicMock()
        mgmt._current_process = mock_proc
        mgmt._paused = True
        mgmt._on_cv_timeout()
        mock_proc.terminate.assert_not_called()

    def test_no_process_is_safe(self):
        mgmt = _make_mgmt()
        mgmt._current_process = None
        mgmt._paused = False
        mgmt._on_cv_timeout()  # should not raise


# ---------------------------------------------------------------------------
# _recv_loop
# ---------------------------------------------------------------------------

class TestRecvLoop:
    def test_dispatches_cvdata(self):
        mgmt = _make_mgmt()
        cv_cb = MagicMock()
        mgmt._cvdata_callback = cv_cb
        mgmt._watchdog = MagicMock()

        cvdata = CVData(pts_ns=1, fps=30.0, bounding_box=None)
        mock_conn = MagicMock()
        mock_conn.recv.side_effect = [cvdata, EOFError()]

        mgmt._recv_loop(mock_conn)
        cv_cb.assert_called_once_with(cvdata)

    def test_dispatches_preview_data(self):
        mgmt = _make_mgmt()
        preview_cb = MagicMock()
        mgmt._preview_callback = preview_cb
        mgmt._watchdog = MagicMock()

        preview = PreviewData(pts_ns=2, frame=b"\xff")
        mock_conn = MagicMock()
        mock_conn.recv.side_effect = [preview, EOFError()]

        mgmt._recv_loop(mock_conn)
        preview_cb.assert_called_once_with(preview)

    def test_stops_on_eof(self):
        mgmt = _make_mgmt()
        mgmt._watchdog = MagicMock()

        mock_conn = MagicMock()
        mock_conn.recv.side_effect = [EOFError()]

        # Should not raise and should exit cleanly
        mgmt._recv_loop(mock_conn)
