"""Image and mask augmentations for the cv-v2 data pipeline.

All ops accept numpy arrays (HWC uint8 image, HW uint8 mask) and return numpy
arrays of the same dtype/shape conventions. Randomness is controlled via an
explicit `rng` argument (np.random.Generator) so dataset-level seeding
remains reproducible.
"""
from __future__ import annotations
from typing import Optional
import numpy as np
import cv2


def bbox_from_mask(mask: np.ndarray) -> Optional[tuple[int, int, int, int]]:
    """Return (x0, y0, x1, y1) tight bbox of nonzero pixels, or None if empty."""
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop_with_context(
    image: np.ndarray,
    mask: np.ndarray,
    context_factor: float,
    out_size: int,
    scale_jitter: float,
    translate_jitter: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    """Crop a context-padded square around the mask object and resize to out_size.

    Args:
        image: HWC uint8 RGB.
        mask: HW uint8 binary {0, 1}.
        context_factor: square side length = context_factor * max(bbox_w, bbox_h).
        out_size: final H=W in pixels (multiple of 32).
        scale_jitter: fractional jitter on context side, e.g. 0.2 -> +/-20%.
        translate_jitter: fractional jitter on center, e.g. 0.15 -> +/-15% of side.
        rng: numpy random generator.

    Returns:
        (cropped_image, cropped_mask) both at (out_size, out_size, ...).
    """
    H, W = mask.shape
    bbox = bbox_from_mask(mask)
    if bbox is None:
        # No object: return centered random crop, mask stays zero.
        cy, cx = H // 2, W // 2
        side = min(H, W)
    else:
        x0, y0, x1, y1 = bbox
        bw, bh = x1 - x0, y1 - y0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        side = max(bw, bh) * context_factor

    if scale_jitter > 0:
        side *= 1.0 + rng.uniform(-scale_jitter, scale_jitter)
    if translate_jitter > 0:
        cx += rng.uniform(-translate_jitter, translate_jitter) * side
        cy += rng.uniform(-translate_jitter, translate_jitter) * side

    side = max(int(round(side)), 1)
    half = side // 2
    x0 = int(round(cx - half))
    y0 = int(round(cy - half))
    x1 = x0 + side
    y1 = y0 + side

    # Clamp to image, padding with zeros where needed.
    pad_l = max(0, -x0)
    pad_t = max(0, -y0)
    pad_r = max(0, x1 - W)
    pad_b = max(0, y1 - H)

    if any((pad_l, pad_t, pad_r, pad_b)):
        image = cv2.copyMakeBorder(
            image, pad_t, pad_b, pad_l, pad_r,
            cv2.BORDER_CONSTANT, value=(0, 0, 0),
        )
        mask = cv2.copyMakeBorder(
            mask, pad_t, pad_b, pad_l, pad_r,
            cv2.BORDER_CONSTANT, value=0,
        )
        x0 += pad_l
        y0 += pad_t
        x1 += pad_l
        y1 += pad_t

    crop_img = image[y0:y1, x0:x1]
    crop_mask = mask[y0:y1, x0:x1]

    crop_img = cv2.resize(crop_img, (out_size, out_size), interpolation=cv2.INTER_LINEAR)
    crop_mask = cv2.resize(crop_mask, (out_size, out_size), interpolation=cv2.INTER_NEAREST)

    return crop_img, crop_mask


def random_color_jitter(
    image: np.ndarray,
    brightness: float = 0.3,
    contrast: float = 0.3,
    saturation: float = 0.4,
    p_gray: float = 0.05,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    """Photometric jitter on uint8 RGB. Returns uint8 RGB."""
    rng = rng if rng is not None else np.random.default_rng()
    img = image.astype(np.float32)

    # Brightness: per-channel multiplicative
    if brightness > 0:
        b = 1.0 + rng.uniform(-brightness, brightness)
        img *= b

    # Contrast: pull toward mean
    if contrast > 0:
        c = 1.0 + rng.uniform(-contrast, contrast)
        mean = img.mean(axis=(0, 1), keepdims=True)
        img = (img - mean) * c + mean

    # Saturation: convert to HSV-ish via gray mix
    if saturation > 0:
        s = 1.0 + rng.uniform(-saturation, saturation)
        gray = img.mean(axis=2, keepdims=True)
        img = (img - gray) * s + gray

    # Random gray
    if p_gray > 0 and rng.random() < p_gray:
        gray = img.mean(axis=2, keepdims=True)
        img = np.broadcast_to(gray, img.shape).copy()

    return np.clip(img, 0, 255).astype(np.uint8)


def horizontal_flip_pair(
    image: np.ndarray, mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Flip image and mask along the horizontal axis (mirror left/right)."""
    return image[:, ::-1].copy(), mask[:, ::-1].copy()


def random_rotation_pair(
    image: np.ndarray,
    mask: np.ndarray,
    max_angle_deg: float,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray]:
    """Rotate image and mask together by a random angle in [-max, +max] degrees.

    Image uses bilinear interpolation; mask uses nearest neighbor to keep it
    binary. Border is filled with 0 (black image / empty mask). Output H/W
    are preserved (rotation is around image center, no scaling).

    Args:
        image: HWC uint8.
        mask:  HW  uint8 binary.
        max_angle_deg: rotation drawn uniformly from [-max, +max]. Set to 0
            to disable.
        rng: numpy random generator.
    """
    if max_angle_deg <= 0.0:
        return image, mask

    angle = float(rng.uniform(-max_angle_deg, max_angle_deg))
    H, W = image.shape[:2]
    M = cv2.getRotationMatrix2D((W / 2.0, H / 2.0), angle, 1.0)
    img_r = cv2.warpAffine(
        image, M, (W, H),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0),
    )
    mask_r = cv2.warpAffine(
        mask, M, (W, H),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT, borderValue=0,
    )
    return img_r, mask_r
