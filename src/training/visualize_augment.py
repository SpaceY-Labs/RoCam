# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-03-17
Purpose: Visualize and compare augmentation effects on small targets at different mosaic levels.

Level 0 验证: 增强可视化 (0 GPU 时间)
对比 mosaic=0.8 vs mosaic=0.4 下小目标是否可见
用法:
  python visualize_augment.py
  python visualize_augment.py --n 20 --outdir /tmp/aug_vis
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics.data.dataset import YOLODataset
from ultralytics.data.augment import v8_transforms, Compose, LetterBox, Format
from ultralytics.utils import IterableSimpleNamespace


DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")
TRAIN_PATH = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "images" / "train")
IMGSZ = 960


def draw_labels(img, labels, color=(0, 255, 0), thickness=2):
    h, w = img.shape[:2]
    for label in labels:
        if len(label) < 5:
            continue
        cls, cx, cy, bw, bh = label[:5]
        x1 = int((cx - bw / 2) * w)
        y1 = int((cy - bh / 2) * h)
        x2 = int((cx + bw / 2) * w)
        y2 = int((cy + bh / 2) * h)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
        pw = int(bw * w)
        cv2.putText(img, f"{pw}px", (x1, max(y1 - 5, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    return img


def build_dataset(mosaic_p, rect=False):
    hyp = IterableSimpleNamespace(
        mosaic=mosaic_p, copy_paste=0.0, copy_paste_mode="flip",
        mixup=0.05 if mosaic_p > 0 else 0.0, cutmix=0.0,
        degrees=180, translate=0.05, scale=0.08, shear=3.0,
        perspective=0.0001, flipud=0.5, fliplr=0.5,
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.35,
        erasing=0.0, bgr=0.0, mask_ratio=4, overlap_mask=True,
        augmentations=None,
    )

    ds = YOLODataset(
        img_path=TRAIN_PATH,
        imgsz=IMGSZ,
        augment=True,
        hyp=hyp,
        rect=rect,
        batch_size=16,
        data={"nc": 1, "names": {0: "rocket"}},
    )
    return ds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=10, help="每种 mosaic 可视化几张")
    parser.add_argument("--outdir", type=str, default=str(DATA_DIR / "aug_visualize"))
    cli = parser.parse_args()

    outdir = Path(cli.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    small_target_indices = []
    ds_scan = build_dataset(0.0, rect=False)
    for idx in range(min(len(ds_scan), 2000)):
        label_data = ds_scan.get_image_and_label(idx)
        bboxes = label_data.get("bboxes", np.empty((0, 4)))
        if len(bboxes) == 0:
            continue
        widths = bboxes[:, 2] * label_data["ori_shape"][1]
        if np.any(widths < 40):
            small_target_indices.append(idx)
        if len(small_target_indices) >= cli.n * 3:
            break

    if not small_target_indices:
        print("[WARN] 未找到小目标样本, 使用前 N 张")
        small_target_indices = list(range(min(cli.n, len(ds_scan))))

    indices = small_target_indices[:cli.n]

    for mosaic_p, tag in [(0.8, "mosaic08"), (0.4, "mosaic04"), (0.0, "no_mosaic")]:
        ds = build_dataset(mosaic_p)
        print(f"\n[VIS] 生成 {tag} 样本...")
        for j, idx in enumerate(indices):
            try:
                sample = ds[idx % len(ds)]
            except Exception:
                continue
            img = sample["img"]
            if isinstance(img, torch.Tensor):
                img = img.permute(1, 2, 0).numpy()
            if img.dtype != np.uint8:
                img = (img * 255).clip(0, 255).astype(np.uint8)
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            cls = sample.get("cls", np.empty((0, 1)))
            bboxes = sample.get("bboxes", np.empty((0, 4)))
            if len(cls) > 0 and len(bboxes) > 0:
                labels = np.hstack([cls, bboxes])
                img = draw_labels(img, labels, color=(0, 255, 0))

            out_path = outdir / f"{tag}_{j:03d}.jpg"
            cv2.imwrite(str(out_path), img)

        print(f"[VIS] {tag}: {len(indices)} 张已保存到 {outdir}")

    print(f"\n[DONE] 可视化完成, 查看 {outdir}/ 对比小目标在不同 mosaic 下的可见性")


if __name__ == "__main__":
    main()
