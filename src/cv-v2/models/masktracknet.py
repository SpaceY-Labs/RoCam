"""MaskTrackNet - full Siamese mask-tracker assembly.

Two backbones:
  - Reference branch: 4-channel stem (RGB + mask), shared weights from stage 1+
  - Target branch:    3-channel stem (RGB), shared weights from stage 1+

Fusion: depthwise cross-correlation at stride 16.
Decoder: FPN over target-branch skips, outputs 1-channel logits at full res.
"""
from __future__ import annotations
import torch
import torch.nn as nn

from models.backbone import Backbone, Conv
from models.fusion import DepthwiseCorrelation
from models.decoder import FPNDecoder


class MaskTrackNet(nn.Module):
    """Stride contract:
       - Stems are stride 2 (k=3, s=2). They take RGB(+mask) and emit a c0-channel
         stride-2 feature.
       - The backbone's own stem is replaced with Identity, so the backbone
         consumes the stride-2 stem feature directly. Its keys (4, 8, 16, 32)
         then refer to input-relative strides.
       - The decoder consumes f_fused_s16 plus skips at s8, s4, and the s2 stem
         feature. It up-samples once more to s1 (full input resolution).
       - Therefore input H, W must be multiples of 32.
    """
    def __init__(
        self,
        widths: tuple[int, int, int, int, int] = (32, 64, 128, 256, 256),
        depths: tuple[int, int, int, int] = (2, 4, 4, 2),
        fusion_kernel: int = 5,
        decoder_channels: int = 64,
    ):
        super().__init__()
        c0, c1, c2, c3, _c4 = widths

        # Stride-2 stems. ref takes 4 channels (RGB+mask), tgt takes 3 (RGB).
        self.stem_ref = Conv(in_ch=4, out_ch=c0, k=3, s=2)
        self.stem_tgt = Conv(in_ch=3, out_ch=c0, k=3, s=2)

        # Shared backbone, with its own stem stripped (we provide stems above).
        self.backbone = Backbone(in_channels=c0, widths=widths, depths=depths)
        self.backbone.stem = nn.Identity()

        self.fusion = DepthwiseCorrelation(
            channels=widths[3], kernel_size=fusion_kernel,
        )
        self.decoder = FPNDecoder(
            in_channels_per_stride={
                4:  widths[1],
                8:  widths[2],
                16: widths[3],
                32: widths[4],
            },
            decoder_channels=decoder_channels,
        )

    def forward(
        self,
        reference_image: torch.Tensor,
        reference_mask: torch.Tensor,
        target_image: torch.Tensor,
    ) -> torch.Tensor:
        H, W = target_image.shape[-2], target_image.shape[-1]
        if H % 32 != 0 or W % 32 != 0:
            raise ValueError(f"target_image H,W ({H},{W}) must be multiple of 32")
        Hr, Wr = reference_image.shape[-2], reference_image.shape[-1]
        if Hr % 32 != 0 or Wr % 32 != 0:
            raise ValueError(f"reference_image H,W ({Hr},{Wr}) must be multiple of 32")

        ref_in = torch.cat([reference_image, reference_mask], dim=1)
        tgt_in = target_image

        f_ref_stem = self.stem_ref(ref_in)        # stride 2
        f_tgt_stem = self.stem_tgt(tgt_in)        # stride 2

        f_ref = self.backbone(f_ref_stem)         # keys 4, 8, 16, 32
        f_tgt = self.backbone(f_tgt_stem)

        fused_s16 = self.fusion(f_ref[16], f_tgt[16])

        return self.decoder(
            f_fused_s16=fused_s16,
            f_tgt_s8=f_tgt[8],
            f_tgt_s4=f_tgt[4],
            f_tgt_stem_s2=f_tgt_stem,
        )
