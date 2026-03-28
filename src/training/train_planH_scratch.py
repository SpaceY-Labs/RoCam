#!/usr/bin/env python3
"""
Plan H: From-scratch training at imgsz=544 with train63 recipe + small-target boosts.

Replicates train63's proven augmentation recipe (mosaic=1.0, lr0=0.01, etc.)
but locks resolution to 544 for deployment alignment and adds stronger
small-target augmentations (higher erasing, scale, close_mosaic).
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

import torch
from ultralytics import YOLO

DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")

try:
    import albumentations as A
    HAS_ALB = True
except ImportError:
    HAS_ALB = False


def build_albumentations():
    """train63 original Albumentations."""
    if not HAS_ALB:
        return None
    return A.Compose([
        A.MotionBlur(blur_limit=(3, 7), p=0.15),
        A.GaussianBlur(blur_limit=(0, 7), sigma_limit=(0.5, 3.0), p=0.10),
        A.GaussNoise(std_range=(0.2, 0.44), per_channel=True, p=0.15),
        A.ImageCompression(quality_range=(99, 100), p=0.20),
        A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.20),
        A.RandomGamma(gamma_limit=(80, 120), p=0.10),
        A.CLAHE(clip_limit=(1.0, 3.0), tile_grid_size=(8, 8), p=0.10),
    ], bbox_params=A.BboxParams(format="yolo", min_visibility=0.3))


def select_gpu(preferred=3, min_free_gb=30):
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
            text=True)
        for line in out.strip().splitlines():
            idx, free = line.split(",")
            idx, free = int(idx.strip()), int(free.strip())
            if idx == preferred and free > min_free_gb * 1024:
                return str(idx)
    except Exception:
        pass
    return str(preferred)


def main():
    parser = argparse.ArgumentParser(description="Plan H: train63 recipe from scratch @544")
    parser.add_argument("--gpu", type=int, default=3)
    parser.add_argument("--epochs", type=int, default=420)
    cli = parser.parse_args()

    device = select_gpu(cli.gpu)
    print(f"[Plan H] train63 recipe from scratch @544")
    print(f"  Device: GPU {device}, Epochs: {cli.epochs}")

    alb = build_albumentations()
    model = YOLO("yolo26s.pt")

    results = model.train(
        data=DATA_YAML,
        imgsz=544,
        epochs=cli.epochs,
        batch=64,
        nbs=64,

        optimizer="auto",
        lr0=0.01,
        lrf=0.01,
        cos_lr=False,
        warmup_epochs=3,
        momentum=0.937,
        weight_decay=0.0005,

        mosaic=1.0,
        mixup=0.1,
        cutmix=0.1,
        copy_paste=0.0,
        erasing=0.5,
        scale=0.4,
        degrees=180,
        shear=5.0,
        perspective=0.0002,
        translate=0.05,
        flipud=0.5,
        fliplr=0.5,
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        close_mosaic=100,

        multi_scale=False,
        rect=False,

        patience=30,
        amp=True,
        cache="disk",
        device=device,
        workers=8,
        seed=0,
        deterministic=False,
        save_period=25,

        augmentations=alb,

        project=str(DATA_DIR / "runs" / "detect"),
        name="planH_scratch",
        exist_ok=True,
    )

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None and hasattr(model, "trainer"):
        save_dir = model.trainer.save_dir
    print(f"[DONE] Plan H complete: {save_dir}")


if __name__ == "__main__":
    sys.exit(main() or 0)
