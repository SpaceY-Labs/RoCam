"""Print param count and FLOPs at multiple input resolutions.

Usage:
    cd src/cv-v2
    python scripts/flop_report.py
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
from fvcore.nn import FlopCountAnalysis, parameter_count

from models.masktracknet import MaskTrackNet


RESOLUTIONS = (384, 448, 512, 576, 640, 768, 896, 960, 1024)


def main() -> None:
    m = MaskTrackNet().eval()
    n_params = sum(p.numel() for p in m.parameters() if p.requires_grad)
    print(f"Param count: {n_params:,}  ({n_params / 1e6:.2f}M)")
    print()
    print(f"{'Resolution':>10} | {'GFLOPs':>10}  {'TFLOPs':>10}")
    print("-" * 40)

    for size in RESOLUTIONS:
        ref = torch.rand(1, 3, size, size)
        ref_m = (torch.rand(1, 1, size, size) > 0.5).float()
        tgt = torch.rand(1, 3, size, size)
        flops = FlopCountAnalysis(m, (ref, ref_m, tgt))
        flops.unsupported_ops_warnings(False)
        flops.uncalled_modules_warnings(False)
        gflops = flops.total() / 1e9
        tflops = gflops / 1e3
        print(f"{size:>10} | {gflops:>10.2f}  {tflops:>10.4f}")


if __name__ == "__main__":
    main()
