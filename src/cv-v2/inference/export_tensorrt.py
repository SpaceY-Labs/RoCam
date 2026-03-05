"""
TensorRT Export for Jetson Orin Nano Deployment.

Exports the SiamMask-Lite model as two separate TensorRT engines:
1. Template encoder: runs once when target is selected
2. Tracking engine: runs every frame (search encoder + correlation + decoder)

The split is critical for 60fps — the template encoder is heavy but runs once,
while the per-frame engine is optimized to be as light as possible.

Export pipeline:
    PyTorch -> ONNX -> TensorRT (FP16)

On Jetson Orin Nano with FP16:
    Template encoder: ~5ms (one-time)
    Per-frame engine:  ~8-12ms (targeting <16ms for 60fps)

Usage:
    python -m siammask.inference.export_tensorrt \
        --checkpoint checkpoints/best.pth \
        --output-dir engines/ \
        --fp16
"""

import argparse
from pathlib import Path
from typing import Tuple

import torch
import torch.nn as nn

import sys


from models.siammask_lite import SiamMaskLite, build_model
from models.backbone import LiteBackbone


# ──────────── Wrapper modules for clean ONNX export ────────────


class TemplateEncoder(nn.Module):
    """
    Wraps just the backbone for template encoding.
    Input:  template image (1, 3, 127, 127)
    Output: (p2, p3, p4) feature maps
    """

    def __init__(self, model: SiamMaskLite):
        super().__init__()
        self.backbone = model.backbone

    def forward(self, template: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        return self.backbone(template)


class TrackingEngine(nn.Module):
    """
    Wraps search encoding + correlation + decoder for per-frame inference.
    Inputs: search image (1, 3, 255, 255) + template features (p2, p3, p4)
    Output: mask (1, 1, 255, 255), bbox (1, 4), score (1, 1)
    """

    def __init__(self, model: SiamMaskLite):
        super().__init__()
        self.backbone = model.backbone
        self.correlation = model.correlation
        self.decoder = model.decoder

    def forward(
        self,
        search: torch.Tensor,
        template_p2: torch.Tensor,
        template_p3: torch.Tensor,
        template_p4: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        search_feats = self.backbone(search)
        template_feats = (template_p2, template_p3, template_p4)
        corr_maps = self.correlation(template_feats, search_feats)
        mask, bbox, score = self.decoder(corr_maps, search_feats, 255)
        return mask, bbox, score


def export_onnx(
    model: nn.Module,
    dummy_inputs: tuple,
    input_names: list,
    output_names: list,
    output_path: str,
    dynamic_axes: dict = None,
):
    """Export PyTorch model to ONNX."""
    print(f"Exporting to ONNX: {output_path}")

    torch.onnx.export(
        model,
        dummy_inputs,
        output_path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=17,
        do_constant_folding=True,
    )
    print(f"  ONNX saved: {output_path}")

    # Verify
    import onnx
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)
    print(f"  ONNX verification passed")


def build_tensorrt_engine(onnx_path: str, engine_path: str, fp16: bool = True):
    """
    Build TensorRT engine from ONNX model.
    Requires tensorrt Python package (available on Jetson).
    """
    try:
        import tensorrt as trt
    except ImportError:
        print("TensorRT not available. Install on Jetson with:")
        print("  sudo apt-get install python3-libnvinfer-dev")
        print(f"  Skipping TRT build. ONNX file available at: {onnx_path}")
        return False

    TRT_LOGGER = trt.Logger(trt.Logger.WARNING)

    builder = trt.Builder(TRT_LOGGER)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, TRT_LOGGER)

    with open(onnx_path, "rb") as f:
        if not parser.parse(f.read()):
            for i in range(parser.num_errors):
                print(f"  ONNX parse error: {parser.get_error(i)}")
            return False

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 1 << 30)  # 1GB

    if fp16:
        if builder.platform_has_fast_fp16:
            config.set_flag(trt.BuilderFlag.FP16)
            print("  FP16 enabled")
        else:
            print("  FP16 not supported on this platform, using FP32")

    print(f"  Building TensorRT engine (this may take several minutes on Jetson)...")
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        print("  TensorRT build failed!")
        return False

    with open(engine_path, "wb") as f:
        f.write(serialized)

    print(f"  TensorRT engine saved: {engine_path}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Export SiamMask-Lite to TensorRT")
    parser.add_argument("--checkpoint", required=True, help="Path to trained .pth file")
    parser.add_argument("--output-dir", default="engines", help="Output directory")
    parser.add_argument("--fp16", action="store_true", help="Enable FP16 (recommended for Jetson)")
    parser.add_argument("--onnx-only", action="store_true", help="Only export ONNX, skip TRT build")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load trained model
    model = build_model(args.checkpoint)
    model.eval()
    model.cpu()

    # ── Export Template Encoder ──
    template_encoder = TemplateEncoder(model)
    template_encoder.eval()

    dummy_template = torch.randn(1, 3, 127, 127)
    export_onnx(
        template_encoder,
        (dummy_template,),
        input_names=["template"],
        output_names=["template_p2", "template_p3", "template_p4"],
        output_path=str(out_dir / "template_encoder.onnx"),
    )

    # ── Export Tracking Engine ──
    tracking_engine = TrackingEngine(model)
    tracking_engine.eval()

    # Get template feature shapes for dummy inputs
    with torch.no_grad():
        tp2, tp3, tp4 = template_encoder(dummy_template)

    dummy_search = torch.randn(1, 3, 255, 255)
    export_onnx(
        tracking_engine,
        (dummy_search, tp2, tp3, tp4),
        input_names=["search", "template_p2", "template_p3", "template_p4"],
        output_names=["mask", "bbox", "score"],
        output_path=str(out_dir / "tracking_engine.onnx"),
    )

    # ── Build TensorRT engines ──
    if not args.onnx_only:
        print("\n=== Building TensorRT Engines ===")
        build_tensorrt_engine(
            str(out_dir / "template_encoder.onnx"),
            str(out_dir / "template_encoder.engine"),
            fp16=args.fp16,
        )
        build_tensorrt_engine(
            str(out_dir / "tracking_engine.onnx"),
            str(out_dir / "tracking_engine.engine"),
            fp16=args.fp16,
        )

    print("\n=== Export Complete ===")
    print(f"Files saved to: {out_dir}")
    print(f"\nDeployment on Jetson Orin Nano:")
    print(f"  1. Copy engines/ to Jetson")
    print(f"  2. Use TensorRT runtime (see inference/trt_tracker.py)")
    print(f"  3. Integrate with GStreamer pipeline via appsink/appsrc")


if __name__ == "__main__":
    main()
