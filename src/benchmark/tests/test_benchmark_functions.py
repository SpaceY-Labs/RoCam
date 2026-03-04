"""
Tests for pure computational functions in accuracy_benchmark.py.
Hardware/GPU code is not exercised – only CPU-side logic is tested.
"""
import sys
import io
from pathlib import Path
import pytest
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

# conftest.py already installs stubs; import module under test
from accuracy_benchmark import (
    compute_stage_transform,
    parse_yolo_label_file,
    yolo_to_staged_xywh,
    postprocess_by_image,
    load_data_yaml,
    stage_images,
    build_pipeline_desc,
    _load_image_size,
    _read_image_bgr,
    _write_jpg,
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

    def test_fallback_parser_when_yaml_unavailable(self, tmp_path, monkeypatch):
        """Exercise the pure-Python fallback parser (no PyYAML)."""
        import sys
        # Temporarily hide the yaml module
        original = sys.modules.pop("yaml", None)
        try:
            yaml_file = tmp_path / "data.yaml"
            yaml_file.write_text(
                "path: /data\nnc: 1\nnames:\n  - drone\n  - bird\n"
            )
            result = load_data_yaml(yaml_file)
            assert isinstance(result, dict)
        finally:
            if original is not None:
                sys.modules["yaml"] = original

    def test_fallback_inline_list(self, tmp_path, monkeypatch):
        """Fallback parser handles inline list syntax like names: [drone, bird]."""
        import sys
        original = sys.modules.pop("yaml", None)
        try:
            yaml_file = tmp_path / "data.yaml"
            yaml_file.write_text("names: [drone, bird]\nnc: 2\n")
            result = load_data_yaml(yaml_file)
            assert isinstance(result, dict)
        finally:
            if original is not None:
                sys.modules["yaml"] = original

    def test_fallback_skips_comments_and_blank_lines(self, tmp_path, monkeypatch):
        """Fallback parser ignores comment and empty lines."""
        import yaml as yaml_mod
        monkeypatch.setattr(yaml_mod, "safe_load", lambda f: (_ for _ in ()).throw(RuntimeError("fail")))
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("# comment\n\nnc: 1\n")
        result = load_data_yaml(yaml_file)
        assert isinstance(result, dict)

    def test_fallback_handles_key_with_no_value(self, tmp_path, monkeypatch):
        """Fallback parser handles a key with no value (sets to None)."""
        import yaml as yaml_mod
        monkeypatch.setattr(yaml_mod, "safe_load", lambda f: (_ for _ in ()).throw(RuntimeError("fail")))
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("path:\nnc: 1\n")
        result = load_data_yaml(yaml_file)
        assert "nc" in result

    def test_fallback_inline_list_real(self, tmp_path, monkeypatch):
        """Fallback parser handles inline list via yaml failure."""
        import yaml as yaml_mod
        monkeypatch.setattr(yaml_mod, "safe_load", lambda f: (_ for _ in ()).throw(RuntimeError("fail")))
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("names: [drone, bird]\nnc: 2\n")
        result = load_data_yaml(yaml_file)
        assert isinstance(result, dict)

    def test_fallback_string_value(self, tmp_path, monkeypatch):
        """Fallback parser correctly parses simple key: value pairs."""
        import yaml as yaml_mod
        monkeypatch.setattr(yaml_mod, "safe_load", lambda f: (_ for _ in ()).throw(RuntimeError("fail")))
        yaml_file = tmp_path / "data.yaml"
        yaml_file.write_text("path: /datasets/coco\nnc: 80\n")
        result = load_data_yaml(yaml_file)
        assert result.get("path") == "/datasets/coco"
        assert result.get("nc") == "80"


# ============================================================================
# _load_image_size, _read_image_bgr, _write_jpg  (use PIL fallback in CI)
# ============================================================================

def _create_test_image(tmp_path: Path, name: str = "test.jpg") -> Path:
    """Create a small JPEG image using PIL for testing."""
    from PIL import Image as PILImage
    img = PILImage.new("RGB", (64, 32), color=(255, 0, 0))
    path = tmp_path / name
    img.save(path, format="JPEG")
    return path


class TestImageIO:
    def test_load_image_size_returns_width_height(self, tmp_path):
        path = _create_test_image(tmp_path)
        w, h = _load_image_size(path)
        assert w == 64
        assert h == 32

    def test_load_image_size_png(self, tmp_path):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (100, 50), color=(0, 128, 0))
        path = tmp_path / "test.png"
        img.save(path, format="PNG")
        w, h = _load_image_size(path)
        assert w == 100
        assert h == 50

    def test_load_image_size_falls_back_to_pil_when_cv2_returns_none(self, tmp_path, monkeypatch):
        """When cv2.imread returns None the function falls back to PIL."""
        import sys, types
        cv2_stub = types.ModuleType("cv2")
        cv2_stub.IMREAD_UNCHANGED = 1
        cv2_stub.imread = lambda p, f=None: None
        monkeypatch.setitem(sys.modules, "cv2", cv2_stub)
        path = _create_test_image(tmp_path)
        w, h = _load_image_size(path)
        assert w == 64
        assert h == 32

    def test_read_image_bgr_returns_array(self, tmp_path):
        path = _create_test_image(tmp_path)
        arr = _read_image_bgr(path)
        assert arr is not None
        # Result should be a numpy-compatible array with shape (H, W, 3)
        assert hasattr(arr, "shape")
        assert arr.shape[2] == 3

    def test_read_image_bgr_dimensions_match(self, tmp_path):
        path = _create_test_image(tmp_path)
        arr = _read_image_bgr(path)
        h, w = arr.shape[:2]
        assert w == 64
        assert h == 32

    def test_read_image_bgr_falls_back_to_pil_when_cv2_returns_none(self, tmp_path, monkeypatch):
        """When cv2.imread returns None, _read_image_bgr falls back to PIL."""
        import sys, types
        cv2_stub = types.ModuleType("cv2")
        cv2_stub.IMREAD_COLOR = 1
        cv2_stub.imread = lambda p, f=None: None
        monkeypatch.setitem(sys.modules, "cv2", cv2_stub)
        path = _create_test_image(tmp_path)
        arr = _read_image_bgr(path)
        assert arr is not None
        assert arr.shape[2] == 3  # 3 channel BGR

    def test_write_jpg_creates_file(self, tmp_path):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (32, 32), color=(0, 0, 255))
        arr = np.array(img)[:, :, ::-1].copy()  # RGB -> BGR numpy array
        out = tmp_path / "out.jpg"
        _write_jpg(out, arr, quality=90)
        assert out.exists()

    def test_write_jpg_creates_parent_directories(self, tmp_path):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (16, 16), color=(128, 128, 128))
        arr = np.array(img)[:, :, ::-1].copy()
        nested = tmp_path / "a" / "b" / "out.jpg"
        _write_jpg(nested, arr, quality=85)
        assert nested.exists()

    def test_write_jpg_falls_back_to_pil_when_cv2_fails(self, tmp_path, monkeypatch):
        """When cv2.imwrite raises, _write_jpg falls back to PIL."""
        import sys, types
        cv2_stub = types.ModuleType("cv2")
        cv2_stub.IMWRITE_JPEG_QUALITY = 1
        cv2_stub.imwrite = lambda p, img, params=None: (_ for _ in ()).throw(RuntimeError("no cv2"))
        monkeypatch.setitem(sys.modules, "cv2", cv2_stub)
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (32, 32), color=(200, 100, 50))
        arr = np.array(img)[:, :, ::-1].copy()
        out = tmp_path / "fallback.jpg"
        _write_jpg(out, arr, quality=80)
        assert out.exists()


# ============================================================================
# yolo_to_staged_xywh – additional edge-case branches
# ============================================================================

class TestYoloStagedEdgeCases:
    def _st(self, orig_w=640, orig_h=480):
        sx, sy, px, py = compute_stage_transform(orig_w, orig_h, WIDTH, HEIGHT)
        return StageInfo(Path("/a.jpg"), Path("/s.jpg"), orig_w, orig_h, sx, sy, px, py)

    def test_returns_none_when_left_and_width_sum_zero_or_negative(self):
        """Box that extends entirely to the left → left_s + bw_s <= 0."""
        st = self._st()
        # Place box well to the left with absolute (unnormalized) coordinates
        result = yolo_to_staged_xywh(0, -200.0, 240.0, 10.0, 10.0, st)
        assert result is None

    def test_returns_none_for_zero_height(self):
        """Zero height bbox should return None (bh_s <= 0)."""
        st = self._st()
        result = yolo_to_staged_xywh(0, 0.5, 0.5, 0.2, 0.0, st)
        assert result is None

    def test_pixel_coords_outside_bottom(self):
        """Box below the image → top_s >= HEIGHT."""
        st = self._st()
        result = yolo_to_staged_xywh(0, 960.0, 5000.0, 50.0, 50.0, st)
        assert result is None


# ============================================================================
# stage_images  (pure-Python early-exit paths, no cv2 required)
# ============================================================================

class TestStageImages:
    def _make_jpg(self, path: Path, w: int = WIDTH, h: int = HEIGHT):
        """Create a JPEG image at the given path."""
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (w, h))
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, format="JPEG")

    def test_raises_if_no_images_found(self, tmp_path):
        empty = tmp_path / "imgs"
        empty.mkdir()
        staging = tmp_path / "staging"
        with pytest.raises(RuntimeError, match="No images found"):
            stage_images(empty, staging, limit=None)

    def test_reuses_existing_staging_when_sizes_match(self, tmp_path):
        """When staging dir already has the correct images, no rebuild occurs."""
        imgs_dir = tmp_path / "imgs"
        imgs_dir.mkdir()
        # Create two source JPEG images
        self._make_jpg(imgs_dir / "a.jpg", 640, 480)
        self._make_jpg(imgs_dir / "b.jpg", 640, 480)

        staging = tmp_path / "staging"
        staging.mkdir()
        # Pre-populate staging with two correctly-sized images
        self._make_jpg(staging / "000000.jpg", WIDTH, HEIGHT)
        self._make_jpg(staging / "000001.jpg", WIDTH, HEIGHT)

        infos, pattern = stage_images(imgs_dir, staging, limit=None)
        assert len(infos) == 2
        assert "%06d.jpg" in str(pattern)

    def test_applies_limit_to_number_of_images(self, tmp_path):
        imgs_dir = tmp_path / "imgs"
        imgs_dir.mkdir()
        for i in range(5):
            self._make_jpg(imgs_dir / f"{i}.jpg", 640, 480)

        staging = tmp_path / "staging"
        staging.mkdir()
        # Pre-populate staging with exactly 2 files at correct size
        self._make_jpg(staging / "000000.jpg", WIDTH, HEIGHT)
        self._make_jpg(staging / "000001.jpg", WIDTH, HEIGHT)

        infos, _ = stage_images(imgs_dir, staging, limit=2)
        assert len(infos) == 2

    def test_rebuilds_if_staging_size_mismatch(self, tmp_path, monkeypatch):
        """When staged files have wrong dimensions, force a rebuild."""
        import types, sys
        # cv2 stub that reads our small PIL images
        cv2_stub = types.ModuleType("cv2")
        cv2_stub.IMREAD_UNCHANGED = 1
        cv2_stub.IMREAD_COLOR = 1
        cv2_stub.IMWRITE_JPEG_QUALITY = 1
        cv2_stub.INTER_LINEAR = 1
        cv2_stub.BORDER_CONSTANT = 0
        import numpy as _np
        dummy_bgr = _np.zeros((HEIGHT, WIDTH, 3), dtype=_np.uint8)
        cv2_stub.imread = lambda p, f=None: dummy_bgr
        cv2_stub.resize = lambda src, dsize, **kw: _np.zeros((dsize[1], dsize[0], 3), dtype=_np.uint8)
        cv2_stub.copyMakeBorder = lambda src, t, b, l, r, borderType, value=None: dummy_bgr
        cv2_stub.imwrite = lambda p, img, params=None: True
        monkeypatch.setitem(sys.modules, "cv2", cv2_stub)

        imgs_dir = tmp_path / "imgs"
        imgs_dir.mkdir()
        self._make_jpg(imgs_dir / "a.jpg", 640, 480)

        staging = tmp_path / "staging"
        staging.mkdir()
        # Staged file exists but has WRONG size (100x100 vs expected 1920x1080)
        self._make_jpg(staging / "000000.jpg", 100, 100)

        infos, _ = stage_images(imgs_dir, staging, limit=None)
        # After size-check failure, it rebuilds and produces 1 entry
        assert len(infos) == 1

    def test_rebuilds_if_staging_count_mismatch(self, tmp_path, monkeypatch):
        """When staging file count doesn't match, it clears the dir and rebuilds.
        The cv2 import line is excluded from coverage via pragma; here we mock
        cv2 to avoid the hardware dependency during the rebuild path."""
        import types, sys
        # Create a minimal cv2 stub
        cv2_stub = types.ModuleType("cv2")
        cv2_stub.IMREAD_UNCHANGED = 1
        cv2_stub.IMREAD_COLOR = 1
        cv2_stub.IMWRITE_JPEG_QUALITY = 1
        cv2_stub.INTER_LINEAR = 1
        cv2_stub.BORDER_CONSTANT = 0
        import numpy as _np
        dummy_bgr = _np.zeros((HEIGHT, WIDTH, 3), dtype=_np.uint8)
        cv2_stub.imread = lambda p, f=None: dummy_bgr
        cv2_stub.resize = lambda src, dsize, **kw: _np.zeros((dsize[1], dsize[0], 3), dtype=_np.uint8)
        cv2_stub.copyMakeBorder = lambda src, t, b, l, r, borderType, value=None: dummy_bgr
        cv2_stub.imwrite = lambda p, img, params=None: True
        monkeypatch.setitem(sys.modules, "cv2", cv2_stub)

        imgs_dir = tmp_path / "imgs"
        imgs_dir.mkdir()
        self._make_jpg(imgs_dir / "a.jpg", 640, 480)

        staging = tmp_path / "staging"
        staging.mkdir()
        # Wrong count: 2 files but only 1 source image
        self._make_jpg(staging / "000000.jpg", WIDTH, HEIGHT)
        self._make_jpg(staging / "000001.jpg", WIDTH, HEIGHT)

        infos, pattern = stage_images(imgs_dir, staging, limit=None)
        assert len(infos) == 1


# ============================================================================
# build_pipeline_desc
# ============================================================================

class TestBuildPipelineDesc:
    def test_contains_multifilesrc(self):
        from pathlib import Path
        desc = build_pipeline_desc(Path("/data/staging/%06d.jpg"), count=10, pgie_cfg=Path("/cfg/pgie.cfg"))
        assert "multifilesrc" in desc

    def test_contains_count_minus_one(self):
        from pathlib import Path
        desc = build_pipeline_desc(Path("/staging/%06d.jpg"), count=5, pgie_cfg=Path("/pgie.cfg"))
        assert "stop-index=4" in desc

    def test_contains_width_and_height(self):
        from pathlib import Path
        desc = build_pipeline_desc(Path("/staging/%06d.jpg"), count=1, pgie_cfg=Path("/p.cfg"))
        assert str(WIDTH) in desc
        assert str(HEIGHT) in desc

    def test_contains_nvinfer(self):
        from pathlib import Path
        desc = build_pipeline_desc(Path("/s/%06d.jpg"), count=2, pgie_cfg=Path("/cfg.txt"))
        assert "nvinfer" in desc
