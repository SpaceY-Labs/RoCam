# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-03-19
Purpose: Offline small-target copy-paste augmentation for training data generation.

Offline small-target copy-paste augmentation script.

Since Ultralytics copy_paste requires segmentation masks (not supported for bbox-only datasets),
this script copies and pastes small target regions onto training images offline to generate
additional training samples.

Features:
  1. Scan the training set for all small targets below threshold_px
  2. Crop small target regions (with a small amount of padding)
  3. Apply random transforms to each small target (slight rotation, scaling, brightness)
  4. Paste onto random positions in other training images (avoiding overlap with existing annotations)
  5. Generate additional training images and corresponding labels

Usage:
  python augment_small_targets.py                    # default: generate 5000 images
  python augment_small_targets.py --num_images 10000 # generate 10000 images
  python augment_small_targets.py --dry_run           # only count, do not generate
"""
import argparse
import glob
import os
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

DATA_ROOT = Path("/u50/loux8/datafrompega/rocam_data_15000/data_15000")
IMGSZ = 960


def load_labels(label_path):
    boxes = []
    with open(label_path) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 5:
                cls = int(parts[0])
                cx, cy, w, h = map(float, parts[1:5])
                boxes.append((cls, cx, cy, w, h))
    return boxes


def find_small_targets(label_dir, img_dir, threshold_px=50):
    """Find all small targets and their source images."""
    targets = []
    label_files = glob.glob(os.path.join(label_dir, "*.txt"))

    for lf in label_files:
        boxes = load_labels(lf)
        if not boxes:
            continue

        stem = Path(lf).stem
        img_path = None
        for ext in (".jpg", ".jpeg", ".png", ".bmp"):
            candidate = os.path.join(img_dir, stem + ext)
            if os.path.exists(candidate):
                img_path = candidate
                break
        if img_path is None:
            continue

        for cls, cx, cy, w, h in boxes:
            w_px = w * IMGSZ
            h_px = h * IMGSZ
            max_dim = max(w_px, h_px)
            if max_dim < threshold_px and w_px > 2 and h_px > 2:
                targets.append({
                    "img_path": img_path,
                    "label_path": lf,
                    "cls": cls,
                    "cx": cx, "cy": cy, "w": w, "h": h,
                    "w_px": w_px, "h_px": h_px,
                })
    return targets


def crop_target(img, cx, cy, w, h, padding=0.3):
    """Crop the target region from the image, with padding."""
    ih, iw = img.shape[:2]
    pw = int(w * iw * (1 + padding))
    ph = int(h * ih * (1 + padding))
    x1 = max(0, int(cx * iw - pw / 2))
    y1 = max(0, int(cy * ih - ph / 2))
    x2 = min(iw, x1 + pw)
    y2 = min(ih, y1 + ph)
    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return crop


def random_transform_crop(crop):
    """Apply slight random transforms to the cropped region."""
    h, w = crop.shape[:2]
    if h < 3 or w < 3:
        return crop

    scale = random.uniform(0.8, 1.2)
    new_w = max(3, int(w * scale))
    new_h = max(3, int(h * scale))
    crop = cv2.resize(crop, (new_w, new_h))

    angle = random.uniform(-15, 15)
    M = cv2.getRotationMatrix2D((new_w / 2, new_h / 2), angle, 1.0)
    crop = cv2.warpAffine(crop, M, (new_w, new_h), borderMode=cv2.BORDER_REFLECT_101)

    brightness = random.uniform(0.85, 1.15)
    crop = np.clip(crop * brightness, 0, 255).astype(np.uint8)

    return crop


def boxes_overlap(box1, box2, threshold=0.1):
    """Check whether two YOLO-format boxes overlap beyond the threshold (IoA)."""
    cx1, cy1, w1, h1 = box1
    cx2, cy2, w2, h2 = box2

    x1_min, x1_max = cx1 - w1 / 2, cx1 + w1 / 2
    y1_min, y1_max = cy1 - h1 / 2, cy1 + h1 / 2
    x2_min, x2_max = cx2 - w2 / 2, cx2 + w2 / 2
    y2_min, y2_max = cy2 - h2 / 2, cy2 + h2 / 2

    inter_w = max(0, min(x1_max, x2_max) - max(x1_min, x2_min))
    inter_h = max(0, min(y1_max, y2_max) - max(y1_min, y2_min))
    inter_area = inter_w * inter_h

    area1 = w1 * h1
    if area1 == 0:
        return True
    return (inter_area / area1) > threshold


def paste_target_on_image(bg_img, crop, existing_boxes, max_attempts=20):
    """Paste a small target onto the background image, avoiding overlap with existing annotations."""
    bh, bw = bg_img.shape[:2]
    ch, cw = crop.shape[:2]

    if cw >= bw or ch >= bh:
        return None, None

    crop_w_norm = cw / bw
    crop_h_norm = ch / bh

    for _ in range(max_attempts):
        x = random.randint(0, bw - cw)
        y = random.randint(0, bh - ch)
        cx_norm = (x + cw / 2) / bw
        cy_norm = (y + ch / 2) / bh

        new_box = (cx_norm, cy_norm, crop_w_norm, crop_h_norm)
        overlap = False
        for _, ecx, ecy, ew, eh in existing_boxes:
            if boxes_overlap(new_box, (ecx, ecy, ew, eh)):
                overlap = True
                break

        if not overlap:
            result = bg_img.copy()
            alpha = 0.85 + random.uniform(0, 0.15)
            roi = result[y:y + ch, x:x + cw]
            blended = cv2.addWeighted(crop, alpha, roi, 1 - alpha, 0)
            result[y:y + ch, x:x + cw] = blended
            return result, (cx_norm, cy_norm, crop_w_norm, crop_h_norm)

    return None, None


def generate_augmented_images(targets, img_dir, label_dir, out_img_dir, out_label_dir,
                              num_images=5000, pastes_per_image=(1, 3)):
    """Generate augmented training images."""
    os.makedirs(out_img_dir, exist_ok=True)
    os.makedirs(out_label_dir, exist_ok=True)

    bg_images = glob.glob(os.path.join(img_dir, "*"))
    bg_images = [p for p in bg_images if p.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))]

    if not targets:
        print("[WARN] No small targets found, skipping generation")
        return 0

    generated = 0
    for i in range(num_images):
        bg_path = random.choice(bg_images)
        bg_img = cv2.imread(bg_path)
        if bg_img is None:
            continue

        stem = Path(bg_path).stem
        label_path = os.path.join(label_dir, stem + ".txt")
        existing_boxes = load_labels(label_path) if os.path.exists(label_path) else []

        new_boxes = list(existing_boxes)
        n_paste = random.randint(*pastes_per_image)
        pasted = 0

        for _ in range(n_paste):
            target = random.choice(targets)
            src_img = cv2.imread(target["img_path"])
            if src_img is None:
                continue

            crop = crop_target(src_img, target["cx"], target["cy"], target["w"], target["h"])
            if crop is None:
                continue

            crop = random_transform_crop(crop)
            bg_img_new, new_box = paste_target_on_image(bg_img, crop, new_boxes)
            if bg_img_new is not None:
                bg_img = bg_img_new
                new_boxes.append((target["cls"], *new_box))
                pasted += 1

        if pasted > 0:
            out_name = f"aug_small_{i:06d}"
            cv2.imwrite(os.path.join(out_img_dir, out_name + ".jpg"), bg_img)
            with open(os.path.join(out_label_dir, out_name + ".txt"), "w") as f:
                for cls, cx, cy, w, h in new_boxes:
                    f.write(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")
            generated += 1

        if (i + 1) % 500 == 0:
            print(f"  Progress: {i + 1}/{num_images}, generated {generated} images")

    return generated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold_px", type=int, default=50,
                        help="Small target threshold (pixels, based on imgsz=960)")
    parser.add_argument("--num_images", type=int, default=5000)
    parser.add_argument("--dry_run", action="store_true",
                        help="Only count small targets, do not generate")
    cli = parser.parse_args()

    img_dir = str(DATA_ROOT / "images" / "train")
    label_dir = str(DATA_ROOT / "labels" / "train")

    print(f"[SCAN] Finding small targets < {cli.threshold_px}px...")
    targets = find_small_targets(label_dir, img_dir, cli.threshold_px)
    print(f"[RESULT] Found {len(targets)} small targets")

    if cli.dry_run:
        sizes = [max(t["w_px"], t["h_px"]) for t in targets]
        if sizes:
            print(f"  Average max dimension: {np.mean(sizes):.1f}px")
            print(f"  < 10px: {sum(1 for s in sizes if s < 10)}")
            print(f"  10-20px: {sum(1 for s in sizes if 10 <= s < 20)}")
            print(f"  20-30px: {sum(1 for s in sizes if 20 <= s < 30)}")
            print(f"  30-50px: {sum(1 for s in sizes if 30 <= s < 50)}")
        return

    out_img_dir = str(DATA_ROOT / "images" / "train")
    out_label_dir = str(DATA_ROOT / "labels" / "train")
    print(f"[GENERATE] Will generate {cli.num_images} augmented images into the training set...")
    n = generate_augmented_images(
        targets, img_dir, label_dir,
        out_img_dir, out_label_dir,
        num_images=cli.num_images,
    )
    print(f"[DONE] Generated {n} small-target augmented images in total")


if __name__ == "__main__":
    main()
