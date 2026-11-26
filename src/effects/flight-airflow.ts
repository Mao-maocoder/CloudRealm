import * as T from 'three';
import type { Quality } from '../config/settings';
import type { Player } from '../player/controller';

const WISP_COUNT = 12;
const WISP_SEGMENTS = 20;
const STREAK_COUNT = 56;
const MOTE_COUNT = 48;

const qualityScale: Record<Quality, { wisps: number; streaks: number; motes: number }> = {
    low: { wisps: 6, streaks: 28, motes: 20 },
    medium: { wisps: 10, streaks: 42, motes: 36 },
    high: { wisps: WISP_COUNT, streaks: STREAK_COUNT, motes: MOTE_COUNT },
};

function seeded(index: number, salt: number): number {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
    return x - Math.floor(x);
}

/**
 * Builds razor-thin, intermittent flank air-wisps that glide past the character's
 * left and right sides at high speed (detached from the body, subtle aerodynamic bend).
 */
function createWispGeometry(): T.BufferGeometry {
    const vertsPerWisp = (WISP_SEGMENTS + 1) * 2;
    const indicesPerWisp = WISP_SEGMENTS * 6;
    const totalVerts = WISP_COUNT * vertsPerWisp;
    const totalIndices = WISP_COUNT * indicesPerWisp;

    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const sides = new Float32Array(totalVerts);
    const paramsA = new Float32Array(totalVerts * 4); // lrSign, baseX, yHeight, width
    const paramsB = new Float32Array(totalVerts * 4); // zLength, zOffset, phase, speedMul
    const indices = new Uint16Array(totalIndices);

    let vCursor = 0;
    let iCursor = 0;

    for (let w = 0; w < WISP_COUNT; w++) {
        const lrSign = w % 2 === 0 ? 1 : -1;
        // Detached from the character silhouette so it reads as passing air, not spray.
        const baseX = 0.85 + seeded(w, 2) * 1.15;
        const yHeight = 0.45 + seeded(w, 3) * 1.55;
        const width = 0.014 + seeded(w, 4) * 0.016;
        const zLength = 2.8 + seeded(w, 5) * 2.2;
        const zOffset = -2.0 + seeded(w, 6) * 0.9;
        const phase = seeded(w, 7);
        const speedMul = 0.85 + seeded(w, 8) * 0.55;

        const baseVertex = vCursor;

        for (let s = 0; s <= WISP_SEGMENTS; s++) {
            const t = s / WISP_SEGMENTS;
            for (let side = 0; side < 2; side++) {
                const sign = side === 0 ? -1 : 1;
                positions[vCursor * 3] = 0;
                positions[vCursor * 3 + 1] = 0;
                positions[vCursor * 3 + 2] = t;

                uvs[vCursor * 2] = t;
                uvs[vCursor * 2 + 1] = side;
                sides[vCursor] = sign;

                paramsA[vCursor * 4] = lrSign;
                paramsA[vCursor * 4 + 1] = baseX;
                paramsA[vCursor * 4 + 2] = yHeight;
                paramsA[vCursor * 4 + 3] = width;

                paramsB[vCursor * 4] = zLength;
                paramsB[vCursor * 4 + 1] = zOffset;
                paramsB[vCursor * 4 + 2] = phase;
                paramsB[vCursor * 4 + 3] = speedMul;
                vCursor++;
            }

            if (s < WISP_SEGMENTS) {
                const a = baseVertex + s * 2;
                const b = a + 1;
                const c = a + 2;
                const d = a + 3;
                indices[iCursor++] = a;
                indices[iCursor++] = c;
                indices[iCursor++] = b;
                indices[iCursor++] = b;
                indices[iCursor++] = c;
                indices[iCursor++] = d;
            }
        }
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
    geometry.setAttribute('aSide', new T.BufferAttribute(sides, 1));
    geometry.setAttribute('aParamA', new T.BufferAttribute(paramsA, 4));
    geometry.setAttribute('aParamB', new T.BufferAttribute(paramsB, 4));
    geometry.setIndex(new T.BufferAttribute(indices, 1));
    return geometry;
}

/**
 * Builds crisp, fast-zipping wind streaks distributed in a wide horseshoe arch
 * around the character (left, right, and upper-sides; avoiding directly underneath
 * so they read purely as ambient air whipping past at high speed).
 */
function createStreakGeometry(): T.BufferGeometry {
    const totalVerts = STREAK_COUNT * 4;
    const totalIndices = STREAK_COUNT * 6;
    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const metaA = new Float32Array(totalVerts * 4); // posX, posY, zPhase, deflectSign
    const metaB = new Float32Array(totalVerts * 4); // length, width, speedMul, seed
    const indices = new Uint16Array(totalIndices);

    for (let i = 0; i < STREAK_COUNT; i++) {
        // Horseshoe arch: -16 deg to +196 deg (sides & upper arc, leaving below-feet clear).
        const u = (i + seeded(i, 21)) / STREAK_COUNT;
        const angle = -0.28 + u * (Math.PI + 0.56);
        const radius = 1.65 + Math.pow(seeded(i, 22), 0.72) * 4.35;
        const posX = Math.cos(angle) * radius;
        const posY = 1.15 + Math.sin(angle) * radius * 0.62;
        const zPhase = seeded(i, 24);
        const deflectSign = posX >= 0 ? 1 : -1;

        const length = 1.5 + seeded(i, 25) * 2.4;
        const width = 0.011 + seeded(i, 26) * 0.016;
        const speedMul = 0.8 + seeded(i, 27) * 0.65;
        const seed = seeded(i, 28);

        const base = i * 4;
        const corners: readonly [number, number][] = [
            [0, -1],
            [0, 1],
            [1, -1],
            [1, 1],
        ];
        for (let c = 0; c < 4; c++) {
            const v = base + c;
            positions[v * 3] = corners[c][0];
            positions[v * 3 + 1] = corners[c][1];
            positions[v * 3 + 2] = 0;

            uvs[v * 2] = corners[c][0];
            uvs[v * 2 + 1] = corners[c][1] * 0.5 + 0.5;

            metaA[v * 4] = posX;
            metaA[v * 4 + 1] = posY;
            metaA[v * 4 + 2] = zPhase;
            metaA[v * 4 + 3] = deflectSign;

            metaB[v * 4] = length;
            metaB[v * 4 + 1] = width;
            metaB[v * 4 + 2] = speedMul;
            metaB[v * 4 + 3] = seed;
        }

        const idx = i * 6;
        indices[idx] = base;
        indices[idx + 1] = base + 2;
        indices[idx + 2] = base + 1;
        indices[idx + 3] = base + 1;
        indices[idx + 4] = base + 2;
        indices[idx + 5] = base + 3;
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
    geometry.setAttribute('aMetaA', new T.BufferAttribute(metaA, 4));
    geometry.setAttribute('aMetaB', new T.BufferAttribute(metaB, 4));
    geometry.setIndex(new T.BufferAttribute(indices, 1));
    return geometry;
}

/**
 * Builds subtle sunlit air-motes whipping past in the same surrounding horseshoe arch.
 */
function createMoteGeometry(): T.BufferGeometry {
    const positions = new Float32Array(MOTE_COUNT * 3);
    const seeds = new Float32Array(MOTE_COUNT * 4); // posX, posY, phase, speedMul
    for (let i = 0; i < MOTE_COUNT; i++) {
        const angle = -0.25 + seeded(i, 41) * (Math.PI + 0.5);
        const radius = 1.45 + seeded(i, 42) * 3.8;
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;
        seeds[i * 4] = Math.cos(angle) * radius;
        seeds[i * 4 + 1] = 1.05 + Math.sin(angle) * radius * 0.6;
        seeds[i * 4 + 2] = seeded(i, 44);
        seeds[i * 4 + 3] = 0.78 + seeded(i, 45) * 0.7;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
    return geometry;
}

/**
 * Speed-gated high-speed airflow effect for sword flight:
 * - Silent/invisible during slow flight (<= 20 m/s) and takeoff mount.
 * - Activates smoothly during cruise (~30 m/s) and intensifies during Shift boost (~65 m/s).
 * - Uses detached, razor-thin passing wind streaks and flank air-wisps rushing past
 *   in the surrounding air space rather than spraying out of the character.
 */
export class FlightAirflow {
    readonly group = new T.Group();
    private readonly wisps: T.Mesh;
    private readonly streaks: T.Mesh;
    private readonly motes: T.Points;
    private readonly uniforms = {
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uIntensity: { value: 0 },
        uSpeedNorm: { value: 0 },
        uBoost: { value: 0 },
        uBank: { value: 0 },
        uPixelRatio: { value: 1 },
    };

    private intensity = 0;
    private speedNorm = 0;
    private boost = 0;
    private bank = 0;
    private flowDistance = 0;

    private readonly forward = new T.Vector3(0, 0, -1);
    private readonly desiredForward = new T.Vector3(0, 0, -1);
    private readonly worldUp = new T.Vector3(0, 1, 0);
    private readonly right = new T.Vector3();
    private readonly up = new T.Vector3();
    private readonly back = new T.Vector3();
    private readonly basis = new T.Matrix4();
    private readonly rollQuat = new T.Quaternion();
    private readonly targetQuat = new T.Quaternion();
    private initializedOrientation = false;

    constructor(scene: T.Scene, quality: Quality) {
        this.group.name = 'Flight Airflow';
        this.group.visible = false;

        const wispMaterial = new T.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: T.DoubleSide,
            blending: T.NormalBlending,
            vertexShader: /* glsl */ `
                attribute float aSide;
                attribute vec4 aParamA; // lrSign, baseX, yHeight, width
                attribute vec4 aParamB; // zLength, zOffset, phase, speedMul

                uniform float uTime;
                uniform float uSpeedNorm;
                uniform float uBoost;
                uniform float uBank;

                varying vec2 vUv;
                varying float vPhase;
                varying float vSpeedMul;
                varying float vFresnel;

                vec3 sampleWisp(float t, float lrSign, float baseX, float yHeight, float zLength, float zOffset, float phase, float speedMul) {
                    float z = zOffset + t * zLength;
                    // Gentle aerodynamic parting (~10 deg) as air slips past the character's flank.
                    float part = smoothstep(0.0, 1.0, t) * (0.35 + 0.18 * uBoost);
                    float flutter = sin(uTime * (5.5 + uSpeedNorm * 3.5) * speedMul - t * 8.0 + phase * 6.283) * 0.05;
                    float x = lrSign * (baseX + part) + flutter + uBank * t * t * 0.65;
                    float y = yHeight + cos(uTime * 3.8 * speedMul - t * 6.0 + phase * 6.283) * 0.04;
                    return vec3(x, y, z);
                }

                void main() {
                    float t = position.z;
                    float lrSign = aParamA.x;
                    float baseX = aParamA.y;
                    float yHeight = aParamA.z;
                    float width = aParamA.w * (0.9 + uSpeedNorm * 0.25 + uBoost * 0.28);
                    float zLength = aParamB.x * (0.85 + uSpeedNorm * 0.25 + uBoost * 0.35);
                    float zOffset = aParamB.y;
                    float phase = aParamB.z;
                    float speedMul = aParamB.w;

                    vec3 p = sampleWisp(t, lrSign, baseX, yHeight, zLength, zOffset, phase, speedMul);
                    vec3 pNext = sampleWisp(t + 0.03, lrSign, baseX, yHeight, zLength, zOffset, phase, speedMul);
                    vec3 tangent = normalize(pNext - p);

                    vec4 mvCenter = modelViewMatrix * vec4(p, 1.0);
                    vec3 viewDir = normalize(-mvCenter.xyz);
                    vec3 mvTangent = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
                    vec3 sideView = cross(mvTangent, viewDir);
                    float sideLen = length(sideView);
                    sideView = sideLen > 0.001 ? sideView / sideLen : vec3(0.0, 1.0, 0.0);

                    float taper = smoothstep(0.0, 0.20, t) * (1.0 - smoothstep(0.60, 1.0, t));
                    vec4 mvPos = mvCenter;
                    mvPos.xyz += sideView * aSide * width * taper;

                    gl_Position = projectionMatrix * mvPos;
                    vUv = uv;
                    vPhase = phase;
                    vSpeedMul = speedMul;
                    vFresnel = clamp(abs(dot(mvTangent, viewDir)), 0.0, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uFlow;
                uniform float uIntensity;
                uniform float uSpeedNorm;
                uniform float uBoost;

                varying vec2 vUv;
                varying float vPhase;
                varying float vSpeedMul;
                varying float vFresnel;

                void main() {
                    float t = vUv.x;
                    float across = abs(vUv.y - 0.5) * 2.0;
                    float core = pow(max(0.0, 1.0 - across), 1.8);

                    // Intermittent short wind pulses zipping past (not solid continuous hoses).
                    float cycle = fract(t * 1.15 - uFlow * 0.16 * vSpeedMul + vPhase);
                    float dash = smoothstep(0.0, 0.16, cycle) * (1.0 - smoothstep(0.32, 0.56, cycle));

                    float env = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.62, 1.0, t));
                    float viewFade = 1.0 - smoothstep(0.88, 0.995, vFresnel);

                    float alpha = core * env * dash * viewFade;
                    alpha *= uIntensity * (0.28 + 0.24 * uSpeedNorm + 0.26 * uBoost);
                    alpha = min(alpha, 0.62);
                    if (alpha < 0.005) discard;

                    vec3 tint = mix(vec3(0.92, 0.98, 1.00), vec3(0.58, 0.93, 1.00), uBoost * 0.55);
                    gl_FragColor = vec4(tint * (1.04 + 0.22 * uBoost), alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        });

        this.wisps = new T.Mesh(createWispGeometry(), wispMaterial);
        this.wisps.frustumCulled = false;
        this.wisps.renderOrder = 4;
        this.group.add(this.wisps);

        const streakMaterial = new T.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: T.DoubleSide,
            blending: T.NormalBlending,
            vertexShader: /* glsl */ `
                attribute vec4 aMetaA; // posX, posY, zPhase, deflectSign
                attribute vec4 aMetaB; // length, width, speedMul, seed

                uniform float uFlow;
                uniform float uSpeedNorm;
                uniform float uBoost;
                uniform float uBank;

                varying vec2 vUv;
                varying float vLifeFade;
                varying float vSeed;

                vec3 sampleStreak(float z, float posX, float posY, float deflectSign) {
                    // Air travels straight along flight path, parting gently around z=0.
                    float deflect = deflectSign * 0.32 * smoothstep(-3.5, 4.5, z);
                    float x = posX + deflect + uBank * max(0.0, z + 3.0) * 0.06;
                    return vec3(x, posY, z);
                }

                void main() {
                    float along = position.x; // 0 = head, 1 = tail
                    float side = position.y;  // -1 or +1

                    float posX = aMetaA.x;
                    float posY = aMetaA.y;
                    float zPhase = aMetaA.z;
                    float deflectSign = aMetaA.w;

                    float baseLen = aMetaB.x;
                    float width = aMetaB.y * (0.88 + uSpeedNorm * 0.30 + uBoost * 0.34);
                    float speedMul = aMetaB.z;
                    float seed = aMetaB.w;

                    // Zip from ahead (-14m) past the character and fade out before reaching camera (+5.5m).
                    float progress = fract(zPhase + uFlow * 0.075 * speedMul);
                    float zHead = mix(-14.0, 5.2, progress);
                    float len = baseLen * (0.65 + uSpeedNorm * 0.70 + uBoost * 0.85);
                    float z = zHead + along * len;

                    vec3 p = sampleStreak(z, posX, posY, deflectSign);
                    vec3 pNext = sampleStreak(z + 0.15, posX, posY, deflectSign);
                    vec3 tangent = normalize(pNext - p);

                    vec4 mvCenter = modelViewMatrix * vec4(p, 1.0);
                    vec3 mvAxis = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
                    vec3 viewDir = normalize(-mvCenter.xyz);
                    vec3 sideView = cross(mvAxis, viewDir);
                    float sideLen = length(sideView);
                    sideView = sideLen > 0.001 ? sideView / sideLen : vec3(0.0, 1.0, 0.0);

                    float taper = smoothstep(0.0, 0.25, along) * (1.0 - smoothstep(0.65, 1.0, along));
                    mvCenter.xyz += sideView * side * width * taper;

                    gl_Position = projectionMatrix * mvCenter;
                    vUv = uv;
                    // Fade in cleanly ahead, fade out cleanly before reaching the camera plane.
                    vLifeFade = smoothstep(0.0, 0.18, progress) * (1.0 - smoothstep(0.76, 1.0, progress));
                    vSeed = seed;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uIntensity;
                uniform float uSpeedNorm;
                uniform float uBoost;

                varying vec2 vUv;
                varying float vLifeFade;
                varying float vSeed;

                void main() {
                    float along = vUv.x;
                    float across = abs(vUv.y - 0.5) * 2.0;

                    float core = pow(max(0.0, 1.0 - across), 1.9);
                    float headTail = smoothstep(0.0, 0.22, along) * (1.0 - smoothstep(0.58, 1.0, along));

                    float alpha = core * headTail * vLifeFade * uIntensity * (0.24 + 0.28 * uSpeedNorm + 0.28 * uBoost);
                    alpha = min(alpha, 0.65);
                    if (alpha < 0.005) discard;

                    vec3 tint = mix(vec3(0.95, 0.99, 1.00), vec3(0.64, 0.94, 1.00), vSeed * 0.45 + uBoost * 0.40);
                    gl_FragColor = vec4(tint * (1.04 + 0.22 * uBoost), alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        });

        this.streaks = new T.Mesh(createStreakGeometry(), streakMaterial);
        this.streaks.frustumCulled = false;
        this.streaks.renderOrder = 4;
        this.group.add(this.streaks);

        const moteMaterial = new T.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                attribute vec4 aSeed; // posX, posY, phase, speedMul

                uniform float uTime;
                uniform float uFlow;
                uniform float uIntensity;
                uniform float uSpeedNorm;
                uniform float uBoost;
                uniform float uPixelRatio;

                varying float vAlpha;
                varying float vBoostMix;

                void main() {
                    float posX = aSeed.x;
                    float posY = aSeed.y;
                    float phase = aSeed.z;
                    float speedMul = aSeed.w;

                    float progress = fract(phase + uFlow * 0.08 * speedMul);
                    float z = mix(-11.0, 4.8, progress);
                    float x = posX + sin(uTime * 2.4 + phase * 10.0) * 0.14;
                    float y = posY + cos(uTime * 2.1 + phase * 8.0) * 0.12;

                    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
                    gl_Position = projectionMatrix * mv;

                    float fade = smoothstep(0.0, 0.18, progress) * (1.0 - smoothstep(0.72, 1.0, progress));
                    float size = (13.0 + 14.0 * fract(phase * 13.7)) * (0.8 + 0.35 * uBoost) * uPixelRatio;
                    gl_PointSize = clamp(size / max(1.2, -mv.z), 1.5, 11.0);
                    vAlpha = fade * uIntensity * (0.20 + 0.24 * uSpeedNorm + 0.30 * uBoost);
                    vBoostMix = fract(phase * 7.3) * 0.55 + uBoost * 0.45;
                }
            `,
            fragmentShader: /* glsl */ `
                varying float vAlpha;
                varying float vBoostMix;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);
                    float glow = smoothstep(0.5, 0.04, d);
                    float alpha = glow * glow * vAlpha;
                    if (alpha < 0.005) discard;

                    vec3 col = mix(vec3(0.94, 0.99, 1.00), vec3(0.56, 0.93, 1.00), clamp(vBoostMix, 0.0, 1.0));
                    gl_FragColor = vec4(col * alpha, alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        });

        this.motes = new T.Points(createMoteGeometry(), moteMaterial);
        this.motes.frustumCulled = false;
        this.motes.renderOrder = 4;
        this.group.add(this.motes);

        this.setQuality(quality);
        scene.add(this.group);
    }

    setQuality(quality: Quality) {
        const budget = qualityScale[quality];
        this.wisps.geometry.setDrawRange(0, budget.wisps * WISP_SEGMENTS * 6);
        this.streaks.geometry.setDrawRange(0, budget.streaks * 6);
        this.motes.geometry.setDrawRange(0, budget.motes);
    }

    update(dt: number, player: Player, active: boolean, pixelRatio: number) {
        const riding = active && player.flying && player.avatar.riding;
        const speed = player.velocity.length();

        // Keep airflow completely off during slow flight (slow = 15 m/s ≈ 54 km/h).
        // Smoothly ramp in above 20 m/s (72 km/h) up through cruise (30 m/s) and boost (65 m/s).
        const speedGate = riding ? T.MathUtils.smoothstep(speed, 20, 31) : 0;
        const targetIntensity = speedGate;
        const targetSpeedNorm = riding ? T.MathUtils.clamp((speed - 20) / 30, 0, 1.4) : 0;
        const targetBoost = riding && player.boosting ? T.MathUtils.smoothstep(speed, 34, 54) : 0;
        const targetBank = riding ? T.MathUtils.clamp(player.bank, -0.5, 0.5) : 0;

        this.intensity = T.MathUtils.damp(this.intensity, targetIntensity, targetIntensity > this.intensity ? 6.5 : 8.5, dt);
        this.speedNorm = T.MathUtils.damp(this.speedNorm, targetSpeedNorm, 6, dt);
        this.boost = T.MathUtils.damp(this.boost, targetBoost, 6, dt);
        this.bank = T.MathUtils.damp(this.bank, targetBank, 7, dt);

        if (this.intensity < 0.01) {
            this.group.visible = false;
            this.initializedOrientation = false;
            return;
        }

        this.group.visible = true;
        this.group.position.copy(player.avatar.position);

        if (speed > 2.5) {
            this.desiredForward.copy(player.velocity).divideScalar(speed);
        } else {
            this.desiredForward.set(Math.sin(player.heading), 0, -Math.cos(player.heading));
        }

        if (!this.initializedOrientation) {
            this.forward.copy(this.desiredForward);
            this.initializedOrientation = true;
        } else {
            this.forward.lerp(this.desiredForward, 1 - Math.exp(-10 * dt)).normalize();
        }

        this.back.copy(this.forward).negate();
        this.right.crossVectors(this.worldUp, this.back);
        if (this.right.lengthSq() < 1e-4) {
            this.right.set(Math.cos(player.heading), 0, Math.sin(player.heading));
        } else {
            this.right.normalize();
        }
        this.up.crossVectors(this.back, this.right).normalize();

        this.basis.makeBasis(this.right, this.up, this.back);
        this.targetQuat.setFromRotationMatrix(this.basis);
        this.rollQuat.setFromAxisAngle(this.back, -this.bank * 0.75);
        this.group.quaternion.copy(this.targetQuat).premultiply(this.rollQuat);

        const effectiveFlowSpeed = Math.max(12, speed) * (1 + this.boost * 0.28);
        this.flowDistance += dt * effectiveFlowSpeed;

        this.uniforms.uTime.value += dt;
        this.uniforms.uFlow.value = this.flowDistance;
        this.uniforms.uIntensity.value = this.intensity;
        this.uniforms.uSpeedNorm.value = this.speedNorm;
        this.uniforms.uBoost.value = this.boost;
        this.uniforms.uBank.value = this.bank;
        this.uniforms.uPixelRatio.value = pixelRatio;
    }

    clear() {
        this.intensity = 0;
        this.speedNorm = 0;
        this.boost = 0;
        this.bank = 0;
        this.initializedOrientation = false;
        this.group.visible = false;
    }

    dispose() {
        this.wisps.geometry.dispose();
        (this.wisps.material as T.Material).dispose();
        this.streaks.geometry.dispose();
        (this.streaks.material as T.Material).dispose();
        this.motes.geometry.dispose();
        (this.motes.material as T.Material).dispose();
        this.group.removeFromParent();
    }
}
