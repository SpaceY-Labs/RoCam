from pathlib import Path

ENGINE_FILE_NAME = "model_b1_gpu0_fp16.engine"

def generate_pgie_config(config_output_path: str, onnx_path: str = None, engine_path: str = None):
    """
    Generates a pgie_config.txt file for DeepStream nvinfer.
    Hardcodes standard YOLO benchmark parameters but allows specifying the ONNX input.
    Warning: If pgie can't find a valid engine file under the specified engine path, it 
    will always create the generated engine file at {ENGINE_FILE_NAME} under cwd instead,
    even if you specify a different engine path.

    If onnx_path is specified, and engine_path is not, pgie will generate the engine file at {ENGINE_FILE_NAME} under cwd.
    If engine_path is specified, and onnx_path is not, pgie will use the specified engine file.
    If both onnx_path and engine_path are specified, pgie will use the specified engine file.
    """

    custom_lib_path = Path(__file__).parent / "libnvdsinfer_custom_impl_Yolo.so"
    onnx_file_field = f"onnx-file={onnx_path}\n" if onnx_path else ""
    engine_file_field = f"model-engine-file={engine_path}\n" if engine_path else ""

    content = (
        f"[property]\n"
        f"gpu-id=0\n"
        # required to avoid VIC random crash
        f"scaling-compute-hw=1\n"
        f"net-scale-factor=0.0039215697906911373\n"
        f"model-color-format=0\n"
        f"{onnx_file_field}"
        f"{engine_file_field}"
        f"batch-size=1\n"
        f"network-mode=2\n"
        f"num-detected-classes=1\n"
        f"interval=0\n"
        f"gie-unique-id=1\n"
        f"process-mode=1\n"
        f"network-type=0\n"
        f"cluster-mode=4\n"
        f"maintain-aspect-ratio=1\n"
        f"symmetric-padding=1\n"
        f"parse-bbox-func-name=NvDsInferParseYolo\n"
        f"custom-lib-path={custom_lib_path}\n"
        f"engine-create-func-name=NvDsInferYoloCudaEngineGet\n"
        f"\n"
        f"[class-attrs-all]\n"
        f"nms-iou-threshold=0.45\n"
        f"pre-cluster-threshold=0.25\n"
        f"topk=300\n"
    )

    with open(config_output_path, "w") as f:
        f.write(content)
    return config_output_path
