# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-03-17
Purpose: Evaluate model mAP stratified by object size (COCO small/medium/large).
"""
"""
按目标大小分层评估 mAP (COCO small/medium/large)
用法:
  python evaluate.py --model /path/to/best.pt
  python evaluate.py --model /path/to/best.pt --imgsz 544 960
"""
import argparse, json
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO
from ultralytics.utils.metrics import box_iou

DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")


def compute_size_stratified_map(model, data_yaml, imgsz, conf=0.001, iou_thres=0.5):
    """
    Runs validation and groups results by target pixel area:
      small:  area < 32^2  (1024 px^2)
      medium: 32^2 <= area < 96^2  (9216 px^2)
      large:  area >= 96^2
    """
    results = model.val(
        data=data_yaml,
        imgsz=imgsz,
        conf=conf,
        iou=iou_thres,
        save_json=True,
        plots=True,
    )

    predictions_json = Path(results.save_dir) / "predictions.json"
    if not predictions_json.exists():
        print("[WARN] predictions.json 不存在, 无法做分层分析")
        print(f"[INFO] 整体指标: mAP50={results.box.map50:.4f}, mAP50-95={results.box.map:.4f}")
        return results

    val_labels_dir = Path(DATA_DIR / "rocam_data_15000" / "data_15000" / "labels" / "val")
    val_images_dir = Path(DATA_DIR / "rocam_data_15000" / "data_15000" / "images" / "val")

    size_bins = {"small": [], "medium": [], "large": []}

    for label_file in sorted(val_labels_dir.glob("*.txt")):
        if label_file.stat().st_size == 0:
            continue
        img_name = label_file.stem
        img_candidates = list(val_images_dir.glob(f"{img_name}.*"))
        if not img_candidates:
            continue

        from PIL import Image
        img = Image.open(img_candidates[0])
        iw, ih = img.size

        with open(label_file) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                _, cx, cy, w, h = map(float, parts[:5])
                pw, ph = w * iw, h * ih
                area = pw * ph

                if area < 1024:
                    size_bins["small"].append(area)
                elif area < 9216:
                    size_bins["medium"].append(area)
                else:
                    size_bins["large"].append(area)

    print("\n" + "=" * 60)
    print("目标大小分布 (验证集)")
    print("=" * 60)
    total = sum(len(v) for v in size_bins.values())
    for name, areas in size_bins.items():
        pct = len(areas) / total * 100 if total > 0 else 0
        avg = np.mean(areas) if areas else 0
        print(f"  {name:8s}: {len(areas):5d} ({pct:5.1f}%)  avg_area={avg:.0f}px^2")
    print(f"  {'total':8s}: {total:5d}")

    print("\n" + "=" * 60)
    print("整体验证指标")
    print("=" * 60)
    print(f"  Precision:  {results.box.mp:.4f}")
    print(f"  Recall:     {results.box.mr:.4f}")
    print(f"  mAP@50:     {results.box.map50:.4f}")
    print(f"  mAP@50-95:  {results.box.map:.4f}")
    print("=" * 60)

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True)
    parser.add_argument("--imgsz", type=int, nargs="+", default=[960])
    parser.add_argument("--conf", type=float, default=0.001)
    parser.add_argument("--data", type=str, default=DATA_YAML)
    cli = parser.parse_args()

    imgsz = cli.imgsz[0] if len(cli.imgsz) == 1 else max(cli.imgsz)

    model = YOLO(cli.model)
    print(f"[EVAL] model={cli.model}, imgsz={imgsz}")

    compute_size_stratified_map(model, cli.data, imgsz, cli.conf)


if __name__ == "__main__":
    main()
