"""Evaluation utilities for MaskTrackNet.

Metrics:
  J  - region similarity (IoU). Per frame.
  F  - boundary F-measure with tolerance = 0.008 * sqrt(H^2 + W^2). Per frame.
  J&F - average of J and F.

Inference modes:
  Mode A - fixed reference (frame 0 + gt mask 0); all later frames use the same ref.
  Mode B - previous-frame propagation (frame t uses frame t-1 + predicted mask t-1).

evaluate_davis_val(model, davis_root) returns mean J, F, J&F across the val set.
"""
from __future__ import annotations
from pathlib import Path
from typing import Callable
import numpy as np
import cv2
import torch
import torch.nn.functional as F
from PIL import Image
from tqdm import tqdm


def binarize_logits(logits: torch.Tensor, threshold: float = 0.5) -> torch.Tensor:
    return (torch.sigmoid(logits) >= threshold).float()


def compute_j(pred: np.ndarray, gt: np.ndarray) -> float:
    """Region similarity (Jaccard) between two boolean masks."""
    pred = pred.astype(bool)
    gt = gt.astype(bool)
    inter = np.logical_and(pred, gt).sum()
    union = np.logical_or(pred, gt).sum()
    if union == 0:
        return 1.0
    return float(inter / union)


def _mask_boundary(mask: np.ndarray, dilation: int = 1) -> np.ndarray:
    """Return boundary pixels of a binary mask via morphological gradient."""
    mask_u8 = mask.astype(np.uint8)
    k = dilation * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    dil = cv2.dilate(mask_u8, kernel)
    ero = cv2.erode(mask_u8, kernel)
    return (dil - ero).astype(bool)


def compute_f(pred: np.ndarray, gt: np.ndarray, tol_factor: float = 0.008) -> float:
    """Boundary F-measure with tolerance (in pixels) of tol_factor * diag."""
    H, W = gt.shape
    diag = float(np.sqrt(H * H + W * W))
    tol = max(1, int(round(tol_factor * diag)))

    pred_b = _mask_boundary(pred)
    gt_b = _mask_boundary(gt)

    if pred_b.sum() == 0 and gt_b.sum() == 0:
        return 1.0
    if pred_b.sum() == 0 or gt_b.sum() == 0:
        return 0.0

    # Dilate gt boundary by tolerance for matching
    k = tol * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    gt_b_dil = cv2.dilate(gt_b.astype(np.uint8), kernel).astype(bool)
    pred_b_dil = cv2.dilate(pred_b.astype(np.uint8), kernel).astype(bool)

    precision = (pred_b & gt_b_dil).sum() / pred_b.sum()
    recall = (gt_b & pred_b_dil).sum() / gt_b.sum()
    if precision + recall == 0:
        return 0.0
    return float(2 * precision * recall / (precision + recall))


def _pad_to_multiple(t: torch.Tensor, multiple: int = 32) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
    """Pad a (B,C,H,W) tensor with zeros so H and W are multiples of `multiple`.
    Returns (padded_tensor, (pad_l, pad_t, pad_r, pad_b)).
    """
    H, W = t.shape[-2], t.shape[-1]
    pad_h = (multiple - H % multiple) % multiple
    pad_w = (multiple - W % multiple) % multiple
    pad = (0, pad_w, 0, pad_h)
    return F.pad(t, pad, mode="constant", value=0.0), (0, 0, pad_w, pad_h)


def _unpad(t: torch.Tensor, orig_hw: tuple[int, int]) -> torch.Tensor:
    H, W = orig_hw
    return t[..., :H, :W]


@torch.no_grad()
def predict_pair(
    model: torch.nn.Module,
    ref_img: torch.Tensor, ref_mask: torch.Tensor, tgt_img: torch.Tensor,
) -> torch.Tensor:
    """Predict target_mask. Inputs are (1,3,H,W), (1,1,H,W), (1,3,H,W) on the
    same device. Pads to multiples of 32 internally."""
    device = next(model.parameters()).device
    ref_img = ref_img.to(device)
    ref_mask = ref_mask.to(device)
    tgt_img = tgt_img.to(device)

    ref_img_p, _ = _pad_to_multiple(ref_img)
    ref_mask_p, _ = _pad_to_multiple(ref_mask)
    tgt_img_p, _ = _pad_to_multiple(tgt_img)

    logits = model(ref_img_p, ref_mask_p, tgt_img_p)
    logits = _unpad(logits, (tgt_img.shape[-2], tgt_img.shape[-1]))
    return binarize_logits(logits)


def _load_video(davis_root: Path, video: str, ann_object_id: int = 1
                ) -> tuple[list[np.ndarray], list[np.ndarray]]:
    img_dir = davis_root / "JPEGImages" / "480p" / video
    ann_dir = davis_root / "Annotations" / "480p" / video
    img_paths = sorted(img_dir.glob("*.jpg"))
    ann_paths = sorted(ann_dir.glob("*.png"))
    images = [cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB) for p in img_paths]
    masks = [(np.array(Image.open(p)) == ann_object_id).astype(np.uint8) for p in ann_paths]
    return images, masks


def evaluate_davis_val(
    model: torch.nn.Module,
    davis_root: Path,
    val_videos: list[str],
    mode: str = "A",
    object_id: int = 1,
    progress: bool = True,
) -> dict[str, float]:
    """Run inference on all val videos and return mean J, F, J&F.

    Args:
        model: MaskTrackNet (already on a CUDA device, eval mode).
        davis_root: path to DAVIS root containing JPEGImages/480p and Annotations/480p.
        val_videos: list of video names (e.g. from ImageSets/2017/val.txt).
        mode: "A" for fixed reference (frame 0), "B" for previous-frame propagation.
        object_id: which object id in the palette PNG to track.
    """
    assert mode in ("A", "B")
    model.eval()
    js, fs = [], []

    iterator = tqdm(val_videos, desc=f"DAVIS-val Mode {mode}") if progress else val_videos
    for video in iterator:
        images, gt_masks = _load_video(davis_root, video, ann_object_id=object_id)
        if len(images) < 2:
            continue

        ref_img_t = torch.from_numpy(images[0].transpose(2, 0, 1)).float().div_(255.0).unsqueeze(0)
        ref_mask_t = torch.from_numpy(gt_masks[0]).float().unsqueeze(0).unsqueeze(0)

        prev_pred = ref_mask_t  # for Mode B

        for t in range(1, len(images)):
            tgt_img_t = torch.from_numpy(images[t].transpose(2, 0, 1)).float().div_(255.0).unsqueeze(0)

            if mode == "A":
                pred = predict_pair(model, ref_img_t, ref_mask_t, tgt_img_t)
            else:  # Mode B
                ref_img_b = torch.from_numpy(images[t - 1].transpose(2, 0, 1)).float().div_(255.0).unsqueeze(0)
                pred = predict_pair(model, ref_img_b, prev_pred, tgt_img_t)
                prev_pred = pred

            pred_np = pred[0, 0].cpu().numpy().astype(bool)
            gt_np = gt_masks[t].astype(bool)
            js.append(compute_j(pred_np, gt_np))
            fs.append(compute_f(pred_np, gt_np))

    j_mean = float(np.mean(js)) if js else 0.0
    f_mean = float(np.mean(fs)) if fs else 0.0
    return {"J": j_mean, "F": f_mean, "J&F": (j_mean + f_mean) / 2.0,
            "n_frames": len(js)}


def load_davis_val_videos(davis_root: Path) -> list[str]:
    """Read DAVIS-2017 val.txt; fall back to listing Annotations/ if missing."""
    val_txt = davis_root / "ImageSets" / "2017" / "val.txt"
    if val_txt.exists():
        return [v.strip() for v in val_txt.read_text().splitlines() if v.strip()]
    ann_root = davis_root / "Annotations" / "480p"
    return sorted(p.name for p in ann_root.iterdir() if p.is_dir())
