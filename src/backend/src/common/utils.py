from concurrent.futures import Future
import os
import subprocess
import threading
from typing import Any, Callable
import netifaces
import logging
import gi

gi.require_version("Gst", "1.0")
from gi.repository import GLib, Gst  # pyright: ignore[reportMissingModuleSource]  # noqa: E402

logger = logging.getLogger(__name__)


def set_scheduler_fifo(priority: int):
    """
    Use FIFO real-time scheduling for the current thread.

    Priority: 1-99 (99 is highest, preempts all non-RT processes)

    WARNING: A FIFO thread that never blocks can freeze the system.
    """
    if not 1 <= priority <= 99:
        raise ValueError("FIFO priority must be between 1 and 99")
    os.sched_setscheduler(0, os.SCHED_FIFO, os.sched_param(priority))


def set_scheduler_other(nice_value: int = 0):
    """
    Use normal (CFS) scheduling for the current thread.

    Nice: -20 to +19 (-20 is highest priority, 0 is default, +19 is lowest)

    This is the default scheduler for most processes. Suitable for
    interactive and general-purpose tasks.
    """
    if not -20 <= nice_value <= 19:
        raise ValueError("Nice value must be between -20 and 19")

    os.sched_setscheduler(0, os.SCHED_OTHER, os.sched_param(0))

    # Adjust nice value
    current_nice = os.nice(0)
    adjustment = nice_value - current_nice
    if adjustment != 0:
        os.nice(adjustment)


def set_scheduler_batch(nice_value: int = 19):
    """
    Use batch scheduling for the current thread.

    Nice: -20 to +19 (default +19 for background tasks)

    Suitable for CPU-intensive non-interactive tasks. Gets longer time
    slices but lower priority than SCHED_OTHER. Still runs before SCHED_IDLE.
    """
    if not -20 <= nice_value <= 19:
        raise ValueError("Nice value must be between -20 and 19")

    os.sched_setscheduler(0, os.SCHED_BATCH, os.sched_param(0))

    current_nice = os.nice(0)
    adjustment = nice_value - current_nice
    if adjustment != 0:
        os.nice(adjustment)


def ip4_addresses():
    addrs = []
    for iface in netifaces.interfaces():
        info = netifaces.ifaddresses(iface)
        if netifaces.AF_INET in info:
            addrs.append(info[netifaces.AF_INET][0]["addr"])

    return addrs


def run_pipeline_and_wait_for_start(
    pipeline_name: str, pipeline: Gst.Element, bus_call_handler: Callable[..., Any]
):
    loop = GLib.MainLoop()
    bus = pipeline.get_bus()
    assert bus
    bus.add_signal_watch()
    bus.connect("message", bus_call_handler, loop)

    pipeline_start_future = Future()

    def internal_bus_call(_bus, message, _loop):
        t = message.type
        if t == Gst.MessageType.STATE_CHANGED:
            _, new, __ = message.parse_state_changed()
            if message.src == pipeline and new == Gst.State.PLAYING:
                if not pipeline_start_future.done():
                    pipeline_start_future.set_result(True)
        return True

    bus.connect("message", internal_bus_call, loop)

    def run_pipeline():
        logger.info("Starting pipeline")
        pipeline.set_state(Gst.State.PLAYING)
        try:
            loop.run()
        except Exception as e:
            pass
            if not pipeline_start_future.done():
                pipeline_start_future.set_exception(e)
            else:
                logger.error(f"Pipeline exception: {e}")

        logger.info("Pipeline stopped")
        pipeline.set_state(Gst.State.NULL)

    thread = threading.Thread(target=run_pipeline, daemon=True)
    thread.start()

    pipeline_start_future.result()

    Gst.debug_bin_to_dot_file(pipeline, Gst.DebugGraphDetails.ALL, pipeline_name)  # pyright: ignore[reportArgumentType]

    def generate_png_and_cleanup():
        subprocess.run(
            ["dot", "-Tpng", f"{pipeline_name}.dot", "-o", f"{pipeline_name}.png"]
        )
        os.remove(f"{pipeline_name}.dot")

    threading.Thread(target=generate_png_and_cleanup, daemon=True).start()

    logger.info(f"{pipeline_name} started")

    return thread
