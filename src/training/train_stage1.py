# -*- coding: utf-8 -*-
"""
Stage 1: YOLO26s-P2 主训练 (300 epochs)
- Ultralytics 内置 DDP: device="0,1,2,3" 让框架自己管理多卡
- patience=0 禁用早停，保证 close_mosaic 在 ep250 生效
- mosaic=0.4 保护小目标，multi_scale=False 避免缩到 480px
- nbs=batch 防止 weight_decay 被隐式放大
用法:
  冒烟测试:  python train_stage1.py --smoke
  50ep验证:  python train_stage1.py --epochs 50
  正式训练:  python train_stage1.py  (由 run_pipeline.bash 调用)
"""
import os
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

import sys, argparse, subprocess, random, shutil, zipfile, urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")
MODEL_YAML = "yolo26s-p2.yaml"
PRETRAINED = str(DATA_DIR / "yolo26s.pt")

ROCAM_TRAIN_DIR = DATA_DIR / "rocam_data_15000" / "data_15000" / "images" / "train"
ROCAM_LABEL_TRAIN_DIR = DATA_DIR / "rocam_data_15000" / "data_15000" / "labels" / "train"
COCO_ROOT = DATA_DIR / "external" / "coco2017"
COCO_NEG_MAX = 2000
COCO_ZIPS = {
    "train2017.zip": "http://images.cocodataset.org/zips/train2017.zip",
    "val2017.zip": "http://images.cocodataset.org/zips/val2017.zip",
}


# --------------- GPU / RAM 探测 ---------------

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


# --------------- COCO 负样本 ---------------

def _download(url, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    print(f"[COCO] 下载 {dst.name} ...")
    urllib.request.urlretrieve(url, dst)


def ensure_coco_images():
    train_dir = COCO_ROOT / "images" / "train2017"
    val_dir = COCO_ROOT / "images" / "val2017"
    if train_dir.exists() and val_dir.exists():
        print("[COCO] 已存在, 跳过下载")
        return
    COCO_ROOT.mkdir(parents=True, exist_ok=True)
    images_dir = COCO_ROOT / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    for fname, url in COCO_ZIPS.items():
        zip_path = COCO_ROOT / fname
        _download(url, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(images_dir)
        zip_path.unlink()


def prepare_coco_negatives():
    existing = sorted(ROCAM_TRAIN_DIR.glob("coco_neg_*.jpg"))
    if len(existing) >= COCO_NEG_MAX:
        print(f"[COCO] 已有 {len(existing)} 负样本 >= {COCO_NEG_MAX}, 跳过")
        return
    images_dir = COCO_ROOT / "images"
    all_imgs = list((images_dir / "train2017").glob("*.jpg")) + \
               list((images_dir / "val2017").glob("*.jpg"))
    if not all_imgs:
        print("[COCO] 无 COCO 图片, 跳过负样本准备")
        return
    n = min(COCO_NEG_MAX, len(all_imgs))
    random.seed(0)
    sample = random.sample(all_imgs, n)
    ROCAM_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    ROCAM_LABEL_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    added = 0
    for i, src in enumerate(sample, 1):
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)
            added += 1
        (ROCAM_LABEL_TRAIN_DIR / f"{dst.stem}.txt").touch(exist_ok=True)
        if i % 500 == 0 or i == n:
            print(f"[COCO] {i}/{n} (新增 {added})")
    print(f"[COCO] 负样本就绪: {n} 张 (新增 {added})")


# --------------- Albumentations 猴子补丁 ---------------

def patch_albumentations():
    """
    猴子补丁注入自定义成像退化增强。
    注意: Ultralytics 内置 DDP 会重新产生子进程，此补丁不会传播到子进程。
    Stage 2/3 使用单卡训练，补丁可完整生效。
    """
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
        print("[AUG] 自定义 Albumentations 已注入 (pixel-only, blur5, downscale)")

    Albumentations.__init__ = _custom_init
    print("[AUG] 猴子补丁已安装")


# --------------- 训练入口 ---------------

def build_args(device_str, batch, workers, epochs=300, smoke=False):
    if smoke:
        epochs = 2
        batch = 16
        device_str = device_str.split(",")[0]
        workers = 2

    return dict(
        data=DATA_YAML,
        imgsz=960,
        batch=batch,
        epochs=epochs,
        device=device_str,
        workers=workers,
        amp=True,
        cache="disk",

        optimizer="auto",
        nbs=batch,

        lrf=0.02,
        patience=0,
        multi_scale=False,
        rect=False,
        seed=42,
        save_period=25 if not smoke else 1,
        deterministic=False,

        hsv_h=0.015, hsv_s=0.5, hsv_v=0.35,
        degrees=180,
        flipud=0.5, fliplr=0.5,
        shear=3.0,
        perspective=0.0001,
        translate=0.05,
        scale=0.08,

        mosaic=0.4,
        close_mosaic=50,
        mixup=0.05,
        cutmix=0.0,
        copy_paste=0.0,
        erasing=0.0,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke", action="store_true", help="2ep 单卡冒烟测试")
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--project", type=str, default=str(DATA_DIR / "runs" / "detect"))
    parser.add_argument("--name", type=str, default="stage1")
    cli = parser.parse_args()

    ensure_coco_images()
    prepare_coco_negatives()
    patch_albumentations()

    device_str, batch, n_gpu, workers = preflight(cli.batch)
    args = build_args(device_str, batch, workers, cli.epochs, cli.smoke)
    args["project"] = cli.project
    args["name"] = cli.name

    from ultralytics import YOLO
    model = YOLO(MODEL_YAML).load(PRETRAINED)
    print(f"[MODEL] {MODEL_YAML} + {PRETRAINED}")
    print(f"[TRAIN] epochs={args['epochs']}, batch={args['batch']}, "
          f"device={args['device']}, nbs={args['nbs']}")

    results = model.train(**args)

    save_dir = getattr(results, "save_dir", "?")
    print(f"[DONE] Stage 1 完成: {save_dir}")
    result_file = Path(cli.project) / cli.name / ".stage1_result"
    result_file.parent.mkdir(parents=True, exist_ok=True)
    best_pt = Path(save_dir) / "weights" / "best.pt"
    result_file.write_text(str(best_pt))
    print(f"[DONE] best.pt = {best_pt}")


if __name__ == "__main__":
    main()
