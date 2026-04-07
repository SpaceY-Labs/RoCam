# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-01-29
Purpose: YOLO26 training configuration with COCO negative samples and single-GPU setup (channel v2).
"""
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "2"
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
MODEL     = "yolo26s.pt"
batch = 64

# ========= COCO-related Configuration =========
BASE_DIR         = Path(__file__).resolve().parent

# COCO download & extraction root directory (adjust as needed)
COCO_ROOT        = BASE_DIR / "external" / "coco2017"

# Training image directory (must match the train path in data.yaml)
ROCAM_TRAIN_DIR  = BASE_DIR / "rocam_data_15000" / "data_15000" / "images" / "train"
# Added: corresponding labels/train (create empty labels for COCO negatives for reliability)
ROCAM_LABEL_TRAIN_DIR = BASE_DIR / "rocam_data_15000" / "data_15000" / "labels" / "train"

# Maximum number of COCO images to sample as negative examples
COCO_NEG_MAX = 1000

# Only images are needed (negative samples do not require annotations)
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
    """
    Download and extract COCO train/val to COCO_ROOT/images.
    Only actually downloads and extracts on the first run; skips if directories already exist.
    """
    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"

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
    Randomly sample images from COCO train2017/val2017, copy them to your train directory,
    and create empty label files -> serving as pure background negative samples (more reliable).

    Note: Only runs once; writes a .coco_neg_done sentinel file in the train directory.
    """
    if not ROCAM_TRAIN_DIR.exists():
        raise FileNotFoundError(f"[COCO] Cannot find training image directory: {ROCAM_TRAIN_DIR}")

    sentinel = ROCAM_TRAIN_DIR / ".coco_neg_done"
    if sentinel.exists():
        print("[COCO] Negative samples already prepared, skipping this step")
        return

    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"
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
    ROCAM_LABEL_TRAIN_DIR.mkdir(parents=True, exist_ok=True)

    for i, src in enumerate(sample, 1):
        # Add prefix to avoid naming conflicts
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)

        # Create empty label file (ensures negative samples are treated as background during training)
        empty_label = ROCAM_LABEL_TRAIN_DIR / f"{dst.stem}.txt"
        empty_label.touch(exist_ok=True)

        if i % 1000 == 0 or i == n:
            print(f"[COCO] Copied {i}/{n} images")

    sentinel.touch()
    print("[COCO] Negative sample preparation complete! Will not repeat on next run")


# ========= Training Parameters (minimal changes: small-target friendly + leverage YOLO26 defaults) =========
args = dict(
    data=DATA_YAML,
    imgsz=(IMG_H, IMG_W),
    batch=batch,
    epochs=420,
    cache='disk',
    device="0",
    workers=8,
    amp=True,

    # Let YOLO26/Ultralytics default strategy take over (easier to benefit from YOLO26 new training strategy)
    # cos_lr=True,

    rect=False,
    multi_scale=True,   # More friendly for small targets (slightly slower)
    patience=30,
    seed=0,

    save_period=25,
    deterministic=False,

    # ---- Color Jitter ----
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,

    # ---- Geometric Augmentation (toned down to avoid augmenting small rockets out of existence) ----
    degrees=180,         # Original 180 is too aggressive
    flipud=0.5,         # Original 0.5, disabled for now (vertical flip may not match real distribution)
    fliplr=0.5,
    shear=5.0,          # Original 10 too large
    perspective=0.0002, # Original 0.0005
    translate=0.05,     # Original 0.1
    scale=0.3,          # Original 0.6 (too large causes targets to shrink/go out of frame)

    # ---- Composite Augmentation ----
    mosaic=1.0,
    mixup=0.10,         # Original 0.05, slightly increased
    cutmix=0.10,        # Better suited for detection (copy_paste may not work for detection)
    copy_paste=0.0,     # Keep key but set to 0; avoid assuming it works for detection
    close_mosaic=80,    # Original 150 was too early (total 420 epochs)
)

def attach_albumentations_if_available(train_args: dict):
    “””
    Optional: Add imaging degradation augmentation (critical for small targets).
    If albumentations is not installed, this is automatically skipped without affecting training.
    “””
    try:
        import albumentations as A
    except Exception as e:
        print("[AUG] albumentations not installed, skipping extra imaging augmentation.", repr(e))
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
    print("[AUG] Albumentations imaging augmentation enabled (blur/noise/jpeg/brightness etc.)")
    return train_args

if __name__ == "__main__":
    # 1) Auto-download & extract COCO (only actually downloads on first run)
    ensure_coco_images()

    # 2) Auto-copy COCO images to train directory as negative samples (only once)
    prepare_coco_negatives()

    # 3) Start YOLO training
    model = YOLO(MODEL)

    # Attach optional augmentation (auto-skipped if albumentations is not installed)
    train_args = attach_albumentations_if_available(args)

    try:
        results = model.train(**train_args)
    except Exception as e:
        # Some newer versions/models may not accept imgsz=(H,W) tuple
        # This fallback only triggers on failure: use long-edge imgsz + rect=True
        print(“[WARN] model.train failed, possibly imgsz tuple incompatibility. Error:”)
        print(e)
        print(“[WARN] Trying fallback: imgsz=max(H,W) + rect=True for retraining...”)

        args2 = dict(train_args)
        args2["imgsz"] = max(IMG_H, IMG_W)  # 960
        args2["rect"] = True
        args2["multi_scale"] = False  # rect=True is usually not used together with multi_scale
        results = model.train(**args2)

    print("runs dir:", getattr(results, "save_dir", "see runs/detect/"))

    # 4) Validate using YOLO26's one-to-many head (typically more accuracy-oriented)
    #    end2end=False => one-to-many (requires NMS; generally more accurate)
    try:
        metrics = model.val(data=DATA_YAML, imgsz=(IMG_H, IMG_W), end2end=False)
        print("[VAL] one-to-many metrics:", metrics)
    except Exception as e:
        print("[WARN] model.val(one-to-many) failed, possibly version/parameter incompatibility:", repr(e))
