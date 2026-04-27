"""Learning rate schedulers for MaskTrackNet training."""
from __future__ import annotations
import math
import torch


class WarmupCosineLR:
    """Linear warmup then cosine decay to lrf_ratio * lr0.

    This scales each param-group's *initial* LR by the same multiplier so that
    multiple param groups (e.g. backbone vs head with different base LRs) keep
    their relative ratios.
    """

    def __init__(
        self,
        optimizer: torch.optim.Optimizer,
        lr0: float,
        lrf_ratio: float,
        total_steps: int,
        warmup_steps: int = 0,
    ):
        self.optimizer = optimizer
        self.lr0 = lr0
        self.lrf_ratio = lrf_ratio
        self.total_steps = total_steps
        self.warmup_steps = warmup_steps
        self._step = 0
        self._initial_lrs = [g["lr"] for g in optimizer.param_groups]
        self._set_lr(0.0)

    def _multiplier(self, step: int) -> float:
        if step < self.warmup_steps:
            return step / max(1, self.warmup_steps)
        progress = (step - self.warmup_steps) / max(1, self.total_steps - self.warmup_steps)
        progress = min(1.0, max(0.0, progress))
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return self.lrf_ratio + (1.0 - self.lrf_ratio) * cosine

    def _set_lr(self, mult: float) -> None:
        for g, base in zip(self.optimizer.param_groups, self._initial_lrs):
            g["lr"] = base * mult

    def step(self) -> None:
        self._step += 1
        self._set_lr(self._multiplier(self._step))

    def state_dict(self) -> dict:
        return {"step": self._step, "initial_lrs": self._initial_lrs}

    def load_state_dict(self, state: dict) -> None:
        self._step = state["step"]
        self._initial_lrs = state["initial_lrs"]
        self._set_lr(self._multiplier(self._step))
