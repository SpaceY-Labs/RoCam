"""Tests for models/fusion.py."""
from __future__ import annotations
import torch

from models.fusion import DepthwiseCorrelation


def test_fusion_output_shape_matches_target():
    fusion = DepthwiseCorrelation(channels=256, kernel_size=5)
    f_ref = torch.randn(2, 256, 16, 16)
    f_tgt = torch.randn(2, 256, 24, 40)  # arbitrary non-square
    out = fusion(f_ref, f_tgt)
    assert out.shape == (2, 256, 24, 40)


def test_fusion_param_count_small():
    from models.backbone import count_params
    fusion = DepthwiseCorrelation(channels=256, kernel_size=5)
    n = count_params(fusion)
    # 1x1 mix conv (256x256=65k) + 256-channel GN (512 params) ~= 66k
    # Depthwise correlation itself has no params (kernel comes from f_ref).
    assert 50_000 < n < 100_000, n


def test_fusion_gradient_flows_to_both_inputs():
    fusion = DepthwiseCorrelation(channels=256, kernel_size=5)
    f_ref = torch.randn(1, 256, 16, 16, requires_grad=True)
    f_tgt = torch.randn(1, 256, 16, 16, requires_grad=True)
    out = fusion(f_ref, f_tgt)
    out.sum().backward()
    assert f_ref.grad is not None and f_ref.grad.abs().sum() > 0
    assert f_tgt.grad is not None and f_tgt.grad.abs().sum() > 0


def test_fusion_handles_different_ref_resolution():
    """Reference can be smaller than target; both go through GAP -> kxk kernel."""
    fusion = DepthwiseCorrelation(channels=256, kernel_size=5)
    f_ref = torch.randn(1, 256, 8, 8)
    f_tgt = torch.randn(1, 256, 32, 32)
    out = fusion(f_ref, f_tgt)
    assert out.shape == (1, 256, 32, 32)
