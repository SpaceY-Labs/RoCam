import base64
import json
import os
import urllib.request

import cv2
import numpy as np
import torch
from ts.torch_handler.base_handler import BaseHandler


class Sam3Handler(BaseHandler):
    def __init__(self):
        super().__init__()
        self.model = None
        self.device = None
        self.model_type = None
        self.predictor = None
        self.mask_generator = None

    def initialize(self, context):
        properties = context.system_properties
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        model_dir = properties.get("model_dir")
        manifest = context.manifest
        serialized_file = manifest["model"].get("serializedFile")
        model_path = os.path.join(model_dir, serialized_file)

        if os.environ.get("SAM3_SKIP_MODEL_LOAD") == "1":
            self.model_type = "skip"
            self.initialized = True
            return

        self._load_model(model_path)
        self.initialized = True

    def _load_model(self, model_path):
        handler_mode = os.environ.get("SAM3_HANDLER_MODE", "auto").lower()
        if handler_mode in ("segment_anything", "auto"):
            try:
                from segment_anything import SamAutomaticMaskGenerator, SamPredictor, sam_model_registry

                model_type = os.environ.get("SAM3_MODEL_TYPE", "vit_h")
                sam = sam_model_registry[model_type](checkpoint=model_path)
                sam.to(device=self.device)
                self.predictor = SamPredictor(sam)
                self.mask_generator = SamAutomaticMaskGenerator(sam)
                self.model_type = "segment_anything"
                return
            except Exception:
                if handler_mode == "segment_anything":
                    raise

        try:
            self.model = torch.jit.load(model_path, map_location=self.device)
            self.model.eval()
            self.model_type = "torchscript"
            return
        except Exception as error:
            raise RuntimeError("Failed to load SAM3 model") from error

    def preprocess(self, data):
        if not data:
            return []

        results = []
        for record in data:
            payload = record.get("data") or record.get("body")
            if isinstance(payload, (bytes, bytearray)):
                payload = payload.decode("utf-8")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                raise ValueError("Request payload must be JSON")

            image = self._load_image(payload)
            results.append({
                "image": image,
                "mode": payload.get("mode", "click"),
                "points": payload.get("points"),
                "box": payload.get("box"),
                "prompt": payload.get("prompt"),
            })
        return results

    def inference(self, data, *args, **kwargs):
        outputs = []
        for item in data:
            image = item["image"]
            mode = item["mode"]
            points = item.get("points") or []
            box = item.get("box")
            prompt = item.get("prompt")
            outputs.append(self._predict(image, mode, points, box, prompt))
        return outputs

    def postprocess(self, inference_output):
        return inference_output

    def _load_image(self, payload):
        image_base64 = payload.get("image") or payload.get("imageBase64")
        image_url = payload.get("imageUrl") or payload.get("image_url")

        if image_base64:
            return self._decode_base64_image(image_base64)
        if image_url:
            return self._download_image(image_url)

        raise ValueError("image or imageUrl is required")

    def _decode_base64_image(self, image_base64):
        if image_base64.startswith("data:"):
            image_base64 = image_base64.split(",", 1)[-1]
        raw = base64.b64decode(image_base64)
        array = np.frombuffer(raw, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Unable to decode base64 image")
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    def _download_image(self, image_url):
        with urllib.request.urlopen(image_url) as response:
            data = response.read()
        array = np.frombuffer(data, dtype=np.uint8)
        image = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Unable to decode image from URL")
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    def _predict(self, image, mode, points, box, prompt):
        if self.model_type == "segment_anything":
            return self._predict_segment_anything(image, mode, points, box, prompt)
        if self.model_type == "torchscript":
            return self._predict_torchscript(image, mode, points, box, prompt)
        raise RuntimeError("Model not initialized")

    def _predict_segment_anything(self, image, mode, points, box, prompt):
        if mode == "auto" or mode == "semantic":
            return self._auto_masks(image)

        if mode != "click":
            raise ValueError(f"Unsupported mode: {mode}")

        self.predictor.set_image(image)
        point_coords = None
        point_labels = None
        if points:
            point_coords = np.array([[p["x"], p["y"]] for p in points], dtype=np.float32)
            point_labels = np.array([p.get("label", 1) for p in points], dtype=np.int32)

        box_array = None
        if box:
            box_array = np.array([box["x1"], box["y1"], box["x2"], box["y2"]], dtype=np.float32)

        masks, scores, _ = self.predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box_array,
            multimask_output=True,
        )

        return self._format_masks(masks, scores)

    def _auto_masks(self, image):
        results = self.mask_generator.generate(image)
        masks = []
        scores = []
        for item in results:
            masks.append(item["segmentation"])
            scores.append(float(item.get("predicted_iou", 1.0)))
        return self._format_masks(np.array(masks), np.array(scores))

    def _predict_torchscript(self, image, mode, points, box, prompt):
        if self.model is None:
            raise RuntimeError("Model not loaded")

        image_tensor = torch.from_numpy(image).permute(2, 0, 1).unsqueeze(0).float()
        image_tensor = image_tensor.to(self.device)

        point_tensor = None
        label_tensor = None
        if points:
            coords = [[p["x"], p["y"]] for p in points]
            labels = [p.get("label", 1) for p in points]
            point_tensor = torch.tensor(coords, dtype=torch.float32, device=self.device)
            label_tensor = torch.tensor(labels, dtype=torch.int64, device=self.device)

        box_tensor = None
        if box:
            box_tensor = torch.tensor(
                [box["x1"], box["y1"], box["x2"], box["y2"]],
                dtype=torch.float32,
                device=self.device,
            )

        with torch.no_grad():
            if hasattr(self.model, "predict"):
                output = self.model.predict(
                    image_tensor,
                    point_tensor,
                    label_tensor,
                    box_tensor,
                    prompt,
                    mode,
                )
            else:
                output = self.model(image_tensor, point_tensor, label_tensor, box_tensor, prompt, mode)

        masks, scores = self._unpack_output(output)
        return self._format_masks(masks, scores)

    def _unpack_output(self, output):
        if isinstance(output, dict):
            masks = output.get("masks")
            scores = output.get("scores")
        elif isinstance(output, (list, tuple)) and len(output) >= 2:
            masks, scores = output[0], output[1]
        else:
            raise RuntimeError("Unexpected model output format")

        masks = self._to_numpy(masks)
        scores = self._to_numpy(scores)
        return masks, scores

    def _to_numpy(self, value):
        if value is None:
            return np.array([])
        if isinstance(value, np.ndarray):
            return value
        if torch.is_tensor(value):
            return value.detach().cpu().numpy()
        return np.array(value)

    def _format_masks(self, masks, scores):
        if masks is None or len(masks) == 0:
            return {"masks": []}

        formatted = []
        for index, mask in enumerate(masks):
            score = float(scores[index]) if scores is not None and len(scores) > index else 1.0
            formatted.append(self._build_mask_response(mask, score))

        return {"masks": formatted}

    def _build_mask_response(self, mask, score):
        mask_uint8 = (mask > 0).astype(np.uint8)
        polygons = self._mask_to_polygons(mask_uint8)
        x, y, w, h = cv2.boundingRect(mask_uint8)
        area = int(mask_uint8.sum())

        return {
            "polygon": polygons,
            "boundingBox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
            "area": area,
            "score": float(score),
        }

    def _mask_to_polygons(self, mask):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        polygons = []
        for contour in contours:
            if len(contour) < 3:
                continue
            ring = []
            for point in contour:
                x, y = point[0]
                ring.append({"x": float(x), "y": float(y)})
            polygons.append(ring)

        if not polygons:
            polygons = [[]]
        return polygons


def handle(data, context):
    handler = Sam3Handler()
    handler.initialize(context)
    return handler.handle(data, context)
