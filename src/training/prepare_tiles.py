#!/usr/bin/env python3
"""
Prepare tiled dataset for Plan I.

Slices images into overlapping tiles and remaps YOLO labels.
Produces a mixed dataset: original images + tile crops.
"""

import argparse
import math
import shutil
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import yaml


def slice_image_and_labels(
    img_path: Path,
    label_path: Path,
    out_img_dir: Path,
    out_lbl_dir: Path,
    tile_h: int = 544,
    tile_w: int = 544,
    overlap: float = 0.2,
    min_visibility: float = 0.3,
    prefix: str = "",
) -> int:
    """Slice one image into tiles and remap labels. Returns number of tiles with objects."""
    img = cv2.imread(str(img_path))
    if img is None:
        return 0
    ih, iw = img.shape[:2]

    bboxes = []
    if label_path.exists():
        for line in label_path.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) >= 5:
                cls = int(float(parts[0]))
                cx, cy, bw, bh = map(float, parts[1:5])
                bboxes.append((cls, cx, cy, bw, bh))

    step_h = int(tile_h * (1 - overlap))
    step_w = int(tile_w * (1 - overlap))

    tiles_with_objects = 0
    tile_idx = 0

    y = 0
    while y < ih:
        x = 0
        y_end = min(y + tile_h, ih)
        if y_end - y < tile_h and y > 0:
            y = max(0, ih - tile_h)
            y_end = ih

        while x < iw:
            x_end = min(x + tile_w, iw)
            if x_end - x < tile_w and x > 0:
                x = max(0, iw - tile_w)
                x_end = iw

            crop = img[y:y_end, x:x_end]
            crop_h, crop_w = crop.shape[:2]

            tile_bboxes = []
            for cls, cx, cy, bw, bh in bboxes:
                abs_cx = cx * iw
                abs_cy = cy * ih
                abs_w = bw * iw
                abs_h = bh * ih

                rel_cx = (abs_cx - x) / crop_w
                rel_cy = (abs_cy - y) / crop_h
                rel_w = abs_w / crop_w
                rel_h = abs_h / crop_h

                x1 = max(0.0, rel_cx - rel_w / 2)
                y1 = max(0.0, rel_cy - rel_h / 2)
                x2 = min(1.0, rel_cx + rel_w / 2)
                y2 = min(1.0, rel_cy + rel_h / 2)

                clipped_w = x2 - x1
                clipped_h = y2 - y1
                if clipped_w <= 0 or clipped_h <= 0:
                    continue
                orig_area = rel_w * rel_h
                clipped_area = clipped_w * clipped_h
                if orig_area > 0 and clipped_area / orig_area < min_visibility:
                    continue

                new_cx = (x1 + x2) / 2
                new_cy = (y1 + y2) / 2
                tile_bboxes.append((cls, new_cx, new_cy, clipped_w, clipped_h))

            if tile_bboxes:
                stem = f"{prefix}{img_path.stem}_tile{tile_idx}"
                out_img = out_img_dir / f"{stem}.jpg"
                out_lbl = out_lbl_dir / f"{stem}.txt"

                if crop_h != tile_h or crop_w != tile_w:
                    crop = cv2.resize(crop, (tile_w, tile_h))

                cv2.imwrite(str(out_img), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
                with open(out_lbl, 'w') as f:
                    for cls, cx, cy, bw, bh in tile_bboxes:
                        f.write(f"{cls} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")
                tiles_with_objects += 1

            tile_idx += 1
            if x_end >= iw:
                break
            x += step_w

        if y_end >= ih:
            break
        y += step_h

    return tiles_with_objects


def main():
    parser = argparse.ArgumentParser(description="Prepare tiled dataset")
    parser.add_argument("--data-yaml", default="/u50/loux8/datafrompega/rocam_data_15000/data_15000/data.yaml")
    parser.add_argument("--output", default="/u50/loux8/datafrompega/rocam_data_15000/data_tiled")
    parser.add_argument("--tile-h", type=int, default=544)
    parser.add_argument("--tile-w", type=int, default=544)
    parser.add_argument("--overlap", type=float, default=0.2)
    parser.add_argument("--split", default="train")
    cli = parser.parse_args()

    with open(cli.data_yaml) as f:
        data = yaml.safe_load(f)

    root = Path(cli.data_yaml).parent
    img_dir = root / data.get(cli.split, f"images/{cli.split}")
    if not img_dir.exists():
        img_dir = root / "images" / cli.split
    lbl_dir = root / "labels" / cli.split

    out_base = Path(cli.output)
    out_img_dir = out_base / "images" / cli.split
    out_lbl_dir = out_base / "labels" / cli.split
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_lbl_dir.mkdir(parents=True, exist_ok=True)

    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    images = sorted([p for p in img_dir.iterdir() if p.suffix.lower() in exts])

    total_tiles = 0
    for i, img_path in enumerate(images):
        label_path = lbl_dir / f"{img_path.stem}.txt"
        n = slice_image_and_labels(
            img_path, label_path, out_img_dir, out_lbl_dir,
            tile_h=cli.tile_h, tile_w=cli.tile_w, overlap=cli.overlap,
            prefix="t_",
        )
        total_tiles += n
        if (i + 1) % 1000 == 0:
            print(f"  Processed {i+1}/{len(images)}, tiles with objects: {total_tiles}")

    print(f"\n[DONE] Tiled dataset: {total_tiles} tiles -> {out_base}")
    print(f"  Images: {out_img_dir}")
    print(f"  Labels: {out_lbl_dir}")

    # Also copy original images + labels into the same output for mixed training
    mixed_img_dir = out_base / "images" / f"{cli.split}_mixed"
    mixed_lbl_dir = out_base / "labels" / f"{cli.split}_mixed"
    mixed_img_dir.mkdir(parents=True, exist_ok=True)
    mixed_lbl_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nCreating mixed dataset (original + tiles)...")
    count = 0
    for img_path in images:
        dst = mixed_img_dir / img_path.name
        if not dst.exists():
            os.symlink(str(img_path), str(dst))
        lbl = lbl_dir / f"{img_path.stem}.txt"
        lbl_dst = mixed_lbl_dir / lbl.name
        if lbl.exists() and not lbl_dst.exists():
            os.symlink(str(lbl), str(lbl_dst))
        count += 1

    for tile_img in out_img_dir.glob("t_*"):
        dst = mixed_img_dir / tile_img.name
        if not dst.exists():
            os.symlink(str(tile_img), str(dst))
        tile_lbl = out_lbl_dir / f"{tile_img.stem}.txt"
        lbl_dst = mixed_lbl_dir / tile_lbl.name
        if tile_lbl.exists() and not lbl_dst.exists():
            os.symlink(str(tile_lbl), str(lbl_dst))

    # Copy val as-is
    val_img_src = root / "images" / "val"
    val_lbl_src = root / "labels" / "val"
    val_img_dst = out_base / "images" / "val"
    val_lbl_dst = out_base / "labels" / "val"
    if not val_img_dst.exists():
        os.symlink(str(val_img_src), str(val_img_dst))
    if not val_lbl_dst.exists():
        os.symlink(str(val_lbl_src), str(val_lbl_dst))

    # Write new data.yaml
    new_yaml = {
        "path": str(out_base),
        "train": f"images/{cli.split}_mixed",
        "val": "images/val",
        "nc": data.get("nc", 1),
        "names": data.get("names", ["rocket"]),
    }
    yaml_path = out_base / "data.yaml"
    with open(yaml_path, 'w') as f:
        yaml.dump(new_yaml, f, default_flow_style=False)
    print(f"  Mixed dataset yaml: {yaml_path}")
    print(f"  Original: {count}, Tiles: {total_tiles}, Total: {count + total_tiles}")


if __name__ == "__main__":
    main()
