"""
upload_masks.py

Single end-to-end pipeline:
  1) Load images from a source directory.
  2) Run SAM segmentation on GPU/CPU.
  3) Build each chunk ZIP in memory (no local ZIP files are written).
  4) Upload each chunk to the labelling backend.

By default, one project is created per chunk with names:
  project_1, project_2, ...

Each chunk defaults to 100 images.
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, List, Tuple
from zipfile import ZIP_DEFLATED, ZipFile

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit("numpy is required. Install with: pip install numpy") from exc

try:
    from PIL import Image, UnidentifiedImageError
except ImportError as exc:
    raise SystemExit("pillow is required. Install with: pip install pillow") from exc

try:
    import requests
except ImportError as exc:
    raise SystemExit("requests is required. Install with: pip install requests") from exc

try:
    import torch
except ImportError as exc:
    raise SystemExit("torch is required. Install with: pip install torch") from exc

try:
    from ultralytics import SAM
except ImportError as exc:
    raise SystemExit("ultralytics is required. Install with: pip install ultralytics") from exc


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

BACKEND_URL = "https://labeler-backend-12671474910.us-central1.run.app"
FIREBASE_API_KEY = "AIzaSyDzBJISefaV93iGUM9v1A_LjR-YxAFJaaw"
FIREBASE_ANON_SIGNIN_URL = (
    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}"
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

DEFAULT_MODEL = r"C:\Personal-Project\vision-guided-tracker\src\cv\weights\sam_b.pt"
DEFAULT_IMGSZ = 1024
DEFAULT_FALLBACK = "full"
DEFAULT_THRESHOLD = 128
DEFAULT_RECURSIVE = True
DEFAULT_STATUS = "unlabeled"
DEFAULT_CHUNK_SIZE = 100
HEALTH_TIMEOUT_S = 15
UPLOAD_TIMEOUT_S = 300

DEFAULT_LABELS = {
    "lbl_001": {"labelId": "lbl_001", "name": "Object", "color": "#00FF00"},
}


class AuthExpiredError(RuntimeError):
    """Raised when backend auth token is rejected (401/403)."""


@dataclass(frozen=True)
class ImageCandidate:
    relative: PurePosixPath
    data: bytes


# ---------------------------------------------------------------------------
# Auth / backend helpers
# ---------------------------------------------------------------------------

def api_base(backend_url: str) -> str:
    url = backend_url.rstrip("/")
    return url if url.endswith("/api") else f"{url}/api"


def check_health(backend_url: str) -> None:
    health_url = f"{backend_url.rstrip('/')}/health"
    print(f"[health] Checking {health_url} ...", flush=True)
    try:
        resp = requests.get(health_url, timeout=HEALTH_TIMEOUT_S)
    except requests.exceptions.RequestException as exc:
        raise SystemExit(f"[health] Failed: {exc}") from exc

    if not resp.ok:
        raise SystemExit(
            f"[health] Backend returned HTTP {resp.status_code}: {resp.text[:200]}"
        )
    print(f"[health] OK (HTTP {resp.status_code})", flush=True)


def get_anonymous_id_token(firebase_api_key: str) -> str:
    url = FIREBASE_ANON_SIGNIN_URL.format(api_key=firebase_api_key)
    print("[auth] Signing in anonymously with Firebase ...", flush=True)
    try:
        resp = requests.post(url, json={"returnSecureToken": True}, timeout=15)
    except requests.exceptions.RequestException as exc:
        raise SystemExit(f"[auth] Firebase sign-in request failed: {exc}") from exc

    if not resp.ok:
        raise SystemExit(
            f"[auth] Firebase sign-in failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )

    token = resp.json().get("idToken")
    if not token:
        raise SystemExit("[auth] Firebase response did not contain idToken.")
    print("[auth] Anonymous sign-in OK.", flush=True)
    return token


def create_project(
    backend_url: str,
    auth_token: str,
    name: str,
    labels: dict,
    description: str | None = None,
) -> str:
    url = f"{api_base(backend_url)}/projects"
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json",
    }
    payload: dict = {"name": name, "labels": labels}
    if description is not None:
        payload["description"] = description

    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code in (401, 403):
        raise AuthExpiredError(
            f"Create project auth rejected (HTTP {resp.status_code}): {resp.text[:300]}"
        )
    if not resp.ok:
        raise RuntimeError(
            f"Create project failed (HTTP {resp.status_code}): {resp.text[:500]}"
        )
    project_id = resp.json().get("projectId")
    if not project_id:
        raise RuntimeError("Create project succeeded but projectId is missing.")
    return project_id


def upload_zip_bytes(
    zip_name: str,
    zip_bytes: bytes,
    project_id: str,
    auth_token: str,
    backend_url: str,
    status: str,
    tags: list[str],
) -> dict:
    url = f"{api_base(backend_url)}/projects/{project_id}/images/zip"
    meta = json.dumps({"status": status, "tags": tags})
    headers = {"Authorization": f"Bearer {auth_token}"}

    files = {"zipData": (zip_name, io.BytesIO(zip_bytes), "application/zip")}
    data = {"meta": meta}
    resp = requests.post(
        url,
        headers=headers,
        files=files,
        data=data,
        timeout=UPLOAD_TIMEOUT_S,
    )
    if resp.status_code in (401, 403):
        raise AuthExpiredError(
            f"Upload auth rejected (HTTP {resp.status_code}): {resp.text[:300]}"
        )
    if not resp.ok:
        raise RuntimeError(
            f"Upload failed (HTTP {resp.status_code}): {resp.text[:500]}"
        )
    return resp.json()


# ---------------------------------------------------------------------------
# Masking helpers
# ---------------------------------------------------------------------------

def _default_device() -> str:
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _is_image_file(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTENSIONS


def collect_images_from_directory(root: Path, recursive: bool) -> List[ImageCandidate]:
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
            masks.append((np.ones((height, width), dtype=np.uint8), width, height))
        elif fallback_mode == "threshold":
            grayscale = np.asarray(Image.fromarray(rgb).convert("L"), dtype=np.uint8)
            masks.append(((grayscale > threshold).astype(np.uint8), width, height))
        else:
            raise ValueError("SAM returned no masks and fallback mode is 'none'.")

    return masks


def build_zip_bytes_for_chunk(
    images: List[ImageCandidate],
    model: SAM,
    device: str,
    imgsz: int,
    fallback_mode: str,
    threshold: int,
) -> tuple[bytes, int]:
    if not images:
        return b"", 0

    total_masks = 0
    mem = io.BytesIO()
    with ZipFile(mem, "w", ZIP_DEFLATED) as zout:
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
                mask_entry = PurePosixPath("masks") / parent / f"{base_name}_{idx:02d}.bin"
                zout.writestr(mask_entry.as_posix(), encode_mask(mask_array, width, height))
                total_masks += 1

    return mem.getvalue(), total_masks


# ---------------------------------------------------------------------------
# CLI and pipeline
# ---------------------------------------------------------------------------

def _load_labels(args: argparse.Namespace) -> dict:
    if args.labels_file is not None:
        path = args.labels_file.resolve()
        if not path.is_file():
            raise SystemExit(f"Labels file not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not data:
            raise SystemExit("Labels file must be a non-empty JSON object.")
        return data

    if args.labels is not None:
        data = json.loads(args.labels)
        if not isinstance(data, dict) or not data:
            raise SystemExit("--labels must be a non-empty JSON object.")
        return data

    return DEFAULT_LABELS.copy()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run SAM masking and upload directly to backend without saving local ZIP files."
        ),
    )
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=None,
        help="Directory containing source images (default: current directory).",
    )
    parser.add_argument("--source", dest="source", type=Path, help="Source image directory.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Path or name of SAM model weights.")
    parser.add_argument("--device", default=None, help="Inference device (default: cuda:0 if available else cpu).")
    parser.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ, help=f"SAM inference image size (default: {DEFAULT_IMGSZ}).")
    parser.add_argument("--fallback", choices=("full", "threshold", "none"), default=DEFAULT_FALLBACK, help=f"Fallback mask strategy when SAM returns no masks (default: {DEFAULT_FALLBACK}).")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD, help=f"Threshold for --fallback=threshold (default: {DEFAULT_THRESHOLD}).")
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help=f"Images per upload set (default: {DEFAULT_CHUNK_SIZE}).")
    parser.add_argument("--recursive", dest="recursive", action="store_true", help="Scan subdirectories (default).")
    parser.add_argument("--no-recursive", dest="recursive", action="store_false", help="Do not scan subdirectories.")
    parser.set_defaults(recursive=DEFAULT_RECURSIVE)

    parser.add_argument("--backend-url", default=BACKEND_URL, help=f"Labelling backend base URL (default: {BACKEND_URL}).")
    parser.add_argument("--auth-token", default=None, help="Firebase ID token override (optional).")
    parser.add_argument("--skip-health-check", action="store_true", help="Skip GET /health check.")
    parser.add_argument("--status", default=DEFAULT_STATUS, choices=("unlabeled", "in_progress", "done"), help=f"Image status metadata for upload (default: {DEFAULT_STATUS}).")
    parser.add_argument("--tags", nargs="*", default=[], help="Optional tags added during upload.")

    # Project routing
    parser.add_argument(
        "--create-projects",
        dest="create_projects",
        action="store_true",
        default=True,
        help="Create one new project per chunk (default behavior).",
    )
    parser.add_argument(
        "--single-project",
        dest="create_projects",
        action="store_false",
        help="Upload all chunks to one existing project (--project-id required).",
    )
    parser.add_argument("--project-id", default=None, help="Existing project ID for --single-project mode.")
    parser.add_argument("--project-name-prefix", default="project", help="Prefix for created project names (default: project).")
    parser.add_argument("--start-index", type=int, default=1, help="Starting index for project names (default: 1).")
    parser.add_argument("--labels", default=None, help="JSON object of labels for created projects.")
    parser.add_argument("--labels-file", type=Path, default=None, help="Path to JSON labels file.")

    parser.add_argument("--dry-run", action="store_true", help="Print plan only. Do not call backend.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if not args.create_projects and not args.project_id:
        raise SystemExit("--project-id is required when using --single-project.")
    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size must be > 0.")

    source_dir = args.source or Path(".")
    if not source_dir.is_dir():
        raise SystemExit(f"Source must be a directory: {source_dir}")

    threshold = max(0, min(255, args.threshold))
    device = args.device if args.device is not None else _default_device()
    if device.startswith("cuda") and not torch.cuda.is_available():
        print("Warning: CUDA requested but unavailable, using CPU.", file=sys.stderr)
        device = "cpu"

    backend_url = args.backend_url.rstrip("/")
    print(f"Source   : {source_dir.resolve()}")
    print(f"Backend  : {backend_url}")
    print(f"Device   : {device}")
    print(f"Chunk    : {args.chunk_size} images/set")
    print(f"Mode     : {'create project per chunk' if args.create_projects else 'single existing project'}")
    if args.create_projects:
        print(f"Prefix   : {args.project_name_prefix}_{args.start_index}...")
    else:
        print(f"Project  : {args.project_id}")
    print()

    images = collect_images_from_directory(source_dir, args.recursive)
    if not images:
        raise SystemExit(f"No supported images found in {source_dir}")
    total_images = len(images)
    num_chunks = (total_images + args.chunk_size - 1) // args.chunk_size
    print(f"Found {total_images} image(s) -> {num_chunks} upload chunk(s)")

    if args.dry_run:
        print("Dry-run mode. No backend calls and no uploads were made.")
        return

    if not args.skip_health_check:
        check_health(backend_url)
        print()

    auth_token = args.auth_token or get_anonymous_id_token(FIREBASE_API_KEY)
    labels = _load_labels(args) if args.create_projects else None

    try:
        model = SAM(args.model)
    except Exception as exc:
        raise SystemExit(f"Failed to load SAM model '{args.model}': {exc}") from exc

    success = 0
    failed = 0

    for chunk_idx in range(num_chunks):
        start = chunk_idx * args.chunk_size
        end = min(start + args.chunk_size, total_images)
        chunk_images = images[start:end]
        part_name = f"masked_images_part{chunk_idx + 1:03d}.zip"

        project_id = None if args.create_projects else args.project_id
        project_name = None
        if args.create_projects:
            project_name = f"{args.project_name_prefix}_{args.start_index + chunk_idx}"

        print(
            f"[{chunk_idx + 1}/{num_chunks}] {part_name} ({len(chunk_images)} images, "
            f"{start + 1}-{end} of {total_images})"
        )

        t0 = time.monotonic()
        try:
            zip_bytes, masks_count = build_zip_bytes_for_chunk(
                images=chunk_images,
                model=model,
                device=device,
                imgsz=args.imgsz,
                fallback_mode=args.fallback,
                threshold=threshold,
            )

            result = None
            for attempt in range(2):
                try:
                    if args.create_projects and project_id is None:
                        project_id = create_project(
                            backend_url=backend_url,
                            auth_token=auth_token,
                            name=project_name or f"{args.project_name_prefix}_{chunk_idx + 1}",
                            labels=labels or DEFAULT_LABELS,
                            description=None,
                        )
                        print(f"  -> created project {project_name} (id={project_id})")

                    result = upload_zip_bytes(
                        zip_name=part_name,
                        zip_bytes=zip_bytes,
                        project_id=project_id or "",
                        auth_token=auth_token,
                        backend_url=backend_url,
                        status=args.status,
                        tags=args.tags,
                    )
                    break
                except AuthExpiredError as exc:
                    if attempt == 0:
                        print(f"  -> auth expired: {exc}")
                        print("  -> re-authenticating and retrying once ...")
                        auth_token = get_anonymous_id_token(FIREBASE_API_KEY)
                        continue
                    raise

            if result is None:
                raise RuntimeError("Upload did not produce a response.")
            elapsed = time.monotonic() - t0
            uploaded_images = result.get("count", "?")
            print(
                f"  -> uploaded: {uploaded_images} image(s), {masks_count} mask(s) "
                f"in {elapsed:.1f}s"
            )
            success += 1
        except Exception as exc:  # noqa: BLE001
            elapsed = time.monotonic() - t0
            print(f"  -> FAILED in {elapsed:.1f}s: {exc}", file=sys.stderr)
            failed += 1

    print()
    print(f"Pipeline complete. Successful chunks: {success}/{num_chunks}")
    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
