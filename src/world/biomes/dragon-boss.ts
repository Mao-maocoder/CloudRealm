import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BOSS_TERRITORIES, type BossTerritorySpec } from '../geo/boss-territories';
import { heightAt } from '../geo/height';
import { DragonLandingFX } from '../../effects/dragon-landing-fx';
import { DragonBreathFX } from '../../effects/dragon-breath-fx';
import type { SwordRainContact } from '../../effects/sword-array';

const DRAGON_BOSS_URL = new URL('../../../resource/boss/dragon_boss.glb', import.meta.url).href;

export type DragonBossState =
    | 'SLEEP'
    | 'WAKE_UP'
    | 'PATROL_WALK'
    | 'TAKEOFF'
    | 'SOAR_CIRCLE'
    | 'LANDING'
    | 'TERRITORY_ROAR'
    | 'BREATH_STRAFE'
    | 'ATTACK_CLAW'
    | 'ATTACK_BITE'
    | 'ATTACK_TAIL_WHIP'
    | 'ATTACK_GROUND_BREATH'
    | 'DEFEATED';

export interface DragonBossCallbacks {
    onDamagePlayer?: (rawDamage: number, attackLabel: string) => void;
    damageMultiplier?: () => { scale: number; crit: boolean };
    onDefeat?: (bossName: string) => void;
    onHitFeedback?: (damage: number, crit: boolean) => void;
    onSfx?: (kind: 'roar' | 'impact' | 'breath' | 'wing') => void;
}

const DRAGON_SCALE = 11.5;
const AGGRO_RADIUS = 92;
const DEAGGRO_RADIUS = 165;
const WALK_SPEED = 4.8;
const CHASE_SPEED = 10.6;
const SOAR_SPEED = 22.0;
const STRAFE_SPEED = 32.0;

// Combat hitbox & stats (元婴后期古龙)
const BOSS_STRUCK_ID = -9902;
const BOSS_HIT_RADIUS = 9.8;
const BOSS_HIT_HEIGHT = 11.8;
const BOSS_MAX_HP = 18000;
const BOSS_RESPAWN_SEC = 45;

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * (1 - Math.exp(-lambda * dt));
}

function angleDiffAbs(a: number, b: number): number {
    let d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}

export class DragonBoss {
    static readonly REALM_INDEX = 3;
    static readonly STAGE_INDEX = 2;
    static readonly REALM_LABEL = '元婴后期';
    static readonly DISPLAY_NAME = '潜龙晶渊 · 蚀渊古龙';

    readonly group = new T.Group();
    readonly territory: BossTerritorySpec;
    private readonly landingFx: DragonLandingFX;
    private readonly breathFx: DragonBreathFX;
    private readonly callbacks: DragonBossCallbacks;

    private disposed = false;
    private loadPromise?: Promise<void>;
    private gltf?: GLTF;
    private model?: T.Object3D;
    private headBone?: T.Object3D;
    private readonly dragonMats: T.MeshStandardMaterial[] = [];
    private mixer?: T.AnimationMixer;
    private readonly actions = new Map<string, T.AnimationAction>();
    private activeAction?: T.AnimationAction;

    // Combat stats
    hp = BOSS_MAX_HP;
    readonly maxHp = BOSS_MAX_HP;
    private hitFlash = 0;
    private respawnTimer = 0;

    // Live ecology & combat state
    state: DragonBossState = 'SLEEP';
    private stateTime = 0;
    private stateDuration = 22;
    private aggroActive = false;
    private roarCooldown = 0;
    private breathCooldown = 0;
    private attackCooldown = 0;
    private clawImpactFired = false;
    private strikeDamageFired = false;
    private breathTickAccum = 0;
    private strafeGapClose = false;

    // Spatial kinematics
    readonly position = new T.Vector3();
    private yaw = 0;
    private roll = 0;
    private pitch = 0;
    private readonly waypoint = new T.Vector3();
    private orbitAngle = 0;
    private orbitRadius = 112;
    private orbitAltitude = 56;
    private readonly strafeDir = new T.Vector3(0, 0, 1);

    // Reusable scratch vectors
    private readonly tmpHeadPos = new T.Vector3();
    private readonly tmpHeadDir = new T.Vector3(0, -0.32, 1);
    private readonly tmpQuat = new T.Quaternion();
    private readonly tmpVec = new T.Vector3();
    private readonly aimProxy = {
        position: new T.Vector3(),
        profile: { height: BOSS_HIT_HEIGHT },
        health: BOSS_MAX_HP,
        ready: true,
    };

    constructor(
        private readonly scene: T.Scene,
        private readonly sampleFloorY: (x: number, z: number) => number = heightAt,
        pixelRatio = 1,
        callbacks: DragonBossCallbacks = {},
    ) {
        this.territory = BOSS_TERRITORIES.find(t => t.id === 'boss2') ?? BOSS_TERRITORIES[0];
        this.callbacks = callbacks;
        this.group.name = 'DragonBoss_Entity';
        this.scene.add(this.group);

        this.landingFx = new DragonLandingFX(this.scene, pixelRatio);
        this.breathFx = new DragonBreathFX(this.scene, pixelRatio);

        const baseY = this.sampleFloorY(this.territory.x, this.territory.z);
        this.position.set(this.territory.x + 6, baseY, this.territory.z - 8);
        this.yaw = this.territory.yaw + Math.PI * 0.75;
        this.group.position.copy(this.position);
        this.group.rotation.set(0, this.yaw, 0);
    }

    get isAlive(): boolean {
        return this.hp > 0 && this.state !== 'DEFEATED';
    }

    get inCombat(): boolean {
        return this.isAlive && this.aggroActive;
    }

    getHealthBarState(playerPos: T.Vector3) {
        const dist = Math.hypot(playerPos.x - this.territory.x, playerPos.z - this.territory.z);
        const visible = this.isAlive && (this.aggroActive || dist < this.territory.radius * 1.15);
        return {
            visible,
            name: DragonBoss.DISPLAY_NAME,
            realm: DragonBoss.REALM_LABEL,
            hp: this.hp,
            maxHp: this.maxHp,
        };
    }

    load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        const loader = new GLTFLoader();
        this.loadPromise = loader.loadAsync(DRAGON_BOSS_URL)
            .then(gltf => {
                if (this.disposed) {
                    this.disposeGltf(gltf);
                    return;
                }
                this.gltf = gltf;
                this.installModel(gltf);
            })
            .catch(err => {
                console.warn('古龙 Boss 模型加载失败:', err);
            });
        return this.loadPromise;
    }

    private installModel(gltf: GLTF) {
        const root = gltf.scene;
        root.name = 'DragonBoss_Model';
        root.scale.setScalar(DRAGON_SCALE);

        root.traverse(obj => {
            if (obj.name === 'Head') {
                this.headBone = obj;
            }
            if (obj instanceof T.Mesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                obj.frustumCulled = false;
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of mats) {
                    if (m instanceof T.MeshStandardMaterial) {
                        m.roughness = Math.min(0.88, Math.max(0.45, m.roughness));
                        m.envMapIntensity = 0.85;
                        this.dragonMats.push(m);
                    }
                }
            }
        });

        this.model = root;
        this.group.add(root);

        this.mixer = new T.AnimationMixer(root);
        for (const clip of gltf.animations) {
            const action = this.mixer.clipAction(clip);
            this.actions.set(clip.name, action);
        }

        const r = Math.random();
        if (r < 0.45) {
            this.enterState('SLEEP');
        } else if (r < 0.78) {
            this.enterState('SOAR_CIRCLE');
            this.position.y = this.sampleFloorY(this.territory.x, this.territory.z) + this.orbitAltitude;
        } else {
            this.enterState('PATROL_WALK');
        }
    }

    // =========================================================================
    // PLAYER-TO-BOSS DAMAGE & SKILL HITBOX API
    // =========================================================================
    applyDamage(baseDamage: number): boolean {
        if (!this.isAlive || baseDamage <= 0) return false;
        const roll = this.callbacks.damageMultiplier?.() ?? { scale: 1, crit: false };
        const dmg = Math.max(1, Math.round(baseDamage * roll.scale));
        this.hp = Math.max(0, this.hp - dmg);
        this.hitFlash = 0.18;
        this.aggroActive = true;
        this.callbacks.onHitFeedback?.(dmg, roll.crit);

        // Wake up immediately if struck while sleeping!
        if (this.state === 'SLEEP') {
            this.enterState('WAKE_UP');
        }
        if (this.hp <= 0) {
            this.enterState('DEFEATED');
            this.callbacks.onDefeat?.(DragonBoss.DISPLAY_NAME);
        }
        return true;
    }

    melee(from: T.Vector3, heading: number) {
        if (!this.isAlive) return;
        const dx = this.position.x - from.x;
        const dz = this.position.z - from.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 3.2 + BOSS_HIT_RADIUS || Math.abs(this.position.y - from.y) > BOSS_HIT_HEIGHT + 2.0) return;
        if (dx * Math.sin(heading) - dz * Math.cos(heading) < distance * 0.30) return;
        this.applyDamage(28);
    }

    swordTarget(from: T.Vector3, heading: number, range: number, senseActive = false) {
        if (!this.isAlive) return undefined;
        const forwardX = Math.sin(heading);
        const forwardZ = -Math.cos(heading);
        const dx = this.position.x - from.x;
        const dz = this.position.z - from.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz < 1.5 || horiz > range + BOSS_HIT_RADIUS) return undefined;
        const facing = (dx * forwardX + dz * forwardZ) / horiz;
        if (facing < (senseActive ? 0.72 : 0.82)) return undefined;
        const dy = Math.abs((this.position.y + BOSS_HIT_HEIGHT * 0.5) - (from.y + 1.2));
        if (dy > (senseActive ? 55 : 28)) return undefined;
        this.aimProxy.position.copy(this.position);
        this.aimProxy.health = this.hp;
        return this.aimProxy;
    }

    swordTravel(from: T.Vector3, to: T.Vector3, struck: Set<number>) {
        if (!this.isAlive || struck.has(BOSS_STRUCK_ID)) return;
        const move = this.tmpVec.subVectors(to, from);
        const lenSq = Math.max(1e-4, move.lengthSq());
        const closest = T.MathUtils.clamp(
            ((this.position.x - from.x) * move.x + (this.position.y + BOSS_HIT_HEIGHT * 0.45 - from.y) * move.y + (this.position.z - from.z) * move.z) / lenSq,
            0,
            1,
        );
        const px = from.x + move.x * closest;
        const py = from.y + move.y * closest;
        const pz = from.z + move.z * closest;
        const dHoriz = Math.hypot(this.position.x - px, this.position.z - pz);
        if (dHoriz <= BOSS_HIT_RADIUS + 1.8 && py >= this.position.y - 1.2 && py <= this.position.y + BOSS_HIT_HEIGHT + 1.5) {
            if (this.applyDamage(52)) struck.add(BOSS_STRUCK_ID);
        }
    }

    fireballContact(from: T.Vector3, to: T.Vector3): number | undefined {
        if (!this.isAlive) return undefined;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const lenSq = Math.max(1e-4, dx * dx + dz * dz);
        const along = T.MathUtils.clamp(((this.position.x - from.x) * dx + (this.position.z - from.z) * dz) / lenSq, 0, 1);
        const py = T.MathUtils.lerp(from.y, to.y, along);
        if (py < this.position.y - 1.0 || py > this.position.y + BOSS_HIT_HEIGHT + 1.2) return undefined;
        const dist = Math.hypot((this.position.x - from.x) - dx * along, (this.position.z - from.z) - dz * along);
        return dist <= BOSS_HIT_RADIUS + 0.9 ? along : undefined;
    }

    fireballBlast(point: T.Vector3, power = 0.5, directHit = false, radiusScale = 1) {
        if (!this.isAlive) return;
        const charge = T.MathUtils.clamp(power, 0, 1);
        const splashRadius = T.MathUtils.lerp(4.2, 6.8, charge) * radiusScale;
        const dist = Math.max(0, Math.hypot(this.position.x - point.x, this.position.z - point.z) - BOSS_HIT_RADIUS);
        const yOk = point.y >= this.position.y - 2.4 * radiusScale && point.y <= this.position.y + BOSS_HIT_HEIGHT + 3.2 * radiusScale;
        if (!yOk || dist > splashRadius + (directHit ? 2.0 : 0)) return;
        const dmg = directHit && dist <= 2.2 * radiusScale
            ? Math.round(T.MathUtils.lerp(34, 72, charge))
            : Math.round(T.MathUtils.lerp(42, 16, T.MathUtils.clamp(dist / splashRadius, 0, 1)));
        this.applyDamage(dmg);
    }

    giantSwordContact(from: T.Vector3, to: T.Vector3): number | undefined {
        if (!this.isAlive) return undefined;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const flatLenSq = dx * dx + dz * dz;
        const vertical = flatLenSq < 1e-4 && Math.abs(dy) > 1e-4;
        const bottom = this.position.y - 1.0;
        const top = this.position.y + BOSS_HIT_HEIGHT + 1.5;
        const along = T.MathUtils.clamp(
            vertical
                ? ((dy < 0 ? top : bottom) - from.y) / dy
                : ((this.position.x - from.x) * dx + (this.position.z - from.z) * dz) / Math.max(1e-4, flatLenSq),
            0,
            1,
        );
        const py = T.MathUtils.lerp(from.y, to.y, along);
        if (py < bottom || py > top) return undefined;
        const dist = Math.hypot((this.position.x - from.x) - dx * along, (this.position.z - from.z) - dz * along);
        return dist <= BOSS_HIT_RADIUS + 1.6 ? along : undefined;
    }

    giantSwordBlast(point: T.Vector3, directHit = false, splashRadius = 8.5) {
        if (!this.isAlive) return;
        const dist = Math.max(0, Math.hypot(this.position.x - point.x, this.position.z - point.z) - BOSS_HIT_RADIUS);
        const yOk = point.y >= this.position.y - 3.0 && point.y <= this.position.y + BOSS_HIT_HEIGHT + 4.0;
        if (!yOk || dist > splashRadius + (directHit ? 2.5 : 0)) return;
        const dmg = directHit && dist <= 2.8 ? 135 : Math.round(T.MathUtils.lerp(98, 48, T.MathUtils.clamp(dist / splashRadius, 0, 1)));
        this.applyDamage(dmg);
    }

    rainContact(sword: SwordRainContact) {
        if (!this.isAlive || sword.struck.has(BOSS_STRUCK_ID)) return;
        const dist = Math.hypot(sword.x - this.position.x, sword.z - this.position.z);
        const direct = dist <= BOSS_HIT_RADIUS + 1.2 && sword.fromY >= this.position.y - 0.5 && sword.toY <= this.position.y + BOSS_HIT_HEIGHT + 1.2;
        const nearby = sword.landed && dist <= BOSS_HIT_RADIUS + 2.6 && Math.abs(this.position.y - sword.toY) <= 3.5;
        if (!direct && !nearby) return;
        if (this.applyDamage(direct ? 24 : 15)) {
            sword.struck.add(BOSS_STRUCK_ID);
        }
    }

    // =========================================================================
    // DIVINE SENSE OPPRESSION (Astral Projection Only)
    // =========================================================================
    evaluateDivineSensePressure(
        probePos: T.Vector3,
        playerRealmIndex: number,
        playerStageIndex: number,
    ): { suppressed: boolean; pressure: number; triggeredBacklash: boolean } {
        if (!this.isAlive) {
            return { suppressed: false, pressure: 0, triggeredBacklash: false };
        }
        const belowMidNascent = playerRealmIndex < 3 || (playerRealmIndex === 3 && playerStageIndex < 1);
        if (!belowMidNascent) {
            return { suppressed: false, pressure: 0, triggeredBacklash: false };
        }
        const distToTerr = Math.hypot(probePos.x - this.territory.x, probePos.z - this.territory.z);
        const distToDragon = Math.hypot(probePos.x - this.position.x, probePos.z - this.position.z);
        const effDist = Math.min(distToTerr, distToDragon);
        const outerRadius = this.territory.radius + 170;
        const triggerRadius = this.territory.radius;
        if (effDist >= outerRadius) {
            return { suppressed: true, pressure: 0, triggeredBacklash: false };
        }
        const t = T.MathUtils.clamp((outerRadius - effDist) / Math.max(1, outerRadius - triggerRadius), 0, 1);
        const pressure = t * t * (3 - 2 * t);
        return {
            suppressed: true,
            pressure,
            triggeredBacklash: effDist <= triggerRadius,
        };
    }

    // =========================================================================
    // ANIMATION & STATE MACHINE
    // =========================================================================
    private playClip(name: string, fadeSec = 0.45, loop: T.AnimationActionLoopStyles = T.LoopRepeat, timeScale = 1.0, startTime = 0) {
        const next = this.actions.get(name);
        if (!next) return;
        next.reset();
        next.setLoop(loop, loop === T.LoopOnce ? 1 : Infinity);
        next.clampWhenFinished = loop === T.LoopOnce;
        next.timeScale = timeScale;
        if (startTime > 0) next.time = startTime;
        next.enabled = true;
        next.setEffectiveWeight(1);
        next.play();
        if (this.activeAction && this.activeAction !== next) {
            this.activeAction.crossFadeTo(next, fadeSec, false);
        }
        this.activeAction = next;
    }

    private pickPatrolWaypoint() {
        const angle = Math.random() * Math.PI * 2;
        const radius = 14 + Math.random() * 34;
        const wx = this.territory.x + Math.cos(angle) * radius;
        const wz = this.territory.z + Math.sin(angle) * radius;
        this.waypoint.set(wx, this.sampleFloorY(wx, wz), wz);
    }

    private enterState(next: DragonBossState, playerPos?: T.Vector3) {
        this.state = next;
        this.stateTime = 0;
        this.strikeDamageFired = false;
        this.breathTickAccum = 0;
        this.landingFx.resetSync();
        this.breathFx.setEmitting(false);

        switch (next) {
            case 'SLEEP':
                this.stateDuration = 18 + Math.random() * 14;
                this.playClip('Dragon_Sleep_Idle', 0.85, T.LoopRepeat, 1.0);
                break;

            case 'DEFEATED':
                this.respawnTimer = BOSS_RESPAWN_SEC;
                this.aggroActive = false;
                this.landingFx.triggerEvent('front_foot_impact', this.position.clone(), 1.1, DRAGON_SCALE * 0.85);
                this.callbacks.onSfx?.('impact');
                this.callbacks.onSfx?.('roar');
                this.playClip('Dragon_Sleep_Idle', 0.9, T.LoopRepeat, 0.25);
                break;

            case 'WAKE_UP':
                this.stateDuration = 4.0;
                this.callbacks.onSfx?.('roar');
                this.playClip('Dragon_Wake_Up', 0.25, T.LoopOnce, 1.0);
                break;

            case 'PATROL_WALK':
                this.stateDuration = 16 + Math.random() * 14;
                this.pickPatrolWaypoint();
                this.playClip('Dragon_Walk_Cycle', 0.45, T.LoopRepeat, this.aggroActive ? 1.35 : 1.0);
                break;

            case 'TAKEOFF':
                this.stateDuration = this.aggroActive ? 1.55 : 3.2;
                this.orbitAngle = Math.atan2(this.position.z - this.territory.z, this.position.x - this.territory.x);
                this.orbitRadius = 96 + Math.random() * 36;
                this.orbitAltitude = 48 + Math.random() * 20;
                this.playClip('Dragon_Flight_Cycle', 0.4, T.LoopRepeat, 1.35);
                break;

            case 'SOAR_CIRCLE':
                this.stateDuration = 22 + Math.random() * 16;
                this.orbitAngle = Math.atan2(this.position.z - this.territory.z, this.position.x - this.territory.x);
                this.orbitRadius = 96 + Math.random() * 36;
                this.orbitAltitude = 48 + Math.random() * 20;
                this.playClip('Dragon_Flight_Cycle', 0.6, T.LoopRepeat, 0.92);
                break;

            case 'LANDING':
                this.stateDuration = 3.6;
                if (this.aggroActive && playerPos) {
                    // Land near the player to resume close pressure
                    const dx = this.position.x - playerPos.x;
                    const dz = this.position.z - playerPos.z;
                    const d = Math.max(1, Math.hypot(dx, dz));
                    const lx = playerPos.x + (dx / d) * 16;
                    const lz = playerPos.z + (dz / d) * 16;
                    this.waypoint.set(lx, this.sampleFloorY(lx, lz), lz);
                } else {
                    this.waypoint.set(
                        this.territory.x + (Math.random() - 0.5) * 24,
                        this.sampleFloorY(this.territory.x, this.territory.z),
                        this.territory.z + (Math.random() - 0.5) * 24,
                    );
                }
                this.playClip('Dragon_Landing', 0.4, T.LoopOnce, 1.25);
                break;

            case 'TERRITORY_ROAR': {
                this.roarCooldown = 14;
                this.callbacks.onSfx?.('roar');
                const groundY = this.sampleFloorY(this.position.x, this.position.z);
                const airborne = this.position.y - groundY > 4.0;
                if (airborne) {
                    this.stateDuration = 9.17;
                    this.playClip('Dragon_Territory_Landing_Roar', 0.4, T.LoopOnce, 1.0, 0);
                } else {
                    this.stateDuration = 4.8;
                    this.playClip('Dragon_Territory_Landing_Roar', 0.35, T.LoopOnce, 1.0, 4.35);
                }
                if (playerPos) {
                    this.yaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                }
                break;
            }

            case 'BREATH_STRAFE': {
                this.breathCooldown = 11;
                this.stateDuration = 3.8;
                this.strafeGapClose = true;
                if (playerPos) {
                    this.strafeDir.set(playerPos.x - this.position.x, 0, playerPos.z - this.position.z);
                    if (this.strafeDir.lengthSq() < 1) this.strafeDir.set(0, 0, 1);
                    this.strafeDir.normalize();
                    this.yaw = Math.atan2(this.strafeDir.x, this.strafeDir.z);
                }
                this.playClip('Dragon_Low_Flight_Breath', 0.35, T.LoopOnce, 1.0);
                break;
            }

            case 'ATTACK_CLAW':
                this.attackCooldown = 2.4;
                this.clawImpactFired = false;
                this.stateDuration = 2.33;
                this.playClip('Dragon_Attack_ClawSwipe', 0.22, T.LoopOnce, 1.0);
                break;

            case 'ATTACK_BITE':
                this.attackCooldown = 2.6;
                this.stateDuration = 2.50;
                this.playClip('Dragon_Attack_BiteLunge', 0.22, T.LoopOnce, 1.0);
                break;

            case 'ATTACK_TAIL_WHIP':
                this.attackCooldown = 3.0;
                this.stateDuration = 2.67;
                this.playClip('Dragon_Attack_TailWhip', 0.22, T.LoopOnce, 1.0);
                break;

            case 'ATTACK_GROUND_BREATH':
                this.attackCooldown = 4.0;
                this.breathCooldown = 9.0;
                this.stateDuration = 3.50;
                this.playClip('Dragon_Attack_GroundBreath', 0.28, T.LoopOnce, 1.0);
                break;
        }
    }

    private tryHitPlayerCone(playerPos: T.Vector3, maxRange: number, maxHalfAngleRad: number, rawDamage: number, label: string, maxHeightDiff = 10) {
        const dx = playerPos.x - this.position.x;
        const dz = playerPos.z - this.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > maxRange || Math.abs(playerPos.y - this.position.y) > maxHeightDiff) return;
        const toPlayerYaw = Math.atan2(dx, dz);
        if (angleDiffAbs(toPlayerYaw, this.yaw) <= maxHalfAngleRad) {
            this.callbacks.onDamagePlayer?.(rawDamage, label);
        }
    }

    update(dt: number, playerPos: T.Vector3) {
        if (this.disposed || dt <= 0) return;
        const clampedDt = Math.min(dt, 0.05);

        const groundAtDragon = this.sampleFloorY(this.position.x, this.position.z);
        this.landingFx.update(clampedDt);

        if (!this.mixer || !this.model) {
            this.breathFx.update(clampedDt, this.position, this.tmpHeadDir, groundAtDragon, DRAGON_SCALE);
            return;
        }
        this.mixer.update(clampedDt);

        // Brief emissive hit flash on scales when struck by player skills
        if (this.hitFlash > 0) {
            this.hitFlash = Math.max(0, this.hitFlash - clampedDt);
            const em = (this.hitFlash / 0.18) * 0.65;
            for (const m of this.dragonMats) {
                m.emissive.setRGB(em, em * 0.35, em * 0.12);
            }
        }

        // Defeated dissolve & vanish -> clean respawn after timer
        if (this.state === 'DEFEATED') {
            this.stateTime += clampedDt;
            this.respawnTimer -= clampedDt;
            const fadeSec = 1.6;
            if (this.stateTime < fadeSec) {
                const u = this.stateTime / fadeSec;
                const alpha = 1 - u;
                for (const m of this.dragonMats) {
                    m.transparent = true;
                    m.opacity = alpha;
                    m.emissive.setRGB(u * 0.9, u * 0.32, u * 0.12);
                }
                this.position.y = T.MathUtils.lerp(this.position.y, groundAtDragon - 1.2 * u, 1 - Math.exp(-5 * clampedDt));
                this.group.position.copy(this.position);
                this.group.rotation.set(this.pitch, this.yaw, this.roll);
            } else if (this.group.visible) {
                this.group.visible = false;
            }
            if (this.respawnTimer <= 0) {
                this.hp = this.maxHp;
                for (const m of this.dragonMats) {
                    m.transparent = false;
                    m.opacity = 1;
                    m.emissive.setRGB(0, 0, 0);
                }
                this.group.visible = true;
                const baseY = this.sampleFloorY(this.territory.x, this.territory.z);
                this.position.set(this.territory.x + 6, baseY, this.territory.z - 8);
                this.enterState('SLEEP');
            }
            this.breathFx.update(clampedDt, this.position, this.tmpHeadDir, groundAtDragon, DRAGON_SCALE);
            return;
        }

        this.stateTime += clampedDt;
        if (this.roarCooldown > 0) this.roarCooldown = Math.max(0, this.roarCooldown - clampedDt);
        if (this.breathCooldown > 0) this.breathCooldown = Math.max(0, this.breathCooldown - clampedDt);
        if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - clampedDt);

        const distPlayerToTerr = Math.hypot(playerPos.x - this.territory.x, playerPos.z - this.territory.z);
        const distPlayerToDragon = Math.hypot(playerPos.x - this.position.x, playerPos.z - this.position.z);
        const playerGroundY = this.sampleFloorY(playerPos.x, playerPos.z);
        const playerAirborne = (playerPos.y - playerGroundY) > 10.0;

        if (!this.aggroActive && (distPlayerToTerr < AGGRO_RADIUS || distPlayerToDragon < AGGRO_RADIUS * 0.85)) {
            this.aggroActive = true;
        } else if (this.aggroActive && distPlayerToTerr > DEAGGRO_RADIUS && distPlayerToDragon > DEAGGRO_RADIUS) {
            this.aggroActive = false;
            // Slowly recover HP when player leaves the lair
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.04 * clampedDt);
        }

        switch (this.state) {
            case 'SLEEP':
                this.position.y = T.MathUtils.lerp(this.position.y, groundAtDragon, 1 - Math.exp(-8 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-6 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-6 * clampedDt));
                if (this.aggroActive || this.stateTime >= this.stateDuration) {
                    this.enterState('WAKE_UP', playerPos);
                }
                break;

            case 'WAKE_UP':
                this.position.y = T.MathUtils.lerp(this.position.y, groundAtDragon, 1 - Math.exp(-8 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-6 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-6 * clampedDt));
                if (this.stateTime >= this.stateDuration) {
                    if (this.aggroActive) {
                        this.enterState(distPlayerToDragon > 34 ? 'TAKEOFF' : 'TERRITORY_ROAR', playerPos);
                    } else {
                        this.enterState(Math.random() < 0.62 ? 'PATROL_WALK' : 'TAKEOFF');
                    }
                }
                break;

            case 'PATROL_WALK': {
                const target = this.aggroActive ? playerPos : this.waypoint;
                const dx = target.x - this.position.x;
                const dz = target.z - this.position.z;
                const dist = Math.hypot(dx, dz);

                if (this.aggroActive) {
                    if (this.activeAction) this.activeAction.timeScale = 1.45;
                    // If player flies up OR pulls away far (> 36m), launch low-altitude strafe breath to close the gap!
                    if (playerAirborne || (dist > 36 && this.breathCooldown <= 0)) {
                        this.enterState('TAKEOFF', playerPos);
                        break;
                    }

                    const desiredYaw = Math.atan2(dx, dz);
                    let relAngle = ((desiredYaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
                    if (relAngle < -Math.PI) relAngle += Math.PI * 2;

                    // Position-aware Boss combat selection — NEVER swing in place out of range!
                    if (this.attackCooldown <= 0) {
                        if (Math.abs(relAngle) > Math.PI * 0.58 && dist < 30) {
                            this.enterState('ATTACK_TAIL_WHIP', playerPos);
                            break;
                        }
                        if (dist < 22 && Math.abs(relAngle) < Math.PI * 0.45) {
                            this.enterState(Math.random() < 0.52 ? 'ATTACK_CLAW' : 'ATTACK_BITE', playerPos);
                            break;
                        }
                        if (dist >= 22 && dist <= 44 && Math.abs(relAngle) < Math.PI * 0.42 && this.breathCooldown <= 0) {
                            this.enterState('ATTACK_GROUND_BREATH', playerPos);
                            break;
                        }
                        if (dist < 26 && this.roarCooldown <= 0) {
                            this.enterState('TERRITORY_ROAR', playerPos);
                            break;
                        }
                    }

                    // Actively chase player to close distance!
                    this.yaw = dampAngle(this.yaw, desiredYaw, 3.8, clampedDt);
                    if (dist > 15) {
                        this.position.x += Math.sin(this.yaw) * CHASE_SPEED * clampedDt;
                        this.position.z += Math.cos(this.yaw) * CHASE_SPEED * clampedDt;
                    }
                } else {
                    if (this.activeAction) this.activeAction.timeScale = 1.0;
                    if (dist < 4.0) {
                        this.pickPatrolWaypoint();
                    } else {
                        const desiredYaw = Math.atan2(dx, dz);
                        this.yaw = dampAngle(this.yaw, desiredYaw, 2.2, clampedDt);
                        this.position.x += Math.sin(this.yaw) * WALK_SPEED * clampedDt;
                        this.position.z += Math.cos(this.yaw) * WALK_SPEED * clampedDt;
                    }
                    if (this.stateTime >= this.stateDuration) {
                        this.enterState(Math.random() < 0.5 ? 'SLEEP' : 'TAKEOFF');
                        break;
                    }
                }
                const ny = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, ny, 1 - Math.exp(-10 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-6 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-6 * clampedDt));
                break;
            }

            case 'TAKEOFF': {
                const t = T.MathUtils.clamp(this.stateTime / this.stateDuration, 0, 1);
                const ease = t * t * (3 - 2 * t);
                if (this.aggroActive) {
                    // Quick combat takeoff aiming right at the player for a low gap-closing fire strafe!
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 4.0, clampedDt);
                    const targetAlt = playerAirborne
                        ? Math.max(groundAtDragon + 12, playerPos.y + 5)
                        : groundAtDragon + 10.5;
                    this.position.y = T.MathUtils.lerp(this.position.y, targetAlt, 1 - Math.exp(-4.2 * clampedDt));
                    this.position.x += Math.sin(this.yaw) * 14 * clampedDt;
                    this.position.z += Math.cos(this.yaw) * 14 * clampedDt;
                    this.pitch = T.MathUtils.lerp(this.pitch, -0.18 * (1 - t), 1 - Math.exp(-4 * clampedDt));
                    this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-4 * clampedDt));
                } else {
                    this.orbitAngle += (SOAR_SPEED / this.orbitRadius) * clampedDt;
                    const tx = this.territory.x + Math.cos(this.orbitAngle) * (this.orbitRadius * (0.35 + 0.65 * ease));
                    const tz = this.territory.z + Math.sin(this.orbitAngle) * (this.orbitRadius * (0.35 + 0.65 * ease));
                    const desiredYaw = Math.atan2(tx - this.position.x, tz - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 3.0, clampedDt);
                    this.position.x = T.MathUtils.lerp(this.position.x, tx, 1 - Math.exp(-2.2 * clampedDt));
                    this.position.z = T.MathUtils.lerp(this.position.z, tz, 1 - Math.exp(-2.2 * clampedDt));
                    const targetAlt = this.sampleFloorY(this.position.x, this.position.z) + this.orbitAltitude * ease;
                    this.position.y = T.MathUtils.lerp(this.position.y, targetAlt, 1 - Math.exp(-3.5 * clampedDt));
                    this.pitch = T.MathUtils.lerp(this.pitch, -0.22 * (1 - t), 1 - Math.exp(-4 * clampedDt));
                    this.roll = T.MathUtils.lerp(this.roll, -0.22, 1 - Math.exp(-3 * clampedDt));
                }
                if (this.stateTime >= this.stateDuration) {
                    if (this.aggroActive && (playerAirborne || this.breathCooldown <= 0 || distPlayerToDragon > 28)) {
                        this.enterState('BREATH_STRAFE', playerPos);
                    } else {
                        this.enterState('SOAR_CIRCLE');
                    }
                }
                break;
            }

            case 'SOAR_CIRCLE': {
                const angVel = SOAR_SPEED / this.orbitRadius;
                this.orbitAngle += angVel * clampedDt;
                const tx = this.territory.x + Math.cos(this.orbitAngle) * this.orbitRadius;
                const tz = this.territory.z + Math.sin(this.orbitAngle) * this.orbitRadius;
                const desiredYaw = Math.atan2(tx - this.position.x, tz - this.position.z);
                this.yaw = dampAngle(this.yaw, desiredYaw, 3.5, clampedDt);
                this.position.x = T.MathUtils.lerp(this.position.x, tx, 1 - Math.exp(-4 * clampedDt));
                this.position.z = T.MathUtils.lerp(this.position.z, tz, 1 - Math.exp(-4 * clampedDt));
                const wave = Math.sin(this.stateTime * 0.65) * 4.5;
                const baseOrbitY = playerAirborne && this.aggroActive
                    ? Math.max(playerPos.y + 10.0, this.sampleFloorY(this.territory.x, this.territory.z) + 28.0)
                    : this.sampleFloorY(this.territory.x, this.territory.z) + this.orbitAltitude;
                const targetY = baseOrbitY + wave;
                this.position.y = T.MathUtils.lerp(this.position.y, targetY, 1 - Math.exp(-2.5 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, -0.28, 1 - Math.exp(-3 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, Math.cos(this.stateTime * 0.65) * 0.06, 1 - Math.exp(-3 * clampedDt));

                if (this.aggroActive && this.stateTime > (playerAirborne ? 1.8 : 2.6)) {
                    if (playerAirborne || this.breathCooldown <= 0) {
                        this.enterState('BREATH_STRAFE', playerPos);
                    } else {
                        this.enterState('LANDING', playerPos);
                    }
                } else if (this.stateTime >= this.stateDuration) {
                    this.enterState('LANDING');
                }
                break;
            }

            case 'LANDING': {
                const t = T.MathUtils.clamp(this.stateTime / 1.8, 0, 1);
                const ease = t * t * (3 - 2 * t);
                const desiredYaw = Math.atan2(this.waypoint.x - this.position.x, this.waypoint.z - this.position.z);
                if (t < 0.85) this.yaw = dampAngle(this.yaw, desiredYaw, 3.2, clampedDt);
                this.position.x = T.MathUtils.lerp(this.position.x, this.waypoint.x, 1 - Math.exp(-3.2 * clampedDt));
                this.position.z = T.MathUtils.lerp(this.position.z, this.waypoint.z, 1 - Math.exp(-3.2 * clampedDt));
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, ease > 0.85 ? 1 - Math.exp(-12 * clampedDt) : 1 - Math.exp(-3.5 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-5 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-5 * clampedDt));

                const clipTime = this.activeAction?.time ?? this.stateTime;
                this.landingFx.syncWithAnimationTime(clipTime, this.position, this.yaw, DRAGON_SCALE);

                if (this.stateTime >= this.stateDuration) {
                    this.enterState(this.aggroActive ? 'PATROL_WALK' : (Math.random() < 0.55 ? 'PATROL_WALK' : 'SLEEP'), playerPos);
                }
                break;
            }

            case 'TERRITORY_ROAR': {
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, 1 - Math.exp(-6 * clampedDt));
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-6 * clampedDt));
                this.pitch = T.MathUtils.lerp(this.pitch, 0, 1 - Math.exp(-6 * clampedDt));
                if (this.stateTime < 1.2) {
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 3.0, clampedDt);
                }
                if (!this.strikeDamageFired && this.stateTime >= 1.55) {
                    this.strikeDamageFired = true;
                    this.tryHitPlayerCone(playerPos, 30, Math.PI * 0.65, 48, '蚀渊古龙 · 血煞龙威', 14);
                }
                if (this.stateTime >= this.stateDuration) {
                    this.enterState('PATROL_WALK', playerPos);
                }
                break;
            }

            case 'BREATH_STRAFE': {
                // Low-altitude ground-skimming fire-breath dive (closes distance fast on distant grounded players,
                // or actively tracks & chases flying players in 3D!)
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                if (this.aggroActive) {
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, playerAirborne ? 2.6 : 2.0, clampedDt);
                    this.strafeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
                    const targetAlt = playerAirborne
                        ? Math.max(floorY + 12.0, playerPos.y + 4.5)
                        : floorY + 8.0; // Low ground-skimming strafe!
                    const dy = targetAlt - this.position.y;
                    this.position.y = T.MathUtils.lerp(this.position.y, targetAlt, 1 - Math.exp(-3.8 * clampedDt));
                    this.pitch = T.MathUtils.lerp(this.pitch, T.MathUtils.clamp(-dy * 0.015, -0.24, 0.22), 1 - Math.exp(-4 * clampedDt));
                }
                this.position.x += this.strafeDir.x * STRAFE_SPEED * clampedDt;
                this.position.z += this.strafeDir.z * STRAFE_SPEED * clampedDt;
                this.roll = T.MathUtils.lerp(this.roll, 0, 1 - Math.exp(-5 * clampedDt));

                const clipTime = this.activeAction?.time ?? this.stateTime;
                this.breathFx.syncWithAnimationTime(clipTime);

                // Periodic flame stream damage tick while breathing (1.08s..2.83s)
                if (clipTime >= 1.05 && clipTime <= 2.85) {
                    if (distPlayerToDragon < 140) this.callbacks.onSfx?.('breath');
                    this.breathTickAccum += clampedDt;
                    if (this.breathTickAccum >= 0.42) {
                        this.breathTickAccum = 0;
                        this.tryHitPlayerCone(playerPos, 48, Math.PI * 0.28, 56, '蚀渊古龙 · 贴地焚焰', 22);
                    }
                }

                if (this.stateTime >= this.stateDuration) {
                    // Land near player if grounded to resume fierce melee pressure, else circle in sky!
                    if (this.aggroActive && !playerAirborne && this.strafeGapClose) {
                        this.enterState('LANDING', playerPos);
                    } else {
                        this.enterState('SOAR_CIRCLE');
                    }
                }
                break;
            }

            case 'ATTACK_CLAW': {
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, 1 - Math.exp(-8 * clampedDt));
                if (this.stateTime < 0.72) {
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 3.8, clampedDt);
                }
                if (!this.clawImpactFired && this.stateTime >= 0.96) {
                    this.clawImpactFired = true;
                    const hitPos = new T.Vector3(
                        this.position.x + Math.sin(this.yaw) * (0.45 * DRAGON_SCALE),
                        floorY,
                        this.position.z + Math.cos(this.yaw) * (0.45 * DRAGON_SCALE),
                    );
                    this.landingFx.triggerEvent('front_foot_impact', hitPos, 0.85, DRAGON_SCALE * 0.75);
                    this.callbacks.onSfx?.('impact');
                    this.tryHitPlayerCone(playerPos, 26, Math.PI * 0.42, 68, '蚀渊古龙 · 裂地重爪', 11);
                }
                if (this.stateTime >= this.stateDuration) {
                    this.enterState('PATROL_WALK', playerPos);
                }
                break;
            }

            case 'ATTACK_BITE': {
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, 1 - Math.exp(-8 * clampedDt));
                if (this.stateTime < 0.85) {
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 4.2, clampedDt);
                }
                if (!this.strikeDamageFired && this.stateTime >= 1.05) {
                    this.strikeDamageFired = true;
                    this.tryHitPlayerCone(playerPos, 30, Math.PI * 0.28, 84, '蚀渊古龙 · 龙颌噬咬', 11);
                }
                if (this.stateTime >= this.stateDuration) {
                    this.enterState('PATROL_WALK', playerPos);
                }
                break;
            }

            case 'ATTACK_TAIL_WHIP': {
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, 1 - Math.exp(-8 * clampedDt));
                if (!this.strikeDamageFired && this.stateTime >= 1.08) {
                    this.strikeDamageFired = true;
                    // Wide 360/rear-flank sweep around the dragon
                    if (distPlayerToDragon <= 34 && Math.abs(playerPos.y - this.position.y) <= 10) {
                        this.callbacks.onDamagePlayer?.(74, '蚀渊古龙 · 神龙摆尾');
                    }
                }
                if (this.stateTime >= this.stateDuration) {
                    this.enterState('PATROL_WALK', playerPos);
                }
                break;
            }

            case 'ATTACK_GROUND_BREATH': {
                const floorY = this.sampleFloorY(this.position.x, this.position.z);
                this.position.y = T.MathUtils.lerp(this.position.y, floorY, 1 - Math.exp(-8 * clampedDt));
                if (this.stateTime < 0.9) {
                    const desiredYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
                    this.yaw = dampAngle(this.yaw, desiredYaw, 3.2, clampedDt);
                }
                const firing = this.stateTime >= 1.08 && this.stateTime <= 2.67;
                this.breathFx.setEmitting(firing);
                if (firing) {
                    if (distPlayerToDragon < 140) this.callbacks.onSfx?.('breath');
                    this.breathTickAccum += clampedDt;
                    if (this.breathTickAccum >= 0.44) {
                        this.breathTickAccum = 0;
                        this.tryHitPlayerCone(playerPos, 54, Math.PI * 0.34, 46, '蚀渊古龙 · 炽炎龙息', 14);
                    }
                }
                if (this.stateTime >= this.stateDuration) {
                    this.breathFx.setEmitting(false);
                    this.enterState('PATROL_WALK', playerPos);
                }
                break;
            }
        }

        this.group.position.copy(this.position);
        this.group.rotation.order = 'YXZ';
        this.group.rotation.set(this.pitch, this.yaw, this.roll);
        this.group.updateMatrixWorld(true);

        // Fire-breath particle emitter anchored cleanly inside the open mouth along Head +Y forward axis
        if (this.headBone) {
            this.tmpHeadPos.set(0, 0.115, -0.042);
            this.headBone.localToWorld(this.tmpHeadPos);
            if (this.state === 'BREATH_STRAFE' && playerAirborne && this.aggroActive) {
                this.tmpHeadDir.subVectors(playerPos, this.tmpHeadPos).normalize();
            } else {
                this.headBone.getWorldQuaternion(this.tmpQuat);
                this.tmpHeadDir.set(0, 1, -0.14).normalize().applyQuaternion(this.tmpQuat);
            }
        } else {
            this.tmpHeadPos.copy(this.position).add(new T.Vector3(Math.sin(this.yaw) * 6, 3, Math.cos(this.yaw) * 6));
            this.tmpHeadDir.set(Math.sin(this.yaw), -0.35, Math.cos(this.yaw)).normalize();
        }
        this.breathFx.update(clampedDt, this.tmpHeadPos, this.tmpHeadDir, groundAtDragon, DRAGON_SCALE);
    }

    private disposeGltf(gltf: GLTF) {
        const geos = new Set<T.BufferGeometry>();
        const mats = new Set<T.Material>();
        gltf.scene.traverse(obj => {
            if (!(obj instanceof T.Mesh)) return;
            geos.add(obj.geometry);
            for (const m of [obj.material].flat()) mats.add(m);
        });
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
    }

    dispose() {
        this.disposed = true;
        this.mixer?.stopAllAction();
        this.landingFx.dispose();
        this.breathFx.dispose();
        if (this.gltf) {
            this.disposeGltf(this.gltf);
            this.gltf = undefined;
        }
        this.group.removeFromParent();
    }
}
