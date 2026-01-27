import os
import time
import json
import pyds
import threading
from dataclasses import asdict

import logging
from common.ipc_buffer import IPCBufferSender
from common.utils import run_pipeline_and_wait_for_start, set_scheduler_fifo
from common.ipc import (
    OSDData,
    create_rocam_ipc_client,
    BoundingBox,
    CVData,
    PreviewData,
    RecordingInfo,
    StopRecording,
)

import gi

gi.require_version("Gst", "1.0")
os.environ["GST_DEBUG_DUMP_DOT_DIR"] = "./"
from gi.repository import Gst    # pyright: ignore[reportMissingModuleSource]  # noqa: E402

logger = logging.getLogger(__name__)

WIDTH = 1920
HEIGHT = 1080
LIVE_STREAM_SHM_NAME = "rocam-livestream"
LIVE_STREAM_FRAME_SIZE = WIDTH * HEIGHT * 4
LIVE_STREAM_QUEUE_DEPTH = 3
CV_SOCKET_PATH = "/tmp/rocam-cv"


class CVProcess:
    def __init__(self):
        self._livestream_frames_sender = IPCBufferSender(
            LIVE_STREAM_SHM_NAME, LIVE_STREAM_QUEUE_DEPTH, LIVE_STREAM_FRAME_SIZE
        )

        Gst.init(None)

        self._ipc_client = None
        self._recording_lock = threading.Lock()
        self._log_file = None
        self._fps_last_time = time.perf_counter()
        self._fps_time_list = [0.0]
        self._osd_data_list: list[OSDData] = []
        self._osd: Gst.Element | None = None
        self._shader: Gst.Element | None = None

        pipeline_desc = f"""
            nvarguscamerasrc sensor-id=0 !
            video/x-raw(memory:NVMM),width=(int){WIDTH},height=(int){HEIGHT},framerate=(fraction)120/1,format=(string)NV12 !
            videorate !
            video/x-raw(memory:NVMM),width=(int){WIDTH},height=(int){HEIGHT},framerate=(fraction)60/1,format=(string)NV12 !
            
            nvvideoconvert !
            mux.sink_0 nvstreammux name=mux width=1920 height=1080 live-source=1 batch-size=1 !
            nvinfer name=infer config-file-path={os.path.dirname(__file__)}/pgie_config.txt !
            
            tee name=t
            
            t. !
            queue max-size-buffers=3 min-threshold-buffers=2 leaky=1 !
            nvvideoconvert !
            video/x-raw,format=RGBA !
            glupload !
            glshader name=shader !
            gldownload !
            video/x-raw,format=RGBA !
            textoverlay name=osd valignment=top halignment=left font-desc="Sans, 12" draw-outline=0 draw-shadow=0 color=0xFFFF0000 !
            video/x-raw,format=RGBA !
            queue max-size-buffers=2 leaky=1 !
            appsink name=livestream-sink emit-signals=true sync=false

            t. !
            queue leaky=1 max-size-buffers=30 !
            nvvideoconvert !
            nvjpegenc quality=70 !
            queue name=recording-queue !
            fakesink name=recording-sink

            t. !
            queue leaky=1 max-size-buffers=1 !
            nvvideoconvert dest-crop=0:0:{int(WIDTH / 4)}:{int(HEIGHT / 4)} !
            video/x-raw(memory:NVMM),width={int(WIDTH / 4)},height={int(HEIGHT / 4)} !
            videorate !
            video/x-raw(memory:NVMM),framerate=30/1 !
            nvjpegenc quality=70 !
            appsink name=preview-sink emit-signals=true sync=false
        """

        self._pipeline: Gst.Element = Gst.parse_launch(pipeline_desc)

        infer = self._pipeline.get_by_name("infer")  # pyright: ignore[reportAttributeAccessIssue]
        assert infer
        infer_source_pad = infer.get_static_pad("src")
        assert infer_source_pad
        infer_source_pad.add_probe(
            Gst.PadProbeType.BUFFER, self._inference_stop_probe, 0
        )

        preview_sink = self._pipeline.get_by_name("preview-sink")  # pyright: ignore[reportAttributeAccessIssue]
        assert preview_sink
        preview_sink.connect("new-sample", self._preview_sink_callback)

        livestream_sink = self._pipeline.get_by_name("livestream-sink")  # pyright: ignore[reportAttributeAccessIssue]
        assert livestream_sink
        livestream_sink.connect("new-sample", self._livestream_sink_callback)

        self._shader = self._pipeline.get_by_name("shader")  # pyright: ignore[reportAttributeAccessIssue]
        assert self._shader
        shader_sink_pad = self._shader.get_static_pad("sink")
        assert shader_sink_pad
        shader_sink_pad.add_probe(Gst.PadProbeType.BUFFER, self._shader_probe, 0)
        self._shader.set_property(
            "fragment",
            open(os.path.join(os.path.dirname(__file__), "shader.frag")).read(),
        )
        self._shader.set_property(
            "uniforms",
            Gst.Structure.new_from_string(
                "uniforms, tx=(float)0.0, ty=(float)0.0, scale=(float)1.0"
            ),
        )

        self._osd = self._pipeline.get_by_name("osd")  # pyright: ignore[reportAttributeAccessIssue]
        assert self._osd

        self.pipeline_thread = run_pipeline_and_wait_for_start(
            "cv_process_pipeline", self._pipeline, self._bus_call
        )

        self._ipc_client = create_rocam_ipc_client(CV_SOCKET_PATH)
        logger.info("Connected to IPC server.")
        threading.Thread(target=self._ipc_command_listener, daemon=True).start()

    def _inference_stop_probe(self, pad, info, u_data):
        gst_buffer = info.get_buffer()
        if not gst_buffer:
            print("Unable to get GstBuffer ")
            return

        pts_ns = gst_buffer.pts  # presentation timestamp in nanoseconds

        now = time.perf_counter()
        avg_fps = len(self._fps_time_list) / (now - self._fps_time_list[0])
        self._fps_last_time = now
        self._fps_time_list.append(now)
        # logger.info(f"FPS: {avg_fps}")
        if len(self._fps_time_list) > 60:
            self._fps_time_list.pop(0)

        # Retrieve batch metadata from the gst_buffer
        # Note that pyds.gst_buffer_get_nvds_batch_meta() expects the
        # C address of gst_buffer as input, which is obtained with hash(gst_buffer)
        batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
        l_frame = batch_meta.frame_meta_list
        bounding_box = None
        while l_frame is not None:
            try:
                # Note that l_frame.data needs a cast to pyds.NvDsFrameMeta
                # The casting is done by pyds.NvDsFrameMeta.cast()
                # The casting also keeps ownership of the underlying memory
                # in the C code, so the Python garbage collector will leave
                # it alone.
                frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
            except StopIteration:
                break

            l_obj = frame_meta.obj_meta_list
            while l_obj is not None:
                try:
                    # Casting l_obj.data to pyds.NvDsObjectMeta
                    obj_meta = pyds.NvDsObjectMeta.cast(l_obj.data)
                except StopIteration:
                    break

                bbox = obj_meta.detector_bbox_info.org_bbox_coords
                if not bounding_box or obj_meta.confidence > bounding_box.conf:
                    bounding_box = BoundingBox(
                        conf=obj_meta.confidence,
                        left=bbox.left / WIDTH,
                        top=bbox.top / HEIGHT,
                        width=bbox.width / WIDTH,
                        height=bbox.height / HEIGHT,
                    )
                try:
                    l_obj = l_obj.next
                except StopIteration:
                    break

            try:
                l_frame = l_frame.next
            except StopIteration:
                break

        if self._ipc_client:
            try:
                if bounding_box and bounding_box.conf > 0.2:
                    self._ipc_client.send(
                        CVData(
                            pts_ns=pts_ns,
                            fps=avg_fps,
                            bounding_box=bounding_box.get_rotate_90_deg(),
                        )
                    )
                else:
                    self._ipc_client.send(
                        CVData(
                            pts_ns=pts_ns,
                            fps=avg_fps,
                            bounding_box=None,
                        )
                    )
            except Exception as e:
                logger.error(f"Failed to send CVData: {e}")
                exit(1)

        return Gst.PadProbeReturn.OK

    def _preview_sink_callback(self, sink):
        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.ERROR

        buffer = sample.get_buffer()
        if not buffer:
            return Gst.FlowReturn.ERROR

        pts_ns = buffer.pts

        success, map_info = buffer.map(Gst.MapFlags.READ)
        if not success:
            return Gst.FlowReturn.ERROR

        try:
            if self._ipc_client:
                try:
                    self._ipc_client.send(
                        PreviewData(pts_ns=pts_ns, frame=map_info.data)
                    )
                except Exception as e:
                    logger.error(f"Failed to send PreviewData: {e}")
                    exit(1)
        finally:
            buffer.unmap(map_info)

        return Gst.FlowReturn.OK

    def _livestream_sink_callback(self, sink):
        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.ERROR

        buffer = sample.get_buffer()
        if not buffer:
            return Gst.FlowReturn.ERROR

        success, map_info = buffer.map(Gst.MapFlags.READ)
        if not success:
            return Gst.FlowReturn.ERROR

        try:
            self._livestream_frames_sender.send(map_info.data)
        finally:
            buffer.unmap(map_info)

        return Gst.FlowReturn.OK

    def _start_recording(self, video_path: str, log_path: str):
        with self._recording_lock:
            if not self._pipeline:
                return

            recording_queue = self._pipeline.get_by_name("recording-queue")  # pyright: ignore[reportAttributeAccessIssue]
            old_sink = self._pipeline.get_by_name("recording-sink")  # pyright: ignore[reportAttributeAccessIssue]

            if not recording_queue or not old_sink:
                logger.error("Could not find recording-queue or recording-sink")
                return

            # Check if already recording (avimux exists means we're recording)
            if self._pipeline.get_by_name("avimux"):  # pyright: ignore[reportAttributeAccessIssue]
                logger.warning("Already recording")
                return

            logger.info(f"Starting recording to {video_path}")

            # Open log file for JSONL writing
            self._log_file = open(log_path, "w")

            # Remove old fakesink
            recording_queue.unlink(old_sink)
            old_sink.set_state(Gst.State.NULL)
            self._pipeline.remove(old_sink)  # pyright: ignore[reportAttributeAccessIssue]

            # Create and add avimux and filesink
            new_avimux = Gst.ElementFactory.make("avimux", "avimux")
            new_sink = Gst.ElementFactory.make("filesink", "recording-sink")
            assert new_avimux and new_sink
            new_sink.set_property("location", video_path)

            self._pipeline.add(new_avimux)  # pyright: ignore[reportAttributeAccessIssue]
            self._pipeline.add(new_sink)  # pyright: ignore[reportAttributeAccessIssue]
            recording_queue.link(new_avimux)
            new_avimux.link(new_sink)
            new_avimux.sync_state_with_parent()
            new_sink.sync_state_with_parent()

            logger.info("Recording started")

    def _stop_recording(self):
        with self._recording_lock:
            if not self._pipeline:
                return

            recording_queue = self._pipeline.get_by_name("recording-queue")  # pyright: ignore[reportAttributeAccessIssue]
            old_avimux = self._pipeline.get_by_name("avimux")  # pyright: ignore[reportAttributeAccessIssue]
            old_sink = self._pipeline.get_by_name("recording-sink")  # pyright: ignore[reportAttributeAccessIssue]

            if not recording_queue or not old_sink:
                logger.error("Could not find recording-queue or recording-sink")
                return

            # Check if not recording (no avimux means not recording)
            if not old_avimux:
                logger.warning("Not currently recording")
                return

            logger.info("Stopping recording")

            # Close log file
            if self._log_file:
                self._log_file.close()
                self._log_file = None

            # Unlink and remove avimux + filesink - setting avimux to NULL finalizes the file
            recording_queue.unlink(old_avimux)
            old_avimux.unlink(old_sink)
            old_avimux.set_state(Gst.State.NULL)
            old_sink.set_state(Gst.State.NULL)
            self._pipeline.remove(old_avimux)  # pyright: ignore[reportAttributeAccessIssue]
            self._pipeline.remove(old_sink)  # pyright: ignore[reportAttributeAccessIssue]

            # Create and add just fakesink (no avimux needed when not recording)
            new_sink = Gst.ElementFactory.make("fakesink", "recording-sink")
            assert new_sink

            self._pipeline.add(new_sink)  # pyright: ignore[reportAttributeAccessIssue]
            recording_queue.link(new_sink)
            new_sink.sync_state_with_parent()

            logger.info("Recording stopped")

    def _update_osd(self, msg: OSDData):
        self._osd.set_property("text", f"{round(msg.average_fps)}")  # pyright: ignore[reportOptionalMemberAccess]
        self._shader.set_property(  # pyright: ignore[reportOptionalMemberAccess]
            "uniforms",
            Gst.Structure.new_from_string(
                f"uniforms, tx=(float){msg.translate_x}, ty=(float){msg.translate_y}, scale=(float){msg.scale}"
            ),
        )

    def _shader_probe(self, pad, info, u_data):
        gst_buffer = info.get_buffer()
        if not gst_buffer:
            return Gst.PadProbeReturn.OK

        pts_ns = gst_buffer.pts

        # Find OSDData with matching pts_ns
        matching_osd = None
        for osd_data in self._osd_data_list:
            if osd_data.pts_ns == pts_ns:
                matching_osd = osd_data
                break

        if matching_osd:
            self._update_osd(matching_osd)
        else:
            logger.warning(f"No OSDData found for pts_ns={pts_ns}")

        return Gst.PadProbeReturn.OK

    def _ipc_command_listener(self):
        assert self._ipc_client
        while True:
            try:
                msg = self._ipc_client.recv()
                if isinstance(msg, RecordingInfo):
                    self._start_recording(msg.video_path, msg.log_path)
                elif isinstance(msg, StopRecording):
                    self._stop_recording()
                elif isinstance(msg, OSDData):
                    self._osd_data_list.append(msg)
                    if len(self._osd_data_list) > 10:
                        self._osd_data_list.pop(0)
                    # Write OSD data to log file if recording
                    if self._log_file:
                        json.dump(asdict(msg), self._log_file)
                        self._log_file.write("\n")
                        self._log_file.flush()
            except EOFError:
                logger.info("IPC connection closed")
                break

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


def run_cv_process():
    set_scheduler_fifo(40)
    cv_process = CVProcess()
    cv_process.pipeline_thread.join()
