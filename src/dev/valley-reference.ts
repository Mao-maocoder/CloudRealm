import { MathUtils, type PerspectiveCamera, type Vector3 } from 'three';
import { heightAt } from '../world/geo/height';
import { welcome } from '../ui/welcome';

export interface ValleyReferenceHost {
    readonly input: { clear(): void };
    readonly player: { teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void };
    readonly follow: { free: boolean; readonly freePosition: Vector3 };
    readonly camera: PerspectiveCamera;
    readonly hud: { started: boolean };
}

/** Fixed aerial composition for the supplied Changfeng concept. */
export const valleyReference = {
    x: 785, y: 291, z: -255,
    heading: 248, pitch: -20, fov: 66,
};

export const cascadeReference = {
    x: 211, y: 280, z: 268,
    heading: 6.66, pitch: -10.10, fov: 72.5,
};

export const canyonReference = {
    x: -50, y: 311, z: -993,
    heading: MathUtils.radToDeg(Math.atan2(10, 697)),
    pitch: MathUtils.radToDeg(Math.atan2(5, Math.hypot(10, 697))),
    fov: 63,
};

const referenceViews = { reference: valleyReference, cascade: cascadeReference, canyon: canyonReference };
export type ValleyReferenceView = keyof typeof referenceViews;

export function openValleyReference(host: ValleyReferenceHost, view: ValleyReferenceView = 'reference') {
    const { x, y, z, heading, pitch, fov } = referenceViews[view];
    const yaw = MathUtils.degToRad(heading - 360);
    const altitude = Math.max(y, heightAt(x, z) + 2);
    const distance = view === 'canyon' ? 11 : 8;
    const drop = view === 'canyon' ? 2.45 : 5;
    host.input.clear();
    host.player.teleport(x + Math.sin(yaw) * distance, altitude - drop, z - Math.cos(yaw) * distance, yaw, MathUtils.degToRad(pitch));
    host.follow.free = true;
    host.follow.freePosition.set(x, altitude, z);
    host.camera.fov = fov;
    host.camera.updateProjectionMatrix();
    host.hud.started = true;
    welcome.hide();
}
