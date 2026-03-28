#!/usr/bin/env python3
"""
Custom BBox-only Copy-Paste augmentation for small object detection.

Unlike Ultralytics' built-in copy_paste (which requires segmentation masks),
this crops small target bbox regions and pastes them onto other images.
"""

import os
import random
from pathlib import Path
from typing import List, Tuple, Optional

import cv2
import numpy as np

try:
    import albumentations as A
    from albumentations.core.transforms_interface import ImageOnlyTransform, DualTransform
except ImportError:
    A = None


class SmallObjectCopyPaste:
    """
    Bbox-only copy-paste augmentation for small objects.

    Pre-extracts small object crops from the training set,
    then pastes 1-3 of them onto each training image.
    """

    def __init__(
        self,
        crop_dir: str,
        max_paste: int = 3,
        p: float = 0.5,
        blend_sigma: float = 1.0,
        min_crop_size: int = 4,
    ):
        self.p = p
        self.max_paste = max_paste
        self.blend_sigma = blend_sigma
        self.min_crop_size = min_crop_size
        self.crops = []

        crop_path = Path(crop_dir)
        if crop_path.exists():
            for f in sorted(crop_path.glob("*.png")):
                img = cv2.imread(str(f), cv2.IMREAD_UNCHANGED)
                if img is not None and img.shape[0] >= min_crop_size and img.shape[1] >= min_crop_size:
                    self.crops.append(img)
        print(f"[SmallObjectCopyPaste] Loaded {len(self.crops)} crops from {crop_dir}")

    def __call__(self, image: np.ndarray, bboxes: List[Tuple]) -> Tuple[np.ndarray, List[Tuple]]:
        if random.random() > self.p or not self.crops:
            return image, bboxes

        img = image.copy()
        ih, iw = img.shape[:2]
        new_bboxes = list(bboxes)
        n_paste = random.randint(1, self.max_paste)

        for _ in range(n_paste):
            crop = random.choice(self.crops)
            ch, cw = crop.shape[:2]

            scale = random.uniform(0.7, 1.3)
            ch_s = max(self.min_crop_size, int(ch * scale))
            cw_s = max(self.min_crop_size, int(cw * scale))
            if ch_s >= ih or cw_s >= iw:
                continue

            crop_resized = cv2.resize(crop, (cw_s, ch_s))

            max_attempts = 10
            for _ in range(max_attempts):
                px = random.randint(0, iw - cw_s)
                py = random.randint(0, ih - ch_s)

                paste_cx = (px + cw_s / 2) / iw
                paste_cy = (py + ch_s / 2) / ih
                paste_w = cw_s / iw
                paste_h = ch_s / ih

                overlap = False
                for bbox in new_bboxes:
                    bcx, bcy, bw, bh = bbox[1], bbox[2], bbox[3], bbox[4]
                    dx = abs(paste_cx - bcx)
                    dy = abs(paste_cy - bcy)
                    if dx < (paste_w + bw) / 2 and dy < (paste_h + bh) / 2:
                        overlap = True
                        break

                if not overlap:
                    if crop_resized.shape[2] == 4:
                        alpha = crop_resized[:, :, 3:4] / 255.0
                        rgb = crop_resized[:, :, :3]
                        region = img[py:py+ch_s, px:px+cw_s]
                        img[py:py+ch_s, px:px+cw_s] = (
                            rgb * alpha + region * (1 - alpha)
                        ).astype(np.uint8)
                    else:
                        if self.blend_sigma > 0:
                            mask = np.ones((ch_s, cw_s), dtype=np.float32)
                            border = max(2, min(ch_s, cw_s) // 4)
                            mask[:border, :] *= np.linspace(0, 1, border)[:, None]
                            mask[-border:, :] *= np.linspace(1, 0, border)[:, None]
                            mask[:, :border] *= np.linspace(0, 1, border)[None, :]
                            mask[:, -border:] *= np.linspace(1, 0, border)[None, :]
                            mask = mask[:, :, None]
                            region = img[py:py+ch_s, px:px+cw_s]
                            img[py:py+ch_s, px:px+cw_s] = (
                                crop_resized * mask + region * (1 - mask)
                            ).astype(np.uint8)
                        else:
                            img[py:py+ch_s, px:px+cw_s] = crop_resized

                    new_bboxes.append((0, paste_cx, paste_cy, paste_w, paste_h))
                    break

        return img, new_bboxes


def extract_small_crops(
    img_dir: Path,
    lbl_dir: Path,
    out_dir: Path,
    max_sqrt_area: float = 32.0,
    padding: int = 4,
    target_w: int = 960,
    target_h: int = 544,
):
    """Extract small object crops from training images."""
    out_dir.mkdir(parents=True, exist_ok=True)
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    images = sorted([p for p in img_dir.iterdir() if p.suffix.lower() in exts])

    crop_id = 0
    for i, img_path in enumerate(images):
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            continue

        img = None
        for line in lbl_path.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            cls = int(float(parts[0]))
            cx, cy, bw, bh = map(float, parts[1:5])

            pw = bw * target_w
            ph = bh * target_h
            sqrt_area = (pw * ph) ** 0.5
            if sqrt_area >= max_sqrt_area or sqrt_area < 3:
                continue

            if img is None:
                img = cv2.imread(str(img_path))
                if img is None:
                    break
                ih, iw = img.shape[:2]

            x1 = max(0, int((cx - bw / 2) * iw) - padding)
            y1 = max(0, int((cy - bh / 2) * ih) - padding)
            x2 = min(iw, int((cx + bw / 2) * iw) + padding)
            y2 = min(ih, int((cy + bh / 2) * ih) + padding)

            if x2 - x1 < 4 or y2 - y1 < 4:
                continue

            crop = img[y1:y2, x1:x2]
            cv2.imwrite(str(out_dir / f"crop_{crop_id:06d}.png"), crop)
            crop_id += 1

        if (i + 1) % 2000 == 0:
            print(f"  Processed {i+1}/{len(images)}, crops: {crop_id}")

    print(f"[DONE] Extracted {crop_id} small object crops -> {out_dir}")
    return crop_id


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-yaml", default="/u50/loux8/datafrompega/rocam_data_15000/data_15000/data.yaml")
    parser.add_argument("--output", default="/u50/loux8/datafrompega/small_crops")
    parser.add_argument("--max-sqrt-area", type=float, default=32.0)
    cli = parser.parse_args()

    import yaml
    with open(cli.data_yaml) as f:
        data = yaml.safe_load(f)
    root = Path(cli.data_yaml).parent
    img_dir = root / "images" / "train"
    lbl_dir = root / "labels" / "train"

    extract_small_crops(img_dir, lbl_dir, Path(cli.output), cli.max_sqrt_area)
