"""
Author: Xiaotian Lou
Date: 2026-01-31
Purpose: Monitors Jetson system health metrics (CPU/GPU utilization, temperature,
    power draw, memory usage, and network interfaces) via jtop and psutil.
"""

import logging
import psutil
from jtop import jtop

logger = logging.getLogger(__name__)

class SystemStatusMonitor:
    def __init__(self):
        self._jetson = jtop()
        self._jetson.start()

        self._cpu_utilization = 0.0
        self._gpu_utilization = 0.0
        self._core_temperature_celsius = 0.0
        self._system_power_w = 0.0
        self._memory_used_bytes = 0.0
        self._memory_total_bytes = 0.0
        self._device_ip_addresses = []

        self._callback(self._jetson)

        self._jetson.attach(self._callback)
    
    def _callback(self, jetson: jtop):
        self._cpu_utilization = psutil.cpu_percent() # does not use jtop because jtop cpu utilization is not accurate
        self._gpu_utilization = jetson.gpu["gpu"]["status"]["load"]
        self._core_temperature_celsius = jetson.temperature["cpu"]["temp"]
        self._system_power_w = jetson.power["tot"]["power"] / 1000.0
        self._memory_used_bytes = jetson.memory["RAM"]["used"]
        self._memory_total_bytes = jetson.memory["RAM"]["tot"]
        self._device_ip_addresses = list(jetson.local_interfaces["interfaces"].values())

    def get_cpu_utilization(self) -> float:
        """Returns CPU utilization as a percentage in the range 0-100."""
        return self._cpu_utilization

    def get_gpu_utilization(self) -> float:
        """Returns GPU utilization as a percentage in the range 0-100."""
        return self._gpu_utilization

    def get_core_temperature_celsius(self) -> float:
        return self._core_temperature_celsius

    def get_system_power_w(self) -> float:
        return self._system_power_w

    def get_memory_used_bytes(self) -> int:
        return self._memory_used_bytes

    def get_memory_total_bytes(self) -> int:
        return self._memory_total_bytes

    def get_device_ip_addresses(self) -> list[str]:
        return self._device_ip_addresses
