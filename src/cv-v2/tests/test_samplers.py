"""Tests for data/samplers.py."""
from __future__ import annotations
from collections import Counter
import pytest

from data.samplers import MultiScaleSampler


def test_multiscale_sampler_returns_only_listed_sizes():
    sizes = [384, 448, 512, 576, 640]
    sampler = MultiScaleSampler(sizes, seed=0)
    seen = {sampler.next_size() for _ in range(200)}
    assert seen.issubset(set(sizes))


def test_multiscale_sampler_reasonably_uniform():
    sizes = [384, 448, 512, 576, 640]
    sampler = MultiScaleSampler(sizes, seed=0)
    counts = Counter(sampler.next_size() for _ in range(5000))
    # Expect roughly 1000 each. Within 25% of expected.
    expected = 5000 / len(sizes)
    for s in sizes:
        assert abs(counts[s] - expected) < 0.25 * expected, (s, counts[s])


def test_multiscale_sampler_deterministic_with_seed():
    s1 = MultiScaleSampler([384, 512, 640], seed=42)
    s2 = MultiScaleSampler([384, 512, 640], seed=42)
    seq1 = [s1.next_size() for _ in range(100)]
    seq2 = [s2.next_size() for _ in range(100)]
    assert seq1 == seq2


def test_multiscale_sampler_rejects_non_multiples_of_32():
    with pytest.raises(ValueError, match="multiple of 32"):
        MultiScaleSampler([384, 500], seed=0)


def test_multiscale_sampler_rejects_empty_list():
    with pytest.raises(ValueError, match="empty"):
        MultiScaleSampler([], seed=0)
