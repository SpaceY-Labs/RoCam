# -*- coding: utf-8 -*-
"""
Plan C Phase 1: Standard 3-head yolo26s at imgsz=544 (300 epochs)
- Matches deployment resolution (1920x1080 -> 544x960 via nvinfer)
- Single H100, batch=64, nbs=128 (accumulate=2)
- SGD, lr0=0.0003, cos_lr=True
- V3 augmentation strategy (scale=0.25, erasing=0.30, 9x Albumentations)

Usage:
  python train_planC_phase1.py
  python train_planC_phase1.py --gpu 3 --epochs 300
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
DEFAULT_MODEL = "yolo26s.pt"


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
        A.Downscale(scale_range=(0.5, 0.85), p=0.12),
        A.CoarseDropout(
            max_holes=6, max_height=40, max_width=40,
            min_holes=1, min_height=8, min_width=8, p=0.10,
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
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--gpu", type=int, default=None, help="Force specific GPU index")
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="planC_phase1")
    cli = parser.parse_args()

    if cli.gpu is not None:
        device = str(cli.gpu)
        gpu_free = get_gpu_free_memory()
        free_mb = gpu_free.get(cli.gpu, 0)
        print(f"[GPU] Using forced GPU {cli.gpu} (free={free_mb}MiB)")
        if free_mb < 30000:
            print(f"[WARN] GPU {cli.gpu} has < 30GB free, may OOM with batch={cli.batch}")
    else:
        gpu_free = get_gpu_free_memory()
        usable = sorted(gpu_free.items(), key=lambda x: -x[1])
        if not usable or usable[0][1] < 30_000:
            raise RuntimeError(f"No GPU > 30GB free: {gpu_free}")
        device = str(usable[0][0])
        print(f"[GPU] Auto-selected GPU {device} (free={usable[0][1]}MiB)")

    ram_gb = get_ram_available_gb()
    workers = 8 if ram_gb > 40 else 4 if ram_gb > 20 else 2

    augmentations = build_albumentations()
    print(f"[AUG] {len(augmentations)} Albumentations transforms")
    for t in augmentations:
        print(f"  {t.__class__.__name__}(p={t.p})")

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
    print(f"[PlanC-P1] model={cli.model} (yolo26s 3-head)")
    print(f"[PlanC-P1] imgsz=544 (deployment resolution)")
    print(f"[PlanC-P1] SGD lr0=0.0003, cos_lr, batch={cli.batch}, nbs=128")
    print(f"[PlanC-P1] scale=0.25, erasing=0.30, mosaic=0.15, close_mosaic=40")
    print(f"[PlanC-P1] epochs={cli.epochs}, device={device}")

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

    print(f"[DONE] Plan C Phase 1 complete: {save_dir}")
    result_file = Path(cli.project) / cli.name / ".planC_phase1_result"
    result_file.parent.mkdir(parents=True, exist_ok=True)
    best_pt = Path(save_dir) / "weights" / "best.pt"
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt not found: {best_pt}")
    result_file.write_text(str(best_pt))
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
