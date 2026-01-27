import logging

from common.utils import set_scheduler_fifo
from control_process.api import run_api_gateway
from threading import Thread

from control_process.state_management import StateManagement

logger = logging.getLogger(__name__)

def run_control_process():
    set_scheduler_fifo(50)

    state_management = StateManagement()
    
    api_thread = Thread(target=run_api_gateway, args=(state_management,), daemon=True)
    api_thread.start()
    api_thread.join()
    