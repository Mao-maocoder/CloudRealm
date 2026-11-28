import { readArtStyle } from '../../config/settings';

export const valleySpawn = { x: 79, z: 160 };
export const shrineRadius = 4.18;
export const shrineDatum = 13.92;
export const shrineFloor = shrineDatum - .015;
export const shrineHeading = 25 * Math.PI / 180;

// Leads from the north edge of the terrace to the existing east-bank trail.
export const shrinePath = [
    [80.0, 156.0], [81.4, 153.0], [85.3, 150.9], [90.6, 149.8], [98.0, 149.4],
] as const;

function pathDistanceSquared(x: number, z: number) {
    let nearest = Infinity;
    for (let i = 1; i < shrinePath.length; i++) {
        const [ax, az] = shrinePath[i - 1], [bx, bz] = shrinePath[i];
        const dx = bx - ax, dz = bz - az;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        nearest = Math.min(nearest, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
    }
    return nearest;
}

export function inSpawnShrineClearance(x: number, z: number, extra = 0) {
    if (readArtStyle() !== 'guofeng' || x < 72 - extra || x > 101 + extra || z < 146 - extra || z > 167 + extra) return false;
    return (x - valleySpawn.x) ** 2 + (z - valleySpawn.z) ** 2 < (shrineRadius + .16 + extra) ** 2
        || pathDistanceSquared(x, z) < (1.2 + extra) ** 2;
}

export const shrinePathGLSL = `
float shrineSegmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 line = b - a;
    return length(p - a - line * clamp(dot(p - a, line) / dot(line, line), 0.0, 1.0));
}
float shrinePathDistance(vec2 p) {
    if (p.x < 76.0 || p.x > 102.0 || p.y < 146.0 || p.y > 160.0) return 10.0;
    float d = 10.0;
    ${shrinePath.slice(1).map(([bx, bz], i) => {
        const [ax, az] = shrinePath[i];
        return `d = min(d, shrineSegmentDistance(p, vec2(${ax.toFixed(1)}, ${az.toFixed(1)}), vec2(${bx.toFixed(1)}, ${bz.toFixed(1)})));`;
    }).join('\n    ')}
    return d;
}
float shrineGrassCover(vec2 p) {
    if (p.x < 73.0 || p.x > 102.0 || p.y < 146.0 || p.y > 166.0) return 1.0;
    float terrace = smoothstep(4.32, 5.05, length(p - vec2(${valleySpawn.x}.0, ${valleySpawn.z}.0)));
    return terrace * smoothstep(1.05, 1.85, shrinePathDistance(p));
}`;
