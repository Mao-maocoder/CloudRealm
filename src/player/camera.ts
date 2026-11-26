import * as T from 'three';
import { Player } from './controller';
import { Input } from './input';
import { heightAt } from '../world/geo/height';
import { clipStructureCamera } from '../world/physics/solid-world';

export interface AstralCameraState {
    origin: T.Vector3;
    radius: number;
}

export class FollowCamera {
    free = false;
    roll = true;
    readonly freePosition = new T.Vector3();
    readonly astralPosition = new T.Vector3();
    private astralInitialized = false;
    private readonly target = new T.Vector3();
    private readonly direction = new T.Vector3();
    private readonly right = new T.Vector3();
    private readonly move = new T.Vector3();
    private readonly focus = new T.Vector3();
    private readonly desired = new T.Vector3();
    private readonly look = new T.Vector3();
    private readonly probe = new T.Vector3();
    private readonly wide = new T.Vector3();
    private readonly blendLook = new T.Vector3();
    private readonly astralOffset = new T.Vector3();
    private initialized = false;

    constructor(readonly camera: T.PerspectiveCamera, private player: Player, private input: Input) {}

    reset() {
        this.free = false;
        this.astralInitialized = false;
        this.initialized = false;
    }

    /** Seeds the astral camera cleanly from the current view when entering Divine Sense Projection. */
    beginAstral(fromPosition?: T.Vector3) {
        this.free = false;
        this.astralPosition.copy(fromPosition ?? this.camera.position);
        this.astralInitialized = true;
    }

    endAstral() {
        this.astralInitialized = false;
    }

    update(
        dt: number,
        swordArray?: { center: T.Vector3; weight: number; radius: number; fullWeightWithin?: number; fadeBeyond?: number },
        cinematic?: { position: T.Vector3; target: T.Vector3; fov?: number },
        astral?: AstralCameraState,
        senseInsight = false,
    ) {
        if (cinematic) {
            this.free = false;
            this.astralInitialized = false;
            const alpha = this.initialized ? 1 - Math.exp(-5.5 * dt) : 1;
            const desiredPos = this.desired.copy(cinematic.position);
            desiredPos.y = Math.max(desiredPos.y, heightAt(desiredPos.x, desiredPos.z) + 1.2, 4);
            this.camera.position.lerp(desiredPos, alpha);
            this.target.lerp(cinematic.target, alpha);
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(this.target);
            if (cinematic.fov !== undefined) {
                const nextFov = T.MathUtils.damp(this.camera.fov, cinematic.fov, 4.5, dt);
                if (Math.abs(nextFov - this.camera.fov) > 0.005) {
                    this.camera.fov = nextFov;
                    this.camera.updateProjectionMatrix();
                }
            }
            this.initialized = true;
            return;
        }
        const cosPitch = Math.cos(this.input.pitch);
        const direction = this.direction.set(
            Math.sin(this.input.yaw) * cosPitch,
            Math.sin(this.input.pitch),
            -Math.cos(this.input.yaw) * cosPitch,
        );
        if (astral) {
            this.free = false;
            if (!this.astralInitialized) {
                this.astralPosition.copy(this.camera.position);
                this.astralInitialized = true;
            }
            const right = this.right.set(Math.cos(this.input.yaw), 0, Math.sin(this.input.yaw));
            const speed = (this.input.has('ShiftLeft') || this.input.has('ShiftRight')) ? 135 : 48;
            const fwd = (+this.input.has('KeyW')) - (+this.input.has('KeyS')) + (this.input.moveZ ?? 0);
            const strafe = (+this.input.has('KeyD')) - (+this.input.has('KeyA')) + (this.input.moveX ?? 0);
            const move = this.move.copy(direction).multiplyScalar(fwd).addScaledVector(right, strafe);
            move.y += (+this.input.has('Space')) - (+(this.input.has('ControlLeft') || this.input.has('ControlRight')));
            if (move.lengthSq() > 0) move.normalize();
            this.astralPosition.addScaledVector(move, speed * dt);
            // Clamp consciousness strictly within the cultivator's Divine Sense sphere
            this.astralOffset.subVectors(this.astralPosition, astral.origin);
            const dist = this.astralOffset.length();
            if (dist > astral.radius) {
                this.astralOffset.multiplyScalar(astral.radius / dist);
                this.astralPosition.copy(astral.origin).add(this.astralOffset);
            }
            this.astralPosition.y = Math.max(this.astralPosition.y, heightAt(this.astralPosition.x, this.astralPosition.z) + 2.2, 5);
            const alpha = 1 - Math.exp(-11 * dt);
            this.camera.position.lerp(this.astralPosition, alpha);
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(this.look.copy(this.camera.position).add(direction));
            const nextFov = T.MathUtils.damp(this.camera.fov, 74, 4.5, dt);
            if (Math.abs(nextFov - this.camera.fov) > 0.005) {
                this.camera.fov = nextFov;
                this.camera.updateProjectionMatrix();
            }
            this.initialized = true;
            return;
        }
        this.astralInitialized = false;
        if (this.input.take('KeyC')) {
            this.free = !this.free;
            this.freePosition.copy(this.camera.position);
            this.input.clear();
        }
        if (this.free) {
            const right = this.right.set(Math.cos(this.input.yaw), 0, Math.sin(this.input.yaw));
            const speed = this.input.has('ShiftLeft') ? 100 : 30;
            const fwd = (+this.input.has('KeyW')) - (+this.input.has('KeyS')) + (this.input.moveZ ?? 0);
            const strafe = (+this.input.has('KeyD')) - (+this.input.has('KeyA')) + (this.input.moveX ?? 0);
            const move = this.move.copy(direction).multiplyScalar(fwd).addScaledVector(right, strafe);
            move.y += (+this.input.has('Space')) - (+this.input.has('ControlLeft'));
            if (move.lengthSq() > 0) move.normalize();
            this.freePosition.addScaledVector(move, speed * dt);
            this.freePosition.y = Math.max(this.freePosition.y, heightAt(this.freePosition.x, this.freePosition.z) + 2, 5);
            this.camera.position.copy(this.freePosition);
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(this.look.copy(this.freePosition).add(direction));
            return;
        }

        const speed = this.player.velocity.length();
        const distance = 7 + speed * .045;
        const focus = this.focus.copy(this.player.avatar.position);
        focus.y += this.player.swimming ? .85 : 1.65;
        const desired = this.desired.copy(focus).addScaledVector(direction, -distance);
        desired.y += 2;
        const look = this.look.copy(focus).addScaledVector(direction, 5);

        if (swordArray) {
            const foot = this.player.avatar.position;
            const separation = Math.hypot(foot.x - swordArray.center.x, foot.z - swordArray.center.z);
            const weight = swordArray.weight * (1 - T.MathUtils.smoothstep(separation, swordArray.fullWeightWithin ?? 4, swordArray.fadeBeyond ?? 10));
            const standoff = swordArray.radius + 18;
            this.wide.set(
                foot.x - standoff * Math.sin(this.input.yaw),
                foot.y + 6.4,
                foot.z + standoff * Math.cos(this.input.yaw),
            );
            desired.lerp(this.wide, weight);
            look.lerp(this.blendLook.copy(foot).lerp(swordArray.center, .55), weight);
        }

        desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 2, 5);
        for (let i = 1; i <= 12; i++) {
            this.probe.lerpVectors(focus, desired, i / 12);
            if (this.probe.y < heightAt(this.probe.x, this.probe.z) + .6) {
                desired.lerpVectors(focus, desired, Math.max(.1, (i - 1) / 12));
                break;
            }
        }
        desired.lerpVectors(focus, desired, clipStructureCamera(focus, desired));
        const alpha = this.initialized ? 1 - Math.exp(-7 * dt) : 1;
        this.camera.position.lerp(desired, alpha);
        this.camera.position.lerpVectors(focus, this.camera.position, clipStructureCamera(focus, this.camera.position));
        this.camera.position.y = Math.max(this.camera.position.y, heightAt(this.camera.position.x, this.camera.position.z) + .7, 4);
        this.target.lerp(look, alpha);
        this.camera.up.set(this.roll ? this.player.avatar.rotation.z * .09 : 0, 1, 0).normalize();
        this.camera.lookAt(this.target);
        const focusFovOffset = senseInsight ? -3.2 : 0;
        const nextFov = T.MathUtils.damp(this.camera.fov, 65 + focusFovOffset + Math.min(17, speed / 65 * 17), 4, dt);
        if (Math.abs(nextFov - this.camera.fov) > 0.005) {
            this.camera.fov = nextFov;
            this.camera.updateProjectionMatrix();
        }
        this.initialized = true;
    }
}
