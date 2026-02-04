import json
import logging
import queue
import threading
import time
from dataclasses import asdict

from flask import Response, stream_with_context

from control_process.state_management import StateManagement
from control_process.state_management_recording_management_only import (
    StateManagementRecordingManagementOnly,
)


logger = logging.getLogger(__name__)


def _format_sse(data: str, event=None) -> str:
    """Format a string as SSE message. If event is set, prepend event line."""
    msg = f"data: {data}\n\n"
    if event is not None:
        msg = f"event: {event}\n{msg}"
    return msg


class _MessageAnnouncer:
    """Broadcasts messages to SSE listeners. Drops messages for slow clients (backpressure)."""

    def __init__(self):
        self._listeners = []

    def listen(self):
        q = queue.Queue(maxsize=1)
        self._listeners.append(q)
        return q

    def remove(self, q):
        if q in self._listeners:
            self._listeners.remove(q)

    def announce(self, msg: str):
        for i in reversed(range(len(self._listeners))):
            try:
                self._listeners[i].put_nowait(msg)
            except queue.Full:
                pass  # drop message for this client, keep connection


def register_status_sse(
    app,
    state_management: StateManagement | StateManagementRecordingManagementOnly,
) -> None:
    """Register GET /api/generate_204 and GET /api/status (SSE) and start 30Hz broadcast thread."""
    announcer = _MessageAnnouncer()

    def _status_broadcast_loop():
        while True:
            try:
                status_obj = state_management.status()
                d = asdict(status_obj)
                msg = _format_sse(json.dumps(d))
                announcer.announce(msg)
            except Exception as e:
                logger.exception("Status broadcast error: %s", e)
            time.sleep(1.0 / 30)

    status_thread = threading.Thread(target=_status_broadcast_loop, daemon=True)
    status_thread.start()

    @app.get("/api/status")
    def status_stream():
        def stream():
            messages = announcer.listen()
            try:
                while True:
                    yield messages.get()
            finally:
                announcer.remove(messages)

        return Response(
            stream_with_context(stream()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "X-Accel-Buffering": "no",
            },
        )
