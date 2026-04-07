"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for SystemStatusMonitor construction, callback, and getter methods.
"""
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_jetson_mock(
    gpu_load=55.0,
    cpu_temp=42.0,
    power_mw=5000,
    ram_used=2048,
    ram_total=8192,
    interfaces=None,
):
    """Build a minimal jtop mock object with the attribute structure expected by the callback."""
    jetson = MagicMock()
    jetson.gpu = {"gpu": {"status": {"load": gpu_load}}}
    jetson.temperature = {"cpu": {"temp": cpu_temp}}
    jetson.power = {"tot": {"power": power_mw}}
    jetson.memory = {"RAM": {"used": ram_used, "tot": ram_total}}
    jetson.local_interfaces = {"interfaces": interfaces or {"eth0": "10.0.0.1"}}
    return jetson


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSystemStatusMonitor:
    def _make_monitor(self, jetson_mock=None, cpu_percent=30.0):
        """Create a SystemStatusMonitor with all hardware deps mocked."""
        from common.system_status import SystemStatusMonitor

        if jetson_mock is None:
            jetson_mock = _make_jetson_mock()

        fake_jtop_cls = MagicMock(return_value=jetson_mock)
        with patch("common.system_status.jtop", fake_jtop_cls), \
             patch("common.system_status.psutil.cpu_percent", return_value=cpu_percent):
            monitor = SystemStatusMonitor()
        return monitor

    # -- construction --------------------------------------------------------

    def test_construction_does_not_raise(self):
        self._make_monitor()

    def test_initial_cpu_from_psutil(self):
        monitor = self._make_monitor(cpu_percent=72.5)
        assert monitor.get_cpu_utilization() == 72.5

    def test_initial_gpu_from_jetson(self):
        j = _make_jetson_mock(gpu_load=88.0)
        monitor = self._make_monitor(jetson_mock=j)
        assert monitor.get_gpu_utilization() == 88.0

    def test_initial_temperature(self):
        j = _make_jetson_mock(cpu_temp=65.5)
        monitor = self._make_monitor(jetson_mock=j)
        assert monitor.get_core_temperature_celsius() == 65.5

    def test_initial_power(self):
        j = _make_jetson_mock(power_mw=3000)
        monitor = self._make_monitor(jetson_mock=j)
        assert monitor.get_system_power_w() == 3.0

    def test_initial_memory(self):
        j = _make_jetson_mock(ram_used=4096, ram_total=16384)
        monitor = self._make_monitor(jetson_mock=j)
        assert monitor.get_memory_used_bytes() == 4096
        assert monitor.get_memory_total_bytes() == 16384

    def test_initial_ip_addresses(self):
        j = _make_jetson_mock(interfaces={"eth0": "192.168.1.5", "lo": "127.0.0.1"})
        monitor = self._make_monitor(jetson_mock=j)
        ips = monitor.get_device_ip_addresses()
        assert "192.168.1.5" in ips
        assert "127.0.0.1" in ips

    # -- _callback() ---------------------------------------------------------

    def test_callback_updates_gpu(self):
        from common.system_status import SystemStatusMonitor

        jetson = _make_jetson_mock(gpu_load=10.0)
        fake_jtop_cls = MagicMock(return_value=jetson)

        with patch("common.system_status.jtop", fake_jtop_cls), \
             patch("common.system_status.psutil.cpu_percent", return_value=5.0):
            monitor = SystemStatusMonitor()

        # Now simulate a callback with updated values
        jetson2 = _make_jetson_mock(gpu_load=99.0)
        with patch("common.system_status.psutil.cpu_percent", return_value=50.0):
            monitor._callback(jetson2)

        assert monitor.get_gpu_utilization() == 99.0
        assert monitor.get_cpu_utilization() == 50.0

    def test_callback_updates_ip_addresses(self):
        from common.system_status import SystemStatusMonitor

        jetson = _make_jetson_mock(interfaces={"eth0": "1.2.3.4"})
        fake_jtop_cls = MagicMock(return_value=jetson)

        with patch("common.system_status.jtop", fake_jtop_cls), \
             patch("common.system_status.psutil.cpu_percent", return_value=0.0):
            monitor = SystemStatusMonitor()

        jetson2 = _make_jetson_mock(interfaces={"eth0": "9.8.7.6"})
        with patch("common.system_status.psutil.cpu_percent", return_value=0.0):
            monitor._callback(jetson2)

        assert "9.8.7.6" in monitor.get_device_ip_addresses()
