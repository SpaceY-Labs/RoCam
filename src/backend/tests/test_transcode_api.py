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
