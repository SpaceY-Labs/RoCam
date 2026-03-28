# -*- coding: utf-8 -*-
"""
Plan F: smallrocket + small-target focused fine-tune at imgsz=544
- Based on smallrocket.pt (best small-target baseline: 0.341 mAP50-95 small)
- Strong mosaic + high scale to force model to learn small objects at 544
- Unlike Plan D which turned off mosaic (causing small-target regression),
  Plan F aggressively augments for small targets

Usage:
  python train_planF_small.py --gpu 0
"""
import os

os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import argparse
import subprocess
from pathlib import Path

DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")
SMALLROCKET = str(DATA_DIR / "models" / "smallrocket.pt")


def get_gpu_free_memory():
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
        capture_output=True, text=True,
    )
    gpus = {}
    for line in result.stdout.strip().split("\n"):
        parts = line.split(",")
        if len(parts) == 2:
            gpus[int(parts[0].strip())] = int(parts[1].strip())
    return gpus


def get_ram_available_gb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024 / 1024
    except Exception:
        return 999


def build_albumentations():
    import albumentations as A

    return [
        A.Downscale(scale_range=(0.4, 0.8), p=0.15),
        A.CoarseDropout(
            max_holes=8, max_height=48, max_width=48,
            min_holes=2, min_height=8, min_width=8, p=0.12,
        ),
        A.MotionBlur(blur_limit=7, p=0.15),
        A.GaussianBlur(blur_limit=(3, 5), p=0.08),
        A.GaussNoise(std_range=(0.01, 0.04), p=0.15),
        A.ImageCompression(quality_range=(30, 95), p=0.18),
        A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.22),
        A.RandomGamma(gamma_limit=(60, 140), p=0.12),
        A.CLAHE(clip_limit=4.0, tile_grid_size=(8, 8), p=0.10),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default=SMALLROCKET)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--gpu", type=int, default=0)
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="planF_small")
    cli = parser.parse_args()

    device = str(cli.gpu)
    gpu_free = get_gpu_free_memory()
    free_mb = gpu_free.get(cli.gpu, 0)
    print(f"[GPU] Using GPU {cli.gpu} (free={free_mb}MiB)")

    ram_gb = get_ram_available_gb()
    workers = 8 if ram_gb > 40 else 4 if ram_gb > 20 else 2

    augmentations = build_albumentations()
    print(f"[AUG] {len(augmentations)} Albumentations (small-target focused)")

    args = dict(
        data=DATA_YAML,
        imgsz=544,
        batch=cli.batch,
        epochs=cli.epochs,
        device=device,
        workers=workers,
        amp=True,
        cache="disk",

        optimizer="SGD",
        lr0=0.0002,
        lrf=0.1,
        nbs=128,
        cos_lr=True,
        warmup_epochs=3,

        patience=25,
        rect=False,
        multi_scale=False,
        seed=42,
        save_period=10,
        deterministic=False,

        hsv_h=0.015,
        hsv_s=0.5,
        hsv_v=0.35,
        degrees=180,
        flipud=0.5,
        fliplr=0.5,
        shear=3.0,
        perspective=0.0001,
        translate=0.05,
        scale=0.50,

        mosaic=0.30,
        close_mosaic=15,
        mixup=0.05,
        cutmix=0.0,
        copy_paste=0.0,
        erasing=0.35,

        augmentations=augmentations,

        project=cli.project,
        name=cli.name,
    )

    from ultralytics import YOLO

    model = YOLO(cli.model)
    print(f"[PlanF] Fine-tune smallrocket for SMALL TARGETS")
    print(f"[PlanF] mosaic=0.30, scale=0.50, erasing=0.35 (aggressive)")
    print(f"[PlanF] lr0=0.0002, close_mosaic=15")
    print(f"[PlanF] epochs={cli.epochs}, device={device}")

    results = model.train(**args)

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None:
        save_dir = model.trainer.save_dir if hasattr(model, "trainer") else None
    if save_dir is None:
        candidates = sorted(
            Path(cli.project).glob(f"{cli.name}*"),
            key=lambda p: p.stat().st_mtime, reverse=True,
        )
        for c in candidates:
            if (c / "weights" / "best.pt").exists():
                save_dir = c
                break

    print(f"[DONE] Plan F complete: {save_dir}")
    best_pt = Path(save_dir) / "weights" / "best.pt"
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt not found: {best_pt}")
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
