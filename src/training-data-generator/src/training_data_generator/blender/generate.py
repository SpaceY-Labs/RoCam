import bpy
import os
import sys
import random
import math
import argparse
from mathutils import Vector
import bpy_extras

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

    # Volumetric smoke trail: 25% chance no smoke; else randomized length, size, gap
    if random.random() >= 0.25:
        trail_length = random.uniform(25.0, 60.0)
        trail_radius_start = body_radius * random.uniform(1.2, 2.0)  # narrow at rocket exit
        trail_radius_end = random.uniform(2.0, 6.0)  # wide at far end
        # Volume domain: cone narrow at rocket, wide at far end (starts at rocket tail)
        cone_center_z = -(body_height / 2) - (trail_length / 2)
        bpy.ops.mesh.primitive_cone_add(
            radius1=trail_radius_end,
            radius2=trail_radius_start,
            depth=trail_length,
            location=(0, 0, cone_center_z),
        )
        trail_obj = bpy.context.active_object
        trail_obj.name = "SmokeTrail"
        trail_obj.parent = body
        trail_obj.matrix_parent_inverse = body.matrix_world.inverted()
        trail_obj.cycles.use_motion_blur = False

        # Volumetric material: soft radial falloff + noise for wispy, irregular edges
        smoke_mat = bpy.data.materials.new(name="SmokeTrailMat")
        nodes = smoke_mat.node_tree.nodes
        links = smoke_mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if bsdf:
            nodes.remove(bsdf)
        output_node = nodes.get("Material Output")
        principled_vol = nodes.new("ShaderNodeVolumePrincipled")
        principled_vol.location = (400, 0)
        density_val = random.uniform(0.3, 0.7)
        smoke_gray = random.uniform(0.0, 1.0)
        principled_vol.inputs["Color"].default_value = (smoke_gray, smoke_gray, smoke_gray, 1)
        principled_vol.inputs["Anisotropy"].default_value = 0.0
        links.new(principled_vol.outputs["Volume"], output_node.inputs["Volume"])

        # Position in object space -> distance from Z axis (radial)
        tex_coord = nodes.new("ShaderNodeTexCoord")
        tex_coord.location = (-780, 0)
        separate_xyz = nodes.new("ShaderNodeSeparateXYZ")
        separate_xyz.location = (-620, 0)
        links.new(tex_coord.outputs["Object"], separate_xyz.inputs["Vector"])
        combine_xyz = nodes.new("ShaderNodeCombineXYZ")
        combine_xyz.inputs["Z"].default_value = 0.0
        combine_xyz.location = (-500, 0)
        links.new(separate_xyz.outputs["X"], combine_xyz.inputs["X"])
        links.new(separate_xyz.outputs["Y"], combine_xyz.inputs["Y"])
        vec_length = nodes.new("ShaderNodeVectorMath")
        vec_length.operation = "LENGTH"
        vec_length.location = (-380, 0)
        links.new(combine_xyz.outputs["Vector"], vec_length.inputs[0])
        # Normalize by max radius so 0=center, ~1=edge
        max_radius_inv = 1.0 / (trail_radius_end * 1.15)
        norm_radius = nodes.new("ShaderNodeMath")
        norm_radius.operation = "MULTIPLY"
        norm_radius.inputs[1].default_value = max_radius_inv
        norm_radius.location = (-260, 0)
        links.new(vec_length.outputs["Value"], norm_radius.inputs[0])
        # Edge noise: perturb radius so boundary is wispy (not a straight cone edge)
        edge_noise = nodes.new("ShaderNodeTexNoise")
        edge_noise.inputs["Scale"].default_value = random.uniform(1.2, 3.0)
        edge_noise.inputs["Detail"].default_value = 3.0
        edge_noise.location = (-500, -180)
        noise_scale = nodes.new("ShaderNodeMath")
        noise_scale.operation = "MULTIPLY"
        noise_scale.inputs[1].default_value = random.uniform(0.2, 0.35)
        noise_scale.location = (-380, -120)
        links.new(edge_noise.outputs["Fac"], noise_scale.inputs[0])
        noise_add = nodes.new("ShaderNodeMath")
        noise_add.operation = "ADD"
        noise_add.location = (-260, -80)
        links.new(norm_radius.outputs["Value"], noise_add.inputs[0])
        links.new(noise_scale.outputs["Value"], noise_add.inputs[1])
        # Wavy modulation along trail (Z): sine wave so boundary undulates along length
        wave_freq = nodes.new("ShaderNodeMath")
        wave_freq.operation = "MULTIPLY"
        wave_freq.inputs[1].default_value = random.uniform(0.25, 0.7)
        wave_freq.location = (-500, -320)
        links.new(separate_xyz.outputs["Z"], wave_freq.inputs[0])
        wave_sine = nodes.new("ShaderNodeMath")
        wave_sine.operation = "SINE"
        wave_sine.location = (-380, -320)
        links.new(wave_freq.outputs["Value"], wave_sine.inputs[0])
        wave_amp = nodes.new("ShaderNodeMath")
        wave_amp.operation = "MULTIPLY"
        wave_amp.inputs[1].default_value = random.uniform(0.18, 0.38)
        wave_amp.location = (-260, -260)
        links.new(wave_sine.outputs["Value"], wave_amp.inputs[0])
        # Low-frequency noise along trail for irregular waviness (large-scale variation)
        wave_noise = nodes.new("ShaderNodeTexNoise")
        wave_noise.inputs["Scale"].default_value = random.uniform(0.15, 0.45)
        wave_noise.inputs["Detail"].default_value = 2.0
        wave_noise.location = (-500, -420)
        wave_noise_scale = nodes.new("ShaderNodeMath")
        wave_noise_scale.operation = "MULTIPLY"
        wave_noise_scale.inputs[1].default_value = random.uniform(0.15, 0.3)
        wave_noise_scale.location = (-380, -380)
        links.new(wave_noise.outputs["Fac"], wave_noise_scale.inputs[0])
        wave_add = nodes.new("ShaderNodeMath")
        wave_add.operation = "ADD"
        wave_add.location = (-140, -120)
        links.new(noise_add.outputs["Value"], wave_add.inputs[0])
        wave_add2 = nodes.new("ShaderNodeMath")
        wave_add2.operation = "ADD"
        wave_add2.location = (-140, -200)
        links.new(wave_amp.outputs["Value"], wave_add2.inputs[0])
        links.new(wave_noise_scale.outputs["Value"], wave_add2.inputs[1])
        links.new(wave_add2.outputs["Value"], wave_add.inputs[1])
        # Soft falloff: 1 at center, gradual to 0 at edge (no sharp boundary)
        falloff_ramp = nodes.new("ShaderNodeValToRGB")
        falloff_ramp.location = (-120, 0)
        falloff_ramp.color_ramp.elements[0].position = 0.0
        falloff_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
        falloff_ramp.color_ramp.elements[1].position = random.uniform(0.45, 0.7)
        falloff_ramp.color_ramp.elements[1].color = (0.35, 0.35, 0.35, 1)
        edge_el = falloff_ramp.color_ramp.elements.new(random.uniform(0.82, 0.98))
        edge_el.color = (0, 0, 0, 1)
        links.new(wave_add.outputs["Value"], falloff_ramp.inputs["Fac"])
        # Density = base noise * radial falloff (so edges fade softly)
        base_noise = nodes.new("ShaderNodeTexNoise")
        base_noise.inputs["Scale"].default_value = random.uniform(0.6, 1.8)
        base_noise.inputs["Detail"].default_value = 4.0
        base_noise.location = (-500, 120)
        base_mul = nodes.new("ShaderNodeMath")
        base_mul.operation = "MULTIPLY"
        base_mul.inputs[1].default_value = density_val
        base_mul.location = (-260, 120)
        links.new(base_noise.outputs["Fac"], base_mul.inputs[0])
        final_mul = nodes.new("ShaderNodeMath")
        final_mul.operation = "MULTIPLY"
        final_mul.location = (-40, 60)
        links.new(base_mul.outputs["Value"], final_mul.inputs[0])
        # Use R channel of ramp as falloff multiplier
        sep_color = nodes.new("ShaderNodeSeparateColor")
        sep_color.mode = "RGB"
        sep_color.location = (-120, -60)
        links.new(falloff_ramp.outputs["Color"], sep_color.inputs["Color"])
        red_out = sep_color.outputs.get("Red") or sep_color.outputs.get("R")
        links.new(red_out, final_mul.inputs[1])
        links.new(final_mul.outputs["Value"], principled_vol.inputs["Density"])

        trail_obj.data.materials.append(smoke_mat)

        # Flame at rocket tail (only when there is smoke): very thin, tapers to point at far end
        flame_depth = random.uniform(0.8, 2.5)
        flame_radius_start = body_radius * random.uniform(0.15, 0.35)  # very thin at rocket
        flame_center_z = -(body_height / 2) - (flame_depth / 2)  # narrow end at rocket tail, no gap
        bpy.ops.mesh.primitive_cone_add(
            radius1=0,
            radius2=flame_radius_start,
            depth=flame_depth,
            location=(0, 0, flame_center_z),
        )
        flame_obj = bpy.context.active_object
        flame_obj.name = "RocketFlame"
        flame_obj.parent = body
        flame_obj.matrix_parent_inverse = body.matrix_world.inverted()
        flame_obj.cycles.use_motion_blur = False
        # Bright emissive material: color randomized in red-to-white range (very bright for bloom)
        flame_mat = bpy.data.materials.new(name="FlameMat")
        fnodes = flame_mat.node_tree.nodes
        flinks = flame_mat.node_tree.links
        flame_bsdf = fnodes.get("Principled BSDF")
        if flame_bsdf:
            fnodes.remove(flame_bsdf)
        flame_emit = fnodes.new("ShaderNodeEmission")
        flame_emit.location = (0, 0)
        # Random color in range: red (low G,B) through orange/yellow to white (high G,B)
        flame_r = random.uniform(0.92, 1.0)
        flame_g = random.uniform(0.06, 1.0)
        flame_b = random.uniform(0.02, 1.0)
        flame_emit.inputs["Color"].default_value = (flame_r, flame_g, flame_b, 1)
        flame_emit.inputs["Strength"].default_value = random.uniform(100.0, 220.0)  # very bright for bloom
        flinks.new(flame_emit.outputs["Emission"], fnodes["Material Output"].inputs["Surface"])
        flame_obj.data.materials.append(flame_mat)

    # Unwrap UVs for everything to ensure texture shows up (skip curve - not a mesh)
    unwrap_object(body)
    unwrap_object(nose)
    for child in body.children:
        if child.type == "MESH":
            unwrap_object(child)

    return body

def get_rocket_yolo_aabb(rocket, scene, camera, class_id=0):
    """
    Compute YOLO-style normalized AABB (class_id center_x center_y width height)
    for the rocket (body + nose + fins only; excludes SmokeTrail and RocketFlame).
    Returns a string for one line in a .txt label file, or None if no visible points.
    """
    def is_rocket_mesh(obj):
        if obj.type != "MESH":
            return False
        name = obj.name
        if name == "RocketBody":
            return True
        if name == "RocketNose":
            return True
        if name.startswith("RocketFin_"):
            return True
        return False

    objects_to_project = [rocket] if rocket.type == "MESH" else []
    for child in rocket.children:
        if is_rocket_mesh(child):
            objects_to_project.append(child)

    xs, ys = [], []
    for obj in objects_to_project:
        mesh = obj.data
        if not mesh or not mesh.vertices:
            continue
        world_mat = obj.matrix_world
        for v in mesh.vertices:
            world_co = world_mat @ v.co
            co_2d = bpy_extras.object_utils.world_to_camera_view(scene, camera, world_co)
            if co_2d.z > 0:  # in front of camera
                xs.append(co_2d.x)
                ys.append(co_2d.y)

    if not xs or not ys:
        return None

    x_min = max(0.0, min(xs))
    x_max = min(1.0, max(xs))
    y_min = max(0.0, min(ys))
    y_max = min(1.0, max(ys))

    if x_min >= x_max or y_min >= y_max:
        return None

    center_x = (x_min + x_max) / 2.0
    center_y = (y_min + y_max) / 2.0
    width = x_max - x_min
    height = y_max - y_min

    return f"{class_id} {center_x:.6f} {center_y:.6f} {width:.6f} {height:.6f}\n"


def delete_rocket(rocket):
    """Delete the rocket and its children."""
    if rocket is None:
        return

    # Collect children and remove their materials (SmokeTrailMat, FlameMat) before unlinking
    children = [child for child in rocket.children]
    for child in children:
        if child.data and child.data.materials:
            for mat in list(child.data.materials):
                if mat and (mat.name.startswith("SmokeTrailMat") or mat.name.startswith("FlameMat")):
                    bpy.data.materials.remove(mat, do_unlink=True)
        bpy.data.objects.remove(child, do_unlink=True)

    # Remove rocket body material
    if rocket.data and rocket.data.materials:
        mat = rocket.data.materials[0]
        bpy.data.materials.remove(mat, do_unlink=True)

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
    # Keep film_transparent False so HDRI background is visible; smoke Alpha still makes it translucent

    # Enable motion blur
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5

    # Compositor: bloom (Glare Fog Glow) on bright areas (e.g. flame)
    try:
        if hasattr(scene, "use_nodes"):
            scene.use_nodes = True
        comp = getattr(scene, "node_tree", None)
        if comp is None:
            comp = bpy.data.node_groups.new("Compositor", "CompositorNodeTree")
            if hasattr(scene, "node_tree"):
                scene.node_tree = comp
        if comp is not None:
            comp.nodes.clear()
            rl = comp.nodes.new("CompositorNodeRLayers")
            rl.location = (-400, 0)
            glare = comp.nodes.new("CompositorNodeGlare")
            glare.glare_type = "FOG_GLOW"
            glare.quality = "HIGH"
            glare.mix = 1.0  # output only glare (we add it to original in Mix)
            glare.threshold = 0.3
            glare.fade = 0.9
            glare.size = 8
            glare.location = (-160, 0)
            comp.links.new(rl.outputs["Image"], glare.inputs["Image"])
            mix = comp.nodes.new("CompositorNodeMixRGB")
            mix.blend_type = "ADD"
            mix.inputs["Fac"].default_value = 1.0
            mix.location = (80, 0)
            comp.links.new(rl.outputs["Image"], mix.inputs["Color1"])
            comp.links.new(glare.outputs["Image"], mix.inputs["Color2"])
            comp_out = comp.nodes.new("CompositorNodeComposite")
            comp_out.location = (280, 0)
            comp.links.new(mix.outputs["Image"], comp_out.inputs["Image"])
    except Exception:
        pass  # Bloom optional; flame still renders bright without compositor

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
        speed = random.uniform(0.0, 1.0)
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
        scene = bpy.context.scene
        scene.render.filepath = filepath

        bpy.ops.render.render(write_still=True)

        # YOLO-style label: one .txt per image (same base name)
        label_line = get_rocket_yolo_aabb(rocket, scene, camera, class_id=0)
        label_path = os.path.join(args.out_dir, f"{i:06d}.txt")
        if label_line:
            with open(label_path, "w") as f:
                f.write(label_line)
        else:
            # Rocket not visible (e.g. behind camera); write empty or minimal bbox
            with open(label_path, "w") as f:
                pass

        print(f"Generated {i+1}/{args.count}: {filepath}")
        
        # Cleanup
        delete_rocket(rocket)

if __name__ == "__main__":
    main()
