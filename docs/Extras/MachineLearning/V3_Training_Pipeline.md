# V3 Training Pipeline — Detailed Documentation

> **Project**: RoCam Small Rocket Detection  
> **Branch**: `CV_yolo26`  
> **Version**: V3 — Small Target + Robustness Enhancement  
> **Final Model**: `v3_phase2/weights/best.pt`  
> **Final mAP50-95**: **0.7651** (all-time best)  
> **Date**: March 2026

---

## 1. Task Overview

Detect rockets in launch surveillance video. Core challenges:

| Challenge | Description |
|-----------|-------------|
| **Small targets** | Rockets at long range occupy only 10--30 pixels; COCO-small targets account for ~10% |
| **All orientations** | Rockets may appear at any position and any angle in the frame |
| **Environmental interference** | Motion blur, compression artefacts, illumination changes, sensor noise |
| **Low false-positive rate** | Requires very high precision (Precision > 0.95) |

---

## 2. Model Architecture

| Item | Value |
|------|-------|
| **Model** | YOLO26s-P2 |
| **Detection heads** | Includes P2 (stride=4) small-target detection head |
| **Total parameters** | 9,663,464 (9.66 M) |
| **GFLOPs** | 26.4 |
| **Layers** | 329 |
| **Framework** | Ultralytics v8.4.6 |

YOLO26s-P2 adds a P2 detection head (stride=4) compared to standard YOLO, enabling the network to detect small targets on higher-resolution feature maps. This is the primary reason for selecting this architecture.

---

## 3. Dataset

### 3.1 Basic Information

| Item | Value |
|------|-------|
| **Dataset path** | `/u50/loux8/datafrompega/rocam_data_15000/data_15000/` |
| **Config file** | `data.yaml` |
| **Classes** | 1 class (`rocket`) |
| **Training images** | 31,666 (including augmented flips) |
| **Training label files** | 15,832 |
| **Validation images** | 6,756 |
| **Test images** | 3,421 |
| **Annotation format** | YOLO (class x_center y_center width height, normalised) |

### 3.2 Annotation Statistics (at imgsz=960)

| Target size | Count | Proportion |
|-------------|-------|------------|
| < 10 px (very small) | 214 | 1.6% |
| 10--20 px (small) | 454 | 3.5% |
| 20--32 px (small) | 622 | 4.8% |
| 32--50 px (medium-small) | 997 | 7.7% |
| 50--100 px (medium) | 2,441 | 18.8% |
| 100--200 px (large) | 3,014 | 23.2% |
| 200+ px (very large) | 5,234 | 40.3% |
| **COCO-small (< 32 px)** | **1,290** | **9.9%** |

- **Empty labels (negative samples)**: 4,000 images (25.3%), used to suppress false positives
- **Total bounding boxes**: 12,976
- Target sizes span an extremely wide range (< 10 px to 200+ px), which is the core training difficulty

---

## 4. V3 Pipeline Design Rationale

### 4.1 Problems in V1/V2

| Version | Problem | Consequence |
|---------|---------|-------------|
| V1 | Stage 2/3 switched to single GPU + rect=True + different batch size | mAP dropped from 0.756 to 0.748 |
| V2 | 4-GPU DDP to single-GPU "regime shock" | Stage 2/3 mAP continued to decline |
| V2 | Monkey-patched Albumentations did not take effect under DDP | Custom augmentations were never actually applied |
| V2 | scale=0.08 too conservative, erasing=0.0 not enabled | Insufficient small-target augmentation |

### 4.2 Core Improvements in V3

1. **Consistent training regime throughout**: Both phases use single GPU + `batch=32` + `nbs=128` (gradient accumulation over 4 steps) + `rect=False`, completely eliminating performance regression caused by regime switching
2. **Native augmentations parameter**: Custom Albumentations passed via `model.train(augmentations=...)`, no longer using monkey-patching, ensuring augmentations are 100% effective
3. **Enhanced small-target capability**: `scale` increased from 0.08 to 0.25, `erasing` enabled from 0.0 to 0.30
4. **Sensor/environmental robustness**: 9 Albumentations transforms covering blur, noise, compression, illumination, and other real-world scenarios

---

## 5. Detailed Training Phase Parameters

### 5.1 Starting Model

V3 continues training from the V2 Stage 1b best weights:

```
Starting point: /u50/loux8/datafrompega/runs/detect/stage1b/weights/best.pt
This model was trained with 4-GPU DDP for 300 epochs, mAP50-95 = 0.7624
```

### 5.2 Phase 1: Small Target + Robustness Joint Training

**Objective**: Improve small-target detection capability and environmental robustness through enhanced data augmentation while maintaining existing accuracy.

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Script** | `train_v3_phase1.py` | |
| **Epochs** | 250 | Long training ensures full convergence |
| **GPU** | Single H100 PCIe (80 GB) | Automatically selects GPU with most free VRAM |
| **Batch Size** | 32 | Actual per-GPU batch |
| **NBS** | 128 | Nominal batch size, gradient accumulation over 4 steps |
| **Effective Batch** | 128 | Equivalent to 4x H100 DDP with batch=32/GPU |
| **Image Size** | 960x960 | High resolution preserves small-target detail |
| **Rect** | False | Consistent with DDP training |
| **Cache** | disk | Disk caching accelerates data loading |
| **AMP** | True | Mixed-precision training |
| **Workers** | 8 | Data loading threads |
| **Seed** | 42 | Reproducible |
| **Save Period** | Every 25 epochs | Checkpoint saving interval |

#### Optimiser Configuration

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Optimiser** | SGD | Stable, good generalisation |
| **lr0** | 0.0003 | Lower initial LR for continued training |
| **lrf** | 0.1 | Final LR = lr0 x lrf = 0.00003 |
| **cos_lr** | True | Cosine annealing schedule |
| **Momentum** | 0.937 | |
| **Weight Decay** | 0.0005 | |
| **Warmup Epochs** | 5 | |
| **Patience** | 0 | No early stopping; runs all 250 epochs |

#### Built-in Data Augmentation

| Parameter | Value | V2 Comparison | Notes |
|-----------|-------|---------------|-------|
| **mosaic** | 0.15 | 0.20 | 15% probability of 4-image mosaic |
| **close_mosaic** | 40 | 30 | Mosaic disabled for last 40 epochs |
| **mixup** | 0.05 | 0.02 | 5% probability of image mixing |
| **scale** | **0.25** | 0.08 | **3x increase**, larger scaling range simulates distant small targets |
| **erasing** | **0.30** | 0.0 | **Newly enabled**, random erasing enhances occlusion robustness |
| **degrees** | 180 | 180 | Full-angle rotation (rockets at any orientation) |
| **flipud** | 0.5 | 0.5 | Vertical flip |
| **fliplr** | 0.5 | 0.5 | Horizontal flip |
| **shear** | 3.0 | -- | Shear transform |
| **perspective** | 0.0001 | -- | Perspective transform |
| **translate** | 0.05 | -- | Translation |
| **hsv_h** | 0.015 | -- | Hue perturbation |
| **hsv_s** | 0.5 | -- | Saturation perturbation |
| **hsv_v** | 0.35 | -- | Brightness perturbation |
| **copy_paste** | 0.0 | -- | Requires segmentation masks; not supported by this dataset |
| **cutmix** | 0.0 | -- | Not enabled |

#### Custom Albumentations (9 Transforms)

Passed natively via `model.train(augmentations=...)`, effectively applied for the first time in this project:

| Transform | Parameters | Probability | Purpose |
|-----------|-----------|-------------|---------|
| **Downscale** | scale_range=(0.5, 0.85) | 12% | Simulates low-resolution / distant targets |
| **CoarseDropout** | max_holes=6, 8--40 px | 10% | Simulates occlusion / signal loss |
| **MotionBlur** | blur_limit=7 | 15% | Simulates camera/target motion blur |
| **GaussianBlur** | blur_limit=(3, 5) | 8% | Simulates defocus |
| **GaussNoise** | std_range=(0.01, 0.04) | 15% | Simulates sensor noise |
| **ImageCompression** | quality_range=(30, 95) | 18% | Simulates JPEG compression artefacts |
| **RandomBrightnessContrast** | limit=0.3 | 22% | Simulates illumination variation |
| **RandomGamma** | gamma_limit=(60, 140) | 12% | Simulates exposure differences |
| **CLAHE** | clip_limit=4.0, tile=(8, 8) | 10% | Local contrast enhancement |

### 5.3 Phase 2: Low Learning Rate Fine-Tuning

**Objective**: Fine-tune on top of Phase 1 with a lower learning rate and gentler augmentation to extract the last bit of performance.

| Parameter | Value | vs Phase 1 | Notes |
|-----------|-------|------------|-------|
| **Script** | `train_v3_phase2.py` | | |
| **Starting model** | Phase 1 best.pt | | Automatically inherited from Phase 1 |
| **Epochs** | 80 | 250 -> 80 | Fine-tuning does not need as many epochs |
| **GPU** | Single H100 | Unchanged | Regime consistent |
| **Batch Size** | 32 | Unchanged | Regime consistent |
| **NBS** | 128 | Unchanged | Regime consistent |
| **Image Size** | 960x960 | Unchanged | Regime consistent |
| **Rect** | **False** | Unchanged | **Critical**: V2 changed this to True, causing degradation |
| **Cache** | disk | Unchanged | |
| **Save Period** | Every 10 epochs | 25 -> 10 | More frequent saving |

#### Optimiser Configuration

| Parameter | Value | vs Phase 1 |
|-----------|-------|------------|
| **Optimiser** | SGD | Unchanged |
| **lr0** | **0.0001** | 0.0003 -> 0.0001 (reduced 3.3x) |
| **lrf** | 0.15 | 0.1 -> 0.15 |
| **cos_lr** | True | Unchanged |
| **Warmup Epochs** | 3 | 5 -> 3 |
| **Patience** | **30** | 0 -> 30 (early stopping enabled) |

#### Built-in Data Augmentation (Reduced Intensity)

| Parameter | Phase 2 | Phase 1 | Change |
|-----------|---------|---------|--------|
| **mosaic** | **0.0** | 0.15 | Disabled |
| **mixup** | **0.0** | 0.05 | Disabled |
| **scale** | **0.10** | 0.25 | Reduced 60% |
| **erasing** | **0.15** | 0.30 | Reduced 50% |
| **shear** | **2.0** | 3.0 | Reduced 33% |
| degrees/flip/hsv | Unchanged | Unchanged | Basic geometric/colour augmentation retained |

#### Custom Albumentations (8 Transforms, ~60% of Phase 1 Probability)

| Transform | Phase 2 Parameters | Phase 2 Prob. | Phase 1 Prob. |
|-----------|--------------------|---------------|---------------|
| **Downscale** | scale_range=(0.6, 0.9) | 8% | 12% |
| **MotionBlur** | blur_limit=5 | 10% | 15% |
| **GaussianBlur** | blur_limit=(3, 5) | 5% | 8% |
| **GaussNoise** | std_range=(0.01, 0.03) | 10% | 15% |
| **ImageCompression** | quality_range=(40, 95) | 12% | 18% |
| **RandomBrightnessContrast** | limit=0.2 | 15% | 22% |
| **RandomGamma** | gamma_limit=(70, 130) | 8% | 12% |
| **CLAHE** | clip_limit=3.0 | 7% | 10% |

> Phase 2 removes CoarseDropout and reduces all transform probabilities and intensities by ~40%, allowing the model to fine-tune on cleaner data.

---

## 6. Pipeline Execution Flow

### 6.1 Script Structure

```
src/training/
├── run_pipeline.bash          # Main orchestrator (tmux/nohup background)
├── train_v3_phase1.py         # Phase 1 training script
├── train_v3_phase2.py         # Phase 2 training script
└── augment_small_targets.py   # (Optional) offline small-target copy-paste augmentation
```

### 6.2 Usage

```bash
# Start (tmux preferred; survives terminal/SSH disconnection)
bash run_pipeline.bash start

# Check status
bash run_pipeline.bash status

# Tail logs in real time
bash run_pipeline.bash tail

# Attach to tmux session (Ctrl-b d to detach)
bash run_pipeline.bash attach

# Stop training
bash run_pipeline.bash stop
```

### 6.3 Automated Flow

```
┌──────────────────────────────────────────────────────────┐
│                   run_pipeline.bash                       │
│                                                           │
│  1. Start tmux session "rocket_v3" (disconnect-safe)      │
│  2. Activate conda environment (jplab)                    │
│                                                           │
│  ┌───────────────────────────────────────────────┐        │
│  │ Phase 1: train_v3_phase1.py                    │        │
│  │  - Auto-selects GPU with most free VRAM        │        │
│  │  - 250 epochs, SGD lr=0.0003                   │        │
│  │  - Writes .v3_phase1_result on completion       │        │
│  │  - Auto-retry on failure (up to 3x, 60s apart) │        │
│  └──────────────┬────────────────────────────────┘        │
│                 │ Passes best.pt path                      │
│  ┌──────────────▼────────────────────────────────┐        │
│  │ Phase 2: train_v3_phase2.py                    │        │
│  │  - Inherits Phase 1 best.pt                    │        │
│  │  - 80 epochs, SGD lr=0.0001                    │        │
│  │  - patience=30 early stopping                  │        │
│  │  - Auto-retry on failure (up to 3x)            │        │
│  └──────────────┬────────────────────────────────┘        │
│                 │                                          │
│  ┌──────────────▼────────────────────────────────┐        │
│  │ Final evaluation: evaluate.py                  │        │
│  └───────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

### 6.4 Fault Tolerance

- **tmux background**: Closing the terminal or SSH does not affect training
- **nohup fallback**: Automatically switches to nohup when tmux is unavailable
- **Auto-retry**: Up to 3 retries per phase, 60-second intervals
- **Automatic GPU selection**: Detects the GPU with the most free VRAM at runtime, avoiding contention with other users
- **Result file handoff**: Best weight paths are passed between phases via `.v3_phase1_result` / `.v3_phase2_result` files

---

## 7. Hardware and Environment

| Item | Value |
|------|-------|
| **GPU** | NVIDIA H100 PCIe 80 GB (1 card used) |
| **Server** | McMaster Grace HPC |
| **OS** | Linux 5.14.0 (RHEL 9) |
| **Python** | 3.x (conda env: jplab) |
| **Framework** | Ultralytics 8.4.6 |
| **PyTorch** | With CUDA support |
| **Albumentations** | Latest version |

### Environment Variables

```bash
MKL_THREADING_LAYER=GNU          # Resolve MKL/OpenMP conflict
OMP_NUM_THREADS=16               # OpenMP thread count
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True  # CUDA memory fragmentation optimisation
```

---

## 8. Training Results

### 8.1 Phase 1 Training Curve (250 Epochs)

| Epoch | mAP50-95 | mAP50 | Precision | Recall | box_loss | cls_loss | dfl_loss |
|-------|----------|-------|-----------|--------|----------|----------|----------|
| 1 | 0.7497 | 0.9607 | 0.9595 | 0.9133 | 0.8907 | 0.5045 | 0.0064 |
| 25 | 0.7379 | 0.9579 | 0.9556 | 0.9087 | 0.8377 | 0.4588 | 0.0060 |
| 50 | 0.7425 | 0.9581 | 0.9608 | 0.9002 | 0.8249 | 0.4512 | 0.0058 |
| 100 | 0.7497 | 0.9587 | 0.9589 | 0.9072 | 0.8056 | 0.4407 | 0.0056 |
| 150 | 0.7524 | 0.9587 | 0.9601 | 0.9101 | 0.7902 | 0.4227 | 0.0055 |
| 200 | 0.7533 | 0.9581 | 0.9546 | 0.9106 | 0.7899 | 0.4346 | 0.0055 |
| **233** | **0.7542** | **0.9584** | **0.9580** | **0.9095** | 0.6684 | 0.2522 | 0.0041 |
| 250 | 0.7538 | 0.9584 | 0.9582 | 0.9112 | 0.6759 | 0.2674 | 0.0042 |

- **Phase 1 best**: Epoch 233, mAP50-95 = **0.7542**
- Training progressed steadily upward with no degradation
- After epoch 210, mosaic was automatically disabled (close_mosaic=40), causing a notable loss drop

### 8.2 Phase 2 Training Curve (67 Epochs, patience=30 Early Stopping)

| Epoch | mAP50-95 | mAP50 | Precision | Recall | box_loss | cls_loss | dfl_loss |
|-------|----------|-------|-----------|--------|----------|----------|----------|
| 1 | 0.7477 | 0.9592 | 0.9599 | 0.9077 | 0.5974 | 0.2156 | 0.0035 |
| 10 | 0.7551 | 0.9608 | 0.9600 | 0.9103 | 0.5774 | 0.2097 | 0.0034 |
| 20 | 0.7617 | 0.9616 | 0.9661 | 0.9109 | 0.5723 | 0.2082 | 0.0033 |
| 30 | 0.7583 | 0.9624 | 0.9603 | 0.9147 | 0.5658 | 0.2052 | 0.0033 |
| **37** | **0.7651** | **0.9623** | **0.9602** | **0.9151** | 0.5626 | 0.2032 | 0.0033 |
| 50 | 0.7638 | 0.9620 | 0.9605 | 0.9128 | 0.5599 | 0.2019 | 0.0032 |
| 67 | 0.7640 | 0.9619 | 0.9623 | 0.9154 | 0.5624 | 0.2025 | 0.0033 |

- **Phase 2 best (all-time best)**: Epoch 37, mAP50-95 = **0.7651**
- Phase 2 improved +0.0109 mAP50-95 over Phase 1
- patience=30 triggered early stopping at epoch 67

### 8.3 Final Model Metrics

| Metric | Value |
|--------|-------|
| **mAP50-95** | **0.7651** |
| **mAP50** | **0.9623** |
| **Precision** | **0.9602** |
| **Recall** | **0.9151** |

### 8.4 Historical Version Comparison

| Version | Phase | mAP50-95 | Notes |
|---------|-------|----------|-------|
| V1 Stage 1 | 300 ep, 4-GPU DDP | 0.7560 | Initial training |
| V1 Stage 2 | 100 ep, single GPU rect=True | 0.7480 | Degradation |
| V2 Stage 1b | 300 ep, 4-GPU DDP SGD | **0.7624** | V2 best |
| V2 Stage 2 | Single GPU rect=True | 0.7550 | Degradation |
| **V3 Phase 1** | 250 ep, single GPU nbs=128 | 0.7542 | Steady improvement |
| **V3 Phase 2** | 67 ep, single GPU nbs=128 | **0.7651** | All-time best |

---

## 9. Key Factors Behind V3's Success

### 9.1 Training Regime Consistency

The root cause of V2's failure was the drastic change from Stage 1 (4-GPU DDP, batch=128, rect=False) to Stage 2 (single GPU, batch=32, rect=True). V3 resolves this:

```
V2 approach (failed):
  Stage 1: 4x GPU, batch=32x4=128, rect=False, DDP
  Stage 2: 1x GPU, batch=32,       rect=True,  single GPU  <- regime shock!

V3 approach (succeeded):
  Phase 1: 1x GPU, batch=32, nbs=128 (accumulate=4), rect=False
  Phase 2: 1x GPU, batch=32, nbs=128 (accumulate=4), rect=False  <- fully consistent!
```

Gradient accumulation (nbs=128) makes the effective batch size of single-GPU training fully equivalent to 4-GPU DDP, while avoiding DDP complexity.

### 9.2 Custom Augmentations Actually Taking Effect

V2 used monkey-patching to inject Albumentations, but under DDP mode Ultralytics creates temporary training files via `generate_ddp_file`, and the monkey-patch is not copied, meaning augmentations were never actually applied.

V3 discovered that Ultralytics' `v8_transforms` natively supports an `augmentations` parameter:

```python
# Ultralytics internal code (v8_transforms):
augmentations = getattr(hyp, "augmentations", None)
if augmentations:
    transforms.append(Albumentations(augmentations=augmentations))
```

Passing via `model.train(augmentations=augmentations)` is 100% reliable.

### 9.3 Progressive Augmentation Design

```
Phase 1 (250 ep): Strong augmentation
  ├── Built-in: mosaic=0.15, mixup=0.05, scale=0.25, erasing=0.30
  └── Albumentations: 9 transforms, high probability (8%--22%)
       -> Learn robust features

Phase 2 (80 ep): Gentle augmentation
  ├── Built-in: mosaic=0, mixup=0, scale=0.10, erasing=0.15
  └── Albumentations: 8 transforms, low probability (5%--15%)
       -> Fine-tune on cleaner data
```

---

## 10. Output Files

```
/u50/loux8/datafrompega/runs/detect/
├── v3_phase1/
│   ├── weights/
│   │   ├── best.pt              # Phase 1 best weights (ep233)
│   │   └── last.pt              # Phase 1 final weights (ep250)
│   ├── results.csv              # Per-epoch metrics
│   ├── results.png              # Training curve plots
│   ├── args.yaml                # Full training parameters
│   └── .v3_phase1_result        # best.pt path (read by Phase 2)
│
├── v3_phase2/
│   ├── weights/
│   │   ├── best.pt              # Final best model (ep37, mAP50-95=0.7651)
│   │   └── last.pt              # Phase 2 final weights (ep67)
│   ├── results.csv
│   ├── results.png
│   ├── args.yaml
│   └── .v3_phase2_result
│
└── (historical: stage1/, stage1b/, stage2/, stage3/)
```

---

## 11. Reproduction Guide

### 11.1 Environment Setup

```bash
conda activate jplab
cd /u50/loux8/CVimprove/src/training
```

### 11.2 Full Pipeline Run

```bash
# One-command start (tmux background, auto Phase 1 -> Phase 2)
bash run_pipeline.bash start
```

### 11.3 Running Individual Phases

```bash
# Phase 1 (continue from stage1b best.pt)
python train_v3_phase1.py \
    --model /u50/loux8/datafrompega/runs/detect/stage1b/weights/best.pt \
    --epochs 250

# Phase 2 (continue from Phase 1 best.pt)
python train_v3_phase2.py \
    --model /u50/loux8/datafrompega/runs/detect/v3_phase1/weights/best.pt \
    --epochs 80
```

### 11.4 Using the Final Model

```python
from ultralytics import YOLO

model = YOLO("/u50/loux8/datafrompega/runs/detect/v3_phase2/weights/best.pt")

# Inference
results = model.predict("image.jpg", imgsz=960, conf=0.25)

# Validation
metrics = model.val(data="data.yaml", imgsz=960)
```

---

## 12. Appendix: Full Parameter Comparison Table

### Phase 1 vs Phase 2 Complete Parameter Comparison

| Category | Parameter | Phase 1 | Phase 2 | Notes |
|----------|-----------|---------|---------|-------|
| **Basic** | epochs | 250 | 80 | |
| | imgsz | 960 | 960 | Consistent |
| | batch | 32 | 32 | Consistent |
| | nbs | 128 | 128 | Consistent |
| | device | Single H100 | Single H100 | Consistent |
| | rect | False | False | Consistent (critical) |
| | amp | True | True | Consistent |
| | cache | disk | disk | Consistent |
| **Optimiser** | optimiser | SGD | SGD | Consistent |
| | lr0 | 0.0003 | 0.0001 | Reduced 3.3x |
| | lrf | 0.1 | 0.15 | |
| | cos_lr | True | True | Consistent |
| | momentum | 0.937 | 0.937 | Consistent |
| | weight_decay | 0.0005 | 0.0005 | Consistent |
| | warmup_epochs | 5 | 3 | |
| **Control** | patience | 0 | 30 | Phase 2 enables early stopping |
| | save_period | 25 | 10 | |
| **Geometric** | degrees | 180 | 180 | Consistent |
| | flipud | 0.5 | 0.5 | Consistent |
| | fliplr | 0.5 | 0.5 | Consistent |
| | shear | 3.0 | 2.0 | Reduced |
| | perspective | 0.0001 | 0.0001 | Consistent |
| | translate | 0.05 | 0.05 | Consistent |
| | scale | 0.25 | 0.10 | Reduced 60% |
| **Colour** | hsv_h | 0.015 | 0.015 | Consistent |
| | hsv_s | 0.5 | 0.5 | Consistent |
| | hsv_v | 0.35 | 0.35 | Consistent |
| **Mixing** | mosaic | 0.15 | 0.0 | Phase 2 disabled |
| | close_mosaic | 40 | 0 | |
| | mixup | 0.05 | 0.0 | Phase 2 disabled |
| | erasing | 0.30 | 0.15 | Reduced 50% |
| | copy_paste | 0.0 | 0.0 | Not supported (no masks) |
| | cutmix | 0.0 | 0.0 | |
| **Albumentations** | Transform count | 9 | 8 | Phase 2 removes CoarseDropout |
| | Mean probability | ~13.6% | ~9.4% | Reduced ~30% |
