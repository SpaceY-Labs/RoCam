# -*- coding: utf-8 -*-
"""
YOLO26s Training Script for Small Rocket Detection (train63 / smallrocket.pt)

This is the training script that produced the deployed smallrocket.pt model.
It trains YOLO26s on the ROCAM dataset with aggressive augmentation
(mosaic=1.0, multi-scale, 7 Albumentations transforms) and COCO hard
negative mining (4,000 background images).

Original location on Grace HPC: /u50/loux8/CVimprove/src/CV/yolo26_coco_ch_v2_uv.py

Usage:
    python train_smallrocket.py

Prerequisites:
    - Ultralytics >= 8.3
    - albumentations (optional, for imaging degradation augmentations)
    - ROCAM dataset at DATA_YAML path
    - COCO images will be auto-downloaded on first run
"""
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
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

# ==================== Configuration ====================

DATA_YAML = "rocam_data_15000/data_15000/data.yaml"
IMG_H, IMG_W = 544, 960
MODEL     = "yolo26s.pt"
batch = 64

# ==================== COCO Hard Negative Mining ====================

BASE_DIR         = Path(__file__).resolve().parent
COCO_ROOT        = BASE_DIR / "external" / "coco2017"
ROCAM_TRAIN_DIR  = BASE_DIR / "rocam_data_15000" / "data_15000" / "images" / "train"
ROCAM_LABEL_TRAIN_DIR = BASE_DIR / "rocam_data_15000" / "data_15000" / "labels" / "train"

# Number of COCO images to sample as negative examples.
# The deployed model (train63) used 4,000 COCO negatives in total,
# constituting ~25% of the training set.
COCO_NEG_MAX = 4000

COCO_ZIPS = {
    "train2017.zip": "http://images.cocodataset.org/zips/train2017.zip",
    "val2017.zip":   "http://images.cocodataset.org/zips/val2017.zip",
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
    """Download and extract COCO train/val images (only on first run)."""
    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"

    if train_dir.exists() and val_dir.exists():
        print("[COCO] train2017 / val2017 already exist, skipping")
        return

    COCO_ROOT.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    for fname, url in COCO_ZIPS.items():
        zip_path = COCO_ROOT / fname
        _download(url, zip_path)
        print(f"[COCO] Extracting {fname}")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(images_dir)
        zip_path.unlink()
        print(f"[COCO] Extracted and removed archive: {fname}")

def prepare_coco_negatives():
    """
    Randomly sample COCO images and copy them into the ROCAM training
    directory with empty label files, providing pure background supervision.

    This is idempotent: a sentinel file prevents re-execution.
    """
    if not ROCAM_TRAIN_DIR.exists():
        raise FileNotFoundError(f"[COCO] Training image directory not found: {ROCAM_TRAIN_DIR}")

    sentinel = ROCAM_TRAIN_DIR / ".coco_neg_done"
    if sentinel.exists():
        print("[COCO] Negatives already prepared, skipping")
        return

    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"
    if not (train_dir.exists() and val_dir.exists()):
        raise FileNotFoundError("[COCO] Call ensure_coco_images() first")

    all_imgs = list(train_dir.glob("*.jpg")) + list(val_dir.glob("*.jpg"))
    if not all_imgs:
        raise RuntimeError("[COCO] No jpg images found in train2017/val2017")

    n = min(COCO_NEG_MAX, len(all_imgs))
    print(f"[COCO] Found {len(all_imgs)} COCO images, sampling {n} as negatives")

    random.seed(0)
    sample = random.sample(all_imgs, n)

    ROCAM_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    ROCAM_LABEL_TRAIN_DIR.mkdir(parents=True, exist_ok=True)

    for i, src in enumerate(sample, 1):
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)

        # Create empty label file (ensures YOLO treats image as background)
        empty_label = ROCAM_LABEL_TRAIN_DIR / f"{dst.stem}.txt"
        empty_label.touch(exist_ok=True)

        if i % 1000 == 0 or i == n:
            print(f"[COCO] Copied {i}/{n}")

    sentinel.touch()
    print("[COCO] Negative sample preparation complete")


# ==================== Training Hyperparameters ====================
# These are the exact parameters used to train smallrocket.pt (train63).

args = dict(
    data=DATA_YAML,
    imgsz=(IMG_H, IMG_W),
    batch=batch,
    epochs=420,
    cache='disk',
    device="0",
    workers=8,
    amp=True,

    rect=False,
    multi_scale=True,   # Variable resolution 544-960px
    patience=30,
    seed=0,

    save_period=25,
    deterministic=False,

    # Colour augmentation
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,

    # Geometric augmentation
    degrees=180,         # Full rotation (rockets at any orientation)
    flipud=0.5,
    fliplr=0.5,
    shear=5.0,
    perspective=0.0002,
    translate=0.05,
    scale=0.3,

    # Composition augmentation
    mosaic=1.0,          # CRITICAL: always-on mosaic for small objects
    mixup=0.10,
    cutmix=0.10,
    copy_paste=0.0,
    close_mosaic=80,     # Disable mosaic for last 80 epochs
    erasing=0.4,
)

def attach_albumentations_if_available(train_args: dict):
    """
    Attach custom Albumentations transforms for imaging degradation robustness.
    If albumentations is not installed, training proceeds without them.
    """
    try:
        import albumentations as A
    except Exception as e:
        print(f"[AUG] albumentations not installed, skipping: {repr(e)}")
        return train_args

    small_obj_aug = [
        A.MotionBlur(blur_limit=7, p=0.15),
        A.GaussianBlur(blur_limit=7, p=0.10),
        A.GaussNoise(var_limit=(10.0, 50.0), p=0.15),
        A.ImageCompression(quality_lower=40, quality_upper=95, p=0.20),
        A.RandomBrightnessContrast(p=0.20),
        A.RandomGamma(p=0.10),
        A.CLAHE(clip_limit=3.0, p=0.10),
    ]
    train_args = dict(train_args)
    train_args["augmentations"] = small_obj_aug
    print("[AUG] Albumentations imaging degradation transforms enabled")
    return train_args

if __name__ == "__main__":
    # 1) Download & extract COCO (only on first run)
    ensure_coco_images()

    # 2) Prepare COCO negative samples (only on first run)
    prepare_coco_negatives()

    # 3) Train YOLO26s
    model = YOLO(MODEL)
    train_args = attach_albumentations_if_available(args)

    try:
        results = model.train(**train_args)
    except Exception as e:
        print(f"[WARN] model.train failed, trying fallback: {e}")
        args2 = dict(train_args)
        args2["imgsz"] = max(IMG_H, IMG_W)
        args2["rect"] = True
        args2["multi_scale"] = False
        results = model.train(**args2)

    print("Output directory:", getattr(results, "save_dir", "see runs/detect/"))

    # 4) Validate with one-to-many head (higher recall, used for mAP reporting)
    try:
        metrics = model.val(data=DATA_YAML, imgsz=(IMG_H, IMG_W), end2end=False)
        print("[VAL] one-to-many metrics:", metrics)
    except Exception as e:
        print(f"[WARN] model.val failed: {repr(e)}")
