"""
Tests for pure computational functions in accuracy_benchmark.py.
Hardware/GPU code is not exercised – only CPU-side logic is tested.
"""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

# conftest.py already installs stubs; import module under test
from accuracy_benchmark import (
    compute_stage_transform,
    parse_yolo_label_file,
    yolo_to_staged_xywh,
    postprocess_by_image,
    load_data_yaml,
    StageInfo,
    WIDTH,
    HEIGHT,
)


# ============================================================================
# compute_stage_transform
# ============================================================================
class TestComputeStageTransform:
    def test_square_target_wider_source(self):
        sx, sy, px, py = compute_stage_transform(3840, 2160, 1920, 1080)
        assert sx == pytest.approx(0.5)
        assert sy == pytest.approx(0.5)
        assert px == pytest.approx(0.0)
        assert py == pytest.approx(0.0)

    def test_letterbox_padding_for_portrait_image(self):
        # 480x640 portrait image -> 1920x1080 landscape target
        # s = min(1920/480, 1080/640) = min(4.0, 1.6875) = 1.6875
        sx, sy, px, py = compute_stage_transform(480, 640, 1920, 1080)
        assert sx == pytest.approx(sy)
        new_w = 480 * sx
        new_h = 640 * sy
        assert px == pytest.approx((1920 - new_w) / 2.0)
        assert py == pytest.approx((1080 - new_h) / 2.0)

    def test_identity_for_same_dimensions(self):
        sx, sy, px, py = compute_stage_transform(1920, 1080, 1920, 1080)
        assert sx == pytest.approx(1.0)
        assert sy == pytest.approx(1.0)
        assert px == pytest.approx(0.0)
        assert py == pytest.approx(0.0)

    def test_scale_is_always_uniform(self):
        # sx == sy because we use the same scale factor `s`
        sx, sy, _px, _py = compute_stage_transform(640, 360, 1920, 1080)
        assert sx == pytest.approx(sy)


# ============================================================================
# parse_yolo_label_file
# ============================================================================
class TestParseYoloLabelFile:
    def test_returns_empty_for_nonexistent_file(self, tmp_path):
        result = parse_yolo_label_file(tmp_path / "no_file.txt")
        assert result == []

    def test_parses_single_valid_line(self, tmp_path):
        label = tmp_path / "label.txt"
        label.write_text("0 0.5 0.5 0.1 0.2\n")
        rows = parse_yolo_label_file(label)
        assert len(rows) == 1
        cls, x, y, w, h = rows[0]
        assert cls == 0
        assert x == pytest.approx(0.5)
        assert y == pytest.approx(0.5)
        assert w == pytest.approx(0.1)
        assert h == pytest.approx(0.2)

    def test_parses_multiple_lines(self, tmp_path):
        label = tmp_path / "label.txt"
        label.write_text("0 0.5 0.5 0.1 0.2\n0 0.3 0.4 0.15 0.25\n")
        rows = parse_yolo_label_file(label)
        assert len(rows) == 2

    def test_skips_blank_and_short_lines(self, tmp_path):
        label = tmp_path / "label.txt"
        label.write_text("\n   \n0 0.5\n0 0.5 0.5 0.1 0.2\n")
        rows = parse_yolo_label_file(label)
        assert len(rows) == 1

    def test_class_id_is_integer(self, tmp_path):
        label = tmp_path / "label.txt"
        label.write_text("0 0.5 0.5 0.1 0.2\n")
        rows = parse_yolo_label_file(label)
        assert isinstance(rows[0][0], int)


# ============================================================================
# yolo_to_staged_xywh
# ============================================================================
def _make_stage_info(orig_w=640, orig_h=480, target_w=WIDTH, target_h=HEIGHT):
    from accuracy_benchmark import compute_stage_transform
    sx, sy, px, py = compute_stage_transform(orig_w, orig_h, target_w, target_h)
    return StageInfo(
        orig_path=Path("/dummy/orig.jpg"),
        staged_path=Path("/dummy/staged.jpg"),
        orig_w=orig_w,
        orig_h=orig_h,
        sx=sx,
        sy=sy,
        pad_x=px,
        pad_y=py,
    )


class TestYoloToStagedXywh:
    def test_normalized_coords_produce_valid_result(self):
        st = _make_stage_info()
        result = yolo_to_staged_xywh(0, 0.5, 0.5, 0.2, 0.2, st)
        assert result is not None
        cls, lx, ly, bw, bh = result
        assert cls == 0
        assert 0 <= lx < WIDTH
        assert 0 <= ly < HEIGHT
        assert bw > 0
        assert bh > 0

    def test_returns_none_for_zero_width(self):
        st = _make_stage_info()
        result = yolo_to_staged_xywh(0, 0.5, 0.5, 0.0, 0.1, st)
        assert result is None

    def test_returns_none_for_bbox_entirely_outside_right(self):
        st = _make_stage_info()
        # Use absolute pixel coords (> 1.5) far beyond image width → left_s >= WIDTH
        result = yolo_to_staged_xywh(0, 3000.0, 240.0, 50.0, 50.0, st)
        assert result is None

    def test_clamps_bbox_to_image_boundaries(self):
        st = _make_stage_info()
        # Near the edge but still partially inside
        result = yolo_to_staged_xywh(0, 0.01, 0.01, 0.02, 0.02, st)
        if result is not None:
            cls, lx, ly, bw, bh = result
            assert lx >= 0
            assert ly >= 0
            assert lx + bw <= WIDTH
            assert ly + bh <= HEIGHT

    def test_pixel_coords_treated_as_unnormalized(self):
        # Values > 1.5 are treated as absolute pixel coords
        st = _make_stage_info()
        result = yolo_to_staged_xywh(0, 320.0, 240.0, 100.0, 80.0, st)
        assert result is not None


# ============================================================================
# postprocess_by_image
# ============================================================================
class TestPostprocessByImage:
    def test_empty_input(self):
        assert postprocess_by_image([]) == []

    def test_single_detection_passes_through(self):
        dets = [{"image_id": 0, "score": 0.9, "bbox": [10, 10, 50, 50], "category_id": 1}]
        result = postprocess_by_image(dets)
        assert len(result) == 1
        assert result[0]["score"] == pytest.approx(0.9)

    def test_picks_highest_score_per_image(self):
        dets = [
            {"image_id": 1, "score": 0.7, "bbox": [0, 0, 10, 10], "category_id": 1},
            {"image_id": 1, "score": 0.95, "bbox": [5, 5, 20, 20], "category_id": 1},
            {"image_id": 1, "score": 0.5, "bbox": [1, 1, 5, 5], "category_id": 1},
        ]
        result = postprocess_by_image(dets)
        assert len(result) == 1
        assert result[0]["score"] == pytest.approx(0.95)

    def test_keeps_one_detection_per_image_id(self):
        dets = [
            {"image_id": 0, "score": 0.8, "bbox": [0, 0, 10, 10], "category_id": 1},
            {"image_id": 1, "score": 0.6, "bbox": [5, 5, 15, 15], "category_id": 1},
            {"image_id": 0, "score": 0.9, "bbox": [2, 2, 12, 12], "category_id": 1},
        ]
        result = postprocess_by_image(dets)
        assert len(result) == 2
        scores_by_img = {int(d["image_id"]): d["score"] for d in result}
        assert scores_by_img[0] == pytest.approx(0.9)
        assert scores_by_img[1] == pytest.approx(0.6)


# ============================================================================
# load_data_yaml (fallback parser)
# ============================================================================
class TestLoadDataYaml:
    def test_parses_simple_yaml_file(self, tmp_path):
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("path: /data\nnc: 1\nnames:\n  - drone\n")
        result = load_data_yaml(yaml_file)
        assert "path" in result or "nc" in result  # either yaml or fallback

    def test_returns_dict(self, tmp_path):
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("nc: 1\nnames: ['drone']\n")
        result = load_data_yaml(yaml_file)
        assert isinstance(result, dict)
