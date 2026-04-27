"""Samplers for cv-v2 data pipeline.

MultiScaleSampler: uniform random pick from a fixed list of square input sizes.
Used to vary H=W per training iteration.
"""
from __future__ import annotations
import random


class MultiScaleSampler:
    """Yields square input sizes from a fixed list. All sizes must be multiples of 32."""

    def __init__(self, sizes: list[int], seed: int = 0):
        if not sizes:
            raise ValueError("sizes list is empty")
        for s in sizes:
            if s <= 0 or s % 32 != 0:
                raise ValueError(f"size {s} must be a positive multiple of 32")
        self.sizes = list(sizes)
        self._rng = random.Random(seed)

    def next_size(self) -> int:
        return self._rng.choice(self.sizes)
