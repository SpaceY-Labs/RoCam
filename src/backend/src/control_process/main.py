import logging

from common.utils import set_scheduler_fifo, set_scheduler_other
from control_process.api import run_api_gateway
from threading import Thread

from control_process.state_management import StateManagement
from control_process.state_management_recording_management_only import StateManagementRecordingManagementOnly

logger = logging.getLogger(__name__)

def run_control_process():
    set_scheduler_fifo(50)

    state_management = StateManagement()
    
    api_thread = Thread(target=run_api_gateway, args=(state_management,), daemon=True)
    api_thread.start()
    api_thread.join()

def run_recording_management():
    set_scheduler_other()

    state_management = StateManagementRecordingManagementOnly()
    
    api_thread = Thread(target=run_api_gateway, args=(state_management,), daemon=True)
    api_thread.start()
    api_thread.join()