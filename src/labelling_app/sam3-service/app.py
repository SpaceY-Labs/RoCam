from __future__ import annotations

import base64
import os
import threading
import urllib.request
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import torch
from fastapi import FastAPI, Header, HTTPException, Request


app = FastAPI()

_api_key = os.environ.get("SAM3_API_KEY", "")
_model_lock = threading.Lock()

_model_type: Optional[str] = None
_predictor = None
_mask_generator = None
_torchscript_model = None
_device = "cuda" if torch.cuda.is_available() else "cpu"


def _load_model() -> None:
    global _model_type, _predictor, _mask_generator, _torchscript_model

    model_path = os.environ.get("SAM3_MODEL_PATH", "/app/weights/sam3.pt")
    handler_mode = os.environ.get("SAM3_HANDLER_MODE", "auto").lower()

    if handler_mode in ("segment_anything", "auto"):
        try:
            from segment_anything import (
                SamAutomaticMaskGenerator,
                SamPredictor,
                sam_model_registry,
            )

            model_key = os.environ.get("SAM3_MODEL_TYPE", "vit_h")
            sam = sam_model_registry[model_key](checkpoint=model_path)
            sam.to(device=_device)
            _predictor = SamPredictor(sam)
            _mask_generator = SamAutomaticMaskGenerator(sam)
            _model_type = "segment_anything"
            return
        except Exception:
            if handler_mode == "segment_anything":
                raise

    try:
        _torchscript_model = torch.jit.load(model_path, map_location=_device)
        _torchscript_model.eval()
        _model_type = "torchscript"
    except Exception as error:
        raise RuntimeError("Failed to load SAM3 model") from error


@app.on_event("startup")
async def startup_event() -> None:
    if os.environ.get("SAM3_SKIP_MODEL_LOAD") == "1":
        return
    _load_model()


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


def _require_api_key(auth_header: Optional[str], api_key_header: Optional[str]) -> None:
    if not _api_key:
        return

    if api_key_header and api_key_header == _api_key:
        return

    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "", 1).strip()
        if token == _api_key:
            return

    raise HTTPException(status_code=401, detail="Unauthorized")


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

    return {
        "polygon": polygons,
        "boundingBox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        "area": area,
        "score": float(score),
    }


def _format_masks(masks: np.ndarray, scores: np.ndarray) -> Dict[str, Any]:
    if masks is None or len(masks) == 0:
        return {"masks": []}

    formatted = []
    for index, mask in enumerate(masks):
        score = float(scores[index]) if scores is not None and len(scores) > index else 1.0
        formatted.append(_build_mask_response(mask, score))

    return {"masks": formatted}


def _predict_segment_anything(
    image: np.ndarray,
    mode: str,
    points: List[Dict[str, Any]],
    box: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if mode in ("auto", "semantic"):
        results = _mask_generator.generate(image)
        masks = []
        scores = []
        for item in results:
            masks.append(item["segmentation"])
            scores.append(float(item.get("predicted_iou", 1.0)))
        return _format_masks(np.array(masks), np.array(scores))

    if mode != "click":
        raise ValueError(f"Unsupported mode: {mode}")

    _predictor.set_image(image)
    point_coords = None
    point_labels = None
    if points:
        point_coords = np.array([[p["x"], p["y"]] for p in points], dtype=np.float32)
        point_labels = np.array([p.get("label", 1) for p in points], dtype=np.int32)

    box_array = None
    if box:
        box_array = np.array([box["x1"], box["y1"], box["x2"], box["y2"]], dtype=np.float32)

    masks, scores, _ = _predictor.predict(
        point_coords=point_coords,
        point_labels=point_labels,
        box=box_array,
        multimask_output=True,
    )

    return _format_masks(masks, scores)


def _predict_torchscript(
    image: np.ndarray,
    mode: str,
    points: List[Dict[str, Any]],
    box: Optional[Dict[str, Any]],
    prompt: Optional[str],
) -> Dict[str, Any]:
    if _torchscript_model is None:
        raise RuntimeError("Model not loaded")

    image_tensor = torch.from_numpy(image).permute(2, 0, 1).unsqueeze(0).float()
    image_tensor = image_tensor.to(_device)

    point_tensor = None
    label_tensor = None
    if points:
        coords = [[p["x"], p["y"]] for p in points]
        labels = [p.get("label", 1) for p in points]
        point_tensor = torch.tensor(coords, dtype=torch.float32, device=_device)
        label_tensor = torch.tensor(labels, dtype=torch.int64, device=_device)

    box_tensor = None
    if box:
        box_tensor = torch.tensor(
            [box["x1"], box["y1"], box["x2"], box["y2"]],
            dtype=torch.float32,
            device=_device,
        )

    with torch.no_grad():
        if hasattr(_torchscript_model, "predict"):
            output = _torchscript_model.predict(
                image_tensor,
                point_tensor,
                label_tensor,
                box_tensor,
                prompt,
                mode,
            )
        else:
            output = _torchscript_model(image_tensor, point_tensor, label_tensor, box_tensor, prompt, mode)

    masks, scores = _unpack_output(output)
    return _format_masks(masks, scores)


def _unpack_output(output: Any) -> tuple[np.ndarray, np.ndarray]:
    if isinstance(output, dict):
        masks = output.get("masks")
        scores = output.get("scores")
    elif isinstance(output, (list, tuple)) and len(output) >= 2:
        masks, scores = output[0], output[1]
    else:
        raise RuntimeError("Unexpected model output format")

    return _to_numpy(masks), _to_numpy(scores)


def _to_numpy(value: Any) -> np.ndarray:
    if value is None:
        return np.array([])
    if isinstance(value, np.ndarray):
        return value
    if torch.is_tensor(value):
        return value.detach().cpu().numpy()
    return np.array(value)


@app.post("/predictions/{model_name}")
async def predict(
    model_name: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="x-api-key"),
) -> Dict[str, Any]:
    _require_api_key(authorization, x_api_key)

    payload = await request.json()
    payload = _extract_payload(payload)

    try:
        image = _load_image(payload)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    mode = payload.get("mode", "click")
    points = payload.get("points") or []
    box = payload.get("box")
    prompt = payload.get("prompt")

    if _model_type is None:
        raise HTTPException(status_code=500, detail="Model not initialized")

    with _model_lock:
        try:
            if _model_type == "segment_anything":
                return _predict_segment_anything(image, mode, points, box)
            if _model_type == "torchscript":
                return _predict_torchscript(image, mode, points, box, prompt)
        except Exception as error:
            raise HTTPException(status_code=500, detail=str(error)) from error

    raise HTTPException(status_code=500, detail="Unsupported model type")
