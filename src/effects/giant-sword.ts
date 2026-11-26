import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { traceFireballWorld, type SampleGround } from './fireball-trajectory';
import type { SpellLightPool } from './spell-lights';

const swordModelUrl = new URL('../../resource/skill/giant-sword/GiantSword.glb', import.meta.url).href;
const impactModelUrl = new URL('../../resource/skill/giant-sword/GiantSword_Impact.glb', import.meta.url).href;

// Authored Blender clip is 3.0s (frames 1..90 at 30fps). Played at 1.25x in game.
export const giantSwordAnimRate = 1.25;
export const giantSwordFlightStart = 8 / 30;      // 0.267s — sword detaches from back
export const giantSwordFlightEnd = 35 / 30;       // 1.167s — sword arrives at overhead hover apex
export const giantSwordBurstTime = 46 / 30;       // 1.533s — phantom bursts outward & shockwave expands
export const giantSwordGrowStart = 50 / 30;       // 1.667s — solid giant sword enlarges BEFORE phantom fades out
export const giantSwordGrowPeak = 58 / 30;        // 1.933s — slight heroic scale overshoot
export const giantSwordGrowSettle = 61 / 30;      // 2.033s — solid giant sword settled at full scale
export const giantSwordPhantomEnd = 66 / 30;      // 2.200s — phantom finishes fading out
export const giantSwordAimStart = 59 / 30;        // 1.967s — pre-launch crosshair aiming begins
export const giantSwordLaunchTime = 71 / 30;      // 2.367s — giant sword launches toward crosshair target
export const giantSwordCastEnd = 78 / 30;         // 2.600s — character smoothly returns to idle/ready

const SMALL_SCALE = 0.44;
const GIANT_SCALE = 1.42;
const LAUNCH_SPEED = 48;
const MAX_FLIGHT_AGE = 2.4;
const MAX_AIM_RANGE = 95;
const TRAIL_MAX_POINTS = 48;
const WAKE_SPARK_COUNT = 28;
const IMPACT_SPARK_COUNT = 34;

const UP = new T.Vector3(0, 1, 0);
const LOCAL_TIP_AXIS = new T.Vector3(0, 0, 1);

export interface GiantSwordAimResult {
    target: T.Vector3;
    hitSurface: boolean;
}

/**
 * Casts a crosshair ray from the center of the camera, matching Fireball's crosshair convention.
 * Prioritizes direct wildlife hits and terrain/boulder/structure surfaces; otherwise aims far along the crosshair ray.
 */
export function giantSwordAim(
    camera: T.Camera,
    caster: T.Vector3,
    sampleGround: SampleGround,
    traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
): GiantSwordAimResult {
    const ray = camera.getWorldDirection(new T.Vector3()).normalize();
    const origin = camera.getWorldPosition(new T.Vector3());
    const startDist = Math.max(0, new T.Vector3().subVectors(caster, origin).dot(ray));
    const nearStart = origin.clone().addScaledVector(ray, Math.max(0.5, startDist - 0.5));
    const farEnd = origin.clone().addScaledVector(ray, startDist + MAX_AIM_RANGE);

    const worldHit = traceFireballWorld(nearStart, farEnd, sampleGround, 0.04);
    const creatureT = traceCreature(nearStart, farEnd);
    const bestT = Math.min(worldHit?.t ?? Infinity, creatureT ?? Infinity);

    if (bestT <= 1) {
        const hitPoint = new T.Vector3().lerpVectors(nearStart, farEnd, bestT);
        if (worldHit && worldHit.t === bestT && worldHit.ground) {
            hitPoint.y = worldHit.ground.height;
        }
        return { target: hitPoint, hitSurface: true };
    }
    return { target: farEnd, hitSurface: false };
}

/** Builds a quaternion pointing local +Z along `dir`, with optional heroic roll around the blade axis. */
function orientBlade(dir: T.Vector3, rollRad = 0, out = new T.Quaternion()): T.Quaternion {
    const z = dir.clone().normalize();
    const refUp = Math.abs(z.y) > 0.96 ? new T.Vector3(1, 0, 0) : UP;
    const x = new T.Vector3().crossVectors(refUp, z).normalize();
    const y = new T.Vector3().crossVectors(z, x).normalize();
    const m = new T.Matrix4().makeBasis(x, y, z);
    out.setFromRotationMatrix(m);
    if (Math.abs(rollRad) > 1e-4) {
        const qRoll = new T.Quaternion().setFromAxisAngle(LOCAL_TIP_AXIS, rollRad);
        out.multiply(qRoll);
    }
    return out;
}

function makePhantomMaterial(opacityUniform: { value: number }): T.ShaderMaterial {
    return new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        uniforms: {
            uOpacity: opacityUniform,
        },
        vertexShader: `
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormalView = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            void main() {
                if (uOpacity <= 0.005) discard;
                float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
                float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.65);
                float alpha = mix(0.12, 0.78, rim) * uOpacity;
                vec3 col = mix(vec3(0.05, 0.42, 0.96), vec3(0.32, 0.80, 1.08), rim);
                gl_FragColor = vec4(col, alpha);
                #include <colorspace_fragment>
            }
        `,
    });
}

function makeBurstRingMaterial(opacityUniform: { value: number }): T.ShaderMaterial {
    return new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        uniforms: { uOpacity: opacityUniform },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                if (uOpacity <= 0.005) discard;
                float r = length(vUv - 0.5) * 2.0;
                if (r > 1.0 || r < 0.32) discard;
                float band = smoothstep(0.32, 0.66, r) * (1.0 - smoothstep(0.72, 1.0, r));
                vec3 col = mix(vec3(0.08, 0.58, 1.05), vec3(0.60, 0.95, 1.18), band);
                gl_FragColor = vec4(col, band * uOpacity * 0.85);
                #include <colorspace_fragment>
            }
        `,
    });
}

function makeArcTrailMaterial(opacityUniform: { value: number }): T.ShaderMaterial {
    return new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        uniforms: { uOpacity: opacityUniform },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                if (uOpacity <= 0.005) discard;
                float across = abs(vUv.y - 0.5) * 2.0;
                float core = pow(max(0.0, 1.0 - across), 1.65);
                float along = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
                float a = core * along * uOpacity;
                if (a < 0.01) discard;
                vec3 col = mix(vec3(0.04, 0.45, 1.05), vec3(0.55, 0.94, 1.18), core);
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }
        `,
    });
}

function makeFlightWakeGeometry(): T.BufferGeometry {
    // Two crossed luminous sword-qi wake ribbons trailing along -Z behind the flying Giant Sword.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const segs = 12;
    const length = 7.2;
    for (const rot of [0, Math.PI / 2]) {
        const base = pos.length / 3;
        const c = Math.cos(rot), s = Math.sin(rot);
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const z = 1.6 - t * length;
            const halfW = 1.05 * (1 - t * 0.85) * (0.45 + 0.55 * Math.sin(Math.min(1, t * 2.5) * Math.PI * 0.5));
            for (const side of [-1, 1]) {
                pos.push(c * side * halfW, s * side * halfW, z);
                uv.push(side < 0 ? 0 : 1, t);
            }
            if (i < segs) {
                const k = base + i * 2;
                idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            }
        }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
}

function makeFlightWakeMaterial(timeUniform: { value: number }): T.ShaderMaterial {
    return new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        uniforms: { uTime: timeUniform },
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
                float across = abs(vUv.x - 0.5) * 2.0;
                float along = vUv.y;
                float streak = 0.72 + 0.28 * sin(along * 18.0 - uTime * 22.0 + across * 4.0);
                float core = pow(max(0.0, 1.0 - across), 1.75);
                float fade = smoothstep(0.0, 0.14, along) * pow(1.0 - along, 1.25);
                float a = core * fade * streak * 0.82;
                if (a < 0.015) discard;
                vec3 col = mix(vec3(0.05, 0.48, 1.05), vec3(0.68, 0.96, 1.2), core);
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }
        `,
    });
}

function makeConeAuraGeometry(): T.BufferGeometry {
    // Open cone around blade tip (+Z) streaming backward (-Z) for supersonic sword-qi break feel.
    const geo = new T.ConeGeometry(1.15, 4.4, 24, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.35);
    return geo;
}

function makeConeAuraMaterial(timeUniform: { value: number }): T.ShaderMaterial {
    return new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        uniforms: { uTime: timeUniform },
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
                float streak = 0.65 + 0.35 * sin(vUv.x * 37.7 + vUv.y * 10.0 - uTime * 20.0);
                float fade = smoothstep(0.0, 0.22, vUv.y) * pow(1.0 - vUv.y, 1.6);
                float a = fade * streak * 0.48;
                if (a < 0.01) discard;
                vec3 col = mix(vec3(0.08, 0.55, 1.05), vec3(0.65, 0.96, 1.18), vUv.y);
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }
        `,
    });
}

function makeImpactEnergyMaterial(
    innerHex: string,
    edgeHex: string,
    additive = false,
): { material: T.ShaderMaterial; opacity: { value: number } } {
    const opacity = { value: 1 };
    const inner = new T.Color(innerHex);
    const edge = new T.Color(edgeHex);
    const material = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: T.DoubleSide,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
        uniforms: {
            uOpacity: opacity,
            uInner: { value: inner },
            uEdge: { value: edge },
        },
        vertexShader: `
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormalView = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            uniform vec3 uInner;
            uniform vec3 uEdge;
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            void main() {
                if (uOpacity <= 0.005) discard;
                float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
                float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.35);
                vec3 col = mix(uInner, uEdge, rim);
                float a = mix(0.62, 1.0, rim) * uOpacity;
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }
        `,
    });
    return { material, opacity };
}

function makeSwirlRibbonMaterial(): { material: T.ShaderMaterial; opacity: { value: number } } {
    const opacity = { value: 1 };
    const material = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        uniforms: { uOpacity: opacity },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                if (uOpacity <= 0.005) discard;
                float across = abs(vUv.y - 0.5) * 2.0;
                float core = pow(max(0.0, 1.0 - across), 1.45);
                float ends = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
                float a = core * ends * uOpacity;
                if (a < 0.01) discard;
                vec3 col = mix(vec3(0.10, 0.72, 0.88), vec3(0.76, 0.99, 1.0), core);
                gl_FragColor = vec4(col, a);
                #include <colorspace_fragment>
            }
        `,
    });
    return { material, opacity };
}

interface ActiveProjectile {
    group: T.Group;
    sparks: T.InstancedMesh;
    direction: T.Vector3;
    speed: number;
    age: number;
}

interface ImpactMeshGeos {
    slabs?: T.BufferGeometry;
    flash?: T.BufferGeometry;
    swirl?: T.BufferGeometry;
    fissure?: T.BufferGeometry;
    debris?: T.BufferGeometry;
}

interface ActiveImpact {
    root: T.Group;
    embeddedSword?: T.Object3D;
    slabs?: T.Mesh;
    flash?: T.Mesh;
    flashOpacity?: { value: number };
    swirl?: T.Mesh;
    swirlOpacity?: { value: number };
    fissure?: T.Mesh;
    fissureOpacity?: { value: number };
    debris?: T.Mesh;
    ownedMaterials: T.Material[];
    sparks: T.InstancedMesh;
    sparkVel: T.Vector3[];
    position: T.Vector3;
    age: number;
    duration: number;
}

function disposeGltf(model: GLTF) {
    const geos = new Set<T.BufferGeometry>();
    const mats = new Set<T.Material>();
    model.scene.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        geos.add(o.geometry);
        for (const m of [o.material].flat()) mats.add(m);
    });
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
}

export class GiantSword {
    private template?: GLTF;
    private impactTemplate?: GLTF;
    private impactGeos: ImpactMeshGeos = {};
    private disposed = false;

    // Summoning / hover / phantom / solid-enlarge state
    private activeCast = false;
    private launchedThisCast = false;
    private swordHidden = false;
    private swordGrip?: T.Object3D;
    private swordMotion?: T.Object3D;
    private swordTip?: T.Object3D;

    private readonly hoverPos = new T.Vector3();
    private hoverLocked = false;
    private readonly defaultAimDir = new T.Vector3(0, 0.14, -1);
    private readonly currentAimDir = new T.Vector3(0, 0.14, -1);
    private readonly targetAimDir = new T.Vector3(0, 0.14, -1);
    private readonly lockedQuat = new T.Quaternion();
    private readonly defaultQuat = new T.Quaternion();

    private readonly castGroup = new T.Group();
    private solidPreview?: T.Object3D;
    private phantomPreview?: T.Object3D;
    private readonly phantomOpacity = { value: 0 };
    private readonly phantomMaterial = makePhantomMaterial(this.phantomOpacity);
    private readonly burstRingOpacity = { value: 0 };
    private readonly burstRingMaterial = makeBurstRingMaterial(this.burstRingOpacity);
    private readonly burstRingMesh: T.Mesh;

    // Dynamic curved blue J-arc flight trail ribbon (samples live SwordMotion world positions!)
    private readonly trailPoints: T.Vector3[] = [];
    private readonly trailOpacity = { value: 0 };
    private readonly trailMaterial = makeArcTrailMaterial(this.trailOpacity);
    private readonly trailGeometry: T.BufferGeometry;
    private readonly trailMesh: T.Mesh;

    // Projectile & impact shared resources
    private readonly timeUniform = { value: 0 };
    private readonly wakeGeo = makeFlightWakeGeometry();
    private readonly wakeMat = makeFlightWakeMaterial(this.timeUniform);
    private readonly coneGeo = makeConeAuraGeometry();
    private readonly coneMat = makeConeAuraMaterial(this.timeUniform);
    private readonly sparkGeo = new T.OctahedronGeometry(0.11, 0);
    private readonly sparkMat = new T.MeshBasicMaterial({
        color: '#88eeff',
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
    private readonly craterRockMat = new T.MeshStandardMaterial({
        color: '#4a5a68',
        roughness: 0.78,
        metalness: 0.10,
        emissive: '#0c3a4c',
        emissiveIntensity: 0.28,
        flatShading: true,
    });

    private readonly projectiles = new Set<ActiveProjectile>();
    private readonly impacts = new Set<ActiveImpact>();
    private readonly dummy = new T.Object3D();
    private readonly tmpA = new T.Vector3();
    private readonly tmpB = new T.Vector3();
    private readonly tmpC = new T.Vector3();
    private readonly tmpQ = new T.Quaternion();

    constructor(
        private readonly scene: T.Scene,
        private readonly sampleGround: SampleGround,
        private readonly traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
        private readonly blast: (point: T.Vector3, directHit: boolean) => void,
    ) {
        this.castGroup.name = 'GiantSword_CastGroup';
        this.castGroup.visible = false;
        this.scene.add(this.castGroup);

        this.burstRingMesh = new T.Mesh(new T.PlaneGeometry(2.4, 2.4), this.burstRingMaterial);
        this.burstRingMesh.name = 'GiantSword_BurstRing';
        this.burstRingMesh.visible = false;
        this.burstRingMesh.renderOrder = 5;
        this.castGroup.add(this.burstRingMesh);

        // Pre-allocate crossed dual-ribbon buffer for up to TRAIL_MAX_POINTS samples
        const maxSegs = TRAIL_MAX_POINTS - 1;
        const vertCount = TRAIL_MAX_POINTS * 2 * 2;
        const positions = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        const indices: number[] = [];
        for (let r = 0; r < 2; r++) {
            const base = r * TRAIL_MAX_POINTS * 2;
            for (let i = 0; i < maxSegs; i++) {
                const k = base + i * 2;
                indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            }
        }
        this.trailGeometry = new T.BufferGeometry();
        this.trailGeometry.setAttribute('position', new T.BufferAttribute(positions, 3));
        this.trailGeometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
        this.trailGeometry.setIndex(indices);
        this.trailGeometry.setDrawRange(0, 0);

        this.trailMesh = new T.Mesh(this.trailGeometry, this.trailMaterial);
        this.trailMesh.name = 'GiantSword_ArcTrail';
        this.trailMesh.frustumCulled = false;
        this.trailMesh.visible = false;
        this.trailMesh.renderOrder = 4;
        this.scene.add(this.trailMesh);
    }

    async load() {
        const loader = new GLTFLoader();
        await Promise.all([
            loader.loadAsync(swordModelUrl).then(gltf => {
                if (this.disposed) {
                    disposeGltf(gltf);
                    return;
                }
                gltf.scene.traverse(obj => {
                    if (!(obj instanceof T.Mesh)) return;
                    obj.castShadow = true;
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    for (const mat of mats) {
                        if (!(mat instanceof T.MeshStandardMaterial)) continue;
                        if (mat.name.includes('冰蓝灵光')) {
                            mat.emissive.set('#4ce0ff');
                            mat.emissiveIntensity = 2.4;
                            mat.toneMapped = false;
                        } else if (mat.name.includes('亮银')) {
                            mat.color.set('#e8f2fc');
                            mat.metalness = 0.26;
                            mat.roughness = 0.28;
                            mat.emissive.set('#28405a');
                            mat.emissiveIntensity = 0.42;
                        } else if (mat.name.includes('月银')) {
                            mat.color.set('#c4d8ec');
                            mat.metalness = 0.30;
                            mat.roughness = 0.34;
                            mat.emissive.set('#1c3048');
                            mat.emissiveIntensity = 0.35;
                        } else if (mat.name.includes('青银')) {
                            mat.color.set('#7aa4c4');
                            mat.metalness = 0.32;
                            mat.roughness = 0.36;
                            mat.emissive.set('#14283c');
                            mat.emissiveIntensity = 0.28;
                        } else if (mat.name.includes('淡金')) {
                            mat.color.set('#f0cf82');
                            mat.metalness = 0.34;
                            mat.roughness = 0.30;
                            mat.emissive.set('#4d3812');
                            mat.emissiveIntensity = 0.35;
                        } else if (mat.name.includes('靛蓝')) {
                            mat.color.set('#2b4668');
                            mat.metalness = 0.12;
                            mat.roughness = 0.62;
                        }
                    }
                });
                this.template = gltf;
                this.buildCastPreviews();
            }),
            loader.loadAsync(impactModelUrl).then(gltf => {
                if (this.disposed) {
                    disposeGltf(gltf);
                    return;
                }
                this.impactTemplate = gltf;
                gltf.scene.traverse(obj => {
                    if (!(obj instanceof T.Mesh)) return;
                    const n = obj.name;
                    if (n.startsWith('Impact_CraterSlabs')) this.impactGeos.slabs = obj.geometry;
                    else if (n.startsWith('Impact_BaseFlash')) this.impactGeos.flash = obj.geometry;
                    else if (n.startsWith('Impact_SwirlRibbons')) this.impactGeos.swirl = obj.geometry;
                    else if (n.startsWith('Impact_GroundFissure')) this.impactGeos.fissure = obj.geometry;
                    else if (n.startsWith('Impact_RockDebris')) this.impactGeos.debris = obj.geometry;
                });
            }),
        ]);
    }

    private buildCastPreviews() {
        if (!this.template) return;
        this.solidPreview = this.template.scene.clone(true);
        this.solidPreview.name = 'GiantSword_SolidPreview';
        this.solidPreview.visible = false;

        this.phantomPreview = this.template.scene.clone(true);
        this.phantomPreview.name = 'GiantSword_PhantomPreview';
        this.phantomPreview.visible = false;
        this.phantomPreview.traverse(o => {
            if (o instanceof T.Mesh) {
                o.material = this.phantomMaterial;
                o.castShadow = false;
                o.renderOrder = 6;
            }
        });

        this.castGroup.add(this.solidPreview, this.phantomPreview);
    }

    attachSword(swordMotion: T.Object3D, swordTip: T.Object3D) {
        this.swordMotion = swordMotion;
        this.swordTip = swordTip;
        this.swordGrip = swordMotion.getObjectByName('AzureSword_Grip') ?? undefined;
    }

    private setOriginalSwordHidden(hidden: boolean) {
        if (this.swordHidden === hidden) return;
        this.swordHidden = hidden;
        if (this.swordGrip) this.swordGrip.visible = !hidden;
    }

    private rebuildTrailRibbon() {
        const pts = this.trailPoints;
        const count = pts.length;
        if (count < 2) {
            this.trailGeometry.setDrawRange(0, 0);
            this.trailMesh.visible = false;
            return;
        }
        const posAttr = this.trailGeometry.getAttribute('position') as T.BufferAttribute;
        const uvAttr = this.trailGeometry.getAttribute('uv') as T.BufferAttribute;
        const tangent = this.tmpA;
        const side = this.tmpB;
        const binorm = this.tmpC;

        for (let r = 0; r < 2; r++) {
            const base = r * TRAIL_MAX_POINTS * 2;
            for (let i = 0; i < count; i++) {
                const u = i / (count - 1);
                const prev = pts[Math.max(0, i - 1)];
                const next = pts[Math.min(count - 1, i + 1)];
                tangent.subVectors(next, prev);
                if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
                else tangent.normalize();

                side.crossVectors(tangent, UP);
                if (side.lengthSq() < 1e-5) side.set(1, 0, 0);
                else side.normalize();
                binorm.crossVectors(tangent, side).normalize();

                const axis = r === 0 ? side : binorm;
                const width = 0.05 + 0.17 * Math.pow(Math.sin(u * Math.PI), 0.72);
                const p = pts[i];
                const idx0 = base + i * 2;
                const idx1 = idx0 + 1;
                posAttr.setXYZ(idx0, p.x - axis.x * width, p.y - axis.y * width, p.z - axis.z * width);
                posAttr.setXYZ(idx1, p.x + axis.x * width, p.y + axis.y * width, p.z + axis.z * width);
                uvAttr.setXY(idx0, u, 0);
                uvAttr.setXY(idx1, u, 1);
            }
        }
        posAttr.needsUpdate = true;
        uvAttr.needsUpdate = true;
        // Draw both crossed ribbons using the valid active segment count
        const segs = count - 1;
        // Rebuild active index range cleanly for both ribbons
        const idxArr = this.trailGeometry.index!;
        let write = 0;
        for (let r = 0; r < 2; r++) {
            const base = r * TRAIL_MAX_POINTS * 2;
            for (let i = 0; i < segs; i++) {
                const k = base + i * 2;
                idxArr.setX(write++, k);
                idxArr.setX(write++, k + 1);
                idxArr.setX(write++, k + 2);
                idxArr.setX(write++, k + 1);
                idxArr.setX(write++, k + 3);
                idxArr.setX(write++, k + 2);
            }
        }
        idxArr.needsUpdate = true;
        this.trailGeometry.setDrawRange(0, segs * 6 * 2);
        this.trailMesh.visible = true;
    }

    /**
     * Updates the summoning visuals (J-arc blue trail, overhead hover, phantom burst + fade,
     * solid giant sword enlargement before phantom vanishes, pre-launch crosshair pitch/aim, and launch).
     */
    updateCast(
        clipTime: number | undefined,
        camera: T.Camera,
        casterPos: T.Vector3,
        heading: number,
    ) {
        if (clipTime === undefined) {
            if (this.activeCast) this.endCast();
            return;
        }

        if (!this.activeCast) {
            this.activeCast = true;
            this.launchedThisCast = false;
            this.hoverLocked = false;
            this.trailPoints.length = 0;
            this.trailGeometry.setDrawRange(0, 0);
            this.trailMesh.visible = false;
            this.castGroup.visible = false;
            this.setOriginalSwordHidden(false);
        }

        // Default heroic horizontal / slightly-upward attitude along the player's facing direction
        this.defaultAimDir.set(Math.sin(heading), 0.14, -Math.cos(heading)).normalize();
        orientBlade(this.defaultAimDir, 0.56, this.defaultQuat);

        // 1. Blue curved flight trajectory trail while small sword flies off the back (frames 8..45)
        if (clipTime >= giantSwordFlightStart && clipTime <= giantSwordFlightEnd + 0.04 && this.swordMotion && this.swordTip) {
            this.swordMotion.getWorldPosition(this.tmpA);
            this.swordTip.getWorldPosition(this.tmpB);
            const mid = this.tmpC.lerpVectors(this.tmpA, this.tmpB, 0.42);
            const last = this.trailPoints[this.trailPoints.length - 1];
            if (!last || last.distanceToSquared(mid) > 0.015) {
                if (this.trailPoints.length >= TRAIL_MAX_POINTS) this.trailPoints.shift();
                this.trailPoints.push(mid.clone());
                this.rebuildTrailRibbon();
            }
            this.trailOpacity.value = T.MathUtils.smoothstep(clipTime, giantSwordFlightStart, giantSwordFlightStart + 0.10) * 0.92;
        } else if (clipTime > giantSwordFlightEnd + 0.04 && clipTime < giantSwordBurstTime + 0.15) {
            const fade = 1 - T.MathUtils.smoothstep(clipTime, giantSwordFlightEnd + 0.04, giantSwordBurstTime + 0.05);
            this.trailOpacity.value = fade * 0.92;
            this.trailMesh.visible = fade > 0.01 && this.trailPoints.length >= 2;
        } else {
            this.trailOpacity.value = 0;
            this.trailMesh.visible = false;
        }

        // 2. Capture exact hover apex when small sword reaches overhead stop (frame 35..46)
        if (!this.hoverLocked && clipTime >= giantSwordFlightEnd && this.swordMotion && this.swordTip) {
            this.swordMotion.getWorldPosition(this.tmpA);
            this.swordTip.getWorldPosition(this.tmpB);
            this.hoverPos.lerpVectors(this.tmpA, this.tmpB, 0.42);
            this.hoverLocked = true;
            this.currentAimDir.copy(this.defaultAimDir);
            this.lockedQuat.copy(this.defaultQuat);
        }

        // Fallback hoverPos if clipTime jumped directly past flightEnd
        if (!this.hoverLocked && clipTime >= giantSwordBurstTime) {
            this.hoverPos.set(
                casterPos.x + Math.sin(heading) * 0.45,
                casterPos.y + 4.05,
                casterPos.z - Math.cos(heading) * 0.45,
            );
            this.hoverLocked = true;
            this.currentAimDir.copy(this.defaultAimDir);
            this.lockedQuat.copy(this.defaultQuat);
        }

        // 3. Phantom burst + fade + solid Giant Sword enlargement BEFORE phantom finishes fading!
        if (clipTime >= giantSwordBurstTime && !this.launchedThisCast) {
            this.castGroup.visible = true;

            // Gentle upward energy lift during growth + crisp anticipation pullback right before launch
            const lift = 0.24 * T.MathUtils.smoothstep(clipTime, giantSwordBurstTime, giantSwordGrowSettle);
            const bob = Math.sin((clipTime - giantSwordBurstTime) * 7.5) * 0.04;
            const recoil = clipTime >= giantSwordAimStart
                ? 0.32 * T.MathUtils.smoothstep(clipTime, giantSwordAimStart + 0.16, giantSwordLaunchTime)
                : 0;

            // Evaluate crosshair aiming during pre-launch window!
            // Default stays poised slightly upward; if player aims crosshair at ground/enemy below sword,
            // automatically pitches smoothly downward to lock dead-on onto the target before firing!
            if (clipTime >= giantSwordAimStart) {
                const aim = giantSwordAim(camera, casterPos, this.sampleGround, this.traceCreature);
                this.targetAimDir.subVectors(aim.target, this.hoverPos);
                if (this.targetAimDir.lengthSq() < 0.25) {
                    camera.getWorldDirection(this.targetAimDir);
                }
                this.targetAimDir.normalize();

                // If crosshair hits ground or points downward, pitch directly onto target;
                // otherwise keep heroic upward/crosshair direction.
                const aimBlend = T.MathUtils.smoothstep(clipTime, giantSwordAimStart, giantSwordLaunchTime - 0.05);
                const eased = 1 - Math.pow(1 - aimBlend, 2.6);
                this.currentAimDir.lerpVectors(this.defaultAimDir, this.targetAimDir, eased).normalize();
                // Roll smoothly toward level broadside as it locks onto target
                const roll = T.MathUtils.lerp(0.56, 0.22, eased);
                orientBlade(this.currentAimDir, roll, this.lockedQuat);
            } else {
                this.currentAimDir.copy(this.defaultAimDir);
                this.lockedQuat.copy(this.defaultQuat);
            }

            this.castGroup.position.copy(this.hoverPos);
            this.castGroup.position.y += lift + bob;
            if (recoil > 0) this.castGroup.position.addScaledVector(this.currentAimDir, -recoil);
            this.castGroup.quaternion.copy(this.lockedQuat);

            // 3a. Translucent Phantom Sword (bursts suddenly huge at f46..52, then drifts & fades out by f66)
            if (this.phantomPreview) {
                const pProgress = (clipTime - giantSwordBurstTime) / (giantSwordPhantomEnd - giantSwordBurstTime);
                if (pProgress >= 0 && pProgress <= 1) {
                    this.phantomPreview.visible = true;
                    const burst = 1 - Math.pow(1 - Math.min(1, pProgress / 0.28), 3);
                    const drift = Math.max(0, (pProgress - 0.28) / 0.72);
                    const pScale = T.MathUtils.lerp(SMALL_SCALE, GIANT_SCALE * 1.38, burst) + drift * GIANT_SCALE * 0.26;
                    this.phantomPreview.scale.set(pScale * 1.06, pScale * 1.06, pScale * 1.02);
                    const fadeIn = T.MathUtils.smoothstep(pProgress, 0, 0.12);
                    const fadeOut = 1 - T.MathUtils.smoothstep(pProgress, 0.24, 1.0);
                    this.phantomOpacity.value = fadeIn * fadeOut * 0.76;
                } else {
                    this.phantomPreview.visible = false;
                    this.phantomOpacity.value = 0;
                }
            }

            // 3b. Feathered Cyan Burst Shockwave Ring (f46..58)
            const ringT = (clipTime - giantSwordBurstTime) / (giantSwordGrowPeak - giantSwordBurstTime);
            if (ringT >= 0 && ringT <= 1) {
                this.burstRingMesh.visible = true;
                const rScale = T.MathUtils.lerp(0.32, 2.35, 1 - Math.pow(1 - ringT, 2.2));
                this.burstRingMesh.scale.setScalar(rScale);
                this.burstRingOpacity.value = T.MathUtils.smoothstep(ringT, 0, 0.15) * (1 - T.MathUtils.smoothstep(ringT, 0.35, 1.0)) * 0.85;
            } else {
                this.burstRingMesh.visible = false;
                this.burstRingOpacity.value = 0;
            }

            // 3c. Solid Giant Sword Body (appears at f50, surges to full size by f61 — BEFORE phantom finishes fading at f66!)
            if (this.solidPreview && clipTime >= giantSwordGrowStart) {
                this.setOriginalSwordHidden(true);
                this.solidPreview.visible = true;
                let sScale: number;
                if (clipTime <= giantSwordGrowPeak) {
                    const g = T.MathUtils.smoothstep(clipTime, giantSwordGrowStart, giantSwordGrowPeak);
                    sScale = T.MathUtils.lerp(SMALL_SCALE, GIANT_SCALE * 1.09, g);
                } else {
                    const settle = T.MathUtils.smoothstep(clipTime, giantSwordGrowPeak, giantSwordGrowSettle);
                    sScale = T.MathUtils.lerp(GIANT_SCALE * 1.09, GIANT_SCALE, settle);
                }
                this.solidPreview.scale.setScalar(sScale);
            } else if (this.solidPreview) {
                this.solidPreview.visible = false;
            }
        }

        // 4. Launch Giant Sword toward crosshair target!
        if (clipTime >= giantSwordLaunchTime && !this.launchedThisCast) {
            this.launchedThisCast = true;
            // Final fresh crosshair lock right at launch moment
            const aim = giantSwordAim(camera, casterPos, this.sampleGround, this.traceCreature);
            const launchDir = aim.target.clone().sub(this.castGroup.position);
            if (launchDir.lengthSq() < 0.25) camera.getWorldDirection(launchDir);
            launchDir.normalize();
            this.launchProjectile(this.castGroup.position.clone(), launchDir);
            this.castGroup.visible = false;
            if (this.solidPreview) this.solidPreview.visible = false;
            if (this.phantomPreview) this.phantomPreview.visible = false;
            this.burstRingMesh.visible = false;
            this.phantomOpacity.value = 0;
            this.burstRingOpacity.value = 0;
        }
    }

    private endCast() {
        this.activeCast = false;
        this.launchedThisCast = false;
        this.hoverLocked = false;
        this.castGroup.visible = false;
        this.trailMesh.visible = false;
        this.trailOpacity.value = 0;
        this.phantomOpacity.value = 0;
        this.burstRingOpacity.value = 0;
        if (this.solidPreview) this.solidPreview.visible = false;
        if (this.phantomPreview) this.phantomPreview.visible = false;
        this.burstRingMesh.visible = false;
        this.setOriginalSwordHidden(false);
    }

    private launchProjectile(origin: T.Vector3, direction: T.Vector3) {
        if (!this.template) return;
        const group = new T.Group();
        group.name = 'Flying_GiantSword';
        group.position.copy(origin);
        orientBlade(direction, 0.22, group.quaternion);

        const blade = this.template.scene.clone(true);
        blade.scale.setScalar(GIANT_SCALE);

        const wake = new T.Mesh(this.wakeGeo, this.wakeMat);
        wake.renderOrder = 4;
        const cone = new T.Mesh(this.coneGeo, this.coneMat);
        cone.renderOrder = 5;

        const sparks = new T.InstancedMesh(this.sparkGeo, this.sparkMat, WAKE_SPARK_COUNT);
        sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
        sparks.frustumCulled = false;
        sparks.renderOrder = 5;

        group.add(blade, wake, cone, sparks);
        this.scene.add(group);

        const proj: ActiveProjectile = {
            group,
            sparks,
            direction: direction.clone().normalize(),
            speed: LAUNCH_SPEED,
            age: 0,
        };
        this.updateWakeSparks(proj);
        this.projectiles.add(proj);
    }

    private updateWakeSparks(proj: ActiveProjectile) {
        for (let i = 0; i < WAKE_SPARK_COUNT; i++) {
            const drift = (i * 0.618 + proj.age * (3.1 + (i % 5) * 0.35)) % 1;
            const ang = i * 2.399 + drift * 2.2;
            const rad = 0.28 + drift * 1.15;
            this.dummy.position.set(
                Math.cos(ang) * rad,
                Math.sin(ang) * rad,
                1.4 - drift * 6.8,
            );
            this.dummy.rotation.set(ang, drift * 3, 0);
            const s = (1 - drift) * (0.45 + (i % 3) * 0.25);
            this.dummy.scale.set(s * 0.55, s * 0.55, s * 3.8);
            this.dummy.updateMatrix();
            proj.sparks.setMatrixAt(i, this.dummy.matrix);
        }
        proj.sparks.instanceMatrix.needsUpdate = true;
    }

    private spawnImpact(point: T.Vector3, dir: T.Vector3, groundHeight: number | undefined, embedSword: boolean) {
        const root = new T.Group();
        root.name = 'GiantSword_Impact';
        root.position.copy(point);
        if (groundHeight !== undefined) root.position.y = groundHeight;
        this.scene.add(root);

        const impactYaw = Math.random() * Math.PI * 2;
        const ownedMaterials: T.Material[] = [];

        let embeddedSword: T.Object3D | undefined;
        if (embedSword && this.template) {
            embeddedSword = this.template.scene.clone(true);
            embeddedSword.scale.setScalar(GIANT_SCALE);
            orientBlade(dir, 0.22, embeddedSword.quaternion);
            // Plant sword tip deeply into crater center so broad silver blade & crossguard tower heroically!
            embeddedSword.position.copy(dir).multiplyScalar(-1.05);
            root.add(embeddedSword);
        }

        // Layer 1: Fractured flat-topped dark stone ground slabs (matching Giant Sword skill icon)
        let slabs: T.Mesh | undefined;
        if (this.impactGeos.slabs && groundHeight !== undefined) {
            slabs = new T.Mesh(this.impactGeos.slabs, this.craterRockMat);
            slabs.name = 'Impact_CraterSlabs';
            slabs.rotation.y = impactYaw;
            slabs.scale.set(1.22, 0.12, 1.22);
            slabs.castShadow = true;
            slabs.receiveShadow = true;
            root.add(slabs);
        }

        // Layer 2: Short, razor-sharp straight white-cyan starburst flash at sword entry base
        let flash: T.Mesh | undefined;
        let flashOpacity: { value: number } | undefined;
        if (this.impactGeos.flash) {
            const fm = makeImpactEnergyMaterial('#5ce8ff', '#eeffff', true);
            ownedMaterials.push(fm.material);
            flashOpacity = fm.opacity;
            flash = new T.Mesh(this.impactGeos.flash, fm.material);
            flash.name = 'Impact_BaseFlash';
            flash.rotation.y = impactYaw;
            flash.scale.setScalar(0.25);
            flash.renderOrder = 6;
            root.add(flash);
        }

        // Layer 3: Sleek horizontal & spiraling cyan wind-qi ribbons
        let swirl: T.Mesh | undefined;
        let swirlOpacity: { value: number } | undefined;
        if (this.impactGeos.swirl) {
            const sm = makeSwirlRibbonMaterial();
            ownedMaterials.push(sm.material);
            swirlOpacity = sm.opacity;
            swirl = new T.Mesh(this.impactGeos.swirl, sm.material);
            swirl.name = 'Impact_SwirlRibbons';
            swirl.rotation.y = impactYaw;
            swirl.scale.setScalar(0.45);
            swirl.renderOrder = 5;
            root.add(swirl);
        }

        // Layer 4: Branching organic glowing turquoise-cyan ground fissures
        let fissure: T.Mesh | undefined;
        let fissureOpacity: { value: number } | undefined;
        if (this.impactGeos.fissure && groundHeight !== undefined) {
            const fm = makeImpactEnergyMaterial('#2ad4ee', '#d8fcff', true);
            fm.material.polygonOffset = true;
            fm.material.polygonOffsetFactor = -2;
            ownedMaterials.push(fm.material);
            fissureOpacity = fm.opacity;
            fissure = new T.Mesh(this.impactGeos.fissure, fm.material);
            fissure.name = 'Impact_GroundFissure';
            fissure.rotation.y = impactYaw;
            fissure.position.y = 0.05;
            fissure.scale.set(0.18, 1, 0.18);
            fissure.renderOrder = 3;
            root.add(fissure);
        }

        // Layer 5: 14 chiseled dark fractured rock chunks blasted upward in ballistic arc
        let debris: T.Mesh | undefined;
        if (this.impactGeos.debris) {
            debris = new T.Mesh(this.impactGeos.debris, this.craterRockMat);
            debris.name = 'Impact_RockDebris';
            debris.rotation.y = impactYaw;
            debris.scale.setScalar(0.28);
            debris.castShadow = true;
            root.add(debris);
        }

        const sparks = new T.InstancedMesh(this.sparkGeo, this.sparkMat, IMPACT_SPARK_COUNT);
        sparks.instanceMatrix.setUsage(T.DynamicDrawUsage);
        sparks.frustumCulled = false;
        sparks.renderOrder = 6;
        root.add(sparks);

        const sparkVel: T.Vector3[] = [];
        for (let i = 0; i < IMPACT_SPARK_COUNT; i++) {
            const a = (i / IMPACT_SPARK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            const spd = 5 + Math.random() * 12;
            const vy = 3.5 + Math.random() * 9.5;
            sparkVel.push(new T.Vector3(Math.cos(a) * spd, vy, Math.sin(a) * spd));
        }

        this.impacts.add({
            root,
            embeddedSword,
            slabs,
            flash,
            flashOpacity,
            swirl,
            swirlOpacity,
            fissure,
            fissureOpacity,
            debris,
            ownedMaterials,
            sparks,
            sparkVel,
            position: root.position.clone(),
            age: 0,
            duration: 1.85,
        });
    }

    update(dt: number) {
        this.timeUniform.value += dt;

        // Advance launched Giant Sword projectiles
        for (const proj of this.projectiles) {
            const step = Math.min(dt, MAX_FLIGHT_AGE - proj.age);
            const from = proj.group.position;
            const next = this.tmpA.copy(from).addScaledVector(proj.direction, proj.speed * step);

            const worldHit = traceFireballWorld(from, next, this.sampleGround, 0.22);
            const creatureT = this.traceCreature(from, next);
            const contact = Math.min(worldHit?.t ?? Infinity, creatureT ?? Infinity);

            if (contact <= 1) {
                const hitPoint = this.tmpB.lerpVectors(from, next, contact);
                const directHit = creatureT !== undefined && (worldHit === undefined || creatureT <= worldHit.t);
                const surface = worldHit && worldHit.t === contact ? worldHit.ground : undefined;
                if (surface) hitPoint.y = surface.height;
                const below = surface ?? this.sampleGround(hitPoint.x, hitPoint.z, hitPoint.y + 0.5);
                const nearGround = surface !== undefined || Math.abs(hitPoint.y - below.height) < 2.2;
                const groundH = surface ? surface.height : nearGround ? below.height : undefined;

                this.blast(hitPoint, directHit);
                this.spawnImpact(hitPoint, proj.direction, groundH, surface !== undefined || nearGround);
                this.removeProjectile(proj);
                continue;
            }

            from.copy(next);
            proj.age += step;
            this.updateWakeSparks(proj);
            if (proj.age >= MAX_FLIGHT_AGE) {
                this.removeProjectile(proj);
            }
        }

        // Advance icon-matched 5-layer 3D impacts (crisp base flash + sleek wind ribbons + fractured dark rock slabs & debris)
        for (const imp of this.impacts) {
            imp.age += dt;
            const t = imp.age / imp.duration;
            if (t >= 1) {
                this.removeImpact(imp);
                continue;
            }
            const age = imp.age;

            // Layer 2: Short, razor-sharp white-cyan impact starburst flash (0.00s..0.38s)
            if (imp.flash && imp.flashOpacity) {
                const ft = Math.min(1, age / 0.38);
                const fEase = 1 - Math.pow(1 - ft, 2.8);
                imp.flash.scale.setScalar(0.25 + fEase * 1.45);
                imp.flashOpacity.value = ft < 1 ? (1 - T.MathUtils.smoothstep(ft, 0.22, 1.0)) * 0.94 : 0;
                imp.flash.visible = imp.flashOpacity.value > 0.01;
            }

            // Layer 3: Sleek horizontal & spiraling cyan wind-qi ribbons (0.00s..0.78s)
            if (imp.swirl && imp.swirlOpacity) {
                const st = Math.min(1, age / 0.78);
                const sEase = 1 - Math.pow(1 - st, 2.4);
                const sXZ = 0.45 + sEase * 1.85;
                const sY = 0.48 + sEase * 1.05;
                imp.swirl.scale.set(sXZ, sY, sXZ);
                imp.swirl.rotation.y += dt * 2.6;
                imp.swirlOpacity.value = st < 1 ? (1 - T.MathUtils.smoothstep(st, 0.32, 1.0)) * 0.92 : 0;
                imp.swirl.visible = imp.swirlOpacity.value > 0.01;
            }

            // Layer 1: Fractured flat-topped dark stone slabs (heave up 0..0.15s, hold, sink cleanly 1.32..1.85s)
            if (imp.slabs) {
                let sy: number;
                if (age < 0.15) {
                    sy = T.MathUtils.lerp(0.12, 1.38, 1 - Math.pow(1 - age / 0.15, 2.6));
                } else if (age < 0.28) {
                    sy = T.MathUtils.lerp(1.38, 1.22, (age - 0.15) / 0.13);
                } else if (age < imp.duration - 0.50) {
                    sy = 1.22;
                } else {
                    const sink = T.MathUtils.smoothstep(age, imp.duration - 0.50, imp.duration);
                    sy = T.MathUtils.lerp(1.22, 0.02, sink);
                }
                imp.slabs.scale.set(1.24, sy, 1.24);
            }

            // Layer 4: Branching glowing turquoise-cyan ground fissures (0..1.85s)
            if (imp.fissure && imp.fissureOpacity) {
                const ft = Math.min(1, age / 0.18);
                const fScale = T.MathUtils.lerp(0.18, 1.28, 1 - Math.pow(1 - ft, 2.5));
                imp.fissure.scale.set(fScale, 1, fScale);
                imp.fissureOpacity.value = (1 - T.MathUtils.smoothstep(age, 1.12, imp.duration)) * 0.94;
                imp.fissure.visible = imp.fissureOpacity.value > 0.01;
            }

            // Layer 5: Chiseled dark rock debris chunks (ballistic flight 0..1.35s, then sink)
            if (imp.debris) {
                const dtFrac = Math.min(1, age / 1.35);
                const dEase = 1 - Math.pow(1 - dtFrac, 2.0);
                const sXZ = 0.28 + dEase * 1.72;
                const sinkFade = 1 - T.MathUtils.smoothstep(age, 1.05, 1.45);
                imp.debris.scale.set(sXZ, Math.max(0.01, (0.35 + Math.sin(dtFrac * Math.PI) * 0.95) * sinkFade), sXZ);
                imp.debris.position.y = Math.sin(dtFrac * Math.PI) * 0.72 - dtFrac * dtFrac * 0.45;
                imp.debris.visible = sinkFade > 0.02;
            }

            // Embedded giant sword dissolves smoothly upward during final 0.40s
            if (imp.embeddedSword) {
                const dissolve = T.MathUtils.smoothstep(age, imp.duration - 0.40, imp.duration);
                if (dissolve > 0) {
                    const s = GIANT_SCALE * (1 - dissolve * 0.85);
                    imp.embeddedSword.scale.set(s * (1 - dissolve * 0.4), s * (1 - dissolve * 0.4), s);
                    imp.embeddedSword.position.y += dt * 1.4;
                }
            }

            // Flying cyan impact sparks
            const spT = Math.min(1, age / 0.95);
            for (let i = 0; i < IMPACT_SPARK_COUNT; i++) {
                const v = imp.sparkVel[i];
                this.dummy.position.set(
                    v.x * age * 0.72,
                    Math.max(0.05, v.y * age - 9.5 * age * age),
                    v.z * age * 0.72,
                );
                this.dummy.rotation.set(age * 6 + i, age * 4, 0);
                const s = (1 - spT) * (0.65 + (i % 3) * 0.35);
                this.dummy.scale.set(s * 0.5, s * 1.9, s * 0.5);
                this.dummy.updateMatrix();
                imp.sparks.setMatrixAt(i, this.dummy.matrix);
            }
            imp.sparks.instanceMatrix.needsUpdate = true;
        }
    }

    collectLights(pool: SpellLightPool) {
        if (this.castGroup.visible) {
            const p = this.castGroup.position;
            const boost = 1 + this.phantomOpacity.value * 1.6;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0x38c8ff,
                intensity: 5.5 * boost,
                distance: 18,
                priority: 86,
                castShadow: true,
            });
        }
        for (const proj of this.projectiles) {
            const p = proj.group.position;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0x42d4ff,
                intensity: 9.5,
                distance: 22,
                priority: 94,
                castShadow: true,
            });
        }
        for (const imp of this.impacts) {
            const fade = Math.max(0, 1 - imp.age / 0.85);
            if (fade <= 0.02) continue;
            pool.emit({
                x: imp.position.x,
                y: imp.position.y + 1.2,
                z: imp.position.z,
                color: 0x4cdbff,
                intensity: 14 * fade * fade,
                distance: 26,
                priority: 96,
                castShadow: false,
            });
        }
    }

    private removeProjectile(proj: ActiveProjectile) {
        proj.sparks.dispose();
        proj.group.removeFromParent();
        this.projectiles.delete(proj);
    }

    private removeImpact(imp: ActiveImpact) {
        for (const m of imp.ownedMaterials) m.dispose();
        imp.sparks.dispose();
        imp.root.removeFromParent();
        this.impacts.delete(imp);
    }

    clear() {
        this.endCast();
        for (const p of this.projectiles) this.removeProjectile(p);
        for (const imp of this.impacts) this.removeImpact(imp);
    }

    dispose() {
        this.disposed = true;
        this.clear();
        this.castGroup.removeFromParent();
        this.trailMesh.removeFromParent();
        this.trailGeometry.dispose();
        this.trailMaterial.dispose();
        this.burstRingMesh.geometry.dispose();
        this.burstRingMaterial.dispose();
        this.phantomMaterial.dispose();
        this.wakeGeo.dispose();
        this.wakeMat.dispose();
        this.coneGeo.dispose();
        this.coneMat.dispose();
        this.sparkGeo.dispose();
        this.sparkMat.dispose();
        this.craterRockMat.dispose();
        if (this.template) disposeGltf(this.template);
        if (this.impactTemplate) disposeGltf(this.impactTemplate);
    }
}
