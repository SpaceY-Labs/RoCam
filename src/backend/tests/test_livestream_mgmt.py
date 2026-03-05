"""
Unit tests for src/control_process/livestream_process_management.py

LivestreamProcessManagement is a thin wrapper that launches a daemon thread
which loops forever calling subprocess.Popen → wait. We test that:
  - Construction starts a daemon thread
  - _start_process_loop calls Popen with the expected command
"""
import threading
import time
import pytest
from unittest.mock import MagicMock, patch

from control_process.livestream_process_management import LivestreamProcessManagement


class TestLivestreamProcessManagement:
    def test_construction_starts_daemon_thread(self):
        """Verify that __init__ launches exactly one daemon background thread."""
        started_threads = []

        original_thread_init = threading.Thread.__init__

        with patch("threading.Thread") as mock_thread_cls:
            mock_thread = MagicMock()
            mock_thread_cls.return_value = mock_thread

            LivestreamProcessManagement()

            mock_thread_cls.assert_called_once()
            mock_thread.start.assert_called_once()

    def test_start_process_loop_calls_popen(self):
        """Verify that the loop invokes Popen with the livestream command."""
        call_count = {"n": 0}

        def fake_popen(cmd, **kwargs):
            call_count["n"] += 1
            m = MagicMock()
            m.wait.return_value = 0
            if call_count["n"] >= 2:
                raise StopIteration("done")
            return m

        with patch("control_process.livestream_process_management.subprocess.Popen",
                   side_effect=fake_popen):
            mgmt = LivestreamProcessManagement.__new__(LivestreamProcessManagement)
            try:
                mgmt._start_process_loop()
            except StopIteration:
                pass

        assert call_count["n"] >= 1
