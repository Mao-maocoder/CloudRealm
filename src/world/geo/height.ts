import {WorldPlan,worldHeightAt,riverX,roadDistanceAt} from './world-plan';
import {waterSurfaceAt} from './geo-core';
import {canyonFootprint} from './canyon-plan';
export {riverX};
export const heightAt=worldHeightAt;
export const waterHeight = 3;


/** Width of the carved river channel; used by the water shader's shore logic. */
export const riverHalfWidth = 24;

/** Walkable dirt trail that follows the east bank, past the spawn point. */
export const trailCenter = (z: number) => riverX(z) + 30 + 6 * Math.sin(z / 57);
export const trailDistance = (x: number, z: number) => roadDistanceAt(x,z);

const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Bilinear value noise over the same deterministic hash, used for biome masks and colors. */
export function valueNoise(x: number, z: number, seed = 0) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = randomAt(xi, zi, seed), b = randomAt(xi + 1, zi, seed);
    const c = randomAt(xi, zi + 1, seed), d = randomAt(xi + 1, zi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number, octaves = 3, seed = 0) {
    let sum = 0, amplitude = 0.5, frequency = 1, total = 0;
    for (let i = 0; i < octaves; i++) {
        sum += valueNoise(x * frequency, z * frequency, seed + i * 17) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2.07;
    }
    return sum / total;
}

/** Approximate terrain gradient magnitude (rise per metre). */
export function slopeAt(x: number, z: number) {
    const dx = heightAt(x + 1, z) - heightAt(x - 1, z);
    const dz = heightAt(x, z + 1) - heightAt(x, z - 1);
    return Math.hypot(dx, dz) * 0.5;
}

export function isNearWater(x: number, z: number) {
    return heightAt(x, z) < waterHeight + 1.1;
}

/** True on the packed dirt path, where vegetation should stay clear. */
export function onTrail(x: number, z: number, margin = 2.4) {
    return trailDistance(x, z) < margin && heightAt(x, z) > waterHeight + 0.8 && slopeAt(x, z) < 0.62;
}

export function randomAt(x: number, z: number, seed = 0) {
    const n = Math.sin(x * 127.1 + z * 311.7 + (seed + WorldPlan.seed - 741103) * 74.7) * 43758.5453;
    return n - Math.floor(n);
}

/** Keep the trunk and root flare out of the water and off the wet bank. */
export function canPlantTree(x: number, z: number, rootRadius: number) {
    if(canyonFootprint(x,z))return false;
    const shore = waterSurfaceAt(x, z, rootRadius + 8);
    if (!Number.isFinite(shore))
        return true;
    if (Number.isFinite(waterSurfaceAt(x, z, rootRadius + 1.5)))
        return false;
    for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        if (heightAt(x + Math.cos(angle) * rootRadius, z + Math.sin(angle) * rootRadius) < shore + .55)
            return false;
    }
    return heightAt(x, z) >= shore + .55;
}

export { smooth };

