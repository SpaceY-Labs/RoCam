import logging
import sys
import threading
import subprocess

logger = logging.getLogger(__name__)

class LivestreamProcessManagement:
    def __init__(self):
        threading.Thread(target=self._start_process_loop, daemon=True).start()

    def _monitor_stderr(self, p: subprocess.Popen):
        assert p.stderr is not None
        for line in p.stderr:
            sys.stderr.buffer.write(line)
            sys.stderr.buffer.flush()
            if b"Failed in mem copy" in line:
                logger.warning("Detected 'Failed in mem copy' in livestream stderr, restarting...")
                p.terminate()
                break

    def _start_process_loop(self):
        while True:
            p = subprocess.Popen(
                ["python3", "src/main.py", "livestream"],
                stderr=subprocess.PIPE,
            )

            threading.Thread(target=self._monitor_stderr, args=(p,), daemon=True).start()

            p.wait()

