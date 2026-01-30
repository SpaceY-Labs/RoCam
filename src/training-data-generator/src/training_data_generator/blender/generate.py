import bpy
import os
import sys
import random
import math
import argparse
from mathutils import Vector

def reset_scene():
    """Clear existing objects."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

def setup_scene(resolution_x=1280, resolution_y=720, samples=128):
    """Setup basic scene settings: Cycles, resolution, ground, cube."""
    # Render settings
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU' # Or GPU if available, but keep safe with CPU/auto
    try:
        # Try to use GPU if available
        preferences = bpy.context.preferences
        cycles_preferences = preferences.addons['cycles'].preferences
        cycles_preferences.refresh_devices()
        devices = cycles_preferences.devices
        if devices:
            # enable all devices
            for device in devices:
                device.use = True
            scene.cycles.device = 'GPU'
    except Exception:
        pass # Fallback to CPU

    scene.render.resolution_x = resolution_x
    scene.render.resolution_y = resolution_y
    scene.render.image_settings.file_format = 'PNG'
    scene.cycles.samples = samples
    
    # World settings (for HDRI)
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    
    # Create Cube
    # Cube size 2m default -> center at (0,0,0)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    cube = bpy.context.active_object
    cube.name = "TargetCube"
    
    # Gray Material for Cube
    mat_cube = bpy.data.materials.new(name="CubeMat")
    mat_cube.use_nodes = True
    bsdf_cube = mat_cube.node_tree.nodes["Principled BSDF"]
    bsdf_cube.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1) # Middle gray
    bsdf_cube.inputs['Roughness'].default_value = 0.5
    cube.data.materials.append(mat_cube)

    # Create Camera
    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    camera.name = "Camera"
    scene.camera = camera
    
    return camera, world

def set_hdri(world, hdri_path):
    """Set the background HDRI."""
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    
    # Clear existing nodes connected to Background
    for node in nodes:
        if node.type == 'TEX_ENVIRONMENT':
            nodes.remove(node)
            
    bg_node = nodes.get("Background")
    if not bg_node: # Should exist by default but just in case
        bg_node = nodes.new('ShaderNodeBackground')
        output = nodes.get("World Output")
        links.new(bg_node.outputs[0], output.inputs[0])

    env_tex_node = nodes.new('ShaderNodeTexEnvironment')
    env_tex_node.image = bpy.data.images.load(hdri_path)
    
    links.new(env_tex_node.outputs['Color'], bg_node.inputs['Color'])

def look_at(obj, target):
    """Point object at target vector."""
    direction = target - obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    obj.rotation_euler = rot_quat.to_euler()

def randomize_camera(camera, min_radius=3.0, max_radius=8.0, 
                     min_elev=-80, max_elev=-10, 
                     min_fov=30, max_fov=90):
    """
    Randomize camera position on a spherical shell sector (below ground).
    Randomize target look-at point (fixed at origin).
    """
    # Random spherical coords
    r = random.uniform(min_radius, max_radius)
    theta = random.uniform(0, 2 * math.pi) # Azimuth
    
    # Elevation: 0 is horizon, 90 is zenith, -90 is nadir.
    # We want below ground, so negative elevation.
    phi_deg = random.uniform(min_elev, max_elev) 
    phi = math.radians(90 - phi_deg) # Polar angle from Z-up (0 is up)
    
    # Convert to Cartesian
    x = r * math.sin(phi) * math.cos(theta)
    y = r * math.sin(phi) * math.sin(theta)
    z = r * math.cos(phi)
    
    camera.location = Vector((x, y, z))
    
    # Target always at origin
    target = Vector((0, 0, 0))
    
    look_at(camera, target)
    
    # FOV
    fov_deg = random.uniform(min_fov, max_fov)
    camera.data.angle = math.radians(fov_deg)

def main():
    # Parse arguments passed after "--"
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1:]
    else:
        argv = []

    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--hdri-dir", required=True)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--samples", type=int, default=32)
    args = parser.parse_args(argv)

    if args.seed is not None:
        random.seed(args.seed)

    # Ensure output directory exists (should be done by caller, but safe to check)
    os.makedirs(args.out_dir, exist_ok=True)

    # Get HDRI files
    if not os.path.exists(args.hdri_dir):
        print(f"HDRI directory not found: {args.hdri_dir}", file=sys.stderr)
        sys.exit(1)
        
    hdri_files = [
        os.path.join(args.hdri_dir, f) 
        for f in os.listdir(args.hdri_dir) 
        if f.lower().endswith(('.hdr', '.exr'))
    ]
    
    if not hdri_files:
        print(f"No HDRI files found in {args.hdri_dir}", file=sys.stderr)
        sys.exit(1)

    # Setup
    reset_scene()
    camera, world = setup_scene(samples=args.samples)
    
    # Loop
    print(f"Starting generation of {args.count} images...")
    for i in range(args.count):
        # Pick random HDRI
        hdri_path = random.choice(hdri_files)
        set_hdri(world, hdri_path)
        
        # Randomize camera
        randomize_camera(camera)
        
        # Render
        filename = f"{i:06d}.png"
        filepath = os.path.join(args.out_dir, filename)
        bpy.context.scene.render.filepath = filepath
        
        # Suppress render output to stdout to avoid clutter
        # We can redirect stdout temporarily or just let it fly. 
        # Blender output is noisy. 
        bpy.ops.render.render(write_still=True)
        print(f"Generated {i+1}/{args.count}: {filepath}")

if __name__ == "__main__":
    main()
