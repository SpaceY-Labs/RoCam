"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Pytest conftest providing stub modules for NVIDIA/Jetson hardware dependencies.
"""
"""
Stubs for hardware / NVIDIA dependencies that are unavailable outside Jetson.
Must be imported before any benchmark module is loaded.
"""
import sys
import types


def _make_stub_module(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod


# Stub gi / GLib / Gst
gi_mod = _make_stub_module("gi")
gi_mod.require_version = lambda *a, **kw: None  # type: ignore[attr-defined]
sys.modules.setdefault("gi", gi_mod)

gi_repo_mod = _make_stub_module("gi.repository")
sys.modules.setdefault("gi.repository", gi_repo_mod)

gst_mod = _make_stub_module("gi.repository.Gst")
sys.modules.setdefault("gi.repository.Gst", gst_mod)

glib_mod = _make_stub_module("gi.repository.GLib")
sys.modules.setdefault("gi.repository.GLib", glib_mod)

# Stub pyds
pyds_mod = _make_stub_module("pyds")
sys.modules.setdefault("pyds", pyds_mod)

# Stub torch / ultralytics (not available on dev machines)
torch_mod = _make_stub_module("torch")
sys.modules.setdefault("torch", torch_mod)

ultralytics_mod = _make_stub_module("ultralytics")
sys.modules.setdefault("ultralytics", ultralytics_mod)

# Stub convert_tensorrt so accuracy_benchmark can be imported
ct_mod = _make_stub_module("convert_tensorrt", pt_to_engine=lambda *a, **kw: None)
sys.modules.setdefault("convert_tensorrt", ct_mod)

# Stub pycocotools
coco_mod = _make_stub_module("pycocotools")
sys.modules.setdefault("pycocotools", coco_mod)

coco_coco_mod = _make_stub_module("pycocotools.coco", COCO=object)
sys.modules.setdefault("pycocotools.coco", coco_coco_mod)

coco_eval_mod = _make_stub_module("pycocotools.cocoeval", COCOeval=object)
sys.modules.setdefault("pycocotools.cocoeval", coco_eval_mod)
