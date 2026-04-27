"""Depthwise cross-correlation fusion for MaskTrackNet.

The reference feature is global-avg-pooled to a (C, k, k) kernel, then
depthwise-convolved against the target feature map. A 1x1 conv + GN + SiLU
mixes channels and produces the fused feature for the decoder.
"""
from __future__ import annotations
import torch
import torch.nn as nn
import torch.nn.functional as F


class DepthwiseCorrelation(nn.Module):
    """Fuse reference and target features by depthwise correlation.

    Args:
        channels: feature channel count (must match for ref and tgt).
        kernel_size: spatial size of the kernel produced from f_ref via
            adaptive avg pool. Larger k captures more spatial signal at
            small cost.
    """
    def __init__(self, channels: int, kernel_size: int = 5):
        super().__init__()
        self.channels = channels
        self.kernel_size = kernel_size
        self.mix = nn.Conv2d(channels, channels, kernel_size=1, bias=False)
        self.gn = nn.GroupNorm(num_groups=min(32, channels), num_channels=channels)
        self.act = nn.SiLU(inplace=True)

    def forward(self, f_ref: torch.Tensor, f_tgt: torch.Tensor) -> torch.Tensor:
        """
        Args:
            f_ref: (B, C, Hr, Wr)
            f_tgt: (B, C, Ht, Wt)
        Returns:
            fused: (B, C, Ht, Wt)
        """
        B, C, Ht, Wt = f_tgt.shape
        k = self.kernel_size

        # Adaptive avg pool ref -> (B, C, k, k) kernel
        kernel = F.adaptive_avg_pool2d(f_ref, output_size=(k, k))  # (B, C, k, k)
        # Reshape to a per-batch depthwise conv weight of shape (B*C, 1, k, k)
        kernel = kernel.reshape(B * C, 1, k, k)

        # Group convolution trick: reshape f_tgt to (1, B*C, Ht, Wt) and groups=B*C
        x = f_tgt.reshape(1, B * C, Ht, Wt)
        y = F.conv2d(x, kernel, padding=k // 2, groups=B * C)
        y = y.reshape(B, C, Ht, Wt)

        return self.act(self.gn(self.mix(y)))
