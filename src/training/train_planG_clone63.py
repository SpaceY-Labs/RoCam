#!/usr/bin/env python3
"""
Plan G: Clone train63 (smallrocket) recipe exactly, but fine-tune from smallrocket.pt.

Key insight: smallrocket was trained with mosaic=1.0, multi_scale=True, lr0=0.01,
erasing=0.4, 420 epochs — aggressive augmentation that works for small targets.
All our previous plans used overly conservative settings (low mosaic, low lr).

This plan replicates train63's exact augmentation recipe while fine-tuning
from smallrocket.pt at imgsz=544 to match deployment resolution.
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
SMALLROCKET = str(DATA_DIR / "models" / "smallrocket.pt")

try:
    import albumentations as A
    HAS_ALB = True
except ImportError:
    HAS_ALB = False


def build_albumentations_train63():
    """Exact Albumentations from train63/args.yaml."""
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


def select_gpu(preferred=0, min_free_gb=15):
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
            text=True
        )
        for line in out.strip().splitlines():
            idx, free = line.split(",")
            idx, free = int(idx.strip()), int(free.strip())
            if idx == preferred and free > min_free_gb * 1024:
                return str(idx)
        for line in out.strip().splitlines():
            idx, free = line.split(",")
            idx, free = int(idx.strip()), int(free.strip())
            if free > min_free_gb * 1024:
                return str(idx)
    except Exception:
        pass
    return str(preferred)


def main():
    parser = argparse.ArgumentParser(description="Plan G: Clone train63 recipe, fine-tune smallrocket@544")
    parser.add_argument("--model", type=str, default=SMALLROCKET)
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--gpu", type=int, default=2)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="planG_clone63")
    cli = parser.parse_args()

    device = select_gpu(cli.gpu)
    print(f"[Plan G] Clone train63 recipe, fine-tune smallrocket@544")
    print(f"  Model: {cli.model}")
    print(f"  Device: GPU {device}")
    print(f"  Epochs: {cli.epochs}")

    alb = build_albumentations_train63()
    if alb:
        print(f"  Albumentations: {len(alb.transforms)} transforms")
        for t in alb.transforms:
            print(f"    {t.__class__.__name__}(p={t.p})")

    model = YOLO(cli.model)

    results = model.train(
        data=DATA_YAML,
        imgsz=544,
        epochs=cli.epochs,
        batch=cli.batch,
        nbs=64,             # train63 used nbs=64, NOT 128
        device=device,

        # Optimizer: match train63 exactly
        optimizer="SGD",
        lr0=0.005,          # Half of train63's 0.01 since we're fine-tuning
        lrf=0.01,           # Same as train63
        cos_lr=False,       # train63 did NOT use cosine LR
        warmup_epochs=3,
        momentum=0.937,
        weight_decay=0.0005,

        # train63's exact augmentation recipe
        mosaic=1.0,
        mixup=0.1,
        cutmix=0.1,
        copy_paste=0.0,
        erasing=0.4,
        scale=0.3,
        degrees=180,
        shear=5.0,
        perspective=0.0002,
        translate=0.05,
        flipud=0.5,
        fliplr=0.5,
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        close_mosaic=80,     # train63: 80

        # Multi-scale OFF for fine-tune (fixed 544 for deployment alignment)
        multi_scale=False,
        rect=False,

        # Training controls
        patience=30,
        amp=True,
        cache="disk",
        workers=8,
        seed=42,
        deterministic=False,
        save_period=25,

        # Albumentations
        augmentations=alb,

        # Output
        project=cli.project,
        name=cli.name,
        exist_ok=True,
    )

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None:
        save_dir = model.trainer.save_dir if hasattr(model, "trainer") else None
    print(f"[DONE] Plan G complete: {save_dir}")

    best_pt = Path(save_dir) / "weights" / "best.pt" if save_dir else None
    if best_pt and best_pt.exists():
        print(f"[INFO] Best model: {best_pt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
