#!/usr/bin/env python3
import argparse
import os
import shutil
import sys
import time
import hashlib
import types
from pathlib import Path
from copy import deepcopy

import torch
import torch.nn as nn
from ultralytics import YOLO
from ultralytics.nn.modules import C2f, Detect, v10Detect
import ultralytics.utils
import ultralytics.models.yolo
import ultralytics.utils.tal as _m
from ultralytics.utils.patches import torch_load
import onnx
import onnxslim
from util import generate_pgie_config, ENGINE_FILE_NAME

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib

# Compatibility hacks for YOLO models
sys.modules["ultralytics.yolo"] = ultralytics.models.yolo
sys.modules["ultralytics.yolo.utils"] = ultralytics.utils


WIDTH = 1920
HEIGHT = 1080
INFER_SCALE = 0.5
CACHE_DIR = Path("/mnt/data/tensorrt_engine_cache")


def _dist2bbox(distance, anchor_points, xywh=False, dim=-1):
    lt, rb = distance.chunk(2, dim)
    x1y1 = anchor_points - lt
    x2y2 = anchor_points + rb
    return torch.cat((x1y1, x2y2), dim)


_m.dist2bbox.__code__ = _dist2bbox.__code__


def forward_deepstream(self, x):
    """
    Forward pass replacement for YOLO26 Detect head to match DeepStream expectations.
    """
    x_detach = [xi.detach() for xi in x]
    if hasattr(self, "inference"):
        one2one = [
            torch.cat(
                (self.one2one_cv2[i](x_detach[i]), self.one2one_cv3[i](x_detach[i])), 1
            )
            for i in range(self.nl)
        ]
        y = self.inference(one2one)
    else:
        one2one = self.forward_head(x_detach, **self.one2one)
        y = self._inference(one2one)
    return y


class DeepStreamOutput(nn.Module):
    """
    Post-processing layer to format YOLO output for DeepStream's nvinfer.
    Concatenates [boxes, scores, labels] into a single output tensor.
    """

    def __init__(self):
        super().__init__()

    def forward(self, x):
        x = x.transpose(1, 2)
        boxes = x[:, :, :4]
        scores, labels = torch.max(x[:, :, 4:], dim=-1, keepdim=True)
        return torch.cat([boxes, scores, labels.to(boxes.dtype)], dim=-1)


def get_file_md5(file_path: Path) -> str:
    """Computes MD5 hash of a file."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.ERROR:
        err, dbg = message.parse_error()
        print(f"[GStreamer ERROR] {err}\n{dbg}", file=sys.stderr)
        loop.quit()
    elif t == Gst.MessageType.EOS:
        loop.quit()
    return True


def get_model_info(pt_path: Path):
    """
    Identifies the model type (YOLO11 vs YOLO26) from the .pt file metadata.
    Checks train_args.model string first, then falls back to model yaml metadata.
    """
    try:
        from ultralytics.nn.tasks import DetectionModel

        torch.serialization.add_safe_globals([DetectionModel])
        m = torch.load(str(pt_path), map_location="cpu", weights_only=False)
        if isinstance(m, dict) and "train_args" in m:
            train_model = m["train_args"].get("model", "unknown")
            if "yolo11" in train_model:
                return "YOLO11"
            elif "yolo26" in train_model:
                return "YOLO26"

        # Fallback: check model yaml metadata (handles fine-tuned checkpoints)
        if isinstance(m, dict):
            model_obj = m.get("ema") or m.get("model")
            if model_obj is not None and hasattr(model_obj, "yaml"):
                yaml_info = model_obj.yaml
                yaml_file = yaml_info.get("yaml_file", "") if isinstance(yaml_info, dict) else ""
                if "yolo11" in yaml_file:
                    return "YOLO11"
                elif "yolo26" in yaml_file:
                    return "YOLO26"

        return "Unknown"
    except Exception as e:
        print(f"[WARN] Could not identify model info: {e}")
        return "Unknown"


def simplify_onnx(onnx_path: Path):
    """Simplifies the ONNX model using onnxslim."""
    print(f"[INFO] Simplifying ONNX model: {onnx_path}")
    model_onnx = onnx.load(str(onnx_path))
    model_onnx = onnxslim.slim(model_onnx)
    onnx.save(model_onnx, str(onnx_path))


def pt_yolo11_to_onnx(input_pt: Path, output_onnx: Path):
    """
    Exports a YOLO11 .pt model to a DeepStream-compatible ONNX model.
    """
    img_size = _align_to_stride(int(HEIGHT * INFER_SCALE), int(WIDTH / 2), 32)
    batch_size = 1
    opset_version = 17
    device = torch.device("cpu")

    print(f"[INFO] Loading YOLO11 model: {input_pt}")

    ckpt = torch_load(str(input_pt), map_location="cpu")
    ckpt = (ckpt.get("ema") or ckpt["model"]).to(device).float()
    if not hasattr(ckpt, "stride"):
        ckpt.stride = torch.tensor([32.0])
    if hasattr(ckpt, "names") and isinstance(ckpt.names, (list, tuple)):
        ckpt.names = dict(enumerate(ckpt.names))

    model = ckpt.fuse().eval() if hasattr(ckpt, "fuse") else ckpt.eval()

    for m in model.modules():
        if hasattr(m, "inplace"):
            m.inplace = True
        elif type(m).__name__ == "Upsample" and not hasattr(
            m, "recompute_scale_factor"
        ):
            m.recompute_scale_factor = None

    model = deepcopy(model).to(device)
    for p in model.parameters():
        p.requires_grad = False
    model.eval()
    model.float()
    model = model.fuse()

    for k, m in model.named_modules():
        if m.__class__.__name__ in ("Detect", "RTDETRDecoder"):
            m.dynamic = False
            m.export = True
            m.format = "onnx"

    model = nn.Sequential(model, DeepStreamOutput())

    print(
        f"[INFO] Exporting to ONNX: {output_onnx} (Size: {img_size}, Batch: {batch_size})"
    )
    dummy_input = torch.zeros(batch_size, 3, *img_size).to(device)

    torch.onnx.export(
        model,
        dummy_input,
        str(output_onnx),
        verbose=False,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
    )
    simplify_onnx(output_onnx)
    print(f"[INFO] YOLO11 ONNX export complete: {output_onnx}")


def _align_to_stride(h: int, w: int, stride: int = 32):
    """Round dimensions up to the nearest multiple of stride."""
    import math
    return math.ceil(h / stride) * stride, math.ceil(w / stride) * stride


def pt_yolo26_to_onnx(input_pt: Path, output_onnx: Path):
    """
    Exports a YOLO26 .pt model to a DeepStream-compatible ONNX model.
    """
    batch_size = 1
    opset_version = 17
    device = torch.device("cpu")

    print(f"[INFO] Loading YOLO26 model: {input_pt}")

    yolo_model = YOLO(str(input_pt))
    model = deepcopy(yolo_model.model).to(device)
    for p in model.parameters():
        p.requires_grad = False
    model.eval()
    model.float()
    model = model.fuse()

    for k, m in model.named_modules():
        if isinstance(m, (Detect, v10Detect)):
            m.dynamic = False
            m.export = True
            m.format = "onnx"
            if m.__class__.__name__ == "Detect":
                m.forward = types.MethodType(forward_deepstream, m)
        elif isinstance(m, C2f):
            m.forward = m.forward_split

    model = nn.Sequential(model, DeepStreamOutput())

    stride = int(max(yolo_model.model.stride))
    img_size = _align_to_stride(int(HEIGHT * INFER_SCALE), int(WIDTH / 2), stride)
    print(
        f"[INFO] Exporting to ONNX: {output_onnx} (Size: {img_size}, Batch: {batch_size}, Stride: {stride})"
    )
    dummy_input = torch.zeros(batch_size, 3, *img_size).to(device)

    torch.onnx.export(
        model,
        dummy_input,
        str(output_onnx),
        verbose=False,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"],
    )
    simplify_onnx(output_onnx)
    print(f"[INFO] YOLO26 ONNX export complete: {output_onnx}")


def onnx_to_engine(input_onnx: Path, output_engine: Path):
    """
    Triggers DeepStream's nvinfer to build a TensorRT engine.
    Always rebuilds by deleting the intermediate engine first.
    Moves the result to the specified output path.
    """
    # Change working directory to the script's directory for nvinfer consistency
    script_dir = Path(__file__).parent.resolve()
    orig_cwd = os.getcwd()
    os.chdir(script_dir)

    try:
        # pgie will always create the generated engine file at {ENGINE_FILE_NAME} under cwd,
        temp_engine_path = Path(ENGINE_FILE_NAME)
        if temp_engine_path.exists():
            temp_engine_path.unlink()

        # Generate a unique temp config name under /tmp
        md5_onnx = hashlib.md5(str(input_onnx).encode()).hexdigest()
        temp_config_path = Path("/tmp") / f"temp_config_{md5_onnx}.txt"
        generate_pgie_config(str(temp_config_path), onnx_path=str(input_onnx))

        Gst.init(None)
        pipeline_desc = f"""
            videotestsrc num-buffers=1 ! 
            video/x-raw,format=NV12,width={WIDTH},height={HEIGHT} ! 
            nvvideoconvert compute-hw=1 ! 
            video/x-raw(memory:NVMM),format=NV12 ! 
            mux.sink_0
            nvstreammux name=mux width={WIDTH} height={HEIGHT} batch-size=1 ! 
            nvinfer config-file-path={temp_config_path} ! 
            fakesink
        """

        print("[INFO] Starting TensorRT engine build...")
        pipeline = Gst.parse_launch(pipeline_desc)
        loop = GLib.MainLoop()
        bus = pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", bus_call, loop)

        pipeline.set_state(Gst.State.PLAYING)
        try:
            loop.run()
        finally:
            pipeline.set_state(Gst.State.NULL)

        if temp_engine_path.exists():
            output_engine.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(temp_engine_path), str(output_engine))
            return True
        else:
            print("[ERROR] Engine file was not generated by nvinfer.", file=sys.stderr)
            return False
    finally:
        if "temp_config_path" in locals() and temp_config_path.exists():
            temp_config_path.unlink()
        os.chdir(orig_cwd)


def pt_to_engine(input_pt: str, output_engine: str, rebuild: bool = False, scale_factor: float = 0.5):
    """
    Checks cache, handles conversion flow: .pt -> .onnx -> .engine.
    """
    start_time = time.time()
    pt_path = Path(input_pt).resolve()
    if not pt_path.exists():
        print(f"[ERROR] Input .pt file not found: {pt_path}", file=sys.stderr)
        return False

    # Apply scale factor globally
    global INFER_SCALE
    INFER_SCALE = scale_factor
    infer_h = int(HEIGHT * scale_factor)
    infer_w = int(WIDTH / 2)
    print(f"[INFO] Inference resolution: ~{infer_h}x{infer_w} (height_scale={scale_factor}, width=WIDTH/2)")

    # 1. Check Cache (include scale in cache key to avoid collisions)
    model_type = get_model_info(pt_path)
    print(f"[INFO] Identified model type: {model_type}")

    pt_md5_raw = get_file_md5(pt_path)
    scale_tag = f"_s{int(scale_factor * 100)}" if scale_factor != 0.5 else ""
    pt_md5 = pt_md5_raw + scale_tag
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached_engine = CACHE_DIR / f"{pt_md5}.engine"
    output_engine_path = Path(output_engine).resolve()

    if cached_engine.exists() and not rebuild:
        print(f"[INFO] Cache hit: Found existing engine for MD5 {pt_md5}")
        if cached_engine != output_engine_path:
            print(f"[INFO] Copying from cache: {cached_engine} -> {output_engine_path}")
            output_engine_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(str(cached_engine), str(output_engine_path))
        else:
            print(f"[INFO] Engine already at destination: {output_engine_path}")
        print(f"[OK] Engine restored from cache in {time.time() - start_time:.2f}s")
        return True

    print(f"[INFO] Cache miss or rebuild forced for {pt_path.name}")

    # 2. Export ONNX (Temporary under /tmp)
    temp_onnx = Path("/tmp") / f"temp_{pt_md5}.onnx"
    try:
        if model_type == "YOLO11":
            pt_yolo11_to_onnx(pt_path, temp_onnx)
        elif model_type == "YOLO26":
            pt_yolo26_to_onnx(pt_path, temp_onnx)
        else:
            print(f"[ERROR] Unsupported model type: {model_type}", file=sys.stderr)
            return False

        # 3. Build Engine
        if onnx_to_engine(temp_onnx, output_engine_path):
            # 4. Update Cache
            if cached_engine != output_engine_path:
                shutil.copy(str(output_engine_path), str(cached_engine))

            duration = time.time() - start_time
            size_mb = output_engine_path.stat().st_size / (1024 * 1024)
            print(
                f"\n[OK] Engine successfully generated: {output_engine_path} ({size_mb:.1f} MB)"
            )
            print(f"[INFO] Total conversion time: {duration / 60:.2f} minutes")
            return True
        else:
            return False
    finally:
        if temp_onnx.exists():
            temp_onnx.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert YOLO .pt to TensorRT engine with caching"
    )
    parser.add_argument("input_pt", help="Path to input .pt file")
    parser.add_argument("output_engine", help="Path to save the generated engine")
    parser.add_argument(
        "--rebuild", action="store_true", help="Force rebuild even if cache exists"
    )
    parser.add_argument(
        "--scale-factor", type=float, default=0.5,
        help="Height scale factor (default 0.5). Width is fixed at WIDTH/2=960. "
             "E.g. 0.68 -> 736x960, 0.76 -> 816x960"
    )

    args = parser.parse_args()

    success = pt_to_engine(args.input_pt, args.output_engine, args.rebuild, args.scale_factor)
    sys.exit(0 if success else 1)
