# -*- coding: utf-8 -*-
"""
YOLO26s-p2 精调脚本 — Close-Mosaic Phase
==========================================
目的：补上 train77 中因 EarlyStopping 而缺失的 close_mosaic 精调阶段。

train77 回顾：
  best epoch = 267   mAP50 = 0.920   mAP50-95 = 0.614
  close_mosaic=250 → 原计划 epoch 350 关闭 mosaic，但 317 就早停了
  → mosaic 从未关闭，模型始终在 1/4 分辨率拼接图上训练

精调策略：
  1. 从 best.pt (ep267) 加载，完全关闭 mosaic/mixup
  2. 用较低学习率 + cosine schedule 在全分辨率下精调
  3. 保留几何增强 & albumentations 成像退化增强
  4. 目标：提升小目标定位精度，突破 mAP50-95 瓶颈

学习率设计：
  train77 effective lr0 = 0.01 × (batch/nbs) = 0.01 × 3 = 0.03
  epoch 267 时 effective lr ≈ 0.017
  精调取 plateau lr 的 ~1/3 → lr0=0.002 (effective ≈ 0.006)
  cosine 衰减至 lr0×lrf = 0.002×0.05 = 0.0001
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

# ========= 路径配置 =========
BASE_DIR  = Path(__file__).resolve().parent
BEST_PT   = BASE_DIR / "runs" / "detect" / "train77" / "weights" / "best.pt"
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"
IMG_H, IMG_W = 544, 960

# ========= 精调参数 =========
args = dict(
    data=DATA_YAML,
    imgsz=max(IMG_H, IMG_W),       # 960，与推理分辨率一致
    batch=192,                      # 4 卡 DDP，每卡 48（与 train77 一致）
    epochs=100,                     # 精调不需要太长
    cache='disk',
    device="0,1,2,3",
    workers=8,
    amp=True,

    # ──── 学习率（精调核心）────
    lr0=0.002,                      # train77 的 1/5，精调需要低学习率
    lrf=0.05,                       # 终态 = 0.002 × 0.05 = 0.0001
    cos_lr=True,                    # cosine annealing 比线性更平滑
    warmup_epochs=5,                # 稍长热身，让模型平滑过渡到无 mosaic 分布

    # ──── mosaic 完全关闭（精调核心目的）────
    mosaic=0.0,                     # ★ 关闭！让模型看全分辨率原图
    mixup=0.0,                      # ★ 关闭！不再混合图片
    close_mosaic=0,                 # 已无 mosaic，无需 close
    cutmix=0.0,                     # 关闭
    copy_paste=0.0,                 # 关闭

    # ──── 几何增强（保留，与 train77 一致）────
    degrees=180,                    # 火箭飞行中任意朝向
    flipud=0.5,                     # 火箭可上可下
    fliplr=0.5,
    shear=5.0,
    perspective=0.0002,
    translate=0.05,
    scale=0.15,

    # ──── 颜色增强（保留）────
    hsv_h=0.015,
    hsv_s=0.6,
    hsv_v=0.4,

    # ──── 其他增强 ────
    erasing=0.2,                    # 从 0.4 降到 0.2，精调减少信息遮挡

    # ──── 训练控制 ────
    rect=False,                     # 与 train77 一致
    multi_scale=True,               # 保留多尺度，小目标友好
    patience=40,                    # 精调收敛快，但要给足够观察窗口
    seed=0,
    deterministic=False,
    save_period=10,                 # 每 10 轮存一次 checkpoint
)


def attach_albumentations_if_available():
    """
    注入自定义成像退化增强（与 train77 完全一致）。
    blur/noise/jpeg/亮度等对小目标鲁棒性很关键，精调阶段保留。
    """
    try:
        import albumentations as A
        from ultralytics.data.augment import Albumentations
    except Exception as e:
        print("[AUG] 未安装 albumentations 或版本不兼容，跳过。", repr(e))
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
        print("[AUG] 已注入自定义 Albumentations 增强（精调保留成像退化）")

    Albumentations.__init__ = _custom_init
    print("[AUG] Albumentations 管线已就绪（DDP 兼容）")


if __name__ == "__main__":
    print("=" * 60)
    print("  YOLO26s-p2 精调 — Close-Mosaic Phase")
    print(f"  基线模型:  {BEST_PT}")
    print(f"  数据集:    {DATA_YAML}")
    print(f"  核心变化:  mosaic=0  mixup=0  lr0=0.002  cos_lr=True")
    print("=" * 60)

    if not BEST_PT.exists():
        raise FileNotFoundError(f"找不到 best.pt: {BEST_PT}")

    # 直接加载 best.pt（已含模型结构 + 权重，无需指定 .yaml）
    model = YOLO(str(BEST_PT))
    print(f"[MODEL] 已加载 train77/best.pt (ep267  mAP50=0.920  mAP50-95=0.614)")

    # 挂载 albumentations（猴子补丁方式，兼容 DDP 多卡）
    attach_albumentations_if_available()

    # 开始精调
    results = model.train(**args)

    save_dir = getattr(results, "save_dir", "see runs/detect/")
    print("=" * 60)
    print(f"  精调完成！结果: {save_dir}")
    print("=" * 60)

    # 最终验证（可选）
    try:
        metrics = model.val(data=DATA_YAML, imgsz=max(IMG_H, IMG_W))
        print(f"[VAL] 最终指标: {metrics}")
    except Exception as e:
        print(f"[WARN] 最终验证失败: {repr(e)}")
