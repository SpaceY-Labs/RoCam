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

def create_fin_mesh(name, span, root_chord, tip_chord, sweep):
    """Create a custom fin mesh."""
    # Vertices for a trapezoidal fin in X-Z plane (Z is up)
    # Root LE at (0, 0, 0)
    # Root TE at (0, 0, -root_chord)
    # Tip LE at (span, 0, -sweep)
    # Tip TE at (span, 0, -sweep - tip_chord)
    
    verts = [
        (0, 0, 0),                          # 0: Root LE
        (span, 0, -sweep),                  # 1: Tip LE
        (span, 0, -sweep - tip_chord),      # 2: Tip TE
        (0, 0, -root_chord),                # 3: Root TE
    ]
    
    faces = [(0, 1, 2, 3)]
    
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    
    return mesh

def create_rocket(body_radius=0.15, body_height=0.8, nose_height=0.3, 
                  num_fins=3, fin_span=0.2, fin_root_chord=0.2, fin_tip_chord=0.1, fin_sweep=0.1):
    """Create a rocket model with specific dimensions."""
    # Material
    mat = bpy.data.materials.get("RocketMat")
    if mat is None:
        mat = bpy.data.materials.new(name="RocketMat")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1) # Gray
        bsdf.inputs['Roughness'].default_value = 0.5

    # Body Tube (Cylinder)
    bpy.ops.mesh.primitive_cylinder_add(
        radius=body_radius, 
        depth=body_height, 
        location=(0, 0, 0)
    )
    body = bpy.context.active_object
    body.name = "RocketBody"
    body.data.materials.append(mat)

    # Nose Cone
    # Sits on top of cylinder. 
    # Cylinder top is at z = body_height / 2
    # Cone center is at z = body_height / 2 + nose_height / 2
    nose_z = (body_height / 2) + (nose_height / 2)
    
    bpy.ops.mesh.primitive_cone_add(
        radius1=body_radius, 
        radius2=0, 
        depth=nose_height, 
        location=(0, 0, nose_z)
    )
    nose = bpy.context.active_object
    nose.name = "RocketNose"
    nose.data.materials.append(mat)
    
    # Parent nose to body
    nose.parent = body
    nose.matrix_parent_inverse = body.matrix_world.inverted()

    # Fins (custom mesh)
    for i in range(num_fins):
        angle = (2 * math.pi / num_fins) * i
        
        # Create fin mesh
        mesh = create_fin_mesh(f"FinMesh_{i}", fin_span, fin_root_chord, fin_tip_chord, fin_sweep)
        fin = bpy.data.objects.new(f"RocketFin_{i}", mesh)
        bpy.context.collection.objects.link(fin)
        
        fin.data.materials.append(mat)
        
        # Rotate 90 deg on X (vertical) is NOT needed because we defined it in X-Z plane directly?
        # Wait, create_fin_mesh defined it in X-Z plane where Z is up.
        # But we want the fin to stick out radially.
        # If we rotate by 'angle' around Z, the X axis points radially out.
        # So we just need to rotate by 'angle' around Z.
        
        # However, create_fin_mesh uses Z for the vertical dimension of the fin.
        # If we just rotate around Z, the fin will be vertical.
        # That's what we want.
        
        fin.rotation_euler = (0, 0, angle)
        
        # Position
        # The fin root is at (0,0,0) in local coords.
        # We want to shift it out by body_radius.
        # And shift it down to the bottom of the rocket.
        
        # Local shift in X (radial)
        # Local shift in Z (vertical)
        
        # We can set location directly
        # X shift: body_radius * cos(angle)
        # Y shift: body_radius * sin(angle)
        # Z shift: -body_height/2 + (some offset to align bottom of fin)
        
        # Let's align the bottom of the fin (Root TE) with the bottom of the rocket.
        # Root TE is at z = -root_chord in local coords.
        # Bottom of rocket is at z = -body_height/2.
        # So we want local z=-root_chord to map to world z=-body_height/2.
        # So origin (local z=0) should be at world z = -body_height/2 + root_chord.
        
        fin_z_loc = -(body_height / 2) + fin_root_chord
        
        fin.location.x = body_radius * math.cos(angle)
        fin.location.y = body_radius * math.sin(angle)
        fin.location.z = fin_z_loc
        
        fin.parent = body
        fin.matrix_parent_inverse = body.matrix_world.inverted()
        
    return body

def delete_rocket(rocket):
    """Delete the rocket and its children."""
    if rocket is None:
        return
    # Collect children
    children = [child for child in rocket.children]
    for child in children:
        bpy.data.objects.remove(child, do_unlink=True)
    bpy.data.objects.remove(rocket, do_unlink=True)

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

def randomize_camera(camera, min_radius=20.0, max_radius=50.0, 
                     min_elev=-90, max_elev=10, 
                     min_fov=45, max_fov=70):
    """
    Randomize camera position on a spherical shell sector.
    Randomize target look-at point (fixed at origin).
    Uses uniform sampling on the sphere surface (sine of elevation)
    to avoid clustering at the poles.
    """
    # Random spherical coords
    r = random.uniform(min_radius, max_radius)
    theta = random.uniform(0, 2 * math.pi) # Azimuth
    
    # Convert elevation range to sine range (z/r)
    # elev = 90 -> z/r = 1
    # elev = 0 -> z/r = 0
    # elev = -90 -> z/r = -1
    min_sin_phi = math.sin(math.radians(min_elev))
    max_sin_phi = math.sin(math.radians(max_elev))
    
    # Sample z component uniformly
    u = random.uniform(min_sin_phi, max_sin_phi)
    
    # Calculate coordinates
    z = r * u
    # horizontal radius at height z
    # r^2 = x^2 + y^2 + z^2
    # rho = sqrt(r^2 - z^2)
    # Use max(0, ...) to avoid domain error due to float precision
    rho = math.sqrt(max(0, r*r - z*z))
    
    x = rho * math.cos(theta)
    y = rho * math.sin(theta)
    
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

        # Randomize rocket parameters
        # Body Height: 0.5 - 2.5m
        # Body Radius: 0.05 - 0.3m
        # Nose Height: 0.2 - 0.8m
        # Fin parameters
        body_h = random.uniform(1.0, 5.0)
        body_r = random.uniform(0.05, 0.3)
        nose_h = random.uniform(0.2, 0.8)
        
        num_fins = random.randint(3, 5)
        fin_span = random.uniform(0.1, 0.4)
        fin_root_chord = random.uniform(0.15, 0.5)
        fin_tip_chord = random.uniform(0.05, 0.3)
        fin_sweep = random.uniform(0.0, 0.3)
        
        # Ensure tip chord isn't larger than root chord (usually)
        if fin_tip_chord > fin_root_chord:
            fin_tip_chord = fin_root_chord * random.uniform(0.5, 1.0)
            
        rocket = create_rocket(
            body_radius=body_r,
            body_height=body_h,
            nose_height=nose_h,
            num_fins=num_fins,
            fin_span=fin_span,
            fin_root_chord=fin_root_chord,
            fin_tip_chord=fin_tip_chord,
            fin_sweep=fin_sweep
        )
        
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
        
        # Cleanup
        delete_rocket(rocket)

if __name__ == "__main__":
    main()
