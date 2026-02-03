import logging
from jtop import jtop

logger = logging.getLogger(__name__)

class SystemStatusMonitor:
    def __init__(self):
        self._jetson = jtop()
        self._jetson.start()

    def get_cpu_utilization(self) -> float:
        """Returns CPU utilization as a percentage in the range 0-100."""
        return 100 - self._jetson.cpu["total"]["idle"]

    def get_gpu_utilization(self) -> float:
        """Returns GPU utilization as a percentage in the range 0-100."""
        return self._jetson.gpu["gpu"]["status"]["load"]

    def get_core_temperature_celsius(self) -> float:
        return self._jetson.temperature["cpu"]["temp"]

    def get_system_power_w(self) -> float:
        return self._jetson.power["tot"]["power"] / 1000.0

    def get_memory_used_bytes(self) -> int:
        return self._jetson.memory["RAM"]["used"]

    def get_memory_total_bytes(self) -> int:
        return self._jetson.memory["RAM"]["tot"]

    def get_device_ip_addresses(self) -> list[str]:
        return list(self._jetson.local_interfaces["interfaces"].values())
