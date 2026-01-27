import multiprocessing as mp
import logging
from multiprocessing import shared_memory
from multiprocessing.resource_tracker import unregister
import struct
import time

logger = logging.getLogger(__name__)

def cleanup_shared_memory(name):
    try:
        shm = shared_memory.SharedMemory(name=name, create=False)
        shm.close()
        shm.unlink()
    except Exception:
        pass

class IPCBufferSender:
    """Best-effort IPC ring buffer sender with fixed-size messages."""
    
    def __init__(self, name, size=256, message_size=8192):
        """
        Args:
            name: unique identifier for the shared memory
            size: number of slots in ring buffer
            message_size: fixed size of each message in bytes
        """
        self.name = name
        self.size = size
        self.message_size = message_size
        
        # Shared memory layout:
        # [head: 8 bytes][tail: 8 bytes][buffer: size * message_size bytes]
        header_size = 16
        buffer_size = size * message_size
        total_size = header_size + buffer_size
        
        # Try to attach to existing shared memory first
        try:
            self.shm = shared_memory.SharedMemory(name=name, create=False)
            print(f"[Sender] Reusing existing shared memory: {name}")
        except FileNotFoundError:
            # Doesn't exist, create new
            self.shm = shared_memory.SharedMemory(name=name, create=True, size=total_size)
            # Initialize head/tail to 0
            self.shm.buf[:16] = b'\x00' * 16
            print(f"[Sender] Created shared memory: {name} ({total_size} bytes)")
        
        # Unregister so Python doesn't auto-cleanup
        unregister(self.shm._name, 'shared_memory')  # pyright: ignore[reportAttributeAccessIssue]
        
        self.lock = mp.Lock()
    
    def send(self, data):
        """
        Send data through the buffer.
        
        Args:
            data: bytes to send (must be exactly message_size bytes)
            
        Returns:
            True if successful, False if buffer was full (oldest data overwritten)
        """
        if len(data) != self.message_size:
            raise ValueError(f"Data must be exactly {self.message_size} bytes, got {len(data)}")
        
        with self.lock:
            head = struct.unpack('Q', self.shm.buf[0:8])[0]
            tail = struct.unpack('Q', self.shm.buf[8:16])[0]
            
            # Check if full (leave one slot empty to distinguish full/empty)
            was_full = (head + 1) % self.size == tail % self.size
            if was_full:
                # Advance tail to discard oldest entry and make room
                self.shm.buf[8:16] = struct.pack('Q', tail + 1)
            
            # Write data directly at slot
            offset = 16 + (head % self.size) * self.message_size
            self.shm.buf[offset:offset+self.message_size] = data
            
            # Update head
            self.shm.buf[0:8] = struct.pack('Q', head + 1)
            return not was_full
    
    def get_stats(self):
        """Get buffer statistics."""
        with self.lock:
            head = struct.unpack('Q', self.shm.buf[0:8])[0]
            tail = struct.unpack('Q', self.shm.buf[8:16])[0]
            used = (head - tail) % self.size
            return {
                'head': head,
                'tail': tail,
                'used_slots': used,
                'free_slots': self.size - used - 1,
                'utilization': used / (self.size - 1)
            }


class IPCBufferReceiver:
    """Best-effort IPC ring buffer receiver with fixed-size messages."""
    
    def __init__(self, name, size=256, message_size=8192, timeout=5.0):
        """
        Args:
            name: unique identifier for the shared memory (must match sender)
            size: number of slots in ring buffer (must match sender)
            message_size: fixed size of each message in bytes (must match sender)
            timeout: seconds to wait for shared memory to appear
        """
        self.name = name
        self.size = size
        self.message_size = message_size
        
        # Wait for shared memory to exist
        start_time = time.time()
        while True:
            try:
                self.shm = shared_memory.SharedMemory(name=name, create=False)
                print(f"[Receiver] Attached to shared memory: {name}")
                break
            except FileNotFoundError:
                if time.time() - start_time > timeout:
                    raise RuntimeError(f"Timeout waiting for shared memory '{name}'")
                time.sleep(0.1)
        
        # Unregister so Python doesn't auto-cleanup
        unregister(self.shm._name, 'shared_memory')  # pyright: ignore[reportAttributeAccessIssue]
        
        self.lock = mp.Lock()
    
    def receive(self, block=False, timeout=None):
        """
        Receive data from the buffer.
        
        Args:
            block: if True, wait for data to arrive
            timeout: max seconds to wait if blocking (None = wait forever)
            
        Returns:
            bytes (message_size bytes) if data available, None if empty
        """
        if block:
            start_time = time.time()
            while True:
                data = self._try_receive()
                if data is not None:
                    return data
                
                if timeout is not None and (time.time() - start_time) > timeout:
                    return None
                
                time.sleep(0.001)
        else:
            return self._try_receive()
    
    def _try_receive(self):
        """Single non-blocking receive attempt."""
        with self.lock:
            head = struct.unpack('Q', self.shm.buf[0:8])[0]
            tail = struct.unpack('Q', self.shm.buf[8:16])[0]
            
            # Check if empty
            if head % self.size == tail % self.size:
                return None
            
            # Read data directly from slot
            offset = 16 + (tail % self.size) * self.message_size
            data = bytes(self.shm.buf[offset:offset+self.message_size])
            
            # Update tail
            self.shm.buf[8:16] = struct.pack('Q', tail + 1)
            return data
    
    def get_stats(self):
        """Get buffer statistics."""
        with self.lock:
            head = struct.unpack('Q', self.shm.buf[0:8])[0]
            tail = struct.unpack('Q', self.shm.buf[8:16])[0]
            used = (head - tail) % self.size
            return {
                'head': head,
                'tail': tail,
                'used_slots': used,
                'free_slots': self.size - used - 1,
                'utilization': used / (self.size - 1)
            }


# Example usage
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python ipc_buffer.py sender")
        print("  python ipc_buffer.py receiver")
        sys.exit(1)
    
    mode = sys.argv[1]
     
    QUEUE_SIZE = 3
    MESSAGE_SIZE = 8294400

    if mode == "sender":
        
        sender = IPCBufferSender("my_buffer4", size=QUEUE_SIZE, message_size=MESSAGE_SIZE)
        print("[Sender] Starting to send data...")
        counter = 0
        dropped = 0
        
        try:
            while True:
                # Pad message to fixed size
                msg = f"Message {counter}: {time.time()}".encode('utf-8')
                data = msg.ljust(MESSAGE_SIZE, b'\x00')  # Pad with zeros
                
                if sender.send(data):
                    print(f"[Sender] Sent: {msg.decode()}")
                    counter += 1
                else:
                    dropped += 1
                    print(f"[Sender] Buffer full, dropped message (total: {dropped})")
                
                if counter % 10 == 0:
                    stats = sender.get_stats()
                    print(f"[Sender] Stats: {stats}")
                
                time.sleep(0.1)
                
        except KeyboardInterrupt:
            print(f"\n[Sender] Stopped. Sent: {counter}, Dropped: {dropped}")
    
    elif mode == "receiver":
        receiver = IPCBufferReceiver("rocam-livestream", size=QUEUE_SIZE, message_size=MESSAGE_SIZE)
        print("[Receiver] Starting to receive data...")
        received = 0
        
        try:
            while True:
                data = receiver.receive(block=True)
                
                if data is not None:
                    # Strip padding zeros
                    print(f"[Receiver] Got: {len(data)} bytes")
                    received += 1
                    
                    if received % 10 == 0:
                        stats = receiver.get_stats()
                        print(f"[Receiver] Stats: {stats}")
                else:
                    time.sleep(0.01)
                    
        except KeyboardInterrupt:
            print(f"\n[Receiver] Stopped. Received: {received}")
    
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)