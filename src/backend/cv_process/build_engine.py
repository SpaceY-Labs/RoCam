#!/usr/bin/env python3
"""
Minimal DeepStream/TensorRT engine builder.

Goal:
- Use the SAME pgie_config.txt as your cv_process pipeline.
- Trigger nvinfer to build and serialize .engine (if model-engine-file is set).
- Avoid IPC / Flask / display / camera / mp4.

Usage:
  cd ~/bm/backend/cv_process
  python3 build_engine.py --rebuild
  python3 build_engine.py
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path

import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib


def parse_model_engine_file(cfg_path: Path) -> Path | None:
    """
    Parse model-engine-file=... from pgie_config.txt (INI-like).
    Returns an absolute path if found, else None.
    """
    pattern = re.compile(r"^\s*model-engine-file\s*=\s*(.+?)\s*$")
    text = cfg_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for line in text:
        s = line.strip()
        if not s or s.startswith("#") or s.startswith(";"):
            continue
        m = pattern.match(s)
        if m:
            val = m.group(1).strip().strip('"').strip("'")
            p = Path(val)
            return p if p.is_absolute() else (cfg_path.parent / p).resolve()
    return None


def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.ERROR:
        err, dbg = message.parse_error()
        print(f"[GStreamer ERROR] {err}\n{dbg}", file=sys.stderr)
        loop.quit()
    elif t == Gst.MessageType.EOS:
        print("[INFO] EOS")
        loop.quit()
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="pgie_config.txt", help="Path to pgie_config.txt (default: ./pgie_config.txt)")
    ap.add_argument("--rebuild", action="store_true", help="Delete existing engine first (force rebuild)")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--num-buffers", type=int, default=300, help="Dummy frames to push through (default: 300)")
    ap.add_argument("--timeout-sec", type=int, default=300, help="Stop after N seconds (default: 300)")
    args = ap.parse_args()

    cfg_path = Path(args.config).resolve()
    if not cfg_path.exists():
        print(f"[ERROR] Config not found: {cfg_path}", file=sys.stderr)
        return 2

    engine_path = parse_model_engine_file(cfg_path)
    if engine_path is None:
        print("[WARN] model-engine-file not found in config. "
              "nvinfer may build an engine in memory, but it may NOT be saved to disk.\n"
              "If you want an .engine file saved, add model-engine-file=... under [property] in pgie_config.txt.",
              file=sys.stderr)
    else:
        print(f"[INFO] Engine path from config: {engine_path}")
        if args.rebuild and engine_path.exists():
            print("[INFO] Removing existing engine to force rebuild...")
            engine_path.unlink()

        if engine_path.exists() and not args.rebuild:
            print("[INFO] Engine already exists. Use --rebuild to force rebuild.")
            return 0

    # Init GStreamer (DeepStream plugins must be available in env)
    Gst.init(None)

    W, H, FPS, N = args.width, args.height, args.fps, args.num_buffers

    # Minimal pipeline:
    # videotestsrc -> (to NVMM) -> nvstreammux -> nvinfer(using SAME config) -> fakesink
    #
    # Note: mux width/height/batch-size kept consistent with your main pipeline defaults.
    pipeline_desc = f"""
        videotestsrc is-live=true num-buffers={N} !
        video/x-raw,format=NV12,width={W},height={H},framerate={FPS}/1 !
        videoconvert !
        nvvideoconvert !
        video/x-raw(memory:NVMM),format=NV12,width={W},height={H},framerate={FPS}/1 !
        mux.sink_0

        nvstreammux name=mux width={W} height={H} live-source=0 batch-size=1 !
        nvinfer name=infer config-file-path={cfg_path} !
        fakesink sync=false
    """

    print("[INFO] Starting minimal pipeline to trigger engine build...")
    # print(pipeline_desc)  # uncomment if you want to see full pipeline

    pipeline = Gst.parse_launch(pipeline_desc)

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", bus_call, loop)

    start = time.time()

    # Periodic check for engine file creation (if path known)
    size_hist = []

    def tick():
        if args.timeout_sec > 0 and (time.time() - start) > args.timeout_sec:
            print("[ERROR] Timeout waiting for engine build.", file=sys.stderr)
            loop.quit()
            return False

        if engine_path:
            if engine_path.exists():
                sz = engine_path.stat().st_size
                size_hist.append(sz)
                if len(size_hist) > 5:
                    size_hist.pop(0)
                print(f"[INFO] engine size = {sz} bytes")
                # Consider done when size stable a few ticks and non-trivial
                if len(size_hist) >= 4 and len(set(size_hist[-4:])) == 1 and sz > 1_000_000:
                    print("[INFO] Engine size stabilized. Stopping.")
                    loop.quit()
                    return False
            else:
                print("[INFO] engine not created yet...")
        return True

    GLib.timeout_add_seconds(1, tick)

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)

    if engine_path and engine_path.exists():
        mb = engine_path.stat().st_size / (1024 * 1024)
        print(f"[OK] Engine generated: {engine_path} ({mb:.1f} MB)")
        return 0

    print("[WARN] Finished, but engine file not found on disk. "
          "Check pgie_config.txt for model-engine-file and model paths.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
