"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Shared pytest fixtures and configuration for RoCam backend unit tests.
"""
import sys
import os
import types
import pytest

# ---------------------------------------------------------------------------
# Stub heavy third-party / hardware-dependent modules before any src import.
# ---------------------------------------------------------------------------

def _make_module(name: str, **attrs):
    """Create a lightweight fake module."""
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    return m


# -- gi / GStreamer stubs ---------------------------------------------------
gi_mod = _make_module("gi")
gi_repo_mod = _make_module("gi.repository")
Gst_stub = _make_module(
    "gi.repository.Gst",
    init=lambda *a, **kw: None,
    parse_launch=lambda desc: None,
    Element=object,
    PadProbeReturn=type("PadProbeReturn", (), {"OK": 0}),
    PadProbeType=type("PadProbeType", (), {"BUFFER": 0}),
    MessageType=type("MessageType", (), {"EOS": 0, "ERROR": 1, "WARNING": 2, "STATE_CHANGED": 3}),
    State=type("State", (), {"PLAYING": 0, "NULL": 1}),
    Structure=type("Structure", (), {"new_from_string": staticmethod(lambda s: s)}),
    FlowReturn=type("FlowReturn", (), {"OK": 0, "ERROR": 1}),
    MapFlags=type("MapFlags", (), {"READ": 0}),
    DebugGraphDetails=type("DebugGraphDetails", (), {"ALL": 0}),
    debug_bin_to_dot_file=lambda *a, **kw: None,
    ElementFactory=type("ElementFactory", (), {"make": staticmethod(lambda *a: None)}),
)
GLib_stub = _make_module("gi.repository.GLib", MainLoop=lambda: None)

gi_mod.require_version = lambda *a, **kw: None
gi_mod.repository = gi_repo_mod

gi_repo_mod.Gst = Gst_stub
gi_repo_mod.GLib = GLib_stub

sys.modules.setdefault("gi", gi_mod)
sys.modules.setdefault("gi.repository", gi_repo_mod)
sys.modules.setdefault("gi.repository.Gst", Gst_stub)
sys.modules.setdefault("gi.repository.GLib", GLib_stub)

# -- pyds stub ---------------------------------------------------------------
pyds_stub = _make_module(
    "pyds",
    gst_buffer_get_nvds_batch_meta=lambda h: None,
    NvDsFrameMeta=type("NvDsFrameMeta", (), {"cast": staticmethod(lambda d: d)}),
    NvDsObjectMeta=type("NvDsObjectMeta", (), {"cast": staticmethod(lambda d: d)}),
)
sys.modules.setdefault("pyds", pyds_stub)

# -- jtop stub ---------------------------------------------------------------
class _FakeJtop:
    def start(self):
        pass
    def attach(self, cb):
        pass
    def close(self):
        pass
    gpu = {"gpu": {"status": {"load": 0.0}}}
    temperature = {"cpu": {"temp": 0.0}}
    power = {"tot": {"power": 0}}
    memory = {"RAM": {"used": 0, "tot": 0}}
    local_interfaces = {"interfaces": {}}

jtop_mod = _make_module("jtop", jtop=_FakeJtop)
sys.modules.setdefault("jtop", jtop_mod)

# -- netifaces stub ----------------------------------------------------------
netifaces_stub = _make_module(
    "netifaces",
    interfaces=lambda: [],
    ifaddresses=lambda iface: {},
    AF_INET=2,
)
sys.modules.setdefault("netifaces", netifaces_stub)

# -- psutil stub (only needed on non-Linux where it may be missing) ----------
try:
    import psutil  # noqa: F401
except ImportError:
    psutil_stub = _make_module("psutil", cpu_percent=lambda **kw: 0.0)
    sys.modules.setdefault("psutil", psutil_stub)

# -- os.sched_* stubs for macOS (Linux-only API) ----------------------------
import os as _os

if not hasattr(_os, "sched_setscheduler"):
    _os.SCHED_FIFO = 1
    _os.SCHED_OTHER = 0
    _os.SCHED_BATCH = 3

    class _sched_param:  # noqa: N801
        def __init__(self, priority):
            self.sched_priority = priority

    _os.sched_param = _sched_param
    _os.sched_setscheduler = lambda pid, policy, param: None

if not hasattr(_os, "SCHED_FIFO"):
    _os.SCHED_FIFO = 1
if not hasattr(_os, "SCHED_OTHER"):
    _os.SCHED_OTHER = 0
if not hasattr(_os, "SCHED_BATCH"):
    _os.SCHED_BATCH = 3

# -- serial stub -------------------------------------------------------------
class _FakeSerial:
    is_open = True
    def __init__(self, *a, **kw):
        pass
    def write(self, data):
        return len(data)
    def read(self, n):
        return b"\x00" * n
    def close(self):
        self.is_open = False

serial_stub = _make_module("serial", Serial=_FakeSerial)
sys.modules.setdefault("serial", serial_stub)


@pytest.fixture
def tmp_recording_dir(tmp_path):
    """Provide a temporary directory suitable for RecordingDatabase."""
    d = tmp_path / "recordings"
    d.mkdir()
    return str(d)
