# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-01-29
Purpose: YOLO26 training configuration with COCO negative samples and single-GPU setup (channel v2).
"""
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "2"
os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
os.environ["MKL_THREADING_LAYER"] = "GNU"
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["NCCL_IB_DISABLE"] = "0"
os.environ["NCCL_P2P_DISABLE"] = "0"
os.environ["NCCL_BLOCKING_WAIT"] = "0"

from ultralytics import YOLO
from pathlib import Path
import random, zipfile, urllib.request, shutil

# ========= 你的原始配置（保持不变） =========
DATA_YAML = "rocam_data_15000/data_15000/data.yaml"
IMG_H, IMG_W = 544, 960
MODEL     = "yolo26s.pt"
batch = 64

# ========= 新增：COCO 相关配置 =========
BASE_DIR         = Path(__file__).resolve().parent

# COCO 下载 & 解压的根目录（可以按需改）
COCO_ROOT        = BASE_DIR / "external" / "coco2017"

# 你的训练图片目录（一定要和 data.yaml 里的 train 对应上）
ROCAM_TRAIN_DIR  = BASE_DIR / "rocam_data_15000" / "data_15000" / "images" / "train"
# ✅ 新增：对应 labels/train（给 COCO 负样本创建空 label，更稳）
ROCAM_LABEL_TRAIN_DIR = BASE_DIR / "rocam_data_15000" / "data_15000" / "labels" / "train"

# 最多从 COCO 抽多少张图片作为负样本
COCO_NEG_MAX = 1000

# 只用 image 就够了（当负样本不用标注）
COCO_ZIPS = {
    "train2017.zip": "http://images.cocodataset.org/zips/train2017.zip",
    "val2017.zip":   "http://images.cocodataset.org/zips/val2017.zip",
}

def _download(url: str, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        print(f"[COCO] 已存在: {dst.name}，跳过下载")
        return
    print(f"[COCO] 正在下载 {dst.name} -> {dst}")
    urllib.request.urlretrieve(url, dst)
    print(f"[COCO] 下载完成: {dst.name}")

def ensure_coco_images():
    """
    下载并解压 COCO train/val 到 COCO_ROOT/images 下。
    只在第一次运行时真正下载和解压，之后检测到目录存在就直接跳过。
    """
    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"

    if train_dir.exists() and val_dir.exists():
        print("[COCO] train2017 / val2017 已存在，跳过下载和解压")
        return

    COCO_ROOT.mkdir(parents=True, exist_ok=True)
    images_dir.mkdir(parents=True, exist_ok=True)

    for fname, url in COCO_ZIPS.items():
        zip_path = COCO_ROOT / fname
        _download(url, zip_path)
        print(f"[COCO] 正在解压 {fname}")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(images_dir)
        zip_path.unlink()  # 解压后删除 zip 节省空间
        print(f"[COCO] 解压完成并删除压缩包: {fname}")

def prepare_coco_negatives():
    """
    从 COCO train2017/val2017 里随机抽一些图，拷贝到你的 train 目录，
    并创建空 label 文件 → 作为纯背景负样本（更稳）。

    注意：只做一次，会在 train 目录下写一个 .coco_neg_done 标记文件。
    """
    if not ROCAM_TRAIN_DIR.exists():
        raise FileNotFoundError(f"[COCO] 找不到你的训练图片目录: {ROCAM_TRAIN_DIR}")

    sentinel = ROCAM_TRAIN_DIR / ".coco_neg_done"
    if sentinel.exists():
        print("[COCO] 负样本已经准备过了，跳过这一阶段")
        return

    images_dir = COCO_ROOT / "images"
    train_dir  = images_dir / "train2017"
    val_dir    = images_dir / "val2017"
    if not (train_dir.exists() and val_dir.exists()):
        raise FileNotFoundError("[COCO] 请先调用 ensure_coco_images() 完成下载和解压")

    all_imgs = list(train_dir.glob("*.jpg")) + list(val_dir.glob("*.jpg"))
    if not all_imgs:
        raise RuntimeError("[COCO] 在 train2017/val2017 里没有找到 jpg 图片")

    n = min(COCO_NEG_MAX, len(all_imgs))
    print(f"[COCO] 一共找到 {len(all_imgs)} 张 COCO 图片，将抽取 {n} 张作为负样本")

    random.seed(0)
    sample = random.sample(all_imgs, n)

    ROCAM_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    ROCAM_LABEL_TRAIN_DIR.mkdir(parents=True, exist_ok=True)

    for i, src in enumerate(sample, 1):
        # 为避免命名冲突，统一增加前缀
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)

        # ✅ 创建空 label 文件（保证负样本一定被当作背景参与训练）
        empty_label = ROCAM_LABEL_TRAIN_DIR / f"{dst.stem}.txt"
        empty_label.touch(exist_ok=True)

        if i % 1000 == 0 or i == n:
            print(f"[COCO] 已拷贝 {i}/{n} 张")

    sentinel.touch()
    print("[COCO] 负样本准备完成！下次不会重复拷贝")


# ========= 训练参数（最小化改动：偏小目标友好 + 利用 YOLO26 默认策略） =========
args = dict(
    data=DATA_YAML,
    imgsz=(IMG_H, IMG_W),
    batch=batch,
    epochs=420,
    cache='disk',
    device="0",
    workers=8,
    amp=True,

    # ✅ 让 YOLO26/Ultralytics 默认策略完全接管（更容易吃到 YOLO26 新训练策略）
    # cos_lr=True,

    rect=False,
    multi_scale=True,   # ✅ 小目标更友好（会稍慢）
    patience=30,
    seed=0,

    save_period=25,
    deterministic=False,

    # ---- 颜色抖动 ----
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,

    # ---- 几何增强（收敛一些，避免把小火箭“增强没了”）----
    degrees=180,         # 原 180 太激进
    flipud=0.5,         # 原 0.5 先关掉（上下翻转可能不符合真实分布）
    fliplr=0.5,
    shear=5.0,          # 原 10 太大
    perspective=0.0002, # 原 0.0005
    translate=0.05,     # 原 0.1
    scale=0.3,          # 原 0.6（过大会更常把目标缩小/出框）

    # ---- 组合型增强 ----
    mosaic=1.0,
    mixup=0.10,         # 原 0.05 稍微加一点
    cutmix=0.10,        # ✅ 更适合 detect（copy_paste 对 detect 不一定生效）
    copy_paste=0.0,     # 保留键但置 0，避免误以为 detect 生效
    close_mosaic=80,    # 原 150 关太早（你总共 420 epoch）
)

def attach_albumentations_if_available(train_args: dict):
    """
    ✅ 可选：加“成像退化类增强”（对小目标很关键）
    如果环境里没装 albumentations，会自动跳过，不影响训练。
    """
    try:
        import albumentations as A
    except Exception as e:
        print("[AUG] 未安装 albumentations，跳过额外成像增强。", repr(e))
        return train_args

    small_obj_aug = [
        A.MotionBlur(blur_limit=7, p=0.15),
        A.GaussianBlur(blur_limit=7, p=0.10),
        A.GaussNoise(var_limit=(10.0, 50.0), p=0.15),
        A.ImageCompression(quality_lower=40, quality_upper=95, p=0.20),
        A.RandomBrightnessContrast(p=0.20),
        A.RandomGamma(p=0.10),
        A.CLAHE(clip_limit=3.0, p=0.10),
    ]
    train_args = dict(train_args)
    train_args["augmentations"] = small_obj_aug
    print("[AUG] 已启用 Albumentations 成像增强（blur/noise/jpeg/亮度等）")
    return train_args

if __name__ == "__main__":
    # 1) 自动下载 & 解压 COCO（只会在第一次真下载）
    ensure_coco_images()

    # 2) 自动把 COCO 图片拷贝到你的 train 目录，当作负样本（只做一次）
    prepare_coco_negatives()

    # 3) 正常开始 YOLO 训练
    model = YOLO(MODEL)

    # ✅ 挂载可选增强（若没装 albumentations 自动跳过）
    train_args = attach_albumentations_if_available(args)

    try:
        results = model.train(**train_args)
    except Exception as e:
        # 某些新版本/新模型可能不接受 imgsz=(H,W) 这种 tuple
        # 这里做一个“只在失败时触发”的 fallback：用长边 imgsz + rect=True
        print("[WARN] model.train 失败，可能是 imgsz tuple 不兼容。错误如下：")
        print(e)
        print("[WARN] 尝试 fallback：imgsz=max(H,W) + rect=True 重新训练...")

        args2 = dict(train_args)
        args2["imgsz"] = max(IMG_H, IMG_W)  # 960
        args2["rect"] = True
        args2["multi_scale"] = False  # rect=True 时通常不和 multi_scale 一起用
        results = model.train(**args2)

    print("runs dir:", getattr(results, "save_dir", "see runs/detect/"))

    # 4) ✅ 用 YOLO26 的 one-to-many head 做验证（通常更偏精度）
    #    end2end=False => one-to-many（需要 NMS；一般更准）
    try:
        metrics = model.val(data=DATA_YAML, imgsz=(IMG_H, IMG_W), end2end=False)
        print("[VAL] one-to-many metrics:", metrics)
    except Exception as e:
        print("[WARN] model.val(one-to-many) 失败，可能是版本参数不兼容：", repr(e))
