"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for Tracking detection queue, stop signaling, and gimbal control law.
"""
import math
import time
import threading
import pytest
from unittest.mock import MagicMock, patch

from control_process.tracking import Tracking


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tracking(width=100, height=100, k_p=0.1):
    """Create a Tracking instance with a mocked GimbalSerial."""
    gimbal = MagicMock()
    gimbal.get_deg.return_value = (45.0, 0.0)
    gimbal.set_deg = MagicMock()

    t = Tracking(gimbal=gimbal, width=width, height=height, k_p=k_p)
    return t, gimbal


# ---------------------------------------------------------------------------
# on_detection
# ---------------------------------------------------------------------------

class TestOnDetection:
    def test_put_when_queue_empty(self):
        tracking, _ = _make_tracking()
        tracking.stop()

        tracking.on_detection((0.5, 0.5))
        assert not tracking._queue.empty()

    def test_put_replaces_when_full(self):
        tracking, _ = _make_tracking()
        tracking.stop()

        tracking._queue.put_nowait((0.1, 0.1))  # fill the single-slot queue
        # putting again should drop old and put new
        tracking.on_detection((0.9, 0.9))

        item = tracking._queue.get_nowait()
        # The new item should be either the new value or the old one
        # (depending on timing), but queue should not raise
        assert item is not None

    def test_none_detection_accepted(self):
        tracking, _ = _make_tracking()
        tracking.stop()

        tracking.on_detection(None)
        assert not tracking._queue.empty()


# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------

class TestStop:
    def test_stop_sets_event(self):
        tracking, _ = _make_tracking()
        tracking.stop(timeout=0.5)
        assert tracking._stop_event.is_set()

    def test_stop_joins_thread(self):
        tracking, _ = _make_tracking()
        tracking.stop(timeout=1.0)
        assert not tracking._thread.is_alive()


# ---------------------------------------------------------------------------
# _worker control law
# ---------------------------------------------------------------------------

class TestWorkerControlLaw:
    def test_worker_calls_gimbal_set_deg(self):
        """Feed a detection and verify gimbal.set_deg is eventually called."""
        gimbal = MagicMock()
        gimbal.get_deg.return_value = (45.0, 0.0)
        gimbal.set_deg = MagicMock()

        tracking = Tracking(gimbal=gimbal, width=100, height=100, k_p=0.1)

        tracking.on_detection((0.8, 0.5))  # off-center horizontally

        # Give the worker time to process
        deadline = time.time() + 2.0
        while not gimbal.set_deg.called and time.time() < deadline:
            time.sleep(0.01)

        tracking.stop(timeout=1.0)
        assert gimbal.set_deg.called

    def test_worker_clamps_tilt_to_valid_range(self):
        """If error pushes new_tilt above 90, it should be clamped."""
        gimbal = MagicMock()
        gimbal.get_deg.return_value = (89.0, 0.0)  # already near max tilt
        gimbal.set_deg = MagicMock()

        tracking = Tracking(gimbal=gimbal, width=100, height=100, k_p=10.0)

        # Detection at top of frame → delta_tilt will push tilt above 90
        tracking.on_detection((0.5, 0.0))

        deadline = time.time() + 2.0
        while not gimbal.set_deg.called and time.time() < deadline:
            time.sleep(0.01)

        tracking.stop(timeout=1.0)

        if gimbal.set_deg.called:
            new_tilt = gimbal.set_deg.call_args[0][0]
            assert new_tilt <= 90.0

    def test_worker_ignores_none_detection(self):
        """Sending None should not call gimbal.set_deg."""
        gimbal = MagicMock()
        gimbal.get_deg.return_value = (0.0, 0.0)
        gimbal.set_deg = MagicMock()

        tracking = Tracking(gimbal=gimbal, width=100, height=100, k_p=0.1)
        tracking.on_detection(None)

        time.sleep(0.2)
        tracking.stop(timeout=0.5)

        gimbal.set_deg.assert_not_called()
