import os
import logging
import sys


logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG)


def cleanup():
    from control_process.gimbal import GimbalSerial

    logger.info("Cleaning up.....")
    gimbal = GimbalSerial(port="/dev/ttyTHS1", baudrate=115200, timeout=0.1)
    gimbal.set_deg(0, 0)
    gimbal.set_arm_led(False)
    gimbal.set_status_led(False)
    gimbal.close()


if __name__ == "__main__":
    # Change to project root (one level up from src/)
    SRC_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_ROOT = os.path.dirname(SRC_DIR)
    os.chdir(PROJECT_ROOT)

    if len(sys.argv) == 1:
        logger.info("Starting control process.....")
        from control_process.main import run_control_process

        run_control_process()
    elif sys.argv[1] == "recording-management":
        logger.info("Starting recording management process.....")
        from control_process.main import run_recording_management

        run_recording_management()
    elif sys.argv[1] == "cv":
        logger.info("Starting cv process.....")
        from cv_process.main import run_cv_process

        run_cv_process()
    elif sys.argv[1] == "livestream":
        logger.info("Starting livestream process.....")
        from livestream_process.main import run_livestream_process

        run_livestream_process()
    elif sys.argv[1] == "download-stabilized":
        logger.info("Starting transcode process.....")
        from transcode_process.main import start_transcode_process

        start_transcode_process(
            mode="download-stabilized",
            raw_video_path=sys.argv[2],
            log_path=sys.argv[3],
            destination_path=sys.argv[4],
        )
    elif sys.argv[1] == "preview-stabilized":
        logger.info("Starting transcode process.....")
        from transcode_process.main import start_transcode_process

        start_transcode_process(
            mode="preview-stabilized",
            raw_video_path=sys.argv[2],
            log_path=sys.argv[3],
            destination_path=sys.argv[4],
        )
    elif sys.argv[1] == "cleanup":
        cleanup()
    else:
        logger.warning("Unknown command")
        sys.exit(1)
