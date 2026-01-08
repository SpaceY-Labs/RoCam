from fastapi import APIRouter, HTTPException
from ..schemas.request import ClickSegmentRequest
from ..schemas.response import SegmentationResponse
from ...inference.click_segment import run_click_inference
from ...utils.image import load_image_from_url

router = APIRouter()

@router.post("/click", response_model=SegmentationResponse)
async def click_segment(request: ClickSegmentRequest) -> SegmentationResponse:
    try:
        image = await load_image_from_url(request.image_url)
        points = [(p.x, p.y) for p in request.points]
        labels = [p.label for p in request.points]

        box = None
        if request.box:
            box = (request.box.x1, request.box.y1, request.box.x2, request.box.y2)

        result = run_click_inference(image, points, labels, box)
        return SegmentationResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
