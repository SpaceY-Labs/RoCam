"""Tests for engines/eval.py."""
from __future__ import annotations
import numpy as np
import torch

from engines.eval import (
    compute_j,
    compute_f,
    binarize_logits,
)


def test_compute_j_perfect_match_is_one():
    pred = np.ones((10, 10), dtype=bool)
    gt = np.ones((10, 10), dtype=bool)
    assert compute_j(pred, gt) == 1.0


def test_compute_j_disjoint_is_zero():
    pred = np.zeros((10, 10), dtype=bool)
    pred[:5, :] = True
    gt = np.zeros((10, 10), dtype=bool)
    gt[5:, :] = True
    assert compute_j(pred, gt) == 0.0


def test_compute_j_half_overlap():
    pred = np.zeros((10, 10), dtype=bool)
    pred[:, :5] = True
    gt = np.zeros((10, 10), dtype=bool)
    gt[:, :10] = True
    # IoU = 50/100 = 0.5
    assert abs(compute_j(pred, gt) - 0.5) < 1e-6


def test_compute_j_both_empty_is_one():
    pred = np.zeros((10, 10), dtype=bool)
    gt = np.zeros((10, 10), dtype=bool)
    assert compute_j(pred, gt) == 1.0


def test_compute_f_perfect_match_is_one():
    pred = np.zeros((50, 50), dtype=bool)
    pred[10:40, 10:40] = True
    gt = pred.copy()
    assert abs(compute_f(pred, gt) - 1.0) < 1e-3


def test_compute_f_disjoint_is_zero():
    pred = np.zeros((50, 50), dtype=bool)
    pred[5:10, 5:10] = True
    gt = np.zeros((50, 50), dtype=bool)
    gt[40:45, 40:45] = True
    assert compute_f(pred, gt) < 0.05


def test_binarize_logits_threshold_default_05():
    logits = torch.tensor([[[[10.0, -10.0, 0.5]]]])
    out = binarize_logits(logits)
    assert out.shape == (1, 1, 1, 3)
    assert (out == torch.tensor([[[[1.0, 0.0, 1.0]]]])).all()
