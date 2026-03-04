"""
Unit tests for src/control_process/api/sse.py

Covers:
  - _format_sse() - pure string formatting for SSE events
  - _MessageAnnouncer.listen() - creates a Queue and registers it
  - _MessageAnnouncer.remove() - deregisters a Queue
  - _MessageAnnouncer.announce() - broadcasts to all listeners, drops on Full
"""
import queue
import pytest
from unittest.mock import MagicMock, patch

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
