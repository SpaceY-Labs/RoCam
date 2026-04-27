"""Tests for data/augmentations.py."""
from __future__ import annotations
import numpy as np
import pytest
import torch

from data.augmentations import (
    crop_with_context,
    random_color_jitter,
    horizontal_flip_pair,
    random_rotation_pair,
    bbox_from_mask,
)


def test_bbox_from_mask_simple():
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[20:50, 30:80] = 1
    x0, y0, x1, y1 = bbox_from_mask(mask)
    assert (x0, y0, x1, y1) == (30, 20, 80, 50)


def test_bbox_from_mask_empty_returns_none():
    mask = np.zeros((50, 50), dtype=np.uint8)
    assert bbox_from_mask(mask) is None


def test_crop_with_context_centers_on_object():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[80:120, 80:120] = 1  # 40x40 object centered at (100, 100)

    crop_img, crop_mask = crop_with_context(
        img, mask, context_factor=2.5, out_size=128, scale_jitter=0.0,
        translate_jitter=0.0, rng=np.random.default_rng(0)
    )

    assert crop_img.shape == (128, 128, 3)
    assert crop_mask.shape == (128, 128)
    # Object should still be present after crop+resize
    assert crop_mask.sum() > 0


def test_crop_with_context_jitter_changes_output():
    img = np.zeros((200, 200, 3), dtype=np.uint8)
    img[80:120, 80:120] = 255
    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[80:120, 80:120] = 1

    rng1 = np.random.default_rng(0)
    rng2 = np.random.default_rng(42)
    out1, _ = crop_with_context(img, mask, 2.5, 128, 0.2, 0.15, rng1)
    out2, _ = crop_with_context(img, mask, 2.5, 128, 0.2, 0.15, rng2)
    assert not np.array_equal(out1, out2)


def test_random_color_jitter_keeps_shape_and_dtype():
    img = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
    out = random_color_jitter(img, rng=np.random.default_rng(0))
    assert out.shape == img.shape
    assert out.dtype == np.uint8


def test_horizontal_flip_pair_flips_image_and_mask_together():
    img = np.arange(100, dtype=np.uint8).reshape(10, 10, 1).repeat(3, axis=2)
    mask = np.zeros((10, 10), dtype=np.uint8)
    mask[:, 0] = 1  # leftmost column

    f_img, f_mask = horizontal_flip_pair(img, mask)
    assert (f_mask[:, -1] == 1).all()  # column moved to right
    assert (f_mask[:, :-1] == 0).all()
    np.testing.assert_array_equal(f_img[:, ::-1], img)


def test_random_rotation_pair_zero_angle_is_identity():
    img = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[20:40, 20:40] = 1

    rng = np.random.default_rng(0)
    out_img, out_mask = random_rotation_pair(img, mask, max_angle_deg=0.0, rng=rng)
    np.testing.assert_array_equal(out_img, img)
    np.testing.assert_array_equal(out_mask, mask)


def test_random_rotation_pair_preserves_shape_and_dtype():
    img = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[10:30, 10:30] = 1

    out_img, out_mask = random_rotation_pair(
        img, mask, max_angle_deg=30.0, rng=np.random.default_rng(0),
    )
    assert out_img.shape == img.shape
    assert out_mask.shape == mask.shape
    assert out_img.dtype == img.dtype
    assert out_mask.dtype == mask.dtype


def test_random_rotation_pair_keeps_mask_binary():
    """Mask must stay {0, 1} — uses NEAREST interpolation."""
    img = (np.random.rand(64, 64, 3) * 255).astype(np.uint8)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[20:44, 20:44] = 1

    _, out_mask = random_rotation_pair(
        img, mask, max_angle_deg=45.0, rng=np.random.default_rng(0),
    )
    unique = np.unique(out_mask)
    assert set(unique.tolist()).issubset({0, 1}), unique


def test_random_rotation_pair_rotates_image_and_mask_together():
    """A 90deg rotation of a corner blob lands the blob in the rotated corner.

    With a fixed angle of 90deg (max=90, rng forces choice), the top-left
    rectangle must end up at the top-right of the image (cv2 rotates CCW for
    positive angles → 90deg CCW puts top-left at bottom-left). Use any angle
    that is consistent for image + mask: verify that image and mask rotate
    *together* by checking both have the blob centered after the rotation.
    """
    img = np.zeros((64, 64, 3), dtype=np.uint8)
    img[10:30, 10:30] = 255   # white blob top-left of image
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[10:30, 10:30] = 1

    out_img, out_mask = random_rotation_pair(
        img, mask, max_angle_deg=180.0, rng=np.random.default_rng(0),
    )
    # Mask center-of-mass should match image bright-pixel center-of-mass
    img_mean = (out_img.mean(axis=2) > 100)
    if img_mean.sum() > 0 and out_mask.sum() > 0:
        ys_i, xs_i = np.where(img_mean)
        ys_m, xs_m = np.where(out_mask)
        assert abs(ys_i.mean() - ys_m.mean()) < 2.0
        assert abs(xs_i.mean() - xs_m.mean()) < 2.0
