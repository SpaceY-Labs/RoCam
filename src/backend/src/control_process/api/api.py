import logging
import os
from pathlib import Path

from common.utils import set_scheduler_other
from control_process.state_management import StateManagement
from control_process.state_management_recording_management_only import (
    StateManagementRecordingManagementOnly,
)
from control_process.api.sse import register_logs_sse, register_status_sse
from control_process.api.transcode import register_transcode_routes
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS


logger = logging.getLogger(__name__)
logging.getLogger("werkzeug").setLevel(logging.WARN)


def _json_body():
    return request.get_json(silent=True) or {}


def run_api_gateway(
    state_management: StateManagement | StateManagementRecordingManagementOnly,
) -> None:
    set_scheduler_other()

    app = Flask(__name__)
    CORS(app)

    register_status_sse(app, state_management)
    register_logs_sse(app)
    register_transcode_routes(app, state_management)

    @app.get("/api/generate_204")
    def generate_204():
        return "", 204

    FRONTEND_DIR = Path("../react-app/dist").resolve()
    if not os.path.isdir(FRONTEND_DIR):
        logger.warning(f"{FRONTEND_DIR} does not exist.")

    @app.post("/api/manual_move")
    def manual_move():
        data = request.get_json()
        direction = data.get("direction")
        state_management.manual_move(direction)
        return jsonify({})

    @app.post("/api/manual_move_to")
    def manual_move_to():
        data = request.get_json()
        tilt = data.get("tilt")
        pan = data.get("pan")
        state_management.manual_move_to(tilt, pan)
        return jsonify({})

    @app.post("/api/set_focal_length")
    def set_focal_length():
        data = request.get_json()
        focal_length_mm = data.get("focal_length_mm")
        state_management.set_focal_length(focal_length_mm)
        return jsonify({})

    @app.post("/api/arm")
    def arm():
        state_management.arm()
        return jsonify({})

    @app.post("/api/disarm")
    def disarm():
        state_management.disarm()
        return jsonify({})

    @app.post("/api/recordings/start")
    def recordings_start():
        state_management.start_recording()
        return jsonify({}), 200

    @app.post("/api/recordings/stop")
    def recordings_stop():
        state_management.stop_recording()
        return jsonify({}), 200

    @app.get("/api/recordings")
    def recordings_list():
        return jsonify(
            {"recordings": state_management.database.list_all_recordings()}
        ), 200

    @app.patch("/api/recordings/<recordingId>")
    def recordings_rename(recordingId: str):
        data = _json_body()
        new_name = data.get("new_name")
        if not isinstance(new_name, str):
            return jsonify({"error": "Missing new_name"}), 400
        state_management.database.rename_recording(recordingId, new_name)
        return jsonify({}), 200

    @app.delete("/api/recordings/<recordingId>")
    def recordings_delete(recordingId: str):
        state_management.database.delete_recording(recordingId)
        return jsonify({}), 200

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        try:
            return send_from_directory(FRONTEND_DIR, path)
        except Exception:
            return send_from_directory(FRONTEND_DIR, "index.html")

    app.run(host="0.0.0.0", port=80, debug=False)
