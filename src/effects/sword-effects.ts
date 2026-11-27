import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAirflowMaterial } from './airflow-material';
import { loadSwordSlash, type SwordSlashAsset, type SwordSlashInstance } from './sword-slash';
import type { SpellLightPool } from './spell-lights';

const swordWaveRolls = [-Math.PI / 4, 0, Math.PI / 4];
const swordWavePlaybackRate = 2.6;
const swordWaveTurnRate = 9;
const swordWaveTravel = 40;
const swordWaveScale = .54;
const swordWaveStart = 1.25;
export const swordWaveRange = swordWaveTravel * swordWaveScale + swordWaveStart - .6;

/** Narrow structural contract so `effects` never needs to import `world/wildlife-simulation`. */
export interface SwordWaveTarget {
    readonly ready: boolean;
    readonly health: number;
    readonly position: T.Vector3;
    readonly profile: { readonly height: number };
}

interface SwordWavePath {
    previous: T.Vector3;
    struck: Set<number>;
    tracking?: { target: SwordWaveTarget; direction: T.Vector3; roll: number };
}

export class SwordEffects {
    private asset?: SwordSlashAsset;
    private waves = new Map<SwordSlashInstance, SwordWavePath>();
    private readonly point = new T.Vector3();
    private readonly desired = new T.Vector3();
    private readonly destination = new T.Vector3();
    private readonly turn = new T.Quaternion();
    private readonly noTurn = new T.Quaternion();
    private readonly rotation = new T.Euler(0, 0, 0, 'YZX');
    private wind?: T.Group;
    private windMaterials: T.ShaderMaterial[] = [];
    private windTextures: T.Texture[] = [];
    private disposed = false;

    get windMesh() { return this.wind; }

    constructor(
        private readonly scene: T.Scene,
        private readonly onTravel: (from: T.Vector3, to: T.Vector3, struck: Set<number>) => void,
    ) {}

    async load() {
        const textureLoader = new T.TextureLoader();
        await Promise.all([
            loadSwordSlash().then(asset => {
                if (this.disposed) asset.dispose();
                else this.asset = asset;
            }),
            Promise.all([
                new GLTFLoader().loadAsync(new URL('../../resource/fly/airflow/airflow_only_flat.glb', import.meta.url).href),
                textureLoader.loadAsync(new URL('../../resource/fly/airflow/textures/airflow_alpha.png', import.meta.url).href),
                textureLoader.loadAsync(new URL('../../resource/fly/airflow/textures/airflow_flow.png', import.meta.url).href),
            ]).then(([{ scene }, alphaMap, flowMap]) => {
                this.wind = scene;
                this.windTextures = [alphaMap, flowMap];
                if (this.disposed) {
                    this.disposeWind();
                    return;
                }

                alphaMap.flipY = flowMap.flipY = false;
                flowMap.wrapS = flowMap.wrapT = T.RepeatWrapping;
                alphaMap.needsUpdate = flowMap.needsUpdate = true;
                for (const [name, variant] of [['FX_Airflow_FilmsV3', 'film'], ['FX_Airflow_FibersV3', 'fiber']] as const) {
                    const ribbon = scene.getObjectByName(name);
                    if (!(ribbon instanceof T.Mesh)) throw new Error('Sword airflow GLB is missing ' + name);
                    const material = createAirflowMaterial({ alphaMap, flowMap, variant });
                    ribbon.material.dispose();
                    ribbon.material = material;
                    ribbon.renderOrder = variant === 'fiber' ? 5 : 4;
                    this.windMaterials.push(material);
                }
                scene.name = 'Sword Boost Wind';
                scene.visible = false;
            }),
        ]);
    }

    attach(sword: T.Object3D, tip: T.Object3D) {
        if (!this.wind) return;
        const anchor = this.wind.getObjectByName(T.PropertyBinding.sanitizeNodeName('FX_TipAnchor.001'));
        if (!anchor) throw new Error('Sword airflow GLB is missing its tip anchor');
        this.wind.rotation.y = Math.PI;
        const scale = tip.position.length() / anchor.position.length();
        this.wind.scale.set(scale * 1.7, scale, scale * 1.3);
        const airflowTip = anchor.position.clone().multiply(this.wind.scale).applyQuaternion(this.wind.quaternion);
        this.wind.position.copy(tip.position).sub(airflowTip);
        sword.add(this.wind);
    }

    release(position: T.Vector3, heading: number, target?: SwordWaveTarget) {
        if (!this.asset) return;
        const wave = this.asset.create({ travel: swordWaveTravel, renderOrder: 4 });
        wave.object.name = 'Heavy Attack Sword Wave';
        wave.object.scale.setScalar(swordWaveScale);
        wave.object.rotation.y = -Math.PI / 2 - heading;
        const roll = swordWaveRolls[Math.floor(Math.random() * swordWaveRolls.length)];
        wave.object.rotateX(roll);
        wave.object.position.set(position.x + swordWaveStart * Math.sin(heading), position.y + 1.22, position.z - swordWaveStart * Math.cos(heading));
        this.scene.add(wave.object);
        const tracking = target ? { target, direction: new T.Vector3(Math.sin(heading), 0, -Math.cos(heading)), roll } : undefined;
        this.waves.set(wave, { previous: wave.travelPoint(new T.Vector3()), struck: new Set(), tracking });
    }

    private steer(wave: SwordSlashInstance, path: SwordWavePath, distance: number, dt: number) {
        const { target, direction, roll } = path.tracking!;
        if (target.ready && target.health > 0) {
            this.desired.copy(target.position).y += target.profile.height * .56;
            this.desired.sub(path.previous);
            if (this.desired.lengthSq() > .001 && this.desired.dot(direction) > .25) {
                this.desired.normalize();
                const angle = direction.angleTo(this.desired);
                this.turn.setFromUnitVectors(direction, this.desired);
                this.turn.slerp(this.noTurn, 1 - Math.min(1, swordWaveTurnRate * dt / Math.max(angle, .001)));
                direction.applyQuaternion(this.turn).normalize();
            }
        }
        const yaw = Math.atan2(direction.x, -direction.z);
        this.rotation.set(roll, -Math.PI / 2 - yaw, -Math.asin(T.MathUtils.clamp(direction.y, -1, 1)), 'YZX');
        wave.object.quaternion.setFromEuler(this.rotation);
        this.destination.copy(path.previous).addScaledVector(direction, distance);
        wave.object.position.add(this.destination.sub(wave.travelPoint(this.point)));
        return wave.travelPoint(this.point);
    }

    update(dt: number, boosting: boolean) {
        if (this.wind) {
            this.wind.visible = boosting;
            if (boosting) {
                for (const material of this.windMaterials) material.uniforms.uTime.value += dt;
            }
        }
        for (const [wave, path] of this.waves) {
            wave.update(dt * swordWavePlaybackRate);
            let point = wave.travelPoint(this.point);
            if (path.tracking) point = this.steer(wave, path, path.previous.distanceTo(point), dt);
            this.onTravel(path.previous, point, path.struck);
            path.previous.copy(point);
            if (!wave.finished) continue;
            wave.dispose();
            this.waves.delete(wave);
        }
    }

    collectLights(pool: SpellLightPool) {
        for (const [wave, path] of this.waves) {
            if (wave.finished) continue;
            const p = path.previous;
            pool.emit({
                x: p.x,
                y: p.y + 0.35,
                z: p.z,
                color: 0x3ee4ff,
                intensity: 4.2,
                distance: 13,
                priority: 78,
                castShadow: false,
            });
        }
    }

    clear() {
        if (this.wind) this.wind.visible = false;
        for (const wave of this.waves.keys()) wave.dispose();
        this.waves.clear();
    }

    private disposeWind() {
        this.wind?.traverse(object => {
            if (!(object instanceof T.Mesh)) return;
            object.geometry.dispose();
            object.material.dispose();
        });
        this.wind?.removeFromParent();
        this.wind = undefined;
        for (const texture of this.windTextures) texture.dispose();
        this.windTextures = [];
        this.windMaterials = [];
    }

    dispose() {
        this.disposed = true;
        this.clear();
        this.disposeWind();
        this.asset?.dispose();
    }
}
