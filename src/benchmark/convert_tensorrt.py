#!/usr/bin/env python3
import argparse
import os
import shutil
import sys
import time
import hashlib
from pathlib import Path
from copy import deepcopy

import torch
import torch.nn as nn
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

def _dist2bbox(distance, anchor_points, xywh=False, dim=-1):
    lt, rb = distance.chunk(2, dim)
    x1y1 = anchor_points - lt
    x2y2 = anchor_points + rb
    return torch.cat((x1y1, x2y2), dim)

_m.dist2bbox.__code__ = _dist2bbox.__code__

WIDTH = 1920
HEIGHT = 1080
CACHE_DIR = Path("/mnt/data/tensorrt_engine_cache")

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

def pt_to_onnx(input_pt: Path, output_onnx: Path):
    """
    Exports a YOLO .pt model to a DeepStream-compatible ONNX model.
    Follows logic from export_yolo11.py exactly.
    """
    img_size = (int(HEIGHT / 2), int(WIDTH / 2)) # (540, 960)
    batch_size = 1
    opset_version = 17
    device = torch.device('cpu')

    print(f"[INFO] Loading PyTorch model: {input_pt}")
    
    # yolo11_export logic from export_yolo11.py
    ckpt = torch_load(str(input_pt), map_location='cpu')
    ckpt = (ckpt.get('ema') or ckpt['model']).to(device).float()
    if not hasattr(ckpt, 'stride'):
        ckpt.stride = torch.tensor([32.])
    if hasattr(ckpt, 'names') and isinstance(ckpt.names, (list, tuple)):
        ckpt.names = dict(enumerate(ckpt.names))
    
    model = ckpt.fuse().eval() if hasattr(ckpt, 'fuse') else ckpt.eval()
    
    for m in model.modules():
        t = type(m)
        if hasattr(m, 'inplace'):
            m.inplace = True
        elif t.__name__ == 'Upsample' and not hasattr(m, 'recompute_scale_factor'):
            m.recompute_scale_factor = None
            
    model = deepcopy(model).to(device)
    for p in model.parameters():
        p.requires_grad = False
    model.eval()
    model.float()
    model = model.fuse()
    
    for k, m in model.named_modules():
        if m.__class__.__name__ in ('Detect', 'RTDETRDecoder'):
            m.dynamic = False
            m.export = True
            m.format = 'onnx'

    # Append DeepStream formatting layer
    model = nn.Sequential(model, DeepStreamOutput())

    print(f"[INFO] Exporting to ONNX: {output_onnx} (Size: {img_size}, Batch: {batch_size})")
    dummy_input = torch.zeros(batch_size, 3, *img_size).to(device)
    
    torch.onnx.export(
        model,
        dummy_input,
        str(output_onnx),
        verbose=False,
        opset_version=opset_version,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["output"]
    )

    print("[INFO] Simplifying ONNX model...")
    model_onnx = onnx.load(str(output_onnx))
    model_onnx = onnxslim.slim(model_onnx)
    onnx.save(model_onnx, str(output_onnx))
    print(f"[INFO] ONNX export complete: {output_onnx}")

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
            nvvideoconvert ! 
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
        if 'temp_config_path' in locals() and temp_config_path.exists():
            temp_config_path.unlink()
        os.chdir(orig_cwd)

def pt_to_engine(input_pt: str, output_engine: str, rebuild: bool = False):
    """
    Checks cache, handles conversion flow: .pt -> .onnx -> .engine.
    """
    start_time = time.time()
    pt_path = Path(input_pt).resolve()
    if not pt_path.exists():
        print(f"[ERROR] Input .pt file not found: {pt_path}", file=sys.stderr)
        return False

    # 1. Check Cache
    pt_md5 = get_file_md5(pt_path)
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
        pt_to_onnx(pt_path, temp_onnx)

        # 3. Build Engine
        if onnx_to_engine(temp_onnx, output_engine_path):
            # 4. Update Cache
            if cached_engine != output_engine_path:
                shutil.copy(str(output_engine_path), str(cached_engine))
            
            duration = time.time() - start_time
            size_mb = output_engine_path.stat().st_size / (1024 * 1024)
            print(f"\n[OK] Engine successfully generated: {output_engine_path} ({size_mb:.1f} MB)")
            print(f"[INFO] Total conversion time: {duration/60:.2f} minutes")
            return True
        else:
            return False
    finally:
        if temp_onnx.exists():
            temp_onnx.unlink()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert YOLO .pt to TensorRT engine with caching")
    parser.add_argument("input_pt", help="Path to input .pt file")
    parser.add_argument("output_engine", help="Path to save the generated engine")
    parser.add_argument("--rebuild", action="store_true", help="Force rebuild even if cache exists")
    
    args = parser.parse_args()
    
    success = pt_to_engine(args.input_pt, args.output_engine, args.rebuild)
    sys.exit(0 if success else 1)
