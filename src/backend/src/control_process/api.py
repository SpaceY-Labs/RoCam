import logging
import os

from common.utils import set_scheduler_other, ip4_addresses
from control_process.state_management import StateManagement
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS


logger = logging.getLogger(__name__)
logging.getLogger("werkzeug").setLevel(logging.WARN)

def _json_body():
    return request.get_json(silent=True) or {}

def run_api_gateway(state_management: StateManagement):
    set_scheduler_other()

    app = Flask(__name__)
    CORS(app)
    FRONTEND_DIR = "../frontend"

    logger.info(f"ipv4 addresses: {ip4_addresses()}")
    if not os.path.isdir(FRONTEND_DIR):
        logger.warning(f"{FRONTEND_DIR} does not exist.")

    @app.post("/api/status")
    def get_status():
        return jsonify(state_management.status())

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

    @app.post("/api/arm")
    def arm():
        state_management.arm()
        return jsonify({})

    @app.post("/api/disarm")
    def disarm():
        state_management.disarm()
        return jsonify({})

    # -------------------------
    # Recordings endpoints (MOCK IMPLEMENTATION)
    # -------------------------
    MOCK_RECORDINGS = [
        {
            "id": "mock-1",
            "filename": "sample_001.mp4",
            "createdAt": "2026-01-26T10:00:00Z",
            "durationSeconds": 12.3,
            "sizeBytes": 15000000,
        },
        {
            "id": "mock-2",
            "filename": "sample_002.mp4",
            "createdAt": "2026-01-26T09:00:00Z",
            "durationSeconds": 45.0,
            "sizeBytes": 52000000,
        },
    ]

    @app.post("/api/recordings/start")
    def recordings_start():
        return jsonify({}), 200

    @app.post("/api/recordings/stop")
    def recordings_stop():
        return jsonify({}), 200

    @app.get("/api/recordings")
    def recordings_list():
        return jsonify({"recordings": MOCK_RECORDINGS}), 200

    @app.patch("/api/recordings/<recordingId>")
    def recordings_rename(recordingId: str):
        data = _json_body()
        new_name = data.get("new_name")

        if not isinstance(new_name, str):
            return jsonify({"error": "Missing new_name"}), 400

        rec = next((r for r in MOCK_RECORDINGS if r["id"] == recordingId), None)
        if rec:
            rec["filename"] = new_name
            return jsonify({}), 200
        return jsonify({"error": "Recording not found"}), 404

    @app.delete("/api/recordings/<recordingId>")
    def recordings_delete(recordingId: str):
        return jsonify({}), 200

    @app.get("/api/recordings/<recordingId>/download")
    def recordings_download(recordingId: str):
        # Return a 404 for mock download since we don't have actual files
        return jsonify({"error": "Mock download not available"}), 404

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        try:
            return send_from_directory(FRONTEND_DIR, path)
        except Exception:
            return send_from_directory(FRONTEND_DIR, "index.html")

    app.run(host="0.0.0.0", port=80, debug=False)
