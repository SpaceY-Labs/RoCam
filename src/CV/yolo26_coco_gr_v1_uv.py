# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-01-29
Purpose: YOLO26 training configuration with COCO negative samples and multi-GPU DDP (group v1).
"""
import os

os.environ["CUDA_VISIBLE_DEVICES"] = "0,1,2,3"
os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

from ultralytics import YOLO
from pathlib import Path
import random, zipfile, urllib.request, shutil

# ========= Original Configuration (unchanged) =========
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"
IMG_H, IMG_W = 544, 960
MODEL = "yolo26s.pt"  # Can upgrade to "yolo26m.pt" if GPU memory allows
batch = 64

# ========= COCO-related Configuration =========
BASE_DIR = Path(__file__).resolve().parent

# COCO download & extraction root directory (adjust as needed)
COCO_ROOT = BASE_DIR / "external" / "coco2017"

# Training image directory (must match the train path in data.yaml)
ROCAM_TRAIN_DIR = BASE_DIR / "rocam_data_15000" / "data_15000" / "images" / "train"

# Maximum number of COCO images to sample as negative examples
COCO_NEG_MAX = 1000

# Only images are needed (negative samples do not require annotations)
COCO_ZIPS = {
    "train2017.zip": "http://images.cocodataset.org/zips/train2017.zip",
    "val2017.zip": "http://images.cocodataset.org/zips/val2017.zip",
}


def _download(url: str, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        print(f"[COCO] Already exists: {dst.name}, skipping download")
        return
    print(f"[COCO] Downloading {dst.name} -> {dst}")
    urllib.request.urlretrieve(url, dst)
    print(f"[COCO] Download complete: {dst.name}")


def ensure_coco_images():
    """
    Download and extract COCO train/val to COCO_ROOT/images.
    Only actually downloads and extracts on the first run; skips if directories already exist.
    """
    images_dir = COCO_ROOT / "images"
    train_dir = images_dir / "train2017"
    val_dir = images_dir / "val2017"

    if train_dir.exists() and val_dir.exists():
        print("[COCO] train2017 / val2017 already exist, skipping download and extraction")
        return

    COCO_ROOT.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    for fname, url in COCO_ZIPS.items():
        zip_path = COCO_ROOT / fname
        _download(url, zip_path)
        print(f"[COCO] Extracting {fname}")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(images_dir)
        zip_path.unlink()  # Delete zip after extraction to save space
        print(f"[COCO] Extraction complete, archive deleted: {fname}")


def prepare_coco_negatives():
    """
    Randomly sample images from COCO train2017/val2017, copy them to your train directory.
    No label files are generated -> serving as pure background negative samples.

    Note: Only runs once; writes a .coco_neg_done sentinel file in the train directory.
    """
    if not ROCAM_TRAIN_DIR.exists():
        raise FileNotFoundError(f"[COCO] Cannot find training image directory: {ROCAM_TRAIN_DIR}")

    sentinel = ROCAM_TRAIN_DIR / ".coco_neg_done"
    if sentinel.exists():
        print("[COCO] Negative samples already prepared, skipping this step")
        return

    images_dir = COCO_ROOT / "images"
    train_dir = images_dir / "train2017"
    val_dir = images_dir / "val2017"
    if not (train_dir.exists() and val_dir.exists()):
        raise FileNotFoundError("[COCO] Please call ensure_coco_images() first to complete download and extraction")

    all_imgs = list(train_dir.glob("*.jpg")) + list(val_dir.glob("*.jpg"))
    if not all_imgs:
        raise RuntimeError("[COCO] No jpg images found in train2017/val2017")

    n = min(COCO_NEG_MAX, len(all_imgs))
    print(f"[COCO] Found {len(all_imgs)} COCO images total, will sample {n} as negative examples")

    random.seed(0)
    sample = random.sample(all_imgs, n)

    ROCAM_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    for i, src in enumerate(sample, 1):
        # Add prefix to avoid naming conflicts
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)
        if i % 1000 == 0 or i == n:
            print(f"[COCO] Copied {i}/{n} images")

    sentinel.touch()
    print("[COCO] Negative sample preparation complete! Will not repeat on next run")


# ========= Training Parameters (minimal changes, only key YOLO26 adjustments) =========
# Key adjustments:
# 1) Do not force optimizer / lr0 / lrf / warmup etc.; let YOLO26/Ultralytics defaults take over
# 2) Keep imgsz tuple; if incompatible with newer versions, auto-fallback in main

args = dict(
    data=DATA_YAML,
    imgsz=1280,  # Increase resolution to improve small target detection
    rect=True,  # Enable rectangular batching, suitable for wide images
    multi_scale=True,  # Enable multi-scale training, leveraging YOLO26 features
    end2end=True,  # Enable YOLO26 NMS-free end-to-end mode
    optimizer='MuSGD',  # Use YOLO26's new optimizer
    batch=batch,
    epochs=420,
    cache=True,  # Upgrade to RAM cache if memory allows
    device="0,1,2,3",
    workers=16,  # Increase workers to match OMP_NUM_THREADS
    amp=True,
    cos_lr=True,
    patience=30,
    seed=0,
    save_period=25,
    deterministic=False,
    # ---- Color Jitter ----
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,
    # ---- Geometric Augmentation ----
    degrees=180,
    flipud=0.5,
    fliplr=0.5,
    shear=10.0,
    perspective=0.0005,
    translate=0.1,
    scale=0.8,  # Adjusted to avoid excessively shrinking small targets
    # ---- Composite Augmentation ----
    mosaic=1.0,
    mixup=0.1,  # Increased to improve small target blending
    copy_paste=0.2,  # Increased to paste more small targets
    erasing=0.4,  # Added random erasing to simulate occlusion
    close_mosaic=150,
)

if __name__ == "__main__":
    # 1) Auto-download & extract COCO (only actually downloads on first run)
    ensure_coco_images()

    # 2) Auto-copy COCO images to train directory as negative samples (only once)
    prepare_coco_negatives()

    # 3) Start YOLO training
    model = YOLO(MODEL)

    try:
        results = model.train(**args)
    except Exception as e:
        # Some newer versions/models may not accept imgsz=(H,W) tuple
        # This fallback only triggers on failure: use long-edge imgsz + rect=True
        print(“[WARN] model.train failed, possibly imgsz tuple incompatibility. Error:”)
        print(e)
        print(“[WARN] Trying fallback: imgsz=max(H,W) + rect=True for retraining...”)

        args2 = dict(args)
        args2["imgsz"] = max(IMG_H, IMG_W)  # 960
        args2["rect"] = True
        results = model.train(**args2)

    print("runs dir:", getattr(results, "save_dir", "see runs/detect/"))