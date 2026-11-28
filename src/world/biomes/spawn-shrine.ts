import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { readArtStyle } from '../../config/settings';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../../rendering/aerial-perspective';
import { heightAt, randomAt } from '../geo/height';
import { shrineDatum, shrineFloor, shrineRadius, valleySpawn } from '../geo/spawn-site';
import { addSolid } from '../physics/solid-world';
import { makeBankFlowerCluster, makeLeafTexture } from '../flora/flora-geometry';
import { windify, type WindUniforms } from '../../rendering/foliage-wind';
import type { SpawnShoreGrass } from '../../rendering/spawn-shore-grass';

const SHRINE_YAW = (-12 * Math.PI) / 180;
const COS_Y = Math.cos(SHRINE_YAW);
const SIN_Y = Math.sin(SHRINE_YAW);

const FINE_DETAIL_DIST_SQ = 75 * 75;
const VFX_DETAIL_DIST_SQ = 110 * 110;
const SHADOW_CAST_DIST_SQ = 140 * 140;
const SHRINE_CULL_DIST_SQ = 380 * 380;

function toWorld(lx: number, lz: number): [number, number] {
    return [
        valleySpawn.x + lx * COS_Y + lz * SIN_Y,
        valleySpawn.z - lx * SIN_Y + lz * COS_Y,
    ];
}

/** Only open single-sided sheets (cloth banner, thin roof eaves) need DoubleSide. */
function needsDoubleSide(matName: string): boolean {
    const n = matName.toLowerCase();
    return n.includes('banner') || n.includes('tile');
}

/** Enhance GLB PBR MeshStandardMaterials with Guofeng sky-hemisphere lift and aerial perspective. */
function enhanceShrinePbrMaterial(mat: T.Material, isGlow: boolean, seen: Set<T.Material>) {
    if (!(mat instanceof T.MeshStandardMaterial) || seen.has(mat)) return;
    seen.add(mat);
    mat.side = needsDoubleSide(mat.name) ? T.DoubleSide : T.FrontSide;
    if (isGlow) {
        mat.emissiveIntensity = 1.65;
        mat.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, atmosphereUniforms);
            shader.fragmentShader = 'uniform float uAtmoLight;\n' + shader.fragmentShader.replace(
                '#include <tonemapping_fragment>',
                `float duskBoost = 1.0 + (1.0 - smoothstep(0.35, 0.90, uAtmoLight)) * 0.95;
                gl_FragColor.rgb *= vec3(1.22, 1.06, 0.78) * duskBoost;
                #include <tonemapping_fragment>`,
            );
        };
        mat.customProgramCacheKey = () => 'guofeng-spawn-glow-pbr-v2';
        return;
    }
    // Share compiled PBR programs across all shrine materials with matching defines
    // (Three.js already keys programs by USE_NORMALMAP / USE_MAP / USE_INSTANCING).
    mat.customProgramCacheKey = () => 'guofeng-spawn-pbr-v2';
    mat.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader = 'varying vec3 vShrineWorld;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec4 shrinePosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                shrinePosition = instanceMatrix * shrinePosition;
            #endif
            vShrineWorld = (modelMatrix * shrinePosition).xyz;`,
        );
        shader.fragmentShader = `${aerialPerspectiveGLSL}\nvarying vec3 vShrineWorld;\n` + shader.fragmentShader
            .replace('#include <fog_fragment>', '')
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                reflectedLight.indirectDiffuse *= mix(vec3(1.14, 1.22, 1.30), vec3(1.22, 1.20, 1.15), uAtmoLight);
                reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(vec3(.06, .09, .12), vec3(.10, .10, .09), uAtmoLight);`)
            .replace('#include <tonemapping_fragment>', `
                float sDist = length(cameraPosition - vShrineWorld);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vShrineWorld), smoothstep(160., 560., sDist));
                #include <tonemapping_fragment>`);
    };
}

/** Glowing celadon-cyan cloud-scroll spirit array inlaid on the circular spawn stone terrace. */
function makeSpiritArrayDisc(time: { value: number }): T.Mesh {
    const geo = new T.CircleGeometry(1.98, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: { uTime: time },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            varying vec2 vUv;
            float ink(float d) { return exp(-d * d); }
            void main() {
                float r = length(vUv);
                if (r > 1.0) discard;
                float a = atan(vUv.y, vUv.x);
                float rotA = a + uTime * 0.12;

                float outerRing = ink((r - 0.90) / 0.024);
                float midRing = ink((r - 0.62) / 0.020) * 0.66;
                float coreRing = ink((r - 0.28) / 0.022) * 0.58;

                float scrollWave = 0.56 + 0.18 * sin(rotA * 4.0 + sin(r * 9.0) * 0.8);
                float cloudScroll = ink((r - scrollWave) / 0.032) * smoothstep(0.22, 0.36, r) * (1.0 - smoothstep(0.80, 0.92, r));
                float innerSwirl = ink((r - (0.34 + 0.12 * cos(rotA * 3.0 - r * 5.0))) / 0.028) * smoothstep(0.10, 0.22, r) * (1.0 - smoothstep(0.55, 0.68, r));
                float ticks = pow(max(0.0, cos(a * 8.0)), 14.0) * ink((r - 0.82) / 0.041) * 0.55;
                float pool = (1.0 - smoothstep(0.0, 0.96, r)) * 0.09;

                float pulse = 0.86 + 0.14 * sin(uTime * 1.9);
                float mask = clamp((outerRing + midRing + coreRing + cloudScroll * 0.88 + innerSwirl * 0.78 + ticks + pool) * pulse, 0.0, 1.0);
                vec3 col = mix(vec3(0.32, 0.86, 0.84), vec3(0.84, 0.99, 0.98), clamp(outerRing + cloudScroll * 0.7, 0.0, 1.0));
                gl_FragColor = vec4(col * 0.84, mask * 0.74);
            }
        `,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 3;
    return mesh;
}

/** Ethereal rising cyan spirit curtain hovering gently around the inner carved stone ring. */
function makeSpiritAuraCurtain(time: { value: number }): T.Mesh {
    const geo = new T.CylinderGeometry(1.84, 1.92, .62, 28, 1, true);
    geo.translate(0, .31, 0);
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        uniforms: { uTime: time },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                float h = vUv.y;
                float fade = smoothstep(0.0, 0.14, h) * pow(1.0 - h, 1.9);
                float wisp1 = 0.55 + 0.45 * sin(vUv.x * 18.85 + uTime * 0.7 - h * 4.5);
                float wisp2 = 0.55 + 0.45 * cos(vUv.x * 31.41 - uTime * 1.1 + h * 6.0);
                float alpha = fade * pow(wisp1 * wisp2, 2.0) * .20;
                vec3 col = mix(vec3(0.38, 0.88, 0.88), vec3(0.82, 0.98, 0.98), (1.0 - h) * 0.65);
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 4;
    return mesh;
}

/** Glowing cyan rune glyph decal placed on the standing stele and cloud-rune boulder. */
function makeRuneGlyphMesh(time: { value: number }, kind: 'stele' | 'cloud'): T.Mesh {
    const geo = new T.PlaneGeometry(kind === 'stele' ? 0.52 : 0.88, kind === 'stele' ? 1.12 : 0.58);
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        uniforms: { uTime: time, uKind: { value: kind === 'stele' ? 0 : 1 } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime, uKind;
            varying vec2 vUv;
            float ink(float d) { return exp(-d * d); }
            void main() {
                float glow = 0.0;
                if (uKind < 0.5) {
                    float spine = ink((vUv.x - 0.12 * sin(vUv.y * 4.2)) / 0.085) * smoothstep(-0.85, -0.55, vUv.y) * (1.0 - smoothstep(0.55, 0.85, vUv.y));
                    float loopTop = ink((length(vUv - vec2(0.0, 0.36)) - 0.24) / 0.075);
                    float strokeMid = ink((vUv.y + 0.08 + 0.14 * vUv.x) / 0.075) * (1.0 - smoothstep(0.28, 0.58, abs(vUv.x)));
                    float dotBot = ink(length(vUv - vec2(-0.08, -0.54)) / 0.14);
                    glow = clamp(spine + loopTop * 0.85 + strokeMid * 0.8 + dotBot * 0.75, 0.0, 1.0);
                } else {
                    float c1 = ink((length((vUv - vec2(0.0, 0.08)) * vec2(1.0, 1.25)) - 0.34) / 0.075) * smoothstep(-0.18, 0.15, vUv.y);
                    float c2 = ink((length(vUv - vec2(-0.42, -0.10)) - 0.22) / 0.075);
                    float c3 = ink((length(vUv - vec2(0.42, -0.10)) - 0.22) / 0.075);
                    float base = ink((vUv.y + 0.32) / 0.065) * (1.0 - smoothstep(0.52, 0.78, abs(vUv.x)));
                    glow = clamp(c1 + c2 * 0.9 + c3 * 0.9 + base * 0.85, 0.0, 1.0);
                }
                if (glow < 0.02) discard;
                float pulse = 0.82 + 0.18 * sin(uTime * 2.2 + uKind * 1.4);
                vec3 col = mix(vec3(0.32, 0.88, 0.88), vec3(0.86, 1.0, 0.99), glow * 0.75);
                gl_FragColor = vec4(col * 1.15, glow * pulse * 0.92);
            }
        `,
    });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 4;
    return mesh;
}

/** Sculpted lush sakura blossom clusters framing the sweeping branches of the leaning spawn sakura tree. */
function makeSakuraCanopyCards(): T.BufferGeometry {
    const clusters: ReadonlyArray<[number, number, number, number]> = [
        [-4.95, 5.15, -1.10, 1.75],
        [-4.35, 4.65, 1.25, 1.55],
        [-4.10, 4.95, -2.65, 1.65],
        [-5.75, 5.35, 0.25, 1.65],
        [-5.40, 5.65, -2.40, 1.55],
        [-2.85, 6.05, -0.75, 1.65],
        [1.35, 4.75, -2.00, 1.45],
        [-3.25, 5.15, -0.45, 1.55],
        [-4.95, 4.90, -0.10, 1.50],
    ];
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const norm: number[] = [];
    const idx: number[] = [];
    const crownCenter = new T.Vector3(-4.0, 5.2, -0.8);

    let seed = 9182;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const vTmp = new T.Vector3();
    const nTmp = new T.Vector3();
    const side = new T.Vector3();
    const lift = new T.Vector3();

    for (const [cx, cy, cz, rad] of clusters) {
        const count = 11;
        for (let i = 0; i < count; i++) {
            const a = i * 2.39996 + (rand() - 0.5) * 0.4;
            const lvl = (i + 0.5) / count;
            const ring = Math.sqrt(Math.max(0.05, 1 - (lvl * 0.8) ** 2));
            const px = cx + Math.cos(a) * rad * ring * (0.7 + rand() * 0.4);
            const py = cy + (lvl - 0.19) * rad * 0.65;
            const pz = cz + Math.sin(a) * rad * ring * (0.7 + rand() * 0.4);

            nTmp.set(px - crownCenter.x, py - crownCenter.y + 1.2, pz - crownCenter.z).normalize();
            side.set(-Math.sin(a), 0, Math.cos(a)).normalize();
            lift.crossVectors(side, nTmp).normalize();

            const w = rad * (0.60 + rand() * 0.23);
            const h = rad * (0.49 + rand() * 0.24);
            const base = pos.length / 3;
            const tone = 0.84 + 0.24 * lvl;
            const corners: ReadonlyArray<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
            for (const [ux, uy] of corners) {
                vTmp.set(px, py, pz).addScaledVector(side, ux * w).addScaledVector(lift, uy * h);
                pos.push(vTmp.x, vTmp.y, vTmp.z);
                uv.push((ux + 1) * 0.5, (uy + 1) * 0.5);
                col.push(tone * (1.02 + 0.04 * uy), tone * (0.86 + 0.06 * uy), tone * (0.93 + 0.04 * uy));
                norm.push(nTmp.x, nTmp.y, nTmp.z);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }

    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(norm, 3));
    g.setIndex(idx);
    return g;
}

/** Bake a placed node's mesh geometry into world space for same-material static batching. */
function cloneBakedGeometry(mesh: T.Mesh, x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1): T.BufferGeometry {
    const g = mesh.geometry.clone();
    if (g.hasAttribute('color1')) g.deleteAttribute('color1');
    const m = new T.Matrix4().compose(
        new T.Vector3(x, y, z),
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), ry),
        new T.Vector3(sx, sy, sz),
    );
    g.applyMatrix4(m);
    return g;
}

/** Spawn Sanctuary (长风聚灵台) with tiered distance culling and batched GLB props. */
export class SpawnShrine extends T.Group {
    readonly ready?: Promise<void>;
    private readonly center = new T.Vector3(valleySpawn.x, shrineFloor, valleySpawn.z);
    private readonly fineDetails: T.Object3D[] = [];
    private readonly vfxDetails: T.Object3D[] = [];
    private readonly shadowCasters: T.Object3D[] = [];
    private fineVisible = true;
    private vfxVisible = true;
    private shadowsEnabled = true;

    constructor(owner: T.Group, time: { value: number }, wind: WindUniforms, spawnShoreGrass?: SpawnShoreGrass) {
        super();
        this.name = 'spawn-shrine';

        const { x: centerX, z: centerZ } = valleySpawn;

        // The inset disc and raised flagstones share a low, walkable footprint.
        addSolid(owner, {
            minX: centerX - shrineRadius,
            maxX: centerX + shrineRadius,
            minZ: centerZ - shrineRadius,
            maxZ: centerZ + shrineRadius,
            minY: shrineDatum - .68,
            maxY: shrineDatum + .07,
            step: true,
            volume: true,
            radius: 4.06,
            roof: (x, z) => {
                const r = Math.hypot(x - centerX, z - centerZ);
                return shrineFloor + .055 * T.MathUtils.smoothstep(r, 1.95, 2.20) * (1 - T.MathUtils.smoothstep(r, 3.55, 4.20));
            },
        });

        const fallback = new T.Mesh(
            new T.CylinderGeometry(4.06, shrineRadius, .61, 32).translate(0, -.305, 0),
            new T.MeshLambertMaterial({ color: '#87918a' }),
        );
        fallback.name = 'shrine-stone-base';
        fallback.position.set(centerX, shrineFloor, centerZ);
        fallback.receiveShadow = true;
        this.add(fallback);

        // 2. Glowing celadon-cyan cloud-rune spirit array + rising spirit aura curtain
        const arrayDisc = makeSpiritArrayDisc(time);
        arrayDisc.name = 'spirit-array';
        arrayDisc.position.set(centerX, shrineFloor + .016, centerZ);
        arrayDisc.rotation.y = SHRINE_YAW;
        const auraCurtain = makeSpiritAuraCurtain(time);
        auraCurtain.position.set(centerX, shrineFloor + .018, centerZ);
        this.add(arrayDisc, auraCurtain);
        this.vfxDetails.push(arrayDisc, auraCurtain);

        // 3. Scattered fallen pink sakura petals resting across the terrace & right garden grass
        const petalGeo = new T.CircleGeometry(0.08, 5);
        petalGeo.rotateX(-Math.PI / 2);
        const petalMat = new T.MeshLambertMaterial({ color: '#ffd4e6', side: T.DoubleSide });
        const petalCount = 72;
        const petals = new T.InstancedMesh(petalGeo, petalMat, petalCount);
        const dummy = new T.Object3D();
        const pCol = new T.Color();
        let petalIndex = 0;
        for (let i = 0; i < petalCount; i++) {
            const a = i * 2.39996 + randomAt(i, 19, 912) * 0.4;
            const r = 1.65 + Math.sqrt(randomAt(i, 23, 912)) * 4.4;
            const lx = Math.cos(a) * r + 1.1;
            const lz = Math.sin(a) * r - 0.6;
            const [wx, wz] = toWorld(lx, lz);
            const rToCenter = Math.hypot(wx - centerX, wz - centerZ);
            const onTerrace = rToCenter < 4.00;
            if (!onTerrace && spawnShoreGrass?.blocksPlant(wx, wz, .20)) continue;
            const py = onTerrace ? shrineDatum + (rToCenter < 1.98 ? .002 : .064) : heightAt(wx, wz) + .03;
            dummy.position.set(wx, py, wz);
            dummy.rotation.set(0, randomAt(i, 29, 912) * Math.PI * 2, 0);
            const s = 0.7 + randomAt(i, 31, 912) * 0.85;
            dummy.scale.set(s * 1.35, 1, s * 0.85);
            dummy.updateMatrix();
            petals.setMatrixAt(petalIndex, dummy.matrix);
            petals.setColorAt(petalIndex++, pCol.set(i % 3 === 0 ? '#ffe8f2' : i % 3 === 1 ? '#ffc4de' : '#ffabc9'));
        }
        petals.count = petalIndex;
        petals.instanceMatrix.needsUpdate = true;
        if (petals.instanceColor) petals.instanceColor.needsUpdate = true;
        petals.receiveShadow = true;
        this.add(petals);
        this.fineDetails.push(petals);

        const flowerBanks = [[74.9, 157.9], [76.0, 155.1], [75.0, 163.1], [83.1, 163.0], [84.1, 158.7], [85.4, 154.9], [78.8, 152.3]];
        const blooms = new T.InstancedMesh(
            makeBankFlowerCluster(),
            new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }),
            flowerBanks.length * 5,
        );
        let flowerIndex = 0;
        for (const [x, z] of flowerBanks) {
            for (let i = 0; i < 5; i++) {
                const wx = x + (randomAt(x, i, 916) - .5) * 1.3;
                const wz = z + (randomAt(z, i, 917) - .5) * 1.1;
                if (Math.hypot(wx - centerX, wz - centerZ) < 4.27 || spawnShoreGrass?.blocksPlant(wx, wz, .54)) continue;
                dummy.position.set(wx, heightAt(wx, wz) - .03, wz);
                dummy.rotation.set(0, randomAt(wx, wz, 918) * Math.PI * 2, 0);
                dummy.scale.setScalar(.57 + randomAt(wx, wz, 919) * .43);
                dummy.updateMatrix();
                blooms.setMatrixAt(flowerIndex, dummy.matrix);
                blooms.setColorAt(flowerIndex++, pCol.set(x < 79 ? '#fff0eb' : '#e7a8bc'));
            }
        }
        blooms.count = flowerIndex;
        blooms.instanceMatrix.needsUpdate = true;
        if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
        blooms.receiveShadow = true;
        this.add(blooms);
        this.fineDetails.push(blooms);

        // 4. Coordinates & colliders for hero props (every prop grounded cleanly on leveled terrain)
        const [rbx, rbz] = toWorld(4.85, -1.55);
        const rby = heightAt(rbx, rbz) - 0.12;
        addSolid(owner, { minX: rbx - 1.15, maxX: rbx + 1.15, minZ: rbz - 1.05, maxZ: rbz + 1.05, minY: rby - 0.5, maxY: rby + 1.25, radius: 1.05 });

        // Glowing cyan cloud glyph on the sculpted boulder's chiseled front face
        const cloudGlyph = makeRuneGlyphMesh(time, 'cloud');
        const [cgx, cgz] = toWorld(4.02, -0.92);
        cloudGlyph.position.set(cgx, rby + 0.66, cgz);
        cloudGlyph.rotation.y = SHRINE_YAW - 0.62;
        this.add(cloudGlyph);
        this.vfxDetails.push(cloudGlyph);

        // Left-side standing rune stele & glowing vertical cyan Daoist glyph
        const [stx, stz] = toWorld(-2.75, -3.55);
        const sty = heightAt(stx, stz) - 0.08;
        const steleGlyph = makeRuneGlyphMesh(time, 'stele');
        const [sgx, sgz] = toWorld(-2.54, -3.14);
        steleGlyph.position.set(sgx, sty + 1.06, sgz);
        steleGlyph.rotation.y = SHRINE_YAW + 0.35;
        this.add(steleGlyph);
        this.vfxDetails.push(steleGlyph);
        addSolid(owner, { minX: stx - 0.65, maxX: stx + 0.65, minZ: stz - 0.65, maxZ: stz + 0.65, minY: sty - 0.5, maxY: sty + 1.95, radius: 0.55 });

        // 5. Leaning Sakura blossom canopy + collider (gnarled PBR bark trunk comes from Blender GLB)
        const [skx, skz] = toWorld(6.65, -1.35);
        const sky = heightAt(skx, skz) - 0.08;
        const blossomTex = makeLeafTexture(true);
        const blossomMat = new T.MeshLambertMaterial({
            map: blossomTex,
            color: '#ffe6f1',
            alphaTest: 0.34,
            alphaToCoverage: false,
            vertexColors: true,
            side: T.DoubleSide,
        });
        windify(blossomMat, wind, 0.16, 6.2);
        const sakuraCanopy = new T.Mesh(makeSakuraCanopyCards(), blossomMat);
        sakuraCanopy.position.set(skx, sky, skz);
        sakuraCanopy.rotation.y = SHRINE_YAW;
        sakuraCanopy.castShadow = sakuraCanopy.receiveShadow = true;
        this.add(sakuraCanopy);
        this.shadowCasters.push(sakuraCanopy);
        addSolid(owner, { minX: skx - 0.85, maxX: skx + 0.85, minZ: skz - 0.85, maxZ: skz + 0.85, minY: sky - 0.5, maxY: sky + 4.5, radius: 0.78 });

        // 6. Colliders for right-side curved-eave waypost & stone lantern
        const [wpx, wpz] = toWorld(3.55, -3.20);
        const wpy = heightAt(wpx, wpz) - 0.06;
        addSolid(owner, { minX: wpx - 0.55, maxX: wpx + 0.55, minZ: wpz - 0.55, maxZ: wpz + 0.55, minY: wpy - 0.5, maxY: wpy + 3.6, radius: 0.45 });

        const [slx, slz] = toWorld(2.25, -4.85);
        const sly = heightAt(slx, slz) - 0.06;
        addSolid(owner, { minX: slx - 0.55, maxX: slx + 0.55, minZ: slz - 0.55, maxZ: slz + 0.55, minY: sly - 0.5, maxY: sly + 1.9, radius: 0.48 });

        // Keep the walkable base available if the sculpted assets cannot load.
        if (typeof window === 'undefined') return;
        const url = new URL('../../../resource/architecture/guofeng_spawn_shrine.glb', import.meta.url).href;

        this.ready = new GLTFLoader().loadAsync(url).then(gltf => {
            const nodes = new Map<string, T.Object3D>();
            const seenMaterials = new Set<T.Material>();
            for (const child of gltf.scene.children) {
                nodes.set(child.name.toLowerCase(), child);
                const isGlow = child.name.toLowerCase().includes('glow');
                child.traverse(o => {
                    if (!(o instanceof T.Mesh)) return;
                    if (o.geometry.hasAttribute('color1')) o.geometry.deleteAttribute('color1');
                    o.castShadow = !isGlow;
                    o.receiveShadow = !isGlow;
                    if (Array.isArray(o.material)) {
                        o.material.forEach(m => enhanceShrinePbrMaterial(m, isGlow, seenMaterials));
                    } else if (o.material) {
                        enhanceShrinePbrMaterial(o.material, isGlow, seenMaterials);
                    }
                });
            }

            const placeNode = (name: string, x: number, y: number, z: number, ry: number, castShadow: boolean, sx = 1, sy = 1, sz = 1) => {
                const src = nodes.get(name.toLowerCase());
                if (!src) return;
                const inst = src.clone(true);
                inst.position.set(x, y, z);
                inst.rotation.y = ry;
                inst.scale.set(sx, sy, sz);
                inst.traverse(o => {
                    if (!(o instanceof T.Mesh)) return;
                    o.castShadow = castShadow && this.shadowsEnabled;
                    if (castShadow) this.shadowCasters.push(o);
                });
                this.add(inst);
                return inst;
            };

            // Terrace is flush with the ground: receiveShadow only (saves 4,304 shadow tris/frame).
            if (placeNode('terrace', centerX, shrineDatum, centerZ, SHRINE_YAW, false)) {
                fallback.removeFromParent();
                fallback.geometry.dispose();
                fallback.material.dispose();
            }

            // Batch static shadow-casting Mat_Bluestone hero props into 1 draw call.
            const stoneSpecs: ReadonlyArray<[string, number, number, number, number, number, number, number]> = [
                ['stonelantern', slx, sly, slz, SHRINE_YAW + 0.15, 1, 1, 1],
                ['runestele', stx, sty, stz, SHRINE_YAW + 0.35, 1, 1, 1],
                ['runeboulder', rbx, rby, rbz, SHRINE_YAW - 0.62, 1.15, 1.05, 1.12],
            ];
            const stoneParts: T.BufferGeometry[] = [];
            let stoneMat: T.Material | undefined;
            for (const [key, x, y, z, ry, sx, sy, sz] of stoneSpecs) {
                const src = nodes.get(key);
                if (src instanceof T.Mesh) {
                    stoneMat ??= src.material as T.Material;
                    stoneParts.push(cloneBakedGeometry(src, x, y, z, ry, sx, sy, sz));
                }
            }
            // Pull Waypost's bluestone plinth into the same static stone batch if present.
            const waypostSrc = nodes.get('waypost');
            if (waypostSrc) {
                const inst = waypostSrc.clone(true);
                inst.position.set(wpx, wpy, wpz);
                inst.rotation.y = SHRINE_YAW - 0.28;
                const toRemove: T.Object3D[] = [];
                inst.traverse(o => {
                    if (!(o instanceof T.Mesh)) return;
                    if (stoneMat && o.material === stoneMat) {
                        stoneParts.push(cloneBakedGeometry(o, wpx, wpy, wpz, SHRINE_YAW - 0.28));
                        toRemove.push(o);
                    } else {
                        o.castShadow = this.shadowsEnabled;
                        this.shadowCasters.push(o);
                    }
                });
                for (const r of toRemove) r.removeFromParent();
                this.add(inst);
            }
            if (stoneParts.length && stoneMat) {
                const mergedStone = mergeGeometries(stoneParts, false);
                stoneParts.forEach(g => g.dispose());
                if (mergedStone) {
                    const stoneBatch = new T.Mesh(mergedStone, stoneMat);
                    stoneBatch.name = 'shrine-stone-props';
                    stoneBatch.castShadow = this.shadowsEnabled;
                    stoneBatch.receiveShadow = true;
                    this.add(stoneBatch);
                    this.shadowCasters.push(stoneBatch);
                }
            }

            // Batch both lantern glow cores into 1 draw call.
            const glowParts: T.BufferGeometry[] = [];
            let glowMat: T.Material | undefined;
            for (const [key, x, y, z, ry] of [
                ['waypostglow', wpx, wpy, wpz, SHRINE_YAW - 0.28],
                ['stonelanternglow', slx, sly, slz, SHRINE_YAW + 0.15],
            ] as const) {
                const src = nodes.get(key);
                if (src instanceof T.Mesh) {
                    glowMat ??= src.material as T.Material;
                    glowParts.push(cloneBakedGeometry(src, x, y, z, ry));
                }
            }
            if (glowParts.length && glowMat) {
                const mergedGlow = mergeGeometries(glowParts, false);
                glowParts.forEach(g => g.dispose());
                if (mergedGlow) {
                    const glowBatch = new T.Mesh(mergedGlow, glowMat);
                    glowBatch.name = 'shrine-lantern-glows';
                    glowBatch.castShadow = false;
                    glowBatch.receiveShadow = false;
                    this.add(glowBatch);
                }
            }

            placeNode('sakuratrunk', skx, sky, skz, SHRINE_YAW, true);

            const steps: ReadonlyArray<[number, number, number]> = [
                [80.26, 155.53, -.28], [80.70, 154.44, -.55], [81.32, 153.37, -.38],
                [82.28, 152.57, -.85], [83.44, 151.92, -.99], [84.69, 151.14, -1.06],
                [86.14, 150.72, -1.22], [88.34, 150.20, -1.30], [90.65, 149.85, -1.38],
            ];
            const stepSource = nodes.get('stepstone');
            if (!(stepSource instanceof T.Mesh)) return;
            const stepStones = new T.InstancedMesh(stepSource.geometry, stepSource.material, steps.length);
            stepStones.name = 'shrine-step-stones';
            // Flat 2.7cm flagstones flush with the path only need receiveShadow.
            stepStones.castShadow = false;
            stepStones.receiveShadow = true;
            const up = new T.Vector3(0, 1, 0);
            const normal = new T.Vector3();
            const slope = new T.Quaternion();
            for (const [index, [x, z, yaw]] of steps.entries()) {
                const y = heightAt(x, z);
                const dx = (heightAt(x + .5, z) - heightAt(x - .5, z));
                const dz = (heightAt(x, z + .5) - heightAt(x, z - .5));
                normal.set(-dx, 1, -dz).normalize();
                dummy.position.set(x, y + .027, z);
                dummy.rotation.set(0, yaw, 0);
                dummy.quaternion.premultiply(slope.setFromUnitVectors(up, normal));
                dummy.scale.set(1.18, 1, 1.17);
                dummy.updateMatrix();
                stepStones.setMatrixAt(index, dummy.matrix);
            }
            stepStones.instanceMatrix.needsUpdate = true;
            stepStones.computeBoundingSphere();
            stepStones.visible = this.fineVisible;
            this.add(stepStones);
            this.fineDetails.push(stepStones);
        }).catch(err => {
            console.warn('Spawn shrine GLB failed to load:', err);
        });
    }

    /** Tiered distance culling for the resident spawn shrine when exploring far from spawn. */
    update(camera: T.Camera) {
        const d2 = camera.position.distanceToSquared(this.center);
        const show = d2 < SHRINE_CULL_DIST_SQ;
        this.visible = show;
        if (!show) return;

        const showFine = d2 < FINE_DETAIL_DIST_SQ;
        if (showFine !== this.fineVisible) {
            this.fineVisible = showFine;
            for (const o of this.fineDetails) o.visible = showFine;
        }
        const showVfx = d2 < VFX_DETAIL_DIST_SQ;
        if (showVfx !== this.vfxVisible) {
            this.vfxVisible = showVfx;
            for (const o of this.vfxDetails) o.visible = showVfx;
        }
        const cast = d2 < SHADOW_CAST_DIST_SQ;
        if (cast !== this.shadowsEnabled) {
            this.shadowsEnabled = cast;
            for (const o of this.shadowCasters) o.castShadow = cast;
        }
    }
}

/** Populate the Spawn Sanctuary (长风聚灵台) at (79, 160) in Guofeng mode. */
export function populateSpawnShrine(group: T.Group, time: { value: number }, wind: WindUniforms, spawnShoreGrass?: SpawnShoreGrass): SpawnShrine | undefined {
    if (readArtStyle() !== 'guofeng') return;
    const shrine = new SpawnShrine(group, time, wind, spawnShoreGrass);
    group.add(shrine);
    return shrine;
}
