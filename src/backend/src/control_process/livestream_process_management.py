import logging
import threading
import subprocess

logger = logging.getLogger(__name__)

class LivestreamProcessManagement:
    def __init__(self):
        threading.Thread(target=self._start_process_loop, daemon=True).start()

    # call this function after cv process crashed
    # will return after the cv process is up and fully running
    def _start_process_loop(self):
        while True:
            p = subprocess.Popen(
                ["python3", "src/main.py", "livestream"],
            )

            p.wait()

