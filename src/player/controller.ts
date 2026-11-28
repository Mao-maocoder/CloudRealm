import{resolveStructures,structureFloor}from '../world/physics/solid-world';
import{waterSurfaceAt}from '../world/geo/geo-core';
import * as T from 'three';
import { config, readArtStyle } from '../config/settings';
import { heightAt } from '../world/geo/height';
import { shrineFloor, shrineHeading, valleySpawn } from '../world/geo/spawn-site';
import { Input } from './input';
import { Avatar } from './avatar';
import { radialShadowTexture } from '../rendering/materials';
import {floatingFloor} from '../world/geo/regions';
import type { FlightProfile, SkillId } from './cultivation';

export interface PlayerGates {
    canStartFlight?: () => boolean;
    onFlightStep?: (dt: number, intensity: 'hover' | 'cruise' | 'boost') => boolean;
    canCastSkill?: (skill: SkillId) => boolean;
    onConsumeSkill?: (skill: SkillId) => boolean;
    onSkywalkToggle?: (skyWalking: boolean) => void;
    shouldHideBody?: () => boolean;
}

const DEFAULT_FLIGHT_PROFILE: FlightProfile = {
    mode: 'sword',
    slow: config.slow,
    cruise: config.cruise,
    boost: config.boost,
    minMp: 0,
    hoverDrain: 0,
    cruiseDrain: 0,
    boostDrain: 0,
};

export class Player {
    readonly position = new T.Vector3();
    readonly velocity = new T.Vector3();
    readonly avatar = new Avatar();
    readonly shadow: T.Mesh;
    flightProfile: FlightProfile = DEFAULT_FLIGHT_PROFILE;
    flying = false;
    boosting = false;
    skyWalking = false;
    escapeLight = false;
    swimming = false;
    grounded = true;
    heading = 0;
    bank = 0;
    private swimOffset = 0;
    private previousSwimOffset = 0;
    private previousPosition = new T.Vector3();
    private readonly scratchForward = new T.Vector3();
    private readonly scratchRight = new T.Vector3();
    private readonly scratchMove = new T.Vector3();
    private readonly scratchBefore = new T.Vector3();
    private previousHeading = 0;
    private previousBank = 0;
    private lean = 0;
    private previousLean = 0;
    private takeoffOffset = 0;
    private previousTakeoffOffset = 0;
    private jumpHeld = false;
    private attackHeading = 0;
    private fireballHeld = false;
    private fireballCharge = 0;
    get fireballPower() { return T.MathUtils.smoothstep(this.fireballCharge, .06, 1.24); }
    get voidFlying() { return this.flying && this.flightProfile.mode === 'void'; }

    constructor(
        readonly input: Input,
        scene: T.Scene,
        private onHeavyHit?: (position: T.Vector3, heading: number) => void,
        private onSkillCast?: (position: T.Vector3) => void,
        private onLightHit?: (position: T.Vector3, heading: number) => void,
        private resolveWildlife?: (position: T.Vector3, previous: T.Vector3, velocity: T.Vector3) => void,
        private onFireballCast?: (power: number) => void,
        private gates?: PlayerGates,
    ) {
        scene.add(this.avatar);
        const shadowMaterial = new T.MeshBasicMaterial({
            color: '#20303a',
            map: radialShadowTexture(),
            transparent: true,
            opacity: .32,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
        });
        this.shadow = new T.Mesh(new T.PlaneGeometry(1, 1), shadowMaterial);
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.renderOrder = 2;
        scene.add(this.shadow);
        this.reset();
    }

    setFlightProfile(profile: FlightProfile) {
        const prevMode = this.flightProfile.mode;
        this.flightProfile = profile;
        if (this.flying && prevMode !== profile.mode) {
            if (profile.mode === 'void') {
                this.skyWalking = false;
                this.escapeLight = false;
                this.avatar.enterVoidFlight();
            } else {
                this.skyWalking = false;
                this.escapeLight = false;
                this.avatar.mount();
            }
        }
    }

    reset() {
        this.position.set(valleySpawn.x, 0, valleySpawn.z);
        const guofeng = readArtStyle() === 'guofeng';
        this.position.y = guofeng ? shrineFloor : this.floor(this.position.x, this.position.z);
        this.place(false, guofeng ? shrineHeading : 0, -.12);
    }
    solidFloor(x: number, z: number, fromY = this.position.y) {
        return Math.max(structureFloor(x, z, fromY), heightAt(x, z), floatingFloor(x, z, fromY));
    }
    floor(x: number, z: number, fromY = this.position.y) {
        return Math.max(this.solidFloor(x, z, fromY), waterSurfaceAt(x, z));
    }
    teleport(x: number, y: number, z: number, yaw = 0, pitch = -.25) {
        this.position.set(x, y, z);
        this.position.y = Math.max(y, this.floor(x, z) + 2);
        this.place(true, yaw, pitch);
    }

    /** Drives the cultivator's levitating position & Blender ritual animation during the Nascent Soul breakthrough ceremony. */
    stepRitual(dt: number, worldPos: T.Vector3, heading: number, ritualPose: 'meditate' | 'burst') {
        this.velocity.set(0, 0, 0);
        this.position.copy(worldPos);
        this.previousPosition.copy(worldPos);
        this.heading = this.previousHeading = heading;
        this.bank = this.previousBank = 0;
        this.lean = this.previousLean = 0;
        this.flying = true;
        this.grounded = false;
        this.boosting = false;
        this.swimming = false;
        this.avatar.position.copy(worldPos);
        this.avatar.rotation.set(0, Math.PI - heading, 0, 'YXZ');
        this.avatar.update(dt, true, false, false, 0, false, false, false, true, false, false, ritualPose);
        this.updateShadow();
    }

    /** Holds the cultivator in serene cross-legged meditation while consciousness projects out of body. */
    stepMeditate(dt: number, anchorPos: T.Vector3, heading: number, time: number) {
        this.velocity.set(0, 0, 0);
        const hoverY = anchorPos.y + 0.55 + Math.sin(time * 1.9) * 0.14;
        this.position.set(anchorPos.x, hoverY, anchorPos.z);
        this.previousPosition.copy(this.position);
        this.heading = this.previousHeading = heading;
        this.bank = this.previousBank = 0;
        this.lean = this.previousLean = 0;
        this.boosting = false;
        this.escapeLight = false;
        this.avatar.position.copy(this.position);
        this.avatar.rotation.set(0, Math.PI - heading, 0, 'YXZ');
        this.avatar.update(dt, true, false, false, 0, false, false, false, true, false, false, 'meditate');
        this.updateShadow();
    }

    /** Pins the cultivator to the ground in a hunched, immobilized bracing pose under Dragon Boss gravity pressure. */
    stepSuppressed(dt: number, anchorPos: T.Vector3, heading: number) {
        this.velocity.set(0, 0, 0);
        this.flying = false;
        this.grounded = true;
        this.boosting = false;
        this.skyWalking = false;
        this.escapeLight = false;
        this.swimming = false;
        const alpha = 1 - Math.exp(-14 * dt);
        this.position.lerp(anchorPos, alpha);
        this.previousPosition.copy(this.position);
        this.heading = this.previousHeading = heading;
        this.bank = this.previousBank = 0;
        this.lean = this.previousLean = 0;
        this.avatar.position.copy(this.position);
        this.avatar.rotation.set(0, Math.PI - heading, 0, 'YXZ');
        this.avatar.update(dt, false, true, false, 0, false, false, false, false, false, false, 'pressure');
        this.updateShadow();
    }

    /** Hands back control after the ceremony in graceful Nascent Soul midair hover. */
    finishBreakthroughHover(worldPos: T.Vector3, heading: number) {
        this.position.copy(worldPos);
        this.previousPosition.copy(worldPos);
        this.velocity.set(0, 0, 0);
        this.heading = this.previousHeading = this.input.yaw = heading;
        this.input.pitch = -0.06;
        this.flying = true;
        this.grounded = false;
        this.boosting = false;
        this.skyWalking = false;
        this.escapeLight = false;
        this.swimming = false;
        this.avatar.enterVoidFlight();
        this.syncRender(1);
    }
    private place(flying: boolean, yaw: number, pitch: number) {
        this.velocity.set(0, 0, 0);
        this.flying = flying;
        this.boosting = false;
        this.skyWalking = false;
        this.escapeLight = false;
        this.swimming = false;
        this.grounded = !flying;
        this.jumpHeld = false;
        this.fireballHeld = false;
        this.fireballCharge = 0;
        this.heading = this.input.yaw = this.previousHeading = yaw;
        this.input.pitch = pitch;
        this.bank = this.previousBank = 0;
        this.lean = this.previousLean = 0;
        this.takeoffOffset = this.previousTakeoffOffset = 0;
        this.swimOffset = this.previousSwimOffset = 0;
        this.previousPosition.copy(this.position);
        this.avatar.reset(flying, this.flightProfile.mode === 'void');
        this.syncRender(1);
    }
    private updateShadow() {
        this.shadow.visible = !this.swimming && !this.escapeLight;
        if (!this.shadow.visible) return;
        const rendered = this.avatar.position;
        const ground = this.floor(rendered.x, rendered.z);
        const gap = Math.max(0, rendered.y - ground);
        this.shadow.position.set(rendered.x, ground + .08, rendered.z);
        const scale = 2.1 + gap * .16;
        this.shadow.scale.set(scale, scale, 1);
        (this.shadow.material as T.MeshBasicMaterial).opacity = .16 * T.MathUtils.clamp(1 - gap / 26, .08, 1);
    }
    step(dt: number, active = true) {
        const wasGrounded=this.grounded;
        this.previousPosition.copy(this.position);
        this.previousHeading=this.heading;
        this.previousBank=this.bank;
        this.previousLean=this.lean;
        this.previousTakeoffOffset = this.takeoffOffset;
        this.takeoffOffset = Math.max(0, this.takeoffOffset - 3.5 * dt);
        this.previousSwimOffset = this.swimOffset;

        const voidMode = this.flightProfile.mode === 'void';

        if (this.input.take('KeyF') && active) {
            if (!this.flying) {
                if (this.gates?.canStartFlight?.() ?? true) {
                    this.flying = true;
                    this.skyWalking = false;
                    this.escapeLight = false;
                    if (this.swimming) {
                        this.swimming = false;
                        this.swimOffset = 0;
                    }
                    const lift = voidMode ? 2.2 : 2.5;
                    this.position.y += lift;
                    this.takeoffOffset += lift;
                    this.grounded = false;
                    this.velocity.y = 0;
                    if (voidMode) this.avatar.enterVoidFlight();
                    else this.avatar.mount();
                }
            } else {
                this.flying = false;
                this.skyWalking = false;
                this.boosting = false;
                this.escapeLight = false;
            }
        }

        if (this.input.take('KeyV') && active && this.flying && voidMode) {
            this.skyWalking = !this.skyWalking;
            if (this.skyWalking) {
                this.boosting = false;
                this.escapeLight = false;
                this.velocity.y *= 0.2;
            }
            this.gates?.onSkywalkToggle?.(this.skyWalking);
        }

        const input = this.input as Input & { moveX?: number; moveZ?: number; sprint?: boolean };
        const boost = active && (input.has('ShiftLeft') || input.has('ShiftRight') || Boolean(input.sprint));
        const w = active && input.has('KeyW') ? 1 : 0, s = active && input.has('KeyS') ? 1 : 0, a = active && input.has('KeyA') ? 1 : 0, d = active && input.has('KeyD') ? 1 : 0, up = active && input.has('Space') ? 1 : 0, down = active && (input.has('ControlLeft') || input.has('ControlRight')) ? 1 : 0;
        const axisX = T.MathUtils.clamp((d - a) + (active ? (input.moveX ?? 0) : 0), -1, 1);
        const axisZ = T.MathUtils.clamp((w - s) + (active ? (input.moveZ ?? 0) : 0), -1, 1);
        const movingInput = Math.abs(axisX) > .04 || Math.abs(axisZ) > .04;
        const jumpPressed = input.take('Space') || (up && !this.jumpHeld);
        this.jumpHeld = !!up;
        const heavy = input.take('AttackHeavy'), light = input.take('AttackLight');
        const skywalkCombat = this.flying && voidMode && this.skyWalking;
        const canUseSword = active && (!this.flying || skywalkCombat) && !this.swimming && (this.grounded || skywalkCombat);
        if (input.take('KeyX') && canUseSword) this.avatar.toggleSword();

        const skillPressed = input.take('KeyQ') && canUseSword;
        let skill = false;
        if (skillPressed && !this.avatar.casting && this.avatar.fireballTime === undefined && !this.avatar.giantSwordCasting) {
            if (this.gates?.canCastSkill ? this.gates.canCastSkill('swordArray') : true) {
                skill = true;
            }
        }

        const giantPressed = input.take('Digit1') && canUseSword && !skill && !this.avatar.actionLocked;
        let giantSword = false;
        if (giantPressed) {
            if (this.gates?.canCastSkill ? this.gates.canCastSkill('giantSword') : true) {
                if (this.avatar.requestGiantSword()) {
                    if (this.gates?.onConsumeSkill ? this.gates.onConsumeSkill('giantSword') : true) {
                        giantSword = true;
                    } else {
                        this.avatar.cancelGiantSword();
                    }
                }
            }
        }
        if (giantSword) this.attackHeading = input.yaw;
        if (this.avatar.giantSwordCasting) {
            if (!canUseSword) this.avatar.cancelGiantSword();
            else this.attackHeading = input.yaw;
        }

        let attack: 'light' | 'heavy' | undefined;
        if (canUseSword && !giantSword) {
            if (heavy) {
                if (this.gates?.canCastSkill ? this.gates.canCastSkill('swordWave') : true) {
                    attack = 'heavy';
                }
            } else if (light) {
                attack = 'light';
            }
        }

        const actionLocked = this.avatar.actionLocked;
        const releaseFireball = input.take('FireballRelease');
        const fireballPressed = input.take('KeyE') && canUseSword && !skill && !giantSword && !attack;
        let fireball = false;
        if (fireballPressed) {
            if (this.gates?.canCastSkill ? this.gates.canCastSkill('fireball') : true) {
                if (this.avatar.requestFireball()) {
                    if (this.gates?.onConsumeSkill ? this.gates.onConsumeSkill('fireball') : true) {
                        fireball = true;
                    } else {
                        this.avatar.cancelFireball();
                    }
                }
            }
        }
        if (fireball) {
            this.fireballHeld = true;
            this.fireballCharge = 0;
        }
        if (this.avatar.fireballTime !== undefined) {
            if (!canUseSword || (this.fireballHeld && !releaseFireball && !input.has('KeyE'))) {
                this.avatar.cancelFireball();
                this.fireballHeld = false;
            } else {
                this.attackHeading = input.yaw;
                if (releaseFireball) this.fireballHeld = false;
                else if (this.fireballHeld) this.fireballCharge = Math.min(1.24, this.fireballCharge + dt);
            }
        } else this.fireballHeld = false;

        if ((skill || attack) && this.avatar.fireballTime === undefined && !this.avatar.giantSwordCasting) {
            if (!this.avatar.movementLocked && (skill || attack === 'heavy')) this.attackHeading = input.yaw;
            if (skill) {
                if (this.gates?.onConsumeSkill ? this.gates.onConsumeSkill('swordArray') : true) {
                    this.avatar.requestSkill();
                }
            } else if (attack) {
                if (attack === 'heavy') {
                    if (!this.avatar.heavyQueued && (this.gates?.onConsumeSkill ? this.gates.onConsumeSkill('swordWave') : true)) {
                        this.avatar.requestAttack(attack);
                    }
                } else {
                    this.avatar.requestAttack(attack);
                }
            }
        }

        const movementLocked = this.avatar.movementLocked;
        let facing = this.heading;
        if (this.flying && !skywalkCombat) facing = input.yaw;
        else if (movementLocked) facing = this.attackHeading;
        else if (attack === 'heavy' || this.avatar.heavyAttacking) facing = input.yaw;
        else if (movingInput) facing = input.yaw + Math.atan2(axisX, axisZ);
        else if (attack === 'light' || this.avatar.lightAttacking) facing = input.yaw;
        const delta = Math.atan2(Math.sin(facing - this.heading), Math.cos(facing - this.heading));
        const turnRate = (this.flying && !skywalkCombat)
            ? (voidMode ? 4.2 : 1.6)
            : this.swimming
                ? 7.5
                : (attack === 'heavy' || this.avatar.heavyAttacking) ? 22 : 16;
        const turn = active ? T.MathUtils.clamp(delta, -turnRate * dt, turnRate * dt) : 0;
        this.heading += turn;
        this.bank = T.MathUtils.damp(this.bank, (this.flying && !skywalkCombat) ? -turn / dt * (voidMode ? .12 : .2) : 0, 6, dt);
        const yaw = (this.flying && !skywalkCombat) ? this.heading : input.yaw;
        const forward = this.scratchForward.set(Math.sin(yaw), 0, -Math.cos(yaw));
        const right = this.scratchRight.set(Math.cos(yaw), 0, Math.sin(yaw));
        const reverseFly = axisZ < -.25;

        if (this.flying && voidMode && this.skyWalking) {
            // Nascent Soul Skywalk: walk/sprint freely on empty air with altitude lock
            this.boosting = false;
            this.escapeLight = false;
            const move = movementLocked
                ? this.scratchMove.set(0, 0, 0)
                : this.scratchMove.copy(forward).multiplyScalar(axisZ).addScaledVector(right, axisX);
            const mag = Math.min(1, move.length());
            if (mag > 0.001) {
                const pace = (boost ? 13 : 6.2) * mag;
                move.normalize().multiplyScalar(pace);
            }
            this.velocity.x = T.MathUtils.damp(this.velocity.x, move.x, 10, dt);
            this.velocity.z = T.MathUtils.damp(this.velocity.z, move.z, 10, dt);
            const vertTarget = active && !movementLocked ? (up - down) * 9.5 : 0;
            this.velocity.y = T.MathUtils.damp(this.velocity.y, vertTarget, 9, dt);
        } else if (this.flying && voidMode) {
            // Nascent Soul Void Flight: hover on release, human-model cruise, Shift -> Escape Light (遁光)
            this.boosting = boost && !reverseFly;
            this.escapeLight = this.boosting;
            const steer = active;
            const target = this.scratchMove.set(0, 0, 0);
            if (steer) {
                if (this.boosting) {
                    const spd = this.flightProfile.boost;
                    target.copy(forward).multiplyScalar(spd * Math.cos(input.pitch));
                    target.addScaledVector(right, axisX * 24);
                    target.y = spd * Math.sin(input.pitch) + (up - down) * 26;
                } else if (movingInput || up || down) {
                    const fwdSpd = reverseFly ? -14 : axisZ > .15 ? this.flightProfile.cruise : 0;
                    target.copy(forward).multiplyScalar(fwdSpd * Math.cos(input.pitch));
                    target.addScaledVector(right, axisX * 22);
                    target.y = fwdSpd * Math.sin(input.pitch) + (up - down) * 20;
                }
            }
            const dampRate = (!this.boosting && !movingInput && !up && !down) ? 5.2 : 3.2;
            this.velocity.lerp(target, 1 - Math.exp(-dampRate * dt));
        } else if (this.flying) {
            // Sword Flight (炼气 / 筑基 / 结丹)
            this.skyWalking = false;
            this.escapeLight = false;
            this.boosting = boost && !reverseFly && !this.avatar.mounting;
            const steer = active && !this.avatar.mounting;
            const forwardPush = axisZ > .15;
            const speed = !steer ? 0 : reverseFly ? -8 : this.boosting ? this.flightProfile.boost : forwardPush ? this.flightProfile.cruise : this.flightProfile.slow;
            const target = this.scratchMove.copy(forward).multiplyScalar(speed * Math.cos(input.pitch));
            if (steer) target.addScaledVector(right, axisX * 14);
            target.y = speed * Math.sin(input.pitch) + (steer ? (up - down) * 18 : 0);
            this.velocity.lerp(target, 1 - Math.exp(-2.3 * dt));
        } else if (this.swimming) {
            this.boosting = false;
            this.escapeLight = false;
            this.skyWalking = false;
            const move = this.scratchMove.copy(forward).multiplyScalar(axisZ).addScaledVector(right, axisX);
            const mag = Math.min(1, move.length());
            if (mag > 0.001) move.normalize().multiplyScalar((boost ? 6.8 : 4.4) * mag);
            this.velocity.x = T.MathUtils.damp(this.velocity.x, move.x, 5.5, dt);
            this.velocity.z = T.MathUtils.damp(this.velocity.z, move.z, 5.5, dt);
            const water = waterSurfaceAt(this.position.x, this.position.z);
            const targetY = Number.isFinite(water) ? water - .02 : this.position.y;
            this.velocity.y = T.MathUtils.damp(this.velocity.y, (targetY - this.position.y) * 6.5, 7, dt);
        } else {
            this.boosting = false;
            this.escapeLight = false;
            this.skyWalking = false;
            const move = movementLocked
                ? this.scratchMove.set(0, 0, 0)
                : this.scratchMove.copy(forward).multiplyScalar(axisZ).addScaledVector(right, axisX);
            const mag = Math.min(1, move.length());
            if (mag > 0.001) {
                const pace = (boost ? config.runSpeed : config.walkSpeed) * mag;
                move.normalize().multiplyScalar(pace);
            }
            this.velocity.x = T.MathUtils.damp(this.velocity.x, move.x, 10, dt);
            this.velocity.z = T.MathUtils.damp(this.velocity.z, move.z, 10, dt);
            const jumpedNow = !!(active && !actionLocked && !fireball && !giantSword && !skill && !attack && this.grounded && jumpPressed);
            if (jumpedNow) {
                this.velocity.y = 8.5;
                this.grounded = false;
            }
            this.velocity.y -= 22 * dt;
        }

        // Continuous low mana drain during flight
        if (this.flying && active && this.gates?.onFlightStep) {
            const spd = this.velocity.length();
            const intensity: 'hover' | 'cruise' | 'boost' = this.boosting
                ? 'boost'
                : (voidMode && (this.skyWalking ? Math.hypot(this.velocity.x, this.velocity.z) < 9 : spd < 2.2))
                    ? 'hover'
                    : 'cruise';
            if (!this.gates.onFlightStep(dt, intensity)) {
                this.flying = false;
                this.skyWalking = false;
                this.boosting = false;
                this.escapeLight = false;
            }
        }

        const jumped = !!(active && !this.flying && !this.swimming && !actionLocked && !fireball && !giantSword && !skill && !attack && wasGrounded && !this.grounded && this.velocity.y > 7);

        const n = Math.max(1, Math.ceil(this.velocity.length() * dt / .6));
        for (let i = 0; i < n; i++) {
            const before = this.scratchBefore.copy(this.position);
            this.position.addScaledVector(this.velocity, dt / n);
            resolveStructures(this.position, before, this.velocity, !this.flying && !this.swimming && this.grounded);
            this.resolveWildlife?.(this.position, before, this.velocity);
            // A point-height test misses shoulders embedded in steep banks. Sample the body footprint.
            for(let probe=0;probe<8;probe++){
                const angle=probe*Math.PI/4,nx=Math.cos(angle),nz=Math.sin(angle);
                const sideHeight=heightAt(this.position.x+nx*.48,this.position.z+nz*.48);
                const centreHeight=heightAt(this.position.x,this.position.z);
                if(sideHeight>this.position.y+.45&&sideHeight-centreHeight>.3){
                    this.position.x=before.x;this.position.z=before.z;
                    const into=this.velocity.x*nx+this.velocity.z*nz;
                    if(into>0){this.velocity.x-=into*nx;this.velocity.z-=into*nz;}
                    break;
                }
            }
            const solid = this.solidFloor(this.position.x, this.position.z);
            const water = waterSurfaceAt(this.position.x, this.position.z);
            if (this.flying) {
                const floor = Math.max(solid, water) + config.clearance;
                if (this.position.y < floor || (this.position.y <= floor + 1e-5 && this.velocity.y <= 0)) {
                    this.position.y = floor;
                    this.velocity.y = Math.max(0, this.velocity.y);
                }
                this.grounded = false;
                this.swimming = false;
            } else {
                const waterDepth = Number.isFinite(water) ? water - solid : 0;
                const inSwimDepth = this.swimming ? waterDepth >= .72 : waterDepth >= .86;
                if (!this.swimming && inSwimDepth && this.position.y <= water - .70) {
                    this.swimming = true;
                    this.grounded = false;
                    const jumpY = (water - .02) - this.position.y;
                    this.position.y = water - .02;
                    this.swimOffset += jumpY;
                    this.velocity.y *= .25;
                } else if (this.swimming && !inSwimDepth) {
                    this.swimming = false;
                    const dropY = solid - this.position.y;
                    this.position.y = solid;
                    this.swimOffset += dropY;
                    this.grounded = true;
                    this.velocity.y = Math.max(0, this.velocity.y);
                }
                if (this.swimming) {
                    this.grounded = false;
                    if (this.position.y < solid + .45) {
                        this.position.y = solid + .45;
                        this.velocity.y = Math.max(0, this.velocity.y);
                    }
                } else {
                    const stickToGround = wasGrounded && !jumped && this.position.y >= solid && this.position.y - solid < .55;
                    if (this.position.y < solid || stickToGround || (this.position.y <= solid + 1e-5 && this.velocity.y <= 0)) {
                        this.position.y = solid;
                        this.velocity.y = Math.max(0, this.velocity.y);
                        this.grounded = true;
                    } else {
                        this.grounded = false;
                    }
                }
            }
        }
        this.swimOffset = T.MathUtils.damp(this.swimOffset, 0, 12, dt);
        const groundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        const animSpeed = this.flying && voidMode && !this.skyWalking ? this.velocity.length() : groundSpeed;
        const targetLean = !this.flying && !this.swimming && this.grounded && this.avatar.swordDrawn && boost && groundSpeed > .4
            ? T.MathUtils.clamp(groundSpeed / config.runSpeed, .35, 1) * .05 : 0;
        this.lean = T.MathUtils.damp(this.lean, targetLean, 9, dt);

        const hideBody = this.gates?.shouldHideBody?.() ?? this.escapeLight;
        const cue = this.avatar.update(
            dt,
            this.flying,
            this.grounded,
            jumped,
            animSpeed,
            boost,
            this.fireballHeld,
            this.swimming,
            voidMode,
            this.skyWalking,
            hideBody,
        );
        if (cue === 'heavy-hit') this.onHeavyHit?.(this.position, this.heading);
        if (cue === 'light-hit') this.onLightHit?.(this.position, this.heading);
        if (cue === 'sword-array') this.onSkillCast?.(this.position);
        if (cue === 'fireball') this.onFireballCast?.(this.fireballPower);
    }
    /** The model and camera share a pose interpolated between physics steps. */
    syncRender(alpha:number) {
        const blend=T.MathUtils.clamp(alpha,0,1);
        this.avatar.position.lerpVectors(this.previousPosition,this.position,blend);
        this.avatar.position.y -= T.MathUtils.lerp(this.previousTakeoffOffset, this.takeoffOffset, blend);
        this.avatar.position.y -= T.MathUtils.lerp(this.previousSwimOffset, this.swimOffset, blend);
        this.avatar.rotation.order='YXZ';
        this.avatar.rotation.x = T.MathUtils.lerp(this.previousLean, this.lean, blend);
        this.avatar.rotation.y = Math.PI - T.MathUtils.lerp(this.previousHeading, this.heading, blend);
        this.avatar.rotation.z = T.MathUtils.lerp(this.previousBank, this.bank, blend);
        this.updateShadow();
    }
    dispose() {
        this.avatar.dispose();
        this.shadow.geometry.dispose();
        (this.shadow.material as T.Material).dispose();
        const map = (this.shadow.material as T.MeshBasicMaterial).map;
        map?.dispose();
        this.shadow.removeFromParent();
    }
}
