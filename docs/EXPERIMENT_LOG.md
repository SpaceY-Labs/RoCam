# Experiment Log: 小目标火箭检测模型 边缘部署优化

> **上下文恢复指南**: 新会话请阅读本文件即可恢复所有方案状态、关键结论和下一步操作。
> **上次更新**: 2026-03-28 ~02:00 EDT

---

## Quick Status

**Baseline (smallrocket/train63)**: DS mAP50-95=0.631, mAP50=0.875, **mAP50-95(small)=0.341**

### Phase 1 方案 (全部已结论)

| 方案 | Val mAP50-95 | DS mAP50-95 | DS small | 结论 |
|------|-------------|-------------|----------|------|
| A - P2@高分辨率 | 0.765@960 | 0.525~0.526 | 0.146~0.150 | ❌ FP16 量化主因 |
| C - yolo26s@544 从头 | 0.543 | 0.499 | 0.238 | ❌ mosaic太低+lr太保守 |
| D - smallrocket@544 微调 | 0.684 | 0.641 | 0.312 | ⚠️ 整体好但小目标退步 |
| E - yolo26s@640 | 0.551 | 未测 | 未测 | ❌ 已停止 (同C问题) |
| F - smallrocket 小目标强化 | - | - | - | ❌ 已停止 (mosaic=0.30不够) |

### Phase 2 方案 (当前运行中)

| 方案 | GPU | Epoch | 策略 | 状态 |
|------|-----|-------|------|------|
| G - clone63 微调 | 2 | 14/150 | 复制 train63 配方, 微调 smallrocket@544 | 🔄 训练中 |
| **H - 从头小目标无敌** | 3 | 5/420 | train63+小目标增强 (erasing=0.5, scale=0.4, close_mosaic=100) | 🔄 训练中 |
| **I - 切片训练** | 0 | 缓存中 | 15832原图+34909tiles=50741混合, train63配方, 300ep | 🔄 缓存数据 |
| **J - Copy-Paste** | 1 | 4/420 | 自定义bbox copy-paste (3581 crops)+train63, 420ep | 🔄 训练中 |
| K - QAT | 2 | - | 量化感知微调 (G完成后) | ⏳ 等待 |

---

## Branch Map

| Branch | Repo | Purpose | GitHub |
|--------|------|---------|--------|
| `CV_planC_544` | CVimprove (Grace) | 所有 Plan C-K 训练代码 | ✅ PR #361 (Draft) |
| `experiment/planA_highres` | RoCam (Orin) | Plan A 部署验证代码 | ✅ PR #362 (Draft) |

## GitHub Push
PAT: `~/.git_pat` (chmod 600)
```
PAT=$(cat ~/.git_pat)
GIT_ASKPASS=echo git push https://${PAT}@github.com/SpaceY-Labs/RoCam.git CV_planC_544
```

---

## Core Problem & Root Cause

P2 模型 (maxvalue.pt) 训练 mAP=0.765@960, DeepStream FP16 仅 0.539@544x960.
标准模型 (smallrocket.pt) DS mAP=0.631, **反超 P2**.

**根因**: (1) 分辨率不匹配 960→544 (2) FP16 量化, P2 43K anchors 受损严重 (3) P2+FP16 是已知社区问题

---

## 关键发现: smallrocket (train63) 完整训练配置

| 参数 | train63 (smallrocket) | 我们之前的方案 |
|------|----------------------|--------------|
| **mosaic** | **1.0** | 0~0.30 |
| **lr0** | **0.01** | 0.0002 (差50x) |
| **epochs** | **420** | 80~300 |
| **cutmix** | **0.1** | 0.0 |
| **cos_lr** | **False** (线性) | True (余弦) |
| **close_mosaic** | **80** | 0~40 |
| **multi_scale** | **True** (544~960) | False |
| **erasing** | **0.4** | 0.15~0.35 |
| **shear** | **5.0** | 2.0~3.0 |
| **nbs** | **64** | 128 |
| **imgsz** | **[544, 960]** | 544 或 640 固定 |
| seed | 0 | 42 |

**核心结论**: mosaic=1.0 是小目标检测的关键——每张训练图4拼接,小目标出现频率翻倍.
高 lr0 让模型充分学习,线性衰减比余弦保持更久的学习能力.

来源: `/u50/loux8/datafrompega/runs/detect/train63/args.yaml`

---

## Phase 1 详细结果

### Plan A (❌ 不可行)
尝试提高 DeepStream 推理分辨率恢复 P2 精度.
- 544x960: mAP=0.539, small=0.149
- 736x960: mAP=0.525, small=0.150
- 816x960: mAP=0.526, small=0.146
结论: 提高分辨率无法恢复 P2, FP16 量化是主因.

### Plan C (❌ 全面落后)
yolo26s@544 从头训练, mosaic=0.15, lr0=0.0003, 300ep.
- Val: 0.543, DS: 0.499, small: 0.238
- 213ep 后趋平. 从头训练+低增强不够充分.

### Plan D (⚠️ 小目标退步)
smallrocket@544 微调, mosaic=0, lr0=0.00015, 80ep.
- Val: 0.684, DS: 0.641 (超baseline), small: 0.312 (低于baseline 0.341)
- 整体mAP提升但小目标退步. 关mosaic导致遗忘.

### Plan E (❌ 已停止)
yolo26s@640 从头, 200ep. Val: 0.551. 同C问题, 未做DS benchmark.

### Plan F (❌ 已停止)
smallrocket@544, mosaic=0.30, lr0=0.0002. 仍然太低, 注定不够.

---

## Phase 2 详细配置

### Plan G: clone63 微调
- model: smallrocket.pt, imgsz=544, batch=16, nbs=64
- lr0=0.005 (train63一半), lrf=0.01, cos_lr=False
- 150ep, patience=30
- mosaic=1.0, mixup=0.1, cutmix=0.1, erasing=0.4, scale=0.3
- close_mosaic=80, shear=5.0, degrees=180
- tmux: `planG_clone63`, GPU 2, 脚本: `train_planG_clone63.py`

### Plan H: 从头小目标无敌
- model: yolo26s.pt (COCO pretrained), imgsz=544, batch=64, nbs=64
- lr0=0.01, lrf=0.01, cos_lr=False
- **420ep**, patience=30
- mosaic=1.0, mixup=0.1, cutmix=0.1
- **erasing=0.5** (高于train63), **scale=0.4** (高于train63)
- **close_mosaic=100** (高于train63), shear=5.0
- multi_scale=False (锁定544)
- tmux: `planH_scratch`, GPU 3, 脚本: `train_planH_scratch.py`

### Plan I: 切片训练
- 数据: 15832原图 + 34909 tiles (544x544, overlap=20%) = **50741**混合
- model: yolo26s.pt, imgsz=544, batch=64
- train63 配方 (mosaic=1.0, lr0=0.01 等), 300ep
- tmux: `planI_tiled`, GPU 0, 脚本: `prepare_tiles.py`, `train_planI_tiled.py`

### Plan J: 自定义 BBox Copy-Paste
- 预提取 **3581 个小目标 crops** (sqrt_area<32px)
- SmallObjectCopyPaste: p=0.5, 每图粘贴1-3个crops, 边缘模糊
- monkey-patch 注入 Ultralytics 训练管线 ✅ 已确认生效
- model: yolo26s.pt, imgsz=544, train63 配方, 420ep
- tmux: `planJ_prep`, GPU 1, 脚本: `small_object_copypaste.py`, `train_planJ_copypaste.py`

---

## Model Inventory

| Model | Arch | imgsz | Val mAP50-95 | DS mAP50-95 | DS small | Location |
|-------|------|-------|-------------|-------------|----------|----------|
| maxvalue.pt | yolo26s-p2 (4head) | 960 | 0.765 | 0.539 | 0.149 | `runs/detect/v3_phase2/weights/best.pt` |
| **smallrocket.pt** | yolo26s (3head) | [544,960] | 0.694 | **0.631** | **0.341** | `datafrompega/models/smallrocket.pt` |
| planC | yolo26s | 544 | 0.543 | 0.499 | 0.238 | `runs/detect/planC_phase1/weights/best.pt` |
| planD | yolo26s | 960→544ft | 0.684 | 0.641 | 0.312 | `runs/detect/planD_finetune/weights/best.pt` |
| planE | yolo26s | 640 | 0.551 | - | - | `runs/detect/planE_640/weights/best.pt` |

---

## Orin 部署注意事项

### numpy PCG64 兼容性
Grace numpy 2.x vs Orin numpy 1.x → `torch.load` 失败.
**解决**: Grace导出ONNX (`export_onnx_grace.py`), 传ONNX到Orin.
`accuracy_benchmark.py` 支持 `--onnx` 参数.

### benchmark 代码验证
- `postprocess_by_image()` 每图保留最高置信度检测: 对本数据集正确 (每图1个GT)
- Val集 3118 张, 每张恰好 1 个标注
- conf=0.25 预过滤 → top-1 → COCOeval

---

## Data

- Dataset: `/u50/loux8/datafrompega/rocam_data_15000/data_15000/data.yaml`
- Train: 15832 images (4000 backgrounds, 25%)
- Val: 3378 images (3759 instances)
- 1 class: rocket
- 目标分布@544x960: 28% COCO-small, 11% ultra-small (<16px), 3.5% nano (<8px)
- Tiled dataset: `/u50/loux8/datafrompega/rocam_data_15000/data_tiled/data.yaml` (50741 images)

## Deployment

- Camera: 1920x1080@60fps (locked)
- nvinfer: auto-scales, maintain-aspect-ratio=1
- TensorRT FP16, custom NMS (libnvdsinfer_custom_impl_Yolo.so)
- Orin: 8GB unified, Jetson AGX Orin

## GitHub PRs

| PR | Branch | Status |
|----|--------|--------|
| [#361](https://github.com/SpaceY-Labs/RoCam/pull/361) | CV_planC_544 | Draft (experiment) |
| [#362](https://github.com/SpaceY-Labs/RoCam/pull/362) | experiment/planA_highres | Draft (experiment) |

## Decision Criteria

胜出模型必须:
1. DS mAP50-95 > 0.631 (超baseline)
2. **DS mAP50-95(small) > 0.341** (核心指标)
3. Orin FPS >= 60

## 实验时间线

| 时间 | 事件 |
|------|------|
| 03-27 ~14:00 | 启动 Plan A (Orin 高分辨率验证) + Plan C (yolo26s@544 从头) |
| 03-27 ~19:00 | Plan A 结论: 不可行. 启动 Plan D (smallrocket 微调) |
| 03-27 ~20:00 | 启动 Plan E (yolo26s@640) |
| 03-27 ~22:00 | Plan D 完成, DS benchmark: mAP=0.641, small=0.312 (退步) |
| 03-27 ~23:30 | 启动 Plan F (小目标强化). Plan C DS benchmark: mAP=0.499 |
| 03-28 ~00:00 | 关键发现: train63 配方分析, 找到失败根因 |
| 03-28 ~00:10 | 启动 Plan G (clone63 微调) |
| 03-28 ~00:25 | Phase 2 启动: 停止 C/F, 启动 H/I/J |
| 03-28 ~00:30 | Plan I tiles 预处理完成 (34909 tiles), 开始缓存 |
| 03-28 ~00:35 | Plan J crops 提取完成 (3581), 训练已注入 copy-paste |
| 03-28 ~02:00 | G=ep14, H=ep5, I=缓存中, J=ep4. 全部正常运行 |

## Next Steps

1. 🔄 Plan G/H/I/J 持续训练
2. Plan G (~150ep) 预计 ~6h 后完成 → DS benchmark → 如果好, Plan K (QAT)
3. Plan H (420ep) 预计 ~15h 后完成
4. Plan I (300ep, 50741图) 预计 ~20h 后完成
5. Plan J (420ep) 预计 ~15h 后完成
6. 每个完成后: Grace导出ONNX → scp → Orin DS benchmark
7. 胜者部署 + PR

---
*Last updated: 2026-03-28 ~02:00 EDT*
