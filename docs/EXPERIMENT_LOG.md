# Experiment Log: Plan A/C/D Parallel Validation

> **上下文恢复指南**: 如果在新会话中继续，阅读本文件即可了解所有方案状态、分支映射、关键结论和下一步操作。

## Quick Status (最后更新: 2026-03-27 20:00 EDT)

| 方案 | GPU | Epoch | mAP50-95 | 状态 | 预计完成 |
|------|-----|-------|----------|------|---------|
| C - yolo26s@544 从头训练 | GPU 3 | 27/300 (P1) | 0.396 | 训练中 (tmux: planC_train) | 明早 ~05:30 |
| D - smallrocket@544 微调 | GPU 0 | 4/80 | ~0.673 | 训练中 (tmux: planD_finetune) | 今晚 ~22:00 |
| A - 816x960 P2 benchmark | Orin | - | - | engine 编译中 | ~30min |

## Branch Map

| Branch | Repo | Purpose | GitHub |
|--------|------|---------|--------|
| `CV_planC_544` | CVimprove (Grace) | Plan C+D 训练代码 | ✅ pushed |
| `experiment/planA_highres` | RoCam (Orin) | Plan A 部署验证代码 | ✅ pushed |
| `CV_yolo26` | CVimprove (Grace) | V3 pipeline (P2, imgsz=960) baseline | ✅ exists |

## GitHub Push
Use PAT token (stored locally, not in repo) with:
`GIT_ASKPASS=echo git push https://<PAT>@github.com/SpaceY-Labs/RoCam.git <branch>`

## Model Inventory

| Model | Architecture | Heads | Train imgsz | Best mAP50-95 | Location |
|-------|-------------|-------|-------------|---------------|----------|
| maxvalue.pt | yolo26s-p2 | 4 (P2) | 960 | 0.765 (val@960) | `datafrompega/runs/detect/v3_phase2/weights/best.pt` |
| smallrocket.pt | yolo26s | 3 | 960 | ~0.70 (val@960) | `datafrompega/models/smallrocket.pt` |
| planC best (进行中) | yolo26s | 3 | 544 | 0.396 (ep27) | `datafrompega/runs/detect/planC_phase1/weights/` |
| planD best (进行中) | yolo26s | 3 | 960→544 ft | ~0.673 (ep4) | `datafrompega/runs/detect/planD_finetune/weights/` |

## Core Problem & Root Cause

P2 模型 (maxvalue.pt) 训练时 mAP50-95=0.773@960，但 DeepStream 部署时仅 0.539@544x960。
标准模型 (smallrocket.pt) 部署时 mAP50-95=0.631@544x960，**反超 P2**。

**根因 (已确认)**:
1. 训练/部署分辨率不匹配 (960→544)：小目标从 17.7%→35.7% COCO-small
2. FP16 量化：P2 的 43K anchors 比标准的 8K anchors 受损更严重
3. 社区证实：P2 头在 FP16 TensorRT 下精度损失是已知问题

**结论**: 边缘 FP16 部署场景下，匹配分辨率训练的标准 3 头 yolo26s 是最佳选择。

## Plan A Results (已结论)

| Resolution | mAP50-95 | mAP50 | mAP50-95 (small) | Detections |
|-----------|----------|-------|-------------------|------------|
| 544x960 (baseline) | 0.539 | 0.791 | 0.149 | 2649/3118 |
| 736x960 | 0.525 | 0.782 | 0.150 | 2608/3118 |
| 816x960 | PENDING | - | - | - |

**结论**: 增大分辨率无法恢复 P2 精度，FP16 量化损失是主因。Plan A 不可行。

## Plan C: yolo26s from scratch @ imgsz=544

**训练配置**:
- 模型: yolo26s.pt (pretrained), 3-head, stride=[8,16,32]
- imgsz=544, batch=64, nbs=128 (accumulate=2)
- SGD, lr0=0.0003, cos_lr, warmup=5ep
- Phase 1: 300ep, Phase 2: 100ep (lr0=0.0001)
- V3 augmentations: scale=0.25, erasing=0.30, mosaic=0.15, close_mosaic=40, 9x Albumentations
- tmux session: `planC_train`, GPU 3
- 脚本: `src/training/run_planC.bash`, `train_planC_phase1.py`, `train_planC_phase2.py`

**训练曲线**:
| Epoch | mAP50-95 | mAP50 |
|-------|----------|-------|
| 1 | 0.030 | 0.067 |
| 5 | 0.167 | 0.454 |
| 10 | 0.282 | 0.608 |
| 15 | 0.325 | 0.672 |
| 20 | 0.367 | 0.700 |
| 25 | 0.396 | 0.735 |

## Plan D: Fine-tune smallrocket @ imgsz=544

**训练配置**:
- 模型: smallrocket.pt (已在 960 训练的 yolo26s)
- imgsz=544, batch=64, nbs=128
- SGD, lr0=0.00015 (低 LR 微调), cos_lr, warmup=3ep
- 80 epochs, patience=25
- No mosaic/mixup, moderate augmentations
- tmux session: `planD_finetune`, GPU 0
- 脚本: `src/training/run_planD.bash`, `train_planD_finetune.py`

## Data

- Dataset: `/u50/loux8/datafrompega/rocam_data_15000/data_15000/data.yaml`
- Train: 15832 images (4000 backgrounds)
- Val: 3378 images (3759 instances)
- 1 class: rocket

## Deployment Pipeline

- Camera: 1920x1080@60fps (locked)
- nvinfer: auto-scales to model input size, maintain-aspect-ratio=1
- TensorRT FP16, custom NMS (libnvdsinfer_custom_impl_Yolo.so)
- Orin: 8GB unified memory, Jetson AGX Orin

## Next Steps

1. ✅ Plan A 736x960 benchmark → 无改善
2. ⏳ Plan A 816x960 benchmark → Orin engine 编译中
3. ⏳ Plan D (smallrocket fine-tune) → ~2h 后出结果，快速验证
4. ⏳ Plan C Phase 1 → ~8h 后完成
5. 待做: Plan C Phase 2 (自动接续)
6. 待做: 胜者 DeepStream benchmark on Orin
7. 待做: 最终模型部署 + PR

## Decision Criteria

胜出模型必须:
1. DeepStream benchmark mAP50-95 > 0.631 (超过 smallrocket baseline)
2. Orin FPS >= 60 (TensorRT FP16)
3. mAP50-95 (small) 最大化

---
*Last updated: 2026-03-27 20:00 EDT*
