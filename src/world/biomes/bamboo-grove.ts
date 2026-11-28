import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canPlantTree, heightAt, randomAt, slopeAt, trailDistance, valueNoise } from '../geo/height';
import { inBuildingLot } from './building-layout';
import { regionalHabitatAt } from '../geo/regional-habitat';
import { shoreDistanceAt } from '../geo/meadow-distribution';
import { addSolid } from '../physics/solid-world';
import { windify, type WindUniforms } from '../../rendering/foliage-wind';
import { dilateTransparentColor } from '../flora/flora-geometry';
import { readArtStyle } from '../../config/settings';
import { bambooSeaRadius, type Region } from '../geo/regions';

export { bambooSeaRadius };
const up = new T.Vector3(0, 1, 0);

/** Procedural cutout texture of slender, lance-shaped bamboo leaf fans. */
function makeBambooLeafTexture(): T.Texture {
    if (typeof document === 'undefined') {
        const data = new Uint8Array([134, 178, 102, 255]);
        const fallback = new T.DataTexture(data, 1, 1, T.RGBAFormat);
        fallback.needsUpdate = true;
        return fallback;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    let seed = 41927;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

    // Draw several small twig-anchored fans of pointed bamboo blades.
    const clusters = [
        [128, 224, -Math.PI / 2, 1.0],
        [92, 172, -Math.PI / 2 - .45, .86],
        [164, 168, -Math.PI / 2 + .42, .86],
        [112, 118, -Math.PI / 2 - .22, .78],
        [148, 114, -Math.PI / 2 + .24, .78],
    ] as const;

    // Subtle slender stem linking the fans
    ctx.strokeStyle = '#5c7c40';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(128, 248);
    ctx.quadraticCurveTo(124, 170, 130, 88);
    ctx.stroke();

    const isGuofeng = readArtStyle() === 'guofeng';
    for (const [cx, cy, baseAngle, scale] of clusters) {
        const blades = isGuofeng ? 9 : 7;
        for (let i = 0; i < blades; i++) {
            const spread = (i / (blades - 1) - .5) * 2.1 + (rand() - .5) * .22;
            const angle = baseAngle + spread;
            const length = (68 + rand() * 38) * scale;
            const width = ((isGuofeng ? 9.5 : 6.5) + rand() * (isGuofeng ? 4.8 : 3.8)) * scale;
            const curve = (rand() - .5) * 14 * scale;
            const light = .32 + (1 - cy / 256) * .42 + rand() * .26;
            const r = Math.round(isGuofeng ? (86 + 96 * light) : (92 + 120 * light));
            const g = Math.round(isGuofeng ? (132 + 78 * light) : (148 + 94 * light));
            const b = Math.round(isGuofeng ? (78 + 56 * light) : (74 + 62 * light));

            ctx.save();
            ctx.translate(cx + (rand() - .5) * 10, cy + (rand() - .5) * 10);
            ctx.rotate(angle);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(length * .38, -width + curve * .3, length, curve);
            ctx.quadraticCurveTo(length * .38, width + curve * .3, 0, 0);
            ctx.closePath();
            ctx.fill();

            // Delicate sunlit midrib vein
            ctx.strokeStyle = `rgba(${Math.min(255, r + 35)},${Math.min(255, g + 35)},${Math.min(255, b + 20)},0.45)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(2, 0);
            ctx.quadraticCurveTo(length * .45, curve * .35, length * .92, curve * .92);
            ctx.stroke();
            ctx.restore();
        }
    }

    if (isGuofeng) dilateTransparentColor(ctx, 256, 8);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

/** Tapered slender branch twig sprouting from a bamboo node. */
function makeTwig(start: T.Vector3, end: T.Vector3, r0: number, r1: number) {
    const mid = start.clone().lerp(end, .52);
    mid.y += start.distanceTo(end) * .12;
    const curve = new T.CatmullRomCurve3([start, mid, end]);
    const segs = 3, sides = 4;
    const pos: number[] = [], colors: number[] = [], idx: number[] = [];
    const q = new T.Quaternion();
    for (let j = 0; j <= segs; j++) {
        const t = j / segs, p = curve.getPoint(t), r = T.MathUtils.lerp(r0, r1, t);
        q.setFromUnitVectors(up, curve.getTangent(t));
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            const v = new T.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(q).add(p);
            pos.push(v.x, v.y, v.z);
            const shade = .74 + .22 * t;
            colors.push(shade * .78, shade * .96, shade * .64);
        }
        if (j < segs) {
            for (let i = 0; i < sides; i++) {
                const a = j * (sides + 1) + i;
                idx.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
            }
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

/** Gently arched spray card of lance-shaped bamboo leaves. */
function makeLeafFan(anchor: T.Vector3, dir: T.Vector3, width: number, length: number, droop: number, shade: number, roll = 0) {
    const forward = dir.clone().setY(0);
    if (forward.lengthSq() < 1e-4) forward.set(1, 0, 0);
    forward.normalize();
    const right = new T.Vector3(-forward.z, 0, forward.x);
    const tilt = new T.Vector3(0, 1, 0).addScaledVector(right, Math.sin(roll) * .45).normalize();
    const side = new T.Vector3().crossVectors(forward, tilt).normalize();

    const pos: number[] = [], uv: number[] = [], colors: number[] = [], normals: number[] = [], idx: number[] = [];
    const rows = 3;
    for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const archY = Math.sin(v * Math.PI * .78) * length * .14 - v * v * droop;
        const center = anchor.clone()
            .addScaledVector(forward, v * length)
            .addScaledVector(up, archY);
        const halfW = width * (.45 + .55 * Math.sin(Math.min(1, v * 1.15) * Math.PI * .85));
        for (const s of [-1, 1]) {
            const p = center.clone()
                .addScaledVector(side, s * halfW)
                .addScaledVector(up, -Math.abs(s) * halfW * .12);
            pos.push(p.x, p.y, p.z);
            uv.push(s < 0 ? 0 : 1, v);
            const tipLight = shade * (.82 + .30 * v);
            colors.push(tipLight * .96, tipLight * 1.03, tipLight * .86);
            const n = up.clone().multiplyScalar(.78).addScaledVector(forward, .35 * v).addScaledVector(side, s * .22).normalize();
            normals.push(n.x, n.y, n.z);
        }
        if (j < rows) {
            const base = j * 2;
            idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    g.setIndex(idx);
    return g;
}

/** Sculpted segmented bamboo culm with pale node rings, fine twigs, and layered feathery canopy. */
function makeBambooVariant(height: number, lean: number, seed: number) {
    const spine = new T.CatmullRomCurve3([
        new T.Vector3(0, -.35, 0),
        new T.Vector3(lean * .08, height * .32, lean * .03),
        new T.Vector3(lean * .38, height * .68, -lean * .04),
        new T.Vector3(lean, height, lean * .06),
    ]);

    const internodes = 8;
    const sides = 5;
    const ringProfile: { t: number; bulge: number; nodeTone: number }[] = [];
    for (let n = 0; n < internodes; n++) {
        const t0 = n / internodes, t1 = (n + 1) / internodes, span = t1 - t0;
        if (n === 0) ringProfile.push({ t: 0, bulge: 1.18, nodeTone: 0 });
        ringProfile.push({ t: t0 + span * .45, bulge: .97, nodeTone: 0 });
        ringProfile.push({ t: t1 - span * .06, bulge: .99, nodeTone: .25 });
        ringProfile.push({ t: t1, bulge: 1.16, nodeTone: 1.0 });
        if (n < internodes - 1) ringProfile.push({ t: t1 + span * .05, bulge: .98, nodeTone: .30 });
    }

    const pos: number[] = [], colors: number[] = [], idx: number[] = [];
    const q = new T.Quaternion();
    const baseRadius = .165, tipRadius = .038;
    for (let j = 0; j < ringProfile.length; j++) {
        const { t, bulge, nodeTone } = ringProfile[j];
        const clampedT = Math.min(1, t);
        const p = spine.getPoint(clampedT);
        q.setFromUnitVectors(up, spine.getTangent(clampedT));
        const r = T.MathUtils.lerp(baseRadius, tipRadius, clampedT ** .88) * bulge;
        for (let i = 0; i <= sides; i++) {
            const a = (i / sides) * Math.PI * 2;
            const v = new T.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(q).add(p);
            pos.push(v.x, v.y, v.z);
            // Natural Moso bamboo gradient: darker olive-green at base, pale powdery ring at nodes.
            const heightLift = .62 + .42 * clampedT;
            const cr = T.MathUtils.lerp(.46 * heightLift, .84, nodeTone * .72);
            const cg = T.MathUtils.lerp(.70 * heightLift, .90, nodeTone * .62);
            const cb = T.MathUtils.lerp(.36 * heightLift, .66, nodeTone * .75);
            colors.push(cr, cg, cb);
        }
        if (j < ringProfile.length - 1) {
            for (let i = 0; i < sides; i++) {
                const a = j * (sides + 1) + i;
                idx.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
            }
        }
    }

    const culmBase = new T.BufferGeometry();
    culmBase.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    culmBase.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    culmBase.setIndex(idx);
    culmBase.computeVertexNormals();

    const stemParts: T.BufferGeometry[] = [culmBase];
    const leafParts: T.BufferGeometry[] = [];

    // Sprout twigs and feathery leaf fans from the upper 65% of the culm.
    for (let n = 3; n <= internodes; n++) {
        const t = Math.min(.99, n / internodes);
        const nodePos = spine.getPoint(t);
        const branches = n >= internodes - 1 ? 4 : n >= 5 ? 3 : 2;
        const crownFactor = (t - .30) / .70;
        for (let b = 0; b < branches; b++) {
            const a = seed * 1.7 + n * 2.399 + b * (Math.PI * 2 / branches) + (randomAt(n, b, seed) - .5) * .45;
            const reach = (1.35 + .95 * Math.sin(crownFactor * Math.PI * .85)) * (.82 + randomAt(b, n, seed + 5) * .36);
            const rise = reach * (.38 + .25 * crownFactor);
            const dir = new T.Vector3(Math.cos(a), 0, Math.sin(a));
            const tip = nodePos.clone().addScaledVector(dir, reach).add(new T.Vector3(0, rise, 0));
            stemParts.push(makeTwig(nodePos, tip, .025 * (1 - crownFactor * .4), .007));

            const fanLength = (2.15 + 1.15 * (1 - Math.abs(crownFactor - .55))) * (.88 + randomAt(n, b, seed + 9) * .26);
            const fanWidth = fanLength * .84;
            const shade = .74 + .34 * crownFactor;
            // Pair two crossed/tilted sprays per twig so the canopy forms a lush bamboo ceiling.
            leafParts.push(makeLeafFan(nodePos.clone().lerp(tip, .52), dir, fanWidth, fanLength, fanLength * .34, shade, .32));
            const sideDir = dir.clone().applyAxisAngle(up, (b % 2 ? 1 : -1) * .52);
            leafParts.push(makeLeafFan(tip, sideDir, fanWidth * .90, fanLength * .94, fanLength * .42, shade * 1.04, -.36));
        }
    }

    // Arching crown plume at the very top of the stalk.
    const topPos = spine.getPoint(1);
    for (let k = 0; k < 4; k++) {
        const a = seed + k * Math.PI * .5 + .35;
        const dir = new T.Vector3(Math.cos(a), 0, Math.sin(a));
        leafParts.push(makeLeafFan(topPos.clone().add(new T.Vector3(0, -.35, 0)), dir, 1.95, 2.55, .78, 1.08, (k % 2 ? .28 : -.28)));
    }

    const culm = mergeGeometries(stemParts);
    const canopy = mergeGeometries(leafParts);
    stemParts.forEach(g => g.dispose());
    leafParts.forEach(g => g.dispose());
    if (!culm || !canopy) throw new Error('Unable to merge bamboo variant geometry');
    return { culm, canopy };
}

/** Populate the Bamboo Sea (听竹泽) with dense, multi-stalk arching bamboo clumps. */
export function populateBambooGrove(group: T.Group, region: Region, wind: WindUniforms) {
    const variants = [
        makeBambooVariant(18.5, 1.55, 11),
        makeBambooVariant(14.8, 2.45, 29),
    ];

    const isGuofeng = readArtStyle() === 'guofeng';
    const leafTexture = makeBambooLeafTexture();
    const culmMaterial = new T.MeshLambertMaterial({ vertexColors: true });
    const leafMaterial = new T.MeshLambertMaterial({
        map: leafTexture,
        alphaTest: isGuofeng ? .32 : .34,
        alphaToCoverage: !isGuofeng,
        vertexColors: true,
        side: T.DoubleSide,
    });
    windify(culmMaterial, wind, .16, 17);
    windify(leafMaterial, wind, .34, 16);

    type Stalk = { x: number; y: number; z: number; yaw: number; scaleH: number; scaleW: number; hueShift: number };
    const buckets: Stalk[][] = [[], []];

    // Scatter dense bamboo clumps across the full 听竹泽 wetland & gentle slopes,
    // framing both sides of the winding dirt trails like a true bamboo corridor.
    const clumpAttempts = 1120;
    const radiusX = 345, radiusZ = 315;
    for (let i = 0; i < clumpAttempts; i++) {
        const golden = i * 2.39996;
        const radial = Math.sqrt((i + .5) / clumpAttempts);
        const cx = region.x + Math.cos(golden) * radial * radiusX + (randomAt(i, 11, 74) - .5) * 14;
        const cz = region.z + Math.sin(golden) * radial * radiusZ + (randomAt(i, 19, 74) - .5) * 14;

        const pathDist = trailDistance(cx, cz);
        if (pathDist < 3.4 || inBuildingLot(cx, cz, 5.2) || !canPlantTree(cx, cz, .95)) continue;
        const cy = heightAt(cx, cz), slope = slopeAt(cx, cz);
        if (slope > .74) continue;

        const habitat = regionalHabitatAt(cx, cz, cy, slope, shoreDistanceAt(cx, cz));
        const glade = valueNoise(cx * .018, cz * .018, 91);
        const edgeWarp = (valueNoise(cx * .0065, cz * .0065, 83) - .5) * .36;
        const perimeter = radial + edgeWarp;
        // Feather the outer bamboo perimeter organically so it blends naturally from high altitude.
        if (perimeter > 1.04) continue;
        if (perimeter > .66) {
            const edgeKeep = (1 - (perimeter - .66) / .38) * (.55 + habitat.woodland * .55);
            if (randomAt(cx, cz, 128) > edgeKeep) continue;
        }
        if (glade < .15 && pathDist > 12 && randomAt(cx, cz, 129) > .45) continue;

        const rimTaper = perimeter > .72 ? 1 - Math.min(1, (perimeter - .72) / .34) * .26 : 1;
        const stalksInClump = 5 + Math.floor(randomAt(i, 23, 74) * 4); // 5..8 stalks per clump
        let clumpPlanted = 0;
        for (let s = 0; s < stalksInClump; s++) {
            const sa = s * 2.399 + randomAt(i, s, 31) * 1.1;
            const sr = s === 0 ? randomAt(i, s, 32) * .45 : .70 + randomAt(i, s, 33) * 2.55;
            const x = cx + Math.cos(sa) * sr;
            const z = cz + Math.sin(sa) * sr;
            if (trailDistance(x, z) < 2.6 || inBuildingLot(x, z, 4.0) || !canPlantTree(x, z, .45)) continue;
            const y = heightAt(x, z);
            const variant = (s + i) % 4 === 0 || sr > 2.0 ? 1 : 0;
            const scaleH = (.82 + randomAt(x, z, 41) * .58) * rimTaper;
            const scaleW = .86 + randomAt(x, z, 42) * .42;
            // Arch outer stalks slightly outward from clump centre for an authentic bamboo grove silhouette.
            const yaw = sr > .5 ? -sa + (randomAt(x, z, 43) - .5) * .9 : randomAt(x, z, 44) * Math.PI * 2;
            const hueShift = randomAt(x, z, 45);
            buckets[variant].push({ x, y, z, yaw, scaleH, scaleW, hueShift });
            clumpPlanted++;
        }

        // One lightweight collision cylinder per clump core keeps paths navigable and physics fast.
        if (clumpPlanted > 0) {
            const radius = .72;
            addSolid(group, {
                minX: cx - radius, maxX: cx + radius,
                minY: cy, maxY: cy + 8,
                minZ: cz - radius, maxZ: cz + radius,
                radius,
            });
        }
    }

    const dummy = new T.Object3D();
    const stemTint = new T.Color();
    const leafTint = new T.Color();
    const freshLeaf = new T.Color(isGuofeng ? '#8eb872' : '#b6d476');
    const deepLeaf = new T.Color(isGuofeng ? '#4c7a5c' : '#6ca86b');
    const jadeStem = new T.Color(isGuofeng ? '#769a68' : '#95b874');
    const oliveStem = new T.Color(isGuofeng ? '#4d6c4e' : '#6c8d58');

    buckets.forEach((stalks, v) => {
        if (!stalks.length) {
            variants[v].culm.dispose();
            variants[v].canopy.dispose();
            return;
        }
        const culms = new T.InstancedMesh(variants[v].culm, culmMaterial, stalks.length);
        const canopies = new T.InstancedMesh(variants[v].canopy, leafMaterial, stalks.length);
        culms.instanceMatrix.setUsage(T.StaticDrawUsage);
        canopies.instanceMatrix.setUsage(T.StaticDrawUsage);

        stalks.forEach((s, i) => {
            dummy.position.set(s.x, s.y, s.z);
            dummy.rotation.set(0, s.yaw, 0);
            dummy.scale.set(s.scaleW, s.scaleH, s.scaleW);
            dummy.updateMatrix();
            culms.setMatrixAt(i, dummy.matrix);
            canopies.setMatrixAt(i, dummy.matrix);

            stemTint.copy(oliveStem).lerp(jadeStem, s.hueShift).multiplyScalar(.88 + randomAt(s.x, s.z, 51) * .22);
            leafTint.copy(deepLeaf).lerp(freshLeaf, s.hueShift).multiplyScalar(.86 + randomAt(s.x, s.z, 52) * .28);
            culms.setColorAt(i, stemTint);
            canopies.setColorAt(i, leafTint);
        });

        culms.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = true;
        if (culms.instanceColor) culms.instanceColor.needsUpdate = true;
        if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
        culms.computeBoundingSphere();
        canopies.computeBoundingSphere();
        culms.castShadow = culms.receiveShadow = true;
        // Culms cast crisp vertical bamboo shadows; skipping alpha-tested canopy shadow pass keeps FPS high.
        canopies.castShadow = false;
        canopies.receiveShadow = true;
        culms.name = `bamboo-culms-${v}`;
        canopies.name = `bamboo-canopies-${v}`;
        group.add(culms, canopies);
    });
}
