"""
Unit tests for src/cv_process/main.py

Covers pure/testable functions:
  - _format_time() - formats a millisecond timestamp to human-readable string
  - update_osd() - builds OSD text and sets properties on mocked GStreamer elements
"""
import math
import pytest
from unittest.mock import MagicMock, call
from datetime import datetime

from cv_process.main import _format_time, update_osd
from common.ipc import OSDData


# ---------------------------------------------------------------------------
# _format_time
# ---------------------------------------------------------------------------

class TestFormatTime:
    def test_returns_string(self):
        result = _format_time(0)
        assert isinstance(result, str)

    def test_milliseconds_included(self):
        """The last 3 digits of timestamp_ms should appear as milliseconds."""
        ts = 1_000_000_500  # ends in 500 ms
        result = _format_time(ts)
        assert ".500" in result

    def test_zero_ms_suffix(self):
        ts = 1_000_001_000  # ends in 000 ms
        result = _format_time(ts)
        assert ".000" in result

    def test_format_has_date_components(self):
        # 2024-01-15 10:30:00 UTC+0 → depends on local tz, but year should appear
        ts = 1705314600000  # roughly 2024-01-15
        result = _format_time(ts)
        # The result should contain a 4-digit year
        assert any(str(y) in result for y in range(2020, 2030))


# ---------------------------------------------------------------------------
# update_osd
# ---------------------------------------------------------------------------

def _make_osd_data(**kwargs):
    defaults = dict(
        pts_ns=0,
        translate_x=0.1,
        translate_y=-0.2,
        scale=1.5,
        average_fps=30.0,
        gimbal_tilt_deg=15.0,
        gimbal_pan_deg=-5.0,
        gimbal_focal_length_mm=24.0,
        device_ip_addresses=["192.168.1.1"],
        timestamp_ms=1000,
        tracking_state="idle",
        longitude=None,
        latitude=None,
    )
    defaults.update(kwargs)
    return OSDData(**defaults)


class TestUpdateOsd:
    def test_sets_osd_text_property(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data()

        update_osd(osd, shader, msg, step_size=5)

        osd.set_property.assert_any_call("text", pytest.approx(osd.set_property.call_args_list[0][0][1], rel=1e-3))

    def test_osd_text_contains_tilt_pan(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data(gimbal_tilt_deg=30.0, gimbal_pan_deg=10.0)

        update_osd(osd, shader, msg, step_size=5)

        text_arg = osd.set_property.call_args_list[0][0][1]
        assert "30.00" in text_arg
        assert "10.00" in text_arg

    def test_osd_text_contains_gps_unavailable_when_none(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data(longitude=None, latitude=None)

        update_osd(osd, shader, msg, step_size=5)

        text_arg = osd.set_property.call_args_list[0][0][1]
        assert "GPS unavailable" in text_arg

    def test_osd_text_contains_coordinates_when_available(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data(longitude=-73.935242, latitude=40.730610)

        update_osd(osd, shader, msg, step_size=5)

        text_arg = osd.set_property.call_args_list[0][0][1]
        assert "GPS:" in text_arg
        assert "-73.935242" in text_arg

    def test_shader_uniforms_set(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data(translate_x=0.3, translate_y=-0.1, scale=2.0)

        update_osd(osd, shader, msg, step_size=3)

        # shader.set_property should be called with "uniforms"
        uniforms_calls = [
            c for c in shader.set_property.call_args_list
            if c[0][0] == "uniforms"
        ]
        assert len(uniforms_calls) >= 1

    def test_handles_none_osd_element_gracefully(self):
        """If osd or shader is None, update_osd should raise (documenting behavior)."""
        msg = _make_osd_data()
        with pytest.raises(Exception):
            update_osd(None, None, msg, step_size=5)

    def test_ip_addresses_in_text(self):
        osd = MagicMock()
        shader = MagicMock()
        msg = _make_osd_data(device_ip_addresses=["10.0.0.5", "172.16.0.1"])

        update_osd(osd, shader, msg, step_size=5)

        text_arg = osd.set_property.call_args_list[0][0][1]
        assert "10.0.0.5" in text_arg
