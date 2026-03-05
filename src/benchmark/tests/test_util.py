"""Tests for src/benchmark/util.py – config file generation."""
import sys
import os
from pathlib import Path

# Ensure benchmark src is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

from util import generate_pgie_config, ENGINE_FILE_NAME


class TestGeneratePgieConfig:
    def test_creates_file_at_given_path(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        result = generate_pgie_config(str(out))
        assert result == str(out)
        assert out.exists()

    def test_returns_output_path(self, tmp_path):
        out = tmp_path / "cfg.txt"
        assert generate_pgie_config(str(out)) == str(out)

    def test_contains_standard_fields(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out))
        content = out.read_text()
        assert "[property]" in content
        assert "gpu-id=0" in content
        assert "batch-size=1" in content
        assert "network-mode=2" in content
        assert "[class-attrs-all]" in content
        assert "nms-iou-threshold=0.45" in content
        assert "pre-cluster-threshold=0.25" in content

    def test_no_onnx_field_when_not_specified(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out))
        content = out.read_text()
        assert "onnx-file=" not in content

    def test_includes_onnx_field_when_specified(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out), onnx_path="/path/to/model.onnx")
        content = out.read_text()
        assert "onnx-file=/path/to/model.onnx" in content

    def test_no_engine_field_when_not_specified(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out))
        content = out.read_text()
        assert "model-engine-file=" not in content

    def test_includes_engine_field_when_specified(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out), engine_path="/path/to/model.engine")
        content = out.read_text()
        assert "model-engine-file=/path/to/model.engine" in content

    def test_includes_both_onnx_and_engine_fields(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(
            str(out),
            onnx_path="/path/to/model.onnx",
            engine_path="/path/to/model.engine",
        )
        content = out.read_text()
        assert "onnx-file=/path/to/model.onnx" in content
        assert "model-engine-file=/path/to/model.engine" in content

    def test_custom_lib_path_is_absolute(self, tmp_path):
        out = tmp_path / "pgie_config.txt"
        generate_pgie_config(str(out))
        content = out.read_text()
        assert "custom-lib-path=" in content
        lib_line = [l for l in content.splitlines() if "custom-lib-path=" in l][0]
        lib_path = lib_line.split("=", 1)[1].strip()
        assert os.path.isabs(lib_path)

    def test_engine_file_name_constant(self):
        assert ENGINE_FILE_NAME == "model_b1_gpu0_fp16.engine"
