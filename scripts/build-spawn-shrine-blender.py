"""
Blender 5.2 high-detail sculpted + procedural PBR textured hero asset generator
for Yunjing (云境) Spawn Sanctuary (长风聚灵台).

Exports resource/architecture/guofeng_spawn_shrine.glb with embedded PBR textures
(BaseColor + Normal + Roughness) and separate named meshes:
  - Terrace          : Beveled carved bluestone spirit terrace with recessed array ring & mossy joints
  - StepStone        : Single sculpted natural flagstone slab (instanced & terrain-snapped at runtime)
  - Waypost          : Ornate curved-eave Xianxia wooden signpost with barrel tiles, corbels, lantern, painted cloud banner & silk ribbons
  - WaypostGlow      : Warm glowing parchment lantern core
  - StoneLantern     : Traditional 6-part carved stone garden lantern with open-pillar fire chamber & upturned roof
  - StoneLanternGlow : Warm glowing core inside the stone lantern
  - RuneStele        : Sculpted rough-hewn ancient monolith stele with chiseled front face & mossy base rocks
  - RuneBoulder      : Sculpted mossy cliff boulder for the right-side auspicious cloud emblem
  - SakuraTrunk      : Gnarled high-detail leaning ancient sakura trunk with fissured bark UVs & flared roots
"""
import math
import os
import random
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, Euler

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_PATH = os.path.join(ROOT_DIR, "resource", "architecture", "guofeng_spawn_shrine.glb")
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ─────────────────────────────────────────────────────────────────────────────
# Fast Vectorized Procedural PBR Texture Synthesis (BaseColor + Normal + Rough)
# ─────────────────────────────────────────────────────────────────────────────
def _fbm_grid(size, freqs, seed=0):
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size), dtype=np.float32)
    amp_sum = 0.0
    amp = 0.55
    for f in freqs:
        g = rng.random((f, f), dtype=np.float32)
        ys = np.linspace(0, f, size, endpoint=False)
        xs = np.linspace(0, f, size, endpoint=False)
        yi = np.floor(ys).astype(np.int32) % f
        xi = np.floor(xs).astype(np.int32) % f
        yf = (ys - np.floor(ys)).astype(np.float32)
        xf = (xs - np.floor(xs)).astype(np.float32)
        yf = yf * yf * (3.0 - 2.0 * yf)
        xf = xf * xf * (3.0 - 2.0 * xf)
        y1 = (yi + 1) % f
        x1 = (xi + 1) % f
        v00 = g[np.ix_(yi, xi)]
        v10 = g[np.ix_(yi, x1)]
        v01 = g[np.ix_(y1, xi)]
        v11 = g[np.ix_(y1, x1)]
        top = v00 * (1.0 - xf[None, :]) + v10 * xf[None, :]
        bot = v01 * (1.0 - xf[None, :]) + v11 * xf[None, :]
        acc += (top * (1.0 - yf[:, None]) + bot * yf[:, None]) * amp
        amp_sum += amp
        amp *= 0.5
    return acc / amp_sum


def _height_to_normal(h, strength=2.4):
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(gx * gx + gy * gy + nz * nz)
    rgb = np.stack([(-gx * inv) * 0.5 + 0.5, (-gy * inv) * 0.5 + 0.5, (nz * inv) * 0.5 + 0.5], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def _pack_image(name, rgb, colorspace="sRGB"):
    h, w, _ = rgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def _make_pbr_material(name, base_rgb, normal_rgb=None, rough_val=0.84, metallic=0.02, emission_rgb=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = rough_val
    bsdf.inputs["Metallic"].default_value = metallic
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex_col = nt.nodes.new("ShaderNodeTexImage")
    tex_col.image = _pack_image(f"{name}_BaseColor", base_rgb, "sRGB")

    # Multiply with Vertex Color ("Color") so baked crevices / AO & mossy variations tint the PBR albedo
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 0.85
    nt.links.new(tex_col.outputs["Color"], mix.inputs["A"])
    nt.links.new(vcol.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    if normal_rgb is not None:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.image = _pack_image(f"{name}_Normal", normal_rgb, "Non-Color")
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.85
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    if emission_rgb is not None and emission_strength > 0.0:
        bsdf.inputs["Emission Color"].default_value = (*emission_rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    return mat


def create_materials():
    S = 256  # Crisp 256x256 procedural PBR maps (keeps GLB fast & compact ~350-550 KB)
    mats = {}

    # 1. Weathered mossy bluestone (青石板/石灯笼/石碑/灵纹巨石)
    n1 = _fbm_grid(S, [4, 8, 16, 32, 64], seed=101)
    n2 = _fbm_grid(S, [6, 12, 24, 48], seed=202)
    speckle = _fbm_grid(S, [32, 64, 128], seed=303)
    crack = np.exp(-((np.abs(n2 - 0.5) * 28.0) ** 2))
    moss_mask = np.clip((n1 - 0.58) * 3.2, 0.0, 0.65)
    stone_r = 0.52 + (n1 - 0.5) * 0.22 + (speckle - 0.5) * 0.12 - crack * 0.16
    stone_g = 0.55 + (n1 - 0.5) * 0.22 + (speckle - 0.5) * 0.11 - crack * 0.15
    stone_b = 0.53 + (n1 - 0.5) * 0.20 + (speckle - 0.5) * 0.10 - crack * 0.14
    stone_rgb = np.stack([
        stone_r * (1 - moss_mask) + 0.34 * moss_mask,
        stone_g * (1 - moss_mask) + 0.48 * moss_mask,
        stone_b * (1 - moss_mask) + 0.28 * moss_mask,
    ], axis=-1)
    stone_h = n1 * 0.45 + speckle * 0.35 - crack * 0.40
    mats["stone"] = _make_pbr_material("Mat_Bluestone", stone_rgb, _height_to_normal(stone_h, 3.2), rough_val=0.86)

    # 2. Aged Chinese timber (雕花古木)
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32) / S
    grain_noise = _fbm_grid(S, [4, 16, 48], seed=404)
    fibers = 0.5 + 0.5 * np.sin((xs * 36.0 + grain_noise * 3.8) * math.tau)
    knots = _fbm_grid(S, [8, 24], seed=405)
    wood_h = fibers * 0.45 + knots * 0.55
    wood_rgb = np.stack([
        0.34 + wood_h * 0.16,
        0.20 + wood_h * 0.10,
        0.13 + wood_h * 0.06,
    ], axis=-1)
    mats["wood"] = _make_pbr_material("Mat_CarvedWood", wood_rgb, _height_to_normal(wood_h, 2.5), rough_val=0.76)

    # 3. Glazed blue-grey barrel roof tiles (青灰筒瓦)
    tile_cols = np.abs(np.sin(xs * 14.0 * math.pi))
    tile_rows = (ys * 10.0) % 1.0
    tile_step = np.clip(tile_rows * 6.0, 0.0, 1.0)
    tile_n = _fbm_grid(S, [8, 24, 64], seed=505)
    tile_h = tile_cols * 0.65 * tile_step + tile_n * 0.18
    tile_rgb = np.stack([
        0.22 + tile_h * 0.16 + tile_n * 0.05,
        0.29 + tile_h * 0.20 + tile_n * 0.05,
        0.37 + tile_h * 0.24 + tile_n * 0.04,
    ], axis=-1)
    mats["tile"] = _make_pbr_material("Mat_RoofTile", tile_rgb, _height_to_normal(tile_h, 4.0), rough_val=0.62, metallic=0.08)

    # 4. Ivory linen banner with painted celadon auspicious cloud emblem (素帛云纹幡)
    weave = _fbm_grid(S, [32, 64], seed=606)
    u = xs * 2.0 - 1.0
    v = ys * 2.0 - 1.0
    # Subtle celadon border
    border = ((np.abs(u) > 0.78) & (np.abs(u) < 0.86) & (np.abs(v) < 0.88)) | ((np.abs(v) > 0.80) & (np.abs(v) < 0.88) & (np.abs(u) < 0.86))
    # Painted cloud scroll in center
    c1 = np.exp(-((np.hypot(u, (v - 0.10) * 1.25) - 0.28) / 0.045) ** 2) * (v > -0.10)
    c2 = np.exp(-((np.hypot(u + 0.32, v + 0.05) - 0.18) / 0.045) ** 2)
    c3 = np.exp(-((np.hypot(u - 0.32, v + 0.05) - 0.18) / 0.045) ** 2)
    cbar = np.exp(-(((v + 0.24) / 0.038) ** 2)) * (np.abs(u) < 0.42)
    emblem = np.clip(c1 + c2 + c3 + cbar + border.astype(np.float32) * 0.65, 0.0, 1.0)
    banner_rgb = np.stack([
        (0.90 + (weave - 0.5) * 0.06) * (1 - emblem * 0.72) + 0.28 * emblem * 0.72,
        (0.86 + (weave - 0.5) * 0.06) * (1 - emblem * 0.72) + 0.54 * emblem * 0.72,
        (0.76 + (weave - 0.5) * 0.05) * (1 - emblem * 0.72) + 0.58 * emblem * 0.72,
    ], axis=-1)
    mats["banner"] = _make_pbr_material("Mat_CloudBanner", banner_rgb, _height_to_normal(weave, 1.0), rough_val=0.90)

    # 5. Gnarled ancient cherry bark with horizontal lenticels & lichen (苍老古樱树皮)
    bn1 = _fbm_grid(S, [4, 12, 32], seed=707)
    bn2 = _fbm_grid(S, [8, 24, 64], seed=708)
    furrows = 0.5 + 0.5 * np.sin((xs * 22.0 + bn1 * 4.5) * math.tau)
    lenticels = np.exp(-((np.sin(ys * 42.0 * math.pi + bn2 * 3.0)) ** 2) * 18.0) * 0.35
    lichen = np.clip((bn1 - 0.66) * 4.5, 0.0, 0.45)
    bark_h = furrows * 0.55 + bn2 * 0.35 + lenticels * 0.25
    bark_rgb = np.stack([
        (0.28 + bark_h * 0.18) * (1 - lichen) + 0.44 * lichen,
        (0.20 + bark_h * 0.14) * (1 - lichen) + 0.48 * lichen,
        (0.16 + bark_h * 0.11) * (1 - lichen) + 0.38 * lichen,
    ], axis=-1)
    mats["bark"] = _make_pbr_material("Mat_SakuraBark", bark_rgb, _height_to_normal(bark_h, 4.2), rough_val=0.92)

    # 6. Warm parchment lantern glow with dark wood lattice ribs
    lat_v = (np.abs(((xs * 4.0) % 1.0) - 0.5) > 0.44).astype(np.float32)
    lat_h = (np.abs(((ys * 3.0) % 1.0) - 0.5) > 0.45).astype(np.float32)
    rib = np.clip(lat_v + lat_h, 0.0, 1.0)
    glow_rgb = np.stack([
        1.0 * (1 - rib * 0.72) + 0.18 * rib * 0.72,
        0.84 * (1 - rib * 0.72) + 0.12 * rib * 0.72,
        0.48 * (1 - rib * 0.72) + 0.08 * rib * 0.72,
    ], axis=-1)
    mats["glow"] = _make_pbr_material("Mat_LanternGlow", glow_rgb, None, rough_val=0.4, emission_rgb=(1.0, 0.80, 0.42), emission_strength=1.8)

    # 7. Aged bronze / brass fittings (古铜饰件)
    bronze_rgb = np.stack([
        0.58 + (n1 - 0.5) * 0.12,
        0.46 + (n1 - 0.5) * 0.10,
        0.24 + (n1 - 0.5) * 0.06,
    ], axis=-1)
    mats["bronze"] = _make_pbr_material("Mat_AgedBronze", bronze_rgb, None, rough_val=0.45, metallic=0.65)

    return mats


# ─────────────────────────────────────────────────────────────────────────────
# BMesh Geometry & UV Helpers
# ─────────────────────────────────────────────────────────────────────────────
def box_project_uvs(bm, uv_layer, scale=0.45):
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in f.loops:
            co = loop.vert.co
            if az >= ax and az >= ay:
                loop[uv_layer].uv = (co.x * scale, co.y * scale)
            elif ax >= ay:
                loop[uv_layer].uv = (co.y * scale, co.z * scale)
            else:
                loop[uv_layer].uv = (co.x * scale, co.z * scale)


def paint_faces(faces, col_layer, rgba, top_boost=1.06, bot_dark=0.72):
    for f in faces:
        nz = f.normal.z
        s = top_boost if nz > 0.35 else (bot_dark if nz < -0.35 else 0.92)
        c = (min(1.0, rgba[0] * s), min(1.0, rgba[1] * s), min(1.0, rgba[2] * s), 1.0)
        for loop in f.loops:
            loop[col_layer] = c


def add_beveled_box(bm, col_layer, center, size, color, rot_euler=(0, 0, 0), bevel=0.025, mat_idx=0, jitter=0.0, rng=None, smooth=False):
    mat = Matrix.Translation(center) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    for v in verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    edges = list({e for v in verts for e in v.link_edges})
    stack = list(verts)
    if bevel > 0.0:
        result = bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect="EDGES", clamp_overlap=True)
        stack.extend(v for face in result["faces"] for v in face.verts)
    # Gather all resulting verts/faces connected to this island
    all_verts = set()
    while stack:
        v = stack.pop()
        if not v.is_valid or v in all_verts:
            continue
        all_verts.add(v)
        for e in v.link_edges:
            ov = e.other_vert(v)
            if ov not in all_verts:
                stack.append(ov)
    for v in all_verts:
        if jitter > 0.0 and rng is not None:
            v.co.x += rng.uniform(-jitter, jitter)
            v.co.y += rng.uniform(-jitter, jitter)
            v.co.z += rng.uniform(-jitter * 0.45, jitter * 0.45)
        v.co = mat @ v.co
    faces = {f for v in all_verts for f in v.link_faces}
    for f in faces:
        f.smooth = smooth
        f.material_index = mat_idx
    paint_faces(faces, col_layer, color)
    return list(all_verts)


def add_cyl(bm, col_layer, center, r_bot, r_top, height, segs, color, rot_euler=(0, 0, 0), mat_idx=0, smooth=True):
    mat = Matrix.Translation(center) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r_bot, radius2=r_top, depth=height)
    verts = res["verts"]
    for v in verts:
        v.co = mat @ v.co
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.smooth = smooth
        f.material_index = mat_idx
    paint_faces(faces, col_layer, color)
    return verts


def finalize_mesh(name, bm, materials, uv_scale=0.45, auto_uv=True):
    uv_layer = bm.loops.layers.uv.verify()
    if auto_uv:
        box_project_uvs(bm, uv_layer, uv_scale)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in materials:
        mesh.materials.append(m)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# 1. Sculpted Beveled Bluestone Spirit Terrace (聚灵青石台 — Low & Flush!)
# ─────────────────────────────────────────────────────────────────────────────
def build_terrace(mats):
    rng = random.Random(79160)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")

    # Separate the lower plinth from the carved edge so the foundation reads
    # as a shallow stone course with embedded paving above.
    add_cyl(bm, col, Vector((0, 0, -0.366)), 4.09, 3.91, 0.628, 48, (0.58, 0.65, 0.64), smooth=True)

    # Inner recessed spirit-array carved bluestone disc (r = 2.00m, top at Z = -0.015)
    add_cyl(bm, col, Vector((0, 0, -0.09)), 2.02, 2.00, 0.15, 40, (0.95, 0.98, 0.96), smooth=False)

    # Raised chamfered inner curb ring (20 beveled carved stones, r = 2.02 .. 2.46m)
    for i in range(20):
        a = (i + 0.5) / 20.0 * math.tau
        r = 2.24
        v = 0.88 + rng.uniform(-0.06, 0.06)
        c = (v * 0.96, v * 1.00, v * 0.98)
        add_beveled_box(bm, col, Vector((math.cos(a) * r, math.sin(a) * r, -0.018)), (0.44, 0.67, 0.14), c, (0, 0, a), bevel=0.022, jitter=0.008, rng=rng)

    # Outer radial flagstone ring (22 beveled weathered bluestones, r = 2.48 .. 3.82m)
    for i in range(22):
        a = (i + 0.5) / 22.0 * math.tau
        r = 3.16 + rng.uniform(-0.04, 0.04)
        v = 0.84 + rng.uniform(-0.08, 0.08)
        moss = rng.uniform(0.0, 0.07)
        c = (v * 0.94, v * 1.00 + moss, v * 0.95)
        add_beveled_box(
            bm, col,
            Vector((math.cos(a) * r, math.sin(a) * r, -0.035 + rng.uniform(-0.008, 0.008))),
            (1.32, 0.86, 0.15), c, (rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012), a),
            bevel=0.028, jitter=0.015, rng=rng,
        )

    # Organic outer mossy curb stones tapering gently into the surrounding grass
    for i in range(24):
        a = (i / 24.0) * math.tau + rng.uniform(-0.05, 0.05)
        r = 3.92 + rng.uniform(-0.06, 0.10)
        v = 0.78 + rng.uniform(-0.07, 0.07)
        c = (v * 0.92, v * 1.02, v * 0.91)
        add_beveled_box(
            bm, col,
            Vector((math.cos(a) * r, math.sin(a) * r, -0.10 + rng.uniform(-0.02, 0.01))),
            (0.56, rng.uniform(0.75, 1.05), 0.22), c, (0, 0, a),
            bevel=0.035, jitter=0.02, rng=rng,
        )

    return finalize_mesh("Terrace", bm, [mats["stone"]], uv_scale=0.38)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Single Grounded Stepping Stone Slab (instanced along trail at runtime)
# ─────────────────────────────────────────────────────────────────────────────
def build_step_stone(mats):
    rng = random.Random(79161)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    add_beveled_box(bm, col, Vector((0, 0, -0.02)), (1.28, 0.78, 0.14), (0.86, 0.90, 0.86), (0, 0, 0), bevel=0.032, jitter=0.025, rng=rng)
    return finalize_mesh("StepStone", bm, [mats["stone"]], uv_scale=0.55)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Ornate Curved-Eave Xianxia Wooden Signpost (飞檐路标亭柱)
# ─────────────────────────────────────────────────────────────────────────────
def build_waypost(mats):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    uv_layer = bm.loops.layers.uv.new("UVMap")
    # Material slots: 0=stone, 1=wood, 2=tile, 3=banner, 4=bronze

    # Stepped carved stone plinth (须弥座式基座)
    add_beveled_box(bm, col, Vector((0, 0, 0.04)), (0.76, 0.76, 0.34), (0.86, 0.90, 0.87), bevel=0.028, mat_idx=0)
    add_beveled_box(bm, col, Vector((0, 0, 0.28)), (0.56, 0.56, 0.18), (0.92, 0.95, 0.92), bevel=0.022, mat_idx=0)
    add_cyl(bm, col, Vector((0, 0, 0.42)), 0.22, 0.19, 0.12, 12, (0.95, 0.90, 0.75), mat_idx=4)

    # Main carved wooden pillar + bronze collars
    add_cyl(bm, col, Vector((0, 0, 1.85)), 0.145, 0.125, 2.95, 16, (0.95, 0.92, 0.90), mat_idx=1)
    for cz in (0.62, 2.72, 3.12):
        add_cyl(bm, col, Vector((0, 0, cz)), 0.155, 0.155, 0.08, 16, (0.95, 0.92, 0.85), mat_idx=4)

    # Crossbeam + secondary tie-beam + carved corbel brackets (雀替/斗拱)
    add_beveled_box(bm, col, Vector((-0.38, 0, 2.96)), (1.92, 0.18, 0.16), (0.96, 0.94, 0.92), bevel=0.018, mat_idx=1)
    add_beveled_box(bm, col, Vector((-0.32, 0, 2.74)), (1.58, 0.12, 0.10), (0.90, 0.88, 0.86), bevel=0.012, mat_idx=1)
    # Corbel knee braces under crossbeam
    add_beveled_box(bm, col, Vector((-0.30, 0, 2.66)), (0.46, 0.09, 0.10), (0.90, 0.88, 0.85), rot_euler=(0, -0.58, 0), bevel=0.012, mat_idx=1)
    add_beveled_box(bm, col, Vector((0.26, 0, 2.68)), (0.38, 0.09, 0.10), (0.90, 0.88, 0.85), rot_euler=(0, 0.58, 0), bevel=0.012, mat_idx=1)
    # Bronze end-caps on crossbeam
    add_beveled_box(bm, col, Vector((-1.34, 0, 2.96)), (0.08, 0.20, 0.18), (0.95, 0.92, 0.85), bevel=0.012, mat_idx=4)
    add_beveled_box(bm, col, Vector((0.58, 0, 2.96)), (0.08, 0.20, 0.18), (0.95, 0.92, 0.85), bevel=0.012, mat_idx=4)

    # Sweeping curved Chinese tiled roof (双坡飞檐筒瓦顶)
    # Build smooth curved roof mesh with upturned eaves
    nx, ny = 14, 6
    rx_min, rx_max = -1.48, 0.72
    ry_half = 0.66
    for side in (-1, 1):
        grid = []
        for ix in range(nx + 1):
            tx = ix / nx
            x = rx_min + (rx_max - rx_min) * tx
            edge_u = abs(tx * 2.0 - 1.0)
            eave_lift = (edge_u ** 2.6) * 0.24
            row = []
            for iy in range(ny + 1):
                ty = iy / ny
                y = side * ty * ry_half
                # Concave Chinese roof curve + upturned eaves at tips
                z = 3.68 - 0.56 * (ty ** 0.82) + 0.14 * (ty ** 2.4) + eave_lift * (0.35 + 0.65 * ty)
                v = bm.verts.new(Vector((x, y, z)))
                row.append((v, tx, ty))
            grid.append(row)
        for ix in range(nx):
            for iy in range(ny):
                v00, u00, w00 = grid[ix][iy]
                v10, u10, w10 = grid[ix + 1][iy]
                v11, u11, w11 = grid[ix + 1][iy + 1]
                v01, u01, w01 = grid[ix][iy + 1]
                verts_q = (v00, v10, v11, v01) if side > 0 else (v00, v01, v11, v10)
                f = bm.faces.new(verts_q)
                f.smooth = True
                f.material_index = 2
                for loop in f.loops:
                    loop[col] = (0.96, 0.98, 1.0, 1.0)
                    loop[uv_layer].uv = ((loop.vert.co.x - rx_min) * 0.85, abs(loop.vert.co.y) * 1.45)

    # Under-roof timber soffit rafters & central ridge beam (正脊 + 鸱吻)
    add_beveled_box(bm, col, Vector((-0.38, 0, 3.24)), (1.98, 0.76, 0.12), (0.82, 0.78, 0.75), bevel=0.015, mat_idx=1)
    add_beveled_box(bm, col, Vector((-0.38, 0, 3.72)), (2.18, 0.14, 0.16), (0.92, 0.95, 1.0), bevel=0.02, mat_idx=2)
    # Ornate upturned dragon-tail finials (鸱吻) at both ridge ends
    for fx, sgn in [(-1.44, -1), (0.68, 1)]:
        add_beveled_box(bm, col, Vector((fx, 0, 3.88)), (0.18, 0.14, 0.26), (0.95, 0.92, 0.82), rot_euler=(0, sgn * 0.35, 0), bevel=0.02, mat_idx=4)

    # Hanging wooden lantern frame on the left arm (x = -1.10)
    add_cyl(bm, col, Vector((-1.10, 0, 2.78)), 0.016, 0.016, 0.34, 8, (0.95, 0.90, 0.80), mat_idx=4)
    add_cyl(bm, col, Vector((-1.10, 0, 2.58)), 0.24, 0.08, 0.16, 6, (0.92, 0.90, 0.88), mat_idx=1, smooth=False)
    add_cyl(bm, col, Vector((-1.10, 0, 2.12)), 0.15, 0.18, 0.08, 6, (0.92, 0.90, 0.88), mat_idx=1, smooth=False)
    # Decorative crimson/gold tassel below lantern
    add_cyl(bm, col, Vector((-1.10, 0, 1.94)), 0.04, 0.015, 0.28, 8, (0.92, 0.34, 0.28), mat_idx=4)

    # Billowing ivory cloud banner (云纹垂幡) with dedicated UV mapping for Mat_CloudBanner
    add_cyl(bm, col, Vector((-0.44, 0, 2.70)), 0.022, 0.022, 0.68, 8, (0.92, 0.88, 0.80), rot_euler=(0, math.pi * 0.5, 0), mat_idx=1)
    add_cyl(bm, col, Vector((-0.44, 0, 1.56)), 0.020, 0.020, 0.66, 8, (0.92, 0.88, 0.80), rot_euler=(0, math.pi * 0.5, 0), mat_idx=4)
    b_rows, b_cols = 8, 4
    b_grid = []
    for ir in range(b_rows + 1):
        tr = ir / b_rows
        z = 2.68 - tr * 1.12
        # Gentle breeze billow
        y_off = 0.045 * math.sin(tr * math.pi)
        row = []
        for ic in range(b_cols + 1):
            tc = ic / b_cols
            x = -0.74 + tc * 0.60
            v = bm.verts.new(Vector((x, y_off, z)))
            row.append((v, tc, 1.0 - tr))
        b_grid.append(row)
    for ir in range(b_rows):
        for ic in range(b_cols):
            v00, u00, w00 = b_grid[ir][ic]
            v10, u10, w10 = b_grid[ir][ic + 1]
            v11, u11, w11 = b_grid[ir + 1][ic + 1]
            v01, u01, w01 = b_grid[ir + 1][ic]
            f = bm.faces.new((v00, v10, v11, v01))
            f.smooth = True
            f.material_index = 3
            for loop, (lu, lw) in zip(f.loops, [(u00, w00), (u10, w10), (u11, w11), (u01, w01)]):
                loop[col] = (1.0, 1.0, 1.0, 1.0)
                loop[uv_layer].uv = (lu, lw)

    # Graceful S-curved fluttering silk ribbons trailing from the right crossbeam
    for r_idx, (y_bias, drop, len_x) in enumerate([(0.06, 0.72, 1.05), (-0.06, 0.92, 0.92)]):
        segs = 10
        prev = None
        for k in range(segs + 1):
            t = k / segs
            x = 0.14 + t * len_x
            z = 2.74 - drop * (t ** 1.15) + 0.07 * math.sin(t * 5.2 + r_idx)
            y = y_bias + 0.08 * math.sin(t * 4.5 + r_idx * 1.4)
            w = 0.065 * (1.0 - 0.35 * t)
            v_top = bm.verts.new(Vector((x, y, z + w)))
            v_bot = bm.verts.new(Vector((x, y, z - w)))
            if prev is not None:
                f = bm.faces.new((prev[0], v_top, v_bot, prev[1]))
                f.smooth = True
                f.material_index = 3
                for loop in f.loops:
                    loop[col] = (0.96, 0.99, 1.0, 1.0)
                    loop[uv_layer].uv = (0.08, 0.5)
            prev = (v_top, v_bot)

    # Box-project UVs for non-banner/non-roof parts (stone, wood, bronze)
    for f in bm.faces:
        if f.material_index in (0, 1, 4):
            n = f.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop in f.loops:
                co = loop.vert.co
                if az >= ax and az >= ay:
                    loop[uv_layer].uv = (co.x * 0.65, co.y * 0.65)
                elif ax >= ay:
                    loop[uv_layer].uv = (co.y * 0.65, co.z * 0.65)
                else:
                    loop[uv_layer].uv = (co.x * 0.65, co.z * 0.65)

    waypost_obj = finalize_mesh("Waypost", bm, [mats["stone"], mats["wood"], mats["tile"], mats["banner"], mats["bronze"]], auto_uv=False)

    # Warm glowing lantern core (WaypostGlow)
    bm_glow = bmesh.new()
    col_g = bm_glow.loops.layers.color.new("Color")
    add_cyl(bm_glow, col_g, Vector((-1.10, 0, 2.35)), 0.145, 0.165, 0.38, 12, (1.0, 1.0, 1.0), smooth=True)
    glow_obj = finalize_mesh("WaypostGlow", bm_glow, [mats["glow"]], uv_scale=1.6)

    return waypost_obj, glow_obj


# ─────────────────────────────────────────────────────────────────────────────
# 4. Traditional 6-Part Carved Stone Garden Lantern (精雕石灯笼)
# ─────────────────────────────────────────────────────────────────────────────
def build_stone_lantern(mats):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")

    # 1. Flared hexagonal stone base (基础)
    add_cyl(bm, col, Vector((0, 0, 0.02)), 0.46, 0.40, 0.36, 6, (0.82, 0.86, 0.82), smooth=False)
    add_cyl(bm, col, Vector((0, 0, 0.25)), 0.34, 0.26, 0.14, 6, (0.88, 0.91, 0.88), smooth=False)

    # 2. Waisted carved stone shaft (竿)
    add_cyl(bm, col, Vector((0, 0, 0.56)), 0.18, 0.15, 0.50, 12, (0.90, 0.93, 0.90), smooth=True)
    add_cyl(bm, col, Vector((0, 0, 0.56)), 0.20, 0.20, 0.07, 12, (0.85, 0.88, 0.85), smooth=True)

    # 3. Carved lotus-petal platform (中台)
    add_cyl(bm, col, Vector((0, 0, 0.88)), 0.22, 0.36, 0.16, 6, (0.90, 0.93, 0.90), smooth=False)
    add_cyl(bm, col, Vector((0, 0, 0.99)), 0.38, 0.38, 0.08, 6, (0.94, 0.96, 0.93), smooth=False)

    # 4. Open 6-pillar fire chamber (火袋) so warm glow shines through carved stone windows!
    for i in range(6):
        a = (i / 6.0) * math.tau
        px, py = math.cos(a) * 0.26, math.sin(a) * 0.26
        add_cyl(bm, col, Vector((px, py, 1.24)), 0.036, 0.032, 0.44, 6, (0.86, 0.90, 0.87), smooth=False)

    # 5. Sweeping upturned hexagonal pagoda roof (笠)
    add_cyl(bm, col, Vector((0, 0, 1.50)), 0.56, 0.42, 0.10, 6, (0.86, 0.90, 0.88), smooth=False)
    add_cyl(bm, col, Vector((0, 0, 1.64)), 0.42, 0.14, 0.20, 6, (0.90, 0.94, 0.92), smooth=False)
    # 6 upturned corner eaves (翘角)
    for i in range(6):
        a = (i / 6.0) * math.tau
        add_beveled_box(
            bm, col,
            Vector((math.cos(a) * 0.50, math.sin(a) * 0.50, 1.54)),
            (0.16, 0.09, 0.09), (0.88, 0.92, 0.90),
            rot_euler=(0, -0.35, a), bevel=0.015,
        )

    # 6. Lotus-bud jewel finial (宝珠)
    add_cyl(bm, col, Vector((0, 0, 1.79)), 0.12, 0.06, 0.10, 10, (0.90, 0.94, 0.92), smooth=True)
    add_cyl(bm, col, Vector((0, 0, 1.91)), 0.08, 0.015, 0.16, 10, (0.94, 0.96, 0.94), smooth=True)

    lantern_obj = finalize_mesh("StoneLantern", bm, [mats["stone"]], uv_scale=0.85)

    bm_glow = bmesh.new()
    col_g = bm_glow.loops.layers.color.new("Color")
    add_cyl(bm_glow, col_g, Vector((0, 0, 1.24)), 0.18, 0.18, 0.36, 12, (1.0, 1.0, 1.0), smooth=True)
    glow_obj = finalize_mesh("StoneLanternGlow", bm_glow, [mats["glow"]], uv_scale=1.8)

    return lantern_obj, glow_obj


# ─────────────────────────────────────────────────────────────────────────────
# 5. Sculpted Rough-Hewn Ancient Rune Stele & Mossy Cloud-Rune Boulder
# ─────────────────────────────────────────────────────────────────────────────
def _rock_noise(v, seed=0):
    return (
        math.sin(v.x * 3.1 + seed) * math.cos(v.y * 2.7 - seed) * 0.55
        + math.sin(v.z * 4.3 + v.x * 2.4) * 0.30
        + math.cos(v.y * 6.5 - v.z * 5.2) * 0.15
    )


def build_rune_stele(mats):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")

    res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in res["verts"]:
        # Tall tapered ancient standing monolith silhouette
        z_norm = v.co.z  # -1 .. +1
        taper = 1.0 - 0.52 * max(0.0, z_norm)
        v.co.x *= 0.54 * taper
        v.co.y *= 0.36 * taper
        v.co.z = (z_norm + 0.65) * 1.15  # base at -0.40, top at +1.90
        # Chisel a slightly flatter front face (+Y in Blender = -Z in glTF, facing terrace/player)
        if v.co.y < -0.14:
            v.co.y = v.co.y * 0.68 - 0.08
        n = _rock_noise(v.co, 17)
        v.co.x += n * 0.065
        v.co.y += n * 0.045
        v.co.z += n * 0.055

    for f in bm.faces:
        f.smooth = False
        moss = max(0.0, f.normal.z) * 0.14
        paint_faces([f], col, (0.82 - moss * 0.3, 0.86 + moss, 0.84 - moss * 0.2))

    # Flanking mossy base rocks anchoring the stele naturally into the riverbank
    for cx, cy, cz, sx, sy, sz, seed in [(-0.46, 0.06, 0.04, 0.42, 0.34, 0.28, 31), (0.42, -0.08, 0.00, 0.36, 0.30, 0.24, 47)]:
        r2 = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in r2["verts"]:
            n = _rock_noise(v.co, seed)
            v.co = Vector((cx + v.co.x * sx * (1 + n * 0.22), cy + v.co.y * sy * (1 + n * 0.22), cz + v.co.z * sz * (1 + n * 0.22)))
        faces = {f for v in r2["verts"] for f in v.link_faces}
        for f in faces:
            f.smooth = False
        paint_faces(faces, col, (0.76, 0.84, 0.75))

    return finalize_mesh("RuneStele", bm, [mats["stone"]], uv_scale=0.65)


def build_rune_boulder(mats):
    """Sculpted mossy faceted riverbank boulder with a natural flat front face for the glowing cloud glyph."""
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in res["verts"]:
        v.co.x *= 1.18
        v.co.y *= 0.92
        v.co.z = v.co.z * 0.78 + 0.42
        # Slightly flatter chiseled front face (-Y in Blender = +Z in glTF, facing player)
        if v.co.y < -0.45:
            v.co.y = -0.45 + (v.co.y + 0.45) * 0.45
        n = _rock_noise(v.co, 88)
        v.co += v.co.normalized() * (n * 0.14)

    for f in bm.faces:
        f.smooth = False
        moss = max(0.0, f.normal.z - 0.2) * 0.28
        paint_faces([f], col, (0.80 - moss * 0.4, 0.85 + moss * 0.6, 0.82 - moss * 0.5))

    return finalize_mesh("RuneBoulder", bm, [mats["stone"]], uv_scale=0.52)


# ─────────────────────────────────────────────────────────────────────────────
# 6. High-Detail Gnarled Ancient Sakura Trunk with Proper Cylindrical Bark UVs
# ─────────────────────────────────────────────────────────────────────────────
def catmull_rom(pts, t):
    n = len(pts) - 1
    scaled = max(0.0, min(1.0, t)) * n
    i = min(int(scaled), n - 1)
    u = scaled - i
    p0 = pts[max(0, i - 1)]
    p1 = pts[i]
    p2 = pts[min(n, i + 1)]
    p3 = pts[min(n, i + 2)]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


def add_branch_tube(bm, col_layer, uv_layer, pts, r0, r1, segs=16, sides=10, uv_v_scale=2.2):
    up_ref = Vector((0, 0, 1))
    rings = []
    for j in range(segs + 1):
        t = j / segs
        p = catmull_rom(pts, t)
        a = catmull_rom(pts, max(0.0, t - 0.01))
        b = catmull_rom(pts, min(1.0, t + 0.01))
        tang = (b - a).normalized() if (b - a).length > 1e-5 else up_ref
        rot = up_ref.rotation_difference(tang)
        flare = 1.0 + 0.42 * math.exp(-t * 7.5) if r0 > 0.40 else 1.0
        gnarl = 1.0 + 0.08 * math.sin(t * 14.0)
        r = (r0 * (1.0 - t ** 0.78) + r1 * (t ** 0.78)) * flare * gnarl
        ring = []
        for i in range(sides + 1):
            ang = (i / sides) * math.tau
            ridge = 1.0 + 0.14 * math.cos(ang * 4.0 + t * 6.5) * (1.0 - t * 0.5)
            v = bm.verts.new(p + (rot @ Vector((math.cos(ang) * r * ridge, math.sin(ang) * r * ridge, 0))))
            ring.append((v, i / sides, t * uv_v_scale))
        rings.append(ring)
    for j in range(segs):
        for i in range(sides):
            v00, u00, w00 = rings[j][i]
            v01, u01, w01 = rings[j][i + 1]
            v11, u11, w11 = rings[j + 1][i + 1]
            v10, u10, w10 = rings[j + 1][i]
            try:
                f = bm.faces.new((v00, v01, v11, v10))
                f.smooth = True
                shade = 0.82 + 0.18 * (j / segs)
                for loop, (lu, lw) in zip(f.loops, [(u00, w00), (u01, w01), (u11, w11), (u10, w10)]):
                    loop[col_layer] = (shade, shade, shade, 1.0)
                    loop[uv_layer].uv = (lu * 2.0, lw)
            except ValueError:
                pass


def build_leaning_sakura_trunk(mats):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # Sweeping gnarled main trunk arching gracefully from far-right over the top-right sky
    spine = [
        Vector((0.0, 0.0, -0.75)),
        Vector((-0.42, 0.12, 1.35)),
        Vector((-1.48, 0.35, 3.15)),
        Vector((-3.30, 0.72, 4.35)),
        Vector((-5.25, 1.08, 4.95)),
    ]
    add_branch_tube(bm, col, uv_layer, spine, 0.68, 0.12, segs=18, sides=12, uv_v_scale=3.2)

    # Flared gnarled roots gripping the hillside
    for i in range(6):
        a = i * 1.047 + 0.35
        pts = [
            Vector((0, 0, 0.85)),
            Vector((math.cos(a) * 0.82, math.sin(a) * 0.82, 0.18)),
            Vector((math.cos(a) * 1.65, math.sin(a) * 1.65, -0.35)),
            Vector((math.cos(a) * 2.15, math.sin(a) * 2.15, -0.75)),
        ]
        add_branch_tube(bm, col, uv_layer, pts, 0.28, 0.05, segs=7, sides=7, uv_v_scale=1.4)

    # Primary & secondary sweeping blossom boughs
    boughs = [
        ([catmull_rom(spine, 0.48), Vector((-2.6, -0.75, 3.85)), Vector((-4.5, -1.35, 4.35))], 0.26, 0.045),
        ([catmull_rom(spine, 0.56), Vector((-2.4, 1.65, 4.05)), Vector((-4.2, 2.65, 4.65))], 0.24, 0.045),
        ([catmull_rom(spine, 0.68), Vector((-4.4, 0.20, 4.85)), Vector((-6.0, -0.25, 5.20))], 0.20, 0.035),
        ([catmull_rom(spine, 0.78), Vector((-4.6, 1.85, 5.10)), Vector((-5.7, 2.45, 5.50))], 0.16, 0.03),
        ([catmull_rom(spine, 0.42), Vector((0.35, 1.25, 3.70)), Vector((1.40, 2.05, 4.55))], 0.22, 0.04),
        ([catmull_rom(spine, 0.62), Vector((-1.95, 0.50, 5.05)), Vector((-2.95, 0.75, 5.95))], 0.20, 0.035),
    ]
    for pts, r0, r1 in boughs:
        add_branch_tube(bm, col, uv_layer, pts, r0, r1, segs=9, sides=8, uv_v_scale=2.0)

    return finalize_mesh("SakuraTrunk", bm, [mats["bark"]], auto_uv=False)


def main():
    reset_scene()
    mats = create_materials()
    objs = [
        build_terrace(mats),
        build_step_stone(mats),
        *build_waypost(mats),
        *build_stone_lantern(mats),
        build_rune_stele(mats),
        build_rune_boulder(mats),
        build_leaning_sakura_trunk(mats),
    ]
    total_faces = sum(len(o.data.polygons) for o in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_attributes=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_image_quality=88,
    )
    size_kb = os.path.getsize(OUT_PATH) / 1024.0
    print(f"EXPORTED guofeng_spawn_shrine.glb | meshes={len(objs)} | faces={total_faces} | size={size_kb:.1f} KB")


if __name__ == "__main__":
    main()
