"""
Builds an animated Blender 5.2 scene for 《云境》元婴期 · 万剑归宗 (Curved Sword-Flood Edition):
  - Cultivator levitating in mid-air with a giant vertical Celestial Magic Array behind their back
  - 220 detailed metallic xianxia swords bloom radially from the array center outward (Frames 1..45)
  - Then surge forward like a roaring flood along 4 intertwining 3D curved river streams (Frames 45..150)
  - Every single sword is strictly oriented along the exact 3D tangent vector of its own curved trajectory
  - Subtle wispy glowing curved airflow trails weave through the sword river
  - Saves `resource/skill/nascent-sword-array/Nascent_SwordFlood_Preview.blend`
  - Renders 4 cinematic Cycles keyframe stills (frames 25, 55, 90, 110) for immediate visual review!
"""
import os
import math
import random
import bpy
import bmesh
from mathutils import Vector, Quaternion

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSET_DIR = os.path.join(ROOT_DIR, "resource", "skill", "nascent-sword-array")
OUT_BLEND = os.path.join(ASSET_DIR, "Nascent_SwordFlood_Preview.blend")
PREVIEW_DIR = os.environ.get("FLOOD_PREVIEW_DIR", os.path.join(ROOT_DIR, "resource", "skill", "nascent-sword-array"))
os.makedirs(PREVIEW_DIR, exist_ok=True)

OUTER_TEX = os.path.join(ASSET_DIR, "Nascent_SkyArray_Outer_RGBA.png")
INNER_TEX = os.path.join(ASSET_DIR, "Nascent_SkyArray_Inner_RGBA.png")

FPS = 30
FRAME_START = 1
FRAME_END = 150
SWORD_COUNT = 220

# Origin of giant vertical array behind the levitating cultivator (elevated high so flood arcs down to ground z=0!)
ARRAY_CENTER = Vector((-1.6, 0.0, 12.0))
ARRAY_RADIUS = 6.8


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 28
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 8
    scene.render.fps = FPS
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"

    # Moody dark twilight-cyan mountain sky (like reference image 1 so metallic blades & gold glints pop!)
    world = bpy.data.worlds.new("XianxiaNightWorld")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.018, 0.042, 0.075, 1.0)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (0.008, 0.018, 0.040, 1.0)
    bg.inputs["Strength"].default_value = 0.85
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return scene


def make_pbr_mat(name, base_color, metallic=0.0, roughness=0.25, emission_color=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission_color is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission_color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def make_tex_array_mat(name, image_path, tint=(1.0, 1.0, 1.0), strength=2.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path, check_existing=True)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    mul.inputs["B"].default_value = (*tint, 1.0)
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = strength
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], mul.inputs["A"])
    nt.links.new(mul.outputs["Result"], emit.inputs["Color"])
    nt.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_trail_mat(name, color, strength=3.6, alpha=0.38):
    """Feathered wispy airflow trail: soft glowing core, zero-alpha feathered edges via LayerWeight."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.55
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.use_clamp = True
    inv.inputs[0].default_value = 1.0
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.2
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = alpha
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lw.outputs["Facing"], inv.inputs[1])
    nt.links.new(inv.outputs["Value"], pw.inputs[0])
    nt.links.new(pw.outputs["Value"], mul.inputs[0])
    nt.links.new(mul.outputs["Value"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def build_hero_xianxia_sword_mesh():
    """
    Builds a crisp, detailed xianxia sword mesh aligned along +X (hilt at x=-0.55, tip at x=+1.85),
    matching Reference Image 1: ring pommel, dark ribbed grip, antique-gold ornate guard, gleaming silver-steel blade!
    Uses 3 material slots: 0=SteelBlade, 1=AntiqueGold, 2=DarkGrip.
    """
    bm = bmesh.new()

    def add_loft(rings_pts, mat_idx, cap_start=True, cap_end=True):
        ring_verts = [[bm.verts.new(p) for p in r] for r in rings_pts]
        n = len(ring_verts[0])
        for i in range(len(ring_verts) - 1):
            r0, r1 = ring_verts[i], ring_verts[i + 1]
            for k in range(n):
                k2 = (k + 1) % n
                f = bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
                f.material_index = mat_idx
        if cap_start:
            f = bm.faces.new(ring_verts[0][::-1])
            f.material_index = mat_idx
        if cap_end:
            f = bm.faces.new(ring_verts[-1])
            f.material_index = mat_idx

    # 1) Sleeker, razor-sharp double-edged diamond-faceted steel blade (x = 0.0 -> 2.35)
    blade_st = [
        (0.00, 0.088, 0.022),
        (0.22, 0.082, 0.020),
        (1.25, 0.072, 0.018),
        (1.98, 0.054, 0.014),
        (2.35, 0.002, 0.002),
    ]
    blade_rings = []
    for x, wz, ty in blade_st:
        blade_rings.append([
            (x, 0.0,  wz),
            (x, ty,   0.0),
            (x, 0.0, -wz),
            (x, -ty,  0.0),
        ])
    add_loft(blade_rings, mat_idx=0)

    # 2) Ornate Antique-Gold Crossguard at x = -0.02..+0.08 (flared wings in Z)
    guard_st = [
        (-0.04, 0.14, 0.045),
        (0.00,  0.22, 0.052),
        (0.05,  0.19, 0.042),
        (0.11,  0.11, 0.030),
    ]
    guard_rings = []
    for x, wz, ty in guard_st:
        guard_rings.append([
            (x, 0.0,  wz),
            (x, ty,   wz * 0.45),
            (x, ty,  -wz * 0.45),
            (x, 0.0, -wz),
            (x, -ty, -wz * 0.45),
            (x, -ty,  wz * 0.45),
        ])
    add_loft(guard_rings, mat_idx=1)

    # 3) Dark Wrapped Grip (x = -0.46 -> -0.04)
    grip_st = [
        (-0.46, 0.036, 0.028),
        (-0.32, 0.040, 0.032),
        (-0.18, 0.038, 0.030),
        (-0.04, 0.044, 0.034),
    ]
    grip_rings = []
    for x, wz, ty in grip_st:
        pts = []
        for k in range(8):
            a = k * (math.pi / 4.0)
            pts.append((x, math.cos(a) * ty, math.sin(a) * wz))
        grip_rings.append(pts)
    add_loft(grip_rings, mat_idx=2)

    # 4) Antique-Gold Pommel Cap & Ring (x = -0.56 -> -0.46)
    pom_st = [
        (-0.56, 0.048, 0.036),
        (-0.51, 0.058, 0.044),
        (-0.46, 0.042, 0.032),
    ]
    pom_rings = []
    for x, wz, ty in pom_st:
        pts = []
        for k in range(8):
            a = k * (math.pi / 4.0)
            pts.append((x, math.cos(a) * ty, math.sin(a) * wz))
        pom_rings.append(pts)
    add_loft(pom_rings, mat_idx=1)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new("XianxiaHeroSwordMesh")
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def build_cultivator_silhouette(scene, parent):
    """Stylized levitating cultivator silhouette floating high at (0, 0, 11.2) facing +X."""
    mat_robe = make_pbr_mat("CultivatorRobe", (0.86, 0.90, 0.96), metallic=0.05, roughness=0.55, emission_color=(0.35, 0.65, 1.0), emission_strength=0.18)
    mat_sash = make_pbr_mat("CultivatorSash", (0.12, 0.42, 0.85), metallic=0.15, roughness=0.40, emission_color=(0.18, 0.65, 1.0), emission_strength=0.45)

    z0 = ARRAY_CENTER.z - 0.85
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.42, radius2=0.16, depth=1.15, location=(0.0, 0.0, z0))
    robe = bpy.context.active_object
    robe.name = "Cultivator_Robe"
    robe.data.materials.append(mat_robe)
    robe.parent = parent

    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.17, depth=0.58, location=(0.0, 0.0, z0 + 0.83))
    torso = bpy.context.active_object
    torso.name = "Cultivator_Torso"
    torso.data.materials.append(mat_sash)
    torso.parent = parent

    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.14, location=(0.02, 0.0, z0 + 1.27))
    head = bpy.context.active_object
    head.name = "Cultivator_Head"
    head.data.materials.append(mat_robe)
    head.parent = parent

    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.055, depth=0.68, location=(0.35, -0.18, z0 + 0.97), rotation=(0, math.radians(82), math.radians(-12)))
    arm = bpy.context.active_object
    arm.name = "Cultivator_CommandArm"
    arm.data.materials.append(mat_robe)
    arm.parent = parent


def eval_stream_curve(stream_id, u, start_pt, land_pt, rng_off):
    """
    Evaluates a smooth 3D curved flood trajectory for u in [0, 1] starting from `start_pt` on the high vertical array,
    sweeping forward in 4 intertwining wave-like river streams, and plunging obliquely into `land_pt` on the ground (z=0)!
    At u=1, the curve's tangent naturally enters the ground at a dramatic 30-55 deg slanted impact angle.
    """
    # Base interpolation from sky array to ground landing point, with arched vertical trajectory
    x = start_pt.x + (land_pt.x - start_pt.x) * u
    y_base = start_pt.y + (land_pt.y - start_pt.y) * (u * u * (3.0 - 2.0 * u))
    # Stay high across the first half of flight, then plunge steeply into the earth!
    z_base = start_pt.z * (1.0 - math.pow(u, 1.95)) + land_pt.z * math.pow(u, 1.95)

    # Envelope vanishes at u=0 (clean departure) and u=1 (exact ground landing at land_pt)
    env = math.sin(u * math.pi)
    if stream_id == 0:
        # Upper Crest Stream: arches dramatically high before diving steeply into the far ground
        y_wave = math.sin(u * math.pi * 1.45 + 0.3) * 4.2 * env + rng_off.y * env
        z_wave = (6.8 * math.sin(u * math.pi * 0.92) + 1.2 * math.sin(u * math.pi * 2.0)) * env + rng_off.z * env
    elif stream_id == 1:
        # Main Center Silver-Gold Hero Flood: bold S-wave sweeping across mid-air then plunging into ground
        y_wave = (-math.sin(u * math.pi * 1.3) * 3.6 + math.sin(u * math.pi * 2.3) * 1.4) * env + rng_off.y * env
        z_wave = (2.8 * math.sin(u * math.pi) - 1.6 * math.sin(u * math.pi * 2.0)) * env + rng_off.z * env
    elif stream_id == 2:
        # Lower Azure Torrent: swoops low early, crests slightly, then slams obliquely into near-mid ground
        y_wave = math.sin(u * math.pi * 1.6 - 0.7) * 3.4 * env + rng_off.y * env
        z_wave = (-2.6 * math.sin(u * math.pi * 1.15) + 1.4 * math.sin(u * math.pi * 2.2)) * env + rng_off.z * env
    else:
        # Braided Ribbon Stream: weaves around center stream in a sweeping helix before diving into earth
        ang = u * math.pi * 2.0 + rng_off.x * 6.28
        rad = (1.6 + 3.0 * env) * env
        y_wave = math.cos(ang) * rad + rng_off.y * 0.5 * env
        z_wave = math.sin(ang) * rad * 0.75 + 2.0 * env + rng_off.z * 0.5 * env

    return Vector((x, y_base + y_wave, max(land_pt.z, z_base + z_wave)))


def build_scene():
    scene = reset_scene()
    root = bpy.data.objects.new("Nascent_SwordFlood_Root", None)
    scene.collection.objects.link(root)

    # 0) Dark Battlefield Ground Plane at z = 0 so slanted sword embedding is clearly visible!
    mat_ground = make_pbr_mat("BattlefieldGround", (0.045, 0.065, 0.088), metallic=0.12, roughness=0.72)
    bpy.ops.mesh.primitive_plane_add(size=120.0, location=(24.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "Battlefield_Ground"
    ground.data.materials.append(mat_ground)

    # 1) Levitating Cultivator Silhouette
    build_cultivator_silhouette(scene, root)

    # 2) Giant Vertical Celestial Magic Array behind cultivator's back (upright in YZ plane, facing +X!)
    mat_outer = make_tex_array_mat("VerticalArrayOuter", OUTER_TEX, tint=(0.65, 0.90, 1.0), strength=2.6)
    mat_inner = make_tex_array_mat("VerticalArrayInner", INNER_TEX, tint=(0.75, 0.92, 1.0), strength=2.8)

    bpy.ops.mesh.primitive_plane_add(size=ARRAY_RADIUS * 2.35, location=(ARRAY_CENTER.x - 0.35, ARRAY_CENTER.y, ARRAY_CENTER.z), rotation=(0, math.pi / 2, 0))
    outer_arr = bpy.context.active_object
    outer_arr.name = "BackArray_Outer"
    outer_arr.data.materials.append(mat_outer)
    outer_arr.parent = root

    bpy.ops.mesh.primitive_plane_add(size=ARRAY_RADIUS * 1.48, location=(ARRAY_CENTER.x, ARRAY_CENTER.y, ARRAY_CENTER.z), rotation=(0, math.pi / 2, 0))
    inner_arr = bpy.context.active_object
    inner_arr.name = "BackArray_Inner"
    inner_arr.data.materials.append(mat_inner)
    inner_arr.parent = root

    # Animate array bloom & counter-rotation
    for arr, spd in ((outer_arr, 1.1), (inner_arr, -1.9)):
        arr.scale = (0.05, 0.05, 0.05)
        arr.keyframe_insert("scale", frame=1)
        arr.scale = (1.0, 1.0, 1.0)
        arr.keyframe_insert("scale", frame=20)
        arr.rotation_euler = (0.0, math.pi / 2, 0.0)
        arr.keyframe_insert("rotation_euler", frame=1)
        arr.rotation_euler = (spd * 2.5, math.pi / 2, 0.0)
        arr.keyframe_insert("rotation_euler", frame=FRAME_END)

    # 3) Three Stream-Themed Metallic Sword Materials (matching Reference Image 1's 3 color bands!)
    # Stream 0: Jade-Cyan enchanted steel | Stream 1 & 3: Classic Silver-Gold Hero Steel | Stream 2: Sapphire-Azure Steel
    mat_gold = make_pbr_mat("SwordAntiqueGold", (0.98, 0.78, 0.30), metallic=0.95, roughness=0.16, emission_color=(1.0, 0.80, 0.32), emission_strength=0.35)
    mat_grip = make_pbr_mat("SwordDarkGrip", (0.08, 0.09, 0.12), metallic=0.25, roughness=0.55)

    blade_mats = [
        make_pbr_mat("BladeJade", (0.55, 0.98, 0.90), metallic=0.90, roughness=0.12, emission_color=(0.35, 0.98, 0.84), emission_strength=0.95),
        make_pbr_mat("BladeSilverGold", (0.94, 0.96, 1.0), metallic=0.96, roughness=0.09, emission_color=(1.0, 0.92, 0.72), emission_strength=0.48),
        make_pbr_mat("BladeAzure", (0.42, 0.82, 1.0), metallic=0.92, roughness=0.12, emission_color=(0.24, 0.72, 1.0), emission_strength=1.05),
        make_pbr_mat("BladeSilverGold2", (0.92, 0.96, 1.0), metallic=0.95, roughness=0.10, emission_color=(0.65, 0.92, 1.0), emission_strength=0.55),
    ]

    # Build 4 mesh variants sharing the exact same crisp geometry, one per stream color tint
    base_mesh = build_hero_xianxia_sword_mesh()
    stream_meshes = []
    for s_idx in range(4):
        m = base_mesh.copy()
        m.name = f"XianxiaSword_Stream{s_idx}"
        m.materials.append(blade_mats[s_idx])
        m.materials.append(mat_gold)
        m.materials.append(mat_grip)
        stream_meshes.append(m)
    bpy.data.meshes.remove(base_mesh)

    # 4) Spawn 220 Swords: Bloom radially from Array Center -> Surge out as Curved Sword Flood along exact Tangent!
    rng = random.Random(2026)
    sword_coll = bpy.data.collections.new("SwordFlood_Swords")
    scene.collection.children.link(sword_coll)

    # Also build wispy curved airflow ribbon guides along the 4 streams (like Reference Image 1's delicate wind-trails!)
    trail_mats = [
        make_trail_mat("TrailJade", (0.32, 0.98, 0.85), strength=2.6, alpha=0.32),
        make_trail_mat("TrailGold", (1.0, 0.90, 0.62), strength=2.4, alpha=0.28),
        make_trail_mat("TrailAzure", (0.24, 0.76, 1.0), strength=2.8, alpha=0.34),
        make_trail_mat("TrailCyan", (0.45, 0.92, 1.0), strength=2.5, alpha=0.28),
    ]

    trail_coll = bpy.data.collections.new("SwordFlood_FlowTrails")
    scene.collection.children.link(trail_coll)

    # Create 28 graceful wispy curved trail tubes diving into the battlefield along the 4 streams!
    for k in range(28):
        s_id = k % 4
        ang = (k / 28.0) * math.pi * 2.0
        r0 = 1.4 + (k % 5) * 1.15
        start_pt = Vector((ARRAY_CENTER.x + 0.4, ARRAY_CENTER.y + math.cos(ang) * r0, ARRAY_CENTER.z + math.sin(ang) * r0))
        land_x = 18.0 + (k / 28.0) * 28.0 + rng.uniform(-2.0, 2.0)
        land_y = math.cos(ang) * (4.0 + r0 * 1.1) + rng.uniform(-2.5, 2.5)
        land_pt = Vector((land_x, land_y, 0.0))
        rng_off = Vector((rng.random(), rng.uniform(-1.1, 1.1), rng.uniform(-0.9, 0.9)))

        curve_data = bpy.data.curves.new(f"FlowTrail_{k}", type="CURVE")
        curve_data.dimensions = "3D"
        curve_data.bevel_depth = 0.018 + (k % 3) * 0.007
        curve_data.bevel_resolution = 3
        spline = curve_data.splines.new("POLY")
        segs = 36
        spline.points.add(segs)
        for i in range(segs + 1):
            u = i / segs
            p = eval_stream_curve(s_id, u, start_pt, land_pt, rng_off)
            spline.points[i].co = (p.x, p.y, p.z, 1.0)
            spline.points[i].radius = math.sin(u * math.pi) * 1.15 + 0.12

        # Animate bevel_factor_end so the wispy trails surge forward WITH the sword flood!
        t_obj = bpy.data.objects.new(f"FlowTrail_{k}", curve_data)
        t_obj.data.materials.append(trail_mats[s_id])
        trail_coll.objects.link(t_obj)
        t_obj.parent = root

        delay = int((k % 7) * 2.5)
        curve_data.bevel_factor_start = 0.0
        curve_data.bevel_factor_end = 0.0
        curve_data.keyframe_insert("bevel_factor_start", frame=42 + delay)
        curve_data.keyframe_insert("bevel_factor_end", frame=42 + delay)
        curve_data.bevel_factor_end = 1.0
        curve_data.keyframe_insert("bevel_factor_end", frame=105 + delay)
        curve_data.bevel_factor_start = 0.65
        curve_data.keyframe_insert("bevel_factor_start", frame=145)

    # Now create & animate all 220 Swords with EXACT analytical curve tangent alignment!
    for i in range(SWORD_COUNT):
        # Distribute across 4 streams (heavier weight on Main Hero Center Stream 1!)
        r_pick = rng.random()
        if r_pick < 0.24:
            s_id = 0  # Upper Jade
        elif r_pick < 0.62:
            s_id = 1  # Center Silver-Gold Hero Stream
        elif r_pick < 0.84:
            s_id = 2  # Lower Azure
        else:
            s_id = 3  # Braided Ribbon

        # Golden-angle spiral bloom position on the vertical array behind the cultivator
        frac = i / SWORD_COUNT
        ang = i * 2.399963 + rng.uniform(-0.12, 0.12)
        rad = 0.9 + math.sqrt(frac) * (ARRAY_RADIUS - 0.6)
        # Bias vertical start slightly by stream so streams peel off naturally from upper/mid/lower array!
        z_bias = 1.6 if s_id == 0 else (-1.8 if s_id == 2 else 0.0)
        start_pt = Vector((
            ARRAY_CENTER.x + 0.35 + rng.uniform(-0.35, 0.55),
            ARRAY_CENTER.y + math.cos(ang) * rad,
            ARRAY_CENTER.z + math.sin(ang) * rad * 0.88 + z_bias * 0.45,
        ))
        # Ground landing zone (x = 15..46m, y = -13..+13m, z = 0)
        land_x = 15.0 + frac * 28.0 + (4.5 if s_id == 0 else (-3.5 if s_id == 2 else 0.0)) + rng.uniform(-3.0, 3.0)
        land_y = math.cos(ang) * (2.5 + rad * 1.35) + rng.uniform(-2.8, 2.8)
        land_pt = Vector((land_x, land_y, 0.0))
        rng_off = Vector((rng.random(), rng.uniform(-1.05, 1.05), rng.uniform(-0.85, 0.85)))

        obj = bpy.data.objects.new(f"Sword_{i:03d}", stream_meshes[s_id])
        sword_coll.objects.link(obj)
        obj.parent = root
        obj.rotation_mode = "QUATERNION"

        base_scale = rng.uniform(0.95, 1.55) if s_id != 1 else rng.uniform(1.15, 1.85)

        # Phase 1: Spawn at Array Center & bloom radially outward (Frames 5..42)
        spawn_f = int(5 + frac * 22)
        bloom_end_f = spawn_f + 15
        # Phase 2: Surge forward & dive obliquely into the ground (Frames 44..128), then STAY EMBEDDED SLANTED!
        wave_delay = int(frac * 36 + rng.uniform(0, 6))
        launch_f = 44 + wave_delay
        flight_frames = int(rng.uniform(42, 56))

        obj.location = ARRAY_CENTER
        obj.scale = (0.001, 0.001, 0.001)
        obj.rotation_quaternion = Quaternion((1, 0, 0, 0))
        obj.keyframe_insert("location", frame=max(1, spawn_f - 1))
        obj.keyframe_insert("scale", frame=max(1, spawn_f - 1))
        obj.keyframe_insert("rotation_quaternion", frame=max(1, spawn_f - 1))

        obj.location = start_pt
        obj.scale = (base_scale, base_scale, base_scale)
        obj.rotation_quaternion = Quaternion((1, 0, 0, 0))
        obj.keyframe_insert("location", frame=bloom_end_f)
        obj.keyframe_insert("scale", frame=bloom_end_f)
        obj.keyframe_insert("rotation_quaternion", frame=bloom_end_f)

        if launch_f > bloom_end_f:
            obj.location = start_pt
            obj.keyframe_insert("location", frame=launch_f)
            obj.keyframe_insert("rotation_quaternion", frame=launch_f)

        # Sample 16 dense keyframes along the 3D curve with EXACT tangent alignment until slanted ground impact!
        sample_steps = 16
        last_pos = land_pt
        last_quat = Quaternion((1, 0, 0, 0))
        impact_frame = launch_f + flight_frames
        for step in range(1, sample_steps + 1):
            u = step / sample_steps
            u_pos = u * (0.35 + 0.65 * u)
            f_num = int(launch_f + u * flight_frames)
            p_cur = eval_stream_curve(s_id, u_pos, start_pt, land_pt, rng_off)
            p_next = eval_stream_curve(s_id, min(1.0, u_pos + 0.015), start_pt, land_pt, rng_off)
            p_prev = eval_stream_curve(s_id, max(0.0, u_pos - 0.015), start_pt, land_pt, rng_off)
            tangent = (p_next - p_prev)
            if tangent.length < 1e-5:
                tangent = Vector((1, 0, -0.7)).normalized()
            else:
                tangent.normalize()
            q = tangent.to_track_quat("X", "Z")
            # At u=1 (ground impact), sink the blade tip 1.1m into the ground along its slanted impact tangent!
            if step == sample_steps:
                # Sword tip is at local +2.35 * base_scale; place origin back along -tangent so ~45% of blade embeds cleanly
                embed_pos = land_pt - tangent * (1.25 * base_scale)
                obj.location = embed_pos
                obj.rotation_quaternion = q
                obj.keyframe_insert("location", frame=f_num)
                obj.keyframe_insert("rotation_quaternion", frame=f_num)
                last_pos = embed_pos
                last_quat = q
                impact_frame = f_num
            else:
                obj.location = p_cur
                obj.rotation_quaternion = q
                obj.keyframe_insert("location", frame=f_num)
                obj.keyframe_insert("rotation_quaternion", frame=f_num)

        # Hold firmly embedded at that exact slanted impact angle through FRAME_END!
        if impact_frame < FRAME_END:
            obj.location = last_pos
            obj.rotation_quaternion = last_quat
            obj.keyframe_insert("location", frame=FRAME_END)
            obj.keyframe_insert("rotation_quaternion", frame=FRAME_END)

    # 5) Dramatic Xianxia Lighting (warm golden hero key + cool cyan rim + array backlight)
    bpy.ops.object.light_add(type="AREA", location=(14, -18, 16))
    key = bpy.context.active_object
    key.data.energy = 14000
    key.data.color = (1.0, 0.92, 0.78)
    key.data.size = 14
    key.rotation_euler = (math.radians(52), 0, math.radians(24))

    bpy.ops.object.light_add(type="AREA", location=(20, 14, 10))
    rim = bpy.context.active_object
    rim.data.energy = 10000
    rim.data.color = (0.35, 0.85, 1.0)
    rim.data.size = 12
    rim.rotation_euler = (math.radians(65), 0, math.radians(150))

    bpy.ops.object.light_add(type="POINT", location=(ARRAY_CENTER.x + 1.5, 0, ARRAY_CENTER.z))
    arr_light = bpy.context.active_object
    arr_light.data.energy = 5000
    arr_light.data.color = (0.38, 0.78, 1.0)
    arr_light.data.shadow_soft_size = 3.5

    # 6) Camera setup (Hero side-3/4 view matching user's sketch & Reference Image 1!)
    cam_data = bpy.data.cameras.new("HeroCam")
    cam_data.lens = 32
    cam_obj = bpy.data.objects.new("HeroCam", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    def aim_cam(loc, target, lens=32):
        cam_data.lens = lens
        cam_obj.location = Vector(loc)
        d = Vector(target) - cam_obj.location
        cam_obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

    # Save the full animated .blend file first so the user can open and scrub frames 1..150 directly in Blender!
    aim_cam((19.0, -34.0, 12.0), (18.0, 0.0, 6.2), lens=30)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print(f"[OK] Saved animated Blender scene: {OUT_BLEND}")

    # 7) Render 4 Cinematic Keyframe Previews in Cycles!
    shots = [
        (28,  (6.5, -18.0, 12.5),  (0.5, 0.0, 12.0),  34, "flood_01_bloom.png"),
        (78,  (18.0, -34.0, 11.5), (16.5, 0.0, 7.2),  30, "flood_02_surge.png"),
        (106, (21.0, -36.0, 11.2), (20.0, 0.0, 5.2),  28, "flood_03_wide_flood.png"),
        (134, (24.0, -18.5, 5.2),  (28.5, 0.0, 1.4),  34, "flood_04_closeup_tangent.png"),
    ]
    for f_num, cam_loc, cam_tgt, lens, fname in shots:
        scene.frame_set(f_num)
        aim_cam(cam_loc, cam_tgt, lens=lens)
        out_png = os.path.join(PREVIEW_DIR, fname)
        scene.render.filepath = out_png
        bpy.ops.render.render(write_still=True)
        print(f"[OK] Rendered {out_png}")

    print("=== SWORD FLOOD BLENDER PREVIEW COMPLETE ===")


if __name__ == "__main__":
    build_scene()
