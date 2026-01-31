import bpy
import os
import sys
import random
import math
import argparse
from mathutils import Vector, Quaternion, Matrix
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

def _material_with_texture(name, texture_image=None):
    """Create a material with optional image texture (like rocket). Gray if no image."""
    mat = bpy.data.materials.new(name=name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    if texture_image:
        tex_node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex_node.image = texture_image
        mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    return mat


def create_sphere(radius=0.5, texture_image=None):
    """Create a sphere at origin (negative sample). Returns root object."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "NegativeSphere"
    obj.data.materials.append(_material_with_texture("NegativeSphereMat", texture_image))
    unwrap_object(obj)
    return obj


def create_box(size_x=0.6, size_y=0.6, size_z=0.8, texture_image=None):
    """Create a box at origin (negative sample). Returns root object."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "NegativeBox"
    obj.scale = (size_x, size_y, size_z)
    obj.data.materials.append(_material_with_texture("NegativeBoxMat", texture_image))
    unwrap_object(obj)
    return obj


def create_simple_house(base_size=0.6, base_height=0.4, roof_height=0.5, texture_image=None):
    """Create a simple house (box base + cone roof) at origin. Returns root object."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    base = bpy.context.active_object
    base.name = "NegativeHouseBase"
    mat = _material_with_texture("NegativeHouseMat", texture_image)
    base.data.materials.append(mat)
    base.scale = (base_size, base_size, base_height)
    base.location.z = base_height / 2
    roof_z = base_height + roof_height / 2
    bpy.ops.mesh.primitive_cone_add(radius1=base_size * 0.72, radius2=0, depth=roof_height, location=(0, 0, roof_z))
    roof = bpy.context.active_object
    roof.name = "NegativeHouseRoof"
    roof.data.materials.append(mat)
    roof.parent = base
    roof.matrix_parent_inverse = base.matrix_world.inverted()
    unwrap_object(base)
    unwrap_object(roof)
    return base


def create_bottle(body_radius=0.25, body_height=0.6, neck_radius=0.1, neck_height=0.2, texture_image=None):
    """Create a bottle (cylinder body + narrow cylinder neck) at origin. Returns root object."""
    bpy.ops.mesh.primitive_cylinder_add(radius=body_radius, depth=body_height, location=(0, 0, 0))
    body = bpy.context.active_object
    body.name = "NegativeBottleBody"
    mat = _material_with_texture("NegativeBottleMat", texture_image)
    body.data.materials.append(mat)
    neck_z = body_height / 2 + neck_height / 2
    bpy.ops.mesh.primitive_cylinder_add(radius=neck_radius, depth=neck_height, location=(0, 0, neck_z))
    neck = bpy.context.active_object
    neck.name = "NegativeBottleNeck"
    neck.data.materials.append(mat)
    neck.parent = body
    neck.matrix_parent_inverse = body.matrix_world.inverted()
    unwrap_object(body)
    unwrap_object(neck)
    return body


def delete_other_object(obj):
    """Delete a negative-sample object and its children (sphere, box, house, bottle; may include SmokeTrail/RocketFlame)."""
    if obj is None:
        return
    children = [c for c in obj.children]
    for c in children:
        if c.data and c.data.materials:
            for m in list(c.data.materials):
                if m and (m.name.startswith("Negative") or m.name.startswith("SmokeTrailMat") or m.name.startswith("FlameMat")):
                    bpy.data.materials.remove(m, do_unlink=True)
        bpy.data.objects.remove(c, do_unlink=True)
    if obj.data and obj.data.materials:
        for m in list(obj.data.materials):
            if m and m.name.startswith("Negative"):
                bpy.data.materials.remove(m, do_unlink=True)
    bpy.data.objects.remove(obj, do_unlink=True)


def add_smoke_and_flame(parent, tail_z_local, radius_at_tail, mode):
    """
    Add smoke trail and/or flame as children of parent. tail_z_local is the z of the
    nozzle in parent's local space (e.g. -body_height/2). radius_at_tail scales smoke/flame size.
    mode: 'none' | 'both' | 'smoke_only' | 'flame_only'.
    """
    add_smoke = mode in ("both", "smoke_only")
    add_flame = mode in ("both", "flame_only")
    if not add_smoke and not add_flame:
        return

    if add_smoke:
        trail_length = random.uniform(25.0, 60.0)
        trail_radius_start = radius_at_tail * random.uniform(1.2, 2.0)
        trail_radius_end = random.uniform(2.0, 6.0)
        bpy.ops.mesh.primitive_cone_add(
            radius1=trail_radius_end,
            radius2=trail_radius_start,
            depth=trail_length,
            location=(0, 0, 0),
        )
        trail_obj = bpy.context.active_object
        trail_obj.name = "SmokeTrail"
        trail_obj.parent = parent
        trail_obj.matrix_parent_inverse = parent.matrix_world.inverted()
        trail_obj.location = (0, 0, tail_z_local - trail_length / 2)
        trail_obj.cycles.use_motion_blur = False

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
        max_radius_inv = 1.0 / (trail_radius_end * 1.15)
        norm_radius = nodes.new("ShaderNodeMath")
        norm_radius.operation = "MULTIPLY"
        norm_radius.inputs[1].default_value = max_radius_inv
        norm_radius.location = (-260, 0)
        links.new(vec_length.outputs["Value"], norm_radius.inputs[0])
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
        falloff_ramp = nodes.new("ShaderNodeValToRGB")
        falloff_ramp.location = (-120, 0)
        falloff_ramp.color_ramp.elements[0].position = 0.0
        falloff_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
        falloff_ramp.color_ramp.elements[1].position = random.uniform(0.45, 0.7)
        falloff_ramp.color_ramp.elements[1].color = (0.35, 0.35, 0.35, 1)
        edge_el = falloff_ramp.color_ramp.elements.new(random.uniform(0.82, 0.98))
        edge_el.color = (0, 0, 0, 1)
        links.new(wave_add.outputs["Value"], falloff_ramp.inputs["Fac"])
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
        sep_color = nodes.new("ShaderNodeSeparateColor")
        sep_color.mode = "RGB"
        sep_color.location = (-120, -60)
        links.new(falloff_ramp.outputs["Color"], sep_color.inputs["Color"])
        red_out = sep_color.outputs.get("Red") or sep_color.outputs.get("R")
        links.new(red_out, final_mul.inputs[1])
        links.new(final_mul.outputs["Value"], principled_vol.inputs["Density"])
        trail_obj.data.materials.append(smoke_mat)

    if add_flame:
        flame_depth = random.uniform(0.8, 2.5)
        flame_radius_start = radius_at_tail * random.uniform(0.15, 0.35)
        bpy.ops.mesh.primitive_cone_add(
            radius1=0,
            radius2=flame_radius_start,
            depth=flame_depth,
            location=(0, 0, 0),
        )
        flame_obj = bpy.context.active_object
        flame_obj.name = "RocketFlame"
        flame_obj.parent = parent
        flame_obj.matrix_parent_inverse = parent.matrix_world.inverted()
        flame_obj.location = (0, 0, tail_z_local - flame_depth / 2)
        flame_obj.cycles.use_motion_blur = False
        flame_mat = bpy.data.materials.new(name="FlameMat")
        fnodes = flame_mat.node_tree.nodes
        flinks = flame_mat.node_tree.links
        flame_bsdf = fnodes.get("Principled BSDF")
        if flame_bsdf:
            fnodes.remove(flame_bsdf)
        flame_emit = fnodes.new("ShaderNodeEmission")
        flame_emit.location = (0, 0)
        flame_r = random.uniform(0.92, 1.0)
        flame_g = random.uniform(0.06, 1.0)
        flame_b = random.uniform(0.02, 1.0)
        flame_emit.inputs["Color"].default_value = (flame_r, flame_g, flame_b, 1)
        flame_emit.inputs["Strength"].default_value = random.uniform(100.0, 220.0)
        flinks.new(flame_emit.outputs["Emission"], fnodes["Material Output"].inputs["Surface"])
        flame_obj.data.materials.append(flame_mat)


def create_rocket(texture_image=None, body_radius=0.15, body_height=0.8, nose_height=0.3, 
                  num_fins=3, fin_span=0.2, fin_root_chord=0.2, fin_tip_chord=0.1, fin_sweep=0.1,
                  smoke_flame_mode="both"):
    """Create a rocket model. smoke_flame_mode: 'none' | 'both' | 'smoke_only' | 'flame_only'."""
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

    add_smoke_and_flame(body, -(body_height / 2), body_radius, smoke_flame_mode)

    # Unwrap UVs for everything to ensure texture shows up (skip curve - not a mesh)
    unwrap_object(body)
    unwrap_object(nose)
    for child in body.children:
        if child.type == "MESH":
            unwrap_object(child)

    return body

def get_rocket_yolo_aabb(rocket, scene, camera, velocity=None, shutter=0.5, class_id=0):
    """
    Compute YOLO-style normalized AABB (class_id center_x center_y width height)
    for the rocket only (body, nose, fins). Explicitly excludes flame and smoke.
    Accounts for motion blur by projecting vertices at start/end of shutter.
    """
    def is_rocket_only_mesh(obj):
        if obj.type != "MESH":
            return False
        name = obj.name
        if name == "RocketFlame" or name == "SmokeTrail":
            return False  # never include flame or smoke in bbox
        if name == "RocketBody":
            return True
        if name == "RocketNose":
            return True
        if name.startswith("RocketFin_"):
            return True
        return False

    objects_to_project = [rocket] if (rocket.type == "MESH" and rocket.name == "RocketBody") else []
    for child in rocket.children:
        if is_rocket_only_mesh(child):
            objects_to_project.append(child)

    xs, ys = [], []
    
    # Calculate motion offsets: start and end of shutter (centered on frame 1)
    # Velocity is displacement per frame.
    # Start: t = -shutter/2 -> offset = velocity * (-shutter/2)
    # End: t = +shutter/2 -> offset = velocity * (shutter/2)
    offsets = [Vector((0, 0, 0))]
    if velocity is not None and shutter > 0:
        offsets.append(velocity * (-shutter / 2))
        offsets.append(velocity * (shutter / 2))

    for obj in objects_to_project:
        mesh = obj.data
        if not mesh or not mesh.vertices:
            continue
        world_mat = obj.matrix_world
        for v in mesh.vertices:
            # Vertex in world space at frame 1 (center of shutter)
            base_co = world_mat @ v.co
            
            # Project at base, start, and end of motion
            for offset in offsets:
                world_co = base_co + offset
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

    # YOLO Darknet/Ultralytics format: class_id center_x center_y width height (all 0-1).
    # Origin: (0,0) top-left, (1,1) bottom-right. Blender gives bottom-left origin, so flip y.
    center_x = (x_min + x_max) / 2.0
    center_y = 1.0 - (y_min + y_max) / 2.0
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

def setup_scene(resolution_x=720, resolution_y=720, samples=128):
    """Setup basic scene settings: Cycles, resolution, ground, cube."""
    # Render settings
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU' # Or GPU if available, but keep safe with CPU/auto
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
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 90
    scene.cycles.samples = samples
    # Keep film_transparent False so HDRI background is visible; smoke Alpha still makes it translucent

    # Enable motion blur
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5

    # Compositor: bloom (Glare Fog Glow)
    try:
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
            glare.mix = 1.0
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
        pass  # Bloom/lens flare optional

    # World settings (for HDRI)
    world = bpy.data.worlds.new("World")
    scene.world = world

    # Create Camera
    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    camera.name = "Camera"
    scene.camera = camera

    return camera, world


def _create_lens_flare_speck(camera, distance=2.0, length=3.5, thin=0.04, depth=0.02):
    """
    Add a thin, long volumetric lens flare (same approach as smoke) between camera and origin.
    More transparent, 10x longer, random rotation in camera view, color white→light yellow→orange.
    Rotation is in the camera's view (strip spins in the screen plane). Density is higher at
    the middle of the strip and in the center cross-section, lower at the edges.
    Strip width (thin/depth) and position in camera view are randomized.
    """
    cam = camera
    target = Vector((0, 0, 0))
    direction = (target - cam.location).normalized()
    cam_right = cam.matrix_world.to_3x3().col[0].xyz.normalized()
    cam_up = cam.matrix_world.to_3x3().col[1].xyz.normalized()
    # Base position along view ray, then random offset in camera view (screen plane)
    pos = cam.location + direction * distance
    view_offset = 0.35  # max translation in camera view
    pos += random.uniform(-view_offset, view_offset) * cam_right + random.uniform(-view_offset, view_offset) * cam_up
    # Random strip width (thin = across strip, depth = thickness along view)
    thin = random.uniform(0.02, 0.10)
    depth = random.uniform(0.01, 0.05)
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    vol_obj = bpy.context.active_object
    vol_obj.name = "LensFlareSpeck"
    vol_obj.cycles.use_motion_blur = False
    # Orient strip in camera view: strip lies in the plane perpendicular to view direction,
    # rotated by a random angle in that plane (so it spins in the camera's POV).
    angle_rad = math.radians(random.uniform(0, 360))
    strip_axis = (math.cos(angle_rad) * cam_right + math.sin(angle_rad) * cam_up).normalized()
    axis_y = strip_axis.cross(direction).normalized()
    axis_z = strip_axis.cross(axis_y).normalized()
    R3 = Matrix((strip_axis, axis_y, axis_z)).transposed()
    R = Matrix((
        (R3[0][0], R3[0][1], R3[0][2], 0),
        (R3[1][0], R3[1][1], R3[1][2], 0),
        (R3[2][0], R3[2][1], R3[2][2], 0),
        (0, 0, 0, 1),
    ))
    S = Matrix(((length, 0, 0, 0), (0, thin, 0, 0), (0, 0, depth, 0), (0, 0, 0, 1)))
    vol_obj.matrix_world = Matrix.Translation(pos) @ R @ S
    # Material: Principled Volume – more transparent (lower density)
    mat = bpy.data.materials.new(name="LensFlareSpeckMat")
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        nodes.remove(bsdf)
    output_node = nodes.get("Material Output")
    principled_vol = nodes.new("ShaderNodeVolumePrincipled")
    principled_vol.location = (0, 0)
    # More transparent: lower density
    density_val = random.uniform(0.006, 0.018)
    principled_vol.inputs["Density"].default_value = density_val
    principled_vol.inputs["Color"].default_value = (0.01, 0.01, 0.01, 1)  # minimal scatter
    # Random color: white → light yellow → orange (R=1, G 0.5–1, B 0.1–1)
    t = random.random()
    flare_r = 1.0
    flare_g = 0.5 + 0.5 * t
    flare_b = 0.1 + 0.9 * t
    emission_color = principled_vol.inputs.get("Emission Color") or principled_vol.inputs.get("Emission")
    if emission_color:
        emission_color.default_value = (flare_r, flare_g, flare_b, 1.0)
    emission_strength = principled_vol.inputs.get("Emission Strength")
    if emission_strength is not None:
        emission_strength.default_value = random.uniform(40.0, 100.0)
    principled_vol.inputs["Anisotropy"].default_value = 0.0
    links.new(principled_vol.outputs["Volume"], output_node.inputs["Volume"])
    # Density falloff: denser at middle (centerline + along strip), less at edges.
    # 1) Cross-section: distance from strip centerline (X axis) = length(Y, Z) in object space.
    # 2) Along strip: denser at X=0, less at X=±0.5.
    tex_coord = nodes.new("ShaderNodeTexCoord")
    tex_coord.location = (-520, 0)
    separate_xyz = nodes.new("ShaderNodeSeparateXYZ")
    separate_xyz.location = (-400, 0)
    links.new(tex_coord.outputs["Object"], separate_xyz.inputs["Vector"])
    # Cross-section falloff: length(0, Y, Z) -> ramp (1 at center, 0 at edges)
    combine_yz = nodes.new("ShaderNodeCombineXYZ")
    combine_yz.inputs["X"].default_value = 0.0
    combine_yz.location = (-280, 40)
    links.new(separate_xyz.outputs["Y"], combine_yz.inputs["Y"])
    links.new(separate_xyz.outputs["Z"], combine_yz.inputs["Z"])
    vec_length_yz = nodes.new("ShaderNodeVectorMath")
    vec_length_yz.operation = "LENGTH"
    vec_length_yz.location = (-160, 40)
    links.new(combine_yz.outputs["Vector"], vec_length_yz.inputs[0])
    scale_yz = 1.0 / max(max(thin, depth) * 0.6, 0.01)
    scale_node_yz = nodes.new("ShaderNodeMath")
    scale_node_yz.operation = "MULTIPLY"
    scale_node_yz.inputs[1].default_value = scale_yz
    scale_node_yz.location = (-40, 40)
    links.new(vec_length_yz.outputs["Value"], scale_node_yz.inputs[0])
    ramp_yz = nodes.new("ShaderNodeValToRGB")
    ramp_yz.location = (80, 40)
    ramp_yz.color_ramp.elements[0].position = 0.0
    ramp_yz.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp_yz.color_ramp.elements[1].position = 0.85
    ramp_yz.color_ramp.elements[1].color = (0, 0, 0, 1)
    links.new(scale_node_yz.outputs["Value"], ramp_yz.inputs["Fac"])
    # Along-strip falloff: 1 - 2*abs(X), ramp (1 at center X=0, 0 at ends)
    abs_x = nodes.new("ShaderNodeMath")
    abs_x.operation = "ABSOLUTE"
    abs_x.location = (-280, -80)
    links.new(separate_xyz.outputs["X"], abs_x.inputs[0])
    mul_2 = nodes.new("ShaderNodeMath")
    mul_2.operation = "MULTIPLY"
    mul_2.inputs[1].default_value = 2.0
    mul_2.location = (-160, -80)
    links.new(abs_x.outputs["Value"], mul_2.inputs[0])
    one_minus = nodes.new("ShaderNodeMath")
    one_minus.operation = "SUBTRACT"
    one_minus.inputs[0].default_value = 1.0
    one_minus.location = (-40, -80)
    links.new(mul_2.outputs["Value"], one_minus.inputs[1])
    ramp_x = nodes.new("ShaderNodeValToRGB")
    ramp_x.location = (80, -80)
    ramp_x.color_ramp.elements[0].position = 0.0
    ramp_x.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp_x.color_ramp.elements[1].position = 1.0
    ramp_x.color_ramp.elements[1].color = (1, 1, 1, 1)
    links.new(one_minus.outputs["Value"], ramp_x.inputs["Fac"])
    # Multiply both factors (R channels) then by base density
    sep_yz = nodes.new("ShaderNodeSeparateColor")
    sep_yz.mode = "RGB"
    sep_yz.location = (260, 40)
    links.new(ramp_yz.outputs["Color"], sep_yz.inputs["Color"])
    sep_x = nodes.new("ShaderNodeSeparateColor")
    sep_x.mode = "RGB"
    sep_x.location = (260, -80)
    links.new(ramp_x.outputs["Color"], sep_x.inputs["Color"])
    red_out = sep_yz.outputs.get("Red") or sep_yz.outputs.get("R")
    mult_factors = nodes.new("ShaderNodeMath")
    mult_factors.operation = "MULTIPLY"
    mult_factors.location = (440, -20)
    links.new(red_out, mult_factors.inputs[0])
    red_x = sep_x.outputs.get("Red") or sep_x.outputs.get("R")
    links.new(red_x, mult_factors.inputs[1])
    mult_density = nodes.new("ShaderNodeMath")
    mult_density.operation = "MULTIPLY"
    mult_density.inputs[1].default_value = density_val
    mult_density.location = (620, -20)
    links.new(mult_factors.outputs["Value"], mult_density.inputs[0])
    links.new(mult_density.outputs["Value"], principled_vol.inputs["Density"])
    vol_obj.data.materials.append(mat)
    return vol_obj, mat


def _delete_lens_flare_speck():
    """Remove the lens flare plane and its material."""
    plane = bpy.data.objects.get("LensFlareSpeck")
    if plane:
        if plane.data.materials:
            for m in list(plane.data.materials):
                if m and m.name == "LensFlareSpeckMat":
                    bpy.data.materials.remove(m, do_unlink=True)
        bpy.data.objects.remove(plane, do_unlink=True)


OVERLAY_TEXT_CHARS = "WETYIPAFHKLZXVMB"


def _create_overlay_text(camera):
    """
    Add a 3D text overlay in the middle of the frame: 10 random chars from OVERLAY_TEXT_CHARS,
    random grayscale color, random alpha, random size and rotation. Text has extrusion (thickness)
    and uses a lit Principled BSDF so scene lighting affects it.
    """
    target = Vector((0, 0, 0))
    direction = (target - camera.location).normalized()
    distance = 2.5
    pos = camera.location + direction * distance
    bpy.ops.object.text_add(location=pos)
    text_obj = bpy.context.active_object
    text_obj.name = "OverlayText"
    text_obj.cycles.use_motion_blur = False
    # 10 random chars
    text_obj.data.body = "".join(random.choice(OVERLAY_TEXT_CHARS) for _ in range(10))
    text_obj.data.align_x = "CENTER"
    text_obj.data.align_y = "CENTER"
    # Thickness: extrude so text has volume and lighting affects front, back, and sides
    text_obj.data.extrude = random.uniform(0.02, 0.08)
    # Random scale (size)
    s = random.uniform(0.15, 0.55)
    text_obj.scale = (s, s, s)
    # Random rotation (euler)
    text_obj.rotation_euler = (
        math.radians(random.uniform(-180, 180)),
        math.radians(random.uniform(-180, 180)),
        math.radians(random.uniform(-180, 180)),
    )
    # Material: random grayscale, random alpha; Principled BSDF (no emission) so scene lighting affects it
    mat = bpy.data.materials.new(name="OverlayTextMat")
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        g = random.uniform(0.0, 1.0)
        bsdf.inputs["Base Color"].default_value = (g, g, g, 1.0)
        bsdf.inputs["Alpha"].default_value = random.uniform(0.3, 1.0)
        # Ensure diffuse/specular so HDRI and lights affect the text (default roughness is fine)
        bsdf.inputs["Roughness"].default_value = random.uniform(0.3, 0.8)
    text_obj.data.materials.append(mat)
    return text_obj


def _delete_overlay_text():
    """Remove the overlay text object, its curve data, and material."""
    text_obj = bpy.data.objects.get("OverlayText")
    if text_obj:
        if text_obj.data.materials:
            for m in list(text_obj.data.materials):
                if m and m.name == "OverlayTextMat":
                    bpy.data.materials.remove(m, do_unlink=True)
        curve = text_obj.data
        bpy.data.objects.remove(text_obj, do_unlink=True)
        if curve and curve.users == 0:
            bpy.data.curves.remove(curve)


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
                     min_elev=-45, max_elev=10, 
                     min_fov=20, max_fov=70):
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
    # Object: 20% nothing, 30% other (sphere/box/house/bottle), 50% rocket
    # Smoke/flame (when rocket): 25% none, 55% both, 10% smoke_only, 10% flame_only
    print(f"Starting generation of {args.count} images...")
    for i in range(args.count):
        hdri_path = random.choice(hdri_files)
        set_hdri(world, hdri_path)

        object_roll = random.random()
        nothing = object_roll < 0.2
        other_object = object_roll >= 0.2 and object_roll < 0.5
        write_empty_label = nothing or other_object

        rocket = None
        other_obj = None
        velocity = None

        if nothing:
            pass
        elif other_object:
            # Negative sample: sphere, box, house, or bottle; same smoke/flame roll as rocket
            sf_roll = random.random()
            if sf_roll < 0.25:
                other_sf_mode = "none"
            elif sf_roll < 0.80:
                other_sf_mode = "both"
            elif sf_roll < 0.90:
                other_sf_mode = "smoke_only"
            else:
                other_sf_mode = "flame_only"

            tex_image = random.choice(loaded_textures) if loaded_textures else None
            shape_choice = random.choice(["sphere", "box", "house", "bottle"])
            if shape_choice == "sphere":
                r = random.uniform(0.3, 0.8)
                other_obj = create_sphere(radius=r, texture_image=tex_image)
                tail_z, radius_at_tail = -r, r * 0.5
            elif shape_choice == "box":
                sx, sy, sz = random.uniform(0.4, 0.8), random.uniform(0.4, 0.8), random.uniform(0.5, 1.0)
                other_obj = create_box(size_x=sx, size_y=sy, size_z=sz, texture_image=tex_image)
                tail_z, radius_at_tail = -sz / 2, min(sx, sy) / 2
            elif shape_choice == "house":
                bs, bh, rh = random.uniform(0.4, 0.7), random.uniform(0.3, 0.5), random.uniform(0.35, 0.6)
                other_obj = create_simple_house(base_size=bs, base_height=bh, roof_height=rh, texture_image=tex_image)
                tail_z, radius_at_tail = -bh / 2, bs * 0.4
            else:  # bottle
                br, bht, nr, nh = random.uniform(0.15, 0.35), random.uniform(0.4, 0.9), random.uniform(0.06, 0.15), random.uniform(0.1, 0.3)
                other_obj = create_bottle(body_radius=br, body_height=bht, neck_radius=nr, neck_height=nh, texture_image=tex_image)
                tail_z, radius_at_tail = -bht / 2, br
            add_smoke_and_flame(other_obj, tail_z, radius_at_tail, other_sf_mode)
            rot_x = math.radians(random.uniform(-45, 45))
            rot_y = math.radians(random.uniform(-45, 45))
            rot_z = math.radians(random.uniform(-45, 45))
            other_obj.rotation_euler = (rot_x, rot_y, rot_z)
        else:
            # Rocket (60%): smoke/flame 25% none, 55% both, 10% smoke_only, 10% flame_only
            sf_roll = random.random()
            if sf_roll < 0.25:
                smoke_flame_mode = "none"
            elif sf_roll < 0.80:
                smoke_flame_mode = "both"
            elif sf_roll < 0.90:
                smoke_flame_mode = "smoke_only"
            else:
                smoke_flame_mode = "flame_only"

            body_h = random.uniform(1.5, 4.0)
            body_r = random.uniform(0.05, 0.3)
            nose_h = random.uniform(0.2, 0.8)
            num_fins = 0 if random.random() < 0.5 else random.randint(3, 5)
            fin_span = random.uniform(0.1, 0.4)
            fin_root_chord = random.uniform(0.15, 0.5)
            fin_tip_chord = random.uniform(0.05, 0.3)
            fin_sweep = random.uniform(0.0, 0.3)
            if fin_tip_chord > fin_root_chord:
                fin_tip_chord = fin_root_chord * random.uniform(0.5, 1.0)
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
                fin_sweep=fin_sweep,
                smoke_flame_mode=smoke_flame_mode,
            )
            rot_x = math.radians(random.uniform(-45, 45))
            rot_y = math.radians(random.uniform(-45, 45))
            rot_z = math.radians(random.uniform(-45, 45))
            rocket.rotation_euler = (rot_x, rot_y, rot_z)
            rot_mat = rocket.rotation_euler.to_matrix()
            forward_vec = rot_mat @ Vector((0, 0, 1))
            speed = random.uniform(0.0, 0.5)
            velocity = forward_vec * speed
            rocket.location = -velocity
            rocket.keyframe_insert(data_path="location", frame=0)
            rocket.location = velocity
            rocket.keyframe_insert(data_path="location", frame=2)

        # Randomize camera (after object setup so bbox uses correct frame)
        randomize_camera(camera)

        filename = f"{i:06d}.jpg"
        filepath = os.path.join(args.out_dir, filename)
        scene = bpy.context.scene
        scene.render.filepath = filepath
        # Lens flare 50% of the time
        if random.random() < 0.5:
            _create_lens_flare_speck(camera)
        # Overlay text 30% of the time: 10-char random text, grayscale, random alpha, center, random size/rotation
        if random.random() < 0.3:
            _create_overlay_text(camera)
        bpy.ops.render.render(write_still=True)
        _delete_lens_flare_speck()
        _delete_overlay_text()

        label_path = os.path.join(args.out_dir, f"{i:06d}.txt")
        if write_empty_label:
            with open(label_path, "w") as f:
                pass
        else:
            label_line = get_rocket_yolo_aabb(rocket, scene, camera, velocity=velocity, shutter=0.5, class_id=0)
            if label_line:
                with open(label_path, "w") as f:
                    f.write(label_line)
            else:
                with open(label_path, "w") as f:
                    pass

        print(f"Generated {i+1}/{args.count}: {filepath}")

        if rocket is not None:
            delete_rocket(rocket)
        if other_obj is not None:
            delete_other_object(other_obj)

if __name__ == "__main__":
    main()
