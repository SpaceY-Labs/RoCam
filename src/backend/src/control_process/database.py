import os
import json
import uuid
import shutil
import logging
import time
from datetime import datetime
from typing import Optional
from common.ipc import RecordingInfo, OSDData

logger = logging.getLogger(__name__)


class RecordingNotFoundError(Exception):
    """Exception raised when a recording is not found."""

    pass


class RecordingDatabase:
    def __init__(self, base_path: str):
        """
        Sets the base_path state variable to the given base path.
        """
        self._base_path = os.path.abspath(base_path)
        if not os.path.exists(self._base_path):
            os.makedirs(self._base_path, exist_ok=True)
        self._recording_rate_cache_value: Optional[float] = None
        self._recording_rate_cache_time = 0.0

    def allocate_recording(self) -> RecordingInfo:
        """
        Generates a new recording ID and name, creates a folder and meta.json.
        Returns initial RecordingInfo.
        """
        recording_id = uuid.uuid4().hex
        name = f"Recording {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        recording_dir = os.path.join(self._base_path, recording_id)
        os.makedirs(recording_dir, exist_ok=True)

        meta_path = os.path.join(recording_dir, "meta.json")
        with open(meta_path, "w") as f:
            json.dump({"name": name}, f)

        video_path = os.path.join(recording_dir, "video.avi")
        return RecordingInfo(
            id=recording_id,
            name=name,
            start_timestamp_ms=None,
            duration_ms=None,
            video_path=video_path,
            log_path=os.path.join(recording_dir, "log.txt"),
            size_bytes=0,
        )

    def _validate_id(self, recording_id: str):
        """
        Validates the recording_id to prevent path traversal.
        """
        if (
            not recording_id
            or os.path.sep in recording_id
            or (os.path.altsep and os.path.altsep in recording_id)
        ):
            raise ValueError(f"Invalid recording ID: {recording_id}")

    def _get_size_bytes(self, video_path: str) -> int:
        """
        Gets the size of the video file in bytes.
        Returns 0 if the file doesn't exist.
        """
        if os.path.exists(video_path):
            try:
                return os.path.getsize(video_path)
            except OSError as e:
                logger.warning(f"Error getting size for {video_path}: {e}")
                return 0
        return 0

    def _get_log_summary(
        self, recording_id: str
    ) -> tuple[Optional[int], Optional[int]]:
        """
        Efficiently gets start_timestamp_ms and duration_ms by reading only the first and last line of the log.
        """
        log_path = os.path.join(self._base_path, recording_id, "log.txt")
        if not os.path.exists(log_path) or os.path.getsize(log_path) == 0:
            return None, None

        first_ts_ms = None
        last_ts_ms = None

        try:
            with open(log_path, "rb") as f:
                # Get first line
                first_line = f.readline().decode("utf-8").strip()
                if first_line:
                    first_ts_ms = json.loads(first_line).get("timestamp_ms")

                if first_ts_ms is None:
                    return None, None

                # Get last valid line efficiently
                f.seek(0, os.SEEK_END)
                pointer = f.tell() - 1

                # If file has only one line or is very small
                if pointer <= 0:
                    last_ts_ms = first_ts_ms
                else:
                    buffer = b""
                    # Search backwards for a valid JSON line
                    while pointer >= 0:
                        f.seek(pointer)
                        char = f.read(1)
                        if char == b"\n" or char == b"\r":
                            if buffer:
                                try:
                                    last_line = buffer.decode("utf-8").strip()
                                    if last_line:
                                        last_ts_ms = json.loads(last_line).get(
                                            "timestamp_ms"
                                        )
                                        if last_ts_ms is not None:
                                            break  # Found a valid last line
                                except (json.JSONDecodeError, UnicodeDecodeError):
                                    # Corrupted line, reset buffer and keep searching backwards
                                    buffer = b""
                            # if buffer was empty, it just means we found multiple newlines at the end
                        else:
                            buffer = char + buffer
                        pointer -= 1

                    # If we reached the beginning of the file without breaking,
                    # try the very first buffer (which would be the first line)
                    if last_ts_ms is None and buffer:
                        try:
                            last_line = buffer.decode("utf-8").strip()
                            last_ts_ms = json.loads(last_line).get("timestamp_ms")
                        except (json.JSONDecodeError, UnicodeDecodeError):
                            pass

                    if last_ts_ms is None:
                        last_ts_ms = first_ts_ms

            start_timestamp_ms = first_ts_ms
            duration_ms = (last_ts_ms - first_ts_ms) if last_ts_ms is not None else None
            return start_timestamp_ms, duration_ms

        except (
            json.JSONDecodeError,
            OSError,
            UnicodeDecodeError,
            KeyError,
            TypeError,
            ValueError,
        ) as e:
            logger.warning(f"Error reading log boundaries for {recording_id}: {e}")

        return None, None

    

    def get_recording_by_id(self, recording_id: str) -> Optional[RecordingInfo]:
        """
        Retrieves RecordingInfo for a specific recording_id.
        """
        try:
            self._validate_id(recording_id)
        except ValueError:
            return None

        recording_dir = os.path.join(self._base_path, recording_id)
        meta_path = os.path.join(recording_dir, "meta.json")
        video_path = os.path.join(recording_dir, "video.avi")
        log_path = os.path.join(recording_dir, "log.txt")

        if not os.path.isdir(recording_dir) or not all(
            os.path.exists(p) for p in [meta_path, video_path, log_path]
        ):
            return None

        try:
            with open(meta_path, "r") as f:
                meta = json.load(f)

            start_timestamp_ms, duration_ms = self._get_log_summary(recording_id)
            size_bytes = self._get_size_bytes(video_path)

            return RecordingInfo(
                id=recording_id,
                name=meta.get("name", ""),
                start_timestamp_ms=start_timestamp_ms,
                duration_ms=duration_ms,
                video_path=video_path,
                log_path=log_path,
                size_bytes=size_bytes,
            )
        except Exception as e:
            logger.error(f"Error getting recording {recording_id}: {e}")
            return None

    def list_all_recordings(self) -> list[RecordingInfo]:
        """
        Lists all valid recordings in the base_path, sorted by newest to oldest.
        """
        if not os.path.exists(self._base_path):
            return []

        recordings = []
        try:
            for entry in os.scandir(self._base_path):
                if entry.is_dir():
                    # entry.name is safe as it's from scandir, but get_recording_by_id will validate it anyway
                    info = self.get_recording_by_id(entry.name)
                    if info:
                        recordings.append(info)
            # Sort by start_timestamp_ms descending (newest first)
            # None values (in-progress recordings) are treated as newest
            recordings.sort(
                key=lambda r: r.start_timestamp_ms if r.start_timestamp_ms is not None else float('inf'),
                reverse=True
            )
            return recordings
        except Exception as e:
            logger.error(f"Error listing recordings: {e}")
            return []

    def rename_recording(self, recording_id: str, new_name: str):
        """
        Updates the name in meta.json for the given recording_id.
        """
        self._validate_id(recording_id)
        meta_path = os.path.join(self._base_path, recording_id, "meta.json")
        if not os.path.exists(meta_path):
            raise RecordingNotFoundError(f"Recording {recording_id} not found")

        with open(meta_path, "r") as f:
            meta = json.load(f)

        meta["name"] = new_name

        with open(meta_path, "w") as f:
            json.dump(meta, f)

    def delete_recording(self, recording_id: str):
        """
        Deletes the folder for the given recording_id.
        """
        self._validate_id(recording_id)
        recording_dir = os.path.join(self._base_path, recording_id)
        if not os.path.exists(recording_dir):
            raise RecordingNotFoundError(f"Recording {recording_id} not found")

        shutil.rmtree(recording_dir)

    def space_usage_bytes(self) -> tuple[int, int]:
        """
        Returns used and total space in bytes.
        """
        usage = shutil.disk_usage(self._base_path)
        return (usage.used, usage.total)

    def estimate_recording_bytes_per_second(
        self, cache_ttl_s: float = 5.0
    ) -> Optional[float]:
        """
        Estimates bytes per second from recent recordings.
        Uses a cached value to avoid expensive scans on every call.
        """
        now = time.time()
        if now - self._recording_rate_cache_time < cache_ttl_s:
            return self._recording_rate_cache_value

        rate: Optional[float] = None
        recordings = self.list_all_recordings()
        for recording in recordings:
            if (
                recording.duration_ms is None
                or recording.duration_ms <= 0
                or recording.size_bytes <= 0
            ):
                continue

            duration_s = recording.duration_ms / 1000.0
            if duration_s <= 0:
                continue

            rate = recording.size_bytes / duration_s
            break

        self._recording_rate_cache_value = rate
        self._recording_rate_cache_time = now
        return rate
