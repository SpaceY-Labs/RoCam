import numpy as np

def intersect_ray_box(rays_o, rays_d, box_min, box_max):
    """
    Vectorized Ray-AABB intersection.
    rays_o, rays_d: (N, 3) arrays
    box_min, box_max: (3,) arrays
    
    Returns:
    t: (N,) distance to intersection. inf if no hit.
    normal: (N, 3) normal at intersection point. zero if no hit.
    """
    
    # slab method
    # t = (plane - origin) / direction
    
    # prevent div by zero
    inv_d = 1.0 / np.where(rays_d == 0, 1e-10, rays_d)
    
    t0 = (box_min - rays_o) * inv_d
    t1 = (box_max - rays_o) * inv_d
    
    tmin = np.minimum(t0, t1)
    tmax = np.maximum(t0, t1)
    
    # max of mins
    t_enter = np.max(tmin, axis=1)
    # min of maxs
    t_exit = np.min(tmax, axis=1)
    
    # hit if t_enter <= t_exit and t_exit > 0
    mask = (t_enter <= t_exit) & (t_exit > 0)
    
    # For box sitting on ground, camera is usually outside.
    # So the hit distance is t_enter.
    # If camera is inside (should not happen with our constraints), it would be t_exit.
    # We take t_enter if t_enter > 0, else t_exit? 
    # Let's assume camera is outside.
    t_hit = np.where(mask, t_enter, np.inf)
    
    # Calculate normals
    # The normal depends on which face we hit.
    # A simple way for AABB: compare hit point to planes
    # But we can also derive it from which component of tmin was max.
    
    # Identify which axis maximized t_enter
    # t_enter is max(tmin_x, tmin_y, tmin_z)
    
    # We need to compute normals only for hits
    normals = np.zeros_like(rays_d)
    
    if np.any(mask):
        hit_indices = np.where(mask)[0]
        
        # Extract subset for efficiency
        t_sub = t_hit[hit_indices]
        # Which axis gave the intersection?
        # We need to know which component of tmin corresponded to t_enter
        
        tmin_sub = tmin[hit_indices] # (M, 3)
        # argmax along axis 1
        axis = np.argmax(tmin_sub, axis=1)
        
        # Normal direction is -sign(ray_d) for that axis
        # e.g. if ray is moving +x, and hits min_x plane, normal is -x
        # Wait, t0 = (min - o) / d. If d > 0, t0 is entry for min plane. Normal is -1.
        # If d < 0, t1 is entry for max plane. Normal is +1.
        
        # Let's use a simpler heuristic:
        # P = O + tD
        # For a cube centered at C with radius R (actually half-extents):
        # Normal is (P - C) / R, then stepified.
        # But our box is arbitrary min/max.
        # Center = (min+max)/2
        # Extent = (max-min)/2
        # P_local = P - Center
        # Normal is step(P_local / Extent) approx
        
        O_sub = rays_o[hit_indices] if rays_o.ndim > 1 else rays_o
        D_sub = rays_d[hit_indices]
        P = O_sub + D_sub * t_sub[:, None]
        
        center = (box_min + box_max) * 0.5
        extents = (box_max - box_min) * 0.5
        
        local_p = P - center
        # normalize by extents
        # use a small epsilon for robustness
        # bias = local_p / extents
        # The largest component in magnitude is the normal axis
        
        # But we can just use the 'axis' we found earlier.
        # If axis=0 (x), check direction of ray x.
        # If ray_x < 0, we hit the +X face -> normal +X
        # If ray_x > 0, we hit the -X face -> normal -X
        
        signs = -np.sign(D_sub)
        
        # We need to select the component based on 'axis'
        # One-hot encoding of axis
        one_hot = np.zeros_like(D_sub)
        one_hot[np.arange(len(axis)), axis] = 1.0
        
        normals[hit_indices] = one_hot * signs * one_hot # signs * one_hot gives the vector with correct sign
        
    return t_hit, normals
