# -*- coding: utf-8 -*-
"""
Stage 1b: 从 Stage 1 best.pt 延长训练 (200 epochs)
- 4-GPU DDP (Ultralytics 内置): device 由 preflight 动态分配
- optimizer="MuSGD" 显式指定, 保持与 Stage 1 (auto→MuSGD) 一致
- lr0=0.005 (卷积层有效 lr=0.0005 因 muon_scale=0.1)
- mosaic=0.2 低强度继续生成小目标, close_mosaic=30
- patience=0 训练满全部 epoch
用法:
  python train_stage1b.py
  python train_stage1b.py --model /path/to/best.pt --epochs 200
"""
import os
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

import sys, argparse, subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")

STAGE1_BEST = str(DATA_DIR / "runs" / "detect" / "stage17" / "weights" / "best.pt")


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


def preflight(target_batch=128):
    gpu_free = get_gpu_free_memory()
    usable = sorted(
        [(i, m) for i, m in gpu_free.items() if m > 60_000],
        key=lambda x: -x[1],
    )
    if not usable:
        usable = sorted(
            [(i, m) for i, m in gpu_free.items() if m > 40_000],
            key=lambda x: -x[1],
        )
    n_gpu = len(usable)
    if n_gpu == 0:
        raise RuntimeError(f"无 GPU 剩余 > 40GB: {gpu_free}")

    per_gpu = target_batch // n_gpu
    actual_batch = per_gpu * n_gpu
    device_str = ",".join(str(i) for i, _ in usable)

    ram_gb = get_ram_available_gb()
    workers = 8 if ram_gb > 40 else 4 if ram_gb > 20 else 2

    print(f"[PREFLIGHT] GPU: {device_str} ({n_gpu}卡), batch={actual_batch}, "
          f"workers={workers}, RAM={ram_gb:.1f}GB")
    return device_str, actual_batch, n_gpu, workers


def patch_albumentations():
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
            A.MotionBlur(blur_limit=5, p=0.12),
            A.GaussianBlur(blur_limit=5, p=0.08),
            A.GaussNoise(std_range=(0.01, 0.03), p=0.15),
            A.ImageCompression(quality_range=(40, 95), p=0.20),
            A.RandomBrightnessContrast(p=0.20),
            A.RandomGamma(p=0.10),
            A.CLAHE(clip_limit=3.0, p=0.10),
            A.Downscale(scale_range=(0.7, 0.9), p=0.10),
        ])
        self.contains_spatial = False
        print("[AUG] Stage 1b Albumentations 已注入")

    Albumentations.__init__ = _custom_init
    print("[AUG] 猴子补丁已安装 (DDP 子进程不生效, Stage 2/3 单卡时完整生效)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default=STAGE1_BEST,
                        help="Stage 1 best.pt 路径")
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--project", type=str,
                        default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="stage1b")
    cli = parser.parse_args()

    patch_albumentations()

    device_str, batch, n_gpu, workers = preflight(cli.batch)

    args = dict(
        data=DATA_YAML,
        imgsz=960,
        batch=batch,
        epochs=cli.epochs,
        device=device_str,
        workers=workers,
        amp=True,
        cache="disk",

        optimizer="MuSGD",
        lr0=0.005,
        lrf=0.02,
        nbs=batch,
        warmup_epochs=5,

        patience=0,
        multi_scale=False,
        rect=False,
        seed=42,
        save_period=25,
        deterministic=False,

        hsv_h=0.015, hsv_s=0.5, hsv_v=0.35,
        degrees=180,
        flipud=0.5, fliplr=0.5,
        shear=3.0,
        perspective=0.0001,
        translate=0.05,
        scale=0.08,

        mosaic=0.2,
        close_mosaic=30,
        mixup=0.02,
        cutmix=0.0,
        copy_paste=0.0,
        erasing=0.0,

        project=cli.project,
        name=cli.name,
    )

    from ultralytics import YOLO
    model = YOLO(cli.model)
    print(f"[STAGE1b] model={cli.model}")
    print(f"[STAGE1b] optimizer=MuSGD, lr0=0.005, mosaic=0.2, close_mosaic=30")
    print(f"[STAGE1b] epochs={args['epochs']}, batch={args['batch']}, "
          f"device={args['device']}")

    results = model.train(**args)

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None:
        save_dir = model.trainer.save_dir if hasattr(model, "trainer") else None
    if save_dir is None:
        from pathlib import Path as _P
        candidates = sorted(
            _P(cli.project).glob(f"{cli.name}*"),
            key=lambda p: p.stat().st_mtime, reverse=True,
        )
        for c in candidates:
            if (c / "weights" / "best.pt").exists():
                save_dir = c
                break
    print(f"[DONE] Stage 1b 完成: {save_dir}")
    result_file = Path(cli.project) / cli.name / ".stage1b_result"
    result_file.parent.mkdir(parents=True, exist_ok=True)
    best_pt = Path(save_dir) / "weights" / "best.pt"
    if not best_pt.exists():
        raise FileNotFoundError(f"best.pt 不存在: {best_pt}")
    result_file.write_text(str(best_pt))
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
