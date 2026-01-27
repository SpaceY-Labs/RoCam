import os

import logging
from common.ipc_buffer import IPCBufferReceiver
from common.utils import run_pipeline_and_wait_for_start, set_scheduler_fifo

import gi

from cv_process.main import (
    HEIGHT,
    LIVE_STREAM_FRAME_SIZE,
    LIVE_STREAM_QUEUE_DEPTH,
    LIVE_STREAM_SHM_NAME,
    WIDTH,
)

gi.require_version("Gst", "1.0")
os.environ["GST_DEBUG_DUMP_DOT_DIR"] = "./"
from gi.repository import Gst  # pyright: ignore[reportMissingModuleSource]  # noqa: E402

logger = logging.getLogger(__name__)


class LivestreamProcess:
    _using_fallback = False

    def __init__(self):
        self._livestream_frames_receiver = IPCBufferReceiver(
            LIVE_STREAM_SHM_NAME, LIVE_STREAM_QUEUE_DEPTH, LIVE_STREAM_FRAME_SIZE
        )

        Gst.init(None)

        pipeline_desc = f"""
            appsrc name=source emit-signals=True do-timestamp=True format=3 is-live=True caps=video/x-raw,format=RGBA,width={WIDTH},height={HEIGHT},framerate=60/1 ! 
            queue max-size-buffers=2 !
            nvvideoconvert !
            nvdrmvideosink set-mode=1
        """

        self._pipeline: Gst.Element = Gst.parse_launch(pipeline_desc)

        self._source = self._pipeline.get_by_name("source")  # pyright: ignore[reportAttributeAccessIssue]
        assert self._source
        self._source.connect("need-data", self._get_frame)

        self.pipeline_thread = run_pipeline_and_wait_for_start(
            "livestream_process_pipeline", self._pipeline, self._bus_call
        )

    def _get_frame(self, src, _length):
        data = self._livestream_frames_receiver.receive(block=True)
        assert data
        buffer = Gst.Buffer.new_wrapped(data)
        gst_flow_return = src.emit("push-buffer", buffer)
        if gst_flow_return != Gst.FlowReturn.OK:
            print("error")

    def _bus_call(self, bus, message, loop):
        t = message.type
        if t == Gst.MessageType.EOS:
            logger.info("End-of-stream\n")
            # Cleanup log file if recording
            if self._log_file:
                self._log_file.close()
                self._log_file = None
            loop.quit()
        elif t == Gst.MessageType.WARNING:
            err, debug = message.parse_warning()
            logger.warning("%s: %s" % (err, debug))
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            logger.error("%s: %s" % (err, debug))
            # Cleanup log file if recording
            if self._log_file:
                self._log_file.close()
                self._log_file = None
            loop.quit()
        return True


def run_livestream_process():
    set_scheduler_fifo(40)

    livestream_process = LivestreamProcess()
    livestream_process.pipeline_thread.join()
