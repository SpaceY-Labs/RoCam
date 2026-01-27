#!/usr/bin/env python3
import os
import argparse
import logging
import sys
import time
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
import pyds
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

from util import generate_pgie_config
from convert_tensorrt import pt_to_engine

import gi
gi.require_version("Gst", "1.0")
from gi.repository import GLib, Gst



# Set GST debug directory
os.environ.setdefault("GST_DEBUG_DUMP_DOT_DIR", "/tmp")

logger = logging.getLogger("accuracy_benchmark")
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

# Global constants for the pipeline
WIDTH = 1920
HEIGHT = 1080
HARDCODED_FPS = 60
DEFAULT_STAGING_DIR = "/mnt/data/testdata/staging"
DEBUG_VIS_DIR = "/mnt/data/testdata/debug"

# ---------------- image IO ----------------
def _load_image_size(path: Path) -> Tuple[int, int]:
    try:
        import cv2
        img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise RuntimeError(f"cv2.imread failed: {path}")
        h, w = img.shape[:2]
        return w, h
    except Exception:
        from PIL import Image
        with Image.open(path) as im:
            return im.size

def _read_image_bgr(path: Path):
    try:
        import cv2
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"cv2.imread failed: {path}")
        return img
    except Exception:
        from PIL import Image
        import numpy as np
        with Image.open(path) as im:
            im = im.convert("RGB")
            arr = np.array(im)[:, :, ::-1].copy()
            return arr

def _write_jpg(path: Path, bgr, quality: int = 95):
    try:
        import cv2
        path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    except Exception:
        from PIL import Image
        import numpy as np
        rgb = bgr[:, :, ::-1]
        im = Image.fromarray(np.asarray(rgb))
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, format="JPEG", quality=quality, subsampling=0)

# ---------------- YAML loader ----------------
def load_data_yaml(path: Path) -> Dict[str, Any]:
    try:
        import yaml
        return yaml.safe_load(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        out: Dict[str, Any] = {}
        txt = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        key = None
        for line in txt:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if ":" in s and not s.startswith("-"):
                k, v = s.split(":", 1)
                key = k.strip()
                v = v.strip()
                if v.startswith("[") and v.endswith("]"):
                    items = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
                    out[key] = items
                elif v:
                    out[key] = v.strip().strip("'\"")
                else:
                    out[key] = None
            elif s.startswith("-") and key:
                out.setdefault(key, [])
                out[key].append(s[1:].strip().strip("'\""))
        return out

# ---------------- staging + transform ----------------
@dataclass
class StageInfo:
    orig_path: Path
    staged_path: Path
    orig_w: int
    orig_h: int
    sx: float
    sy: float
    pad_x: float
    pad_y: float

def compute_stage_transform(orig_w: int, orig_h: int, target_w: int, target_h: int) -> Tuple[float, float, float, float]:
    s = min(target_w / orig_w, target_h / orig_h)
    new_w = orig_w * s
    new_h = orig_h * s
    pad_x = (target_w - new_w) / 2.0
    pad_y = (target_h - new_h) / 2.0
    return s, s, pad_x, pad_y

def stage_images(images_dir: Path, staging_dir: Path, limit: Optional[int]) -> Tuple[List[StageInfo], Path]:
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    imgs = [p for p in sorted(images_dir.rglob("*")) if p.suffix.lower() in exts and p.is_file()]
    if not imgs:
        raise RuntimeError(f"No images found under {images_dir}")
    if limit is not None:
        imgs = imgs[:limit]

    staging_dir.mkdir(parents=True, exist_ok=True)

    staged_files = sorted(staging_dir.glob("*.jpg"))
    if len(staged_files) == len(imgs):
        ok = True
        for k in [0, len(staged_files)//2, len(staged_files)-1]:
            if k < 0 or k >= len(staged_files):
                continue
            try:
                w, h = _load_image_size(staged_files[k])
                if w != WIDTH or h != HEIGHT:
                    ok = False
                    break
            except Exception:
                ok = False
                break
        if ok:
            logger.info(f"staging reuse: {len(imgs)} already in {staging_dir}")
            infos: List[StageInfo] = []
            for i, orig in enumerate(imgs):
                ow, oh = _load_image_size(orig)
                sx, sy, px, py = compute_stage_transform(ow, oh, WIDTH, HEIGHT)
                infos.append(StageInfo(orig, staging_dir / f"{i:06d}.jpg", ow, oh, sx, sy, px, py))
            return infos, staging_dir / "%06d.jpg"
        else:
            logger.warning("staging dir exists but size check failed -> rebuilding staging...")

    for old in staging_dir.glob("*"):
        try:
            old.unlink()
        except Exception:
            pass

    infos: List[StageInfo] = []
    n = len(imgs)

    import cv2
    for i, orig in enumerate(imgs):
        if (i + 1) % 200 == 0:
            logger.info(f"staging {i+1}/{n}")

        bgr = _read_image_bgr(orig)
        oh, ow = bgr.shape[:2]
        sx, sy, px, py = compute_stage_transform(ow, oh, WIDTH, HEIGHT)

        new_w = int(round(ow * sx))
        new_h = int(round(oh * sy))
        resized = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        top = int(round(py))
        left = int(round(px))
        bottom = HEIGHT - top - new_h
        right = WIDTH - left - new_w
        out_bgr = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(0, 0, 0))

        staged = staging_dir / f"{i:06d}.jpg"
        _write_jpg(staged, out_bgr, quality=95)
        infos.append(StageInfo(orig, staged, ow, oh, sx, sy, px, py))

    logger.info(f"staging done: {len(infos)} -> {staging_dir}")
    return infos, staging_dir / "%06d.jpg"

# ---------------- YOLO label -> staged pixel bbox ----------------
def parse_yolo_label_file(label_path: Path) -> List[Tuple[int, float, float, float, float]]:
    if not label_path.exists():
        return []
    rows = []
    for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if not s:
            continue
        parts = s.split()
        if len(parts) < 5:
            continue
        c = int(float(parts[0]))
        x, y, w, h = map(float, parts[1:5])
        rows.append((c, x, y, w, h))
    return rows

def yolo_to_staged_xywh(cls: int, x: float, y: float, w: float, h: float, st: StageInfo) -> Optional[Tuple[int, float, float, float, float]]:
    ow, oh = st.orig_w, st.orig_h
    normalized = (0.0 <= x <= 1.5 and 0.0 <= y <= 1.5 and 0.0 <= w <= 1.5 and 0.0 <= h <= 1.5)
    if normalized:
        cx = x * ow
        cy = y * oh
        bw = w * ow
        bh = h * oh
    else:
        cx, cy, bw, bh = x, y, w, h

    left = cx - bw / 2.0
    top = cy - bh / 2.0

    left_s = left * st.sx + st.pad_x
    top_s = top * st.sy + st.pad_y
    bw_s = bw * st.sx
    bh_s = bh * st.sy

    if bw_s <= 0 or bh_s <= 0:
        return None

    if left_s >= WIDTH or top_s >= HEIGHT:
        return None
    if left_s + bw_s <= 0 or top_s + bh_s <= 0:
        return None

    left_s = max(0.0, min(float(WIDTH - 1), left_s))
    top_s = max(0.0, min(float(HEIGHT - 1), top_s))
    bw_s = max(0.0, min(float(WIDTH) - left_s, bw_s))
    bh_s = max(0.0, min(float(HEIGHT) - top_s, bh_s))
    if bw_s < 1e-3 or bh_s < 1e-3:
        return None
    return (cls, left_s, top_s, bw_s, bh_s)

# ---------------- postprocess ----------------
def postprocess_by_image(
    dets: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    by_img: Dict[int, List[Dict[str, Any]]] = {}
    for d in dets:
        by_img.setdefault(int(d["image_id"]), []).append(d)

    out: List[Dict[str, Any]] = []
    for img_id, lst in by_img.items():
        if not lst:
            continue
        # Pick the one with the highest score
        best = max(lst, key=lambda d: float(d["score"]))
        out.append(best)
    return out

# ---------------- debug visualization ----------------
def draw_debug_overlays(
    stage_infos: List[StageInfo],
    preds: List[Dict[str, Any]],
    gt_coco: Dict[str, Any],
    out_dir: Path,
    max_n: int
):
    out_dir.mkdir(parents=True, exist_ok=True)
    by_img_pred: Dict[int, List[Dict[str, Any]]] = {}
    for d in preds:
        by_img_pred.setdefault(int(d["image_id"]), []).append(d)

    by_img_gt: Dict[int, List[List[float]]] = {}
    for ann in gt_coco.get("annotations", []):
        by_img_gt.setdefault(int(ann["image_id"]), []).append(list(map(float, ann["bbox"])))

    n = min(max_n, len(stage_infos))
    import cv2
    for i in range(n):
        img_path = stage_infos[i].staged_path
        try:
            bgr = _read_image_bgr(img_path)
        except Exception:
            continue

        for bbox in by_img_gt.get(i, []):
            x, y, w, h = bbox
            cv2.rectangle(bgr, (int(x), int(y)), (int(x + w), int(y + h)), (0, 255, 0), 2)
        for d in by_img_pred.get(i, []):
            x, y, w, h = d["bbox"]
            s = float(d["score"])
            cv2.rectangle(bgr, (int(x), int(y)), (int(x + w), int(y + h)), (0, 0, 255), 2)
            cv2.putText(bgr, f"{s:.2f}", (int(x), max(0, int(y) - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        cv2.imwrite(str(out_dir / f"{i:06d}.jpg"), bgr)

# ---------------- GStreamer globals ----------------
detections_raw: List[Dict[str, Any]] = []
frame_counter = 0
seq_counter = 0
had_error = False
had_error_msg = ""

def bus_call(bus, message, loop):
    global had_error, had_error_msg
    t = message.type
    if t == Gst.MessageType.ERROR:
        err, dbg = message.parse_error()
        had_error = True
        had_error_msg = f"{err}\n{dbg}"
        logger.error(f"GStreamer ERROR: {had_error_msg}")
        loop.quit()
    elif t == Gst.MessageType.EOS:
        logger.info("End-of-stream received")
        loop.quit()
    return True

def infer_probe(pad, info, u_data):
    global detections_raw, frame_counter, seq_counter
    gst_buffer = info.get_buffer()
    if not gst_buffer:
        return Gst.PadProbeReturn.OK

    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
    l_frame = batch_meta.frame_meta_list

    args = u_data

    while l_frame is not None:
        try:
            frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
        except StopIteration:
            break

        image_id = int(seq_counter)

        l_obj = frame_meta.obj_meta_list
        while l_obj is not None:
            try:
                obj = pyds.NvDsObjectMeta.cast(l_obj.data)
            except StopIteration:
                break

            score = float(obj.confidence)
            if score >= args.conf:
                bb = obj.detector_bbox_info.org_bbox_coords
                left, top, w, h = float(bb.left), float(bb.top), float(bb.width), float(bb.height)

                left = max(0.0, min(float(WIDTH - 1), left))
                top = max(0.0, min(float(HEIGHT - 1), top))
                w = max(0.0, min(float(WIDTH) - left, w))
                h = max(0.0, min(float(HEIGHT) - top, h))

                if w > 1e-3 and h > 1e-3:
                    cls_id = int(getattr(obj, "class_id", 0))
                    detections_raw.append({
                        "image_id": image_id,
                        "category_id": cls_id + 1,
                        "bbox": [left, top, w, h],
                        "score": score,
                    })

            try:
                l_obj = l_obj.next
            except StopIteration:
                break

        frame_counter += 1
        seq_counter += 1

        if frame_counter % 200 == 0:
            logger.info(f"infer progress: frames={frame_counter}")

        try:
            l_frame = l_frame.next
        except StopIteration:
            break

    return Gst.PadProbeReturn.OK

def build_pipeline_desc(staged_pattern: Path, count: int, pgie_cfg: Path) -> str:
    return f"""
        multifilesrc location={staged_pattern} start-index=0 stop-index={count-1} do-timestamp=true !
        image/jpeg,width={WIDTH},height={HEIGHT},framerate={HARDCODED_FPS}/1 !
        jpegparse !
        jpegdec !
        videoconvert !
        nvvideoconvert compute-hw=1 !
        video/x-raw(memory:NVMM),format=NV12,width={WIDTH},height={HEIGHT},framerate={HARDCODED_FPS}/1 !
        mux.sink_0

        nvstreammux name=mux width={WIDTH} height={HEIGHT} live-source=0 batch-size=1 !
        nvinfer name=infer config-file-path={pgie_cfg} !
        fakesink sync=false
    """

def main():
    global detections_raw, frame_counter, seq_counter, had_error, had_error_msg

    ap = argparse.ArgumentParser(description="Accuracy Benchmark for YOLO models on DeepStream")
    ap.add_argument("--pt", help="Path to input .pt model file")
    ap.add_argument("--engine", help="Path to input .engine model file")
    ap.add_argument("--rebuild", action="store_true", help="Force rebuild of TensorRT engine")
    ap.add_argument("--data-yaml", required=True, help="YOLO data.yaml path")
    ap.add_argument("--split", choices=["val", "test"], default="val", help="Dataset split to evaluate")
    ap.add_argument("--images-dir", help="Override images directory path")
    ap.add_argument("--labels-dir", help="Override labels directory path")
    ap.add_argument("--limit", type=int, help="Limit number of images to evaluate")
    ap.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    ap.add_argument("--debug-vis", type=int, default=0, help=f"Save N debug overlay images to {DEBUG_VIS_DIR}")
    args = ap.parse_args()

    # 1. Handle model (Convert .pt to .engine or use .engine directly)
    if (args.pt and args.engine) or (not args.pt and not args.engine):
        logger.error("Exactly one of --pt or --engine must be provided")
        return 1

    temp_engine_to_cleanup = None

    if args.pt:
        pt_path = Path(args.pt).resolve()
        # Create a temporary engine file path
        temp_engine_to_cleanup = Path("/tmp") / f"bench_engine_{int(time.time())}.engine"
        engine_path = temp_engine_to_cleanup
        
        logger.info(f"Converting/Restoring model: {pt_path} to {engine_path}")
        if not pt_to_engine(str(pt_path), str(engine_path), args.rebuild):
            logger.error("Model conversion failed")
            return 1
        onnx_path_for_config = str(pt_path)
    else:
        engine_path = Path(args.engine).resolve()
        logger.info(f"Using existing engine: {engine_path}")
        onnx_path_for_config = None

    # 2. Generate temporary PGIE config
    tmp_pgie_cfg = Path("/tmp") / f"bench_pgie_config_{int(time.time())}.txt"
    generate_pgie_config(str(tmp_pgie_cfg), onnx_path=onnx_path_for_config, engine_path=str(engine_path))
    logger.info(f"Generated temporary PGIE config: {tmp_pgie_cfg}")

    # 3. Load dataset info
    data_yaml = Path(args.data_yaml).resolve()
    data = load_data_yaml(data_yaml)
    names = data.get("names", ["rocket"])
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names.keys())]
    logger.info(f"Classes: {names}")

    # Resolve directories
    root = data_yaml.parent
    if args.images_dir:
        images_dir = Path(args.images_dir).resolve()
    else:
        split_path = data.get(args.split)
        images_dir = (root / (split_path if split_path else f"images/{args.split}")).resolve()
    
    if args.labels_dir:
        labels_dir = Path(args.labels_dir).resolve()
    else:
        labels_dir = (root / f"labels/{args.split}").resolve()

    logger.info(f"Images: {images_dir}")
    logger.info(f"Labels: {labels_dir}")

    # 4. Stage images
    staging_dir = Path(DEFAULT_STAGING_DIR).resolve()
    stage_infos, pattern = stage_images(images_dir, staging_dir, args.limit)
    count = len(stage_infos)
    logger.info(f"Images to evaluate: {count}")

    # 5. Prepare COCO Ground Truth
    categories = [{"id": i + 1, "name": str(n)} for i, n in enumerate(names)]
    coco_gt = {"images": [], "annotations": [], "categories": categories}
    ann_id = 1
    for i, st in enumerate(stage_infos):
        coco_gt["images"].append({"id": i, "file_name": str(st.orig_path), "width": WIDTH, "height": HEIGHT})
        rows = parse_yolo_label_file(labels_dir / f"{st.orig_path.stem}.txt")
        for (cls, x, y, w, h) in rows:
            mapped = yolo_to_staged_xywh(0 if len(names) == 1 else cls, x, y, w, h, st)
            if mapped:
                cls_m, l, t, bw, bh = mapped
                coco_gt["annotations"].append({
                    "id": ann_id, "image_id": i, "category_id": int(cls_m) + 1,
                    "bbox": [l, t, bw, bh], "area": float(bw * bh), "iscrowd": 0
                })
                ann_id += 1

    gt_json = Path("/tmp") / f"bench_gt_coco_{int(time.time())}.json"
    gt_json.write_text(json.dumps(coco_gt), encoding="utf-8")

    # 6. Run Inference Pipeline
    Gst.init(None)
    pipeline_desc = build_pipeline_desc(pattern, count, tmp_pgie_cfg)
    pipeline = Gst.parse_launch(pipeline_desc)
    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", bus_call, loop)

    infer = pipeline.get_by_name("infer")
    infer.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, infer_probe, args)

    logger.info(f"Starting inference...")
    detections_raw, frame_counter, seq_counter = [], 0, 0
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)
        if tmp_pgie_cfg.exists():
            tmp_pgie_cfg.unlink()
        if temp_engine_to_cleanup and temp_engine_to_cleanup.exists():
            logger.info(f"Cleaning up temporary engine: {temp_engine_to_cleanup}")
            temp_engine_to_cleanup.unlink()

    if had_error or frame_counter != count:
        logger.error(f"Inference failed or incomplete: {frame_counter}/{count}")
        if had_error_msg:
            logger.error(had_error_msg)
        if gt_json.exists():
            gt_json.unlink()
        return 2

    # 7. Post-process and Evaluate
    dets_pp = postprocess_by_image(detections_raw)
    logger.info(f"Final detections: {len(dets_pp)}")

    if args.debug_vis > 0:
        draw_debug_overlays(stage_infos, dets_pp, coco_gt, Path(DEBUG_VIS_DIR), args.debug_vis)

    try:
        coco = COCO(str(gt_json))
        if not dets_pp:
            logger.error("No detections. mAP=0")
            return 0

        coco_dt = coco.loadRes(dets_pp)
        ev = COCOeval(coco, coco_dt, iouType="bbox")
        ev.evaluate()
        ev.accumulate()
        ev.summarize()

        print("\n=== ACCURACY SUMMARY (COCOeval) ===")
        print(f"Model: {args.pt or args.engine}")
        print(f"Images: {count} | Detections: {len(dets_pp)}")
        print(f"mAP@0.50:0.95 = {float(ev.stats[0]):.6f}")
        print(f"mAP@0.50      = {float(ev.stats[1]):.6f}")
        print(f"Debug vis images saved to {DEBUG_VIS_DIR}")
    finally:
        if gt_json.exists():
            gt_json.unlink()

    return 0

if __name__ == "__main__":
    sys.exit(main())
