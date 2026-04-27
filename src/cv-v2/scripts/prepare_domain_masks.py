"""Convert YOLO bbox-labeled frames into VOS-format mask data for domain fine-tune.

Default mode: bbox-rectangle pseudo-masks (cheap, instant).
Optional --sam: SAM-assisted tight masks (slower, higher quality).

Output layout (DAVIS-style):
    <out>/JPEGImages/480p/<seq>/<frame>.jpg
    <out>/Annotations/480p/<seq>/<frame>.png   (palette PNG, value 1 = target)

Usage:
    cd src/cv-v2
    python scripts/prepare_domain_masks.py \
        --yolo-images data/rockets/images \
        --yolo-labels data/rockets/labels \
        --out data/rockets-masks \
        --bbox-mode rectangle      # or: --sam --sam-checkpoint sam_vit_b.pth

Expected YOLO label format: one .txt per .jpg, lines = "class cx cy w h" (normalized).
"""
from __future__ import annotations
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import cv2
from PIL import Image
from tqdm import tqdm


def yolo_line_to_xyxy(line: str, W: int, H: int) -> tuple[int, int, int, int] | None:
    parts = line.strip().split()
    if len(parts) < 5:
        return None
    _, cx, cy, w, h = parts[:5]
    cx, cy, w, h = float(cx), float(cy), float(w), float(h)
    x0 = int(round((cx - w / 2) * W))
    y0 = int(round((cy - h / 2) * H))
    x1 = int(round((cx + w / 2) * W))
    y1 = int(round((cy + h / 2) * H))
    return max(0, x0), max(0, y0), min(W, x1), min(H, y1)


def make_rectangle_mask(img_shape: tuple[int, int], boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
    H, W = img_shape
    mask = np.zeros((H, W), dtype=np.uint8)
    for (x0, y0, x1, y1) in boxes:
        mask[y0:y1, x0:x1] = 1
    return mask


def make_sam_mask(
    img: np.ndarray, boxes: list[tuple[int, int, int, int]], sam_predictor
) -> np.ndarray:
    """Use SAM to generate tight masks from each box, then OR them together."""
    H, W = img.shape[:2]
    sam_predictor.set_image(img)
    union = np.zeros((H, W), dtype=np.uint8)
    for box in boxes:
        masks, _, _ = sam_predictor.predict(
            box=np.array(box, dtype=np.float32), multimask_output=False,
        )
        union |= masks[0].astype(np.uint8)
    return union


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yolo-images", type=Path, required=True)
    parser.add_argument("--yolo-labels", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--bbox-mode", choices=["rectangle"], default="rectangle")
    parser.add_argument("--sam", action="store_true", help="use SAM instead of bbox-mode")
    parser.add_argument("--sam-checkpoint", type=Path, default=None)
    parser.add_argument("--sam-model-type", default="vit_b")
    parser.add_argument("--seq-name", default="seq00")
    parser.add_argument("--split", default="train", choices=["train", "val"])
    args = parser.parse_args()

    out_jpg = args.out / "JPEGImages" / "480p" / args.seq_name
    out_ann = args.out / "Annotations" / "480p" / args.seq_name
    out_jpg.mkdir(parents=True, exist_ok=True)
    out_ann.mkdir(parents=True, exist_ok=True)

    sam_predictor = None
    if args.sam:
        if args.sam_checkpoint is None:
            print("[error] --sam requires --sam-checkpoint", file=sys.stderr)
            sys.exit(1)
        from segment_anything import SamPredictor, sam_model_registry
        sam = sam_model_registry[args.sam_model_type](checkpoint=str(args.sam_checkpoint))
        sam_predictor = SamPredictor(sam.cuda())

    img_paths = sorted(args.yolo_images.glob("*.jpg")) + sorted(args.yolo_images.glob("*.png"))
    for img_path in tqdm(img_paths, desc="prepare_domain_masks"):
        label_path = args.yolo_labels / (img_path.stem + ".txt")
        if not label_path.exists():
            continue

        img = cv2.cvtColor(cv2.imread(str(img_path)), cv2.COLOR_BGR2RGB)
        H, W = img.shape[:2]
        boxes = []
        for line in label_path.read_text().splitlines():
            box = yolo_line_to_xyxy(line, W, H)
            if box is not None and box[2] > box[0] and box[3] > box[1]:
                boxes.append(box)
        if not boxes:
            continue

        if sam_predictor is not None:
            mask = make_sam_mask(img, boxes, sam_predictor)
        else:
            mask = make_rectangle_mask((H, W), boxes)

        # Copy frame, save palette mask
        shutil.copy(img_path, out_jpg / img_path.name)
        Image.fromarray(mask, mode="P").save(out_ann / (img_path.stem + ".png"))

    print(f"[done] wrote masks under {out_ann}")


if __name__ == "__main__":
    main()
