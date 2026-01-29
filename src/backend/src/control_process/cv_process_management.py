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

        threading.Thread(target=self._start_process_loop, daemon=True).start()

    def _start_process_loop(self):
        while True:
            # Reset state for new process
            self._first_cvdata_received = False
            self._watchdog.clear()

            # TODO: properly clean up the subprocess when the control process quits
            self._current_process = subprocess.Popen(["python3", "src/main.py", "cv"])

            logger.info("Waiting for CV process to initialize.....")
            self._conn = self._ipc_server.accept()

            self._process_restart_callback()

            threading.Thread(target=self._recv_loop, daemon=True).start()

            self._current_process.wait()
            self._current_process = None

    def _on_cv_timeout(self):
        """Callback for watchdog when CVData timeout has occurred."""
        logger.warning("CVData timeout: no CVData received. Restarting subprocess.")
        if self._current_process:
            try:
                self._current_process.terminate()
            except Exception as e:
                logger.error(f"Error terminating subprocess: {e}")

    def _recv_loop(self):
        while self._conn:
            try:
                data = self._conn.recv()
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

    def send_osd_data(self, osd_data: OSDData):
        if self._conn:
            try:
                self._conn.send(osd_data)
            except Exception:
                pass

    def start_recording(self, recording_info: RecordingInfo):
        if self._conn:
            self._conn.send(recording_info)

    def stop_recording(self):
        if self._conn:
            self._conn.send(StopRecording())
