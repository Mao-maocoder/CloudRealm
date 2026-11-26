import * as T from 'three';
import type { Quality } from '../config/settings';

const CORE_TEX_URL = new URL('../../resource/sky/omen/omen_vortex_core.png', import.meta.url).href;
const MID_TEX_URL = new URL('../../resource/sky/omen/omen_vortex_mid.png', import.meta.url).href;
const SEA_TEX_URL = new URL('../../resource/sky/omen/omen_cloud_sea.png', import.meta.url).href;
const PUFF_TEX_URL = new URL('../../resource/sky/omen/omen_cloud_puff.png', import.meta.url).href;

export type OmenPhase = 0 | 1 | 2 | 3 | 4 | 5;

export const OMEN_PHASE_NAMES: Record<OmenPhase, string> = {
    0: '平静',
    1: '天地感应',
    2: '灵气汇聚',
    3: '天地威压',
    4: '元婴凝成',
    5: '天地归寂',
};

export interface OmenShockState {
    x: number;
    z: number;
    radius: number;
    strength: number;
}

interface LightningSlot {
    line: T.LineSegments;
    positions: Float32Array;
    mat: T.LineBasicMaterial;
    age: number;
    duration: number;
    active: boolean;
    centroid: T.Vector3;
    intensity: number;
    flickerSeed: number;
}

interface CloudPuffSpec {
    radius: number;
    angle: number;
    y: number;
    size: number;
    speed: number;
    tilt: number;
    seed: number;
}

const MAX_LIGHTNING_SLOTS = 5;
const LIGHTNING_MAX_SEGS = 34;
const MAX_SPIRIT_MOTES = 112;
const MAX_CLOUD_PUFFS = 16;

// Phase timeline milestones (seconds) for full cinematic breakthrough evolution:
// Phase 1 (天地感应): 0.0 -> 3.2s
// Phase 2 (灵气汇聚): 3.2 -> 7.2s
// Phase 3 (天地威压): 7.2 -> 12.6s (sustained hold in manual toggle mode)
// Phase 4 (元婴凝成): 12.6 -> 17.6s (breakthrough climax + golden pillar + shockwave)
// Phase 5 (天地归寂): 17.6 -> 23.0s (smooth cloud dissolution & lighting recovery)
const T_P1_END = 3.2;
const T_P2_END = 7.2;
const T_P3_END = 12.6;
const T_P4_END = 17.6;
const T_P5_END = 23.0;

function smooth01(a: number, b: number, x: number): number {
    if (b <= a) return x >= b ? 1 : 0;
    const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Deterministic multi-frequency 3D funnel geometry with irregular non-circular rims
 * and undulating thunderhead height ridges/troughs to break uniform dome silhouette.
 */
function createOrganicFunnelGeometry(
    rInner: number,
    rOuter: number,
    yInner: number,
    yOuter: number,
    archCurve: number,
    heightNoiseAmp: number,
    radialIrregularity: number,
    seed: number,
    segsTheta = 76,
    segsRad = 22,
): T.BufferGeometry {
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const maxRadius = rOuter * (1 + radialIrregularity * 1.18);

    for (let ir = 0; ir <= segsRad; ir++) {
        const tr = ir / segsRad;
        // Slightly denser radial rings near the inner throat where perspective curvature is greatest
        const trCurve = Math.pow(tr, 1.06);
        const baseR = rInner + (rOuter - rInner) * trCurve;
        const baseY = T.MathUtils.lerp(yInner, yOuter, Math.pow(tr, 0.76)) + Math.sin(tr * Math.PI) * archCurve;

        for (let it = 0; it <= segsTheta; it++) {
            const a = (it / segsTheta) * Math.PI * 2;
            const ca = Math.cos(a);
            const sa = Math.sin(a);

            // Low-frequency angular irregularity breaks any circular donut silhouette
            const angWave =
                Math.sin(a * 2.0 + seed * 1.3) * 0.44 +
                Math.cos(a * 3.0 - seed * 2.1 + tr * 1.8) * 0.34 +
                Math.sin(a * 5.0 + seed * 0.7 - tr * 2.4) * 0.22;
            const r = baseR * (1.0 + angWave * radialIrregularity);

            // Multi-frequency 3D thunderhead vertical billows (ridges & deep troughs)
            const edgeWeight = Math.sin(tr * Math.PI);
            const ridgeA = Math.sin(a * 3.0 + tr * 5.2 + seed * 1.7) * Math.cos(a * 2.0 - tr * 3.4 + seed);
            const ridgeB = Math.sin(a * 6.0 - tr * 7.8 + seed * 2.9) * 0.45;
            const yOffset = (ridgeA + ridgeB) * heightNoiseAmp * (0.28 + 0.72 * edgeWeight);

            const x = ca * r;
            const z = sa * r;
            const y = baseY + yOffset;

            verts.push(x, y, z);
            // Planar polar UV mapped from actual world-aligned (x, z) so irregular vertex displacement never stretches UVs!
            const u = 0.5 + (x / (maxRadius * 2.0)) * 0.94;
            const v = 0.5 + (z / (maxRadius * 2.0)) * 0.94;
            uvs.push(u, v);
        }
    }

    const stride = segsTheta + 1;
    for (let ir = 0; ir < segsRad; ir++) {
        for (let it = 0; it < segsTheta; it++) {
            const a = ir * stride + it;
            const b = a + 1;
            const c = (ir + 1) * stride + it + 1;
            const d = (ir + 1) * stride + it;
            indices.push(a, c, b, a, d, c);
        }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/**
 * Undulating vertical veil mesh for subtle intermittent aurora wisps tucked between cloud decks.
 */
function createAuroraVeilGeometry(
    radius: number,
    yBottom: number,
    height: number,
    waveAmp: number,
    waveFreq: number,
    segs = 96,
): T.BufferGeometry {
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const a = u * Math.PI * 2;
        const r = radius + Math.sin(a * waveFreq) * waveAmp + Math.cos(a * (waveFreq + 2)) * (waveAmp * 0.5);
        const yOff = Math.sin(a * (waveFreq - 1) + 0.9) * 18;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        verts.push(x, yBottom + yOff, z);
        uvs.push(u, 0);
        verts.push(x * 0.93, yBottom + height + yOff, z * 0.93);
        uvs.push(u, 1);
    }
    for (let i = 0; i < segs; i++) {
        const v0 = i * 2, v1 = v0 + 1, v2 = v0 + 2, v3 = v0 + 3;
        indices.push(v0, v2, v1, v1, v2, v3);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
}

const WORLD_NOISE_GLSL = /* glsl */ `
float omHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float omNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(omHash(i), omHash(i + vec2(1.0, 0.0)), f.x),
        mix(omHash(i + vec2(0.0, 1.0)), omHash(i + vec2(1.0, 1.0)), f.x),
        f.y
    );
}
float omFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 3; i++) {
        v += omNoise(p) * a;
        p = rot * p * 2.04 + vec2(13.7, -9.2);
        a *= 0.5;
    }
    return v;
}
`;

/**
 * 《云境》天地异象 V2 (Grand Xianxia Celestial Omen / 元婴天兆):
 * Art direction: "以云为体，以光为骨，以雷为势" (55% massive brooding storm-cloud vortex,
 * 20% deep vortex eye & crevice gold light, 12% restrained cloud-gap God Rays & distinct
 * Phase-4 breakthrough pillar, 8% localized in-cloud lightning, 5% hidden aurora wisps &
 * converging spirit motes).
 *
 * Preserves Scheme C architecture:
 * - Offline Blender Principled Volume storm-cloud textures (core, mid, sea + 3D cloud puffs)
 * - 3 vertically separated organic 3D concave funnel domes + instanced volumetric cloud puffs
 * - World-space noise modulation & organic vapor gather/dissolve (zero UV stretching / wormhole look)
 * - Full 5-phase continuous narrative evolution: 天地感应 -> 灵气汇聚 -> 天地威压 -> 元婴凝成 -> 天地归寂
 */
export class CelestialOmen {
    readonly group = new T.Group();
    private readonly dummyTex: T.DataTexture;
    private readonly loadedTextures: T.Texture[] = [];
    private loadPromise?: Promise<void>;
    private disposed = false;
    private quality: Quality;

    private readonly coreLayer: T.Mesh;
    private readonly midLayer: T.Mesh;
    private readonly seaLayer: T.Mesh;
    private readonly cloudMats: T.ShaderMaterial[] = [];

    private readonly puffMesh: T.InstancedMesh;
    private readonly puffMat: T.ShaderMaterial;
    private readonly puffSpecs: CloudPuffSpec[] = [];
    private readonly puffDummy = new T.Object3D();

    private readonly eyeMesh: T.Mesh;
    private readonly eyeMat: T.ShaderMaterial;

    private readonly raysGroup = new T.Group();
    private readonly rayShafts: T.Mesh[] = [];
    private readonly rayMat: T.ShaderMaterial;

    private readonly centerPillarOuter: T.Mesh;
    private readonly centerPillarCore: T.Mesh;
    private readonly pillarOuterMat: T.ShaderMaterial;
    private readonly pillarCoreMat: T.ShaderMaterial;

    private readonly shockRing: T.Mesh;
    private readonly shockMat: T.ShaderMaterial;

    private readonly auroraInner: T.Mesh;
    private readonly auroraOuter: T.Mesh;
    private readonly auroraMats: T.ShaderMaterial[] = [];

    private readonly lightningSlots: LightningSlot[] = [];
    private readonly spiritMotes: T.Points;
    private readonly spiritMotesMat: T.ShaderMaterial;

    // 5-phase evolution state
    private time = 0;
    private spinClock = 0;
    private phaseElapsed = 0;
    private _phase: OmenPhase = 0;
    private mode: 'idle' | 'sustain' | 'breakthrough' | 'dispersing' = 'idle';
    private disperseElapsed = 0;
    private disperseStartWeights = {
        atmo: 0,
        sea: 0,
        mid: 0,
        core: 0,
        eye: 0,
        rays: 0,
        aurora: 0,
        motes: 0,
        wind: 0,
        gold: 0,
    };
    private timedHoldRemaining = 0;

    // Live output signals for full-scene atmosphere, lighting, water, and foliage wind coupling
    private _intensity = 0;
    private _atmoWeight = 0;
    private _goldWeight = 0;
    private _windStrength = 0;
    private _flash = 0;
    private _climax = 0;
    private readonly _shock: OmenShockState = { x: 0, z: 0, radius: 0, strength: 0 };

    // Localized lightning bolts passed to cloud shaders (xyz = local centroid, w = live strength)
    private readonly boltA = new T.Vector4(0, 290, 0, 0);
    private readonly boltB = new T.Vector4(0, 290, 0, 0);
    private readonly tmpBoltP0 = new T.Vector3();
    private readonly tmpBoltP1 = new T.Vector3();
    private readonly tmpBoltPrev = new T.Vector3();
    private readonly tmpBoltCur = new T.Vector3();
    private readonly tmpBoltFork = new T.Vector3();
    private readonly tmpBoltMainPts: T.Vector3[] = Array.from({ length: 18 }, () => new T.Vector3());
    private nextLightningAt = 1.4;
    private highCamOrder = false;

    get active(): boolean {
        return this.mode === 'sustain' || this.mode === 'breakthrough';
    }

    get phase(): OmenPhase {
        return this._phase;
    }

    get phaseName(): string {
        return OMEN_PHASE_NAMES[this._phase];
    }

    /** Overall 0..1 omen presence for legacy callers & atmosphere blend. */
    get intensity(): number {
        return this._intensity;
    }

    /** Smoothed 0..1 sky/fog/lighting storm darkening strength. */
    get atmosphereWeight(): number {
        return this._atmoWeight;
    }

    /** Smoothed 0..1 golden cloud-crevice peak & canopy highlight strength. */
    get goldLightWeight(): number {
        return this._goldWeight;
    }

    /** Smoothed 0..1 valley wind boost synchronized to Phases 1-5. */
    get windStrength(): number {
        return this._windStrength;
    }

    /** Momentary 0..1 sky/valley bounce flash from in-cloud lightning. */
    get lightningFlash(): number {
        return this._flash;
    }

    /** Phase-4 spatial shockwave state for foliage/water/fog reaction. */
    get shockwave(): Readonly<OmenShockState> {
        return this._shock;
    }

    get warmObjects(): readonly T.Object3D[] {
        return [
            this.coreLayer,
            this.midLayer,
            this.seaLayer,
            this.puffMesh,
            this.eyeMesh,
            this.raysGroup,
            this.centerPillarOuter,
            this.centerPillarCore,
            this.shockRing,
            this.auroraInner,
            this.auroraOuter,
            this.spiritMotes,
        ];
    }

    constructor(scene: T.Scene, quality: Quality = 'high') {
        this.quality = quality;
        this.group.name = 'Celestial Omen V2';
        this.group.visible = false;

        this.dummyTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        this.dummyTex.needsUpdate = true;

        const makeCloudLayerMat = (
            deepSlate: [number, number, number],
            litSlate: [number, number, number],
            goldRimStrength: number,
            opacityMul: number,
            worldScale: number,
            innerGoldFalloff: number,
        ) => {
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uMap: { value: this.dummyTex },
                    uHasMap: { value: 0 },
                    uTime: { value: 0 },
                    uLayerAlpha: { value: 0 },
                    uCoverage: { value: 0 },
                    uGoldWeight: { value: 0 },
                    uClimax: { value: 0 },
                    uBoltA: { value: this.boltA },
                    uBoltB: { value: this.boltB },
                    uShock: { value: new T.Vector3(0, 0, 0) }, // x=radius, y=strength
                    uDeepSlate: { value: new T.Vector3(...deepSlate) },
                    uLitSlate: { value: new T.Vector3(...litSlate) },
                    uGoldRim: { value: goldRimStrength },
                    uOpacityMul: { value: opacityMul },
                    uWorldScale: { value: worldScale },
                    uInnerFalloff: { value: innerGoldFalloff },
                },
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                fog: false,
                vertexShader: /* glsl */ `
                    varying vec2 vUv;
                    varying vec3 vLocalPos;
                    varying vec3 vWorldPos;
                    varying vec3 vWorldNormal;
                    void main() {
                        vUv = uv;
                        vLocalPos = position;
                        vec4 wp = modelMatrix * vec4(position, 1.0);
                        vWorldPos = wp.xyz;
                        vWorldNormal = normalize(mat3(modelMatrix) * normal);
                        gl_Position = projectionMatrix * viewMatrix * wp;
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform sampler2D uMap;
                    uniform float uHasMap;
                    uniform float uTime;
                    uniform float uLayerAlpha;
                    uniform float uCoverage;
                    uniform float uGoldWeight;
                    uniform float uClimax;
                    uniform vec4 uBoltA;
                    uniform vec4 uBoltB;
                    uniform vec3 uShock;
                    uniform vec3 uDeepSlate;
                    uniform vec3 uLitSlate;
                    uniform float uGoldRim;
                    uniform float uOpacityMul;
                    uniform float uWorldScale;
                    uniform float uInnerFalloff;
                    varying vec2 vUv;
                    varying vec3 vLocalPos;
                    varying vec3 vWorldPos;
                    varying vec3 vWorldNormal;
                    ${WORLD_NOISE_GLSL}

                    void main() {
                        if (uHasMap < 0.5 || uLayerAlpha <= 0.002) discard;

                        // Grazing-angle volumetric fade prevents thin-paper edge-on ribbons from mountaintops or free-cam!
                        vec3 viewDir = normalize(cameraPosition - vWorldPos);
                        float ndotv = abs(dot(normalize(vWorldNormal), viewDir));
                        float grazingFade = smoothstep(0.03, 0.28, ndotv);
                        if (grazingFade < 0.01) discard;

                        // World-space multi-octave cloud sculpting breaks up any UV stretch or radial regularity
                        vec2 wCoord = vWorldPos.xz * uWorldScale;
                        float wBillow = omFbm(wCoord + vec2(uTime * 0.012, -uTime * 0.009));
                        float wFine = omNoise(wCoord * 2.65 - vec2(uTime * 0.018, uTime * 0.014));

                        // Gentle organic advection warp (very small so volumetric details stay crisp!)
                        vec2 warp = (vec2(wBillow, wFine) - 0.5) * 0.022;
                        vec4 tex = texture2D(uMap, clamp(vUv + warp, 0.002, 0.998));
                        if (tex.a <= 0.008) discard;

                        // Preserve real volumetric self-shadowing from Blender render!
                        float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
                        float warmness = clamp((tex.r - tex.b) * 2.8, 0.0, 1.0);

                        // Modulate volumetric relief with world-space billow shadows (rich slate-indigo storm thunderheads)
                        float relief = clamp(luma * (0.82 + 0.44 * wBillow), 0.0, 1.35);
                        vec3 stormBody = mix(uDeepSlate, uLitSlate, smoothstep(0.08, 0.68, relief));
                        // Preserve subtle localized violet storm depth & warm backlit crevices from Blender volume
                        vec3 graded = mix(stormBody, tex.rgb * 1.08, 0.52);

                        // Crevice & inner-lip golden backlit scattering along thin edges facing the vortex eye (20% weight)
                        float r = length(vUv - 0.5) * 2.0; // 0..1
                        float thinEdge = smoothstep(0.06, 0.36, tex.a) * (1.0 - smoothstep(0.48, 0.90, tex.a));
                        float innerProx = exp(-max(0.0, r - 0.16) * uInnerFalloff);
                        float crevNoise = smoothstep(0.28, 0.76, wFine * 0.58 + wBillow * 0.42);
                        float goldMask = clamp((warmness * 0.92 + thinEdge * innerProx * 1.05 * crevNoise) * uGoldRim, 0.0, 1.25);
                        vec3 goldCol = vec3(1.0, 0.78, 0.40) * goldMask * (0.58 + 0.56 * uGoldWeight + 0.48 * uClimax);

                        // Subtle localized storm-indigo violet edge depth (muted, zero neon magenta)
                        vec3 violetDepth = vec3(0.36, 0.28, 0.68) * thinEdge * (1.0 - innerProx) * crevNoise * 0.22;

                        // Localized in-cloud lightning scatter (lights ONLY nearby thunderheads from within!)
                        float distA = length(vLocalPos - uBoltA.xyz);
                        float distB = length(vLocalPos - uBoltB.xyz);
                        float glowA = exp(-distA / 460.0) * uBoltA.w;
                        float glowB = exp(-distB / 460.0) * uBoltB.w;
                        float boltScatter = clamp(glowA + glowB, 0.0, 1.35) * (0.42 + 0.68 * thinEdge + 0.35 * wFine);
                        vec3 boltCol = vec3(0.64, 0.72, 1.0) * boltScatter * 1.08;

                        // Phase-4 outward spatial spirit shockwave ripple across cloud undersides
                        float shockDist = abs(length(vLocalPos.xz) - uShock.x);
                        float shockBand = exp(-pow(shockDist / 115.0, 2.0)) * uShock.y;
                        vec3 shockCol = vec3(0.96, 0.80, 0.48) * shockBand * (0.32 + 0.48 * thinEdge);

                        vec3 finalCol = graded + goldCol + violetDepth + boltCol + shockCol;
                        // Gentle soft-knee highlight roll-off preserves rich amber gold & prevents flat white clipping
                        finalCol = finalCol / (vec3(1.0) + finalCol * 0.28);

                        // Organic vapor gather / dissolve via world-space noise erosion (no flat fade pop!)
                        float cloudDensity = tex.a * (0.76 + 0.44 * wBillow + 0.14 * (wFine - 0.5));
                        float erodeCut = mix(0.86, 0.02, clamp(uCoverage, 0.0, 1.0));
                        float organicMask = smoothstep(erodeCut, erodeCut + 0.28, cloudDensity);
                        float alpha = clamp(tex.a * organicMask * grazingFade * uOpacityMul * uLayerAlpha, 0.0, 0.94);
                        if (alpha < 0.008) discard;

                        gl_FragColor = vec4(finalCol, alpha);
                    }
                `,
            });
            this.cloudMats.push(mat);
            return mat;
        };

        // 1. Three vertically separated organic 3D concave funnel domes high in the heavens (540m..1040m altitude, up to 2350m radius!)
        // Core layer: deep recessed upper vortex throat high in the ninth heaven
        this.coreLayer = new T.Mesh(
            createOrganicFunnelGeometry(52, 660, 1040, 890, 48, 22, 0.11, 1.7),
            makeCloudLayerMat([0.068, 0.098, 0.205], [0.28, 0.36, 0.54], 1.25, 0.96, 0.0032, 2.5),
        );
        this.coreLayer.renderOrder = 2;

        // Mid layer: primary 55% visual hero storm thunderhead wall
        this.midLayer = new T.Mesh(
            createOrganicFunnelGeometry(175, 1580, 860, 670, 78, 32, 0.12, 4.3),
            makeCloudLayerMat([0.060, 0.090, 0.188], [0.26, 0.35, 0.52], 0.88, 0.96, 0.0018, 3.0),
        );
        this.midLayer.renderOrder = 4;

        // Lower sea layer: vast horizon storm cloud sea hovering well above peaks & flight paths
        this.seaLayer = new T.Mesh(
            createOrganicFunnelGeometry(340, 2350, 640, 540, 52, 22, 0.14, 7.9),
            makeCloudLayerMat([0.074, 0.106, 0.202], [0.30, 0.39, 0.55], 0.48, 0.90, 0.00125, 3.5),
        );
        this.seaLayer.renderOrder = 8;

        this.group.add(this.coreLayer, this.midLayer, this.seaLayer);

        // 2. Instanced Soft Wide Cloud-Bank Strata Shelves (1 draw call, seamlessly blends 3D cloud deck thickness — zero round dark balls!)
        const puffGeo = new T.PlaneGeometry(1, 1);
        this.puffMat = new T.ShaderMaterial({
            uniforms: {
                uMap: { value: this.dummyTex },
                uHasMap: { value: 0 },
                uAlpha: { value: 0 },
                uGoldWeight: { value: 0 },
                uClimax: { value: 0 },
                uBoltA: { value: this.boltA },
                uBoltB: { value: this.boltB },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                varying vec3 vLocalCenter;
                varying float vInnerProx;
                void main() {
                    vUv = uv;
                    vec3 centerLocal = instanceMatrix[3].xyz;
                    float sx = length(instanceMatrix[0].xyz);
                    float sy = length(instanceMatrix[1].xyz);
                    vLocalCenter = centerLocal;
                    vInnerProx = exp(-max(0.0, length(centerLocal.xz) - 180.0) / 460.0);

                    // Cylindrical camera-facing shelf stays horizontal like real stratified cumulus banks!
                    vec4 mvCenter = modelViewMatrix * vec4(centerLocal, 1.0);
                    mvCenter.xy += position.xy * vec2(sx, sy);
                    gl_Position = projectionMatrix * mvCenter;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uHasMap;
                uniform float uAlpha;
                uniform float uGoldWeight;
                uniform float uClimax;
                uniform vec4 uBoltA;
                uniform vec4 uBoltB;
                varying vec2 vUv;
                varying vec3 vLocalCenter;
                varying float vInnerProx;

                void main() {
                    if (uHasMap < 0.5 || uAlpha <= 0.002) discard;
                    vec4 tex = texture2D(uMap, vUv);
                    if (tex.a < 0.01) discard;

                    // Ultra-soft Gaussian radial feathering eliminates any faint oval billboard rim!
                    vec2 ec = (vUv - 0.5) * 2.0;
                    float r = length(ec);
                    if (r >= 0.94) discard;
                    float softEdge = pow(1.0 - smoothstep(0.15, 0.92, r), 1.75);

                    float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
                    float warm = clamp((tex.r - tex.b) * 2.4, 0.0, 1.0);
                    vec3 baseCol = mix(vec3(0.075, 0.105, 0.205), vec3(0.26, 0.34, 0.50), smoothstep(0.12, 0.72, luma));
                    baseCol = mix(baseCol, tex.rgb * 0.96, 0.44);

                    vec3 gold = vec3(1.0, 0.78, 0.42) * warm * vInnerProx * (0.45 + 0.55 * uGoldWeight + 0.45 * uClimax);
                    float glowA = exp(-length(vLocalCenter - uBoltA.xyz) / 420.0) * uBoltA.w;
                    float glowB = exp(-length(vLocalCenter - uBoltB.xyz) / 420.0) * uBoltB.w;
                    vec3 bolt = vec3(0.62, 0.70, 1.0) * clamp(glowA + glowB, 0.0, 1.0) * 0.85;

                    vec3 col = baseCol + gold + bolt;
                    col = col / (vec3(1.0) + col * 0.30);
                    float a = clamp(tex.a * softEdge * 0.26 * uAlpha, 0.0, 0.38);
                    if (a < 0.008) discard;
                    gl_FragColor = vec4(col, a);
                }
            `,
        });

        this.puffMesh = new T.InstancedMesh(puffGeo, this.puffMat, MAX_CLOUD_PUFFS);
        this.puffMesh.frustumCulled = false;
        this.puffMesh.renderOrder = 6;
        for (let i = 0; i < MAX_CLOUD_PUFFS; i++) {
            const innerRing = i < 8;
            const idx = innerRing ? i : i - 8;
            const total = innerRing ? 8 : MAX_CLOUD_PUFFS - 8;
            const a = (idx / total) * Math.PI * 2 + (innerRing ? 0.22 : 0.64) + ((i * 37) % 100) * 0.003;
            const r = innerRing
                ? 240 + (((i * 53) % 100) / 100) * 210
                : 570 + (((i * 71) % 100) / 100) * 390;
            // Tucked directly into the high-altitude throat & mid cloud deck strata
            const y = innerRing
                ? 830 + (((i * 29) % 100) / 100) * 110
                : 685 + (((i * 43) % 100) / 100) * 95;
            const size = innerRing
                ? 190 + (((i * 19) % 100) / 100) * 85
                : 270 + (((i * 61) % 100) / 100) * 115;
            this.puffSpecs.push({
                radius: r,
                angle: a,
                y,
                size,
                speed: innerRing ? -0.055 : -0.026,
                tilt: (i % 2 === 0 ? 1 : -1) * 0.08,
                seed: i * 1.37,
            });
        }
        this.group.add(this.puffMesh);

        // 3. Deep Recessed Celestial Eye (pure Cartesian layered cloud-rift & warm heavenly radiance — zero polar pinch!)
        this.eyeMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uEyeAlpha: { value: 0 },
                uClimax: { value: 0 },
                uFlash: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv * 2.0 - 1.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uEyeAlpha;
                uniform float uClimax;
                uniform float uFlash;
                varying vec2 vUv;
                ${WORLD_NOISE_GLSL}

                vec2 rot2(vec2 p, float ang) {
                    float c = cos(ang), s = sin(ang);
                    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
                }

                void main() {
                    if (uEyeAlpha <= 0.002) discard;
                    float r = length(vUv);
                    if (r > 1.0) discard;

                    // Pure Cartesian slow-rotating multi-layer clouds (ZERO atan() polar singularity at r=0!)
                    vec2 pSlow = rot2(vUv, -uTime * 0.055);
                    vec2 pFast = rot2(vUv, -uTime * 0.095);

                    // Domain-warped organic high-altitude cloud tendrils drifting across the celestial opening
                    vec2 warp = vec2(
                        omFbm(pSlow * 2.6 + vec2(3.1, -1.7)),
                        omFbm(pSlow * 2.6 + vec2(-2.4, 4.3))
                    ) - 0.5;
                    float wispA = omFbm(pSlow * 3.2 + warp * 1.35 + vec2(uTime * 0.015, -uTime * 0.012));
                    float wispB = omFbm(pFast * 5.6 - warp * 0.95 + vec2(-uTime * 0.022, uTime * 0.018));

                    // Soft asymmetric celestial sky core: radiant golden heaven-light deepest inside,
                    // framed by translucent indigo-violet high-altitude cloud veils drifting across it!
                    vec2 coreOffset = vec2(0.06 * sin(uTime * 0.14), 0.05 * cos(uTime * 0.11));
                    float rCore = length(vUv - coreOffset + warp * 0.18);

                    // Deep royal celestial indigo-violet twilight sky behind the clouds
                    vec3 deepSky = mix(vec3(0.09, 0.12, 0.27), vec3(0.18, 0.16, 0.36), smoothstep(0.05, 0.65, wispA));

                    // Luminous warm-gold heavenly rift light shining OUTWARD from the deepest center (never a dark dot!)
                    float innerGlow = exp(-rCore * rCore * 3.8);
                    float softHalo = exp(-rCore * rCore * 1.45) * 0.65;
                    // Wispy clouds partly veil & catch golden silver-lining as they drift across the golden rift
                    float cloudVeil = smoothstep(0.34, 0.76, wispA * 0.62 + wispB * 0.38);
                    float goldRim = smoothstep(0.28, 0.54, cloudVeil) * (1.0 - smoothstep(0.56, 0.86, cloudVeil));

                    vec3 warmGold = vec3(1.0, 0.84, 0.48);
                    vec3 paleGold = vec3(1.0, 0.94, 0.76);
                    vec3 veilCol = mix(vec3(0.14, 0.19, 0.36), vec3(0.46, 0.42, 0.62), smoothstep(0.25, 0.80, wispB));

                    // Build rich layered celestial sky: deep sky -> golden heaven glow -> drifting cloud veils + golden backlit edges
                    vec3 col = deepSky;
                    col += warmGold * (softHalo * 0.55 + innerGlow * (0.85 + 0.75 * uClimax)) * (1.0 - cloudVeil * 0.48);
                    col += paleGold * exp(-rCore * rCore * 11.0) * (0.42 + 0.72 * uClimax) * (1.0 - cloudVeil * 0.35);
                    col = mix(col, veilCol, cloudVeil * 0.52 * smoothstep(0.10, 0.78, r));
                    col += warmGold * goldRim * (0.52 + 0.45 * innerGlow + 0.40 * uClimax);

                    // Subtle violet-blue lightning scatter inside the upper sky rift
                    col += vec3(0.58, 0.68, 1.0) * uFlash * (0.28 + 0.32 * cloudVeil) * (1.0 - r * 0.7);

                    // Soft-knee roll-off preserves warm gold detail without clipping to flat white
                    col = col / (vec3(1.0) + col * 0.38);

                    float irregOuter = r + (wispA - 0.5) * 0.20;
                    float outerFade = 1.0 - smoothstep(0.48, 0.96, irregOuter);
                    float alpha = clamp(outerFade * (0.78 + 0.20 * innerGlow) * uEyeAlpha, 0.0, 0.95);
                    gl_FragColor = vec4(col, alpha);
                }
            `,
        });
        const eyeGeo = new T.PlaneGeometry(650, 650);
        eyeGeo.rotateX(Math.PI / 2);
        this.eyeMesh = new T.Mesh(eyeGeo, this.eyeMat);
        this.eyeMesh.position.y = 1065;
        this.eyeMesh.renderOrder = 1;
        this.group.add(this.eyeMesh);

        // 4. Restrained Cloud-Gap God Rays (6 varied-width shafts piercing real cloud openings, 12% visual weight)
        this.rayMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uRayAlpha: { value: 0 },
                uClimax: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vUv = uv;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uRayAlpha;
                uniform float uClimax;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    if (uRayAlpha <= 0.002) discard;
                    // Strong Fresnel edge feathering completely eliminates flat card / cylinder silhouette!
                    float ndotv = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
                    float edgeSoft = pow(ndotv, 2.25);
                    float vertFade = smoothstep(0.0, 0.44, vUv.y) * smoothstep(1.0, 0.80, vUv.y);
                    // Organic internal light-curtain density variation
                    float wisps = 0.62 + 0.38 * sin(vUv.x * 12.566 + uTime * 0.45) * cos(vUv.y * 5.0 - uTime * 0.32);
                    float breath = 0.86 + 0.14 * sin(uTime * 0.75 + vUv.x * 6.283);

                    vec3 topGold = vec3(1.0, 0.84, 0.48);
                    vec3 botMist = vec3(0.68, 0.72, 0.88);
                    vec3 col = mix(botMist, topGold, smoothstep(0.10, 0.82, vUv.y));
                    float alpha = edgeSoft * vertFade * wisps * breath * (0.21 + 0.06 * uClimax) * uRayAlpha;
                    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.42));
                }
            `,
        });

        const rayGeo = new T.CylinderGeometry(28, 125, 1020, 18, 1, true);
        rayGeo.translate(0, -510, 0);
        // Asymmetric angles & offsets so rays emerge through irregular cloud crevices rather than a uniform cone
        const rayConfigs: readonly { a: number; r: number; tilt: number; w: number; h: number }[] = [
            { a: 0.35, r: 95, tilt: 0.24, w: 0.90, h: 1.05 },
            { a: 1.48, r: 175, tilt: 0.33, w: 1.18, h: 1.12 },
            { a: 2.52, r: 118, tilt: 0.27, w: 0.76, h: 0.96 },
            { a: 3.74, r: 198, tilt: 0.36, w: 1.08, h: 1.08 },
            { a: 4.86, r: 108, tilt: 0.22, w: 0.95, h: 1.02 },
            { a: 5.62, r: 220, tilt: 0.39, w: 0.82, h: 0.94 },
        ];
        for (const rc of rayConfigs) {
            const shaft = new T.Mesh(rayGeo, this.rayMat);
            shaft.position.set(Math.cos(rc.a) * rc.r, 985, Math.sin(rc.a) * rc.r);
            shaft.rotation.order = 'YXZ';
            shaft.rotation.y = rc.a;
            shaft.rotation.x = rc.tilt;
            shaft.scale.set(rc.w, rc.h, rc.w);
            shaft.renderOrder = 3;
            this.rayShafts.push(shaft);
            this.raysGroup.add(shaft);
        }
        this.group.add(this.raysGroup);

        // 5. Phase-4 Dedicated Golden Breakthrough Pillar (distinct dual-shell heaven-to-earth beam over cultivator!)
        const makePillarMat = (isCore: boolean) =>
            new T.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uAlpha: { value: 0 },
                },
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                blending: T.AdditiveBlending,
                fog: false,
                vertexShader: /* glsl */ `
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;
                    void main() {
                        vUv = uv;
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        vNormal = normalize(normalMatrix * normal);
                        vView = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform float uTime;
                    uniform float uAlpha;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;
                    void main() {
                        if (uAlpha <= 0.002) discard;
                        float ndotv = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
                        float edge = pow(ndotv, ${isCore ? '1.65' : '2.45'});
                        // Ascending spiral spiritual currents distinguish breakthrough pillar from ambient sunbeams
                        float spiral = 0.62 + 0.38 * sin(vUv.y * 24.0 - uTime * 4.2 + vUv.x * 18.849);
                        float ribbons = 0.72 + 0.28 * cos(vUv.x * 25.132 - vUv.y * 10.0 - uTime * 2.6);
                        float vFade = smoothstep(0.0, 0.07, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
                        vec3 col = ${
                            isCore
                                ? 'mix(vec3(0.98, 0.78, 0.36), vec3(1.0, 0.94, 0.74), edge * 0.72)'
                                : 'mix(vec3(0.68, 0.62, 0.88), vec3(0.96, 0.76, 0.38), smoothstep(0.08, 0.72, vUv.y))'
                        };
                        float peak = ${isCore ? '0.46' : '0.24'};
                        float alpha = edge * spiral * ribbons * vFade * peak * uAlpha;
                        gl_FragColor = vec4(col, clamp(alpha, 0.0, ${isCore ? '0.68' : '0.40'}));
                    }
                `,
            });

        this.pillarOuterMat = makePillarMat(false);
        this.pillarCoreMat = makePillarMat(true);

        const pillarOuterGeo = new T.CylinderGeometry(20, 36, 1280, 24, 1, true);
        pillarOuterGeo.translate(0, 440, 0); // spans -200m..+1080m so it connects heaven to earth at any elevation!
        this.centerPillarOuter = new T.Mesh(pillarOuterGeo, this.pillarOuterMat);
        this.centerPillarOuter.visible = false;
        this.centerPillarOuter.renderOrder = 9;

        const pillarCoreGeo = new T.CylinderGeometry(7.0, 14.0, 1285, 20, 1, true);
        pillarCoreGeo.translate(0, 442, 0);
        this.centerPillarCore = new T.Mesh(pillarCoreGeo, this.pillarCoreMat);
        this.centerPillarCore.visible = false;
        this.centerPillarCore.renderOrder = 9;
        this.group.add(this.centerPillarOuter, this.centerPillarCore);

        // Phase-4 Expanding Spatial Spirit Shockwave Ring
        this.shockMat = new T.ShaderMaterial({
            uniforms: {
                uStrength: { value: 0 },
                uTime: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv * 2.0 - 1.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uStrength;
                uniform float uTime;
                varying vec2 vUv;
                void main() {
                    if (uStrength <= 0.002) discard;
                    float r = length(vUv);
                    if (r > 1.0 || r < 0.62) discard;
                    float a = atan(vUv.y, vUv.x);
                    float wave = 0.80 + 0.20 * sin(a * 12.0 - uTime * 3.0);
                    float ring = exp(-pow((r - 0.86) / 0.085, 2.0)) * wave;
                    float trail = smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r)) * 0.42;
                    vec3 col = mix(vec3(0.62, 0.72, 0.96), vec3(0.98, 0.80, 0.44), ring);
                    gl_FragColor = vec4(col, clamp((ring * 0.44 + trail * 0.25) * uStrength, 0.0, 0.55));
                }
            `,
        });
        const shockGeo = new T.PlaneGeometry(2, 2);
        shockGeo.rotateX(Math.PI / 2);
        this.shockRing = new T.Mesh(shockGeo, this.shockMat);
        this.shockRing.position.y = 28;
        this.shockRing.visible = false;
        this.shockRing.renderOrder = 9;
        this.group.add(this.shockRing);

        // 6. Subtle Intermittent Aurora Wisps hidden BETWEEN midLayer & seaLayer (zero continuous neon ring!)
        const makeAuroraMat = (speedMul: number, opacity: number, phaseOffset: number) => {
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uAuroraAlpha: { value: 0 },
                    uSpeed: { value: speedMul },
                    uOpacity: { value: opacity },
                    uPhaseOffset: { value: phaseOffset },
                },
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                blending: T.AdditiveBlending,
                fog: false,
                vertexShader: /* glsl */ `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform float uTime;
                    uniform float uAuroraAlpha;
                    uniform float uSpeed;
                    uniform float uOpacity;
                    uniform float uPhaseOffset;
                    varying vec2 vUv;

                    void main() {
                        if (uAuroraAlpha <= 0.002) discard;
                        float x = vUv.x * 6.2831853;
                        float y = vUv.y;

                        // Wide intermittent gap mask: ONLY 2-3 slow drifting wisps visible at once (NEVER a full 360 ring!)
                        float patchA = sin(x * 2.0 + uTime * 0.07 * uSpeed + uPhaseOffset);
                        float patchB = cos(x * 3.0 - uTime * 0.05 * uSpeed + uPhaseOffset * 1.7);
                        float intermittent = smoothstep(0.28, 0.86, patchA * 0.55 + patchB * 0.55);
                        if (intermittent < 0.01) discard;

                        float fold1 = sin(x * 6.0 + uTime * 0.24 * uSpeed + sin(x * 3.0 - uTime * 0.14) * 1.1);
                        float fold2 = sin(x * 15.0 - uTime * 0.38 * uSpeed + y * 2.0);
                        float curtain = smoothstep(-0.1, 0.92, fold1 * 0.65 + fold2 * 0.35);

                        float vMask = smoothstep(0.0, 0.24, y) * pow(1.0 - y, 1.65);
                        // Heavily desaturated Xianxia spirit-jade -> slate-indigo -> muted violet
                        vec3 jadeMist = vec3(0.24, 0.48, 0.52);
                        vec3 slateBlue = vec3(0.26, 0.36, 0.58);
                        vec3 dimViolet = vec3(0.36, 0.28, 0.54);
                        vec3 col = mix(jadeMist, slateBlue, smoothstep(0.12, 0.52, y));
                        col = mix(col, dimViolet, smoothstep(0.42, 0.90, y));

                        float alpha = curtain * intermittent * vMask * uOpacity * uAuroraAlpha;
                        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.26));
                    }
                `,
            });
            this.auroraMats.push(mat);
            return mat;
        };

        this.auroraInner = new T.Mesh(
            createAuroraVeilGeometry(680, 585, 175, 95, 4),
            makeAuroraMat(1.0, 0.18, 0.4),
        );
        this.auroraInner.renderOrder = 5;

        this.auroraOuter = new T.Mesh(
            createAuroraVeilGeometry(1140, 550, 185, 135, 5),
            makeAuroraMat(-0.72, 0.13, 2.3),
        );
        this.auroraOuter.renderOrder = 5;
        this.group.add(this.auroraOuter, this.auroraInner);

        // 7. Dynamic Randomized 3D In-Cloud & Inter-Layer Lightning Bolt Pool (8% visual weight)
        for (let i = 0; i < MAX_LIGHTNING_SLOTS; i++) {
            const positions = new Float32Array(LIGHTNING_MAX_SEGS * 2 * 3);
            const geo = new T.BufferGeometry();
            geo.setAttribute('position', new T.BufferAttribute(positions, 3));
            const mat = new T.LineBasicMaterial({
                color: i % 2 === 0 ? 0xc2d8ff : 0xb49ef5,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: T.AdditiveBlending,
                fog: false,
            });
            const line = new T.LineSegments(geo, mat);
            line.frustumCulled = false;
            line.visible = false;
            line.renderOrder = 7;
            this.group.add(line);
            this.lightningSlots.push({
                line,
                positions,
                mat,
                age: 0,
                duration: 0.28,
                active: false,
                centroid: new T.Vector3(0, 290, 0),
                intensity: 0,
                flickerSeed: i * 1.9 + 0.5,
            });
        }

        // 8. Restrained Converging Spirit Motes (spiraling inward & upward toward the vortex eye, <= 5% weight)
        const motePos = new Float32Array(MAX_SPIRIT_MOTES * 3);
        const moteSeed = new Float32Array(MAX_SPIRIT_MOTES * 4);
        for (let i = 0; i < MAX_SPIRIT_MOTES; i++) {
            const a = ((i * 137.508) % 360) * (Math.PI / 180);
            const rStart = 240 + (((i * 73) % 1000) / 1000) * 860;
            const yStart = 150 + (((i * 41) % 1000) / 1000) * 320;
            // Store polar start in position: (angle, rStart, yStart)
            motePos[i * 3] = a;
            motePos[i * 3 + 1] = rStart;
            motePos[i * 3 + 2] = yStart;
            moteSeed[i * 4] = ((i * 53) % 1000) / 1000; // life phase offset
            moteSeed[i * 4 + 1] = 0.08 + (((i * 29) % 100) / 100) * 0.11; // convergence speed
            moteSeed[i * 4 + 2] = 0.75 + (((i * 19) % 100) / 100) * 0.85; // size
            moteSeed[i * 4 + 3] = i % 3 === 0 ? 1 : 0; // gold vs pale spirit-blue
        }
        const moteGeo = new T.BufferGeometry();
        moteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
        moteGeo.setAttribute('aSeed', new T.BufferAttribute(moteSeed, 4));
        this.spiritMotesMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMoteAlpha: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                attribute vec4 aSeed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vFade;
                varying float vKind;
                void main() {
                    // Life cycle t in [0..1] spirals inward & upward toward the vortex eye!
                    float t = fract(aSeed.x + uTime * aSeed.y);
                    float ease = t * t * (3.0 - 2.0 * t);
                    float a = position.x - t * 1.45;
                    float r = mix(position.y, 65.0 + position.y * 0.14, ease);
                    float y = mix(position.z, 890.0, pow(t, 0.85)) + sin(t * 6.283 + position.x) * 22.0;
                    vec3 p = vec3(cos(a) * r, y, sin(a) * r);

                    vFade = smoothstep(0.0, 0.20, t) * (1.0 - smoothstep(0.70, 1.0, t));
                    vKind = aSeed.w;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp((1350.0 * aSeed.z * uPixelRatio) / max(60.0, -mv.z), 2.0, 11.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uMoteAlpha;
                varying float vFade;
                varying float vKind;
                void main() {
                    if (uMoteAlpha <= 0.002) discard;
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    float d2 = dot(c, c);
                    if (d2 > 1.0) discard;
                    float core = exp(-d2 * 6.5);
                    vec3 col = mix(vec3(0.92, 0.78, 0.46), vec3(0.64, 0.78, 0.96), vKind);
                    float alpha = core * vFade * 0.72 * uMoteAlpha;
                    if (alpha < 0.01) discard;
                    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.82));
                }
            `,
        });
        this.spiritMotes = new T.Points(moteGeo, this.spiritMotesMat);
        this.spiritMotes.frustumCulled = false;
        this.spiritMotes.renderOrder = 9;
        this.group.add(this.spiritMotes);

        this.setQuality(quality);
        scene.add(this.group);
    }

    setQuality(q: Quality) {
        this.quality = q;
        const puffCount = q === 'low' ? 6 : q === 'medium' ? 10 : MAX_CLOUD_PUFFS;
        this.puffMesh.count = puffCount;

        const rayCount = q === 'low' ? 3 : q === 'medium' ? 4 : this.rayShafts.length;
        for (let i = 0; i < this.rayShafts.length; i++) {
            this.rayShafts[i].visible = i < rayCount;
        }

        const moteCount = q === 'low' ? 36 : q === 'medium' ? 68 : MAX_SPIRIT_MOTES;
        this.spiritMotes.geometry.setDrawRange(0, moteCount);
    }

    /** Idempotent lazy loader so storm-cloud textures only load when needed or during idle background prefetch. */
    load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = (async () => {
            const loader = new T.TextureLoader();
            const [coreTex, midTex, seaTex, puffTex] = await Promise.all([
                loader.loadAsync(CORE_TEX_URL),
                loader.loadAsync(MID_TEX_URL),
                loader.loadAsync(SEA_TEX_URL),
                loader.loadAsync(PUFF_TEX_URL),
            ]);
            if (this.disposed) {
                coreTex.dispose();
                midTex.dispose();
                seaTex.dispose();
                puffTex.dispose();
                return;
            }
            for (const tex of [coreTex, midTex, seaTex, puffTex]) {
                tex.colorSpace = T.SRGBColorSpace;
                tex.anisotropy = 4;
                tex.wrapS = T.ClampToEdgeWrapping;
                tex.wrapT = T.ClampToEdgeWrapping;
                this.loadedTextures.push(tex);
            }
            const pairs: readonly [T.ShaderMaterial, T.Texture][] = [
                [this.cloudMats[0], coreTex],
                [this.cloudMats[1], midTex],
                [this.cloudMats[2], seaTex],
            ];
            for (const [mat, tex] of pairs) {
                mat.uniforms.uMap.value = tex;
                mat.uniforms.uHasMap.value = 1;
            }
            this.puffMat.uniforms.uMap.value = puffTex;
            this.puffMat.uniforms.uHasMap.value = 1;
        })();
        return this.loadPromise;
    }

    /**
     * Triggers the 5-phase Celestial Omen centered above `anchor`.
     * - `breakthrough = true`: runs full 5-phase evolution (天地感应 -> 灵气汇聚 -> 天地威压 -> 元婴凝成 -> 天地归寂).
     * - `breakthrough = false`: evolves smoothly through Phases 1 -> 2 -> 3 and holds (or disperses after `durationSeconds`).
     */
    trigger(anchor: T.Vector3, durationSeconds = 0, breakthrough = false) {
        this.group.position.set(anchor.x, Math.max(0, anchor.y - 350), anchor.z);
        this.mode = breakthrough ? 'breakthrough' : 'sustain';
        this.phaseElapsed = 0;
        this.disperseElapsed = 0;
        this.timedHoldRemaining = breakthrough ? 0 : durationSeconds;
        this._phase = 1;
        this.group.visible = true;
    }

    /** Triggers Phase 5 (天地归寂) graceful dispersal from current state. */
    stop() {
        if (this.mode === 'idle' || this.mode === 'dispersing') return;
        this.captureDisperseSnapshot();
        this.mode = 'dispersing';
        this.disperseElapsed = 0;
        this._phase = 5;
    }

    toggle(anchor: T.Vector3): boolean {
        if (this.active) {
            this.stop();
            return false;
        }
        this.trigger(anchor, 0, false);
        return true;
    }

    /** DEV helper: jump cleanly into any of the 5 phases for visual verification. */
    setPhaseForDev(phase: 1 | 2 | 3 | 4 | 5, anchor: T.Vector3) {
        this.group.position.set(anchor.x, Math.max(0, anchor.y - 350), anchor.z);
        this.group.visible = true;
        if (phase === 5) {
            this.mode = 'breakthrough';
            this.phaseElapsed = T_P4_END + 1.8;
        } else if (phase === 4) {
            this.mode = 'breakthrough';
            this.phaseElapsed = T_P3_END + 1.85;
        } else {
            this.mode = 'sustain';
            this.timedHoldRemaining = 0;
            this.phaseElapsed = phase === 1 ? 1.9 : phase === 2 ? 5.4 : T_P2_END + 2.5;
        }
        this._phase = phase;
        this.time = Math.max(this.time, 8.0);
        this.spinClock = this.time * 0.85;
        // Fire one localized in-cloud bolt in Phase 3/4 so lightning illumination can be inspected
        if (phase === 3 || phase === 4) {
            this.spawnLightningBolt(phase === 4);
        }
    }

    /** DEV helper: jump directly to an exact timestamp (0..22.5s) in the breakthrough timeline. */
    setBreakthroughTimeForDev(seconds: number, anchor: T.Vector3) {
        this.group.position.set(anchor.x, Math.max(0, anchor.y - 350), anchor.z);
        this.group.visible = true;
        this.mode = 'breakthrough';
        this.phaseElapsed = T.MathUtils.clamp(seconds, 0.05, T_P5_END - 0.5);
        this.time = Math.max(this.time, 8.0 + seconds);
        this.spinClock = this.time * 0.85;
        this._phase = seconds < T_P1_END ? 1 : seconds < T_P2_END ? 2 : seconds < T_P3_END ? 3 : seconds < T_P4_END ? 4 : 5;
        if (this._phase === 3 || this._phase === 4) {
            this.spawnLightningBolt(this._phase === 4);
        }
    }

    private captureDisperseSnapshot() {
        this.disperseStartWeights = {
            atmo: this._atmoWeight,
            sea: this.cloudMats[2].uniforms.uLayerAlpha.value as number,
            mid: this.cloudMats[1].uniforms.uLayerAlpha.value as number,
            core: this.cloudMats[0].uniforms.uLayerAlpha.value as number,
            eye: this.eyeMat.uniforms.uEyeAlpha.value as number,
            rays: this.rayMat.uniforms.uRayAlpha.value as number,
            aurora: this.auroraMats[0].uniforms.uAuroraAlpha.value as number,
            motes: this.spiritMotesMat.uniforms.uMoteAlpha.value as number,
            wind: this._windStrength,
            gold: this._goldWeight,
        };
    }

    private spawnLightningBolt(nearCore = false) {
        const activeCap = this.quality === 'low' ? 2 : this.quality === 'medium' ? 3 : MAX_LIGHTNING_SLOTS;
        let slot: LightningSlot | undefined;
        for (let i = 0; i < activeCap; i++) {
            if (!this.lightningSlots[i].active) {
                slot = this.lightningSlots[i];
                break;
            }
        }
        if (!slot) slot = this.lightningSlots[0];

        slot.active = true;
        slot.age = 0;
        slot.duration = 0.20 + Math.random() * 0.24;
        slot.flickerSeed = Math.random() * 6.283;

        // Mostly intra-cloud & inter-layer lightning arcs high inside the 580m..950m storm decks!
        const interLayer = Math.random() < 0.36;
        const a0 = Math.random() * Math.PI * 2;
        const r0 = nearCore ? 175 + Math.random() * 290 : 240 + Math.random() * 540;
        const y0 = interLayer ? 760 + Math.random() * 165 : 650 + Math.random() * 200;

        const a1 = a0 + (Math.random() > 0.5 ? 1 : -1) * (0.28 + Math.random() * 0.72);
        const r1 = T.MathUtils.clamp(r0 + (Math.random() - 0.32) * 480, 180, 1320);
        const y1 = interLayer ? 540 + Math.random() * 110 : y0 + (Math.random() - 0.5) * 95;

        const p0 = this.tmpBoltP0.set(Math.cos(a0) * r0, y0, Math.sin(a0) * r0);
        const p1 = this.tmpBoltP1.set(Math.cos(a1) * r1, y1, Math.sin(a1) * r1);
        slot.centroid.copy(p0).lerp(p1, 0.5);

        const mainSegs = 12 + Math.floor(Math.random() * 5);
        const forkCount = 1 + Math.floor(Math.random() * 3); // 1..3 randomized branches
        let cursor = 0;

        const writeSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
            if (cursor >= LIGHTNING_MAX_SEGS) return;
            const o = cursor * 6;
            slot!.positions[o] = ax;
            slot!.positions[o + 1] = ay;
            slot!.positions[o + 2] = az;
            slot!.positions[o + 3] = bx;
            slot!.positions[o + 4] = by;
            slot!.positions[o + 5] = bz;
            cursor++;
        };

        this.tmpBoltMainPts[0].copy(p0);
        const prev = this.tmpBoltPrev.copy(p0);
        const cur = this.tmpBoltCur;
        for (let i = 1; i <= mainSegs; i++) {
            const t = i / mainSegs;
            cur.copy(p0).lerp(p1, t);
            if (i < mainSegs) {
                const jag = Math.sin(t * Math.PI) * 36;
                cur.x += (Math.random() - 0.5) * jag;
                cur.y += (Math.random() - 0.5) * jag * 0.65;
                cur.z += (Math.random() - 0.5) * jag;
            }
            writeSeg(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
            this.tmpBoltMainPts[i].copy(cur);
            prev.copy(cur);
        }

        const forkEnd = this.tmpBoltFork;
        for (let f = 0; f < forkCount; f++) {
            const idx = Math.min(mainSegs - 1, 2 + Math.floor(Math.random() * (mainSegs - 2)));
            const origin = this.tmpBoltMainPts[idx];
            forkEnd.set(
                origin.x + (Math.random() - 0.5) * 180,
                origin.y - 35 - Math.random() * 75,
                origin.z + (Math.random() - 0.5) * 180,
            );
            const bSegs = 4 + Math.floor(Math.random() * 3);
            prev.copy(origin);
            for (let i = 1; i <= bSegs; i++) {
                const t = i / bSegs;
                cur.copy(origin).lerp(forkEnd, t);
                if (i < bSegs) {
                    cur.x += (Math.random() - 0.5) * 20;
                    cur.y += (Math.random() - 0.5) * 14;
                    cur.z += (Math.random() - 0.5) * 20;
                }
                writeSeg(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
                prev.copy(cur);
            }
        }

        for (let i = cursor * 6; i < slot.positions.length; i++) slot.positions[i] = 0;
        (slot.line.geometry.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
        slot.line.geometry.setDrawRange(0, cursor * 2);
        slot.line.visible = true;
        // Realistic desaturated electric blue-white / muted storm violet
        slot.mat.color.setHex(Math.random() < 0.62 ? 0xc4dcff : 0xb29cf0);
        // Restrained momentary valley/sky flash bounce
        this._flash = Math.min(0.85, this._flash + 0.38 + Math.random() * 0.24);
    }

    private syncLayerRenderOrder(cameraY: number) {
        const high = cameraY > this.group.position.y + 760;
        if (high === this.highCamOrder) return;
        this.highCamOrder = high;
        if (high) {
            // Viewed from above: lower sea layer is farthest, core layer is closest
            this.seaLayer.renderOrder = 2;
            this.auroraOuter.renderOrder = 3;
            this.auroraInner.renderOrder = 3;
            this.midLayer.renderOrder = 4;
            this.puffMesh.renderOrder = 5;
            this.raysGroup.children.forEach(c => { c.renderOrder = 5; });
            this.coreLayer.renderOrder = 6;
            this.eyeMesh.renderOrder = 7;
        } else {
            // Viewed from valley / mid-air looking up: eye & core farthest, aurora hidden between mid & sea, sea closest
            this.eyeMesh.renderOrder = 1;
            this.coreLayer.renderOrder = 2;
            this.raysGroup.children.forEach(c => { c.renderOrder = 3; });
            this.midLayer.renderOrder = 4;
            this.auroraOuter.renderOrder = 5;
            this.auroraInner.renderOrder = 5;
            this.puffMesh.renderOrder = 6;
            this.seaLayer.renderOrder = 8;
        }
    }

    update(dt: number, anchorFollow: T.Vector3, pixelRatio: number, cameraY = 0) {
        if (this.mode === 'idle') {
            this.group.visible = false;
            return;
        }
        this.time += dt;
        this.group.visible = true;

        // Compute continuous per-channel 5-phase evolution curves
        let atmoW = 0;
        let seaA = 0, seaCov = 0;
        let midA = 0, midCov = 0;
        let coreA = 0, coreCov = 0;
        let puffA = 0;
        let eyeA = 0;
        let rayA = 0;
        let auroraA = 0;
        let moteA = 0;
        let pillarA = 0;
        let climaxW = 0;
        let windW = 0;
        let goldW = 0;
        let spinRate = 0.35;
        let lightningChance = 0;

        if (this.mode === 'sustain' || this.mode === 'breakthrough') {
            this.phaseElapsed += dt;
            if (this.mode === 'sustain') {
                // Smoothly evolve Phase 1 -> 2 -> 3 and hold in Phase 3
                if (this.phaseElapsed > T_P2_END + 3.0) {
                    this.phaseElapsed = T_P2_END + 3.0;
                }
                if (this.timedHoldRemaining > 0) {
                    this.timedHoldRemaining -= dt;
                    if (this.timedHoldRemaining <= 0) {
                        this.stop();
                    }
                }
            }

            const t = this.phaseElapsed;
            if (t < T_P1_END) {
                this._phase = 1;
            } else if (t < T_P2_END) {
                this._phase = 2;
            } else if (this.mode === 'sustain' || t < T_P3_END) {
                this._phase = 3;
            } else if (t < T_P4_END) {
                this._phase = 4;
            } else if (t < T_P5_END) {
                this._phase = 5;
            } else {
                this.resetToIdle();
                return;
            }

            // Phase 1..3 build-up curves (staggered so NOTHING switches on simultaneously!)
            const p1 = smooth01(0.0, T_P1_END, t);
            const p2 = smooth01(T_P1_END - 0.5, T_P2_END, t);
            const p3 = smooth01(T_P2_END - 0.6, T_P2_END + 2.6, t);

            // Phase 4 (元婴凝成) breakthrough climax & shockwave
            const p4In = this.mode === 'breakthrough' ? smooth01(T_P3_END, T_P3_END + 1.1, t) : 0;
            const p4Out = this.mode === 'breakthrough' ? smooth01(T_P4_END - 1.5, T_P4_END + 0.4, t) : 0;
            const p4Env = p4In * (1 - p4Out);

            // Phase 5 (天地归寂) graceful dispersal during breakthrough timeline
            const d5 = this.mode === 'breakthrough' ? smooth01(T_P4_END, T_P5_END, t) : 0;
            const keepClouds = 1 - d5;
            const keepFast = 1 - smooth01(T_P4_END - 0.4, T_P4_END + 2.0, t);
            const keepMotes = 1 - smooth01(T_P4_END + 1.4, T_P5_END, t);

            atmoW = (p1 * 0.42 + p2 * 0.34 + p3 * 0.24) * keepClouds;
            windW = (p1 * 0.48 + p2 * 0.32 + p3 * 0.20 + p4Env * 0.22) * keepClouds;

            // Cloud layers condense sequentially: Sea first -> Mid -> Core
            seaA = (p1 * 0.58 + p2 * 0.32 + p3 * 0.10) * keepClouds;
            seaCov = (p1 * 0.50 + p2 * 0.36 + p3 * 0.14) * (1 - smooth01(T_P4_END + 0.5, T_P5_END, t));

            midA = (smooth01(1.4, T_P2_END, t) * 0.86 + p3 * 0.14) * keepClouds;
            midCov = (smooth01(1.2, T_P2_END + 0.4, t) * 0.85 + p3 * 0.15) * (1 - smooth01(T_P4_END + 0.2, T_P5_END - 0.3, t));

            coreA = (smooth01(3.0, T_P2_END + 0.8, t) * 0.84 + p3 * 0.16) * keepClouds;
            coreCov = (smooth01(2.8, T_P2_END + 1.0, t) * 0.85 + p3 * 0.15) * (1 - smooth01(T_P4_END, T_P5_END - 0.6, t));

            puffA = smooth01(3.2, T_P2_END + 1.2, t) * keepClouds;
            eyeA = (smooth01(4.2, T_P2_END + 1.8, t) * 0.80 + p3 * 0.20) * keepFast;
            goldW = (smooth01(5.4, T_P2_END + 2.2, t) * 0.78 + p4Env * 0.35) * keepFast;
            rayA = smooth01(T_P2_END - 0.2, T_P2_END + 2.4, t) * keepFast;
            auroraA = smooth01(3.4, T_P2_END + 0.8, t) * (1 - smooth01(T_P4_END, T_P4_END + 2.6, t));
            moteA = smooth01(2.6, T_P2_END - 0.4, t) * keepMotes;

            pillarA = p4Env;
            climaxW = p4Env;
            spinRate = (0.35 + p2 * 0.65 + p4Env * 0.30) * (1 - d5 * 0.72);
            lightningChance = (p2 * 0.40 + p3 * 0.60 + p4Env * 0.75) * keepFast;

            // Spatial Spirit Shockwave during Phase 4 (expands 15m -> 880m over ~3.4s)
            if (this.mode === 'breakthrough' && t >= T_P3_END + 0.35 && t <= T_P4_END + 0.3) {
                const st = T.MathUtils.clamp((t - (T_P3_END + 0.35)) / 3.4, 0, 1);
                const easeOut = 1 - Math.pow(1 - st, 2.1);
                this._shock.x = this.group.position.x;
                this._shock.z = this.group.position.z;
                this._shock.radius = 18 + easeOut * 880;
                this._shock.strength = Math.sin(st * Math.PI) * (1 - st * 0.35);
            } else {
                this._shock.radius = 0;
                this._shock.strength = 0;
            }
        } else if (this.mode === 'dispersing') {
            this._phase = 5;
            this.disperseElapsed += dt;
            const totalDisperse = 5.2;
            if (this.disperseElapsed >= totalDisperse) {
                this.resetToIdle();
                return;
            }
            const s = this.disperseStartWeights;
            const keepFast = 1 - smooth01(0.0, 1.8, this.disperseElapsed);
            const keepCore = 1 - smooth01(0.2, 3.8, this.disperseElapsed);
            const keepMid = 1 - smooth01(0.4, 4.4, this.disperseElapsed);
            const keepSea = 1 - smooth01(0.6, 5.0, this.disperseElapsed);
            const keepMotes = 1 - smooth01(1.2, 5.2, this.disperseElapsed);

            atmoW = s.atmo * keepSea;
            windW = s.wind * keepMid;
            seaA = s.sea * keepSea;
            seaCov = keepSea;
            midA = s.mid * keepMid;
            midCov = keepMid;
            coreA = s.core * keepCore;
            coreCov = keepCore;
            puffA = s.mid * keepCore;
            eyeA = s.eye * keepFast;
            rayA = s.rays * keepFast;
            auroraA = s.aurora * keepFast;
            goldW = s.gold * keepFast;
            moteA = s.motes * keepMotes;
            pillarA = 0;
            climaxW = 0;
            spinRate = 0.25 + 0.75 * keepMid;
            lightningChance = 0;
            this._shock.strength = 0;
        }

        // Keep the celestial canopy anchored high in the heavens: fixed at world altitude 540m..1065m for
        // valley/mountain/normal flight, and smoothly rising if the cultivator climbs above 350m so they never clip into the sky mesh!
        if (this.mode === 'sustain' || this.mode === 'breakthrough') {
            const followRate = this._phase === 4 ? 1.6 : 0.30;
            this.group.position.x = T.MathUtils.damp(this.group.position.x, anchorFollow.x, followRate, dt);
            this.group.position.z = T.MathUtils.damp(this.group.position.z, anchorFollow.z, followRate, dt);
            const targetBaseY = Math.max(0, anchorFollow.y - 350);
            this.group.position.y = T.MathUtils.damp(this.group.position.y, targetBaseY, 1.2, dt);
        }
        // Keep the Phase-4 horizontal shockwave ring near the cultivator's altitude
        this.shockRing.position.y = Math.max(18, anchorFollow.y - this.group.position.y + 18);

        this.syncLayerRenderOrder(cameraY);

        // Update live output telemetry for atmosphere / foliage / water
        this._atmoWeight = T.MathUtils.clamp(atmoW, 0, 1);
        this._goldWeight = T.MathUtils.clamp(goldW, 0, 1);
        this._windStrength = T.MathUtils.clamp(windW, 0, 1);
        this._climax = T.MathUtils.clamp(climaxW, 0, 1);
        this._intensity = T.MathUtils.clamp(Math.max(seaA, midA, atmoW), 0, 1);

        // Decay lightning flash & fire randomized in-cloud bolts
        this._flash = Math.max(0, this._flash - dt * 4.4);
        if (lightningChance > 0.15) {
            this.nextLightningAt -= dt;
            if (this.nextLightningAt <= 0) {
                const baseDelay = this._phase === 4 ? 0.38 : this._phase === 2 ? 1.65 : 0.85;
                const spread = this._phase === 4 ? 0.55 : this._phase === 2 ? 2.1 : 1.75;
                this.nextLightningAt = baseDelay + Math.random() * spread;
                this.spawnLightningBolt(this._phase === 4);
            }
        }

        // Update active bolts & pick top 2 for localized in-cloud scatter illumination
        let topA: LightningSlot | null = null;
        let topB: LightningSlot | null = null;
        for (const s of this.lightningSlots) {
            if (!s.active) {
                s.intensity = 0;
                continue;
            }
            s.age += dt;
            if (s.age >= s.duration) {
                s.active = false;
                s.line.visible = false;
                s.intensity = 0;
                continue;
            }
            const p = s.age / s.duration;
            // Randomized double-pulse lightning envelope (never uniform)
            const split = 0.24 + 0.08 * Math.sin(s.flickerSeed);
            const flicker = p < split ? 1.0 : p < split + 0.14 ? 0.25 : p < 0.62 ? 0.88 : (1 - p) / 0.38;
            s.intensity = T.MathUtils.clamp(flicker * Math.max(0.4, midA), 0, 1);
            s.mat.opacity = s.intensity * 0.92;
            if (!topA || s.intensity > topA.intensity) {
                topB = topA;
                topA = s;
            } else if (!topB || s.intensity > topB.intensity) {
                topB = s;
            }
        }
        if (topA) {
            this.boltA.set(topA.centroid.x, topA.centroid.y, topA.centroid.z, topA.intensity);
        } else {
            this.boltA.w = Math.max(0, this.boltA.w - dt * 6.0);
        }
        if (topB) {
            this.boltB.set(topB.centroid.x, topB.centroid.y, topB.centroid.z, topB.intensity);
        } else {
            this.boltB.w = Math.max(0, this.boltB.w - dt * 6.0);
        }

        // Differential angular spin decelerates smoothly during Phase 5 dispersal
        this.spinClock += dt * spinRate;
        this.coreLayer.rotation.y = -this.spinClock * 0.095;
        this.midLayer.rotation.y = -this.spinClock * 0.048;
        this.seaLayer.rotation.y = -this.spinClock * 0.020;
        this.raysGroup.rotation.y = -this.spinClock * 0.018;
        this.auroraInner.rotation.y = this.spinClock * 0.012;
        this.auroraOuter.rotation.y = -this.spinClock * 0.009;

        // Update 3D volumetric cloud-puff instances (gentle differential orbit + vertical breath)
        if (puffA > 0.005) {
            this.puffMesh.visible = true;
            const count = this.puffMesh.count;
            for (let i = 0; i < count; i++) {
                const sp = this.puffSpecs[i];
                const a = sp.angle + this.spinClock * sp.speed;
                const y = sp.y + Math.sin(this.time * 0.35 + sp.seed) * 6.5;
                this.puffDummy.position.set(Math.cos(a) * sp.radius, y, Math.sin(a) * sp.radius);
                this.puffDummy.rotation.set(0, 0, sp.tilt);
                // Wide horizontal cloud-bank shelf aspect (never round dark floating meatballs!)
                this.puffDummy.scale.set(sp.size * 2.35, sp.size * 0.58, 1);
                this.puffDummy.updateMatrix();
                this.puffMesh.setMatrixAt(i, this.puffDummy.matrix);
            }
            this.puffMesh.instanceMatrix.needsUpdate = true;
        } else {
            this.puffMesh.visible = false;
        }

        // Push uniforms to all 3 cloud funnel layers
        const layerData: readonly [number, number][] = [
            [coreA, coreCov],
            [midA, midCov],
            [seaA, seaCov],
        ];
        for (let i = 0; i < 3; i++) {
            const mat = this.cloudMats[i];
            mat.uniforms.uTime.value = this.time;
            mat.uniforms.uLayerAlpha.value = layerData[i][0];
            mat.uniforms.uCoverage.value = layerData[i][1];
            mat.uniforms.uGoldWeight.value = this._goldWeight;
            mat.uniforms.uClimax.value = this._climax;
            (mat.uniforms.uShock.value as T.Vector3).set(this._shock.radius, this._shock.strength, 0);
        }

        this.puffMat.uniforms.uAlpha.value = puffA;
        this.puffMat.uniforms.uGoldWeight.value = this._goldWeight;
        this.puffMat.uniforms.uClimax.value = this._climax;

        this.eyeMat.uniforms.uTime.value = this.time;
        this.eyeMat.uniforms.uEyeAlpha.value = eyeA;
        this.eyeMat.uniforms.uClimax.value = this._climax;
        this.eyeMat.uniforms.uFlash.value = this._flash;

        this.rayMat.uniforms.uTime.value = this.time;
        this.rayMat.uniforms.uRayAlpha.value = rayA;
        this.rayMat.uniforms.uClimax.value = this._climax;
        this.raysGroup.visible = rayA > 0.005;

        const pillarVis = pillarA > 0.005;
        this.centerPillarOuter.visible = pillarVis;
        this.centerPillarCore.visible = pillarVis;
        if (pillarVis) {
            this.pillarOuterMat.uniforms.uTime.value = this.time;
            this.pillarOuterMat.uniforms.uAlpha.value = pillarA;
            this.pillarCoreMat.uniforms.uTime.value = this.time;
            this.pillarCoreMat.uniforms.uAlpha.value = pillarA;
        }

        const shockVis = this._shock.strength > 0.005;
        this.shockRing.visible = shockVis;
        if (shockVis) {
            const s = Math.max(12, this._shock.radius);
            this.shockRing.scale.set(s, 1, s);
            this.shockMat.uniforms.uStrength.value = this._shock.strength;
            this.shockMat.uniforms.uTime.value = this.time;
        }

        const auroraVis = auroraA > 0.005;
        this.auroraInner.visible = auroraVis;
        this.auroraOuter.visible = auroraVis;
        if (auroraVis) {
            for (const mat of this.auroraMats) {
                mat.uniforms.uTime.value = this.time;
                mat.uniforms.uAuroraAlpha.value = auroraA;
            }
        }

        this.spiritMotes.visible = moteA > 0.005;
        if (this.spiritMotes.visible) {
            this.spiritMotesMat.uniforms.uTime.value = this.time;
            this.spiritMotesMat.uniforms.uMoteAlpha.value = moteA;
            this.spiritMotesMat.uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    private resetToIdle() {
        this.mode = 'idle';
        this._phase = 0;
        this.phaseElapsed = 0;
        this.disperseElapsed = 0;
        this._intensity = 0;
        this._atmoWeight = 0;
        this._goldWeight = 0;
        this._windStrength = 0;
        this._flash = 0;
        this._climax = 0;
        this._shock.radius = 0;
        this._shock.strength = 0;
        this.boltA.w = 0;
        this.boltB.w = 0;
        for (const s of this.lightningSlots) {
            s.active = false;
            s.line.visible = false;
            s.intensity = 0;
        }
        this.group.visible = false;
    }

    dispose() {
        this.disposed = true;
        this.group.removeFromParent();
        const disposedGeos = new Set<T.BufferGeometry>();
        const disposedMats = new Set<T.Material>();
        this.group.traverse(obj => {
            if (obj instanceof T.Mesh || obj instanceof T.LineSegments || obj instanceof T.Points) {
                if (!disposedGeos.has(obj.geometry)) {
                    disposedGeos.add(obj.geometry);
                    obj.geometry.dispose();
                }
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                for (const m of mats) {
                    if (!disposedMats.has(m)) {
                        disposedMats.add(m);
                        m.dispose();
                    }
                }
            }
        });
        for (const tex of this.loadedTextures) tex.dispose();
        this.dummyTex.dispose();
    }
}
