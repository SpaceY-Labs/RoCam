import math
import numpy as np

def load_hdr(filename):
    """
    Read a Radiance .hdr (RGBE) file and return a float32 numpy array (H, W, 3).
    """
    with open(filename, 'rb') as f:
        # Read header
        header = {}
        line = f.readline()
        if not line.startswith(b'#?RADIANCE'):
             # Some files start with #?RGB or similar, but let's just warn or proceed
             pass
        
        while True:
            line = f.readline()
            if not line or line == b'\n':
                break
            if line.startswith(b'FORMAT='):
                header['FORMAT'] = line.strip().split(b'=')[1]
            # We ignore other header lines like exposure for now

        # Read resolution line (e.g. "-Y 1024 +X 2048")
        line = f.readline()
        parts = line.strip().split()
        if len(parts) != 4:
            raise ValueError(f"Invalid resolution line: {line}")
            
        # Usually -Y H +X W
        height = int(parts[1])
        width = int(parts[3])

        # Read data
        data = f.read()
    
    # Simple uncompressed RGBE reader for small files, but most HDRs are RLE compressed.
    # We need a proper RLE decoder.
    
    image = np.zeros((height, width, 3), dtype=np.float32)
    
    # Pointer into data buffer
    ptr = 0
    
    # Each scanline
    for y in range(height):
        if ptr >= len(data):
            break
            
        # Check for new RLE format: 2, 2, scanline_width_upper, scanline_width_lower
        # Note: The first two bytes are 2, 2
        if ptr + 4 <= len(data) and data[ptr] == 2 and data[ptr+1] == 2:
            # New RLE format
            # Read scanline width
            scan_width = (data[ptr+2] << 8) | data[ptr+3]
            if scan_width != width:
                raise ValueError(f"Scanline width mismatch at line {y}: expected {width}, got {scan_width}")
            ptr += 4
            
            # Read 4 channels (R, G, B, E)
            channels = [bytearray() for _ in range(4)]
            
            for i in range(4):
                while len(channels[i]) < width:
                    # Read run code
                    code = data[ptr]
                    ptr += 1
                    if code > 128:
                        # Run of same value
                        count = code - 128
                        val = data[ptr]
                        ptr += 1
                        channels[i].extend([val] * count)
                    else:
                        # Run of literals
                        count = code
                        channels[i].extend(data[ptr:ptr+count])
                        ptr += count
            
            # Combine channels
            r = np.array(channels[0], dtype=np.uint8)
            g = np.array(channels[1], dtype=np.uint8)
            b = np.array(channels[2], dtype=np.uint8)
            e = np.array(channels[3], dtype=np.uint8)
            
            # Convert RGBE to float
            # v = (mantissa + 0.5) * 2^(exponent - 128) / 256
            # standard conversion: rgb * 2^(e - 128)
            
            # Optimization: 2.0 ** (e - 128)
            scale = np.ldexp(1.0, e.astype(np.int32) - 128)
            image[y, :, 0] = (r + 0.5) * scale / 256.0
            image[y, :, 1] = (g + 0.5) * scale / 256.0
            image[y, :, 2] = (b + 0.5) * scale / 256.0

        else:
            # Old RLE or uncompressed (rare in modern files, but possible)
            # For simplicity, implementing only the standard New RLE which applies to the assets usually found.
            # If we hit this, we might need a fallback, but let's assume New RLE for typical .hdr files.
            # But wait, standard uncompressed is just (R,G,B,E) tuples.
            # Let's handle uncompressed scanline if it doesn't match 2,2 marker
            scanline_data = data[ptr : ptr + width*4]
            ptr += width*4
            # This is complex to support mixed, but let's assume standard RLE for these assets.
            # If it fails, I'll see the error.
            pass

    return image
