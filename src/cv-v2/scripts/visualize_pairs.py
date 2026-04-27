"""Save 50 sample pairs from VOSPairDataset to disk for manual inspection.

Usage (from src/cv-v2/):
  python scripts/visualize_pairs.py \
      --davis-root data/DAVIS \
      --yt-vos-root data/youtube-vos \
      --out runs/visualization \
      --n 50 --out-size 384

Each sample is saved as a 2x2 grid: (ref_img, ref_mask_overlay, tgt_img, tgt_mask_overlay).
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import cv2

from data.dataset import VOSPairDataset, NegativePairWrapper


def _overlay(img_chw_float: "torch.Tensor", mask_1hw: "torch.Tensor") -> np.ndarray:
    img = (img_chw_float.numpy().transpose(1, 2, 0) * 255).astype(np.uint8)
    m = mask_1hw[0].numpy().astype(np.uint8)
    overlay = img.copy()
    overlay[m > 0] = (0.4 * overlay[m > 0] + 0.6 * np.array([255, 0, 0])).astype(np.uint8)
    return overlay


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--davis-root", type=Path, required=True)
    parser.add_argument("--yt-vos-root", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=Path("runs/visualization"))
    parser.add_argument("--n", type=int, default=50)
    parser.add_argument("--out-size", type=int, default=384)
    parser.add_argument("--neg-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    if args.yt_vos_root is not None and args.yt_vos_root.exists():
        ds_root, split, ann_split, max_gap = (
            args.yt_vos_root, "train/JPEGImages", "train/Annotations", 30
        )
    else:
        ds_root, split, ann_split, max_gap = (
            args.davis_root, "JPEGImages/480p", "Annotations/480p", 15
        )

    base = VOSPairDataset(
        root=ds_root, split=split, ann_split=ann_split,
        out_size=args.out_size, max_gap=max_gap, seed=args.seed, length=args.n,
    )
    ds = NegativePairWrapper(base, neg_ratio=args.neg_ratio, seed=args.seed + 1)

    for i in range(args.n):
        s = ds[i]
        ref_overlay = _overlay(s["reference_image"], s["reference_mask"])
        tgt_overlay = _overlay(s["target_image"], s["target_mask"])

        # 2x2 grid: top row ref+ref_overlay, bottom row tgt+tgt_overlay
        ref_img = (s["reference_image"].numpy().transpose(1, 2, 0) * 255).astype(np.uint8)
        tgt_img = (s["target_image"].numpy().transpose(1, 2, 0) * 255).astype(np.uint8)
        top = np.concatenate([ref_img, ref_overlay], axis=1)
        bot = np.concatenate([tgt_img, tgt_overlay], axis=1)
        grid = np.concatenate([top, bot], axis=0)
        cv2.imwrite(str(args.out / f"pair_{i:03d}.jpg"),
                    cv2.cvtColor(grid, cv2.COLOR_RGB2BGR))

    print(f"[visualize_pairs] wrote {args.n} samples to {args.out}")


if __name__ == "__main__":
    main()
