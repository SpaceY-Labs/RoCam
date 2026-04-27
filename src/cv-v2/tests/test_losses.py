"""Tests for engines/losses.py."""
from __future__ import annotations
import torch
import pytest

from engines.losses import (
    bce_loss,
    dice_loss,
    boundary_dice_loss,
    MaskLoss,
)


def test_bce_zero_loss_when_logits_match_targets():
    # Very confident correct predictions -> near-zero BCE
    logits = torch.full((1, 1, 8, 8), 10.0)  # sigmoid ~= 1
    gt = torch.ones((1, 1, 8, 8))
    assert bce_loss(logits, gt).item() < 0.01


def test_bce_high_loss_when_logits_opposite():
    logits = torch.full((1, 1, 8, 8), 10.0)   # all positive
    gt = torch.zeros((1, 1, 8, 8))            # all negative
    assert bce_loss(logits, gt).item() > 5.0


def test_dice_perfect_match_gives_zero_loss():
    logits = torch.full((1, 1, 8, 8), 10.0)
    gt = torch.ones((1, 1, 8, 8))
    assert dice_loss(logits, gt).item() < 0.01


def test_dice_disjoint_masks_give_loss_near_one():
    # Logits start very negative everywhere (sigmoid ~= 0), then top half set
    # to large positive (sigmoid ~= 1). This makes the prediction strictly
    # disjoint from a bottom-half GT, so Dice -> 0 and loss -> 1.
    logits = torch.full((1, 1, 8, 8), -10.0)
    logits[:, :, :4, :] = 10.0  # top half predicted
    gt = torch.zeros((1, 1, 8, 8))
    gt[:, :, 4:, :] = 1.0       # bottom half is gt
    assert dice_loss(logits, gt).item() > 0.95


def test_boundary_dice_focuses_on_edges():
    # A 16x16 GT square in the middle. Pred matches interior but misses edge.
    gt = torch.zeros((1, 1, 16, 16))
    gt[:, :, 4:12, 4:12] = 1.0
    pred_logits = torch.full((1, 1, 16, 16), -10.0)
    pred_logits[:, :, 5:11, 5:11] = 10.0  # smaller predicted square (off by 1)

    full_dice = dice_loss(pred_logits, gt).item()
    boundary_d = boundary_dice_loss(pred_logits, gt, dilation=3).item()
    # Boundary error -> both losses non-zero
    assert full_dice > 0.0
    assert boundary_d > 0.0


def test_mask_loss_combines_components():
    logits = torch.randn(2, 1, 16, 16)
    gt = (torch.rand(2, 1, 16, 16) > 0.5).float()

    L = MaskLoss(w_bce=1.0, w_dice=1.0, w_boundary=0.5)
    out = L(logits, gt)
    assert isinstance(out, dict)
    assert "total" in out and "bce" in out and "dice" in out and "boundary" in out
    assert torch.isclose(
        out["total"],
        out["bce"] + out["dice"] + 0.5 * out["boundary"],
    )


def test_mask_loss_skips_boundary_when_weight_zero():
    logits = torch.randn(1, 1, 16, 16)
    gt = (torch.rand(1, 1, 16, 16) > 0.5).float()

    L = MaskLoss(w_bce=1.0, w_dice=1.0, w_boundary=0.0)
    out = L(logits, gt)
    assert out["boundary"].item() == 0.0
