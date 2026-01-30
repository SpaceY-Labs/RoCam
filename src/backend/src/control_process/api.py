import logging
import os
from pathlib import Path
import subprocess
import time

from pathvalidate import sanitize_filename
from common.ipc import RecordingInfo
from common.utils import set_scheduler_other, ip4_addresses
from control_process.state_management import StateManagement
from control_process.state_management_recording_management_only import (
    StateManagementRecordingManagementOnly,
)
from flask import (
    Flask,
    Response,
    jsonify,
    request,
    send_from_directory,
    stream_with_context,
)
from flask_cors import CORS

from transcode_process.main import TranscodeMode


logger = logging.getLogger(__name__)
logging.getLogger("werkzeug").setLevel(logging.WARN)


def _json_body():
    return request.get_json(silent=True) or {}


def run_api_gateway(
    state_management: StateManagement | StateManagementRecordingManagementOnly,
):
    set_scheduler_other()
    logger.info(f"ipv4 addresses: {ip4_addresses()}")

    app = Flask(__name__)
    CORS(app)

    FRONTEND_DIR = Path("../react-app/dist").resolve()
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

    def _create_named_pipe(recording_id: str):
        """Create a unique named pipe and return its path."""
        pipe_name = f"rocam-transcode-{recording_id}-{time.time_ns()}.pipe"
        pipe_path = os.path.join("/tmp", pipe_name)

        os.mkfifo(pipe_path)
        return pipe_path

    def _cleanup_pipe(pipe_path: str):
        """Remove the named pipe."""
        try:
            if os.path.exists(pipe_path):
                os.unlink(pipe_path)
        except OSError:
            pass

    def _stream_from_transcode_process(mode: TranscodeMode, recording: RecordingInfo):
        pipe_path = _create_named_pipe(recording.id)
        logger.info(f"Created pipe: {pipe_path}")

        process = None
        pipe_fd = None

        try:
            # Start the pipeline subprocess via main.py
            process = subprocess.Popen(
                [
                    "python3",
                    "src/main.py",
                    mode,
                    recording.video_path,
                    recording.log_path,
                    pipe_path,
                ],
            )

            # Open pipe for reading (this blocks until writer opens it)
            pipe_fd = os.open(pipe_path, os.O_RDONLY)
            logger.info("Pipe opened, streaming...")

            bytes_read = 0
            while True:
                # Read chunks from the pipe
                chunk = os.read(pipe_fd, 65536)  # 64KB chunks
                if not chunk:
                    # EOF - pipeline finished
                    logger.info(f"EOF from pipe. Total bytes read: {bytes_read}")
                    break
                bytes_read += len(chunk)
                yield chunk

        except GeneratorExit:
            logger.info("Browser disconnected!")
            raise
        except Exception as e:
            logger.error(f"Unknown transcoding error: {e}")
            raise
        finally:
            # Clean up
            logger.info("Cleaning up transcode process...")

            # Close the pipe (this will cause the pipeline to get BrokenPipeError)
            if pipe_fd is not None:
                try:
                    os.close(pipe_fd)
                except:
                    pass

            # Wait for process to finish (with timeout)
            if process is not None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logger.warning("Transcode process didn't exit, killing...")
                    process.kill()
                    process.wait()

            # Remove the named pipe
            _cleanup_pipe(pipe_path)
            logger.info("Transcode cleanup complete.")

    @app.get("/api/recordings/<recordingId>/preview-stabilized")
    def preview_stabilized(recordingId: str):
        recording = state_management.database.get_recording_by_id(recordingId)
        if not recording:
            return jsonify({"error": "Recording not found"}), 404

        headers = {
            "Content-Type": "video/webm",
            # inline disposition allows browser to play it
            "Content-Disposition": 'inline; filename="preview.webm"',
        }
        return Response(
            stream_with_context(
                _stream_from_transcode_process("preview-stabilized", recording)
            ),
            headers=headers,
        )

    @app.get("/api/recordings/<recordingId>/download-stabilized")
    def download_stabilized(recordingId: str):
        recording = state_management.database.get_recording_by_id(recordingId)
        if not recording:
            return jsonify({"error": "Recording not found"}), 404

        sanitized_name = sanitize_filename(recording.name, platform="universal")
        headers = {
            "Content-Type": "video/webm",
            "Content-Disposition": f'attachment; filename="{sanitized_name}.webm"',
        }
        return Response(
            stream_with_context(
                _stream_from_transcode_process("download-stabilized", recording)
            ),
            headers=headers,
        )

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        try:
            return send_from_directory(FRONTEND_DIR, path)
        except Exception:
            return send_from_directory(FRONTEND_DIR, "index.html")

    app.run(host="0.0.0.0", port=80, debug=False)
