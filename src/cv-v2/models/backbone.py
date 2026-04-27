"""YOLO26-mini backbone for cv-v2 MaskTrackNet.

Four C2f stages, channel widths capped at 256 (vs 512 in YOLOv26s' deep stages).
GroupNorm replaces BatchNorm everywhere - resolution-agnostic at inference and
stable under small batch sizes (Stage 2 uses batch=4 at 960px).

Returns multi-stride feature maps for the FPN decoder to consume.
"""
from __future__ import annotations
from typing import Dict
import torch
import torch.nn as nn


def _gn(channels: int, num_groups: int = 32) -> nn.GroupNorm:
    return nn.GroupNorm(num_groups=min(num_groups, channels), num_channels=channels)


class Conv(nn.Module):
    """Conv + GroupNorm + SiLU."""
    def __init__(
        self, in_ch: int, out_ch: int, k: int = 3, s: int = 1, p: int | None = None,
    ):
        super().__init__()
        if p is None:
            p = k // 2
        self.conv = nn.Conv2d(in_ch, out_ch, k, s, p, bias=False)
        self.gn = _gn(out_ch)
        self.act = nn.SiLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.gn(self.conv(x)))


class Bottleneck(nn.Module):
    """Standard bottleneck used inside C2f. Two 3x3 convs, optional residual."""
    def __init__(self, in_ch: int, out_ch: int, shortcut: bool = True):
        super().__init__()
        self.cv1 = Conv(in_ch, out_ch, k=3)
        self.cv2 = Conv(out_ch, out_ch, k=3)
        self.use_residual = shortcut and (in_ch == out_ch)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.cv2(self.cv1(x))
        return x + y if self.use_residual else y


class C2f(nn.Module):
    """YOLOv26 Cross Stage Partial block (depth=n bottlenecks).

    Splits input into two halves, runs n bottlenecks on one half with
    chained outputs (aggressively dense), concatenates, then 1x1 mixes.
    """
    def __init__(self, in_ch: int, out_ch: int, n: int = 1, shortcut: bool = True):
        super().__init__()
        self.c = out_ch // 2
        self.cv1 = Conv(in_ch, 2 * self.c, k=1)
        self.cv2 = Conv((2 + n) * self.c, out_ch, k=1)
        self.m = nn.ModuleList(
            Bottleneck(self.c, self.c, shortcut=shortcut) for _ in range(n)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = list(self.cv1(x).chunk(2, dim=1))  # two halves of c
        for m in self.m:
            y.append(m(y[-1]))
        return self.cv2(torch.cat(y, dim=1))


class SPPF(nn.Module):
    """Spatial Pyramid Pooling - Fast. 5x5 max-pool 3x stacked."""
    def __init__(self, in_ch: int, out_ch: int, k: int = 5):
        super().__init__()
        c_ = in_ch // 2
        self.cv1 = Conv(in_ch, c_, k=1)
        self.m = nn.MaxPool2d(kernel_size=k, stride=1, padding=k // 2)
        self.cv2 = Conv(c_ * 4, out_ch, k=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.cv1(x)
        y1 = self.m(y)
        y2 = self.m(y1)
        y3 = self.m(y2)
        return self.cv2(torch.cat([y, y1, y2, y3], dim=1))


class Backbone(nn.Module):
    """4-stage YOLO26-mini backbone.

    Args:
        in_channels: 3 for RGB target stream; 4 for RGB+mask reference stream.
        widths: per-stage channel counts (post-stem). Default capped at 256.
        depths: per-stage C2f bottleneck counts.

    Output:
        dict mapping stride (4,8,16,32) -> feature map tensor.
    """
    def __init__(
        self,
        in_channels: int = 3,
        widths: tuple[int, int, int, int, int] = (32, 64, 128, 256, 256),
        depths: tuple[int, int, int, int] = (2, 4, 4, 2),
    ):
        super().__init__()
        c0, c1, c2, c3, c4 = widths
        d1, d2, d3, d4 = depths

        # Stem: stride 2, in_channels -> c0
        self.stem = Conv(in_channels, c0, k=3, s=2)
        # Stage 1: stride 4, c0 -> c1
        self.stage1_down = Conv(c0, c1, k=3, s=2)
        self.stage1 = C2f(c1, c1, n=d1, shortcut=True)
        # Stage 2: stride 8, c1 -> c2
        self.stage2_down = Conv(c1, c2, k=3, s=2)
        self.stage2 = C2f(c2, c2, n=d2, shortcut=True)
        # Stage 3: stride 16, c2 -> c3
        self.stage3_down = Conv(c2, c3, k=3, s=2)
        self.stage3 = C2f(c3, c3, n=d3, shortcut=True)
        # Stage 4: stride 32, c3 -> c4
        self.stage4_down = Conv(c3, c4, k=3, s=2)
        self.stage4 = nn.Sequential(
            C2f(c4, c4, n=d4, shortcut=True),
            SPPF(c4, c4, k=5),
        )

    def forward(self, x: torch.Tensor) -> Dict[int, torch.Tensor]:
        H, W = x.shape[-2], x.shape[-1]
        if H % 32 != 0 or W % 32 != 0:
            raise ValueError(
                f"input H,W ({H},{W}) must be multiple of 32"
            )

        x0 = self.stem(x)               # stride 2
        x1 = self.stage1(self.stage1_down(x0))  # stride 4
        x2 = self.stage2(self.stage2_down(x1))  # stride 8
        x3 = self.stage3(self.stage3_down(x2))  # stride 16
        x4 = self.stage4(self.stage4_down(x3))  # stride 32

        return {4: x1, 8: x2, 16: x3, 32: x4}


def count_params(module: nn.Module) -> int:
    return sum(p.numel() for p in module.parameters() if p.requires_grad)
