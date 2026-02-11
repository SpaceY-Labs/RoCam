"""
SAM2 Point-Based Mask Prediction Service.

Minimal FastAPI backend that exposes POST /segment for on-demand,
point-based mask generation using Ultralytics SAM2.

Designed for Cloud Run with an NVIDIA L4 GPU.
"""

from __future__ import annotations

import io
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sam-backend")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SAM_MODEL_NAME = os.environ.get("SAM_MODEL_NAME", "sam2.1_b.pt")
IMGSZ = int(os.environ.get("SAM_IMGSZ", "1024"))
PORT = int(os.environ.get("PORT", "8080"))


def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


DEVICE = os.environ.get("SAM_DEVICE", "cuda" if _has_cuda() else "cpu")


# ---------------------------------------------------------------------------
# Model singleton
# ---------------------------------------------------------------------------

_model = None


def get_model():
    global _model
    if _model is None:
        from ultralytics import SAM

        logger.info("Loading SAM model: %s on device: %s", SAM_MODEL_NAME, DEVICE)
        t0 = time.time()
        _model = SAM(SAM_MODEL_NAME)
        logger.info("SAM model loaded in %.1fs", time.time() - t0)
    return _model


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class PointInput(BaseModel):
    x: float
    y: float
    label: int = 1  # 1=foreground, 0=background


class SegmentRequest(BaseModel):
    mode: str = "click"
    imageUrl: Optional[str] = None
    projectId: Optional[str] = None
    imageId: Optional[str] = None
    points: Optional[List[PointInput]] = None
    box: Optional[dict] = None
    prompt: Optional[str] = None


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class MaskResult(BaseModel):
    mask: List[List[int]]
    boundingBox: BoundingBox


class SegmentResponse(BaseModel):
    masks: List[MaskResult]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Eagerly load model at startup so first request is fast
    try:
        get_model()
    except Exception as exc:
        logger.warning("Failed to preload model at startup: %s", exc)
    yield


app = FastAPI(title="SAM Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "model": SAM_MODEL_NAME, "device": DEVICE}


def _download_image(url: str) -> Image.Image:
    """Download image from URL (typically a GCS signed URL)."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def _compute_bbox(mask_2d: np.ndarray) -> dict:
    """Compute bounding box {x, y, w, h} from a 2D binary mask."""
    rows = np.any(mask_2d, axis=1)
    cols = np.any(mask_2d, axis=0)
    if not rows.any():
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    return {
        "x": int(cmin),
        "y": int(rmin),
        "w": int(cmax - cmin + 1),
        "h": int(rmax - rmin + 1),
    }


@app.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest):
    """
    Point-based SAM2 mask prediction.

    Only invoked on explicit user action from the frontend toolbar.
    """
    if not req.imageUrl:
        raise HTTPException(status_code=400, detail="imageUrl is required")

    if not req.points or len(req.points) == 0:
        raise HTTPException(status_code=400, detail="At least one point is required")

    # 1. Download image
    try:
        pil_image = _download_image(req.imageUrl)
    except Exception as exc:
        logger.error("Failed to download image: %s", exc)
        raise HTTPException(status_code=400, detail=f"Failed to download image: {exc}")

    width, height = pil_image.size
    rgb_array = np.asarray(pil_image)

    # 2. Convert normalized points (0-1) to pixel coordinates
    points_px = []
    labels = []
    for pt in req.points:
        px_x = pt.x * width
        px_y = pt.y * height
        points_px.append([px_x, px_y])
        labels.append(pt.label)

    points_array = np.array(points_px, dtype=np.float32)
    labels_array = np.array(labels, dtype=np.int32)

    # 3. Run SAM2 point-based prediction
    model = get_model()
    t0 = time.time()
    try:
        results = model.predict(
            source=rgb_array,
            points=points_array,
            labels=labels_array,
            imgsz=IMGSZ,
            device=DEVICE,
            verbose=False,
        )
    except Exception as exc:
        logger.error("SAM prediction failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"SAM prediction failed: {exc}")

    elapsed = time.time() - t0
    logger.info("SAM prediction took %.2fs", elapsed)

    # 4. Extract masks from results
    masks_out: List[MaskResult] = []

    if results and hasattr(results[0], "masks") and results[0].masks is not None:
        masks_data = results[0].masks.data
        if masks_data is not None and len(masks_data) > 0:
            if hasattr(masks_data, "cpu"):
                mask_np = masks_data.cpu().numpy()
            else:
                mask_np = np.asarray(masks_data)

            logger.info(
                "SAM returned %d masks, shape: %s (image: %dx%d)",
                mask_np.shape[0], mask_np.shape, width, height,
            )

            for i in range(mask_np.shape[0]):
                single = (mask_np[i] > 0.5).astype(np.uint8)
                mask_h, mask_w = single.shape

                # Resize to original image dimensions if needed
                if mask_w != width or mask_h != height:
                    mask_pil = Image.fromarray(single * 255)
                    mask_pil = mask_pil.resize((width, height), Image.NEAREST)
                    single = (np.array(mask_pil) > 127).astype(np.uint8)

                bbox = _compute_bbox(single)

                # Convert to 2D list for JSON response
                mask_2d = single.tolist()
                masks_out.append(
                    MaskResult(
                        mask=mask_2d,
                        boundingBox=BoundingBox(**bbox),
                    )
                )

    if not masks_out:
        logger.warning("SAM returned no masks for the given points")

    logger.info("Returning %d masks", len(masks_out))
    return SegmentResponse(masks=masks_out)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
