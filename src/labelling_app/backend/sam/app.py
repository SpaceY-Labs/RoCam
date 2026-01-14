from __future__ import annotations

import base64
import logging
import os
import shutil
import tempfile
import threading
import urllib.request
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request


app = FastAPI()

_model_lock = threading.Lock()
_model_type: Optional[str] = None
_sam3_predictor = None
_torchscript_model = None
_session_resources: Dict[str, str] = {}
def _detect_device() -> str:
    try:
        if torch.cuda.is_available():
            return "cuda"
        logging.warning("CUDA not available; SAM3 will run on CPU.")
        return "cpu"
    except Exception:
        logging.warning("CUDA availability check failed; SAM3 will run on CPU.")
        return "cpu"


_device = _detect_device()


def _load_model() -> None:
    global _model_type, _sam3_predictor, _torchscript_model

    model_path = os.environ.get("SAM3_MODEL_PATH", "/app/sam/weights/sam3.pt")
    handler_mode = os.environ.get("SAM3_HANDLER_MODE", "sam3").lower()

    if handler_mode in ("sam3", "auto"):
        try:
            from sam3.model_builder import build_sam3_video_predictor

            bpe_path = os.environ.get("SAM3_BPE_PATH", "/app/sam3/sam3/assets/bpe_simple_vocab_16e6.txt.gz")
            if os.path.exists(bpe_path):
                _sam3_predictor = build_sam3_video_predictor(
                    checkpoint_path=model_path,
                    bpe_path=bpe_path,
                )
            else:
                _sam3_predictor = build_sam3_video_predictor(checkpoint_path=model_path)
            _model_type = "sam3_video"
            return
        except Exception:
            if handler_mode == "sam3":
                raise

    if handler_mode in ("torchscript", "auto"):
        try:
            _torchscript_model = torch.jit.load(model_path, map_location=_device)
            _torchscript_model.eval()
            _model_type = "torchscript"
            return
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


def _download_resource(resource_url: str) -> str:
    parsed = urlparse(resource_url)
    suffix = os.path.splitext(parsed.path)[1] or ".mp4"
    temp_dir = tempfile.mkdtemp(prefix="sam3-")
    temp_path = os.path.join(temp_dir, f"resource{suffix}")
    with urllib.request.urlopen(resource_url) as response:
        data = response.read()
    with open(temp_path, "wb") as handle:
        handle.write(data)
    return temp_path


def _normalize_sam3_request(request: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(request)
    if "resourcePath" in normalized and "resource_path" not in normalized:
        normalized["resource_path"] = normalized.pop("resourcePath")
    if "resourceUrl" in normalized and "resource_url" not in normalized:
        normalized["resource_url"] = normalized.pop("resourceUrl")
    return normalized


def _cleanup_session_resource(session_id: Optional[str]) -> None:
    if not session_id:
        return
    resource_path = _session_resources.pop(session_id, None)
    if not resource_path:
        return
    resource_dir = os.path.dirname(resource_path)
    if os.path.basename(resource_dir).startswith("sam3-"):
        shutil.rmtree(resource_dir, ignore_errors=True)
        return
    try:
        os.remove(resource_path)
    except OSError:
        pass


def _format_sam3_outputs(outputs: Any) -> Dict[str, Any]:
    if not isinstance(outputs, dict):
        return {"raw": _to_jsonable(outputs)}

    raw_masks = (
        outputs.get("out_binary_masks")
        or outputs.get("binary_masks")
        or outputs.get("masks")
    )
    if raw_masks is None:
        return {"raw": _to_jsonable(outputs)}

    masks_array = _to_numpy(raw_masks)
    if masks_array.size == 0:
        return {"masks": []}
    if masks_array.ndim == 2:
        masks_array = masks_array[None, ...]

    obj_ids = outputs.get("out_obj_ids") or outputs.get("obj_ids")
    obj_ids_array = _to_numpy(obj_ids) if obj_ids is not None else None
    if obj_ids_array is not None and obj_ids_array.ndim == 0:
        obj_ids_array = np.array([int(obj_ids_array.item())])

    scores = outputs.get("scores") or outputs.get("out_scores")
    scores_array = _to_numpy(scores) if scores is not None else None
    if scores_array is not None and scores_array.ndim == 0:
        scores_array = np.array([float(scores_array.item())])

    formatted: List[Dict[str, Any]] = []
    for index, mask in enumerate(masks_array):
        score = 1.0
        if scores_array is not None and scores_array.size > index:
            score = float(scores_array[index])
        mask_info = _build_mask_response(mask, score)
        if obj_ids_array is not None and obj_ids_array.size > index:
            mask_info["objId"] = int(obj_ids_array[index])
        else:
            mask_info["objId"] = index
        formatted.append(mask_info)

    return {"masks": formatted}


def _run_sam3_request(request: Dict[str, Any]) -> Dict[str, Any]:
    if _sam3_predictor is None:
        raise RuntimeError("SAM3 predictor not initialized")

    normalized = _normalize_sam3_request(request)
    request_type = normalized.get("type")
    if not request_type:
        raise ValueError("SAM3 request requires 'type'")

    if request_type == "start_session":
        resource_url = normalized.get("resource_url")
        if resource_url and not normalized.get("resource_path"):
            normalized = dict(normalized)
            normalized["resource_path"] = _download_resource(resource_url)
        response = _sam3_predictor.handle_request(request=normalized)
        session_id = response.get("session_id") if isinstance(response, dict) else None
        resource_path = normalized.get("resource_path")
        if session_id and resource_path and resource_url:
            _session_resources[str(session_id)] = resource_path
        return _to_jsonable(response)

    if request_type == "close_session":
        response = _sam3_predictor.handle_request(request=normalized)
        _cleanup_session_resource(str(normalized.get("session_id") or ""))
        return _to_jsonable(response)

    if request_type == "propagate_in_video":
        outputs_per_frame: Dict[str, Any] = {}
        for response in _sam3_predictor.handle_stream_request(request=normalized):
            frame_index = response.get("frame_index")
            outputs = response.get("outputs")
            outputs_per_frame[str(frame_index)] = _format_sam3_outputs(outputs)
        return {"frames": outputs_per_frame}

    response = _sam3_predictor.handle_request(request=normalized)
    if isinstance(response, dict) and "outputs" in response:
        response = dict(response)
        response["outputs"] = _format_sam3_outputs(response.get("outputs"))
        return response
    return _to_jsonable(response)


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


def _to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {key: _to_jsonable(val) for key, val in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if torch.is_tensor(value):
        return value.detach().cpu().tolist()
    return str(value)


@app.post("/predictions/{model_name}")
async def predict(model_name: str, request: Request) -> Dict[str, Any]:
    payload = await request.json()
    payload = _extract_payload(payload)

    if _model_type is None:
        raise HTTPException(status_code=500, detail="Model not initialized")

    with _model_lock:
        try:
            if _model_type == "sam3_video":
                sam3_request = payload.get("request") if isinstance(payload, dict) else None
                sam3_request = sam3_request or payload
                if not isinstance(sam3_request, dict):
                    raise HTTPException(status_code=400, detail="SAM3 request must be an object")
                return _run_sam3_request(sam3_request)
            if _model_type == "torchscript":
                try:
                    image = _load_image(payload)
                except Exception as error:
                    raise HTTPException(status_code=400, detail=str(error)) from error

                mode = payload.get("mode", "click")
                points = payload.get("points") or []
                box = payload.get("box")
                prompt = payload.get("prompt")
                return _predict_torchscript(image, mode, points, box, prompt)
        except HTTPException:
            raise
        except Exception as error:
            logging.exception("SAM3 request failed")
            raise HTTPException(status_code=500, detail=str(error)) from error

    raise HTTPException(status_code=500, detail="Unsupported model type")
