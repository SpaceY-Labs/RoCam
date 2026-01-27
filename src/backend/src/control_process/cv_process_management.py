from multiprocessing.connection import Connection
import logging
from cv_process.main import CV_SOCKET_PATH
import threading
from common.ipc import OSDData, PreviewData, RecordingInfo, StopRecording, create_rocam_ipc_server, CVData
import subprocess
import time

logger = logging.getLogger(__name__)


class CVProcessManagement:
    # will return after the cv process is up and fully running
    def __init__(self, cvdata_callback, preview_callback):
        self._conn: Connection | None = None
        self._cvdata_callback = cvdata_callback
        self._preview_callback = preview_callback

        self._ipc_server = create_rocam_ipc_server(CV_SOCKET_PATH)
        self._current_process: subprocess.Popen | None = None
        self._last_cvdata_time: float | None = None
        self._first_cvdata_received = False
        self._timeout_timer: threading.Timer | None = None
        self._timeout_lock = threading.Lock()
        self._timeout_duration = 0.1  # 0.1 seconds

        threading.Thread(target=self._start_process_loop, daemon=True).start()

    # call this function after cv process crashed
    # will return after the cv process is up and fully running
    def _start_process_loop(self):
        while True:
            # Reset state for new process
            with self._timeout_lock:
                self._first_cvdata_received = False
                self._last_cvdata_time = None
                if self._timeout_timer:
                    self._timeout_timer.cancel()
                    self._timeout_timer = None

            # this subprocess will automatically stop when the control process stops
            # because shmsink in the subprocess will stop the pipeline in the subprocess when shmsrc stops
            # thus, no clean up code is required for this subprocess
            # TODO: not the case, does not clean up when the control process quits before connect to shmsink
            self._current_process = subprocess.Popen(["python3", "src/main.py", "cv"])

            logger.info("Waiting for CV process to initialize.....")
            self._conn = self._ipc_server.accept()

            threading.Thread(target=self._recv_loop, daemon=True).start()

            self._current_process.wait()
            self._current_process = None

    def _reset_timeout_timer(self):
        """Cancel existing timer and start a new one."""
        if self._timeout_timer:
            self._timeout_timer.cancel()
        self._timeout_timer = threading.Timer(self._timeout_duration, self._check_timeout)
        self._timeout_timer.daemon = True
        self._timeout_timer.start()

    def _check_timeout(self):
        """Check if CVData timeout has occurred and restart subprocess if needed."""
        with self._timeout_lock:
            if not self._first_cvdata_received or self._last_cvdata_time is None:
                return

            elapsed = time.time() - self._last_cvdata_time
            if elapsed > self._timeout_duration:
                logger.warning(f"CVData timeout: no CVData received for {elapsed:.3f} seconds. Restarting subprocess.")
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
                    with self._timeout_lock:
                        self._last_cvdata_time = time.time()
                        if not self._first_cvdata_received:
                            self._first_cvdata_received = True
                            logger.info("First CVData received, starting timeout monitoring")
                        self._reset_timeout_timer()
                    
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