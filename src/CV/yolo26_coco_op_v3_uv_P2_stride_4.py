# -*- coding: utf-8 -*-
"""
Author: Xiaotian Lou
Date: 2026-02-06
Purpose: YOLO26s-P2 (stride-4 detection head) training configuration with COCO negative samples (optimized v3).
"""
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "1,2,3"
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
# ✅ 使用 P2 小目标检测头变体：增加 stride=4 的高分辨率检测层
#    参数量几乎不变(9.8M vs 10M)，GFLOPs +22%（推理慢约 20%）
#    如果帧率不可接受，改回 "yolo26s.pt"
MODEL     = "yolo26s-p2.yaml"
batch = 192               # ✅ 3 卡 DDP：每卡 64

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
    imgsz=max(IMG_H, IMG_W),  # 960，与推理分辨率一致
    batch=batch,
    epochs=600,
    cache='disk',
    device="0,1,2",          # ✅ 3 卡 DDP（物理 GPU 1,2,3）
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

    # ---- 几何增强（收敛一些，避免把小火箭"增强没了"）----
    degrees=180,         # 原 180 太激进
    flipud=0.5,         # 原 0.5 先关掉（上下翻转可能不符合真实分布）
    fliplr=0.5,
    shear=5.0,          # 原 10 太大
    perspective=0.0002, # 原 0.0005
    translate=0.05,     # 原 0.1
    scale=0.15,          # ✅ 从 0.3→0.15：scale 过大会把小目标缩到几乎不可见

    # ---- 组合型增强 ----
    mosaic=0.8,          # ✅ 从 1.0→0.8：mosaic 把图缩到 1/4，对小目标不友好
    mixup=0.10,         # 原 0.05 稍微加一点
    cutmix=0.0,          # ✅ 从 0.10→0：cutmix 随机切矩形区域，容易切掉小目标
    copy_paste=0.0,     # 保留键但置 0，避免误以为 detect 生效
    close_mosaic=150,    # ✅ 从 80→150：最后 150 epoch 关闭 mosaic，在原始分辨率下精调小目标
)

def attach_albumentations_if_available():
    """
    ✅ 可选：加"成像退化类增强"（对小目标很关键）
    通过猴子补丁注入自定义增强管线，兼容 DDP 多卡训练。
    如果环境里没装 albumentations，会自动跳过，不影响训练。
    """
    try:
        import albumentations as A
        from ultralytics.data.augment import Albumentations
    except Exception as e:
        print("[AUG] 未安装 albumentations 或版本不兼容，跳过额外成像增强。", repr(e))
        return

    # 保存原始 __init__，用猴子补丁覆盖 Albumentations 类的初始化
    _orig_init = Albumentations.__init__

    def _custom_init(self, p=1.0):
        # 先调用原始初始化
        _orig_init(self, p=p)
        # 替换为自定义的增强管线
        self.transform = A.Compose([
            A.MotionBlur(blur_limit=7, p=0.15),
            A.GaussianBlur(blur_limit=7, p=0.10),
            A.GaussNoise(std_range=(0.01, 0.03), p=0.15),
            A.ImageCompression(quality_range=(40, 95), p=0.20),
            A.RandomBrightnessContrast(p=0.20),
            A.RandomGamma(p=0.10),
            A.CLAHE(clip_limit=3.0, p=0.10),
        ], bbox_params=A.BboxParams(format="yolo", min_visibility=0.0))
        print("[AUG] 已注入自定义 Albumentations 增强（blur/noise/jpeg/亮度等）")

    Albumentations.__init__ = _custom_init
    print("[AUG] 已配置自定义 Albumentations 管线（DDP 兼容）")

if __name__ == "__main__":
    # 1) 自动下载 & 解压 COCO（只会在第一次真下载）
    ensure_coco_images()

    # 2) 自动把 COCO 图片拷贝到你的 train 目录，当作负样本（只做一次）
    prepare_coco_negatives()

    # 3) 正常开始 YOLO 训练
    #    如果 MODEL 是 .yaml（如 P2 变体），从 yolo26s.pt 迁移预训练权重
    if MODEL.endswith(".yaml"):
        model = YOLO(MODEL).load("yolo26s.pt")
        print(f"[MODEL] 使用自定义架构 {MODEL}，已从 yolo26s.pt 迁移匹配层权重")
    else:
        model = YOLO(MODEL)

    # ✅ 挂载可选增强（猴子补丁方式，兼容 DDP）
    attach_albumentations_if_available()

    results = model.train(**args)

    print("runs dir:", getattr(results, "save_dir", "see runs/detect/"))

    # 4) ✅ 用 YOLO26 的 one-to-many head 做验证（通常更偏精度）
    #    end2end=False => one-to-many（需要 NMS；一般更准）
    try:
        metrics = model.val(data=DATA_YAML, imgsz=max(IMG_H, IMG_W), end2end=False)
        print("[VAL] one-to-many metrics:", metrics)
    except Exception as e:
        print("[WARN] model.val(one-to-many) 失败，可能是版本参数不兼容：", repr(e))
