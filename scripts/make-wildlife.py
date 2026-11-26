"""Build the six 云境 creature rigs and gameplay GLBs with Blender 5.2.

Run from the project root: blender --background --python scripts/make-wildlife.py
"""

from pathlib import Path
from math import cos, pi, sin, sqrt
from mathutils import Matrix, Quaternion, Vector
import bpy
import numpy as np


ROOT = Path.cwd()
OUTPUT = ROOT / 'output' / 'Monster_Toon'
GAME = ROOT / 'resource' / 'wildlife'
FPS = 24

# Bone coordinates use Blender Z-up and the creatures' original -Y forward.
# The longest original side is normalised to 2.6 m for authoring.
PROFILES = {
    'flower': dict(hips=(0, .03, .43), chest=(0, .02, 1.13), neck=(0, .02, 1.41), face=(0, -.24, 1.61),
                   legs=[((.25,.02,.43),(.25,-.04,.22),(.26,.013,.09),(.26,-.12,.04))],
                   arms=((.60,-.08,1.12),(.81,-.17,.95),(.98,-.19,.69),(1.04,-.18,.40)),
                   paired=[('Leaf',(.26,.02,1.80),(.88,.08,2.25),'Head',.19)],
                   extras=[('Bloom',(0,.02,1.85),(0,.01,2.55),'Head',.19)], stride=(.65,1.02)),
    'stone-boar': dict(hips=(0,.39,.91), chest=(0,-.48,1.10), neck=(0,-.69,1.29), face=(0,-1.18,.91),
                       legs=[((.39,-.57,.66),(.42,-.56,.39),(.43,-.70,.135),(.43,-.86,.06)),
                             ((.36,.38,.66),(.37,.27,.39),(.37,.40,.135),(.37,.24,.055))],
                       paired=[('Ear',(.37,-.70,1.30),(.59,-.71,1.62),'Head',.13)],
                       extras=[('Sprout',(0,-.64,1.73),(0,-.57,2.09),'Head',.10),
                               ('Tail',(0,.83,.98),(0,1.13,1.00),'Hips',.10),
                               ('TailTip',(0,1.13,1.00),(0,1.28,1.44),'Tail',.09)], stride=(.68,1.18)),
    'water': dict(hips=(0,.02,.58), chest=(0,.03,1.31), neck=(0,-.04,1.48), face=(0,-.15,1.99),
                  legs=[((.24,.01,.57),(.26,-.069,.35),(.27,-.02,.125),(.27,-.23,.06))],
                  arms=((.30,-.055,1.28),(.43,-.12,.91),(.55,-.15,.70),(.65,-.18,.56)),
                  paired=[('Fin',(.31,-.11,1.76),(.66,-.24,1.73),'Head',.12)],
                  extras=[('Plume',(0,-.035,2.16),(0,.03,2.57),'Head',.09),
                          ('Shell',(0,.25,1.24),(0,.51,.70),'Chest',.29),
                          ('Tail',(0,.18,.45),(0,.49,.31),'Hips',.10)], stride=(.83,1.25)),
    'wolf': dict(hips=(0,.55,1.03), chest=(0,-.40,1.13), neck=(0,-.64,1.36), face=(0,-1.13,1.13),
                 legs=[((.29,-.36,.91),(.30,-.32,.50),(.31,-.65,.155),(.31,-.85,.05)),
                       ((.29,.62,.98),(.25,.48,.60),(.28,.91,.27),(.28,.76,.07))],
                 paired=[('Ear',(.19,-.64,1.62),(.30,-.84,2.05),'Head',.11)],
                 extras=[('Jaw',(0,-.73,1.16),(0,-1.18,.99),'Head',.11),
                         ('Tail',(0,.75,1.08),(0,1.10,1.22),'Hips',.14),
                         ('TailMid',(0,1.10,1.22),(0,1.19,1.63),'Tail',.12),
                         ('TailTip',(0,1.19,1.63),(0,.57,1.77),'TailMid',.13)], stride=(1.15,2.05)),
    'mantis': dict(hips=(0,.02,.95), chest=(0,-.08,1.50), neck=(0,-.18,1.72), face=(0,-.34,1.99),
                   legs=[((.25,-.01,.89),(.40,-.27,.54),(.48,-.125,.105),(.49,-.31,.04))],
                   arms=((.25,-.07,1.51),(.398,-.30,1.36),(.54,-.49,1.47),(.61,-.48,.64)),
                   paired=[('Antenna',(.085,-.23,2.06),(.31,-.21,2.46),'Head',.055),
                           ('AntennaTip',(.31,-.21,2.46),(.51,.31,2.38),'Antenna',.055)],
                   extras=[('Abdomen',(0,.09,1.0),(0,.42,.58),'Hips',.17),
                           ('AbdomenTip',(0,.42,.58),(0,.57,.29),'Abdomen',.14)], stride=(1.0,1.65)),
    'crystal-boar': dict(hips=(0,.48,.87), chest=(0,-.43,1.02), neck=(0,-.63,1.09), face=(0,-1.18,.59),
                         legs=[((.37,-.42,.68),(.41,-.36,.42),(.40,-.53,.15),(.40,-.74,.055)),
                               ((.35,.52,.73),(.37,.43,.41),(.37,.66,.135),(.37,.49,.06))],
                         paired=[('Ear',(.31,-.51,1.05),(.47,-.62,1.21),'Head',.08)],
                         extras=[('Jaw',(0,-.72,.61),(0,-1.15,.37),'Head',.10),
                                 ('Tail',(0,.88,.86),(0,1.25,.69),'Hips',.09)], stride=(.83,1.42)),
}

CLIPS = dict(Idle=60, Walk=26, Run=17, Forage=65, Attack=26, Hit=12, Defeat=27)
X, Y, Z = (Vector(axis) for axis in ((1,0,0),(0,1,0),(0,0,1)))


def create_rig(name, profile):
    data = bpy.data.armatures.new(name + ' Skeleton')
    rig = bpy.data.objects.new(name + ' Rig', data)
    bpy.context.scene.collection.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    segments = {}

    def bone(label, head, tail, parent=None, radius=.15, deform=True):
        item = data.edit_bones.new(label)
        item.head, item.tail = head, tail
        item.use_deform = deform
        if parent:
            item.parent = data.edit_bones[parent]
            item.use_connect = (item.head-item.parent.tail).length < 1e-5
        if deform:
            segments[label] = (head, tail, radius)

    hips, chest, neck, face = (profile[k] for k in ('hips','chest','neck','face'))
    quad = len(profile['legs']) == 2
    bone('Root',(0,0,0),(0,0,.20),deform=False)
    bone('Hips',hips,chest,'Root',.39 if quad else .26)
    bone('Chest',chest,neck,'Hips',.38 if quad else .22)
    bone('Head',neck,face,'Chest',.32 if name != 'mantis' else .17)
    for side, sign in [('L',1),('R',-1)]:
        def mirror(point):
            return (point[0]*sign, point[1], point[2])

        for row, chain in enumerate(profile['legs']):
            names = leg_names(row, side)
            parent = 'Chest' if quad and row == 0 else 'Hips'
            for j,label in enumerate(names):
                bone(label,mirror(chain[j]),mirror(chain[j+1]),parent,.12 if quad else .095)
                parent = label
        if 'arms' in profile:
            parent = 'Chest'
            for j, label in enumerate(('UpperArm','Forearm','Hand')):
                arm = profile['arms']
                label += '.'+side
                bone(label,mirror(arm[j]),mirror(arm[j+1]),parent,.11 if name == 'mantis' else .09)
                parent = label
        for label, head, tail, parent, radius in profile['paired']:
            parent = parent if parent == 'Head' else parent+'.'+side
            bone(label+'.'+side,mirror(head),mirror(tail),parent,radius)
    for label, head, tail, parent, radius in profile['extras']:
        bone(label,head,tail,parent,radius)
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig, segments


def leg_names(row, side):
    prefix = ('Front','Rear')[row]
    return tuple(f'{prefix}{part}.{side}' for part in ('Thigh','Shin','Foot'))


def bind_mesh(rig, model, segments, name):
    # Fit a smooth, normalised four-influence envelope on the actual surface.
    # Restrict limbs to their body side and legs below their attachment.
    xyz = np.empty(len(model.data.vertices)*3, dtype=np.float32)
    model.data.vertices.foreach_get('co',xyz)
    xyz = xyz.reshape((-1,3))
    scores = []
    groups = []
    for label, (head, tail, radius) in segments.items():
        a, b = np.array(head), np.array(tail)
        direction = b-a
        along = np.clip(((xyz-a)@direction)/np.dot(direction,direction),0,1)
        distance = np.linalg.norm(xyz - (a + along[:, None]*direction),axis=1) - radius*.66
        if label.endswith(('.L','.R')):
            side = 1 if label.endswith('.L') else -1
            distance += np.maximum(0, .015-xyz[:,0]*side)*2.5
        if label.startswith(('Front','Rear')):
            distance += np.maximum(0, xyz[:,2]-head[2]-.025)*1.8
            if name == 'flower':
                distance += np.maximum(0, np.abs(xyz[:,0])-.43)*1.3
        elif label in {'Hips','Chest','Head'}:
            floor = .24 if name == 'flower' else .30
            distance += np.maximum(0, floor-xyz[:,2])*4
        if label.startswith(('UpperArm','Forearm','Hand')):
            inboard = {'flower':.57,'water':.26,'mantis':.23}[name]
            distance += np.maximum(0, inboard-np.abs(xyz[:,0]))*2.5
        if label in {'Jaw','Shell'}:
            # Preserve the shell and lower jaw as coherent attachments.
            front = label == 'Jaw'
            distance += np.maximum(0, xyz[:,2]-head[2]-.045)*2.2 if front else np.maximum(0,.13-xyz[:,1])*3
        scores.append(distance)
        groups.append(model.vertex_groups.new(name=label))

    score = np.stack(scores,axis=1)
    order = np.argsort(score,axis=1)[:,:4]
    best = np.take_along_axis(score,order,axis=1)
    weights = np.exp(-(best-best[:,:1]) / (.045 if name in {'flower','mantis'} else .058))
    weights[weights < .028] = 0
    weights /= weights.sum(axis=1,keepdims=True)
    for vertex,(joints,values) in enumerate(zip(order,weights)):
        for j,w in zip(joints,values):
            if w:
                groups[int(j)].add([vertex],float(w),'REPLACE')
    model.parent = rig
    modifier = model.modifiers.new('Creature skin','ARMATURE')
    modifier.object = rig


def rotate(bone, axis, angle):
    local_axis = bone.bone.matrix_local.to_quaternion().inverted() @ axis
    bone.rotation_quaternion @= Quaternion(local_axis,angle)


def aim(bone, parent_matrix, direction):
    basis = parent_matrix @ bone.parent.bone.matrix_local.inverted() @ bone.bone.matrix_local
    rest_rotation = basis.to_quaternion()
    corrected = (rest_rotation @ Y).rotation_difference(direction) @ rest_rotation
    bone.rotation_quaternion = rest_rotation.inverted() @ corrected
    return Matrix.LocRotScale(basis.translation, corrected, Vector((1,1,1)))


def plant_foot(bones, points, shift, lift, splay=0):
    thigh, shin, foot = bones
    hip, knee, ankle, toe = map(Vector,points)
    origin = thigh.head.copy()
    target = ankle + Vector((splay,shift,lift))
    dist = (target-origin).length
    line = (target-origin).normalized()
    upper, lower = thigh.length, shin.length
    reach = min(upper+lower-.003,max(abs(upper-lower)+.003,dist))
    along = (upper*upper+reach*reach-lower*lower)/(2*reach)
    bend = knee-hip
    bend -= line*bend.dot(line)
    if bend.length < .008:
        bend = -Y + line*line.y
    joint = origin + line*along + bend.normalized()*sqrt(max(0,upper*upper-along*along))
    upper_pose = aim(thigh,thigh.parent.matrix,joint-origin)
    lower_pose = aim(shin,upper_pose,origin+line*reach-joint)
    aim(foot,lower_pose,toe-ankle)


def gait(phase, stance, stride, step_height):
    phase %= 1
    travel = stance*stride
    if phase < stance:
        return (phase/stance-.5)*travel, 0
    p = (phase-stance)/(1-stance)
    return (.5-p)*travel, step_height*sin(pi*p)


def animate(rig, name, profile):
    pose = rig.pose.bones
    for bone in pose:
        bone.rotation_mode = 'QUATERNION'
    animation = rig.animation_data_create()
    actions = []
    quad = len(profile['legs']) == 2
    for clip, frames in CLIPS.items():
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        animation.action = action
        for frame in range(frames+1):
            t = frame/frames
            beat = 2*pi*t
            body = pose['Root']
            previous = {b.name:b.rotation_quaternion.copy() for b in pose}
            for b in pose:
                b.rotation_quaternion = Quaternion()
                b.location = Vector()
            offset = Vector((0,0,.016*sin(beat)))
            locomotion = clip in {'Walk','Run'}
            running = clip == 'Run'
            strike = max(0,1-abs(t-.52)/.16) if clip == 'Attack' else 0
            ready = max(0,1-abs(t-.30)/.24) if clip == 'Attack' else 0
            recoil = sin(pi*min(1, t/.80))**2 * (1.0 if t <= .34 else .76) if clip == 'Hit' else 0
            if locomotion:
                offset.z = (-.047 if running else -.021) + (.039 if running else .022)*cos(beat*(1 if quad and running else 2))
                rotate(body,Z,.035*sin(beat))
                rotate(pose['Chest'],X,(.08 if running else .035)*sin(beat))
                rotate(pose['Head'],Z,.04*sin(beat-.35))
            elif clip == 'Forage':
                dip = sin(pi*t)**2
                rotate(pose['Chest'],X,.27*dip if quad else .13*dip)
                rotate(pose['Head'],X,.32*dip if quad else .19*dip)
                rotate(pose['Head'],Z,.085*sin(3*beat)*dip)
                offset.z -= dip*(.045 if quad else .028)
            elif clip == 'Attack':
                offset.y += .12*ready - (.40 if quad else .22)*strike
                offset.z += .12*strike - .07*ready
                rotate(body,X,(.17*ready - .12*strike) if quad else (-.13*ready+.18*strike))
                rotate(pose['Head'],X,(.34*ready-.27*strike) if quad else .12*strike)
                if 'Jaw' in pose:
                    rotate(pose['Jaw'],X,.39*ready+.12*strike)
            elif clip == 'Hit':
                flinch = sin(pi*min(1,t/.43)) if t <= .43 else 0
                heavy = .66 if name in {'stone-boar','crystal-boar'} else 1.0
                offset.y += .10*recoil*heavy
                offset.z -= .075*recoil*heavy
                rotate(body,X,-.13*flinch*heavy)
                rotate(pose['Chest'],Y,.19*recoil*heavy)
                rotate(pose['Head'],X,-.25*flinch*heavy)
            elif clip == 'Defeat':
                tilt = min(1,t/.84)
                tilt = tilt*tilt*(3-2*tilt)
                offset = Vector((.14*tilt, .08*tilt, (.60 if name=='flower' else .47)*tilt))
                rotate(body,Y,-1.49*tilt)
                rotate(pose['Head'],Z,.20*tilt)
            body.location = body.bone.matrix_local.to_quaternion().inverted() @ offset

            for b in pose:
                prefix = b.name.split('.')[0]
                if prefix in {'Tail','TailMid','TailTip','Fin','Sprout','Plume','Leaf','Antenna','AntennaTip','Abdomen','AbdomenTip','Bloom','Ear'}:
                    strength = .12 if locomotion else .073
                    sign = -1 if b.name.endswith('.R') else 1
                    phase = beat - ((2 if prefix.endswith('Tip') else 1) if prefix.startswith(('Tail','Antenna')) else 0)
                    rotate(b, Z if prefix.startswith(('Tail','Abdomen')) else X, sign*strength*sin(phase)*(1-t if clip=='Defeat' else 1))
            if 'arms' in profile:
                for side, sign in [('L',1),('R',-1)]:
                    arm = pose['UpperArm.'+side]
                    forearm = pose['Forearm.'+side]
                    hand = pose['Hand.'+side]
                    swing = sign*(.41 if running else .24)*sin(beat) if locomotion else sign*.06*sin(beat)
                    if clip == 'Attack':
                        sweep = strike if side == 'L' else max(0,1-abs(t-.63)/.14)
                        rotate(arm,Z,sign*(.88*ready-.94*sweep))
                        swing += .49*ready-1.04*sweep
                        rotate(forearm,X,-.38*ready+.60*sweep)
                        rotate(hand,Y,sign*.27*sweep)
                    elif clip == 'Forage':
                        swing -= .25*sin(pi*t)**2
                    elif clip == 'Hit':
                        rotate(arm,Z,sign*.30*recoil)
                        swing += .23*recoil
                        rotate(forearm,X,-.20*recoil)
                    rotate(arm,X,swing)

            bpy.context.view_layer.update()
            if clip != 'Defeat':
                for row,chain in enumerate(profile['legs']):
                    for side, sign in [('L',1),('R',-1)]:
                        bones = tuple(pose[n] for n in leg_names(row,side))
                        points = tuple((sign*x,y,z) for x,y,z in chain)
                        shift = lift = 0
                        if locomotion:
                            phase = t + (.5 if side=='R' else 0)
                            if quad:
                                phase = t + ((.49*row+.14*(side=='R')) if running else (.74*row+.5*(side=='R')))
                            stride = profile['stride'][int(running)]
                            height = (.21 if running else .115)*(1.15 if name in {'wolf','mantis'} else 1)
                            shift,lift = gait(phase,.56 if running else .65,stride,height)
                        elif clip == 'Attack':
                            shift = -.17*strike if row==0 and (quad or side=='L') else .035*ready
                            lift = .085*strike if row==0 and (not quad or name=='wolf') else 0
                        elif clip == 'Hit' and (row==1 if quad else side=='R'):
                            shift = .14*recoil
                            lift = .068*recoil
                        plant_foot(bones,points,shift,lift)
            for b in pose:
                if frame and b.rotation_quaternion.dot(previous[b.name]) < 0:
                    b.rotation_quaternion.negate()
                b.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=b.name)
            body.keyframe_insert(data_path='location',frame=frame,group=body.name)
        for channelbag in action.layers[0].strips[0].channelbags:
            for fcurve in channelbag.fcurves:
                for key in fcurve.keyframe_points:
                    key.interpolation = 'LINEAR'
        actions.append((action,animation.action_slot))
        animation.action = None
    for action,slot in actions:
        track = animation.nla_tracks.new()
        track.name = action.name.split('.')[0]
        strip = track.strips.new(track.name,0,action)
        strip.action_slot = slot
        track.mute = True
    return actions


def model_for(number, name):
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'resource'/f'master{number}.glb'),merge_vertices=True)
    model = next(o for o in bpy.context.selected_objects if o.type=='MESH')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bounds = [Vector(v) for v in model.bound_box]
    low = Vector(tuple(min(p[i] for p in bounds) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in bounds) for i in range(3)))
    center = (low+high)/2
    center.z = low.z
    scale = 2.6/max(high-low)
    for v in model.data.vertices:
        v.co = (v.co-center)*scale
    model.name = name
    simplify = model.modifiers.new('Gameplay mesh density','DECIMATE')
    simplify.ratio = .54
    bpy.ops.object.modifier_apply(modifier=simplify.name)

    mat = model.data.materials[0]
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    base = bsdf.inputs['Base Color'].links[0].from_node
    output = next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    for node in list(nodes):
        if node not in (bsdf,base,output):
            nodes.remove(node)
    bsdf.inputs['Metallic'].default_value = 0
    bsdf.inputs['Roughness'].default_value = .9
    base.image.scale(1024,1024)
    base.image.pack()
    return model


def run():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    GAME.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    first = bpy.context.scene
    for number,(name,profile) in enumerate(PROFILES.items(),1):
        scene = first if number==1 else bpy.data.scenes.new(name)
        scene.name = name
        bpy.context.window.scene = scene
        scene.render.fps = FPS
        scene.frame_start = 0
        scene.frame_end = max(CLIPS.values())
        model = model_for(number,name)
        model.select_set(False)
        rig,segments = create_rig(name,profile)
        bind_mesh(rig,model,segments,name)
        actions = animate(rig,name,profile)
        model.select_set(True)
        for track in rig.animation_data.nla_tracks:
            track.mute = False
        bpy.ops.export_scene.gltf(filepath=str(GAME/f'{name}.glb'),use_selection=True,use_active_scene=True,export_format='GLB',
                                  export_image_format='JPEG',export_image_quality=89,export_animation_mode='NLA_TRACKS',
                                  export_anim_slide_to_zero=True,export_reset_pose_bones=True,export_texcoords=True)
        for track in rig.animation_data.nla_tracks:
            track.mute = True
        rig.animation_data.action, rig.animation_data.action_slot = actions[0]
        scene.frame_set(0)
        print(name, 'joints',len(rig.data.bones),'vertices',len(model.data.vertices),flush=True)
    bpy.context.window.scene = first
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                view = area.spaces.active.region_3d
                view.view_location = (0,0,1.1)
                view.view_distance = 5.6
                view.view_rotation = Vector((.4,.9,-.22)).to_track_quat('-Z','Y')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/'Monster_Rigs.blend'),compress=True)


if __name__=='__main__':
    run()
