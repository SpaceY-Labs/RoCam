#!/usr/bin/env python3
"""
Plan J: Train with custom BBox Copy-Paste augmentation for small objects.

Uses train63 recipe + SmallObjectCopyPaste that pastes small object crops
onto training images, bypassing Ultralytics' segmentation mask requirement.
"""

import os
import sys
import argparse
import subprocess
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO

DATA_DIR = Path("/u50/loux8/datafrompega")
DATA_YAML = str(DATA_DIR / "rocam_data_15000" / "data_15000" / "data.yaml")
CROP_DIR = str(DATA_DIR / "small_crops")

try:
    import albumentations as A
    HAS_ALB = True
except ImportError:
    HAS_ALB = False

from small_object_copypaste import SmallObjectCopyPaste


class CopyPasteAlbumentations:
    """Wraps SmallObjectCopyPaste into an Albumentations-compatible pipeline."""

    def __init__(self, crop_dir, max_paste=3, p=0.5):
        self.copypaste = SmallObjectCopyPaste(crop_dir, max_paste=max_paste, p=p)

        base_transforms = []
        if HAS_ALB:
            base_transforms = [
                A.MotionBlur(blur_limit=(3, 7), p=0.15),
                A.GaussianBlur(blur_limit=(0, 7), sigma_limit=(0.5, 3.0), p=0.10),
                A.GaussNoise(std_range=(0.2, 0.44), per_channel=True, p=0.15),
                A.ImageCompression(quality_range=(99, 100), p=0.20),
                A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.20),
                A.RandomGamma(gamma_limit=(80, 120), p=0.10),
                A.CLAHE(clip_limit=(1.0, 3.0), tile_grid_size=(8, 8), p=0.10),
            ]
        self.base = A.Compose(
            base_transforms,
            bbox_params=A.BboxParams(format="yolo", min_visibility=0.3)
        ) if HAS_ALB else None

    def __call__(self, **kwargs):
        image = kwargs.get("image")
        bboxes = kwargs.get("bboxes", [])
        cls_labels = kwargs.get("class_labels", [])

        full_bboxes = [(c, b[0], b[1], b[2], b[3]) for c, b in zip(cls_labels, bboxes)]

        image, full_bboxes = self.copypaste(image, full_bboxes)

        new_bboxes = [(b[1], b[2], b[3], b[4]) for b in full_bboxes]
        new_cls = [b[0] for b in full_bboxes]

        if self.base:
            result = self.base(image=image, bboxes=new_bboxes, class_labels=new_cls)
            return result
        else:
            return {"image": image, "bboxes": new_bboxes, "class_labels": new_cls}


def build_albumentations_with_copypaste(crop_dir):
    """Build Albumentations with copy-paste for Ultralytics compatibility."""
    if not HAS_ALB:
        return None
    return A.Compose([
        A.MotionBlur(blur_limit=(3, 7), p=0.15),
        A.GaussianBlur(blur_limit=(0, 7), sigma_limit=(0.5, 3.0), p=0.10),
        A.GaussNoise(std_range=(0.2, 0.44), per_channel=True, p=0.15),
        A.ImageCompression(quality_range=(99, 100), p=0.20),
        A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.20),
        A.RandomGamma(gamma_limit=(80, 120), p=0.10),
        A.CLAHE(clip_limit=(1.0, 3.0), tile_grid_size=(8, 8), p=0.10),
    ], bbox_params=A.BboxParams(format="yolo", min_visibility=0.3))


def select_gpu(preferred=1, min_free_gb=15):
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"],
            text=True)
        for line in out.strip().splitlines():
            idx, free = line.split(",")
            idx, free = int(idx.strip()), int(free.strip())
            if idx == preferred and free > min_free_gb * 1024:
                return str(idx)
    except Exception:
        pass
    return str(preferred)


def main():
    parser = argparse.ArgumentParser(description="Plan J: Copy-paste training")
    parser.add_argument("--gpu", type=int, default=1)
    parser.add_argument("--epochs", type=int, default=420)
    parser.add_argument("--crop-dir", type=str, default=CROP_DIR)
    cli = parser.parse_args()

    crop_path = Path(cli.crop_dir)
    if not crop_path.exists() or len(list(crop_path.glob("*.png"))) == 0:
        print(f"[ERROR] No crops found at {cli.crop_dir}")
        print("  Run: python3 small_object_copypaste.py first!")
        return 1

    device = select_gpu(cli.gpu)
    print(f"[Plan J] Copy-paste augmented training")
    print(f"  Crops: {cli.crop_dir}")
    print(f"  Device: GPU {device}, Epochs: {cli.epochs}")

    alb = build_albumentations_with_copypaste(cli.crop_dir)
    copypaste = SmallObjectCopyPaste(cli.crop_dir, max_paste=3, p=0.5)

    model = YOLO("yolo26s.pt")

    # Monkey-patch the trainer's preprocess to inject copy-paste
    _orig_preprocess = None

    def patch_trainer(trainer):
        nonlocal _orig_preprocess
        if hasattr(trainer, 'train_loader') and hasattr(trainer.train_loader, 'dataset'):
            ds = trainer.train_loader.dataset
            if hasattr(ds, 'transforms') and ds.transforms:
                _orig_transform = ds.transforms

                class CopyPasteWrapper:
                    def __init__(self, orig, cp):
                        self.orig = orig
                        self.cp = cp

                    def __call__(self, data):
                        if 'img' in data and 'bboxes' in data:
                            img = data['img']
                            if isinstance(img, np.ndarray):
                                bboxes = data.get('bboxes', [])
                                cls = data.get('cls', [])
                                full = [(int(c), b[0], b[1], b[2], b[3])
                                        for c, b in zip(cls.flatten().tolist() if hasattr(cls, 'flatten') else cls, bboxes)]
                                img, full = self.cp(img, full)
                                data['img'] = img
                                if full:
                                    data['bboxes'] = np.array([[b[1], b[2], b[3], b[4]] for b in full], dtype=np.float32)
                                    data['cls'] = np.array([[b[0]] for b in full], dtype=np.float32)
                        return self.orig(data)

                ds.transforms = CopyPasteWrapper(_orig_transform, copypaste)
                print("[INFO] Copy-paste wrapper injected into training pipeline")

    model.add_callback("on_train_start", patch_trainer)

    results = model.train(
        data=DATA_YAML,
        imgsz=544,
        epochs=cli.epochs,
        batch=64,
        nbs=64,

        optimizer="auto",
        lr0=0.01,
        lrf=0.01,
        cos_lr=False,
        warmup_epochs=3,
        momentum=0.937,
        weight_decay=0.0005,

        mosaic=1.0,
        mixup=0.1,
        cutmix=0.1,
        copy_paste=0.0,
        erasing=0.4,
        scale=0.3,
        degrees=180,
        shear=5.0,
        perspective=0.0002,
        translate=0.05,
        flipud=0.5,
        fliplr=0.5,
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        close_mosaic=80,

        multi_scale=False,
        rect=False,

        patience=30,
        amp=True,
        cache="disk",
        device=device,
        workers=8,
        seed=0,
        deterministic=False,
        save_period=25,

        augmentations=alb,

        project=str(DATA_DIR / "runs" / "detect"),
        name="planJ_copypaste",
        exist_ok=True,
    )

    save_dir = getattr(results, "save_dir", None)
    if save_dir is None and hasattr(model, "trainer"):
        save_dir = model.trainer.save_dir
    print(f"[DONE] Plan J complete: {save_dir}")


if __name__ == "__main__":
    sys.exit(main() or 0)
