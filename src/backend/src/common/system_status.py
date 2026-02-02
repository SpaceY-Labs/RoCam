import logging
import os
import re
import shutil
import subprocess
import threading
from typing import Optional, Tuple


logger = logging.getLogger(__name__)


class SystemStatusMonitor:
    def __init__(self, update_interval_s: float = 3.0):
        self._interval = update_interval_s
        self._lock = threading.Lock()
        self._cpu_utilization: Optional[float] = None
        self._gpu_utilization: Optional[float] = None
        self._core_temperature_celsius: Optional[float] = None
        self._system_power_w: Optional[float] = None
        self._memory_usage_bytes: Optional[Tuple[int, int]] = None
        self._prev_cpu_total: Optional[int] = None
        self._prev_cpu_idle: Optional[int] = None
        self._has_proc_stat = os.path.isfile("/proc/stat")
        self._has_nvidia_smi = shutil.which("nvidia-smi") is not None
        self._has_tegrastats = shutil.which("tegrastats") is not None
        self._has_thermal_zones = os.path.isdir("/sys/class/thermal")
        self._has_meminfo = os.path.isfile("/proc/meminfo")
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

    def get_memory_usage_bytes(self) -> Optional[Tuple[int, int]]:
        with self._lock:
            return self._memory_usage_bytes

    def _run(self):
        while not self._stop_event.is_set():
            tegrastats_metrics = None
            if self._has_tegrastats:
                try:
                    tegrastats_metrics = _read_tegrastats_metrics()
                except Exception as e:
                    logger.warning(f"Failed to read tegrastats: {e}")

            try:
                self._update_cpu_utilization()
            except Exception as e:
                logger.warning(f"Failed to update CPU utilization: {e}")

            try:
                self._update_gpu_utilization(tegrastats_metrics)
            except Exception as e:
                logger.warning(f"Failed to update GPU utilization: {e}")

            try:
                self._update_system_power_w(tegrastats_metrics)
            except Exception as e:
                logger.warning(f"Failed to update system power: {e}")

            try:
                self._update_core_temperature_celsius()
            except Exception as e:
                logger.warning(f"Failed to update temperature: {e}")

            try:
                self._update_memory_usage_bytes()
            except Exception as e:
                logger.warning(f"Failed to update memory usage: {e}")

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

        if usage is None:
            usage = _read_gpu_utilization_sysfs()

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

    def _update_memory_usage_bytes(self):
        if not self._has_meminfo:
            with self._lock:
                self._memory_usage_bytes = None
            return

        usage = _read_memory_usage_bytes()
        with self._lock:
            self._memory_usage_bytes = usage


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


def _read_memory_usage_bytes() -> Optional[Tuple[int, int]]:
    meminfo: dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r") as handle:
            for line in handle:
                parts = line.split()
                if len(parts) < 2:
                    continue
                key = parts[0].rstrip(":")
                try:
                    value_kb = int(parts[1])
                except ValueError:
                    continue
                meminfo[key] = value_kb
    except OSError:
        return None

    total_kb = meminfo.get("MemTotal")
    if total_kb is None:
        return None

    available_kb = meminfo.get("MemAvailable")
    if available_kb is None:
        free_kb = meminfo.get("MemFree", 0)
        buffers_kb = meminfo.get("Buffers", 0)
        cached_kb = meminfo.get("Cached", 0)
        available_kb = free_kb + buffers_kb + cached_kb

    used_kb = max(0, total_kb - available_kb)
    return used_kb * 1024, total_kb * 1024


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
            with open(temp_path, "rb") as temp_handle:
                raw_bytes = temp_handle.read()
        except (OSError, TypeError):
            continue

        if not raw_bytes:
            continue

        try:
            raw = raw_bytes.decode(errors="ignore").strip()
            if not raw:
                continue
            value = float(raw)
        except (UnicodeDecodeError, ValueError, TypeError):
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
    output = _run_tegrastats_once()
    if not output:
        return None, None

    lines = [line.strip() for line in output.splitlines() if line.strip()]
    gpu_utilization: Optional[float] = None
    system_power_w: Optional[float] = None

    for line in reversed(lines):
        if "unknown command" in line.lower():
            continue

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


def _run_tegrastats_once() -> str:
    try:
        result = subprocess.run(
            ["tegrastats", "--interval", "1000"],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""

    if isinstance(stdout, bytes):
        stdout = stdout.decode(errors="ignore")
    if isinstance(stderr, bytes):
        stderr = stderr.decode(errors="ignore")

    output = stdout
    if stderr:
        output = f"{output}\n{stderr}" if output else stderr

    return output.strip()


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


def _read_gpu_utilization_sysfs() -> Optional[float]:
    candidates = _get_gpu_load_candidates()
    for path, scale in candidates:
        value = _read_sysfs_float(path)
        if value is None:
            continue

        percent = _convert_gpu_load_to_percent(value, scale)
        if percent is None:
            continue

        return percent

    return None


def _get_gpu_load_candidates() -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []

    fixed_paths = [
        "/sys/devices/gpu.0/load",
        "/sys/devices/17000000.gp10b/load",
        "/sys/devices/17000000.gv11b/load",
        "/sys/devices/17000000.ga10b/load",
    ]

    for path in fixed_paths:
        if os.path.isfile(path):
            candidates.append((path, "load-255"))

    devfreq_base = "/sys/class/devfreq"
    if os.path.isdir(devfreq_base):
        try:
            entries = os.listdir(devfreq_base)
        except OSError:
            entries = []

        for entry in entries:
            name = entry.lower()
            if not any(key in name for key in ("gpu", "gp10b", "gv11b", "ga10b")):
                continue

            load_path = os.path.join(devfreq_base, entry, "load")
            if os.path.isfile(load_path):
                candidates.append((load_path, "load-1000"))

    return candidates


def _read_sysfs_float(path: str) -> Optional[float]:
    try:
        with open(path, "rb") as handle:
            raw_bytes = handle.read()
    except OSError:
        return None

    if not raw_bytes:
        return None

    raw = raw_bytes.decode(errors="ignore").strip()
    if not raw:
        return None

    match = re.search(r"(\d+(\.\d+)?)", raw)
    if not match:
        return None

    try:
        return float(match.group(1))
    except ValueError:
        return None


def _convert_gpu_load_to_percent(value: float, scale: str) -> Optional[float]:
    if value < 0:
        return None

    if scale == "load-1000":
        if value <= 1000:
            return value / 10.0
        return None

    if scale == "load-255":
        if value <= 255:
            return value / 255.0 * 100.0
        if value <= 100:
            return value
        return None

    if value <= 100:
        return value
    if value <= 255:
        return value / 255.0 * 100.0
    if value <= 1000:
        return value / 10.0

    return None
