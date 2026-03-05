"""
Mask Decoder Head — produces pixel-level segmentation masks.

This is what makes this system different from standard trackers (which only
output bounding boxes). The mask head takes the multi-scale correlation
response maps and decodes them into a binary mask of the target object.

Design for Orin Nano at 60fps:
- Lightweight upsampling with depthwise-separable convolutions
- Skip connections from search features for sharp edges
- Final output: 255x255 binary mask (same as search region crop)

The mask is then mapped back to the full frame using the search region
coordinates to produce a full-resolution segmentation.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple


class DepthwiseSeparableConv(nn.Module):
    """Depthwise separable conv: depthwise 3x3 + pointwise 1x1."""

    def __init__(self, in_ch: int, out_ch: int, stride: int = 1):
        super().__init__()
        self.dw = nn.Conv2d(in_ch, in_ch, 3, stride, 1, groups=in_ch, bias=False)
        self.bn1 = nn.BatchNorm2d(in_ch)
        self.pw = nn.Conv2d(in_ch, out_ch, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(out_ch)
        self.relu = nn.ReLU6(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.relu(self.bn1(self.dw(x)))
        x = self.relu(self.bn2(self.pw(x)))
        return x


class MaskDecoder(nn.Module):
    """
    Lightweight mask decoder with skip connections.

    Takes:
    - Multi-scale correlation maps (corr_p2, corr_p3, corr_p4)
    - Search feature maps (search_p2, search_p3) for edge detail

    Produces:
    - Binary mask at 255x255 resolution (matching search region crop size)
    - Bounding box regression (cx, cy, w, h) for tracker state update

    Decoder path:
    1. Start from corr_p4 (coarsest, strongest semantic match signal)
    2. Upsample + concat corr_p3 + search_p3 skip -> refine
    3. Upsample + concat corr_p2 + search_p2 skip -> refine
    4. Upsample 4x to full 255x255 -> final 1-channel mask
    """

    def __init__(self, corr_channels: int = 64, feat_channels: int = 64):
        super().__init__()

        # Stage 3 (from P4 correlation): start decoding
        self.decode_p4 = nn.Sequential(
            DepthwiseSeparableConv(corr_channels, 64),
            DepthwiseSeparableConv(64, 64),
        )

        # Stage 2 (fuse P3 correlation + P3 search skip)
        # Input: 64 (from P4 upsample) + 64 (corr_p3) + 64 (search_p3) = 192
        self.decode_p3 = nn.Sequential(
            nn.Conv2d(192, 64, 1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU6(inplace=True),
            DepthwiseSeparableConv(64, 64),
        )

        # Stage 1 (fuse P2 correlation + P2 search skip)
        # Input: 64 (from P3 upsample) + 64 (corr_p2) + 64 (search_p2) = 192
        self.decode_p2 = nn.Sequential(
            nn.Conv2d(192, 64, 1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU6(inplace=True),
            DepthwiseSeparableConv(64, 48),
        )

        # Final upsample and mask prediction (stride 4 -> stride 1)
        self.mask_head = nn.Sequential(
            nn.ConvTranspose2d(48, 32, 4, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU6(inplace=True),
            nn.ConvTranspose2d(32, 16, 4, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(16),
            nn.ReLU6(inplace=True),
            nn.Conv2d(16, 1, 3, padding=1),  # 1-channel mask logit
        )

        # Bounding box regression head (from P4 correlation)
        # Predicts (dx, dy, dw, dh) offset from center of search region
        self.bbox_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(64, 32),
            nn.ReLU6(inplace=True),
            nn.Linear(32, 4),  # (cx, cy, w, h) normalized to [0, 1]
        )

        # Confidence score head (is the target present?)
        self.score_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(64, 32),
            nn.ReLU6(inplace=True),
            nn.Linear(32, 1),
        )

    def forward(
        self,
        corr_maps: Tuple[torch.Tensor, torch.Tensor, torch.Tensor],
        search_feats: Tuple[torch.Tensor, torch.Tensor, torch.Tensor],
        output_size: int = 255,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Args:
            corr_maps:    (corr_p2, corr_p3, corr_p4) from MultiScaleCorrelation
            search_feats: (search_p2, search_p3, search_p4) from backbone on search image

        Returns:
            mask:  (B, 1, output_size, output_size) — mask logits (pre-sigmoid)
            bbox:  (B, 4) — (cx, cy, w, h) normalized to search region
            score: (B, 1) — confidence logit (pre-sigmoid)
        """
        corr_p2, corr_p3, corr_p4 = corr_maps
        s_p2, s_p3, _ = search_feats

        # Decode from coarsest
        x = self.decode_p4(corr_p4)

        # BBox and score from coarse features (fast path)
        bbox = torch.sigmoid(self.bbox_head(x))
        score = self.score_head(x)

        # Upsample to P3 resolution and fuse
        x = F.interpolate(x, size=corr_p3.shape[2:], mode="bilinear", align_corners=False)
        x = self.decode_p3(torch.cat([x, corr_p3, s_p3], dim=1))

        # Upsample to P2 resolution and fuse
        x = F.interpolate(x, size=corr_p2.shape[2:], mode="bilinear", align_corners=False)
        x = self.decode_p2(torch.cat([x, corr_p2, s_p2], dim=1))

        # Final upsample to full resolution mask
        mask = self.mask_head(x)
        mask = F.interpolate(mask, size=(output_size, output_size), mode="bilinear", align_corners=False)

        return mask, bbox, score


if __name__ == "__main__":
    decoder = MaskDecoder()
    print(f"Mask decoder params: {sum(p.numel() for p in decoder.parameters()):,}")

    # Simulated correlation maps (search 255x255)
    corr_p2 = torch.randn(2, 64, 33, 33)  # xcorr output size depends on template/search
    corr_p3 = torch.randn(2, 64, 17, 17)
    corr_p4 = torch.randn(2, 64, 9, 9)

    # Search feature maps
    sp2 = torch.randn(2, 64, 33, 33)
    sp3 = torch.randn(2, 64, 17, 17)
    sp4 = torch.randn(2, 64, 9, 9)

    mask, bbox, score = decoder((corr_p2, corr_p3, corr_p4), (sp2, sp3, sp4))
    print(f"Mask: {mask.shape}, BBox: {bbox.shape}, Score: {score.shape}")
