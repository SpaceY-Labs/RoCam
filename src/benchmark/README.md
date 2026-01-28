# YOLO DeepStream Accuracy Benchmark

This directory provides tools to convert YOLO models to TensorRT engines and run accuracy benchmarks using DeepStream.

## 1. Model Conversion (`convert_tensorrt.py`)

Converts a PyTorch (`.pt`) model to a TensorRT engine using DeepStream's `nvinfer` for optimal compatibility.

### Usage

```bash
python3 convert_tensorrt.py <input_pt> <output_engine> [--rebuild]
```

- **Caching**: Engines are automatically cached in `/mnt/data/tensorrt_engine_cache` based on the MD5 hash of the `.pt` file.
- **Rebuild**: Use `--rebuild` to force a new engine generation even if a cache entry exists.

---

## 2. Accuracy Benchmark (`accuracy_benchmark.py`)

Runs a COCO-style accuracy evaluation on a dataset using a YOLO model (either `.pt` or `.engine`).

### Usage

```bash
python3 accuracy_benchmark.py --pt <model.pt> --data-yaml <data.yaml> [options]
# OR
python3 accuracy_benchmark.py --engine <model.engine> --data-yaml <data.yaml> [options]
```

### Key Features

- **Auto-Conversion**: If `--pt` is provided, it is converted to a temporary engine in `/tmp`, which is cleaned up after the run.
- **Letterboxing**: Images are automatically staged using letterbox padding to maintain aspect ratio.
- **Single Detection**: The script picks the single highest-confidence detection per image (NMS is disabled).

### Options

- `--split {val,test}`: Dataset split to evaluate (default: `val`).
- `--limit N`: Limit evaluation to the first `N` images.
- `--conf X`: Confidence threshold (default: `0.25`).
- `--rebuild`: Force rebuild of the TensorRT engine when using `--pt`.
- `--debug-vis N`: Save `N` debug images with GT (green) and Pred (red) overlays to the debug directory.

---

## 3. Quick Start Example

```bash
python3 accuracy_benchmark.py \
    --pt ./models/original.pt \
    --data-yaml /mnt/data/testdata/data_15000/data.yaml \
    --debug-vis 50
```

# Benchmark Results

| Path                 | Base Model | mAP@0.50:0.95 | mAP@0.50 | Author  | Date    | Notes        |
| -------------------- | ---------- | ------------- | -------- | ------- | ------- | ------------ |
| https://drive.google.com/file/d/1AW7gZ-v0RBsLZtk08OuHOnq00pPTb0nF/view?usp=drive_link | 11s        | 0.507540      | 0.796407 | Unknown | Unknown | 0.95 model |
| ./models/original.pt | 11s        | 0.501598      | 0.796249 | Unknown | Unknown | Oldest model |
