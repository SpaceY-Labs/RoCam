from __future__ import annotations

import base64
import logging
import os
import threading
import urllib.request
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import torch
from pycocotools import mask as mask_utils
from fastapi import FastAPI, HTTPException, Request

try:
    from ultralytics import SAM
    _SAM_IMPORT_ERROR = None
except Exception:
    try:
        from ultralytics import SAM2 as SAM
        _SAM_IMPORT_ERROR = None
    except Exception as error:
        SAM = None
        _SAM_IMPORT_ERROR = error

app = FastAPI()

_model_lock = threading.Lock()
_sam_model = None


def _detect_device() -> str:
    try:
        if torch.cuda.is_available():
            return "cuda"
        logging.warning("CUDA not available; SAM2 will run on CPU.")
        return "cpu"
    except Exception:
        logging.warning("CUDA availability check failed; SAM2 will run on CPU.")
        return "cpu"


_device = _detect_device()


def _resolve_model_path() -> str:
    return (
        os.environ.get("SAM2_MODEL_PATH")
        or os.environ.get("SAM3_MODEL_PATH")
        or "/app/sam/weights/sam_b.pt"
    )


def _load_model() -> None:
    global _sam_model

    if SAM is None:
        raise RuntimeError(f"Ultralytics SAM is not available: {_SAM_IMPORT_ERROR}")

    model_path = _resolve_model_path()
    try:
        _sam_model = SAM(model_path)
        try:
            _sam_model.to(_device)
        except Exception:
            pass
    except Exception as error:
        raise RuntimeError("Failed to load SAM2 model") from error


@app.on_event("startup")
async def startup_event() -> None:
    if os.environ.get("SAM2_SKIP_MODEL_LOAD") == "1" or os.environ.get("SAM3_SKIP_MODEL_LOAD") == "1":
        return
    _load_model()


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


def _extract_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    instances = payload.get("instances")
    if isinstance(instances, list) and instances:
        first = instances[0]
        if isinstance(first, dict):
            return first
    return payload


def _decode_base64_image(image_base64: str) -> np.ndarray:
    if image_base64.startswith("data:"):
        image_base64 = image_base64.split(",", 1)[-1]
    raw = base64.b64decode(image_base64)
    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode base64 image")
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def _download_image(image_url: str) -> np.ndarray:
    with urllib.request.urlopen(image_url) as response:
        data = response.read()
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode image from URL")
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def _load_image(payload: Dict[str, Any]) -> np.ndarray:
    image_base64 = payload.get("image") or payload.get("imageBase64") or payload.get("image_base64")
    image_url = payload.get("imageUrl") or payload.get("image_url")

    if image_base64:
        return _decode_base64_image(image_base64)
    if image_url:
        return _download_image(image_url)

    raise ValueError("image or imageUrl is required")


def _mask_to_polygons(mask: np.ndarray) -> List[List[Dict[str, float]]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: List[List[Dict[str, float]]] = []
    for contour in contours:
        if len(contour) < 3:
            continue
        ring = []
        for point in contour:
            x, y = point[0]
            ring.append({"x": float(x), "y": float(y)})
        polygons.append(ring)

    if not polygons:
        polygons = [[]]
    return polygons


def _build_mask_response(mask: np.ndarray, score: float) -> Dict[str, Any]:
    mask_uint8 = (mask > 0).astype(np.uint8)
    polygons = _mask_to_polygons(mask_uint8)
    x, y, w, h = cv2.boundingRect(mask_uint8)
    area = int(mask_uint8.sum())
    rle = mask_utils.encode(np.asfortranarray(mask_uint8))
    counts = rle.get("counts")
    if isinstance(counts, bytes):
        counts = counts.decode("ascii")

    return {
      "polygon": polygons,
      "boundingBox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
      "area": area,
      "score": float(score),
      "rle": {
          "counts": counts,
          "size": [int(rle["size"][0]), int(rle["size"][1])],
      },
    }


def _format_masks(masks: np.ndarray, scores: Optional[List[float]] = None) -> Dict[str, Any]:
    if masks is None or masks.size == 0:
        return {"masks": []}

    if masks.ndim == 2:
        masks = masks[None, ...]

    formatted = []
    for index, mask in enumerate(masks):
        score = scores[index] if scores and len(scores) > index else 1.0
        mask_binary = (mask > 0.5).astype(np.uint8)
        formatted.append(_build_mask_response(mask_binary, score))

    return {"masks": formatted}


def _normalize_points(points: List[List[float]], width: int, height: int) -> List[List[float]]:
    if not points or width <= 1 or height <= 1:
        return points

    max_x = max(point[0] for point in points)
    max_y = max(point[1] for point in points)
    if 0 <= max_x <= 1 and 0 <= max_y <= 1:
        return [[point[0] * width, point[1] * height] for point in points]

    return points


def _normalize_box(box: List[float], width: int, height: int) -> List[float]:
    if width <= 1 or height <= 1:
        return box
    max_coord = max(box)
    if 0 <= max_coord <= 1:
        return [box[0] * width, box[1] * height, box[2] * width, box[3] * height]
    return box


def _predict_sam2(
    image: np.ndarray,
    mode: str,
    points: List[Dict[str, Any]],
    box: Optional[Dict[str, Any]],
    prompt: Optional[str],
) -> Dict[str, Any]:
    if _sam_model is None:
        raise RuntimeError("Model not loaded")

    height, width = image.shape[:2]

    point_coords: List[List[float]] = []
    point_labels: List[int] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        if "x" not in point or "y" not in point:
            continue
        x = float(point["x"])
        y = float(point["y"])
        label_raw = point.get("label", 1)
        label = 0 if str(label_raw) == "0" else 1
        point_coords.append([x, y])
        point_labels.append(label)

    point_coords = _normalize_points(point_coords, width, height)

    box_values = None
    if isinstance(box, dict) and {"x1", "y1", "x2", "y2"}.issubset(box.keys()):
        try:
            box_values = [
                float(box["x1"]),
                float(box["y1"]),
                float(box["x2"]),
                float(box["y2"]),
            ]
            box_values = _normalize_box(box_values, width, height)
        except (TypeError, ValueError):
            box_values = None

    if mode == "semantic":
        mode = "auto"

    if mode == "click" and not point_coords and not box_values:
        raise HTTPException(status_code=400, detail="click mode requires points or box")

    kwargs: Dict[str, Any] = {"device": _device}
    if point_coords:
        kwargs["points"] = point_coords
        kwargs["labels"] = point_labels
    if box_values:
        kwargs["bboxes"] = [box_values]

    try:
        results = _sam_model.predict(source=image, **kwargs)
    except TypeError as error:
        if "device" in kwargs and "device" in str(error):
            kwargs.pop("device", None)
            results = _sam_model.predict(source=image, **kwargs)
        else:
            raise RuntimeError(f"SAM2 prediction failed: {error}") from error
    except Exception as error:
        raise RuntimeError(f"SAM2 prediction failed: {error}") from error

    if isinstance(results, list):
        if not results:
            return {"masks": []}
        result = results[0]
    else:
        result = results

    masks = getattr(result, "masks", None)
    if masks is None:
        return {"masks": []}

    mask_data = getattr(masks, "data", None)
    if mask_data is None:
        return {"masks": []}

    if torch.is_tensor(mask_data):
        mask_array = mask_data.detach().cpu().numpy()
    else:
        mask_array = np.asarray(mask_data)

    if mask_array.ndim == 2:
        mask_array = mask_array[None, ...]

    if mask_array.ndim == 3:
        mask_h, mask_w = mask_array.shape[1], mask_array.shape[2]
        if mask_h != height or mask_w != width:
            resized_masks = []
            for mask in mask_array:
                resized_masks.append(
                    cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
                )
            mask_array = np.stack(resized_masks, axis=0)

    scores = None
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        conf = getattr(boxes, "conf", None)
        if conf is not None:
            scores = conf.detach().cpu().tolist() if torch.is_tensor(conf) else list(conf)

    return _format_masks(mask_array, scores)


@app.post("/predictions/{model_name}")
async def predict(model_name: str, request: Request) -> Dict[str, Any]:
    payload = await request.json()
    payload = _extract_payload(payload)

    if _sam_model is None:
        raise HTTPException(status_code=500, detail="Model not initialized")

    with _model_lock:
        try:
            image = _load_image(payload)
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        mode = payload.get("mode") if isinstance(payload.get("mode"), str) else "click"
        mode = mode.lower()
        if mode not in ("click", "auto", "semantic"):
            mode = "click"
        raw_points = payload.get("points")
        points = [point for point in raw_points if isinstance(point, dict)] if isinstance(raw_points, list) else []
        box = payload.get("box") if isinstance(payload.get("box"), dict) else None
        prompt = payload.get("prompt") if isinstance(payload.get("prompt"), str) else None

        try:
            return _predict_sam2(image, mode, points, box, prompt)
        except HTTPException:
            raise
        except Exception as error:
            logging.exception("SAM2 request failed")
            raise HTTPException(status_code=500, detail=str(error)) from error
