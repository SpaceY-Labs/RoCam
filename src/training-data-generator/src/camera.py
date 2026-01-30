import numpy as np

def generate_rays(width, height, fov_deg, cam_pos, cam_target, cam_up=np.array([0, 1, 0])):
    """
    Generate camera rays for a pinhole camera.
    Returns:
    rays_o: (H*W, 3) origin
    rays_d: (H*W, 3) normalized direction
    """
    aspect = width / height
    fov_rad = np.deg2rad(fov_deg)
    
    # Screen height in normalized view coords
    # distance to plane = 1
    # tan(fov/2) = (h/2) / 1
    t = np.tan(fov_rad / 2)
    screen_height = 2 * t
    screen_width = screen_height * aspect
    
    # Camera basis
    w = cam_pos - cam_target # forward (camera looks -w)
    w = w / np.linalg.norm(w)
    
    u = np.cross(cam_up, w)
    if np.linalg.norm(u) < 1e-6:
        # Looking straight up or down
        u = np.cross(np.array([1, 0, 0]), w)
    u = u / np.linalg.norm(u)
    
    v = np.cross(w, u)
    
    # Pixel grid
    i, j = np.meshgrid(np.arange(width), np.arange(height), indexing='xy')
    
    # Normalize to [-1, 1]
    # (i + 0.5) / width -> [0, 1]
    # * 2 - 1 -> [-1, 1]
    # But we want 0 to be center.
    
    px = (i + 0.5) / width * 2 - 1
    py = (j + 0.5) / height * 2 - 1
    
    # Flip y because image y is down, but 3D y is up usually
    py = -py 
    
    # Scale by screen size
    px *= (screen_width / 2)
    py *= (screen_height / 2)
    
    # Ray direction in camera space: (px, py, -1)
    # Transform to world
    # D = px * u + py * v - w
    
    # Flatten
    px = px.flatten()
    py = py.flatten()
    
    # (N, 3)
    # rays_d = px[:, None] * u + py[:, None] * v - w
    # Optimized:
    rays_d = np.outer(px, u) + np.outer(py, v) - w
    
    # Normalize
    norm = np.linalg.norm(rays_d, axis=1, keepdims=True)
    rays_d = rays_d / norm
    
    # Rays origin is constant
    rays_o = np.broadcast_to(cam_pos, rays_d.shape)
    
    return rays_o, rays_d

def sample_camera_pose(rng):
    """
    Randomly sample a camera pose looking at the cube.
    Cube is at (0, 0.5, 0) with size 1.
    Ground is y=0.
    
    Returns: pos, target, fov
    """
    # Target near center of cube
    target = np.array([0.0, 0.5, 0.0]) + rng.uniform(-0.1, 0.1, 3)
    
    # Spherical coordinates
    # Distance: 2 to 5 units
    dist = rng.uniform(2.0, 5.0)
    
    # Yaw: 0 to 2pi
    yaw = rng.uniform(0, 2 * np.pi)
    
    # Pitch: restricted to be above ground
    # 0 is horizontal, pi/2 is top-down
    # Allow 10 deg to 80 deg elevation
    pitch = rng.uniform(np.deg2rad(10), np.deg2rad(80))
    
    # Convert to Cartesian
    # y = dist * sin(pitch)
    # r = dist * cos(pitch)
    # x = r * cos(yaw)
    # z = r * sin(yaw)
    
    y = dist * np.sin(pitch)
    r = dist * np.cos(pitch)
    x = r * np.cos(yaw)
    z = r * np.sin(yaw)
    
    pos = np.array([x, y, z])
    
    # FOV: 30 to 70 degrees
    fov = rng.uniform(30, 70)
    
    return pos, target, fov
