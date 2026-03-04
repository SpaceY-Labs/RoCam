"""
Unit tests for src/common/ipc.py

Covers:
  - BoundingBox.center()
  - BoundingBox.get_rotate_90_deg()
  - Dataclass construction for CVData, OSDData, PreviewData, RecordingInfo, StopRecording
  - create_rocam_ipc_server() (mocked)
  - create_rocam_ipc_client() (mocked)
"""
import math
import pytest
from unittest.mock import MagicMock, patch, call

from common.ipc import (
    BoundingBox,
    CVData,
    OSDData,
    PreviewData,
    RecordingInfo,
    StopRecording,
    create_rocam_ipc_server,
    create_rocam_ipc_client,
)


# ---------------------------------------------------------------------------
# BoundingBox.center()
# ---------------------------------------------------------------------------

class TestBoundingBoxCenter:
    def test_center_basic(self):
        bb = BoundingBox(conf=0.9, left=0.1, top=0.2, width=0.4, height=0.6)
        cx, cy = bb.center()
        assert math.isclose(cx, 0.3, rel_tol=1e-6)
        assert math.isclose(cy, 0.5, rel_tol=1e-6)

    def test_center_at_origin(self):
        bb = BoundingBox(conf=1.0, left=0.0, top=0.0, width=0.0, height=0.0)
        assert bb.center() == (0.0, 0.0)

    def test_center_unit_box(self):
        bb = BoundingBox(conf=0.5, left=0.0, top=0.0, width=1.0, height=1.0)
        cx, cy = bb.center()
        assert math.isclose(cx, 0.5)
        assert math.isclose(cy, 0.5)

    def test_center_right_edge(self):
        bb = BoundingBox(conf=0.8, left=0.8, top=0.0, width=0.2, height=0.4)
        cx, cy = bb.center()
        assert math.isclose(cx, 0.9)
        assert math.isclose(cy, 0.2)


# ---------------------------------------------------------------------------
# BoundingBox.get_rotate_90_deg()
# ---------------------------------------------------------------------------

class TestBoundingBoxRotate90:
    def test_rotation_preserves_conf(self):
        bb = BoundingBox(conf=0.75, left=0.1, top=0.2, width=0.3, height=0.4)
        rotated = bb.get_rotate_90_deg()
        assert rotated.conf == 0.75

    def test_rotation_swaps_width_height(self):
        bb = BoundingBox(conf=1.0, left=0.1, top=0.2, width=0.3, height=0.4)
        rotated = bb.get_rotate_90_deg()
        assert math.isclose(rotated.width, bb.height)
        assert math.isclose(rotated.height, bb.width)

    def test_rotation_new_top(self):
        bb = BoundingBox(conf=1.0, left=0.1, top=0.2, width=0.3, height=0.4)
        rotated = bb.get_rotate_90_deg()
        assert math.isclose(rotated.top, bb.left)

    def test_rotation_new_left(self):
        bb = BoundingBox(conf=1.0, left=0.1, top=0.2, width=0.3, height=0.4)
        rotated = bb.get_rotate_90_deg()
        expected_left = 1 - (bb.top + bb.height)
        assert math.isclose(rotated.left, expected_left)

    def test_rotation_returns_bounding_box_instance(self):
        bb = BoundingBox(conf=0.5, left=0.0, top=0.0, width=0.5, height=0.5)
        rotated = bb.get_rotate_90_deg()
        assert isinstance(rotated, BoundingBox)

    def test_double_rotation_consistency(self):
        """Two 90-deg rotations should yield a predictable result (not necessarily identity)."""
        bb = BoundingBox(conf=0.9, left=0.1, top=0.2, width=0.2, height=0.3)
        twice = bb.get_rotate_90_deg().get_rotate_90_deg()
        assert isinstance(twice, BoundingBox)


# ---------------------------------------------------------------------------
# Dataclass construction
# ---------------------------------------------------------------------------

class TestDataclasses:
    def test_cvdata_construction(self):
        bb = BoundingBox(conf=0.9, left=0.0, top=0.0, width=0.5, height=0.5)
        data = CVData(pts_ns=1_000_000, fps=30.0, bounding_box=bb)
        assert data.pts_ns == 1_000_000
        assert data.fps == 30.0
        assert data.bounding_box is bb

    def test_cvdata_no_bbox(self):
        data = CVData(pts_ns=0, fps=0.0, bounding_box=None)
        assert data.bounding_box is None

    def test_osddata_construction(self):
        osd = OSDData(
            pts_ns=42,
            translate_x=0.1,
            translate_y=0.2,
            scale=1.5,
            average_fps=60.0,
            gimbal_tilt_deg=10.0,
            gimbal_pan_deg=-5.0,
            gimbal_focal_length_mm=24.0,
            device_ip_addresses=["192.168.1.1"],
            timestamp_ms=999,
            tracking_state="idle",
            longitude=None,
            latitude=None,
        )
        assert osd.pts_ns == 42
        assert osd.tracking_state == "idle"

    def test_preview_data_construction(self):
        frame = b"\x00\xff" * 10
        pd = PreviewData(pts_ns=100, frame=frame)
        assert pd.frame == frame

    def test_recording_info_construction(self):
        ri = RecordingInfo(
            id="abc123",
            name="Test Recording",
            start_timestamp_ms=1000,
            duration_ms=5000,
            video_path="/tmp/video.avi",
            log_path="/tmp/log.txt",
            size_bytes=1024,
        )
        assert ri.id == "abc123"
        assert ri.size_bytes == 1024

    def test_stop_recording_construction(self):
        sr = StopRecording()
        assert isinstance(sr, StopRecording)


# ---------------------------------------------------------------------------
# create_rocam_ipc_server()
# ---------------------------------------------------------------------------

class TestCreateRocamIPCServer:
    def test_removes_existing_socket_file(self, tmp_path):
        socket_file = tmp_path / "rocam.sock"
        socket_file.write_bytes(b"stale")

        mock_listener = MagicMock()
        with patch("common.ipc.os.path.exists", return_value=True), \
             patch("common.ipc.os.remove") as mock_remove, \
             patch("common.ipc.Listener", return_value=mock_listener) as mock_listener_cls:
            result = create_rocam_ipc_server("/fake/socket.sock")
            mock_remove.assert_called_once_with("/fake/socket.sock")
            mock_listener_cls.assert_called_once_with("/fake/socket.sock")
            assert result is mock_listener

    def test_no_existing_socket(self):
        mock_listener = MagicMock()
        with patch("common.ipc.os.path.exists", return_value=False), \
             patch("common.ipc.os.remove") as mock_remove, \
             patch("common.ipc.Listener", return_value=mock_listener):
            create_rocam_ipc_server("/no/socket")
            mock_remove.assert_not_called()


# ---------------------------------------------------------------------------
# create_rocam_ipc_client()
# ---------------------------------------------------------------------------

class TestCreateRocamIPCClient:
    def test_returns_client_on_success(self):
        mock_conn = MagicMock()
        with patch("common.ipc.Client", return_value=mock_conn) as mock_client_cls:
            result = create_rocam_ipc_client("/tmp/sock")
            mock_client_cls.assert_called_once_with("/tmp/sock")
            assert result is mock_conn

    def test_calls_exit_on_failure(self):
        with patch("common.ipc.Client", side_effect=ConnectionRefusedError("refused")), \
             patch("common.ipc.exit") as mock_exit:
            create_rocam_ipc_client("/tmp/bad_sock")
            mock_exit.assert_called_once_with(1)
