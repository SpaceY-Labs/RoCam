"""
Author: Jianqing Liu
Date: 2026-01-27
Purpose: Build a /images/zip-compatible archive from a folder of images using SAM auto-segmentation.
"""

"""
Build a `/images/zip`-compatible archive from a folder of images using SAM (Ultralytics).

Flow:
  1) Load every image under the given folder (recursively by default)
  2) Run SAM to auto-label/segment each image
  3) Save the original image and a generated binary mask as Feather, zipped in the layout
     expected by the backend upload endpoint `/projects/:projectId/images/zip`

ZIP layout produced:
  * `image/<relative-path>` copies of every source image
  * `masks/<relative-path>.feather` binary masks (columns: mask, width, height)

Dependencies: `pip install ultralytics torch numpy pillow pyarrow`
"""

from __future__ import annotations

import argparse
import io
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, List, Tuple
from zipfile import ZipFile, ZIP_DEFLATED

try:
    import numpy as np
except ImportError as exc:  # pragma: no cover - highlight missing dependency
    raise SystemExit("numpy is required (install via `pip install numpy`).") from exc

try:
    import pyarrow as pa
    import pyarrow.feather as feather
except ImportError as exc:  # pragma: no cover - highlight missing dependency
    raise SystemExit("pyarrow is required (install via `pip install pyarrow`).") from exc

try:
    from PIL import Image, UnidentifiedImageError
except ImportError as exc:  # pragma: no cover - highlight missing dependency
    raise SystemExit("Pillow is required (install via `pip install pillow`).") from exc

try:
    from ultralytics import SAM
except ImportError as exc:  # pragma: no cover - highlight missing dependency
    raise SystemExit("ultralytics is required (install via `pip install ultralytics`).") from exc

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

# Default configuration values surfaced at the top for easy tweaking
DEFAULT_MODEL = r"C:\Personal-Project\vision-guided-tracker\src\cv\weights\sam_b.pt"
DEFAULT_DEVICE = "cpu"
DEFAULT_IMGSZ = 1024
DEFAULT_FALLBACK = "full"
DEFAULT_THRESHOLD = 128
DEFAULT_OUTPUT = Path("./masked_images.zip")
DEFAULT_RECURSIVE = True


@dataclass(frozen=True)
class ImageCandidate:
    """Reusable descriptor for source images that will be masked."""

    relative: PurePosixPath
    data: bytes


def _is_image_file(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTENSIONS


def collect_images_from_directory(root: Path, recursive: bool) -> List[ImageCandidate]:
    """Walk the directory tree (optionally recursively) and collect supported image files."""

    if not root.exists():
        raise FileNotFoundError(f"Input directory does not exist: {root}")

    files: List[ImageCandidate] = []
    iterator: Iterable[Path] = root.rglob("*") if recursive else root.iterdir()
    for path in iterator:
        if not path.is_file():
            continue
        if not _is_image_file(path.name):
            continue
        try:
            rel = path.relative_to(root)
        except ValueError:
            # Should not happen, but skip if the file is outside the root
            continue
        files.append(ImageCandidate(PurePosixPath(rel.as_posix()), path.read_bytes()))
    return sorted(files, key=lambda item: item.relative.as_posix())

def encode_mask(mask: np.ndarray, width: int, height: int) -> bytes:
    """Encode a binary mask array into a Feather file that the backend can parse."""

    table = pa.table(
        {
            "mask": pa.array([mask.tobytes()], type=pa.binary()),
            "width": pa.array([int(width)], type=pa.int32()),
            "height": pa.array([int(height)], type=pa.int32()),
        }
    )
    buffer = io.BytesIO()
    # Disable compression - apache-arrow JS doesn't support compressed feather
    feather.write_feather(table, buffer, compression="uncompressed")
    return buffer.getvalue()


def predict_sam_masks(
    model: SAM,
    image_bytes: bytes,
    device: str,
    imgsz: int,
    fallback_mode: str,
    threshold: int,
) -> List[Tuple[np.ndarray, int, int]]:
    """
    Run SAM on the input image and return a list of binary masks.
    Each mask is returned as a separate item in the list.
    Falls back to deterministic mask generation if SAM returns no masks.
    """

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            rgb = np.asarray(image.convert("RGB"))
    except UnidentifiedImageError as exc:  # pragma: no cover - should not happen
        raise ValueError("Input file is not a supported image") from exc

    # Run SAM; device is passed to predict to avoid .to() mismatches across versions.
    results = model.predict(source=rgb, imgsz=imgsz, device=device, verbose=False)
    masks: List[Tuple[np.ndarray, int, int]] = []

    if results and hasattr(results[0], "masks") and results[0].masks is not None:
        masks_data = results[0].masks.data  # torch.Tensor [N, H, W]
        if masks_data is not None and len(masks_data) > 0:
            if hasattr(masks_data, "cpu"):
                mask_np = masks_data.cpu().numpy()
            else:
                mask_np = np.asarray(masks_data)

            # Return each mask separately instead of merging them
            for i in range(mask_np.shape[0]):
                single_mask = (mask_np[i] > 0.5).astype(np.uint8)
                masks.append((single_mask, width, height))

    print(f"mask count: {len(masks)}", file=sys.stderr)

    # Fallback if no masks were detected
    if not masks:
        if fallback_mode == "full":
            mask_array = np.ones((height, width), dtype=np.uint8)
            masks.append((mask_array, width, height))
        elif fallback_mode == "threshold":
            grayscale = np.asarray(Image.fromarray(rgb).convert("L"), dtype=np.uint8)
            mask_array = (grayscale > threshold).astype(np.uint8)
            masks.append((mask_array, width, height))
        else:
            raise ValueError("SAM returned no masks and fallback mode is 'none'.")

    return masks


def build_zip(
    images: List[ImageCandidate],
    output: Path,
    model: SAM,
    device: str,
    imgsz: int,
    fallback_mode: str,
    threshold: int,
) -> None:
    """Write the transformed images and Feather masks into the destination ZIP."""

    if not images:
        raise ValueError("No supported image files were found to mask.")

    total_masks = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as zout:
        for candidate in images:
            image_entry = PurePosixPath("image") / candidate.relative

            zout.writestr(image_entry.as_posix(), candidate.data)

            # Get all masks for this image (returns a list now)
            masks = predict_sam_masks(
                model=model,
                image_bytes=candidate.data,
                device=device,
                imgsz=imgsz,
                fallback_mode=fallback_mode,
                threshold=threshold,
            )

            # Write each mask as a separate feather file with index suffix
            # e.g., masks/image_00.feather, masks/image_01.feather, etc.
            base_name = candidate.relative.stem  # filename without extension
            parent = candidate.relative.parent

            for idx, (mask_array, width, height) in enumerate(masks):
                mask_filename = f"{base_name}_{idx:02d}.feather"
                mask_entry = PurePosixPath("masks") / parent / mask_filename
                mask_bytes = encode_mask(mask_array, width, height)
                zout.writestr(mask_entry.as_posix(), mask_bytes)
                total_masks += 1

    print(f"Total masks created: {total_masks}", file=sys.stderr)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Auto-label images with SAM and bundle them into a /images/zip compatible archive."
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=None,
        help="Input directory that contains the source images (default: current directory).",
    )
    parser.add_argument(
        "--source",
        dest="source",
        type=Path,
        help="Input directory that contains the source images (default: current directory).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Destination ZIP file (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Path or name of the SAM/SAM2 weights (default: {DEFAULT_MODEL}).",
    )
    parser.add_argument(
        "--device",
        default=DEFAULT_DEVICE,
        help="Device for inference, e.g. cpu, cuda:0.",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=DEFAULT_IMGSZ,
        help=f"Inference image size passed to SAM (default: {DEFAULT_IMGSZ}).",
    )
    parser.add_argument(
        "--fallback",
        choices=("full", "threshold", "none"),
        default=DEFAULT_FALLBACK,
        help=f"Fallback mask strategy if SAM2 returns nothing (default: {DEFAULT_FALLBACK}).",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_THRESHOLD,
        help=f"Threshold value (0-255) applied when --fallback=threshold (default: {DEFAULT_THRESHOLD}).",
    )
    parser.add_argument(
        "--recursive",
        dest="recursive",
        action="store_true",
        help="Scan subdirectories of the source directory (default).",
    )
    parser.add_argument(
        "--no-recursive",
        dest="recursive",
        action="store_false",
        help="Do not descend into subdirectories when the source is a directory.",
    )
    parser.set_defaults(recursive=DEFAULT_RECURSIVE)
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()

    threshold = max(0, min(255, args.threshold))

    source_dir = Path(r"C:\Year4\4G06\project-folder\vision-guided-tracker\src\labelling_app\sample_img")

    if not source_dir.is_dir():
        raise SystemExit("Source must be a directory containing images.")
    images = collect_images_from_directory(source_dir, args.recursive)

    if not images:
        raise SystemExit(f"No supported image files were found in {source_dir}")

    try:
        model = SAM(args.model)
    except Exception as exc:  # pragma: no cover - surface model loading issues
        raise SystemExit(f"Failed to load SAM model '{args.model}': {exc}") from exc

    build_zip(
        images=images,
        output=args.output,
        model=model,
        device=args.device,
        imgsz=args.imgsz,
        fallback_mode=args.fallback,
        threshold=threshold,
    )

    print(
        f"Created ZIP for /images/zip with {len(images)} images at {args.output.resolve()}"
    )


if __name__ == "__main__":
    main()
