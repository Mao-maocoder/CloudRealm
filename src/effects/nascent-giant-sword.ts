import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { traceFireballWorld, type SampleGround } from './fireball-trajectory';
import type { SpellLightPool } from './spell-lights';

const modelUrl = new URL('../../resource/skill/giant-sword/Nascent_GiantSword.glb', import.meta.url).href;

const fps = 30;
const releaseTime = (104 - 1) / fps;
const sonicTime = (109 - 1) / fps;
const impactTime = (130 - 1) / fps;
const gravity = 46;
const sonicSpeed = 5.2;
const topSpeed = 88;
const embedDepth = .24;
const up = new T.Vector3(0, 1, 0);

const TRAIL_STEPS = 4;
const TRAIL_STEP_DT = 0.068;
const FORGE_MOTE_COUNT = 56;
const IMPACT_EMBER_COUNT = 48;

interface Layer {
    root: T.Object3D;
    mixer: T.AnimationMixer;
    fades: T.Material[];
}

interface FlightPath {
    sword: T.Mesh;
    departure: number;
    arrival: number;
    position: T.LinearInterpolant;
}

/** Pre-built reusable summon rig (built once at load time -> zero 191-node GLB cloning or shader compilation on cast!). */
interface SummonRig {
    layer: Layer;
    sword: T.Object3D;
    mount: T.Group;
    paths: FlightPath[];
    batch: T.InstancedMesh;
    trailLines: T.LineSegments;
    trailGeo: T.BufferGeometry;
    trailMat: T.ShaderMaterial;
    trailPos: Float32Array;
    trailAlpha: Float32Array;
}

interface ActiveSummon {
    landing: T.Vector3;
    offset: T.Vector3;
    anchor: T.Vector3;
    offsetVelocity: T.Vector3;
    previousTime: number;
    elapsed: number;
    trackLanding?: () => T.Vector3 | undefined;
}

interface Fall {
    sword: T.Object3D;
    tip: T.Object3D;
    speed: number;
    sonic: boolean;
    casterHeight: number;
    directY?: number;
    age: number;
    sheath: SheathSlot;
}

interface SheathSlot {
    mesh: T.Mesh;
    mat: T.ShaderMaterial;
    inUse: boolean;
}

interface RingSlot {
    root: T.Group;
    mesh: T.Mesh;
    mat: T.ShaderMaterial;
    inUse: boolean;
    age: number;
    duration: number;
    maxScale: number;
}

interface ClimaxSlot {
    root: T.Group;
    pillar: T.Mesh;
    pillarMat: T.ShaderMaterial;
    flash: T.Sprite;
    flashMat: T.SpriteMaterial;
    ring: T.Mesh;
    ringMat: T.ShaderMaterial;
    embers: T.InstancedMesh;
    emberMat: T.MeshBasicMaterial;
    emberVel: T.Vector3[];
    inUse: boolean;
    age: number;
    duration: number;
    maxRing: number;
}

interface PooledLayer {
    layer: Layer;
    inUse: boolean;
}

interface EventEffect {
    pooled: PooledLayer;
    start: number;
    duration: number;
    age: number;
    sword?: T.Object3D;
    height?: number;
    baseScale?: T.Vector3;
    origin: T.Vector3;
    isImpact: boolean;
}

function section(root: T.Object3D, animation: T.AnimationClip): Layer {
    const names = new Set<string>();
    const copies = new Map<T.Material, T.Material>();
    root.traverse(node => {
        names.add(node.name);
        if (!(node instanceof T.Mesh)) return;
        node.castShadow = false;
        node.receiveShadow = false;
        const clone = (mat: T.Material) => {
            if (!Array.isArray(mat.userData.opacityFrames)) return mat;
            if (!copies.has(mat)) {
                const copy = mat.clone();
                const tint = mat.userData.pulseTint as number[] | undefined;
                if (copy instanceof T.MeshStandardMaterial && tint) copy.color.setRGB(tint[0], tint[1], tint[2]);
                copies.set(mat, copy);
            }
            return copies.get(mat)!;
        };
        node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
    });
    const tracks = animation.tracks.filter(track => names.has(T.PropertyBinding.parseTrackName(track.name).nodeName));
    const mixer = new T.AnimationMixer(root);
    const action = mixer.clipAction(new T.AnimationClip(animation.name, animation.duration, tracks));
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    return { root, mixer, fades: [...copies.values()] };
}

function sample(layer: Layer, time: number) {
    layer.mixer.setTime(time);
    const samplePos = Math.max(0, time * fps);
    for (const mat of layer.fades) {
        const frames = mat.userData.opacityFrames as number[];
        const i = Math.min(Math.floor(samplePos), frames.length - 1);
        const j = Math.min(i + 1, frames.length - 1);
        mat.opacity = T.MathUtils.lerp(frames[i], frames[j], samplePos - i);
    }
}

function disposeLayer(layer: Layer) {
    layer.mixer.stopAllAction();
    layer.mixer.uncacheRoot(layer.root);
    layer.root.removeFromParent();
    for (const material of layer.fades) material.dispose();
}

function lookup(root: T.Object3D, name: string) {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`Nascent Giant Sword GLB is missing ${name}`);
    return node;
}

function terrainNormal(point: T.Vector3, sampleGround: SampleGround) {
    const d = .32;
    const height = (x: number, z: number) => sampleGround(x, z, point.y + 1.2).height;
    const west = height(point.x - d, point.z), east = height(point.x + d, point.z);
    const north = height(point.x, point.z - d), south = height(point.x, point.z + d);
    if ([west, east, north, south].some(y => !Number.isFinite(y) || Math.abs(y - point.y) > .85)) return up;
    return new T.Vector3(west - east, 2 * d, north - south).normalize();
}

/** Elevates blade jade-silver luster and disables shadow casting/receiving on VFX meshes to prevent 330k-tri shadow passes. */
function enhanceAssetMaterials(asset: GLTF) {
    const seen = new Set<T.Material>();
    asset.scene.traverse(obj => {
        if (!(obj instanceof T.Mesh)) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
            if (seen.has(mat) || !(mat instanceof T.MeshStandardMaterial)) continue;
            seen.add(mat);
            const hasEmissive = mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.04;
            if (hasEmissive) {
                mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1.55);
            } else if (!Array.isArray(mat.userData.opacityFrames)) {
                mat.emissive.set('#2c7d7c');
                mat.emissiveIntensity = 0.28;
                mat.roughness = Math.min(mat.roughness, 0.34);
                mat.metalness = Math.max(mat.metalness, 0.35);
            }
        }
    });
}

function createStarHaloTexture(): T.Texture {
    if (typeof document === 'undefined') {
        const tex = new T.DataTexture(new Uint8Array([140, 255, 240, 255]), 1, 1, T.RGBAFormat);
        tex.needsUpdate = true;
        return tex;
    }
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0.0, 'rgba(255, 252, 236, 1.0)');
    g.addColorStop(0.16, 'rgba(182, 255, 246, 0.85)');
    g.addColorStop(0.42, 'rgba(72, 224, 212, 0.34)');
    g.addColorStop(0.75, 'rgba(34, 150, 168, 0.08)');
    g.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(cx, cx);
    const drawRay = (rx: number, ry: number, alpha: number) => {
        ctx.save();
        ctx.scale(rx, ry);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        rg.addColorStop(0, `rgba(255, 250, 224, ${alpha})`);
        rg.addColorStop(0.35, `rgba(148, 252, 240, ${alpha * 0.55})`);
        rg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };
    drawRay(124, 7.5, 0.92);
    drawRay(9, 96, 0.62);
    ctx.restore();

    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

function createCasterCircleMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uAlpha: { value: 0 },
            uGrow: { value: 0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uAlpha;
            uniform float uGrow;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uAlpha <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float reveal = smoothstep(uGrow + 0.08, uGrow - 0.14, r);
                float outerRing = exp(-pow((r - 0.89) / 0.019, 2.0)) + 0.55 * exp(-pow((r - 0.81) / 0.012, 2.0));
                float midRing   = exp(-pow((r - 0.58) / 0.015, 2.0)) + 0.45 * exp(-pow((r - 0.52) / 0.010, 2.0));
                float innerRing = exp(-pow((r - 0.28) / 0.016, 2.0));
                float runeBand = smoothstep(0.25, 0.95, sin(a * 24.0 - uTime * 1.15)) * exp(-pow((r - 0.85) / 0.038, 2.0));
                float sealTicks = smoothstep(0.55, 0.95, cos(a * 12.0 + uTime * 0.85)) * exp(-pow((r - 0.55) / 0.032, 2.0));
                float spokes = pow(max(0.0, cos(a * 8.0 + uTime * 0.35)), 24.0) * smoothstep(0.18, 0.30, r) * (1.0 - smoothstep(0.84, 0.92, r));
                float diamondNodes = pow(max(0.0, cos(a * 8.0 - uTime * 0.35)), 32.0) * exp(-pow((r - 0.89) / 0.045, 2.0));
                float coreMist = exp(-r * r * 3.8) * 0.26;
                float intensity = (outerRing * 1.0 + midRing * 0.8 + innerRing * 0.68
                    + runeBand * 0.58 + sealTicks * 0.52 + spokes * 0.65 + diamondNodes * 0.95 + coreMist) * reveal;
                float edgeFade = 1.0 - smoothstep(0.92, 1.0, r);
                vec3 celadon = vec3(0.36, 0.94, 0.86);
                vec3 paleGold = vec3(1.0, 0.95, 0.78);
                vec3 col = mix(celadon, paleGold, clamp(diamondNodes * 0.65 + outerRing * 0.32 + spokes * 0.25, 0.0, 1.0));
                gl_FragColor = vec4(col * 1.18, clamp(intensity * edgeFade * uAlpha, 0.0, 0.96));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-gs-circle-v1';
    return mat;
}

function createDescentSheathMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 0 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;
            void main() {
                vUv = uv;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormalDir = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uIntensity;
            varying vec2 vUv;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;
            void main() {
                if (uIntensity <= 0.004) discard;
                float fres = pow(1.0 - abs(dot(normalize(vNormalDir), normalize(vViewDir))), 1.35);
                float streakA = pow(0.5 + 0.5 * sin(vUv.x * 37.7 + vUv.y * 6.0 - uTime * 22.0), 4.0);
                float streakB = pow(0.5 + 0.5 * cos(vUv.x * 25.1 - vUv.y * 9.0 - uTime * 30.0), 6.0);
                float tipCore = exp(-vUv.y * 5.2);
                float bodyEnvelope = smoothstep(0.0, 0.09, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
                float alpha = (tipCore * 0.85 + bodyEnvelope * (0.28 + 0.62 * streakA + 0.45 * streakB) * (0.35 + 0.85 * fres)) * uIntensity;
                vec3 col = mix(vec3(0.32, 0.92, 0.90), vec3(1.0, 0.96, 0.82), tipCore * 0.72 + streakB * 0.35);
                gl_FragColor = vec4(col * 1.25, clamp(alpha, 0.0, 0.92));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-gs-sheath-v1';
    return mat;
}

function createImpactPillarMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uAlpha: { value: 1 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;
            void main() {
                vUv = uv;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormalDir = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uAlpha;
            varying vec2 vUv;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;
            void main() {
                float core = pow(abs(dot(normalize(vNormalDir), normalize(vViewDir))), 0.65);
                float rise = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.45);
                float veins = 0.68 + 0.32 * sin(vUv.x * 25.13 + uTime * 9.0) * cos(vUv.y * 12.0 - uTime * 16.0);
                float alpha = core * rise * veins * uAlpha;
                vec3 col = mix(vec3(0.35, 0.95, 0.88), vec3(1.0, 0.96, 0.80), core * 0.65 + (1.0 - vUv.y) * 0.25);
                gl_FragColor = vec4(col * 1.38, clamp(alpha, 0.0, 0.95));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-gs-pillar-v1';
    return mat;
}

function createShockRingMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uAlpha: { value: 1 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uProgress;
            uniform float uAlpha;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uAlpha <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float lead = mix(0.18, 0.94, uProgress);
                float mainRing = exp(-pow((r - lead) / 0.055, 2.0));
                float subRing = exp(-pow((r - max(0.06, lead - 0.14)) / 0.032, 2.0)) * 0.65;
                float rays = (0.62 + 0.38 * sin(a * 16.0 + uTime * 4.0)) * mainRing;
                float runeEcho = smoothstep(0.35, 0.95, cos(a * 24.0 - uTime * 3.0)) * subRing;
                float mask = (mainRing * 0.85 + rays * 0.45 + subRing * 0.55 + runeEcho * 0.45) * (1.0 - smoothstep(0.92, 1.0, r));
                vec3 col = mix(vec3(0.34, 0.95, 0.88), vec3(1.0, 0.95, 0.78), mainRing * 0.55 + runeEcho * 0.35);
                gl_FragColor = vec4(col * 1.25, clamp(mask * uAlpha, 0.0, 0.95));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-gs-ring-v1';
    return mat;
}

/**
 * Lean, crisp faceted Chinese Jian geometry (~48 tris vs 3,934 tris in the GLB) matching the exact
 * [-0.55..0.55, -1.12..4.88, -0.20..0.20] bounds of `Back Sword · shared mesh`, cutting 84-sword
 * vertex/triangle throughput by ~98% while retaining bright silver-jade blade & gold guard colors.
 */
function createFlyingSwordGeometry(): T.BufferGeometry {
    const pos: number[] = [];
    const col: number[] = [];
    const tri = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        r: number, g: number, b: number,
    ) => {
        pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        col.push(r, g, b, r, g, b, r, g, b);
    };
    const quad = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        dx: number, dy: number, dz: number,
        r: number, g: number, b: number,
    ) => {
        tri(ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b);
        tri(ax, ay, az, cx, cy, cz, dx, dy, dz, r, g, b);
    };
    const diamondSection = (
        y0: number, w0: number, t0: number,
        y1: number, w1: number, t1: number,
        r: number, g: number, b: number,
    ) => {
        // 4 diamond edges: (+x,0), (0,+z), (-x,0), (0,-z)
        quad(w0, y0, 0, 0, y0, t0, 0, y1, t1, w1, y1, 0, r, g, b);
        quad(0, y0, t0, -w0, y0, 0, -w1, y1, 0, 0, y1, t1, r * 0.94, g * 0.98, b);
        quad(-w0, y0, 0, 0, y0, -t0, 0, y1, -t1, -w1, y1, 0, r * 0.88, g * 0.94, b * 0.96);
        quad(0, y0, -t0, w0, y0, 0, w1, y1, 0, 0, y1, -t1, r * 0.94, g * 0.98, b);
    };
    const diamondTip = (y0: number, w0: number, t0: number, yTip: number, r: number, g: number, b: number) => {
        tri(w0, y0, 0, 0, y0, t0, 0, yTip, 0, r, g, b);
        tri(0, y0, t0, -w0, y0, 0, 0, yTip, 0, r * 0.95, g * 0.99, b);
        tri(-w0, y0, 0, 0, y0, -t0, 0, yTip, 0, r * 0.90, g * 0.96, b * 0.98);
        tri(0, y0, -t0, w0, y0, 0, 0, yTip, 0, r * 0.95, g * 0.99, b);
    };

    // Faceted silver-jade double-edged blade (y = 0.08 -> 4.88)
    diamondSection(0.08, 0.22, 0.09, 3.85, 0.16, 0.065, 0.86, 0.97, 0.96);
    diamondTip(3.85, 0.16, 0.065, 4.88, 0.96, 1.0, 0.97);

    // Winged pale-gold crossguard (x: ±0.55, y: -0.08..0.16, z: ±0.16)
    diamondSection(-0.08, 0.36, 0.16, 0.12, 0.55, 0.14, 0.98, 0.86, 0.54);
    diamondTip(0.12, 0.55, 0.14, 0.24, 1.0, 0.90, 0.60);
    diamondTip(-0.08, 0.36, 0.16, -0.18, 0.88, 0.74, 0.42);

    // Grip & gold pommel (y = -1.12 -> -0.08)
    diamondSection(-0.92, 0.10, 0.09, -0.08, 0.11, 0.10, 0.30, 0.56, 0.62);
    diamondTip(-0.92, 0.15, 0.13, -1.12, 0.98, 0.85, 0.52);

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
}

export class NascentGiantSword {
    private asset?: GLTF;
    private rig?: SummonRig;
    private disposed = false;
    private summon?: ActiveSummon;
    private released = false;
    private readonly falls = new Set<Fall>();
    private readonly effects = new Set<EventEffect>();
    private readonly from = new T.Vector3();
    private readonly to = new T.Vector3();
    private readonly contact = new T.Vector3();
    private readonly frameCenter = new T.Vector3();
    private readonly direction = new T.Vector3();
    private readonly tangent = new T.Vector3();
    private readonly faceAlongPath = new T.Quaternion();
    private readonly flightRotation = new T.Quaternion();
    private readonly flightPosition = new T.Vector3();
    private readonly flightMatrix = new T.Matrix4();
    private readonly tmpWorldA = new T.Vector3();
    private readonly tmpWorldB = new T.Vector3();
    private readonly tmpDummy = new T.Object3D();
    private frameWeight = 0;

    // Pre-allocated persistent summon VFX (zero allocations or shader compiles on cast!)
    private readonly circleGeo = new T.PlaneGeometry(7.8, 7.8);
    private readonly circleMat = createCasterCircleMaterial();
    private readonly circleMesh: T.Mesh;
    private circleFadeAge = -1;
    private circleElapsed = 0;

    private readonly forgeMoteGeo: T.BufferGeometry;
    private readonly forgeMoteMat: T.ShaderMaterial;
    private readonly forgeMotes: T.Points;

    private readonly haloTex = createStarHaloTexture();
    private readonly forgeHaloMat: T.SpriteMaterial;
    private readonly forgeHalo: T.Sprite;

    // Lean stylized flying-sword geometry & fast Lambert material (cuts 84-sword draw from 330k PBR tris -> 5.7k tris!)
    private readonly flyingSwordGeo = createFlyingSwordGeometry();
    private readonly flyingSwordMat = new T.MeshLambertMaterial({
        vertexColors: true,
        color: '#ffffff',
        emissive: '#329e96',
        emissiveIntensity: 0.48,
    });

    // Shared geometries for pooled drop/impact FX
    private readonly ringGeo = new T.PlaneGeometry(2, 2);
    private readonly sheathGeo = new T.CylinderGeometry(2.35, 0.16, 13.5, 16, 1, true);
    private readonly pillarGeo = new T.CylinderGeometry(2.4, 0.85, 28, 16, 1, true);
    private readonly emberGeo = new T.OctahedronGeometry(0.14, 0);

    // Pre-built reusable pools — ZERO clone(true), ZERO new ShaderMaterial, ZERO new InstancedMesh at runtime!
    private readonly swordPool: T.Object3D[] = [];
    private readonly pooledSwordMats: T.Material[] = [];
    private readonly sonicPool: PooledLayer[] = [];
    private readonly impactPool: PooledLayer[] = [];
    private readonly sheathPool: SheathSlot[] = [];
    private readonly ringPool: RingSlot[] = [];
    private readonly climaxPool: ClimaxSlot[] = [];

    constructor(
        private readonly scene: T.Scene,
        private readonly sampleGround: SampleGround,
        private readonly traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
        private readonly blast: (point: T.Vector3, directHit: boolean) => void,
        private readonly splashRadius: number,
    ) {
        this.circleGeo.rotateX(-Math.PI / 2);
        this.ringGeo.rotateX(-Math.PI / 2);
        this.sheathGeo.translate(0, 6.75, 0);
        this.pillarGeo.translate(0, 14, 0);

        this.circleMesh = new T.Mesh(this.circleGeo, this.circleMat);
        this.circleMesh.name = 'Nascent_Caster_SwordCircle';
        this.circleMesh.renderOrder = 5;
        this.circleMesh.visible = false;
        this.scene.add(this.circleMesh);

        // Persistent converging forging motes
        const moteSeed = new Float32Array(FORGE_MOTE_COUNT * 4);
        const motePos = new Float32Array(FORGE_MOTE_COUNT * 3);
        for (let i = 0; i < FORGE_MOTE_COUNT; i++) {
            moteSeed[i * 4] = (i / FORGE_MOTE_COUNT) * Math.PI * 2 + (i % 7) * 0.43;
            moteSeed[i * 4 + 1] = 1.6 + ((i * 37) % 100) / 100 * 4.6;
            moteSeed[i * 4 + 2] = -4.2 + ((i * 53) % 100) / 100 * 8.4;
            moteSeed[i * 4 + 3] = ((i * 19) % 100) / 100;
        }
        this.forgeMoteGeo = new T.BufferGeometry();
        this.forgeMoteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
        this.forgeMoteGeo.setAttribute('aSeed', new T.BufferAttribute(moteSeed, 4));
        this.forgeMoteMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            toneMapped: false,
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
            },
            vertexShader: `
                attribute vec4 aSeed;
                uniform float uTime;
                uniform float uProgress;
                varying float vGlow;
                void main() {
                    float cycle = fract(aSeed.w + uTime * 0.58);
                    float pull = 1.0 - pow(cycle, 1.55);
                    float ang = aSeed.x + uTime * (1.8 + aSeed.w * 1.6) + cycle * 2.4;
                    float rad = aSeed.y * (0.14 + 0.86 * pull);
                    float y = aSeed.z * (0.42 + 0.58 * pull) + (1.0 - pull) * 1.4;
                    vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
                    vGlow = smoothstep(0.0, 0.22, cycle) * (1.0 - smoothstep(0.75, 1.0, cycle)) * smoothstep(0.08, 0.35, uProgress);
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = clamp((24.0 + 18.0 * aSeed.w) / max(1.5, -mv.z), 2.5, 16.0);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying float vGlow;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0 || vGlow <= 0.01) discard;
                    float core = exp(-d * d * 4.5);
                    vec3 col = mix(vec3(0.42, 0.96, 0.90), vec3(1.0, 0.95, 0.78), core * 0.65);
                    gl_FragColor = vec4(col * 1.3, core * vGlow * 0.92);
                }
            `,
        });
        this.forgeMoteMat.customProgramCacheKey = () => 'nascent-gs-motes-v1';
        this.forgeMotes = new T.Points(this.forgeMoteGeo, this.forgeMoteMat);
        this.forgeMotes.name = 'Nascent_Forge_Motes';
        this.forgeMotes.frustumCulled = false;
        this.forgeMotes.renderOrder = 7;
        this.forgeMotes.visible = false;
        this.scene.add(this.forgeMotes);

        this.forgeHaloMat = new T.SpriteMaterial({
            map: this.haloTex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: T.AdditiveBlending,
            toneMapped: false,
        });
        this.forgeHalo = new T.Sprite(this.forgeHaloMat);
        this.forgeHalo.name = 'Nascent_Forge_Halo';
        this.forgeHalo.renderOrder = 7;
        this.forgeHalo.visible = false;
        this.scene.add(this.forgeHalo);

        // Pre-allocate descent sheath, shock ring, and impact climax pools (zero runtime shader compiles!)
        for (let i = 0; i < 2; i++) {
            const mat = createDescentSheathMaterial();
            const mesh = new T.Mesh(this.sheathGeo, mat);
            mesh.name = `Nascent_Descent_Sheath_${i}`;
            mesh.renderOrder = 7;
            mesh.visible = false;
            this.scene.add(mesh);
            this.sheathPool.push({ mesh, mat, inUse: false });
        }
        for (let i = 0; i < 3; i++) {
            const root = new T.Group();
            root.name = `Nascent_ShockRing_${i}`;
            root.visible = false;
            const mat = createShockRingMaterial();
            const mesh = new T.Mesh(this.ringGeo, mat);
            mesh.renderOrder = 7;
            root.add(mesh);
            this.scene.add(root);
            this.ringPool.push({ root, mesh, mat, inUse: false, age: 0, duration: 0.44, maxScale: 12 });
        }
        for (let i = 0; i < 2; i++) {
            const root = new T.Group();
            root.name = `Nascent_ImpactClimax_${i}`;
            root.visible = false;

            const pillarMat = createImpactPillarMaterial();
            const pillar = new T.Mesh(this.pillarGeo, pillarMat);
            pillar.renderOrder = 7;
            root.add(pillar);

            const flashMat = new T.SpriteMaterial({
                map: this.haloTex,
                transparent: true,
                opacity: 1,
                depthWrite: false,
                blending: T.AdditiveBlending,
                toneMapped: false,
            });
            const flash = new T.Sprite(flashMat);
            flash.position.set(0, 1.6, 0);
            flash.renderOrder = 8;
            root.add(flash);

            const ringMat = createShockRingMaterial();
            const ring = new T.Mesh(this.ringGeo, ringMat);
            ring.position.set(0, 0.16, 0);
            ring.renderOrder = 7;
            root.add(ring);

            const emberMat = new T.MeshBasicMaterial({
                color: '#9cfef2',
                transparent: true,
                opacity: 0.95,
                blending: T.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            });
            const embers = new T.InstancedMesh(this.emberGeo, emberMat, IMPACT_EMBER_COUNT);
            embers.instanceMatrix.setUsage(T.DynamicDrawUsage);
            embers.renderOrder = 8;
            embers.frustumCulled = false;

            const emberVel: T.Vector3[] = [];
            const emberCol = new T.Color();
            for (let k = 0; k < IMPACT_EMBER_COUNT; k++) {
                const ang = (k / IMPACT_EMBER_COUNT) * Math.PI * 2 + ((k * 17) % 10) * 0.06;
                const speed = 5.5 + ((k * 31) % 100) / 100 * 14.5;
                const vy = 6.5 + ((k * 43) % 100) / 100 * 13.0;
                emberVel.push(new T.Vector3(Math.cos(ang) * speed, vy, Math.sin(ang) * speed));
                emberCol.set(k % 3 === 0 ? '#ffe79e' : '#7ef9eb');
                embers.setColorAt(k, emberCol);
            }
            if (embers.instanceColor) embers.instanceColor.needsUpdate = true;
            root.add(embers);
            this.scene.add(root);
            this.climaxPool.push({
                root,
                pillar,
                pillarMat,
                flash,
                flashMat,
                ring,
                ringMat,
                embers,
                emberMat,
                emberVel,
                inUse: false,
                age: 0,
                duration: 1.12,
                maxRing: this.splashRadius * 1.48,
            });
        }
    }

    get ready(): boolean {
        return Boolean(this.rig);
    }

    /** Returns representative pre-built objects so renderer.compileAsync can pre-warm every shader & PBR program before first cast. */
    get warmObjects(): T.Object3D[] {
        const list: T.Object3D[] = [this.circleMesh, this.forgeMotes, this.forgeHalo];
        if (this.rig) list.push(this.rig.layer.root);
        if (this.sheathPool[0]) list.push(this.sheathPool[0].mesh);
        if (this.ringPool[0]) list.push(this.ringPool[0].root);
        if (this.climaxPool[0]) list.push(this.climaxPool[0].root);
        if (this.sonicPool[0]) list.push(this.sonicPool[0].layer.root);
        if (this.impactPool[0]) list.push(this.impactPool[0].layer.root);
        return list;
    }

    get framing() {
        const framing = { radius: 12, fullWeightWithin: 12, fadeBeyond: 32 };
        if (this.summon && this.rig && this.frameWeight > 0) {
            this.rig.sword.getWorldPosition(this.frameCenter);
            return { ...framing, center: this.frameCenter, weight: this.frameWeight };
        }
        const fall = this.falls.values().next().value;
        if (fall) {
            const weight = .65 + .35 * T.MathUtils.smoothstep(fall.sword.position.y - fall.casterHeight, 7, 17);
            return { ...framing, center: fall.sword.position, weight };
        }
        for (const fx of this.effects) {
            if (fx.sword && fx.age < .72) {
                const weight = .65 * (1 - T.MathUtils.smoothstep(fx.age, .13, .72));
                return { ...framing, center: fx.sword.position, weight };
            }
        }
    }

    async load(loader: GLTFLoader) {
        const asset = await loader.loadAsync(modelUrl);
        if (this.disposed) {
            this.disposeAsset(asset);
            return;
        }
        enhanceAssetMaterials(asset);
        this.asset = asset;
        this.buildReusableRig(asset);
    }

    /** Pre-builds the 191-node summon rig & falling sword pool once at load time so casting has ZERO cloning lag! */
    private buildReusableRig(asset: GLTF) {
        const root = asset.scene.clone(true);
        root.name = 'Nascent_GiantSword_Cast';
        lookup(root, 'Ground_Impact').removeFromParent();
        lookup(root, 'Air_SonicBurst').removeFromParent();
        const flight = lookup(root, 'FlyingSwords');
        const sources = flight.children.filter((node): node is T.Mesh => node instanceof T.Mesh);
        // Use lean stylized Chinese Jian geometry + Lambert material (cuts 84-sword draw from 330k PBR tris to ~5.7k tris!)
        const batch = new T.InstancedMesh(this.flyingSwordGeo, this.flyingSwordMat, sources.length);
        batch.name = 'Nascent_FlyingSwords_Batch';
        batch.count = 0;
        batch.castShadow = false;
        batch.receiveShadow = false;
        batch.frustumCulled = false;
        batch.instanceMatrix.setUsage(T.DynamicDrawUsage);

        const clip = asset.animations[0];
        const tracks = new Map(clip.tracks.map(track => [track.name, track]));
        const paths = sources.map(sword => {
            sword.visible = false;
            const track = tracks.get(`${sword.name}.position`);
            if (!track) throw new Error(`Nascent Giant Sword GLB is missing ${sword.name} flight keys`);
            return {
                sword,
                departure: (Number(sword.userData.departure_frame) - 1) / fps,
                arrival: (Number(sword.userData.arrival_frame) - 1) / fps,
                position: new T.LinearInterpolant(track.times, track.values, 3, new Float32Array(3)),
            };
        });
        flight.add(batch);

        const maxSegments = sources.length * (TRAIL_STEPS - 1);
        const trailPos = new Float32Array(maxSegments * 2 * 3);
        const trailAlpha = new Float32Array(maxSegments * 2);
        const trailGeo = new T.BufferGeometry();
        trailGeo.setAttribute('position', new T.BufferAttribute(trailPos, 3));
        trailGeo.setAttribute('aFade', new T.BufferAttribute(trailAlpha, 1));
        trailGeo.setDrawRange(0, 0);
        const trailMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            toneMapped: false,
            vertexShader: `
                attribute float aFade;
                varying float vFade;
                void main() {
                    vFade = aFade;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying float vFade;
                void main() {
                    if (vFade <= 0.01) discard;
                    vec3 col = mix(vec3(0.22, 0.84, 0.82), vec3(0.98, 0.96, 0.80), pow(vFade, 2.2));
                    gl_FragColor = vec4(col * 1.28, vFade * 0.82);
                }
            `,
        });
        trailMat.customProgramCacheKey = () => 'nascent-gs-trails-v1';
        const trailLines = new T.LineSegments(trailGeo, trailMat);
        trailLines.name = 'Nascent_FlyingSword_Trails';
        trailLines.frustumCulled = false;
        trailLines.renderOrder = 6;
        flight.add(trailLines);

        const sword = lookup(root, 'GiantSword');
        const mount = new T.Group();
        sword.parent!.add(mount);
        mount.add(sword);
        const layer = section(root, clip);

        // Advance the rig to `releaseTime` (frame 104) BEFORE cloning falling swords into the pool!
        // At frame 0, GiantSword's child meshes are unforged (scale = 0, opacity = 0); sampling releaseTime
        // captures the exact fully-forged blade transforms, scales, and material opacities for the pool.
        sample(layer, releaseTime);
        root.updateMatrixWorld(true);

        // Pre-clone 2 forged falling giant swords, 2 sonic bursts, and 2 ground impacts at load time -> zero runtime clone/mixer stalls!
        for (let i = 0; i < 2; i++) {
            const copy = sword.clone(true);
            copy.name = `Nascent_GiantSword_Pooled_${i}`;
            // Clone any opacity-animated materials on the pooled falling sword so resetting rig.layer to t=0
            // on a subsequent cast never turns an already-falling or embedded sword transparent.
            const matCopies = new Map<T.Material, T.Material>();
            copy.traverse(node => {
                if (!(node instanceof T.Mesh)) return;
                const freeze = (mat: T.Material) => {
                    if (!Array.isArray(mat.userData.opacityFrames)) return mat;
                    if (!matCopies.has(mat)) {
                        const frozen = mat.clone();
                        matCopies.set(mat, frozen);
                        this.pooledSwordMats.push(frozen);
                    }
                    return matCopies.get(mat)!;
                };
                node.material = Array.isArray(node.material) ? node.material.map(freeze) : freeze(node.material);
            });
            copy.visible = false;
            this.scene.add(copy);
            this.swordPool.push(copy);

            const sonicRoot = lookup(asset.scene, 'Air_SonicBurst').clone(true);
            sonicRoot.visible = false;
            this.scene.add(sonicRoot);
            this.sonicPool.push({ layer: section(sonicRoot, clip), inUse: false });

            const impactRoot = lookup(asset.scene, 'Ground_Impact').clone(true);
            impactRoot.visible = false;
            this.scene.add(impactRoot);
            this.impactPool.push({ layer: section(impactRoot, clip), inUse: false });
        }

        // Reset summon rig back to frame 0 and hide until cast
        sample(layer, 0);
        root.visible = false;
        this.scene.add(root);

        this.rig = {
            layer,
            sword,
            mount,
            paths,
            batch,
            trailLines,
            trailGeo,
            trailMat,
            trailPos,
            trailAlpha,
        };
    }

    private acquireFallingSword(): T.Object3D {
        for (const s of this.swordPool) {
            if (!s.visible) {
                s.visible = true;
                return s;
            }
        }
        const extra = this.rig!.sword.clone(true);
        extra.name = 'Nascent_GiantSword_Falling';
        this.scene.add(extra);
        return extra;
    }

    private releaseFallingSword(sword: T.Object3D) {
        if (this.swordPool.includes(sword)) {
            sword.visible = false;
        } else {
            sword.removeFromParent();
        }
    }

    private beginSummon(position: T.Vector3, heading: number, landing: T.Vector3, trackLanding?: () => T.Vector3 | undefined): ActiveSummon {
        const rig = this.rig!;
        const root = rig.layer.root;
        root.position.copy(position);
        root.rotation.set(0, -heading, 0);
        rig.mount.position.set(0, 0, 0);
        sample(rig.layer, 0);
        root.visible = true;
        root.updateMatrixWorld(true);

        const localLanding = root.worldToLocal(landing.clone());
        const anchor = new T.Vector3(rig.sword.position.x, 0, rig.sword.position.z);
        const offset = new T.Vector3(localLanding.x - anchor.x, Math.max(0, localLanding.y), localLanding.z - anchor.z);

        const groundY = this.sampleGround(position.x, position.z, position.y + 1.5).height;
        this.circleMesh.position.set(position.x, Math.max(groundY, position.y) + 0.09, position.z);
        this.circleMesh.visible = true;
        this.circleFadeAge = -1;
        this.circleElapsed = 0;

        this.forgeMotes.visible = true;
        this.forgeHalo.visible = true;

        return {
            landing: localLanding,
            offset,
            anchor,
            offsetVelocity: new T.Vector3(),
            previousTime: 0,
            elapsed: 0,
            trackLanding,
        };
    }

    private acquireSheath(): SheathSlot {
        let slot = this.sheathPool.find(s => !s.inUse);
        if (!slot) slot = this.sheathPool[0];
        slot.inUse = true;
        slot.mesh.visible = true;
        slot.mat.uniforms.uTime.value = 0;
        slot.mat.uniforms.uIntensity.value = 0;
        return slot;
    }

    private spawnBurstRing(position: T.Vector3, maxScale: number, duration: number, normal?: T.Vector3) {
        let slot = this.ringPool.find(r => !r.inUse);
        if (!slot) slot = this.ringPool[0];
        slot.inUse = true;
        slot.age = 0;
        slot.duration = duration;
        slot.maxScale = maxScale;
        slot.root.position.copy(position);
        if (normal) slot.root.quaternion.setFromUnitVectors(up, normal);
        else slot.root.quaternion.identity();
        slot.mesh.scale.setScalar(maxScale * 0.16);
        slot.mat.uniforms.uTime.value = 0;
        slot.mat.uniforms.uProgress.value = 0;
        slot.mat.uniforms.uAlpha.value = 0.95;
        slot.root.visible = true;
    }

    private spawnImpactClimax(position: T.Vector3, normal: T.Vector3) {
        let slot = this.climaxPool.find(c => !c.inUse);
        if (!slot) slot = this.climaxPool[0];
        slot.inUse = true;
        slot.age = 0;
        slot.duration = 1.12;
        slot.maxRing = this.splashRadius * 1.48;
        slot.root.position.copy(position);
        slot.ring.quaternion.setFromUnitVectors(up, normal);
        slot.pillar.visible = true;
        slot.flash.visible = true;
        slot.ring.visible = true;
        slot.root.visible = true;
    }

    updateCast(clipTime: number | undefined, position: T.Vector3, heading: number, launchTime: number, aim: () => T.Vector3, trackLanding?: () => T.Vector3 | undefined) {
        if (clipTime === undefined) {
            this.cancelCast();
            return;
        }
        if (!this.rig || this.released) return;
        const rig = this.rig;
        if (!this.summon) {
            const locked = trackLanding?.();
            this.summon = this.beginSummon(position, heading, locked ?? aim(), locked ? trackLanding : undefined);
        }
        const cast = this.summon;
        this.frameWeight = T.MathUtils.smoothstep(clipTime, .08, .48);
        const normProgress = Math.min(1, clipTime / launchTime);
        const time = normProgress * releaseTime;
        const dtCast = Math.max(0, time - cast.previousTime);
        cast.elapsed += dtCast;
        sample(rig.layer, time);
        cast.offsetVelocity.set(0, 0, 0);
        const tracking = cast.trackLanding?.();
        if (tracking) {
            rig.layer.root.worldToLocal(cast.landing.copy(tracking));
            const previous = this.direction.copy(cast.offset);
            cast.offset.set(cast.landing.x - cast.anchor.x, Math.max(0, cast.landing.y), cast.landing.z - cast.anchor.z);
            const elapsed = time - cast.previousTime;
            if (elapsed > 1e-5) cast.offsetVelocity.subVectors(cast.offset, previous).multiplyScalar(1 / elapsed);
        }
        cast.previousTime = time;
        rig.mount.position.set(cast.landing.x - rig.sword.position.x, cast.offset.y,
            cast.landing.z - rig.sword.position.z);

        // Layer 1: Caster ground Daoist Sword Formation Circle
        this.circleElapsed = cast.elapsed;
        this.circleMat.uniforms.uTime.value = cast.elapsed;
        this.circleMat.uniforms.uGrow.value = T.MathUtils.smoothstep(normProgress, 0.0, 0.26);
        this.circleMat.uniforms.uAlpha.value = T.MathUtils.smoothstep(normProgress, 0.0, 0.14) * (0.86 + 0.14 * Math.sin(cast.elapsed * 5.2));

        // Layer 3: Forging motes & celestial jade-gold halo
        rig.sword.getWorldPosition(this.tmpWorldA);
        this.forgeMotes.position.copy(this.tmpWorldA);
        this.forgeMoteMat.uniforms.uTime.value = cast.elapsed;
        this.forgeMoteMat.uniforms.uProgress.value = normProgress;

        const haloGrow = T.MathUtils.smoothstep(normProgress, 0.36, 0.98);
        this.forgeHalo.position.set(this.tmpWorldA.x, this.tmpWorldA.y + 1.1, this.tmpWorldA.z);
        const haloSize = 5.5 + haloGrow * 11.5 + Math.sin(cast.elapsed * 9.0) * 0.55;
        this.forgeHalo.scale.set(haloSize * 1.45, haloSize, 1);
        this.forgeHaloMat.opacity = haloGrow * 0.86;

        if (clipTime >= launchTime) {
            const sword = this.acquireFallingSword();
            rig.sword.getWorldPosition(sword.position);
            rig.sword.getWorldQuaternion(sword.quaternion);
            rig.sword.getWorldScale(sword.scale);
            const axis = up.clone().applyQuaternion(sword.quaternion);
            sword.quaternion.premultiply(new T.Quaternion().setFromUnitVectors(axis, up));

            this.spawnBurstRing(sword.position, 11.5, 0.42);
            const sheath = this.acquireSheath();

            // Start fading out the persistent caster circle smoothly after launch
            this.circleFadeAge = 0;

            this.falls.add({
                sword,
                tip: lookup(sword, 'NascentSwordTip'),
                speed: 0,
                sonic: false,
                casterHeight: rig.layer.root.position.y,
                age: 0,
                sheath,
            });
            this.released = true;
            this.hideSummon(true);
            return;
        }

        // Layer 2: Instanced small flying swords + lean 4-point celadon spirit ribbons
        let count = 0;
        let segVerts = 0;
        const posBuf = rig.trailPos;
        const alphaBuf = rig.trailAlpha;

        for (const path of rig.paths) {
            const sword = path.sword;
            if (sword.scale.x < .001) continue;
            const progress = T.MathUtils.smootherstep(time, path.departure, path.arrival);
            this.flightPosition.copy(sword.position).addScaledVector(cast.offset, progress);
            this.flightRotation.copy(sword.quaternion);
            if (time > path.departure && time < path.arrival) {
                const before = time - 1 / 120, after = time + 1 / 120;
                this.tangent.fromArray(path.position.evaluate(before)).negate();
                this.tangent.add(this.direction.fromArray(path.position.evaluate(after)));
                const offsetDelta = T.MathUtils.smootherstep(after, path.departure, path.arrival)
                    - T.MathUtils.smootherstep(before, path.departure, path.arrival);
                this.tangent.addScaledVector(cast.offset, offsetDelta)
                    .addScaledVector(cast.offsetVelocity, progress * (after - before));
                if (this.tangent.lengthSq() > 1e-8) {
                    this.direction.copy(up).applyQuaternion(sword.quaternion);
                    this.flightRotation.premultiply(this.faceAlongPath.setFromUnitVectors(this.direction, this.tangent.normalize()));
                }
            }
            rig.batch.setMatrixAt(count++, this.flightMatrix.compose(this.flightPosition, this.flightRotation, sword.scale));

            if (time > path.departure + 0.01 && time < path.arrival + 0.20) {
                const arrivalFade = 1 - T.MathUtils.smoothstep(time, path.arrival - 0.04, path.arrival + 0.20);
                // Reuse head position & chain points so each sword only evaluates 3 past samples instead of 12!
                this.tmpWorldA.copy(this.flightPosition);
                let prevAlpha = arrivalFade;
                for (let s = 1; s < TRAIL_STEPS; s++) {
                    const tB = Math.max(path.departure, time - s * TRAIL_STEP_DT);
                    const pB = T.MathUtils.smootherstep(tB, path.departure, path.arrival);
                    this.tmpWorldB.fromArray(path.position.evaluate(tB)).addScaledVector(cast.offset, pB);
                    const nextAlpha = (1 - s / (TRAIL_STEPS - 1)) * arrivalFade;

                    const baseIdx = segVerts * 3;
                    posBuf[baseIdx] = this.tmpWorldA.x;
                    posBuf[baseIdx + 1] = this.tmpWorldA.y;
                    posBuf[baseIdx + 2] = this.tmpWorldA.z;
                    posBuf[baseIdx + 3] = this.tmpWorldB.x;
                    posBuf[baseIdx + 4] = this.tmpWorldB.y;
                    posBuf[baseIdx + 5] = this.tmpWorldB.z;

                    alphaBuf[segVerts] = prevAlpha;
                    alphaBuf[segVerts + 1] = nextAlpha;
                    segVerts += 2;

                    this.tmpWorldA.copy(this.tmpWorldB);
                    prevAlpha = nextAlpha;
                    if (tB <= path.departure + 1e-5) break;
                }
            }
        }
        rig.batch.count = count;
        rig.batch.instanceMatrix.needsUpdate = true;

        rig.trailGeo.setDrawRange(0, segVerts);
        if (segVerts > 0) {
            (rig.trailGeo.attributes.position as T.BufferAttribute).needsUpdate = true;
            (rig.trailGeo.attributes.aFade as T.BufferAttribute).needsUpdate = true;
        }
    }

    update(dt: number) {
        if (dt <= 0) return;

        // Fade out persistent caster circle smoothly after release
        if (this.circleFadeAge >= 0) {
            this.circleElapsed += dt;
            this.circleFadeAge += dt;
            const fade = 1 - T.MathUtils.smoothstep(this.circleFadeAge, 0, 0.65);
            this.circleMat.uniforms.uTime.value = this.circleElapsed;
            this.circleMat.uniforms.uAlpha.value = fade * 0.85;
            if (fade <= 0.005) {
                this.circleMesh.visible = false;
                this.circleFadeAge = -1;
            }
        }

        // Update pooled shock rings (zero runtime allocation/disposal)
        for (const r of this.ringPool) {
            if (!r.inUse) continue;
            r.age += dt;
            if (r.age >= r.duration) {
                r.inUse = false;
                r.root.visible = false;
                continue;
            }
            const p = r.age / r.duration;
            const eased = 1 - Math.pow(1 - p, 2.6);
            r.mesh.scale.setScalar(T.MathUtils.lerp(r.maxScale * 0.16, r.maxScale, eased));
            r.mat.uniforms.uTime.value = r.age;
            r.mat.uniforms.uProgress.value = eased;
            r.mat.uniforms.uAlpha.value = (1 - T.MathUtils.smoothstep(p, 0.25, 1.0)) * 0.95;
        }

        // Update pooled impact climaxes (pillar + flash + rune ring + instanced shards)
        for (const c of this.climaxPool) {
            if (!c.inUse) continue;
            c.age += dt;
            if (c.age >= c.duration) {
                c.inUse = false;
                c.root.visible = false;
                continue;
            }
            const age = c.age;
            const p = age / c.duration;

            const pFade = 1 - T.MathUtils.smoothstep(age, 0.12, 0.68);
            const pWidth = T.MathUtils.lerp(1.45, 0.28, Math.min(1, age / 0.68));
            c.pillar.scale.set(pWidth, 0.85 + Math.min(1, age / 0.16) * 0.35, pWidth);
            c.pillarMat.uniforms.uTime.value = age;
            c.pillarMat.uniforms.uAlpha.value = pFade * 0.92;
            c.pillar.visible = pFade > 0.01;

            const fFade = 1 - T.MathUtils.smoothstep(age, 0.05, 0.44);
            const fSize = T.MathUtils.lerp(13.5, 4.5, Math.min(1, age / 0.44));
            c.flash.scale.set(fSize * 1.35, fSize * 0.9, 1);
            c.flashMat.opacity = fFade;
            c.flash.visible = fFade > 0.01;

            const rProg = Math.min(1, age / 0.82);
            const rEase = 1 - Math.pow(1 - rProg, 2.7);
            c.ring.scale.setScalar(T.MathUtils.lerp(1.2, c.maxRing, rEase));
            c.ringMat.uniforms.uTime.value = age;
            c.ringMat.uniforms.uProgress.value = rEase;
            c.ringMat.uniforms.uAlpha.value = (1 - T.MathUtils.smoothstep(rProg, 0.28, 1.0)) * 0.96;
            c.ring.visible = rProg < 1;

            const eFade = 1 - T.MathUtils.smoothstep(p, 0.42, 1.0);
            c.emberMat.opacity = eFade * 0.95;
            for (let i = 0; i < IMPACT_EMBER_COUNT; i++) {
                const v = c.emberVel[i];
                const drag = 1 - Math.min(0.45, age * 0.42);
                const y = Math.max(0.06, v.y * age * drag - 12.5 * age * age);
                this.tmpDummy.position.set(v.x * age * drag, y, v.z * age * drag);
                this.tmpDummy.rotation.set(age * 7 + i, age * 5 + i * 0.7, 0);
                const sc = Math.max(0.01, eFade * (0.65 + (i % 4) * 0.28));
                this.tmpDummy.scale.set(sc * 0.45, sc * 2.1, sc * 0.45);
                this.tmpDummy.updateMatrix();
                c.embers.setMatrixAt(i, this.tmpDummy.matrix);
            }
            c.embers.instanceMatrix.needsUpdate = true;
        }

        for (const fx of this.effects) {
            fx.age += dt;
            if (fx.age >= fx.duration) {
                this.removeEffect(fx);
                continue;
            }
            sample(fx.pooled.layer, fx.start + fx.age);
            if (fx.sword && fx.height !== undefined) {
                const drive = Math.min(1, fx.age / .10);
                fx.sword.position.y = fx.height - embedDepth * fx.sword.scale.y * (1 - (1 - drive) ** 3);
                const dissolve = T.MathUtils.smoothstep(fx.age, fx.duration - 0.34, fx.duration);
                if (dissolve > 0 && fx.baseScale) {
                    const thin = Math.max(0.02, 1 - dissolve * 0.92);
                    fx.sword.scale.set(fx.baseScale.x * thin, fx.baseScale.y * (1 + dissolve * 0.14), fx.baseScale.z * thin);
                    fx.sword.position.y += dt * 2.2;
                }
            }
        }

        for (const fall of this.falls) {
            fall.age += dt;
            fall.tip.getWorldPosition(this.from);
            const faster = Math.min(topSpeed, fall.speed + gravity * dt);
            this.to.copy(this.from);
            this.to.y -= (fall.speed + faster) * dt * .5;
            const hit = traceFireballWorld(this.from, this.to, this.sampleGround);
            if (!fall.sonic && faster >= sonicSpeed) {
                const t = T.MathUtils.clamp((sonicSpeed - fall.speed) / Math.max(.0001, faster - fall.speed), 0, 1);
                if (!hit || t < hit.t) {
                    this.contact.lerpVectors(this.from, this.to, t);
                    this.contact.y += .91 * fall.sword.scale.y;
                    this.spawn('Air_SonicBurst', this.contact, sonicTime, .34, false);
                    this.spawnBurstRing(this.contact, 12.5, 0.44);
                    fall.sonic = true;
                }
            }
            if (hit) this.to.lerpVectors(this.from, this.to, hit.t);
            const creatureT = this.traceCreature(this.from, this.to);
            if (creatureT !== undefined) fall.directY = T.MathUtils.lerp(this.from.y, this.to.y, creatureT);
            if (!hit) {
                fall.sword.position.y += this.to.y - this.from.y;
                fall.speed = faster;
                fall.sheath.mesh.position.copy(this.to);
                fall.sheath.mat.uniforms.uTime.value = fall.age;
                fall.sheath.mat.uniforms.uIntensity.value = T.MathUtils.smoothstep(fall.speed, 1.5, 28) * 0.92;
                continue;
            }
            if (hit.ground) this.to.y = hit.ground.height;
            fall.sword.position.y += this.to.y - this.from.y;
            fall.sheath.inUse = false;
            fall.sheath.mesh.visible = false;

            this.blast(this.to, fall.directY !== undefined && Math.abs(fall.directY - this.to.y) <= 2.8);
            const fx = this.spawn('Ground_Impact', this.to, impactTime, 1.08, true);
            const groundNormal = hit.ground ? terrainNormal(this.to, this.sampleGround) : up;
            if (hit.ground) {
                fx.pooled.layer.root.quaternion.setFromUnitVectors(up, groundNormal);
            } else {
                fx.pooled.layer.root.quaternion.identity();
            }
            const solidGround = hit.ground && hit.ground.kind !== 'water';
            lookup(fx.pooled.layer.root, 'Surface_Fractures').visible = Boolean(solidGround);
            lookup(fx.pooled.layer.root, 'Ground_Shockwave').visible = Boolean(hit.ground);
            const rim = lookup(fx.pooled.layer.root, 'Ground_Shockwave');
            rim.scale.set(this.splashRadius / 3.55, 1, this.splashRadius / 3.55);

            this.spawnImpactClimax(this.to, groundNormal);

            if (solidGround) {
                fx.sword = fall.sword;
                fx.height = fall.sword.position.y;
                fx.baseScale = fall.sword.scale.clone();
            } else {
                this.releaseFallingSword(fall.sword);
            }
            this.falls.delete(fall);
        }
    }

    /**
     * Emits fast, shadow-free dynamic celadon-cyan fill lights (`castShadow: false` avoids expensive
     * 6-face PointLight cubemap shadow passes during the giant sword plunge!).
     */
    collectLights(pool: SpellLightPool) {
        if (this.summon && this.rig) {
            const cp = this.circleMesh.position;
            const cAlpha = this.circleMat.uniforms.uAlpha.value as number;
            if (cAlpha > 0.05) {
                pool.emit({
                    x: cp.x,
                    y: cp.y + 1.2,
                    z: cp.z,
                    color: 0x56f0e2,
                    intensity: 7.5 * cAlpha,
                    distance: 18,
                    priority: 85,
                    castShadow: false,
                });
            }
            this.rig.sword.getWorldPosition(this.tmpWorldA);
            pool.emit({
                x: this.tmpWorldA.x,
                y: this.tmpWorldA.y,
                z: this.tmpWorldA.z,
                color: 0x76f8ee,
                intensity: 12.0,
                distance: 34,
                priority: 92,
                castShadow: false,
            });
        }
        for (const fall of this.falls) {
            const p = fall.sword.position;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0x62f4ec,
                intensity: 16.0,
                distance: 32,
                priority: 95,
                castShadow: false,
            });
        }
        for (const fx of this.effects) {
            if (!fx.isImpact) continue;
            const fade = Math.max(0, 1 - fx.age / 0.85);
            if (fade <= 0.02) continue;
            pool.emit({
                x: fx.origin.x,
                y: fx.origin.y + 2.2,
                z: fx.origin.z,
                color: 0x6cf6ea,
                intensity: 24 * fade * fade,
                distance: 38,
                priority: 98,
                castShadow: false,
            });
        }
    }

    private spawn(name: string, position: T.Vector3, start: number, duration: number, isImpact: boolean) {
        const pool = isImpact ? this.impactPool : this.sonicPool;
        let pooled = pool.find(p => !p.inUse);
        if (!pooled) {
            // Recycle oldest matching active effect if more than 2 overlap simultaneously
            for (const active of this.effects) {
                if (active.isImpact === isImpact) {
                    this.removeEffect(active);
                    break;
                }
            }
            pooled = pool.find(p => !p.inUse) ?? pool[0];
        }
        pooled.inUse = true;
        const root = pooled.layer.root;
        root.position.copy(position);
        root.quaternion.identity();
        root.visible = true;
        sample(pooled.layer, start);
        const fx: EventEffect = { pooled, start, duration, age: 0, origin: position.clone(), isImpact };
        this.effects.add(fx);
        return fx;
    }

    private hideSummon(keepCircle = false) {
        if (this.rig) {
            this.rig.layer.root.visible = false;
            this.rig.batch.count = 0;
            this.rig.trailGeo.setDrawRange(0, 0);
        }
        this.forgeMotes.visible = false;
        this.forgeHalo.visible = false;
        if (!keepCircle) {
            this.circleMesh.visible = false;
            this.circleFadeAge = -1;
        }
        this.summon = undefined;
    }

    private removeEffect(fx: EventEffect) {
        if (fx.sword) this.releaseFallingSword(fx.sword);
        fx.pooled.inUse = false;
        fx.pooled.layer.root.visible = false;
        this.effects.delete(fx);
    }

    cancelCast() {
        this.hideSummon(false);
        this.released = false;
    }

    clear() {
        this.cancelCast();
        for (const fall of this.falls) {
            this.releaseFallingSword(fall.sword);
            fall.sheath.inUse = false;
            fall.sheath.mesh.visible = false;
        }
        this.falls.clear();
        for (const fx of this.effects) this.removeEffect(fx);
        for (const r of this.ringPool) {
            r.inUse = false;
            r.root.visible = false;
        }
        for (const c of this.climaxPool) {
            c.inUse = false;
            c.root.visible = false;
        }
    }

    dispose() {
        this.disposed = true;
        this.clear();
        if (this.rig) {
            this.rig.batch.dispose();
            this.rig.trailGeo.dispose();
            this.rig.trailMat.dispose();
            disposeLayer(this.rig.layer);
            this.rig = undefined;
        }
        for (const s of this.swordPool) s.removeFromParent();
        this.swordPool.length = 0;
        for (const m of this.pooledSwordMats) m.dispose();
        this.pooledSwordMats.length = 0;
        for (const p of this.sonicPool) disposeLayer(p.layer);
        this.sonicPool.length = 0;
        for (const p of this.impactPool) disposeLayer(p.layer);
        this.impactPool.length = 0;
        for (const s of this.sheathPool) {
            s.mesh.removeFromParent();
            s.mat.dispose();
        }
        this.sheathPool.length = 0;
        for (const r of this.ringPool) {
            r.root.removeFromParent();
            r.mat.dispose();
        }
        this.ringPool.length = 0;
        for (const c of this.climaxPool) {
            c.root.removeFromParent();
            c.pillarMat.dispose();
            c.flashMat.dispose();
            c.ringMat.dispose();
            c.embers.dispose();
            c.emberMat.dispose();
        }
        this.climaxPool.length = 0;
        this.circleMesh.removeFromParent();
        this.circleGeo.dispose();
        this.circleMat.dispose();
        this.forgeMotes.removeFromParent();
        this.forgeMoteGeo.dispose();
        this.forgeMoteMat.dispose();
        this.forgeHalo.removeFromParent();
        this.forgeHaloMat.dispose();
        this.flyingSwordGeo.dispose();
        this.flyingSwordMat.dispose();
        this.ringGeo.dispose();
        this.sheathGeo.dispose();
        this.pillarGeo.dispose();
        this.emberGeo.dispose();
        this.haloTex.dispose();
        if (this.asset) this.disposeAsset(this.asset);
        this.asset = undefined;
    }

    private disposeAsset(asset: GLTF) {
        const geometry = new Set<T.BufferGeometry>();
        const materials = new Set<T.Material>();
        asset.scene.traverse(node => {
            if (!(node instanceof T.Mesh)) return;
            geometry.add(node.geometry);
            for (const material of [node.material].flat()) materials.add(material);
        });
        for (const item of geometry) item.dispose();
        for (const item of materials) item.dispose();
    }
}
