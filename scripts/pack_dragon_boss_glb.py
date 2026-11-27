import bpy
import math
import os
from mathutils import Euler

"""
Packs the upgraded 4-bone-neck Dragon_Mesh + Dragon_Armature and ALL 7 finalized
animation clips into a single game-ready multi-clip GLB:
  D:\workspace\云境\resource\boss\dragon_boss.glb

Included AnimationClips (all pushed to NLA tracks so GLTF exporter includes every clip):
  1. Dragon_Sleep_Idle              (72f / 3.0s loop: grounded sleep pose + gentle chest/wing breathing)
  2. Dragon_Wake_Up                 (96f / 4.0s: sleep -> head lift -> front push-up -> stand & wing shake -> idle)
  3. Dragon_Walk_Cycle              (48f / 2.0s loop: weighty 4-beat quadruped patrol walk)
  4. Dragon_Flight_Cycle            (loop: majestic high-altitude soaring/circling wingbeat)
  5. Dragon_Landing                 (120f / 5.0s: weighty descent & impact landing)
  6. Dragon_Territory_Landing_Roar  (220f / 9.17s: territorial landing + low-crouch sweeping roar)
  7. Dragon_Low_Flight_Breath       (96f / 4.0s: low-altitude gliding fire-breath strafe)
"""

MASTER_BLEND = r"D:\workspace\云境\output\dragon_wakeup\dragon_wakeup.blend"
OUT_GLB = r"D:\workspace\云境\resource\boss\dragon_boss.glb"
OUT_MASTER_BLEND = r"D:\workspace\云境\output\dragon_boss_master.blend"

SOURCES = [
    (r"D:\workspace\云境\output\dragon_walk\dragon_walk.blend", "Dragon_Walk_Cycle"),
    (r"D:\workspace\云境\output\dragon_territory_roar\dragon_territory_roar.blend", "Dragon_Territory_Landing_Roar"),
    (r"D:\workspace\云境\output\dragon_flight\dragon_flight.blend", "Dragon_Flight_Cycle"),
    (r"D:\workspace\云境\output\dragon_landing\dragon_landing.blend", "Dragon_Landing"),
    (r"D:\workspace\云境\output\dragon_breath\dragon_breath.blend", "Dragon_Low_Flight_Breath"),
    (r"D:\workspace\云境\output\dragon_attacks\dragon_attacks.blend", "Dragon_Attack_ClawSwipe"),
    (r"D:\workspace\云境\output\dragon_attacks\dragon_attacks.blend", "Dragon_Attack_BiteLunge"),
    (r"D:\workspace\云境\output\dragon_attacks\dragon_attacks.blend", "Dragon_Attack_TailWhip"),
    (r"D:\workspace\云境\output\dragon_attacks\dragon_attacks.blend", "Dragon_Attack_GroundBreath"),
]

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=MASTER_BLEND)

arm_obj = bpy.data.objects["Dragon_Armature"]
mesh_obj = bpy.data.objects["Dragon_Mesh"]
scene = bpy.context.scene
scene.render.fps = 24

# Clean non-dragon objects
for o in list(bpy.data.objects):
    if o not in (arm_obj, mesh_obj):
        bpy.data.objects.remove(o, do_unlink=True)

# 1) Create a gentle 72-frame (3.0s @ 24fps) breathing loop `Dragon_Sleep_Idle` from `Dragon_Sleep_Pose`
sleep_pose_act = bpy.data.actions.get("Dragon_Sleep_Pose")
if sleep_pose_act:
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = sleep_pose_act
    scene.frame_set(1)
    bpy.context.view_layer.update()

    # Snapshot base pose
    base_eul = {}
    base_root_loc = arm_obj.pose.bones["Root"].location.copy()
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = 'XYZ'
        base_eul[pb.name] = pb.rotation_euler.copy()

    sleep_idle = bpy.data.actions.new(name="Dragon_Sleep_Idle")
    sleep_idle.use_fake_user = True
    arm_obj.animation_data.action = sleep_idle

    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='POSE')
    for f in range(1, 73):
        t = (f - 1) / 72.0
        breath = 0.5 - 0.5 * math.cos(2.0 * math.pi * t)  # 0 -> 1 -> 0 seamless breathing cycle
        for pb in arm_obj.pose.bones:
            e = base_eul[pb.name].copy()
            if pb.name == "Chest":
                e.x -= math.radians(2.8 * breath)
            elif pb.name == "Spine_02":
                e.x -= math.radians(1.6 * breath)
            elif pb.name in ("WingRoot.L", "WingRoot.R"):
                e.x += math.radians(2.2 * breath)
            elif pb.name == "Head":
                e.x += math.radians(1.2 * breath)
            elif pb.name == "Tail_07":
                e.z += math.radians(2.5 * math.sin(2.0 * math.pi * t))
            pb.rotation_euler = e
            pb.scale = (1.0, 1.0, 1.0)
            pb.keyframe_insert(data_path="rotation_euler", frame=f)
            if pb.name == "Root":
                pb.location = base_root_loc
                pb.keyframe_insert(data_path="location", frame=f)
    bpy.ops.object.mode_set(mode='OBJECT')

# 2) Append external actions from each finalized .blend
loaded_actions = []
for name in ("Dragon_Sleep_Idle", "Dragon_Wake_Up"):
    a = bpy.data.actions.get(name)
    if a:
        loaded_actions.append(a)

for blend_path, act_name in SOURCES:
    if not os.path.exists(blend_path):
        print(f"WARNING: missing {blend_path}")
        continue
    existing = bpy.data.actions.get(act_name)
    if existing:
        bpy.data.actions.remove(existing, do_unlink=True)
    with bpy.data.libraries.load(blend_path, link=False) as (data_from, data_to):
        if act_name in data_from.actions:
            data_to.actions = [act_name]
        else:
            print(f"WARNING: action {act_name} not found in {blend_path} (available: {data_from.actions})")
    act = bpy.data.actions.get(act_name)
    if act:
        act.use_fake_user = True
        loaded_actions.append(act)
        print(f"LOADED ACTION: {act.name} ({act.frame_range[0]:.0f}..{act.frame_range[1]:.0f})")

# 3) Push every action onto its own NLA track on Dragon_Armature so glTF exports ALL clips cleanly!
if not arm_obj.animation_data:
    arm_obj.animation_data_create()
arm_obj.animation_data.action = None
for tr in list(arm_obj.animation_data.nla_tracks):
    arm_obj.animation_data.nla_tracks.remove(tr)

for act in loaded_actions:
    tr = arm_obj.animation_data.nla_tracks.new()
    tr.name = act.name
    f_start = int(round(act.frame_range[0]))
    strip = tr.strips.new(name=act.name, start=f_start, action=act)
    strip.name = act.name
    tr.mute = False

# Save master blend
bpy.ops.wm.save_as_mainfile(filepath=OUT_MASTER_BLEND)
print("SAVED MASTER BLEND:", OUT_MASTER_BLEND)

# Export unified multi-clip GLB with ALL 7 actions embedded!
# CRITICAL: Unhide Dragon_Armature & Dragon_Mesh so glTF exporter includes the Skin + all 7 AnimationClips!
arm_obj.hide_viewport = False
arm_obj.hide_render = False
arm_obj.hide_set(False)
mesh_obj.hide_viewport = False
mesh_obj.hide_render = False
mesh_obj.hide_set(False)
arm_obj.animation_data.action = bpy.data.actions.get("Dragon_Sleep_Idle")

bpy.ops.object.select_all(action='DESELECT')
arm_obj.select_set(True)
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='JPEG',
    export_image_quality=85,
)
print(f"EXPORTED UNIFIED MULTI-CLIP GLB: {OUT_GLB} ({os.path.getsize(OUT_GLB)/(1024*1024):.2f} MB)")
print("CLIPS:", [a.name for a in loaded_actions])
