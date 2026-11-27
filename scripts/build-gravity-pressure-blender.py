"""
Builds an animated 120-frame Blender 5.2 Anime Gravity-Field Spiritual Pressure (重力场威压) VFX:
  1. Descending translucent spherical/cylindrical atmospheric compression dome (天穹下压重力球壳)
  2. Vertical downward-crushing anime gravity speed-lines / pressure curtains (垂直下压重力流线)
  3. Concave sunken ground depression + spiderweb stone fractures (地面生生压塌凹坑 + 蛛网裂纹)
  4. Repeated downward-slamming horizontal air-compression shockwave ripples (贴地横扫空气压迫波)
  5. Horizontal ground-skimming dust/debris blast pushed flat along the earth (贴地尘浪与压碎石屑)

Saves `resource/boss/Dragon_GravityPressure_Preview.blend` and renders 3 Cycles keyframe stills!
"""
import os
import math
import random
import bpy
import bmesh
from mathutils import Vector

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT_DIR, "resource", "boss")
OUT_BLEND = os.path.join(OUT_DIR, "Dragon_GravityPressure_Preview.blend")
PREVIEW_DIR = os.environ.get("GRAV_PREVIEW_DIR", OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(PREVIEW_DIR, exist_ok=True)

FPS = 30
FRAME_START = 1
FRAME_END = 120


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 28
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 10
    scene.render.fps = FPS
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = "Standard"

    # Heavy oppressive storm-indigo dusk atmosphere (like Fujitora / Aizen gravity crush!)
    world = bpy.data.worlds.new("GravityStormWorld")
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
    ramp.color_ramp.elements[0].color = (0.045, 0.038, 0.075, 1.0)
    ramp.color_ramp.elements[1].position = 0.70
    ramp.color_ramp.elements[1].color = (0.012, 0.010, 0.028, 1.0)
    bg.inputs["Strength"].default_value = 0.9
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return scene


def make_pbr_mat(name, base_color, metallic=0.0, roughness=0.75):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def make_gravity_dome_mat(name, rim_col=(0.58, 0.36, 1.0), core_col=(0.14, 0.08, 0.32), strength=1.8, max_alpha=0.52):
    """Translucent anime atmospheric distortion dome: clear in center, glowing violet-silver refractive rim!"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")

    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.38
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.4
    nt.links.new(lw.outputs["Facing"], pw.inputs[0])

    # Subtle horizontal compression wave bands on the dome
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 4.5
    wave.inputs["Distortion"].default_value = 1.8
    nt.links.new(tex.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(tex.outputs["Object"], sep.inputs["Vector"])

    mix_col = nt.nodes.new("ShaderNodeMix")
    mix_col.data_type = "RGBA"
    mix_col.inputs["A"].default_value = (*core_col, 1.0)
    mix_col.inputs["B"].default_value = (*rim_col, 1.0)
    nt.links.new(pw.outputs["Value"], mix_col.inputs["Factor"])

    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = strength
    nt.links.new(mix_col.outputs["Result"], emit.inputs["Color"])

    add_w = nt.nodes.new("ShaderNodeMath")
    add_w.operation = "MULTIPLY_ADD"
    add_w.inputs[1].default_value = 0.22
    nt.links.new(wave.outputs["Fac"], add_w.inputs[0])
    nt.links.new(pw.outputs["Value"], add_w.inputs[2])

    mul_a = nt.nodes.new("ShaderNodeMath")
    mul_a.operation = "MULTIPLY"
    mul_a.use_clamp = True
    mul_a.inputs[1].default_value = max_alpha
    nt.links.new(add_w.outputs["Value"], mul_a.inputs[0])

    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mul_a.outputs["Value"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_pressure_line_mat(name, color=(0.72, 0.56, 1.0), strength=2.2, alpha=0.58):
    """Crisp anime downward gravity streak material."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = alpha
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def make_shock_ring_mat(name, color=(0.66, 0.44, 1.0), strength=2.4, ring_r=0.86, ring_w=0.11, alpha_mul=0.78):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (0.5, 0.5, 0.0)
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "SCALE"
    mul.inputs["Scale"].default_value = 2.0
    vlen = nt.nodes.new("ShaderNodeVectorMath")
    vlen.operation = "LENGTH"
    nt.links.new(tex.outputs["UV"], sub.inputs[0])
    nt.links.new(sub.outputs["Vector"], mul.inputs[0])
    nt.links.new(mul.outputs["Vector"], vlen.inputs[0])

    s2 = nt.nodes.new("ShaderNodeMath")
    s2.operation = "SUBTRACT"
    s2.inputs[1].default_value = ring_r
    ab = nt.nodes.new("ShaderNodeMath")
    ab.operation = "ABSOLUTE"
    dv = nt.nodes.new("ShaderNodeMath")
    dv.operation = "DIVIDE"
    dv.inputs[1].default_value = ring_w
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.use_clamp = True
    inv.inputs[0].default_value = 1.0
    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = 2.2
    ma = nt.nodes.new("ShaderNodeMath")
    ma.operation = "MULTIPLY"
    ma.inputs[1].default_value = alpha_mul
    nt.links.new(vlen.outputs["Value"], s2.inputs[0])
    nt.links.new(s2.outputs["Value"], ab.inputs[0])
    nt.links.new(ab.outputs["Value"], dv.inputs[0])
    nt.links.new(dv.outputs["Value"], inv.inputs[1])
    nt.links.new(inv.outputs["Value"], pw.inputs[0])
    nt.links.new(pw.outputs["Value"], ma.inputs[0])

    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ma.outputs["Value"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def build_crushed_ground_mesh():
    """Creates a ground mesh with a concave circular gravity-crushed crater depression at the center!"""
    bm = bmesh.new()
    segs = 64
    size = 90.0
    bmesh.ops.create_grid(bm, x_segments=segs, y_segments=segs, size=size * 0.5)
    for v in bm.verts:
        r = math.hypot(v.co.x, v.co.y)
        if r < 14.5:
            # Sunken stepped crater bowl with raised fractured rim at r ~ 12.5m
            t = r / 14.5
            bowl = -1.65 * math.pow(1.0 - t * t, 1.5)
            rim = 0.42 * math.exp(-pow((r - 12.2) / 1.8, 2.0))
            crackle = 0.08 * math.sin(v.co.x * 1.9) * math.cos(v.co.y * 1.9)
            v.co.z = bowl + rim + crackle
        else:
            v.co.z = 0.02 * math.sin(v.co.x * 0.4) * math.cos(v.co.y * 0.4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new("CrushedGroundMesh")
    bm.to_mesh(m)
    bm.free()
    return m


def build_scene():
    scene = reset_scene()
    root = bpy.data.objects.new("Gravity_Pressure_Root", None)
    scene.collection.objects.link(root)
    rng = random.Random(2026)

    # 1) Concave Crushed Ground Crater
    mat_ground = make_pbr_mat("CrushedStoneGround", (0.14, 0.13, 0.17), metallic=0.08, roughness=0.82)
    ground_obj = bpy.data.objects.new("Gravity_CrushedGround", build_crushed_ground_mesh())
    ground_obj.data.materials.append(mat_ground)
    scene.collection.objects.link(ground_obj)

    # Kneeling/crushed target silhouette at the center of the crater so the downward weight is felt immediately!
    mat_target = make_pbr_mat("TargetSilhouette", (0.78, 0.84, 0.92), metallic=0.05, roughness=0.55)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.32, depth=1.1, location=(0, 0, -1.05))
    tgt_body = bpy.context.active_object
    tgt_body.name = "Crushed_Target_Body"
    tgt_body.data.materials.append(mat_target)
    tgt_body.parent = root
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=0.22, location=(0, 0, -0.32))
    tgt_head = bpy.context.active_object
    tgt_head.name = "Crushed_Target_Head"
    tgt_head.data.materials.append(mat_target)
    tgt_head.parent = root

    # 2) Spiderweb Concentric & Radial Shattered Cracks inside the sunken crater (蛛网压裂地痕)
    mat_crack_dark = make_pbr_mat("CrackAbyss", (0.015, 0.008, 0.025), roughness=0.95)
    mat_crack_glow = make_pressure_line_mat("CrackVioletGlow", (0.58, 0.34, 1.0), strength=2.2, alpha=0.85)
    bm_c = bmesh.new()

    def ground_z(x, y):
        r = math.hypot(x, y)
        if r >= 14.5:
            return 0.05
        t = r / 14.5
        return -1.65 * math.pow(1.0 - t * t, 1.5) + 0.42 * math.exp(-pow((r - 12.2) / 1.8, 2.0)) + 0.06

    # Radial fractures
    for k in range(20):
        a = (k / 20.0) * math.pi * 2.0 + rng.uniform(-0.08, 0.08)
        cur_r = 0.8
        cur_a = a
        for s in range(9):
            nxt_r = cur_r + rng.uniform(1.1, 1.75)
            nxt_a = cur_a + rng.uniform(-0.14, 0.14)
            p0 = Vector((math.cos(cur_a) * cur_r, math.sin(cur_a) * cur_r, ground_z(math.cos(cur_a) * cur_r, math.sin(cur_a) * cur_r)))
            p1 = Vector((math.cos(nxt_a) * nxt_r, math.sin(nxt_a) * nxt_r, ground_z(math.cos(nxt_a) * nxt_r, math.sin(nxt_a) * nxt_r)))
            d = (p1 - p0)
            d.z = 0
            if d.length > 0.01:
                d.normalize()
                perp = Vector((-d.y, d.x, 0.0)) * (0.14 * (1.0 - s * 0.08))
                bm_c.faces.new([
                    bm_c.verts.new(p0 + perp), bm_c.verts.new(p0 - perp),
                    bm_c.verts.new(p1 - perp * 0.8), bm_c.verts.new(p1 + perp * 0.8),
                ])
            cur_r, cur_a = nxt_r, nxt_a

    # Concentric spiderweb fracture rings at r = 3.6, 7.2, 10.8
    for rr in (3.6, 7.2, 10.8):
        segs_r = 40
        for s in range(segs_r):
            a0 = (s / segs_r) * math.pi * 2.0
            a1 = ((s + 1) / segs_r) * math.pi * 2.0
            r0 = rr + math.sin(s * 2.3) * 0.35
            r1 = rr + math.sin((s + 1) * 2.3) * 0.35
            p0 = Vector((math.cos(a0) * r0, math.sin(a0) * r0, ground_z(math.cos(a0) * r0, math.sin(a0) * r0)))
            p1 = Vector((math.cos(a1) * r1, math.sin(a1) * r1, ground_z(math.cos(a1) * r1, math.sin(a1) * r1)))
            rad0 = Vector((math.cos(a0), math.sin(a0), 0.0)) * 0.09
            rad1 = Vector((math.cos(a1), math.sin(a1), 0.0)) * 0.09
            bm_c.faces.new([
                bm_c.verts.new(p0 + rad0), bm_c.verts.new(p0 - rad0),
                bm_c.verts.new(p1 - rad1), bm_c.verts.new(p1 + rad1),
            ])

    mc = bpy.data.meshes.new("SpiderwebCracks")
    bm_c.to_mesh(mc)
    bm_c.free()
    cracks_obj = bpy.data.objects.new("Gravity_SpiderwebCracks", mc)
    cracks_obj.data.materials.append(mat_crack_glow)
    scene.collection.objects.link(cracks_obj)
    cracks_obj.parent = root

    # 3) Descending Translucent Atmospheric Compression Dome (天穹下压重力球壳 — Fujitora/Aizen style!)
    mat_dome_outer = make_gravity_dome_mat("GravityDomeOuter", rim_col=(0.64, 0.42, 1.0), core_col=(0.12, 0.06, 0.32), strength=1.85, max_alpha=0.50)
    mat_dome_inner = make_gravity_dome_mat("GravityDomeInner", rim_col=(0.86, 0.80, 1.0), core_col=(0.24, 0.14, 0.56), strength=2.2, max_alpha=0.42)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=13.5, location=(0, 0, 18.0))
    dome_out = bpy.context.active_object
    dome_out.name = "Gravity_CompressionDome_Outer"
    dome_out.scale = (1.0, 1.0, 0.72)  # Flattened heavy lens/dome pressing down!
    for p in dome_out.data.polygons:
        p.use_smooth = True
    dome_out.data.materials.append(mat_dome_outer)
    dome_out.parent = root

    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=9.2, location=(0, 0, 16.0))
    dome_in = bpy.context.active_object
    dome_in.name = "Gravity_CompressionDome_Inner"
    dome_in.scale = (1.0, 1.0, 0.65)
    for p in dome_in.data.polygons:
        p.use_smooth = True
    dome_in.data.materials.append(mat_dome_inner)
    dome_in.parent = root

    # Animate heavy descending slam from high sky -> crushing down onto the ground!
    for dome, z_start, z_end in ((dome_out, 19.5, 4.2), (dome_in, 17.5, 2.8)):
        dome.location.z = z_start
        dome.keyframe_insert("location", frame=1)
        dome.location.z = z_end + 0.6
        dome.keyframe_insert("location", frame=36)
        # Heavy pulsing downward crush!
        dome.location.z = z_end - 0.5
        dome.keyframe_insert("location", frame=58)
        dome.location.z = z_end + 0.35
        dome.keyframe_insert("location", frame=80)
        dome.location.z = z_end - 0.45
        dome.keyframe_insert("location", frame=105)

    # 4) Vertical Downward-Crushing Anime Gravity Lines (90 根垂直下压重力流线!)
    mat_line_vio = make_pressure_line_mat("GravLineViolet", (0.64, 0.42, 1.0), strength=2.2, alpha=0.55)
    mat_line_wht = make_pressure_line_mat("GravLineWhite", (0.90, 0.88, 1.0), strength=2.6, alpha=0.68)
    line_coll = bpy.data.collections.new("Gravity_DownwardLines")
    scene.collection.children.link(line_coll)

    for k in range(90):
        ang = rng.uniform(0, math.pi * 2.0)
        r = 1.2 + math.sqrt(rng.random()) * 13.5
        h_len = rng.uniform(4.5, 11.5)
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=rng.uniform(0.022, 0.055), depth=h_len, location=(math.cos(ang) * r, math.sin(ang) * r, 22.0))
        ln = bpy.context.active_object
        ln.name = f"GravLine_{k:02d}"
        ln.data.materials.append(mat_line_wht if k % 3 == 0 else mat_line_vio)
        line_coll.objects.link(ln)
        bpy.context.scene.collection.objects.unlink(ln)
        ln.parent = root

        # Rapid continuous downward plunging motion!
        phase = (k * 7) % 40
        for rep in range(3):
            f0 = max(1, phase + rep * 36 - 10)
            f1 = f0 + 28
            if f0 > FRAME_END:
                break
            ln.location.z = 22.0 + rng.uniform(0, 6.0)
            ln.keyframe_insert("location", frame=f0)
            ln.location.z = -1.5
            ln.keyframe_insert("location", frame=min(FRAME_END, f1))

    # 5) Repeated Downward-Slamming Horizontal Air-Compression Rings (多层下压横扫气环!)
    mat_ring_air = make_shock_ring_mat("AirCompressionRing", (0.82, 0.72, 1.0), strength=2.4, ring_r=0.86, ring_w=0.10, alpha_mul=0.72)
    mat_ring_vio = make_shock_ring_mat("GravWaveRing", (0.52, 0.24, 1.0), strength=2.1, ring_r=0.82, ring_w=0.15, alpha_mul=0.65)
    ring_coll = bpy.data.collections.new("Gravity_CompressionRings")
    scene.collection.children.link(ring_coll)

    # A) Vertical descending horizontal pressure rings (pressing down through the air!)
    for k in range(5):
        bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 18.0))
        ro = bpy.context.active_object
        ro.name = f"DescendRing_{k}"
        ro.data.materials.append(mat_ring_vio)
        ring_coll.objects.link(ro)
        bpy.context.scene.collection.objects.unlink(ro)
        ro.parent = root
        f0 = 6 + k * 20
        ro.location.z = 19.0
        ro.scale = (8.5, 8.5, 1.0)
        ro.keyframe_insert("location", frame=f0)
        ro.keyframe_insert("scale", frame=f0)
        ro.location.z = 0.25
        ro.scale = (16.5, 16.5, 1.0)
        ro.keyframe_insert("location", frame=min(FRAME_END, f0 + 26))
        ro.keyframe_insert("scale", frame=min(FRAME_END, f0 + 26))

    # B) Ground-skimming radial air-blast rings exploding outward horizontally upon each gravity slam!
    for k in range(5):
        bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0.28))
        ro = bpy.context.active_object
        ro.name = f"GroundSlamRing_{k}"
        ro.data.materials.append(mat_ring_air)
        ring_coll.objects.link(ro)
        bpy.context.scene.collection.objects.unlink(ro)
        ro.parent = root
        f0 = 26 + k * 20
        ro.scale = (3.5, 3.5, 1.0)
        ro.keyframe_insert("scale", frame=f0)
        ro.scale = (26.0, 26.0, 1.0)
        ro.keyframe_insert("scale", frame=min(FRAME_END, f0 + 30))

    # 6) Ground-Pressed Fractured Stone Slabs & Outward-Blasted Pebbles (被压裂翘起的地砖碎石)
    mat_slab = make_pbr_mat("CrushedSlab", (0.11, 0.10, 0.14), metallic=0.10, roughness=0.88)
    slab_coll = bpy.data.collections.new("Gravity_CrushedSlabs")
    scene.collection.children.link(slab_coll)
    for k in range(32):
        ang = (k / 32.0) * math.pi * 2.0 + rng.uniform(-0.1, 0.1)
        r = 10.5 + rng.uniform(-1.8, 3.2)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(math.cos(ang) * r, math.sin(ang) * r, 0.15))
        sb = bpy.context.active_object
        sb.name = f"CrushedSlab_{k:02d}"
        sb.scale = (rng.uniform(0.7, 1.8), rng.uniform(0.6, 1.5), rng.uniform(0.18, 0.42))
        # Tilted upward along the crater rim as if crushed down in the middle!
        sb.rotation_euler = (math.sin(ang) * rng.uniform(0.25, 0.65), -math.cos(ang) * rng.uniform(0.25, 0.65), ang)
        sb.data.materials.append(mat_slab)
        slab_coll.objects.link(sb)
        bpy.context.scene.collection.objects.unlink(sb)
        sb.parent = root

    # 7) Overhead Cold-Violet Gravity Lighting + Ground Rim Light
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 22))
    top_l = bpy.context.active_object
    top_l.data.energy = 28000
    top_l.data.color = (0.62, 0.45, 1.0)
    top_l.data.size = 18

    bpy.ops.object.light_add(type="AREA", location=(-16, -20, 10))
    key_l = bpy.context.active_object
    key_l.data.energy = 9000
    key_l.data.color = (0.88, 0.90, 1.0)
    key_l.data.size = 10
    key_l.rotation_euler = (math.radians(65), 0, math.radians(-38))

    # 8) Camera & Save .blend
    cam_d = bpy.data.cameras.new("GravCam")
    cam_d.lens = 28
    cam_o = bpy.data.objects.new("GravCam", cam_d)
    scene.collection.objects.link(cam_o)
    scene.camera = cam_o

    def aim(loc, tgt, lens=28):
        cam_d.lens = lens
        cam_o.location = Vector(loc)
        cam_o.rotation_euler = (Vector(tgt) - cam_o.location).to_track_quat("-Z", "Y").to_euler()

    aim((0.0, -28.0, 9.5), (0.0, 0.0, 4.0), lens=28)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
    print(f"[OK] Saved {OUT_BLEND}")

    shots = [
        (24, (0.0, -30.0, 10.5), (0.0, 0.0, 6.2), 28, "gravity_01_descend.png"),
        (56, (6.5, -28.0, 8.2),  (0.0, 0.0, 3.0), 26, "gravity_02_crush_slam.png"),
        (86, (-11.0, -16.5, 4.8), (0.0, 0.0, 1.2), 32, "gravity_03_crater_closeup.png"),
    ]
    for f_num, loc, tgt, lens, fname in shots:
        scene.frame_set(f_num)
        aim(loc, tgt, lens)
        out_p = os.path.join(PREVIEW_DIR, fname)
        scene.render.filepath = out_p
        bpy.ops.render.render(write_still=True)
        print(f"[OK] Rendered {out_p}")

    print("=== ANIME GRAVITY PRESSURE BLENDER PREVIEW COMPLETE ===")


if __name__ == "__main__":
    build_scene()
