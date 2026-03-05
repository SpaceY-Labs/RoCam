#!/usr/bin/env python3
"""
Prepare rocket training data from your existing YOLO annotations.

This script:
1. Copies YOLO images/labels from the existing benchmark/model dataset
   into cv-v2/data/rockets/ with train/val splits
2. Optionally generates GrabCut pseudo-masks from bounding boxes
3. Optionally runs SAM (Segment Anything) for higher quality pseudo-masks

Usage:
    # Basic: copy existing YOLO data
    python scripts/prepare_rocket_data.py \
        --yolo-images path/to/existing/images \
        --yolo-labels path/to/existing/labels \
        --val-ratio 0.15

    # With GrabCut pseudo-masks (no extra dependencies)
    python scripts/prepare_rocket_data.py \
        --yolo-images path/to/images \
        --yolo-labels path/to/labels \
        --grabcut

    # With SAM (pip install segment-anything first)
    python scripts/prepare_rocket_data.py \
        --yolo-images path/to/images \
        --yolo-labels path/to/labels \
        --sam --sam-checkpoint sam_vit_b_01ec64.pth
"""

import argparse
import random
import shutil
from pathlib import Path
from typing import List, Tuple, Optional

import cv2
import numpy as np


# ─── Split and copy YOLO data ─────────────────────────────────────────────


def split_and_copy_yolo(
    src_images: Path,
    src_labels: Path,
    dst_root: Path,
    val_ratio: float = 0.15,
    seed: int = 42,
):
    """Copy and split YOLO images + labels into train/val."""
    random.seed(seed)

    # Find all image-label pairs
    exts = {".jpg", ".jpeg", ".png"}
    pairs: List[Tuple[Path, Path]] = []
    for img in sorted(src_images.iterdir()):
        if img.suffix.lower() not in exts:
            continue
        lbl = src_labels / f"{img.stem}.txt"
        if lbl.exists():
            pairs.append((img, lbl))

    if not pairs:
        print(f"WARNING: No image-label pairs found in {src_images}")
        return

    random.shuffle(pairs)
    n_val = max(1, int(len(pairs) * val_ratio))
    val_set = set(i for i in range(n_val))

    for split in ("train", "val"):
        (dst_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (dst_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    copied = {"train": 0, "val": 0}
    for i, (img, lbl) in enumerate(pairs):
        split = "val" if i in val_set else "train"
        shutil.copy2(img, dst_root / "images" / split / img.name)
        shutil.copy2(lbl, dst_root / "labels" / split / lbl.name)
        copied[split] += 1

    print(f"Copied {copied['train']} train + {copied['val']} val samples -> {dst_root}")


# ─── GrabCut pseudo-masks ────────────────────────────────────────────────


def grabcut_from_bbox(
    image: np.ndarray,
    bbox: Tuple[float, float, float, float],  # (x, y, w, h) pixels
) -> np.ndarray:
    """Generate a rough binary mask using GrabCut from a bounding box."""
    H, W = image.shape[:2]
    x, y, w, h = [int(round(v)) for v in bbox]
    x = max(0, min(x, W - 2))
    y = max(0, min(y, H - 2))
    w = max(2, min(w, W - x))
    h = max(2, min(h, H - y))

    # Minimum size for GrabCut
    if w < 5 or h < 5:
        mask = np.zeros((H, W), dtype=np.uint8)
        mask[y:y+h, x:x+w] = 1
        return mask

    rect = (x, y, w, h)
    bgd_model = np.zeros((1, 65), dtype=np.float64)
    fgd_model = np.zeros((1, 65), dtype=np.float64)
    gc_mask = np.zeros((H, W), dtype=np.uint8)

    try:
        cv2.grabCut(image, gc_mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
        # If GrabCut produced empty mask, fall back to bbox rectangle
        if fg_mask.sum() < 10:
            fg_mask[y:y+h, x:x+w] = 1
        return fg_mask
    except Exception:
        fg_mask = np.zeros((H, W), dtype=np.uint8)
        fg_mask[y:y+h, x:x+w] = 1
        return fg_mask


def generate_grabcut_masks(
    src_images: Path,
    src_labels: Path,
    dst_masks: Path,
    split: str = "train",
):
    """Generate GrabCut pseudo-masks for all labeled images in a split."""
    img_dir = src_images / split
    lbl_dir = src_labels / split
    mask_dir = dst_masks / split
    mask_dir.mkdir(parents=True, exist_ok=True)

    images = sorted([f for f in img_dir.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"}])
    n = len(images)
    print(f"Generating GrabCut masks for {n} {split} images...")

    for i, img_path in enumerate(images):
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            continue

        image = cv2.imread(str(img_path))
        if image is None:
            continue
        H, W = image.shape[:2]

        combined_mask = np.zeros((H, W), dtype=np.uint8)
        for line in lbl_path.read_text().strip().split("\n"):
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            cx, cy, bw, bh = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            x = (cx - bw / 2) * W
            y = (cy - bh / 2) * H
            w = bw * W
            h = bh * H
            mask = grabcut_from_bbox(image, (x, y, w, h))
            combined_mask = np.maximum(combined_mask, mask)

        # Save as PNG (0=bg, 1=fg)
        mask_path = mask_dir / f"{img_path.stem}.png"
        cv2.imwrite(str(mask_path), combined_mask * 255)

        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{n}")

    print(f"  Done. Masks saved to {mask_dir}")


# ─── SAM pseudo-masks ────────────────────────────────────────────────────


def generate_sam_masks(
    src_images: Path,
    src_labels: Path,
    dst_masks: Path,
    sam_checkpoint: str,
    split: str = "train",
):
    """Generate SAM-quality masks using bboxes as prompts."""
    try:
        from segment_anything import sam_model_registry, SamPredictor
    except ImportError:
        print("ERROR: segment-anything not installed.")
        print("  pip install git+https://github.com/facebookresearch/segment-anything.git")
        return

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading SAM on {device}...")

    # Determine model type from checkpoint name
    if "vit_h" in sam_checkpoint:
        model_type = "vit_h"
    elif "vit_l" in sam_checkpoint:
        model_type = "vit_l"
    else:
        model_type = "vit_b"

    sam = sam_model_registry[model_type](checkpoint=sam_checkpoint)
    sam.to(device)
    predictor = SamPredictor(sam)

    img_dir = src_images / split
    lbl_dir = src_labels / split
    mask_dir = dst_masks / split
    mask_dir.mkdir(parents=True, exist_ok=True)

    images = sorted([f for f in img_dir.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"}])
    n = len(images)
    print(f"Generating SAM masks for {n} {split} images...")

    for i, img_path in enumerate(images):
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            continue

        image_bgr = cv2.imread(str(img_path))
        if image_bgr is None:
            continue
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        H, W = image_bgr.shape[:2]

        predictor.set_image(image_rgb)
        combined_mask = np.zeros((H, W), dtype=np.uint8)

        for line in lbl_path.read_text().strip().split("\n"):
            parts = line.strip().split()
            if len(parts) < 5:
                continue
            cx, cy, bw, bh = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            x1 = int((cx - bw / 2) * W)
            y1 = int((cy - bh / 2) * H)
            x2 = int((cx + bw / 2) * W)
            y2 = int((cy + bh / 2) * H)

            # Use bbox as SAM prompt
            import torch as th
            masks, scores, _ = predictor.predict(
                box=np.array([x1, y1, x2, y2]),
                multimask_output=True,
            )
            # Take the highest-scored mask
            best_mask = masks[scores.argmax()]
            combined_mask = np.maximum(combined_mask, best_mask.astype(np.uint8))

        mask_path = mask_dir / f"{img_path.stem}.png"
        cv2.imwrite(str(mask_path), combined_mask * 255)

        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{n}")

    print(f"  Done. SAM masks saved to {mask_dir}")
    print(f"  Use these in Phase 3 training with --vos-root data/rockets-masks")


# ─── Main ────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--yolo-images", required=True, help="Source YOLO images directory")
    parser.add_argument("--yolo-labels", required=True, help="Source YOLO labels directory")
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--grabcut", action="store_true", help="Generate GrabCut pseudo-masks")
    parser.add_argument("--sam", action="store_true", help="Generate SAM masks (higher quality)")
    parser.add_argument("--sam-checkpoint", default="sam_vit_b_01ec64.pth")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    dst_rockets = root / "data" / "rockets"
    dst_masks = root / "data" / "rockets-masks"

    src_images = Path(args.yolo_images)
    src_labels = Path(args.yolo_labels)

    print("=== Preparing Rocket Training Data ===")

    # Step 1: Copy and split YOLO data
    print("\n[1] Splitting and copying YOLO data...")
    split_and_copy_yolo(src_images, src_labels, dst_rockets, args.val_ratio)

    # Step 2: GrabCut pseudo-masks
    if args.grabcut:
        print("\n[2] Generating GrabCut pseudo-masks (Phase 2 training)...")
        for split in ("train", "val"):
            generate_grabcut_masks(
                dst_rockets / "images",
                dst_rockets / "labels",
                dst_masks,
                split,
            )

    # Step 3: SAM masks (higher quality)
    if args.sam:
        print("\n[2] Generating SAM masks (Phase 3 training)...")
        for split in ("train", "val"):
            generate_sam_masks(
                dst_rockets / "images",
                dst_rockets / "labels",
                dst_masks,
                args.sam_checkpoint,
                split,
            )

    print("\n=== Done! ===")
    print(f"Rocket data: {dst_rockets}")
    if args.grabcut or args.sam:
        print(f"Mask data:   {dst_masks}")
    print(f"\nNext step — Phase 2 training:")
    print(f"  cd src/cv-v2")
    print(f"  python -m training.train --phase 2 \\")
    print(f"      --checkpoint checkpoints/phase1_best.pth \\")
    print(f"      --yolo-images data/rockets/images/train \\")
    print(f"      --yolo-labels data/rockets/labels/train")


if __name__ == "__main__":
    main()
