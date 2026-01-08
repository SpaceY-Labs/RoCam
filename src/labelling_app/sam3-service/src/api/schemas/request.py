from pydantic import BaseModel
from typing import List, Optional

class Point(BaseModel):
    x: float
    y: float
    label: int

class Box(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class ClickSegmentRequest(BaseModel):
    image_url: str
    points: List[Point]
    box: Optional[Box] = None

class AutoSegmentRequest(BaseModel):
    image_url: str

class SemanticSegmentRequest(BaseModel):
    image_url: str
    prompt: str
