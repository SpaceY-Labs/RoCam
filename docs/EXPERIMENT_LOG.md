# Experiment Log: Plan A/C/D Parallel Validation

## Branch Map

| Branch | Repo | Purpose |
|--------|------|---------|
| `CV_planC_544` | CVimprove (Grace H100) | Plan C: yolo26s 3-head trained at imgsz=544 from scratch |
| `experiment/planA_highres` | RoCam (Orin) | Plan A: higher-res ONNX export for P2 model |
| `CV_yolo26` | CVimprove (Grace H100) | V3 pipeline (P2 model, imgsz=960) - baseline |

## Model Inventory

| Model | Architecture | Heads | Training imgsz | Best mAP50-95 (val@train_res) | Location |
|-------|-------------|-------|---------------|-------------------------------|----------|
| maxvalue.pt (V3 Phase 2) | yolo26s-p2 | 4 (P2) | 960 | 0.7651 | `/u50/loux8/datafrompega/runs/detect/v3_phase2/weights/best.pt` |
| smallrocket.pt | yolo26s | 3 | 960 | ~0.70 | `/u50/loux8/datafrompega/models/smallrocket.pt` |

## Problem Statement

P2 model (maxvalue.pt) achieves mAP50-95=0.773 at training resolution (960) but drops to 0.539 at deployment resolution (544x960) in DeepStream. Standard 3-head model (smallrocket) gets 0.631 at 544, beating P2 in deployment.

Root cause (confirmed by community + experiments):
1. Resolution mismatch (960 train → 544 deploy) shrinks small objects below P2's effective range
2. FP16 quantization degrades P2's 43K anchors more than standard model's 8K anchors
3. P2 head inherently trades large/medium object accuracy for small object focus

## Plan A: Higher Resolution Deployment (CONCLUDED)

### Results

| Resolution | mAP50-95 (all) | mAP50 | mAP50-95 (small) | mAP50-95 (medium) | mAP50-95 (large) | Detections |
|-----------|----------------|-------|-------------------|--------------------|--------------------|------------|
| 544x960 (baseline) | **0.539** | 0.791 | 0.149 | 0.514 | 0.656 | 2649/3118 |
| 736x960 | **0.525** | 0.782 | 0.150 | 0.509 | 0.637 | 2608/3118 |
| 816x960 | PENDING | - | - | - | - | - |

**Conclusion**: Increasing resolution did NOT help. P2 model's FP16 quantization loss dominates over resolution gains. Plan A is not viable.

## Plan C: Train Standard 3-Head at imgsz=544 (IN PROGRESS)

### Config
- Base model: `yolo26s.pt` (pretrained, 3-head)
- imgsz: 544, batch: 64, nbs: 128
- GPU: H100 #3
- Phase 1: 300 epochs, Phase 2: 100 epochs
- V3 augmentations (scale=0.25, erasing=0.30, 9x Albumentations)

### Training Progress (Phase 1)

| Epoch | mAP50-95 | mAP50 | Status |
|-------|----------|-------|--------|
| 1 | 0.030 | 0.067 | - |
| 5 | 0.167 | 0.454 | - |
| 10 | 0.282 | 0.608 | - |
| 15 | 0.325 | 0.672 | - |
| 20 | 0.367 | 0.700 | - |
| ~24 | 0.375 | 0.719 | LATEST |

Started: 2026-03-27 19:14 EDT | ETA Phase 1 done: ~03:00 AM | ETA Phase 2 done: ~05:30 AM

## Plan D: Fine-tune smallrocket.pt at imgsz=544 (IN PROGRESS)

### Config
- Base model: `smallrocket.pt` (already mAP50-95=0.631 on DeepStream)
- imgsz: 544, batch: 64, nbs: 128
- GPU: H100 #0
- 80 epochs, low LR (lr0=0.00015)
- Moderate augmentations (no mosaic/mixup, V3 Albumentations at 80% intensity)

### Rationale
smallrocket was trained at imgsz=960, so fine-tuning at 544 lets it adapt features to deployment resolution. Expected: 2-3 hours for quick improvement.

### Training Progress

| Epoch | mAP50-95 | mAP50 | Status |
|-------|----------|-------|--------|
| 1 | - | - | STARTED |

Started: 2026-03-27 19:48 EDT | ETA done: ~22:00 EDT

## GPU Allocation

| GPU | Task | Utilization |
|-----|------|------------|
| 0 | Plan D (smallrocket fine-tune) | 91% |
| 1 | (Other users) | 5% |
| 2 | (Other users) | 99% |
| 3 | Plan C (yolo26s from scratch) | 100% |

## Decision Criteria

The winning model must:
1. Achieve the highest mAP50-95 on DeepStream benchmark at 544x960
2. Maintain >= 60 FPS on Orin (TensorRT FP16)
3. Especially: mAP50-95 (small) should be maximized

## Key Insight

Community evidence + our experiments confirm: **for edge FP16 deployment, train at deployment resolution with standard 3-head architecture.** P2 head's theoretical advantage is eliminated by FP16 quantization and resolution downscaling.

---
*Last updated: 2026-03-27 19:55 EDT*
