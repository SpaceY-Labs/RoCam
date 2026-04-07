"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for Watchdog timer init, refresh, and clear lifecycle.
"""
import threading
import pytest
from unittest.mock import MagicMock, patch, call

from common.watchdog import Watchdog


class TestWatchdogInit:
    def test_stores_timeout(self):
        wd = Watchdog(timeout_s=2.5, callback=lambda: None)
        assert wd._timeout_s == 2.5

    def test_stores_callback(self):
        cb = lambda: None
        wd = Watchdog(timeout_s=1.0, callback=cb)
        assert wd._callback is cb

    def test_timer_initially_none(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)
        assert wd._timer is None

    def test_has_lock(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)
        assert isinstance(wd._lock, type(threading.Lock()))


class TestWatchdogRefresh:
    def test_refresh_creates_timer(self):
        cb = MagicMock()
        wd = Watchdog(timeout_s=5.0, callback=cb)

        mock_timer = MagicMock()
        with patch("common.watchdog.threading.Timer", return_value=mock_timer) as mock_timer_cls:
            wd.refresh()
            mock_timer_cls.assert_called_once_with(5.0, cb)
            mock_timer.start.assert_called_once()
            assert mock_timer.daemon is True

    def test_refresh_cancels_existing_timer(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)

        old_timer = MagicMock()
        wd._timer = old_timer

        new_timer = MagicMock()
        with patch("common.watchdog.threading.Timer", return_value=new_timer):
            wd.refresh()
            old_timer.cancel.assert_called_once()

    def test_refresh_twice_replaces_timer(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)

        timer1 = MagicMock()
        timer2 = MagicMock()

        with patch("common.watchdog.threading.Timer", side_effect=[timer1, timer2]):
            wd.refresh()
            assert wd._timer is timer1
            wd.refresh()
            timer1.cancel.assert_called_once()
            assert wd._timer is timer2


class TestWatchdogClear:
    def test_clear_cancels_timer(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)
        mock_timer = MagicMock()
        wd._timer = mock_timer

        wd.clear()

        mock_timer.cancel.assert_called_once()
        assert wd._timer is None

    def test_clear_when_no_timer_is_idempotent(self):
        wd = Watchdog(timeout_s=1.0, callback=lambda: None)
        # No timer set; should not raise
        wd.clear()
        assert wd._timer is None

    def test_clear_after_refresh(self):
        cb = MagicMock()
        wd = Watchdog(timeout_s=1.0, callback=cb)

        mock_timer = MagicMock()
        with patch("common.watchdog.threading.Timer", return_value=mock_timer):
            wd.refresh()
            wd.clear()

        mock_timer.cancel.assert_called_once()
        assert wd._timer is None
