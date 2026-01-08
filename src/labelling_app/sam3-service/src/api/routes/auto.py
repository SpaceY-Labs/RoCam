from fastapi import APIRouter
from ..schemas.request import AutoSegmentRequest
from ..schemas.response import SegmentationListResponse

router = APIRouter()

@router.post("/auto", response_model=SegmentationListResponse)
async def auto_segment(request: AutoSegmentRequest) -> SegmentationListResponse:
    return SegmentationListResponse(segments=[])
