"""
Author: Jianqing Liu
Date: 2026-01-24
Purpose: Manages the lifecycle of the CV child process, including automatic restart
    on crash or timeout, IPC message routing for CVData/PreviewData/OSDData, and
    pause/resume support during transcoding downloads.
"""

from multiprocessing.connection import Connection
import logging
from cv_process.main import CV_SOCKET_PATH
import threading
from common.ipc import (
    OSDData,
    PreviewData,
    RecordingInfo,
    StopRecording,
    create_rocam_ipc_server,
    CVData,
)
from common.watchdog import Watchdog
import subprocess

logger = logging.getLogger(__name__)


class CVProcessManagement:
    # will return after the cv process is up and fully running
    def __init__(self, cvdata_callback, preview_callback, process_restart_callback):
        self._conn: Connection | None = None
        self._cvdata_callback = cvdata_callback
        self._preview_callback = preview_callback
        self._process_restart_callback = process_restart_callback

        self._ipc_server = create_rocam_ipc_server(CV_SOCKET_PATH)
        self._current_process: subprocess.Popen | None = None
        self._first_cvdata_received = False

        self._watchdog = Watchdog(1.0, self._on_cv_timeout)

        self._paused = False
        self._resume_event = threading.Event()

        threading.Thread(target=self._start_process_loop, daemon=True).start()

    def _start_process_loop(self):
        while True:
            if self._paused:
                logger.info("CV process paused. Waiting for resume...")
                self._resume_event.wait()
                self._resume_event.clear()
                logger.info("Resuming CV process loop...")

            # Reset state for new process
            self._first_cvdata_received = False
            self._watchdog.clear()

            # TODO: properly clean up the subprocess when the control process quits
            self._current_process = subprocess.Popen(["python3", "src/main.py", "cv"])

            # Handle race condition where pause_pipeline was called just before Popen
            if self._paused:
                 self._current_process.terminate()

            logger.info("Waiting for CV process to initialize.....")
            try:
                self._conn = self._ipc_server.accept()
            except Exception as e:
                logger.error(f"Error accepting IPC connection: {e}")
                if self._current_process:
                     self._current_process.terminate()
                     self._current_process.wait()
                continue

            self._process_restart_callback()

            threading.Thread(target=self._recv_loop, args=(self._conn,), daemon=True).start()

            self._current_process.wait()
            self._current_process = None

    def _on_cv_timeout(self):
        """Callback for watchdog when CVData timeout has occurred."""
        logger.warning("CVData timeout: no CVData received. Restarting subprocess.")
        if self._current_process and not self._paused:
            try:
                self._current_process.terminate()
            except Exception as e:
                logger.error(f"Error terminating subprocess: {e}")

    def _recv_loop(self, conn):
        while conn:
            try:
                data = conn.recv()
                if isinstance(data, CVData):
                    if not self._first_cvdata_received:
                        self._first_cvdata_received = True
                        logger.info(
                            "First CVData received, starting timeout monitoring"
                        )

                    self._watchdog.refresh()
                    self._cvdata_callback(data)
                elif isinstance(data, PreviewData):
                    self._preview_callback(data)
            except EOFError:
                logger.info("CV process disconnected")
                break
            except Exception:
                break
        
        # Ensure we close connection on our side if loop exits
        if conn:
            try:
                conn.close()
            except:
                pass
            if self._conn == conn:
                self._conn = None

    def send_osd_data(self, osd_data: OSDData):
        if self._conn:
            try:
                self._conn.send(osd_data)
            except Exception:
                pass

    def start_recording(self, recording_info: RecordingInfo):
        if self._conn:
            try:
                self._conn.send(recording_info)
            except Exception:
                pass

    def stop_recording(self):
        if self._conn:
            try:
                self._conn.send(StopRecording())
            except Exception:
                pass

    def pause_pipeline(self):
        logger.info("Pausing CV process...")
        self._paused = True
        if self._current_process:
            try:
                self._current_process.terminate()
            except Exception as e:
                logger.error(f"Error terminating subprocess: {e}")

    def resume_pipeline(self):
        logger.info("Resuming CV process...")
        self._paused = False
        self._resume_event.set()
