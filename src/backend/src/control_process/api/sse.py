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
        self._lock = threading.Lock()

    def listen(self):
        q = queue.Queue(maxsize=1)
        with self._lock:  
            self._listeners.append(q)
        return q

    def remove(self, q):
        with self._lock:  
            if q in self._listeners:  
                self._listeners.remove(q)

    def announce(self, msg: str):
        with self._lock:  
            listeners_snapshot = list(self._listeners)  
        for q in listeners_snapshot:  
            try:  
                q.put_nowait(msg)
            except queue.Full:
                pass  # drop message for this client, keep connection


def register_status_sse(
    app,
    state_management: StateManagement | StateManagementRecordingManagementOnly,
) -> None:
    """Register GET /api/status (SSE) and start 30Hz broadcast thread."""
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


class _LogStreamHandler(logging.Handler):
    """Logging handler that forwards log records to an SSE announcer."""

    def __init__(self, announcer: _MessageAnnouncer):
        super().__init__()
        self._announcer = announcer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            payload = json.dumps(
                {
                    "level": record.levelname,
                    "name": record.name,
                    "message": msg,
                    "created": record.created,
                }
            )
            self._announcer.announce(_format_sse(payload, event="log"))
        except Exception:
            self.handleError(record)


def register_logs_sse(app) -> None:
    """Register GET /api/logs (SSE) and attach a logging handler to stream log records."""
    log_announcer = _MessageAnnouncer()
    handler = _LogStreamHandler(log_announcer)
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    logging.getLogger().addHandler(handler)

    @app.get("/api/logs")
    def logs_stream():
        def stream():
            messages = log_announcer.listen()
            try:
                while True:
                    yield messages.get()
            finally:
                log_announcer.remove(messages)

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
