"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for SSE formatting, message announcer, and status endpoint registration.
"""
import queue
import pytest
from unittest.mock import MagicMock, patch
from flask import Flask

from control_process.api.sse import _format_sse, _MessageAnnouncer


# ---------------------------------------------------------------------------
# _format_sse
# ---------------------------------------------------------------------------

class TestFormatSse:
    def test_data_only(self):
        result = _format_sse("hello")
        assert result == "data: hello\n\n"

    def test_data_with_event(self):
        result = _format_sse("payload", event="update")
        assert result == "event: update\ndata: payload\n\n"

    def test_empty_data(self):
        result = _format_sse("")
        assert result == "data: \n\n"

    def test_no_event_prefix(self):
        result = _format_sse("x", event=None)
        assert "event:" not in result

    def test_json_payload_preserved(self):
        json_str = '{"key": "value", "n": 42}'
        result = _format_sse(json_str)
        assert json_str in result


# ---------------------------------------------------------------------------
# _MessageAnnouncer
# ---------------------------------------------------------------------------

class TestMessageAnnouncer:
    def test_listen_returns_queue(self):
        ann = _MessageAnnouncer()
        q = ann.listen()
        assert isinstance(q, queue.Queue)

    def test_listen_registers_queue(self):
        ann = _MessageAnnouncer()
        q = ann.listen()
        assert q in ann._listeners

    def test_remove_deregisters_queue(self):
        ann = _MessageAnnouncer()
        q = ann.listen()
        ann.remove(q)
        assert q not in ann._listeners

    def test_remove_unknown_queue_is_safe(self):
        ann = _MessageAnnouncer()
        q = queue.Queue()
        ann.remove(q)  # should not raise

    def test_announce_delivers_to_listener(self):
        ann = _MessageAnnouncer()
        q = ann.listen()
        ann.announce("message1")
        assert q.get_nowait() == "message1"

    def test_announce_delivers_to_multiple_listeners(self):
        ann = _MessageAnnouncer()
        q1 = ann.listen()
        q2 = ann.listen()
        ann.announce("broadcast")
        assert q1.get_nowait() == "broadcast"
        assert q2.get_nowait() == "broadcast"

    def test_announce_drops_when_queue_full(self):
        """When a listener queue is full (maxsize=1), the new message is silently dropped."""
        ann = _MessageAnnouncer()
        q = ann.listen()
        q.put_nowait("existing")  # fill the single-slot queue

        ann.announce("dropped")  # this should not raise

        # The queue still contains the original message
        assert q.get_nowait() == "existing"

    def test_announce_no_listeners_is_safe(self):
        ann = _MessageAnnouncer()
        ann.announce("nobody_listening")  # should not raise

    def test_multiple_announces_only_latest_in_queue(self):
        """Queue maxsize=1; first message fills it, second is dropped."""
        ann = _MessageAnnouncer()
        q = ann.listen()
        ann.announce("first")
        ann.announce("second")  # dropped because queue is full
        assert q.get_nowait() == "first"
        assert q.empty()


# ---------------------------------------------------------------------------
# register_status_sse
# ---------------------------------------------------------------------------

class TestRegisterStatusSse:
    def _make_app_with_sse(self, state_management=None):
        from control_process.api.sse import register_status_sse

        if state_management is None:
            state_management = MagicMock()

        app = Flask(__name__)
        with patch("control_process.api.sse.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            register_status_sse(app, state_management)
        app.testing = True
        return app.test_client(), state_management

    def test_status_endpoint_returns_event_stream_content_type(self):
        """GET /api/status should respond with text/event-stream."""
        mock_q = MagicMock()
        mock_q.get.return_value = "data: {}\n\n"

        with patch("control_process.api.sse._MessageAnnouncer.listen", return_value=mock_q):
            c, _ = self._make_app_with_sse()
            resp = c.get("/api/status")
        assert "text/event-stream" in resp.content_type

    def test_status_endpoint_cache_control_headers(self):
        mock_q = MagicMock()
        mock_q.get.return_value = "data: {}\n\n"

        with patch("control_process.api.sse._MessageAnnouncer.listen", return_value=mock_q):
            c, _ = self._make_app_with_sse()
            resp = c.get("/api/status")
        assert resp.headers.get("Cache-Control") == "no-cache"

    def test_broadcast_thread_is_daemon(self):
        """The status broadcast thread must be a daemon thread."""
        from control_process.api.sse import register_status_sse

        app = Flask(__name__)
        sm = MagicMock()
        with patch("control_process.api.sse.threading.Thread") as mock_thread:
            register_status_sse(app, sm)
            _, kwargs = mock_thread.call_args
        assert kwargs.get("daemon") is True

    def test_broadcast_thread_is_started(self):
        """register_status_sse starts the broadcast thread."""
        from control_process.api.sse import register_status_sse

        app = Flask(__name__)
        sm = MagicMock()
        with patch("control_process.api.sse.threading.Thread") as mock_thread:
            thread_instance = MagicMock()
            mock_thread.return_value = thread_instance
            register_status_sse(app, sm)
        thread_instance.start.assert_called_once()
