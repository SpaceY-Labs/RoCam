"""cv-v2 dataset module.

Produces (reference_image, reference_mask, target_image, target_mask) pairs
for training MaskTrackNet, sampled from DAVIS- or YouTube-VOS-style trees:

    <root>/<split>/<video>/<frame>.jpg
    <root>/<ann_split>/<video>/<frame>.png   palette PNG, value = object_id

This module replaces the SiamMask-style dataset that previously lived here.
The old schema (template_127, search_255, gt_mask, gt_bbox, gt_present) does
not match MaskTrackNet's I/O.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import numpy as np
import cv2
import torch
from torch.utils.data import Dataset, ConcatDataset, WeightedRandomSampler
from PIL import Image

from data.augmentations import (
    crop_with_context,
    random_color_jitter,
    horizontal_flip_pair,
    random_rotation_pair,
    bbox_from_mask,
)


@dataclass
class _ObjectIndex:
    video: str
    object_id: int
    frames: list[str]  # sorted frame stems, e.g. ["00000", "00005", ...]


class VOSPairDataset(Dataset):
    """Pairwise sampler from a DAVIS/YT-VOS-style mask-annotated tree.

    Each __getitem__ call samples:
      1. uniformly random object (across all videos)
      2. two annotated frames at random temporal gap in [1, max_gap]
      3. context-padded crops on each frame, resized to out_size

    Returns dict with float tensors:
      reference_image, target_image: (3, H, W) in [0, 1]
      reference_mask,  target_mask : (1, H, W) binary {0, 1}

    Args:
        root: dataset root containing JPEGImages/Annotations subtrees.
        split: subpath under `root` for images, e.g. "JPEGImages/480p".
        ann_split: subpath under `root` for annotations.
        out_size: square H=W output, must be multiple of 32.
        max_gap: max temporal frame gap in pair sampling.
        context_factor: crop side = context_factor * max(bbox_w, bbox_h).
        scale_jitter, translate_jitter: passed to crop_with_context.
        flip_prob: prob of horizontal flip per crop.
        color_jitter: bool, enable photometric jitter.
        max_rotation_deg: max +/- rotation in degrees per crop. Reference and
            target rotate independently so the model learns rotation-invariant
            matching rather than a temporally-correlated rotation prior.
        seed: base seed; per-call deterministic given the index.
        length: virtual epoch length; __len__ returns this.
    """

    def __init__(
        self,
        root: Path | str,
        split: str = "JPEGImages/480p",
        ann_split: str = "Annotations/480p",
        out_size: int = 384,
        max_gap: int = 30,
        context_factor: float = 2.5,
        scale_jitter: float = 0.2,
        translate_jitter: float = 0.15,
        flip_prob: float = 0.5,
        color_jitter: bool = True,
        max_rotation_deg: float = 15.0,
        seed: int = 0,
        length: int = 10000,
    ):
        if out_size <= 0 or out_size % 32 != 0:
            raise ValueError(f"out_size {out_size} must be multiple of 32")

        self.root = Path(root)
        self.split = split
        self.ann_split = ann_split
        self.out_size = out_size
        self.max_gap = max_gap
        self.context_factor = context_factor
        self.scale_jitter = scale_jitter
        self.translate_jitter = translate_jitter
        self.flip_prob = flip_prob
        self.color_jitter = color_jitter
        self.max_rotation_deg = max_rotation_deg
        self.seed = seed
        self.length = length

        self.objects: list[_ObjectIndex] = self._build_index()
        if not self.objects:
            raise RuntimeError(f"No usable objects found under {self.root}")

    def set_out_size(self, out_size: int) -> None:
        """Change the output resolution at runtime (used by multi-scale sampler)."""
        if out_size <= 0 or out_size % 32 != 0:
            raise ValueError(f"out_size {out_size} must be multiple of 32")
        self.out_size = out_size

    def _build_index(self) -> list[_ObjectIndex]:
        """Walk Annotations/<video>/*.png and collect objects with >=2 frames."""
        ann_root = self.root / self.ann_split
        if not ann_root.exists():
            raise RuntimeError(f"Annotation dir not found: {ann_root}")

        index: list[_ObjectIndex] = []
        for vid_dir in sorted(p for p in ann_root.iterdir() if p.is_dir()):
            obj_to_frames: dict[int, list[str]] = {}
            for png in sorted(vid_dir.glob("*.png")):
                stem = png.stem
                arr = np.array(Image.open(png))
                # Multi-object palette PNG: each unique nonzero value is an obj id
                for obj_id in np.unique(arr):
                    if obj_id == 0:
                        continue
                    obj_to_frames.setdefault(int(obj_id), []).append(stem)
            for obj_id, frames in obj_to_frames.items():
                if len(frames) >= 2:
                    index.append(_ObjectIndex(
                        video=vid_dir.name, object_id=obj_id, frames=sorted(frames)
                    ))
        return index

    def __len__(self) -> int:
        return self.length

    def _read_pair(
        self, obj: _ObjectIndex, t_ref: str, t_tgt: str, rng: np.random.Generator
    ) -> dict[str, torch.Tensor]:
        img_root = self.root / self.split / obj.video
        ann_root = self.root / self.ann_split / obj.video

        ref_img = cv2.cvtColor(cv2.imread(str(img_root / f"{t_ref}.jpg")), cv2.COLOR_BGR2RGB)
        tgt_img = cv2.cvtColor(cv2.imread(str(img_root / f"{t_tgt}.jpg")), cv2.COLOR_BGR2RGB)
        ref_ann = np.array(Image.open(ann_root / f"{t_ref}.png"))
        tgt_ann = np.array(Image.open(ann_root / f"{t_tgt}.png"))

        ref_mask = (ref_ann == obj.object_id).astype(np.uint8)
        tgt_mask = (tgt_ann == obj.object_id).astype(np.uint8)

        # Crop+resize each frame independently
        ref_img_c, ref_mask_c = crop_with_context(
            ref_img, ref_mask, self.context_factor, self.out_size,
            self.scale_jitter, self.translate_jitter, rng,
        )
        tgt_img_c, tgt_mask_c = crop_with_context(
            tgt_img, tgt_mask, self.context_factor, self.out_size,
            self.scale_jitter, self.translate_jitter, rng,
        )

        if self.color_jitter:
            ref_img_c = random_color_jitter(ref_img_c, rng=rng)
            tgt_img_c = random_color_jitter(tgt_img_c, rng=rng)

        if self.max_rotation_deg > 0.0:
            ref_img_c, ref_mask_c = random_rotation_pair(
                ref_img_c, ref_mask_c, self.max_rotation_deg, rng,
            )
            tgt_img_c, tgt_mask_c = random_rotation_pair(
                tgt_img_c, tgt_mask_c, self.max_rotation_deg, rng,
            )

        if rng.random() < self.flip_prob:
            ref_img_c, ref_mask_c = horizontal_flip_pair(ref_img_c, ref_mask_c)
        if rng.random() < self.flip_prob:
            tgt_img_c, tgt_mask_c = horizontal_flip_pair(tgt_img_c, tgt_mask_c)

        return {
            "reference_image": _to_chw_float01(ref_img_c),
            "reference_mask":  _to_chw_mask(ref_mask_c),
            "target_image":    _to_chw_float01(tgt_img_c),
            "target_mask":     _to_chw_mask(tgt_mask_c),
        }

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        rng = np.random.default_rng(self.seed * 100003 + idx)
        obj = self.objects[rng.integers(0, len(self.objects))]

        # Pick (t_ref, t_tgt) with gap in [1, max_gap]
        n = len(obj.frames)
        i_ref = int(rng.integers(0, n))
        gap = int(rng.integers(1, max(2, min(self.max_gap, n - 1) + 1)))
        i_tgt = (i_ref + gap) if (i_ref + gap < n) else max(0, i_ref - gap)
        if i_ref == i_tgt:
            i_tgt = (i_ref + 1) % n
        t_ref, t_tgt = obj.frames[i_ref], obj.frames[i_tgt]

        return self._read_pair(obj, t_ref, t_tgt, rng)


class NegativePairWrapper(Dataset):
    """With probability `neg_ratio`, swap the reference for a different object.

    The target_mask is then forced to zero (the reference does not appear in
    the target). This teaches the model to predict empty masks for absent
    references.
    """

    def __init__(self, base: VOSPairDataset, neg_ratio: float, seed: int = 0):
        if not 0.0 <= neg_ratio <= 1.0:
            raise ValueError(f"neg_ratio must be in [0,1], got {neg_ratio}")
        self.base = base
        self.neg_ratio = neg_ratio
        self.seed = seed

    def __len__(self) -> int:
        return len(self.base)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        sample = self.base[idx]
        rng = np.random.default_rng(self.seed * 7919 + idx)
        if rng.random() >= self.neg_ratio:
            return sample

        # Replace reference with a different object. Pick another video to
        # avoid picking the same object's frame.
        wrong_obj_idx = int(rng.integers(0, len(self.base.objects)))
        if self.base.objects[wrong_obj_idx].video == \
                self.base.objects[rng.integers(0, len(self.base.objects))].video:
            # one re-roll attempt; collisions are fine, this is augmentation noise
            wrong_obj_idx = (wrong_obj_idx + 1) % len(self.base.objects)
        wrong_obj = self.base.objects[wrong_obj_idx]
        # Sample a frame for the wrong object
        t = wrong_obj.frames[int(rng.integers(0, len(wrong_obj.frames)))]
        wrong_pair = self.base._read_pair(wrong_obj, t, t, rng)

        # Use the *target* of the original (original target_image stays the same;
        # just swap reference + zero the gt mask).
        return {
            "reference_image": wrong_pair["reference_image"],
            "reference_mask":  wrong_pair["reference_mask"],
            "target_image":    sample["target_image"],
            "target_mask":     torch.zeros_like(sample["target_mask"]),
        }


def _to_chw_float01(img: np.ndarray) -> torch.Tensor:
    """HWC uint8 RGB -> CHW float32 [0,1]."""
    return torch.from_numpy(img.transpose(2, 0, 1)).float().div_(255.0)


def _to_chw_mask(mask: np.ndarray) -> torch.Tensor:
    """HW uint8 -> 1HW float32 binary."""
    return torch.from_numpy(mask).unsqueeze(0).float().clamp_(0.0, 1.0)


def build_dataloaders(
    *,
    yt_vos_root: Optional[Path],
    davis_root: Path,
    out_size: int,
    batch_size: int,
    num_workers: int,
    yt_vos_weight: float = 5.0,
    davis_weight: float = 1.0,
    neg_ratio: float = 0.1,
    seed: int = 0,
    length_per_epoch: int = 10000,
    **dataset_kwargs,
) -> torch.utils.data.DataLoader:
    """Build a weighted ConcatDataset -> DataLoader for Stage 1 training.

    YT-VOS samples are weighted yt_vos_weight: davis_weight (default 5:1) per
    spec sec 5.3. Returns a single DataLoader; multi-scale resizing is handled by
    `set_out_size()` calls from the train loop, not here.
    """
    davis = NegativePairWrapper(
        VOSPairDataset(
            root=davis_root, out_size=out_size,
            max_gap=15, seed=seed, length=length_per_epoch,
            **dataset_kwargs,
        ),
        neg_ratio=neg_ratio, seed=seed + 1,
    )

    if yt_vos_root is not None and yt_vos_root.exists():
        yt = NegativePairWrapper(
            VOSPairDataset(
                root=yt_vos_root,
                split="train/JPEGImages",
                ann_split="train/Annotations",
                out_size=out_size, max_gap=30,
                seed=seed + 100, length=length_per_epoch,
                **dataset_kwargs,
            ),
            neg_ratio=neg_ratio, seed=seed + 101,
        )
        concat = ConcatDataset([yt, davis])
        weights = (
            [yt_vos_weight] * len(yt) + [davis_weight] * len(davis)
        )
        sampler = WeightedRandomSampler(
            weights, num_samples=length_per_epoch, replacement=True,
        )
    else:
        concat = davis
        sampler = None

    return torch.utils.data.DataLoader(
        concat, batch_size=batch_size,
        sampler=sampler,
        shuffle=(sampler is None),
        num_workers=num_workers,
        pin_memory=True, drop_last=True, persistent_workers=(num_workers > 0),
    )
