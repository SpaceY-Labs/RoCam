# cv-v2: SiamMask-Lite Visual Query Object Segmentation

Real-time pixel-level object tracking driven by a **reference image** (not a text class label).
Designed for Jetson Orin Nano at 60 fps. Replaces the YOLO text-class detection in the RoCam pipeline.

## Key Difference from YOLO (cv-v1)

| | YOLO (cv-v1) | SiamMask-Lite (cv-v2) |
|---|---|---|
| Input | Text class: `"rocket"` | Image crop of the target |
| Output | Bounding box | Pixel mask + bbox + score |
| Customization | Retrain for new objects | Zero-shot: just show it |
| Multi-target | Detects all rockets | Tracks the specific one you clicked |
| Speed (Orin Nano FP16) | ~5ms | ~12ms |

## Project Structure

```
src/cv-v2/
├── models/
│   ├── backbone.py          # LiteBackbone — inverted residuals + SE attention (~300K params)
│   ├── correlation.py       # Depthwise cross-correlation + multi-scale FPN fusion
│   ├── mask_head.py         # MaskDecoder — mask + bbox + confidence prediction
│   └── siammask_lite.py     # Full model + SiamMaskLoss
├── data/
│   ├── dataset.py           # VOSDataset, YOLOBBoxDataset, augmentations
│   └── README.md            # ← Data download instructions
├── training/
│   └── train.py             # 3-phase training script
├── inference/
│   ├── tracker.py           # PyTorch tracker (dev / desktop testing)
│   ├── export_tensorrt.py   # ONNX + TensorRT export
│   └── trt_tracker.py       # TensorRT tracker (Jetson production)
├── scripts/
│   ├── download_davis.sh         # Auto-download DAVIS 2017 (~2.5GB)
│   ├── download_youtube_vos.sh   # Setup YouTube-VOS (~20GB, needs registration)
│   └── prepare_rocket_data.py    # Convert YOLO labels → training data + masks
├── configs/
│   └── default.yaml         # All hyperparameters
├── data/                    # ← gitignored, download locally
├── checkpoints/             # ← gitignored
├── engines/                 # ← gitignored (TensorRT .engine files)
└── requirements.txt
```

## Setup

```bash
cd src/cv-v2
pip install -r requirements.txt
```

## Step 1: Get Training Data

```bash
# DAVIS 2017 — auto-downloads, no account needed (~2.5GB, ~5 min)
bash scripts/download_davis.sh

# YouTube-VOS — largest VOS dataset, requires free registration
bash scripts/download_youtube_vos.sh --kaggle
# OR after downloading manually:
bash scripts/download_youtube_vos.sh --zip /path/to/train.zip

# Your existing YOLO rocket annotations
python scripts/prepare_rocket_data.py \
    --yolo-images ../../benchmark/models/<your_dataset>/images/train \
    --yolo-labels ../../benchmark/models/<your_dataset>/labels/train \
    --grabcut        # generates GrabCut pseudo-masks for Phase 2
```

## Step 2: Train (3 phases)

**Phase 1** — Pre-train on VOS datasets (desktop GPU recommended, ~12h on RTX 3080):
```bash
python -m training.train \
    --phase 1 \
    --vos-root data/youtube-vos/train data/DAVIS \
    --epochs 50 --batch-size 32 --lr 1e-3
```

**Phase 2** — Fine-tune on rocket YOLO data:
```bash
python -m training.train \
    --phase 2 \
    --checkpoint checkpoints/phase1_best.pth \
    --yolo-images data/rockets/images/train \
    --yolo-labels data/rockets/labels/train \
    --vos-root data/youtube-vos/train \
    --epochs 30 --batch-size 16 --lr 1e-4
```

**Phase 3** — Fine-tune on real mask annotations:
```bash
python -m training.train \
    --phase 3 \
    --checkpoint checkpoints/phase2_best.pth \
    --vos-root data/rockets-masks/train \
    --epochs 20 --batch-size 8 --lr 5e-5
```

## Step 3: Export to TensorRT (run on Jetson)

```bash
# Copy checkpoints/ to Jetson, then:
python -m inference.export_tensorrt \
    --checkpoint checkpoints/phase2_best.pth \
    --output-dir engines/ \
    --fp16
```

## Step 4: Benchmark

```bash
python -m inference.tracker --model checkpoints/phase2_best.pth --benchmark
```

Expected on Jetson Orin Nano FP16:
- Template encoding (one-time): ~5ms
- Per-frame tracking: ~12ms → **83 FPS capable**

## Integration with RoCam GStreamer Pipeline

The `TRTSiamMaskTracker` in `inference/trt_tracker.py` has the same interface
as the existing `CVProcess`. Replace the `nvinfer` probe callback with:

```python
from inference.trt_tracker import TRTSiamMaskTracker

tracker = TRTSiamMaskTracker(
    template_engine="engines/template_encoder.engine",
    tracking_engine="engines/tracking_engine.engine",
)

# When operator clicks target in web app:
tracker.initialize(frame, bbox=(x, y, w, h))

# In your GStreamer probe (replaces _inference_stop_probe):
result = tracker.update(frame)
if result:
    mask, bbox, score = result
    # mask: (H, W) uint8 — send via shader for overlay
    # bbox: (x, y, w, h) pixels — same as existing BoundingBox IPC message
```
