import * as T from 'three';

// Covers the east bank beside the respawn terrace. Samples are centred in .25 m cells.
const left = 64, north = 142, step = .25, width = 112, depth = 176;
const right = left + width * step, south = north + depth * step;
const reach = 1.6;
const DIR_COUNT = 12;
const dirX = new Float32Array(DIR_COUNT);
const dirZ = new Float32Array(DIR_COUNT);
for (let i = 0; i < DIR_COUNT; i++) {
    const angle = i * Math.PI / 6;
    dirX[i] = Math.cos(angle);
    dirZ[i] = Math.sin(angle);
}
const edgeScratch = new Float32Array(DIR_COUNT);
const vertexScratch = new T.Vector3();

export const spawnShoreBounds = { left, right, north, south, reach } as const;

export class SpawnShoreGrass {
    private readonly data = new Uint8Array(width * depth);
    readonly texture = new T.DataTexture(this.data, width, depth, T.RedFormat);

    constructor() {
        this.texture.magFilter = this.texture.minFilter = T.LinearFilter;
        this.texture.needsUpdate = true;
    }

    addStone(geometry: T.BufferGeometry, transform: T.Matrix4, bounds: T.Box3) {
        if (bounds.max.x + reach < left || bounds.min.x - reach >= right
            || bounds.max.z + reach < north || bounds.min.z - reach >= south) return;
        edgeScratch.fill(-Infinity);
        const vertices = geometry.getAttribute('position');
        // Bound the projected mesh with supporting lines. This follows each
        // boulder's yaw and silhouette without clearing an axis-aligned patch.
        for (let v = 0, n = vertices.count; v < n; v++) {
            vertexScratch.fromBufferAttribute(vertices, v).applyMatrix4(transform);
            const vx = vertexScratch.x, vz = vertexScratch.z;
            for (let i = 0; i < DIR_COUNT; i++) {
                const proj = vx * dirX[i] + vz * dirZ[i];
                if (proj > edgeScratch[i]) edgeScratch[i] = proj;
            }
        }
        const fromX = Math.max(0, Math.floor((bounds.min.x - reach - left) / step));
        const toX = Math.min(width - 1, Math.floor((bounds.max.x + reach - left) / step));
        const fromZ = Math.max(0, Math.floor((bounds.min.z - reach - north) / step));
        const toZ = Math.min(depth - 1, Math.floor((bounds.max.z + reach - north) / step));
        const invReach = 255 / reach;
        for (let z = fromZ; z <= toZ; z++) {
            const wz = north + (z + .5) * step;
            const row = z * width;
            for (let x = fromX; x <= toX; x++) {
                const wx = left + (x + .5) * step;
                let distance = 0;
                for (let i = 0; i < DIR_COUNT; i++) {
                    const d = wx * dirX[i] + wz * dirZ[i] - edgeScratch[i];
                    if (d > distance) distance = d;
                }
                if (distance >= reach) continue;
                const val = Math.round((reach - distance) * invReach);
                const index = row + x;
                if (val > this.data[index]) this.data[index] = val;
            }
        }
        this.texture.needsUpdate = true;
    }

    blocksPlant(x: number, z: number, clearance: number) {
        if (x < left || x >= right || z < north || z >= south) return false;
        const index = Math.floor((z - north) / step) * width + Math.floor((x - left) / step);
        return this.data[index] >= (1 - clearance / reach) * 255;
    }
}

export const spawnShoreGrassGLSL = `
uniform sampler2D uSpawnShoreGrass;
float shoreGrassCover(vec2 p) {
    if (p.x < ${left}.0 || p.x >= ${right}.0 || p.y < ${north}.0 || p.y >= ${south}.0) return 1.0;
    vec2 uv = (p - vec2(${left}.0, ${north}.0)) / vec2(${right - left}.0, ${south - north}.0);
    return 1.0 - smoothstep(0.44, 0.70, texture2D(uSpawnShoreGrass, uv).r);
}`;
