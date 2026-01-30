import numpy as np

class EnvironmentMap:
    def __init__(self, data):
        """
        data: (H, W, 3) float32 numpy array of linear RGB values.
        """
        self.data = data
        self.height, self.width, _ = data.shape
        
        # Pre-calculate sin(theta) for solid angle weighting if needed, 
        # but for simple importance sampling or cosine weighted sampling we might do it differently.
        # For 'fast' mode, we might just sample the hemisphere in the shader.
        
    def sample_bilinear(self, dir_vectors):
        """
        Sample the environment map for a batch of direction vectors (N, 3).
        Vectors should be normalized.
        Returns (N, 3) RGB values.
        """
        # Convert (x, y, z) to spherical (phi, theta)
        # Standard convention: Y is up? 
        # Usually HDRIs are equirectangular where Y is up in 3D space?
        # Let's assume standard: Y is up.
        # phi = atan2(z, x)  (longitude) [-pi, pi]
        # theta = acos(y)    (latitude)  [0, pi]
        
        x = dir_vectors[:, 0]
        y = dir_vectors[:, 1]
        z = dir_vectors[:, 2]
        
        phi = np.arctan2(z, x) # -pi to pi
        theta = np.arccos(np.clip(y, -1.0, 1.0)) # 0 to pi (0 is +y pole)
        
        # Map to UV [0, 1]
        # u = (phi + pi) / (2pi)
        # v = theta / pi
        
        u = (phi + np.pi) / (2.0 * np.pi)
        v = theta / np.pi
        
        # Map to pixel coords
        # U corresponds to X (width), V corresponds to Y (height)
        px = u * self.width - 0.5
        py = v * self.height - 0.5
        
        # Wrap X (u), Clamp Y (v)
        x0 = np.floor(px).astype(np.int32)
        y0 = np.floor(py).astype(np.int32)
        
        x1 = x0 + 1
        y1 = y0 + 1
        
        # Bilinear weights
        wx = px - x0
        wy = py - y0
        
        # Wrap x
        x0 = x0 % self.width
        x1 = x1 % self.width
        
        # Clamp y
        y0 = np.clip(y0, 0, self.height - 1)
        y1 = np.clip(y1, 0, self.height - 1)
        
        # Gather samples
        # shape (N, 3)
        v00 = self.data[y0, x0]
        v10 = self.data[y0, x1]
        v01 = self.data[y1, x0]
        v11 = self.data[y1, x1]
        
        # Interpolate
        # (1-wx)*v00 + wx*v10
        top = v00 * (1 - wx)[:, None] + v10 * wx[:, None]
        bot = v01 * (1 - wx)[:, None] + v11 * wx[:, None]
        
        val = top * (1 - wy)[:, None] + bot * wy[:, None]
        return val

