from typing import Optional
import numpy as np

_model_loaded = False

class DummyPredictor:
    def set_image(self, image: np.ndarray) -> None:
        self._image = image

    def predict_click(self, points: np.ndarray, labels: np.ndarray, box: Optional[np.ndarray] = None):
        _ = points
        _ = labels
        _ = box
        height, width = self._image.shape[:2]
        mask = np.ones((height, width), dtype=np.uint8)
        score = 0.5
        return mask, score

def load_model() -> None:
    global _model_loaded
    _model_loaded = True

def get_model_loaded() -> bool:
    return _model_loaded

def get_predictor() -> DummyPredictor:
    return DummyPredictor()
