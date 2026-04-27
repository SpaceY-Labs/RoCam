"""Loss functions for MaskTrackNet training.

Components:
  bce_loss: per-pixel binary cross-entropy with logits.
  dice_loss: standard soft-Dice on sigmoid(logits).
  boundary_dice_loss: Dice computed only on the boundary band of the GT mask.

MaskLoss: weighted sum, returns a dict so the train loop can log components.
"""
from __future__ import annotations
import torch
import torch.nn as nn
import torch.nn.functional as F


def bce_loss(logits: torch.Tensor, gt: torch.Tensor) -> torch.Tensor:
    return F.binary_cross_entropy_with_logits(logits, gt, reduction="mean")


def dice_loss(logits: torch.Tensor, gt: torch.Tensor, eps: float = 1e-6) -> torch.Tensor:
    p = torch.sigmoid(logits)
    num = 2 * (p * gt).sum(dim=(2, 3))
    den = (p + gt).sum(dim=(2, 3)) + eps
    return (1 - num / den).mean()


def _morph_boundary(mask: torch.Tensor, dilation: int) -> torch.Tensor:
    """Return 1 where pixel is within `dilation` of mask boundary, else 0.

    boundary = dilation(mask) - erosion(mask)
    Implemented via max-pool: erosion = 1 - max_pool(1 - mask).
    """
    k = dilation * 2 + 1
    pad = dilation
    dil = F.max_pool2d(mask, kernel_size=k, stride=1, padding=pad)
    ero = 1.0 - F.max_pool2d(1.0 - mask, kernel_size=k, stride=1, padding=pad)
    return (dil - ero).clamp(0.0, 1.0)


def boundary_dice_loss(
    logits: torch.Tensor, gt: torch.Tensor, dilation: int = 3, eps: float = 1e-6
) -> torch.Tensor:
    edge = _morph_boundary(gt, dilation)
    p = torch.sigmoid(logits) * edge
    g = gt * edge
    num = 2 * (p * g).sum(dim=(2, 3))
    den = (p + g).sum(dim=(2, 3)) + eps
    return (1 - num / den).mean()


class MaskLoss(nn.Module):
    """Weighted combination: total = w_bce * BCE + w_dice * Dice + w_boundary * BoundaryDice."""

    def __init__(self, w_bce: float = 1.0, w_dice: float = 1.0,
                 w_boundary: float = 0.0, boundary_dilation: int = 3):
        super().__init__()
        self.w_bce = w_bce
        self.w_dice = w_dice
        self.w_boundary = w_boundary
        self.boundary_dilation = boundary_dilation

    def forward(self, logits: torch.Tensor, gt: torch.Tensor) -> dict[str, torch.Tensor]:
        L_bce = bce_loss(logits, gt) if self.w_bce > 0 else logits.new_zeros(())
        L_dice = dice_loss(logits, gt) if self.w_dice > 0 else logits.new_zeros(())
        L_bnd = (
            boundary_dice_loss(logits, gt, self.boundary_dilation)
            if self.w_boundary > 0 else logits.new_zeros(())
        )
        total = self.w_bce * L_bce + self.w_dice * L_dice + self.w_boundary * L_bnd
        return {"total": total, "bce": L_bce, "dice": L_dice, "boundary": L_bnd}
