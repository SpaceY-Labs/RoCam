"""
Author: Jianqing Liu
Date: 2026-01-27
Purpose: Preview images and mask overlays from a ZIP archive formatted for the labelling backend.

Preview images and mask overlays from a ZIP formatted for /projects/:projectId/images/zip.

Expected ZIP structure:
  - image/<path>.png (or jpg/webp/...)
  - masks/<path>.feather (mask bytes + width + height columns)

For each image, this script loads the paired mask and shows a side-by-side preview.

Dependencies: pip install pillow pyarrow matplotlib numpy
"""

from __future__ import annotations

import io
from pathlib import Path, PurePosixPath
from typing import Optional
from zipfile import ZipFile

import matplotlib.pyplot as plt
import numpy as np
import pyarrow.feather as feather
from PIL import Image

# Configure these values directly to run the preview
ZIP_PATH = Path(r"C:\Year4\4G06\project-folder\vision-guided-tracker\src\labelling_app\sample_img\masked_images.zip")
ALPHA = 0.4
LIMIT: Optional[int] = None


def load_mask(feather_bytes: bytes) -> tuple[np.ndarray, int, int]:
    """Load mask bytes, width, and height from a Feather buffer."""
    table = feather.read_table(io.BytesIO(feather_bytes))
    mask_col = table.column("mask")[0].as_py()
    width = int(table.column("width")[0].as_py())
    height = int(table.column("height")[0].as_py())

    mask_arr = np.frombuffer(mask_col, dtype=np.uint8)
    if mask_arr.size != width * height:
        raise ValueError(f"Mask size mismatch (len={mask_arr.size}, expected={width*height})")
    return mask_arr.reshape((height, width)), width, height


def make_overlay(image: Image.Image, mask: np.ndarray, alpha: float = 0.4) -> np.ndarray:
    """Blend a red mask overlay onto the RGB image."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    overlay_color = np.array([255.0, 0.0, 0.0], dtype=np.float32)
    mask_bool = mask.astype(bool)

    blended = rgb.copy()
    blended[mask_bool] = (1 - alpha) * rgb[mask_bool] + alpha * overlay_color
    return blended.astype(np.uint8)


def preview_zip(
    zip_path: Path,
    limit: Optional[int],
    alpha: float,
) -> None:
    with ZipFile(zip_path, "r") as zf:
        # Collect image entries
        image_entries = [
            entry
            for entry in zf.infolist()
            if not entry.is_dir() and PurePosixPath(entry.filename).parts[0] == "image"
        ]

        if not image_entries:
            raise SystemExit("No image entries found under image/ in the ZIP.")

        count = 0
        for entry in sorted(image_entries, key=lambda e: e.filename):
            rel_path = PurePosixPath(entry.filename).relative_to("image")
            mask_path = PurePosixPath("masks") / rel_path.with_suffix(".feather")

            if mask_path.as_posix() not in zf.namelist():
                print(f"[skip] No mask for {rel_path}")
                continue

            image_bytes = zf.read(entry)
            mask_bytes = zf.read(mask_path.as_posix())

            image = Image.open(io.BytesIO(image_bytes))
            mask, width, height = load_mask(mask_bytes)

            if (image.width, image.height) != (width, height):
                print(f"[warn] Size mismatch for {rel_path}: image {image.size}, mask {(width, height)}")

            overlay = make_overlay(image, mask, alpha=alpha)

            fig, axes = plt.subplots(1, 2, figsize=(10, 5))
            axes[0].imshow(image)
            axes[0].set_title(f"Image: {rel_path}")
            axes[0].axis("off")

            axes[1].imshow(overlay)
            axes[1].set_title("Overlay")
            axes[1].axis("off")

            plt.tight_layout()
            plt.show(block=True)
            plt.close(fig)

            count += 1
            if limit and count >= limit:
                break

        print(f"Previewed {count} images from {zip_path}")


def main() -> None:
    if not ZIP_PATH:
        raise SystemExit("Set ZIP_PATH at the top of the file to your masked ZIP.")
    preview_zip(
        zip_path=ZIP_PATH,
        limit=LIMIT,
        alpha=ALPHA,
    )


if __name__ == "__main__":
    main()
