import numpy as np
from PIL import Image
from tqdm import tqdm
from .geometry import intersect_ray_box
from .camera import generate_rays
from .envmap import EnvironmentMap

def render_image(env_map: EnvironmentMap, width, height, cam_pos, cam_target, fov, quality='fast', box_min=None, box_max=None):
    """
    Render a single image.
    """
    if box_min is None: box_min = np.array([-0.5, 0.0, -0.5])
    if box_max is None: box_max = np.array([0.5, 1.0, 0.5])
    
    # Generate rays
    rays_o, rays_d = generate_rays(width, height, fov, cam_pos, cam_target)
    
    # Intersect
    t_hit, normals = intersect_ray_box(rays_o, rays_d, box_min, box_max)
    
    # Initialize output buffer (N, 3)
    # Default to environment background
    pixel_colors = env_map.sample_bilinear(rays_d)
    
    # Where we hit the cube
    hit_mask = np.isfinite(t_hit)
    
    if np.any(hit_mask):
        hit_normals = normals[hit_mask]
        
        # Simple lighting model:
        # Diffuse + Specular
        # For 'fast' quality, we might just use a few samples or a pre-convolved irradiance approach.
        # But we don't have pre-convolved.
        # So let's do importance sampling or cosine weighted sampling on the hemisphere.
        
        # Number of samples
        n_samples = 4 if quality == 'fast' else (16 if quality == 'balanced' else 64)
        
        # We need a random number generator for Monte Carlo
        rng = np.random.default_rng()
        
        diffuse_accum = np.zeros((np.sum(hit_mask), 3), dtype=np.float32)
        
        # Basis for hemisphere sampling
        # Construct arbitrary tangent space from normal
        # normal is Z
        N = hit_normals
        
        # Create helper vector
        # if abs(Nx) < 0.9, use (1,0,0), else (0,1,0)
        helper = np.where(np.abs(N[:, 0:1]) < 0.9, np.array([1,0,0]), np.array([0,1,0]))
        T = np.cross(helper, N)
        T = T / np.linalg.norm(T, axis=1, keepdims=True)
        B = np.cross(N, T)
        
        # Monte Carlo loop
        for _ in range(n_samples):
            # Cosine weighted sample
            # r1, r2 uniform [0,1]
            r1 = rng.random(len(N))
            r2 = rng.random(len(N))
            
            # concentric mapping or simple polar
            # phi = 2*pi*r1
            # theta = acos(sqrt(1-r2)) -> sin(theta) = sqrt(r2) ? 
            # standard cosine weighted:
            # theta = acos(sqrt(r1))
            # phi = 2 pi r2
            
            # local direction
            # x = sin(theta) cos(phi) = sqrt(1-r1) cos(2pi r2)
            # y = sin(theta) sin(phi) = sqrt(1-r1) sin(2pi r2)
            # z = cos(theta)        = sqrt(r1)
            
            sqrt_r1 = np.sqrt(r1)
            sqrt_1_minus_r1 = np.sqrt(1 - r1)
            phi = 2 * np.pi * r2
            
            lx = sqrt_1_minus_r1 * np.cos(phi)
            ly = sqrt_1_minus_r1 * np.sin(phi)
            lz = sqrt_r1
            
            # Transform to world space
            # L = xT + yB + zN
            sample_dir = lx[:, None] * T + ly[:, None] * B + lz[:, None] * N
            
            # Sample environment
            # Note: We assume no occlusion for environment (cube is alone in space)
            # Actually, the ground plane occludes the bottom hemisphere!
            # If sample_dir.y < 0, it hits ground (black or ground color).
            # Let's assume ground is dark or checks, or just shadow catcher.
            # For simplicity, if y < 0, zero light (ground blocks).
            
            env_sample = env_map.sample_bilinear(sample_dir)
            
            # Ground occlusion check
            # We assume cube is on plane y=0.
            # If ray direction is down (y<0) and origin > 0, it hits ground.
            # Hit points are on cube surface. Some are on top, some side.
            # If y < 0, zero contribution.
            
            # But wait, sample_dir is normalized.
            mask_ground = sample_dir[:, 1] < 0
            env_sample[mask_ground] = 0.0
            
            diffuse_accum += env_sample
            
        diffuse = diffuse_accum / n_samples
        
        # Specular term (perfect reflection)
        # R = I - 2(N.I)N
        # I is incoming ray (rays_d), we need reflection of view vector
        # View vector V = -rays_d
        # R = -V + 2(N.V)N = rays_d - 2(rays_d.N)N
        # Wait, standard reflection formula: R = D - 2(D.N)N
        
        D_hit = rays_d[hit_mask]
        dot = np.sum(D_hit * N, axis=1, keepdims=True)
        R = D_hit - 2 * dot * N
        
        specular = env_map.sample_bilinear(R)
        
        # Fresnel (Schlick)
        # F0 = 0.04 (plastic/dielectric)
        # F = F0 + (1-F0) * (1 - max(0, -D.N))^5
        cos_theta = np.maximum(0.0, -dot)
        F0 = 0.04
        F = F0 + (1 - F0) * np.power(1.0 - cos_theta, 5)
        
        # Combine
        # Color = Diffuse * (1-F) * Albedo + Specular * F
        # Gray cube albedo = 0.5
        albedo = 0.5
        
        pixel_color_hit = diffuse * (1.0 - F) * albedo + specular * F
        
        pixel_colors[hit_mask] = pixel_color_hit

    # Reshape
    img_linear = pixel_colors.reshape((height, width, 3))
    
    # Tonemap
    # Simple Reinhard or Exposure
    # exposure = 1.0 / percentile?
    # Let's use robust max
    
    # Auto-exposure: map 90th percentile to 0.8
    # Avoid zero
    vals = np.linalg.norm(img_linear, axis=2)
    p90 = np.percentile(vals, 90)
    if p90 < 1e-4: p90 = 1.0
    exposure = 0.8 / p90
    
    img_exposed = img_linear * exposure
    
    # Gamma correction
    # sRGB approx: x^(1/2.2)
    img_srgb = np.power(np.clip(img_exposed, 0, 1), 1.0/2.2)
    
    # Convert to uint8
    img_uint8 = (img_srgb * 255).astype(np.uint8)
    
    return Image.fromarray(img_uint8)
