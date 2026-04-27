"""Tests for data/dataset.py."""
from __future__ import annotations
from pathlib import Path
import numpy as np
import torch
import pytest

from data.dataset import VOSPairDataset, NegativePairWrapper


def test_dataset_iteration_yields_correct_schema(tiny_vos_root: Path):
    ds = VOSPairDataset(
        root=tiny_vos_root, split="JPEGImages/480p",
        ann_split="Annotations/480p",
        out_size=128, max_gap=2,
        scale_jitter=0.0, translate_jitter=0.0,
        seed=0, length=20,
    )
    assert len(ds) == 20

    sample = ds[0]
    assert set(sample.keys()) == {"reference_image", "reference_mask",
                                   "target_image", "target_mask"}
    for key in ("reference_image", "target_image"):
        assert sample[key].shape == (3, 128, 128)
        assert sample[key].dtype == torch.float32
        assert 0.0 <= sample[key].min() and sample[key].max() <= 1.0
    for key in ("reference_mask", "target_mask"):
        assert sample[key].shape == (1, 128, 128)
        assert sample[key].dtype == torch.float32
        assert torch.all((sample[key] == 0) | (sample[key] == 1))


def test_dataset_rejects_non_multiple_of_32_when_strict(tiny_vos_root: Path):
    with pytest.raises(ValueError, match="multiple of 32"):
        VOSPairDataset(
            root=tiny_vos_root, split="JPEGImages/480p",
            ann_split="Annotations/480p",
            out_size=100, max_gap=2, seed=0, length=10,
        )


def test_dataset_supports_dynamic_out_size(tiny_vos_root: Path):
    ds = VOSPairDataset(
        root=tiny_vos_root, split="JPEGImages/480p",
        ann_split="Annotations/480p",
        out_size=128, max_gap=2, seed=0, length=10,
    )
    ds.set_out_size(256)
    sample = ds[0]
    assert sample["reference_image"].shape == (3, 256, 256)
    assert sample["target_mask"].shape == (1, 256, 256)


def test_dataset_skips_object_with_too_few_frames(tmp_path: Path):
    """Objects appearing in <2 frames are filtered out at index time."""
    from PIL import Image
    root = tmp_path / "single_frame_obj"
    img_dir = root / "JPEGImages/480p/vid"
    ann_dir = root / "Annotations/480p/vid"
    img_dir.mkdir(parents=True)
    ann_dir.mkdir(parents=True)

    # 2 frames; obj id 1 in only frame 0, obj id 2 in both frames
    img = (np.random.rand(120, 160, 3) * 255).astype(np.uint8)
    Image.fromarray(img).save(img_dir / "00000.jpg")
    Image.fromarray(img).save(img_dir / "00001.jpg")

    m0 = np.zeros((120, 160), dtype=np.uint8)
    m0[10:20, 10:20] = 1  # obj 1
    m0[40:60, 40:60] = 2  # obj 2
    Image.fromarray(m0, mode="P").save(ann_dir / "00000.png")

    m1 = np.zeros((120, 160), dtype=np.uint8)
    m1[40:60, 40:60] = 2  # obj 2 only
    Image.fromarray(m1, mode="P").save(ann_dir / "00001.png")

    ds = VOSPairDataset(
        root=root, split="JPEGImages/480p",
        ann_split="Annotations/480p",
        out_size=128, max_gap=5, seed=0, length=20,
    )
    # Only obj 2 has >=2 frames -> 1 object across 1 video
    assert len(ds.objects) == 1
    assert ds.objects[0].object_id == 2


def test_negative_pair_wrapper_zeros_target_mask(tiny_vos_root: Path):
    base = VOSPairDataset(
        root=tiny_vos_root, split="JPEGImages/480p",
        ann_split="Annotations/480p",
        out_size=128, max_gap=2, seed=0, length=50,
    )
    wrapped = NegativePairWrapper(base, neg_ratio=1.0, seed=0)  # always negative

    sample = wrapped[0]
    assert sample["target_mask"].sum() == 0  # negatives -> empty target mask


def test_negative_pair_wrapper_passthrough_when_ratio_zero(tiny_vos_root: Path):
    base = VOSPairDataset(
        root=tiny_vos_root, split="JPEGImages/480p",
        ann_split="Annotations/480p",
        out_size=128, max_gap=2, seed=0, length=50,
    )
    wrapped = NegativePairWrapper(base, neg_ratio=0.0, seed=0)  # never negative

    # All samples should match base 1:1
    for i in range(5):
        s_base = base[i]
        s_wrapped = wrapped[i]
        torch.testing.assert_close(s_wrapped["target_mask"], s_base["target_mask"])
