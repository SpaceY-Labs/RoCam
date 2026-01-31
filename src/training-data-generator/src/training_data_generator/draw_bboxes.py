"""Draw YOLO-style bounding boxes on images under a directory."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def parse_yolo_line(line: str) -> tuple[int, float, float, float, float] | None:
    """Parse one YOLO line: class_id center_x center_y width height (normalized 0-1)."""
    parts = line.strip().split()
    if len(parts) != 5:
        return None
    try:
        class_id = int(parts[0])
        cx, cy, w, h = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
        return (class_id, cx, cy, w, h)
    except (ValueError, IndexError):
        return None


def yolo_to_pixels(cx: float, cy: float, w: float, h: float, img_width: int, img_height: int) -> tuple[int, int, int, int]:
    """Convert YOLO normalized box to pixel (left, top, right, bottom)."""
    left = (cx - w / 2) * img_width
    right = (cx + w / 2) * img_width
    top = (cy - h / 2) * img_height
    bottom = (cy + h / 2) * img_height
    return (int(left), int(top), int(right), int(bottom))


def draw_bboxes_on_image(
    image_path: Path,
    label_path: Path,
    out_path: Path,
    color: str = "lime",
    width: int = 2,
) -> bool:
    """Load image, draw boxes from YOLO label file, save to out_path. Returns True if drawn."""
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    w, h = img.size

    if not label_path.exists():
        img.save(out_path)
        return False

    drawn = False
    with open(label_path) as f:
        for line in f:
            parsed = parse_yolo_line(line)
            if parsed is None:
                continue
            _class_id, cx, cy, bw, bh = parsed
            left, top, right, bottom = yolo_to_pixels(cx, cy, bw, bh, w, h)
            draw.rectangle([left, top, right, bottom], outline=color, width=width)
            drawn = True

    img.save(out_path)
    return drawn


def main() -> None:
    parser = argparse.ArgumentParser(description="Draw YOLO bounding boxes on images.")
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("./out"),
        help="Directory containing images and .txt labels (default: ./out)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for output images (default: input_dir + '_bbox')",
    )
    parser.add_argument(
        "--color",
        default="lime",
        help="Outline color name or hex (default: lime)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=2,
        help="Line width in pixels (default: 2)",
    )
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    output_dir = (args.output_dir or input_dir.parent / f"{input_dir.name}_bbox").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    extensions = {".png", ".jpg", ".jpeg"}
    count = 0
    for path in sorted(input_dir.iterdir()):
        if path.suffix.lower() not in extensions:
            continue
        stem = path.stem
        label_path = input_dir / f"{stem}.txt"
        out_path = output_dir / path.name
        draw_bboxes_on_image(path, label_path, out_path, color=args.color, width=args.width)
        count += 1
        print(f"  {path.name} -> {out_path}")

    print(f"Done: {count} images written to {output_dir}")
