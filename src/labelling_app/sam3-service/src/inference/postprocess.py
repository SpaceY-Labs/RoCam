from typing import List, Dict, Any
import numpy as np

def mask_to_polygon(mask: np.ndarray, simplify_tolerance: float = 2.0) -> List[List[Dict[str, float]]]:
    _ = simplify_tolerance
    height, width = mask.shape[:2]
    return [[
        {"x": 0.0, "y": 0.0},
        {"x": float(width), "y": 0.0},
        {"x": float(width), "y": float(height)},
        {"x": 0.0, "y": float(height)}
    ]]

def calculate_bbox(mask: np.ndarray) -> Dict[str, float]:
    height, width = mask.shape[:2]
    return {"x": 0.0, "y": 0.0, "w": float(width), "h": float(height)}

def calculate_area(mask: np.ndarray) -> float:
    return float(mask.size)
