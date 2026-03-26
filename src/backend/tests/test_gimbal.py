"""
Unit tests for src/control_process/gimbal.py

Covers:
  - GimbalSerial._crc8_smbus() - pure CRC-8 computation
  - GimbalSerial.create_request_data() - packet construction
  - GimbalSerial.set_arm_led() / set_status_led() - LED commands (mocked serial)
  - GimbalSerial.set_deg() - angle command (mocked serial)
  - GimbalSerial.get_deg() - angle query (mocked serial response)
  - GimbalSerial.gimbal_info() - info query (mocked serial response)
  - GimbalSerial.get_gps_data() - GPS data parsing
  - GimbalSerial.close() - closes port
"""
import math
import struct
import pytest
from unittest.mock import MagicMock, patch

from control_process.gimbal import GimbalSerial


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_gimbal(is_open=True):
    """Create a GimbalSerial instance with a mocked serial port."""
    fake_serial = MagicMock()
    fake_serial.is_open = is_open
    fake_serial.write = MagicMock(side_effect=lambda data: len(data))

    with patch("control_process.gimbal.serial.Serial", return_value=fake_serial):
        g = GimbalSerial(port="/dev/fake", baudrate=115200, timeout=0.5)
    g.ser = fake_serial
    return g


def _ack_response():
    """Single byte ACK (0x00)."""
    return b"\x00"


def _data_with_crc(data: bytes) -> bytes:
    """Append a valid CRC-8 byte to the given data bytes."""
    crc = GimbalSerial._crc8_smbus(data)
    return data + bytes([crc])


# ---------------------------------------------------------------------------
# _crc8_smbus
# ---------------------------------------------------------------------------

class TestCrc8Smbus:
    def test_empty_input(self):
        assert GimbalSerial._crc8_smbus(b"") == 0x00

    def test_single_zero_byte(self):
        assert GimbalSerial._crc8_smbus(b"\x00") == 0x00

    def test_single_ff_byte(self):
        result = GimbalSerial._crc8_smbus(b"\xFF")
        # Verify the result is a valid CRC byte
        assert 0 <= result <= 0xFF
        # Verify it is consistent (calling twice gives same result)
        assert result == GimbalSerial._crc8_smbus(b"\xFF")

    def test_known_sequence(self):
        # CRC of b"\x01\x02\x03" is deterministic
        result = GimbalSerial._crc8_smbus(b"\x01\x02\x03")
        assert isinstance(result, int)
        assert 0 <= result <= 0xFF

    def test_different_data_different_crc(self):
        assert GimbalSerial._crc8_smbus(b"\x01") != GimbalSerial._crc8_smbus(b"\x02")

    def test_idempotent(self):
        data = b"\xAB\xCD\xEF"
        assert GimbalSerial._crc8_smbus(data) == GimbalSerial._crc8_smbus(data)


# ---------------------------------------------------------------------------
# create_request_data
# ---------------------------------------------------------------------------

class TestCreateRequestData:
    def test_returns_bytes(self):
        g = _make_gimbal()
        packet = g.create_request_data(0x01, b"\x00")
        assert isinstance(packet, bytes)

    def test_packet_length(self):
        g = _make_gimbal()
        payload = b"\x01\x02\x03"
        packet = g.create_request_data(0xFF, payload)
        assert len(packet) == 2 + len(payload)

    def test_request_id_at_byte_1(self):
        g = _make_gimbal()
        packet = g.create_request_data(0x42, b"")
        assert packet[1] == 0x42

    def test_crc_at_byte_0(self):
        g = _make_gimbal()
        packet = g.create_request_data(0x01, b"\x00")
        # CRC should cover bytes[1:]
        expected_crc = GimbalSerial._crc8_smbus(bytes(packet[1:]))
        assert packet[0] == expected_crc

    def test_payload_embedded(self):
        g = _make_gimbal()
        payload = b"\xAB\xCD"
        packet = g.create_request_data(0x03, payload)
        assert packet[2:] == payload

    def test_non_bytes_payload_raises(self):
        g = _make_gimbal()
        with pytest.raises(TypeError):
            g.create_request_data(0x01, "not bytes")


# ---------------------------------------------------------------------------
# set_arm_led / set_status_led
# ---------------------------------------------------------------------------

class TestLedCommands:
    def test_set_arm_led_true_returns_true(self):
        g = _make_gimbal()
        g.ser.read = MagicMock(return_value=b"\x00")
        result = g.set_arm_led(True)
        assert result is True

    def test_set_arm_led_false_returns_true(self):
        g = _make_gimbal()
        g.ser.read = MagicMock(return_value=b"\x00")
        result = g.set_arm_led(False)
        assert result is True

    def test_set_status_led_true_returns_true(self):
        g = _make_gimbal()
        g.ser.read = MagicMock(return_value=b"\x00")
        result = g.set_status_led(True)
        assert result is True

    def test_led_closed_port_raises(self):
        g = _make_gimbal(is_open=False)
        with pytest.raises(RuntimeError, match="not open"):
            g.set_arm_led(True)

    def test_set_arm_led_write_failure_returns_false(self):
        g = _make_gimbal()
        # Simulate short write
        g.ser.write = MagicMock(return_value=0)
        result = g.set_arm_led(True)
        assert result is False


# ---------------------------------------------------------------------------
# set_deg
# ---------------------------------------------------------------------------

class TestSetDeg:
    def test_set_deg_returns_true_on_success(self):
        g = _make_gimbal()
        g.ser.read = MagicMock(return_value=b"\x00")
        result = g.set_deg(10.0, -5.0)
        assert result is True

    def test_set_deg_closed_port_raises(self):
        g = _make_gimbal(is_open=False)
        with pytest.raises(RuntimeError, match="not open"):
            g.set_deg(0.0, 0.0)

    def test_set_deg_returns_false_on_error(self):
        g = _make_gimbal()
        g.ser.write = MagicMock(return_value=0)
        result = g.set_deg(0.0, 0.0)
        assert result is False


# ---------------------------------------------------------------------------
# get_deg
# ---------------------------------------------------------------------------

class TestGetDeg:
    def test_get_deg_parses_response(self):
        g = _make_gimbal()
        # Build a valid 8-byte response (tilt=12.5, pan=-3.25) + CRC
        data = struct.pack("<ff", 12.5, -3.25)
        crc = GimbalSerial._crc8_smbus(data)
        g.ser.read = MagicMock(return_value=data + bytes([crc]))
        tilt, pan = g.get_deg()
        assert math.isclose(tilt, 12.5, rel_tol=1e-5)
        assert math.isclose(pan, -3.25, rel_tol=1e-5)

    def test_get_deg_closed_port_raises(self):
        g = _make_gimbal(is_open=False)
        with pytest.raises(RuntimeError, match="not open"):
            g.get_deg()


# ---------------------------------------------------------------------------
# gimbal_info
# ---------------------------------------------------------------------------

class TestGimbalInfo:
    def test_gimbal_info_parses_response(self):
        g = _make_gimbal()
        # 6 floats: tilt_min, tilt_max, pan_min, pan_max, focal_min, focal_max
        data = struct.pack("<ffffff", 0.0, 90.0, -45.0, 45.0, 20.0, 200.0)
        crc = GimbalSerial._crc8_smbus(data)
        g.ser.read = MagicMock(return_value=data + bytes([crc]))
        tilt_range, pan_range, focal_range = g.gimbal_info()
        assert math.isclose(tilt_range[0], 0.0)
        assert math.isclose(tilt_range[1], 90.0)
        assert math.isclose(pan_range[0], -45.0)
        assert math.isclose(focal_range[1], 200.0)

    def test_gimbal_info_closed_port_raises(self):
        g = _make_gimbal(is_open=False)
        with pytest.raises(RuntimeError, match="not open"):
            g.gimbal_info()


# ---------------------------------------------------------------------------
# get_gps_data
# ---------------------------------------------------------------------------

class TestGetGpsData:
    def test_gps_data_with_valid_coords(self):
        g = _make_gimbal()
        lon, lat, ts = -73.935242, 40.730610, 1234567890
        data = struct.pack("<ddQ", lon, lat, ts)
        crc = GimbalSerial._crc8_smbus(data)
        g.ser.read = MagicMock(return_value=data + bytes([crc]))
        coords, timestamp = g.get_gps_data()
        assert coords is not None
        assert math.isclose(coords[0], lon, rel_tol=1e-9)
        assert math.isclose(coords[1], lat, rel_tol=1e-9)
        assert timestamp == ts

    def test_gps_data_nan_coords_returns_none(self):
        g = _make_gimbal()
        data = struct.pack("<ddQ", float("nan"), float("nan"), 0)
        crc = GimbalSerial._crc8_smbus(data)
        g.ser.read = MagicMock(return_value=data + bytes([crc]))
        coords, timestamp = g.get_gps_data()
        assert coords is None
        assert timestamp is None


# ---------------------------------------------------------------------------
# close
# ---------------------------------------------------------------------------

class TestClose:
    def test_close_calls_serial_close(self):
        g = _make_gimbal()
        g.close()
        g.ser.close.assert_called_once()

    def test_close_when_already_closed_is_safe(self):
        g = _make_gimbal(is_open=False)
        g.close()  # Should not raise
