# -*- coding: utf-8 -*-
import os
from ultralytics import YOLO
from pathlib import Path
import random, zipfile, urllib.request, shutil

# 环境变量保持不变
os.environ["CUDA_VISIBLE_DEVICES"] = "0,1,2,3"
os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

# ========= 配置 =========
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"

# [改进1] 提高分辨率。小目标需要像素支撑。
# YOLO26 支持矩形训练，但在训练小目标时，正方形(1280)通常比长方形(544x960)更能保留细节
# 如果显存允许，建议直接上 1280；如果不行，保持 960 或 1024
IMG_H, IMG_W = 1024, 1024
MODEL = "yolo26s.pt"  # 确保下载的是 2026 最新权重
batch = 64  # 根据显存调整，YOLO26s 可能比 v11 稍大

# ... (COCO 下载与准备函数 download, ensure_coco_images, prepare_coco_negatives 保持不变，此处省略以节省篇幅) ...
# 请直接复制你原来的 COCO 相关函数代码到这里

# ========= 训练参数改进 (针对 YOLO26 & 小火箭) =========
args = dict(
    data=DATA_YAML,
    imgsz=IMG_H,  # 建议使用单一数值 1024/1280，让 YOLO 自动处理
    batch=batch,
    epochs=420,
    cache='disk',
    device="0,1,2,3",
    workers=16,  # 稍微调大一点，数据加载是小目标的瓶颈
    amp=True,

    # [YOLO26 特性]
    # YOLO26 默认使用 MuSGD (Muon + SGD) 混合优化器，建议设为 'auto' 让其自动选择
    optimizer='auto',

    # [关键调整：小目标增强策略]
    # 原来的 scale=0.6 会导致图片缩小到 40%，小火箭会消失。
    # 改为 0.25 或更小，意味着图片主要是在 [0.75x, 1.25x] 之间，或者稍微放大
    # 或者保持 0.5 但在 mosaic 中控制
    scale=0.4,

    # [关键调整：Copy-Paste]
    # 对于小目标，Copy-Paste 是神器。它把目标抠出来贴到其他图上，增加了小火箭的密度。
    # 建议大幅提高
    copy_paste=0.4,

    # [关键调整：关闭 Mixup]
    # Mixup 会让图像半透明重叠，极大破坏小目标的纹理特征，导致漏检。
    mixup=0.0,

    # Mosaic 是双刃剑。它把图变小了。
    # 必须配合 close_mosaic 使用，在最后阶段关掉 Mosaic，让模型看大图
    mosaic=1.0,
    close_mosaic=40,  # 提前 40 个 epoch 关闭 mosaic，让模型在全分辨率下微调

    # 几何增强
    degrees=180,  # 火箭方向任意，保持 180 很好
    flipud=0.5,
    fliplr=0.5,
    shear=2.0,  # 稍微减小剪切，避免小目标变形过度
    perspective=0.0002,  # 减小透视变换，太强烈的透视会让小目标扭曲成直线
    translate=0.1,

    # 训练稳定性
    patience=50,  # 给 YOLO26 多一点耐心，新 Loss 收敛可能波动
    cos_lr=True,
    save_period=20,

    # [YOLO26 新特性利用]
    # 如果你的显存够，开启 determinism 可能有助于调试，但通常 False 训练更快
    deterministic=False,
)

if __name__ == "__main__":
    # 1. COCO 准备 (你的原始逻辑)
    # ensure_coco_images()
    # prepare_coco_negatives()

    # 2. 加载 YOLO26
    # 注意：确保 ultralytics 库已更新到支持 YOLO26 的版本 (pip install -U ultralytics)
    model = YOLO(MODEL)

    # 3. 针对小火箭的特定层级冻结（可选进阶技巧）
    # 如果背景很复杂，可以尝试冻结 Backbone 的前几层，专注于细粒度特征
    # model.add_callback("on_train_start", freeze_layer1)

    print(f"开始训练 {MODEL}，分辨率: {IMG_H}x{IMG_W}，针对小目标优化配置...")

    try:
        results = model.train(**args)
    except Exception as e:
        print(f"[Error] 训练启动失败: {e}")
        print("尝试使用 rect=True 模式...")
        args["rect"] = True
        model.train(**args)