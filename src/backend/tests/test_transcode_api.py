"""
Unit tests for src/control_process/api/transcode.py

Covers:
  - _cleanup_pipe() - removes named pipe file, tolerates missing file, swallows OSError
  - register_transcode_routes() - HTTP 404 when recording not found
"""
import os
import pytest
from unittest.mock import MagicMock, patch

from control_process.api.transcode import _cleanup_pipe


# ---------------------------------------------------------------------------
# _cleanup_pipe
# ---------------------------------------------------------------------------

class TestCleanupPipe:
    def test_removes_existing_pipe(self, tmp_path):
        pipe = tmp_path / "test.pipe"
        pipe.write_bytes(b"")
        _cleanup_pipe(str(pipe))
        assert not pipe.exists()

    def test_ignores_missing_pipe(self):
        _cleanup_pipe("/tmp/nonexistent_rocam_pipe.pipe")  # should not raise

    def test_swallows_oserror_on_unlink(self):
        with patch("control_process.api.transcode.os.path.exists", return_value=True), \
             patch("control_process.api.transcode.os.unlink", side_effect=OSError("busy")):
            _cleanup_pipe("/tmp/fake.pipe")  # should not raise


# ---------------------------------------------------------------------------
# register_transcode_routes - 404 when recording not found
# ---------------------------------------------------------------------------

class TestTranscodeRoutes:
    def _make_app_with_transcode(self, recording=None):
        from flask import Flask
        from flask_cors import CORS
        from control_process.api.transcode import register_transcode_routes

        app = Flask(__name__)
        CORS(app)

        sm = MagicMock()
        sm.database.get_recording_by_id.return_value = recording

        register_transcode_routes(app, sm)
        app.testing = True
        return app.test_client(), sm

    def test_preview_returns_404_when_not_found(self):
        c, _ = self._make_app_with_transcode(recording=None)
        resp = c.get("/api/recordings/missing_id/preview-stabilized")
        assert resp.status_code == 404

    def test_download_returns_404_when_not_found(self):
        c, _ = self._make_app_with_transcode(recording=None)
        resp = c.get("/api/recordings/missing_id/download-stabilized")
        assert resp.status_code == 404

    def test_preview_calls_on_download_start_when_found(self):
        from common.ipc import RecordingInfo
        rec = RecordingInfo(
            id="r1", name="Test Rec",
            start_timestamp_ms=0, duration_ms=0,
            video_path="/v.avi", log_path="/l.txt",
            size_bytes=0,
        )
        with patch(
            "control_process.api.transcode._stream_from_transcode_process",
            return_value=iter([b"chunk1", b"chunk2"]),
        ):
            c, sm = self._make_app_with_transcode(recording=rec)
            resp = c.get(f"/api/recordings/{rec.id}/preview-stabilized")
            _ = resp.data  # consume the stream to trigger finally block
        assert resp.status_code == 200
        sm.on_download_start.assert_called_once()

    def test_download_calls_on_download_start_when_found(self):
        from common.ipc import RecordingInfo
        rec = RecordingInfo(
            id="r2", name="Test Rec 2",
            start_timestamp_ms=0, duration_ms=0,
            video_path="/v.avi", log_path="/l.txt",
            size_bytes=0,
        )
        with patch(
            "control_process.api.transcode._stream_from_transcode_process",
            return_value=iter([b"data"]),
        ):
            c, sm = self._make_app_with_transcode(recording=rec)
            resp = c.get(f"/api/recordings/{rec.id}/download-stabilized")
            _ = resp.data
        assert resp.status_code == 200
        sm.on_download_start.assert_called_once()

    def test_preview_content_type_is_video_webm(self):
        from common.ipc import RecordingInfo
        rec = RecordingInfo(
            id="r3", name="Rec",
            start_timestamp_ms=0, duration_ms=0,
            video_path="/v.avi", log_path="/l.txt",
            size_bytes=0,
        )
        with patch(
            "control_process.api.transcode._stream_from_transcode_process",
            return_value=iter([b""]),
        ):
            c, _ = self._make_app_with_transcode(recording=rec)
            resp = c.get(f"/api/recordings/{rec.id}/preview-stabilized")
        assert "video/webm" in resp.content_type


# ---------------------------------------------------------------------------
# _create_named_pipe
# ---------------------------------------------------------------------------

class TestCreateNamedPipe:
    def test_creates_a_fifo_at_returned_path(self, tmp_path):
        import os
        from control_process.api.transcode import _create_named_pipe
        # We need to redirect mkfifo to tmp_path by mocking os.mkfifo and os.path.join
        pipe_path = str(tmp_path / "test.pipe")
        with patch("control_process.api.transcode.os.mkfifo") as mock_mkfifo, \
             patch("control_process.api.transcode.os.path.join", return_value=pipe_path):
            result = _create_named_pipe("test-recording-id")
        assert result == pipe_path
        mock_mkfifo.assert_called_once_with(pipe_path)


# ---------------------------------------------------------------------------
# _stream_from_transcode_process
# ---------------------------------------------------------------------------

def _make_recording_info(rec_id="r99"):
    from common.ipc import RecordingInfo
    return RecordingInfo(
        id=rec_id, name="Test",
        start_timestamp_ms=0, duration_ms=0,
        video_path="/tmp/v.avi", log_path="/tmp/l.txt",
        size_bytes=0,
    )


class TestStreamFromTranscodeProcess:
    def _default_patches(self, pipe_path="/tmp/test.pipe", chunks=None):
        """Return a context manager with all OS-level mocks."""
        from contextlib import ExitStack

        if chunks is None:
            chunks = [b"hello", b""]

        stack = ExitStack()
        stack.enter_context(patch(
            "control_process.api.transcode._create_named_pipe",
            return_value=pipe_path,
        ))
        stack.enter_context(patch("control_process.api.transcode._cleanup_pipe"))
        mock_popen = stack.enter_context(patch("control_process.api.transcode.subprocess.Popen"))
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # still running
        mock_proc.wait.return_value = 0
        mock_popen.return_value = mock_proc

        stack.enter_context(patch("control_process.api.transcode.os.open", return_value=5))
        stack.enter_context(patch(
            "control_process.api.transcode.select.select",
            return_value=([5], [], []),
        ))
        stack.enter_context(patch("control_process.api.transcode.fcntl.fcntl"))
        stack.enter_context(patch("control_process.api.transcode.os.read", side_effect=chunks))
        stack.enter_context(patch("control_process.api.transcode.os.close"))

        return stack, mock_popen, mock_proc

    def test_yields_data_chunks(self):
        from control_process.api.transcode import _stream_from_transcode_process

        rec = _make_recording_info()
        stack, _, _ = self._default_patches(chunks=[b"chunk1", b"chunk2", b""])

        with stack:
            result = list(_stream_from_transcode_process("preview-stabilized", rec))

        assert result == [b"chunk1", b"chunk2"]

    def test_cleanup_pipe_called_in_finally(self):
        from control_process.api.transcode import _stream_from_transcode_process

        rec = _make_recording_info()
        stack, _, _ = self._default_patches(chunks=[b""])
        cleanup_mock = stack._exit_callbacks[1]  # second entered mock

        with patch("control_process.api.transcode._create_named_pipe", return_value="/tmp/x.pipe"), \
             patch("control_process.api.transcode._cleanup_pipe") as mock_cleanup, \
             patch("control_process.api.transcode.subprocess.Popen") as mock_popen, \
             patch("control_process.api.transcode.os.open", return_value=5), \
             patch("control_process.api.transcode.select.select", return_value=([5], [], [])), \
             patch("control_process.api.transcode.fcntl.fcntl"), \
             patch("control_process.api.transcode.os.read", return_value=b""), \
             patch("control_process.api.transcode.os.close"):
            mock_proc = MagicMock()
            mock_proc.poll.return_value = None
            mock_proc.wait.return_value = 0
            mock_popen.return_value = mock_proc
            list(_stream_from_transcode_process("download-stabilized", rec))

        mock_cleanup.assert_called_once_with("/tmp/x.pipe")

    def test_process_exited_before_pipe_raises_runtime_error(self):
        from control_process.api.transcode import _stream_from_transcode_process

        rec = _make_recording_info()
        with patch("control_process.api.transcode._create_named_pipe", return_value="/tmp/p.pipe"), \
             patch("control_process.api.transcode._cleanup_pipe"), \
             patch("control_process.api.transcode.subprocess.Popen") as mock_popen, \
             patch("control_process.api.transcode.os.open", return_value=5), \
             patch("control_process.api.transcode.select.select", return_value=([], [], [])), \
             patch("control_process.api.transcode.fcntl.fcntl"), \
             patch("control_process.api.transcode.os.close"):

            mock_proc = MagicMock()
            mock_proc.poll.return_value = 1  # process exited with code 1
            mock_popen.return_value = mock_proc

            import pytest
            with pytest.raises(RuntimeError, match="before opening pipe"):
                list(_stream_from_transcode_process("preview-stabilized", rec))

    def test_select_error_raises_runtime_error(self):
        from control_process.api.transcode import _stream_from_transcode_process

        rec = _make_recording_info()
        with patch("control_process.api.transcode._create_named_pipe", return_value="/tmp/p.pipe"), \
             patch("control_process.api.transcode._cleanup_pipe"), \
             patch("control_process.api.transcode.subprocess.Popen") as mock_popen, \
             patch("control_process.api.transcode.os.open", return_value=5), \
             patch("control_process.api.transcode.select.select",
                   side_effect=OSError("select error")), \
             patch("control_process.api.transcode.os.close"):

            mock_proc = MagicMock()
            mock_proc.poll.return_value = None
            mock_popen.return_value = mock_proc

            import pytest
            with pytest.raises(RuntimeError, match="Error waiting for pipe"):
                list(_stream_from_transcode_process("preview-stabilized", rec))
