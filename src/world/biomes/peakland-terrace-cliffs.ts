import * as T from 'three';
import { peakland, terraces } from '../geo/peakland-plan';

/**
 * The temple and bridge sit on heightfield terraces, which have no strata,
 * ledges or joints of their own — they rendered as smooth clay cylinders next
 * to the hand-built rock formations. Each terrace now gets an independent rock
 * mesh, built on the terrace's own analytic contour and sharing the peakland
 * stone material and vocabulary. Collision and the walkable court still belong
 * to the terrain; only the visible cliff is replaced.
 */

const SIDES = 48, RINGS = 24, WALL = 420;

function terraceGeometry(site: (typeof terraces)[number], index: number) {
    const seed = 97 + index * 997;
    const c = Math.cos(site.strike), s = Math.sin(site.strike);
    const positions: number[] = [], indices: number[] = [];
    // Terrace 2 is the small inner pagoda mound sitting on top of Terrace 1; keep
    // it compact with a notch for the connecting stairs so it never clips into them.
    const innerMound = index === 2;
    const wallHeight = innerMound ? 42 : WALL;
    const crown = site.crown * (innerMound ? .88 : 1.02);
    const outer = innerMound ? 1.08 : 1.24;
    const top = site.top;
    // Drop the rock rim where the cloud bridge or temple stairs meet each terrace.
    const notches = innerMound
        ? [[2504, -1518], [2496, -1526]]
        : peakland.bridge.map(({x,z}) => [x,z]);

    for (let j = 0; j <= RINGS; j++) {
        const t = j / RINGS;
        for (let i = 0; i < SIDES; i++) {
            const a = i / SIDES * Math.PI * 2;
            let notch = 0;
            for (const [nx, nz] of notches) {
                const dx = nx - site.x, dz = nz - site.z;
                const na = Math.atan2((dz*c-dx*s)/site.rz, (dx*c+dz*s)/site.rx);
                const delta = a - na;
                const d = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
                notch = Math.max(notch, Math.max(0, 1 - d / (innerMound ? .48 : .24)) * (innerMound ? 14 : 6.5));
            }
            const topY = top - (innerMound ? .95 : .38) - notch;
            const y = topY - t * wallHeight;
            // The terrace wall flares from crown at the court to outer at the
            // base; invert the same smoothstep the heightfield uses.
            const body = T.MathUtils.clamp(1 - (topY - y) / wallHeight, .02, 1);
            const band = 1 - body;
            let lo = 0, hi = 1;
            for (let k = 0; k < 10; k++) {
                const mid = (lo + hi) * .5;
                (mid * mid * (3 - 2 * mid) < band ? lo = mid : hi = mid);
            }
            const contour = crown + (outer - crown) * (lo + hi) * .5;
            const norm = Math.sqrt(Math.sqrt(Math.cos(a) ** 4 + Math.sin(a) ** 4));
            const r0 = contour / norm;
            const u = Math.cos(a) * r0, v = Math.sin(a) * r0;
            let px = site.x + u * site.rx * c - v * site.rz * s;
            let pz = site.z + u * site.rx * s + v * site.rz * c;
            // Rock relief is always well outward from the heightfield wall.
            const wobble = .55 * Math.sin(3 * a + seed) + .38 * Math.cos(7 * a - seed * .3)
                + .22 * Math.sin(11 * a + t * 7 + seed);
            const shelfPhase = (topY - y) / 48 + .35 * Math.sin(a * 2 + seed);
            const local = shelfPhase - Math.floor(shelfPhase);
            const shelf = Math.min(1, Math.max(0, local / .08)) * (1 - Math.min(1, Math.max(0, (local - .62) / .08)));
            const split = Math.max(0, Math.cos(a * 5 + seed * .4)) ** 12;
            const groove = Math.max(0, Math.cos(a * 9 + seed * .7)) ** 20;
            const offset = innerMound
                ? Math.max(.4, 1.1 + .6 * shelf + wobble * .4 - split * .35)
                : Math.max(3.0, 4.4 + 1.8 * shelf + wobble * .8 - split * .7 - groove * .3);
            const dx = px - site.x, dz = pz - site.z, length = Math.max(.001, Math.hypot(dx, dz));
            px += dx / length * offset;
            pz += dz / length * offset;
            positions.push(px, y, pz);
            if (j < RINGS) {
                const p = j * SIDES + i, q = j * SIDES + (i + 1) % SIDES;
                indices.push(p, q, p + SIDES, q, q + SIDES, p + SIDES);
            }
        }
    }

    // A closed rock cap under the grass rim: the court stays green, but there is
    // no open tube to see through when looking down over the edge.
    const cap = positions.length / 3;
    positions.push(site.x, top - (innerMound ? .95 : .38), site.z);
    for (let i = 0; i < SIDES; i++)
        indices.push(cap, i, (i + 1) % SIDES);

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const profile = new Float32Array((positions.length / 3) * 2);
    for (let i = 0; i < profile.length; i += 2) { profile[i] = site.strike; profile[i + 1] = seed; }
    geometry.setAttribute('aGeologicProfile', new T.BufferAttribute(profile, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

export function makeTerraceCliffs(material: T.Material) {
    const group = new T.Group();
    group.name = 'peakland-terrace-cliffs';
    for (const [index, site] of terraces.entries()) {
        const mesh = new T.Mesh(terraceGeometry(site, index), material);
        mesh.name = `peak-terrace-cliff-${index}`;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    return group;
}
