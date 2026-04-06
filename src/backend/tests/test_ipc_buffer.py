"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for shared-memory IPC ring buffer sender and receiver.
"""
import struct
import pytest
from unittest.mock import MagicMock, patch, PropertyMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_shm_buf(size=16, message_size=4, head=0, tail=0):
    """Create a bytearray that mimics the shared memory layout.

    Layout: [head: 8B][tail: 8B][data: size*message_size B]
    """
    total = 16 + size * message_size
    buf = bytearray(total)
    struct.pack_into("Q", buf, 0, head)
    struct.pack_into("Q", buf, 8, tail)
    return buf


class FakeShm:
    """Minimal shared memory stub with a real buffer."""
    def __init__(self, size, message_size, head=0, tail=0):
        self.buf = _make_shm_buf(size, message_size, head, tail)
        self._name = "fake"

    def close(self):
        pass

    def unlink(self):
        pass


# ---------------------------------------------------------------------------
# cleanup_shared_memory
# ---------------------------------------------------------------------------

class TestCleanupSharedMemory:
    def test_cleanup_success(self):
        from common.ipc_buffer import cleanup_shared_memory

        fake = FakeShm(4, 8)
        with patch("common.ipc_buffer.shared_memory.SharedMemory", return_value=fake):
            cleanup_shared_memory("test_shm")
            # No exception means success

    def test_cleanup_swallows_exception(self):
        from common.ipc_buffer import cleanup_shared_memory

        with patch(
            "common.ipc_buffer.shared_memory.SharedMemory",
            side_effect=FileNotFoundError("not found"),
        ):
            # Should NOT raise
            cleanup_shared_memory("nonexistent")


# ---------------------------------------------------------------------------
# IPCBufferSender
# ---------------------------------------------------------------------------

class TestIPCBufferSender:
    def _make_sender(self, size=4, message_size=8):
        """Construct an IPCBufferSender with a fake shared-memory buffer."""
        from common.ipc_buffer import IPCBufferSender

        fake_shm = FakeShm(size, message_size)

        with patch("common.ipc_buffer.shared_memory.SharedMemory", return_value=fake_shm), \
             patch("common.ipc_buffer.unregister"):
            sender = IPCBufferSender("test", size=size, message_size=message_size)
        sender.shm = fake_shm
        return sender

    def test_send_wrong_length_raises(self):
        sender = self._make_sender(size=4, message_size=8)
        with pytest.raises(ValueError, match="exactly 8 bytes"):
            sender.send(b"\x00" * 5)

    def test_send_advances_head(self):
        sender = self._make_sender(size=4, message_size=8)
        payload = b"ABCDEFGH"
        sender.send(payload)
        head = struct.unpack("Q", sender.shm.buf[0:8])[0]
        assert head == 1

    def test_send_returns_true_when_not_full(self):
        sender = self._make_sender(size=4, message_size=8)
        result = sender.send(b"\x01" * 8)
        assert result is True

    def test_send_returns_false_when_full(self):
        """Buffer is full when head - tail >= size - 1."""
        size = 4
        msg_size = 8
        sender = self._make_sender(size=size, message_size=msg_size)
        # Simulate a full buffer: head = size-1, tail = 0
        struct.pack_into("Q", sender.shm.buf, 0, size - 1)
        struct.pack_into("Q", sender.shm.buf, 8, 0)
        result = sender.send(b"\xff" * msg_size)
        assert result is False

    def test_send_writes_data_at_correct_offset(self):
        size = 4
        msg_size = 8
        sender = self._make_sender(size=size, message_size=msg_size)
        payload = b"12345678"
        sender.send(payload)
        # head was 0, so slot 0 is at offset 16
        written = bytes(sender.shm.buf[16:24])
        assert written == payload

    def test_get_stats_initial(self):
        sender = self._make_sender(size=4, message_size=8)
        stats = sender.get_stats()
        assert stats["head"] == 0
        assert stats["tail"] == 0
        assert stats["used_slots"] == 0

    def test_get_stats_after_send(self):
        sender = self._make_sender(size=4, message_size=8)
        sender.send(b"\x00" * 8)
        stats = sender.get_stats()
        assert stats["head"] == 1


# ---------------------------------------------------------------------------
# IPCBufferReceiver
# ---------------------------------------------------------------------------

class TestIPCBufferReceiver:
    def _make_receiver(self, size=4, message_size=8, head=0, tail=0):
        from common.ipc_buffer import IPCBufferReceiver

        fake_shm = FakeShm(size, message_size, head=head, tail=tail)

        with patch("common.ipc_buffer.shared_memory.SharedMemory", return_value=fake_shm), \
             patch("common.ipc_buffer.unregister"):
            receiver = IPCBufferReceiver("test", size=size, message_size=message_size, timeout=1.0)
        receiver.shm = fake_shm
        return receiver

    def test_try_receive_empty_returns_none(self):
        receiver = self._make_receiver(head=0, tail=0)
        result = receiver._try_receive()
        assert result is None

    def test_try_receive_returns_data(self):
        size = 4
        msg_size = 8
        receiver = self._make_receiver(size=size, message_size=msg_size, head=1, tail=0)
        # Write known data at slot 0 (offset 16)
        receiver.shm.buf[16:24] = b"TESTDATA"
        data = receiver._try_receive()
        assert data == b"TESTDATA"

    def test_try_receive_advances_tail(self):
        receiver = self._make_receiver(head=1, tail=0)
        receiver._try_receive()
        tail = struct.unpack("Q", receiver.shm.buf[8:16])[0]
        assert tail == 1

    def test_try_receive_overrun_skips_frames(self):
        """When receiver is too slow, tail should be advanced to head - (size-1)."""
        size = 4
        msg_size = 8
        # head = 10, tail = 0; head - tail = 10 > size-1 = 3 → overrun
        receiver = self._make_receiver(size=size, message_size=msg_size, head=10, tail=0)
        data = receiver._try_receive()
        # After overrun, tail is set to head - (size-1) = 10 - 3 = 7, then incremented to 8
        new_tail = struct.unpack("Q", receiver.shm.buf[8:16])[0]
        assert new_tail == 8
        assert data is not None

    def test_try_receive_head_less_than_tail_resets(self):
        """If head < tail (sender reset), receiver resets tail to head and returns None."""
        receiver = self._make_receiver(head=2, tail=5)
        result = receiver._try_receive()
        tail = struct.unpack("Q", receiver.shm.buf[8:16])[0]
        assert result is None
        assert tail == 2

    def test_receive_non_blocking_empty(self):
        receiver = self._make_receiver(head=0, tail=0)
        result = receiver.receive(block=False)
        assert result is None

    def test_receive_blocking_timeout(self):
        receiver = self._make_receiver(head=0, tail=0)
        with patch("common.ipc_buffer.time.sleep"):
            result = receiver.receive(block=True, timeout=0.001)
        assert result is None

    def test_get_stats_initial(self):
        receiver = self._make_receiver(head=0, tail=0)
        stats = receiver.get_stats()
        assert stats["head"] == 0
        assert stats["tail"] == 0
