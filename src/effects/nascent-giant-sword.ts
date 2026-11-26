import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { traceFireballWorld, type SampleGround } from './fireball-trajectory';

const modelUrl = new URL('../../resource/skill/giant-sword/Nascent_GiantSword.glb', import.meta.url).href;

const fps = 30;
const releaseTime = (104 - 1) / fps;
const sonicTime = (109 - 1) / fps;
const impactTime = (130 - 1) / fps;
const gravity = 43;
const sonicSpeed = 5.2;
const topSpeed = 82;
const embedDepth = .24;
const up = new T.Vector3(0, 1, 0);

interface Layer {
    root: T.Object3D;
    mixer: T.AnimationMixer;
    fades: T.Material[];
}

interface FlightPath {
    sword: T.Mesh;
    departure: number;
    arrival: number;
    position: T.LinearInterpolant;
}

interface Summon {
    layer: Layer;
    sword: T.Object3D;
    mount: T.Group;
    paths: FlightPath[];
    batch: T.InstancedMesh;
    landing: T.Vector3;
    offset: T.Vector3;
    anchor: T.Vector3;
    offsetVelocity: T.Vector3;
    previousTime: number;
    trackLanding?: () => T.Vector3 | undefined;
}

interface Fall {
    sword: T.Object3D;
    tip: T.Object3D;
    speed: number;
    sonic: boolean;
    casterHeight: number;
    directY?: number;
}

interface EventEffect {
    layer: Layer;
    start: number;
    duration: number;
    age: number;
    sword?: T.Object3D;
    height?: number;
}

function section(root: T.Object3D, animation: T.AnimationClip): Layer {
    const names = new Set<string>();
    const copies = new Map<T.Material, T.Material>();
    root.traverse(node => {
        names.add(node.name);
        if (!(node instanceof T.Mesh)) return;
        const clone = (mat: T.Material) => {
            if (!Array.isArray(mat.userData.opacityFrames)) return mat;
            if (!copies.has(mat)) {
                const copy = mat.clone();
                const tint = mat.userData.pulseTint as number[] | undefined;
                if (copy instanceof T.MeshStandardMaterial && tint) copy.color.setRGB(tint[0], tint[1], tint[2]);
                copies.set(mat, copy);
            }
            return copies.get(mat)!;
        };
        node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
    });
    const tracks = animation.tracks.filter(track => names.has(T.PropertyBinding.parseTrackName(track.name).nodeName));
    const mixer = new T.AnimationMixer(root);
    const action = mixer.clipAction(new T.AnimationClip(animation.name, animation.duration, tracks));
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    return { root, mixer, fades: [...copies.values()] };
}

function sample(layer: Layer, time: number) {
    layer.mixer.setTime(time);
    const samplePos = Math.max(0, time * fps);
    for (const mat of layer.fades) {
        const frames = mat.userData.opacityFrames as number[];
        const i = Math.min(Math.floor(samplePos), frames.length - 1);
        const j = Math.min(i + 1, frames.length - 1);
        mat.opacity = T.MathUtils.lerp(frames[i], frames[j], samplePos - i);
    }
}

function removeLayer(layer: Layer) {
    layer.mixer.stopAllAction();
    layer.mixer.uncacheRoot(layer.root);
    layer.root.removeFromParent();
    for (const material of layer.fades) material.dispose();
}

function lookup(root: T.Object3D, name: string) {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`Nascent Giant Sword GLB is missing ${name}`);
    return node;
}

function terrainNormal(point: T.Vector3, sampleGround: SampleGround) {
    const d = .32;
    const height = (x: number, z: number) => sampleGround(x, z, point.y + 1.2).height;
    const west = height(point.x - d, point.z), east = height(point.x + d, point.z);
    const north = height(point.x, point.z - d), south = height(point.x, point.z + d);
    if ([west, east, north, south].some(y => !Number.isFinite(y) || Math.abs(y - point.y) > .85)) return up;
    return new T.Vector3(west - east, 2 * d, north - south).normalize();
}

export class NascentGiantSword {
    private asset?: GLTF;
    private disposed = false;
    private summon?: Summon;
    private released = false;
    private readonly falls = new Set<Fall>();
    private readonly effects = new Set<EventEffect>();
    private readonly from = new T.Vector3();
    private readonly to = new T.Vector3();
    private readonly contact = new T.Vector3();
    private readonly frameCenter = new T.Vector3();
    private readonly direction = new T.Vector3();
    private readonly tangent = new T.Vector3();
    private readonly faceAlongPath = new T.Quaternion();
    private readonly flightRotation = new T.Quaternion();
    private readonly flightPosition = new T.Vector3();
    private readonly flightMatrix = new T.Matrix4();
    private frameWeight = 0;

    constructor(
        private readonly scene: T.Scene,
        private readonly sampleGround: SampleGround,
        private readonly traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
        private readonly blast: (point: T.Vector3, directHit: boolean) => void,
        private readonly splashRadius: number,
    ) {}

    get framing() {
        const framing = { radius: 12, fullWeightWithin: 12, fadeBeyond: 32 };
        if (this.summon && this.frameWeight > 0) {
            this.summon.sword.getWorldPosition(this.frameCenter);
            return { ...framing, center: this.frameCenter, weight: this.frameWeight };
        }
        const fall = this.falls.values().next().value;
        if (fall) {
            const weight = .65 + .35 * T.MathUtils.smoothstep(fall.sword.position.y - fall.casterHeight, 7, 17);
            return { ...framing, center: fall.sword.position, weight };
        }
        for (const fx of this.effects) {
            if (fx.sword && fx.age < .72) {
                const weight = .65 * (1 - T.MathUtils.smoothstep(fx.age, .13, .72));
                return { ...framing, center: fx.sword.position, weight };
            }
        }
    }

    async load(loader: GLTFLoader) {
        const asset = await loader.loadAsync(modelUrl);
        if (this.disposed) {
            this.disposeAsset(asset);
            return;
        }
        this.asset = asset;
    }

    private makeSummon(position: T.Vector3, heading: number, landing: T.Vector3, trackLanding?: () => T.Vector3 | undefined) {
        const asset = this.asset!;
        const root = asset.scene.clone(true);
        root.name = 'Nascent_GiantSword_Cast';
        lookup(root, 'Ground_Impact').removeFromParent();
        lookup(root, 'Air_SonicBurst').removeFromParent();
        const flight = lookup(root, 'FlyingSwords');
        const sources = flight.children.filter((node): node is T.Mesh => node instanceof T.Mesh);
        // The copies share one material and geometry. Keep their transforms as animation targets.
        const batch = new T.InstancedMesh(sources[0].geometry, sources[0].material, sources.length);
        batch.name = 'Nascent_FlyingSwords_Batch';
        batch.count = 0;
        batch.frustumCulled = false;
        batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
        const clip = asset.animations[0];
        const tracks = new Map(clip.tracks.map(track => [track.name, track]));
        const paths = sources.map(sword => {
            sword.visible = false;
            const track = tracks.get(`${sword.name}.position`);
            if (!track) throw new Error(`Nascent Giant Sword GLB is missing ${sword.name} flight keys`);
            return {
                sword,
                departure: (Number(sword.userData.departure_frame) - 1) / fps,
                arrival: (Number(sword.userData.arrival_frame) - 1) / fps,
                position: new T.LinearInterpolant(track.times, track.values, 3, new Float32Array(3)),
            };
        });
        flight.add(batch);
        root.position.copy(position);
        root.rotation.y = -heading;
        this.scene.add(root);
        const sword = lookup(root, 'GiantSword');
        const mount = new T.Group();
        sword.parent!.add(mount);
        mount.add(sword);
        const localLanding = root.worldToLocal(landing.clone());
        const anchor = new T.Vector3(sword.position.x, 0, sword.position.z);
        const offset = new T.Vector3(localLanding.x - anchor.x, Math.max(0, localLanding.y), localLanding.z - anchor.z);
        return { layer: section(root, clip), sword, mount, paths, batch, landing: localLanding, offset, anchor,
            offsetVelocity: new T.Vector3(), previousTime: 0, trackLanding };
    }

    updateCast(clipTime: number | undefined, position: T.Vector3, heading: number, launchTime: number, aim: () => T.Vector3, trackLanding?: () => T.Vector3 | undefined) {
        if (clipTime === undefined) {
            this.cancelCast();
            return;
        }
        if (!this.asset || this.released) return;
        if (!this.summon) {
            const locked = trackLanding?.();
            this.summon = this.makeSummon(position, heading, locked ?? aim(), locked ? trackLanding : undefined);
        }
        const cast = this.summon;
        this.frameWeight = T.MathUtils.smoothstep(clipTime, .08, .48);
        const time = Math.min(1, clipTime / launchTime) * releaseTime;
        sample(cast.layer, time);
        cast.offsetVelocity.set(0, 0, 0);
        const tracking = cast.trackLanding?.();
        if (tracking) {
            cast.layer.root.worldToLocal(cast.landing.copy(tracking));
            const previous = this.direction.copy(cast.offset);
            cast.offset.set(cast.landing.x - cast.anchor.x, Math.max(0, cast.landing.y), cast.landing.z - cast.anchor.z);
            const elapsed = time - cast.previousTime;
            if (elapsed > 1e-5) cast.offsetVelocity.subVectors(cast.offset, previous).multiplyScalar(1 / elapsed);
        }
        cast.previousTime = time;
        // Keep world placement on a parent so the mixer exclusively owns the animated transforms.
        cast.mount.position.set(cast.landing.x - cast.sword.position.x, cast.offset.y,
            cast.landing.z - cast.sword.position.z);
        if (clipTime >= launchTime) {
            const sword = cast.sword.clone(true);
            cast.sword.getWorldPosition(sword.position);
            cast.sword.getWorldQuaternion(sword.quaternion);
            cast.sword.getWorldScale(sword.scale);
            const axis = up.clone().applyQuaternion(sword.quaternion);
            sword.quaternion.premultiply(new T.Quaternion().setFromUnitVectors(axis, up));
            sword.name = 'Nascent_GiantSword_Falling';
            this.scene.add(sword);
            this.falls.add({ sword, tip: lookup(sword, 'NascentSwordTip'), speed: 0, sonic: false,
                casterHeight: cast.layer.root.position.y });
            this.released = true;
            this.removeSummon();
            return;
        }
        let count = 0;
        for (const path of cast.paths) {
            const sword = path.sword;
            if (sword.scale.x < .001) continue;
            const progress = T.MathUtils.smootherstep(time, path.departure, path.arrival);
            this.flightPosition.copy(sword.position).addScaledVector(cast.offset, progress);
            this.flightRotation.copy(sword.quaternion);
            if (time > path.departure && time < path.arrival) {
                // The added displacement is zero at takeoff and reaches the full offset at assembly.
                // Use the resulting tangent to bank the sword without changing the authored roll.
                const before = time - 1 / 120, after = time + 1 / 120;
                this.tangent.fromArray(path.position.evaluate(before)).negate();
                this.tangent.add(this.direction.fromArray(path.position.evaluate(after)));
                const offsetDelta = T.MathUtils.smootherstep(after, path.departure, path.arrival)
                    - T.MathUtils.smootherstep(before, path.departure, path.arrival);
                this.tangent.addScaledVector(cast.offset, offsetDelta)
                    .addScaledVector(cast.offsetVelocity, progress * (after - before));
                if (this.tangent.lengthSq() > 1e-8) {
                    this.direction.copy(up).applyQuaternion(sword.quaternion);
                    this.flightRotation.premultiply(this.faceAlongPath.setFromUnitVectors(this.direction, this.tangent.normalize()));
                }
            }
            cast.batch.setMatrixAt(count++, this.flightMatrix.compose(this.flightPosition, this.flightRotation, sword.scale));
        }
        cast.batch.count = count;
        cast.batch.instanceMatrix.needsUpdate = true;
    }

    update(dt: number) {
        if (dt <= 0) return;
        for (const fx of this.effects) {
            fx.age += dt;
            if (fx.age >= fx.duration) {
                this.removeEffect(fx);
                continue;
            }
            sample(fx.layer, fx.start + fx.age);
            if (fx.sword && fx.height !== undefined) {
                const drive = Math.min(1, fx.age / .10);
                fx.sword.position.y = fx.height - embedDepth * fx.sword.scale.y * (1 - (1 - drive) ** 3);
            }
        }
        for (const fall of this.falls) {
            fall.tip.getWorldPosition(this.from);
            const faster = Math.min(topSpeed, fall.speed + gravity * dt);
            this.to.copy(this.from);
            this.to.y -= (fall.speed + faster) * dt * .5;
            // The falling blade exists until the swept tip reaches world geometry.
            const hit = traceFireballWorld(this.from, this.to, this.sampleGround);
            if (!fall.sonic && faster >= sonicSpeed) {
                const t = T.MathUtils.clamp((sonicSpeed - fall.speed) / Math.max(.0001, faster - fall.speed), 0, 1);
                if (!hit || t < hit.t) {
                    this.contact.lerpVectors(this.from, this.to, t);
                    this.contact.y += .91 * fall.sword.scale.y;
                    this.spawn('Air_SonicBurst', this.contact, sonicTime, .34);
                    fall.sonic = true;
                }
            }
            if (hit) this.to.lerpVectors(this.from, this.to, hit.t);
            const creatureT = this.traceCreature(this.from, this.to);
            if (creatureT !== undefined) fall.directY = T.MathUtils.lerp(this.from.y, this.to.y, creatureT);
            if (!hit) {
                fall.sword.position.y += this.to.y - this.from.y;
                fall.speed = faster;
                continue;
            }
            if (hit.ground) this.to.y = hit.ground.height;
            fall.sword.position.y += this.to.y - this.from.y;
            this.blast(this.to, fall.directY !== undefined && Math.abs(fall.directY - this.to.y) <= 2.8);
            const fx = this.spawn('Ground_Impact', this.to, impactTime, 1.04);
            if (hit.ground) {
                fx.layer.root.quaternion.setFromUnitVectors(up, terrainNormal(this.to, this.sampleGround));
            }
            const solidGround = hit.ground && hit.ground.kind !== 'water';
            lookup(fx.layer.root, 'Surface_Fractures').visible = Boolean(solidGround);
            lookup(fx.layer.root, 'Ground_Shockwave').visible = Boolean(hit.ground);
            const rim = lookup(fx.layer.root, 'Ground_Shockwave');
            rim.scale.set(this.splashRadius / 3.55, 1, this.splashRadius / 3.55);
            if (solidGround) {
                fx.sword = fall.sword;
                fx.height = fall.sword.position.y;
            } else {
                fall.sword.removeFromParent();
            }
            this.falls.delete(fall);
        }
    }

    private spawn(name: string, position: T.Vector3, start: number, duration: number) {
        const asset = this.asset!;
        const root = lookup(asset.scene, name).clone(true);
        root.position.copy(position);
        const layer = section(root, asset.animations[0]);
        sample(layer, start);
        this.scene.add(root);
        const fx = { layer, start, duration, age: 0 } as EventEffect;
        this.effects.add(fx);
        return fx;
    }

    private removeSummon() {
        if (!this.summon) return;
        this.summon.batch.dispose();
        removeLayer(this.summon.layer);
        this.summon = undefined;
    }

    private removeEffect(fx: EventEffect) {
        fx.sword?.removeFromParent();
        removeLayer(fx.layer);
        this.effects.delete(fx);
    }

    cancelCast() {
        this.removeSummon();
        this.released = false;
    }

    clear() {
        this.cancelCast();
        for (const fall of this.falls) fall.sword.removeFromParent();
        this.falls.clear();
        for (const fx of this.effects) this.removeEffect(fx);
    }

    dispose() {
        this.disposed = true;
        this.clear();
        if (this.asset) this.disposeAsset(this.asset);
        this.asset = undefined;
    }

    private disposeAsset(asset: GLTF) {
        const geometry = new Set<T.BufferGeometry>();
        const materials = new Set<T.Material>();
        asset.scene.traverse(node => {
            if (!(node instanceof T.Mesh)) return;
            geometry.add(node.geometry);
            for (const material of [node.material].flat()) materials.add(material);
        });
        for (const item of geometry) item.dispose();
        for (const item of materials) item.dispose();
    }
}
