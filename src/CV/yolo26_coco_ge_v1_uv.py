# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-01-29
Purpose: YOLO26 training configuration with high-resolution input and small-target augmentation (general v1).
"""
import os
from ultralytics import YOLO
from pathlib import Path
import random, zipfile, urllib.request, shutil

# Environment variables unchanged
os.environ["CUDA_VISIBLE_DEVICES"] = "0,1,2,3"
os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

# ========= Configuration =========
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"

# [Improvement 1] Increase resolution. Small targets need more pixels.
# YOLO26 supports rectangular training, but for small targets, square (1280) usually preserves more detail than rectangular (544x960).
# If GPU memory allows, use 1280 directly; otherwise, keep 960 or 1024.
IMG_H, IMG_W = 1024, 1024
MODEL = "yolo26s.pt"  # Make sure to download the latest 2026 weights
batch = 64  # Adjust based on GPU memory; YOLO26s may be slightly larger than v11

# ... (COCO download and preparation functions: download, ensure_coco_images, prepare_coco_negatives remain unchanged; omitted here for brevity) ...
# Copy your original COCO-related function code here

# ========= Training Parameter Improvements (for YOLO26 & small rockets) =========
args = dict(
    data=DATA_YAML,
    imgsz=IMG_H,  # Recommend using a single value 1024/1280, let YOLO handle automatically
    batch=batch,
    epochs=420,
    cache='disk',
    device="0,1,2,3",
    workers=16,  # Slightly increased; data loading is a bottleneck for small targets
    amp=True,

    # [YOLO26 Features]
    # YOLO26 defaults to MuSGD (Muon + SGD) hybrid optimizer; recommend setting to 'auto' for automatic selection
    optimizer='auto',

    # [Key Adjustment: Small Target Augmentation Strategy]
    # The original scale=0.6 causes images to shrink to 40%, making small rockets disappear.
    # Change to 0.25 or smaller, meaning images mainly scale between [0.75x, 1.25x], or slightly enlarge.
    # Alternatively keep 0.5 but control it within mosaic.
    scale=0.4,

    # [Key Adjustment: Copy-Paste]
    # For small targets, Copy-Paste is a powerful tool. It crops targets and pastes them onto other images, increasing small rocket density.
    # Recommend increasing significantly.
    copy_paste=0.4,

    # [Key Adjustment: Disable Mixup]
    # Mixup causes semi-transparent image overlapping, severely destroying small target texture features and causing missed detections.
    mixup=0.0,

    # Mosaic is a double-edged sword. It makes images smaller.
    # Must be used with close_mosaic to disable mosaic in the final phase, letting the model see full-size images.
    mosaic=1.0,
    close_mosaic=40,  # Disable mosaic 40 epochs before the end, let model fine-tune at full resolution

    # Geometric Augmentation
    degrees=180,  # Rockets can point in any direction; keeping 180 is good
    flipud=0.5,
    fliplr=0.5,
    shear=2.0,  # Slightly reduce shear to avoid excessive small target deformation
    perspective=0.0002,  # Reduce perspective transform; too strong perspective distorts small targets into lines
    translate=0.1,

    # Training Stability
    patience=50,  # Give YOLO26 more patience; the new loss may have convergence fluctuations
    cos_lr=True,
    save_period=20,

    # [YOLO26 New Feature Usage]
    # If you have enough GPU memory, enabling determinism may help with debugging, but False is usually faster for training
    deterministic=False,
)

if __name__ == "__main__":
    # 1. COCO preparation (your original logic)
    # ensure_coco_images()
    # prepare_coco_negatives()

    # 2. Load YOLO26
    # Note: Ensure the ultralytics library is updated to a version that supports YOLO26 (pip install -U ultralytics)
    model = YOLO(MODEL)

    # 3. Layer-specific freezing for small rockets (optional advanced technique)
    # If background is complex, try freezing the first few backbone layers to focus on fine-grained features
    # model.add_callback("on_train_start", freeze_layer1)

    print(f"Starting training {MODEL}, resolution: {IMG_H}x{IMG_W}, optimized configuration for small targets...")

    try:
        results = model.train(**args)
    except Exception as e:
        print(f"[Error] Training failed to start: {e}")
        print("Trying with rect=True mode...")
        args["rect"] = True
        model.train(**args)