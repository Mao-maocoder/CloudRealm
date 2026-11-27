"""
Generates Blender assets for 《云境》元婴期 · 万剑归宗 (Concept-faithful Celestial Sapphire & Lotus Edition):
  1. resource/skill/nascent-sword-array/Nascent_Sovereign_Sword.glb
  2. resource/skill/nascent-sword-array/Nascent_SkyArray_Outer_RGBA.png  (1024x1024 Cycles RGBA: 4 gilded cardinal crests + cloud-scroll sapphire rings)
  3. resource/skill/nascent-sword-array/Nascent_SkyArray_Inner_RGBA.png  (1024x1024 Cycles RGBA: 16-petal Celestial Lotus mandala + violet-azure rune wheel)
  4. resource/skill/nascent-sword-array/Nascent_Climax_Crater_RGBA.png   (1024x1024 Cycles RGBA: sapphire-gold radial fissures)
"""
import os
import math
import random
import bpy
import bmesh
from mathutils import Vector

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT_DIR, "resource", "skill", "nascent-sword-array")
PREVIEW_DIR = os.environ.get("NAS_PREVIEW_DIR", OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(PREVIEW_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 8
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
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


def make_emissive_mat(name, color, strength=1.2, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1.0)
    emit.inputs["Strength"].default_value = strength
    if alpha < 0.999:
        trans = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = alpha
        nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
        nt.links.new(emit.outputs["Emission"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    else:
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


def make_radial_glow_mat(name, inner_col, outer_col, strength=0.85, power=2.4, ring_center=0.0, ring_width=0.25, max_alpha=0.55):
    """Restrained, saturated radial glow plane (never blows out to white)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")

    tex = nt.nodes.new("ShaderNodeTexCoord")
    sub_uv = nt.nodes.new("ShaderNodeVectorMath")
    sub_uv.operation = "SUBTRACT"
    sub_uv.inputs[1].default_value = (0.5, 0.5, 0.0)
    mul_uv = nt.nodes.new("ShaderNodeVectorMath")
    mul_uv.operation = "SCALE"
    mul_uv.inputs["Scale"].default_value = 2.0
    vlen = nt.nodes.new("ShaderNodeVectorMath")
    vlen.operation = "LENGTH"
    nt.links.new(tex.outputs["UV"], sub_uv.inputs[0])
    nt.links.new(sub_uv.outputs["Vector"], mul_uv.inputs[0])
    nt.links.new(mul_uv.outputs["Vector"], vlen.inputs[0])

    if ring_center > 0.0:
        sub = nt.nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = ring_center
        absv = nt.nodes.new("ShaderNodeMath")
        absv.operation = "ABSOLUTE"
        div = nt.nodes.new("ShaderNodeMath")
        div.operation = "DIVIDE"
        div.inputs[1].default_value = max(0.01, ring_width)
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.use_clamp = True
        inv.inputs[0].default_value = 1.0
        nt.links.new(vlen.outputs["Value"], sub.inputs[0])
        nt.links.new(sub.outputs["Value"], absv.inputs[0])
        nt.links.new(absv.outputs["Value"], div.inputs[0])
        nt.links.new(div.outputs["Value"], inv.inputs[1])
        fall_src = inv.outputs["Value"]
    else:
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.use_clamp = True
        inv.inputs[0].default_value = 1.0
        nt.links.new(vlen.outputs["Value"], inv.inputs[1])
        fall_src = inv.outputs["Value"]

    pw = nt.nodes.new("ShaderNodeMath")
    pw.operation = "POWER"
    pw.inputs[1].default_value = power
    nt.links.new(fall_src, pw.inputs[0])

    scale_a = nt.nodes.new("ShaderNodeMath")
    scale_a.operation = "MULTIPLY"
    scale_a.inputs[1].default_value = max_alpha
    nt.links.new(pw.outputs["Value"], scale_a.inputs[0])

    mix_col = nt.nodes.new("ShaderNodeMix")
    mix_col.data_type = "RGBA"
    mix_col.inputs["A"].default_value = (*outer_col, 1.0)
    mix_col.inputs["B"].default_value = (*inner_col, 1.0)
    nt.links.new(pw.outputs["Value"], mix_col.inputs["Factor"])

    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = strength
    nt.links.new(mix_col.outputs["Result"], emit.inputs["Color"])

    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(scale_a.outputs["Value"], mix_sh.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix_sh.inputs[1])
    nt.links.new(emit.outputs["Emission"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    return mat


def setup_ortho_camera(scene, ortho_scale=22.4, z=16.0):
    cam_data = bpy.data.cameras.new("OrthoCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_obj = bpy.data.objects.new("OrthoCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (0.0, 0.0, z)
    cam_obj.rotation_euler = (0.0, 0.0, 0.0)
    scene.camera = cam_obj
    scene.render.film_transparent = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    world = bpy.data.worlds.new("EmptyWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1.0)
        bg.inputs[1].default_value = 0.0
    return cam_obj


def add_ring(radius, width, z, mat, segs=128):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=width, major_segments=segs, minor_segments=10,
        location=(0, 0, z),
    )
    o = bpy.context.active_object
    o.data.materials.append(mat)
    return o


def add_box(loc, scale, rot_z, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=(0, 0, rot_z))
    o = bpy.context.active_object
    o.scale = scale
    o.data.materials.append(mat)
    return o


def add_polyline_ribbon(points, width, z, mat, closed=False):
    """Creates a crisp flat ribbon along a 2D polyline (for lotus petals, cloud scrolls, cardinal crests)."""
    bm = bmesh.new()
    n = len(points)
    if n < 2:
        bm.free()
        return None
    lefts, rights = [], []
    for i in range(n):
        p = Vector((points[i][0], points[i][1], z))
        p_prev = Vector((points[(i - 1) % n][0], points[(i - 1) % n][1], z)) if (closed or i > 0) else p
        p_next = Vector((points[(i + 1) % n][0], points[(i + 1) % n][1], z)) if (closed or i < n - 1) else p
        t = (p_next - p_prev)
        if t.length < 1e-6:
            t = Vector((1, 0, 0))
        else:
            t.normalize()
        perp = Vector((-t.y, t.x, 0.0)) * (width * 0.5)
        lefts.append(bm.verts.new(p + perp))
        rights.append(bm.verts.new(p - perp))
    end_i = n if closed else n - 1
    for i in range(end_i):
        i2 = (i + 1) % n
        bm.faces.new((lefts[i], rights[i], rights[i2], lefts[i2]))
    m = bpy.data.meshes.new("RibbonLine")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new("RibbonLine", m)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def add_lotus_petal(radius_inner, radius_outer, half_angle, angle_center, z, mat_outline, mat_fill=None, width=0.065):
    """Draws a graceful pointed Xianxia lotus petal outline (and optional soft translucent fill)."""
    pts = []
    segs = 18
    # Left curve from inner to outer tip
    for i in range(segs + 1):
        t = i / segs
        r = radius_inner + (radius_outer - radius_inner) * t
        bulge = math.sin(t * math.pi) * (1.0 - 0.25 * t)
        a = angle_center - half_angle * bulge
        pts.append((math.cos(a) * r, math.sin(a) * r))
    # Right curve from outer tip back to inner
    for i in range(segs, -1, -1):
        t = i / segs
        r = radius_inner + (radius_outer - radius_inner) * t
        bulge = math.sin(t * math.pi) * (1.0 - 0.25 * t)
        a = angle_center + half_angle * bulge
        pts.append((math.cos(a) * r, math.sin(a) * r))

    add_polyline_ribbon(pts, width, z + 0.02, mat_outline, closed=True)
    # Central petal vein
    v_pts = [
        (math.cos(angle_center) * (radius_inner + 0.15), math.sin(angle_center) * (radius_inner + 0.15)),
        (math.cos(angle_center) * (radius_outer - 0.18), math.sin(angle_center) * (radius_outer - 0.18)),
    ]
    add_polyline_ribbon(v_pts, width * 0.55, z + 0.01, mat_outline, closed=False)

    if mat_fill is not None:
        bm = bmesh.new()
        verts = [bm.verts.new((px, py, z - 0.01)) for px, py in pts]
        bm.faces.new(verts)
        m = bpy.data.meshes.new("PetalFill")
        bm.to_mesh(m)
        bm.free()
        o = bpy.data.objects.new("PetalFill", m)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(mat_fill)


# ==============================================================================
# ASSET 1: Nascent_Sovereign_Sword.glb (Celestial Sapphire + Silver + Pale Gold)
# ==============================================================================
def build_sovereign_sword():
    scene = clear_scene()
    mat_blade = make_pbr_mat(
        "SapphireBlade",
        base_color=(0.14, 0.44, 0.96),
        metallic=0.88,
        roughness=0.14,
        emission_color=(0.12, 0.52, 1.0),
        emission_strength=0.65,
    )
    mat_edge = make_pbr_mat(
        "AzureEdgeGlow",
        base_color=(0.75, 0.94, 1.0),
        metallic=0.20,
        roughness=0.08,
        emission_color=(0.55, 0.90, 1.0),
        emission_strength=2.2,
    )
    mat_gold = make_pbr_mat(
        "PaleGold",
        base_color=(0.98, 0.84, 0.46),
        metallic=0.94,
        roughness=0.18,
        emission_color=(0.98, 0.82, 0.42),
        emission_strength=0.38,
    )
    mat_gold_rune = make_pbr_mat(
        "GoldRuneGlow",
        base_color=(1.0, 0.92, 0.62),
        metallic=0.35,
        roughness=0.12,
        emission_color=(1.0, 0.88, 0.52),
        emission_strength=2.2,
    )
    mat_core_gem = make_pbr_mat(
        "SapphireGem",
        base_color=(0.24, 0.78, 1.0),
        metallic=0.05,
        roughness=0.04,
        emission_color=(0.35, 0.86, 1.0),
        emission_strength=3.2,
    )
    mat_dark_wrap = make_pbr_mat(
        "HiltIndigo",
        base_color=(0.06, 0.10, 0.24),
        metallic=0.35,
        roughness=0.40,
        emission_color=(0.08, 0.16, 0.38),
        emission_strength=0.25,
    )

    root = bpy.data.objects.new("Nascent_Sovereign_Sword", None)
    scene.collection.objects.link(root)

    def link(obj):
        scene.collection.objects.link(obj)
        obj.parent = root
        return obj

    bm = bmesh.new()
    stations = [
        (0.00, 0.004, 0.002, 0.003, 0.002),
        (0.80, 0.28,  0.12,  0.08,  0.06),
        (2.00, 0.50,  0.22,  0.15,  0.11),
        (3.80, 0.64,  0.28,  0.19,  0.13),
        (6.40, 0.74,  0.32,  0.22,  0.15),
        (9.00, 0.84,  0.36,  0.25,  0.17),
        (10.10, 0.94, 0.40,  0.28,  0.19),
        (10.60, 0.74, 0.32,  0.24,  0.20),
    ]
    rings = []
    for z, wx, rx, ry, cy in stations:
        pts = [
            (-wx, 0.0, z), (-rx, ry, z), (0.0, cy, z), (rx, ry, z),
            (wx, 0.0, z), (rx, -ry, z), (0.0, -cy, z), (-rx, -ry, z),
        ]
        rings.append([bm.verts.new(p) for p in pts])
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for k in range(8):
            k2 = (k + 1) % 8
            bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new("BladeMesh")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new("Sovereign_Blade", m)
    o.data.materials.append(mat_blade)
    link(o)

    bm = bmesh.new()
    for side in (-1.0, 1.0):
        er = []
        for z, wx, rx, ry, cy in stations:
            ox = side * (wx + 0.048)
            ix = side * max(0.002, wx - 0.14)
            iy = ry * 0.42
            er.append([bm.verts.new(p) for p in [(ox, 0.0, z), (ix, iy, z), (ix, -iy, z)]])
        for i in range(len(er) - 1):
            for k in range(3):
                k2 = (k + 1) % 3
                bm.faces.new((er[i][k], er[i][k2], er[i + 1][k2], er[i + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new("EdgeMesh")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new("Sovereign_EdgeGlow", m)
    o.data.materials.append(mat_edge)
    link(o)

    bm = bmesh.new()
    for side in (-1.0, 1.0):
        z0, z1 = 1.6, 10.1
        w = 0.075
        y0, y1 = side * 0.19, side * 0.255
        v = [
            bm.verts.new((-w, y0, z0)), bm.verts.new((w, y0, z0)),
            bm.verts.new((w, y1, z0)), bm.verts.new((-w, y1, z0)),
            bm.verts.new((-w * 1.35, y0, z1)), bm.verts.new((w * 1.35, y0, z1)),
            bm.verts.new((w * 1.35, y1, z1)), bm.verts.new((-w * 1.35, y1, z1)),
        ]
        for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)):
            bm.faces.new([v[j] for j in f])
        for k in range(7):
            zc = 2.3 + k * 1.15
            dx = 0.22 + k * 0.016
            dz = 0.34
            yc, yt = side * 0.24, side * 0.32
            c = bm.verts.new((0, yt, zc))
            p = [
                bm.verts.new((0, yc, zc - dz)),
                bm.verts.new((dx, yc, zc)),
                bm.verts.new((0, yc, zc + dz)),
                bm.verts.new((-dx, yc, zc)),
            ]
            for j in range(4):
                bm.faces.new((p[j], p[(j + 1) % 4], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new("RuneSpineMesh")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new("Sovereign_RuneSpine", m)
    o.data.materials.append(mat_gold_rune)
    link(o)

    bm = bmesh.new()
    for side in (-1.0, 1.0):
        wing_st = [
            (0.0, 10.65, 0.44, 0.38), (0.85, 10.74, 0.48, 0.34),
            (1.68, 10.45, 0.39, 0.25), (2.50, 9.92, 0.27, 0.16),
            (3.12, 9.35, 0.11, 0.07), (3.42, 8.95, 0.02, 0.02),
        ]
        wr = []
        for x_d, zc, hz, ty in wing_st:
            x = side * x_d
            pts = [
                (x, 0, zc + hz), (x, ty, zc + hz * 0.25), (x, ty * 0.7, zc - hz * 0.55),
                (x, 0, zc - hz), (x, -ty * 0.7, zc - hz * 0.55), (x, -ty, zc + hz * 0.25),
            ]
            wr.append([bm.verts.new(p) for p in pts])
        for i in range(len(wr) - 1):
            for k in range(6):
                k2 = (k + 1) % 6
                bm.faces.new((wr[i][k], wr[i][k2], wr[i + 1][k2], wr[i + 1][k]))
        bm.faces.new(wr[-1])

        horn_st = [
            (0.92, 10.95, 0.19, 0.18), (1.58, 11.30, 0.15, 0.13),
            (2.12, 11.68, 0.09, 0.08), (2.40, 12.00, 0.02, 0.02),
        ]
        hr = []
        for x_d, zc, hz, ty in horn_st:
            x = side * x_d
            hr.append([bm.verts.new(p) for p in [(x, 0, zc + hz), (x, ty, zc), (x, 0, zc - hz), (x, -ty, zc)]])
        for i in range(len(hr) - 1):
            for k in range(4):
                k2 = (k + 1) % 4
                bm.faces.new((hr[i][k], hr[i][k2], hr[i + 1][k2], hr[i + 1][k]))
        bm.faces.new(hr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new("GuardMesh")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new("Sovereign_Guard", m)
    o.data.materials.append(mat_gold)
    for p in o.data.polygons:
        p.use_smooth = True
    link(o)

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.52, location=(0, 0, 10.62))
    gem = bpy.context.active_object
    gem.name = "Sovereign_CoreGem"
    gem.scale = (0.85, 0.85, 1.38)
    bpy.ops.object.transform_apply(scale=True)
    for p in gem.data.polygons:
        p.use_smooth = True
    gem.data.materials.append(mat_core_gem)
    gem.parent = root

    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.22, depth=2.45, location=(0, 0, 12.1))
    hilt = bpy.context.active_object
    hilt.name = "Sovereign_Hilt"
    hilt.data.materials.append(mat_dark_wrap)
    hilt.parent = root

    for k in range(5):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.255, minor_radius=0.046, major_segments=20, minor_segments=8,
            location=(0, 0, 11.22 + k * 0.44),
        )
        r_o = bpy.context.active_object
        r_o.name = f"Sovereign_HiltRing_{k}"
        r_o.data.materials.append(mat_gold)
        r_o.parent = root

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.39, location=(0, 0, 13.55))
    pom = bpy.context.active_object
    pom.name = "Sovereign_Pommel"
    pom.scale = (1.0, 0.85, 1.38)
    bpy.ops.object.transform_apply(scale=True)
    pom.data.materials.append(mat_gold)
    pom.parent = root

    bpy.ops.mesh.primitive_torus_add(
        major_radius=2.18, minor_radius=0.055, major_segments=48, minor_segments=8,
        location=(0, 0, 11.0), rotation=(math.pi / 2, 0, 0),
    )
    halo = bpy.context.active_object
    halo.name = "Sovereign_SacredHalo"
    halo.data.materials.append(mat_gold_rune)
    halo.parent = root

    for k in range(8):
        ang = k * (math.pi / 4.0)
        r_mid = 2.46
        bpy.ops.mesh.primitive_cone_add(
            vertices=4, radius1=0.11, radius2=0.005, depth=0.68,
            location=(math.cos(ang) * r_mid, 0, 11.0 + math.sin(ang) * r_mid),
            rotation=(0, math.pi / 2 - ang, 0),
        )
        sp = bpy.context.active_object
        sp.name = f"Sovereign_HaloSpike_{k}"
        sp.data.materials.append(mat_gold_rune)
        sp.parent = root

    glb_path = os.path.join(OUT_DIR, "Nascent_Sovereign_Sword.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    print(f"[OK] Exported {glb_path}")


# ==============================================================================
# ASSET 2: Nascent_SkyArray_Outer_RGBA.png (Concept 3: Sapphire Cloud-Scroll Ring + 4 Gold Cardinal Crests)
# ==============================================================================
def build_outer_array_texture():
    scene = clear_scene()
    setup_ortho_camera(scene, ortho_scale=24.0, z=16.0)

    mat_sapphire = make_emissive_mat("Sapphire", (0.12, 0.56, 1.0), strength=1.25)
    mat_azure = make_emissive_mat("Azure", (0.36, 0.84, 1.0), strength=1.35)
    mat_violet = make_emissive_mat("Violet", (0.48, 0.36, 1.0), strength=1.20)
    mat_gold = make_emissive_mat("CardinalGold", (1.0, 0.88, 0.54), strength=1.45)
    mat_white = make_emissive_mat("CrispWhite", (0.94, 0.98, 1.0), strength=1.55)

    # Restrained deep sapphire-violet ring aura (gives rich blue color instead of white blowout!)
    bpy.ops.mesh.primitive_plane_add(size=23.2, location=(0, 0, -0.42))
    pl = bpy.context.active_object
    pl.data.materials.append(
        make_radial_glow_mat("OuterAura", (0.18, 0.68, 1.0), (0.06, 0.24, 0.88), strength=0.95, power=2.2, ring_center=0.78, ring_width=0.16, max_alpha=0.52)
    )
    bpy.ops.mesh.primitive_plane_add(size=23.2, location=(0, 0, -0.46))
    pl2 = bpy.context.active_object
    pl2.data.materials.append(
        make_radial_glow_mat("MidAura", (0.38, 0.32, 1.0), (0.08, 0.42, 0.96), strength=0.85, power=2.4, ring_center=0.56, ring_width=0.14, max_alpha=0.40)
    )

    # Crisp concentric celestial rings
    add_ring(9.65, 0.068, 0.0, mat_azure, 144)
    add_ring(9.32, 0.026, 0.0, mat_white, 144)
    add_ring(7.92, 0.055, 0.0, mat_sapphire, 128)
    add_ring(7.65, 0.022, 0.0, mat_violet, 128)
    add_ring(6.25, 0.048, 0.0, mat_azure, 128)
    add_ring(5.98, 0.020, 0.0, mat_white, 128)

    # 4 Ornate Gilded Cardinal Diamond Crests (N, E, S, W — exact signature silhouette from Concept 3!)
    for k in range(4):
        ang = k * (math.pi / 2.0)
        ca, sa = math.cos(ang), math.sin(ang)
        ta, tb = -sa, ca  # tangent

        def to_xy(r_val, tang_val):
            return (ca * r_val + ta * tang_val, sa * r_val + tb * tang_val)

        # Sweeping wing brackets flanking the crest along r=9.65
        for sgn in (-1.0, 1.0):
            wing = [
                to_xy(9.65, sgn * 0.45),
                to_xy(10.02, sgn * 0.95),
                to_xy(9.88, sgn * 1.55),
                to_xy(9.68, sgn * 2.10),
            ]
            add_polyline_ribbon(wing, 0.11, 0.06, mat_gold)
            wing_inner = [
                to_xy(9.32, sgn * 0.35),
                to_xy(9.55, sgn * 0.95),
                to_xy(9.36, sgn * 1.65),
            ]
            add_polyline_ribbon(wing_inner, 0.055, 0.05, mat_white)

        # Sharp outer diamond spire pointing radially outward
        spire = [
            to_xy(8.55, 0.0),
            to_xy(9.65, 0.62),
            to_xy(11.35, 0.0),
            to_xy(9.65, -0.62),
        ]
        add_polyline_ribbon(spire, 0.11, 0.08, mat_gold, closed=True)
        # Inner bright cyan-white diamond gem inside the cardinal crest
        gem = [
            to_xy(9.10, 0.0),
            to_xy(9.65, 0.30),
            to_xy(10.35, 0.0),
            to_xy(9.65, -0.30),
        ]
        add_polyline_ribbon(gem, 0.08, 0.09, mat_white, closed=True)

    # 8 Secondary Inter-Cardinal Star Spires (at 45, 135, 225, 315 deg + 22.5 offsets)
    for k in range(4):
        ang = math.pi / 4.0 + k * (math.pi / 2.0)
        ca, sa = math.cos(ang), math.sin(ang)
        ta, tb = -sa, ca
        pts = [
            (ca * 6.30, sa * 6.30),
            (ca * 8.15 + ta * 0.24, sa * 8.15 + tb * 0.24),
            (ca * 9.55, sa * 9.55),
            (ca * 8.15 - ta * 0.24, sa * 8.15 - tb * 0.24),
        ]
        add_polyline_ribbon(pts, 0.055, 0.05, mat_azure, closed=True)

    # Auspicious Cloud-Scroll Arcs (祥云纹) nestled in the outer band (r=8.1..9.1)
    for k in range(8):
        base_a = math.pi / 8.0 + k * (math.pi / 4.0)
        scroll = []
        for s in range(25):
            u = (s / 24.0) * 2.0 - 1.0  # -1..1
            a = base_a + u * 0.22
            r = 8.62 + math.cos(u * math.pi * 1.5) * 0.34
            scroll.append((math.cos(a) * r, math.sin(a) * r))
        add_polyline_ribbon(scroll, 0.065, 0.04, mat_azure)
        # Inner cloud curl
        scroll2 = []
        for s in range(17):
            u = (s / 16.0) * 2.0 - 1.0
            a = base_a + u * 0.14
            r = 8.42 - math.cos(u * math.pi) * 0.18
            scroll2.append((math.cos(a) * r, math.sin(a) * r))
        add_polyline_ribbon(scroll2, 0.042, 0.04, mat_white)

    # Delicate rune ticks along the mid-violet ring (r=6.4..7.4)
    for i in range(48):
        a = i * (math.pi * 2.0 / 48.0)
        if i % 3 == 0:
            add_box((math.cos(a) * 6.95, math.sin(a) * 6.95, 0.03), (0.42, 0.045, 0.03), a, mat_violet)
        else:
            add_box((math.cos(a) * 6.95, math.sin(a) * 6.95, 0.03), (0.20, 0.035, 0.03), a, mat_azure)

    out_path = os.path.join(OUT_DIR, "Nascent_SkyArray_Outer_RGBA.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[OK] Rendered {out_path}")


# ==============================================================================
# ASSET 3: Nascent_SkyArray_Inner_RGBA.png (Concept 3: Intricate Celestial Lotus Mandala + Violet Rune Ring)
# ==============================================================================
def build_inner_array_texture():
    scene = clear_scene()
    setup_ortho_camera(scene, ortho_scale=18.0, z=16.0)

    mat_azure = make_emissive_mat("Azure", (0.28, 0.80, 1.0), strength=1.30)
    mat_sapphire = make_emissive_mat("Sapphire", (0.12, 0.50, 1.0), strength=1.15)
    mat_violet = make_emissive_mat("Violet", (0.56, 0.40, 1.0), strength=1.25)
    mat_white = make_emissive_mat("LotusWhite", (0.94, 0.98, 1.0), strength=1.45)
    mat_petal_fill = make_emissive_mat("PetalFill", (0.22, 0.62, 1.0), strength=0.65, alpha=0.22)

    # Soft restrained sapphire-violet halo (NO solid white center!)
    bpy.ops.mesh.primitive_plane_add(size=17.4, location=(0, 0, -0.45))
    pl = bpy.context.active_object
    pl.data.materials.append(
        make_radial_glow_mat("LotusHalo", (0.38, 0.72, 1.0), (0.24, 0.22, 0.92), strength=0.82, power=2.6, ring_center=0.0, max_alpha=0.45)
    )
    bpy.ops.mesh.primitive_plane_add(size=17.4, location=(0, 0, -0.42))
    pl2 = bpy.context.active_object
    pl2.data.materials.append(
        make_radial_glow_mat("RuneHalo", (0.52, 0.38, 1.0), (0.12, 0.56, 1.0), strength=0.88, power=2.5, ring_center=0.68, ring_width=0.15, max_alpha=0.45)
    )

    # Concentric violet-azure sacred rings
    add_ring(7.85, 0.058, 0.0, mat_azure, 128)
    add_ring(7.52, 0.024, 0.0, mat_white, 128)
    add_ring(6.15, 0.052, 0.0, mat_violet, 128)
    add_ring(5.82, 0.022, 0.0, mat_azure, 128)
    add_ring(4.15, 0.040, 0.0, mat_violet, 96)

    # Outer rune ring glyphs (between r=6.2 and r=7.4)
    for i in range(32):
        a = i * (math.pi * 2.0 / 32.0)
        r = 6.82
        add_box((math.cos(a) * r, math.sin(a) * r, 0.04), (0.48, 0.045, 0.03), a, mat_white if i % 4 == 0 else mat_azure)
        if i % 2 == 0:
            add_box((math.cos(a) * (r + 0.16), math.sin(a) * (r + 0.16), 0.04), (0.04, 0.26, 0.03), a, mat_violet)

    # 8-Pointed Sacred Star Geometry inside r=5.8
    for rot_off in (0.0, math.pi / 4.0):
        for k in range(4):
            a1 = rot_off + k * (math.pi / 2.0)
            a2 = rot_off + (k + 1) * (math.pi / 2.0)
            add_polyline_ribbon(
                [(math.cos(a1) * 5.75, math.sin(a1) * 5.75), (math.cos(a2) * 5.75, math.sin(a2) * 5.75)],
                0.048, 0.03, mat_sapphire,
            )

    # Multi-layered 16-Petal Celestial Lotus Mandala in the center (Concept 3 centerpiece!)
    # Outer tier: 8 wide azure-white petals (r=1.1 -> 4.8)
    for i in range(8):
        ang = i * (math.pi / 4.0)
        add_lotus_petal(1.05, 4.95, 0.30, ang, 0.04, mat_azure, mat_petal_fill, width=0.068)
    # Inner tier: 8 offset crisp white petals (r=0.75 -> 3.65)
    for i in range(8):
        ang = i * (math.pi / 4.0) + math.pi / 8.0
        add_lotus_petal(0.72, 3.65, 0.26, ang, 0.08, mat_white, mat_petal_fill, width=0.062)
    # Core lotus crown: 8 delicate inner petals (r=0.35 -> 1.85)
    for i in range(8):
        ang = i * (math.pi / 4.0)
        add_lotus_petal(0.32, 1.90, 0.24, ang, 0.11, mat_white, None, width=0.048)

    add_ring(0.95, 0.035, 0.12, mat_white, 64)

    out_path = os.path.join(OUT_DIR, "Nascent_SkyArray_Inner_RGBA.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[OK] Rendered {out_path}")


# ==============================================================================
# ASSET 4: Nascent_Climax_Crater_RGBA.png (Sapphire-Gold Impact Fissures)
# ==============================================================================
def build_climax_crater_texture():
    scene = clear_scene()
    setup_ortho_camera(scene, ortho_scale=20.0, z=16.0)

    mat_white = make_emissive_mat("CrackWhite", (0.95, 0.98, 1.0), strength=1.6)
    mat_gold = make_emissive_mat("CrackGold", (1.0, 0.86, 0.46), strength=1.35)
    mat_azure = make_emissive_mat("CrackAzure", (0.16, 0.68, 1.0), strength=1.25)

    bpy.ops.mesh.primitive_plane_add(size=19.0, location=(0, 0, -0.35))
    pl = bpy.context.active_object
    pl.data.materials.append(
        make_radial_glow_mat("CraterGlow", (0.45, 0.86, 1.0), (0.12, 0.36, 0.95), strength=0.9, power=2.8, ring_center=0.0, max_alpha=0.52)
    )

    rng = random.Random(2026)
    bm_core = bmesh.new()
    bm_outer = bmesh.new()

    def add_jagged_fissure(bm, start_pt, angle, total_len, base_w, segs=9):
        cur = Vector(start_pt)
        cur_a = angle
        step = total_len / segs
        for s in range(segs):
            frac = s / segs
            next_a = cur_a + rng.uniform(-0.24, 0.24)
            nxt = cur + Vector((math.cos(next_a) * step, math.sin(next_a) * step, 0.0))
            w0 = base_w * (1.0 - frac * 0.88)
            w1 = base_w * (1.0 - (frac + 1.0 / segs) * 0.88)
            d = (nxt - cur).normalized()
            perp = Vector((-d.y, d.x, 0.0))
            v = [
                bm.verts.new(cur + perp * w0),
                bm.verts.new(cur - perp * w0),
                bm.verts.new(nxt - perp * w1),
                bm.verts.new(nxt + perp * w1),
            ]
            bm.faces.new(v)
            if 2 <= s <= segs - 3 and rng.random() < 0.42:
                fork_a = next_a + rng.choice([-1, 1]) * rng.uniform(0.32, 0.65)
                add_jagged_fissure(bm, nxt, fork_a, total_len * (0.35 - frac * 0.2), w1 * 0.85, segs=4)
            cur = nxt
            cur_a = next_a

    for i in range(18):
        ang = (i / 18.0) * math.pi * 2.0 + rng.uniform(-0.12, 0.12)
        length = rng.uniform(5.8, 9.2)
        add_jagged_fissure(bm_outer, (0, 0, 0.02), ang, length, rng.uniform(0.18, 0.28), segs=9)
        add_jagged_fissure(bm_core, (0, 0, 0.06), ang, length * 0.72, rng.uniform(0.06, 0.11), segs=7)

    m_out = bpy.data.meshes.new("CraterOuter")
    bm_outer.to_mesh(m_out)
    bm_outer.free()
    o_out = bpy.data.objects.new("CraterOuter", m_out)
    scene.collection.objects.link(o_out)
    o_out.data.materials.append(mat_azure)

    m_core = bpy.data.meshes.new("CraterCore")
    bm_core.to_mesh(m_core)
    bm_core.free()
    o_core = bpy.data.objects.new("CraterCore", m_core)
    scene.collection.objects.link(o_core)
    o_core.data.materials.append(mat_white)

    add_ring(2.6, 0.052, 0.04, mat_gold, 64)
    add_ring(5.1, 0.032, 0.03, mat_azure, 96)

    out_path = os.path.join(OUT_DIR, "Nascent_Climax_Crater_RGBA.png")
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print(f"[OK] Rendered {out_path}")


if __name__ == "__main__":
    build_sovereign_sword()
    build_outer_array_texture()
    build_inner_array_texture()
    build_climax_crater_texture()
    print("=== CONCEPT-FAITHFUL CELESTIAL SAPPHIRE ASSETS COMPLETE ===")
