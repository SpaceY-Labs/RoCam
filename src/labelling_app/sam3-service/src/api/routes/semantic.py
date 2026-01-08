from fastapi import APIRouter
from ..schemas.request import SemanticSegmentRequest
from ..schemas.response import SegmentationResponse

router = APIRouter()

@router.post("/semantic", response_model=SegmentationResponse)
async def semantic_segment(request: SemanticSegmentRequest) -> SegmentationResponse:
    return SegmentationResponse(polygon=[], boundingBox={"x": 0, "y": 0, "w": 0, "h": 0}, area=0, score=0.0)
