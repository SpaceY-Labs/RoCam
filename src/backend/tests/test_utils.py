"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for ip4_addresses and Linux scheduler priority helpers.
"""
import pytest
from unittest.mock import patch, MagicMock


class TestIp4Addresses:
    def test_returns_empty_when_no_interfaces(self):
        with patch("common.utils.netifaces.interfaces", return_value=[]), \
             patch("common.utils.netifaces.ifaddresses", return_value={}):
            from common.utils import ip4_addresses
            result = ip4_addresses()
        assert result == []

    def test_returns_ipv4_address(self):
        import netifaces as _n

        def fake_ifaddresses(iface):
            return {_n.AF_INET: [{"addr": "192.168.1.10"}]}

        with patch("common.utils.netifaces.interfaces", return_value=["eth0"]), \
             patch("common.utils.netifaces.ifaddresses", side_effect=fake_ifaddresses):
            from common.utils import ip4_addresses
            result = ip4_addresses()
        assert "192.168.1.10" in result

    def test_skips_interfaces_without_af_inet(self):
        import netifaces as _n

        def fake_ifaddresses(iface):
            # No AF_INET key
            return {}

        with patch("common.utils.netifaces.interfaces", return_value=["lo"]), \
             patch("common.utils.netifaces.ifaddresses", side_effect=fake_ifaddresses):
            from common.utils import ip4_addresses
            result = ip4_addresses()
        assert result == []

    def test_multiple_interfaces(self):
        import netifaces as _n

        addresses = {
            "eth0": {_n.AF_INET: [{"addr": "10.0.0.1"}]},
            "wlan0": {_n.AF_INET: [{"addr": "192.168.0.100"}]},
        }

        with patch("common.utils.netifaces.interfaces", return_value=["eth0", "wlan0"]), \
             patch("common.utils.netifaces.ifaddresses", side_effect=lambda iface: addresses[iface]):
            from common.utils import ip4_addresses
            result = ip4_addresses()

        assert "10.0.0.1" in result
        assert "192.168.0.100" in result


class TestSchedulerValidation:
    """
    os.sched_setscheduler is Linux-only; conftest stubs it on macOS.
    We patch via create=True to handle both platforms safely.
    """

    def test_fifo_invalid_priority_low(self):
        from common.utils import set_scheduler_fifo
        with pytest.raises(ValueError, match="between 1 and 99"):
            with patch("common.utils.os.sched_setscheduler", create=True):
                set_scheduler_fifo(0)

    def test_fifo_invalid_priority_high(self):
        from common.utils import set_scheduler_fifo
        with pytest.raises(ValueError, match="between 1 and 99"):
            with patch("common.utils.os.sched_setscheduler", create=True):
                set_scheduler_fifo(100)

    def test_fifo_valid_priority(self):
        from common.utils import set_scheduler_fifo
        with patch("common.utils.os.sched_setscheduler", create=True) as mock_set:
            set_scheduler_fifo(50)
            mock_set.assert_called_once()

    def test_other_invalid_nice_too_low(self):
        from common.utils import set_scheduler_other
        with pytest.raises(ValueError, match="between -20 and 19"):
            with patch("common.utils.os.sched_setscheduler", create=True), \
                 patch("common.utils.os.nice", return_value=0):
                set_scheduler_other(-21)

    def test_other_invalid_nice_too_high(self):
        from common.utils import set_scheduler_other
        with pytest.raises(ValueError, match="between -20 and 19"):
            with patch("common.utils.os.sched_setscheduler", create=True), \
                 patch("common.utils.os.nice", return_value=0):
                set_scheduler_other(20)

    def test_other_valid_nice(self):
        from common.utils import set_scheduler_other
        with patch("common.utils.os.sched_setscheduler", create=True), \
             patch("common.utils.os.nice", return_value=0):
            set_scheduler_other(0)

    def test_batch_invalid_nice_too_low(self):
        from common.utils import set_scheduler_batch
        with pytest.raises(ValueError, match="between -20 and 19"):
            with patch("common.utils.os.sched_setscheduler", create=True), \
                 patch("common.utils.os.nice", return_value=0):
                set_scheduler_batch(-21)

    def test_batch_valid_nice(self):
        from common.utils import set_scheduler_batch
        with patch("common.utils.os.sched_setscheduler", create=True), \
             patch("common.utils.os.nice", return_value=0):
            set_scheduler_batch(19)
