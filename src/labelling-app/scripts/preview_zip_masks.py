"""
Preview images and mask overlays from a ZIP formatted for /projects/:projectId/images/zip.

Expected ZIP structure:
  - image/<path>.png (or jpg/webp/...)
  - masks/<path>.feather (mask bytes + width + height columns)

For each image, this script loads all matching masks and shows a side-by-side preview.
Hover over the overlay to highlight the mask under your mouse.

Dependencies: pip install pillow pyarrow matplotlib numpy
"""

from __future__ import annotations

import io
from pathlib import Path, PurePosixPath
from typing import Optional
from zipfile import ZipFile

import matplotlib.pyplot as plt
import matplotlib.cm as cm
import numpy as np
import pyarrow.feather as feather
from PIL import Image

# Configure these values directly to run the preview
ZIP_PATH = Path(r"C:\Year4\4G06\project-folder\vision-guided-tracker\masked_images.zip")
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


def generate_colors(count: int) -> np.ndarray:
    """Return an array of RGB colors (0-255) with good contrast."""
    if count <= 0:
        return np.zeros((0, 3), dtype=np.uint8)
    if count <= 20:
        cmap = cm.get_cmap("tab20", count)
    else:
        cmap = cm.get_cmap("hsv", count)
    colors = (cmap(np.arange(count))[:, :3] * 255).astype(np.uint8)
    return colors


def build_overlay(
    image: Image.Image,
    masks: list[np.ndarray],
    colors: np.ndarray,
    alpha: float = 0.4,
) -> np.ndarray:
    """Blend a colored mask overlay onto the RGB image."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    blended = rgb.copy()

    for idx, mask in enumerate(masks):
        if mask.size == 0:
            continue
        mask_bool = mask.astype(bool)
        if not mask_bool.any():
            continue
        overlay_color = colors[idx].astype(np.float32)
        blended[mask_bool] = (1 - alpha) * blended[mask_bool] + alpha * overlay_color

    return blended.astype(np.uint8)


def build_hover_map(masks: list[np.ndarray]) -> np.ndarray:
    """Return per-pixel mask index for hover; picks smallest mask on overlaps."""
    if not masks:
        return np.full((1, 1), -1, dtype=np.int32)

    height, width = masks[0].shape
    hover_map = np.full((height, width), -1, dtype=np.int32)
    current_sizes = np.full((height, width), np.iinfo(np.int32).max, dtype=np.int32)

    for idx, mask in enumerate(masks):
        mask_bool = mask.astype(bool)
        if not mask_bool.any():
            continue
        size = int(mask_bool.sum())
        smaller = mask_bool & (size < current_sizes)
        hover_map[smaller] = idx
        current_sizes[smaller] = size

    return hover_map


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
            base_name = rel_path.with_suffix("").as_posix()
            mask_prefix = f"masks/{base_name}_"
            mask_entries = [
                name
                for name in zf.namelist()
                if name.startswith(mask_prefix) and name.endswith(".feather")
            ]

            if not mask_entries:
                print(f"[skip] No masks for {rel_path}")
                continue

            image_bytes = zf.read(entry)

            image = Image.open(io.BytesIO(image_bytes))
            masks: list[np.ndarray] = []
            for mask_name in sorted(mask_entries):
                mask_bytes = zf.read(mask_name)
                mask, width, height = load_mask(mask_bytes)
                if (image.width, image.height) != (width, height):
                    print(
                        f"[warn] Size mismatch for {rel_path}: image {image.size}, mask {(width, height)}"
                    )
                masks.append(mask)

            colors = generate_colors(len(masks))
            overlay = build_overlay(image, masks, colors, alpha=alpha)
            hover_map = build_hover_map(masks)

            fig, axes = plt.subplots(1, 2, figsize=(12, 6))
            image_ax, overlay_ax = axes

            image_ax.imshow(image)
            image_ax.set_title(f"Image: {rel_path}")
            image_ax.axis("off")

            overlay_artist = overlay_ax.imshow(overlay)
            overlay_ax.set_title(f"Overlay ({len(masks)} masks)")
            overlay_ax.axis("off")

            base_overlay = overlay.copy()
            base_rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
            highlight_color = np.array([255, 255, 255], dtype=np.uint8)
            active_idx = {"value": None}

            def update_highlight(idx: Optional[int]) -> None:
                if idx is None or idx < 0 or idx >= len(masks):
                    overlay_artist.set_data(base_overlay)
                    return
                highlight = base_overlay.copy()
                mask_bool = masks[idx].astype(bool)
                if mask_bool.any():
                    highlight[mask_bool] = (
                        0.2 * base_rgb[mask_bool] + 0.8 * highlight_color
                    ).astype(np.uint8)
                overlay_artist.set_data(highlight)

            def on_move(event) -> None:
                if event.inaxes != overlay_ax:
                    if active_idx["value"] is not None:
                        active_idx["value"] = None
                        update_highlight(None)
                        fig.canvas.draw_idle()
                    return
                if event.xdata is None or event.ydata is None:
                    return
                x = int(event.xdata)
                y = int(event.ydata)
                if y < 0 or x < 0 or y >= hover_map.shape[0] or x >= hover_map.shape[1]:
                    return
                idx = int(hover_map[y, x])
                if idx == active_idx["value"]:
                    return
                active_idx["value"] = idx if idx >= 0 else None
                update_highlight(active_idx["value"])
                fig.canvas.draw_idle()

            fig.canvas.mpl_connect("motion_notify_event", on_move)

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
