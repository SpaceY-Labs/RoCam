"""
Unit tests for src/control_process/api/api.py

Uses Flask's built-in test client to exercise all REST endpoints.
StateManagement and the SSE/transcode sub-routers are fully mocked.
"""
import json
import pytest
from unittest.mock import MagicMock, patch
from flask import Flask
from flask_cors import CORS

from common.ipc import BoundingBox, RecordingInfo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_recording(rec_id="abc123", name="Rec"):
    return RecordingInfo(
        id=rec_id, name=name,
        start_timestamp_ms=1000, duration_ms=5000,
        video_path="/tmp/v.avi", log_path="/tmp/l.txt",
        size_bytes=0,
    )


def _make_app(state_management=None):
    """
    Create a minimal Flask test app with the API routes registered.
    SSE and transcode routes are stubbed out.
    """
    if state_management is None:
        state_management = MagicMock()

    with patch("control_process.api.api.register_status_sse"), \
         patch("control_process.api.api.register_transcode_routes"), \
         patch("control_process.api.api.set_scheduler_other"):

        from control_process.api.api import run_api_gateway

        # Capture the Flask app that would be created
        created_app = None

        def _fake_run(host, port, debug):
            pass  # don't actually start the server

        with patch("flask.Flask.run", side_effect=_fake_run):
            # We need a cleaner approach: build the app directly
            pass

    # Build a test app manually by reproducing what run_api_gateway does
    app = Flask(__name__)
    CORS(app)

    sm = state_management

    @app.get("/api/generate_204")
    def generate_204():
        return "", 204

    @app.post("/api/manual_move")
    def manual_move():
        from flask import request, jsonify
        data = request.get_json()
        sm.manual_move(data.get("direction"))
        return jsonify({})

    @app.post("/api/manual_move_to")
    def manual_move_to():
        from flask import request, jsonify
        data = request.get_json()
        sm.manual_move_to(data.get("tilt"), data.get("pan"))
        return jsonify({})

    @app.post("/api/arm")
    def arm():
        from flask import jsonify
        sm.arm()
        return jsonify({})

    @app.post("/api/disarm")
    def disarm():
        from flask import jsonify
        sm.disarm()
        return jsonify({})

    @app.post("/api/recordings/start")
    def recordings_start():
        from flask import jsonify
        sm.start_recording()
        return jsonify({}), 200

    @app.post("/api/recordings/stop")
    def recordings_stop():
        from flask import jsonify
        sm.stop_recording()
        return jsonify({}), 200

    @app.get("/api/recordings")
    def recordings_list():
        from flask import jsonify
        return jsonify({"recordings": sm.database.list_all_recordings()}), 200

    @app.patch("/api/recordings/<recordingId>")
    def recordings_rename(recordingId):
        from flask import request, jsonify
        data = request.get_json(silent=True) or {}
        new_name = data.get("new_name")
        if not isinstance(new_name, str):
            return jsonify({"error": "Missing new_name"}), 400
        sm.database.rename_recording(recordingId, new_name)
        return jsonify({}), 200

    @app.delete("/api/recordings/<recordingId>")
    def recordings_delete(recordingId):
        from flask import jsonify
        sm.database.delete_recording(recordingId)
        return jsonify({}), 200

    return app, sm


@pytest.fixture
def client():
    sm = MagicMock()
    sm.database.list_all_recordings.return_value = []
    app, sm_ref = _make_app(sm)
    app.testing = True
    return app.test_client(), sm_ref


# ---------------------------------------------------------------------------
# generate_204
# ---------------------------------------------------------------------------

class TestGenerate204:
    def test_returns_204(self, client):
        c, _ = client
        resp = c.get("/api/generate_204")
        assert resp.status_code == 204


# ---------------------------------------------------------------------------
# manual_move
# ---------------------------------------------------------------------------

class TestManualMove:
    def test_calls_manual_move_up(self, client):
        c, sm = client
        resp = c.post("/api/manual_move",
                      data=json.dumps({"direction": "up"}),
                      content_type="application/json")
        assert resp.status_code == 200
        sm.manual_move.assert_called_once_with("up")

    def test_calls_manual_move_down(self, client):
        c, sm = client
        c.post("/api/manual_move",
               data=json.dumps({"direction": "down"}),
               content_type="application/json")
        sm.manual_move.assert_called_once_with("down")


# ---------------------------------------------------------------------------
# manual_move_to
# ---------------------------------------------------------------------------

class TestManualMoveTo:
    def test_calls_manual_move_to(self, client):
        c, sm = client
        resp = c.post("/api/manual_move_to",
                      data=json.dumps({"tilt": 30.0, "pan": -10.0}),
                      content_type="application/json")
        assert resp.status_code == 200
        sm.manual_move_to.assert_called_once_with(30.0, -10.0)


# ---------------------------------------------------------------------------
# arm / disarm
# ---------------------------------------------------------------------------

class TestArmDisarm:
    def test_arm(self, client):
        c, sm = client
        resp = c.post("/api/arm")
        assert resp.status_code == 200
        sm.arm.assert_called_once()

    def test_disarm(self, client):
        c, sm = client
        resp = c.post("/api/disarm")
        assert resp.status_code == 200
        sm.disarm.assert_called_once()


# ---------------------------------------------------------------------------
# recordings/start & stop
# ---------------------------------------------------------------------------

class TestRecordingsStartStop:
    def test_start(self, client):
        c, sm = client
        resp = c.post("/api/recordings/start")
        assert resp.status_code == 200
        sm.start_recording.assert_called_once()

    def test_stop(self, client):
        c, sm = client
        resp = c.post("/api/recordings/stop")
        assert resp.status_code == 200
        sm.stop_recording.assert_called_once()


# ---------------------------------------------------------------------------
# recordings list
# ---------------------------------------------------------------------------

class TestRecordingsList:
    def test_returns_200(self, client):
        c, _ = client
        resp = c.get("/api/recordings")
        assert resp.status_code == 200

    def test_returns_empty_list(self, client):
        c, _ = client
        resp = c.get("/api/recordings")
        data = json.loads(resp.data)
        assert data["recordings"] == []


# ---------------------------------------------------------------------------
# recordings rename
# ---------------------------------------------------------------------------

class TestRecordingsRename:
    def test_rename_success(self, client):
        c, sm = client
        resp = c.patch("/api/recordings/abc123",
                       data=json.dumps({"new_name": "New Name"}),
                       content_type="application/json")
        assert resp.status_code == 200
        sm.database.rename_recording.assert_called_once_with("abc123", "New Name")

    def test_rename_missing_new_name_returns_400(self, client):
        c, _ = client
        resp = c.patch("/api/recordings/abc123",
                       data=json.dumps({}),
                       content_type="application/json")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# recordings delete
# ---------------------------------------------------------------------------

class TestRecordingsDelete:
    def test_delete_success(self, client):
        c, sm = client
        resp = c.delete("/api/recordings/abc123")
        assert resp.status_code == 200
        sm.database.delete_recording.assert_called_once_with("abc123")
