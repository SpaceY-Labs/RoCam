"""
TensorRT Runtime Tracker for Jetson Orin Nano.

This is the production-grade tracker that uses TensorRT engines
for maximum performance. Designed to plug directly into your
existing GStreamer pipeline in cv_process/main.py.

Performance target: <16ms per frame for 60fps on Orin Nano (FP16).

Integration with your existing pipeline:
    Replace the nvinfer YOLO detection with this tracker.
    The tracker runs as a GStreamer appsink consumer or
    as a probe callback on the video buffer.

Usage:
    tracker = TRTSiamMaskTracker(
        template_engine="engines/template_encoder.engine",
        tracking_engine="engines/tracking_engine.engine",
    )

    # Initialize with reference image
    tracker.initialize(frame, bbox=(x, y, w, h))

    # Per-frame tracking in your GStreamer probe
    mask, bbox, score = tracker.update(frame)
"""

import time
from typing import Optional, Tuple

import cv2
import numpy as np

# TensorRT imports (available on Jetson)
try:
    import tensorrt as trt
    import pycuda.driver as cuda
    import pycuda.autoinit
    HAS_TRT = True
except ImportError:
    HAS_TRT = False
    print("WARNING: TensorRT/PyCUDA not available. Use PyTorch tracker instead.")


class TRTEngine:
    """Wrapper for a TensorRT engine with CUDA memory management."""

    def __init__(self, engine_path: str):
        if not HAS_TRT:
            raise RuntimeError("TensorRT not available")

        self.logger = trt.Logger(trt.Logger.WARNING)
        with open(engine_path, "rb") as f:
            runtime = trt.Runtime(self.logger)
            self.engine = runtime.deserialize_cuda_engine(f.read())

        self.context = self.engine.create_execution_context()

        # Allocate device memory for all bindings
        self.bindings = []
        self.inputs = {}
        self.outputs = {}

        for i in range(self.engine.num_io_tensors):
            name = self.engine.get_tensor_name(i)
            shape = self.engine.get_tensor_shape(name)
            dtype = trt.nptype(self.engine.get_tensor_dtype(name))
            size = int(np.prod(shape)) * np.dtype(dtype).itemsize

            device_mem = cuda.mem_alloc(size)
            self.bindings.append(int(device_mem))

            tensor_info = {
                "name": name,
                "shape": tuple(shape),
                "dtype": dtype,
                "device_mem": device_mem,
                "size": size,
            }

            mode = self.engine.get_tensor_mode(name)
            if mode == trt.TensorIOMode.INPUT:
                self.inputs[name] = tensor_info
                # Also allocate host memory for input
                tensor_info["host_mem"] = cuda.pagelocked_empty(
                    int(np.prod(shape)), dtype
                )
            else:
                self.outputs[name] = tensor_info
                tensor_info["host_mem"] = cuda.pagelocked_empty(
                    int(np.prod(shape)), dtype
                )

        self.stream = cuda.Stream()

    def infer(self, input_dict: dict) -> dict:
        """
        Run inference.
        Args: input_dict mapping input_name -> numpy array
        Returns: dict mapping output_name -> numpy array
        """
        # Copy inputs to device
        for name, arr in input_dict.items():
            info = self.inputs[name]
            np.copyto(info["host_mem"], arr.ravel())
            cuda.memcpy_htod_async(info["device_mem"], info["host_mem"], self.stream)

        # Set tensor addresses
        for name, info in {**self.inputs, **self.outputs}.items():
            self.context.set_tensor_address(name, int(info["device_mem"]))

        # Execute
        self.context.execute_async_v3(stream_handle=self.stream.handle)

        # Copy outputs back
        results = {}
        for name, info in self.outputs.items():
            cuda.memcpy_dtoh_async(info["host_mem"], info["device_mem"], self.stream)

        self.stream.synchronize()

        for name, info in self.outputs.items():
            results[name] = info["host_mem"].reshape(info["shape"]).copy()

        return results

    def __del__(self):
        """Free CUDA memory."""
        if hasattr(self, "stream"):
            del self.stream


class TRTSiamMaskTracker:
    """
    Production tracker using TensorRT for Jetson deployment.

    Same interface as SiamMaskTracker but uses TRT engines instead of PyTorch.
    """

    TEMPLATE_SIZE = 127
    SEARCH_SIZE = 255

    def __init__(
        self,
        template_engine: str,
        tracking_engine: str,
        score_threshold: float = 0.3,
        mask_threshold: float = 0.5,
        context_factor: float = 4.0,
        position_lr: float = 0.6,
        scale_lr: float = 0.4,
        velocity_smooth: float = 0.7,
    ):
        self.template_eng = TRTEngine(template_engine)
        self.tracking_eng = TRTEngine(tracking_engine)

        self.score_threshold = score_threshold
        self.mask_threshold = mask_threshold
        self.context_factor = context_factor
        self.position_lr = position_lr
        self.scale_lr = scale_lr
        self.velocity_smooth = velocity_smooth

        # State
        self.cx = 0.0
        self.cy = 0.0
        self.target_w = 0.0
        self.target_h = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.score = 0.0
        self.initialized = False

        # Cached template features
        self.template_p2 = None
        self.template_p3 = None
        self.template_p4 = None

    def initialize(self, frame: np.ndarray, bbox: Tuple[float, float, float, float]):
        """Initialize with frame and (x, y, w, h) bounding box."""
        x, y, w, h = bbox
        self.cx = x + w / 2
        self.cy = y + h / 2
        self.target_w = w
        self.target_h = h
        self.vx = 0.0
        self.vy = 0.0
        self.score = 1.0

        # Crop and encode template
        template_crop = self._crop_and_resize(
            frame, self.cx, self.cy,
            max(w, h) * 2.0, self.TEMPLATE_SIZE
        )

        results = self.template_eng.infer({"template": template_crop})
        self.template_p2 = results["template_p2"]
        self.template_p3 = results["template_p3"]
        self.template_p4 = results["template_p4"]
        self.initialized = True

    def update(
        self, frame: np.ndarray
    ) -> Optional[Tuple[np.ndarray, Tuple[float, float, float, float], float]]:
        """
        Track in new frame.
        Returns (mask, bbox, score) or None if lost/uninitialized.
        """
        if not self.initialized:
            return None

        H, W = frame.shape[:2]

        # Predict position
        pred_cx = self.cx + self.vx
        pred_cy = self.cy + self.vy

        # Crop search region
        search_size = max(self.target_w, self.target_h) * self.context_factor
        search_size = np.clip(search_size, min(H, W) * 0.05, min(H, W) * 0.8)

        search_crop = self._crop_and_resize(
            frame, pred_cx, pred_cy, search_size, self.SEARCH_SIZE
        )

        # Run tracking engine
        results = self.tracking_eng.infer({
            "search": search_crop,
            "template_p2": self.template_p2,
            "template_p3": self.template_p3,
            "template_p4": self.template_p4,
        })

        mask_logits = results["mask"]
        bbox = results["bbox"].flatten()
        score_logit = results["score"].flatten()

        # Sigmoid
        score = 1.0 / (1.0 + np.exp(-score_logit[0]))
        mask_prob = 1.0 / (1.0 + np.exp(-mask_logits.squeeze()))

        if score < self.score_threshold:
            return None

        # Update state
        crop_x1 = pred_cx - search_size / 2
        crop_y1 = pred_cy - search_size / 2
        new_cx = crop_x1 + bbox[0] * search_size
        new_cy = crop_y1 + bbox[1] * search_size
        new_w = bbox[2] * search_size
        new_h = bbox[3] * search_size

        # Smooth update
        old_cx, old_cy = self.cx, self.cy
        self.cx = self.cx * (1 - self.position_lr) + new_cx * self.position_lr
        self.cy = self.cy * (1 - self.position_lr) + new_cy * self.position_lr
        self.target_w = self.target_w * (1 - self.scale_lr) + new_w * self.scale_lr
        self.target_h = self.target_h * (1 - self.scale_lr) + new_h * self.scale_lr

        self.vx = self.velocity_smooth * self.vx + (1 - self.velocity_smooth) * (self.cx - old_cx)
        self.vy = self.velocity_smooth * self.vy + (1 - self.velocity_smooth) * (self.cy - old_cy)
        self.score = score

        # Map mask to full frame
        mask_bin = (mask_prob > self.mask_threshold).astype(np.uint8) * 255
        full_mask = self._map_mask_to_frame(mask_bin, crop_x1, crop_y1, search_size, H, W)

        out_bbox = (
            self.cx - self.target_w / 2,
            self.cy - self.target_h / 2,
            self.target_w,
            self.target_h,
        )

        return full_mask, out_bbox, score

    def _crop_and_resize(
        self, frame: np.ndarray, cx: float, cy: float, size: float, output_size: int
    ) -> np.ndarray:
        """Crop square region, pad if needed, resize, normalize to float32 CHW."""
        H, W = frame.shape[:2]
        x1 = int(round(cx - size / 2))
        y1 = int(round(cy - size / 2))
        x2 = int(round(cx + size / 2))
        y2 = int(round(cy + size / 2))

        pad_l, pad_t = max(0, -x1), max(0, -y1)
        pad_r, pad_b = max(0, x2 - W), max(0, y2 - H)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(W, x2), min(H, y2)

        crop = frame[y1:y2, x1:x2]
        if pad_l or pad_t or pad_r or pad_b:
            crop = cv2.copyMakeBorder(crop, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_CONSTANT, value=0)

        crop = cv2.resize(crop, (output_size, output_size))
        crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        return crop.transpose(2, 0, 1)[np.newaxis]  # (1, 3, H, W)

    def _map_mask_to_frame(
        self, mask: np.ndarray, crop_x1: float, crop_y1: float,
        crop_size: float, H: int, W: int
    ) -> np.ndarray:
        """Map mask from crop coords to full frame."""
        cs = int(round(crop_size))
        if cs < 1:
            return np.zeros((H, W), dtype=np.uint8)
        mask_resized = cv2.resize(mask, (cs, cs), interpolation=cv2.INTER_NEAREST)

        full_mask = np.zeros((H, W), dtype=np.uint8)
        x1, y1 = int(round(crop_x1)), int(round(crop_y1))

        sx1, sy1 = max(0, -x1), max(0, -y1)
        sx2, sy2 = min(cs, W - x1), min(cs, H - y1)
        dx1, dy1 = max(0, x1), max(0, y1)
        dx2, dy2 = dx1 + (sx2 - sx1), dy1 + (sy2 - sy1)

        if dx2 > dx1 and dy2 > dy1:
            full_mask[dy1:dy2, dx1:dx2] = mask_resized[sy1:sy2, sx1:sx2]

        return full_mask
