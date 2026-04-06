"""
Author: Jianqing Liu
Date: 2025-11-09
Purpose: Serial client for the custom gimbal protocol, providing thread-safe
    methods to query gimbal info, read/write tilt-pan angles, control LEDs,
    set focal length, and retrieve GPS data over UART.
"""

import struct
import serial
import math
from typing import Optional, Tuple
from threading import Lock

class GimbalSerial:
    """
    Serial client for the gimbal protocol. See docs/Design/GimbalProtocol/GimbalProtocol.tex
    for the full specification.

    Methods raise RuntimeError if the port is closed, a write is short, a read times out,
    or the CRC check fails (where applicable).

    Usage:
        with GimbalSerial("/dev/ttyUSB0", 115200, 0.5) as dev:
            info = dev.gimbal_info()
            dev.set_arm_led(True)
            dev.set_status_led(False)
            dev.set_deg(12.5, 3.25)
            tilt, pan = dev.get_deg()
    """

    def __init__(self, port: str, baudrate: int = 115200, timeout: float = 0.5):
        self.ser = serial.Serial(port=port, baudrate=baudrate, timeout=timeout)
        self._mutex = Lock()

    def close(self) -> None:
        """Close the serial port if open."""
        self._mutex.acquire()
        if self.ser and self.ser.is_open:
            self.ser.close()
        self._mutex.release()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()

    @staticmethod
    def _crc8_smbus(data: bytes) -> int:
        crc = 0x00
        poly = 0x07
        for b in data:
            crc ^= b
            for _ in range(8):
                if crc & 0x80:
                    crc = ((crc << 1) & 0xFF) ^ poly
                else:
                    crc = (crc << 1) & 0xFF
        return crc

    def _read_exact(self, n: int) -> Optional[bytes]:
        buf = bytearray()
        while len(buf) < n:
            chunk = self.ser.read(n - len(buf))
            if not chunk:
                return None
            buf.extend(chunk)
        return bytes(buf)

    def _send_request(self, request_id: int, payload: bytes, response_length: int = 0) -> bytes:
        with self._mutex:
            if not self.ser or not self.ser.is_open:
                raise RuntimeError("Serial port is not open")
            packet = self.create_request_data(request_id, payload)
            written = self.ser.write(packet)
            if written != len(packet):
                raise RuntimeError(f"Short write for request_id 0x{request_id:02X}")
            total_response_length = response_length + 1
            resp = self._read_exact(total_response_length)
            if resp is None or len(resp) != total_response_length:
                raise RuntimeError(f"Timeout or short read on request_id 0x{request_id:02X} response")

            if response_length == 0:
                if resp[0] != 0x00:
                    raise RuntimeError(f"Invalid ACK: got 0x{resp[0]:02X}, expected 0x00")
                return b""
            else:
                data_bytes = resp[:-1]
                crc_expected = self._crc8_smbus(data_bytes)
                crc_received = resp[-1]
                if crc_expected != crc_received:
                    raise RuntimeError(
                        f"CRC mismatch: got 0x{crc_received:02X}, expected 0x{crc_expected:02X}"
                    )
                return data_bytes

    def create_request_data(self, request_id: int, payload: bytes) -> bytes:
        if not isinstance(payload, (bytes, bytearray)):
            raise TypeError("payload must be bytes-like")
        data = bytearray(2 + len(payload))
        data[0] = 0x00
        data[1] = request_id & 0xFF
        if payload:
            data[2:] = payload
        data[0] = self._crc8_smbus(bytes(data[1:]))
        return bytes(data)

    def gimbal_info(self) -> Tuple[Tuple[float, float], Tuple[float, float], Tuple[float, float]]:
        """
        Get tilt, pan, and focal length ranges (Command ID 0x00).

        Returns:
          (tilt_range_deg, pan_range_deg, focal_length_range_mm), each a (min, max) tuple.
        """
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        resp_data = self._send_request(0x00, b"", 24)
        tilt_min, tilt_max = struct.unpack("<ff", resp_data[0:8])
        pan_min, pan_max = struct.unpack("<ff", resp_data[8:16])
        focal_min, focal_max = struct.unpack("<ff", resp_data[16:24])
        return (tilt_min, tilt_max), (pan_min, pan_max), (focal_min, focal_max)

    def set_arm_led(self, enabled: bool) -> bool:
        """Set the ARM LED on or off (Command ID 0x01). Returns True on success."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        try:
            payload = bytes([1 if enabled else 0])
            self._send_request(0x01, payload)
            return True
        except RuntimeError:
            return False

    def set_status_led(self, enabled: bool) -> bool:
        """Set the Status LED on or off (Command ID 0x02). Returns True on success."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        try:
            payload = bytes([1 if enabled else 0])
            self._send_request(0x02, payload)
            return True
        except RuntimeError:
            return False

    def set_deg(self, tilt_deg: float, pan_deg: float) -> bool:
        """Move gimbal to tilt/pan angles in degrees (Command ID 0x03). Returns True on success."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        try:
            payload = struct.pack("<ff", float(tilt_deg), float(pan_deg))
            self._send_request(0x03, payload)
            return True
        except RuntimeError:
            return False

    def get_deg(self) -> Tuple[float, float]:
        """
        Get current tilt and pan in degrees (Command ID 0x04).
        Returns (tilt_deg, pan_deg). If coordinates are not available, returns (NaN, NaN).
        """
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        resp_data = self._send_request(0x04, b"", 8)
        tilt = struct.unpack("<f", resp_data[0:4])[0]
        pan = struct.unpack("<f", resp_data[4:8])[0]
        return tilt, pan

    def set_focal_length_mm(self, focal_length_mm: float) -> bool:
        """Set focal length in mm (Command ID 0x05). Returns True on success."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        try:
            payload = struct.pack("<f", float(focal_length_mm))
            self._send_request(0x05, payload)
            return True
        except RuntimeError:
            return False

    def get_focal_length_mm(self) -> float:
        """Get current focal length in mm (Command ID 0x06)."""
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        resp_data = self._send_request(0x06, b"", 4)
        return struct.unpack("<f", resp_data[0:4])[0]

    def get_gps_data(self) -> Tuple[Optional[Tuple[float, float]], Optional[int]]:
        """
        Get (longitude, latitude) and timestamp (ms) (Command ID 0x07).
        
        Returns:
            ((longitude, latitude), timestamp_ms)
            - coordinates: (longitude, latitude) in degrees, or None if unavailable.
            - timestamp_ms: timestamp in ms, or None if unavailable.
        """
        if not self.ser or not self.ser.is_open:
            raise RuntimeError("Serial port is not open")
        resp_data = self._send_request(0x07, b"", 24)
        longitude = struct.unpack("<d", resp_data[0:8])[0]
        latitude = struct.unpack("<d", resp_data[8:16])[0]
        timestamp_ms = struct.unpack("<Q", resp_data[16:24])[0]

        coordinates = None
        if not math.isnan(longitude) and not math.isnan(latitude):
            coordinates = (longitude, latitude)

        timestamp = None
        if timestamp_ms != 0:
            timestamp = timestamp_ms

        return coordinates, timestamp
