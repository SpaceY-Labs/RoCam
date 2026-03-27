# -*- coding: utf-8 -*-
"""
Plan C Phase 2: Low-LR fine-tuning at imgsz=544 (100 epochs)
- Inherits from Phase 1 best.pt
- Single H100, batch=64, nbs=128 (consistent regime)
- SGD, lr0=0.0001, cos_lr=True
- Reduced augmentation intensity (~60% of Phase 1)

Usage:
  python train_planC_phase2.py --model /path/to/planC_phase1/best.pt
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


def build_albumentations_phase2():
    import albumentations as A

    return [
        A.Downscale(scale_range=(0.6, 0.9), p=0.08),
        A.MotionBlur(blur_limit=5, p=0.10),
        A.GaussianBlur(blur_limit=(3, 5), p=0.05),
        A.GaussNoise(std_range=(0.01, 0.03), p=0.10),
        A.ImageCompression(quality_range=(40, 95), p=0.12),
        A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.15),
        A.RandomGamma(gamma_limit=(70, 130), p=0.08),
        A.CLAHE(clip_limit=3.0, p=0.07),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True, help="Phase 1 best.pt path")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--gpu", type=int, default=None, help="Force specific GPU index")
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="planC_phase2")
    cli = parser.parse_args()

    if cli.gpu is not None:
        device = str(cli.gpu)
        gpu_free = get_gpu_free_memory()
        free_mb = gpu_free.get(cli.gpu, 0)
        print(f"[GPU] Using forced GPU {cli.gpu} (free={free_mb}MiB)")
    else:
        gpu_free = get_gpu_free_memory()
        usable = sorted(gpu_free.items(), key=lambda x: -x[1])
        if not usable or usable[0][1] < 30_000:
            raise RuntimeError(f"No GPU > 30GB free: {gpu_free}")
        device = str(usable[0][0])
        print(f"[GPU] Auto-selected GPU {device} (free={usable[0][1]}MiB)")

    ram_gb = get_ram_available_gb()
    workers = 8 if ram_gb > 40 else 4 if ram_gb > 20 else 2

    augmentations = build_albumentations_phase2()
    print(f"[AUG] Phase 2: {len(augmentations)} transforms (~60% of Phase 1)")

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
        lr0=0.0001,
        lrf=0.15,
        nbs=128,
        cos_lr=True,
        warmup_epochs=3,

        patience=30,
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
        shear=2.0,
        perspective=0.0001,
        translate=0.05,
        scale=0.10,

        mosaic=0.0,
        close_mosaic=0,
        mixup=0.0,
        cutmix=0.0,
        copy_paste=0.0,
        erasing=0.15,

        augmentations=augmentations,

        project=cli.project,
        name=cli.name,
    )

    from ultralytics import YOLO

    model = YOLO(cli.model)
    print(f"[PlanC-P2] model={cli.model}")
    print(f"[PlanC-P2] imgsz=544, SGD lr0=0.0001, batch={cli.batch}")
    print(f"[PlanC-P2] mosaic=0, erasing=0.15, scale=0.10, rect=False")
    print(f"[PlanC-P2] epochs={cli.epochs}, device={device}")

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

    print(f"[DONE] Plan C Phase 2 complete: {save_dir}")
    best_pt = Path(save_dir) / "weights" / "best.pt"
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt not found: {best_pt}")
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
