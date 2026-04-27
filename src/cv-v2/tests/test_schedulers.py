"""Tests for engines/schedulers.py."""
from __future__ import annotations
import math
import torch

from engines.schedulers import WarmupCosineLR


def test_warmup_phase_linear_from_zero_to_lr0():
    opt = torch.optim.SGD([torch.zeros(1, requires_grad=True)], lr=1.0)
    sched = WarmupCosineLR(opt, lr0=1.0, lrf_ratio=0.05, total_steps=100, warmup_steps=10)
    # Step 0: lr ~= 0
    assert opt.param_groups[0]["lr"] < 0.05
    # Step 5 (mid-warmup): lr ~= 0.5
    for _ in range(5):
        sched.step()
    assert 0.4 < opt.param_groups[0]["lr"] < 0.6
    # Step 10 (end of warmup): lr ~= 1.0
    for _ in range(5):
        sched.step()
    assert 0.95 < opt.param_groups[0]["lr"] < 1.05


def test_cosine_phase_decays_to_lrf():
    opt = torch.optim.SGD([torch.zeros(1, requires_grad=True)], lr=1.0)
    sched = WarmupCosineLR(opt, lr0=1.0, lrf_ratio=0.05, total_steps=100, warmup_steps=0)
    for _ in range(99):
        sched.step()
    sched.step()
    final = opt.param_groups[0]["lr"]
    # Final lr should be lrf_ratio * lr0 = 0.05
    assert abs(final - 0.05) < 0.005


def test_scheduler_works_with_multiple_param_groups():
    p1 = torch.zeros(1, requires_grad=True)
    p2 = torch.zeros(1, requires_grad=True)
    opt = torch.optim.SGD([
        {"params": [p1], "lr": 1.0},
        {"params": [p2], "lr": 0.1},
    ])
    sched = WarmupCosineLR(opt, lr0=1.0, lrf_ratio=0.05, total_steps=100, warmup_steps=10)
    for _ in range(50):
        sched.step()
    # Each group's lr scales with its own original lr - but our scheduler
    # applies the same multiplier to all groups. So group 1 -> 1.0 * factor,
    # group 2 -> 0.1 * factor. Verify ratio preserved.
    ratio = opt.param_groups[1]["lr"] / opt.param_groups[0]["lr"]
    assert abs(ratio - 0.1) < 0.01
