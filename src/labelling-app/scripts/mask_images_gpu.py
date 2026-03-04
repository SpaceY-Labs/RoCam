"""
GPU version of mask_images: build /images/zip-compatible archives using SAM (Ultralytics) on CUDA.

Differences from mask_images.py:
  - Default device is CUDA when available (cuda:0), else CPU.
  - Saves one ZIP every 100 images (e.g. masked_images_part001.zip, part002.zip, ...).

Flow:
  1) Load every image under the given folder (recursively by default)
  2) Run SAM on GPU to auto-label/segment each image
  3) Every 100 images: write a ZIP with originals + binary masks (.bin), layout expected by
     `/projects/:projectId/images/zip`

ZIP layout (per part):
  * `image/<relative-path>` copies of source images in that chunk
  * `masks/<relative-path>.bin` binary masks (8-byte header: width uint32 LE, height uint32 LE, then raw mask bytes)

Dependencies: `pip install ultralytics torch numpy pillow`
"""

from __future__ import annotations

import argparse
import io
import logging
import struct
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, List, Tuple
from zipfile import ZipFile, ZIP_DEFLATED

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit("numpy is required (install via `pip install numpy`).") from exc

try:
    from PIL import Image, UnidentifiedImageError
except ImportError as exc:
    raise SystemExit("Pillow is required (install via `pip install pillow`).") from exc

try:
    import torch
except ImportError as exc:
    raise SystemExit("torch is required (install via `pip install torch`).") from exc

try:
    from ultralytics import SAM
except ImportError as exc:
    raise SystemExit("ultralytics is required (install via `pip install ultralytics`).") from exc

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

DEFAULT_MODEL = r"C:\Personal-Project\vision-guided-tracker\src\cv\weights\sam_b.pt"
DEFAULT_IMGSZ = 1024
DEFAULT_FALLBACK = "full"
DEFAULT_THRESHOLD = 128
DEFAULT_OUTPUT = Path("./masked_images.zip")
DEFAULT_RECURSIVE = True
CHUNK_SIZE = 100  # save one zip every N images

logger = logging.getLogger(__name__)


def _default_device() -> str:
    """Use CUDA if available, else CPU."""
    return "cuda:0" if torch.cuda.is_available() else "cpu"


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
            continue
        files.append(ImageCandidate(PurePosixPath(rel.as_posix()), path.read_bytes()))
    return sorted(files, key=lambda item: item.relative.as_posix())


def encode_mask(mask: np.ndarray, width: int, height: int) -> bytes:
    """Encode a binary mask into .bin format: 8-byte header (width, height uint32 LE) + raw mask bytes."""
    header = struct.pack("<II", int(width), int(height))
    return header + mask.tobytes()


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
    Uses the given device (e.g. cuda:0) for inference.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            rgb = np.asarray(image.convert("RGB"))
    except UnidentifiedImageError as exc:
        raise ValueError("Input file is not a supported image") from exc

    results = model.predict(source=rgb, imgsz=imgsz, device=device, verbose=False)
    masks: List[Tuple[np.ndarray, int, int]] = []

    if results and hasattr(results[0], "masks") and results[0].masks is not None:
        masks_data = results[0].masks.data
        if masks_data is not None and len(masks_data) > 0:
            if hasattr(masks_data, "cpu"):
                mask_np = masks_data.cpu().numpy()
            else:
                mask_np = np.asarray(masks_data)

            for i in range(mask_np.shape[0]):
                single_mask = (mask_np[i] > 0.5).astype(np.uint8)
                mask_h, mask_w = single_mask.shape

                if mask_w != width or mask_h != height:
                    mask_pil = Image.fromarray(single_mask * 255)
                    mask_pil = mask_pil.resize((width, height), Image.NEAREST)
                    single_mask = (np.array(mask_pil) > 127).astype(np.uint8)

                masks.append((single_mask, width, height))

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


def build_zip_chunk(
    images: List[ImageCandidate],
    output_path: Path,
    model: SAM,
    device: str,
    imgsz: int,
    fallback_mode: str,
    threshold: int,
) -> int:
    """Write one ZIP containing the given image chunk (images + masks). Returns number of masks written."""
    if not images:
        return 0

    total_masks = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, "w", ZIP_DEFLATED) as zout:
        for candidate in images:
            image_entry = PurePosixPath("image") / candidate.relative
            zout.writestr(image_entry.as_posix(), candidate.data)

            masks = predict_sam_masks(
                model=model,
                image_bytes=candidate.data,
                device=device,
                imgsz=imgsz,
                fallback_mode=fallback_mode,
                threshold=threshold,
            )

            base_name = candidate.relative.stem
            parent = candidate.relative.parent

            for idx, (mask_array, width, height) in enumerate(masks):
                mask_filename = f"{base_name}_{idx:02d}.bin"
                mask_entry = PurePosixPath("masks") / parent / mask_filename
                mask_bytes = encode_mask(mask_array, width, height)
                zout.writestr(mask_entry.as_posix(), mask_bytes)
                total_masks += 1

    return total_masks


def run_with_chunked_zips(
    images: List[ImageCandidate],
    output: Path,
    model: SAM,
    device: str,
    imgsz: int,
    fallback_mode: str,
    threshold: int,
    chunk_size: int,
) -> None:
    """Process all images, saving a new ZIP every chunk_size images."""
    if not images:
        raise ValueError("No supported image files were found to mask.")

    stem = output.stem
    parent = output.parent
    suffix = output.suffix

    total_masks = 0
    num_chunks = (len(images) + chunk_size - 1) // chunk_size

    for i in range(num_chunks):
        start = i * chunk_size
        end = min(start + chunk_size, len(images))
        chunk = images[start:end]
        part_name = f"{stem}_part{i + 1:03d}{suffix}"
        part_path = parent / part_name

        print(f"Writing {part_path.name} ({len(chunk)} images, {start + 1}-{end} of {len(images)})...", file=sys.stderr)
        n = build_zip_chunk(
            images=chunk,
            output_path=part_path,
            model=model,
            device=device,
            imgsz=imgsz,
            fallback_mode=fallback_mode,
            threshold=threshold,
        )
        total_masks += n
        print(f"  -> {n} masks in {part_path.name}", file=sys.stderr)

    print(f"Total masks created: {total_masks} across {num_chunks} ZIP(s)", file=sys.stderr)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Auto-label images with SAM (GPU) and save a ZIP every 100 images."
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=None,
        help="Input directory containing source images (default: current directory).",
    )
    parser.add_argument(
        "--source",
        dest="source",
        type=Path,
        help="Input directory containing source images.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Base output path for ZIPs; parts named <stem>_part001<suffix>, etc. (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Path or name of SAM/SAM2 weights (default: {DEFAULT_MODEL}).",
    )
    parser.add_argument(
        "--device",
        default=None,
        help="Device for inference (default: cuda:0 if available, else cpu).",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=DEFAULT_IMGSZ,
        help=f"Inference image size for SAM (default: {DEFAULT_IMGSZ}).",
    )
    parser.add_argument(
        "--fallback",
        choices=("full", "threshold", "none"),
        default=DEFAULT_FALLBACK,
        help=f"Fallback mask strategy if SAM returns nothing (default: {DEFAULT_FALLBACK}).",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=DEFAULT_THRESHOLD,
        help=f"Threshold (0-255) when --fallback=threshold (default: {DEFAULT_THRESHOLD}).",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=CHUNK_SIZE,
        help=f"Save one ZIP every N images (default: {CHUNK_SIZE}).",
    )
    parser.add_argument(
        "--recursive",
        dest="recursive",
        action="store_true",
        help="Scan subdirectories (default).",
    )
    parser.add_argument(
        "--no-recursive",
        dest="recursive",
        action="store_false",
        help="Do not scan subdirectories.",
    )
    parser.set_defaults(recursive=DEFAULT_RECURSIVE)
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()

    threshold = max(0, min(255, args.threshold))
    device = args.device if args.device is not None else _default_device()
    if device.startswith("cuda") and not torch.cuda.is_available():
        print("Warning: CUDA requested but not available, using CPU.", file=sys.stderr)
        device = "cpu"

    source_dir = args.source or Path(".")
    if not source_dir.is_dir():
        raise SystemExit("Source must be a directory containing images.")

    images = collect_images_from_directory(source_dir, args.recursive)
    if not images:
        raise SystemExit(f"No supported image files found in {source_dir}")

    try:
        model = SAM(args.model)
    except Exception as exc:
        raise SystemExit(f"Failed to load SAM model '{args.model}': {exc}") from exc

    run_with_chunked_zips(
        images=images,
        output=args.output,
        model=model,
        device=device,
        imgsz=args.imgsz,
        fallback_mode=args.fallback,
        threshold=threshold,
        chunk_size=args.chunk_size,
    )

    num_parts = (len(images) + args.chunk_size - 1) // args.chunk_size
    print(
        f"Created {num_parts} ZIP(s) for {len(images)} images (base: {args.output.resolve()})"
    )


if __name__ == "__main__":
    main()
