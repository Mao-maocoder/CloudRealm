import { BufferGeometry, BufferAttribute } from 'three';
import { Color } from 'three';
import {upliftAt} from '../geo/relief';
import {art} from '../../config/art';
import { fbm, heightAt, riverX, slopeAt, smooth, trailDistance, valueNoise, waterHeight } from '../geo/height';

export interface TerrainData {
    positions: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
}

const grass = new Color(), sand = new Color(), rock = new Color(), alpine = new Color(), dirt = new Color(), bed = new Color(), damp = new Color(), wet = new Color();

/**
 * Vertex colours carry the large-scale "painted" look: meadow patches, wet sand,
 * river bed, exposed rock and the riverside walking trail. Fine speckle is added
 * again per-fragment by the terrain material so the ground never looks like flat gouraud.
 */
function paintGround(x: number, z: number, h: number, slope: number, out: Color) {
    const altitude=h;h-=upliftAt(z);
    const macro = fbm(x * .012, z * .012, 3, 3);
    const mid = fbm(x * .058, z * .058, 2, 9);
    const micro = valueNoise(x * .61, z * .61, 5);
    const riverDistance = Math.abs(x - riverX(z));

    grass.setHSL(
        art.meadowHue + .050 * (macro - .5) + .018 * (mid - .5),
        .43 + .13 * (mid - .5) + .035 * (micro - .5),
        .455 + .085 * (macro - .5) + .030 * (micro - .5)
    );

    // Mossy teal in damp hollows, warmer yellow-green on sunlit slopes.
    if (mid < .38) {
        damp.setHSL(.36, .34, .30 + .05 * micro);
        grass.lerp(damp, (.38 - mid) * .9);
    }

    rock.setHSL(.40 + .03 * micro, .10 + .06 * mid, .35 + .11 * mid);
    grass.lerp(rock, smooth(.34, .78, slope));

    if (h > 52) {
        alpine.setHSL(.43, .14 + .05 * micro, .50 + .09 * mid);
        grass.lerp(alpine, smooth(52, 102, h) * .6);
    }

    // Trail: a soft dirt ribbon on the east bank, broken up by noise.
    const td = trailDistance(x, z);
    if (td < 2.8 && h > waterHeight + 1 && slope < .7) {
        dirt.setHSL(.085 + .014 * micro, .36 + .05 * mid, .39 + .05 * micro);
        grass.lerp(dirt, (1 - smooth(1.1, 2.8, td)) * .92);
    }

    // Wet sand / gravel shore. The channel is carved by a smooth analytic curve,
    // so the band is naturally continuous across chunk borders.
    const shore = smooth(4.9, 3.02, h) * (.28 + .72 * smooth(40, 15, riverDistance));
    if (shore > 0) {
        sand.setHSL(.098 + .015 * micro, .44 + .05 * mid, .52 + .045 * mid);
        const wetBand = smooth(3.75, 3.01, h);
        wet.setHSL(.15, .40, .30 + .04 * micro);
        sand.lerp(wet, wetBand * .75);
        grass.lerp(sand, shore);
    }

    if (h < waterHeight + .05) {
        bed.setHSL(.42 + .02 * micro, .26, .18 + .05 * mid);
        if (h > waterHeight - 1.6)
            bed.lerp(sand, smooth(waterHeight - 1.6, waterHeight, h) * .38);
        grass.copy(bed);
    }

    if(z < -1450 && altitude > upliftAt(z)+80){const snow=smooth(80,200,altitude-upliftAt(z))*(1-smooth(.65,1.8,slope));grass.lerp(new Color('#e5eff4'),snow);}
    if(x < -360 && z < -100 && z > -1000 && h>8)grass.lerp(new Color('#a19a50'),.22);
    out.copy(grass);
}

export function terrainData(cx: number, cz: number, size: number, n: number): TerrainData {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const c = new Color();
    for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) {
            const x = cx + i / n * size, z = cz + j / n * size, h = heightAt(x, z);
            positions.push(x, h, z);
            paintGround(x, z, h, slopeAt(x, z), c);
            colors.push(c.r, c.g, c.b);
        }
    for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i, b = a + n + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    // Downward skirts hide cracks where adjacent LODs use different sampling rates.
    const edges = [Array.from({ length: n + 1 }, (_, i) => i), Array.from({ length: n + 1 }, (_, i) => i * (n + 1) + n), Array.from({ length: n + 1 }, (_, i) => n * (n + 1) + n - i), Array.from({ length: n + 1 }, (_, i) => (n - i) * (n + 1))];
    for (const edge of edges) {
        const start = positions.length / 3;
        for (const id of edge) {
            positions.push(positions[id * 3], positions[id * 3 + 1] - 12, positions[id * 3 + 2]);
            colors.push(...colors.slice(id * 3, id * 3 + 3));
        }
        for (let k = 0; k < n; k++)
            indices.push(edge[k], start + k, edge[k + 1], start + k, start + k + 1, edge[k + 1]);
    }
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], z = positions[i + 2];
        const dx = heightAt(x - 1, z) - heightAt(x + 1, z), dz = heightAt(x, z - 1) - heightAt(x, z + 1);
        const len = Math.hypot(dx, 2, dz);
        normals[i] = dx / len;
        normals[i + 1] = 2 / len;
        normals[i + 2] = dz / len;
    }
    return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices), normals };
}

export function createTerrain(data: TerrainData) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.positions, 3));
    g.setAttribute('color', new BufferAttribute(data.colors, 3));
    g.setIndex(new BufferAttribute(data.indices, 1));
    g.setAttribute('normal', new BufferAttribute(data.normals, 3));
    g.computeBoundingSphere();
    return g;
}
