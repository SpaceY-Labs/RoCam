from typing import List, Tuple, Optional, Dict, Any
import numpy as np

from ..model.predictor import get_predictor
from .postprocess import mask_to_polygon, calculate_bbox, calculate_area

def run_click_inference(
    image: np.ndarray,
    points: List[Tuple[float, float]],
    labels: List[int],
    box: Optional[Tuple[float, float, float, float]] = None
) -> Dict[str, Any]:
    predictor = get_predictor()
    predictor.set_image(image)

    point_coords = np.array(points)
    point_labels = np.array(labels)

    mask, score = predictor.predict_click(
        points=point_coords,
        labels=point_labels,
        box=np.array(box) if box else None
    )

    polygon = mask_to_polygon(mask, simplify_tolerance=2.0)
    bbox = calculate_bbox(mask)
    area = calculate_area(mask)

    return {
        "polygon": polygon,
        "boundingBox": bbox,
        "area": area,
        "score": float(score)
    }
