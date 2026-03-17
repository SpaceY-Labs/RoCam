# -*- coding: utf-8 -*-
"""
Stage 3: 极低 LR 抛光 (60 epochs)
- lr0=0.0002, SGD, rect=True
- Albumentations 概率降低 ~30%
用法:  见 run_pipeline.bash
"""
import os, sys, argparse
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")


def patch_albumentations_stage3():
    try:
        import albumentations as A
        from ultralytics.data.augment import Albumentations
    except Exception as e:
        print(f"[AUG] albumentations 不可用: {e}")
        return

    _orig_init = Albumentations.__init__

    def _custom_init(self, p=1.0, transforms=None):
        _orig_init(self, p=p, transforms=transforms)
        self.transform = A.Compose([
            A.MotionBlur(blur_limit=5, p=0.08),
            A.GaussianBlur(blur_limit=5, p=0.05),
            A.GaussNoise(std_range=(0.01, 0.03), p=0.10),
            A.ImageCompression(quality_range=(40, 95), p=0.15),
            A.RandomBrightnessContrast(p=0.15),
            A.RandomGamma(p=0.07),
            A.CLAHE(clip_limit=3.0, p=0.07),
            A.Downscale(scale_range=(0.7, 0.9), p=0.07),
        ])
        self.contains_spatial = False
        print("[AUG] Stage 3 Albumentations 已注入 (概率降低 30%)")

    Albumentations.__init__ = _custom_init


def get_ram_available_gb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1024 / 1024
    except Exception:
        return 999


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True, help="Stage 2 best.pt 路径")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch", type=int, default=192)
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="stage3")
    cli = parser.parse_args()

    rank = int(os.environ.get("LOCAL_RANK", -1))
    is_main = rank in (-1, 0)

    if rank > -1:
        import torch.distributed as dist
        if not dist.is_initialized():
            dist.init_process_group(backend="nccl")
        dist.barrier()

    patch_albumentations_stage3()

    workers = 8 if get_ram_available_gb() > 40 else 4
    device_str = str(rank) if rank > -1 else "0"

    args = dict(
        model=cli.model,
        data=DATA_YAML,
        imgsz=960,
        batch=cli.batch,
        epochs=cli.epochs,
        device=device_str,
        workers=workers,
        amp=True,
        cache="disk",

        optimizer="SGD",
        nbs=cli.batch,
        lr0=0.0002,
        lrf=0.2,
        cos_lr=True,
        patience=25,

        rect=True,
        mosaic=0.0, mixup=0.0, cutmix=0.0,
        copy_paste=0.0, multi_scale=False, erasing=0.0,

        degrees=180,
        flipud=0.5, fliplr=0.5,
        shear=2.0,
        scale=0.05,
        translate=0.02,
        perspective=0.0,

        save_period=10,
        seed=42,
        project=cli.project,
        name=cli.name,
    )

    from ultralytics import YOLO
    model = YOLO(cli.model)
    if is_main:
        print(f"[STAGE3] model={cli.model}, lr0=0.0002, SGD, epochs={cli.epochs}")

    results = model.train(**args)

    if is_main:
        save_dir = getattr(results, "save_dir", "?")
        print(f"[DONE] Stage 3 完成: {save_dir}")
        result_file = Path(cli.project) / cli.name / ".stage3_result"
        result_file.parent.mkdir(parents=True, exist_ok=True)
        best_pt = Path(save_dir) / "weights" / "best.pt"
        result_file.write_text(str(best_pt))


if __name__ == "__main__":
    main()
