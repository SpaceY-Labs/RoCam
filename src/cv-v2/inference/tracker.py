"""
Real-time SiamMask-Lite Tracker — integrates with your GStreamer pipeline.

This is the inference-time tracker that:
1. Takes a reference image (from user click/selection in the web app)
2. Encodes it once into template features
3. Every frame: crops search region around last known position,
   runs the model, outputs mask + bbox + confidence
4. Updates search region position for next frame (motion model)

The tracker handles:
- Dynamic search region sizing based on object scale
- Simple Kalman-like motion prediction for smooth tracking
- Scale estimation from mask area
- Lost target detection and recovery

For TensorRT deployment, see export_tensorrt.py
"""

import time
from dataclasses import dataclass, field
from typing import Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn.functional as F

import sys
from pathlib import Path


from models.siammask_lite import SiamMaskLite, build_model


@dataclass
class TrackerState:
    """Mutable state of the tracker between frames."""
    # Target position in full frame (center x, center y)
    cx: float = 0.0
    cy: float = 0.0
    # Target size in full frame
    target_w: float = 0.0
    target_h: float = 0.0
    # Search region scale factor
    search_scale: float = 1.0
    # Velocity for motion prediction
    vx: float = 0.0
    vy: float = 0.0
    # Tracking confidence
    score: float = 0.0
    # Lost target counter
    lost_count: int = 0
    # Is initialized
    initialized: bool = False


@dataclass
class TrackerConfig:
    """Tracker hyperparameters."""
    # Search region context multiplier
    context_factor: float = 4.0
    # Minimum/maximum search region relative to frame
    min_search_ratio: float = 0.05
    max_search_ratio: float = 0.8
    # Score threshold for "target present"
    score_threshold: float = 0.3
    # Velocity smoothing (EMA factor)
    velocity_smooth: float = 0.7
    # Scale update rate
    scale_lr: float = 0.4
    # Position update rate from bbox (vs motion model)
    position_lr: float = 0.6
    # Max frames lost before giving up
    max_lost_frames: int = 30
    # Mask binarization threshold
    mask_threshold: float = 0.5
    # Penalty for large displacement
    displacement_penalty: float = 0.8


class SiamMaskTracker:
    """
    Real-time visual object tracker with mask output.

    Typical usage with your GStreamer pipeline:

        tracker = SiamMaskTracker("checkpoints/best.pth")

        # When user clicks on target in web app:
        tracker.initialize(frame, bbox=(x, y, w, h))

        # In your inference probe callback (every frame):
        result = tracker.update(frame)
        if result is not None:
            mask, bbox, score = result
            # mask: full-frame binary mask
            # bbox: (x, y, w, h) in pixel coordinates
            # score: confidence 0-1
    """

    TEMPLATE_SIZE = 127
    SEARCH_SIZE = 255

    def __init__(
        self,
        model_path: str,
        config: Optional[TrackerConfig] = None,
        device: str = "cuda",
    ):
        self.config = config or TrackerConfig()
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")

        # Load model
        self.model = build_model(model_path)
        self.model = self.model.to(self.device)
        self.model.eval()

        # State
        self.state = TrackerState()
        self.template_feats: Optional[Tuple[torch.Tensor, ...]] = None

        # Pre-computed Hanning window for score penalization
        self._window = self._create_hanning_window()

    def _create_hanning_window(self, size: int = 25) -> np.ndarray:
        """Create 2D Hanning window for penalizing large displacements."""
        h = np.hanning(size)
        window = np.outer(h, h)
        return window / window.max()

    @torch.no_grad()
    def initialize(
        self,
        frame: np.ndarray,
        bbox: Tuple[float, float, float, float],
    ) -> None:
        """
        Initialize tracker with first frame and target bounding box.

        Args:
            frame: BGR image (H, W, 3)
            bbox:  (x, y, w, h) of target in pixel coordinates
        """
        x, y, w, h = bbox
        self.state = TrackerState(
            cx=x + w / 2,
            cy=y + h / 2,
            target_w=w,
            target_h=h,
            search_scale=1.0,
            score=1.0,
            initialized=True,
        )

        # Crop template
        template_crop = self._crop_template(frame)
        template_tensor = self._preprocess(template_crop, self.TEMPLATE_SIZE)

        # Encode template (cached for all future frames)
        self.template_feats = self.model.encode_template(template_tensor)

    @torch.no_grad()
    def update(
        self, frame: np.ndarray
    ) -> Optional[Tuple[np.ndarray, Tuple[float, float, float, float], float]]:
        """
        Track target in new frame.

        Args:
            frame: BGR image (H, W, 3)

        Returns:
            None if not initialized or target lost
            Otherwise: (mask, bbox, score)
                mask:  (H, W) uint8 binary mask in full frame coordinates
                bbox:  (x, y, w, h) in pixel coordinates
                score: confidence 0-1
        """
        if not self.state.initialized or self.template_feats is None:
            return None

        H, W = frame.shape[:2]

        # Predict next position using velocity
        pred_cx = self.state.cx + self.state.vx
        pred_cy = self.state.cy + self.state.vy

        # Crop search region around predicted position
        search_crop, crop_info = self._crop_search(frame, pred_cx, pred_cy)
        search_tensor = self._preprocess(search_crop, self.SEARCH_SIZE)

        # Run model
        mask_logits, bbox_pred, score_logit = self.model.track(
            search_tensor, self.template_feats
        )

        # Post-process outputs
        score = torch.sigmoid(score_logit).item()
        mask_prob = torch.sigmoid(mask_logits).squeeze().cpu().numpy()
        bbox = bbox_pred.squeeze().cpu().numpy()  # (cx, cy, w, h) normalized to search crop

        if score < self.config.score_threshold:
            self.state.lost_count += 1
            self.state.score = score
            if self.state.lost_count > self.config.max_lost_frames:
                self.state.initialized = False
            return None

        # Convert bbox from search crop coordinates to full frame
        crop_x, crop_y, crop_size = crop_info
        new_cx = crop_x + bbox[0] * crop_size
        new_cy = crop_y + bbox[1] * crop_size
        new_w = bbox[2] * crop_size
        new_h = bbox[3] * crop_size

        # Smooth position update
        lr = self.config.position_lr
        updated_cx = self.state.cx * (1 - lr) + new_cx * lr
        updated_cy = self.state.cy * (1 - lr) + new_cy * lr

        # Update velocity (EMA)
        alpha = self.config.velocity_smooth
        self.state.vx = alpha * self.state.vx + (1 - alpha) * (updated_cx - self.state.cx)
        self.state.vy = alpha * self.state.vy + (1 - alpha) * (updated_cy - self.state.cy)

        # Smooth scale update
        s_lr = self.config.scale_lr
        self.state.target_w = self.state.target_w * (1 - s_lr) + new_w * s_lr
        self.state.target_h = self.state.target_h * (1 - s_lr) + new_h * s_lr

        self.state.cx = np.clip(updated_cx, 0, W)
        self.state.cy = np.clip(updated_cy, 0, H)
        self.state.score = score
        self.state.lost_count = 0

        # Map mask back to full frame
        full_mask = self._map_mask_to_frame(mask_prob, crop_info, (H, W))

        # Output bbox
        out_bbox = (
            self.state.cx - self.state.target_w / 2,
            self.state.cy - self.state.target_h / 2,
            self.state.target_w,
            self.state.target_h,
        )

        return full_mask, out_bbox, score

    def _crop_template(self, frame: np.ndarray) -> np.ndarray:
        """Crop template region from frame."""
        s = self.state
        context_size = max(s.target_w, s.target_h) * 2.0
        return self._crop_region(frame, s.cx, s.cy, context_size)

    def _crop_search(
        self, frame: np.ndarray, cx: float, cy: float
    ) -> Tuple[np.ndarray, Tuple[float, float, float]]:
        """
        Crop search region from frame.
        Returns: (crop, (crop_x1, crop_y1, crop_size))
        """
        H, W = frame.shape[:2]
        s = self.state

        # Search size based on target scale
        search_size = max(s.target_w, s.target_h) * self.config.context_factor
        search_size = np.clip(
            search_size,
            min(H, W) * self.config.min_search_ratio,
            min(H, W) * self.config.max_search_ratio,
        )

        crop_x1 = cx - search_size / 2
        crop_y1 = cy - search_size / 2

        crop = self._crop_region(frame, cx, cy, search_size)
        return crop, (crop_x1, crop_y1, search_size)

    def _crop_region(
        self, frame: np.ndarray, cx: float, cy: float, size: float
    ) -> np.ndarray:
        """Crop a square region with zero-padding for out-of-bounds."""
        H, W = frame.shape[:2]

        x1 = int(round(cx - size / 2))
        y1 = int(round(cy - size / 2))
        x2 = int(round(cx + size / 2))
        y2 = int(round(cy + size / 2))

        # Padding
        pad_l = max(0, -x1)
        pad_t = max(0, -y1)
        pad_r = max(0, x2 - W)
        pad_b = max(0, y2 - H)

        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(W, x2)
        y2 = min(H, y2)

        crop = frame[y1:y2, x1:x2]

        if pad_l > 0 or pad_t > 0 or pad_r > 0 or pad_b > 0:
            crop = cv2.copyMakeBorder(
                crop, pad_t, pad_b, pad_l, pad_r,
                cv2.BORDER_CONSTANT, value=(0, 0, 0),
            )

        return crop

    def _preprocess(self, crop: np.ndarray, size: int) -> torch.Tensor:
        """Resize, normalize, and convert to tensor."""
        crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_LINEAR)
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        tensor = torch.from_numpy(crop).permute(2, 0, 1).unsqueeze(0)
        return tensor.to(self.device)

    def _map_mask_to_frame(
        self,
        mask_prob: np.ndarray,  # (255, 255) float
        crop_info: Tuple[float, float, float],
        frame_shape: Tuple[int, int],
    ) -> np.ndarray:
        """Map the mask from search crop coordinates back to full frame."""
        H, W = frame_shape
        crop_x1, crop_y1, crop_size = crop_info

        # Binarize
        mask_bin = (mask_prob > self.config.mask_threshold).astype(np.uint8) * 255

        # Resize to crop size
        crop_size_int = int(round(crop_size))
        if crop_size_int < 1:
            return np.zeros((H, W), dtype=np.uint8)
        mask_resized = cv2.resize(mask_bin, (crop_size_int, crop_size_int), interpolation=cv2.INTER_NEAREST)

        # Place in full frame
        full_mask = np.zeros((H, W), dtype=np.uint8)

        x1 = int(round(crop_x1))
        y1 = int(round(crop_y1))

        # Source region (within the resized mask)
        src_x1 = max(0, -x1)
        src_y1 = max(0, -y1)
        src_x2 = min(crop_size_int, W - x1)
        src_y2 = min(crop_size_int, H - y1)

        # Destination region (within the full frame)
        dst_x1 = max(0, x1)
        dst_y1 = max(0, y1)
        dst_x2 = dst_x1 + (src_x2 - src_x1)
        dst_y2 = dst_y1 + (src_y2 - src_y1)

        if dst_x2 > dst_x1 and dst_y2 > dst_y1 and src_x2 > src_x1 and src_y2 > src_y1:
            full_mask[dst_y1:dst_y2, dst_x1:dst_x2] = mask_resized[src_y1:src_y2, src_x1:src_x2]

        return full_mask


class TrackerBenchmark:
    """Benchmark tracker speed for Orin Nano profiling."""

    @staticmethod
    def run(model_path: str, n_frames: int = 500, frame_size: Tuple[int, int] = (1920, 1080)):
        tracker = SiamMaskTracker(model_path)

        # Create dummy frame
        frame = np.random.randint(0, 255, (*frame_size[::-1], 3), dtype=np.uint8)

        # Initialize with fake bbox
        tracker.initialize(frame, (frame_size[0] // 2 - 50, frame_size[1] // 2 - 50, 100, 100))

        # Warmup
        for _ in range(10):
            tracker.update(frame)

        # Benchmark
        times = []
        for _ in range(n_frames):
            t0 = time.perf_counter()
            tracker.update(frame)
            times.append(time.perf_counter() - t0)

        times = np.array(times) * 1000  # ms
        print(f"=== Tracker Benchmark ({n_frames} frames) ===")
        print(f"  Mean:   {times.mean():.2f} ms ({1000/times.mean():.1f} FPS)")
        print(f"  Median: {np.median(times):.2f} ms")
        print(f"  P95:    {np.percentile(times, 95):.2f} ms")
        print(f"  P99:    {np.percentile(times, 99):.2f} ms")
        print(f"  Min:    {times.min():.2f} ms")
        print(f"  Max:    {times.max():.2f} ms")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()

    if args.benchmark:
        TrackerBenchmark.run(args.model)
