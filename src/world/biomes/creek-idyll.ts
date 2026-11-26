import * as T from 'three';
import { heightAt, randomAt, slopeAt, trailDistance } from '../geo/height';
import { rivers, waterSurfaceAt } from '../geo/geo-core';
import { makeHouse } from './house-models';
import { makeShoreStoneGeometry, makeShoreStoneMaterial } from '../../rendering/shore-stone';
import { makeGrassTuft, makeLeafTexture, makeValleyTree } from '../flora/flora-geometry';
import { addBoulderSolid, addSolid } from '../physics/solid-world';
import { windify, type WindUniforms } from '../flora/vegetation';
import { atmosphereUniforms } from '../../rendering/aerial-perspective';

// Pastoral creek-bridge crossing in Changfeng Valley (sakura-creek rustic stone arch).
const bridgeStart = { x: 183, z: 23 };
const bridgeEnd = { x: 131, z: -29 };
const bridgeMid = { x: (bridgeStart.x + bridgeEnd.x) * .5, z: (bridgeStart.z + bridgeEnd.z) * .5 };

function dryBankSpot(x: number, z: number) {
    const y = heightAt(x, z);
    const water = waterSurfaceAt(x, z, 6);
    return (!Number.isFinite(water) || y > water + 1.4) && trailDistance(x, z) > 6.5 && slopeAt(x, z) < .48;
}

/**
 * Ghibli-inspired pastoral creek bridge setting in Changfeng Valley:
 * two thatched cottages with stone chimneys on opposite grassy banks,
 * mossy boulders hugging the bridge abutments & creek shore, framing broadleaf
 * trees, and colourful streamside sedge & wildflower drifts.
 */
export function populateCreekIdyll(group: T.Group, wind: WindUniforms) {
    const idyll = new T.Group();
    idyll.name = 'valley-creek-idyll';

    // 1) Two cozy cottages with stone chimneys on opposite banks framing the rustic arch bridge.
    // Note: makeHouse() normalizes geometry to a 1x1x1 unit cube, so scale is in real metres.
    const cottageSpecs = [
        { x: 196, z: -4, yaw: -Math.PI * .68, w: 11.5, h: 10.5, d: 9.8 },
        { x: 120, z: -48, yaw: Math.PI * .22, w: 9.6, h: 9.2, d: 8.6 },
    ];
    const wallMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .88, side: T.DoubleSide });
    const glassMat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
    glassMat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.fragmentShader = 'uniform float uAtmoLight;\n' + shader.fragmentShader.replace(
            '#include <tonemapping_fragment>',
            `float nightGlow = 1.0 - smoothstep(0.42, 0.86, uAtmoLight);
            gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.88, vec3(1.95, 1.32, 0.56), nightGlow * 0.92);
            #include <tonemapping_fragment>`
        );
    };
    const footingMat = new T.MeshStandardMaterial({ color: '#8f8876', roughness: .94 });
    const footingGeo = new T.BoxGeometry(1, 1, 1).translate(0, .5, 0);
    const houseModel = makeHouse('cottage', 0);

    for (const [idx, spec] of cottageSpecs.entries()) {
        let px = spec.x, pz = spec.z;
        if (!dryBankSpot(px, pz)) {
            for (let r = 4; r <= 24; r += 4) {
                let found = false;
                for (let a = 0; a < 8; a++) {
                    const ang = a * Math.PI / 4;
                    const tx = spec.x + Math.cos(ang) * r, tz = spec.z + Math.sin(ang) * r;
                    if (dryBankSpot(tx, tz)) { px = tx; pz = tz; found = true; break; }
                }
                if (found) break;
            }
        }
        const halfX = spec.w * .38, halfZ = spec.d * .38;
        let base = Infinity, high = -Infinity;
        for (const sx of [-halfX, 0, halfX]) for (const sz of [-halfZ, 0, halfZ]) {
            const hy = heightAt(px + sx, pz + sz);
            base = Math.min(base, hy);
            high = Math.max(high, hy);
        }
        const floor = high + .05;
        const house = new T.Group();
        house.position.set(px, floor, pz);
        house.rotation.y = spec.yaw;
        house.scale.set(spec.w, spec.h, spec.d);
        const shell = new T.Mesh(houseModel.shell, wallMat);
        shell.castShadow = shell.receiveShadow = true;
        house.add(shell);
        if (houseModel.glow) {
            const glow = new T.Mesh(houseModel.glow, glassMat);
            house.add(glow);
        }
        house.name = `creek-idyll-cottage-${idx}`;
        idyll.add(house);

        // Stone foundation plinth so the cottage sits solidly on the sloped riverbank.
        const plinth = new T.Mesh(footingGeo, footingMat);
        plinth.position.set(px, base - .25, pz);
        plinth.rotation.y = spec.yaw;
        plinth.scale.set(halfX * 2.02, floor - base + .25, halfZ * 2.02);
        plinth.castShadow = plinth.receiveShadow = true;
        idyll.add(plinth);

        const colR = Math.max(halfX, halfZ) * .92;
        addSolid(group, { minX: px - colR, maxX: px + colR, minY: base - .25, maxY: floor + spec.h * .55, minZ: pz - colR, maxZ: pz + colR, radius: colR });
    }

    // 2) Framing lush broadleaf trees behind & beside both thatched cottages.
    const leafTex = makeLeafTexture();
    const leafMat = new T.MeshLambertMaterial({
        map: leafTex, alphaTest: .36, alphaToCoverage: true, vertexColors: true, side: T.DoubleSide,
    });
    const barkMat = new T.MeshLambertMaterial({ color: '#73513a', vertexColors: true });
    windify(leafMat, wind, .26, 9.0);
    const treeModels = [makeValleyTree(0, true), makeValleyTree(1, true)];
    const treeSpots = [
        { x: 205, z: -13, form: 0, scale: 1.38 },
        { x: 192, z: -18, form: 1, scale: 1.12 },
        { x: 112, z: -56, form: 0, scale: 1.32 },
        { x: 132, z: -54, form: 1, scale: 1.05 },
        { x: 175, z: 37, form: 1, scale: 1.18 },
    ];
    for (const [i, spot] of treeSpots.entries()) {
        if (!dryBankSpot(spot.x, spot.z)) continue;
        const y = heightAt(spot.x, spot.z) - .12;
        const model = treeModels[spot.form];
        const tree = new T.Group();
        tree.position.set(spot.x, y, spot.z);
        tree.rotation.y = randomAt(spot.x, spot.z, 711 + i) * Math.PI * 2;
        tree.scale.setScalar(spot.scale);
        const trunk = new T.Mesh(model.trunk, barkMat);
        const crown = new T.Mesh(model.canopy, leafMat);
        trunk.castShadow = trunk.receiveShadow = crown.castShadow = crown.receiveShadow = true;
        tree.add(trunk, crown);
        idyll.add(tree);
        const r = .42 * spot.scale;
        addSolid(group, { minX: spot.x - r, maxX: spot.x + r, minY: y, maxY: y + 4 * spot.scale, minZ: spot.z - r, maxZ: spot.z + r, radius: r });
    }

    // 3) Mossy weathered boulders hugging both bridge abutments and lining the creek banks.
    const creek = rivers.find(r => r.id === 'sakura-creek');
    const stonePlacements: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; color: string }[] = [];
    const sedgePlacements: { x: number; y: number; z: number; s: number; ry: number; t: number }[] = [];
    const flowerPlacements: { x: number; y: number; z: number; s: number; ry: number; color: string }[] = [];

    const flowerPalette = ['#f4d44d', '#f5f1de', '#7c8be8', '#e882a6', '#ffd24c'];
    const boulderColors = ['#8c8b78', '#7d836c', '#98927c', '#6e7b5e'];

    // Abutment boulder clusters right beside the rustic stone bridge ends.
    for (const end of [bridgeStart, bridgeEnd]) {
        for (let i = 0; i < 10; i++) {
            const a = i * .63 + randomAt(end.x, i, 720) * .45;
            const dist = 3.6 + randomAt(end.z, i, 721) * 5.4;
            const x = end.x + Math.cos(a) * dist, z = end.z + Math.sin(a) * dist;
            if (trailDistance(x, z) < 2.8) continue;
            const y = heightAt(x, z);
            const size = .55 + randomAt(x, z, 722) * 1.45;
            stonePlacements.push({
                x, y: y - size * .22, z,
                sx: size * (1.1 + randomAt(x, z, 723) * .4),
                sy: size * (.52 + randomAt(x, z, 724) * .32),
                sz: size * (.9 + randomAt(x, z, 725) * .35),
                ry: randomAt(x, z, 726) * Math.PI * 2,
                color: boulderColors[i % boulderColors.length],
            });
        }
    }

    // Creek-bank boulders, lush sedges, and bright riverbank wildflowers along sakura-creek.
    if (creek) {
        const nearSamples = creek.samples.filter(s => Math.hypot(s.x - bridgeMid.x, s.z - bridgeMid.z) < 72);
        for (const [si, s] of nearSamples.entries()) {
            for (const side of [-1, 1]) {
                const bankOffset = s.halfWidth * (.92 + randomAt(si, side, 730) * .38);
                const bx = s.x - s.flowZ * bankOffset * side;
                const bz = s.z + s.flowX * bankOffset * side;
                if (trailDistance(bx, bz) < 3.0) continue;
                const by = heightAt(bx, bz);
                if (randomAt(si, side, 731) > .32) {
                    const size = .45 + randomAt(si, side, 732) * 1.35;
                    stonePlacements.push({
                        x: bx, y: Math.min(by, s.waterLevel + .55) - size * .18, z: bz,
                        sx: size * 1.25, sy: size * .56, sz: size * .95,
                        ry: randomAt(si, side, 733) * Math.PI * 2,
                        color: boulderColors[(si + (side > 0 ? 1 : 0)) % boulderColors.length],
                    });
                }
                // Lush streamside sedge & wildflower drifts slightly above the waterline.
                for (let k = 0; k < 4; k++) {
                    const spread = s.halfWidth * (1.02 + randomAt(si, k * 3 + side, 735) * .68);
                    const along = (randomAt(si, k * 5 + side, 736) - .5) * 6.5;
                    const fx = s.x - s.flowZ * spread * side + s.flowX * along;
                    const fz = s.z + s.flowX * spread * side + s.flowZ * along;
                    if (trailDistance(fx, fz) < 2.6) continue;
                    const fy = heightAt(fx, fz);
                    if (fy < s.waterLevel + .10) continue;
                    sedgePlacements.push({
                        x: fx, y: fy - .05, z: fz,
                        s: .75 + randomAt(fx, fz, 737) * .85,
                        ry: randomAt(fx, fz, 738) * Math.PI * 2,
                        t: randomAt(fx, fz, 739),
                    });
                    if (k < 2) {
                        flowerPlacements.push({
                            x: fx + (randomAt(fx, fz, 740) - .5) * 1.4,
                            y: fy + .22,
                            z: fz + (randomAt(fx, fz, 741) - .5) * 1.4,
                            s: .22 + randomAt(fx, fz, 742) * .20,
                            ry: randomAt(fx, fz, 743) * Math.PI * 2,
                            color: flowerPalette[(si + k) % flowerPalette.length],
                        });
                    }
                }
            }
        }
    }

    const dummy = new T.Object3D(), tint = new T.Color();
    if (stonePlacements.length) {
        const rockGeo = makeShoreStoneGeometry(1);
        rockGeo.computeBoundingBox();
        const rockBase = rockGeo.boundingBox!;
        const rockBox = new T.Box3();
        const rockMat = makeShoreStoneMaterial(1);
        const rocks = new T.InstancedMesh(rockGeo, rockMat, stonePlacements.length);
        rocks.instanceMatrix.setUsage(T.StaticDrawUsage);
        stonePlacements.forEach((p, i) => {
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(.08, p.ry, -.08);
            dummy.scale.set(p.sx, p.sy, p.sz);
            dummy.updateMatrix();
            rocks.setMatrixAt(i, dummy.matrix);
            rocks.setColorAt(i, tint.set(p.color));
            rockBox.copy(rockBase).applyMatrix4(dummy.matrix);
            if (Math.max(rockBox.max.x - rockBox.min.x, rockBox.max.z - rockBox.min.z) > .55) {
                addBoulderSolid(group, rockBox.min.x, rockBox.max.x, rockBox.min.y, rockBox.max.y, rockBox.min.z, rockBox.max.z, p.y);
            }
        });
        rocks.instanceMatrix.needsUpdate = true;
        if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
        rocks.computeBoundingSphere();
        rocks.castShadow = rocks.receiveShadow = true;
        rocks.name = 'creek-idyll-boulders';
        idyll.add(rocks);
    }

    if (sedgePlacements.length) {
        const tuftGeo = makeGrassTuft(7);
        const tuftMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
        windify(tuftMat, wind, .16, .9, true);
        const sedges = new T.InstancedMesh(tuftGeo, tuftMat, sedgePlacements.length);
        sedges.instanceMatrix.setUsage(T.StaticDrawUsage);
        const fresh = new T.Color('#b6cc5c'), deep = new T.Color('#5a8f5e');
        sedgePlacements.forEach((p, i) => {
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.ry, 0);
            dummy.scale.setScalar(p.s);
            dummy.updateMatrix();
            sedges.setMatrixAt(i, dummy.matrix);
            sedges.setColorAt(i, tint.copy(deep).lerp(fresh, p.t));
        });
        sedges.instanceMatrix.needsUpdate = true;
        if (sedges.instanceColor) sedges.instanceColor.needsUpdate = true;
        sedges.computeBoundingSphere();
        sedges.receiveShadow = true;
        sedges.name = 'creek-idyll-sedges';
        idyll.add(sedges);
    }

    if (flowerPlacements.length) {
        const flowerGeo = new T.DodecahedronGeometry(.55, 0).scale(1, .45, 1);
        const flowerMat = new T.MeshLambertMaterial({ color: '#ffffff' });
        windify(flowerMat, wind, .12, 1.0);
        const flowers = new T.InstancedMesh(flowerGeo, flowerMat, flowerPlacements.length);
        flowers.instanceMatrix.setUsage(T.StaticDrawUsage);
        flowerPlacements.forEach((p, i) => {
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(.15, p.ry, -.12);
            dummy.scale.setScalar(p.s);
            dummy.updateMatrix();
            flowers.setMatrixAt(i, dummy.matrix);
            flowers.setColorAt(i, tint.set(p.color));
        });
        flowers.instanceMatrix.needsUpdate = true;
        if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
        flowers.computeBoundingSphere();
        flowers.name = 'creek-idyll-flowers';
        idyll.add(flowers);
    }

    group.add(idyll);
}
