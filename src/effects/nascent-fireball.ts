import * as T from 'three';
import veinsUrl from '../../resource/fireball/Nascent_Fireball_Veins.png';
import coronaUrl from '../../resource/fireball/Nascent_Fireball_Corona_RGBA.png';
import { fireballRaiseTime, fireballReleaseTime } from '../player/avatar';
import { fireballAim, traceFireballWorld, type SampleGround } from './fireball-trajectory';
import type { FireballLockTarget } from './fireball';
import type { FireballImpact } from './fireball-impact';
import type { SpellLightPool } from './spell-lights';

const GATHER_MOTE_COUNT = 160;
const GATHER_STRAND_COUNT = 14;
const METEOR_EMBER_COUNT = 36;
const IMPACT_SHARD_COUNT = 40;
const METEOR_GRAVITY = 7.5;
/** Corona ortho_scale (3.0) / sphere diameter (1.96) = 1.5306 -> full sprite scale per unit sphere radius. */
const CORONA_SCALE_PER_RADIUS = 3.08;
/** Approximate distance from the head anchor down to the caster's feet. */
const CASTER_FEET_BELOW_HEAD = 1.2;
const up = new T.Vector3(0, 1, 0);

/**
 * Builds GATHER_STRAND_COUNT independent energy-flow strands. Each strand is a strip of
 * (segs+1)*2 vertices whose actual 3D path is evaluated in the vertex shader from its own
 * random parameters, so every strand rises along a different trajectory.
 */
function createGatherStrandsGeometry(): T.BufferGeometry {
    const segs = 48;
    const tAttr: number[] = [];
    const sideAttr: number[] = [];
    const seedA: number[] = [];
    const seedB: number[] = [];
    const indices: number[] = [];
    let s = 1337;
    const rnd = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };

    for (let k = 0; k < GATHER_STRAND_COUNT; k++) {
        // Evenly spread start angles with jitter so strands surround the body without clumping
        const a0 = ((k + rnd() * 0.7) / GATHER_STRAND_COUNT) * Math.PI * 2;
        const r0 = 0.3 + rnd() * 0.45; // leaves the body 0.3..0.75m out
        const h0 = 0.05 + rnd() * 0.85; // emission height along body (feet -> head)
        const swirl = (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 3.2); // signed total twist (rad)
        const bulge = 0.25 + rnd() * 1.25; // how far it bows outward mid-flight
        const ease = 0.7 + rnd() * 0.75; // vertical easing exponent
        const wFreq = 1.2 + rnd() * 2.6; // lateral wobble frequency
        const wAmp = 0.12 + rnd() * 0.42; // lateral wobble amplitude
        const phase = rnd() * 6.283;
        const speed = 0.55 + rnd() * 0.4; // surge travel speed (~1.5..2.6s from body to orb)
        const width = 0.09 + rnd() * 0.12;
        const endAng = rnd() * 6.283; // where on the orb underside it plunges in
        const baseVert = tAttr.length;

        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            for (const side of [-1, 1]) {
                tAttr.push(t);
                sideAttr.push(side);
                seedA.push(a0, r0, h0, swirl, bulge, ease, wFreq, wAmp);
                seedB.push(phase, speed, width, endAng);
            }
            if (i < segs) {
                const v = baseVert + i * 2;
                indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
            }
        }
    }

    const count = tAttr.length;
    const geo = new T.BufferGeometry();
    // Dummy positions (real path computed in shader); needed for draw count
    geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aT', new T.Float32BufferAttribute(tAttr, 1));
    geo.setAttribute('aSide', new T.Float32BufferAttribute(sideAttr, 1));
    const a = new Float32Array(count * 4);
    const b = new Float32Array(count * 4);
    const c = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        for (let j = 0; j < 4; j++) {
            a[i * 4 + j] = seedA[i * 8 + j];
            b[i * 4 + j] = seedA[i * 8 + 4 + j];
            c[i * 4 + j] = seedB[i * 4 + j];
        }
    }
    geo.setAttribute('aPathA', new T.BufferAttribute(a, 4));
    geo.setAttribute('aPathB', new T.BufferAttribute(b, 4));
    geo.setAttribute('aFlow', new T.BufferAttribute(c, 4));
    geo.setIndex(indices);
    return geo;
}

/**
 * Camera-facing energy surges: each strand periodically peels off the caster's body as a discrete
 * stream of fire-qi that travels its own winding path all the way up and is swallowed by the fireball.
 * Every new surge re-rolls its path, so no two consecutive surges follow the same trajectory.
 */
function createGatherStrandsMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uLocal: { value: 0 },
            uStrength: { value: 0 },
            uBottom: { value: -5 },
            uTop: { value: -1 },
            uTopR: { value: 0.8 },
            uBodyH: { value: CASTER_FEET_BELOW_HEAD },
        },
        vertexShader: /* glsl */ `
            attribute float aT;
            attribute float aSide;
            attribute vec4 aPathA; // a0, r0, h0, swirl
            attribute vec4 aPathB; // bulge, ease, wFreq, wAmp
            attribute vec4 aFlow;  // phase, speed, width, endAng
            uniform float uTime;
            uniform float uLocal;
            uniform float uBottom;
            uniform float uTop;
            uniform float uTopR;
            uniform float uBodyH;
            varying float vT;
            varying float vSide;
            varying float vD;
            varying float vPhase;

            const float LEN = 0.42; // visible surge length (fraction of the whole path)

            float hash(float x) { return fract(sin(x * 12.9898 + aFlow.x * 78.233) * 43758.5453); }

            vec3 strandPos(float t, float a0, float r0, float h0, float swirl, float bulge, float endAng) {
                float ease = aPathB.y, wFreq = aPathB.z, wAmp = aPathB.w;
                float phase = aFlow.x;
                float startY = uBottom + 0.1 + h0 * uBodyH;
                float y = mix(startY, uTop, pow(t, ease));
                float bow = bulge * sin(3.1416 * pow(t, 0.8)) * (1.0 - 0.45 * t);
                float ang = mix(a0, a0 + swirl, t);
                vec2 baseXZ = vec2(cos(ang), sin(ang)) * (mix(r0, 0.0, t) + bow);
                vec2 endXZ = vec2(cos(endAng), sin(endAng)) * uTopR * 0.55;
                vec2 xz = mix(baseXZ, baseXZ * 0.3 + endXZ, smoothstep(0.5, 1.0, t));
                float env = sin(3.1416 * t);
                float w1 = sin(t * wFreq * 6.283 - uTime * (1.1 + wAmp) + phase) * wAmp * env;
                float w2 = cos(t * wFreq * 4.1 + uTime * 0.8 + phase * 1.7) * wAmp * 0.6 * env;
                xz += vec2(-sin(ang), cos(ang)) * w1 + vec2(cos(ang), sin(ang)) * w2;
                y += sin(t * 9.0 + uTime * 1.3 + phase) * 0.08 * env;
                return vec3(xz.x, y, xz.y);
            }

            void main() {
                vT = aT;
                vSide = aSide;
                vPhase = aFlow.x;

                // Staggered launch: strands start surging one after another once charging begins
                float delay = aFlow.x / 6.283 * 0.9;
                float ct = (uLocal - delay) * aFlow.y;
                float period = 1.0 + LEN;
                float ci = floor(max(ct, 0.0) / period);
                float head = mod(max(ct, 0.0), period);
                vD = ct < 0.0 ? -1.0 : (head - aT) / LEN;

                // Re-roll this surge's path every cycle
                float h1 = hash(ci + 1.0), h2 = hash(ci + 7.3), h3 = hash(ci + 13.1), h4 = hash(ci + 21.7);
                float a0 = aPathA.x + (h1 - 0.5) * 2.4;
                float r0 = aPathA.y * (0.7 + 0.6 * h2);
                float h0 = fract(aPathA.z + h3 * 0.6);
                float swirl = aPathA.w * (h2 < 0.35 ? -1.0 : 1.0) * (0.6 + 0.8 * h4);
                float bulge = aPathB.x * (0.5 + 0.9 * h3);
                float endAng = aFlow.w + h4 * 6.283;

                vec3 p = strandPos(aT, a0, r0, h0, swirl, bulge, endAng);
                vec3 pn = strandPos(min(aT + 0.02, 1.0), a0, r0, h0, swirl, bulge, endAng);
                vec3 pp = strandPos(max(aT - 0.02, 0.0), a0, r0, h0, swirl, bulge, endAng);
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                vec3 tang = (modelViewMatrix * vec4(pn - pp, 0.0)).xyz;
                vec3 side = normalize(cross(tang, mv.xyz) + vec3(1e-5, 0.0, 0.0));
                // Fat glowing head, thinning tail; the whole surge narrows as it is drawn into the orb
                float dn = clamp(vD, 0.0, 1.0);
                float w = aFlow.z * mix(1.15, 0.35, dn) * (1.0 - 0.5 * aT);
                mv.xyz += side * aSide * w;
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uStrength;
            varying float vT;
            varying float vSide;
            varying float vD;
            varying float vPhase;

            float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
            float n1(float x) {
                float i = floor(x), f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(h1(i), h1(i + 1.0), f);
            }

            void main() {
                if (uStrength <= 0.01 || vD < 0.0 || vD > 1.0) discard;
                // Bright leading head, long fading tail
                float env = smoothstep(0.0, 0.07, vD) * (1.0 - smoothstep(0.2, 1.0, vD));
                float flick = n1(vT * 16.0 - uTime * 5.0 + vPhase * 10.0);
                float across = abs(vSide);
                float edge = mix(0.55, 1.0, flick);
                float core = 1.0 - smoothstep(edge * 0.3, edge, across);
                float hot = exp(-across * across * 9.0);
                float ends = smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.9, 1.0, vT));
                float alpha = core * env * ends * uStrength;
                if (alpha < 0.02) discard;
                float headHeat = 1.0 - smoothstep(0.0, 0.5, vD);
                float heat = clamp(vT * 0.45 + headHeat * 0.6, 0.0, 1.0);
                vec3 col = mix(vec3(0.92, 0.14, 0.02), vec3(1.32, 0.58, 0.07), heat);
                col = mix(col, vec3(1.6, 1.25, 0.6), hot * headHeat * 0.8);
                gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-strands-v2';
    return mat;
}

function createGatherUpdraftMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uStrength: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uStrength;
            varying vec2 vUv;
            void main() {
                if (uStrength <= 0.01) discard;
                vec2 p = vUv * 2.0 - 1.0;
                float r = length(p);
                if (r > 1.0) discard;
                float ang = atan(p.y, p.x);
                // Fire aura welling up at the caster's feet, pulsing outward from the body
                float tongues = 0.5 + 0.5 * sin(ang * 9.0 - r * 6.0 + uTime * 3.2);
                float wave = fract(r * 1.8 - uTime * 1.2);
                float core = 1.0 - smoothstep(0.15, 0.95, r);
                float intensity = core * (0.45 + 0.55 * tongues) * (0.55 + 0.45 * wave) * uStrength;
                if (intensity < 0.02) discard;
                vec3 col = mix(vec3(0.92, 0.16, 0.02), vec3(1.42, 0.82, 0.16), (1.0 - r) * 0.8 * tongues);
                gl_FragColor = vec4(col, clamp(intensity * 0.6, 0.0, 0.7));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-updraft-v2';
    return mat;
}

/**
 * Custom GLSL shader driven by our Blender Cycles-rendered 360° seamless plasma filament map:
 * Two counter-rotating 3D spherical layers create writhing, razor-sharp branching lightning-fire
 * veins over a deep smoky volcanic-crimson interior and blazing Fresnel rim.
 */
function createSolarOrbMaterial(veinsMap: T.Texture): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: false,
        depthWrite: true,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uCharge: { value: 1 },
            uVeinsMap: { value: veinsMap },
        },
        vertexShader: /* glsl */ `
            uniform float uTime;
            uniform float uCharge;
            varying vec3 vObjDir;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;

            void main() {
                vec3 dir = normalize(position);
                // Subtle organic plasma breathe on the silhouette
                float pulse = sin(dir.x * 5.0 + uTime * 2.2) * cos(dir.y * 5.0 - uTime * 1.9) * sin(dir.z * 5.0 + uTime * 1.6);
                vec3 displaced = position + normal * pulse * (0.022 + 0.014 * uCharge);
                vObjDir = dir;
                vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
                vNormalDir = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uCharge;
            uniform sampler2D uVeinsMap;
            varying vec3 vObjDir;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;

            const float INV_TWO_PI = 0.15915494;
            const float INV_PI = 0.31830989;

            vec2 dirToEquirect(vec3 d) {
                float u = atan(d.z, d.x) * INV_TWO_PI + 0.5;
                float v = asin(clamp(d.y, -1.0, 1.0)) * INV_PI + 0.5;
                return vec2(u, v);
            }

            vec3 rotY(vec3 p, float a) {
                float c = cos(a), s = sin(a);
                return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
            }

            vec3 rotX(vec3 p, float a) {
                float c = cos(a), s = sin(a);
                return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
            }

            void main() {
                vec3 n = normalize(vNormalDir);
                vec3 v = normalize(vViewDir);
                float ndotv = clamp(abs(dot(n, v)), 0.0, 1.0);
                float fresnel = pow(1.0 - ndotv, 2.35);
                float rimHot = pow(1.0 - ndotv, 4.6);

                // Two counter-rotating 3D spherical samples of the Blender Cycles filament map
                vec3 d1 = rotY(normalize(vObjDir), uTime * 0.22);
                vec3 d2 = rotX(rotY(normalize(vObjDir), -uTime * 0.17 + 1.4), uTime * 0.19 + 0.85);

                vec3 s1 = texture2D(uVeinsMap, dirToEquirect(d1)).rgb;
                vec3 s2 = texture2D(uVeinsMap, dirToEquirect(d2)).rgb;

                // R = razor-sharp lightning filaments, G = soft orange plasma halo, B = smoky ember bed
                float sharpVein = max(s1.r, s2.r * 0.82);
                float softGlow = clamp(s1.g * 0.72 + s2.g * 0.58, 0.0, 1.25);
                float smokeBed = mix(s1.b, s2.b, 0.5);

                // Limb boost: keep interior deeply smoky & brooding while veins blaze fiercely near the rim
                float limbBoost = mix(0.55, 1.55, fresnel);
                float veins = sharpVein * limbBoost;
                float glow = softGlow * limbBoost;

                vec3 darkCore = vec3(0.055, 0.009, 0.003) + vec3(0.22, 0.028, 0.003) * smokeBed * (0.35 + 0.65 * fresnel);
                vec3 fireOrange = vec3(1.16, 0.27, 0.014);
                vec3 goldPlasma = vec3(1.38, 0.76, 0.12);
                vec3 whiteHot = vec3(1.58, 1.44, 0.90);

                float orangeMix = clamp(fresnel * 0.86 + glow * 0.62 + veins * 0.55, 0.0, 1.0);
                float goldMix = clamp(rimHot * 0.92 + pow(veins, 1.35) * 0.92 + glow * veins * 0.45, 0.0, 1.0);
                float hotSpark = (pow(veins, 2.6) * 0.82 + pow(rimHot, 2.0) * 0.52) * (0.78 + 0.30 * uCharge);

                vec3 col = darkCore;
                col = mix(col, fireOrange, orangeMix);
                col = mix(col, goldPlasma, goldMix);
                col += whiteHot * hotSpark;

                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-orb-cycles-v2';
    return mat;
}

/** Paired Cycles-rendered wispy solar-flare corona sprite materials (Normal + Additive for day/night pop). */
function createCoronaSpriteMaterials(coronaMap: T.Texture): { outer: T.SpriteMaterial; inner: T.SpriteMaterial } {
    const outer = new T.SpriteMaterial({
        map: coronaMap,
        color: new T.Color('#ff8224'),
        transparent: true,
        opacity: 0.92,
        blending: T.NormalBlending,
        depthWrite: false,
        toneMapped: false,
    });
    const inner = new T.SpriteMaterial({
        map: coronaMap,
        color: new T.Color('#ffb848'),
        transparent: true,
        opacity: 0.68,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
    return { outer, inner };
}

/** Outer licking solar-flare corona shell wrapping the dark plasma core. */
function createSolarCoronaMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.BackSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uAlpha: { value: 1 },
        },
        vertexShader: /* glsl */ `
            uniform float uTime;
            varying vec3 vObjPos;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;

            float hash3(vec3 p) {
                p = fract(p * 0.3183099 + 0.17);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float noise3(vec3 x) {
                vec3 i = floor(x), f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
            }

            void main() {
                float flare = noise3(position * 2.8 + vec3(uTime * 1.1, -uTime * 1.6, uTime * 0.8));
                vec3 p = position * (1.06 + flare * 0.16);
                vObjPos = p;
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                vNormalDir = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uAlpha;
            varying vec3 vObjPos;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;

            float hash3(vec3 p) {
                p = fract(p * 0.3183099 + 0.17);
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }
            float noise3(vec3 x) {
                vec3 i = floor(x), f = fract(x);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                        mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                        mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
            }

            void main() {
                float rim = pow(clamp(abs(dot(normalize(vNormalDir), normalize(vViewDir))), 0.0, 1.0), 1.4);
                float wisps = noise3(normalize(vObjPos) * 5.2 + vec3(0.0, -uTime * 2.4, uTime * 1.5));
                float mask = rim * smoothstep(0.24, 0.82, wisps) * uAlpha;
                vec3 col = mix(vec3(1.05, 0.22, 0.02), vec3(1.45, 0.82, 0.22), wisps);
                gl_FragColor = vec4(col, clamp(mask * 0.78, 0.0, 0.85));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-corona-v1';
    return mat;
}

/** Heavy trailing meteoric flame & ash-smoke wake cone. */
function createMeteorWakeMaterial(): T.ShaderMaterial {
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
        vertexShader: /* glsl */ `
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
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uAlpha;
            varying vec2 vUv;
            varying vec3 vNormalDir;
            varying vec3 vViewDir;

            float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float n2(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(h2(i), h2(i + vec2(1,0)), f.x), mix(h2(i + vec2(0,1)), h2(i + vec2(1,1)), f.x), f.y);
            }

            void main() {
                float along = vUv.y; // 0 = near meteor, 1 = far tail
                float edge = pow(abs(dot(normalize(vNormalDir), normalize(vViewDir))), 0.65);
                float s1 = n2(vec2(vUv.x * 6.0, along * 5.5 - uTime * 5.8));
                float s2 = n2(vec2(vUv.x * 12.0 + 2.3, along * 11.0 - uTime * 9.2));
                float flame = s1 * 0.62 + s2 * 0.38;
                float env = smoothstep(0.0, 0.14, along) * pow(1.0 - along, 1.55);
                float alpha = edge * env * smoothstep(0.22, 0.85, flame) * uAlpha;
                vec3 col = mix(vec3(0.95, 0.18, 0.02), vec3(1.38, 0.72, 0.16), flame * (1.0 - along * 0.65));
                gl_FragColor = vec4(col, clamp(alpha * 0.68, 0.0, 0.75));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-wake-v1';
    return mat;
}

/** Fiery expanding ground shockwave ring on meteor impact. */
function createMeteorRingMaterial(): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uAlpha: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uProgress;
            uniform float uAlpha;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uAlpha <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float lead = mix(0.14, 0.94, uProgress);
                float mainRing = exp(-pow((r - lead) / 0.075, 2.0));
                float innerWave = exp(-pow((r - max(0.05, lead - 0.18)) / 0.045, 2.0)) * 0.6;
                float cracks = 0.68 + 0.32 * sin(a * 14.0 + uTime * 5.0) * cos(a * 9.0 - uTime * 3.0);
                float mask = (mainRing * cracks + innerWave) * (1.0 - smoothstep(0.92, 1.0, r));
                vec3 col = mix(vec3(1.15, 0.24, 0.02), vec3(1.5, 0.94, 0.34), mainRing * 0.65);
                gl_FragColor = vec4(col, clamp(mask * uAlpha, 0.0, 0.92));
            }
        `,
    });
    mat.customProgramCacheKey = () => 'nascent-fb-ring-v1';
    return mat;
}

interface MeteorSlot {
    root: T.Group;
    orb: T.Mesh;
    orbMat: T.ShaderMaterial;
    coronaOuter: T.Sprite;
    coronaOuterMat: T.SpriteMaterial;
    coronaInner: T.Sprite;
    coronaInnerMat: T.SpriteMaterial;
    wake: T.Mesh;
    wakeMat: T.ShaderMaterial;
    embers: T.InstancedMesh;
    inUse: boolean;
    velocity: T.Vector3;
    targetSpeed: number;
    curSpeed: number;
    radius: number;
    power: number;
    age: number;
    duration: number;
    homing?: FireballLockTarget;
}

interface MeteorImpactSlot {
    root: T.Group;
    dome: T.Mesh;
    domeMat: T.ShaderMaterial;
    ring: T.Mesh;
    ringMat: T.ShaderMaterial;
    shards: T.InstancedMesh;
    shardMat: T.MeshBasicMaterial;
    shardVel: T.Vector3[];
    inUse: boolean;
    age: number;
    duration: number;
    maxRadius: number;
    origin: T.Vector3;
}

/**
 * Nascent Soul (元婴期) Meteoric Fireball (`焚天火陨`):
 * 1. Charging: Vast streams of crimson-gold fire energy spiral up from around the cultivator
 *    and condense high above their head into a colossal dark-core crackling solar-plasma orb.
 * 2. Flight: Launches with weighty, deliberate meteoric inertia (accelerating heavily rather than
 *    zipping like small darts), tumbling ominously with a fiery cone wake & molten embers,
 *    and supporting weighty Divine Sense lock-on curving.
 * 3. Impact: Cataclysmic solar-plasma dome, scorching shockwave ring, and ballistic magma shards.
 */
export class NascentFireball {
    readonly group = new T.Group();
    readonly warmObjects: T.Object3D[] = [];

    private readonly orbGeo = new T.IcosahedronGeometry(1, 4);
    private readonly coronaGeo = new T.IcosahedronGeometry(1, 3);
    private readonly wakeGeo: T.CylinderGeometry;
    private readonly emberGeo = new T.OctahedronGeometry(0.16, 0);
    private readonly ringGeo = new T.PlaneGeometry(2, 2);
    private readonly emberMat = new T.MeshBasicMaterial({
        color: '#ff9428',
        transparent: true,
        opacity: 0.92,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });

    private readonly veinsTex: T.Texture;
    private readonly coronaTex: T.Texture;

    // Overhead charging orb & fire-energy convergence vortex (persistent, zero runtime allocation)
    private readonly chargeRoot = new T.Group();
    private readonly chargeOrb: T.Mesh;
    private readonly chargeOrbMat: T.ShaderMaterial;
    private readonly chargeCoronaOuter: T.Sprite;
    private readonly chargeCoronaOuterMat: T.SpriteMaterial;
    private readonly chargeCoronaInner: T.Sprite;
    private readonly chargeCoronaInnerMat: T.SpriteMaterial;
    private readonly gatherMoteGeo: T.BufferGeometry;
    private readonly gatherMoteMat: T.ShaderMaterial;
    private readonly gatherMotes: T.Points;
    private readonly gatherStrandGeo = createGatherStrandsGeometry();
    private readonly gatherStrandMat = createGatherStrandsMaterial();
    private readonly gatherStrands: T.Mesh;
    private chargeStartElapsed = 0;
    private readonly gatherUpdraftMat = createGatherUpdraftMaterial();
    private readonly gatherUpdraft: T.Mesh;
    private chargeRadius = 1.65;
    private chargeVisible = false;
    private elapsed = 0;

    // Pre-allocated pools for flying meteors & impacts
    private readonly meteorPool: MeteorSlot[] = [];
    private readonly impactPool: MeteorImpactSlot[] = [];

    private readonly next = new T.Vector3();
    private readonly steerTo = new T.Vector3();
    private readonly steerDir = new T.Vector3();
    private readonly curDir = new T.Vector3();
    private readonly dummy = new T.Object3D();
    private readonly hotColor = new T.Color('#fff0a4');
    private readonly coolColor = new T.Color('#ff3c08');
    private readonly tmpCol = new T.Color();

    constructor(
        private readonly scene: T.Scene,
        private readonly sampleGround: SampleGround,
        private readonly traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
        private readonly blast: (point: T.Vector3, power: number, directHit: boolean, radiusScale?: number) => void,
        private readonly sharedImpact: FireballImpact,
    ) {
        this.group.name = 'Nascent Meteoric Fireball';
        this.ringGeo.rotateX(-Math.PI / 2);

        // Open tapered wake cone extending behind -Z from the meteor center
        this.wakeGeo = new T.CylinderGeometry(1.02, 0.14, 7.6, 16, 1, true);
        this.wakeGeo.rotateX(-Math.PI / 2);
        this.wakeGeo.translate(0, 0, -4.1);

        // Load Blender Cycles-rendered seamless plasma vein map & wispy solar-flare corona
        const loader = new T.TextureLoader();
        this.veinsTex = loader.load(veinsUrl);
        this.veinsTex.wrapS = T.RepeatWrapping;
        this.veinsTex.wrapT = T.ClampToEdgeWrapping;
        this.veinsTex.colorSpace = T.NoColorSpace;
        this.veinsTex.anisotropy = 4;

        this.coronaTex = loader.load(coronaUrl);
        this.coronaTex.colorSpace = T.SRGBColorSpace;
        this.coronaTex.anisotropy = 4;

        // 1. Overhead charging solar-plasma orb
        this.chargeRoot.name = 'NascentFireball_ChargeRoot';
        this.chargeRoot.visible = false;
        this.chargeOrbMat = createSolarOrbMaterial(this.veinsTex);
        this.chargeOrb = new T.Mesh(this.orbGeo, this.chargeOrbMat);
        this.chargeOrb.renderOrder = 6;
        const chargeCoronaMats = createCoronaSpriteMaterials(this.coronaTex);
        this.chargeCoronaOuterMat = chargeCoronaMats.outer;
        this.chargeCoronaInnerMat = chargeCoronaMats.inner;
        this.chargeCoronaOuter = new T.Sprite(this.chargeCoronaOuterMat);
        this.chargeCoronaOuter.renderOrder = 5;
        this.chargeCoronaInner = new T.Sprite(this.chargeCoronaInnerMat);
        this.chargeCoronaInner.renderOrder = 7;
        this.chargeRoot.add(this.chargeOrb, this.chargeCoronaOuter, this.chargeCoronaInner);

        // Fire-qi released from the caster's own body: rising flame funnel + foot aura + ascending embers
        this.gatherStrands = new T.Mesh(this.gatherStrandGeo, this.gatherStrandMat);
        this.gatherStrands.frustumCulled = false;
        this.gatherStrands.renderOrder = 6;

        this.gatherUpdraft = new T.Mesh(this.ringGeo, this.gatherUpdraftMat);
        this.gatherUpdraft.frustumCulled = false;
        this.gatherUpdraft.renderOrder = 5;

        const motePos = new Float32Array(GATHER_MOTE_COUNT * 3);
        const moteSeed = new Float32Array(GATHER_MOTE_COUNT * 4);
        for (let i = 0; i < GATHER_MOTE_COUNT; i++) {
            moteSeed[i * 4] = (i / GATHER_MOTE_COUNT) * Math.PI * 2 + (i % 7) * 0.41;
            moteSeed[i * 4 + 1] = 0.18 + ((i * 37) % 100) / 100 * 0.62; // emitted 0.18..0.8m off the body
            moteSeed[i * 4 + 2] = ((i * 53) % 100) / 100; // emission height along the body (feet -> head)
            moteSeed[i * 4 + 3] = ((i * 19) % 100) / 100; // phase
        }
        this.gatherMoteGeo = new T.BufferGeometry();
        this.gatherMoteGeo.setAttribute('position', new T.BufferAttribute(motePos, 3));
        this.gatherMoteGeo.setAttribute('aSeed', new T.BufferAttribute(moteSeed, 4));
        this.gatherMoteMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.NormalBlending,
            toneMapped: false,
            uniforms: {
                uTime: { value: 0 },
                uStrength: { value: 0 },
                uBottom: { value: -5 },
                uTop: { value: -1 },
            },
            vertexShader: /* glsl */ `
                attribute vec4 aSeed;
                uniform float uTime;
                uniform float uStrength;
                uniform float uBottom;
                uniform float uTop;
                varying float vGlow;
                varying float vHeat;
                void main() {
                    // Fire sparks shed from the caster's body, rising and accelerating into the orb
                    float cycle = fract(aSeed.w + uTime * (0.3 + aSeed.w * 0.22));
                    float rise = pow(cycle, 1.45);
                    float startY = uBottom + 0.1 + aSeed.z * ${CASTER_FEET_BELOW_HEAD.toFixed(2)};
                    float y = mix(startY, uTop, rise);
                    // Drift slightly outward first, then converge as they near the fireball
                    float converge = 1.0 - smoothstep(0.25, 1.0, cycle);
                    float rad = aSeed.y * (1.0 + 0.55 * sin(cycle * 3.1416)) * converge;
                    float ang = aSeed.x + cycle * (1.8 + aSeed.w) + uTime * 0.6;
                    vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
                    // Flickering heat turbulence
                    p.x += sin(uTime * 7.0 + aSeed.w * 40.0 + y * 3.0) * 0.07 * converge;
                    p.z += cos(uTime * 6.3 + aSeed.x * 11.0 + y * 2.6) * 0.07 * converge;
                    vGlow = smoothstep(0.0, 0.10, cycle) * (1.0 - smoothstep(0.86, 1.0, cycle)) * uStrength;
                    vHeat = cycle;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = clamp((48.0 + 40.0 * aSeed.w) / max(1.5, -mv.z), 4.0, 26.0);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                varying float vGlow;
                varying float vHeat;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0 || vGlow <= 0.01) discard;
                    float core = exp(-d * d * 5.2);
                    float halo = pow(max(0.0, 1.0 - d), 1.8);
                    vec3 col = mix(vec3(0.98, 0.20, 0.02), vec3(1.58, 1.24, 0.48), clamp(vHeat * 0.55 + core * 0.65, 0.0, 1.0));
                    gl_FragColor = vec4(col, clamp((core * 1.1 + halo * 0.65) * vGlow, 0.0, 0.95));
                }
            `,
        });
        this.gatherMoteMat.customProgramCacheKey = () => 'nascent-fb-gather-v3';
        this.gatherMotes = new T.Points(this.gatherMoteGeo, this.gatherMoteMat);
        this.gatherMotes.frustumCulled = false;
        this.gatherMotes.renderOrder = 7;
        this.chargeRoot.add(this.gatherStrands, this.gatherUpdraft, this.gatherMotes);
        this.group.add(this.chargeRoot);

        // 2. Pre-allocated meteor projectile pool (2 slots)
        for (let i = 0; i < 2; i++) {
            const root = new T.Group();
            root.name = `NascentFireball_Meteor_${i}`;
            root.visible = false;

            const orbMat = createSolarOrbMaterial(this.veinsTex);
            const orb = new T.Mesh(this.orbGeo, orbMat);
            orb.renderOrder = 6;

            const coronaMats = createCoronaSpriteMaterials(this.coronaTex);
            const coronaOuter = new T.Sprite(coronaMats.outer);
            coronaOuter.renderOrder = 5;
            const coronaInner = new T.Sprite(coronaMats.inner);
            coronaInner.renderOrder = 7;

            const wakeMat = createMeteorWakeMaterial();
            const wake = new T.Mesh(this.wakeGeo, wakeMat);
            wake.renderOrder = 4;

            const embers = new T.InstancedMesh(this.emberGeo, this.emberMat, METEOR_EMBER_COUNT);
            embers.instanceMatrix.setUsage(T.DynamicDrawUsage);
            embers.frustumCulled = false;
            embers.renderOrder = 7;

            root.add(orb, coronaOuter, coronaInner, wake, embers);
            this.group.add(root);
            this.meteorPool.push({
                root,
                orb,
                orbMat,
                coronaOuter,
                coronaOuterMat: coronaMats.outer,
                coronaInner,
                coronaInnerMat: coronaMats.inner,
                wake,
                wakeMat,
                embers,
                inUse: false,
                velocity: new T.Vector3(),
                targetSpeed: 28,
                curSpeed: 14,
                radius: 1.8,
                power: 0.5,
                age: 0,
                duration: 6,
            });
        }

        // 3. Pre-allocated cataclysmic impact climax pool (2 slots)
        for (let i = 0; i < 2; i++) {
            const root = new T.Group();
            root.name = `NascentFireball_Impact_${i}`;
            root.visible = false;

            const domeMat = createSolarCoronaMaterial();
            domeMat.side = T.DoubleSide;
            const dome = new T.Mesh(this.coronaGeo, domeMat);
            dome.renderOrder = 7;

            const ringMat = createMeteorRingMaterial();
            const ring = new T.Mesh(this.ringGeo, ringMat);
            ring.position.y = 0.18;
            ring.renderOrder = 7;

            const shardMat = new T.MeshBasicMaterial({
                color: '#ff9a2e',
                transparent: true,
                opacity: 0.95,
                blending: T.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            });
            const shards = new T.InstancedMesh(this.emberGeo, shardMat, IMPACT_SHARD_COUNT);
            shards.instanceMatrix.setUsage(T.DynamicDrawUsage);
            shards.frustumCulled = false;
            shards.renderOrder = 8;

            const shardVel: T.Vector3[] = [];
            for (let k = 0; k < IMPACT_SHARD_COUNT; k++) {
                const ang = (k / IMPACT_SHARD_COUNT) * Math.PI * 2 + ((k * 17) % 10) * 0.07;
                const spd = 6.5 + ((k * 31) % 100) / 100 * 16.0;
                const vy = 7.0 + ((k * 43) % 100) / 100 * 14.5;
                shardVel.push(new T.Vector3(Math.cos(ang) * spd, vy, Math.sin(ang) * spd));
                this.tmpCol.copy(this.hotColor).lerp(this.coolColor, (k % 3) * 0.45);
                shards.setColorAt(k, this.tmpCol);
            }
            if (shards.instanceColor) shards.instanceColor.needsUpdate = true;

            root.add(dome, ring, shards);
            this.group.add(root);
            this.impactPool.push({
                root,
                dome,
                domeMat,
                ring,
                ringMat,
                shards,
                shardMat,
                shardVel,
                inUse: false,
                age: 0,
                duration: 1.25,
                maxRadius: 15,
                origin: new T.Vector3(),
            });
        }

        this.warmObjects.push(
            this.chargeRoot,
            this.meteorPool[0].root,
            this.impactPool[0].root,
        );
        this.scene.add(this.group);
    }

    /** Updates the overhead fire-energy convergence & growing solar-plasma orb while casting in Nascent Soul realm. */
    updateCharge(head: T.Object3D | undefined, time: number | undefined, power: number) {
        if (!head || time === undefined || time <= fireballRaiseTime || time >= fireballReleaseTime + 0.08) {
            this.chargeRoot.visible = false;
            this.chargeVisible = false;
            return;
        }
        const grow = T.MathUtils.smoothstep(time, fireballRaiseTime, fireballReleaseTime * 0.92);
        const radius = T.MathUtils.lerp(0.32, T.MathUtils.lerp(1.55, 2.55, power), grow);
        this.chargeRadius = radius;

        head.getWorldPosition(this.chargeRoot.position);
        // Hover majestically high above the cultivator's head, rising slightly as it swells
        this.chargeRoot.position.y += 2.6 + radius * 1.15;
        this.chargeRoot.visible = true;
        if (!this.chargeVisible) this.chargeStartElapsed = this.elapsed;
        this.chargeVisible = true;

        this.chargeOrb.scale.setScalar(radius);
        this.chargeOrb.rotation.y = this.elapsed * 0.55;
        this.chargeOrb.rotation.x = this.elapsed * 0.28;
        this.chargeOrbMat.uniforms.uTime.value = this.elapsed;
        this.chargeOrbMat.uniforms.uCharge.value = power;

        const pulse = 1 + 0.03 * Math.sin(this.elapsed * 7.5);
        this.chargeCoronaOuter.scale.setScalar(radius * CORONA_SCALE_PER_RADIUS * pulse);
        this.chargeCoronaOuterMat.rotation = this.elapsed * 0.28;
        this.chargeCoronaOuterMat.opacity = grow * 0.92;
        this.chargeCoronaInner.scale.setScalar(radius * (CORONA_SCALE_PER_RADIUS * 0.95) * (2 - pulse));
        this.chargeCoronaInnerMat.rotation = -this.elapsed * 0.42;
        this.chargeCoronaInnerMat.opacity = grow * (0.62 + 0.14 * Math.sin(this.elapsed * 9.0));

        // Energy should appear the moment casting starts (released from the body), not only once the orb is big
        const emit = T.MathUtils.smoothstep(time, fireballRaiseTime, fireballRaiseTime + 0.25);
        const gatherStrength = Math.max(emit * 0.75, grow) * (0.85 + 0.30 * power);
        // Local space is centred on the orb; the caster's feet sit below the head anchor
        const feetY = -(2.6 + radius * 1.15) - CASTER_FEET_BELOW_HEAD;
        const intoOrbY = -radius * 0.45;

        this.gatherMoteMat.uniforms.uTime.value = this.elapsed;
        this.gatherMoteMat.uniforms.uStrength.value = gatherStrength;
        this.gatherMoteMat.uniforms.uBottom.value = feetY;
        this.gatherMoteMat.uniforms.uTop.value = intoOrbY;

        const su = this.gatherStrandMat.uniforms;
        su.uTime.value = this.elapsed;
        su.uStrength.value = gatherStrength;
        su.uLocal.value = this.elapsed - this.chargeStartElapsed;
        su.uBottom.value = feetY;
        su.uTop.value = intoOrbY;
        su.uTopR.value = radius;

        this.gatherUpdraft.position.y = feetY + 0.06;
        this.gatherUpdraft.scale.setScalar(1.3 + 0.7 * grow);
        this.gatherUpdraftMat.uniforms.uTime.value = this.elapsed;
        this.gatherUpdraftMat.uniforms.uStrength.value = gatherStrength;
    }

    /** Releases the condensed colossal solar-plasma orb with heavy meteoric flight feel! */
    release(camera: T.Camera, caster: T.Vector3, power: number, lockedTarget?: FireballLockTarget) {
        let slot = this.meteorPool.find(m => !m.inUse);
        if (!slot) slot = this.meteorPool[0];

        const homing = lockedTarget && lockedTarget.state !== 'Dead' ? lockedTarget : undefined;
        const aim = homing
            ? new T.Vector3(homing.position.x, homing.position.y + homing.profile.height * 0.52, homing.position.z)
            : fireballAim(camera, caster, Math.min(1, power + 0.35), this.sampleGround);

        const origin = this.chargeVisible
            ? this.chargeRoot.position.clone()
            : new T.Vector3(caster.x, caster.y + 4.4, caster.z);
        this.chargeRoot.visible = false;
        this.chargeVisible = false;

        const radius = T.MathUtils.lerp(1.65, 2.65, power);
        // Heavy, weighty meteoric speed: starts sluggish & colossal (14 m/s) and builds momentum to 28..34 m/s!
        const initialSpeed = T.MathUtils.lerp(13.5, 16.5, power);
        const targetSpeed = T.MathUtils.lerp(27.0, 34.0, power);
        const dist = origin.distanceTo(aim);
        const dir = aim.clone().sub(origin);
        if (dir.lengthSq() < 1e-4) camera.getWorldDirection(dir);
        dir.normalize();
        // Slight upward loft on manual shots so the heavy meteor arcs down like a falling star
        if (!homing) {
            dir.y += T.MathUtils.clamp(dist * 0.0028, 0.04, 0.24);
            dir.normalize();
        }

        slot.inUse = true;
        slot.age = 0;
        slot.power = Math.min(1, power + 0.25);
        slot.radius = radius;
        slot.curSpeed = initialSpeed;
        slot.targetSpeed = targetSpeed;
        slot.velocity.copy(dir).multiplyScalar(initialSpeed);
        slot.homing = homing;
        slot.duration = Math.max(4.5, dist / (targetSpeed * 0.78) + 2.8);

        slot.root.position.copy(origin);
        slot.root.lookAt(this.next.copy(origin).add(slot.velocity));
        slot.orb.scale.setScalar(radius);
        slot.coronaOuter.scale.setScalar(radius * CORONA_SCALE_PER_RADIUS);
        slot.coronaInner.scale.setScalar(radius * (CORONA_SCALE_PER_RADIUS * 0.95));
        slot.wake.scale.set(radius * 0.96, radius * 0.96, radius * 1.25);
        slot.root.visible = true;
        this.updateMeteorEmbers(slot);
    }

    private updateMeteorEmbers(slot: MeteorSlot) {
        const r = slot.radius;
        for (let i = 0; i < METEOR_EMBER_COUNT; i++) {
            const drift = (i * 0.618 + slot.age * (1.8 + (i % 5) * 0.22)) % 1;
            const ang = i * 2.399 + drift * (i % 2 === 0 ? 1.1 : -1.1);
            const spread = r * (0.45 + drift * 0.85);
            this.dummy.position.set(
                Math.cos(ang) * spread,
                Math.sin(ang) * spread + 0.35 * drift * drift,
                -r * 0.55 - drift * (r * 4.6),
            );
            this.dummy.rotation.set(slot.age * 3.5 + i, slot.age * 2.8, i);
            const s = (1 - drift) * (0.42 + (i % 4) * 0.22) * (r * 0.55);
            this.dummy.scale.set(s, s, s * 2.6);
            this.dummy.updateMatrix();
            slot.embers.setMatrixAt(i, this.dummy.matrix);
            slot.embers.setColorAt(i, this.tmpCol.copy(this.hotColor).lerp(this.coolColor, drift));
        }
        slot.embers.instanceMatrix.needsUpdate = true;
        if (slot.embers.instanceColor) slot.embers.instanceColor.needsUpdate = true;
    }

    private spawnImpactClimax(point: T.Vector3, power: number) {
        let slot = this.impactPool.find(c => !c.inUse);
        if (!slot) slot = this.impactPool[0];
        slot.inUse = true;
        slot.age = 0;
        slot.duration = 1.45;
        slot.maxRadius = T.MathUtils.lerp(18.5, 25.5, power);
        slot.origin.copy(point);
        slot.root.position.copy(point);
        slot.root.visible = true;
        slot.dome.visible = true;
        slot.ring.visible = true;
    }

    update(dt: number) {
        if (dt <= 0) return;
        this.elapsed += dt;

        // 1. Advance flying colossal meteors
        for (const slot of this.meteorPool) {
            if (!slot.inUse) continue;
            const step = Math.min(dt, slot.duration - slot.age);
            const from = slot.root.position;
            const activeHoming = slot.homing && slot.homing.state !== 'Dead' ? slot.homing : undefined;
            if (!activeHoming) slot.homing = undefined;

            // Heavy meteoric acceleration (builds weighty momentum after launch)
            slot.curSpeed = T.MathUtils.damp(slot.curSpeed, slot.targetSpeed, 1.45, step);

            if (activeHoming) {
                this.steerTo.set(
                    activeHoming.position.x,
                    activeHoming.position.y + activeHoming.profile.height * 0.52,
                    activeHoming.position.z,
                );
                this.steerDir.subVectors(this.steerTo, from);
                const dist = this.steerDir.length();
                if (dist > 0.1) {
                    this.steerDir.multiplyScalar(1 / dist);
                    this.curDir.copy(slot.velocity).normalize();
                    // Weighty, deliberate meteor homing curve (heavier than agile twin fireballs!)
                    const turn = dist < 16 ? 6.2 : 3.2;
                    this.curDir.lerp(this.steerDir, 1 - Math.exp(-turn * step)).normalize();
                    slot.velocity.copy(this.curDir).multiplyScalar(slot.curSpeed);
                }
            } else {
                const len = slot.velocity.length();
                if (len > 0.1) {
                    slot.velocity.multiplyScalar(slot.curSpeed / len);
                }
                slot.velocity.y -= METEOR_GRAVITY * step;
            }

            const next = this.next.copy(from).addScaledVector(slot.velocity, step);
            const world = traceFireballWorld(from, next, this.sampleGround, slot.radius * 0.58);
            const creature = this.traceCreature(from, next);
            const contact = Math.min(world?.t ?? Infinity, creature ?? Infinity);

            if (contact <= 1) {
                next.lerpVectors(from, next, contact);
                const directHit = creature !== undefined && (world === undefined || creature <= world.t);
                const surface = world && world.t === contact ? world.ground : undefined;
                if (surface) next.y = surface.height;
                const below = surface ?? this.sampleGround(next.x, next.z, next.y + 0.6);
                const nearGround = surface !== undefined || (directHit && Math.abs(next.y - below.height) < 3.5);
                const groundHeight = surface ? surface.height : nearGround ? below.height : undefined;

                this.sharedImpact.play(next, surface ? surface.kind : directHit ? below.kind : 'stone', nearGround, 1.0, groundHeight, 2.45);
                this.spawnImpactClimax(next, slot.power);
                this.blast(next, slot.power, directHit, 2.65);

                slot.inUse = false;
                slot.root.visible = false;
                continue;
            }

            from.copy(next);
            slot.root.lookAt(this.next.copy(from).add(slot.velocity));
            // Slow ominous meteoric tumble on the inner plasma orb + counter-rotating Cycles corona wisps
            slot.orb.rotation.x += step * 0.68;
            slot.orb.rotation.y += step * 0.45;
            slot.coronaOuterMat.rotation += step * 0.36;
            slot.coronaInnerMat.rotation -= step * 0.54;
            const flicker = 1 + 0.035 * Math.sin(this.elapsed * 9.5 + slot.age * 4.0);
            slot.coronaOuter.scale.setScalar(slot.radius * CORONA_SCALE_PER_RADIUS * flicker);
            slot.coronaInner.scale.setScalar(slot.radius * (CORONA_SCALE_PER_RADIUS * 0.95) * (2 - flicker));

            slot.orbMat.uniforms.uTime.value = this.elapsed;
            slot.orbMat.uniforms.uCharge.value = slot.power;
            slot.wakeMat.uniforms.uTime.value = this.elapsed;
            slot.wakeMat.uniforms.uAlpha.value = T.MathUtils.smoothstep(slot.age, 0, 0.25);

            slot.age += step;
            this.updateMeteorEmbers(slot);
            if (slot.age >= slot.duration) {
                slot.inUse = false;
                slot.root.visible = false;
            }
        }

        // 2. Advance pooled cataclysmic meteor impacts
        for (const c of this.impactPool) {
            if (!c.inUse) continue;
            c.age += dt;
            if (c.age >= c.duration) {
                c.inUse = false;
                c.root.visible = false;
                continue;
            }
            const p = c.age / c.duration;

            const domeFade = 1 - T.MathUtils.smoothstep(p, 0.14, 0.72);
            const domeS = T.MathUtils.lerp(2.2, c.maxRadius * 0.56, Math.min(1, p / 0.55));
            c.dome.scale.set(domeS, domeS * 0.78, domeS);
            c.domeMat.uniforms.uTime.value = this.elapsed;
            c.domeMat.uniforms.uAlpha.value = domeFade * 0.95;
            c.dome.visible = domeFade > 0.01;

            const rProg = Math.min(1, p / 0.85);
            const rEase = 1 - Math.pow(1 - rProg, 2.5);
            c.ring.scale.setScalar(T.MathUtils.lerp(2.4, c.maxRadius, rEase));
            c.ringMat.uniforms.uTime.value = this.elapsed;
            c.ringMat.uniforms.uProgress.value = rEase;
            c.ringMat.uniforms.uAlpha.value = (1 - T.MathUtils.smoothstep(rProg, 0.25, 1.0)) * 0.96;
            c.ring.visible = rProg < 1;

            const sFade = 1 - T.MathUtils.smoothstep(p, 0.45, 1.0);
            c.shardMat.opacity = sFade * 0.95;
            for (let i = 0; i < IMPACT_SHARD_COUNT; i++) {
                const v = c.shardVel[i];
                const drag = 1 - Math.min(0.45, c.age * 0.38);
                const y = Math.max(0.08, v.y * c.age * drag - 13.5 * c.age * c.age);
                this.dummy.position.set(v.x * c.age * drag, y, v.z * c.age * drag);
                this.dummy.rotation.set(c.age * 6 + i, c.age * 5 + i * 0.5, 0);
                const sc = Math.max(0.01, sFade * (0.75 + (i % 4) * 0.35));
                this.dummy.scale.set(sc * 0.6, sc * 2.2, sc * 0.6);
                this.dummy.updateMatrix();
                c.shards.setMatrixAt(i, this.dummy.matrix);
            }
            c.shards.instanceMatrix.needsUpdate = true;
        }
    }

    /** Shadow-free dynamic crimson-orange fill lights (zero 6-face cubemap shadow stalls!). */
    collectLights(pool: SpellLightPool) {
        if (this.chargeVisible) {
            const p = this.chargeRoot.position;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0xff6a18,
                intensity: 10.5 * (0.6 + 0.4 * (this.chargeRadius / 2.5)),
                distance: 28,
                priority: 88,
                castShadow: false,
            });
        }
        for (const slot of this.meteorPool) {
            if (!slot.inUse) continue;
            const p = slot.root.position;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0xff6e1a,
                intensity: 16.5,
                distance: 34,
                priority: 94,
                castShadow: false,
            });
        }
        for (const c of this.impactPool) {
            if (!c.inUse) continue;
            const fade = Math.max(0, 1 - c.age / 0.9);
            if (fade <= 0.02) continue;
            pool.emit({
                x: c.origin.x,
                y: c.origin.y + 2.4,
                z: c.origin.z,
                color: 0xff7b24,
                intensity: 26 * fade * fade,
                distance: 42,
                priority: 98,
                castShadow: false,
            });
        }
    }

    clear() {
        this.chargeRoot.visible = false;
        this.chargeVisible = false;
        for (const slot of this.meteorPool) {
            slot.inUse = false;
            slot.root.visible = false;
        }
        for (const c of this.impactPool) {
            c.inUse = false;
            c.root.visible = false;
        }
    }

    dispose() {
        this.clear();
        this.veinsTex.dispose();
        this.coronaTex.dispose();
        this.orbGeo.dispose();
        this.coronaGeo.dispose();
        this.wakeGeo.dispose();
        this.emberGeo.dispose();
        this.ringGeo.dispose();
        this.emberMat.dispose();
        this.chargeOrbMat.dispose();
        this.chargeCoronaOuterMat.dispose();
        this.chargeCoronaInnerMat.dispose();
        this.gatherMoteGeo.dispose();
        this.gatherMoteMat.dispose();
        this.gatherStrandGeo.dispose();
        this.gatherStrandMat.dispose();
        this.gatherUpdraftMat.dispose();
        for (const slot of this.meteorPool) {
            slot.orbMat.dispose();
            slot.coronaOuterMat.dispose();
            slot.coronaInnerMat.dispose();
            slot.wakeMat.dispose();
            slot.embers.dispose();
        }
        for (const c of this.impactPool) {
            c.domeMat.dispose();
            c.ringMat.dispose();
            c.shards.dispose();
            c.shardMat.dispose();
        }
        this.group.removeFromParent();
    }
}
