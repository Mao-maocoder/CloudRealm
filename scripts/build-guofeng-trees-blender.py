"""
Blender 5.2 offline asset generator for Yunjing (云境) Guofeng Eastern Trees.
Builds 3 low-poly stylized-realistic Eastern tree GLBs with:
  - Gnarled tapered trunks, flared roots, primary & secondary boughs
  - Asymmetrical, layered foliage card pads (breaking spherical cartoon silhouettes)
  - Baked vertex AO (COLOR_0) + smooth outward-upward volume normals for painterly shading
  - Clean UVs compatible with Yunjing's foliage alpha-cutout spray texture
  - Separate 'Trunk' and 'Canopy' meshes for GPU-instanced Three.js integration

Outputs:
  - resource/flora/guofeng_pine.glb  (迎客古松 · layered cloud-pad pine)
  - resource/flora/guofeng_elm.glb   (古村老榆 · spreading multi-bough village tree)
  - resource/flora/guofeng_oak.glb   (山谷苍木 · tall asymmetric valley tree)
  - output/guofeng_trees_preview.png (3-tree silhouette & proportion preview)
"""
import math
import os
import random
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT_DIR, "resource", "flora")
PREVIEW_PATH = os.path.join(ROOT_DIR, "output", "guofeng_trees_preview.png")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def catmull_rom(pts, t):
    n = len(pts) - 1
    if n <= 0:
        return pts[0].copy()
    scaled = max(0.0, min(1.0, t)) * n
    i = min(int(scaled), n - 1)
    u = scaled - i
    p0 = pts[max(0, i - 1)]
    p1 = pts[i]
    p2 = pts[min(n, i + 1)]
    p3 = pts[min(n, i + 2)]
    u2 = u * u
    u3 = u2 * u
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * u
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u3
    )


def catmull_tangent(pts, t):
    eps = 0.01
    a = catmull_rom(pts, max(0.0, t - eps))
    b = catmull_rom(pts, min(1.0, t + eps))
    d = b - a
    return d.normalized() if d.length > 1e-6 else Vector((0.0, 0.0, 1.0))


def add_branch_tube(bm, col_layer, uv_layer, pts, r_start, r_end, segs=8, sides=7, ridge_amp=0.11, ao_base=0.62, ao_tip=0.96):
    rings = []
    up_ref = Vector((0.0, 0.0, 1.0))
    for j in range(segs + 1):
        t = j / segs
        p = catmull_rom(pts, t)
        tang = catmull_tangent(pts, t)
        rot = up_ref.rotation_difference(tang)
        # Organic root flare near t=0 and graceful taper along limb
        flare = 1.0 + 0.32 * math.exp(-t * 9.0) if r_start > 0.32 else 1.0
        r = (r_start * (1.0 - t ** 0.78) + r_end * (t ** 0.78)) * flare
        ring = []
        for i in range(sides):
            a = (i / sides) * math.tau
            ridge = 1.0 + ridge_amp * math.cos(a * 3.0 + t * 4.5) * (1.0 - t * 0.7)
            local = Vector((math.cos(a) * r * ridge, math.sin(a) * r * ridge, 0.0))
            v = bm.verts.new(p + (rot @ local))
            ring.append((v, i / sides, t, a))
        rings.append(ring)

    for j in range(segs):
        r0 = rings[j]
        r1 = rings[j + 1]
        for i in range(sides):
            ni = (i + 1) % sides
            v00, u00, t00, a00 = r0[i]
            v01, u01, t01, a01 = r0[ni]
            v11, u11, t11, a11 = r1[ni]
            v10, u10, t10, a10 = r1[i]
            try:
                f = bm.faces.new((v00, v01, v11, v10))
                f.smooth = True
                uvs = [(u00, t00 * 2.5), (u01 if ni > i else 1.0, t01 * 2.5), (u11 if ni > i else 1.0, t11 * 2.5), (u10, t10 * 2.5)]
                ts = [t00, t01, t11, t10]
                angs = [a00, a01, a11, a10]
                for loop, uv, lt, la in zip(f.loops, uvs, ts, angs):
                    loop[uv_layer].uv = uv
                    shade = ao_base + (ao_tip - ao_base) * lt
                    shade *= 0.88 + 0.14 * (math.cos(la * 3.0 + lt * 4.5) ** 2)
                    loop[col_layer] = (shade, shade * 0.94, shade * 0.86, 1.0)
            except ValueError:
                pass


def add_foliage_pad(
    bm,
    col_layer,
    uv_layer,
    custom_normals,
    center,
    rx,
    rz,
    count,
    rng,
    crown_center,
    pad_ao=0.95,
    flatness=0.55,
):
    """Add a sculpted cluster of arched leaf-spray cards with baked interior AO & outward volume normals."""
    for i in range(count):
        a = i * 2.39996 + rng.uniform(-0.28, 0.28)
        level = (i + 0.5) / count
        rad = math.sqrt(max(0.02, 1.0 - (level * 0.82) ** 2))
        # Flat layered cloud-pad silhouette for Eastern pine/elm
        offset = Vector((
            math.cos(a) * rx * rad * rng.uniform(0.75, 1.15),
            math.sin(a) * rx * rad * rng.uniform(0.75, 1.15),
            (level - 0.38) * rz * flatness * rng.uniform(0.85, 1.15),
        ))
        card_pos = center + offset
        out_dir = (card_pos - crown_center)
        if out_dir.length < 1e-4:
            out_dir = Vector((math.cos(a), math.sin(a), 0.7))
        out_dir.z = max(out_dir.z * 0.85 + 0.35, -0.25)
        out_dir.normalize()

        # Card orientation: mix outward-angled vertical fans (for rich side silhouettes) with gently tilted crown pads
        side = Vector((-math.sin(a), math.cos(a), 0.0)).normalized()
        up_bias = 0.28 + 0.42 * level if (i % 2 == 0) else 0.12 + 0.24 * level
        tilt_n = (out_dir * (1.0 - up_bias) + Vector((0.0, 0.0, up_bias))).normalized()
        up_card = side.cross(tilt_n).normalized()
        if up_card.length < 1e-4:
            up_card = Vector((0.0, 0.0, 1.0))

        w = rx * rng.uniform(0.72, 0.98)
        h = rx * rng.uniform(0.66, 0.90) * (0.88 + 0.24 * (1.0 - flatness))

        # 4-vertex quad (2 tris instead of 4 tris -> 50% triangle reduction with identical silhouette & volume normals)
        corners = [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)]
        verts = []
        v_colors = []
        v_normals = []
        for cx, cy, cz in corners:
            vp = card_pos + side * (cx * w) + up_card * (cy * h) + tilt_n * (cz * w)
            verts.append(bm.verts.new(vp))
            # Baked internal AO: underside/inner cards soft cool green (never crushed black), top/outer sunlit tips brighter
            ao = pad_ao * (0.72 + 0.34 * level) * (0.92 + 0.12 * (cy * 0.5 + 0.5))
            ao = max(0.66, min(1.08, ao))
            v_colors.append((ao * (0.96 + 0.05 * cy), ao * (1.00 + 0.03 * cy), ao * (1.02 - 0.06 * cy), 1.0))
            n = (vp - crown_center)
            n.z = n.z * 0.9 + 0.45
            v_normals.append(n.normalized())

        uvs = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        for tri_idx in ((0, 1, 2), (0, 2, 3)):
            try:
                f = bm.faces.new((verts[tri_idx[0]], verts[tri_idx[1]], verts[tri_idx[2]]))
                f.smooth = True
                for loop, ti in zip(f.loops, tri_idx):
                    loop[uv_layer].uv = uvs[ti]
                    loop[col_layer] = v_colors[ti]
                    custom_normals.append(v_normals[ti])
            except ValueError:
                pass


def build_mesh_obj(name, bm, custom_normals=None):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    if custom_normals and len(custom_normals) == len(mesh.loops):
        mesh.normals_split_custom_set(custom_normals)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def build_guofeng_pine():
    """迎客古松: sweeping S-curved gnarled trunk + asymmetric horizontal cloud-pad pine boughs."""
    rng = random.Random(101)
    bm_bark = bmesh.new()
    bark_col = bm_bark.loops.layers.color.new("Color")
    bark_uv = bm_bark.loops.layers.uv.new("UVMap")

    bm_leaf = bmesh.new()
    leaf_col = bm_leaf.loops.layers.color.new("Color")
    leaf_uv = bm_leaf.loops.layers.uv.new("UVMap")
    leaf_normals = []

    bm_far = bmesh.new()
    far_col = bm_far.loops.layers.color.new("Color")
    far_uv = bm_far.loops.layers.uv.new("UVMap")
    far_normals = []

    # Sweeping S-curve trunk (Blender Z-up; exported to glTF Y-up automatically!)
    spine = [
        Vector((0.0, 0.0, -0.35)),
        Vector((-0.35, 0.18, 2.2)),
        Vector((0.75, -0.25, 5.1)),
        Vector((1.45, 0.15, 7.6)),
        Vector((1.05, 0.35, 9.4)),
    ]
    add_branch_tube(bm_bark, bark_col, bark_uv, spine, 0.52, 0.08, segs=12, sides=8, ridge_amp=0.14)

    # Flared gnarled roots
    for i in range(5):
        a = i * 1.257 + 0.35
        r_len = 1.45 + rng.uniform(-0.2, 0.35)
        pts = [
            Vector((0.0, 0.0, 0.72)),
            Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.16)),
            Vector((math.cos(a) * r_len, math.sin(a) * r_len, -0.28)),
        ]
        add_branch_tube(bm_bark, bark_col, bark_uv, pts, 0.21, 0.03, segs=4, sides=5)

    # Asymmetric horizontal spreading pine limbs
    boughs = [
        (0.42, 0.15, 4.4, 0.28, 1.95, 0.72, 10),   # iconic long greeting limb
        (0.50, 2.45, 3.3, 0.23, 1.60, 0.68, 8),
        (0.58, -1.65, 3.6, 0.22, 1.68, 0.66, 9),
        (0.68, 0.95, 3.1, 0.19, 1.52, 0.65, 8),
        (0.76, -2.55, 2.9, 0.17, 1.42, 0.62, 8),
        (0.84, 2.05, 2.4, 0.14, 1.32, 0.58, 7),
        (0.92, -0.55, 2.2, 0.12, 1.25, 0.55, 7),
    ]
    crown_center = Vector((0.8, 0.05, 6.2))
    for t_root, yaw, reach, r0, pad_rx, pad_rz, cards in boughs:
        start = catmull_rom(spine, t_root)
        dir_xy = Vector((math.cos(yaw), math.sin(yaw), 0.0))
        mid = start + dir_xy * (reach * 0.54) + Vector((0.0, 0.0, -0.35))
        tip = start + dir_xy * reach + Vector((0.0, 0.0, 0.25 + rng.uniform(-0.15, 0.25)))
        add_branch_tube(bm_bark, bark_col, bark_uv, [start, mid, tip], r0, 0.025, segs=6, sides=6)
        add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, tip + Vector((0, 0, 0.28)), pad_rx * 1.12, pad_rz * 1.38, cards + 2, rng, crown_center, pad_ao=0.94 + t_root * 0.10, flatness=0.68)
        add_foliage_pad(bm_far, far_col, far_uv, far_normals, tip + Vector((0, 0, 0.28)), pad_rx * 1.24, pad_rz * 1.45, max(4, cards // 2), rng, crown_center, pad_ao=0.95 + t_root * 0.10, flatness=0.72)

        # Fork sub-branch for asymmetry
        side_yaw = yaw + rng.choice([-0.75, 0.75])
        sub_tip = mid + Vector((math.cos(side_yaw), math.sin(side_yaw), 0.0)) * (reach * 0.52) + Vector((0.0, 0.0, 0.45))
        add_branch_tube(bm_bark, bark_col, bark_uv, [mid, (mid + sub_tip) * 0.5 + Vector((0, 0, 0.12)), sub_tip], r0 * 0.52, 0.018, segs=4, sides=5)
        add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, sub_tip + Vector((0, 0, 0.24)), pad_rx * 0.86, pad_rz * 1.10, max(6, cards - 1), rng, crown_center, pad_ao=0.90 + t_root * 0.10, flatness=0.70)

    # Crown apex pad
    apex = spine[-1] + Vector((0.1, 0.0, 0.25))
    add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, apex, 1.85, 1.12, 11, rng, crown_center, pad_ao=1.04, flatness=0.68)
    add_foliage_pad(bm_far, far_col, far_uv, far_normals, apex, 2.00, 1.20, 5, rng, crown_center, pad_ao=1.04, flatness=0.72)

    trunk_obj = build_mesh_obj("Trunk", bm_bark)
    canopy_obj = build_mesh_obj("Canopy", bm_leaf, leaf_normals)
    canopy_far_obj = build_mesh_obj("CanopyFar", bm_far, far_normals)
    return [trunk_obj, canopy_obj, canopy_far_obj]


def build_guofeng_elm():
    """古村老榆: sturdy gnarled village tree splitting into 3 main boughs with open interior sky gaps."""
    rng = random.Random(202)
    bm_bark = bmesh.new()
    bark_col = bm_bark.loops.layers.color.new("Color")
    bark_uv = bm_bark.loops.layers.uv.new("UVMap")

    bm_leaf = bmesh.new()
    leaf_col = bm_leaf.loops.layers.color.new("Color")
    leaf_uv = bm_leaf.loops.layers.uv.new("UVMap")
    leaf_normals = []

    bm_far = bmesh.new()
    far_col = bm_far.loops.layers.color.new("Color")
    far_uv = bm_far.loops.layers.uv.new("UVMap")
    far_normals = []

    base_spine = [
        Vector((0.0, 0.0, -0.35)),
        Vector((-0.18, 0.12, 1.4)),
        Vector((0.28, -0.14, 3.1)),
    ]
    add_branch_tube(bm_bark, bark_col, bark_uv, base_spine, 0.66, 0.34, segs=8, sides=9, ridge_amp=0.16)

    for i in range(6):
        a = i * 1.047 + 0.2
        r_len = 1.65 + rng.uniform(-0.25, 0.35)
        pts = [
            Vector((0.0, 0.0, 0.85)),
            Vector((math.cos(a) * 0.75, math.sin(a) * 0.75, 0.18)),
            Vector((math.cos(a) * r_len, math.sin(a) * r_len, -0.30)),
        ]
        add_branch_tube(bm_bark, bark_col, bark_uv, pts, 0.24, 0.032, segs=4, sides=5)

    fork_origin = base_spine[-1] - Vector((0.0, 0.0, 0.28))
    crown_center = Vector((0.3, 0.0, 5.8))
    main_boughs = [
        (0.25, 4.3, 5.1, 0.28),
        (2.35, 3.9, 4.6, 0.25),
        (-1.85, 3.7, 5.4, 0.24),
        (1.25, 2.9, 5.8, 0.20),
    ]
    for idx, (yaw, reach, rise, r0) in enumerate(main_boughs):
        dir_xy = Vector((math.cos(yaw), math.sin(yaw), 0.0))
        p1 = fork_origin + dir_xy * (reach * 0.45) + Vector((0.0, 0.0, rise * 0.48))
        p2 = fork_origin + dir_xy * reach + Vector((0.0, 0.0, rise))
        add_branch_tube(bm_bark, bark_col, bark_uv, [fork_origin, p1, p2], r0, 0.035, segs=7, sides=6)
        add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, p2 + Vector((0, 0, 0.45)), 2.25, 1.75, 13, rng, crown_center, pad_ao=0.98, flatness=0.88)
        add_foliage_pad(bm_far, far_col, far_uv, far_normals, p2 + Vector((0, 0, 0.45)), 2.50, 1.88, 6, rng, crown_center, pad_ao=0.98, flatness=0.90)

        for s in (-1, 1):
            sub_yaw = yaw + s * rng.uniform(0.62, 0.92)
            sub_start = p1.lerp(p2, 0.45)
            sub_tip = sub_start + Vector((math.cos(sub_yaw), math.sin(sub_yaw), 0.0)) * rng.uniform(1.65, 2.35) + Vector((0.0, 0.0, rng.uniform(0.45, 1.15)))
            add_branch_tube(bm_bark, bark_col, bark_uv, [sub_start, sub_start.lerp(sub_tip, 0.5) + Vector((0, 0, 0.25)), sub_tip], r0 * 0.52, 0.02, segs=4, sides=5)
            add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, sub_tip + Vector((0, 0, 0.30)), 1.72, 1.38, 9, rng, crown_center, pad_ao=0.92 + (0.06 if s > 0 else 0.0), flatness=0.84)

    # Central upper crown dome to give fuller silhouette volume without becoming a cartoon sphere
    add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, crown_center + Vector((0.0, 0.0, 2.6)), 2.15, 1.55, 10, rng, crown_center, pad_ao=1.04, flatness=0.82)
    add_foliage_pad(bm_far, far_col, far_uv, far_normals, crown_center + Vector((0.0, 0.0, 2.6)), 2.35, 1.65, 5, rng, crown_center, pad_ao=1.04, flatness=0.86)

    trunk_obj = build_mesh_obj("Trunk", bm_bark)
    canopy_obj = build_mesh_obj("Canopy", bm_leaf, leaf_normals)
    canopy_far_obj = build_mesh_obj("CanopyFar", bm_far, far_normals)
    return [trunk_obj, canopy_obj, canopy_far_obj]


def build_guofeng_oak():
    """山谷苍木: tall graceful asymmetric valley hardwood with tiered airy foliage clusters."""
    rng = random.Random(303)
    bm_bark = bmesh.new()
    bark_col = bm_bark.loops.layers.color.new("Color")
    bark_uv = bm_bark.loops.layers.uv.new("UVMap")

    bm_leaf = bmesh.new()
    leaf_col = bm_leaf.loops.layers.color.new("Color")
    leaf_uv = bm_leaf.loops.layers.uv.new("UVMap")
    leaf_normals = []

    bm_far = bmesh.new()
    far_col = bm_far.loops.layers.color.new("Color")
    far_uv = bm_far.loops.layers.uv.new("UVMap")
    far_normals = []

    spine = [
        Vector((0.0, 0.0, -0.35)),
        Vector((0.18, -0.15, 3.0)),
        Vector((-0.32, 0.22, 6.4)),
        Vector((0.45, 0.08, 9.6)),
        Vector((0.72, -0.10, 11.4)),
    ]
    add_branch_tube(bm_bark, bark_col, bark_uv, spine, 0.48, 0.06, segs=12, sides=8, ridge_amp=0.12)

    for i in range(5):
        a = i * 1.257 + 0.6
        r_len = 1.35 + rng.uniform(-0.15, 0.25)
        pts = [
            Vector((0.0, 0.0, 0.65)),
            Vector((math.cos(a) * 0.55, math.sin(a) * 0.55, 0.14)),
            Vector((math.cos(a) * r_len, math.sin(a) * r_len, -0.25)),
        ]
        add_branch_tube(bm_bark, bark_col, bark_uv, pts, 0.19, 0.025, segs=4, sides=5)

    crown_center = Vector((0.25, 0.05, 8.2))
    limbs = [
        (0.46, 0.6, 3.4, 1.5, 0.22, 1.65),
        (0.54, 2.8, 3.1, 1.4, 0.20, 1.55),
        (0.62, -1.5, 3.3, 1.6, 0.19, 1.60),
        (0.70, 1.7, 2.8, 1.5, 0.16, 1.45),
        (0.78, -0.4, 2.6, 1.4, 0.14, 1.38),
        (0.86, -2.5, 2.2, 1.2, 0.12, 1.28),
    ]
    for t_root, yaw, reach, rise, r0, pad_rx in limbs:
        start = catmull_rom(spine, t_root)
        dir_xy = Vector((math.cos(yaw), math.sin(yaw), 0.0))
        mid = start + dir_xy * (reach * 0.52) + Vector((0.0, 0.0, rise * 0.35))
        tip = start + dir_xy * reach + Vector((0.0, 0.0, rise))
        add_branch_tube(bm_bark, bark_col, bark_uv, [start, mid, tip], r0, 0.022, segs=5, sides=6)
        add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, tip + Vector((0, 0, 0.32)), pad_rx * 1.14, pad_rx * 0.88, 10, rng, crown_center, pad_ao=0.92 + t_root * 0.12, flatness=0.78)
        add_foliage_pad(bm_far, far_col, far_uv, far_normals, tip + Vector((0, 0, 0.32)), pad_rx * 1.28, pad_rx * 0.95, 5, rng, crown_center, pad_ao=0.94 + t_root * 0.12, flatness=0.82)

        sub_yaw = yaw + rng.choice([-0.82, 0.82])
        sub_tip = mid + Vector((math.cos(sub_yaw), math.sin(sub_yaw), 0.0)) * (reach * 0.55) + Vector((0.0, 0.0, rise * 0.65))
        add_branch_tube(bm_bark, bark_col, bark_uv, [mid, sub_tip], r0 * 0.48, 0.016, segs=3, sides=4)
        add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, sub_tip + Vector((0, 0, 0.26)), pad_rx * 0.84, pad_rx * 0.68, 7, rng, crown_center, pad_ao=0.88 + t_root * 0.12, flatness=0.78)

    add_foliage_pad(bm_leaf, leaf_col, leaf_uv, leaf_normals, spine[-1] + Vector((0, 0, 0.4)), 1.85, 1.32, 10, rng, crown_center, pad_ao=1.05, flatness=0.78)
    add_foliage_pad(bm_far, far_col, far_uv, far_normals, spine[-1] + Vector((0, 0, 0.4)), 2.05, 1.42, 5, rng, crown_center, pad_ao=1.05, flatness=0.82)

    trunk_obj = build_mesh_obj("Trunk", bm_bark)
    canopy_obj = build_mesh_obj("Canopy", bm_leaf, leaf_normals)
    canopy_far_obj = build_mesh_obj("CanopyFar", bm_far, far_normals)
    return [trunk_obj, canopy_obj, canopy_far_obj]


def export_tree(name, builder):
    reset_scene()
    objs = builder()
    tris = sum(len(o.data.polygons) for o in objs)
    out_path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_attributes=True,
        export_materials="NONE",
    )
    size_kb = os.path.getsize(out_path) / 1024.0
    print(f"EXPORTED {name}.glb | faces={tris} | size={size_kb:.1f} KB")
    return out_path


def render_preview():
    reset_scene()
    # Arrange all 3 trees side-by-side for visual silhouette inspection
    mat_bark = bpy.data.materials.new("PreviewBark")
    mat_bark.use_nodes = True
    bsdf_b = mat_bark.node_tree.nodes["Principled BSDF"]
    bsdf_b.inputs["Base Color"].default_value = (0.14, 0.10, 0.08, 1.0)
    bsdf_b.inputs["Roughness"].default_value = 0.9

    mat_leaf = bpy.data.materials.new("PreviewLeaf")
    mat_leaf.use_nodes = True
    bsdf_l = mat_leaf.node_tree.nodes["Principled BSDF"]
    bsdf_l.inputs["Base Color"].default_value = (0.16, 0.25, 0.13, 1.0)
    bsdf_l.inputs["Roughness"].default_value = 0.78

    for idx, (builder, x_off) in enumerate([(build_guofeng_pine, -9.5), (build_guofeng_elm, 0.0), (build_guofeng_oak, 9.5)]):
        objs = builder()
        for o in objs:
            o.location.x += x_off
            o.data.materials.append(mat_bark if "Trunk" in o.name else mat_leaf)

    # Simple ground plane + sun + camera
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    gnd = bpy.context.active_object
    mat_g = bpy.data.materials.new("PreviewGround")
    mat_g.use_nodes = True
    mat_g.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.20, 0.24, 0.16, 1.0)
    gnd.data.materials.append(mat_g)

    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 3.2
    sun_obj = bpy.data.objects.new("Sun", sun_data)
    sun_obj.rotation_euler = (math.radians(48), math.radians(15), math.radians(38))
    bpy.context.collection.objects.link(sun_obj)

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.56, 0.72, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 38
    cam_obj = bpy.data.objects.new("Cam", cam_data)
    cam_obj.location = (0.0, -27.5, 6.2)
    direction = Vector((0.0, 0.0, 5.2)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 640
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED preview -> {PREVIEW_PATH}")


if __name__ == "__main__":
    export_tree("guofeng_pine", build_guofeng_pine)
    export_tree("guofeng_elm", build_guofeng_elm)
    export_tree("guofeng_oak", build_guofeng_oak)
    render_preview()
