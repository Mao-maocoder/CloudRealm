"""
Blender 5.2 offline asset generator for Yunjing (云境) Guofeng Architecture (v2 — Reference-Matched).
Faithfully models the user's two turnaround reference sheets:
  1. Arched Timber Footbridge post & bracket kit (`guofeng_bridge_post.glb`):
     - Mossy carved stone footing pier
     - Verdigris-iron base collar with brass rivets
     - Square weathered dark timber post
     - Stepped bronze-trimmed pyramid cap
  2. Eastern Ancient Village Cottage (`guofeng_house_cottage.glb`) + cohesive Hall & Tower variants:
     - Stone block lower dado + weathered cream-ochre plaster + exposed dark timber frame & gable truss
     - Straight-sloped corrugated grey-blue tile roof (with sculpted tile ribs, ridge beam & upturned ends)
     - Protruding front entrance portico with 3-panel indigo cloth curtain, twin glowing lanterns & 3 stone steps
     - Left lean-to firewood shed with lower tile roof & stacked round logs
     - Vertical-slat wooden windows with rain awnings, corner ceramic vat, timber fence & laundry rack

Outputs:
  - resource/architecture/guofeng_house_cottage.glb
  - resource/architecture/guofeng_house_hall.glb
  - resource/architecture/guofeng_house_tower.glb
  - resource/architecture/guofeng_bridge_post.glb
  - output/guofeng_arch_preview.png
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_DIR = os.path.join(ROOT_DIR, "resource", "architecture")
PREVIEW_PATH = os.path.join(ROOT_DIR, "output", "guofeng_arch_preview.png")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c):
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


# Reference-calibrated sRGB -> linear palette
COL_STONE = srgb_to_linear((0.55, 0.57, 0.56))
COL_STONE_DARK = srgb_to_linear((0.40, 0.43, 0.43))
COL_MOSS = srgb_to_linear((0.36, 0.46, 0.25))
COL_PLASTER = srgb_to_linear((0.77, 0.71, 0.59))
COL_PLASTER_DAMP = srgb_to_linear((0.62, 0.57, 0.47))
COL_WOOD = srgb_to_linear((0.32, 0.24, 0.18))
COL_WOOD_LIGHT = srgb_to_linear((0.46, 0.35, 0.24))
COL_WOOD_BAMBOO = srgb_to_linear((0.56, 0.46, 0.31))
COL_TILE = srgb_to_linear((0.30, 0.34, 0.38))
COL_TILE_DARK = srgb_to_linear((0.21, 0.24, 0.28))
COL_TILE_RIDGE = srgb_to_linear((0.40, 0.44, 0.47))
COL_CURTAIN = srgb_to_linear((0.31, 0.41, 0.50))
COL_CLOTH_WARM = srgb_to_linear((0.73, 0.65, 0.50))
COL_VAT = srgb_to_linear((0.37, 0.29, 0.23))
COL_LOG_END = srgb_to_linear((0.72, 0.58, 0.38))
COL_IRON = srgb_to_linear((0.35, 0.43, 0.41))
COL_BRONZE = srgb_to_linear((0.74, 0.59, 0.32))
COL_CAP_DARK = srgb_to_linear((0.27, 0.29, 0.31))
COL_LANTERN = srgb_to_linear((0.99, 0.84, 0.50))
COL_VINE = srgb_to_linear((0.32, 0.48, 0.24))


def add_box(bm, col_layer, cx, cy, cz, sx, sy, sz, color, bottom_ao=0.82, top_ao=1.02, rot_x=0.0, rot_y=0.0):
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    raw = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    cx_r, sx_r = math.cos(rot_x), math.sin(rot_x)
    cy_r, sy_r = math.cos(rot_y), math.sin(rot_y)
    verts = []
    for x, y, z in raw:
        # Rotate X then Y
        y1 = y * cx_r - z * sx_r
        z1 = y * sx_r + z * cx_r
        x2 = x * cy_r + z1 * sy_r
        z2 = -x * sy_r + z1 * cy_r
        verts.append(bm.verts.new((cx + x2, cy + y1, cz + z2)))
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (2, 3, 7, 6),
        (1, 2, 6, 5), (3, 0, 4, 7),
    ]
    for fidx in faces:
        try:
            f = bm.faces.new([verts[i] for i in fidx])
            for loop, vi in zip(f.loops, fidx):
                ao = top_ao if vi >= 4 else bottom_ao
                loop[col_layer] = (color[0] * ao, color[1] * ao, color[2] * ao, 1.0)
        except ValueError:
            pass


def add_cylinder(bm, col_layer, cx, cy, cz, r_bot, r_top, length, sides, color, axis="z", ao_a=0.84, ao_b=1.02):
    hl = length * 0.5
    r0, r1 = [], []
    for i in range(sides):
        a = i * math.tau / sides
        ca, sa = math.cos(a), math.sin(a)
        if axis == "z":
            p0 = (cx + ca * r_bot, cy + sa * r_bot, cz - hl)
            p1 = (cx + ca * r_top, cy + sa * r_top, cz + hl)
        elif axis == "y":
            p0 = (cx + ca * r_bot, cy - hl, cz + sa * r_bot)
            p1 = (cx + ca * r_top, cy + hl, cz + sa * r_top)
        else:
            p0 = (cx - hl, cy + ca * r_bot, cz + sa * r_bot)
            p1 = (cx + hl, cy + ca * r_top, cz + sa * r_top)
        r0.append(bm.verts.new(p0))
        r1.append(bm.verts.new(p1))
    for i in range(sides):
        ni = (i + 1) % sides
        try:
            f = bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))
            f.smooth = True
            for loop, ao in zip(f.loops, (ao_a, ao_a, ao_b, ao_b)):
                loop[col_layer] = (color[0] * ao, color[1] * ao, color[2] * ao, 1.0)
        except ValueError:
            pass
    # Caps
    for ring, rev, cap_col in [(r0, True, color), (r1, False, COL_LOG_END if axis == "y" else color)]:
        try:
            f = bm.faces.new(list(reversed(ring)) if rev else ring)
            for loop in f.loops:
                loop[col_layer] = (cap_col[0] * 0.96, cap_col[1] * 0.96, cap_col[2] * 0.96, 1.0)
        except ValueError:
            pass


def add_gable_tile_roof(bm, col_layer, cx, cy, z_eave, width, depth, height, overhang_x=0.55, overhang_y=0.62, ribs=11, along_x=True):
    """Authentic Eastern straight-pitched corrugated tile roof (悬山青瓦顶) with sculpted tile ribs & thick ridge."""
    w_tot = width + overhang_x * 2.0
    d_tot = depth + overhang_y * 2.0
    half_span = (d_tot * 0.5) if along_x else (w_tot * 0.5)
    ridge_len = w_tot if along_x else d_tot
    slope_len = math.hypot(half_span, height)
    pitch = math.atan2(height, half_span)

    # Twin sloped roof deck slabs (front & back)
    for side in (-1, 1):
        mid_off = side * half_span * 0.5
        mid_z = z_eave + height * 0.5
        if along_x:
            add_box(bm, col_layer, cx, cy + mid_off, mid_z, ridge_len, slope_len, 0.14, COL_TILE, 0.80, 1.02, rot_x=-side * pitch)
            # Exposed dark wood underside rafters
            add_box(bm, col_layer, cx, cy + mid_off, mid_z - 0.11, ridge_len - 0.12, slope_len - 0.08, 0.08, COL_WOOD, 0.65, 0.80, rot_x=-side * pitch)
        else:
            add_box(bm, col_layer, cx + mid_off, cy, mid_z, slope_len, ridge_len, 0.14, COL_TILE, 0.80, 1.02, rot_y=side * pitch)
            add_box(bm, col_layer, cx + mid_off, cy, mid_z - 0.11, slope_len - 0.08, ridge_len - 0.12, 0.08, COL_WOOD, 0.65, 0.80, rot_y=side * pitch)

        # Corrugated cylindrical tile ribs (筒瓦列) running down the roof slope
        for r in range(ribs):
            t = -0.47 + 0.94 * (r / max(1, ribs - 1))
            rib_col = COL_TILE_RIDGE if r % 2 == 0 else COL_TILE_DARK
            if along_x:
                add_box(bm, col_layer, cx + t * ridge_len, cy + mid_off, mid_z + 0.085, 0.12, slope_len + 0.04, 0.09, rib_col, 0.86, 1.06, rot_x=-side * pitch)
            else:
                add_box(bm, col_layer, cx + mid_off, cy + t * ridge_len, mid_z + 0.085, slope_len + 0.04, 0.12, 0.09, rib_col, 0.86, 1.06, rot_y=side * pitch)

    # Thick main ridge beam (正脊) + upturned gable ridge finials (翘角脊兽)
    if along_x:
        add_box(bm, col_layer, cx, cy, z_eave + height + 0.14, ridge_len + 0.16, 0.28, 0.26, COL_TILE_RIDGE, 0.88, 1.08)
        for s in (-1, 1):
            add_box(bm, col_layer, cx + s * (ridge_len * 0.5 + 0.05), cy, z_eave + height + 0.30, 0.24, 0.30, 0.32, COL_TILE_RIDGE, 0.90, 1.12)
            # Gable bargeboard (搏风板)
            for side in (-1, 1):
                add_box(bm, col_layer, cx + s * (ridge_len * 0.5 - 0.06), cy + side * half_span * 0.5, z_eave + height * 0.5 - 0.04, 0.14, slope_len + 0.08, 0.22, COL_WOOD, 0.72, 0.96, rot_x=-side * pitch)
    else:
        add_box(bm, col_layer, cx, cy, z_eave + height + 0.14, 0.28, ridge_len + 0.16, 0.26, COL_TILE_RIDGE, 0.88, 1.08)
        for s in (-1, 1):
            add_box(bm, col_layer, cx, cy + s * (ridge_len * 0.5 + 0.05), z_eave + height + 0.30, 0.30, 0.24, 0.32, COL_TILE_RIDGE, 0.90, 1.12)


def add_gable_triangle_wall(bm, col_layer, x_plane, cy, z_base, depth, height):
    """Fill triangular plaster gable wall under pitched roof + vertical timber king-post."""
    hd = depth * 0.5
    v0 = bm.verts.new((x_plane, cy - hd, z_base))
    v1 = bm.verts.new((x_plane, cy + hd, z_base))
    v2 = bm.verts.new((x_plane, cy, z_base + height))
    try:
        f = bm.faces.new((v0, v1, v2))
        for loop in f.loops:
            loop[col_layer] = (COL_PLASTER[0] * 0.92, COL_PLASTER[1] * 0.92, COL_PLASTER[2] * 0.92, 1.0)
    except ValueError:
        pass
    # Exposed timber king-post & collar beam
    add_box(bm, col_layer, x_plane, cy, z_base + height * 0.48, 0.16, 0.16, height * 0.92, COL_WOOD, 0.80, 1.0)
    add_box(bm, col_layer, x_plane, cy, z_base + 0.08, 0.18, depth, 0.18, COL_WOOD, 0.80, 1.0)


def add_eastern_window(bm, col_layer, x, y, z, w, h, along_x=True, awning=True):
    """Vertical-slat timber window with optional sloped rain awning (木格窗 + 雨披)."""
    if along_x:
        add_box(bm, col_layer, x, y, z, w + 0.16, 0.14, h + 0.16, COL_WOOD, 0.78, 1.0)
        add_box(bm, col_layer, x, y, z, w, 0.08, h, COL_PLASTER_DAMP, 0.65, 0.80)
        for i in range(-2, 3):
            add_box(bm, col_layer, x + i * (w * 0.19), y - 0.04, z, 0.055, 0.08, h, COL_WOOD_LIGHT, 0.82, 1.0)
        add_box(bm, col_layer, x, y - 0.05, z, w, 0.08, 0.06, COL_WOOD, 0.85, 1.0)
        if awning:
            add_box(bm, col_layer, x, y - 0.28, z + h * 0.5 + 0.10, w + 0.26, 0.56, 0.07, COL_WOOD_BAMBOO, 0.80, 1.02, rot_x=0.38)
    else:
        add_box(bm, col_layer, x, y, z, 0.14, w + 0.16, h + 0.16, COL_WOOD, 0.78, 1.0)
        add_box(bm, col_layer, x, y, z, 0.08, w, h, COL_PLASTER_DAMP, 0.65, 0.80)
        for i in range(-2, 3):
            add_box(bm, col_layer, x, y + i * (w * 0.19), z, 0.08, 0.055, h, COL_WOOD_LIGHT, 0.82, 1.0)


def add_hanging_lantern(bm_s, col_s, bm_g, col_g, x, y, z):
    add_box(bm_s, col_s, x, y, z + 0.24, 0.16, 0.16, 0.07, COL_WOOD, 0.8, 1.0)
    add_box(bm_s, col_s, x, y, z - 0.24, 0.16, 0.16, 0.07, COL_WOOD, 0.8, 1.0)
    add_cylinder(bm_g, col_g, x, y, z, 0.13, 0.13, 0.42, 7, COL_LANTERN, "z", 0.96, 1.06)


def normalize_and_export(name, bm_shell, bm_glow=None):
    bms = [bm_shell] + ([bm_glow] if bm_glow and len(bm_glow.verts) > 0 else [])
    min_v = Vector((1e9, 1e9, 1e9))
    max_v = Vector((-1e9, -1e9, -1e9))
    for bm in bms:
        for v in bm.verts:
            for k in range(3):
                min_v[k] = min(min_v[k], v.co[k])
                max_v[k] = max(max_v[k], v.co[k])
    size = max_v - min_v
    cx = (min_v.x + max_v.x) * 0.5
    cy = (min_v.y + max_v.y) * 0.5
    cz = min_v.z
    sx = 1.0 / max(size.x, 1e-4)
    sy = 1.0 / max(size.y, 1e-4)
    sz = 1.0 / max(size.z, 1e-4)
    for bm in bms:
        for v in bm.verts:
            v.co.x = (v.co.x - cx) * sx
            v.co.y = (v.co.y - cy) * sy
            v.co.z = (v.co.z - cz) * sz

    objs = []
    for obj_name, bm in [("Shell", bm_shell), ("Glow", bm_glow)]:
        if bm is None or len(bm.verts) == 0:
            if bm:
                bm.free()
            continue
        mesh = bpy.data.meshes.new(obj_name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(obj_name, mesh)
        bpy.context.collection.objects.link(obj)
        objs.append(obj)

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
        export_normals=True,
        export_attributes=True,
        export_materials="NONE",
    )
    size_kb = os.path.getsize(out_path) / 1024.0
    print(f"EXPORTED {name}.glb | faces={tris} | size={size_kb:.1f} KB")
    return objs


def build_cottage(export=True):
    """Reference-matched Eastern Village Cottage (东方古村青瓦木构民居)."""
    bm_s = bmesh.new()
    col_s = bm_s.loops.layers.color.new("Color")
    bm_g = bmesh.new()
    col_g = bm_g.loops.layers.color.new("Color")

    # 1. Main house core: stone block lower dado + weathered plaster upper walls
    add_box(bm_s, col_s, 0.35, 0.0, 0.50, 6.2, 4.3, 1.00, COL_STONE, 0.72, 0.98)
    add_box(bm_s, col_s, 0.35, 0.0, 2.02, 6.0, 4.1, 2.10, COL_PLASTER, 0.80, 1.02)
    # Stone mortar accents along base
    add_box(bm_s, col_s, 0.35, 0.0, 1.01, 6.26, 4.36, 0.09, COL_STONE_DARK, 0.82, 0.98)

    # Exposed timber columns & horizontal lintels
    for x in (-2.65, -0.35, 1.65, 3.35):
        for y in (-2.06, 2.06):
            add_box(bm_s, col_s, x, y, 2.02, 0.22, 0.22, 2.15, COL_WOOD, 0.72, 1.0)
    add_box(bm_s, col_s, 0.35, -2.06, 3.04, 6.25, 0.24, 0.22, COL_WOOD, 0.82, 1.0)
    add_box(bm_s, col_s, 0.35, 2.06, 3.04, 6.25, 0.24, 0.22, COL_WOOD, 0.82, 1.0)

    # Gable triangular plaster walls & main corrugated tile roof
    add_gable_triangle_wall(bm_s, col_s, -2.65, 0.0, 3.05, 4.1, 1.95)
    add_gable_triangle_wall(bm_s, col_s, 3.35, 0.0, 3.05, 4.1, 1.95)
    add_gable_tile_roof(bm_s, col_s, 0.35, 0.0, 3.02, 6.0, 4.2, 2.05, overhang_x=0.58, overhang_y=0.68, ribs=13, along_x=True)

    # 2. Protruding Front Entrance Portico (门廊 + 青布门帘 + 双纸灯笼 + 石阶)
    px = 1.05
    add_box(bm_s, col_s, px, -2.75, 0.26, 2.55, 1.45, 0.52, COL_STONE, 0.74, 0.98)
    add_box(bm_s, col_s, px, -3.56, 0.17, 2.15, 0.42, 0.34, COL_STONE_DARK, 0.74, 0.96)
    add_box(bm_s, col_s, px, -3.90, 0.08, 2.25, 0.34, 0.16, COL_STONE, 0.74, 0.96)
    # Portico posts, double wooden door & indigo 3-panel door curtain (门帘)
    for sx in (-1.08, 1.08):
        add_box(bm_s, col_s, px + sx, -3.32, 1.66, 0.20, 0.20, 2.35, COL_WOOD, 0.74, 1.0)
        add_hanging_lantern(bm_s, col_s, bm_g, col_g, px + sx * 1.18, -3.32, 2.22)
    add_box(bm_s, col_s, px, -3.32, 2.74, 2.40, 0.22, 0.20, COL_WOOD, 0.84, 1.0)
    add_box(bm_s, col_s, px, -2.08, 1.56, 1.42, 0.14, 2.06, COL_WOOD_LIGHT, 0.78, 1.0)
    for p_idx in (-1, 0, 1):
        add_box(bm_s, col_s, px + p_idx * 0.42, -3.28, 2.32, 0.36, 0.05, 0.66, COL_CURTAIN, 0.84, 1.02)
    add_gable_tile_roof(bm_s, col_s, px, -2.78, 2.78, 2.15, 1.65, 0.92, overhang_x=0.38, overhang_y=0.34, ribs=6, along_x=False)

    # 3. Windows with rain awnings (front & back)
    add_eastern_window(bm_s, col_s, -1.35, -2.06, 1.98, 1.38, 1.02, True, True)
    add_eastern_window(bm_s, col_s, 2.55, -2.06, 1.98, 0.92, 0.92, True, False)
    add_eastern_window(bm_s, col_s, -1.10, 2.06, 2.05, 0.92, 0.78, True, False)
    add_eastern_window(bm_s, col_s, 1.55, 2.06, 2.05, 0.92, 0.78, True, False)

    # 4. Left-side lean-to firewood shed (侧廊柴棚 + 堆叠圆木)
    sx0 = -3.85
    add_box(bm_s, col_s, sx0, -0.10, 0.16, 2.25, 3.65, 0.32, COL_STONE_DARK, 0.72, 0.94)
    for sy in (-1.72, 1.52):
        add_box(bm_s, col_s, -4.82, sy, 1.28, 0.18, 0.18, 2.10, COL_WOOD, 0.74, 1.0)
    add_box(bm_s, col_s, -4.82, -0.10, 2.28, 0.18, 3.55, 0.18, COL_WOOD, 0.82, 1.0)
    # Sloped lean-to tile roof
    add_box(bm_s, col_s, -3.78, -0.10, 2.66, 2.75, 4.15, 0.14, COL_TILE, 0.80, 1.02, rot_y=-0.30)
    for r in range(7):
        ry = -1.95 + r * 0.65
        add_box(bm_s, col_s, -3.78, ry, 2.74, 2.78, 0.12, 0.08, COL_TILE_RIDGE if r % 2 == 0 else COL_TILE_DARK, 0.86, 1.05, rot_y=-0.30)
    # Stacked firewood logs inside shed
    for row in range(3):
        n_logs = 5 - row
        for k in range(n_logs):
            lx = -4.35 + (k + row * 0.5) * 0.34
            lz = 0.48 + row * 0.28
            add_cylinder(bm_s, col_s, lx, -0.15, lz, 0.14, 0.14, 1.55, 6, COL_WOOD_LIGHT, "y", 0.78, 1.0)

    # 5. Lived-in props: ceramic water vat, front wooden fence, right laundry drying rack, corner vine
    add_cylinder(bm_s, col_s, -2.35, -2.55, 0.45, 0.34, 0.42, 0.88, 8, COL_VAT, "z", 0.72, 1.0)
    # Front low bamboo/timber fence
    for fx in (-1.75, -0.95, -0.25):
        add_box(bm_s, col_s, fx, -3.55, 0.48, 0.11, 0.11, 0.96, COL_WOOD_BAMBOO, 0.76, 1.0)
    for fz in (0.34, 0.74):
        add_box(bm_s, col_s, -1.00, -3.55, fz, 1.72, 0.08, 0.09, COL_WOOD_BAMBOO, 0.82, 1.0)
    # Right-side drying rack with cloth drapes
    for rx in (3.75, 4.85):
        add_box(bm_s, col_s, rx, -2.45, 0.82, 0.10, 0.10, 1.64, COL_WOOD_BAMBOO, 0.76, 1.0)
    add_box(bm_s, col_s, 4.30, -2.45, 1.52, 1.38, 0.08, 0.08, COL_WOOD_BAMBOO, 0.85, 1.0)
    add_box(bm_s, col_s, 4.08, -2.45, 1.12, 0.42, 0.06, 0.72, COL_CLOTH_WARM, 0.84, 1.02)
    add_box(bm_s, col_s, 4.56, -2.45, 1.15, 0.36, 0.06, 0.66, COL_CURTAIN, 0.84, 1.02)
    # Subtle climbing ivy accent on left eave corner
    for v_i, (vx, vy, vz, vs) in enumerate([(-2.62, -2.12, 2.75, 0.42), (-2.55, -2.14, 2.25, 0.36), (-2.60, -2.13, 1.75, 0.30)]):
        add_box(bm_s, col_s, vx, vy, vz, vs, 0.14, vs * 1.15, COL_VINE, 0.78, 1.04)

    if export:
        return normalize_and_export("guofeng_house_cottage", bm_s, bm_g)
    return bm_s, bm_g


def build_hall(export=True):
    """Cohesive 2-story Eastern Village Hall (双层青瓦木构宅院) in the same architectural language."""
    bm_s = bmesh.new()
    col_s = bm_s.loops.layers.color.new("Color")
    bm_g = bmesh.new()
    col_g = bm_g.loops.layers.color.new("Color")

    # Broad stone terrace + steps
    add_box(bm_s, col_s, 0, 0, 0.52, 7.6, 5.2, 1.04, COL_STONE, 0.72, 0.98)
    add_box(bm_s, col_s, 0, -2.95, 0.24, 2.6, 0.72, 0.48, COL_STONE_DARK, 0.74, 0.96)
    add_box(bm_s, col_s, 0, -3.45, 0.11, 2.8, 0.42, 0.22, COL_STONE, 0.74, 0.96)

    # Ground floor plaster + timber frame + portico curtain & lanterns
    add_box(bm_s, col_s, 0, 0.15, 2.10, 7.0, 4.4, 2.20, COL_PLASTER, 0.80, 1.02)
    for x in (-3.52, -1.25, 1.25, 3.52):
        for y in (-2.08, 2.38):
            add_box(bm_s, col_s, x, y, 2.10, 0.24, 0.24, 2.24, COL_WOOD, 0.72, 1.0)
    add_box(bm_s, col_s, 0, -2.08, 1.72, 1.65, 0.14, 2.10, COL_WOOD_LIGHT, 0.78, 1.0)
    for sx in (-1.25, 1.25):
        add_hanging_lantern(bm_s, col_s, bm_g, col_g, sx * 1.12, -2.55, 2.45)
    for p_idx in (-1, 0, 1):
        add_box(bm_s, col_s, p_idx * 0.46, -2.42, 2.48, 0.38, 0.05, 0.68, COL_CURTAIN, 0.84, 1.02)
    add_eastern_window(bm_s, col_s, -2.42, -2.08, 2.08, 1.35, 0.98, True, True)
    add_eastern_window(bm_s, col_s, 2.42, -2.08, 2.08, 1.35, 0.98, True, True)

    # Lower waist eave roof skirt
    add_gable_tile_roof(bm_s, col_s, 0, 0.05, 3.16, 7.2, 4.9, 1.05, overhang_x=0.55, overhang_y=0.65, ribs=15, along_x=True)

    # Upper wooden gallery floor
    add_box(bm_s, col_s, 0, 0.15, 4.95, 5.6, 3.7, 2.10, COL_PLASTER, 0.82, 1.02)
    add_box(bm_s, col_s, 0, -1.95, 4.25, 5.9, 0.14, 0.65, COL_WOOD_LIGHT, 0.80, 1.0)
    for x in (-2.82, -0.95, 0.95, 2.82):
        add_box(bm_s, col_s, x, -1.95, 4.98, 0.20, 0.20, 2.12, COL_WOOD, 0.76, 1.0)
    for wx in (-1.85, 0.0, 1.85):
        add_eastern_window(bm_s, col_s, wx, -1.72, 5.02, 1.12, 0.96, True, False)
    add_gable_triangle_wall(bm_s, col_s, -2.80, 0.15, 5.98, 3.7, 1.85)
    add_gable_triangle_wall(bm_s, col_s, 2.80, 0.15, 5.98, 3.7, 1.85)
    add_gable_tile_roof(bm_s, col_s, 0, 0.15, 5.96, 5.6, 3.9, 1.95, overhang_x=0.62, overhang_y=0.68, ribs=13, along_x=True)

    if export:
        return normalize_and_export("guofeng_house_hall", bm_s, bm_g)
    return bm_s, bm_g


def build_tower(export=True):
    """Cohesive 3-tier Eastern Village Pavilion Tower (三层古村望楼)."""
    bm_s = bmesh.new()
    col_s = bm_s.loops.layers.color.new("Color")
    bm_g = bmesh.new()
    col_g = bm_g.loops.layers.color.new("Color")

    add_box(bm_s, col_s, 0, 0, 0.55, 5.4, 5.4, 1.10, COL_STONE, 0.72, 0.98)
    tiers = [(1.10, 4.4, 2.3, 1.05, 9), (3.55, 3.6, 2.1, 1.00, 8), (5.80, 2.9, 1.9, 1.65, 7)]
    for idx, (z0, w, h, rh, ribs) in enumerate(tiers):
        add_box(bm_s, col_s, 0, 0, z0 + h * 0.5, w, w, h, COL_PLASTER if idx < 2 else COL_WOOD_LIGHT, 0.78, 1.02)
        hw = w * 0.5 + 0.05
        for sx in (-hw, hw):
            for sy in (-hw, hw):
                add_box(bm_s, col_s, sx, sy, z0 + h * 0.5, 0.22, 0.22, h + 0.08, COL_WOOD, 0.74, 1.0)
        add_eastern_window(bm_s, col_s, 0, -w * 0.5 - 0.02, z0 + h * 0.52, w * 0.38, h * 0.44, True, False)
        add_eastern_window(bm_s, col_s, 0, w * 0.5 + 0.02, z0 + h * 0.52, w * 0.38, h * 0.44, True, False)
        if idx == 0:
            add_hanging_lantern(bm_s, col_s, bm_g, col_g, -w * 0.35, -w * 0.5 - 0.28, z0 + h - 0.35)
            add_hanging_lantern(bm_s, col_s, bm_g, col_g, w * 0.35, -w * 0.5 - 0.28, z0 + h - 0.35)
        add_gable_triangle_wall(bm_s, col_s, -w * 0.5, 0, z0 + h, w, rh * 0.95)
        add_gable_triangle_wall(bm_s, col_s, w * 0.5, 0, z0 + h, w, rh * 0.95)
        add_gable_tile_roof(bm_s, col_s, 0, 0, z0 + h, w, w, rh, overhang_x=0.52, overhang_y=0.55, ribs=ribs, along_x=True)

    if export:
        return normalize_and_export("guofeng_house_tower", bm_s, bm_g)
    return bm_s, bm_g


def build_bridge_post(export=True):
    """Reference-matched Arched Timber Bridge Post: mossy stone footing, riveted iron collar, timber shaft, bronze-trimmed pyramid cap."""
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Color")

    # 1. Mossy carved stone footing block (embedded slightly below y=0 for solid seating)
    add_box(bm, col, 0, 0, 0.08, 0.62, 0.62, 0.36, COL_STONE, 0.70, 0.98)
    add_box(bm, col, -0.18, -0.22, -0.02, 0.28, 0.22, 0.16, COL_MOSS, 0.78, 1.0)
    add_box(bm, col, 0.20, 0.18, -0.02, 0.24, 0.24, 0.14, COL_MOSS, 0.78, 1.0)

    # 2. Verdigris-iron base collar with brass rivets
    add_box(bm, col, 0, 0, 0.38, 0.40, 0.40, 0.26, COL_IRON, 0.80, 1.02)
    for side_x in (-0.205, 0.205):
        for dy in (-0.10, 0.10):
            for dz in (0.33, 0.43):
                add_box(bm, col, side_x, dy, dz, 0.035, 0.045, 0.045, COL_BRONZE, 0.92, 1.08)
    for side_y in (-0.205, 0.205):
        for dx in (-0.10, 0.10):
            for dz in (0.33, 0.43):
                add_box(bm, col, dx, side_y, dz, 0.045, 0.035, 0.045, COL_BRONZE, 0.92, 1.08)

    # 3. Sturdy square weathered timber post shaft
    add_box(bm, col, 0, 0, 0.90, 0.35, 0.35, 1.02, COL_WOOD, 0.76, 1.02)
    # Upper verdigris-iron neck band
    add_box(bm, col, 0, 0, 1.32, 0.37, 0.37, 0.14, COL_IRON, 0.82, 1.02)

    # 4. Stepped bronze-trimmed dark pyramid cap (金边黑铁四坡柱头)
    add_box(bm, col, 0, 0, 1.44, 0.48, 0.48, 0.10, COL_BRONZE, 0.86, 1.08)
    # 4-sided pyramid top
    base_z, tip_z, hr = 1.49, 1.70, 0.22
    v_tip = bm.verts.new((0, 0, tip_z))
    vb = [
        bm.verts.new((-hr, -hr, base_z)), bm.verts.new((hr, -hr, base_z)),
        bm.verts.new((hr, hr, base_z)), bm.verts.new((-hr, hr, base_z)),
    ]
    for i in range(4):
        ni = (i + 1) % 4
        try:
            f = bm.faces.new((vb[i], vb[ni], v_tip))
            for loop in f.loops:
                loop[col] = (COL_CAP_DARK[0] * 1.02, COL_CAP_DARK[1] * 1.02, COL_CAP_DARK[2] * 1.02, 1.0)
        except ValueError:
            pass

    if not export:
        return bm

    reset_scene()
    mesh = bpy.data.meshes.new("BridgePost")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("BridgePost", mesh)
    bpy.context.collection.objects.link(obj)
    tris = len(obj.data.polygons)
    out_path = os.path.join(OUT_DIR, "guofeng_bridge_post.glb")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_attributes=True,
        export_materials="NONE",
    )
    size_kb = os.path.getsize(out_path) / 1024.0
    print(f"EXPORTED guofeng_bridge_post.glb | faces={tris} | size={size_kb:.1f} KB")
    return obj


def render_preview():
    reset_scene()
    mat = bpy.data.materials.new("PreviewMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85

    for idx, (builder, x_off) in enumerate([(build_cottage, -7.5), (build_hall, 1.5), (build_tower, 9.8)]):
        bm_s, bm_g = builder(export=False)
        for suffix, bm in [("Shell", bm_s), ("Glow", bm_g)]:
            m = bpy.data.meshes.new(f"Arch_{idx}_{suffix}")
            bm.to_mesh(m)
            bm.free()
            o = bpy.data.objects.new(f"Arch_{idx}_{suffix}", m)
            o.location.x = x_off
            o.data.materials.append(mat)
            bpy.context.collection.objects.link(o)

    # Also show the bridge post enlarged slightly in front-left for inspection
    bm_p = build_bridge_post(export=False)
    mp = bpy.data.meshes.new("BridgePostPreview")
    bm_p.to_mesh(mp)
    bm_p.free()
    op = bpy.data.objects.new("BridgePostPreview", mp)
    op.location = (-13.5, -2.0, 0.0)
    op.scale = (2.2, 2.2, 2.2)
    op.data.materials.append(mat)
    bpy.context.collection.objects.link(op)

    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    gnd = bpy.context.active_object
    mg = bpy.data.materials.new("Ground")
    mg.use_nodes = True
    mg.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.26, 0.22, 1.0)
    gnd.data.materials.append(mg)

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 38
    cam_obj = bpy.data.objects.new("Cam", cam_data)
    cam_obj.location = (-1.5, -26.0, 8.2)
    cam_obj.rotation_euler = (Vector((-1.5, 0, 3.2)) - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 640
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED preview -> {PREVIEW_PATH}")


if __name__ == "__main__":
    reset_scene()
    build_cottage(True)
    reset_scene()
    build_hall(True)
    reset_scene()
    build_tower(True)
    build_bridge_post(True)
    render_preview()
