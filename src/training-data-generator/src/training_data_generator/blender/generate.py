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

def unwrap_object(obj):
    """Unwrap UVs for an object."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

def create_rocket(texture_image=None, body_radius=0.15, body_height=0.8, nose_height=0.3, 
                  num_fins=3, fin_span=0.2, fin_root_chord=0.2, fin_tip_chord=0.1, fin_sweep=0.1):
    """Create a rocket model with specific dimensions."""
    # Material
    mat = bpy.data.materials.new(name="RocketMat")
    # mat.use_nodes = True # Deprecated in 4.0+
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    
    if texture_image:
        tex_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex_node.image = texture_image
        mat.node_tree.links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
    else:
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
        
        fin.rotation_euler = (0, 0, angle)
        
        fin_z_loc = -(body_height / 2) + fin_root_chord
        
        fin.location.x = body_radius * math.cos(angle)
        fin.location.y = body_radius * math.sin(angle)
        fin.location.z = fin_z_loc
        
        fin.parent = body
        fin.matrix_parent_inverse = body.matrix_world.inverted()
        
    # Unwrap UVs for everything to ensure texture shows up
    unwrap_object(body)
    unwrap_object(nose)
    for child in body.children:
        unwrap_object(child)
        
    return body

def delete_rocket(rocket):
    """Delete the rocket and its children."""
    if rocket is None:
        return
    
    # Remove material
    if rocket.data and rocket.data.materials:
        mat = rocket.data.materials[0]
        bpy.data.materials.remove(mat, do_unlink=True)
        
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
    
    # Enable motion blur
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    
    # World settings (for HDRI)
    world = bpy.data.worlds.new("World")
    scene.world = world
    # world.use_nodes = True # Deprecated in 4.0+
    
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
    parser.add_argument("--texture-dir", required=False, help="Directory containing rocket textures")
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

    # Get Texture files
    texture_files = []
    if args.texture_dir and os.path.exists(args.texture_dir):
        texture_files = [
            os.path.join(args.texture_dir, f)
            for f in os.listdir(args.texture_dir)
            if f.lower().endswith(('.png', '.jpg', '.jpeg'))
        ]
        if not texture_files:
            print(f"No texture files found in {args.texture_dir}, using default gray.", file=sys.stderr)
    elif args.texture_dir:
        print(f"Texture directory not found: {args.texture_dir}, using default gray.", file=sys.stderr)

    # Setup
    reset_scene()
    
    # Set default interpolation to linear to avoid curve editing issues
    # This must be done on the user preferences, but since we are in background mode,
    # we can try to set it, or just handle keyframes differently.
    # However, accessing preferences in background mode can be tricky if they are not initialized.
    # But usually it works.
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    
    camera, world = setup_scene(samples=args.samples)
    
    # Load textures into Blender data once to avoid reloading
    loaded_textures = []
    for tex_path in texture_files:
        try:
            img = bpy.data.images.load(tex_path)
            loaded_textures.append(img)
        except Exception as e:
            print(f"Failed to load texture: {tex_path}. Error: {e}")

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
        body_h = random.uniform(0.5, 2.5)
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
            
        # Pick random texture if available
        tex_image = random.choice(loaded_textures) if loaded_textures else None
            
        rocket = create_rocket(
            texture_image=tex_image,
            body_radius=body_r,
            body_height=body_h,
            nose_height=nose_h,
            num_fins=num_fins,
            fin_span=fin_span,
            fin_root_chord=fin_root_chord,
            fin_tip_chord=fin_tip_chord,
            fin_sweep=fin_sweep
        )
        
        # Randomize rocket rotation (-45 to 45 degrees on each axis)
        rot_x = math.radians(random.uniform(-45, 45))
        rot_y = math.radians(random.uniform(-45, 45))
        rot_z = math.radians(random.uniform(-45, 45))
        rocket.rotation_euler = (rot_x, rot_y, rot_z)
        
        # Add motion blur (animate movement in direction of nose)
        # Calculate forward vector (local Z axis transformed by rotation)
        # Rocket is built along Z, so local forward is (0,0,1)
        # We need to apply the rotation matrix to this vector
        rot_mat = rocket.rotation_euler.to_matrix()
        forward_vec = rot_mat @ Vector((0, 0, 1))
        
        # Random speed (distance per frame)
        speed = random.uniform(0.0, 1.5)
        velocity = forward_vec * speed
        
        # Animate location
        # Frame 0: -velocity
        # Frame 2: +velocity
        # Frame 1 (render): (0,0,0) - interpolated
        
        rocket.location = -velocity
        rocket.keyframe_insert(data_path="location", frame=0)
        
        rocket.location = velocity
        rocket.keyframe_insert(data_path="location", frame=2)
        
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
