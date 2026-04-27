"""Pytest fixtures for cv-v2 tests.

Synthetic DAVIS-style data lives under a temporary directory. Tests can request
the `tiny_vos_root` fixture to get a path containing 2 fake videos, each with
3 annotated frames featuring 1 object id (a random rectangle).
"""
from __future__ import annotations
from pathlib import Path
import shutil
import numpy as np
from PIL import Image
import pytest


@pytest.fixture
def tiny_vos_root(tmp_path: Path) -> Path:
    """Create a tiny DAVIS-format directory tree.

    Layout:
      <root>/JPEGImages/480p/<video>/00000.jpg ...
      <root>/Annotations/480p/<video>/00000.png  (palette PNG, value 1 for object)
    """
    root = tmp_path / "tiny_vos"
    rng = np.random.default_rng(seed=0)

    for vid_idx, vid in enumerate(["videoA", "videoB"]):
        img_dir = root / "JPEGImages" / "480p" / vid
        ann_dir = root / "Annotations" / "480p" / vid
        img_dir.mkdir(parents=True)
        ann_dir.mkdir(parents=True)

        for frame in range(3):
            img = rng.integers(0, 255, size=(120, 160, 3), dtype=np.uint8)
            Image.fromarray(img).save(img_dir / f"{frame:05d}.jpg")

            mask = np.zeros((120, 160), dtype=np.uint8)
            # rectangle that drifts a bit per frame so temporal pairs differ
            x0 = 30 + 5 * frame + 10 * vid_idx
            y0 = 20 + 3 * frame
            mask[y0:y0 + 50, x0:x0 + 60] = 1
            Image.fromarray(mask, mode="P").save(ann_dir / f"{frame:05d}.png")

    return root


@pytest.fixture
def dummy_pair():
    """Return a dict matching the MaskTrackNet input schema, batch=2, 256x256."""
    import torch
    return {
        "reference_image": torch.rand(2, 3, 256, 256),
        "reference_mask": (torch.rand(2, 1, 256, 256) > 0.5).float(),
        "target_image": torch.rand(2, 3, 256, 256),
        "target_mask": (torch.rand(2, 1, 256, 256) > 0.5).float(),
    }
