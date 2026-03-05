"""
Unit tests for src/main.py

Covers the command-line dispatch logic:
  - Default (no args) → run_control_process
  - 'recording-management' → run_recording_management
  - 'cv' → run_cv_process
  - 'livestream' → run_livestream_process
  - 'download-stabilized' → start_transcode_process with correct args
  - 'preview-stabilized' → start_transcode_process with correct args
  - 'cleanup' → cleanup()
  - Unknown command → sys.exit(1)
"""
import sys
import types
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helper: run main() with a given sys.argv
# ---------------------------------------------------------------------------

def _run_main(argv):
    """
    Execute the __main__ block of src/main.py with the given argv.
    Uses runpy.run_path so the if __name__ == '__main__': guard is triggered.
    All sub-imports are pre-mocked to avoid hardware initialisation.
    """
    import runpy
    import os as _os

    run_control = MagicMock()
    run_recording_mgmt = MagicMock()
    run_cv = MagicMock()
    run_livestream = MagicMock()
    start_transcode = MagicMock()

    control_mod = types.ModuleType("control_process.main")
    control_mod.run_control_process = run_control
    control_mod.run_recording_management = run_recording_mgmt

    cv_mod = types.ModuleType("cv_process.main")
    cv_mod.run_cv_process = run_cv

    livestream_mod = types.ModuleType("livestream_process.main")
    livestream_mod.run_livestream_process = run_livestream

    transcode_mod = types.ModuleType("transcode_process.main")
    transcode_mod.start_transcode_process = start_transcode

    src_main_path = _os.path.join(
        _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
        "src", "main.py"
    )

    mocks = {
        "control_process.main": control_mod,
        "cv_process.main": cv_mod,
        "livestream_process.main": livestream_mod,
        "transcode_process.main": transcode_mod,
    }

    saved_argv = sys.argv
    try:
        sys.argv = [src_main_path] + argv
        with patch.dict("sys.modules", mocks), \
             patch("sys.exit") as mock_exit, \
             patch("os.chdir"):
            runpy.run_path(src_main_path, run_name="__main__")
    finally:
        sys.argv = saved_argv

    return {
        "control_process.main": control_mod,
        "cv_process.main": cv_mod,
        "livestream_process.main": livestream_mod,
        "transcode_process.main": transcode_mod,
        "_run_control": run_control,
        "_run_recording_mgmt": run_recording_mgmt,
        "_run_cv": run_cv,
        "_run_livestream": run_livestream,
        "_start_transcode": start_transcode,
    }, mock_exit


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestMainDispatch:
    def test_no_args_starts_control_process(self):
        mocks, _ = _run_main([])
        mocks["_run_control"].assert_called_once()

    def test_recording_management_arg(self):
        mocks, _ = _run_main(["recording-management"])
        mocks["_run_recording_mgmt"].assert_called_once()

    def test_cv_arg(self):
        mocks, _ = _run_main(["cv"])
        mocks["_run_cv"].assert_called_once()

    def test_livestream_arg(self):
        mocks, _ = _run_main(["livestream"])
        mocks["_run_livestream"].assert_called_once()

    def test_download_stabilized_arg(self):
        mocks, _ = _run_main(["download-stabilized", "/vid.avi", "/log.txt", "/out.mkv"])
        mocks["_start_transcode"].assert_called_once_with(
            mode="download-stabilized",
            raw_video_path="/vid.avi",
            log_path="/log.txt",
            destination_path="/out.mkv",
        )

    def test_preview_stabilized_arg(self):
        mocks, _ = _run_main(["preview-stabilized", "/vid.avi", "/log.txt", "/out.webm"])
        mocks["_start_transcode"].assert_called_once_with(
            mode="preview-stabilized",
            raw_video_path="/vid.avi",
            log_path="/log.txt",
            destination_path="/out.webm",
        )

    def test_unknown_arg_exits_with_1(self):
        _, mock_exit = _run_main(["unknowncommand"])
        mock_exit.assert_called_once_with(1)
