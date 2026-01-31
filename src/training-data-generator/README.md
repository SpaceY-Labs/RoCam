# Synthetic HDRI Training Data Generator

This tool generates synthetic training data for computer vision by rendering a gray cube in a 3D environment with random HDRI backgrounds using Blender.

## Prerequisites

1. **Blender 5.0.1** (or compatible) installed via Flatpak:
   ```bash
   flatpak install flathub org.blender.Blender
   ```
2. **uv** package manager.

## Installation

Sync the project environment:

```bash
uv sync
```

## Usage

Run the generator using `uv run`. The tool will automatically look for HDRIs in `assets/hdri` and output to `./out` by default.

```bash
# Generate 10 images (default)
uv run generate-data

# Generate 100 images to a specific directory
uv run generate-data --count 100 --out-dir ./my-dataset

# Specify a custom HDRI directory
uv run generate-data --hdri-dir /path/to/hdris

# Adjust quality (samples) and random seed
uv run generate-data --count 50 --samples 128 --seed 42
```

### Draw bounding boxes on generated images

To visualize YOLO-style labels, draw bounding boxes on the output images:

```bash
# Default: read ./out, write ./out_bbox
uv run draw-bboxes

# Custom directories
uv run draw-bboxes --input-dir ./out --output-dir ./my_bbox

# Custom line color and width
uv run draw-bboxes --color red --width 3
```

- `--input-dir DIR`: Directory containing images and matching `.txt` labels (default: `./out`).
- `--output-dir DIR`: Where to save images with boxes (default: `{input_dir}_bbox`).
- `--color COLOR`: Outline color name or hex (default: `lime`).
- `--width N`: Line width in pixels (default: 2).

### Options (generate-data)

- `--count N`: Number of images to generate (default: 10).
- `--out-dir DIR`: Output directory for generated images (default: `./out`).
- `--hdri-dir DIR`: Directory containing `.hdr` or `.exr` background images (default: `./assets/hdri`).
- `--samples N`: Render samples per pixel. Higher means less noise but slower (default: 32).
- `--seed N`: Random seed for reproducibility.
- `--blender-app-id ID`: Flatpak App ID for Blender (default: `org.blender.Blender`).

## Troubleshooting

### Flatpak Filesystem Permission
The tool runs Blender via Flatpak with `--filesystem=host` to ensure it can read the python script and write to the output directory. If you encounter permission errors, ensure the output directory and HDRI directory are accessible to the user running the command.

### GPU Acceleration
The script attempts to enable CUDA/OptiX/HIP if available in Blender's Cycles settings. If not available, it falls back to CPU rendering. Check your Blender preferences (GUI) to ensure compute devices are configured if you want faster renders.
