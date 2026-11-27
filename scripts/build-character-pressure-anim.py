"""
Authors the crouched, hunched, wide-stance gravity-suppression skeletal animation (`Pressure_Suppress_Loop`)
directly on `resource/Character.glb`'s exact `CharacterRig` armature, exports `resource/boss/Character_Pressure_Anim.glb`,
and renders a quick side-3/4 preview PNG so we can verify bone orientations visually!
"""
import os
import math
import bpy
from mathutils import Vector, Quaternion, Matrix

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHAR_GLB = os.path.join(ROOT_DIR, "resource", "Character.glb")
OUT_GLB = os.path.join(ROOT_DIR, "resource", "boss", "Character_Pressure_Anim.glb")
PREVIEW_PNG = os.environ.get("CHAR_PRESSURE_PREVIEW", os.path.join(ROOT_DIR, "resource", "boss", "preview_char_pressure.png"))
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)


def world_axis_rot_to_bone_local_quat(arm_obj, pbone, world_axis, angle_rad):
    """Converts a rotation around a world-space axis into the pose bone's local rotation quaternion."""
    # Bone's rest orientation in armature/world space (3x3)
    bone_mat = (arm_obj.matrix_world @ pbone.bone.matrix_local).to_3x3().normalized()
    local_axis = bone_mat.inverted() @ Vector(world_axis).normalized()
    return Quaternion(local_axis, angle_rad)


def world_delta_to_bone_local_loc(arm_obj, pbone, world_delta):
    """Converts a world-space translation delta into the pose bone's local translation."""
    bone_mat = (arm_obj.matrix_world @ pbone.bone.matrix_local).to_3x3()
    return bone_mat.inverted() @ Vector(world_delta)


def build_anim():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 60

    bpy.ops.import_scene.gltf(filepath=CHAR_GLB)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("Character.glb missing armature")

    # Clear imported animations so only our new Pressure_Suppress_Loop is exported
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    if arm.animation_data:
        arm.animation_data.action = None
    else:
        arm.animation_data_create()

    action = bpy.data.actions.new("Pressure_Suppress_Loop")
    arm.animation_data.action = action

    # Note: glTF Character.glb imports into Blender with character facing -Y (or +Y); let's detect nose/forward axis!
    # Check left vs right thigh X positions to confirm facing direction
    thigh_l = arm.pose.bones.get("thigh.L")
    thigh_r = arm.pose.bones.get("thigh.R")
    lx = (arm.matrix_world @ thigh_l.bone.head_local).x if thigh_l else 0.1
    rx = (arm.matrix_world @ thigh_r.bone.head_local).x if thigh_r else -0.1
    # If left thigh has +X, character faces -Y (standard Blender front); if -X, character faces +Y!
    faces_minus_y = lx > rx
    fwd = Vector((0, -1, 0)) if faces_minus_y else Vector((0, 1, 0))
    right = Vector((-1, 0, 0)) if faces_minus_y else Vector((1, 0, 0))
    up = Vector((0, 0, 1))
    print(f"Detected character facing: {'-Y' if faces_minus_y else '+Y'} (lx={lx:.3f}, rx={rx:.3f})")

    # Helper to apply composed world-space rotations on a pose bone
    # Pitch forward = rotation around +right (positive tilts top of torso toward fwd!)
    def set_bone_rot(name, pitch_fwd_deg=0.0, roll_right_deg=0.0, yaw_left_deg=0.0, frame=1):
        pb = arm.pose.bones.get(name)
        if not pb:
            return
        pb.rotation_mode = "QUATERNION"
        q = Quaternion((1, 0, 0, 0))
        if abs(yaw_left_deg) > 1e-4:
            q = q @ world_axis_rot_to_bone_local_quat(arm, pb, up, math.radians(yaw_left_deg))
        if abs(pitch_fwd_deg) > 1e-4:
            # Right-hand rule: thumb along `right`, curling from `up` toward `fwd`!
            # Wait: cross(right, up): if right=(-1,0,0), up=(0,0,1), right x up = (0,1,0) = -fwd!
            # So +rotation around (-right) moves `up` toward `fwd`!
            axis_pitch = up.cross(fwd).normalized()  # up x fwd: rotating +angle around (up x fwd) moves up -> fwd?
            # Verify: rotate `up` by +90 deg around `axis`: Rodrigues gives axis x up.
            # We want axis x up = fwd -> axis = up x fwd (since (up x fwd) x up = fwd*(up.up) - up*(fwd.up) = fwd)!
            q = q @ world_axis_rot_to_bone_local_quat(arm, pb, axis_pitch, math.radians(pitch_fwd_deg))
        if abs(roll_right_deg) > 1e-4:
            # Rotate `up` toward `right`: axis = up x right
            axis_roll = up.cross(right).normalized()
            q = q @ world_axis_rot_to_bone_local_quat(arm, pb, axis_roll, math.radians(roll_right_deg))
        pb.rotation_quaternion = q
        pb.keyframe_insert("rotation_quaternion", frame=frame)

    def set_pelvis_drop(drop_z, shift_fwd, frame):
        pb = arm.pose.bones.get("pelvis")
        if not pb:
            return
        delta = Vector((0, 0, -drop_z)) + fwd * shift_fwd
        pb.location = world_delta_to_bone_local_loc(arm, pb, delta)
        pb.keyframe_insert("location", frame=frame)

    # Keyframe a 60-frame looping struggling/trembling crouched bracing pose under crushing gravity!
    # Matches the user's stick-figure sketch: wide braced legs, hunched curved back, arms splayed & trembling!
    keyframes = [1, 10, 20, 30, 40, 50, 60]
    for f in keyframes:
        cyc = (f - 1) / 59.0 * math.pi * 2.0
        # Subtle straining breath + high-frequency gravity tremor
        strain = math.sin(cyc) * 3.5
        tremor = math.sin(cyc * 3.0) * 1.8
        drop = 0.24 + 0.025 * math.sin(cyc)

        set_pelvis_drop(drop, 0.05, f)
        set_bone_rot("pelvis", pitch_fwd_deg=12 + strain * 0.4, roll_right_deg=tremor * 0.3, frame=f)

        # Hunched curved spine & chest straining against crushing downward weight
        set_bone_rot("spine", pitch_fwd_deg=24 + strain * 0.7, roll_right_deg=-tremor * 0.4, frame=f)
        set_bone_rot("chest", pitch_fwd_deg=20 + strain * 0.8, roll_right_deg=tremor * 0.5, frame=f)
        # Neck & head forced downward while trying to resist
        set_bone_rot("neck", pitch_fwd_deg=-12 - strain * 0.3, frame=f)
        set_bone_rot("head", pitch_fwd_deg=-16 - strain * 0.4, yaw_left_deg=tremor * 1.1, frame=f)

        # Wide-stance braced legs (left leg stepped forward, right leg braced back — exact sketch silhouette!)
        set_bone_rot("thigh.L", pitch_fwd_deg=-48 - strain * 0.4, roll_right_deg=-14, frame=f)
        set_bone_rot("shin.L", pitch_fwd_deg=54 + strain * 0.5, frame=f)
        set_bone_rot("foot.L", pitch_fwd_deg=-12, frame=f)

        set_bone_rot("thigh.R", pitch_fwd_deg=26 + strain * 0.3, roll_right_deg=16, frame=f)
        set_bone_rot("shin.R", pitch_fwd_deg=34 + strain * 0.4, frame=f)
        set_bone_rot("foot.R", pitch_fwd_deg=-42, frame=f)

        # Arms splayed out and down, bracing/trembling under the crushing air weight
        set_bone_rot("clavicle.L", pitch_fwd_deg=10, roll_right_deg=-8, frame=f)
        set_bone_rot("upper_arm.L", pitch_fwd_deg=-22 + tremor, roll_right_deg=-34 - strain * 0.6, frame=f)
        set_bone_rot("forearm.L", pitch_fwd_deg=-42 - strain * 0.5, roll_right_deg=-12, frame=f)

        set_bone_rot("clavicle.R", pitch_fwd_deg=10, roll_right_deg=8, frame=f)
        set_bone_rot("upper_arm.R", pitch_fwd_deg=-26 - tremor, roll_right_deg=36 + strain * 0.6, frame=f)
        set_bone_rot("forearm.R", pitch_fwd_deg=-38 - strain * 0.5, roll_right_deg=12, frame=f)

    # Render a quick side-3/4 verification preview BEFORE stripping meshes for animation-only GLB!
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.frame_set(15)

    bpy.ops.object.light_add(type="AREA", location=(3, -3, 4))
    l1 = bpy.context.active_object
    l1.data.energy = 400
    l1.data.size = 3
    cam_d = bpy.data.cameras.new("PrevCam")
    cam_o = bpy.data.objects.new("PrevCam", cam_d)
    scene.collection.objects.link(cam_o)
    cam_o.location = right * 2.6 + fwd * 1.4 + Vector((0, 0, 1.05))
    cam_o.rotation_euler = (Vector((0, 0, 0.78)) - cam_o.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam_o
    scene.render.filepath = PREVIEW_PNG
    bpy.ops.render.render(write_still=True)
    print(f"[OK] Rendered pose preview {PREVIEW_PNG}")

    # Remove lights/camera and meshes so we export a lightweight animation-only GLB (only CharacterRig + action!)
    for obj in list(bpy.data.objects):
        if obj != arm:
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_animations=True,
        export_nla_strips=False,
        export_force_sampling=True,
        export_frame_range=True,
    )
    print(f"[OK] Exported {OUT_GLB}")


if __name__ == "__main__":
    build_anim()
