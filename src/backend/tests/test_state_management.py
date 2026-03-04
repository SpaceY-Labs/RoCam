"""
Unit tests for src/control_process/state_management.py

Focuses on the pure-logic components:
  - BoundingBoxCollection.received_data() - max-10 list management
  - BoundingBoxCollection.get_bbox() - pts_ns lookup within 40ms window
  - BoundingBoxCollection.get_latest_valid_bbox() - newest non-None bbox
"""
import pytest
from common.ipc import BoundingBox, CVData
from control_process.state_management import BoundingBoxCollection


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bbox(conf=0.9, left=0.1, top=0.2, w=0.3, h=0.4):
    return BoundingBox(conf=conf, left=left, top=top, width=w, height=h)


def _cvdata(pts_ns: int, bbox=None):
    return CVData(pts_ns=pts_ns, fps=30.0, bounding_box=bbox)


# ---------------------------------------------------------------------------
# BoundingBoxCollection.received_data
# ---------------------------------------------------------------------------

class TestBoundingBoxCollectionReceivedData:
    def test_appends_data(self):
        coll = BoundingBoxCollection()
        coll.received_data(_cvdata(1000))
        assert len(coll._cv_data_list) == 1

    def test_caps_at_10_entries(self):
        coll = BoundingBoxCollection()
        for i in range(15):
            coll.received_data(_cvdata(i * 1000))
        assert len(coll._cv_data_list) == 10

    def test_oldest_entry_removed_at_cap(self):
        coll = BoundingBoxCollection()
        for i in range(11):
            coll.received_data(_cvdata(i * 1_000_000))
        # The first entry (pts_ns=0) should have been evicted
        pts_values = [d.pts_ns for d in coll._cv_data_list]
        assert 0 not in pts_values

    def test_order_preserved(self):
        coll = BoundingBoxCollection()
        coll.received_data(_cvdata(100))
        coll.received_data(_cvdata(200))
        assert coll._cv_data_list[0].pts_ns == 100
        assert coll._cv_data_list[1].pts_ns == 200


# ---------------------------------------------------------------------------
# BoundingBoxCollection.get_bbox
# ---------------------------------------------------------------------------

class TestBoundingBoxCollectionGetBbox:
    def test_empty_collection_returns_none(self):
        coll = BoundingBoxCollection()
        assert coll.get_bbox(1_000_000) is None

    def test_exact_match_within_window(self):
        coll = BoundingBoxCollection()
        bb = _bbox()
        coll.received_data(_cvdata(1_000_000, bbox=bb))
        result = coll.get_bbox(1_000_000)  # exact match
        assert result is bb

    def test_within_40ms_window(self):
        coll = BoundingBoxCollection()
        bb = _bbox()
        pts = 1_000_000_000  # 1s in ns
        coll.received_data(_cvdata(pts, bbox=bb))
        # Query 20ms later (20_000_000 ns)
        result = coll.get_bbox(pts + 20_000_000)
        assert result is bb

    def test_outside_40ms_window_returns_none(self):
        coll = BoundingBoxCollection()
        bb = _bbox()
        pts = 1_000_000_000
        coll.received_data(_cvdata(pts, bbox=bb))
        # Query 50ms later → outside 40ms window
        result = coll.get_bbox(pts + 50_000_000)
        assert result is None

    def test_query_before_any_data_returns_none(self):
        coll = BoundingBoxCollection()
        coll.received_data(_cvdata(5_000_000_000))  # future timestamp
        result = coll.get_bbox(1_000_000)
        assert result is None

    def test_returns_latest_matching_entry(self):
        coll = BoundingBoxCollection()
        bb1 = _bbox(conf=0.5)
        bb2 = _bbox(conf=0.9)
        pts = 1_000_000_000
        coll.received_data(_cvdata(pts, bbox=bb1))
        coll.received_data(_cvdata(pts + 5_000_000, bbox=bb2))
        result = coll.get_bbox(pts + 5_000_000)
        assert result is bb2


# ---------------------------------------------------------------------------
# BoundingBoxCollection.get_latest_valid_bbox
# ---------------------------------------------------------------------------

class TestBoundingBoxCollectionGetLatestValidBbox:
    def test_empty_returns_none(self):
        coll = BoundingBoxCollection()
        assert coll.get_latest_valid_bbox() is None

    def test_all_none_returns_none(self):
        coll = BoundingBoxCollection()
        coll.received_data(_cvdata(1000, bbox=None))
        coll.received_data(_cvdata(2000, bbox=None))
        assert coll.get_latest_valid_bbox() is None

    def test_returns_latest_non_none(self):
        coll = BoundingBoxCollection()
        bb1 = _bbox(conf=0.5)
        bb2 = _bbox(conf=0.9)
        coll.received_data(_cvdata(1000, bbox=bb1))
        coll.received_data(_cvdata(2000, bbox=bb2))
        coll.received_data(_cvdata(3000, bbox=None))
        result = coll.get_latest_valid_bbox()
        assert result is bb2

    def test_skips_none_entries(self):
        coll = BoundingBoxCollection()
        bb = _bbox()
        coll.received_data(_cvdata(1000, bbox=bb))
        coll.received_data(_cvdata(2000, bbox=None))
        result = coll.get_latest_valid_bbox()
        assert result is bb
