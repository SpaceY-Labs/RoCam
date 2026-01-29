# -*- coding: utf-8 -*-
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
    不生成 label 文件 → 作为纯背景负样本。

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
    for i, src in enumerate(sample, 1):
        # 为避免命名冲突，统一增加前缀
        dst = ROCAM_TRAIN_DIR / f"coco_neg_{i:06d}{src.suffix.lower()}"
        if not dst.exists():
            shutil.copy2(src, dst)
        if i % 1000 == 0 or i == n:
            print(f"[COCO] 已拷贝 {i}/{n} 张")

    sentinel.touch()
    print("[COCO] 负样本准备完成！下次不会重复拷贝")


# ========= 训练参数（尽量保持不变，仅做 YOLO26 关键调整） =========
# 关键调整：
# 1) 不强行指定 optimizer / lr0 / lrf / warmup 等，让 YOLO26/Ultralytics 默认策略接管
# 2) 保留 imgsz tuple；若新版本不兼容，则在 main 里自动 fallback

args = dict(
    data=DATA_YAML,
    imgsz=(IMG_H, IMG_W),
    batch=batch,
    epochs=420,
    cache='disk',
    device="0,1,2,3",
    workers=8,
    amp=True,
    cos_lr=True,

    rect=False,
    multi_scale=False,
    patience=30,
    seed=0,

    save_period=25,
    deterministic=False,

    # ---- 颜色抖动 ----
    hsv_h=0.015, hsv_s=0.6, hsv_v=0.4,

    # ---- 几何增强 ----
    degrees=180,
    flipud=0.5,
    fliplr=0.5,
    shear=10.0,
    perspective=0.0005,
    translate=0.1,
    scale=0.6,

    # ---- 组合型增强 ----
    mosaic=1.0,
    mixup=0.05,
    copy_paste=0.1,
    close_mosaic=150,
)

if __name__ == "__main__":
    # 1) 自动下载 & 解压 COCO（只会在第一次真下载）
    ensure_coco_images()

    # 2) 自动把 COCO 图片拷贝到你的 train 目录，当作负样本（只做一次）
    prepare_coco_negatives()

    # 3) 正常开始 YOLO 训练
    model = YOLO(MODEL)

    try:
        results = model.train(**args)
    except Exception as e:
        # 某些新版本/新模型可能不接受 imgsz=(H,W) 这种 tuple
        # 这里做一个“只在失败时触发”的 fallback：用长边 imgsz + rect=True
        print("[WARN] model.train 失败，可能是 imgsz tuple 不兼容。错误如下：")
        print(e)
        print("[WARN] 尝试 fallback：imgsz=max(H,W) + rect=True 重新训练...")

        args2 = dict(args)
        args2["imgsz"] = max(IMG_H, IMG_W)  # 960
        args2["rect"] = True
        results = model.train(**args2)

    print("runs dir:", getattr(results, "save_dir", "see runs/detect/"))
