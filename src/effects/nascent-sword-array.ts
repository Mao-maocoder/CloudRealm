import * as T from 'three';
import { SwordRainFX } from './sword-rain-fx';
import type { SpellLightPool } from './spell-lights';
import type { SwordRainContact } from './sword-array';

const OUTER_ARRAY_TEX_URL = new URL('../../resource/skill/nascent-sword-array/Nascent_SkyArray_Outer_RGBA.png', import.meta.url).href;
const INNER_ARRAY_TEX_URL = new URL('../../resource/skill/nascent-sword-array/Nascent_SkyArray_Inner_RGBA.png', import.meta.url).href;
const CLIMAX_CRATER_TEX_URL = new URL('../../resource/skill/nascent-sword-array/Nascent_Climax_Crater_RGBA.png', import.meta.url).href;

// ── Four-Phase Sword-Flood Choreography Timeline (seconds) ───────────────────
// Phase 1 (0.00 -> 1.65s): 凌空立阵 · 中心扩散 — Giant vertical Celestial Array blooms behind caster;
//                          target lock domain opens ahead (20-85m); 220 real swords bloom radially from array center
// Phase 2 (1.50 -> 6.15s): 三段曲线剑洪流 — Vanguard Ring (22) -> Main 4-Stream Curved Flood (174) -> Flank Envelopment (24);
//                          every sword strictly aligns to its 3D curve tangent & embeds SLANTED into the earth!
// Phase 3 (6.15 -> 6.60s): 剑冢共鸣 — All 220 slanted grounded blades vibrate & pulse in dramatic stillness
// Phase 4 (6.60 -> 9.65s): 方案A · 交错冲天剑气风暴 — 18 crisscrossing slanted sky-piercing sword-qi spires,
//                          concentric shockwave + rolling mist ring, glowing ground fissures & blasted embers!
const T_BLOOM_START = 0.14;
const T_VANGUARD_START = 1.48;
const T_FLOOD_START = 2.02;
const T_FLANK_START = 3.55;
const T_RESONANCE_START = 6.15;
const T_FINALE_ERUPT = 6.60;
const T_TOTAL_DURATION = 9.65;

const ARRAY_RADIUS = 7.2;
const VANGUARD_COUNT = 22;
const FLOOD_COUNT = 174;
const FLANK_COUNT = 24;
const MAX_BLADES = VANGUARD_COUNT + FLOOD_COUNT + FLANK_COUNT; // 220 real character swords

const WISPY_RIBBON_COUNT = 20;
const WISPY_SEGS = 32;
const CRISSCROSS_SPIRE_COUNT = 18;
const CLIMAX_EMBER_COUNT = 92;

const UP = new T.Vector3(0, 1, 0);
const DOWN = new T.Vector3(0, -1, 0);

type WaveRole = 'vanguard' | 'flood' | 'flank';

interface FloodSword {
    role: WaveRole;
    streamId: number; // 0..3 for flood streams, -1/+1 for flank left/right
    // Local offsets on the vertical back array (right, up)
    arrRight: number;
    arrUp: number;
    arrFwd: number;
    // Target landing position in world coordinates
    landX: number;
    landY: number;
    landZ: number;
    water: boolean;
    // Organic curve variation
    curveSeed: number;
    offRight: number;
    offUp: number;
    size: number;
    roll: number;
    // Timing
    bloomStart: number;
    bloomEnd: number;
    launchStart: number;
    flight: number;
    // Impact state
    impactTangent: T.Vector3;
    impactRecorded: boolean;
    prevY?: number;
    struck: Set<number>;
    landedNotified: boolean;
}

interface SpireSpec {
    offsetX: number;
    offsetZ: number;
    tiltX: number;
    tiltZ: number;
    yaw: number;
    height: number;
    radius: number;
    delay: number;
}

function smooth01(edge0: number, edge1: number, x: number): number {
    if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
    const t = T.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function createDummyTexture(): T.DataTexture {
    const tex = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, T.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
}

function createStarFlareTexture(): T.Texture {
    if (typeof document === 'undefined') return createDummyTexture();
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    g.addColorStop(0.18, 'rgba(150, 248, 245, 0.88)');
    g.addColorStop(0.45, 'rgba(42, 195, 225, 0.36)');
    g.addColorStop(0.78, 'rgba(22, 95, 180, 0.08)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function createArrayMaterial(tex: T.Texture, isGround = false): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
        uniforms: {
            uMap: { value: tex },
            uTime: { value: 0 },
            uOpacity: { value: 0 },
            uReveal: { value: 1 },
            uSurge: { value: 0 },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform sampler2D uMap;
            uniform float uTime;
            uniform float uOpacity;
            uniform float uReveal;
            uniform float uSurge;
            varying vec2 vUv;
            void main() {
                if (uOpacity <= 0.004) discard;
                vec2 p = vUv * 2.0 - 1.0;
                float r = length(p);
                if (r > 1.0) discard;
                float reveal = smoothstep(uReveal + 0.08, uReveal - 0.14, r);
                vec4 texel = texture2D(uMap, vUv);
                float pulse = 0.94 + 0.06 * sin(uTime * 4.2 - r * 7.0);
                vec3 col = texel.rgb * (1.14 + 0.32 * uSurge);
                float alpha = texel.a * reveal * uOpacity * pulse * ${isGround ? '0.84' : '0.96'};
                if (alpha < 0.006) discard;
                gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => `nascent-flood-array-${isGround ? 'g' : 'v'}-v1`;
    return mat;
}

function createBackArrayBackdropMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float disc = 1.0 - smoothstep(0.45, 1.0, r);
                vec3 col = mix(vec3(0.03, 0.10, 0.30), vec3(0.08, 0.28, 0.62), 1.0 - r);
                gl_FragColor = vec4(col, disc * 0.44 * uOpacity);
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-flood-backdrop-v1';
    return mat;
}

/**
 * Crisp tapered sky-piercing sword-qi spire shader (Finale A — matching the crisscrossing cyan-white concept!).
 */
function createCrisscrossSpireMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
                vUv = uv;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            varying vec3 vN;
            varying vec3 vV;
            void main() {
                if (uOpacity <= 0.005) discard;
                float ndv = abs(dot(normalize(vN), normalize(vV)));
                // Sharp razor-bright core + wispy celadon-cyan outer plasma
                float core = pow(ndv, 2.2);
                float body = pow(ndv, 0.72);
                float wisps = 0.5 + 0.5 * sin(6.283 * (5.0 * vUv.x - 2.2 * vUv.y) + uTime * 14.0);
                float vertical = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
                float alpha = (body * (0.45 + 0.55 * pow(wisps, 2.0)) + core * 0.75) * vertical * uOpacity;
                if (alpha < 0.008) discard;
                vec3 cyan = vec3(0.14, 0.86, 0.94);
                vec3 jade = vec3(0.45, 0.98, 0.96);
                vec3 white = vec3(1.38, 1.44, 1.48);
                vec3 col = mix(cyan, jade, pow(wisps, 2.0));
                col = mix(col, white, clamp(core * 0.92 + (1.0 - vUv.y) * 0.35, 0.0, 1.0));
                gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-flood-spire-v1';
    return mat;
}

function createShockRingMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float wisp = 0.75 + 0.25 * sin(a * 14.0 - uTime * 6.0);
                float outer = exp(-pow((r - 0.88) / 0.052, 2.0)) * wisp;
                float mid = exp(-pow((r - 0.66) / 0.085, 2.0)) * 0.45;
                float alpha = (outer + mid) * (1.0 - smoothstep(0.95, 1.0, r)) * uOpacity;
                if (alpha < 0.006) discard;
                vec3 col = mix(vec3(0.24, 0.88, 0.98), vec3(1.18, 1.24, 1.28), outer * 0.72);
                gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-flood-shockring-v1';
    return mat;
}

/**
 * Delicate wispy curved airflow ribbons weaving through the 4 flood streams (whisper-thin, feathered, never thick lasers!).
 */
class WispyFlowRibbons {
    readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
    private readonly posArr: Float32Array;
    private readonly nextArr: Float32Array;
    private readonly prevArr: Float32Array;
    private readonly alphaArr: Float32Array;
    private readonly posAttr: T.BufferAttribute;
    private readonly nextAttr: T.BufferAttribute;
    private readonly prevAttr: T.BufferAttribute;
    private readonly alphaAttr: T.BufferAttribute;

    constructor(private count: number, private segs: number) {
        const vpr = (segs + 1) * 2;
        const total = count * vpr;
        this.posArr = new Float32Array(total * 3);
        this.nextArr = new Float32Array(total * 3);
        this.prevArr = new Float32Array(total * 3);
        this.alphaArr = new Float32Array(total);
        const sideArr = new Float32Array(total);
        const uArr = new Float32Array(total);
        const indices: number[] = [];

        for (let r = 0; r < count; r++) {
            const base = r * vpr;
            for (let i = 0; i <= segs; i++) {
                const u = i / segs;
                const v0 = base + i * 2;
                const v1 = v0 + 1;
                sideArr[v0] = -1;
                sideArr[v1] = 1;
                uArr[v0] = u;
                uArr[v1] = u;
                if (i < segs) indices.push(v0, v1, v0 + 2, v1, v1 + 2, v0 + 2);
            }
        }
        const geo = new T.BufferGeometry();
        this.posAttr = new T.BufferAttribute(this.posArr, 3);
        this.nextAttr = new T.BufferAttribute(this.nextArr, 3);
        this.prevAttr = new T.BufferAttribute(this.prevArr, 3);
        this.alphaAttr = new T.BufferAttribute(this.alphaArr, 1);
        this.posAttr.setUsage(T.DynamicDrawUsage);
        this.nextAttr.setUsage(T.DynamicDrawUsage);
        this.prevAttr.setUsage(T.DynamicDrawUsage);
        this.alphaAttr.setUsage(T.DynamicDrawUsage);
        geo.setAttribute('position', this.posAttr);
        geo.setAttribute('aNext', this.nextAttr);
        geo.setAttribute('aPrev', this.prevAttr);
        geo.setAttribute('aAlpha', this.alphaAttr);
        geo.setAttribute('aSide', new T.BufferAttribute(sideArr, 1));
        geo.setAttribute('aU', new T.BufferAttribute(uArr, 1));
        geo.setIndex(indices);

        const mat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            toneMapped: false,
            vertexShader: /* glsl */ `
                attribute vec3 aNext;
                attribute vec3 aPrev;
                attribute float aAlpha;
                attribute float aSide;
                attribute float aU;
                varying float vSide;
                varying float vU;
                varying float vAlpha;
                void main() {
                    vSide = aSide;
                    vU = aU;
                    vAlpha = aAlpha;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vec3 tang = (modelViewMatrix * vec4(aNext - aPrev, 0.0)).xyz;
                    vec3 side = normalize(cross(tang, mv.xyz) + vec3(1e-5, 0.0, 0.0));
                    float width = (0.14 + 0.12 * sin(aU * 3.1416)) * step(0.005, aAlpha);
                    mv.xyz += side * aSide * width;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                varying float vSide;
                varying float vU;
                varying float vAlpha;
                void main() {
                    if (vAlpha <= 0.006) discard;
                    float x = abs(vSide);
                    float feather = exp(-x * x * 6.5);
                    float ends = smoothstep(0.0, 0.14, vU) * (1.0 - smoothstep(0.76, 1.0, vU));
                    float alpha = feather * ends * vAlpha * 0.42;
                    if (alpha < 0.006) discard;
                    vec3 col = mix(vec3(0.24, 0.86, 0.98), vec3(0.92, 0.98, 1.0), feather * 0.65);
                    gl_FragColor = vec4(col, alpha);
                    #include <colorspace_fragment>
                }
            `,
        });
        mat.customProgramCacheKey = () => 'nascent-flood-wisps-v1';
        this.mesh = new T.Mesh(geo, mat);
        this.mesh.name = 'Nascent Sword Flood Wispy Ribbons';
        this.mesh.frustumCulled = false;
    }

    clear() {
        this.alphaArr.fill(0);
    }

    setRibbon(idx: number, pts: T.Vector3[], alpha: number) {
        if (idx >= this.count) return;
        const base = idx * (this.segs + 1) * 2;
        for (let i = 0; i <= this.segs; i++) {
            const p = pts[i];
            const pn = pts[Math.min(i + 1, this.segs)];
            const pp = pts[Math.max(i - 1, 0)];
            for (let s = 0; s < 2; s++) {
                const v = base + i * 2 + s;
                const o = v * 3;
                this.posArr[o] = p.x; this.posArr[o + 1] = p.y; this.posArr[o + 2] = p.z;
                this.nextArr[o] = pn.x; this.nextArr[o + 1] = pn.y; this.nextArr[o + 2] = pn.z;
                this.prevArr[o] = pp.x; this.prevArr[o + 1] = pp.y; this.prevArr[o + 2] = pp.z;
                this.alphaArr[v] = alpha;
            }
        }
    }

    upload() {
        this.posAttr.needsUpdate = true;
        this.nextAttr.needsUpdate = true;
        this.prevAttr.needsUpdate = true;
        this.alphaAttr.needsUpdate = true;
    }

    dispose() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

/**
 * 《云境》元婴期 · 万剑归宗 (Curved Sword-Flood + Slanted Sword Forest + Finale A Crisscross Sword-Qi Eruption)
 */
export class NascentSwordArray {
    private readonly group = new T.Group();
    private readonly dummyTex = createDummyTexture();
    private readonly loadedTextures: T.Texture[] = [];

    // 1) Giant Vertical Back Array behind caster
    private readonly backArrayRoot = new T.Group();
    private readonly backBackdrop: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly backOuterRing: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly backInnerRing: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;

    // 2) Remote Target Lock Ground Domain (20-85m ahead)
    private readonly targetDomain: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;

    // 3) Delicate Wispy Curved Airflow Ribbons
    private readonly wispyRibbons = new WispyFlowRibbons(WISPY_RIBBON_COUNT, WISPY_SEGS);
    private readonly ribbonPts: T.Vector3[] = Array.from({ length: WISPY_SEGS + 1 }, () => new T.Vector3());

    // 4) Finale A: Crisscrossing Slanted Sky-Piercing Sword-Qi Spires + Shockwaves + Crater + Embers
    private readonly finaleGroup = new T.Group();
    private readonly finaleCrater: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
    private readonly finaleRingA: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly finaleRingB: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly finaleFlash: T.Sprite;
    private readonly finaleFlashMat: T.SpriteMaterial;
    private readonly spireMat: T.ShaderMaterial;
    private readonly spireMeshes: T.Mesh<T.CylinderGeometry, T.ShaderMaterial>[] = [];
    private readonly spireSpecs: SpireSpec[] = [];
    private readonly finaleEmbers: T.InstancedMesh<T.OctahedronGeometry, T.MeshBasicMaterial>;
    private readonly emberSeeds: { vx: number; vy: number; vz: number; rot: number; scale: number }[] = [];
    private readonly starTex: T.Texture;

    // 5) Reused 1,200-tri Character Sword (AzureSword_Grip) InstancedMesh — solid metallic PBR!
    private bladeInstances?: T.InstancedMesh;
    private bladeMat?: T.MeshStandardMaterial;
    private bladeDown = new T.Quaternion();
    private tipOffset = 0;
    private bladeLength = 1.4;

    private readonly rainFx: SwordRainFX;
    private readonly blades: FloodSword[] = [];

    // Dynamic world anchors & basis
    private active = false;
    private disposed = false;
    private loadPromise?: Promise<void>;
    private time = 0;
    private finaleTriggered = false;

    private readonly arrayOrigin = new T.Vector3();
    private readonly targetCenter = new T.Vector3();
    private readonly floodForward = new T.Vector3(0, 0, -1);
    private readonly floodRight = new T.Vector3(1, 0, 0);
    private readonly framingCenter = new T.Vector3();
    private floodDist = 36;

    // Scratch math
    private readonly dummy = new T.Object3D();
    private readonly tmpStart = new T.Vector3();
    private readonly tmpPos = new T.Vector3();
    private readonly tmpNext = new T.Vector3();
    private readonly tmpPrev = new T.Vector3();
    private readonly tmpDir = new T.Vector3();
    private readonly tmpQuat = new T.Quaternion();
    private readonly tmpRollQuat = new T.Quaternion();

    constructor(
        scene: T.Scene,
        private surfaceAt: (x: number, z: number, fromY: number) => { height: number; water: boolean },
        private onContact?: (sword: SwordRainContact) => void,
        private onFinisherImpact?: (point: T.Vector3) => void,
    ) {
        this.group.name = '元婴 · 万剑归宗';
        this.group.visible = false;
        this.starTex = createStarFlareTexture();

        // 1) Giant Vertical Back Array (upright in local XY plane, facing +Z -> rotated to face target!)
        this.backBackdrop = new T.Mesh(
            new T.PlaneGeometry(ARRAY_RADIUS * 2.55, ARRAY_RADIUS * 2.55),
            createBackArrayBackdropMaterial(),
        );
        this.backBackdrop.position.z = -0.35;
        this.backOuterRing = new T.Mesh(
            new T.PlaneGeometry(ARRAY_RADIUS * 2.35, ARRAY_RADIUS * 2.35),
            createArrayMaterial(this.dummyTex, false),
        );
        this.backOuterRing.position.z = -0.15;
        this.backInnerRing = new T.Mesh(
            new T.PlaneGeometry(ARRAY_RADIUS * 1.48, ARRAY_RADIUS * 1.48),
            createArrayMaterial(this.dummyTex, false),
        );
        this.backInnerRing.position.z = 0.15;
        this.backArrayRoot.add(this.backBackdrop, this.backOuterRing, this.backInnerRing);

        // 2) Remote Target Lock Ground Domain
        this.targetDomain = new T.Mesh(
            new T.PlaneGeometry(34, 34),
            createArrayMaterial(this.dummyTex, true),
        );
        this.targetDomain.rotation.x = -Math.PI / 2;

        // 3) Finale A Group (Crisscrossing Slanted Sword-Qi Spires + Shockwaves + Crater + Embers)
        this.finaleCrater = new T.Mesh(
            new T.PlaneGeometry(34, 34),
            new T.MeshBasicMaterial({
                map: this.dummyTex,
                transparent: true,
                opacity: 0,
                blending: T.AdditiveBlending,
                depthWrite: false,
                side: T.DoubleSide,
                toneMapped: false,
            }),
        );
        this.finaleCrater.rotation.x = -Math.PI / 2;
        this.finaleCrater.position.y = 0.18;

        this.finaleRingA = new T.Mesh(new T.PlaneGeometry(2, 2), createShockRingMaterial());
        this.finaleRingA.rotation.x = -Math.PI / 2;
        this.finaleRingA.position.y = 0.26;
        this.finaleRingB = new T.Mesh(new T.PlaneGeometry(2, 2), createShockRingMaterial());
        this.finaleRingB.rotation.x = -Math.PI / 2;
        this.finaleRingB.position.y = 0.42;

        this.finaleFlashMat = new T.SpriteMaterial({
            map: this.starTex,
            color: 0xe6ffff,
            transparent: true,
            opacity: 0,
            blending: T.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
        });
        this.finaleFlash = new T.Sprite(this.finaleFlashMat);
        this.finaleFlash.position.y = 2.6;

        // 18 Crisscrossing Slanted Tapered Sword-Qi Spires (matching the Finale A concept image!)
        this.spireMat = createCrisscrossSpireMaterial();
        const spireGeo = new T.CylinderGeometry(0.06, 1.55, 1.0, 12, 1, true);
        spireGeo.translate(0, 0.5, 0);
        for (let i = 0; i < CRISSCROSS_SPIRE_COUNT; i++) {
            const isHero = i < 4;
            const ringR = isHero ? (i * 1.4) : (3.5 + ((i * 7) % 11) * 1.05);
            const az = (i / CRISSCROSS_SPIRE_COUNT) * Math.PI * 2 + (i % 3) * 0.45;
            // Dramatic oblique crisscross tilts (18..48 deg) crossing over the center!
            const tiltMag = isHero ? (0.22 + i * 0.08) : (0.34 + ((i * 13) % 10) * 0.052);
            const crossDir = az + Math.PI * 0.65 + (i % 2 === 0 ? 0.35 : -0.35);
            const spec: SpireSpec = {
                offsetX: Math.cos(az) * ringR,
                offsetZ: Math.sin(az) * ringR,
                tiltX: Math.cos(crossDir) * tiltMag,
                tiltZ: Math.sin(crossDir) * tiltMag,
                yaw: az,
                height: isHero ? (36 + i * 3.5) : (24 + ((i * 17) % 14)),
                radius: isHero ? (1.15 - i * 0.08) : (0.52 + ((i * 11) % 7) * 0.08),
                delay: isHero ? i * 0.03 : 0.04 + ((i * 5) % 9) * 0.025,
            };
            this.spireSpecs.push(spec);
            const mesh = new T.Mesh(spireGeo, this.spireMat);
            mesh.position.set(spec.offsetX, -0.3, spec.offsetZ);
            mesh.rotation.set(spec.tiltX, spec.yaw, spec.tiltZ);
            mesh.frustumCulled = false;
            this.spireMeshes.push(mesh);
            this.finaleGroup.add(mesh);
        }

        const emberGeo = new T.OctahedronGeometry(0.16, 0);
        emberGeo.scale(0.55, 2.3, 0.55);
        this.finaleEmbers = new T.InstancedMesh(
            emberGeo,
            new T.MeshBasicMaterial({
                color: 0xb8ffff,
                transparent: true,
                opacity: 0,
                blending: T.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            }),
            CLIMAX_EMBER_COUNT,
        );
        this.finaleEmbers.frustumCulled = false;
        this.finaleEmbers.count = 0;
        for (let i = 0; i < CLIMAX_EMBER_COUNT; i++) {
            const a = (i / CLIMAX_EMBER_COUNT) * Math.PI * 2 + (i % 7) * 0.14;
            const spd = 5.0 + ((i * 19) % 13) * 1.55;
            this.emberSeeds.push({
                vx: Math.cos(a) * spd,
                vy: 6.5 + ((i * 29) % 17) * 1.25,
                vz: Math.sin(a) * spd,
                rot: a,
                scale: 0.55 + ((i * 11) % 10) * 0.13,
            });
        }

        this.finaleGroup.visible = false;
        this.finaleGroup.add(
            this.finaleCrater,
            this.finaleRingA,
            this.finaleRingB,
            this.finaleFlash,
            this.finaleEmbers,
        );

        this.rainFx = new SwordRainFX(this.group, MAX_BLADES);

        this.group.add(
            this.backArrayRoot,
            this.targetDomain,
            this.wispyRibbons.mesh,
            this.finaleGroup,
        );
        scene.add(this.group);
    }

    load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = this.loadAssets();
        return this.loadPromise;
    }

    private async loadAssets() {
        const texLoader = new T.TextureLoader();
        const [, outerTex, innerTex, craterTex] = await Promise.all([
            this.rainFx.load(),
            texLoader.loadAsync(OUTER_ARRAY_TEX_URL),
            texLoader.loadAsync(INNER_ARRAY_TEX_URL),
            texLoader.loadAsync(CLIMAX_CRATER_TEX_URL),
        ]);
        if (this.disposed) {
            for (const tex of [outerTex, innerTex, craterTex]) tex.dispose();
            return;
        }
        for (const tex of [outerTex, innerTex, craterTex]) {
            tex.colorSpace = T.SRGBColorSpace;
            tex.needsUpdate = true;
            this.loadedTextures.push(tex);
        }
        this.backOuterRing.material.uniforms.uMap.value = outerTex;
        this.backInnerRing.material.uniforms.uMap.value = innerTex;
        this.targetDomain.material.uniforms.uMap.value = outerTex;
        this.finaleCrater.material.map = craterTex;
        this.finaleCrater.material.needsUpdate = true;
    }

    attachSharedBlade(geometry: T.BufferGeometry, tip: T.Object3D, bladeDown: T.Quaternion, tipOffset: number, bladeLength: number) {
        this.bladeDown.copy(bladeDown);
        this.tipOffset = tipOffset;
        this.bladeLength = bladeLength;

        this.bladeMat = new T.MeshStandardMaterial({
            vertexColors: true,
            color: new T.Color(0xeef6ff),
            metalness: 0.34,
            roughness: 0.34,
            emissive: new T.Color(0x3a82b5),
            emissiveIntensity: 0.34,
            side: T.DoubleSide,
        });
        const inst = new T.InstancedMesh(geometry, this.bladeMat, MAX_BLADES);
        inst.name = 'Nascent Sword Flood · Character Swords';
        inst.count = 0;
        inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
        inst.frustumCulled = false;
        inst.castShadow = false;
        inst.receiveShadow = false;
        this.bladeInstances = inst;
        this.group.add(inst);
    }

    get isActive(): boolean {
        return this.active;
    }

    get warmObjects(): T.Object3D[] {
        return [this.group];
    }

    get framing() {
        if (!this.active) return undefined;
        // Frame the heroic vertical back array + sweeping flood early, and ease cleanly during Finale A
        const w = smooth01(0.0, 0.65, this.time) * (1 - smooth01(7.8, 9.2, this.time)) * 0.78;
        if (w <= 0.01) return undefined;
        return {
            center: this.framingCenter,
            weight: w,
            radius: 17.0,
            fullWeightWithin: 12,
            fadeBeyond: 28,
        };
    }

    start(position: T.Vector3, focusTargets?: T.Vector3[], playerHeading = 0) {
        void this.load();
        this.clear();
        this.active = true;
        this.time = 0;
        this.finaleTriggered = false;

        // Character's true body facing vector (chest -> forward, back -> -casterForward)
        const casterForward = new T.Vector3(Math.sin(playerHeading), 0, -Math.cos(playerHeading)).normalize();
        const validTargets = focusTargets && focusTargets.length > 0 ? focusTargets : undefined;

        // Determine forward direction & dynamic long-range target centroid (16m..95m!)
        if (validTargets) {
            let cx = 0, cz = 0;
            for (const tgt of validTargets) {
                cx += tgt.x;
                cz += tgt.z;
            }
            cx /= validTargets.length;
            cz /= validTargets.length;
            const dx = cx - position.x;
            const dz = cz - position.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 3.0) {
                this.floodForward.set(dx / dist, 0, dz / dist);
                this.floodDist = T.MathUtils.clamp(dist, 16, 95);
            } else {
                this.floodForward.copy(casterForward);
                this.floodDist = 38;
            }
        } else {
            this.floodForward.copy(casterForward);
            this.floodDist = 42;
        }
        this.floodRight.crossVectors(this.floodForward, UP).normalize();

        // Strictly anchor giant vertical array directly BEHIND the character's back!
        this.arrayOrigin.set(
            position.x - casterForward.x * 2.5,
            position.y + 6.4,
            position.z - casterForward.z * 2.5,
        );
        const tx = position.x + this.floodForward.x * this.floodDist;
        const tz = position.z + this.floodForward.z * this.floodDist;
        const targetSurf = this.surfaceAt(tx, tz, this.arrayOrigin.y + 18);
        this.targetCenter.set(tx, targetSurf.height, tz);

        this.framingCenter.copy(this.arrayOrigin).lerp(this.targetCenter, 0.32);

        // Orient vertical back array upright behind the character's back, facing forward along floodForward
        this.backArrayRoot.position.copy(this.arrayOrigin);
        this.backArrayRoot.lookAt(
            this.arrayOrigin.x + this.floodForward.x * 10,
            this.arrayOrigin.y,
            this.arrayOrigin.z + this.floodForward.z * 10,
        );

        // Position remote target lock domain & Finale A eruption group at targetCenter
        this.targetDomain.position.set(this.targetCenter.x, this.targetCenter.y + 0.16, this.targetCenter.z);
        this.finaleGroup.position.copy(this.targetCenter);

        this.buildChoreographedFlood(validTargets);
        this.group.visible = true;
    }

    private buildChoreographedFlood(lockedTargets?: T.Vector3[]) {
        this.blades.length = 0;
        const distScale = this.floodDist / 38.0;

        for (let i = 0; i < MAX_BLADES; i++) {
            const role: WaveRole = i < VANGUARD_COUNT
                ? 'vanguard'
                : i < VANGUARD_COUNT + FLOOD_COUNT
                    ? 'flood'
                    : 'flank';

            // Radial bloom position across the giant vertical back array (golden angle spiral from center!)
            const frac = i / MAX_BLADES;
            const ang = i * 2.399963 + (Math.random() - 0.5) * 0.14;
            const rad = 0.85 + Math.sqrt(frac) * (ARRAY_RADIUS - 0.55);
            const arrRight = Math.cos(ang) * rad;
            const arrUp = Math.sin(ang) * rad * 0.92;
            const arrFwd = 0.45 + (Math.random() - 0.5) * 0.55;

            let streamId = 1;
            let landX = this.targetCenter.x;
            let landZ = this.targetCenter.z;
            let launchStart = T_FLOOD_START;
            let flight = 1.35;

            if (lockedTargets && lockedTargets.length > 0) {
                // Randomly lock each sword onto one of the Divine-Sense-detected monsters within the forward 45° cone!
                const chosen = lockedTargets[Math.floor(Math.random() * lockedTargets.length)];
                const tDist = Math.hypot(chosen.x - this.arrayOrigin.x, chosen.z - this.arrayOrigin.z);
                const tScale = T.MathUtils.clamp(tDist / 38.0, 0.5, 2.2);

                if (role === 'vanguard') {
                    const vf = i / VANGUARD_COUNT;
                    const ringA = vf * Math.PI * 2;
                    const ringR = 2.2 + Math.random() * 2.8;
                    streamId = i % 2;
                    landX = chosen.x + Math.cos(ringA) * ringR;
                    landZ = chosen.z + Math.sin(ringA) * ringR;
                    launchStart = T_VANGUARD_START + vf * 0.45;
                    flight = T.MathUtils.clamp(0.72 * Math.sqrt(tScale) + Math.random() * 0.12, 0.55, 1.35);
                } else if (role === 'flood') {
                    const fi = i - VANGUARD_COUNT;
                    const ff = fi / FLOOD_COUNT;
                    const pick = Math.random();
                    streamId = pick < 0.24 ? 0 : pick < 0.62 ? 1 : pick < 0.84 ? 2 : 3;
                    const scatterR = Math.sqrt(Math.random()) * 2.6;
                    const scatterA = Math.random() * Math.PI * 2;
                    landX = chosen.x + Math.cos(scatterA) * scatterR;
                    landZ = chosen.z + Math.sin(scatterA) * scatterR;
                    launchStart = T_FLOOD_START + ff * 2.35 + (Math.random() - 0.5) * 0.08;
                    flight = T.MathUtils.clamp((0.98 + Math.random() * 0.25) * Math.sqrt(tScale), 0.72, 1.75);
                } else {
                    const ki = i - VANGUARD_COUNT - FLOOD_COUNT;
                    const kf = ki / FLANK_COUNT;
                    streamId = ki % 2 === 0 ? 1 : -1;
                    const scatterR = 0.8 + Math.random() * 2.2;
                    const scatterA = Math.random() * Math.PI * 2;
                    landX = chosen.x + Math.cos(scatterA) * scatterR;
                    landZ = chosen.z + Math.sin(scatterA) * scatterR;
                    launchStart = T_FLANK_START + kf * 0.85;
                    flight = T.MathUtils.clamp((1.18 + Math.random() * 0.22) * Math.sqrt(tScale), 0.88, 1.85);
                }
            } else {
                let landOffFwd = 0;
                let landOffRight = 0;
                if (role === 'vanguard') {
                    const vf = i / VANGUARD_COUNT;
                    const ringA = vf * Math.PI * 2;
                    const ringR = 11.5 + (Math.random() - 0.5) * 2.2;
                    streamId = i % 2;
                    landOffFwd = Math.cos(ringA) * ringR;
                    landOffRight = Math.sin(ringA) * ringR;
                    launchStart = T_VANGUARD_START + vf * 0.45;
                    flight = T.MathUtils.clamp(0.75 * Math.sqrt(distScale) + Math.random() * 0.12, 0.65, 1.25);
                } else if (role === 'flood') {
                    const fi = i - VANGUARD_COUNT;
                    const ff = fi / FLOOD_COUNT;
                    const pick = Math.random();
                    streamId = pick < 0.24 ? 0 : pick < 0.62 ? 1 : pick < 0.84 ? 2 : 3;
                    const spreadR = Math.sqrt(Math.random()) * 13.5;
                    const spreadA = fi * 2.399963 + (Math.random() - 0.5) * 0.25;
                    landOffFwd = Math.cos(spreadA) * spreadR + (streamId === 0 ? 3.5 : streamId === 2 ? -3.0 : 0);
                    landOffRight = Math.sin(spreadA) * spreadR;
                    launchStart = T_FLOOD_START + ff * 2.35 + (Math.random() - 0.5) * 0.08;
                    flight = T.MathUtils.clamp((1.05 + Math.random() * 0.28) * Math.sqrt(distScale), 0.90, 1.75);
                } else {
                    const ki = i - VANGUARD_COUNT - FLOOD_COUNT;
                    const kf = ki / FLANK_COUNT;
                    streamId = ki % 2 === 0 ? 1 : -1;
                    const sideA = (streamId > 0 ? 0.5 : -0.5) * Math.PI + (Math.random() - 0.5) * 0.85;
                    const sideR = 5.5 + Math.random() * 7.5;
                    landOffFwd = Math.cos(sideA) * sideR;
                    landOffRight = Math.sin(sideA) * sideR;
                    launchStart = T_FLANK_START + kf * 0.85;
                    flight = T.MathUtils.clamp((1.25 + Math.random() * 0.22) * Math.sqrt(distScale), 1.05, 1.85);
                }
                landX = this.targetCenter.x + this.floodForward.x * landOffFwd + this.floodRight.x * landOffRight;
                landZ = this.targetCenter.z + this.floodForward.z * landOffFwd + this.floodRight.z * landOffRight;
            }

            const surf = this.surfaceAt(landX, landZ, Math.max(this.arrayOrigin.y, this.targetCenter.y) + 22);

            const bloomStart = T_BLOOM_START + frac * 0.72;
            this.blades.push({
                role,
                streamId,
                arrRight,
                arrUp,
                arrFwd,
                landX,
                landY: surf.height,
                landZ,
                water: surf.water,
                curveSeed: Math.random() * 6.283,
                offRight: (Math.random() - 0.5) * 2.2,
                offUp: (Math.random() - 0.5) * 1.8,
                size: role === 'vanguard' ? 2.85 : (2.35 + Math.random() * 0.70),
                roll: (Math.random() - 0.5) * 0.45,
                bloomStart,
                bloomEnd: bloomStart + 0.48,
                launchStart,
                flight,
                impactTangent: new T.Vector3(0, -1, 0),
                impactRecorded: false,
                struck: new Set(),
                landedNotified: false,
            });
        }
    }

    /** World start position of a blade on the giant vertical back array. */
    private getArrayWorldPos(arrRight: number, arrUp: number, arrFwd: number, out: T.Vector3): T.Vector3 {
        return out.set(
            this.arrayOrigin.x + this.floodRight.x * arrRight + this.floodForward.x * arrFwd,
            this.arrayOrigin.y + arrUp,
            this.arrayOrigin.z + this.floodRight.z * arrRight + this.floodForward.z * arrFwd,
        );
    }

    /**
     * Evaluates a smooth 3D curved flood trajectory from the high vertical back array
     * sweeping across the battlefield and plunging obliquely into the ground!
     */
    private evalSwordCurve(b: FloodSword, u: number, out: T.Vector3): T.Vector3 {
        this.getArrayWorldPos(b.arrRight, b.arrUp, b.arrFwd, this.tmpStart);
        const sx = this.tmpStart.x, sy = this.tmpStart.y, sz = this.tmpStart.z;

        const baseX = T.MathUtils.lerp(sx, b.landX, u);
        const baseZ = T.MathUtils.lerp(sz, b.landZ, u);
        // Stay high across the first half of flight, then plunge steeply into the earth for dramatic slanted impact!
        const dropPow = Math.pow(u, 1.92);
        const baseY = sy * (1 - dropPow) + b.landY * dropPow;

        const env = Math.sin(u * Math.PI);
        const scaleDist = T.MathUtils.clamp(this.floodDist / 36, 0.75, 1.85);
        let waveRight = 0;
        let waveUp = 0;

        if (b.role === 'vanguard') {
            waveUp = 5.5 * env * scaleDist;
            waveRight = Math.sin(u * Math.PI * 1.2) * b.offRight * env;
        } else if (b.role === 'flank') {
            // Sweeping wide 180-deg enveloping side arc!
            waveRight = b.streamId * (14.0 * scaleDist) * Math.sin(u * Math.PI * 0.95) * env;
            waveUp = (5.0 + b.offUp) * env;
        } else {
            // 4 Intertwining Flood Streams (matching Blender preview & hand-drawn sketch!)
            if (b.streamId === 0) {
                waveRight = Math.sin(u * Math.PI * 1.45 + 0.3) * 4.6 * env + b.offRight * env;
                waveUp = (7.2 * Math.sin(u * Math.PI * 0.92) + 1.2 * Math.sin(u * Math.PI * 2.0)) * env + b.offUp * env;
            } else if (b.streamId === 1) {
                waveRight = (-Math.sin(u * Math.PI * 1.3) * 4.2 + Math.sin(u * Math.PI * 2.3) * 1.5) * env + b.offRight * env;
                waveUp = (3.4 * Math.sin(u * Math.PI) - 1.5 * Math.sin(u * Math.PI * 2.0)) * env + b.offUp * env;
            } else if (b.streamId === 2) {
                waveRight = Math.sin(u * Math.PI * 1.6 - 0.7) * 3.8 * env + b.offRight * env;
                waveUp = (-2.2 * Math.sin(u * Math.PI * 1.15) + 1.5 * Math.sin(u * Math.PI * 2.2)) * env + b.offUp * env;
            } else {
                const ang = u * Math.PI * 2.0 + b.curveSeed;
                const rad = (1.8 + 3.4 * env) * env;
                waveRight = Math.cos(ang) * rad + b.offRight * 0.5 * env;
                waveUp = Math.sin(ang) * rad * 0.75 + 2.5 * env + b.offUp * 0.5 * env;
            }
        }

        return out.set(
            baseX + this.floodRight.x * waveRight,
            Math.max(b.landY, baseY + waveUp),
            baseZ + this.floodRight.z * waveRight,
        );
    }

    update(dt: number) {
        if (!this.active) return;

        this.time += dt;
        if (this.time >= T_TOTAL_DURATION) {
            this.clear();
            return;
        }

        const t = this.time;
        const arrayFadeIn = smooth01(0.0, 0.42, t);
        const arrayFadeOut = 1 - smooth01(6.8, 8.6, t);
        const arrayAlpha = arrayFadeIn * arrayFadeOut;
        const floodSurge = smooth01(T_FLOOD_START - 0.1, T_FLOOD_START + 0.35, t) * (1 - smooth01(5.2, 6.2, t));
        const resPulse = smooth01(T_RESONANCE_START, T_FINALE_ERUPT, t);

        // 1) Update Giant Vertical Back Array behind caster
        const expand = smooth01(0.0, 0.65, t);
        const surgeBoost = 1.0 + 0.14 * floodSurge;
        this.backArrayRoot.visible = arrayAlpha > 0.005;
        if (this.backArrayRoot.visible) {
            this.backBackdrop.scale.setScalar((0.25 + 0.75 * expand) * surgeBoost);
            this.backBackdrop.material.uniforms.uOpacity.value = arrayAlpha;

            this.backOuterRing.scale.setScalar((0.22 + 0.78 * expand) * surgeBoost);
            this.backOuterRing.rotation.z = t * 0.38;
            this.backOuterRing.material.uniforms.uTime.value = t;
            this.backOuterRing.material.uniforms.uOpacity.value = arrayAlpha;
            this.backOuterRing.material.uniforms.uReveal.value = expand;
            this.backOuterRing.material.uniforms.uSurge.value = floodSurge;

            this.backInnerRing.scale.setScalar((0.16 + 0.84 * smooth01(0.12, 0.82, t)) * surgeBoost);
            this.backInnerRing.rotation.z = -t * 0.68;
            this.backInnerRing.material.uniforms.uTime.value = t;
            this.backInnerRing.material.uniforms.uOpacity.value = arrayAlpha;
            this.backInnerRing.material.uniforms.uReveal.value = smooth01(0.10, 0.85, t);
            this.backInnerRing.material.uniforms.uSurge.value = floodSurge;
        }

        // 2) Update Remote Target Lock Ground Domain
        const domainAlpha = smooth01(0.18, 0.85, t) * (1 - smooth01(7.8, 9.4, t));
        this.targetDomain.visible = domainAlpha > 0.005;
        if (this.targetDomain.visible) {
            this.targetDomain.rotation.z = -t * 0.28;
            this.targetDomain.material.uniforms.uTime.value = t;
            this.targetDomain.material.uniforms.uOpacity.value = domainAlpha;
            this.targetDomain.material.uniforms.uReveal.value = smooth01(0.18, 1.15, t);
            this.targetDomain.material.uniforms.uSurge.value = resPulse;
        }

        // 3) Update 220 Real Character Swords & Delicate Wispy Curved Airflow Ribbons
        this.updateSwordsAndWisps(t, resPulse);

        // 4) Update Finale A: Crisscrossing Slanted Sky-Piercing Sword-Qi Eruption!
        this.updateFinaleA(t);
    }

    private updateSwordsAndWisps(t: number, resPulse: number) {
        if (!this.bladeInstances || !this.bladeMat) return;
        this.rainFx.clear();
        this.wispyRibbons.clear();

        // Keep bright metallic steel look during flight/forest; pulse bright cyan-white during Phase 3 resonance!
        this.bladeMat.emissiveIntensity = 0.34 + resPulse * 0.95;

        const dissolveFade = 1 - smooth01(T_FINALE_ERUPT + 0.15, T_FINALE_ERUPT + 1.15, t);
        let bladeCount = 0;

        for (let i = 0; i < this.blades.length; i++) {
            const b = this.blades[i];
            if (t < b.bloomStart || dissolveFade <= 0.01) continue;

            // Phase 1: Radial bloom outward from vertical back array center
            if (t < b.launchStart) {
                const bp = smooth01(b.bloomStart, b.bloomEnd, t);
                const rScale = bp;
                this.getArrayWorldPos(b.arrRight * rScale, b.arrUp * rScale, b.arrFwd * rScale, this.tmpPos);
                // Subtle poised hum before launch
                const hum = bp * 0.03 * Math.sin(t * 36 + i * 1.9);
                this.tmpPos.y += hum;
                this.placeBlade(bladeCount++, this.tmpPos, this.floodForward, b.roll, b.size * (0.25 + 0.75 * bp));
                continue;
            }

            // Phase 2 & 3: Curved Flood Flight (strictly tangent-aligned!) -> Slanted Ground Embedding
            const flyAge = t - b.launchStart;
            const rawP = Math.min(flyAge / b.flight, 1);
            const u = rawP * (0.36 + 0.64 * rawP); // Smooth flood acceleration
            const landedFor = flyAge - b.flight;

            if (landedFor < 0) {
                this.evalSwordCurve(b, u, this.tmpPos);
                this.evalSwordCurve(b, Math.min(1, u + 0.015), this.tmpNext);
                this.evalSwordCurve(b, Math.max(0, u - 0.015), this.tmpPrev);
                this.tmpDir.subVectors(this.tmpNext, this.tmpPrev);
                if (this.tmpDir.lengthSq() < 1e-5) this.tmpDir.copy(this.floodForward);
                else this.tmpDir.normalize();

                const prevY = b.prevY ?? this.tmpPos.y;
                if (this.tmpPos.y < prevY) {
                    b.prevY = this.tmpPos.y;
                    this.onContact?.({
                        x: this.tmpPos.x,
                        z: this.tmpPos.z,
                        fromY: prevY,
                        toY: this.tmpPos.y,
                        landed: false,
                        struck: b.struck,
                    });
                }

                this.placeBlade(bladeCount++, this.tmpPos, this.tmpDir, b.roll, b.size);
            } else {
                // Record exact slanted impact tangent once at landing!
                if (!b.impactRecorded) {
                    b.impactRecorded = true;
                    this.evalSwordCurve(b, 1.0, this.tmpNext);
                    this.evalSwordCurve(b, 0.96, this.tmpPrev);
                    b.impactTangent.subVectors(this.tmpNext, this.tmpPrev);
                    if (b.impactTangent.lengthSq() < 1e-5) b.impactTangent.set(0, -1, 0);
                    else b.impactTangent.normalize();
                }
                if (!b.landedNotified) {
                    b.landedNotified = true;
                    this.onContact?.({
                        x: b.landX,
                        z: b.landZ,
                        fromY: b.prevY ?? (b.landY + 1.5),
                        toY: b.landY,
                        landed: true,
                        struck: b.struck,
                    });
                }

                // Sink ~42% of blade into earth along its exact slanted impact tangent!
                const sink = smooth01(0, 0.08, landedFor) * this.bladeLength * b.size * 0.42;
                const vib = resPulse > 0 ? (0.04 + 0.09 * resPulse) * Math.sin(t * 72 + i * 2.7) : 0;
                this.tmpPos.set(
                    b.landX + b.impactTangent.x * sink + vib,
                    b.landY + b.impactTangent.y * sink,
                    b.landZ + b.impactTangent.z * sink - vib * 0.7,
                );
                this.placeBlade(bladeCount++, this.tmpPos, b.impactTangent, b.roll, b.size * dissolveFade);

                if (landedFor < 0.54) {
                    this.rainFx.impact(b.landX, b.landY, b.landZ, b.curveSeed, landedFor, 0.85, b.water);
                }
            }
        }

        // Update 20 delicate wispy curved airflow ribbons surging along the flood streams!
        for (let r = 0; r < WISPY_RIBBON_COUNT; r++) {
            const b = this.blades[VANGUARD_COUNT + Math.floor((r / WISPY_RIBBON_COUNT) * FLOOD_COUNT)];
            if (!b) continue;
            const age = t - b.launchStart;
            if (age < 0 || age > b.flight + 0.65) continue;
            const headU = Math.min(1, (age / b.flight) * (0.36 + 0.64 * Math.min(1, age / b.flight)));
            const tailU = Math.max(0, headU - 0.52);
            const alpha = smooth01(0, 0.18, age) * (1 - smooth01(b.flight, b.flight + 0.62, age));
            if (alpha <= 0.01) continue;
            for (let s = 0; s <= WISPY_SEGS; s++) {
                const su = T.MathUtils.lerp(tailU, headU, s / WISPY_SEGS);
                this.evalSwordCurve(b, su, this.ribbonPts[s]);
            }
            this.wispyRibbons.setRibbon(r, this.ribbonPts, alpha);
        }

        this.bladeInstances.count = bladeCount;
        this.bladeInstances.instanceMatrix.needsUpdate = true;
        this.wispyRibbons.upload();
        this.rainFx.upload();
    }

    private placeBlade(index: number, tipWorld: T.Vector3, dir: T.Vector3, roll: number, size: number) {
        if (!this.bladeInstances || index >= MAX_BLADES) return;
        this.dummy.position.set(
            tipWorld.x - dir.x * this.tipOffset * size,
            tipWorld.y - dir.y * this.tipOffset * size,
            tipWorld.z - dir.z * this.tipOffset * size,
        );
        this.tmpQuat.setFromUnitVectors(DOWN, dir);
        this.tmpRollQuat.setFromAxisAngle(UP, roll);
        this.dummy.quaternion.copy(this.tmpQuat).multiply(this.tmpRollQuat).multiply(this.bladeDown);
        this.dummy.scale.setScalar(size);
        this.dummy.updateMatrix();
        this.bladeInstances.setMatrixAt(index, this.dummy.matrix);
    }

    private updateFinaleA(t: number) {
        if (!this.finaleTriggered && t >= T_FINALE_ERUPT) {
            this.finaleTriggered = true;
            this.onFinisherImpact?.(this.targetCenter);
        }

        const age = t - T_FINALE_ERUPT;
        if (age < 0 || age > 3.0) {
            this.finaleGroup.visible = false;
            this.finaleEmbers.count = 0;
            return;
        }

        this.finaleGroup.visible = true;
        const p = age / 3.0;

        // 1) 18 Crisscrossing Slanted Sky-Piercing Sword-Qi Spires!
        this.spireMat.uniforms.uTime.value = t;
        this.spireMat.uniforms.uOpacity.value = smooth01(0, 0.12, age) * Math.pow(Math.max(0, 1 - p), 1.35);
        for (let i = 0; i < this.spireMeshes.length; i++) {
            const spec = this.spireSpecs[i];
            const sa = Math.max(0, age - spec.delay);
            const shoot = smooth01(0, 0.24, sa);
            const shrink = 1 - smooth01(0.45, 1.0, p) * 0.55;
            const mesh = this.spireMeshes[i];
            mesh.visible = sa > 0;
            if (mesh.visible) {
                mesh.scale.set(spec.radius * shrink, Math.max(0.01, spec.height * shoot), spec.radius * shrink);
            }
        }

        // 2) Glowing Ground Fissure Crater
        const craterGrow = 0.45 + 0.55 * smooth01(0, 0.26, age);
        this.finaleCrater.scale.setScalar(craterGrow);
        this.finaleCrater.material.opacity = smooth01(0, 0.08, age) * Math.pow(Math.max(0, 1 - p), 1.15);

        // 3) Dual Concentric Expanding Shockwave Rings
        const r1 = Math.min(age / 1.35, 1);
        this.finaleRingA.scale.setScalar(2.5 + 32.0 * (1 - Math.pow(1 - r1, 2.3)));
        this.finaleRingA.material.uniforms.uTime.value = t;
        this.finaleRingA.material.uniforms.uOpacity.value = Math.pow(1 - r1, 1.8) * 0.96;

        const r2 = Math.min(Math.max(0, age - 0.16) / 1.55, 1);
        this.finaleRingB.scale.setScalar(2.0 + 38.0 * (1 - Math.pow(1 - r2, 1.9)));
        this.finaleRingB.material.uniforms.uTime.value = t;
        this.finaleRingB.material.uniforms.uOpacity.value = r2 > 0 ? Math.pow(1 - r2, 1.7) * 0.85 : 0;

        // 4) Central Eruption Flash
        const flashP = Math.min(age / 0.65, 1);
        const flashS = 11.0 + 20.0 * (1 - Math.pow(1 - flashP, 2));
        this.finaleFlash.scale.set(flashS, flashS, 1);
        this.finaleFlashMat.opacity = Math.pow(1 - flashP, 2.1) * 0.95;

        // 5) Blasted Rising Cyan-White Spirit Embers
        const emberOp = smooth01(0, 0.08, age) * Math.pow(Math.max(0, 1 - p), 1.2);
        (this.finaleEmbers.material as T.MeshBasicMaterial).opacity = emberOp;
        const dummy = this.dummy;
        for (let i = 0; i < CLIMAX_EMBER_COUNT; i++) {
            const s = this.emberSeeds[i];
            const drag = 1 - Math.exp(-age * 1.4);
            dummy.position.set(
                s.vx * drag * 1.45,
                0.4 + s.vy * age - 1.6 * age * age * 0.45,
                s.vz * drag * 1.45,
            );
            dummy.rotation.set(age * 2.5, s.rot + age * 1.8, age * 1.4);
            dummy.scale.setScalar(s.scale * (1 - p * 0.65));
            dummy.updateMatrix();
            this.finaleEmbers.setMatrixAt(i, dummy.matrix);
        }
        this.finaleEmbers.count = CLIMAX_EMBER_COUNT;
        this.finaleEmbers.instanceMatrix.needsUpdate = true;
    }

    collectLights(pool: SpellLightPool) {
        if (!this.active) return;
        const t = this.time;
        const arrFade = smooth01(0, 0.35, t) * (1 - smooth01(6.8, 8.6, t));
        if (arrFade > 0.02) {
            pool.emit({
                x: this.arrayOrigin.x,
                y: this.arrayOrigin.y,
                z: this.arrayOrigin.z,
                color: 0x389eff,
                intensity: 44 * arrFade,
                distance: 32,
                priority: 92,
                castShadow: false,
            });
        }
        const domFade = smooth01(0.2, 0.8, t) * (1 - smooth01(7.8, 9.4, t));
        if (domFade > 0.02) {
            pool.emit({
                x: this.targetCenter.x,
                y: this.targetCenter.y + 4.5,
                z: this.targetCenter.z,
                color: 0x42e8f5,
                intensity: 38 * domFade,
                distance: 36,
                priority: 96,
                castShadow: false,
            });
        }
        const fAge = t - T_FINALE_ERUPT;
        if (fAge >= 0 && fAge < 2.0) {
            const flash = Math.pow(1 - fAge / 2.0, 1.7);
            pool.emit({
                x: this.targetCenter.x,
                y: this.targetCenter.y + 5.5,
                z: this.targetCenter.z,
                color: 0xa8ffff,
                intensity: 135 * flash,
                distance: 54,
                priority: 112,
                castShadow: false,
            });
        }
    }

    clear() {
        this.active = false;
        this.time = 0;
        this.finaleTriggered = false;
        this.group.visible = false;
        this.finaleGroup.visible = false;
        this.blades.length = 0;
        if (this.bladeInstances) this.bladeInstances.count = 0;
        this.finaleEmbers.count = 0;
        this.wispyRibbons.clear();
        this.wispyRibbons.upload();
        this.rainFx.clear();
    }

    dispose() {
        this.disposed = true;
        this.clear();
        this.group.removeFromParent();
        this.backBackdrop.geometry.dispose();
        this.backBackdrop.material.dispose();
        this.backOuterRing.geometry.dispose();
        this.backOuterRing.material.dispose();
        this.backInnerRing.geometry.dispose();
        this.backInnerRing.material.dispose();
        this.targetDomain.geometry.dispose();
        this.targetDomain.material.dispose();
        this.wispyRibbons.dispose();
        this.finaleCrater.geometry.dispose();
        this.finaleCrater.material.dispose();
        this.finaleRingA.geometry.dispose();
        this.finaleRingA.material.dispose();
        this.finaleRingB.geometry.dispose();
        this.finaleRingB.material.dispose();
        this.finaleFlashMat.dispose();
        if (this.spireMeshes.length) this.spireMeshes[0].geometry.dispose();
        this.spireMat.dispose();
        this.finaleEmbers.geometry.dispose();
        (this.finaleEmbers.material as T.Material).dispose();
        this.finaleEmbers.dispose();
        this.starTex.dispose();
        this.dummyTex.dispose();
        for (const tex of this.loadedTextures) tex.dispose();
        if (this.bladeInstances) this.bladeInstances.dispose();
        this.bladeMat?.dispose();
        this.rainFx.dispose();
    }
}
