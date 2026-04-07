"""
Author: Jianqing Liu
Date: 2026-01-23
Purpose: Registers Flask routes for on-demand video transcoding, streaming
    stabilized preview and download variants of recordings through a named-pipe
    bridge to a child transcode process.
"""

import fcntl
import logging
import os
import select
import subprocess
import time

from pathvalidate import sanitize_filename
from common.ipc import RecordingInfo
from flask import Response, jsonify, stream_with_context

from transcode_process.main import TranscodeMode

from control_process.state_management import StateManagement
from control_process.state_management_recording_management_only import (
    StateManagementRecordingManagementOnly,
)


logger = logging.getLogger(__name__)


def _create_named_pipe(recording_id: str) -> str:
    """Create a unique named pipe and return its path."""
    pipe_name = f"rocam-transcode-{recording_id}-{time.time_ns()}.pipe"
    pipe_path = os.path.join("/tmp", pipe_name)
    os.mkfifo(pipe_path)
    return pipe_path


def _cleanup_pipe(pipe_path: str) -> None:
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

        pipe_fd = os.open(pipe_path, os.O_RDONLY | os.O_NONBLOCK)
        logger.info("Pipe opened (non-blocking), waiting for writer...")

        timeout_seconds = 30
        start_time = time.time()
        pipe_ready = False

        while not pipe_ready:
            return_code = process.poll()
            if return_code is not None:
                error_msg = (
                    f"Transcode process exited with code {return_code} before opening pipe"
                )
                logger.error(error_msg)
                raise RuntimeError(error_msg)

            try:
                ready, _, _ = select.select([pipe_fd], [], [], 0.1)
                if ready:
                    pipe_ready = True
                    logger.info("Pipe writer connected, streaming...")
                    break
            except OSError as e:
                error_msg = f"Error waiting for pipe: {e}"
                logger.error(error_msg)
                raise RuntimeError(error_msg) from e

            elapsed = time.time() - start_time
            if elapsed >= timeout_seconds:
                error_msg = (
                    f"Timeout waiting for transcode process to open pipe after "
                    f"{timeout_seconds}s"
                )
                logger.error(error_msg)
                raise TimeoutError(error_msg)

        flags = fcntl.fcntl(pipe_fd, fcntl.F_GETFL)
        fcntl.fcntl(pipe_fd, fcntl.F_SETFL, flags & ~os.O_NONBLOCK)

        bytes_read = 0
        while True:
            chunk = os.read(pipe_fd, 65536)
            if not chunk:
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
        logger.info("Cleaning up transcode process...")
        if pipe_fd is not None:
            try:
                os.close(pipe_fd)
            except OSError:
                pass
        if process is not None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Transcode process didn't exit, killing...")
                process.kill()
                process.wait()
        _cleanup_pipe(pipe_path)
        logger.info("Transcode cleanup complete.")


def register_transcode_routes(
    app,
    state_management: StateManagement | StateManagementRecordingManagementOnly,
) -> None:
    """Register GET /api/recordings/<id>/preview-stabilized and download-stabilized."""

    def _stream_wrapper(generator):
        state_management.on_download_start()
        try:
            yield from generator
        finally:
            state_management.on_download_end()

    @app.get("/api/recordings/<recordingId>/preview-stabilized")
    def preview_stabilized(recordingId: str):
        recording = state_management.database.get_recording_by_id(recordingId)
        if not recording:
            return jsonify({"error": "Recording not found"}), 404
        headers = {
            "Content-Type": "video/webm",
            "Content-Disposition": 'inline; filename="preview.webm"',
        }
        return Response(
            stream_with_context(
                _stream_wrapper(
                    _stream_from_transcode_process("preview-stabilized", recording)
                )
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
                _stream_wrapper(
                    _stream_from_transcode_process("download-stabilized", recording)
                )
            ),
            headers=headers,
        )
