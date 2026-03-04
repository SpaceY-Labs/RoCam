"""
Coverage tests for src/control_process/api/api.py.

Calls the actual `run_api_gateway` function (patching app.run and hardware deps)
to exercise the route handlers defined inside it.
"""
import json
import pytest
from unittest.mock import MagicMock, patch
from flask import Flask

from common.ipc import RecordingInfo


# ---------------------------------------------------------------------------
# Fixture: build an app by calling run_api_gateway and capturing Flask instance
# ---------------------------------------------------------------------------

def _build_app(state_management=None):
    """
    Call run_api_gateway with all external dependencies mocked.
    Captures the Flask app before app.run() blocks.
    """
    if state_management is None:
        state_management = MagicMock()
        state_management.database.list_all_recordings.return_value = []

    captured = []

    def _capture_run(self, *args, **kwargs):
        captured.append(self)

    with patch.object(Flask, "run", _capture_run), \
         patch("control_process.api.api.register_status_sse"), \
         patch("control_process.api.api.register_transcode_routes"), \
         patch("control_process.api.api.set_scheduler_other"):
        from control_process.api.api import run_api_gateway
        run_api_gateway(state_management)

    assert len(captured) == 1, "Flask.run was not called once"
    app = captured[0]
    app.testing = True
    return app.test_client(), state_management


def _make_recording(rec_id="rec1", name="My Recording"):
    return RecordingInfo(
        id=rec_id, name=name,
        start_timestamp_ms=0, duration_ms=60000,
        video_path="/tmp/v.avi", log_path="/tmp/l.txt",
        size_bytes=1024,
    )


@pytest.fixture
def client():
    sm = MagicMock()
    sm.database.list_all_recordings.return_value = []
    return _build_app(sm)


# ---------------------------------------------------------------------------
# /api/generate_204
# ---------------------------------------------------------------------------

class TestGenerate204Gateway:
    def test_returns_204(self, client):
        c, _ = client
        resp = c.get("/api/generate_204")
        assert resp.status_code == 204


# ---------------------------------------------------------------------------
# /api/manual_move
# ---------------------------------------------------------------------------

class TestManualMoveGateway:
    def test_calls_manual_move_with_direction(self, client):
        c, sm = client
        resp = c.post("/api/manual_move",
                      data=json.dumps({"direction": "up"}),
                      content_type="application/json")
        assert resp.status_code == 200
        sm.manual_move.assert_called_once_with("up")


# ---------------------------------------------------------------------------
# /api/manual_move_to
# ---------------------------------------------------------------------------

class TestManualMoveToGateway:
    def test_calls_manual_move_to_with_tilt_and_pan(self, client):
        c, sm = client
        resp = c.post("/api/manual_move_to",
                      data=json.dumps({"tilt": 45.0, "pan": -15.0}),
                      content_type="application/json")
        assert resp.status_code == 200
        sm.manual_move_to.assert_called_once_with(45.0, -15.0)


# ---------------------------------------------------------------------------
# /api/arm and /api/disarm
# ---------------------------------------------------------------------------

class TestArmDisarmGateway:
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
# /api/recordings/start and stop
# ---------------------------------------------------------------------------

class TestRecordingsStartStopGateway:
    def test_start_recording(self, client):
        c, sm = client
        resp = c.post("/api/recordings/start")
        assert resp.status_code == 200
        sm.start_recording.assert_called_once()

    def test_stop_recording(self, client):
        c, sm = client
        resp = c.post("/api/recordings/stop")
        assert resp.status_code == 200
        sm.stop_recording.assert_called_once()


# ---------------------------------------------------------------------------
# /api/recordings  (list)
# ---------------------------------------------------------------------------

class TestRecordingsListGateway:
    def test_returns_list_from_database(self):
        sm = MagicMock()
        rec = _make_recording()
        sm.database.list_all_recordings.return_value = [rec]
        c, _ = _build_app(sm)
        resp = c.get("/api/recordings")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert len(data["recordings"]) == 1


# ---------------------------------------------------------------------------
# /api/recordings/<id>  PATCH (rename)
# ---------------------------------------------------------------------------

class TestRecordingsRenameGateway:
    def test_rename_returns_200(self, client):
        c, sm = client
        resp = c.patch("/api/recordings/rec1",
                       data=json.dumps({"new_name": "Renamed"}),
                       content_type="application/json")
        assert resp.status_code == 200
        sm.database.rename_recording.assert_called_once_with("rec1", "Renamed")

    def test_rename_without_new_name_returns_400(self, client):
        c, _ = client
        resp = c.patch("/api/recordings/rec1",
                       data=json.dumps({}),
                       content_type="application/json")
        assert resp.status_code == 400

    def test_rename_with_non_string_new_name_returns_400(self, client):
        c, _ = client
        resp = c.patch("/api/recordings/rec1",
                       data=json.dumps({"new_name": 42}),
                       content_type="application/json")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# /api/recordings/<id>  DELETE
# ---------------------------------------------------------------------------

class TestRecordingsDeleteGateway:
    def test_delete_returns_200(self, client):
        c, sm = client
        resp = c.delete("/api/recordings/rec1")
        assert resp.status_code == 200
        sm.database.delete_recording.assert_called_once_with("rec1")


# ---------------------------------------------------------------------------
# _json_body helper (indirectly tested via PATCH with no body)
# ---------------------------------------------------------------------------

class TestJsonBodyHelper:
    def test_empty_body_handled_gracefully(self, client):
        c, _ = client
        # PATCH with no content-type → _json_body returns {} → new_name not str → 400
        resp = c.patch("/api/recordings/rec1", data="", content_type="text/plain")
        assert resp.status_code == 400
