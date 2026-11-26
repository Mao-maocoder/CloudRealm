import * as T from 'three';
import { clipStructureCamera } from '../world/physics/solid-world';

export type ImpactGround = 'grass' | 'stone' | 'soil' | 'water';
export type GroundSample = { height: number; kind: ImpactGround };
export type SampleGround = (x: number, z: number, fromY: number) => GroundSample;
export const fireballGravity = 19;

type WorldHit = { t: number; ground?: GroundSample };

/** Short subsegments keep the existing structure probes effective even on the aim ray. */
export function traceFireballWorld(from: T.Vector3, to: T.Vector3, sample: SampleGround, clearance = 0): WorldHit | undefined {
    const count = Math.max(1, Math.ceil(from.distanceTo(to) / .7));
    const previous = from.clone(), point = new T.Vector3(), probe = new T.Vector3();
    for (let i = 1; i <= count; i++) {
        point.lerpVectors(from, to, i / count);
        const wall = clipStructureCamera(previous, point);
        const surface = sample(point.x, point.z, previous.y);
        if (point.y <= surface.height + clearance) {
            let low = 0, high = 1, ground = surface;
            for (let j = 0; j < 6; j++) {
                const mid = (low + high) * .5;
                probe.lerpVectors(previous, point, mid);
                const at = sample(probe.x, probe.z, previous.y);
                if (probe.y <= at.height + clearance) { high = mid; ground = at; }
                else low = mid;
            }
            if (high <= wall + .08) return { t: (i - 1 + high) / count, ground };
        }
        if (wall < 1) {
            // Structure probes include a tolerance outside the mesh. A descending
            // projectile can touch that tolerance before it reaches a roof, boulder dome, or ledge.
            probe.lerpVectors(previous, point, wall);
            let top = sample(probe.x, probe.z, previous.y + .25);
            if (top.kind !== 'stone') {
                // Step slightly inward along the travel direction to catch curved boulder shoulders.
                const stepDir = point.clone().sub(previous);
                const len = stepDir.length();
                if (len > 1e-4) {
                    stepDir.multiplyScalar(.24 / len);
                    const inward = sample(probe.x + stepDir.x, probe.z + stepDir.z, previous.y + .25);
                    if (inward.kind === 'stone') top = inward;
                }
            }
            const roof = point.y < previous.y && top.kind === 'stone' && previous.y >= top.height - .25
                && Math.abs(probe.y - top.height) <= clearance + .38;
            return { t: (i - 1 + wall) / count, ground: roof ? top : undefined };
        }
        previous.copy(point);
    }
    return undefined;
}

export function fireballAim(camera: T.Camera, caster: T.Vector3, power: number, sample: SampleGround) {
    const ray = camera.getWorldDirection(new T.Vector3());
    const origin = camera.getWorldPosition(new T.Vector3());
    const range = T.MathUtils.lerp(12, 56, power);
    const flat = Math.hypot(ray.x, ray.z);
    const start = Math.max(0, new T.Vector3().subVectors(caster, origin).dot(ray));
    const end = origin.clone().addScaledVector(ray, start + range / Math.max(.52, flat));
    const hit = traceFireballWorld(origin, end, sample);
    if (hit) {
        end.lerpVectors(origin, end, hit.t);
        if (hit.ground) end.y = hit.ground.height;
        return end;
    }
    const surface = sample(end.x, end.z, end.y);
    end.y = surface.height;
    return end;
}

export function fireballArc(origin: T.Vector3, target: T.Vector3, power: number) {
    const displacement = target.clone().sub(origin);
    const distance = Math.hypot(displacement.x, displacement.z);
    const duration = T.MathUtils.clamp(distance / T.MathUtils.lerp(17, 30, power), .55, 2.15);
    const velocity = displacement.multiplyScalar(1 / duration);
    velocity.y += .5 * fireballGravity * duration;
    return { velocity, duration };
}
