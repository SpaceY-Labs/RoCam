# Synthetic HDRI Training Data Generator

A pure-Python renderer (CPU ray tracer) that generates synthetic training data for computer vision. It renders a gray cube lit by random HDRI environment maps.

## Usage

This project is managed with [uv](https://github.com/astral-sh/uv).

To generate data:

```bash
uv run generate-data --count 500 --out ./out
```

### Options

- `--count`: Number of images to generate (default: 10)
- `--out`: Output directory (default: out)
- `--width`, `--height`: Resolution (default: 1280x720)
- `--assets`: Directory containing .hdr files (default: assets/hdri)
- `--quality`: Render quality [fast, balanced, high] (default: fast)
- `--seed`: Random seed
- `--no-metadata`: Disable JSON metadata output

## Output

The output directory will contain:
- `000000.jpg`: Rendered image
- `000000.json`: Metadata (camera pose, HDRI used, etc.)
