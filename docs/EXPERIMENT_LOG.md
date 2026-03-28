# Experiment Log: 小目标火箭检测模型 边缘部署优化

> **上下文恢复指南**: 如果在新会话中继续，阅读本文件即可了解所有方案状态、分支映射、关键结论和下一步操作。
> **上次更新**: 2026-03-28 ~01:45 EDT

---

## Quick Status

| 方案 | GPU | Epoch | Val mAP50-95 | DS Bench mAP50-95 | DS mAP50-95(small) | 状态 |
|------|-----|-------|-------------|-------------------|---------------------|------|
| A - maxvalue@P2 高分辨率 | Orin | - | 0.765@960 | 0.525~0.526 | 0.146~0.150 | ❌ 已结论: 不可行 |
| C - yolo26s@544 从头训练 | GPU 3 | 213/300 (P1) | 0.543 | 0.499 | 0.238 | ❌ 全面落后 baseline |
| D - smallrocket@544 微调 | GPU 0 | 80/80 ✅ | 0.684 | 0.641 | 0.312 | ⚠️ 整体好但小目标退步 |
| E - yolo26s@640 折中 | GPU 1 | 191/200 | 0.549 | - | - | 🔄 训练中, 即将完成 |
| F - smallrocket@544 小目标强化 | GPU 0 | 1/80 | - | - | - | 🔄 训练中 |

**Baseline (smallrocket.pt)**: DS mAP50-95=0.631, mAP50=0.875, mAP50-95(small)=0.341

---

## Branch Map

| Branch | Repo | Purpose | GitHub |
|--------|------|---------|--------|
| `CV_planC_544` | CVimprove (Grace) | Plan C/D/E/F 训练代码 | ✅ PR #361 (Draft) |
| `experiment/planA_highres` | RoCam (Orin) | Plan A 部署验证代码 | ✅ PR #362 (Draft) |
| `CV_yolo26` | CVimprove (Grace) | V3 pipeline baseline | ✅ exists |

## GitHub Push
PAT token stored locally at `~/.git_pat` (chmod 600, NOT in repo).
```
PAT=$(cat ~/.git_pat)
GIT_ASKPASS=echo git push https://${PAT}@github.com/SpaceY-Labs/CVimprove.git CV_planC_544
```

---

## Core Problem & Root Cause

P2 模型 (maxvalue.pt) 训练时 mAP50-95=0.765@960，但 DeepStream FP16 部署时仅 0.539@544x960。
标准模型 (smallrocket.pt) 部署时 mAP50-95=0.631@544x960，**反超 P2**。

**根因 (已确认)**:
1. 训练/部署分辨率不匹配 (960→544)：小目标从 17.7%→35.7% COCO-small
2. FP16 量化：P2 的 43K anchors 比标准的 8K anchors 受损更严重
3. 社区证实：P2 头在 FP16 TensorRT 下精度损失是已知问题

**结论**: 边缘 FP16 部署场景下，匹配分辨率训练的标准 3 头 yolo26s 是最佳选择。

---

## Plan A Results (❌ 已结论: 不可行)

尝试提高 DeepStream 推理分辨率来恢复 P2 精度。

| Resolution | mAP50-95 | mAP50 | mAP50-95(small) | Detections |
|-----------|----------|-------|-----------------|------------|
| 544x960 (baseline) | 0.539 | 0.791 | 0.149 | 2649/3118 |
| 736x960 | 0.525 | 0.782 | 0.150 | 2608/3118 |
| 816x960 | 0.526 | 0.782 | 0.146 | 2634/3118 |

**结论**: 增大分辨率无法恢复 P2 精度，FP16 量化损失是主因。Plan A 不可行。

---

## Plan C: yolo26s from scratch @ imgsz=544

**训练配置**:
- 模型: yolo26s.pt (pretrained), 3-head, stride=[8,16,32]
- imgsz=544, batch=64, nbs=128 (accumulate=2)
- SGD, lr0=0.0003, cos_lr, warmup=5ep
- Phase 1: 300ep, Phase 2: 100ep (lr0=0.0001)
- V3 augmentations: scale=0.25, erasing=0.30, mosaic=0.15, close_mosaic=40, 9x Albumentations
- tmux session: `planC_train`, GPU 3
- 脚本: `src/training/run_planC.bash`, `train_planC_phase1.py`, `train_planC_phase2.py`

**训练曲线** (来自 results.csv):
| Epoch | mAP50-95 | mAP50 |
|-------|----------|-------|
| 25 | 0.396 | 0.735 |
| 50 | 0.467 | 0.802 |
| 100 | 0.525 | 0.843 |
| 150 | 0.540 | 0.855 |
| 200 | 0.542 | 0.856 |
| 212 (最新) | 0.543 | 0.858 |

**观察**: 从 ep150 后 mAP 已趋于平稳 (0.540→0.543)，收益递减明显。

**DeepStream Benchmark** ✅ (通过 Grace 导出 ONNX → Orin TRT 编译，绕过 numpy 兼容问题):
| Metric | Plan C | smallrocket (baseline) |
|--------|--------|----------------------|
| mAP50-95 (all) | 0.499 | **0.631** |
| mAP50 | 0.790 | **0.875** |
| mAP50-95 (small) | 0.238 | **0.341** |
| mAP50-95 (medium) | 0.495 | - |
| mAP50-95 (large) | 0.568 | - |
| Detections | 2761/3118 | ~2929/3118 |

**结论**: 从头训练 213ep 不够充分，FP16 量化后全面落后 baseline。
从头训练路线可能需要更多 epoch 或更强的预训练策略才能追上 fine-tune 路线。

---

## Plan D: Fine-tune smallrocket @ imgsz=544 (⚠️ 小目标退步)

**训练配置**:
- 模型: smallrocket.pt (已在 960 训练的 yolo26s)
- imgsz=544, batch=64, nbs=128
- SGD, lr0=0.00015 (低 LR 微调), cos_lr, warmup=3ep
- 80 epochs, patience=25
- No mosaic/mixup, moderate augmentations
- tmux session: `planD_finetune` (已完成), GPU 0
- 脚本: `src/training/run_planD.bash`, `train_planD_finetune.py`

**训练结果**: Val mAP50-95=0.684, mAP50=0.935 (80 epochs)

**DeepStream Benchmark** ✅:
| Metric | smallrocket (baseline) | Plan D |
|--------|----------------------|--------|
| mAP50-95 (all) | 0.631 | **0.641** ✅ |
| mAP50 | 0.875 | **0.896** ✅ |
| mAP75 | - | 0.717 |
| mAP50-95 (small) | **0.341** | 0.312 ❌ |
| mAP50-95 (medium) | - | 0.631 |
| mAP50-95 (large) | - | 0.734 |
| Detections | ~2929 | 2929/3118 |

**结论**: 整体 mAP 提升 (+0.010)，但小目标 mAP 从 0.341 退步到 0.312 (-0.029)。
对于小目标为主的应用场景，**Plan D 不满足需求**。

---

## Plan E: yolo26s from scratch @ imgsz=640

**训练配置**:
- 模型: yolo26s.pt (pretrained, 3-head)
- imgsz=640, batch=32, nbs=128 (accumulate=4)
- SGD, lr0=0.0003, cos_lr, 200 epochs
- V3 augmentations (same as Plan C)
- tmux session: `planE_640`, GPU 1
- 脚本: `src/training/run_planE.bash`, `train_planE_640.py`

**Rationale**: 640 可能比 544 学到更好的小目标特征，部署时 DeepStream 会自动 resize 到 544x960。

**训练曲线** (来自 results.csv):
| Epoch | mAP50-95 | mAP50 |
|-------|----------|-------|
| 50 | 0.498 | 0.818 |
| 100 | 0.537 | 0.844 |
| 150 | 0.547 | 0.851 |
| 183 (最新) | 0.549 | 0.853 |

**观察**: mAP50-95 略高于 Plan C (0.549 vs 0.543), 也在趋于平稳。~1h 后完成。

---

## Plan F: smallrocket + 小目标强化微调 @ imgsz=544

**训练配置**:
- 模型: smallrocket.pt (fine-tune)
- imgsz=544, batch=64, nbs=128
- SGD, lr0=0.0002 (略高于 Plan D), cos_lr, warmup=3ep
- 80 epochs, patience=25
- **关键区别于 Plan D**: 开启激进小目标增强
  - mosaic=1.0 (全开), scale=0.5 (大范围缩放)
  - erasing=0.5 (高擦除率), mixup=0.0
- tmux session: `planF_small`, GPU 0
- 脚本: `src/training/run_planF.bash`, `train_planF_small.py`

**Rationale**: Plan D 关闭 mosaic 导致小目标退步。Plan F 反其道行之，大量使用 mosaic+scale 增大小目标比例。

**状态**: 刚启动 (ep 1/80), 预计 ~2-3h 后完成

---

## Model Inventory

| Model | Architecture | Heads | Train imgsz | Val mAP50-95 | DS mAP50-95 | DS small | Location |
|-------|-------------|-------|-------------|-------------|-------------|----------|----------|
| maxvalue.pt | yolo26s-p2 | 4 (P2) | 960 | 0.765 | 0.539 | 0.149 | `runs/detect/v3_phase2/weights/best.pt` |
| smallrocket.pt | yolo26s | 3 | 960 | ~0.70 | 0.631 | 0.341 | `datafrompega/models/smallrocket.pt` |
| planC best | yolo26s | 3 | 544 | 0.543 | 0.499 | 0.238 | `runs/detect/planC_phase1/weights/best.pt` |
| planD best | yolo26s | 3 | 960→544 ft | 0.684 | 0.641 | 0.312 | `runs/detect/planD_finetune/weights/best.pt` |
| planE (进行中) | yolo26s | 3 | 640 | 0.549 | - | - | `runs/detect/planE_640/weights/best.pt` |
| planF (进行中) | yolo26s | 3 | 960→544 ft | ~0.67 | - | - | `runs/detect/planF_small/weights/` |

---

## GPU Allocation (当前)

| GPU | Task | Status |
|-----|------|--------|
| 0 | Plan F (小目标强化微调) | 🔄 Running (ep 1/80) |
| 1 | Plan E (yolo26s@640) | 🔄 Running (ep 184/200) |
| 2 | (Other users) | - |
| 3 | Plan C (yolo26s@544) | 🔄 Running (ep 213/300) |

---

## Orin 部署注意事项

### numpy PCG64 兼容性问题
Grace (numpy 2.x) 与 Orin (numpy 1.x) 版本不一致导致 `torch.load` 反序列化失败。
**解决方案**: 在 Grace 上直接导出 DeepStream 兼容 ONNX (`export_onnx_grace.py`)，传 ONNX 到 Orin。
`accuracy_benchmark.py` 已新增 `--onnx` 参数支持直接传入 ONNX 文件。

### benchmark 代码验证 (2026-03-28)
- `postprocess_by_image()` 保留每图最高置信度检测: **对本数据集正确**
- Val 集 3118 张图，每张恰好 1 个标注物体，无多目标图
- `infer_probe` conf=0.25 预过滤 → `postprocess_by_image` top-1 → COCOeval

---

## GitHub PRs (EXPERIMENTAL - DO NOT MERGE)

| PR | Branch | Status | Label |
|----|--------|--------|-------|
| [#361](https://github.com/SpaceY-Labs/RoCam/pull/361) | CV_planC_544 | Draft | experiment |
| [#362](https://github.com/SpaceY-Labs/RoCam/pull/362) | experiment/planA_highres | Draft | experiment |

---

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

---

## Decision Criteria

胜出模型必须:
1. DeepStream mAP50-95 > 0.631 (超过 smallrocket baseline)
2. **mAP50-95 (small) > 0.341** (超过 smallrocket 的小目标能力 — 核心指标)
3. Orin FPS >= 60 (TensorRT FP16)

---

## Plan G: Clone train63 recipe, fine-tune smallrocket@544 (NEW - 关键方案)

**核心发现**: smallrocket (train63) 之所以小目标强，是因为用了与我们完全不同的训练策略:
- mosaic=1.0 (我们的方案最高才 0.30)
- lr0=0.01 (我们用 0.0002, 差了 50 倍)
- multi_scale=True + close_mosaic=80
- erasing=0.4, cutmix=0.1, shear=5.0
- 420 epochs (我们的微调只有 80)
- cos_lr=False (线性衰减, 非余弦)

**Plan G 策略**: 完全复制 train63 的增强配方, fine-tune smallrocket@544

**训练配置**:
- 模型: smallrocket.pt (fine-tune)
- imgsz=544, batch=16, nbs=64
- SGD, **lr0=0.005** (train63 一半, 微调折中), lrf=0.01
- **cos_lr=False** (匹配 train63)
- **150 epochs**, patience=30
- **mosaic=1.0**, mixup=0.1, cutmix=0.1, erasing=0.4, scale=0.3
- **close_mosaic=80** (匹配 train63)
- shear=5.0, degrees=180, perspective=0.0002
- train63 原版 Albumentations
- tmux session: `planG_clone63`, GPU 2
- 脚本: `src/training/run_planG.bash`, `train_planG_clone63.py`

**状态**: 🔄 训练中 (ep 1/150)

---

## 失败分析: 为什么 Plan C/D/F 都没打过 baseline

| 问题 | 影响 |
|------|------|
| **mosaic 太低** (0~0.30 vs baseline 1.0) | 小目标出现频率不够, 模型学不到足够的小目标特征 |
| **学习率太保守** (0.0002 vs 0.01) | 微调时模型参数几乎不动, 无法适应新分辨率 |
| **cos_lr=True** | 学习率末期过低, 不如 train63 的线性衰减 |
| **close_mosaic 过早** (0~40 vs 80) | 模型在精调阶段过早失去 mosaic 增强 |
| **训练轮数不足** (80 ep vs 420 ep) | 参数空间探索不充分 |
| **V3 方案过度"精巧"** | 9 种 Albumentations 复杂度高但对小目标贡献不如 mosaic |

---

## Phase 2: 全面突破计划 (2026-03-28 01:30 启动)

**Plan C/E/F 已停止** (已证明无效: mosaic 太低, lr 太保守)

### 新方案矩阵

| 方案 | GPU | 策略 | 状态 |
|------|-----|------|------|
| G - clone63 微调@544 | 2 | 复制 train63 配方微调 smallrocket, 150ep | 🔄 训练中 |
| **H - 从头@544 小目标无敌** | 3 | train63 配方+小目标增强, 420ep | 🔄 训练中 |
| **I - 切片训练** | 0 | 原图+tile 混合数据集+train63, 300ep | 🔄 预处理中 |
| **J - Copy-Paste** | 1 | 自定义 bbox copy-paste+train63, 420ep | 🔄 训练中 |
| K - QAT | 2 | 量化感知微调 (G 完成后) | ⏳ 等待 |

脚本: `train_planH_scratch.py`, `prepare_tiles.py`, `train_planI_tiled.py`,
`small_object_copypaste.py`, `train_planJ_copypaste.py`

## Next Steps

1. ⏳ 等待 Plan I tiles 预处理完成 → 自动开始训练
2. 🔄 Plan G/H/J 持续训练
3. 待做: 各方案完成后 → Grace 导出 ONNX → Orin DeepStream benchmark
4. 待做: Plan K (QAT, G 完成后)
5. 待做: 胜者部署 + PR

---
*Last updated: 2026-03-28 ~01:45 EDT*
