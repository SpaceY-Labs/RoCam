"""
Author: Xiaotian Lou
Date: 2026-03-04
Purpose: Unit tests for RecordingDatabase CRUD, validation, and disk-space helpers.
"""
import json
import os
import pytest
from unittest.mock import patch, MagicMock

from control_process.database import RecordingDatabase, RecordingNotFoundError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path):
    return RecordingDatabase(base_path=str(tmp_path))


def _create_recording_dir(base_path: str, rec_id: str, name: str = "Test", log_lines=None):
    """Helper: create a valid recording directory with required files."""
    rec_dir = os.path.join(base_path, rec_id)
    os.makedirs(rec_dir, exist_ok=True)

    with open(os.path.join(rec_dir, "meta.json"), "w") as f:
        json.dump({"name": name}, f)

    # Create a zero-byte video file
    open(os.path.join(rec_dir, "video.avi"), "w").close()

    log_path = os.path.join(rec_dir, "log.txt")
    if log_lines:
        with open(log_path, "w") as f:
            for line in log_lines:
                f.write(json.dumps(line) + "\n")
    else:
        open(log_path, "w").close()

    return rec_dir


# ---------------------------------------------------------------------------
# _validate_id
# ---------------------------------------------------------------------------

class TestValidateId:
    def test_valid_id_passes(self, db):
        db._validate_id("abc123")  # should not raise

    def test_empty_id_raises(self, db):
        with pytest.raises(ValueError):
            db._validate_id("")

    def test_none_like_raises(self, db):
        with pytest.raises(ValueError):
            db._validate_id("")

    def test_path_traversal_with_sep_raises(self, db):
        with pytest.raises(ValueError):
            db._validate_id("../etc/passwd")

    def test_id_with_slash_raises(self, db):
        with pytest.raises(ValueError):
            db._validate_id("abc/def")


# ---------------------------------------------------------------------------
# _get_size_bytes
# ---------------------------------------------------------------------------

class TestGetSizeBytes:
    def test_returns_zero_when_file_missing(self, db):
        result = db._get_size_bytes("/nonexistent/file.avi")
        assert result == 0

    def test_returns_file_size(self, tmp_path, db):
        f = tmp_path / "video.avi"
        f.write_bytes(b"X" * 100)
        result = db._get_size_bytes(str(f))
        assert result == 100

    def test_returns_zero_on_oserror(self, db):
        with patch("control_process.database.os.path.exists", return_value=True), \
             patch("control_process.database.os.path.getsize", side_effect=OSError("perm")):
            result = db._get_size_bytes("/some/file.avi")
        assert result == 0


# ---------------------------------------------------------------------------
# _get_log_summary
# ---------------------------------------------------------------------------

class TestGetLogSummary:
    def test_empty_log_returns_none_none(self, db, tmp_path):
        rec_id = "empty_log"
        _create_recording_dir(str(tmp_path), rec_id)
        db._base_path = str(tmp_path)
        start, dur = db._get_log_summary(rec_id)
        assert start is None
        assert dur is None

    def test_single_line_log(self, db, tmp_path):
        rec_id = "single_line"
        _create_recording_dir(
            str(tmp_path), rec_id,
            log_lines=[{"timestamp_ms": 1000}]
        )
        db._base_path = str(tmp_path)
        start, dur = db._get_log_summary(rec_id)
        assert start == 1000
        assert dur == 0

    def test_multi_line_log(self, db, tmp_path):
        rec_id = "multi_line"
        _create_recording_dir(
            str(tmp_path), rec_id,
            log_lines=[
                {"timestamp_ms": 1000},
                {"timestamp_ms": 2000},
                {"timestamp_ms": 3500},
            ]
        )
        db._base_path = str(tmp_path)
        start, dur = db._get_log_summary(rec_id)
        assert start == 1000
        assert dur == 2500

    def test_missing_log_returns_none_none(self, db, tmp_path):
        db._base_path = str(tmp_path)
        start, dur = db._get_log_summary("nonexistent_id")
        assert start is None
        assert dur is None


# ---------------------------------------------------------------------------
# allocate_recording
# ---------------------------------------------------------------------------

class TestAllocateRecording:
    def test_creates_directory(self, db):
        info = db.allocate_recording()
        rec_dir = os.path.join(db._base_path, info.id)
        assert os.path.isdir(rec_dir)

    def test_creates_meta_json(self, db):
        info = db.allocate_recording()
        meta_path = os.path.join(db._base_path, info.id, "meta.json")
        assert os.path.exists(meta_path)
        with open(meta_path) as f:
            meta = json.load(f)
        assert "name" in meta

    def test_returns_recording_info(self, db):
        from common.ipc import RecordingInfo
        info = db.allocate_recording()
        assert isinstance(info, RecordingInfo)
        assert info.id
        assert info.start_timestamp_ms is None
        assert info.duration_ms is None
        assert info.size_bytes == 0

    def test_video_path_ends_with_avi(self, db):
        info = db.allocate_recording()
        assert info.video_path.endswith("video.avi")


# ---------------------------------------------------------------------------
# get_recording_by_id
# ---------------------------------------------------------------------------

class TestGetRecordingById:
    def test_returns_none_for_invalid_id(self, db):
        result = db.get_recording_by_id("../bad")
        assert result is None

    def test_returns_none_when_not_found(self, db):
        result = db.get_recording_by_id("doesnotexist")
        assert result is None

    def test_returns_info_for_valid_recording(self, db, tmp_path):
        rec_id = "validrec"
        _create_recording_dir(str(tmp_path), rec_id, name="MyRec")
        db._base_path = str(tmp_path)
        result = db.get_recording_by_id(rec_id)
        assert result is not None
        assert result.name == "MyRec"
        assert result.id == rec_id


# ---------------------------------------------------------------------------
# list_all_recordings
# ---------------------------------------------------------------------------

class TestListAllRecordings:
    def test_empty_directory_returns_empty(self, db):
        result = db.list_all_recordings()
        assert result == []

    def test_lists_valid_recordings(self, db, tmp_path):
        db._base_path = str(tmp_path)
        for rec_id in ["rec1", "rec2"]:
            _create_recording_dir(str(tmp_path), rec_id)
        result = db.list_all_recordings()
        assert len(result) == 2

    def test_sorts_by_timestamp_descending(self, db, tmp_path):
        db._base_path = str(tmp_path)
        _create_recording_dir(
            str(tmp_path), "older",
            log_lines=[{"timestamp_ms": 1000}, {"timestamp_ms": 2000}]
        )
        _create_recording_dir(
            str(tmp_path), "newer",
            log_lines=[{"timestamp_ms": 5000}, {"timestamp_ms": 6000}]
        )
        result = db.list_all_recordings()
        assert result[0].id == "newer"
        assert result[1].id == "older"


# ---------------------------------------------------------------------------
# rename_recording
# ---------------------------------------------------------------------------

class TestRenameRecording:
    def test_rename_updates_meta(self, db, tmp_path):
        rec_id = "torename"
        _create_recording_dir(str(tmp_path), rec_id, name="Old Name")
        db._base_path = str(tmp_path)
        db.rename_recording(rec_id, "New Name")
        meta_path = os.path.join(str(tmp_path), rec_id, "meta.json")
        with open(meta_path) as f:
            meta = json.load(f)
        assert meta["name"] == "New Name"

    def test_rename_invalid_id_raises(self, db):
        with pytest.raises(ValueError):
            db.rename_recording("../bad", "x")

    def test_rename_missing_recording_raises(self, db):
        with pytest.raises(RecordingNotFoundError):
            db.rename_recording("doesnotexist", "x")


# ---------------------------------------------------------------------------
# delete_recording
# ---------------------------------------------------------------------------

class TestDeleteRecording:
    def test_delete_removes_directory(self, db, tmp_path):
        rec_id = "todelete"
        rec_dir = _create_recording_dir(str(tmp_path), rec_id)
        db._base_path = str(tmp_path)
        db.delete_recording(rec_id)
        assert not os.path.exists(rec_dir)

    def test_delete_invalid_id_raises(self, db):
        with pytest.raises(ValueError):
            db.delete_recording("../escape")

    def test_delete_missing_raises(self, db):
        with pytest.raises(RecordingNotFoundError):
            db.delete_recording("ghostrecording")


# ---------------------------------------------------------------------------
# space_usage_bytes / recording_duration_left_s
# ---------------------------------------------------------------------------

class TestSpaceUsage:
    def test_space_usage_returns_tuple(self, db):
        fake_usage = MagicMock()
        fake_usage.used = 10_000_000_000
        fake_usage.total = 50_000_000_000
        with patch("control_process.database.shutil.disk_usage", return_value=fake_usage):
            used, total = db.space_usage_bytes()
        assert used == 10_000_000_000
        assert total == 50_000_000_000

    def test_duration_left_calculation(self, db):
        fake_usage = MagicMock()
        fake_usage.used = 0
        fake_usage.total = 80_000_000  # 80 MB free
        with patch("control_process.database.shutil.disk_usage", return_value=fake_usage):
            duration = db.recording_duration_left_s()
        # 80_000_000 / 8_000_000 = 10 seconds
        assert duration == 10

    def test_duration_left_no_free_space(self, db):
        fake_usage = MagicMock()
        fake_usage.used = 100_000_000
        fake_usage.total = 100_000_000  # zero free
        with patch("control_process.database.shutil.disk_usage", return_value=fake_usage):
            duration = db.recording_duration_left_s()
        assert duration == 0
