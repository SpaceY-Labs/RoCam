import os
import re
import shutil
import subprocess
import threading
from typing import Optional, Tuple


class SystemStatusMonitor:
    def __init__(self, update_interval_s: float = 1.0):
        self._interval = update_interval_s
        self._lock = threading.Lock()
        self._cpu_utilization: Optional[float] = None
        self._gpu_utilization: Optional[float] = None
        self._prev_cpu_total: Optional[int] = None
        self._prev_cpu_idle: Optional[int] = None
        self._has_proc_stat = os.path.isfile("/proc/stat")
        self._has_nvidia_smi = shutil.which("nvidia-smi") is not None
        self._has_tegrastats = shutil.which("tegrastats") is not None
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def get_cpu_utilization(self) -> Optional[float]:
        with self._lock:
            return self._cpu_utilization

    def get_gpu_utilization(self) -> Optional[float]:
        with self._lock:
            return self._gpu_utilization

    def _run(self):
        while not self._stop_event.is_set():
            self._update_cpu_utilization()
            self._update_gpu_utilization()
            self._stop_event.wait(self._interval)

    def _update_cpu_utilization(self):
        if not self._has_proc_stat:
            with self._lock:
                self._cpu_utilization = None
            return

        cpu_times = _read_proc_stat()
        if cpu_times is None:
            return

        total, idle = cpu_times
        usage: Optional[float] = None

        if self._prev_cpu_total is not None and self._prev_cpu_idle is not None:
            delta_total = total - self._prev_cpu_total
            delta_idle = idle - self._prev_cpu_idle
            if delta_total > 0:
                usage = (delta_total - delta_idle) / delta_total * 100.0

        self._prev_cpu_total = total
        self._prev_cpu_idle = idle

        with self._lock:
            self._cpu_utilization = usage

    def _update_gpu_utilization(self):
        usage: Optional[float] = None

        if self._has_nvidia_smi:
            usage = _read_nvidia_smi()

        if usage is None and self._has_tegrastats:
            usage = _read_tegrastats()

        with self._lock:
            self._gpu_utilization = usage


def _read_proc_stat() -> Optional[Tuple[int, int]]:
    try:
        with open("/proc/stat", "r") as handle:
            line = handle.readline()
    except OSError:
        return None

    parts = line.split()
    if not parts or parts[0] != "cpu":
        return None

    try:
        values = [int(value) for value in parts[1:]]
    except ValueError:
        return None

    if len(values) < 4:
        return None

    idle = values[3] + (values[4] if len(values) > 4 else 0)
    total = sum(values)
    return total, idle


def _read_nvidia_smi() -> Optional[float]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=1.5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None

    try:
        return float(lines[0])
    except ValueError:
        return None


def _read_tegrastats() -> Optional[float]:
    try:
        result = subprocess.run(
            ["tegrastats", "--interval", "1000", "--count", "1"],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        match = re.search(r"GR3D_FREQ\s+(\d+)%", line)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                return None

    return None
