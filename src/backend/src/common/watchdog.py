import threading
from typing import Callable

class Watchdog:
    def __init__(self, timeout_s: float, callback: Callable[[], None]):
        self._timeout_s = timeout_s
        self._callback = callback
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def refresh(self):
        """Reset the watchdog timer."""
        with self._lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self._timeout_s, self._callback)
            self._timer.daemon = True
            self._timer.start()

    def clear(self):
        """Disable the watchdog timer."""
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None
