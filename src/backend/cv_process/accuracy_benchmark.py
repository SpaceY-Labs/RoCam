#!/usr/bin/env python3
import os
os.environ.setdefault("GST_DEBUG_DUMP_DOT_DIR", "/tmp")

import argparse
import logging
import re
import sys
import time
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

import gi
gi.require_version("Gst", "1.0")
from gi.repository import GLib, Gst

import pyds
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval

logger = logging.getLogger("accuracy_benchmark")
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")

# 你线上 pipeline 是固定 1920x1080
WIDTH = 1920
HEIGHT = 1080

# ---------- image IO ----------
def _load_image_size(path: Path) -> Tuple[int, int]:
    try:
        import cv2  # type: ignore
        img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise RuntimeError(f"cv2.imread failed: {path}")
        h, w = img.shape[:2]
        return w, h
    except Exception:
        from PIL import Image  # type: ignore
        with Image.open(path) as im:
            return im.size

def _read_image_bgr(path: Path):
    try:
        import cv2  # type: ignore
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"cv2.imread failed: {path}")
        return img
    except Exception:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore
        with Image.open(path) as im:
            im = im.convert("RGB")
            arr = np.array(im)[:, :, ::-1].copy()
            return arr

def _write_jpg(path: Path, bgr, quality: int = 95):
    try:
        import cv2  # type: ignore
        path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), bgr, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    except Exception:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore
        rgb = bgr[:, :, ::-1]
        im = Image.fromarray(np.asarray(rgb))
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, format="JPEG", quality=quality, subsampling=0)

# ---------- YAML ----------
def load_data_yaml(path: Path) -> Dict:
    try:
        import yaml  # type: ignore
        return yaml.safe_load(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        # fallback: extremely simple parser
        out: Dict = {}
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

# ---------- pgie config patch ----------
def write_temp_pgie_config(orig_cfg: Path, engine_path: Optional[Path]) -> Path:
    text = orig_cfg.read_text(encoding="utf-8", errors="ignore").splitlines()
    out: List[str] = []
    in_prop = False
    replaced = False

    for_engine = (engine_path is not None)

    for line in text:
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            in_prop = (s.lower() == "[property]")
            out.append(line)
            continue

        if in_prop and re.match(r"^\s*model-engine-file\s*=", line):
            if for_engine:
                out.append(f"model-engine-file={engine_path}")
                replaced = True
            else:
                out.append(line)
            continue

        out.append(line)

    if for_engine and not replaced:
        final: List[str] = []
        inserted = False
        for line in out:
            final.append(line)
            if (not inserted) and line.strip().lower() == "[property]":
                final.append(f"model-engine-file={engine_path}")
                inserted = True
        out = final

    tmp = orig_cfg.parent / f".tmp_pgie_config_{int(time.time())}.txt"
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    return tmp

# ---------- staging + transform ----------
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

def compute_stage_transform(orig_w: int, orig_h: int, target_w: int, target_h: int, mode: str) -> Tuple[float, float, float, float]:
    if mode == "stretch":
        return target_w / orig_w, target_h / orig_h, 0.0, 0.0
    if mode == "letterbox":
        s = min(target_w / orig_w, target_h / orig_h)
        new_w = orig_w * s
        new_h = orig_h * s
        pad_x = (target_w - new_w) / 2.0
        pad_y = (target_h - new_h) / 2.0
        return s, s, pad_x, pad_y
    if mode == "none":
        if orig_w != target_w or orig_h != target_h:
            raise ValueError(f"stage-mode=none requires images already {target_w}x{target_h}, got {orig_w}x{orig_h}")
        return 1.0, 1.0, 0.0, 0.0
    raise ValueError(f"Unknown stage-mode: {mode}")

def stage_images(images_dir: Path, staging_dir: Path, mode: str, limit: Optional[int]) -> Tuple[List[StageInfo], Path]:
    exts = {".jpg", ".jpeg", ".png", ".bmp"}
    imgs = [p for p in sorted(images_dir.rglob("*")) if p.suffix.lower() in exts and p.is_file()]
    if not imgs:
        raise RuntimeError(f"No images found under {images_dir}")
    if limit is not None:
        imgs = imgs[:limit]

    staging_dir.mkdir(parents=True, exist_ok=True)

    staged_files = sorted(staging_dir.glob("*.jpg"))
    if len(staged_files) == len(imgs):
        # 复用前抽样校验尺寸
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
            logger.info(f"staging reuse: {len(imgs)} already in {staging_dir} (mode={mode})")
            infos: List[StageInfo] = []
            for i, orig in enumerate(imgs):
                ow, oh = _load_image_size(orig)
                sx, sy, px, py = compute_stage_transform(ow, oh, WIDTH, HEIGHT, mode)
                infos.append(StageInfo(orig, staging_dir / f"{i:06d}.jpg", ow, oh, sx, sy, px, py))
            return infos, staging_dir / "%06d.jpg"
        else:
            logger.warning("staging dir exists but size check failed -> rebuilding staging...")

    # rebuild
    for old in staging_dir.glob("*"):
        try:
            old.unlink()
        except Exception:
            pass

    infos: List[StageInfo] = []
    n = len(imgs)

    for i, orig in enumerate(imgs):
        if (i + 1) % 200 == 0:
            logger.info(f"staging {i+1}/{n}")

        bgr = _read_image_bgr(orig)
        oh, ow = bgr.shape[:2]
        sx, sy, px, py = compute_stage_transform(ow, oh, WIDTH, HEIGHT, mode)

        if mode == "none":
            out_bgr = bgr
        elif mode == "stretch":
            import cv2  # type: ignore
            out_bgr = cv2.resize(bgr, (WIDTH, HEIGHT), interpolation=cv2.INTER_LINEAR)
        elif mode == "letterbox":
            import cv2  # type: ignore
            new_w = int(round(ow * sx))
            new_h = int(round(oh * sy))
            resized = cv2.resize(bgr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
            top = int(round(py))
            left = int(round(px))
            bottom = HEIGHT - top - new_h
            right = WIDTH - left - new_w
            out_bgr = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        else:
            raise ValueError(mode)

        staged = staging_dir / f"{i:06d}.jpg"
        _write_jpg(staged, out_bgr, quality=95)
        infos.append(StageInfo(orig, staged, ow, oh, sx, sy, px, py))

    logger.info(f"staging done: {len(infos)} -> {staging_dir} (mode={mode})")
    return infos, staging_dir / "%06d.jpg"

# ---------- YOLO label -> staged pixel bbox ----------
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
    # 绝大多数 YOLO label 是 0..1 normalized
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

    # clip
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

# ---------- simple NMS (pure python) ----------
def nms_xywh(dets: List[Dict[str, Any]], iou_th: float) -> List[Dict[str, Any]]:
    if iou_th <= 0:
        return dets
    if not dets:
        return dets

    # convert to xyxy
    boxes = []
    scores = []
    for d in dets:
        x, y, w, h = d["bbox"]
        boxes.append((x, y, x + w, y + h))
        scores.append(float(d["score"]))

    idxs = sorted(range(len(dets)), key=lambda i: scores[i], reverse=True)
    keep: List[int] = []

    def iou(a, b) -> float:
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        inter_x1 = max(ax1, bx1)
        inter_y1 = max(ay1, by1)
        inter_x2 = min(ax2, bx2)
        inter_y2 = min(ay2, by2)
        iw = max(0.0, inter_x2 - inter_x1)
        ih = max(0.0, inter_y2 - inter_y1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
        area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
        return inter / max(1e-9, (area_a + area_b - inter))

    while idxs:
        cur = idxs.pop(0)
        keep.append(cur)
        cur_box = boxes[cur]
        rest = []
        for j in idxs:
            if iou(cur_box, boxes[j]) <= iou_th:
                rest.append(j)
        idxs = rest

    return [dets[i] for i in keep]

# ---------- GStreamer ----------
pipeline = None
detections: List[Dict[str, Any]] = []
frame_counter = 0
seq_image_id = 0
args_global = None

def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.ERROR:
        err, dbg = message.parse_error()
        logger.error(f"GStreamer ERROR: {err}\n{dbg}")
        loop.quit()
    elif t == Gst.MessageType.EOS:
        print("End-of-stream")
        loop.quit()
    return True

def _get_bbox_from_obj(obj_meta, source: str):
    """
    source=detector: use detector_bbox_info.org_bbox_coords (与你 main.py 一致)
    source=rect: use rect_params
    """
    if source == "detector":
        try:
            b = obj_meta.detector_bbox_info.org_bbox_coords
            return float(b.left), float(b.top), float(b.width), float(b.height)
        except Exception:
            # fallback
            rp = obj_meta.rect_params
            return float(rp.left), float(rp.top), float(rp.width), float(rp.height)
    else:
        rp = obj_meta.rect_params
        return float(rp.left), float(rp.top), float(rp.width), float(rp.height)

def infer_probe(pad, info, u_data):
    global detections, frame_counter, seq_image_id, args_global
    gst_buffer = info.get_buffer()
    if not gst_buffer:
        return Gst.PadProbeReturn.OK

    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
    l_frame = batch_meta.frame_meta_list

    while l_frame is not None:
        try:
            frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
        except StopIteration:
            break

        # 关键：保证 image_id 和 GT 对齐
        if args_global.image_id_mode == "seq":
            image_id = int(seq_image_id)
            seq_image_id += 1
        else:
            # frame 模式：做 offset，避免从 1 开始
            fn = int(frame_meta.frame_num)
            if args_global._frame_num0 is None:
                args_global._frame_num0 = fn
            image_id = fn - int(args_global._frame_num0)

        fw = int(getattr(frame_meta, "source_frame_width", WIDTH)) or WIDTH
        fh = int(getattr(frame_meta, "source_frame_height", HEIGHT)) or HEIGHT

        l_obj = frame_meta.obj_meta_list
        while l_obj is not None:
            try:
                obj = pyds.NvDsObjectMeta.cast(l_obj.data)
            except StopIteration:
                break

            score = float(obj.confidence)
            if score >= float(args_global.conf):
                left, top, w, h = _get_bbox_from_obj(obj, args_global.bbox_source)

                # clamp to frame size
                left = max(0.0, min(float(fw - 1), left))
                top = max(0.0, min(float(fh - 1), top))
                w = max(0.0, min(float(fw) - left, w))
                h = max(0.0, min(float(fh) - top, h))

                if w > 1e-3 and h > 1e-3:
                    detections.append({
                        "image_id": image_id,
                        "category_id": 1,
                        "bbox": [left, top, w, h],
                        "score": score,
                    })

            try:
                l_obj = l_obj.next
            except StopIteration:
                break

        frame_counter += 1
        if frame_counter % 200 == 0:
            logger.info(f"infer progress: frames={frame_counter}")

        try:
            l_frame = l_frame.next
        except StopIteration:
            break

    return Gst.PadProbeReturn.OK

def build_minimal_pipeline_desc(staged_pattern: Path, count: int, pgie_cfg: Path, fps: int) -> str:
    # 固定 image/jpeg caps，避免 unfixed caps 报错
    return f"""
        multifilesrc location={staged_pattern} start-index=0 stop-index={count-1} do-timestamp=true !
        image/jpeg,width={WIDTH},height={HEIGHT},framerate={fps}/1 !
        jpegparse !
        jpegdec !
        videoconvert !
        nvvideoconvert !
        video/x-raw(memory:NVMM),format=NV12,width={WIDTH},height={HEIGHT},framerate={fps}/1 !
        mux.sink_0

        nvstreammux name=mux width={WIDTH} height={HEIGHT} live-source=0 batch-size=1 !
        nvinfer name=infer config-file-path={pgie_cfg} !
        fakesink sync=false
    """

# ---------- debug visualization ----------
def draw_debug(staged_img: Path, gt_boxes: List[List[float]], pred_boxes: List[List[float]], out_path: Path):
    try:
        import cv2  # type: ignore
        img = cv2.imread(str(staged_img), cv2.IMREAD_COLOR)
        if img is None:
            return
        # GT green
        for (x, y, w, h) in gt_boxes:
            x1, y1, x2, y2 = int(x), int(y), int(x + w), int(y + h)
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
        # Pred red
        for (x, y, w, h) in pred_boxes:
            x1, y1, x2, y2 = int(x), int(y), int(x + w), int(y + h)
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_path), img)
    except Exception:
        return

def main():
    global pipeline, detections, frame_counter, seq_image_id, args_global

    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="pgie_config.txt")
    ap.add_argument("--engine", default=None)
    ap.add_argument("--data-yaml", required=True)
    ap.add_argument("--split", choices=["val", "test"], default="val")
    ap.add_argument("--images-dir", default=None)
    ap.add_argument("--labels-dir", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--conf", type=float, default=0.001)

    ap.add_argument("--stage-mode", choices=["none", "stretch", "letterbox"], default="letterbox")
    ap.add_argument("--staging-dir", default="/tmp/rocam_bench_fixedjpg")

    # 🔥关键：跟你线上一致
    ap.add_argument("--bbox-source", choices=["detector", "rect"], default="detector")
    ap.add_argument("--image-id-mode", choices=["seq", "frame"], default="seq")

    # 可选：贴近线上只取最大 conf
    ap.add_argument("--top1", action="store_true", help="keep only top-1 detection per image (like main.py)")
    ap.add_argument("--nms-iou", type=float, default=0.0, help="apply python NMS per image (0 disables)")

    # 诊断用
    ap.add_argument("--dump-json", default=None)
    ap.add_argument("--dump-stage-csv", default=None)
    ap.add_argument("--debug-vis", type=int, default=0, help="save first N images with GT(green)/Pred(red) overlay into /tmp/rocam_bench_debug")

    args = ap.parse_args()
    args_global = args
    args_global._frame_num0 = None  # for frame id offset

    data_yaml = Path(args.data_yaml).resolve()
    data = load_data_yaml(data_yaml)

    names = data.get("names", ["rocket"])
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names.keys())]
    if not isinstance(names, list):
        names = ["rocket"]
    logger.info(f"names(from yaml)={names}")

    root = data_yaml.parent
    split_key = args.split

    if args.images_dir:
        images_dir = Path(args.images_dir).expanduser().resolve()
    else:
        split_path = data.get(split_key, None)
        if split_path is None:
            images_dir = (root / "images" / split_key).resolve()
        else:
            images_dir = (root / str(split_path)).expanduser().resolve()
            if (images_dir / "images" / split_key).is_dir():
                images_dir = (images_dir / "images" / split_key).resolve()

    if args.labels_dir:
        labels_dir = Path(args.labels_dir).expanduser().resolve()
    else:
        if len(images_dir.parts) >= 2 and images_dir.parts[-2] == "images":
            labels_dir = Path(*images_dir.parts[:-2], "labels", images_dir.parts[-1]).resolve()
        else:
            labels_dir = (root / "labels" / split_key).resolve()

    logger.info(f"Images dir: {images_dir}")
    logger.info(f"Labels dir: {labels_dir}")

    staging_dir = Path(args.staging_dir).resolve()
    stage_infos, pattern = stage_images(images_dir, staging_dir, args.stage_mode, args.limit)
    count = len(stage_infos)
    logger.info(f"Total images to eval: {count}")

    # 导出每张图的 resize/letterbox 参数
    if args.dump_stage_csv:
        lines = ["idx,orig_path,orig_w,orig_h,sx,sy,pad_x,pad_y,staged_path"]
        for i, st in enumerate(stage_infos):
            lines.append(f"{i},{st.orig_path},{st.orig_w},{st.orig_h},{st.sx:.8f},{st.sy:.8f},{st.pad_x:.4f},{st.pad_y:.4f},{st.staged_path}")
        Path(args.dump_stage_csv).write_text("\n".join(lines) + "\n", encoding="utf-8")
        logger.info(f"Dumped stage csv: {args.dump_stage_csv}")

    # ---- build COCO GT ----
    coco_gt = {"images": [], "annotations": [], "categories": [{"id": 1, "name": names[0] if names else "rocket"}]}
    ann_id = 1

    # also keep per-image GT for debug vis
    gt_boxes_by_img: Dict[int, List[List[float]]] = {}

    for i, st in enumerate(stage_infos):
        coco_gt["images"].append({"id": i, "file_name": str(st.orig_path), "width": WIDTH, "height": HEIGHT})
        label_path = labels_dir / f"{st.orig_path.stem}.txt"
        rows = parse_yolo_label_file(label_path)
        for (cls, x, y, w, h) in rows:
            # 单类数据集：cls 应该是 0
            if len(names) == 1 and cls != 0:
                cls = 0
            mapped = yolo_to_staged_xywh(cls, x, y, w, h, st)
            if mapped is None:
                continue
            _, left, top, bw, bh = mapped
            coco_gt["annotations"].append({
                "id": ann_id, "image_id": i, "category_id": 1,
                "bbox": [left, top, bw, bh], "area": float(bw * bh), "iscrowd": 0
            })
            gt_boxes_by_img.setdefault(i, []).append([left, top, bw, bh])
            ann_id += 1

    gt_json = Path("/tmp/rocam_gt_coco.json")
    gt_json.write_text(json.dumps(coco_gt), encoding="utf-8")

    orig_cfg = Path(args.config).resolve()
    engine_path = Path(args.engine).resolve() if args.engine else None
    tmp_cfg = write_temp_pgie_config(orig_cfg, engine_path)
    logger.info(f"Using temp config: {tmp_cfg} (engine forced to {engine_path})")

    # ---- run DeepStream inference ----
    Gst.init(None)
    pipeline_desc = build_minimal_pipeline_desc(pattern, count, tmp_cfg, args.fps)
    pipeline = Gst.parse_launch(pipeline_desc)

    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", bus_call, loop)

    infer = pipeline.get_by_name("infer")
    if infer is None:
        raise RuntimeError("Pipeline element 'infer' not found (nvinfer).")

    infer_src = infer.get_static_pad("src")
    infer_src.add_probe(Gst.PadProbeType.BUFFER, infer_probe, 0)

    logger.info(f"Starting inference over {count} images...")
    detections = []
    frame_counter = 0
    seq_image_id = 0

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)

    logger.info(f"Collected detections: {len(detections)} (after conf>={args.conf:.4f})")

    # ---- postprocess: group by image_id ----
    det_by_img: Dict[int, List[Dict[str, Any]]] = {}
    for d in detections:
        det_by_img.setdefault(int(d["image_id"]), []).append(d)

    # top1 / nms
    final_dets: List[Dict[str, Any]] = []
    for img_id, ds in det_by_img.items():
        # NMS (optional)
        if args.nms_iou > 0:
            ds = nms_xywh(ds, args.nms_iou)

        # top1 (optional)
        if args.top1 and ds:
            ds = [max(ds, key=lambda x: float(x["score"]))]

        final_dets.extend(ds)

    detections = final_dets
    logger.info(f"Detections after postprocess: {len(detections)} (top1={args.top1}, nms_iou={args.nms_iou})")

    if args.dump_json:
        Path(args.dump_json).write_text(json.dumps(detections), encoding="utf-8")
        logger.info(f"Dumped detections json: {args.dump_json}")

    # debug visualization
    if args.debug_vis and args.debug_vis > 0:
        out_dir = Path("/tmp/rocam_bench_debug")
        for i in range(min(args.debug_vis, count)):
            st = stage_infos[i]
            gt = gt_boxes_by_img.get(i, [])
            preds = [d["bbox"] for d in det_by_img.get(i, [])]
            # 如果启用了 top1/nms，用最终结果更直观
            preds2 = [d["bbox"] for d in detections if int(d["image_id"]) == i]
            draw_debug(st.staged_path, gt, preds2, out_dir / f"{i:06d}.jpg")
        logger.info(f"Saved debug overlay images to /tmp/rocam_bench_debug (N={min(args.debug_vis, count)})")

    # ---- COCO eval ----
    coco = COCO(str(gt_json))
    if len(detections) == 0:
        logger.error("No detections produced. mAP=0.")
        print("\n=== ACCURACY SUMMARY (COCOeval) ===")
        print(f"split: {args.split}")
        print(f"images: {count}")
        print(f"stage-mode: {args.stage_mode}")
        print(f"bbox-source: {args.bbox_source}")
        print(f"image-id-mode: {args.image_id_mode}")
        print(f"detections (conf>={args.conf:.4f}): 0")
        print("mAP@0.50:0.95 = 0.000000")
        print("mAP@0.50      = 0.000000")
        return 0

    coco_dt = coco.loadRes(detections)
    ev = COCOeval(coco, coco_dt, iouType="bbox")

    # 如果你想更贴近“每张图只用一个框”的场景，可以把 maxDets=1 的指标也打印出来：
    # COCOeval 默认 summarize 用 maxDets=100；但 evaluate/accumulate 可以通过 params 控制
    ev.evaluate()
    ev.accumulate()
    ev.summarize()

    map_5095 = float(ev.stats[0])
    map_50 = float(ev.stats[1])

    print("\n=== ACCURACY SUMMARY (COCOeval) ===")
    print(f"split: {args.split}")
    print(f"images: {count}")
    print(f"stage-mode: {args.stage_mode}")
    print(f"bbox-source: {args.bbox_source}")
    print(f"image-id-mode: {args.image_id_mode}")
    print(f"top1: {args.top1}   nms_iou: {args.nms_iou}")
    print(f"detections (conf>={args.conf:.4f}): {len(detections)}")
    print(f"mAP@0.50:0.95 = {map_5095:.6f}")
    print(f"mAP@0.50      = {map_50:.6f}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
