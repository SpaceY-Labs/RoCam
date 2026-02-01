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
        self._core_temperature_celsius: Optional[float] = None
        self._system_power_w: Optional[float] = None
        self._prev_cpu_total: Optional[int] = None
        self._prev_cpu_idle: Optional[int] = None
        self._has_proc_stat = os.path.isfile("/proc/stat")
        self._has_nvidia_smi = shutil.which("nvidia-smi") is not None
        self._has_tegrastats = shutil.which("tegrastats") is not None
        self._has_thermal_zones = os.path.isdir("/sys/class/thermal")
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

    def get_core_temperature_celsius(self) -> Optional[float]:
        with self._lock:
            return self._core_temperature_celsius

    def get_system_power_w(self) -> Optional[float]:
        with self._lock:
            return self._system_power_w

    def _run(self):
        while not self._stop_event.is_set():
            tegrastats_metrics = None
            if self._has_tegrastats:
                tegrastats_metrics = _read_tegrastats_metrics()
            self._update_cpu_utilization()
            self._update_gpu_utilization(tegrastats_metrics)
            self._update_system_power_w(tegrastats_metrics)
            self._update_core_temperature_celsius()
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

    def _update_gpu_utilization(
        self, tegrastats_metrics: Optional[tuple[Optional[float], Optional[float]]] = None
    ):
        usage: Optional[float] = None

        if self._has_nvidia_smi:
            usage = _read_nvidia_smi()

        if usage is None and tegrastats_metrics is not None:
            usage = tegrastats_metrics[0]

        with self._lock:
            self._gpu_utilization = usage

    def _update_system_power_w(
        self, tegrastats_metrics: Optional[tuple[Optional[float], Optional[float]]] = None
    ):
        power_w: Optional[float] = None

        if self._has_nvidia_smi:
            power_w = _read_nvidia_smi_power_w()

        if power_w is None and tegrastats_metrics is not None:
            power_w = tegrastats_metrics[1]

        with self._lock:
            self._system_power_w = power_w

    def _update_core_temperature_celsius(self):
        if not self._has_thermal_zones:
            with self._lock:
                self._core_temperature_celsius = None
            return

        temperature = _read_core_temperature_celsius()
        with self._lock:
            self._core_temperature_celsius = temperature


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


def _read_core_temperature_celsius() -> Optional[float]:
    zones = _read_thermal_zones()
    if not zones:
        return None

    preferred = [
        temp for name, temp in zones if any(key in name for key in ("cpu", "core", "soc"))
    ]
    if preferred:
        return max(preferred)

    return max(temp for _, temp in zones)


def _read_thermal_zones() -> list[tuple[str, float]]:
    zones_path = "/sys/class/thermal"
    results: list[tuple[str, float]] = []
    try:
        entries = os.listdir(zones_path)
    except OSError:
        return results

    for entry in entries:
        if not entry.startswith("thermal_zone"):
            continue

        type_path = os.path.join(zones_path, entry, "type")
        temp_path = os.path.join(zones_path, entry, "temp")

        try:
            with open(type_path, "r") as type_handle:
                zone_type = type_handle.read().strip().lower()
        except OSError:
            zone_type = entry.lower()

        try:
            with open(temp_path, "r") as temp_handle:
                raw = temp_handle.read().strip()
                if not raw:
                    continue
                value = float(raw)
        except (OSError, ValueError):
            continue

        if value > 1000:
            value = value / 1000.0

        results.append((zone_type, value))

    return results


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


def _read_nvidia_smi_power_w() -> Optional[float]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=power.draw",
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


def _read_tegrastats_metrics() -> tuple[Optional[float], Optional[float]]:
    try:
        result = subprocess.run(
            ["tegrastats", "--interval", "1000", "--count", "1"],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None, None

    if result.returncode != 0:
        return None, None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    gpu_utilization: Optional[float] = None
    system_power_w: Optional[float] = None

    for line in reversed(lines):
        if gpu_utilization is None:
            match = re.search(r"GR3D_FREQ\s+(\d+)%", line)
            if match:
                try:
                    gpu_utilization = float(match.group(1))
                except ValueError:
                    gpu_utilization = None

        if system_power_w is None:
            system_power_w = _parse_tegrastats_power_w(line)

        if gpu_utilization is not None and system_power_w is not None:
            break

    return gpu_utilization, system_power_w


def _parse_tegrastats_power_w(line: str) -> Optional[float]:
    matches = re.findall(r"(POM_5V_IN|VDD_IN)\s+(\d+)(?:mW)?(?:/\d+)?", line)
    if not matches:
        return None

    values_mw = []
    for _, value in matches:
        try:
            values_mw.append(float(value))
        except ValueError:
            continue

    if not values_mw:
        return None

    return max(values_mw) / 1000.0
    return None
