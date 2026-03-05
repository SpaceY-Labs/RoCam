"""
Lightweight CNN Backbone for SiamMask-Lite.

Design rationale:
- Must produce multi-scale features for both template (reference image) and search (video frame)
- Targets ~1ms on Jetson Orin Nano with TensorRT FP16
- Uses inverted residual blocks (MobileNetV2-style) for efficiency
- No transformer blocks; optional lightweight channel attention (SE blocks)

The backbone is shared (Siamese) — same weights encode both the template crop
and the search region crop.

Output: 3 feature maps at strides 4, 8, 16 for the FPN-lite neck.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import List, Tuple


class SEBlock(nn.Module):
    """Squeeze-and-Excitation channel attention. Lightweight, ~0 latency impact."""

    def __init__(self, channels: int, reduction: int = 4):
        super().__init__()
        mid = max(channels // reduction, 8)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Sequential(
            nn.Linear(channels, mid, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(mid, channels, bias=False),
            nn.Hardsigmoid(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.shape
        w = self.pool(x).view(b, c)
        w = self.fc(w).view(b, c, 1, 1)
        return x * w


class ConvBNReLU(nn.Module):
    """Conv2d + BatchNorm + ReLU6 fused block."""

    def __init__(
        self,
        in_ch: int,
        out_ch: int,
        kernel: int = 3,
        stride: int = 1,
        groups: int = 1,
        use_relu: bool = True,
    ):
        super().__init__()
        padding = (kernel - 1) // 2
        layers = [
            nn.Conv2d(in_ch, out_ch, kernel, stride, padding, groups=groups, bias=False),
            nn.BatchNorm2d(out_ch, momentum=0.03, eps=1e-3),
        ]
        if use_relu:
            layers.append(nn.ReLU6(inplace=True))
        self.block = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class InvertedResidual(nn.Module):
    """
    MobileNetV2-style inverted residual block with optional SE attention.

    1x1 expand -> 3x3/5x5 depthwise -> (optional SE) -> 1x1 project
    """

    def __init__(
        self,
        in_ch: int,
        out_ch: int,
        stride: int = 1,
        expand_ratio: float = 4.0,
        kernel: int = 3,
        use_se: bool = False,
    ):
        super().__init__()
        mid_ch = int(in_ch * expand_ratio)
        self.use_residual = (stride == 1 and in_ch == out_ch)

        layers = []
        # Expand
        if expand_ratio != 1.0:
            layers.append(ConvBNReLU(in_ch, mid_ch, kernel=1))
        # Depthwise
        layers.append(ConvBNReLU(mid_ch, mid_ch, kernel=kernel, stride=stride, groups=mid_ch))
        # SE
        if use_se:
            layers.append(SEBlock(mid_ch))
        # Project (no activation)
        layers.append(ConvBNReLU(mid_ch, out_ch, kernel=1, use_relu=False))

        self.conv = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv(x)
        if self.use_residual:
            out = out + x
        return out


class LiteBackbone(nn.Module):
    """
    Ultra-lightweight backbone producing 3 feature scales.

    Architecture (input: 127x127 template or 255x255 search):

    Stage 0: Conv2d 3->16, stride=2          -> stride 2
    Stage 1: 2x InvRes 16->24, stride=2      -> stride 4  (P2)
    Stage 2: 3x InvRes 24->40, stride=2      -> stride 8  (P3)
    Stage 3: 3x InvRes 40->64, stride=2, SE  -> stride 16 (P4)

    Total params: ~300K (vs 3.4M for MobileNetV2, 25M for ResNet-50)
    """

    def __init__(self):
        super().__init__()

        # Stem: 3 -> 16, stride 2
        self.stem = ConvBNReLU(3, 16, kernel=3, stride=2)

        # Stage 1: stride 4 output (P2), 24 channels
        self.stage1 = nn.Sequential(
            InvertedResidual(16, 24, stride=2, expand_ratio=3.0, kernel=3),
            InvertedResidual(24, 24, stride=1, expand_ratio=3.0, kernel=3),
        )

        # Stage 2: stride 8 output (P3), 40 channels
        self.stage2 = nn.Sequential(
            InvertedResidual(24, 40, stride=2, expand_ratio=4.0, kernel=5),
            InvertedResidual(40, 40, stride=1, expand_ratio=4.0, kernel=5),
            InvertedResidual(40, 40, stride=1, expand_ratio=4.0, kernel=3),
        )

        # Stage 3: stride 16 output (P4), 64 channels with SE
        self.stage3 = nn.Sequential(
            InvertedResidual(40, 64, stride=2, expand_ratio=4.0, kernel=5, use_se=True),
            InvertedResidual(64, 64, stride=1, expand_ratio=4.0, kernel=5, use_se=True),
            InvertedResidual(64, 64, stride=1, expand_ratio=4.0, kernel=3, use_se=True),
        )

        # Channel alignment to uniform 64-ch for FPN
        self.align_p2 = nn.Conv2d(24, 64, 1, bias=False)
        self.align_p3 = nn.Conv2d(40, 64, 1, bias=False)
        # P4 is already 64-ch

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Returns (p2, p3, p4) feature maps, all with 64 channels.
        For 255x255 input: p2=64x64, p3=32x32, p4=16x16
        For 127x127 input: p2=32x32, p3=16x16, p4=8x8
        """
        x = self.stem(x)       # stride 2
        p2 = self.stage1(x)    # stride 4
        p3 = self.stage2(p2)   # stride 8
        p4 = self.stage3(p3)   # stride 16

        p2 = self.align_p2(p2)
        p3 = self.align_p3(p3)

        return p2, p3, p4


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


if __name__ == "__main__":
    # Quick sanity check
    backbone = LiteBackbone()
    print(f"Backbone parameters: {count_parameters(backbone):,}")

    # Template input (127x127)
    t = torch.randn(1, 3, 127, 127)
    tp2, tp3, tp4 = backbone(t)
    print(f"Template P2: {tp2.shape}, P3: {tp3.shape}, P4: {tp4.shape}")

    # Search input (255x255)
    s = torch.randn(1, 3, 255, 255)
    sp2, sp3, sp4 = backbone(s)
    print(f"Search  P2: {sp2.shape}, P3: {sp3.shape}, P4: {sp4.shape}")
