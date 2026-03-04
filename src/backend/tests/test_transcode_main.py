"""
Unit tests for src/transcode_process/main.py

Covers the pure/testable method:
  - TranscodeProcess._read_log() - JSONL parsing of OSD log files
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
