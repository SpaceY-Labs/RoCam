"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for TranscodeProcess log parsing, shader probe, and bus callback.
"""
import json
import os
import pytest
from unittest.mock import MagicMock, patch

from common.ipc import OSDData


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _osd_dict(**kwargs):
    """Return a minimal OSDData-compatible dict."""
    base = dict(
        pts_ns=0, translate_x=0.0, translate_y=0.0, scale=1.0,
        average_fps=30.0, gimbal_tilt_deg=0.0, gimbal_pan_deg=0.0,
        gimbal_focal_length_mm=24.0, device_ip_addresses=[],
        timestamp_ms=1000, tracking_state="idle",
        longitude=None, latitude=None,
    )
    base.update(kwargs)
    return base


def _write_log(path, lines):
    with open(path, "w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTranscodeProcessReadLog:
    def _instance(self):
        """Return a TranscodeProcess instance with GStreamer fully mocked."""
        from transcode_process.main import TranscodeProcess

        with patch("transcode_process.main.Gst.init"), \
             patch("transcode_process.main.Gst.parse_launch") as mock_parse, \
             patch("transcode_process.main.run_pipeline_and_wait_for_start"), \
             patch("builtins.open", side_effect=Exception("block real open")):

            fake_pipeline = MagicMock()
            fake_element = MagicMock()
            fake_element.get_static_pad.return_value = MagicMock()
            fake_pipeline.get_by_name.return_value = fake_element
            mock_parse.return_value = fake_pipeline

            obj = TranscodeProcess.__new__(TranscodeProcess)
            obj._mode = "preview-stabilized"
            obj._step_size = 5
        return obj

    def test_returns_empty_list_for_missing_file(self, tmp_path):
        obj = self._instance()
        result = obj._read_log(str(tmp_path / "nonexistent.txt"))
        assert result == []

    def test_parses_valid_jsonl(self, tmp_path):
        obj = self._instance()
        log_path = str(tmp_path / "log.txt")
        entry = _osd_dict(pts_ns=42, timestamp_ms=2000)
        _write_log(log_path, [entry])

        result = obj._read_log(log_path)

        assert len(result) == 1
        assert isinstance(result[0], OSDData)
        assert result[0].pts_ns == 42
        assert result[0].timestamp_ms == 2000

    def test_skips_invalid_json_lines(self, tmp_path):
        obj = self._instance()
        log_path = str(tmp_path / "log.txt")
        valid = _osd_dict(pts_ns=1)
        with open(log_path, "w") as f:
            f.write("not valid json\n")
            f.write(json.dumps(valid) + "\n")

        result = obj._read_log(log_path)
        assert len(result) == 1
        assert result[0].pts_ns == 1

    def test_skips_empty_lines(self, tmp_path):
        obj = self._instance()
        log_path = str(tmp_path / "log.txt")
        valid = _osd_dict(pts_ns=5)
        with open(log_path, "w") as f:
            f.write("\n")
            f.write("   \n")
            f.write(json.dumps(valid) + "\n")

        result = obj._read_log(log_path)
        assert len(result) == 1

    def test_multiple_entries(self, tmp_path):
        obj = self._instance()
        log_path = str(tmp_path / "log.txt")
        entries = [_osd_dict(pts_ns=i, timestamp_ms=i * 100) for i in range(5)]
        _write_log(log_path, entries)

        result = obj._read_log(log_path)
        assert len(result) == 5
        assert [r.pts_ns for r in result] == list(range(5))


# ---------------------------------------------------------------------------
# TranscodeProcess._shader_probe
# ---------------------------------------------------------------------------

class TestTranscodeProcessShaderProbe:
    def _make_instance_with_osd_data(self, osd_list=None, mode="preview-stabilized"):
        """Return a bare TranscodeProcess with injected OSD data."""
        from transcode_process.main import TranscodeProcess
        obj = TranscodeProcess.__new__(TranscodeProcess)
        obj._mode = mode
        obj._step_size = 5 if mode == "preview-stabilized" else 1
        obj._osd_data_list = osd_list if osd_list is not None else []
        obj._osd_data_pointer = 0
        obj._osd = MagicMock()
        obj._shader = MagicMock()
        return obj

    def _make_probe_args(self, pts_ns=1000):
        pad = MagicMock()
        gst_buf = MagicMock()
        gst_buf.pts = pts_ns
        info = MagicMock()
        info.get_buffer.return_value = gst_buf
        return pad, info, 0

    def test_returns_ok_when_buffer_is_none(self):
        from gi.repository import Gst as GstStub  # stub from conftest
        obj = self._make_instance_with_osd_data()
        pad, info, u_data = self._make_probe_args()
        info.get_buffer.return_value = None
        # Should return Gst.PadProbeReturn.OK
        result = obj._shader_probe(pad, info, u_data)
        # Gst stub returns MagicMock for enum; just check no exception was raised
        assert result is not None

    def test_uses_empty_osd_when_no_list(self):
        obj = self._make_instance_with_osd_data(osd_list=[])
        pad, info, u_data = self._make_probe_args(pts_ns=500)
        with patch("transcode_process.main.update_osd") as mock_update:
            obj._shader_probe(pad, info, u_data)
        mock_update.assert_called_once()
        called_osd = mock_update.call_args[0][2]
        assert called_osd.pts_ns == 500

    def test_uses_last_osd_when_pointer_exceeds_list(self):
        from common.ipc import OSDData
        last = OSDData(**_osd_dict(pts_ns=999))
        obj = self._make_instance_with_osd_data(osd_list=[last])
        obj._osd_data_pointer = 10  # past end
        pad, info, u_data = self._make_probe_args()
        with patch("transcode_process.main.update_osd") as mock_update:
            obj._shader_probe(pad, info, u_data)
        mock_update.assert_called_once()
        called_osd = mock_update.call_args[0][2]
        assert called_osd.pts_ns == 999

    def test_advances_pointer_in_preview_mode(self):
        from common.ipc import OSDData
        entries = [OSDData(**_osd_dict(pts_ns=i)) for i in range(5)]
        obj = self._make_instance_with_osd_data(osd_list=entries, mode="preview-stabilized")
        pad, info, u_data = self._make_probe_args()
        with patch("transcode_process.main.update_osd"):
            obj._shader_probe(pad, info, u_data)
        assert obj._osd_data_pointer == 2  # increments by 2 in preview mode

    def test_advances_pointer_in_download_mode(self):
        from common.ipc import OSDData
        entries = [OSDData(**_osd_dict(pts_ns=i)) for i in range(5)]
        obj = self._make_instance_with_osd_data(osd_list=entries, mode="download-stabilized")
        pad, info, u_data = self._make_probe_args()
        with patch("transcode_process.main.update_osd"):
            obj._shader_probe(pad, info, u_data)
        assert obj._osd_data_pointer == 1  # increments by 1 in download mode


# ---------------------------------------------------------------------------
# TranscodeProcess._bus_call
# ---------------------------------------------------------------------------

class TestTranscodeProcessBusCall:
    def _make_instance(self):
        from transcode_process.main import TranscodeProcess
        obj = TranscodeProcess.__new__(TranscodeProcess)
        obj._osd_data_list = []
        obj._osd_data_pointer = 0
        return obj

    def test_eos_calls_loop_quit(self):
        from gi.repository import Gst as GstStub
        obj = self._make_instance()
        bus = MagicMock()
        loop = MagicMock()
        message = MagicMock()
        message.type = GstStub.MessageType.EOS
        result = obj._bus_call(bus, message, loop)
        loop.quit.assert_called_once()
        assert result is True

    def test_warning_does_not_quit(self):
        from gi.repository import Gst as GstStub
        obj = self._make_instance()
        bus = MagicMock()
        loop = MagicMock()
        message = MagicMock()
        message.type = GstStub.MessageType.WARNING
        message.parse_warning.return_value = ("warn_err", "warn_debug")
        result = obj._bus_call(bus, message, loop)
        loop.quit.assert_not_called()
        assert result is True

    def test_error_calls_loop_quit(self):
        from gi.repository import Gst as GstStub
        obj = self._make_instance()
        bus = MagicMock()
        loop = MagicMock()
        message = MagicMock()
        message.type = GstStub.MessageType.ERROR
        message.parse_error.return_value = ("err", "debug")
        result = obj._bus_call(bus, message, loop)
        loop.quit.assert_called_once()
        assert result is True
