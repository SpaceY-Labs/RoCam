"""
Author: Jianqing Liu
Date: 2026-02-04
Purpose: Implements Server-Sent Events (SSE) endpoints for real-time status
    broadcasting at 30 Hz (/api/status) and log streaming (/api/logs) to
    connected frontend clients.
"""

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

    def __init__(self, queue_size: int = 1):
        self._queue_size = queue_size
        self._listeners = []
        self._lock = threading.Lock()

    def listen(self):
        q = queue.Queue(maxsize=self._queue_size)
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


class _LogsSSEHandler(logging.Handler):
    """Push backend log records into SSE listeners."""

    def __init__(self, announcer: _MessageAnnouncer):
        super().__init__()
        self._announcer = announcer

    def emit(self, record: logging.LogRecord) -> None:
        try:
            payload = {
                "timestamp": int(record.created * 1000),
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            }
            self._announcer.announce(_format_sse(json.dumps(payload)))
        except Exception:
            self.handleError(record)


def register_logs_sse(app) -> None:
    """Register GET /api/logs (SSE) endpoint."""
    root_logger = logging.getLogger()

    # Reuse existing Logs SSE handler if already registered on the root logger
    announcer = None
    for existing_handler in root_logger.handlers:
        if isinstance(existing_handler, _LogsSSEHandler):
            announcer = existing_handler._announcer  # reuse existing announcer
            break

    # If no existing handler was found, create and register a new one
    if announcer is None:
        announcer = _MessageAnnouncer(queue_size=200)
        handler = _LogsSSEHandler(announcer)
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(message)s"))
        root_logger.addHandler(handler)
    
    @app.get("/api/logs")
    def logs_stream():
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
