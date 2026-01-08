import io
import numpy as np
import httpx
from PIL import Image

async def load_image_from_url(url: str) -> np.ndarray:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()

    image = Image.open(io.BytesIO(response.content)).convert("RGB")
    return np.array(image)
