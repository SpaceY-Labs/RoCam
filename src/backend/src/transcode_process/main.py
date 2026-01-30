from typing import Literal, Union

from common.utils import run_pipeline_and_wait_for_start, set_scheduler_batch
import logging
import os
import gi

from cv_process.main import HEIGHT, WIDTH

gi.require_version("Gst", "1.0")
os.environ["GST_DEBUG_DUMP_DOT_DIR"] = "./"
from gi.repository import Gst  # pyright: ignore[reportMissingModuleSource]  # noqa: E402

logger = logging.getLogger(__name__)

TranscodeMode = Literal["download-stabilized", "preview-stabilized"]

def start_transcode_process(
    mode: TranscodeMode,
    raw_video_path: str,
    log_path: str,
    destination_path: str,
):
    set_scheduler_batch()

    Gst.init(None)

    pipeline_desc = f"""
        filesrc location={raw_video_path} !
        avidemux !
        queue !
        jpegdec !
        queue !
        video/x-raw,format=I420 !
        videorate !
        video/x-raw,framerate=30/1 !
        videoscale method=0 !
        queue !
        video/x-raw,width={int(WIDTH / 2)},height={int(HEIGHT / 2)} !
        vp8enc target-bitrate=1000000 cpu-used=5 deadline=1 threads=6 !
        queue !
        webmmux streamable=true !
        filesink location={destination_path}
    """

    pipeline: Gst.Element = Gst.parse_launch(pipeline_desc)
    thread = run_pipeline_and_wait_for_start(
        "transcode_process_pipeline", pipeline, bus_call
    )
    thread.join()


def bus_call(bus, message, loop):
    t = message.type
    if t == Gst.MessageType.EOS:
        logger.info("End-of-stream\n")
        loop.quit()
    elif t == Gst.MessageType.WARNING:
        err, debug = message.parse_warning()
        logger.warning("%s: %s" % (err, debug))
    elif t == Gst.MessageType.ERROR:
        err, debug = message.parse_error()
        logger.error("%s: %s" % (err, debug))
        loop.quit()
    return True
