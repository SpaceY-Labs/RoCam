# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-02-08
Purpose: YOLO26s-P2 fine-tuning script for the close-mosaic phase after early stopping.

YOLO26s-p2 Fine-tuning Script -- Close-Mosaic Phase
=====================================================
Purpose: Complete the close_mosaic fine-tuning phase that was missed in train77 due to EarlyStopping.

train77 Recap:
  best epoch = 267   mAP50 = 0.920   mAP50-95 = 0.614
  close_mosaic=250 -> Originally planned to disable mosaic at epoch 350, but early stopping triggered at 317
  -> Mosaic was never disabled; the model always trained on 1/4 resolution mosaic images

Fine-tuning Strategy:
  1. Load from best.pt (ep267), fully disable mosaic/mixup
  2. Use a lower learning rate + cosine schedule to fine-tune at full resolution
  3. Retain geometric augmentation & albumentations imaging degradation augmentation
  4. Goal: Improve small-target localization accuracy, break through the mAP50-95 bottleneck

Learning Rate Design:
  train77 effective lr0 = 0.01 x (batch/nbs) = 0.01 x 3 = 0.03
  effective lr at epoch 267 ~ 0.017
  Fine-tuning uses ~1/3 of the plateau lr -> lr0=0.002 (effective ~ 0.006)
  cosine decay to lr0 x lrf = 0.002 x 0.05 = 0.0001
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

# ========= Path Configuration =========
BASE_DIR  = Path(__file__).resolve().parent
BEST_PT   = BASE_DIR / "runs" / "detect" / "train77" / "weights" / "best.pt"
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"
IMG_H, IMG_W = 544, 960

# ========= Fine-tuning Parameters =========
args = dict(
    data=DATA_YAML,
    imgsz=max(IMG_H, IMG_W),       # 960, consistent with inference resolution
    batch=192,                      # 4-GPU DDP, 48 per GPU (same as train77)
    epochs=100,                     # Fine-tuning does not need many epochs
    cache='disk',
    device="0,1,2,3",
    workers=8,
    amp=True,

    # ---- Learning Rate (core of fine-tuning) ----
    lr0=0.002,                      # 1/5 of train77; fine-tuning needs a low learning rate
    lrf=0.05,                       # final = 0.002 x 0.05 = 0.0001
    cos_lr=True,                    # cosine annealing is smoother than linear
    warmup_epochs=5,                # Slightly longer warmup for smooth transition to no-mosaic distribution

    # ---- Mosaic fully disabled (core purpose of fine-tuning) ----
    mosaic=0.0,                     # Disabled! Let the model see full-resolution images
    mixup=0.0,                      # Disabled! No more image mixing
    close_mosaic=0,                 # Mosaic already off, no need to close
    cutmix=0.0,                     # Disabled
    copy_paste=0.0,                 # Disabled

    # ---- Geometric Augmentation (retained, same as train77) ----
    degrees=180,                    # Rockets can point in any direction during flight
    flipud=0.5,                     # Rockets can face up or down
    fliplr=0.5,
    shear=5.0,
    perspective=0.0002,
    translate=0.05,
    scale=0.15,

    # ---- Color Augmentation (retained) ----
    hsv_h=0.015,
    hsv_s=0.6,
    hsv_v=0.4,

    # ---- Other Augmentation ----
    erasing=0.2,                    # Reduced from 0.4 to 0.2; less information occlusion during fine-tuning

    # ---- Training Control ----
    rect=False,                     # Same as train77
    multi_scale=True,               # Keep multi-scale; friendly for small targets
    patience=40,                    # Fine-tuning converges quickly, but allow enough observation window
    seed=0,
    deterministic=False,
    save_period=10,                 # Save checkpoint every 10 epochs
)


def attach_albumentations_if_available():
    """
    Inject custom imaging degradation augmentation (identical to train77).
    blur/noise/jpeg/brightness etc. are critical for small-target robustness; retained during fine-tuning.
    """
    try:
        import albumentations as A
        from ultralytics.data.augment import Albumentations
    except Exception as e:
        print("[AUG] albumentations not installed or version incompatible, skipping.", repr(e))
        return

    _orig_init = Albumentations.__init__

    def _custom_init(self, p=1.0):
        _orig_init(self, p=p)
        self.transform = A.Compose([
            A.MotionBlur(blur_limit=7, p=0.15),
            A.GaussianBlur(blur_limit=7, p=0.10),
            A.GaussNoise(std_range=(0.01, 0.03), p=0.15),
            A.ImageCompression(quality_range=(40, 95), p=0.20),
            A.RandomBrightnessContrast(p=0.20),
            A.RandomGamma(p=0.10),
            A.CLAHE(clip_limit=3.0, p=0.10),
        ], bbox_params=A.BboxParams(format="yolo", min_visibility=0.0))
        print("[AUG] Custom Albumentations augmentation injected (imaging degradation retained for fine-tuning)")

    Albumentations.__init__ = _custom_init
    print("[AUG] Albumentations pipeline ready (DDP compatible)")


if __name__ == "__main__":
    print("=" * 60)
    print("  YOLO26s-p2 Fine-tuning -- Close-Mosaic Phase")
    print(f"  Baseline model:  {BEST_PT}")
    print(f"  Dataset:         {DATA_YAML}")
    print(f"  Key changes:     mosaic=0  mixup=0  lr0=0.002  cos_lr=True")
    print("=" * 60)

    if not BEST_PT.exists():
        raise FileNotFoundError(f"Cannot find best.pt: {BEST_PT}")

    # Load best.pt directly (contains model architecture + weights, no .yaml needed)
    model = YOLO(str(BEST_PT))
    print(f"[MODEL] Loaded train77/best.pt (ep267  mAP50=0.920  mAP50-95=0.614)")

    # Attach albumentations (monkey-patch approach, compatible with multi-GPU DDP)
    attach_albumentations_if_available()

    # Start fine-tuning
    results = model.train(**args)

    save_dir = getattr(results, "save_dir", "see runs/detect/")
    print("=" * 60)
    print(f"  Fine-tuning complete! Results: {save_dir}")
    print("=" * 60)

    # Final validation (optional)
    try:
        metrics = model.val(data=DATA_YAML, imgsz=max(IMG_H, IMG_W))
        print(f"[VAL] Final metrics: {metrics}")
    except Exception as e:
        print(f"[WARN] Final validation failed: {repr(e)}")
