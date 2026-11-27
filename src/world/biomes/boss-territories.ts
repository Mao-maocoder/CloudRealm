import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BOSS_TERRITORIES, type BossTerritorySpec } from '../geo/boss-territories';
import { heightAt, smooth } from '../geo/height';
import { addSolid, releaseSolids } from '../physics/solid-world';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../../rendering/aerial-perspective';

const BOSS1_URL = new URL('../../../resource/boss/boss1_territory_opt.glb', import.meta.url).href;
const BOSS2_URL = new URL('../../../resource/boss/boss2_territory_opt.glb', import.meta.url).href;

const MODEL_URLS: Record<BossTerritorySpec['id'], string> = {
    boss1: BOSS1_URL,
    boss2: BOSS2_URL,
};

const ROOF_GRID = 64;

/**
 * Loads the Blender-polished Boss Territory GLB arenas and projects every vertex directly onto
 * the live analytic terrain heightfield (`heightAt(wx, wz) + localRelief`) so both arenas sit
 * completely flat and flush with the surrounding plain (zero bulging mound, zero poke-through),
 * with noise-warped dithered perimeter dissolve so no circular seam is visible even from high altitude.
 */
export class BossTerritories {
    readonly group = new T.Group();
    private disposed = false;
    private loadPromise?: Promise<void>;
    private readonly loadedGltfs: GLTF[] = [];
    private readonly mixers: T.AnimationMixer[] = [];

    constructor(private readonly scene: T.Scene) {
        this.group.name = 'Boss Territories';
        this.scene.add(this.group);
    }

    load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        const loader = new GLTFLoader();
        this.loadPromise = Promise.all(
            BOSS_TERRITORIES.map(spec =>
                loader.loadAsync(MODEL_URLS[spec.id])
                    .then(gltf => {
                        if (this.disposed) {
                            this.disposeGltf(gltf);
                            return;
                        }
                        this.loadedGltfs.push(gltf);
                        this.installTerritory(spec, gltf);
                    })
                    .catch(err => {
                        console.warn(`Boss 领地加载失败: ${spec.name}`, err);
                    }),
            ),
        ).then(() => {});
        return this.loadPromise;
    }

    update(dt: number) {
        if (dt <= 0 || this.mixers.length === 0) return;
        for (const mixer of this.mixers) {
            mixer.update(dt);
        }
    }

    private installTerritory(spec: BossTerritorySpec, gltf: GLTF) {
        const container = new T.Group();
        container.name = `BossTerritory_${spec.id}`;

        const centerY = heightAt(spec.x, spec.z);
        const root = gltf.scene;
        root.position.set(spec.x, centerY, spec.z);
        root.rotation.set(0, spec.yaw, 0);
        root.scale.setScalar(spec.scale);
        root.updateMatrixWorld(true);

        // Normalize model's bottommost point to centerY so `worldPos.y - baseY` is the pure local relief above ground
        const worldBox = new T.Box3().setFromObject(root);
        const baseY = centerY;
        root.position.y += baseY - worldBox.min.y;
        root.updateMatrixWorld(true);

        // For boss1's rigged SwordCloth, shift its armature vertically by the terrain offset right under the sword pommel
        // so the streaming ribbons stay 100% locked onto the projected giant stone sword!
        const localPos = new T.Vector3();
        const worldPos = new T.Vector3();
        const invMatrix = new T.Matrix4();

        const gridStep = (spec.radius * 2.1) / (ROOF_GRID - 1);
        const left = spec.x - spec.radius * 1.05;
        const north = spec.z - spec.radius * 1.05;
        const roofGrid = new Float32Array(ROOF_GRID * ROOF_GRID).fill(-Infinity);

        // Compute the median/low floor baseline of the model's outer rim (so the model's flat base skirt
        // sits flush at 0 relief rather than elevating the whole arena like a thick plinth!).
        let floorReliefBias = 0;
        root.traverse(obj => {
            if (!(obj instanceof T.Mesh) || obj instanceof T.SkinnedMesh || obj.name.includes('SwordCloth')) return;
            const posAttr = (obj.geometry as T.BufferGeometry).getAttribute('position');
            if (!posAttr) return;
            obj.updateMatrixWorld(true);
            const samples: number[] = [];
            const step = Math.max(1, Math.floor(posAttr.count / 1200));
            for (let i = 0; i < posAttr.count; i += step) {
                localPos.fromBufferAttribute(posAttr, i);
                worldPos.copy(localPos).applyMatrix4(obj.matrixWorld);
                const dist = Math.hypot(worldPos.x - spec.x, worldPos.z - spec.z);
                if (dist > spec.radius * 0.68 && dist < spec.radius * 0.96) {
                    samples.push(worldPos.y - baseY);
                }
            }
            if (samples.length > 10) {
                samples.sort((a, b) => a - b);
                // 25th percentile of outer rim height = flat ground skirt thickness of the diorama
                floorReliefBias = samples[Math.floor(samples.length * 0.25)];
            }
        });

        const edgeTint = spec.id === 'boss2'
            ? new T.Color(0.28, 0.27, 0.22) // Desolate ash-ochre dragon wasteland
            : new T.Color(0.42, 0.54, 0.22); // Valley meadow olive-emerald

        // Track sword pommel terrain delta so ClothArmature follows the projected stone sword exactly
        let clothAnchorDeltaY = 0;
        let hasClothAnchor = false;
        root.traverse(obj => {
            if (obj.name === 'ClothArmature' || obj.name.includes('SwordCloth')) {
                obj.updateMatrixWorld(true);
                const box = new T.Box3().setFromObject(obj);
                const cx = (box.min.x + box.max.x) * 0.5;
                const cz = (box.min.z + box.max.z) * 0.5;
                clothAnchorDeltaY = (heightAt(cx, cz) - baseY) - floorReliefBias + 0.14;
                hasClothAnchor = true;
            }
        });
        if (hasClothAnchor) {
            const arm = root.getObjectByName('ClothArmature');
            if (arm) {
                arm.position.y += clothAnchorDeltaY / spec.scale;
                arm.updateMatrixWorld(true);
            }
        }

        root.traverse(obj => {
            if (!(obj instanceof T.Mesh)) return;
            const isCloth = obj instanceof T.SkinnedMesh || obj.name.includes('SwordCloth');
            obj.castShadow = false;
            obj.receiveShadow = !isCloth;
            if (isCloth) obj.frustumCulled = false;

            const geo = obj.geometry as T.BufferGeometry;
            const posAttr = geo.getAttribute('position');

            // Project EVERY vertex of the static territory mesh directly onto `heightAt(wx, wz) + localRelief`!
            // This keeps both arenas 100% flat & flush with the surrounding plain (ZERO bulging mound, ZERO poke-through!).
            if (posAttr && !isCloth) {
                obj.updateMatrixWorld(true);
                invMatrix.copy(obj.matrixWorld).invert();

                const rimStart = spec.radius * 0.80;
                const rimEnd = spec.radius * 0.98;
                for (let i = 0; i < posAttr.count; i++) {
                    localPos.fromBufferAttribute(posAttr, i);
                    worldPos.copy(localPos).applyMatrix4(obj.matrixWorld);
                    const dist = Math.hypot(worldPos.x - spec.x, worldPos.z - spec.z);
                    const gY = heightAt(worldPos.x, worldPos.z);

                    // Subtract the diorama's flat skirt thickness so the arena floor sits flush on the ground
                    const rawRelief = Math.max(0, (worldPos.y - baseY) - floorReliefBias);
                    const rimTaper = 1 - smooth(rimStart, rimEnd, dist);
                    // Only taper low ground-skirt vertices at the outer rim; preserve full height of tall perimeter rocks/pillars!
                    const isLowSkirt = 1 - smooth(1.6, 5.0, rawRelief);
                    const reliefScale = T.MathUtils.lerp(1.0, 0.08 + 0.92 * rimTaper, isLowSkirt);
                    const groundBias = T.MathUtils.lerp(-0.22, 0.14, rimTaper);
                    worldPos.y = gY + rawRelief * reliefScale + groundBias;

                    localPos.copy(worldPos).applyMatrix4(invMatrix);
                    posAttr.setXYZ(i, localPos.x, localPos.y, localPos.z);
                }
                posAttr.needsUpdate = true;
                geo.computeVertexNormals();
                geo.computeBoundingBox();
                geo.computeBoundingSphere();

                // Rasterize projected upward triangles into a fast 64×64 walkable roof heightfield
                const idx = geo.index;
                const triCount = idx ? idx.count : posAttr.count;
                const vA = new T.Vector3(), vB = new T.Vector3(), vC = new T.Vector3();
                for (let i = 0; i < triCount; i += 3) {
                    const ia = idx ? idx.getX(i) : i;
                    const ib = idx ? idx.getX(i + 1) : i + 1;
                    const ic = idx ? idx.getX(i + 2) : i + 2;
                    vA.fromBufferAttribute(posAttr, ia).applyMatrix4(obj.matrixWorld);
                    vB.fromBufferAttribute(posAttr, ib).applyMatrix4(obj.matrixWorld);
                    vC.fromBufferAttribute(posAttr, ic).applyMatrix4(obj.matrixWorld);

                    const dx = vB.x - vA.x, dz = vB.z - vA.z;
                    const ex = vC.x - vA.x, ez = vC.z - vA.z;
                    const area = dz * ex - dx * ez;
                    if (Math.abs(area) <= 1e-4) continue;

                    const x0 = Math.max(0, Math.floor((Math.min(vA.x, vB.x, vC.x) - left) / gridStep));
                    const x1 = Math.min(ROOF_GRID - 1, Math.ceil((Math.max(vA.x, vB.x, vC.x) - left) / gridStep));
                    const z0 = Math.max(0, Math.floor((Math.min(vA.z, vB.z, vC.z) - north) / gridStep));
                    const z1 = Math.min(ROOF_GRID - 1, Math.ceil((Math.max(vA.z, vB.z, vC.z) - north) / gridStep));
                    for (let gz = z0; gz <= z1; gz++) {
                        for (let gx = x0; gx <= x1; gx++) {
                            const wx = left + gx * gridStep - vA.x;
                            const wz = north + gz * gridStep - vA.z;
                            const u = (wz * ex - wx * ez) / area;
                            const v = (dz * wx - dx * wz) / area;
                            if (u < -0.02 || v < -0.02 || u + v > 1.02) continue;
                            const y = vA.y + u * (vB.y - vA.y) + v * (vC.y - vA.y);
                            const cell = gz * ROOF_GRID + gx;
                            if (y > roofGrid[cell]) roofGrid[cell] = y;
                        }
                    }
                }
            }

            // Calibrate Blender-sharpened PBR material + glowing cyan emissive + noise-warped dithered edge dissolve
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) {
                if (!(mat instanceof T.MeshStandardMaterial)) continue;
                mat.side = isCloth ? T.DoubleSide : T.FrontSide;
                mat.roughness = isCloth ? 0.78 : 0.85;
                mat.metalness = 0.04;
                mat.envMapIntensity = 0.65;
                if (mat.normalMap) mat.normalScale.set(1.35, 1.35);
                if (mat.emissiveMap) {
                    mat.emissive.set('#ffffff');
                    mat.emissiveIntensity = spec.id === 'boss2' ? 2.1 : 1.85;
                }
                if ('specularIntensity' in mat) (mat as T.MeshPhysicalMaterial).specularIntensity = 0.22;
                if ('specularColor' in mat) (mat as T.MeshPhysicalMaterial).specularColor?.set('#d8e4dc');

                const centerUniform = new T.Vector3(spec.x, baseY, spec.z);
                const radiusUniform = spec.radius;
                const cacheTag = `boss-terr-v4-${spec.id}-${isCloth ? 'cloth' : 'geo'}`;
                mat.customProgramCacheKey = () => cacheTag;
                mat.onBeforeCompile = shader => {
                    Object.assign(shader.uniforms, atmosphereUniforms, {
                        uTerrCenter: { value: centerUniform },
                        uTerrRadius: { value: radiusUniform },
                        uEdgeTint: { value: edgeTint },
                    });
                    shader.vertexShader = 'varying vec3 vTerrWorld;\n' + shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        '#include <begin_vertex>\nvTerrWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
                    );
                    shader.fragmentShader = 'varying vec3 vTerrWorld;\nuniform vec3 uTerrCenter;\nuniform float uTerrRadius;\nuniform vec3 uEdgeTint;\n'
                        + aerialPerspectiveGLSL + '\n'
                        + shader.fragmentShader
                            .replace('#include <fog_fragment>', '')
                            .replace(
                                '#include <color_fragment>',
                                isCloth
                                    ? '#include <color_fragment>'
                                    : `#include <color_fragment>
                                    vec2 terrRel = vTerrWorld.xz - uTerrCenter.xz;
                                    float terrAng = atan(terrRel.y, terrRel.x);
                                    float terrNoise = sin(terrAng * 5.0 + terrRel.x * 0.03) * 0.5 + cos(terrAng * 9.0 - terrRel.y * 0.04) * 0.5;
                                    float terrDist = length(terrRel) + terrNoise * (uTerrRadius * 0.06);
                                    float edgeColorBlend = smoothstep(uTerrRadius * 0.70, uTerrRadius * 0.96, terrDist);
                                    diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, uEdgeTint, 0.72), edgeColorBlend * 0.82);`,
                            )
                            .replace(
                                '#include <tonemapping_fragment>',
                                `float terrCamDist = length(cameraPosition - vTerrWorld);
                                gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vTerrWorld), smoothstep(120., 480., terrCamDist));
                                #include <tonemapping_fragment>`,
                            );
                };
                mat.needsUpdate = true;
            }
        });

        container.add(root);

        // Start skeletal wind animation clip (ClothWind on boss1's giant stone sword crimson ribbons!)
        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new T.AnimationMixer(root);
            const clip = gltf.animations.find(a => a.name === 'ClothWind') ?? gltf.animations[0];
            const action = mixer.clipAction(clip);
            action.setLoop(T.LoopRepeat, Infinity);
            action.play();
            this.mixers.push(mixer);
        }

        // Register walkable / landable roof collision volume in solid-world
        const sampleRoof = (x: number, z: number): number => {
            const fx = (x - left) / gridStep;
            const fz = (z - north) / gridStep;
            const gx = Math.floor(fx), gz = Math.floor(fz);
            if (gx < 0 || gz < 0 || gx >= ROOF_GRID - 1 || gz >= ROOF_GRID - 1) return heightAt(x, z);
            const h00 = roofGrid[gz * ROOF_GRID + gx];
            const h10 = roofGrid[gz * ROOF_GRID + gx + 1];
            const h01 = roofGrid[(gz + 1) * ROOF_GRID + gx];
            const h11 = roofGrid[(gz + 1) * ROOF_GRID + gx + 1];
            const g = heightAt(x, z);
            const a = Number.isFinite(h00) ? h00 : g;
            const b = Number.isFinite(h10) ? h10 : g;
            const c = Number.isFinite(h01) ? h01 : g;
            const d = Number.isFinite(h11) ? h11 : g;
            const tx = fx - gx, tz = fz - gz;
            const top = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
            return Math.max(g, top);
        };

        const finalBox = new T.Box3().setFromObject(root);
        addSolid(container, {
            minX: spec.x - spec.radius * 0.98,
            maxX: spec.x + spec.radius * 0.98,
            minZ: spec.z - spec.radius * 0.98,
            maxZ: spec.z + spec.radius * 0.98,
            minY: finalBox.min.y - 2,
            maxY: finalBox.max.y + 1,
            contains: (x, z, margin = 0) => Math.hypot(x - spec.x, z - spec.z) <= spec.radius * 0.96 + margin,
            volume: true,
            roof: sampleRoof,
            step: true,
        });

        this.group.add(container);
    }

    private disposeGltf(gltf: GLTF) {
        const geos = new Set<T.BufferGeometry>();
        const mats = new Set<T.Material>();
        gltf.scene.traverse(obj => {
            if (!(obj instanceof T.Mesh)) return;
            geos.add(obj.geometry);
            for (const m of [obj.material].flat()) mats.add(m);
        });
        for (const g of geos) g.dispose();
        for (const m of mats) m.dispose();
    }

    dispose() {
        this.disposed = true;
        for (const m of this.mixers) m.stopAllAction();
        this.mixers.length = 0;
        for (const child of [...this.group.children]) {
            releaseSolids(child);
            this.group.remove(child);
        }
        for (const gltf of this.loadedGltfs) this.disposeGltf(gltf);
        this.loadedGltfs.length = 0;
        this.group.removeFromParent();
    }
}
