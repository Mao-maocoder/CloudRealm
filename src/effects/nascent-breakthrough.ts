import * as T from 'three';
import type { Quality } from '../config/settings';
import type { SpellLightPool } from './spell-lights';

export interface CinematicCameraPose {
    position: T.Vector3;
    target: T.Vector3;
    fov: number;
}

export interface RitualTitleState {
    visible: boolean;
    title: string;
    subtitle: string;
    alpha: number;
}

export type RitualAvatarPose = 'none' | 'meditate' | 'burst';

// Synchronized 1:1 with CelestialOmen's 5-phase timeline (seconds)
const T_P1_END = 3.2;
const T_P2_END = 7.2;
const T_P3_END = 12.6;
const T_P4_END = 17.6;
const T_P5_END = 23.0;

const STRIKE_1_TIME = 8.65;
const STRIKE_2_TIME = 10.45;
const STRIKE_DUR = 0.42;

const SHARD_COUNT = 180;
const MOTE_COUNT = 140;
const BOLT_SEGS = 24;

function smooth01(a: number, b: number, x: number): number {
    if (b <= a) return x >= b ? 1 : 0;
    const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

/** Builds a sculpted, subtly cupped stylized lotus petal mesh extending along +Z and curving upward along +Y. */
function createLotusPetalGeometry(length = 1.45, width = 0.62): T.BufferGeometry {
    const segU = 6;
    const segV = 10;
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let iv = 0; iv <= segV; iv++) {
        const v = iv / segV; // 0 = base, 1 = tip
        // Classic tapered lotus silhouette
        const w = Math.sin(Math.pow(v, 0.72) * Math.PI) * width * 0.5;
        const z = v * length;
        const yCurve = Math.pow(v, 1.85) * 0.56 - Math.sin(v * Math.PI) * 0.08;
        for (let iu = 0; iu <= segU; iu++) {
            const u = iu / segU; // 0..1 across width
            const sx = (u - 0.5) * 2.0; // -1..1
            const x = sx * w;
            // Subtle upward cupping toward petal edges
            const cup = (sx * sx) * 0.14 * Math.sin(v * Math.PI);
            verts.push(x, yCurve + cup, z);
            uvs.push(u, v);
        }
    }

    const stride = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
        for (let iu = 0; iu < segU; iu++) {
            const a = iv * stride + iu;
            const b = a + 1;
            const c = (iv + 1) * stride + iu + 1;
            const d = (iv + 1) * stride + iu;
            indices.push(a, b, c, a, c, d);
        }
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

/** Builds a graceful 3D inward-spiraling qi ribbon sweeping from outer valley air toward the cultivator. */
function createQiRibbonGeometry(
    startRadius: number,
    endRadius: number,
    startY: number,
    endY: number,
    turns: number,
    angleOffset: number,
    ribbonWidth = 0.24,
    segs = 64,
): T.BufferGeometry {
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const a = angleOffset + t * Math.PI * 2 * turns;
        const r = T.MathUtils.lerp(startRadius, endRadius, Math.pow(t, 0.85));
        const y = T.MathUtils.lerp(startY, endY, t) + Math.sin(t * Math.PI * 3 + angleOffset) * 0.45 * (1 - t);
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        const halfW = ribbonWidth * Math.sin(t * Math.PI) * 0.5 + 0.02;
        verts.push(cx, y - halfW, cz);
        uvs.push(t, 0);
        verts.push(cx, y + halfW, cz);
        uvs.push(t, 1);
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

/**
 * 《云境》元婴破境大典 · 写意道韵版 (Nascent Soul Breakthrough Cinematic & VFX):
 * Synchronized 1:1 with CelestialOmen's 5-phase 23s evolution:
 * - Phase 1 (天地感应): Levitating lotus meditation + unfolding dual-ring Daoist spirit formation
 * - Phase 2 (灵气倒灌): Spiraling cyan-gold qi ribbons & inward spirit motes feeding the dantian
 * - Phase 3 (碎丹渡劫): Revolving Golden Core manifests, 2 tribulation lightning bolts test the
 *   protective barrier dome, golden fracture veins spread across the core -> SHATTER!
 * - Phase 4 (道轮凝婴): Stylized translucent Lotus Base + counter-rotating Golden Dao Wheel behind
 *   the shoulders + radiant spirit cocoon synced with CelestialOmen's 1280m Golden Pillar & shockwave
 * - Phase 5 (天地归寂): Dao radiance folds inward, cultivator settles into Nascent void hover.
 */
export class NascentBreakthrough {
    readonly group = new T.Group();
    private readonly formationOuter: T.Mesh;
    private readonly formationInner: T.Mesh;
    private readonly formationOuterMat: T.ShaderMaterial;
    private readonly formationInnerMat: T.ShaderMaterial;

    private readonly qiRibbonsGroup = new T.Group();
    private readonly qiRibbonMat: T.ShaderMaterial;
    private readonly inwardMotes: T.Points;
    private readonly inwardMotesMat: T.ShaderMaterial;

    private readonly coreGroup = new T.Group();
    private readonly goldenCore: T.Mesh;
    private readonly goldenCoreMat: T.ShaderMaterial;
    private readonly coreHaloRing: T.Mesh;
    private readonly coreHaloMat: T.ShaderMaterial;
    private readonly coreShards: T.Points;
    private readonly coreShardsMat: T.ShaderMaterial;

    private readonly barrierDome: T.Mesh;
    private readonly barrierMat: T.ShaderMaterial;
    private readonly tribulationBolt: T.LineSegments;
    private readonly tribulationPositions: Float32Array;
    private readonly tribulationMat: T.LineBasicMaterial;

    private readonly lotusGroup = new T.Group();
    private readonly lotusMat: T.ShaderMaterial;
    private readonly daoWheelGroup = new T.Group();
    private readonly daoWheelOuter: T.Mesh;
    private readonly daoWheelInner: T.Mesh;
    private readonly daoWheelOuterMat: T.ShaderMaterial;
    private readonly daoWheelInnerMat: T.ShaderMaterial;
    private readonly spiritCocoon: T.Mesh;
    private readonly cocoonMat: T.ShaderMaterial;
    private readonly heavenBeam: T.Mesh;
    private readonly heavenBeamMat: T.ShaderMaterial;

    private _active = false;
    private elapsed = 0;
    private baseAnchor = new T.Vector3();
    private baseHeading = 0;
    private playerHoverPos = new T.Vector3();
    private strike1Fired = false;
    private strike2Fired = false;
    private barrierHitImpact = 0;
    private shakeAmount = 0;
    private lightFlash = 0;
    private onCompleteCb?: () => void;

    private readonly camPose: CinematicCameraPose = {
        position: new T.Vector3(),
        target: new T.Vector3(),
        fov: 62,
    };
    private readonly titleState: RitualTitleState = {
        visible: false,
        title: '',
        subtitle: '',
        alpha: 0,
    };
    private readonly lightPos = new T.Vector3();

    get active(): boolean {
        return this._active;
    }

    get avatarPose(): RitualAvatarPose {
        if (!this._active) return 'none';
        return this.elapsed < T_P3_END - 0.15 ? 'meditate' : 'burst';
    }

    get currentAnchor(): T.Vector3 {
        return this.playerHoverPos;
    }

    get cameraPose(): CinematicCameraPose | undefined {
        return this._active ? this.camPose : undefined;
    }

    get title(): Readonly<RitualTitleState> {
        return this.titleState;
    }

    get warmObjects(): readonly T.Object3D[] {
        return [
            this.formationOuter,
            this.formationInner,
            this.qiRibbonsGroup,
            this.inwardMotes,
            this.coreGroup,
            this.coreShards,
            this.barrierDome,
            this.lotusGroup,
            this.daoWheelGroup,
            this.spiritCocoon,
            this.heavenBeam,
        ];
    }

    constructor(scene: T.Scene) {
        this.group.name = 'Nascent Breakthrough Ceremony';
        this.group.visible = false;

        // 1. Dual-Layer Daoist Spirit-Gathering Formation (聚灵法阵)
        const makeFormationMat = (isOuter: boolean) =>
            new T.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uAlpha: { value: 0 },
                    uBurst: { value: 0 },
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
                    uniform float uTime;
                    uniform float uAlpha;
                    uniform float uBurst;
                    varying vec2 vUv;

                    float ringLine(float r, float center, float w) {
                        return exp(-pow((r - center) / w, 2.0));
                    }

                    void main() {
                        if (uAlpha <= 0.002) discard;
                        float r = length(vUv);
                        if (r > 1.0) discard;
                        float a = atan(vUv.y, vUv.x);

                        // Crisp concentric Daoist seal rings
                        float outerRim = ringLine(r, 0.90, 0.018) + ringLine(r, 0.83, 0.008);
                        float midRim = ringLine(r, 0.58, 0.014) + ringLine(r, 0.34, 0.010);

                        // Eight-trigram (八卦) / celestial rune ticks between outer rings
                        float sector = fract((a / 6.2831853) * 8.0);
                        float trigramMask = smoothstep(0.08, 0.14, sector) * (1.0 - smoothstep(0.86, 0.92, sector));
                        float bar1 = ringLine(r, 0.76, 0.009) * trigramMask;
                        float bar2 = ringLine(r, 0.71, 0.009) * trigramMask * step(0.18, abs(sector - 0.5));
                        float bar3 = ringLine(r, 0.66, 0.009) * trigramMask;

                        // Geometric octagram star inscribed inside mid ring
                        float ca4 = abs(cos(a * 4.0));
                        float sa4 = abs(sin(a * 4.0));
                        float polyA = r * (0.72 + 0.28 * ca4);
                        float polyB = r * (0.72 + 0.28 * sa4);
                        float octagram = (ringLine(polyA, 0.48, 0.012) + ringLine(polyB, 0.48, 0.012)) * smoothstep(0.24, 0.32, r);

                        // Subtle radial cloud-wave spokes
                        float spokes = pow(0.5 + 0.5 * cos(a * ${isOuter ? '16.0' : '8.0'}), 10.0) * smoothstep(0.32, 0.60, r) * (1.0 - smoothstep(0.82, 0.92, r)) * 0.45;
                        float softGlow = exp(-r * r * 3.2) * 0.22 + ringLine(r, 0.88, 0.07) * 0.22;

                        float pattern = outerRim + midRim + (bar1 + bar2 + bar3) * 0.85 + octagram * 0.65 + spokes + softGlow;
                        float pulse = 0.88 + 0.12 * sin(uTime * 2.4 - r * 5.0);

                        vec3 jade = vec3(0.42, 0.84, 0.78);
                        vec3 gold = vec3(1.0, 0.82, 0.42);
                        vec3 col = mix(jade, gold, clamp(${isOuter ? '0.45' : '0.78'} + uBurst * 0.45, 0.0, 1.0));
                        col = mix(col, vec3(1.0, 0.95, 0.80), clamp(outerRim * 0.55 + uBurst * 0.25, 0.0, 1.0));

                        float edgeFade = 1.0 - smoothstep(0.92, 1.0, r);
                        float alpha = clamp(pattern * pulse * edgeFade * ${isOuter ? '0.62' : '0.74'} * uAlpha, 0.0, 0.85);
                        if (alpha < 0.008) discard;
                        gl_FragColor = vec4(col, alpha);
                    }
                `,
            });

        this.formationOuterMat = makeFormationMat(true);
        this.formationInnerMat = makeFormationMat(false);

        const outerGeo = new T.PlaneGeometry(17.5, 17.5);
        outerGeo.rotateX(-Math.PI / 2);
        this.formationOuter = new T.Mesh(outerGeo, this.formationOuterMat);
        this.formationOuter.position.y = 0.35;
        this.formationOuter.renderOrder = 5;

        const innerGeo = new T.PlaneGeometry(9.2, 9.2);
        innerGeo.rotateX(-Math.PI / 2);
        this.formationInner = new T.Mesh(innerGeo, this.formationInnerMat);
        this.formationInner.position.y = 0.55;
        this.formationInner.renderOrder = 6;
        this.group.add(this.formationOuter, this.formationInner);

        // 2. Spiraling Qi Convergence Ribbons & Inward Spirit Motes (灵气倒灌)
        this.qiRibbonMat = new T.ShaderMaterial({
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
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uAlpha;
                varying vec2 vUv;
                void main() {
                    if (uAlpha <= 0.002) discard;
                    // Animated flowing luminous qi pulses racing inward along vUv.x (0 -> 1)
                    float flow = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(vUv.x * 16.0 - uTime * 5.2));
                    float crossFade = sin(vUv.y * 3.14159);
                    float endFade = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
                    vec3 col = mix(vec3(0.45, 0.86, 0.84), vec3(1.0, 0.84, 0.46), smoothstep(0.25, 0.85, vUv.x));
                    float a = crossFade * endFade * (0.28 + 0.72 * flow) * 0.48 * uAlpha;
                    if (a < 0.008) discard;
                    gl_FragColor = vec4(col, clamp(a, 0.0, 0.72));
                }
            `,
        });

        for (let i = 0; i < 6; i++) {
            const upper = i % 2 === 0;
            const geo = createQiRibbonGeometry(
                upper ? 13.5 : 11.5,
                0.75,
                upper ? 11.5 + (i % 3) * 2.2 : 1.0 + (i % 3) * 0.9,
                4.9,
                1.35,
                (i / 6) * Math.PI * 2,
                0.28,
            );
            const mesh = new T.Mesh(geo, this.qiRibbonMat);
            mesh.renderOrder = 7;
            this.qiRibbonsGroup.add(mesh);
        }
        this.group.add(this.qiRibbonsGroup);

        // Inward-converging spirit motes
        const motePos = new Float32Array(MOTE_COUNT * 3);
        const moteSeed = new Float32Array(MOTE_COUNT * 4);
        for (let i = 0; i < MOTE_COUNT; i++) {
            motePos[i * 3] = ((i * 137.508) % 360) * (Math.PI / 180); // angle
            motePos[i * 3 + 1] = 6.0 + (((i * 61) % 100) / 100) * 12.0; // start radius
            motePos[i * 3 + 2] = 0.6 + (((i * 43) % 100) / 100) * 12.5; // start y
            moteSeed[i * 4] = ((i * 53) % 1000) / 1000;
            moteSeed[i * 4 + 1] = 0.28 + (((i * 29) % 100) / 100) * 0.25;
            moteSeed[i * 4 + 2] = 0.7 + (((i * 17) % 100) / 100) * 0.8;
            moteSeed[i * 4 + 3] = i % 2 === 0 ? 1 : 0;
        }
        const moteGeo = new T.BufferGeometry();
        moteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
        moteGeo.setAttribute('aSeed', new T.BufferAttribute(moteSeed, 4));
        this.inwardMotesMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
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
                    float t = fract(aSeed.x + uTime * aSeed.y);
                    float ease = t * t * (3.0 - 2.0 * t);
                    float a = position.x + t * 4.2;
                    float r = mix(position.y, 0.55, ease);
                    float y = mix(position.z, 4.95, ease) + sin(t * 6.283 + position.x) * 0.35;
                    vec3 p = vec3(cos(a) * r, y, sin(a) * r);
                    vFade = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.75, 1.0, t));
                    vKind = aSeed.w;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp((135.0 * aSeed.z * uPixelRatio) / max(3.0, -mv.z), 2.0, 12.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uAlpha;
                varying float vFade;
                varying float vKind;
                void main() {
                    if (uAlpha <= 0.002) discard;
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    float d2 = dot(c, c);
                    if (d2 > 1.0) discard;
                    float glow = exp(-d2 * 5.8);
                    vec3 col = mix(vec3(0.50, 0.90, 0.86), vec3(1.0, 0.86, 0.48), vKind);
                    gl_FragColor = vec4(col, clamp(glow * vFade * 0.82 * uAlpha, 0.0, 0.9));
                }
            `,
        });
        this.inwardMotes = new T.Points(moteGeo, this.inwardMotesMat);
        this.inwardMotes.frustumCulled = false;
        this.inwardMotes.renderOrder = 8;
        this.group.add(this.inwardMotes);

        // 3. Revolving Golden Core (悬浮金丹) with Glowing Fracture Cracks + Shatter Shards (碎丹)
        this.goldenCoreMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
                uCrack: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vObjPos;
                void main() {
                    vObjPos = normalize(position);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uAlpha;
                uniform float uCrack;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vObjPos;

                // Crisp 3D cellular fracture veins for the Golden Core shattering moment
                float hash3(vec3 p) {
                    p = fract(p * vec3(443.897, 397.297, 491.187));
                    p += dot(p, p.yxz + 19.19);
                    return fract((p.x + p.y) * p.z);
                }
                float crackPattern(vec3 p) {
                    vec3 g = floor(p);
                    vec3 f = fract(p);
                    float d1 = 8.0, d2 = 8.0;
                    for (int z = -1; z <= 1; z++) {
                        for (int y = -1; y <= 1; y++) {
                            for (int x = -1; x <= 1; x++) {
                                vec3 o = vec3(float(x), float(y), float(z));
                                vec3 rnd = vec3(
                                    hash3(g + o),
                                    hash3(g + o + 17.3),
                                    hash3(g + o + 31.7)
                                );
                                float d = length(o + rnd - f);
                                if (d < d1) { d2 = d1; d1 = d; }
                                else if (d < d2) { d2 = d; }
                            }
                        }
                    }
                    return d2 - d1;
                }

                void main() {
                    if (uAlpha <= 0.002) discard;
                    float ndotv = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
                    float fresnel = pow(1.0 - ndotv, 2.2);

                    vec3 bodyCol = mix(vec3(0.86, 0.56, 0.16), vec3(1.0, 0.88, 0.50), ndotv * 0.72 + 0.28);
                    bodyCol += vec3(1.0, 0.94, 0.70) * fresnel * 0.75;

                    // Incandescent golden fracture lines spreading as uCrack ramps 0 -> 1!
                    float edgeDist = crackPattern(vObjPos * 3.2);
                    float crackWidth = mix(0.0, 0.12, uCrack);
                    float crackGlow = (1.0 - smoothstep(0.0, max(0.001, crackWidth), edgeDist)) * smoothstep(0.02, 0.25, uCrack);
                    float pulse = 0.85 + 0.15 * sin(uTime * 14.0);
                    vec3 col = mix(bodyCol, vec3(1.0, 0.98, 0.88) * (1.45 + uCrack * 0.65), crackGlow * pulse);
                    col = col / (vec3(1.0) + col * 0.22);
                    gl_FragColor = vec4(col, clamp(uAlpha, 0.0, 0.98));
                }
            `,
        });
        this.goldenCore = new T.Mesh(new T.SphereGeometry(0.32, 28, 22), this.goldenCoreMat);
        this.goldenCore.renderOrder = 9;

        this.coreHaloMat = new T.ShaderMaterial({
            uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: /* glsl */ `
                uniform float uAlpha;
                uniform float uTime;
                varying vec2 vUv;
                void main() {
                    if (uAlpha <= 0.002) discard;
                    float r = length(vUv);
                    if (r > 1.0) discard;
                    float a = atan(vUv.y, vUv.x);
                    float ring = exp(-pow((r - 0.78) / 0.06, 2.0)) * (0.7 + 0.3 * sin(a * 6.0 - uTime * 3.0));
                    float halo = exp(-r * r * 5.2) * 0.55;
                    vec3 col = mix(vec3(1.0, 0.80, 0.38), vec3(1.0, 0.96, 0.82), halo);
                    gl_FragColor = vec4(col, clamp((ring + halo) * uAlpha, 0.0, 0.85));
                }
            `,
        });
        const haloGeo = new T.PlaneGeometry(1.5, 1.5);
        this.coreHaloRing = new T.Mesh(haloGeo, this.coreHaloMat);
        this.coreHaloRing.renderOrder = 9;
        this.coreGroup.add(this.goldenCore, this.coreHaloRing);
        this.group.add(this.coreGroup);

        // Shattered Golden Core shards bursting outward & swirling into ascending radiance
        const shardPos = new Float32Array(SHARD_COUNT * 3);
        const shardDir = new Float32Array(SHARD_COUNT * 4);
        for (let i = 0; i < SHARD_COUNT; i++) {
            const u = (((i * 73) % 1000) / 1000) * 2 - 1;
            const phi = ((i * 137.508) % 360) * (Math.PI / 180);
            const s = Math.sqrt(Math.max(0, 1 - u * u));
            shardPos[i * 3] = 0;
            shardPos[i * 3 + 1] = 0;
            shardPos[i * 3 + 2] = 0;
            shardDir[i * 4] = Math.cos(phi) * s;
            shardDir[i * 4 + 1] = u;
            shardDir[i * 4 + 2] = Math.sin(phi) * s;
            shardDir[i * 4 + 3] = 0.65 + (((i * 31) % 100) / 100) * 0.95; // speed / size seed
        }
        const shardGeo = new T.BufferGeometry();
        shardGeo.setAttribute('position', new T.BufferAttribute(shardPos, 3));
        shardGeo.setAttribute('aDir', new T.BufferAttribute(shardDir, 4));
        this.coreShardsMat = new T.ShaderMaterial({
            uniforms: {
                uBurstAge: { value: 0 },
                uAlpha: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                attribute vec4 aDir;
                uniform float uBurstAge;
                uniform float uPixelRatio;
                varying float vFade;
                varying float vSeed;
                void main() {
                    float t = clamp(uBurstAge / 2.4, 0.0, 1.0);
                    float expand = (1.0 - pow(1.0 - t, 2.5)) * 5.8 * aDir.w;
                    float spin = t * 2.8 * aDir.w;
                    float cs = cos(spin), sn = sin(spin);
                    vec3 d = aDir.xyz;
                    vec3 spun = vec3(d.x * cs - d.z * sn, d.y + t * 1.15, d.x * sn + d.z * cs);
                    vec3 p = spun * expand;
                    vFade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.42, 1.0, t));
                    vSeed = aDir.w;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp((190.0 * aDir.w * uPixelRatio) / max(2.5, -mv.z), 2.5, 16.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uAlpha;
                varying float vFade;
                varying float vSeed;
                void main() {
                    if (uAlpha <= 0.002) discard;
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    // Crisp golden diamond crystal spark
                    float diamond = abs(c.x) + abs(c.y);
                    if (diamond > 1.0) discard;
                    float core = exp(-diamond * diamond * 5.0);
                    vec3 col = mix(vec3(1.0, 0.80, 0.36), vec3(0.76, 0.96, 0.92), step(1.28, vSeed));
                    col = mix(col, vec3(1.0, 0.98, 0.90), core * 0.7);
                    gl_FragColor = vec4(col, clamp(core * vFade * uAlpha, 0.0, 0.95));
                }
            `,
        });
        this.coreShards = new T.Points(shardGeo, this.coreShardsMat);
        this.coreShards.frustumCulled = false;
        this.coreShards.visible = false;
        this.coreShards.renderOrder = 10;
        this.group.add(this.coreShards);

        // 4. Protective Barrier Dome (护道灵罩) & Tribulation Lightning Bolt (引雷渡劫)
        this.barrierMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
                uHit: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            fog: false,
            vertexShader: /* glsl */ `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vLocal;
                void main() {
                    vLocal = normalize(position);
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uAlpha;
                uniform float uHit;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vLocal;
                void main() {
                    if (uAlpha <= 0.002) discard;
                    float ndotv = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
                    float rim = pow(1.0 - ndotv, 2.4);
                    // Concentric ripple sweeping down from top apex when tribulation lightning strikes!
                    float wavePos = mix(1.0, -0.8, 1.0 - uHit);
                    float impactRing = exp(-pow((vLocal.y - wavePos) / 0.16, 2.0)) * uHit;
                    float lattice = 0.8 + 0.2 * sin(vLocal.y * 22.0 - uTime * 3.0) * cos(atan(vLocal.z, vLocal.x) * 8.0);
                    vec3 col = mix(vec3(0.48, 0.86, 0.88), vec3(1.0, 0.86, 0.52), rim * 0.5 + impactRing * 0.7);
                    float a = (rim * 0.36 * lattice + impactRing * 0.65) * uAlpha;
                    gl_FragColor = vec4(col, clamp(a, 0.0, 0.78));
                }
            `,
        });
        this.barrierDome = new T.Mesh(new T.SphereGeometry(2.55, 32, 24), this.barrierMat);
        this.barrierDome.visible = false;
        this.barrierDome.renderOrder = 9;
        this.group.add(this.barrierDome);

        this.tribulationPositions = new Float32Array(BOLT_SEGS * 2 * 3);
        const boltGeo = new T.BufferGeometry();
        boltGeo.setAttribute('position', new T.BufferAttribute(this.tribulationPositions, 3));
        this.tribulationMat = new T.LineBasicMaterial({
            color: 0xcbe2ff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: T.AdditiveBlending,
            fog: false,
        });
        this.tribulationBolt = new T.LineSegments(boltGeo, this.tribulationMat);
        this.tribulationBolt.frustumCulled = false;
        this.tribulationBolt.visible = false;
        this.tribulationBolt.renderOrder = 10;
        this.group.add(this.tribulationBolt);

        // 5. Stylized Daoist Lotus Throne (写意金玉光莲台) — Phase 4 Climax
        this.lotusMat = new T.ShaderMaterial({
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
                    float fres = pow(1.0 - ndotv, 1.65);
                    float edgeVein = smoothstep(0.32, 0.50, abs(vUv.x - 0.5));
                    float tipGlow = smoothstep(0.45, 0.96, vUv.y);
                    float baseFade = smoothstep(0.0, 0.16, vUv.y);
                    vec3 jade = vec3(0.46, 0.86, 0.78);
                    vec3 gold = vec3(1.0, 0.84, 0.46);
                    vec3 col = mix(jade, gold, clamp(tipGlow * 0.75 + fres * 0.45, 0.0, 1.0));
                    col += vec3(1.0, 0.96, 0.82) * edgeVein * 0.45;
                    float a = (0.18 + fres * 0.42 + tipGlow * 0.25 + edgeVein * 0.28) * baseFade * uAlpha;
                    gl_FragColor = vec4(col, clamp(a, 0.0, 0.72));
                }
            `,
        });
        const petalGeo = createLotusPetalGeometry(1.55, 0.72);
        for (let tier = 0; tier < 2; tier++) {
            const count = tier === 0 ? 6 : 8;
            for (let i = 0; i < count; i++) {
                const petal = new T.Mesh(petalGeo, this.lotusMat);
                const angle = (i / count) * Math.PI * 2 + tier * (Math.PI / count);
                petal.rotation.y = angle;
                petal.rotation.x = tier === 0 ? -0.18 : 0.12;
                const s = tier === 0 ? 0.85 : 1.18;
                petal.scale.set(s, s, s);
                petal.position.y = tier === 0 ? 0.12 : -0.04;
                petal.renderOrder = 8;
                this.lotusGroup.add(petal);
            }
        }
        this.lotusGroup.visible = false;
        this.group.add(this.lotusGroup);

        // 6. Dual Counter-Rotating Golden Dao Wheel (背后金玉道轮) — Phase 4 Climax
        const makeWheelMat = (isOuter: boolean) =>
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
                    void main() {
                        vUv = uv * 2.0 - 1.0;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform float uTime;
                    uniform float uAlpha;
                    varying vec2 vUv;
                    float ring(float r, float c, float w) { return exp(-pow((r - c) / w, 2.0)); }
                    void main() {
                        if (uAlpha <= 0.002) discard;
                        float r = length(vUv);
                        if (r > 1.0) discard;
                        float a = atan(vUv.y, vUv.x);

                        float mainRing = ring(r, 0.84, 0.022) + ring(r, 0.72, 0.012);
                        float ticks = pow(0.5 + 0.5 * cos(a * ${isOuter ? '12.0' : '8.0'}), 16.0) * smoothstep(0.68, 0.76, r) * (1.0 - smoothstep(0.84, 0.96, r));
                        float sunRays = pow(0.5 + 0.5 * cos(a * ${isOuter ? '24.0' : '16.0'}), 8.0) * smoothstep(0.78, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r)) * 0.55;
                        float innerGlow = ring(r, 0.78, 0.12) * 0.25;
                        float pulse = 0.88 + 0.12 * sin(uTime * 3.0);

                        vec3 col = mix(vec3(1.0, 0.78, 0.36), vec3(1.0, 0.96, 0.82), clamp(mainRing * 0.7 + ticks * 0.5, 0.0, 1.0));
                        float alpha = clamp((mainRing + ticks * 0.85 + sunRays + innerGlow) * pulse * 0.78 * uAlpha, 0.0, 0.86);
                        if (alpha < 0.008) discard;
                        gl_FragColor = vec4(col, alpha);
                    }
                `,
            });

        this.daoWheelOuterMat = makeWheelMat(true);
        this.daoWheelInnerMat = makeWheelMat(false);
        this.daoWheelOuter = new T.Mesh(new T.PlaneGeometry(4.4, 4.4), this.daoWheelOuterMat);
        this.daoWheelInner = new T.Mesh(new T.PlaneGeometry(3.0, 3.0), this.daoWheelInnerMat);
        this.daoWheelInner.position.z = 0.06;
        this.daoWheelOuter.renderOrder = 8;
        this.daoWheelInner.renderOrder = 8;
        this.daoWheelGroup.add(this.daoWheelOuter, this.daoWheelInner);
        this.daoWheelGroup.visible = false;
        this.group.add(this.daoWheelGroup);

        // 7. Translucent Daoist Spirit Cocoon Aura Veil (灵光光茧)
        this.cocoonMat = new T.ShaderMaterial({
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
                    float rim = pow(1.0 - ndotv, 1.85);
                    float ascend = 0.65 + 0.35 * sin(vUv.y * 18.0 - uTime * 3.8 + vUv.x * 12.566);
                    float vFade = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
                    vec3 col = mix(vec3(0.55, 0.88, 0.82), vec3(1.0, 0.84, 0.44), smoothstep(0.15, 0.85, vUv.y));
                    gl_FragColor = vec4(col, clamp(rim * ascend * vFade * 0.48 * uAlpha, 0.0, 0.62));
                }
            `,
        });
        const cocoonGeo = new T.SphereGeometry(1.55, 28, 22);
        cocoonGeo.scale(1.0, 1.42, 1.0);
        this.spiritCocoon = new T.Mesh(cocoonGeo, this.cocoonMat);
        this.spiritCocoon.visible = false;
        this.spiritCocoon.renderOrder = 9;
        this.group.add(this.spiritCocoon);

        // 8. Focused Golden Heaven-Descent Beam (金光贯天柱 — tight vertical beam connecting directly onto the cultivator's Lotus & Dao Wheel!)
        this.heavenBeamMat = new T.ShaderMaterial({
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
                    float edge = pow(ndotv, 1.75);
                    float stream = 0.68 + 0.32 * sin(vUv.y * 42.0 - uTime * 5.5 + vUv.x * 12.566);
                    float vFade = smoothstep(0.0, 0.015, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
                    vec3 col = mix(vec3(1.0, 0.82, 0.42), vec3(1.0, 0.96, 0.82), edge * 0.65);
                    gl_FragColor = vec4(col, clamp(edge * stream * vFade * 0.44 * uAlpha, 0.0, 0.65));
                }
            `,
        });
        const beamGeo = new T.CylinderGeometry(4.2, 2.3, 1080, 20, 1, true);
        beamGeo.translate(0, 540, 0);
        this.heavenBeam = new T.Mesh(beamGeo, this.heavenBeamMat);
        this.heavenBeam.visible = false;
        this.heavenBeam.renderOrder = 8;
        this.group.add(this.heavenBeam);

        scene.add(this.group);
    }

    /** Adapts particle density for low/medium presets while keeping high quality 100% full detail. */
    setQuality(q: Quality) {
        const shardCount = q === 'low' ? 64 : q === 'medium' ? 112 : SHARD_COUNT;
        const moteCount = q === 'low' ? 50 : q === 'medium' ? 92 : MOTE_COUNT;
        this.coreShards.geometry.setDrawRange(0, shardCount);
        this.inwardMotes.geometry.setDrawRange(0, moteCount);
    }

    /** Starts the 23-second Nascent Soul Breakthrough ceremony anchored at the cultivator's current world spot. */
    start(groundAnchor: T.Vector3, heading: number, onComplete?: () => void) {
        this._active = true;
        this.elapsed = 0;
        this.baseAnchor.copy(groundAnchor);
        this.baseHeading = heading;
        this.playerHoverPos.copy(groundAnchor);
        this.strike1Fired = false;
        this.strike2Fired = false;
        this.barrierHitImpact = 0;
        this.shakeAmount = 0;
        this.lightFlash = 0;
        this.onCompleteCb = onComplete;
        this.group.position.copy(groundAnchor);
        this.group.visible = true;
    }

    /** DEV helper: jump directly to any timestamp (0..22s) inside the ceremony for instant visual verification. */
    jumpToTimeForDev(seconds: number, groundAnchor: T.Vector3, heading: number, onComplete?: () => void) {
        this.start(groundAnchor, heading, onComplete);
        this.elapsed = T.MathUtils.clamp(seconds, 0.05, T_P5_END - 0.5);
        if (this.elapsed >= STRIKE_1_TIME) this.strike1Fired = true;
        if (this.elapsed >= STRIKE_2_TIME) this.strike2Fired = true;
        // If jumping right onto a lightning beat, trigger impact wave for visual preview
        if (Math.abs(this.elapsed - STRIKE_1_TIME) < 0.35 || Math.abs(this.elapsed - STRIKE_2_TIME) < 0.35) {
            this.buildTribulationBolt(this.baseAnchor.y + 4.3 - this.group.position.y);
            this.barrierHitImpact = 0.82;
        }
    }

    /** Gracefully skips remaining cinematic time and completes breakthrough immediately. */
    skip() {
        if (!this._active) return;
        this.finish();
    }

    private finish() {
        this._active = false;
        this.group.visible = false;
        this.titleState.visible = false;
        this.titleState.alpha = 0;
        this.tribulationBolt.visible = false;
        const cb = this.onCompleteCb;
        this.onCompleteCb = undefined;
        cb?.();
    }

    private buildTribulationBolt(hoverLocalY: number) {
        const start = new T.Vector3((Math.random() - 0.5) * 42, 460, (Math.random() - 0.5) * 42);
        const end = new T.Vector3((Math.random() - 0.5) * 0.6, hoverLocalY + 2.45, (Math.random() - 0.5) * 0.6);
        let cursor = 0;
        const writeSeg = (a: T.Vector3, b: T.Vector3) => {
            if (cursor >= BOLT_SEGS) return;
            const o = cursor * 6;
            this.tribulationPositions[o] = a.x;
            this.tribulationPositions[o + 1] = a.y;
            this.tribulationPositions[o + 2] = a.z;
            this.tribulationPositions[o + 3] = b.x;
            this.tribulationPositions[o + 4] = b.y;
            this.tribulationPositions[o + 5] = b.z;
            cursor++;
        };
        const mainSegs = 18;
        let prev = start.clone();
        let branchOrigin = start.clone();
        for (let i = 1; i <= mainSegs; i++) {
            const t = i / mainSegs;
            const cur = start.clone().lerp(end, t);
            if (i < mainSegs) {
                const jag = Math.sin(t * Math.PI) * 14 * (1 - t * 0.65);
                cur.x += (Math.random() - 0.5) * jag;
                cur.z += (Math.random() - 0.5) * jag;
            }
            writeSeg(prev, cur);
            if (i === 10) branchOrigin.copy(cur);
            prev = cur;
        }
        // Secondary side fork
        const forkEnd = branchOrigin.clone().add(new T.Vector3((Math.random() - 0.5) * 28, -45, (Math.random() - 0.5) * 28));
        let bPrev = branchOrigin;
        for (let i = 1; i <= 5; i++) {
            const t = i / 5;
            const bCur = branchOrigin.clone().lerp(forkEnd, t);
            if (i < 5) {
                bCur.x += (Math.random() - 0.5) * 4;
                bCur.z += (Math.random() - 0.5) * 4;
            }
            writeSeg(bPrev, bCur);
            bPrev = bCur;
        }
        for (let i = cursor * 6; i < this.tribulationPositions.length; i++) this.tribulationPositions[i] = 0;
        (this.tribulationBolt.geometry.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
        this.tribulationBolt.geometry.setDrawRange(0, cursor * 2);
        this.tribulationBolt.visible = true;
    }

    collectLights(pool: SpellLightPool) {
        if (!this._active) return;
        const t = this.elapsed;
        const p2 = smooth01(2.2, 6.0, t);
        const p4 = smooth01(T_P3_END - 0.1, T_P3_END + 0.5, t) * (1 - smooth01(T_P4_END - 0.5, T_P5_END - 0.8, t));
        const baseStrength = (p2 * 0.48 + p4 * 1.15 + this.lightFlash * 0.95) * (1 - smooth01(T_P5_END - 2.0, T_P5_END, t));
        if (baseStrength <= 0.02) return;
        this.lightPos.copy(this.playerHoverPos);
        this.lightPos.y += 1.6;
        const color = p4 > 0.2 ? 0xffd278 : this.lightFlash > 0.25 ? 0xb8dcff : 0x76e0d2;
        pool.emit({
            x: this.lightPos.x,
            y: this.lightPos.y,
            z: this.lightPos.z,
            color,
            intensity: baseStrength * 16,
            distance: 26 + p4 * 22,
            priority: 10,
            castShadow: p4 > 0.25,
        });
    }

    update(dt: number, pixelRatio: number) {
        if (!this._active) return;
        this.elapsed += dt;
        const t = this.elapsed;
        if (t >= T_P5_END) {
            this.finish();
            return;
        }

        // Levitation height: smoothly ascends +4.2m in Phase 1, rises gently to +5.1m in Phase 4 climax, settles at +4.4m
        const lift1 = smooth01(0.0, 2.8, t) * 4.2;
        const liftClimax = smooth01(T_P3_END, T_P3_END + 1.4, t) * (1 - smooth01(T_P4_END, T_P5_END - 1.0, t) * 0.65) * 0.95;
        const hoverBob = Math.sin(t * 2.1) * 0.12;
        const hoverLocalY = lift1 + liftClimax + hoverBob;
        this.playerHoverPos.set(this.baseAnchor.x, this.baseAnchor.y + hoverLocalY, this.baseAnchor.z);

        const sinH = Math.sin(this.baseHeading);
        const cosH = Math.cos(this.baseHeading);
        const fwdX = sinH;
        const fwdZ = -cosH;

        // 1. Spirit-Gathering Formation (聚灵法阵)
        const formIn = smooth01(0.3, 2.6, t);
        const formOut = 1 - smooth01(T_P4_END + 0.6, T_P5_END - 0.6, t);
        const formAlpha = formIn * formOut;
        const burstEnv = smooth01(T_P3_END, T_P3_END + 0.7, t) * (1 - smooth01(T_P4_END - 0.4, T_P4_END + 1.2, t));
        this.formationOuter.visible = formAlpha > 0.005;
        this.formationInner.visible = formAlpha > 0.005;
        this.formationOuter.rotation.y = t * 0.16;
        this.formationInner.rotation.y = -t * 0.34;
        const formScale = 0.45 + 0.55 * formIn + burstEnv * 0.22;
        this.formationOuter.scale.setScalar(formScale);
        this.formationInner.scale.setScalar(formScale);
        this.formationOuter.position.y = Math.max(0.35, hoverLocalY - 1.35);
        this.formationInner.position.y = Math.max(0.55, hoverLocalY - 1.15);
        this.formationOuterMat.uniforms.uTime.value = t;
        this.formationOuterMat.uniforms.uAlpha.value = formAlpha;
        this.formationOuterMat.uniforms.uBurst.value = burstEnv;
        this.formationInnerMat.uniforms.uTime.value = t;
        this.formationInnerMat.uniforms.uAlpha.value = formAlpha;
        this.formationInnerMat.uniforms.uBurst.value = burstEnv;

        // 2. Spiraling Qi Ribbons & Inward Motes (Phase 2 -> 3)
        const qiAlpha = smooth01(2.6, 5.2, t) * (1 - smooth01(T_P3_END - 0.2, T_P3_END + 0.8, t));
        this.qiRibbonsGroup.visible = qiAlpha > 0.005;
        this.qiRibbonsGroup.rotation.y = t * 0.42;
        this.qiRibbonMat.uniforms.uTime.value = t;
        this.qiRibbonMat.uniforms.uAlpha.value = qiAlpha;

        const moteAlpha = smooth01(2.2, 4.6, t) * (1 - smooth01(T_P4_END + 1.0, T_P5_END - 0.5, t));
        this.inwardMotes.visible = moteAlpha > 0.005;
        this.inwardMotesMat.uniforms.uTime.value = t;
        this.inwardMotesMat.uniforms.uAlpha.value = moteAlpha;
        this.inwardMotesMat.uniforms.uPixelRatio.value = pixelRatio;

        // 3. Floating Golden Core (Phase 3 -> shatters at T_P3_END = 12.6s!)
        const coreIn = smooth01(6.9, 8.1, t);
        const coreAlive = t < T_P3_END;
        const crackProg = smooth01(10.6, T_P3_END - 0.04, t);
        this.coreGroup.visible = coreAlive && coreIn > 0.005;
        if (this.coreGroup.visible) {
            const jitter = crackProg * crackProg * 0.045;
            const jx = Math.sin(t * 62.0) * jitter;
            const jy = Math.cos(t * 74.0) * jitter;
            this.coreGroup.position.set(
                fwdX * 0.92 + jx,
                hoverLocalY + 1.25 + Math.sin(t * 3.2) * 0.06 + jy,
                fwdZ * 0.92,
            );
            const coreScale = (0.35 + 0.65 * coreIn) * (1.0 + crackProg * 0.24);
            this.goldenCore.scale.setScalar(coreScale);
            this.goldenCore.rotation.y = t * (1.4 + crackProg * 4.5);
            this.goldenCore.rotation.x = t * 0.7;
            this.goldenCoreMat.uniforms.uTime.value = t;
            this.goldenCoreMat.uniforms.uAlpha.value = coreIn;
            this.goldenCoreMat.uniforms.uCrack.value = crackProg;

            this.coreHaloRing.rotation.set(Math.PI * 0.36 + Math.sin(t * 1.6) * 0.2, t * 1.8, 0);
            this.coreHaloRing.scale.setScalar(coreScale);
            this.coreHaloMat.uniforms.uAlpha.value = coreIn * (0.75 + 0.45 * crackProg);
            this.coreHaloMat.uniforms.uTime.value = t;
        }

        // Core Shatter burst (12.6s -> 15.2s)
        const burstAge = t - T_P3_END;
        if (burstAge >= 0 && burstAge < 2.6) {
            if (burstAge < dt * 2.5) {
                this.shakeAmount = Math.max(this.shakeAmount, 0.45);
                this.lightFlash = 1.0;
            }
            this.coreShards.visible = true;
            this.coreShards.position.set(fwdX * 0.92, hoverLocalY + 1.25, fwdZ * 0.92);
            this.coreShardsMat.uniforms.uBurstAge.value = burstAge;
            this.coreShardsMat.uniforms.uAlpha.value = 1.0;
            this.coreShardsMat.uniforms.uPixelRatio.value = pixelRatio;
        } else {
            this.coreShards.visible = false;
        }

        // 4. Tribulation Lightning Strikes & Protective Barrier Dome (Phase 3)
        if (!this.strike1Fired && t >= STRIKE_1_TIME) {
            this.strike1Fired = true;
            this.buildTribulationBolt(hoverLocalY);
            this.barrierHitImpact = 1.0;
            this.shakeAmount = 0.32;
            this.lightFlash = 0.85;
        }
        if (!this.strike2Fired && t >= STRIKE_2_TIME) {
            this.strike2Fired = true;
            this.buildTribulationBolt(hoverLocalY);
            this.barrierHitImpact = 1.0;
            this.shakeAmount = 0.38;
            this.lightFlash = 0.95;
        }
        this.barrierHitImpact = Math.max(0, this.barrierHitImpact - dt * 1.45);
        this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.35);
        this.lightFlash = Math.max(0, this.lightFlash - dt * 2.8);

        const s1Age = t - STRIKE_1_TIME;
        const s2Age = t - STRIKE_2_TIME;
        const activeAge = s2Age >= 0 && s2Age < STRIKE_DUR ? s2Age : s1Age >= 0 && s1Age < STRIKE_DUR ? s1Age : -1;
        if (activeAge >= 0) {
            const p = activeAge / STRIKE_DUR;
            const flick = p < 0.25 ? 1.0 : p < 0.42 ? 0.3 : p < 0.62 ? 0.95 : (1 - p) / 0.38;
            this.tribulationBolt.visible = true;
            this.tribulationMat.opacity = flick;
        } else {
            this.tribulationBolt.visible = false;
        }

        const barrierBase = smooth01(7.6, 8.4, t) * (1 - smooth01(T_P3_END - 0.1, T_P3_END + 0.5, t));
        this.barrierDome.visible = barrierBase > 0.005 || this.barrierHitImpact > 0.01;
        if (this.barrierDome.visible) {
            this.barrierDome.position.set(0, hoverLocalY + 1.15, 0);
            this.barrierMat.uniforms.uTime.value = t;
            this.barrierMat.uniforms.uAlpha.value = Math.max(barrierBase * 0.72, this.barrierHitImpact);
            this.barrierMat.uniforms.uHit.value = this.barrierHitImpact;
        }

        // 5. Phase-4 Stylized Daoist Lotus Throne, Dual Golden Dao Wheel & Spirit Cocoon (1B 写意道韵版!)
        const climaxIn = smooth01(T_P3_END, T_P3_END + 1.05, t);
        const climaxOut = 1 - smooth01(T_P4_END + 0.2, T_P5_END - 1.4, t);
        const climaxAlpha = climaxIn * climaxOut;

        this.lotusGroup.visible = climaxAlpha > 0.005;
        if (this.lotusGroup.visible) {
            this.lotusGroup.position.set(0, hoverLocalY - 0.18, 0);
            this.lotusGroup.rotation.y = t * 0.22;
            const bloomScale = 0.25 + 0.85 * climaxIn;
            this.lotusGroup.scale.set(bloomScale, bloomScale * (0.65 + 0.35 * climaxIn), bloomScale);
            this.lotusMat.uniforms.uTime.value = t;
            this.lotusMat.uniforms.uAlpha.value = climaxAlpha;
        }

        this.daoWheelGroup.visible = climaxAlpha > 0.005;
        if (this.daoWheelGroup.visible) {
            // Floats regally right behind the cultivator's upper back!
            this.daoWheelGroup.position.set(-fwdX * 0.52, hoverLocalY + 1.55, -fwdZ * 0.52);
            this.daoWheelGroup.rotation.y = this.baseHeading;
            const wheelScale = 0.35 + 0.72 * climaxIn;
            this.daoWheelGroup.scale.setScalar(wheelScale);
            this.daoWheelOuter.rotation.z = t * 0.26;
            this.daoWheelInner.rotation.z = -t * 0.44;
            this.daoWheelOuterMat.uniforms.uTime.value = t;
            this.daoWheelOuterMat.uniforms.uAlpha.value = climaxAlpha;
            this.daoWheelInnerMat.uniforms.uTime.value = t;
            this.daoWheelInnerMat.uniforms.uAlpha.value = climaxAlpha;
        }

        const cocoonAlpha = climaxIn * (1 - smooth01(T_P4_END - 0.6, T_P4_END + 1.6, t));
        this.spiritCocoon.visible = cocoonAlpha > 0.005;
        if (this.spiritCocoon.visible) {
            this.spiritCocoon.position.set(0, hoverLocalY + 1.25, 0);
            const cScale = 0.75 + 0.35 * climaxIn;
            this.spiritCocoon.scale.setScalar(cScale);
            this.cocoonMat.uniforms.uTime.value = t;
            this.cocoonMat.uniforms.uAlpha.value = cocoonAlpha;
        }

        const beamAlpha = climaxIn * (1 - smooth01(T_P4_END - 0.8, T_P4_END + 1.0, t));
        this.heavenBeam.visible = beamAlpha > 0.005;
        if (this.heavenBeam.visible) {
            this.heavenBeam.position.set(0, Math.max(0.2, hoverLocalY - 1.2), 0);
            this.heavenBeamMat.uniforms.uTime.value = t;
            this.heavenBeamMat.uniforms.uAlpha.value = beamAlpha;
        }

        // 6. Update Cinematic Title & Camera Choreography
        this.updateTitles(t);
        this.updateCamera(t, hoverLocalY);
    }

    private updateTitles(t: number) {
        const stages: readonly { start: number; end: number; title: string; sub: string }[] = [
            { start: 0.4, end: 3.1, title: '天地感应', sub: '风云聚起 · 灵潮初动' },
            { start: 3.5, end: 7.0, title: '灵气倒灌', sub: '聚灵成阵 · 纳气归元' },
            { start: 7.5, end: 12.2, title: '碎丹渡劫', sub: '破而后立 · 雷炼金丹' },
            { start: 12.8, end: 17.4, title: '道轮凝婴', sub: '金光贯天 · 莲台映道' },
            { start: 18.0, end: 22.3, title: '元婴初成', sub: '肉身御空 · 遁光破界 · 寿元大增' },
        ];
        for (const s of stages) {
            if (t >= s.start && t <= s.end) {
                const fadeIn = smooth01(s.start, s.start + 0.65, t);
                const fadeOut = 1 - smooth01(s.end - 0.75, s.end, t);
                this.titleState.visible = true;
                this.titleState.title = s.title;
                this.titleState.subtitle = s.sub;
                this.titleState.alpha = fadeIn * fadeOut;
                return;
            }
        }
        this.titleState.visible = false;
        this.titleState.alpha = 0;
    }

    private updateCamera(t: number, hoverLocalY: number) {
        const cx = this.baseAnchor.x;
        const cy = this.baseAnchor.y + hoverLocalY + 1.25;
        const cz = this.baseAnchor.z;

        let orbitAngle = this.baseHeading + Math.PI * 0.16;
        let radius = 7.2;
        let camYOffset = -0.9;
        let lookYOffset = 1.6;
        let fov = 62;

        if (t < T_P1_END) {
            // Phase 1: Low-angle ascending hero shot framing levitating cultivator + gathering sky above!
            const p = smooth01(0, T_P1_END, t);
            orbitAngle = this.baseHeading + T.MathUtils.lerp(Math.PI * 0.85, Math.PI * 0.35, p);
            radius = T.MathUtils.lerp(6.8, 8.2, p);
            camYOffset = T.MathUtils.lerp(-0.4, -1.6, p);
            lookYOffset = T.MathUtils.lerp(0.6, 2.8, p);
            fov = T.MathUtils.lerp(64, 68, p);
        } else if (t < T_P2_END) {
            // Phase 2: Majestic wide sweep showcasing Spirit Formation & spiraling qi ribbons
            const p = smooth01(T_P1_END, T_P2_END, t);
            orbitAngle = this.baseHeading + T.MathUtils.lerp(Math.PI * 0.35, -Math.PI * 0.22, p);
            radius = T.MathUtils.lerp(8.2, 9.6, Math.sin(p * Math.PI)) - p * 1.4;
            camYOffset = T.MathUtils.lerp(-1.6, 1.2, p);
            lookYOffset = T.MathUtils.lerp(2.8, 0.8, p);
            fov = T.MathUtils.lerp(68, 60, p);
        } else if (t < T_P3_END) {
            // Phase 3: Intimate dramatic push-in framing cultivator, Golden Core & tribulation strikes
            const p = smooth01(T_P2_END, T_P3_END, t);
            orbitAngle = this.baseHeading + T.MathUtils.lerp(-Math.PI * 0.22, 0.26, p);
            radius = T.MathUtils.lerp(6.8, 4.7, p);
            camYOffset = T.MathUtils.lerp(1.2, 0.35, p);
            lookYOffset = T.MathUtils.lerp(0.8, 0.35, p);
            fov = T.MathUtils.lerp(60, 54, p);
        } else if (t < T_P4_END) {
            // Phase 4 Climax: Dramatic pull-back & upward sweeping crane shot capturing Lotus, Dao Wheel & 1280m Golden Pillar!
            const p = smooth01(T_P3_END, T_P4_END, t);
            const pull = 1 - Math.pow(1 - Math.min(1, p * 1.45), 2.2);
            orbitAngle = this.baseHeading + T.MathUtils.lerp(0.26, -0.58, p);
            radius = T.MathUtils.lerp(4.7, 17.5, pull);
            camYOffset = T.MathUtils.lerp(0.35, 3.2, pull);
            lookYOffset = T.MathUtils.lerp(0.35, 3.8, pull);
            fov = T.MathUtils.lerp(54, 72, pull);
        } else {
            // Phase 5: Smooth return behind the ascended cultivator hovering in midair
            const p = smooth01(T_P4_END, T_P5_END, t);
            orbitAngle = this.baseHeading + T.MathUtils.lerp(-0.58, Math.PI, p);
            radius = T.MathUtils.lerp(17.5, 7.2, p);
            camYOffset = T.MathUtils.lerp(3.2, 1.9, p);
            lookYOffset = T.MathUtils.lerp(3.8, 0.4, p);
            fov = T.MathUtils.lerp(72, 65, p);
        }

        const camX = cx + Math.sin(orbitAngle) * radius;
        const camZ = cz - Math.cos(orbitAngle) * radius;
        const camY = Math.max(this.baseAnchor.y + 1.8, cy + camYOffset);

        // Subtle damped impact shake on lightning strikes & Golden Core shatter
        const shakeX = Math.sin(t * 53.0) * this.shakeAmount * 0.38;
        const shakeY = Math.cos(t * 67.0) * this.shakeAmount * 0.30;

        this.camPose.position.set(camX + shakeX, camY + shakeY, camZ);
        this.camPose.target.set(cx, cy + lookYOffset, cz);
        this.camPose.fov = fov;
    }

    dispose() {
        this.group.removeFromParent();
        const geos = new Set<T.BufferGeometry>();
        const mats = new Set<T.Material>();
        this.group.traverse(o => {
            if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.LineSegments) {
                if (!geos.has(o.geometry)) {
                    geos.add(o.geometry);
                    o.geometry.dispose();
                }
                const list = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of list) {
                    if (!mats.has(m)) {
                        mats.add(m);
                        m.dispose();
                    }
                }
            }
        });
    }
}
