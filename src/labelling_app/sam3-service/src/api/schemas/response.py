from pydantic import BaseModel
from typing import List, Dict, Any

class SegmentationResponse(BaseModel):
    polygon: List[List[Dict[str, float]]]
    boundingBox: Dict[str, float]
    area: float
    score: float

class SegmentationListResponse(BaseModel):
    segments: List[SegmentationResponse]
