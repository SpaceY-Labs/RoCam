"""FPN-style mask decoder for MaskTrackNet.

Four upsample blocks (s16 -> s8 -> s4 -> s2 -> s1). Each block:
  bilinear upsample x2 -> 3x3 conv -> GN -> SiLU
and fuses a target-branch skip connection at the matching stride via 1x1
projection + add.

Final 1x1 conv produces 1-channel logits at full input resolution.
"""
from __future__ import annotations
from typing import Dict
import torch
import torch.nn as nn
import torch.nn.functional as F


def _gn(c: int) -> nn.GroupNorm:
    return nn.GroupNorm(num_groups=min(32, c), num_channels=c)


class _UpBlock(nn.Module):
    def __init__(self, in_ch: int, skip_ch: int, out_ch: int):
        super().__init__()
        self.skip_proj = nn.Conv2d(skip_ch, in_ch, kernel_size=1, bias=False)
        self.gn_skip = _gn(in_ch)
        self.conv = nn.Conv2d(in_ch, out_ch, kernel_size=3, padding=1, bias=False)
        self.gn = _gn(out_ch)
        self.act = nn.SiLU(inplace=True)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        # Upsample x to skip's spatial size
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        # Project and add skip
        s = self.gn_skip(self.skip_proj(skip))
        x = x + s
        return self.act(self.gn(self.conv(x)))


class FPNDecoder(nn.Module):
    """Mask decoder consuming fused stride-16 feature + target-branch skips.

    Args:
        in_channels_per_stride: target-branch backbone widths at strides 4,8,16,32.
        decoder_channels: working channel count inside the decoder.
    """
    def __init__(
        self,
        in_channels_per_stride: Dict[int, int],
        decoder_channels: int = 64,
    ):
        super().__init__()
        c4 = in_channels_per_stride[4]
        c8 = in_channels_per_stride[8]
        c16 = in_channels_per_stride[16]
        # Stage 32 features are not consumed; included in dict for forward-compat.

        self.proj_in = nn.Sequential(
            nn.Conv2d(c16, decoder_channels * 4, kernel_size=1, bias=False),
            _gn(decoder_channels * 4),
            nn.SiLU(inplace=True),
        )
        # s16 -> s8
        self.up_s8 = _UpBlock(in_ch=decoder_channels * 4, skip_ch=c8,
                              out_ch=decoder_channels * 2)
        # s8 -> s4
        self.up_s4 = _UpBlock(in_ch=decoder_channels * 2, skip_ch=c4,
                              out_ch=decoder_channels)
        # s4 -> s2 (skip is the stem feature)
        self.up_s2 = _UpBlock(in_ch=decoder_channels, skip_ch=32,
                              out_ch=decoder_channels)
        # s2 -> s1 (no skip)
        self.up_s1 = nn.Sequential(
            nn.Conv2d(decoder_channels, decoder_channels, kernel_size=3, padding=1, bias=False),
            _gn(decoder_channels),
            nn.SiLU(inplace=True),
        )
        self.out_conv = nn.Conv2d(decoder_channels, 1, kernel_size=1)

    def forward(
        self,
        f_fused_s16: torch.Tensor,
        f_tgt_s8: torch.Tensor,
        f_tgt_s4: torch.Tensor,
        f_tgt_stem_s2: torch.Tensor,
    ) -> torch.Tensor:
        x = self.proj_in(f_fused_s16)
        x = self.up_s8(x, f_tgt_s8)
        x = self.up_s4(x, f_tgt_s4)
        x = self.up_s2(x, f_tgt_stem_s2)
        # Final 2x upsample to full resolution
        H, W = f_tgt_stem_s2.shape[-2] * 2, f_tgt_stem_s2.shape[-1] * 2
        x = F.interpolate(x, size=(H, W), mode="bilinear", align_corners=False)
        x = self.up_s1(x)
        return self.out_conv(x)  # (B, 1, H, W) raw logits
