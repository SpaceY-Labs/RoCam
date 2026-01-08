from .predictor import load_model, get_model_loaded

def get_model() -> bool:
    return get_model_loaded()
