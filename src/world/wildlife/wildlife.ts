import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Quality } from '../../config/settings';
import { radialShadowTexture, toonMaterial } from '../../rendering/materials';
import { clipStructureCamera } from '../physics/solid-world';
import { heightAt } from '../geo/height';
import type { SwordRainContact } from '../../effects/sword-array';
import type { SpeciesId } from './wildlife-habitat';
import { Creature, WildlifeSimulation, type DivineSensePulseReport, type WildlifeClip } from './wildlife-simulation';

export const giantSwordSplashRadius = 6.8;

export type SenseThreatLevel = 'low' | 'equal' | 'high';

export interface SenseMarkerProjection {
    id: number;
    screenX: number;
    screenY: number;
    distance: number;
    label: string;
    rankColor: string;
    hpRatio: number;
    threat: SenseThreatLevel;
    statusTag?: '慑' | '警';
    locked: boolean;
}

export interface SenseMapBlip {
    x: number;
    z: number;
    rank: number;
    threat: SenseThreatLevel;
    color: string;
}

export interface SenseDangerIndicator {
    active: boolean;
    /** Degrees clockwise from screen-top (0 = top, 90 = right, 180 = bottom/behind, 270 = left). */
    angleDeg: number;
    urgency: number;
    label: string;
}

export interface SenseOverlayData {
    markers: SenseMarkerProjection[];
    mapBlips: SenseMapBlip[];
    danger: SenseDangerIndicator;
}

const urls: Record<SpeciesId, string> = {
    flower: new URL('../../../resource/wildlife/flower.glb', import.meta.url).href,
    'stone-boar': new URL('../../../resource/wildlife/stone-boar.glb', import.meta.url).href,
    water: new URL('../../../resource/wildlife/water.glb', import.meta.url).href,
    wolf: new URL('../../../resource/wildlife/wolf.glb', import.meta.url).href,
    mantis: new URL('../../../resource/wildlife/mantis.glb', import.meta.url).href,
    'crystal-boar': new URL('../../../resource/wildlife/crystal-boar.glb', import.meta.url).href,
};

const clipNames: WildlifeClip[] = ['Idle', 'Walk', 'Run', 'Forage', 'Attack', 'Hit', 'Defeat'];
const oneShots = new Set<WildlifeClip>(['Attack', 'Hit', 'Defeat']);
const limits: Record<Quality, number> = { low: 18, medium: 26, high: 34 };

function release(gltf: GLTF) {
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    const textures = new Set<T.Texture>();
    gltf.scene.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        geometries.add(o.geometry);
        for (const mat of [o.material].flat()) {
            materials.add(mat);
            for (const [key, value] of Object.entries(mat)) {
                if (key !== 'gradientMap' && value instanceof T.Texture) textures.add(value);
            }
        }
        if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    });
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    for (const tex of textures) tex.dispose();
}

class CreatureView {
    readonly root = new T.Group();
    private readonly mesh;
    private readonly shadow;
    private readonly mixer;
    private readonly healthCanvas = document.createElement('canvas');
    private readonly healthBar: T.Sprite;
    private lastHealth = -1;
    private lastRank = -1;
    private readonly actions = new Map<WildlifeClip, T.AnimationAction>();
    private motion?: WildlifeClip;
    private motionStarted = -1;
    private elapsed = 0;
    private action?: T.AnimationAction;
    private scale: number;

    constructor(scene: T.Group, readonly creature: Creature, gltf: GLTF, plane: T.PlaneGeometry, shade: T.MeshBasicMaterial) {
        this.mesh = clone(gltf.scene);
        const scale = this.scale = (creature.profile.height / creature.profile.authoredHeight) * creature.rank.sizeScale;
        this.mesh.scale.setScalar(scale);
        this.root.name = `${creature.habitat.species}-${creature.id}`;
        this.root.position.copy(creature.position);
        this.root.rotation.y = creature.yaw;
        this.shadow = new T.Mesh(plane, shade);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.scale.set(creature.profile.radius * 2.6 * creature.rank.sizeScale, creature.profile.radius * 2.8 * creature.rank.sizeScale, 1);
        this.shadow.position.y = .055;
        this.shadow.renderOrder = 2;
        this.healthCanvas.width = 192;
        this.healthCanvas.height = 38;
        const healthTexture = new T.CanvasTexture(this.healthCanvas);
        healthTexture.colorSpace = T.SRGBColorSpace;
        healthTexture.minFilter = T.LinearFilter;
        healthTexture.generateMipmaps = false;
        this.healthBar = new T.Sprite(new T.SpriteMaterial({ map: healthTexture, depthWrite: false, toneMapped: false, fog: false }));
        this.healthBar.name = 'Wildlife health';
        this.healthBar.position.y = creature.profile.height * creature.rank.sizeScale + .46;
        this.healthBar.scale.set(1.72, .34, 1);
        this.healthBar.renderOrder = 6;
        this.root.add(this.mesh, this.shadow, this.healthBar);
        scene.add(this.root);
        this.mixer = new T.AnimationMixer(this.mesh);
        for (const name of clipNames) {
            const clip = gltf.animations.find(c => c.name === name)!;
            this.actions.set(name, this.mixer.clipAction(clip));
        }
        creature.ready = true;
    }

    update(dt: number, time: number, center: T.Vector3, showHealth: boolean) {
        const a = this.creature;
        if (this.lastRank !== a.rank.rank) {
            this.scale = (a.profile.height / a.profile.authoredHeight) * a.rank.sizeScale;
            this.mesh.scale.setScalar(this.scale);
            this.shadow.scale.set(a.profile.radius * 2.6 * a.rank.sizeScale, a.profile.radius * 2.8 * a.rank.sizeScale, 1);
            this.healthBar.position.y = a.profile.height * a.rank.sizeScale + .46;
            this.lastHealth = -1;
            this.lastRank = a.rank.rank;
        }
        this.root.position.lerp(a.position, 1-Math.exp(-24*dt));
        this.root.rotation.y = a.yaw;
        const distance = a.position.distanceToSquared(center);
        this.shadow.visible = distance < 80 ** 2;
        this.healthBar.visible = showHealth && a.health > 0 && distance < 52 ** 2;
        if (this.healthBar.visible && this.lastHealth !== a.health) {
            const ctx = this.healthCanvas.getContext('2d')!;
            ctx.clearRect(0, 0, 192, 38);
            // Rank + species tag
            ctx.font = '600 13px "Microsoft YaHei", "PingFang SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = `${a.rank.label} · ${a.profile.name}`;
            ctx.fillStyle = 'rgba(10, 24, 28, 0.78)';
            ctx.fillRect(22, 1, 148, 19);
            ctx.strokeStyle = a.rank.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(22.5, 1.5, 147, 18);
            ctx.fillStyle = a.rank.color;
            ctx.fillText(label, 96, 11);
            // Health bar
            ctx.fillStyle = '#182529ee';
            ctx.fillRect(18, 23, 156, 13);
            ctx.strokeStyle = '#dedac1';
            ctx.strokeRect(18.5, 23.5, 155, 12);
            const ratio = Math.max(0, Math.min(1, a.health / Math.max(1, a.maxHealth)));
            ctx.fillStyle = a.rank.rank >= 4 ? '#c58dff' : a.rank.rank === 3 ? '#f0bc5e' : a.profile.temperament === 'territorial' ? '#e3935f' : '#d3695c';
            ctx.fillRect(21, 26, 150 * ratio, 7);
            this.healthBar.material.map!.needsUpdate = true;
            this.lastHealth = a.health;
        }
        const name = a.motion;
        if (this.motion !== name || (name === 'Hit' && this.motionStarted !== a.since)) {
            const previous = this.action;
            const action = this.actions.get(name)!;
            const first = this.motion === undefined;
            this.motion = name;
            this.motionStarted = a.since;
            this.action = action;
            const once = oneShots.has(name);
            const duration = action.getClip().duration;
            action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
            action.setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity);
            action.clampWhenFinished = once;
            action.time = once && first ? Math.min(duration, time-a.since) : first ? a.id % 9 / 9 * duration : 0;
            if (previous && previous !== action) action.crossFadeFrom(previous, name === 'Hit' ? .08 : .14, false);
            action.play();
            this.elapsed = 0;
        }
        if (name === 'Walk' || name === 'Run') {
            const action = this.action!;
            const stride = a.profile.stride[name === 'Run' ? 1 : 0] * this.scale;
            action.setEffectiveTimeScale(T.MathUtils.clamp(a.speed * action.getClip().duration / stride, .60, 3.4));
        }
        this.elapsed += dt;
        if (distance < 60 ** 2 || this.elapsed >= .14 || oneShots.has(name)) {
            this.mixer.update(this.elapsed);
            this.elapsed = 0;
        }
    }

    dispose() {
        this.creature.ready = false;
        this.healthBar.material.map?.dispose();
        this.healthBar.material.dispose();
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.mesh);
        this.mesh.traverse(o => { if (o instanceof T.SkinnedMesh) o.skeleton.dispose(); });
        this.root.removeFromParent();
    }
}

interface DamagePopup {
    sprite: T.Sprite;
    canvas: HTMLCanvasElement;
    age: number;
    duration: number;
    active: boolean;
}

class DamagePopupPool {
    private readonly slots: DamagePopup[] = [];
    private readonly group = new T.Group();

    constructor(parent: T.Group, count = 18) {
        this.group.name = 'Damage Popups';
        if (typeof document === 'undefined') return;
        for (let i = 0; i < count; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 48;
            const texture = new T.CanvasTexture(canvas);
            texture.colorSpace = T.SRGBColorSpace;
            texture.minFilter = T.LinearFilter;
            texture.generateMipmaps = false;
            const material = new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false });
            const sprite = new T.Sprite(material);
            sprite.visible = false;
            sprite.renderOrder = 10;
            this.group.add(sprite);
            this.slots.push({ sprite, canvas, age: 0, duration: 0.85, active: false });
        }
        parent.add(this.group);
    }

    spawn(x: number, y: number, z: number, amount: number, crit: boolean) {
        if (!this.slots.length) return;
        let slot = this.slots.find(s => !s.active);
        if (!slot) {
            slot = this.slots.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.slots[0]);
        }
        slot.active = true;
        slot.age = 0;
        slot.duration = crit ? 1.05 : 0.82;
        const jitterX = (Math.random() - 0.5) * 0.55;
        const jitterZ = (Math.random() - 0.5) * 0.55;
        slot.sprite.position.set(x + jitterX, y, z + jitterZ);
        slot.sprite.scale.set(crit ? 1.65 : 1.28, crit ? 0.50 : 0.38, 1);
        slot.sprite.material.opacity = 1;
        slot.sprite.visible = true;

        const ctx = slot.canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, 160, 48);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = crit
            ? '800 24px "Microsoft YaHei", "PingFang SC", sans-serif'
            : '700 20px "Microsoft YaHei", "PingFang SC", sans-serif';
        const text = crit ? `暴击 ${amount}` : `-${amount}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = crit ? 'rgba(62, 20, 6, 0.92)' : 'rgba(10, 22, 28, 0.88)';
        ctx.strokeText(text, 80, 24);
        ctx.fillStyle = crit ? '#ffd85e' : '#fff8e2';
        ctx.fillText(text, 80, 24);
        slot.sprite.material.map!.needsUpdate = true;
    }

    update(dt: number) {
        for (const s of this.slots) {
            if (!s.active) continue;
            s.age += dt;
            if (s.age >= s.duration) {
                s.active = false;
                s.sprite.visible = false;
                continue;
            }
            const p = s.age / s.duration;
            s.sprite.position.y += (1.55 * (1 - p * 0.65)) * dt;
            s.sprite.material.opacity = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
        }
    }

    dispose() {
        for (const s of this.slots) {
            s.sprite.material.map?.dispose();
            s.sprite.material.dispose();
        }
        this.group.removeFromParent();
    }
}

export interface WildlifeOptions {
    enableRanks?: boolean;
    onDefeat?: (creature: Creature) => void;
    damageMultiplier?: () => { scale: number; crit: boolean };
}

export class Wildlife {
    readonly simulation;
    readonly root = new T.Group();
    private readonly popups: DamagePopupPool;
    private readonly loader = new GLTFLoader();
    private readonly assets = new Map<SpeciesId, GLTF>();
    private readonly requested = new Set<SpeciesId>();
    private readonly failed = new Set<SpeciesId>();
    private readonly views = new Map<Creature, CreatureView>();
    private readonly shadow = new T.MeshBasicMaterial({ color: '#24332b', map: radialShadowTexture(), opacity: .28, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    private readonly plane = new T.PlaneGeometry(1, 1);
    private readonly hitPoint = new T.Vector3();
    private readonly hitTarget = new T.Vector3();
    private readonly direction = new T.Vector3();
    private readonly aim = new T.Vector3();
    private readonly screen = new T.Vector3();
    private readonly sight = new T.Vector3();
    private readonly damageMultiplier?: () => { scale: number; crit: boolean };
    private disposed = false;

    constructor(scene: T.Scene, onDamage: (damage: number, creature: Creature) => void, options: WildlifeOptions = {}) {
        this.damageMultiplier = options.damageMultiplier;
        this.simulation = new WildlifeSimulation(onDamage, {
            enableRanks: options.enableRanks,
            onDefeat: options.onDefeat,
        });
        this.root.name = 'Wildlife';
        this.popups = new DamagePopupPool(this.root);
        scene.add(this.root);
    }

    private strikeCreature(a: Creature, base: number, origin?: T.Vector3): boolean {
        let amount = base;
        let crit = false;
        if (this.damageMultiplier) {
            const rolled = this.damageMultiplier();
            amount = Math.max(1, Math.round(base * rolled.scale));
            crit = rolled.crit;
        }
        const hit = this.simulation.damage(a, amount, true, origin);
        if (hit) {
            this.popups.spawn(
                a.position.x,
                a.position.y + a.profile.height * a.rank.sizeScale + 0.55,
                a.position.z,
                amount,
                crit,
            );
        }
        return hit;
    }

    private load(id: SpeciesId) {
        if (this.requested.has(id)) return;
        this.requested.add(id);
        void this.loader.loadAsync(urls[id]).then(gltf => {
            if (this.disposed) { release(gltf); return; }
            const missing = clipNames.filter(name => !gltf.animations.some(clip => clip.name === name));
            if (missing.length) {
                release(gltf);
                this.fail(id, `missing clips ${missing.join(', ')}`);
                return;
            }
            gltf.scene.traverse(o => {
                if (!(o instanceof T.SkinnedMesh)) return;
                const old = o.material as T.MeshStandardMaterial;
                const mat = toonMaterial(old.color, { side: old.side });
                mat.map = old.map;
                mat.name = `${id} cel shading`;
                o.material = mat;
                o.geometry.computeBoundingSphere();
                o.boundingSphere = o.geometry.boundingSphere!.clone();
                o.boundingSphere.radius += .7;
                old.dispose();
            });
            this.assets.set(id, gltf);
        }, error => this.fail(id, error));
    }

    private fail(id: SpeciesId, error: unknown) {
        this.failed.add(id);
        console.error(`野怪资源加载失败 (${id})`, error);
    }

    update(dt: number, center: T.Vector3, player: T.Vector3, quality: Quality, running: boolean, canInteract: boolean,
        camera: T.PerspectiveCamera, velocity?:T.Vector3, flying=false, viewportHeight=900, nightFactor = 0, highSpeedFlight = false) {
        camera.updateMatrixWorld();
        const visible=(position:T.Vector3,height:number)=>running&&this.inView(camera,position,height);
        const nightBoost = 1 + 0.55 * Math.max(0, Math.min(1, nightFactor));
        const activeLimit = Math.round((limits[quality] + (flying ? 6 : 0)) * nightBoost);
        this.simulation.update(dt,center,canInteract?player:undefined,activeLimit,running,player,{velocity,visible,flying,nightFactor});
        this.popups.update(dt);
        for(const id of this.simulation.preload)this.load(id);
        const active = new Set(this.simulation.active);
        for (const [agent, view] of this.views) {
            if (active.has(agent)) continue;
            view.dispose();
            this.views.delete(agent);
        }
        let spawned = 0;
        for (const agent of active) {
            const id = agent.habitat.species;
            const asset = this.assets.get(id);
            if (!asset) { this.load(id); continue; }
            let view = this.views.get(agent);
            if (!view) {
                // Skip expensive SkeletonUtils.clone + CanvasTexture allocation while rocketing overhead in Escape Light
                if (highSpeedFlight) continue;
                if (running && spawned >= 1) continue;
                // Far, already-authored residents are loaded before they are large enough to notice.
                const focal=viewportHeight/(2*Math.tan(camera.fov*Math.PI/360));
                const onScreenHeight=agent.profile.height*focal/Math.max(1,agent.position.distanceTo(camera.position));
                if(onScreenHeight>=15&&visible(agent.position,agent.profile.height))continue;
                view = new CreatureView(this.root, agent, asset, this.plane, this.shadow);
                this.views.set(agent, view);
                spawned++;
            }
            view.update(dt, this.simulation.time, center, running);
        }
    }

    private inView(camera:T.PerspectiveCamera, p:T.Vector3, height:number) {
        this.sight.copy(p).y+=height*.6;
        this.screen.copy(this.sight).project(camera);
        if(this.screen.z< -1||this.screen.z>1||Math.abs(this.screen.x)>1.12||Math.abs(this.screen.y)>1.12)return false;
        if(clipStructureCamera(camera.position,this.sight)<.93)return false;
        const samples=Math.min(18,Math.ceil(camera.position.distanceTo(this.sight)/8));
        for(let i=1;i<samples;i++){
            const probe=this.screen.lerpVectors(camera.position,this.sight,i/samples);
            if(probe.y<heightAt(probe.x,probe.z)-.15)return false;
        }
        return true;
    }

    focus() { this.simulation.refresh(); }

    stats() {
        return { total: this.simulation.agents.length, active: this.simulation.active.length, rendered: this.views.size, loaded: this.assets.size, failed: this.failed.size };
    }

    combatTarget(player: T.Vector3, camera: T.PerspectiveCamera, maxRange = 42, senseActive = false) {
        camera.getWorldDirection(this.direction);
        let best: Creature | undefined, score = Infinity;
        const rSq = maxRange * maxRange;
        const minFacing = senseActive ? .84 : .89;
        const pool = senseActive ? this.simulation.agents : this.simulation.active;
        for (const a of pool) {
            if (!a.health || a.state === 'Defeat') continue;
            if (!senseActive && (!a.ready || a.attentionUntil <= this.simulation.time)) continue;
            if (senseActive && a.senseMarkedUntil <= this.simulation.time && !a.ready) continue;
            if (player.distanceToSquared(a.position) > rSq) continue;
            const aim = this.aim.copy(a.position);
            aim.y += a.profile.height * .68;
            aim.sub(camera.position);
            const distance = aim.length();
            const facing = aim.dot(this.direction) / Math.max(.01, distance);
            if (facing < minFacing) continue;
            const rank = (1 - facing) * 90 + distance * .035;
            if (rank >= score) continue;
            score = rank;
            best = a;
        }
        return best;
    }

    /**
     * Collects all live wild monsters revealed by Divine Sense within a forward cone
     * (default ±45° ahead of `heading`) up to `maxRange` meters away.
     */
    senseTargetsInCone(
        origin: T.Vector3,
        heading: number,
        maxRange: number,
        halfAngleRad = Math.PI / 4,
    ): T.Vector3[] {
        const fwdX = Math.sin(heading);
        const fwdZ = -Math.cos(heading);
        const minCos = Math.cos(halfAngleRad);
        const rSq = maxRange * maxRange;
        const now = this.simulation.time;
        const results: T.Vector3[] = [];
        for (const a of this.simulation.agents) {
            if (a.health <= 0 || a.state === 'Defeat') continue;
            if (a.senseMarkedUntil <= now && !a.ready) continue;
            const dx = a.position.x - origin.x;
            const dz = a.position.z - origin.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < 4 || dSq > rSq) continue;
            const dist = Math.sqrt(dSq);
            const dot = (dx * fwdX + dz * fwdZ) / dist;
            if (dot < minCos) continue;
            results.push(new T.Vector3(a.position.x, a.position.y, a.position.z));
        }
        return results;
    }

    applyDivineSensePulse(
        origin: T.Vector3,
        radius: number,
        playerRealmRank: number,
        suppressMaxRank: number,
    ): DivineSensePulseReport {
        return this.simulation.applyDivineSensePulse(origin, radius, playerRealmRank, suppressMaxRank);
    }

    applyNascentPressure(origin: T.Vector3, radius: number, duration = 4.2, baseDamage = 48): number {
        return this.simulation.applyNascentPressure(origin, radius, duration, baseDamage);
    }

    /**
     * Collects:
     * - 3D-projected beast markers (when `senseActive`)
     * - Minimap & world-map blips (when `senseActive`)
     * - Passive off-screen / rear danger indicator (always active!)
     */
    collectSenseOverlay(
        playerPos: T.Vector3,
        senseOrigin: T.Vector3,
        camera: T.PerspectiveCamera,
        senseActive: boolean,
        senseRadius: number,
        playerRealmRank: number,
        viewportW: number,
        viewportH: number,
        lockedId?: number,
    ): SenseOverlayData {
        const markers: SenseMarkerProjection[] = [];
        const mapBlips: SenseMapBlip[] = [];
        const danger: SenseDangerIndicator = { active: false, angleDeg: 180, urgency: 0, label: '' };

        camera.getWorldDirection(this.direction);
        const camForwardX = this.direction.x;
        const camForwardZ = this.direction.z;
        const camFwdLen = Math.hypot(camForwardX, camForwardZ) || 1;
        const fX = camForwardX / camFwdLen;
        const fZ = camForwardZ / camFwdLen;
        // Right vector in XZ plane: (forward × up) = (-fZ, fX)
        const rX = -fZ;
        const rZ = fX;

        const now = this.simulation.time;

        // 1. Passive Divine Sense danger arc: detect unseen/flanking hostile beasts closing on player
        let worstUrgency = 0;
        for (const a of this.simulation.active) {
            if (!a.ready || a.health <= 0 || a.state === 'Defeat') continue;
            const hostile = a.state === 'Pursue' || a.state === 'Attack' || a.state === 'Alert' || a.fightUntil > now;
            if (!hostile || now < a.intimidatedUntil) continue;
            const dx = a.position.x - playerPos.x;
            const dz = a.position.z - playerPos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 56 || dist < 0.1) continue;
            const ndx = dx / dist;
            const ndz = dz / dist;
            const forwardDot = ndx * fX + ndz * fZ;
            // Only warn when the threat is outside central forward sight (flank or behind) or very close
            if (forwardDot > 0.62 && dist > 10) continue;
            const rankBoost = a.rank.rank > playerRealmRank ? 1.35 : 1.0;
            const stateBoost = a.state === 'Attack' ? 1.45 : a.state === 'Pursue' ? 1.15 : 0.85;
            const urgency = T.MathUtils.clamp((1 - dist / 56) * rankBoost * stateBoost, 0, 1);
            if (urgency > worstUrgency) {
                worstUrgency = urgency;
                const rightDot = ndx * rX + ndz * rZ;
                const angleRad = Math.atan2(rightDot, forwardDot);
                danger.active = true;
                danger.angleDeg = (T.MathUtils.radToDeg(angleRad) + 360) % 360;
                danger.urgency = urgency;
                danger.label = a.displayName;
            }
        }

        if (!senseActive) {
            return { markers, mapBlips, danger };
        }

        // 2. Active Divine Sense Insight: collect map blips & prioritized 3D-projected markers
        const rSq = senseRadius * senseRadius;
        const candidates: { a: Creature; dist: number; priority: number }[] = [];

        for (const a of this.simulation.agents) {
            if (a.state === 'Defeat' || a.health <= 0) continue;
            const distSq = a.position.distanceToSquared(senseOrigin);
            if (distSq > rSq) continue;
            const dist = Math.sqrt(distSq);
            const threat: SenseThreatLevel = a.rank.rank > playerRealmRank
                ? 'high'
                : a.rank.rank === playerRealmRank ? 'equal' : 'low';
            const blipColor = threat === 'high' ? '#ff6458' : threat === 'equal' ? '#f6d479' : '#86d4be';
            mapBlips.push({
                x: a.position.x,
                z: a.position.z,
                rank: a.rank.rank,
                threat,
                color: blipColor,
            });
            // Prioritize locked target, high-rank threats, and closer beasts for clean HUD readability
            const priority = (a.id === lockedId ? -500 : 0) + dist - a.rank.rank * 34 - (threat === 'high' ? 85 : 0);
            candidates.push({ a, dist, priority });
        }

        candidates.sort((u, v) => u.priority - v.priority);
        const maxMarkers = 12;
        for (const { a, dist } of candidates) {
            if (markers.length >= maxMarkers) break;
            this.sight.copy(a.position);
            this.sight.y += a.profile.height * a.rank.sizeScale + 0.95;
            this.screen.copy(this.sight).project(camera);
            if (this.screen.z < -1 || this.screen.z > 1) continue;
            if (Math.abs(this.screen.x) > 0.96 || Math.abs(this.screen.y) > 0.94) continue;
            const sx = (this.screen.x * 0.5 + 0.5) * viewportW;
            const sy = (-this.screen.y * 0.5 + 0.5) * viewportH;
            const isLocked = a.id === lockedId;
            const threat: SenseThreatLevel = a.rank.rank > playerRealmRank
                ? 'high'
                : a.rank.rank === playerRealmRank ? 'equal' : 'low';
            // Screen-space declustering so distant beast packs never stack unreadable overlapping tags
            if (!isLocked) {
                let overlapped = false;
                for (const prev of markers) {
                    if (Math.abs(prev.screenX - sx) < 108 && Math.abs(prev.screenY - sy) < 28) {
                        overlapped = true;
                        break;
                    }
                }
                if (overlapped) continue;
            }
            const statusTag: '慑' | '警' | undefined = now < a.intimidatedUntil
                ? '慑'
                : (threat === 'high' && (a.state === 'Alert' || a.angerUntil > now))
                    ? '警'
                    : undefined;
            markers.push({
                id: a.id,
                screenX: sx,
                screenY: sy,
                distance: Math.round(dist),
                label: a.displayName,
                rankColor: a.rank.color,
                hpRatio: T.MathUtils.clamp(a.health / Math.max(1, a.maxHealth), 0, 1),
                threat,
                statusTag,
                locked: isLocked,
            });
        }

        return { markers, mapBlips, danger };
    }

    melee(from: T.Vector3, heading: number) {
        for (const a of this.simulation.active) {
            const dx = a.position.x-from.x, dz = a.position.z-from.z, distance = Math.hypot(dx,dz);
            if (distance > 2.45 + a.profile.radius || Math.abs(a.position.y-from.y) > 1.7) continue;
            if (dx*Math.sin(heading)-dz*Math.cos(heading) < distance*.40) continue;
            this.hitPoint.copy(from).y += .9;
            this.hitTarget.copy(a.position).y += a.profile.height * .5;
            if (clipStructureCamera(this.hitPoint,this.hitTarget) === 1) this.strikeCreature(a, 26, from);
        }
    }

    swordTarget(from: T.Vector3, heading: number, range: number, senseActive = false) {
        const forwardX = Math.sin(heading), forwardZ = -Math.cos(heading);
        const origin = this.hitPoint.copy(from);
        origin.y += 1.22;
        const minFacing = senseActive ? .82 : .90;
        const lateralRatio = senseActive ? .52 : .38;
        const maxPitch = senseActive ? 18.0 : 6.5;
        let found: Creature | undefined, best = Infinity;
        for (const a of this.simulation.active) {
            if (!a.ready || a.health <= 0) continue;
            const dx = a.position.x-from.x, dz = a.position.z-from.z;
            const horizontal = Math.hypot(dx,dz);
            if (horizontal < 1.2 || horizontal > range) continue;
            const facing = (dx*forwardX+dz*forwardZ)/horizontal;
            // Only lock onto targets clearly ahead of the character's facing direction (~±25°, widened under Divine Sense).
            if (facing < minFacing) continue;
            const lateral = Math.abs(dx*forwardZ - dz*forwardX);
            if (lateral > Math.max(2.2, horizontal * lateralRatio)) continue;
            const target = this.hitTarget.copy(a.position);
            target.y += a.profile.height * .56;
            const pitch = Math.abs(target.y-origin.y);
            const distance = Math.hypot(horizontal,pitch);
            if (pitch > maxPitch || distance > range) continue;
            const score = distance * .35 + (1-facing)*65;
            if (score >= best || clipStructureCamera(origin,target) !== 1) continue;
            found = a;
            best = score;
        }
        return found;
    }

    swordTravel(from: T.Vector3, to: T.Vector3, struck: Set<number>) {
        const move = this.direction.subVectors(to, from);
        const length = move.lengthSq();
        for (const a of this.simulation.active) {
            if (struck.has(a.id) || !a.ready || !a.health) continue;
            const closest = this.hitPoint.copy(a.position).sub(from).dot(move) / Math.max(.0001, length);
            this.hitPoint.copy(from).addScaledVector(move, T.MathUtils.clamp(closest, 0, 1));
            const dx = a.position.x-this.hitPoint.x, dz = a.position.z-this.hitPoint.z;
            if (Math.hypot(dx,dz) > 1.7+a.profile.radius || this.hitPoint.y < a.position.y-.38 || this.hitPoint.y > a.position.y+a.profile.height+.6) continue;
            if (clipStructureCamera(from, this.hitPoint) !== 1) continue;
            if (this.strikeCreature(a, 48, from)) struck.add(a.id);
        }
    }

    fireballContact(from: T.Vector3, to: T.Vector3) {
        const dx = to.x - from.x, dz = to.z - from.z;
        const length = Math.max(.0001, dx * dx + dz * dz);
        let contact: number | undefined;
        let nearest = Infinity;
        for (const creature of this.simulation.active) {
            if (!creature.ready || !creature.health) continue;
            const center = creature.position, profile = creature.profile;
            const x = center.x - from.x, z = center.z - from.z;
            const along = T.MathUtils.clamp((x * dx + z * dz) / length, 0, 1);
            const y = T.MathUtils.lerp(from.y, to.y, along);
            if (y < center.y - .35 || y > center.y + profile.height + .35) continue;
            const distance = Math.hypot(x - dx * along, z - dz * along);
            if (distance > profile.radius + .36) continue;
            const rank = along * Math.sqrt(length) + distance;
            if (rank >= nearest) continue;
            this.hitTarget.set(center.x, T.MathUtils.clamp(y, center.y, center.y + profile.height), center.z);
            if (clipStructureCamera(from, this.hitTarget) !== 1) continue;
            nearest = rank;
            contact = along;
        }
        return contact;
    }

    fireballBlast(point: T.Vector3, power = .5, directHit = false, radiusScale = 1) {
        const charge = T.MathUtils.clamp(power, 0, 1);
        const splashRadius = T.MathUtils.lerp(3.6, 5.6, charge) * radiusScale;
        const directDamage = Math.round(T.MathUtils.lerp(24, 58, charge));
        const splashMax = Math.round(T.MathUtils.lerp(15, 34, charge));
        const splashMin = Math.round(T.MathUtils.lerp(6, 14, charge));
        let directTarget: Creature | undefined;
        let nearest = Infinity;
        if (directHit) {
            for (const creature of this.simulation.active) {
                if (!creature.ready || creature.health <= 0) continue;
                const d = Math.max(0, Math.hypot(creature.position.x - point.x, creature.position.z - point.z) - creature.profile.radius);
                if (d < nearest && d <= .85 * radiusScale) { nearest = d; directTarget = creature; }
            }
        }
        const yUp = 1.8 * radiusScale;
        const yDown = 1.3 * Math.min(2.2, radiusScale);
        for (const creature of this.simulation.active) {
            if (!creature.ready || creature.health <= 0) continue;
            const { position, profile } = creature;
            const distance = Math.max(0, Math.hypot(position.x - point.x, position.z - point.z) - profile.radius);
            if (creature !== directTarget && (distance > splashRadius || point.y < position.y - yDown || point.y > position.y + profile.height + yUp)) continue;
            this.hitPoint.copy(point).y += .16;
            this.hitTarget.copy(position).y += profile.height * .48;
            if (creature !== directTarget && clipStructureCamera(this.hitPoint, this.hitTarget) !== 1) continue;
            const damage = creature === directTarget
                ? directDamage
                : Math.round(T.MathUtils.lerp(splashMax, splashMin, distance / splashRadius));
            this.strikeCreature(creature, damage, point);
        }
    }

    giantSwordContact(from: T.Vector3, to: T.Vector3) {
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
        const flatLength = dx * dx + dz * dz;
        const length = Math.max(.0001, flatLength);
        const vertical = flatLength < .0001 && Math.abs(dy) > .0001;
        let contact: number | undefined;
        let nearest = Infinity;
        for (const creature of this.simulation.active) {
            if (!creature.ready || !creature.health) continue;
            const center = creature.position, profile = creature.profile;
            const x = center.x - from.x, z = center.z - from.z;
            const bottom = center.y - .65, top = center.y + profile.height + .85;
            const entryY = dy < 0 ? top : bottom;
            const along = T.MathUtils.clamp(vertical ? (entryY - from.y) / dy : (x * dx + z * dz) / length, 0, 1);
            const y = T.MathUtils.lerp(from.y, to.y, along);
            if (y < bottom - 1e-6 || y > top + 1e-6) continue;
            const distance = Math.hypot(x - dx * along, z - dz * along);
            if (distance > profile.radius + .95) continue;
            const rank = vertical ? along * Math.abs(dy) + distance * .01 : along * Math.sqrt(length) + distance;
            if (rank >= nearest) continue;
            this.hitTarget.set(center.x, T.MathUtils.clamp(y, center.y, center.y + profile.height), center.z);
            if (clipStructureCamera(from, this.hitTarget) !== 1) continue;
            nearest = rank;
            contact = along;
        }
        return contact;
    }

    giantSwordBlast(point: T.Vector3, directHit = false) {
        const splashRadius = giantSwordSplashRadius;
        const directDamage = 95;
        const splashMax = 72;
        const splashMin = 38;
        let directTarget: Creature | undefined;
        let nearest = Infinity;
        if (directHit) {
            for (const creature of this.simulation.active) {
                if (!creature.ready || creature.health <= 0) continue;
                const d = Math.max(0, Math.hypot(creature.position.x - point.x, creature.position.z - point.z) - creature.profile.radius);
                if (d < nearest && d <= 1.35) { nearest = d; directTarget = creature; }
            }
        }
        for (const creature of this.simulation.active) {
            if (!creature.ready || creature.health <= 0) continue;
            const { position, profile } = creature;
            const distance = Math.max(0, Math.hypot(position.x - point.x, position.z - point.z) - profile.radius);
            if (creature !== directTarget && (distance > splashRadius || point.y < position.y - 1.8 || point.y > position.y + profile.height + 2.4)) continue;
            this.hitPoint.copy(point).y += .2;
            this.hitTarget.copy(position).y += profile.height * .48;
            if (creature !== directTarget && clipStructureCamera(this.hitPoint, this.hitTarget) !== 1) continue;
            const damage = creature === directTarget
                ? directDamage
                : Math.round(T.MathUtils.lerp(splashMax, splashMin, distance / splashRadius));
            this.strikeCreature(creature, damage, point);
        }
    }

    rainContact({x,z,fromY,toY,landed,struck}:SwordRainContact) {
        for (const a of this.simulation.active) {
            if(!a.ready||a.health<=0||struck.has(a.id))continue;
            const dx=x-a.position.x,dz=z-a.position.z;
            const axisX=Math.sin(a.yaw),axisZ=Math.cos(a.yaw),half=a.profile.bodyHalfLength??0;
            const along=T.MathUtils.clamp(dx*axisX+dz*axisZ,-half,half);
            const distance=Math.hypot(dx-axisX*along,dz-axisZ*along);
            const direct=distance<=a.profile.radius+.25&&fromY>=a.position.y-.15&&toY<=a.position.y+a.profile.height+.12;
            const nearby=landed&&distance<=a.profile.radius+.98&&Math.abs(a.position.y-toY)<=.85;
            if(!direct&&!nearby)continue;
            const origin=this.hitPoint.set(x,direct?Math.max(toY,a.position.y)+.13:toY+.24,z);
            const body=this.hitTarget.copy(a.position).addScaledVector(T.Object3D.DEFAULT_UP,.45*a.profile.height);
            if(!direct&&clipStructureCamera(origin,body)!==1)continue;
            if(this.strikeCreature(a,direct?17:11,origin))struck.add(a.id);
        }
    }

    dispose() {
        this.disposed = true;
        this.popups.dispose();
        for (const view of this.views.values()) view.dispose();
        for (const asset of this.assets.values()) release(asset);
        this.views.clear();
        this.assets.clear();
        this.shadow.map?.dispose();
        this.shadow.dispose();
        this.plane.dispose();
        this.root.removeFromParent();
    }
}
