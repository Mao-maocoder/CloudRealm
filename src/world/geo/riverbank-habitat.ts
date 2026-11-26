import { riverX, smooth, waterLevelAt } from './geo-core';
import { roadDistanceAt, worldHeightAt } from './geography';
import { fbm, valueNoise } from './height';
import { shoreDistanceAt } from './meadow-distribution';

// West-bank sample and a wider upstream catchment for the drainage calculation.
export const bankField = { left: -166, north: 76, step: 2, width: 109, depth: 121 };
const padding = 48;
const { left, north, step, width, depth } = bankField;
export const riverbankEnabled = !(import.meta.env?.DEV
    && new URLSearchParams(location.search).get('riverbank') === 'baseline');
const offsets = [-1, 0, 1].flatMap(z => [-1, 0, 1]
    .filter(x => x || z).map(x => ({ x, z, run: Math.hypot(x, z) * step })));
let cached: Uint8Array<ArrayBuffer> | undefined;

export function riverbankFieldData() {
    return cached ??= riverbankEnabled ? bakeHabitat() : new Uint8Array(width * depth * 4);
}

function bakeHabitat() {
    const stride = width + padding * 2, rows = depth + padding * 2;
    const heights = new Float32Array(stride * rows);
    for (let z = 0; z < rows; z++) for (let x = 0; x < stride; x++)
        heights[z * stride + x] = worldHeightAt(left + (x - padding) * step, north + (z - padding) * step);

    // D8 routes each cell to its steepest lower neighbour. Strict descent
    // makes the graph acyclic, so a single descending-height pass suffices.
    const downstream = new Int32Array(heights.length).fill(-1);
    const area = new Float32Array(heights.length).fill(step * step);
    for (let z = 1; z < rows - 1; z++) for (let x = 1; x < stride - 1; x++) {
        const i = z * stride + x;
        let steepest = 0;
        for (const offset of offsets) {
            const j = i + offset.z * stride + offset.x;
            const fall = (heights[i] - heights[j]) / offset.run;
            if (fall <= steepest) continue;
            steepest = fall;
            downstream[i] = j;
        }
    }
    const order = Int32Array.from(heights.keys()).sort((a, b) => heights[b] - heights[a]);
    for (const i of order) if (downstream[i] >= 0) area[downstream[i]] += area[i];

    const data = new Uint8Array(width * depth * 4);
    for (let z = 1; z < depth - 1; z++) for (let x = 1; x < width - 1; x++) {
        const wx = left + x * step, wz = north + z * step;
        if (wx >= riverX(wz)) continue;
        const shore = shoreDistanceAt(wx, wz);
        const i = (z + padding) * stride + x + padding;
        const aboveWater = heights[i] - waterLevelAt(wz);
        const edge = Math.min(x, z, width - 1 - x, depth - 1 - z) * step;
        const blend = smooth(0, 24, edge) * smooth(-3, 1, shore) * smooth(-.18, .55, aboveWater);
        if (blend <= 0) continue;

        // Average log area before applying the wetness index to soften
        // grid-aligned flow paths without erasing the sheltered swales.
        let logArea = 0, samples = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
            logArea += Math.log(area[i + dz * stride + dx] / step);
            samples++;
        }
        const span = 2 * step;
        const slope = Math.hypot(heights[i + 2] - heights[i - 2],
            heights[i + 2 * stride] - heights[i - 2 * stride]) / (2 * span);
        const drainage = smooth(2.9, 6.1, logArea / samples - Math.log(Math.max(.025, slope)));
        const bank = (1 - smooth(2, 23, shore)) * (1 - smooth(2, 7, aboveWater));
        const moisture = Math.min(1, drainage * .70 + bank * .64);
        const openings = fbm(wx * .027, wz * .023, 3, 163);
        const shoreBreak = valueNoise(wx * .17, wz * .12, 171);
        const sediment = bank * (1 - smooth(.25, 2.6 + shoreBreak * 1.75, aboveWater))
            * (.36 + .64 * smooth(.30, .73, shoreBreak));

        // Keep visible breaks between the riverside groves and the open meadow.
        const road = smooth(4, 15, roadDistanceAt(wx, wz));
        const shelf = smooth(9, 24, shore) * (1 - smooth(65, 102, shore));
        const grove = smooth(.40, .68, openings + moisture * .16);
        const woodland = grove * shelf * road * (1 - smooth(.31, .68, slope));
        const index = (z * width + x) * 4;
        data[index] = Math.round(moisture * 255);
        data[index + 1] = Math.round(woodland * 255);
        data[index + 2] = Math.round(sediment * 255);
        data[index + 3] = Math.round(blend * 255);
    }
    return data;
}

/** Same bilinear lookup that the terrain and grass shaders get from the texture. */
export function riverbankHabitatAt(x: number, z: number) {
    const u = (x - left) / step, v = (z - north) / step;
    if (u < 0 || v < 0 || u >= width - 1 || v >= depth - 1) return;
    const ix = Math.floor(u), iz = Math.floor(v), a = u - ix, b = v - iz;
    const data = riverbankFieldData(), i = (iz * width + ix) * 4, row = width * 4;
    const channel = (n: number) => ((data[i + n] * (1 - a) + data[i + 4 + n] * a) * (1 - b)
        + (data[i + row + n] * (1 - a) + data[i + row + 4 + n] * a) * b) / 255;
    const blend = channel(3);
    if (blend > 0) return { moisture: channel(0), woodland: channel(1), sediment: channel(2), blend };
}
