"""
Author: Xiaotian Lou, Jianqing Liu
Date: 2026-01-29
Purpose: Implements the transcode process, which re-encodes a raw AVI recording
    with digital stabilization and OSD overlay into a VP8/WebM stream for either
    low-resolution preview or full-quality download.
"""

import json
from typing import Literal

from common.ipc import OSDData
from common.utils import run_pipeline_and_wait_for_start, set_scheduler_batch
import logging
import os
import gi

from cv_process.main import update_osd

gi.require_version("Gst", "1.0")
os.environ["GST_DEBUG_DUMP_DOT_DIR"] = "./"
from gi.repository import Gst  # pyright: ignore[reportMissingModuleSource]  # noqa: E402

logger = logging.getLogger(__name__)

TranscodeMode = Literal["download-stabilized", "preview-stabilized"]


class TranscodeProcess:
    def __init__(
        self,
        mode: TranscodeMode,
        raw_video_path: str,
        log_path: str,
        destination_path: str,
    ):
        self._mode = mode
        self._step_size = 1 if mode == "download-stabilized" else 5

        self._osd_data_list = self._read_log(log_path)
        self._osd_data_pointer = 0

        Gst.init(None)

        pipeline_desc = f"""
            filesrc location={raw_video_path} !
            avidemux !

            queue !
            jpegdec !
            video/x-raw,format=RGB !
            {"videorate ! video/x-raw,framerate=30/1 !" if mode == "preview-stabilized" else ""}
            videoconvert !
            video/x-raw,format=RGBA !

            queue !
            glupload !
            glshader name=shader !
            gldownload !
            videoconvert !
            video/x-raw,format=I420 !

            queue !
            textoverlay name=osd valignment=top halignment=left line-alignment=left font-desc="JetBrains Mono NL, 6" draw-outline=0 draw-shadow=1 color=0xFFFFFFFF !
            video/x-raw,format=I420 !
            
        """

        if mode == "preview-stabilized":
            pipeline_desc = f"""
                {pipeline_desc}

                videoscale method=0 !
                video/x-raw,width=854,height=480 !

                queue !
                vp8enc target-bitrate=1000000 cpu-used=16 deadline=1 threads=6 !

                queue !
                webmmux streamable=true !
                filesink location={destination_path}
            """
        elif mode == "download-stabilized":
            pipeline_desc = f"""
                {pipeline_desc}
                
                queue !
                vp8enc target-bitrate=8000000 cpu-used=8 deadline=1 threads=6 keyframe-max-dist=120 !
                
                queue !
                matroskamux streamable=true min-cluster-duration=0 max-cluster-duration=1000000000 writing-app=RoCam !
                filesink buffer-mode=unbuffered location={destination_path}
            """

        self._pipeline: Gst.Element = Gst.parse_launch(pipeline_desc)

        self._shader = self._pipeline.get_by_name("shader")  # pyright: ignore[reportAttributeAccessIssue]
        assert self._shader
        shader_sink_pad = self._shader.get_static_pad("sink")
        assert shader_sink_pad
        shader_sink_pad.add_probe(Gst.PadProbeType.BUFFER, self._shader_probe, 0)
        self._shader.set_property(
            "fragment",
            open(
                os.path.join(
                    os.path.dirname(__file__), "..", "cv_process", "shader.frag"
                )
            ).read(),
        )
        self._shader.set_property(
            "uniforms",
            Gst.Structure.new_from_string(
                f"uniforms, tx=(float)0.0, ty=(float)0.0, scale=(float)1.0, step_size=(int){self._step_size}"
            ),
        )

        self._osd = self._pipeline.get_by_name("osd")  # pyright: ignore[reportAttributeAccessIssue]
        assert self._osd

        self.pipeline_thread = run_pipeline_and_wait_for_start(
            "transcode_process_pipeline", self._pipeline, self._bus_call
        )

    def _read_log(self, log_path: str) -> list[OSDData]:
        """
        Reads and parses the log file for the given recording_id.
        """
        if not os.path.exists(log_path):
            logger.warning(f"Log file not found: {log_path}")
            return []

        logs = []
        with open(log_path, "r") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    logs.append(OSDData(**data))
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"Failed to parse log line in {log_path}: {e}")
                    continue
        return logs

    def _shader_probe(self, pad, info, u_data):
        gst_buffer = info.get_buffer()
        if not gst_buffer:
            return Gst.PadProbeReturn.OK

        pts_ns = gst_buffer.pts

        if not self._osd_data_list:
            osd_data = OSDData(
                pts_ns=pts_ns,
                translate_x=0.0,
                translate_y=0.0,
                scale=1.0,
                average_fps=0.0,
                gimbal_tilt_deg=0.0,
                gimbal_pan_deg=0.0,
                gimbal_focal_length_mm=24.0,
                device_ip_addresses=[],
                timestamp_ms=0,
                tracking_state="idle",
                longitude=None,
                latitude=None,
            )
        elif self._osd_data_pointer >= len(self._osd_data_list):
            osd_data = self._osd_data_list[-1]
            logger.warning("OSD data is shorter than the video, using the last one")
        else:
            osd_data = self._osd_data_list[self._osd_data_pointer]
        if self._mode == "preview-stabilized":
            self._osd_data_pointer += 2
        elif self._mode == "download-stabilized":
            self._osd_data_pointer += 1

        update_osd(self._osd, self._shader, osd_data, step_size=self._step_size)

        return Gst.PadProbeReturn.OK

    def _bus_call(self, bus, message, loop):
        t = message.type
        if t == Gst.MessageType.EOS:
            logger.info("End-of-stream\n")
            if self._osd_data_pointer < len(self._osd_data_list):
                logger.warning(
                    f"OSDData has {len(self._osd_data_list) - self._osd_data_pointer} more frames than the video"
                )
            loop.quit()
        elif t == Gst.MessageType.WARNING:
            err, debug = message.parse_warning()
            logger.warning("%s: %s" % (err, debug))
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            logger.error("%s: %s" % (err, debug))
            loop.quit()
        return True


def start_transcode_process(
    mode: TranscodeMode,
    raw_video_path: str,
    log_path: str,
    destination_path: str,
):
    set_scheduler_batch()
    transcode_process = TranscodeProcess(
        mode=mode,
        raw_video_path=raw_video_path,
        log_path=log_path,
        destination_path=destination_path,
    )
    transcode_process.pipeline_thread.join()
