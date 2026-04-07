# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-03-19
Purpose: Offline small-target copy-paste augmentation for training data generation.

离线小目标 Copy-Paste 增强脚本

由于 Ultralytics copy_paste 需要 segmentation mask (bbox-only 数据集不支持),
本脚本通过离线方式在训练图像中复制粘贴小目标区域, 生成额外训练样本。

功能:
  1. 扫描训练集中所有 < threshold_px 的小目标
  2. 裁剪小目标区域 (带少量 padding)
  3. 对每个小目标应用随机变换 (轻微旋转、缩放、亮度)
  4. 粘贴到其他训练图像的随机位置 (避免与现有标注重叠)
  5. 生成额外训练图像和对应标签

用法:
  python augment_small_targets.py                    # 默认生成 5000 张
  python augment_small_targets.py --num_images 10000 # 生成 10000 张
  python augment_small_targets.py --dry_run           # 仅统计, 不生成
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
    """找到所有小目标及其来源图像."""
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
    """从图像中裁剪目标区域, 带 padding."""
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
    """对裁剪区域做轻微随机变换."""
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
    """检查两个 YOLO 格式 box 是否重叠超过阈值 (IoA)."""
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
    """在背景图上粘贴小目标, 避免与现有标注重叠."""
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
    """生成增强后的训练图像."""
    os.makedirs(out_img_dir, exist_ok=True)
    os.makedirs(out_label_dir, exist_ok=True)

    bg_images = glob.glob(os.path.join(img_dir, "*"))
    bg_images = [p for p in bg_images if p.lower().endswith((".jpg", ".jpeg", ".png", ".bmp"))]

    if not targets:
        print("[WARN] 未找到小目标, 跳过生成")
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
            print(f"  进度: {i + 1}/{num_images}, 已生成 {generated} 张")

    return generated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold_px", type=int, default=50,
                        help="小目标阈值 (像素, 基于 imgsz=960)")
    parser.add_argument("--num_images", type=int, default=5000)
    parser.add_argument("--dry_run", action="store_true",
                        help="仅统计小目标, 不生成")
    cli = parser.parse_args()

    img_dir = str(DATA_ROOT / "images" / "train")
    label_dir = str(DATA_ROOT / "labels" / "train")

    print(f"[扫描] 查找 < {cli.threshold_px}px 的小目标...")
    targets = find_small_targets(label_dir, img_dir, cli.threshold_px)
    print(f"[结果] 找到 {len(targets)} 个小目标")

    if cli.dry_run:
        sizes = [max(t["w_px"], t["h_px"]) for t in targets]
        if sizes:
            print(f"  平均最大尺寸: {np.mean(sizes):.1f}px")
            print(f"  < 10px: {sum(1 for s in sizes if s < 10)}")
            print(f"  10-20px: {sum(1 for s in sizes if 10 <= s < 20)}")
            print(f"  20-30px: {sum(1 for s in sizes if 20 <= s < 30)}")
            print(f"  30-50px: {sum(1 for s in sizes if 30 <= s < 50)}")
        return

    out_img_dir = str(DATA_ROOT / "images" / "train")
    out_label_dir = str(DATA_ROOT / "labels" / "train")
    print(f"[生成] 将生成 {cli.num_images} 张增强图像到训练集...")
    n = generate_augmented_images(
        targets, img_dir, label_dir,
        out_img_dir, out_label_dir,
        num_images=cli.num_images,
    )
    print(f"[完成] 共生成 {n} 张小目标增强图像")


if __name__ == "__main__":
    main()
