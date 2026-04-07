# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-03-19
Purpose: V3 Phase 1 joint training for small-target detection and robustness with gradient accumulation (250 epochs).

V3 Phase 1: Joint small-target + robustness training (250 epochs)
- Single H100 GPU, batch=32, nbs=128 (gradient accumulation over 4 steps, equivalent to 4-GPU DDP batch=128)
- SGD, lr0=0.0003, cos_lr=True
- scale=0.25 (V2 was only 0.08), erasing=0.30 (V2 was 0)
- Native augmentations parameter passes custom Albumentations (no monkey-patch needed)
- close_mosaic=40 automatically disables mosaic in the last 40 epochs

Usage:
  python train_v3_phase1.py
  python train_v3_phase1.py --model /path/to/best.pt --epochs 250
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
STAGE1B_BEST = str(DATA_DIR / "runs" / "detect" / "stage1b" / "weights" / "best.pt")


def get_gpu_free_memory():
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
    )
    gpus = {}
    for line in result.stdout.strip().split("\n"):
        parts = line.split(",")
        if len(parts) == 2:
            gpus[int(parts[0].strip())] = int(parts[1].strip())
    return gpus


def select_best_gpu():
    gpu_free = get_gpu_free_memory()
    usable = sorted(gpu_free.items(), key=lambda x: -x[1])
    if not usable or usable[0][1] < 40_000:
        raise RuntimeError(f"No GPU with > 40GB available: {gpu_free}")
    best_id, free_mb = usable[0]
    print(f"[GPU] Selected GPU {best_id} (free={free_mb}MiB)")
    return str(best_id)


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
        # --- Small target augmentation ---
        A.Downscale(scale_range=(0.5, 0.85), p=0.12),
        A.CoarseDropout(
            max_holes=6, max_height=40, max_width=40,
            min_holes=1, min_height=8, min_width=8, p=0.10,
        ),
        # --- Sensor/transmission robustness ---
        A.MotionBlur(blur_limit=7, p=0.15),
        A.GaussianBlur(blur_limit=(3, 5), p=0.08),
        A.GaussNoise(std_range=(0.01, 0.04), p=0.15),
        A.ImageCompression(quality_range=(30, 95), p=0.18),
        # --- Lighting/color robustness ---
        A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.22),
        A.RandomGamma(gamma_limit=(60, 140), p=0.12),
        A.CLAHE(clip_limit=4.0, tile_grid_size=(8, 8), p=0.10),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default=STAGE1B_BEST)
    parser.add_argument("--epochs", type=int, default=250)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="v3_phase1")
    cli = parser.parse_args()

    device = select_best_gpu()
    ram_gb = get_ram_available_gb()
    workers = 8 if ram_gb > 40 else 4 if ram_gb > 20 else 2

    augmentations = build_albumentations()
    print(f"[AUG] {len(augmentations)} Albumentations transforms (native parameter, no monkey-patch)")
    for t in augmentations:
        print(f"  {t.__class__.__name__}(p={t.p})")

    args = dict(
        data=DATA_YAML,
        imgsz=960,
        batch=cli.batch,
        epochs=cli.epochs,
        device=device,
        workers=workers,
        amp=True,
        cache="disk",

        optimizer="SGD",
        lr0=0.0003,
        lrf=0.1,
        nbs=128,
        cos_lr=True,
        warmup_epochs=5,

        patience=0,
        rect=False,
        multi_scale=False,
        seed=42,
        save_period=25,
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
        scale=0.25,

        mosaic=0.15,
        close_mosaic=40,
        mixup=0.05,
        cutmix=0.0,
        copy_paste=0.0,
        erasing=0.30,

        augmentations=augmentations,

        project=cli.project,
        name=cli.name,
    )

    from ultralytics import YOLO

    model = YOLO(cli.model)
    print(f"[V3-P1] model={cli.model}")
    print(f"[V3-P1] SGD lr0=0.0003, cos_lr, batch={cli.batch}, nbs=128 (accumulate=4)")
    print(f"[V3-P1] scale=0.25, erasing=0.30, mosaic=0.15, close_mosaic=40")
    print(f"[V3-P1] epochs={cli.epochs}, device={device}")

    results = model.train(**args)

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None:
        save_dir = model.trainer.save_dir if hasattr(model, "trainer") else None
    if save_dir is None:
        candidates = sorted(
            Path(cli.project).glob(f"{cli.name}*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for c in candidates:
            if (c / "weights" / "best.pt").exists():
                save_dir = c
                break

    print(f"[DONE] V3 Phase 1 finished: {save_dir}")
    result_file = Path(cli.project) / cli.name / ".v3_phase1_result"
    result_file.parent.mkdir(parents=True, exist_ok=True)
    best_pt = Path(save_dir) / "weights" / "best.pt"
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt does not exist: {best_pt}")
    result_file.write_text(str(best_pt))
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
