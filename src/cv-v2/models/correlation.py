"""
Cross-Correlation Module for matching template features to search features.

This is the core of the Siamese approach: instead of classifying by text labels
(like YOLO), we directly compare visual features of the reference object against
every spatial location in the search frame.

Two correlation methods:
1. Depthwise cross-correlation (DW-XCorr): efficient, used in SiamRPN++
2. Pixel-wise correlation: richer but heavier

For Orin Nano at 60fps, we use DW-XCorr which maps to standard grouped convolutions
and is extremely TensorRT-friendly.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple


class DepthwiseXCorr(nn.Module):
    """
    Depthwise cross-correlation between template kernel and search feature map.

    How it works:
    1. Template features (e.g., 8x8x64) are compressed to a kernel per channel
    2. Search features (e.g., 32x32x64) are convolved with template kernels
    3. Output is a response map showing where the template matches

    This is equivalent to F.conv2d with groups=channels, using the template
    as the convolution kernel — extremely fast on GPU/TensorRT.
    """

    def __init__(self, in_channels: int = 64, hidden: int = 64, out_channels: int = 64):
        super().__init__()
        # Reduce template to kernel features
        self.template_conv = nn.Sequential(
            nn.Conv2d(in_channels, hidden, 1, bias=False),
            nn.BatchNorm2d(hidden),
            nn.ReLU6(inplace=True),
        )
        # Reduce search to match
        self.search_conv = nn.Sequential(
            nn.Conv2d(in_channels, hidden, 1, bias=False),
            nn.BatchNorm2d(hidden),
            nn.ReLU6(inplace=True),
        )
        # Post-correlation projection
        self.head = nn.Sequential(
            nn.Conv2d(hidden, out_channels, 1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU6(inplace=True),
        )

    def forward(
        self,
        template_feat: torch.Tensor,
        search_feat: torch.Tensor,
    ) -> torch.Tensor:
        """
        Args:
            template_feat: (B, C, Ht, Wt) — template feature map
            search_feat:   (B, C, Hs, Ws) — search region feature map

        Returns:
            response: (B, out_channels, H_out, W_out) — correlation response map
        """
        kernel = self.template_conv(template_feat)  # (B, hidden, Ht, Wt)
        search = self.search_conv(search_feat)       # (B, hidden, Hs, Ws)

        B, C, Ht, Wt = kernel.shape
        _, _, Hs, Ws = search.shape

        # Depthwise cross-correlation:
        # Reshape for grouped conv: treat batch dim specially
        # For batch_size=1 (inference), this is a simple grouped conv
        # For training with batch, we process each sample
        response = self._batch_xcorr(kernel, search)

        return self.head(response)

    def _batch_xcorr(
        self, kernel: torch.Tensor, search: torch.Tensor
    ) -> torch.Tensor:
        """Batched depthwise cross-correlation."""
        B, C, Hk, Wk = kernel.shape
        _, _, Hs, Ws = search.shape

        # Reshape for grouped convolution
        # kernel: (B*C, 1, Hk, Wk)  — each channel is its own filter
        # search: (1, B*C, Hs, Ws)  — grouped input
        kernel = kernel.reshape(B * C, 1, Hk, Wk)
        search = search.reshape(1, B * C, Hs, Ws)

        # Grouped conv: groups = B*C
        out = F.conv2d(search, kernel, groups=B * C)

        # Reshape back: (B, C, H_out, W_out)
        _, _, Ho, Wo = out.shape
        return out.reshape(B, C, Ho, Wo)


class MultiScaleCorrelation(nn.Module):
    """
    Multi-scale cross-correlation with FPN-lite fusion.

    Correlates template and search features at 3 scales (P2, P3, P4),
    then fuses them top-down for the best spatial-semantic tradeoff.

    P4 (stride 16): strong semantics, coarse location
    P3 (stride 8):  balanced
    P2 (stride 4):  fine spatial detail, needed for mask edges
    """

    def __init__(self, feat_channels: int = 64, corr_channels: int = 64):
        super().__init__()
        self.corr_p4 = DepthwiseXCorr(feat_channels, corr_channels, corr_channels)
        self.corr_p3 = DepthwiseXCorr(feat_channels, corr_channels, corr_channels)
        self.corr_p2 = DepthwiseXCorr(feat_channels, corr_channels, corr_channels)

        # Top-down fusion (P4 -> P3 -> P2)
        self.fuse_p4_to_p3 = nn.Sequential(
            nn.Conv2d(corr_channels, corr_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(corr_channels),
            nn.ReLU6(inplace=True),
        )
        self.fuse_p3_to_p2 = nn.Sequential(
            nn.Conv2d(corr_channels, corr_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(corr_channels),
            nn.ReLU6(inplace=True),
        )

    def forward(
        self,
        template_feats: Tuple[torch.Tensor, torch.Tensor, torch.Tensor],
        search_feats: Tuple[torch.Tensor, torch.Tensor, torch.Tensor],
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Args:
            template_feats: (p2, p3, p4) from backbone on template image
            search_feats:   (p2, p3, p4) from backbone on search region

        Returns:
            (corr_p2, corr_p3, corr_p4): multi-scale correlation response maps
        """
        tp2, tp3, tp4 = template_feats
        sp2, sp3, sp4 = search_feats

        # Correlate at each scale
        c_p4 = self.corr_p4(tp4, sp4)  # coarsest
        c_p3 = self.corr_p3(tp3, sp3)
        c_p2 = self.corr_p2(tp2, sp2)  # finest

        # Top-down fusion: upsample coarse and add to fine
        c_p4_up = F.interpolate(c_p4, size=c_p3.shape[2:], mode="bilinear", align_corners=False)
        c_p3 = self.fuse_p4_to_p3(c_p3 + c_p4_up)

        c_p3_up = F.interpolate(c_p3, size=c_p2.shape[2:], mode="bilinear", align_corners=False)
        c_p2 = self.fuse_p3_to_p2(c_p2 + c_p3_up)

        return c_p2, c_p3, c_p4


if __name__ == "__main__":
    corr = MultiScaleCorrelation(64, 64)
    print(f"Correlation params: {sum(p.numel() for p in corr.parameters()):,}")

    # Simulate template features (127x127 input -> P2:32, P3:16, P4:8)
    tp2 = torch.randn(2, 64, 32, 32)
    tp3 = torch.randn(2, 64, 16, 16)
    tp4 = torch.randn(2, 64, 8, 8)

    # Simulate search features (255x255 input -> P2:64, P3:32, P4:16)
    sp2 = torch.randn(2, 64, 64, 64)
    sp3 = torch.randn(2, 64, 32, 32)
    sp4 = torch.randn(2, 64, 16, 16)

    c2, c3, c4 = corr((tp2, tp3, tp4), (sp2, sp3, sp4))
    print(f"Corr P2: {c2.shape}, P3: {c3.shape}, P4: {c4.shape}")
