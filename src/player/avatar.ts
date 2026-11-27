import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detectDevice } from '../config/device';
import { giantSwordAnimRate, giantSwordCastEnd } from '../effects/giant-sword';

type Gait = 'Idle' | 'Walk' | 'Run';
type Motion = Gait | 'Jump_Start' | 'Jump_Loop' | 'Jump_Land' |
    'Fly_Mount' | 'Fly_Loop' | 'Nascent_Fly_Loop' | 'Nascent_Hover_Loop' |
    'Nascent_Meditate_Loop' | 'Nascent_Breakthrough_Burst' |
    'Pressure_Suppress_Loop' |
    'Swim_Idle_Loop' | 'Swim_Fwd_Loop' |
    'Sword_Draw' | 'Sword_Ready' | 'Sword_Walk' | 'Sword_Run' |
    'Attack_Slash' | 'Sword_Sheathe' |
    'Light_Draw' | 'Light_Slash' | 'Skill_DrawAndRaise' | 'Skill_RaiseSword' | 'Fireball_Cast' | 'Skill_GiantSword';

export type Attack = 'light' | 'heavy';
type ActionCue = 'light-hit' | 'heavy-hit' | 'sword-array' | 'fireball';

const loops = new Set<Motion>(['Idle', 'Walk', 'Run', 'Jump_Loop', 'Fly_Loop', 'Nascent_Fly_Loop', 'Nascent_Hover_Loop', 'Nascent_Meditate_Loop', 'Nascent_Breakthrough_Burst', 'Pressure_Suppress_Loop', 'Swim_Idle_Loop', 'Swim_Fwd_Loop', 'Sword_Ready', 'Sword_Walk', 'Sword_Run']);
const upperBody = new Set<Motion>(['Idle', 'Walk', 'Run', 'Light_Draw', 'Light_Slash', 'Attack_Slash', 'Sword_Sheathe', 'Fireball_Cast']);
const gaitRates: Record<Gait, number> = { Idle: 1, Walk: .8, Run: 1.15 };
const slashContact = 10 / 30;
export const fireballRaiseTime = .43;
export const fireballHoldTime = .59;
export const fireballReleaseTime = .83;

function firstPose(name: Motion, clip: T.AnimationClip) {
    const tracks = clip.tracks.map(track => {
        const pose = track.clone();
        pose.times = new Float32Array([0]);
        pose.values = track.values.slice(0, track.getValueSize());
        return pose;
    });
    return new T.AnimationClip(name, 1, tracks);
}

function walkingClip(run: T.AnimationClip, name: Motion = 'Walk') {
    const walk = run.clone();
    walk.name = name;
    const pelvis = walk.tracks.find(track => track.name === 'pelvis.position');
    if (pelvis) {
        const height = pelvis.values[1];
        for (let i = 1; i < pelvis.values.length; i += 3)
            pelvis.values[i] = height + (pelvis.values[i] - height) * .45;
    }
    return walk;
}

function aimJoint(rotation: T.Quaternion, direction: T.Vector3) {
    const current = new T.Vector3(0, 1, 0).applyQuaternion(rotation);
    rotation.premultiply(new T.Quaternion().setFromUnitVectors(current, direction.normalize()));
}

function downwardSlash(scene: T.Group, sword: T.Object3D, source: T.AnimationClip) {
    const tip = sword.getObjectByName('SwordTip');
    if (!tip) throw new Error('Character.glb is missing SwordTip');
    const joints = (['upper_armR', 'Sleeve_ShoulderR', 'forearmR', 'Sleeve_ElbowR', 'handR'] as const).map(name => {
        const bone = scene.getObjectByName(name);
        if (!bone) throw new Error('Character.glb is missing slash joint ' + name);
        return bone;
    });
    const proportions = [.22, .22, .13, .13, .65];
    const mixer = new T.AnimationMixer(scene);
    const action = mixer.clipAction(source).setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const frames = Math.ceil(source.duration * 60);
    const times = Array.from({ length: frames + 1 }, (_, i) => i / frames * source.duration);
    const rotations = joints.map(() => [] as number[]);
    const up = new T.Vector3(0, 1, 0), axis = new T.Vector3(), grip = new T.Vector3(), blade = new T.Vector3();
    const localAxis = new T.Vector3(), parent = new T.Quaternion(), pitch = new T.Quaternion();
    for (const time of times) {
        mixer.setTime(time);
        const followThrough = .51 * T.MathUtils.smoothstep(time, .263, .358) * (1 - T.MathUtils.smoothstep(time, .438, .615));
        // Pitch through the cutting plane. The hand still owns the sword socket.
        sword.getWorldPosition(grip);
        tip.getWorldPosition(blade).sub(grip);
        axis.crossVectors(up, blade).normalize();
        joints.forEach((bone, index) => {
            if (followThrough && axis.lengthSq() > .9) {
                bone.parent!.getWorldQuaternion(parent).invert();
                localAxis.copy(axis).applyQuaternion(parent);
                bone.quaternion.premultiply(pitch.setFromAxisAngle(localAxis, followThrough * proportions[index]));
            }
            rotations[index].push(...bone.quaternion.toArray());
        });
    }
    mixer.stopAllAction();
    const tracks = joints.map((bone, i) => new T.QuaternionKeyframeTrack(bone.name + '.quaternion', times, rotations[i]));
    const replaced = new Set(tracks.map(track => track.name));
    return new T.AnimationClip(source.name, source.duration, [...source.tracks.filter(track => !replaced.has(track.name)), ...tracks]);
}

function poseArm(
    chest: T.Object3D,
    [shoulder, elbow, hand]: readonly [T.Object3D, T.Object3D, T.Object3D],
    wristOffset: T.Vector3,
    elbowGuide: T.Vector3,
    fingerDirection: T.Vector3,
    palmNormal: T.Vector3,
) {
    const start = shoulder.getWorldPosition(new T.Vector3());
    const towardWrist = chest.localToWorld(wristOffset.clone()).sub(start);
    const upperLength = elbow.position.length();
    const lowerLength = hand.position.length();
    const distance = T.MathUtils.clamp(towardWrist.length(), Math.abs(upperLength - lowerLength) + .00001,
        upperLength + lowerLength - .00001);
    const axis = towardWrist.normalize();
    const bend = chest.localToWorld(elbowGuide.clone()).sub(start);
    bend.addScaledVector(axis, -bend.dot(axis)).normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    const elbowTarget = start.clone().addScaledVector(axis, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    const wristTarget = start.addScaledVector(axis, distance);
    aimJoint(shoulder.quaternion, shoulder.parent!.worldToLocal(elbowTarget).sub(shoulder.position));
    aimJoint(elbow.quaternion, shoulder.worldToLocal(wristTarget).sub(elbow.position));

    // In this rig, +Y follows the fingers and +X faces the palm.
    const z = new T.Vector3().crossVectors(palmNormal, fingerDirection).normalize();
    const x = new T.Vector3().crossVectors(fingerDirection, z).normalize();
    const rotation = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, fingerDirection, z));
    const worldRotation = chest.getWorldQuaternion(new T.Quaternion()).multiply(rotation);
    hand.quaternion.copy(elbow.getWorldQuaternion(new T.Quaternion()).invert().multiply(worldRotation));
}

function flightGestureClips(scene: T.Group, sword: T.Object3D, mount: T.AnimationClip, loop: T.AnimationClip) {
    const joint = (name: string) => {
        const bone = scene.getObjectByName(name);
        if (!bone) throw new Error('Character.glb is missing flight joint ' + name);
        return bone;
    };
    const chest = joint('chest');
    const left = [joint('upper_armL'), joint('forearmL'), joint('handL')] as const;
    const right = [joint('upper_armR'), joint('forearmR'), joint('handR')] as const;
    const sleeveShoulder = joint('Sleeve_ShoulderR');
    const sleeveElbow = joint('Sleeve_ElbowR');
    const fingers = ['fingersL', 'fingersR', 'fingers_midR', 'fingers_tipR', 'thumbR', 'thumb_tipR'].map(joint);
    const fingerPose = fingers.map(finger => finger.quaternion.clone());
    fingerPose[2].slerp(new T.Quaternion(), .8);
    fingerPose[3].slerp(new T.Quaternion(), .8);
    aimJoint(fingerPose[4], new T.Vector3(.5, .8, .32));
    const joints = [...left, ...right, sleeveShoulder, sleeveElbow, ...fingers];
    const originalRotations = joints.map(() => new T.Quaternion());
    const swordWorld = new T.Matrix4();
    const swordLocal = new T.Matrix4();
    const socketInverse = new T.Matrix4();
    const leftWrist = new T.Vector3(.095, -.087, -.135);
    const leftElbow = new T.Vector3(.23, -.07, -.055);
    const leftFingersDirection = new T.Vector3(-.92, -.39, -.03).normalize();
    const leftPalm = new T.Vector3(0, .2, 1);
    const rightWrist = new T.Vector3(-.158, .024, .177);
    const rightElbow = new T.Vector3(-.24, -.16, .045);
    const rightFingersDirection = new T.Vector3(.19, .97, .12).normalize();
    const rightPalm = new T.Vector3(.8, 0, -.6);

    return [mount, loop].map(clip => {
        const sampler = new T.AnimationMixer(scene);
        const action = sampler.clipAction(clip).setLoop(T.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        const keyTimes = new Set([0, clip.duration]);
        for (const track of clip.tracks) {
            for (const time of track.times) keyTimes.add(time);
        }
        const times = [...keyTimes].sort((a, b) => a - b);
        const rotations = joints.map(() => [] as number[]);
        const swordPosition: number[] = [];
        const swordRotation: number[] = [];
        const swordScale: number[] = [];
        for (const time of times) {
            sampler.setTime(time);
            const amount = clip === mount ? T.MathUtils.smoothstep(time, .06, .34) : 1;
            sword.updateWorldMatrix(true, false);
            swordWorld.copy(sword.matrixWorld);
            swordLocal.copy(sword.matrix);
            joints.forEach((bone, index) => originalRotations[index].copy(bone.quaternion));
            if (amount > 0) {
                poseArm(chest, left, leftWrist, leftElbow, leftFingersDirection, leftPalm);
                poseArm(chest, right, rightWrist, rightElbow, rightFingersDirection, rightPalm);
                sleeveShoulder.quaternion.copy(right[0].quaternion);
                sleeveElbow.quaternion.copy(right[1].quaternion);
                fingers.forEach((finger, index) => finger.quaternion.copy(fingerPose[index]));
                joints.forEach((bone, index) => bone.quaternion.slerp(originalRotations[index], 1 - amount));
                // SwordMotion lives under the right palm. Keep the blade on its authored path.
                const socket = sword.parent!;
                socket.updateWorldMatrix(true, false);
                socketInverse.copy(socket.matrixWorld).invert().multiply(swordWorld)
                    .decompose(sword.position, sword.quaternion, sword.scale);
            }
            joints.forEach((bone, index) => rotations[index].push(...bone.quaternion.toArray()));
            swordPosition.push(...sword.position.toArray());
            swordRotation.push(...sword.quaternion.toArray());
            swordScale.push(...sword.scale.toArray());
            joints.forEach((bone, index) => bone.quaternion.copy(originalRotations[index]));
            swordLocal.decompose(sword.position, sword.quaternion, sword.scale);
        }
        sampler.stopAllAction();
        const replacements = [
            ...joints.map((bone, index) => new T.QuaternionKeyframeTrack(bone.name + '.quaternion', times, rotations[index])),
            new T.VectorKeyframeTrack(sword.name + '.position', times, swordPosition),
            new T.QuaternionKeyframeTrack(sword.name + '.quaternion', times, swordRotation),
            new T.VectorKeyframeTrack(sword.name + '.scale', times, swordScale),
        ];
        const names = new Set(replacements.map(track => track.name));
        return new T.AnimationClip(clip.name, clip.duration, [...clip.tracks.filter(track => !names.has(track.name)), ...replacements]);
    });
}

function downscaleTextureIfNeeded(texture: T.Texture, maxDim: number) {
    if (typeof document === 'undefined' || maxDim >= 4096) return;
    const img = texture.image as { width?: number; height?: number } & CanvasImageSource | undefined;
    if (!img || typeof img.width !== 'number' || typeof img.height !== 'number') return;
    const w = img.width, h = img.height;
    if (w <= maxDim && h <= maxDim) return;
    const scale = maxDim / Math.max(w, h);
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, nw, nh);
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
        img.close();
    }
    texture.image = canvas;
    texture.needsUpdate = true;
}

/**
 * Batch older exports that still have separate sword meshes for each part.
 */
function batchStaticSwordGrip(sword: T.Object3D) {
    const grip = sword.getObjectByName('AzureSword_Grip');
    if (!grip || grip.getObjectByName('AzureSword_Merged')) return;
    grip.updateWorldMatrix(true, true);
    const invGrip = grip.matrixWorld.clone().invert();
    const byMaterial = new Map<T.Material, T.BufferGeometry[]>();
    const originalGeometries = new Set<T.BufferGeometry>();

    grip.traverse(node => {
        if (node === grip || !(node instanceof T.Mesh) || node instanceof T.SkinnedMesh) return;
        const localMat = invGrip.clone().multiply(node.matrixWorld);
        const src = node.geometry;
        originalGeometries.add(src);
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        if (src.groups.length > 1 && mats.length > 1) {
            for (const grp of src.groups) {
                const mat = mats[grp.materialIndex ?? 0] ?? mats[0];
                const sub = src.index
                    ? (() => {
                        const g = new T.BufferGeometry();
                        for (const k of ['position', 'normal', 'uv'] as const) {
                            const attr = src.getAttribute(k);
                            if (attr) g.setAttribute(k, attr);
                        }
                        g.setIndex(new T.BufferAttribute(src.index.array.slice(grp.start, grp.start + grp.count), 1));
                        return g.toNonIndexed();
                    })()
                    : src.clone();
                sub.applyMatrix4(localMat);
                const keep: Record<string, T.BufferAttribute | T.InterleavedBufferAttribute> = {};
                for (const k of ['position', 'normal']) if (sub.attributes[k]) keep[k] = sub.attributes[k];
                const clean = new T.BufferGeometry();
                for (const [k, a] of Object.entries(keep)) clean.setAttribute(k, a);
                const list = byMaterial.get(mat) ?? [];
                list.push(clean);
                byMaterial.set(mat, list);
            }
        } else {
            const mat = mats[0];
            const indexed = src.index ? src.toNonIndexed() : src.clone();
            indexed.applyMatrix4(localMat);
            const clean = new T.BufferGeometry();
            for (const k of ['position', 'normal']) {
                if (indexed.attributes[k]) clean.setAttribute(k, indexed.attributes[k]);
            }
            const list = byMaterial.get(mat) ?? [];
            list.push(clean);
            byMaterial.set(mat, list);
        }
    });

    if (!byMaterial.size) return;
    for (const child of [...grip.children]) grip.remove(child);
    for (const geo of originalGeometries) geo.dispose();

    let idx = 0;
    for (const [mat, parts] of byMaterial) {
        const merged = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        if (!merged) continue;
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const mesh = new T.Mesh(merged, mat);
        mesh.name = `AzureSword_Merged_${idx++}`;
        mesh.castShadow = true;
        grip.add(mesh);
    }
}

export class Avatar extends T.Group {
    private model?: T.Group;
    private mixer?: T.AnimationMixer;
    private actions = new Map<Motion, T.AnimationAction>();
    private gaits = new Map<Gait, T.AnimationAction>();
    private gaitAction?: T.AnimationAction;
    private groundGait: Gait = 'Idle';
    private action?: T.AnimationAction;
    private motion?: Motion;
    private queuedAttack?: Attack;
    private queuedSkill = false;
    private attack?: Attack;
    private readyTime = 0;
    private disposed = false;
    private pendingGiantSwordClip?: T.AnimationClip;
    private pendingNascentClips: T.AnimationClip[] = [];
    swordDrawn = false;
    swordMotion?: T.Object3D;
    fireballHead?: T.Object3D;

    installGiantSwordClip({ animations }: GLTF) {
        if (this.disposed) return;
        const source = T.AnimationClip.findByName(animations, 'Skill_GiantSword') ?? animations[0];
        if (!source) return;
        const clip = source.clone();
        clip.name = 'Skill_GiantSword';
        if (this.mixer) {
            this.actions.set('Skill_GiantSword', this.mixer.clipAction(clip));
        } else {
            this.pendingGiantSwordClip = clip;
        }
    }

    installNascentFlightClips({ animations }: GLTF) {
        if (this.disposed) return;
        for (const name of ['Nascent_Fly_Loop', 'Nascent_Hover_Loop'] as const) {
            const source = T.AnimationClip.findByName(animations, name);
            if (!source) continue;
            const clip = source.clone();
            clip.name = name;
            if (this.mixer) {
                this.actions.set(name, this.mixer.clipAction(clip));
            } else {
                this.pendingNascentClips.push(clip);
            }
        }
    }

    installBreakthroughClips({ animations }: GLTF) {
        if (this.disposed) return;
        for (const name of ['Nascent_Meditate_Loop', 'Nascent_Breakthrough_Burst'] as const) {
            const source = T.AnimationClip.findByName(animations, name);
            if (!source) continue;
            const clip = source.clone();
            clip.name = name;
            if (this.mixer) {
                this.actions.set(name, this.mixer.clipAction(clip));
            } else {
                this.pendingNascentClips.push(clip);
            }
        }
    }

    installPressureClip({ animations }: GLTF) {
        if (this.disposed) return;
        const source = T.AnimationClip.findByName(animations, 'Pressure_Suppress_Loop') ?? animations[0];
        if (!source) return;
        const clip = source.clone();
        clip.name = 'Pressure_Suppress_Loop';
        if (this.mixer) {
            this.actions.set('Pressure_Suppress_Loop', this.mixer.clipAction(clip));
        } else {
            this.pendingNascentClips.push(clip);
        }
    }

    install({ scene, animations }: GLTF) {
        if (this.disposed) {
            this.releaseModel(scene);
            return;
        }

        const clip = (name: Motion) => {
            const found = T.AnimationClip.findByName(animations, name);
            if (!found) throw new Error('Character.glb is missing animation ' + name);
            return found;
        };
        const sword = scene.getObjectByName('SwordMotion');
        if (!sword) throw new Error('Character.glb is missing SwordMotion');
        const pelvis = scene.getObjectByName('pelvis');
        if (!pelvis) throw new Error('Character.glb is missing pelvis');

        this.model = scene;
        this.swordMotion = sword;
        batchStaticSwordGrip(sword);
        const maxTex = detectDevice().maxTextureSizeCap;
        if (maxTex < 4096) {
            const seenTex = new Set<T.Texture>();
            scene.traverse(obj => {
                if (!(obj instanceof T.Mesh)) return;
                for (const mat of [obj.material].flat()) {
                    for (const val of Object.values(mat)) {
                        if (val instanceof T.Texture && !seenTex.has(val)) {
                            seenTex.add(val);
                            downscaleTextureIfNeeded(val, maxTex);
                        }
                    }
                }
            });
        }
        this.mixer = new T.AnimationMixer(scene);
        const authored: Motion[] = [
            'Jump_Start', 'Jump_Loop', 'Jump_Land',
            'Swim_Idle_Loop', 'Swim_Fwd_Loop',
            'Sword_Draw', 'Skill_DrawAndRaise', 'Skill_RaiseSword',
        ];
        // The ground action owns the pelvis, legs and robes. Sword draw and slash
        // keep their authored spine, arms, fingers and blade tracks on top.
        const lowerBones = new Set([pelvis.name, pelvis.parent!.name]);
        for (const child of pelvis.children) {
            if (child.name !== 'spine') child.traverse(bone => lowerBones.add(bone.name));
        }
        const lowerTrack = (track: T.KeyframeTrack) => lowerBones.has(track.name.slice(0, track.name.lastIndexOf('.')));
        const upper = (name: Motion, source: T.AnimationClip) => new T.AnimationClip(name, source.duration,
            source.tracks.filter(track => !lowerTrack(track)));
        const groundClips = [firstPose('Idle', clip('Sword_Draw')), walkingClip(clip('Run')), clip('Run')];
        const swordRun = clip('Sword_Run');
        const swordWalk = walkingClip(swordRun, 'Sword_Walk');
        const fireball = upper('Fireball_Cast', clip('Fireball_Cast'));
        this.fireballHead = scene.getObjectByName('head');
        const slash = downwardSlash(scene, sword, clip('Attack_Slash'));
        for (const source of groundClips) {
            const gait = new T.AnimationClip(`${source.name}_Legs`, source.duration, source.tracks.filter(lowerTrack));
            this.gaits.set(source.name as Gait, this.mixer.clipAction(gait));
        }
        const library = [
            ...authored.map(clip),
            upper('Attack_Slash', slash),
            ...flightGestureClips(scene, sword, clip('Fly_Mount'), clip('Fly_Loop')),
            ...groundClips.map(source => upper(source.name as Gait, source)),
            upper('Light_Draw', clip('Sword_Draw')),
            upper('Light_Slash', slash),
            clip('Sword_Ready'),
            swordWalk,
            swordRun,
            upper('Sword_Sheathe', clip('Sword_Sheathe')),
            fireball,
        ];
        for (const animation of library)
            this.actions.set(animation.name as Motion, this.mixer.clipAction(animation));
        if (this.pendingGiantSwordClip) {
            this.actions.set('Skill_GiantSword', this.mixer.clipAction(this.pendingGiantSwordClip));
            this.pendingGiantSwordClip = undefined;
        }
        if (this.pendingNascentClips.length) {
            for (const clip of this.pendingNascentClips) {
                this.actions.set(clip.name as Motion, this.mixer.clipAction(clip));
            }
            this.pendingNascentClips.length = 0;
        }

        scene.scale.setScalar(1.7);
        scene.traverse(object => {
            if (object instanceof T.Mesh) object.castShadow = true;
            if (object instanceof T.SkinnedMesh) object.frustumCulled = false;
        });
        this.add(scene);
        this.reset(false);
    }

    get mounting() { return this.motion === 'Fly_Mount'; }
    get riding() { return this.motion === 'Fly_Loop'; }
    get casting() { return this.motion === 'Skill_DrawAndRaise' || this.motion === 'Skill_RaiseSword'; }
    get giantSwordCasting() { return this.motion === 'Skill_GiantSword'; }
    get giantSwordTime() { return this.motion === 'Skill_GiantSword' ? this.action?.time : undefined; }
    get raisingSwordTime() { return this.motion === 'Skill_RaiseSword' ? this.action?.time : undefined; }
    get fireballTime() { return this.motion === 'Fireball_Cast' ? this.action!.time : undefined; }
    get lightAttacking() { return this.motion === 'Light_Slash' || (this.motion === 'Light_Draw' && this.attack === 'light'); }
    get heavyAttacking() { return this.motion === 'Attack_Slash' || (this.motion === 'Light_Draw' && this.attack === 'heavy'); }
    get heavyQueued() { return this.queuedAttack === 'heavy'; }
    get movementLocked() { return this.casting || this.giantSwordCasting || this.fireballTime !== undefined || this.queuedSkill || this.motion === 'Sword_Draw'; }
    get actionLocked() { return this.movementLocked || this.lightAttacking || this.heavyAttacking; }

    reset(flying: boolean, voidMode = false) {
        if (this.model) this.model.visible = true;
        if (this.swordMotion) this.swordMotion.visible = !(flying && voidMode);
        this.mixer?.stopAllAction();
        this.action = undefined;
        this.motion = undefined;
        this.gaitAction = undefined;
        this.groundGait = 'Idle';
        this.swordDrawn = false;
        this.clearCombat();
        this.play(flying && !voidMode ? 'Fly_Loop' : 'Idle', 0);
        this.mixer?.update(0);
    }

    mount() {
        this.swordDrawn = false;
        this.clearCombat();
        this.play('Fly_Mount');
    }

    enterVoidFlight() {
        this.swordDrawn = false;
        this.clearCombat();
        const target: Motion = this.actions.has('Nascent_Hover_Loop') ? 'Nascent_Hover_Loop' : 'Idle';
        this.play(target, .16);
    }

    private isSwordLocomotion() {
        return this.motion === 'Sword_Ready' || this.motion === 'Sword_Walk' || this.motion === 'Sword_Run';
    }

    private swordGait(): { motion: Motion; rate: number } {
        if (this.groundGait === 'Run') return { motion: 'Sword_Run', rate: gaitRates.Run };
        if (this.groundGait === 'Walk') return { motion: 'Sword_Walk', rate: gaitRates.Walk };
        return { motion: 'Sword_Ready', rate: 1 };
    }

    toggleSword() {
        if (this.casting || this.giantSwordCasting || this.fireballTime !== undefined) return;
        this.queuedAttack = undefined;
        this.attack = undefined;
        if (this.swordDrawn) {
            this.swordDrawn = false;
            if (this.isSwordLocomotion() || this.motion === 'Light_Draw' || this.motion === 'Light_Slash' || this.motion === 'Attack_Slash') {
                this.play('Sword_Sheathe', .08, 1.6);
            }
        } else {
            this.swordDrawn = true;
            if (!this.isSwordLocomotion() && this.motion !== 'Light_Draw') {
                this.play('Light_Draw', .08, 2.0);
            }
        }
    }

    requestAttack(attack: Attack) {
        this.queuedAttack = attack;
    }

    requestSkill() {
        if (this.casting) return;
        this.queuedSkill = true;
        this.queuedAttack = undefined;
    }

    requestFireball() {
        if (this.motion !== 'Idle' && this.motion !== 'Walk' && this.motion !== 'Run' && !this.isSwordLocomotion()) return false;
        this.swordDrawn = false;
        this.clearCombat();
        this.play('Fireball_Cast', .1);
        return true;
    }

    requestGiantSword() {
        if (!this.actions.has('Skill_GiantSword')) return false;
        if (this.motion !== 'Idle' && this.motion !== 'Walk' && this.motion !== 'Run' && !this.isSwordLocomotion()) return false;
        this.swordDrawn = false;
        this.clearCombat();
        this.play('Skill_GiantSword', .12, giantSwordAnimRate);
        return true;
    }

    cancelGiantSword() {
        if (this.motion === 'Skill_GiantSword') this.play(this.groundGait, .18, gaitRates[this.groundGait]);
    }

    cancelFireball() {
        if (this.motion === 'Fireball_Cast') this.play(this.groundGait, .15, gaitRates[this.groundGait]);
    }

    private clearCombat() {
        this.queuedAttack = undefined;
        this.queuedSkill = false;
        this.attack = undefined;
        this.readyTime = 0;
    }

    private play(motion: Motion, fade = .12, rate = 1) {
        const next = this.actions.get(motion);
        if (!next) return;
        const outgoing = this.action;
        next.reset().setEffectiveWeight(1).setEffectiveTimeScale(rate);
        next.setLoop(loops.has(motion) ? T.LoopRepeat : T.LoopOnce, loops.has(motion) ? Infinity : 1);
        next.clampWhenFinished = true;
        if (upperBody.has(motion)) {
            this.playGait(fade);
            if (motion === this.groundGait && this.gaitAction) next.time = this.gaitAction.time;
        } else if (this.gaitAction) {
            if (fade) this.gaitAction.fadeOut(fade);
            else this.gaitAction.stop();
            this.gaitAction = undefined;
        }
        next.play();
        if (fade && outgoing && outgoing !== next)
            next.crossFadeFrom(outgoing, fade, false);
        this.action = next;
        this.motion = motion;
    }

    private playGait(fade: number) {
        const next = this.gaits.get(this.groundGait);
        const previous = this.gaitAction;
        if (!next || previous === next) return;
        next.reset().setEffectiveWeight(1).setEffectiveTimeScale(gaitRates[this.groundGait]);
        next.setLoop(T.LoopRepeat, Infinity).play();
        if (previous) {
            if (this.groundGait !== 'Idle')
                next.time = previous.time / previous.getClip().duration * next.getClip().duration;
            next.crossFadeFrom(previous, fade, false);
        } else if (fade && this.action) next.fadeIn(fade);
        this.gaitAction = next;
    }

    private slash(attack: Attack) {
        this.attack = attack;
        this.play(attack === 'heavy' ? 'Attack_Slash' : 'Light_Slash', .08, attack === 'heavy' ? 1.15 : 1.3);
    }

    private raiseSword(holdingSword: boolean) {
        this.attack = undefined;
        if (holdingSword) {
            this.queuedSkill = false;
            this.play('Skill_RaiseSword', .1);
            return;
        }
        // Reuse the newly fixed Sword_Draw before transitioning into Skill_RaiseSword.
        this.play('Sword_Draw', .08, 1.55);
    }

    private readySword() {
        this.readyTime = .45;
        const { motion, rate } = this.swordGait();
        this.play(motion, .1, rate);
    }

    update(
        dt: number,
        flying: boolean,
        grounded: boolean,
        jumped: boolean,
        speed: number,
        running: boolean,
        chargingFireball = false,
        swimming = false,
        voidMode = false,
        skyWalking = false,
        hideBody = false,
        ritualPose: 'none' | 'meditate' | 'burst' | 'pressure' = 'none',
    ): ActionCue | undefined {
        if (this.model) this.model.visible = !hideBody;
        if (!this.mixer) return;
        const inRitual = ritualPose !== 'none';
        const hideSword = inRitual || (flying && voidMode && (!skyWalking || (!this.swordDrawn && !this.casting && !this.giantSwordCasting && !this.lightAttacking && !this.heavyAttacking && this.motion !== 'Sword_Draw' && this.motion !== 'Sword_Sheathe')));
        if (this.swordMotion) this.swordMotion.visible = !hideSword;
        this.groundGait = speed < .25 ? 'Idle' : running ? 'Run' : 'Walk';
        if (this.motion && upperBody.has(this.motion)) this.playGait(.13);
        const before = this.action?.time ?? 0;
        this.mixer.update(chargingFireball && this.motion === 'Fireball_Cast'
            ? Math.min(dt, Math.max(0, fireballHoldTime - before)) : dt);
        const time = this.action?.time ?? 0;
        const finished = this.action?.paused;

        if (inRitual) {
            this.swordDrawn = false;
            this.clearCombat();
            const want: Motion = ritualPose === 'pressure'
                ? (this.actions.has('Pressure_Suppress_Loop') ? 'Pressure_Suppress_Loop' : 'Idle')
                : ritualPose === 'meditate'
                    ? (this.actions.has('Nascent_Meditate_Loop') ? 'Nascent_Meditate_Loop' : 'Idle')
                    : (this.actions.has('Nascent_Breakthrough_Burst') ? 'Nascent_Breakthrough_Burst' : 'Nascent_Hover_Loop');
            if (this.motion !== want) this.play(want, ritualPose === 'pressure' ? .16 : .36);
            return;
        }

        if (flying && !voidMode) {
            if (this.mounting && finished) this.play('Fly_Loop', .08);
            return;
        }
        if (flying && voidMode && !skyWalking) {
            this.swordDrawn = false;
            this.clearCombat();
            const wantFly = speed > 2.2;
            const target: Motion = wantFly
                ? (this.actions.has('Nascent_Fly_Loop') ? 'Nascent_Fly_Loop' : 'Idle')
                : (this.actions.has('Nascent_Hover_Loop') ? 'Nascent_Hover_Loop' : 'Idle');
            if (this.motion !== target) this.play(target, .24);
            return;
        }
        if (swimming) {
            this.swordDrawn = false;
            this.clearCombat();
            const target: Motion = speed > .35 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop';
            const rate = target === 'Swim_Fwd_Loop' ? (running ? 1.25 : 1) : 1;
            if (this.motion !== target) this.play(target, .22, rate);
            else this.action?.setEffectiveTimeScale(rate);
            return;
        }
        const effectiveGrounded = grounded || (flying && voidMode && skyWalking);
        if (!effectiveGrounded) {
            this.clearCombat();
            if (jumped) this.play('Jump_Start', .08, 1.8);
            else if (this.motion !== 'Jump_Loop' && (this.motion !== 'Jump_Start' || finished))
                this.play('Jump_Loop');
            return;
        }
        if (this.motion === 'Fireball_Cast') {
            if (finished) this.play(this.groundGait, .12, gaitRates[this.groundGait]);
            if (before < fireballReleaseTime && time >= fireballReleaseTime) return 'fireball';
            return;
        }
        if (this.motion === 'Skill_GiantSword') {
            if (finished || time >= giantSwordCastEnd) this.play(this.groundGait, .18, gaitRates[this.groundGait]);
            return;
        }
        if (this.casting) {
            const raiseTime = this.motion === 'Skill_DrawAndRaise' ? 46 / 30 : 17 / 30;
            if (finished) this.readySword();
            if (before < raiseTime && time >= raiseTime) return 'sword-array';
            return;
        }
        if (this.motion === 'Jump_Start' || this.motion === 'Jump_Loop') {
            this.play('Jump_Land', .1, 1.5);
            return;
        }

        if (this.motion === 'Sword_Draw' || this.motion === 'Light_Draw') {
            if (finished) {
                if (this.queuedSkill) this.raiseSword(true);
                else if (this.attack) this.slash(this.attack);
                else if (this.swordDrawn) this.readySword();
                else this.play(this.groundGait, .12, gaitRates[this.groundGait]);
            }
            return;
        }
        const slashing = this.motion === 'Attack_Slash' || this.motion === 'Light_Slash';
        const swordHit = slashing && this.attack && before < slashContact && time >= slashContact
            ? (this.attack === 'heavy' ? 'heavy-hit' : 'light-hit') : undefined;
        if (slashing && !finished) return swordHit;
        if (this.motion === 'Sword_Sheathe' && !finished && (time > .18 || !this.queuedAttack)) return;
        if (this.queuedSkill) {
            this.raiseSword(slashing || this.isSwordLocomotion());
            return swordHit;
        }
        if ((slashing || this.isSwordLocomotion() || (this.motion === 'Sword_Sheathe' && !finished)) && this.queuedAttack) {
            this.slash(this.queuedAttack);
            this.queuedAttack = undefined;
            return swordHit;
        }
        if (slashing) {
            this.readySword();
            return swordHit;
        }
        if (this.isSwordLocomotion()) {
            if (!this.swordDrawn) {
                this.readyTime -= dt;
                if (this.readyTime <= 0) {
                    this.play('Sword_Sheathe', .08, 1.6);
                    return;
                }
            }
            const { motion, rate } = this.swordGait();
            if (this.motion !== motion) this.play(motion, .12, rate);
            return;
        }
        if (this.queuedAttack) {
            this.attack = this.queuedAttack;
            this.queuedAttack = undefined;
            this.play('Light_Draw', .08, this.attack === 'heavy' ? 2.1 : 2.25);
            return;
        }
        if (this.motion === 'Jump_Land' && !finished) return;
        if (this.swordDrawn) {
            this.readySword();
            return;
        }

        if (this.motion !== this.groundGait)
            this.play(this.groundGait, .15, gaitRates[this.groundGait]);
    }

    private releaseModel(scene: T.Group) {
        const geometries = new Set<T.BufferGeometry>();
        const materials = new Set<T.Material>();
        const textures = new Set<T.Texture>();
        scene.traverse(object => {
            if (!(object instanceof T.Mesh)) return;
            geometries.add(object.geometry);
            for (const material of [object.material].flat()) materials.add(material);
            if (object instanceof T.SkinnedMesh) object.skeleton.dispose();
        });
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if (value instanceof T.Texture) textures.add(value);
            }
            material.dispose();
        }
        for (const geometry of geometries) geometry.dispose();
        for (const texture of textures) {
            texture.dispose();
            if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap)
                texture.image.close();
        }
        scene.removeFromParent();
    }

    dispose() {
        this.disposed = true;
        this.mixer?.stopAllAction();
        if (this.model) {
            this.mixer?.uncacheRoot(this.model);
            this.releaseModel(this.model);
        }
        this.removeFromParent();
    }
}
