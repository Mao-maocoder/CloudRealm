import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SpellLightPool } from './spell-lights';

interface RippleSlot {
    active: boolean;
    age: number;
    duration: number;
    maxRadius: number;
    strength: number;
    spin: number;
    x: number;
    y: number;
    z: number;
}

interface FloatingCloud {
    sprite: T.Sprite;
    phase: number;
    angle: number;
    radius: number;
    speed: number;
    baseScale: number;
}

const MAX_RIPPLES = 18;
const TRAIL_POINTS = 24;
const GOLD_SPARK_COUNT = 30;
const DIAMOND_SHARD_COUNT = 12;
const CLOUD_SPRITE_COUNT = 2;

const RIPPLE_TEX_URL = new URL('../../resource/fly/nascent/spatial_ripple_rgba.png', import.meta.url).href;
const HOVER_PAD_TEX_URL = new URL('../../resource/fly/nascent/spatial_hover_pad_rgba.png', import.meta.url).href;
const CLOUD_MIST_TEX_URL = new URL('../../resource/fly/nascent/escape_cloud_mist.png', import.meta.url).href;
const GOLD_HALO_TEX_URL = new URL('../../resource/fly/nascent/escape_halo_gold.png', import.meta.url).href;
const GOLD_CLOUD_TEX_URL = new URL('../../resource/fly/nascent/auspicious_cloud_gold.png', import.meta.url).href;
const ESCAPE_MODEL_URL = new URL('../../resource/fly/nascent/Escape_Light_3D.glb', import.meta.url).href;

/**
 * Nascent Soul (元婴期) aerial VFX powered by hybrid Blender assets + custom Three.js shaders:
 * 1. Void Spatial Ripples (spatial_ripple_rgba.png + spatial_hover_pad_rgba.png) for mid-air hover & Skywalk.
 * 2. 7-Layer Celestial Escape Light (元婴遁光):
 *    - Leading golden double-halo ring + translucent glacial-cyan Fresnel spirit sphere
 *    - Blazing warm-white starburst core flare
 *    - Tapered ice-cyan & gold-threaded silky energy spear + billowing ink-cloud mist veil
 *    - Sculpted sweeping champagne-gold & glacial-cyan celestial silk ribbons (Escape_Light_3D.glb)
 *    - Drifting golden auspicious clouds (auspicious_cloud_gold.png)
 *    - Dynamic world-space curving cloud-mist & silk wake ribbon
 *    - Crisp stretched cyan diamond shards (◆) & sparkling golden starlight dust
 */
export class VoidFlightEffects {
    readonly group = new T.Group();
    private readonly ripples: RippleSlot[] = [];
    private readonly rippleMeshes: T.Mesh[] = [];
    private readonly rippleGeo: T.PlaneGeometry;
    private readonly hoverPad: T.Mesh;
    private readonly hoverPadMat: T.ShaderMaterial;

    private readonly lightGroup = new T.Group();
    private readonly haloSprite: T.Sprite;
    private readonly haloMat: T.SpriteMaterial;
    private readonly coreFlareMesh: T.Mesh;
    private readonly coreFlareMat: T.ShaderMaterial;
    private readonly burstMesh: T.Mesh;
    private readonly burstMat: T.ShaderMaterial;
    private readonly clouds: FloatingCloud[] = [];

    private escapeModel?: T.Group;
    private readonly escapeUniformMaterials: T.ShaderMaterial[] = [];
    private readonly loadedTextures: T.Texture[] = [];

    private readonly trailMesh: T.Mesh;
    private readonly trailGeo: T.BufferGeometry;
    private readonly trailMat: T.ShaderMaterial;
    private readonly trailPositions: Float32Array;
    private readonly trailHistory: T.Vector3[] = [];
    private trailCount = 0;

    private readonly goldDust: T.Points;
    private readonly goldDustMat: T.ShaderMaterial;
    private readonly diamondShards: T.Points;
    private readonly diamondShardMat: T.ShaderMaterial;

    private readonly dummyTex: T.DataTexture;
    private cloudMistTex?: T.Texture;
    private loadPromise?: Promise<void>;
    private disposed = false;

    private time = 0;
    private activeRipples = 0;
    private hoverTimer = 0;
    private stepDist = 0;
    private stepSide = 1;
    private lightBlend = 0;
    private burstAge = 99;
    private wasEscapeLight = false;
    private readonly lightPos = new T.Vector3();
    private readonly forward = new T.Vector3(0, 0, -1);
    private readonly right = new T.Vector3();
    private readonly up = new T.Vector3(0, 1, 0);
    private readonly sideA = new T.Vector3();
    private readonly sideB = new T.Vector3();
    private readonly tangent = new T.Vector3();
    private readonly quat = new T.Quaternion();
    private readonly baseZ = new T.Vector3(0, 0, 1);

    get escapeBlend(): number {
        return this.lightBlend;
    }

    get warmObjects(): readonly T.Object3D[] {
        const list: T.Object3D[] = [
            this.group,
            this.lightGroup,
            this.hoverPad,
            this.haloSprite,
            this.coreFlareMesh,
            this.burstMesh,
            this.trailMesh,
            this.goldDust,
            this.diamondShards,
        ];
        if (this.rippleMeshes[0]) list.push(this.rippleMeshes[0]);
        if (this.escapeModel) list.push(this.escapeModel);
        return list;
    }

    constructor(scene: T.Scene) {
        this.group.name = 'Void Flight VFX';

        this.dummyTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        this.dummyTex.needsUpdate = true;

        // 1. Spatial ripple pool (Blender-rendered spatial_ripple_rgba.png)
        this.rippleGeo = new T.PlaneGeometry(1, 1);
        this.rippleGeo.rotateX(-Math.PI / 2);

        for (let i = 0; i < MAX_RIPPLES; i++) {
            this.ripples.push({ active: false, age: 0, duration: 1, maxRadius: 2.6, strength: 1, spin: 0, x: 0, y: 0, z: 0 });
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uMap: { value: this.dummyTex },
                    uHasMap: { value: 0 },
                    uProgress: { value: 0 },
                    uStrength: { value: 0 },
                    uTime: { value: 0 },
                },
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                blending: T.AdditiveBlending,
                vertexShader: /* glsl */ `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform sampler2D uMap;
                    uniform float uHasMap;
                    uniform float uProgress;
                    uniform float uStrength;
                    uniform float uTime;
                    varying vec2 vUv;

                    void main() {
                        vec2 p2 = vUv * 2.0 - 1.0;
                        float r = length(p2);
                        if (r > 1.0) discard;
                        float p = clamp(uProgress, 0.0, 1.0);
                        float fade = smoothstep(0.0, 0.10, p) * (1.0 - smoothstep(0.28, 1.0, p));

                        if (uHasMap > 0.5) {
                            vec4 tex = texture2D(uMap, vUv);
                            float shimmer = 0.88 + 0.12 * sin(atan(p2.y, p2.x) * 6.0 - uTime * 4.5 + r * 8.0);
                            vec3 tint = mix(vec3(0.70, 0.94, 1.0), vec3(1.0, 0.88, 0.62), smoothstep(0.35, 0.85, 1.0 - r) * 0.45);
                            vec3 col = tex.rgb * tint * 1.35 * shimmer;
                            gl_FragColor = vec4(col, clamp(tex.a * fade * uStrength, 0.0, 0.95));
                        } else {
                            float ring = exp(-pow((r - mix(0.2, 0.9, p)) / 0.06, 2.0));
                            gl_FragColor = vec4(vec3(0.68, 0.92, 1.0), ring * fade * uStrength);
                        }
                    }
                `,
            });
            mat.customProgramCacheKey = () => 'void-flight-ripple-v1';
            const mesh = new T.Mesh(this.rippleGeo, mat);
            mesh.visible = false;
            mesh.renderOrder = 5;
            this.rippleMeshes.push(mesh);
            this.group.add(mesh);
        }

        // Persistent tranquil spatial mirror pad under feet when hovering / sky-standing
        this.hoverPadMat = new T.ShaderMaterial({
            uniforms: {
                uMap: { value: this.dummyTex },
                uHasMap: { value: 0 },
                uTime: { value: 0 },
                uAlpha: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uHasMap;
                uniform float uTime;
                uniform float uAlpha;
                varying vec2 vUv;

                vec2 rot2(vec2 p, float a) {
                    float c = cos(a), s = sin(a);
                    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
                }

                void main() {
                    vec2 p = vUv * 2.0 - 1.0;
                    float r = length(p);
                    if (r > 1.0) discard;

                    if (uHasMap > 0.5) {
                        float breath = 1.0 + 0.045 * sin(uTime * 2.4);
                        vec2 uvA = rot2(p * breath, uTime * 0.22) * 0.5 + 0.5;
                        vec2 uvB = rot2(p * (1.16 - 0.04 * sin(uTime * 2.4)), -uTime * 0.16) * 0.5 + 0.5;
                        vec4 tA = texture2D(uMap, clamp(uvA, 0.0, 1.0));
                        vec4 tB = texture2D(uMap, clamp(uvB, 0.0, 1.0));
                        vec3 col = (tA.rgb * 0.85 + tB.rgb * 0.55) * vec3(0.80, 0.94, 1.0) * 1.25;
                        float alpha = clamp(tA.a * 0.82 + tB.a * 0.42, 0.0, 1.0) * uAlpha;
                        gl_FragColor = vec4(col, alpha);
                    } else {
                        float rim = exp(-pow((r - 0.72) / 0.08, 2.0));
                        gl_FragColor = vec4(vec3(0.72, 0.92, 1.0), rim * uAlpha * 0.7);
                    }
                }
            `,
        });
        this.hoverPadMat.customProgramCacheKey = () => 'void-flight-hoverpad-v1';
        this.hoverPad = new T.Mesh(this.rippleGeo, this.hoverPadMat);
        this.hoverPad.scale.setScalar(2.75);
        this.hoverPad.visible = false;
        this.hoverPad.renderOrder = 4;
        this.group.add(this.hoverPad);

        // 2. Escape Light Layer 1: Leading Golden Double Halo Ring (subtle, translucent — no daytime white blowout)
        this.haloMat = new T.SpriteMaterial({
            map: this.dummyTex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: T.AdditiveBlending,
            toneMapped: true,
        });
        this.haloSprite = new T.Sprite(this.haloMat);
        this.haloSprite.position.set(0, 0, 1.22);
        this.haloSprite.scale.setScalar(1.95);
        this.haloSprite.renderOrder = 7;
        this.lightGroup.add(this.haloSprite);

        // 3. Escape Light Layer 2: Blazing Warm-White Starburst Core Flare (billboarded in vertex shader)
        this.coreFlareMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv * 2.0 - 1.0;
                    // True spherical billboard around object origin in view space
                    vec4 mvOrigin = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    float sx = length(vec3(modelViewMatrix[0].xyz));
                    float sy = length(vec3(modelViewMatrix[1].xyz));
                    mvOrigin.xy += position.xy * vec2(sx, sy);
                    gl_Position = projectionMatrix * mvOrigin;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uTime;
                uniform float uAlpha;
                varying vec2 vUv;

                void main() {
                    float r = length(vUv);
                    if (r > 1.0) discard;
                    float pulse = 0.93 + 0.07 * sin(uTime * 15.0);

                    // Blazing incandescent white-gold core
                    float core = exp(-r * r * 20.0);
                    float halo = exp(-r * r * 4.2) * 0.65;

                    // Crisp 4-point diagonal + cardinal celestial starburst rays
                    float a = uTime * 0.25;
                    float ca = cos(a), sa = sin(a);
                    vec2 p1 = vec2(ca * vUv.x - sa * vUv.y, sa * vUv.x + ca * vUv.y);
                    float rayMain = (exp(-abs(p1.y) * 26.0) * exp(-abs(p1.x) * 2.2) + exp(-abs(p1.x) * 26.0) * exp(-abs(p1.y) * 2.2)) * 0.85;
                    vec2 p2 = vec2(0.7071 * (vUv.x - vUv.y), 0.7071 * (vUv.x + vUv.y));
                    float rayDiag = (exp(-abs(p2.y) * 32.0) * exp(-abs(p2.x) * 3.0) + exp(-abs(p2.x) * 32.0) * exp(-abs(p2.y) * 3.0)) * 0.55;

                    vec3 col = mix(vec3(0.32, 0.84, 0.96), vec3(1.0, 0.88, 0.56), smoothstep(0.0, 0.6, halo));
                    col = mix(col, vec3(0.96, 0.99, 1.0), clamp(core * 0.85 + (rayMain + rayDiag) * 0.45, 0.0, 1.0));
                    float alpha = (core * 0.62 + halo * 0.48 + (rayMain + rayDiag) * 0.45) * pulse * uAlpha;
                    gl_FragColor = vec4(col * 0.92, clamp(alpha, 0.0, 0.65));
                }
            `,
        });
        this.coreFlareMat.customProgramCacheKey = () => 'void-flight-coreflare-v1';
        this.coreFlareMesh = new T.Mesh(new T.PlaneGeometry(1, 1), this.coreFlareMat);
        this.coreFlareMesh.position.set(0, 0.08, 1.38);
        this.coreFlareMesh.scale.setScalar(1.45);
        this.coreFlareMesh.renderOrder = 8;
        this.lightGroup.add(this.coreFlareMesh);

        // 4. Drifting Golden Auspicious Cloud Motifs (delicate translucent normal-blended wisps)
        for (let i = 0; i < CLOUD_SPRITE_COUNT; i++) {
            const mat = new T.SpriteMaterial({
                map: this.dummyTex,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: T.NormalBlending,
                toneMapped: true,
            });
            const sprite = new T.Sprite(mat);
            sprite.renderOrder = 7;
            this.lightGroup.add(sprite);
            this.clouds.push({
                sprite,
                phase: i / CLOUD_SPRITE_COUNT,
                angle: (i / CLOUD_SPRITE_COUNT) * Math.PI * 2 + 0.4,
                radius: 0.75 + (i % 3) * 0.32,
                speed: 0.42 + (i % 2) * 0.14,
                baseScale: 1.05 + (i % 3) * 0.24,
            });
        }

        // 5. Transformation Shock Ring
        this.burstMat = new T.ShaderMaterial({
            uniforms: {
                uMap: { value: this.dummyTex },
                uHasMap: { value: 0 },
                uProgress: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uHasMap;
                uniform float uProgress;
                varying vec2 vUv;
                void main() {
                    float p = clamp(uProgress, 0.0, 1.0);
                    float fade = (1.0 - p) * smoothstep(0.0, 0.08, p);
                    if (uHasMap > 0.5) {
                        vec4 tex = texture2D(uMap, vUv);
                        vec3 col = tex.rgb * vec3(0.85, 0.96, 1.0) * 1.65;
                        gl_FragColor = vec4(col, clamp(tex.a * fade * 1.15, 0.0, 1.0));
                    } else {
                        float r = length(vUv * 2.0 - 1.0);
                        float ring = exp(-pow((r - mix(0.2, 0.92, p)) / 0.08, 2.0));
                        gl_FragColor = vec4(vec3(0.82, 0.95, 1.0), ring * fade);
                    }
                }
            `,
        });
        this.burstMat.customProgramCacheKey = () => 'void-flight-burst-v1';
        this.burstMesh = new T.Mesh(new T.PlaneGeometry(1, 1), this.burstMat);
        this.burstMesh.visible = false;
        this.burstMesh.renderOrder = 8;
        this.lightGroup.add(this.burstMesh);
        this.lightGroup.visible = false;
        this.group.add(this.lightGroup);

        // 6. Dynamic World-Space Curving Cloud-Mist + Ice-Cyan & Gold-Threaded Wake Trail
        const ribbonVerts = TRAIL_POINTS * 2 * 2;
        this.trailPositions = new Float32Array(ribbonVerts * 3);
        const trailUvs = new Float32Array(ribbonVerts * 2);
        const trailIndices: number[] = [];
        for (let plane = 0; plane < 2; plane++) {
            const base = plane * TRAIL_POINTS * 2;
            for (let i = 0; i < TRAIL_POINTS; i++) {
                const u = i / (TRAIL_POINTS - 1);
                const v0 = base + i * 2;
                const v1 = v0 + 1;
                trailUvs[v0 * 2] = u;
                trailUvs[v0 * 2 + 1] = 0;
                trailUvs[v1 * 2] = u;
                trailUvs[v1 * 2 + 1] = 1;
                if (i < TRAIL_POINTS - 1) {
                    trailIndices.push(v0, v0 + 2, v1, v1, v0 + 2, v1 + 2);
                }
            }
        }
        this.trailGeo = new T.BufferGeometry();
        this.trailGeo.setAttribute('position', new T.BufferAttribute(this.trailPositions, 3));
        this.trailGeo.setAttribute('uv', new T.BufferAttribute(trailUvs, 2));
        this.trailGeo.setIndex(trailIndices);
        this.trailMat = new T.ShaderMaterial({
            uniforms: {
                uMistMap: { value: this.dummyTex },
                uHasMist: { value: 0 },
                uTime: { value: 0 },
                uAlpha: { value: 0 },
            },
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            blending: T.NormalBlending,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMistMap;
                uniform float uHasMist;
                uniform float uTime;
                uniform float uAlpha;
                varying vec2 vUv;

                void main() {
                    float along = vUv.x; // 0 = head, 1 = far tail
                    float across = abs(vUv.y * 2.0 - 1.0);
                    float tailFade = pow(1.0 - along, 1.85) * smoothstep(0.0, 0.06, along);

                    float silk = 0.65;
                    float mist = 0.45;
                    if (uHasMist > 0.5) {
                        vec4 mA = texture2D(uMistMap, vec2(vUv.y * 1.2, along * 2.2 - uTime * 3.4));
                        vec4 mB = texture2D(uMistMap, vec2(vUv.y * 2.0 + 0.31, along * 3.6 - uTime * 5.0));
                        silk = clamp(mA.r * 0.65 + mB.r * 0.50, 0.0, 1.1);
                        mist = clamp(mA.g * 0.70 + mB.g * 0.42, 0.0, 1.0);
                    }

                    // Translucent glacier-cyan silk stream + delicate champagne-gold inner thread (never clips to solid white!)
                    float coreSpear = exp(-across * across * 16.0) * (0.48 + 0.52 * silk);
                    float goldCenter = sin(along * 9.0 - uTime * 7.5) * 0.16;
                    float goldThread = exp(-pow((vUv.y * 2.0 - 1.0 - goldCenter) / 0.10, 2.0)) * (0.40 + 0.60 * silk) * (1.0 - along * 0.5);
                    float cloudSkirt = exp(-across * across * 2.8) * mist * 0.36;

                    vec3 cyanCol = mix(vec3(0.46, 0.90, 0.96), vec3(0.16, 0.68, 0.88), smoothstep(0.0, 0.72, along));
                    vec3 mistCol = vec3(0.56, 0.86, 0.94);
                    vec3 goldCol = vec3(0.98, 0.84, 0.46);

                    float weightSum = max(0.001, coreSpear + cloudSkirt + goldThread * 0.65);
                    vec3 col = (cyanCol * coreSpear + mistCol * cloudSkirt + goldCol * goldThread * 0.75) / weightSum;
                    col = mix(col, vec3(0.92, 0.99, 1.0), coreSpear * (1.0 - along) * 0.32);
                    float alpha = (coreSpear * 0.42 + cloudSkirt * 0.34 + goldThread * 0.36) * tailFade * uAlpha;
                    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.44));
                }
            `,
        });
        this.trailMat.customProgramCacheKey = () => 'void-flight-trail-v1';
        this.trailMesh = new T.Mesh(this.trailGeo, this.trailMat);
        this.trailMesh.frustumCulled = false;
        this.trailMesh.visible = false;
        this.trailMesh.renderOrder = 5;
        this.group.add(this.trailMesh);
        for (let i = 0; i < TRAIL_POINTS; i++) this.trailHistory.push(new T.Vector3());

        // 7A. Sparkling Golden & White Starlight Dust inside the central jet
        const dustPos = new Float32Array(GOLD_SPARK_COUNT * 3);
        const dustSeed = new Float32Array(GOLD_SPARK_COUNT * 4);
        for (let i = 0; i < GOLD_SPARK_COUNT; i++) {
            const a = (i / GOLD_SPARK_COUNT) * Math.PI * 2 + (i % 7) * 0.53;
            const r = 0.12 + (((i * 67) % 100) / 100) * 0.82;
            dustSeed[i * 4] = Math.cos(a) * r;
            dustSeed[i * 4 + 1] = Math.sin(a) * r;
            dustSeed[i * 4 + 2] = ((i * 37) % 100) / 100;
            dustSeed[i * 4 + 3] = 0.72 + (((i * 19) % 100) / 100) * 0.95;
        }
        const dustGeo = new T.BufferGeometry();
        dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3));
        dustGeo.setAttribute('aSeed', new T.BufferAttribute(dustSeed, 4));
        this.goldDustMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                attribute vec4 aSeed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vFade;
                varying float vGold;
                void main() {
                    float t = fract(aSeed.z + uTime * 1.9 * aSeed.w);
                    float spread = 0.45 + 0.85 * sin(t * 3.14159);
                    vec3 p = vec3(aSeed.x * spread, aSeed.y * spread, 1.55 - t * 11.8);
                    vFade = smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.62, 1.0, t));
                    vGold = fract(aSeed.z * 7.13);
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    float twinkle = 0.72 + 0.48 * sin(uTime * 14.0 + aSeed.z * 40.0);
                    gl_PointSize = clamp((20.0 * twinkle * uPixelRatio) / max(1.0, -mv.z), 2.0, 16.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uAlpha;
                varying float vFade;
                varying float vGold;
                void main() {
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    float d = length(c);
                    if (d > 1.0) discard;
                    // Crisp 4-point star sparkle + soft round glow
                    float core = exp(-d * d * 7.5);
                    float crossStar = (exp(-abs(c.x) * 14.0) * exp(-abs(c.y) * 2.8) + exp(-abs(c.y) * 14.0) * exp(-abs(c.x) * 2.8)) * 0.65;
                    vec3 gold = vec3(1.0, 0.86, 0.44);
                    vec3 cyan = vec3(0.55, 0.94, 1.0);
                    vec3 col = mix(gold, cyan, step(0.65, vGold));
                    col = mix(col, vec3(0.98, 0.99, 0.96), clamp(core * 0.7, 0.0, 1.0));
                    gl_FragColor = vec4(col * 0.95, clamp((core + crossStar) * vFade * uAlpha * 0.56, 0.0, 0.72));
                }
            `,
        });
        this.goldDustMat.customProgramCacheKey = () => 'void-flight-dust-v1';
        this.goldDust = new T.Points(dustGeo, this.goldDustMat);
        this.goldDust.renderOrder = 8;
        this.lightGroup.add(this.goldDust);

        // 7B. Sharp Elongated Ice-Cyan Diamond Shards (◆) flanking the outer wake (signature motif from reference!)
        const shardPos = new Float32Array(DIAMOND_SHARD_COUNT * 3);
        const shardSeed = new Float32Array(DIAMOND_SHARD_COUNT * 4);
        for (let i = 0; i < DIAMOND_SHARD_COUNT; i++) {
            const a = (i / DIAMOND_SHARD_COUNT) * Math.PI * 2 + 0.25;
            const r = 1.05 + (((i * 53) % 100) / 100) * 1.15;
            shardSeed[i * 4] = Math.cos(a) * r;
            shardSeed[i * 4 + 1] = Math.sin(a) * r;
            shardSeed[i * 4 + 2] = ((i * 29) % 100) / 100;
            shardSeed[i * 4 + 3] = 0.65 + (((i * 41) % 100) / 100) * 0.75;
        }
        const shardGeo = new T.BufferGeometry();
        shardGeo.setAttribute('position', new T.BufferAttribute(shardPos, 3));
        shardGeo.setAttribute('aSeed', new T.BufferAttribute(shardSeed, 4));
        this.diamondShardMat = new T.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uAlpha: { value: 0 },
                uPixelRatio: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            vertexShader: /* glsl */ `
                attribute vec4 aSeed;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vFade;
                varying float vWarm;
                void main() {
                    float t = fract(aSeed.z + uTime * 1.35 * aSeed.w);
                    vec3 p = vec3(aSeed.x * (0.7 + t * 0.65), aSeed.y * (0.7 + t * 0.65), 0.8 - t * 12.6);
                    vFade = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.68, 1.0, t));
                    vWarm = step(0.72, fract(aSeed.z * 5.7));
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp((30.0 * (0.7 + 0.5 * aSeed.w) * uPixelRatio) / max(1.0, -mv.z), 5.0, 26.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uAlpha;
                varying float vFade;
                varying float vWarm;
                void main() {
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    // Sleek tilted diamond crystal SDF (◆)
                    vec2 rot = vec2(c.x * 0.86 - c.y * 0.50, c.x * 0.50 + c.y * 0.86);
                    float d = abs(rot.x) * 2.7 + abs(rot.y) * 1.15;
                    if (d > 1.15) discard;
                    float facet = smoothstep(1.05, 0.28, d);
                    float center = smoothstep(0.55, 0.0, d);
                    vec3 cyanShard = vec3(0.38, 0.90, 1.0);
                    vec3 goldShard = vec3(1.0, 0.86, 0.46);
                    vec3 baseCol = mix(cyanShard, goldShard, vWarm);
                    vec3 col = mix(baseCol, vec3(0.96, 0.99, 1.0), center * 0.55);
                    gl_FragColor = vec4(col * 0.95, clamp(facet * vFade * uAlpha * 0.54, 0.0, 0.68));
                }
            `,
        });
        this.diamondShardMat.customProgramCacheKey = () => 'void-flight-shard-v1';
        this.diamondShards = new T.Points(shardGeo, this.diamondShardMat);
        this.diamondShards.renderOrder = 8;
        this.lightGroup.add(this.diamondShards);

        scene.add(this.group);
    }

    /** Idempotent lazy loader so Nascent Soul escape-light & ripple textures only load when needed. */
    load(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = (async () => {
            const texLoader = new T.TextureLoader();
            const gltfLoader = new GLTFLoader();
            const [rippleTex, hoverPadTex, cloudMistTex, goldHaloTex, goldCloudTex, escapeGltf] = await Promise.all([
                texLoader.loadAsync(RIPPLE_TEX_URL),
                texLoader.loadAsync(HOVER_PAD_TEX_URL),
                texLoader.loadAsync(CLOUD_MIST_TEX_URL),
                texLoader.loadAsync(GOLD_HALO_TEX_URL),
                texLoader.loadAsync(GOLD_CLOUD_TEX_URL),
                gltfLoader.loadAsync(ESCAPE_MODEL_URL),
            ]);
            if (this.disposed) {
                rippleTex.dispose();
                hoverPadTex.dispose();
                cloudMistTex.dispose();
                goldHaloTex.dispose();
                goldCloudTex.dispose();
                return;
            }

            rippleTex.colorSpace = T.SRGBColorSpace;
            hoverPadTex.colorSpace = T.SRGBColorSpace;
            goldHaloTex.colorSpace = T.SRGBColorSpace;
            goldCloudTex.colorSpace = T.SRGBColorSpace;
            cloudMistTex.wrapS = cloudMistTex.wrapT = T.RepeatWrapping;

            this.cloudMistTex = cloudMistTex;
            this.loadedTextures.push(rippleTex, hoverPadTex, cloudMistTex, goldHaloTex, goldCloudTex);

            for (const m of this.rippleMeshes) {
                const mat = m.material as T.ShaderMaterial;
                mat.uniforms.uMap.value = rippleTex;
                mat.uniforms.uHasMap.value = 1;
            }
            this.hoverPadMat.uniforms.uMap.value = hoverPadTex;
            this.hoverPadMat.uniforms.uHasMap.value = 1;
            this.burstMat.uniforms.uMap.value = rippleTex;
            this.burstMat.uniforms.uHasMap.value = 1;
            this.haloMat.map = goldHaloTex;
            this.haloMat.needsUpdate = true;
            for (const c of this.clouds) {
                c.sprite.material.map = goldCloudTex;
                c.sprite.material.needsUpdate = true;
            }
            this.trailMat.uniforms.uMistMap.value = cloudMistTex;
            this.trailMat.uniforms.uHasMist.value = 1;

            this.installEscapeLightModel(escapeGltf.scene);
        })();
        return this.loadPromise;
    }

    private installEscapeLightModel(model: T.Group) {
        const mistTex = this.cloudMistTex ?? this.dummyTex;

        // 1. Leading Spirit Bubble shader (delicate translucent celadon-ice swirl + subtle golden Fresnel rim)
        const makeBubbleMat = () => {
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uMistMap: { value: mistTex },
                    uTime: { value: 0 },
                    uAlpha: { value: 0 },
                },
                transparent: true,
                depthWrite: false,
                side: T.FrontSide,
                blending: T.NormalBlending,
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
                    uniform sampler2D uMistMap;
                    uniform float uTime;
                    uniform float uAlpha;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;
                    void main() {
                        float ndotv = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
                        float fresnel = pow(1.0 - ndotv, 2.2);
                        float rimSharp = pow(1.0 - ndotv, 5.2);
                        vec4 swirl = texture2D(uMistMap, vec2(vUv.x * 2.0 + uTime * 0.45, vUv.y * 2.0 - uTime * 1.4));
                        vec3 iceBlue = vec3(0.24, 0.78, 0.94);
                        vec3 goldRim = vec3(0.98, 0.86, 0.48);
                        vec3 col = mix(iceBlue * (0.62 + 0.48 * swirl.r), goldRim, clamp(rimSharp * 1.2, 0.0, 1.0));
                        float alpha = (fresnel * 0.44 + rimSharp * 0.48 + swirl.r * 0.14 * (1.0 - ndotv * 0.5)) * uAlpha;
                        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.52));
                    }
                `,
            });
            mat.customProgramCacheKey = () => 'void-flight-bubble-v1';
            this.escapeUniformMaterials.push(mat);
            return mat;
        };

        // 2. Flowing Spear / Cloud-Mist / Silk Ribbon shader (refined translucent celadon-cyan & champagne-gold)
        const makeFlowMat = (mode: 'spear' | 'mist' | 'goldRibbon' | 'cyanRibbon') => {
            const modeId = mode === 'spear' ? 0 : mode === 'mist' ? 1 : mode === 'goldRibbon' ? 2 : 3;
            const isMist = mode === 'mist';
            const mat = new T.ShaderMaterial({
                uniforms: {
                    uMistMap: { value: mistTex },
                    uTime: { value: 0 },
                    uAlpha: { value: 0 },
                    uMode: { value: modeId },
                },
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                blending: isMist ? T.NormalBlending : T.AdditiveBlending,
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
                    uniform sampler2D uMistMap;
                    uniform float uTime;
                    uniform float uAlpha;
                    uniform float uMode;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;

                    void main() {
                        float ndotv = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
                        float along = vUv.y; // 0 = front, 1 = tail

                        if (uMode < 0.5) {
                            // Mode 0: Sleek Glacial-Cyan Inner Spear Core with subtle golden thread
                            vec4 s1 = texture2D(uMistMap, vec2(vUv.x * 2.2, along * 2.4 - uTime * 4.8));
                            vec4 s2 = texture2D(uMistMap, vec2(vUv.x * 4.0 + 0.27, along * 4.2 - uTime * 6.8));
                            float silk = clamp(s1.r * 0.65 + s2.r * 0.55, 0.0, 1.1);
                            float env = smoothstep(0.0, 0.08, along) * pow(1.0 - along, 1.15);
                            float core = pow(ndotv, 1.25) * 0.72 + pow(1.0 - ndotv, 2.0) * 0.36;
                            vec3 col = mix(vec3(0.20, 0.76, 0.94), vec3(0.86, 0.97, 1.0), clamp(silk * 0.45 + (1.0 - along) * 0.35, 0.0, 1.0));
                            float goldHit = smoothstep(0.72, 0.96, s2.b) * (1.0 - along * 0.4);
                            col = mix(col, vec3(0.98, 0.86, 0.48), goldHit * 0.50);
                            float alpha = core * (0.28 + 0.46 * silk) * env * uAlpha;
                            gl_FragColor = vec4(col * 0.92, clamp(alpha, 0.0, 0.46));
                        } else if (uMode < 1.5) {
                            // Mode 1: Ethereal Pale-Cyan Ink-Cloud Mist Veil (NormalBlending keeps color depth in daylight)
                            vec4 m1 = texture2D(uMistMap, vec2(vUv.x * 1.6, along * 1.8 - uTime * 2.6));
                            vec4 m2 = texture2D(uMistMap, vec2(vUv.x * 2.6 + 0.4, along * 2.8 - uTime * 3.8));
                            float cloud = clamp(m1.g * 0.70 + m2.g * 0.48, 0.0, 1.0);
                            float fresnel = pow(1.0 - ndotv, 1.45) * 0.75 + 0.18;
                            float env = smoothstep(0.0, 0.14, along) * pow(1.0 - along, 1.25);
                            vec3 col = mix(vec3(0.36, 0.78, 0.92), vec3(0.80, 0.94, 0.98), cloud * 0.55);
                            float alpha = fresnel * cloud * env * 0.28 * uAlpha;
                            gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.30));
                        } else if (uMode < 2.5) {
                            // Mode 2: Delicate Champagne-Gold Silk Ribbon (鎏金仙绫)
                            float across = abs(vUv.x * 2.0 - 1.0);
                            vec4 f = texture2D(uMistMap, vec2(vUv.x * 1.2, along * 2.6 - uTime * 3.8));
                            float edgeGlow = exp(-pow((across - 0.78) / 0.16, 2.0)) * 0.78;
                            float bodySilk = exp(-across * across * 2.8) * (0.22 + 0.48 * f.r);
                            float env = smoothstep(0.0, 0.08, along) * pow(1.0 - along, 0.95);
                            vec3 col = mix(vec3(0.94, 0.74, 0.32), vec3(1.0, 0.93, 0.70), clamp(edgeGlow + f.r * 0.38, 0.0, 1.0));
                            float alpha = (edgeGlow + bodySilk) * env * 0.46 * uAlpha;
                            gl_FragColor = vec4(col * 0.94, clamp(alpha, 0.0, 0.50));
                        } else {
                            // Mode 3: Translucent Glacial-Cyan Cloud Silk Ribbon (冰青流云缎带)
                            float across = abs(vUv.x * 2.0 - 1.0);
                            vec4 f = texture2D(uMistMap, vec2(vUv.x * 1.5, along * 2.8 - uTime * 4.4));
                            float edgeGlow = exp(-pow((across - 0.72) / 0.22, 2.0)) * 0.62;
                            float bodySilk = exp(-across * across * 2.2) * (0.20 + 0.52 * max(f.r, f.g * 0.85));
                            float env = smoothstep(0.0, 0.08, along) * pow(1.0 - along, 0.98);
                            vec3 col = mix(vec3(0.24, 0.76, 0.94), vec3(0.80, 0.95, 1.0), clamp(edgeGlow * 0.6 + f.r * 0.4, 0.0, 1.0));
                            float alpha = (edgeGlow + bodySilk) * env * 0.42 * uAlpha;
                            gl_FragColor = vec4(col * 0.92, clamp(alpha, 0.0, 0.46));
                        }
                    }
                `,
            });
            mat.customProgramCacheKey = () => isMist ? 'void-flight-flow-mist-v1' : 'void-flight-flow-add-v1';
            this.escapeUniformMaterials.push(mat);
            return mat;
        };

        model.traverse(obj => {
            if (!(obj instanceof T.Mesh)) return;
            const old = obj.material;
            if (Array.isArray(old)) old.forEach(m => m.dispose());
            else old?.dispose();

            if (obj.name.startsWith('EL_Bubble') || obj.name === 'Sphere') {
                obj.material = makeBubbleMat();
                obj.renderOrder = 6;
            } else if (obj.name.startsWith('EL_SpearCore')) {
                obj.material = makeFlowMat('spear');
                obj.renderOrder = 7;
            } else if (obj.name.startsWith('EL_MistVeil')) {
                obj.material = makeFlowMat('mist');
                obj.renderOrder = 5;
            } else if (obj.name.startsWith('EL_GoldRibbon')) {
                obj.material = makeFlowMat('goldRibbon');
                obj.renderOrder = 7;
            } else {
                obj.material = makeFlowMat('cyanRibbon');
                obj.renderOrder = 6;
            }
        });

        model.scale.setScalar(0.90);
        this.escapeModel = model;
        this.lightGroup.add(model);
    }

    spawnRipple(x: number, y: number, z: number, maxRadius = 2.6, duration = 1.08, strength = 0.92) {
        let slot = this.ripples.find(r => !r.active);
        if (!slot) {
            slot = this.ripples.reduce((oldest, cur) => (cur.age > oldest.age ? cur : oldest), this.ripples[0]);
        }
        if (!slot.active) this.activeRipples++;
        slot.active = true;
        slot.age = 0;
        slot.duration = duration;
        slot.maxRadius = maxRadius;
        slot.strength = strength;
        slot.spin = Math.random() * Math.PI * 2;
        slot.x = x;
        slot.y = y;
        slot.z = z;
    }

    update(
        dt: number,
        position: T.Vector3,
        velocity: T.Vector3,
        heading: number,
        voidFlying: boolean,
        skyWalking: boolean,
        escapeLight: boolean,
        pixelRatio: number,
    ) {
        // Zero-cost early-out when cultivator is not using Nascent flight and all trails/ripples have settled
        if (
            !voidFlying &&
            !escapeLight &&
            !this.wasEscapeLight &&
            this.lightBlend < 0.002 &&
            this.activeRipples === 0 &&
            (this.hoverPadMat.uniforms.uAlpha.value as number) < 0.005 &&
            this.burstAge > 1.2 &&
            this.trailCount === 0
        ) {
            if (this.group.visible) {
                this.lightGroup.visible = false;
                this.hoverPad.visible = false;
                this.burstMesh.visible = false;
                this.trailMesh.visible = false;
                this.group.visible = false;
            }
            return;
        }
        this.group.visible = true;

        this.time += dt;
        const speed = velocity.length();
        const horizSpeed = Math.hypot(velocity.x, velocity.z);

        // Escape-light morph burst on enter/exit
        if (escapeLight !== this.wasEscapeLight) {
            this.wasEscapeLight = escapeLight;
            this.burstAge = 0;
            if (!escapeLight && voidFlying) {
                this.spawnRipple(position.x, position.y + 0.05, position.z, 3.4, 1.05, 1.0);
            }
        }
        const targetBlend = voidFlying && escapeLight ? 1 : 0;
        this.lightBlend = T.MathUtils.damp(this.lightBlend, targetBlend, targetBlend > 0.5 ? 14 : 11, dt);

        // Hover & Skywalk spatial ripples
        const hovering = voidFlying && !escapeLight && (!skyWalking ? speed < 2.2 : horizSpeed < 0.35);
        const targetPadAlpha = hovering ? 0.92 : skyWalking ? 0.48 : 0;
        this.hoverPadMat.uniforms.uTime.value = this.time;
        this.hoverPadMat.uniforms.uAlpha.value = T.MathUtils.damp(this.hoverPadMat.uniforms.uAlpha.value, targetPadAlpha, 8, dt);
        this.hoverPad.visible = this.hoverPadMat.uniforms.uAlpha.value > 0.015;
        if (this.hoverPad.visible) {
            this.hoverPad.position.set(position.x, position.y + 0.04, position.z);
        }

        if (hovering) {
            this.hoverTimer -= dt;
            if (this.hoverTimer <= 0) {
                this.hoverTimer = 0.78;
                this.spawnRipple(position.x, position.y + 0.05, position.z, 3.0, 1.35, 0.74);
            }
        } else {
            this.hoverTimer = Math.min(this.hoverTimer, 0.15);
        }

        if (voidFlying && skyWalking && horizSpeed > 0.4) {
            const stride = horizSpeed > 9 ? 2.15 : 1.5;
            this.stepDist += horizSpeed * dt;
            if (this.stepDist >= stride) {
                this.stepDist -= stride;
                this.stepSide = -this.stepSide;
                const lateral = 0.16 * this.stepSide;
                const rx = position.x + Math.cos(heading) * lateral;
                const rz = position.z + Math.sin(heading) * lateral;
                const sprinting = horizSpeed > 9;
                this.spawnRipple(rx, position.y + 0.04, rz, sprinting ? 2.9 : 2.2, sprinting ? 0.92 : 1.08, sprinting ? 0.98 : 0.84);
            }
        } else {
            this.stepDist = 0;
        }

        for (let i = 0; i < MAX_RIPPLES; i++) {
            const r = this.ripples[i];
            const mesh = this.rippleMeshes[i];
            if (!r.active) {
                mesh.visible = false;
                continue;
            }
            r.age += dt;
            if (r.age >= r.duration) {
                r.active = false;
                this.activeRipples = Math.max(0, this.activeRipples - 1);
                mesh.visible = false;
                continue;
            }
            const p = r.age / r.duration;
            const expand = 0.36 + 0.78 * Math.pow(p, 0.65);
            mesh.visible = true;
            mesh.position.set(r.x, r.y, r.z);
            mesh.rotation.y = r.spin + p * 0.45;
            mesh.scale.setScalar(r.maxRadius * expand);
            const mat = mesh.material as T.ShaderMaterial;
            mat.uniforms.uProgress.value = p;
            mat.uniforms.uStrength.value = r.strength;
            mat.uniforms.uTime.value = this.time;
        }

        // Escape Light assembly orientation & 7-layer animation
        this.lightPos.set(position.x, position.y + 1.15, position.z);
        if (speed > 0.5) {
            this.forward.copy(velocity).normalize();
        } else {
            this.forward.set(Math.sin(heading), 0, -Math.cos(heading));
        }

        if (this.lightBlend > 0.015) {
            this.lightGroup.visible = true;
            this.lightGroup.position.copy(this.lightPos);
            this.quat.setFromUnitVectors(this.baseZ, this.forward);
            this.lightGroup.quaternion.copy(this.quat);

            // Golden halo ring billboard at front (gentle translucency, no daytime blowout)
            this.haloSprite.visible = true;
            this.haloMat.opacity = this.lightBlend * 0.42;
            this.haloMat.rotation = this.time * 0.35;
            const haloS = (1.95 + 0.10 * Math.sin(this.time * 5.0)) * (0.78 + 0.22 * this.lightBlend);
            this.haloSprite.scale.setScalar(haloS);

            // Soft warm-white starburst flare inside front of sphere
            this.coreFlareMesh.visible = true;
            this.coreFlareMat.uniforms.uTime.value = this.time;
            this.coreFlareMat.uniforms.uAlpha.value = this.lightBlend;

            // Blender 3D bubble + spear + mist veil + gold & cyan silk ribbons
            if (this.escapeModel) {
                this.escapeModel.visible = true;
                this.escapeModel.rotation.z = this.time * 0.65 + Math.sin(this.time * 2.1) * 0.22;
                const s = 0.78 + 0.10 * this.lightBlend;
                this.escapeModel.scale.set(s, s, s * (0.92 + 0.18 * this.lightBlend));
            }
            for (const mat of this.escapeUniformMaterials) {
                mat.uniforms.uTime.value = this.time;
                mat.uniforms.uAlpha.value = this.lightBlend;
            }

            // Delicate drifting golden auspicious cloud wisps riding along the silk wake
            for (const c of this.clouds) {
                const t = (c.phase + this.time * c.speed) % 1;
                const a = c.angle + t * 1.45;
                const rad = c.radius * (0.72 + 0.48 * Math.sin(t * Math.PI));
                const z = 1.4 - t * 6.8;
                c.sprite.visible = true;
                c.sprite.position.set(Math.cos(a) * rad, Math.sin(a) * rad, z);
                const env = Math.sin(Math.min(1, t * 4.5) * Math.PI * 0.5) * (1 - Math.pow(t, 1.4));
                c.sprite.material.opacity = env * 0.28 * this.lightBlend;
                c.sprite.material.rotation = Math.sin(this.time * 1.5 + c.angle) * 0.18;
                const sc = c.baseScale * (0.68 + 0.25 * (1 - t));
                c.sprite.scale.set(sc * 1.55, sc * 0.76, 1);
            }

            // Sparkling golden dust & crisp cyan diamond shards
            this.goldDust.visible = true;
            this.goldDustMat.uniforms.uTime.value = this.time;
            this.goldDustMat.uniforms.uAlpha.value = this.lightBlend;
            this.goldDustMat.uniforms.uPixelRatio.value = pixelRatio;

            this.diamondShards.visible = true;
            this.diamondShardMat.uniforms.uTime.value = this.time;
            this.diamondShardMat.uniforms.uAlpha.value = this.lightBlend;
            this.diamondShardMat.uniforms.uPixelRatio.value = pixelRatio;

            // Dynamic world-space curving cloud-mist & cyan-gold ribbon wake
            if (this.trailCount === 0) {
                for (let i = 0; i < TRAIL_POINTS; i++) this.trailHistory[i].copy(this.lightPos);
                this.trailCount = TRAIL_POINTS;
            } else {
                for (let i = TRAIL_POINTS - 1; i > 0; i--) {
                    this.trailHistory[i].copy(this.trailHistory[i - 1]);
                }
                this.trailHistory[0].copy(this.lightPos);
            }

            for (let i = 0; i < TRAIL_POINTS; i++) {
                const cur = this.trailHistory[i];
                const prev = this.trailHistory[Math.max(0, i - 1)];
                const next = this.trailHistory[Math.min(TRAIL_POINTS - 1, i + 1)];
                this.tangent.subVectors(prev, next);
                if (this.tangent.lengthSq() < 1e-6) this.tangent.copy(this.forward);
                else this.tangent.normalize();

                this.right.crossVectors(this.tangent, this.up);
                if (this.right.lengthSq() < 1e-4) this.right.set(1, 0, 0);
                else this.right.normalize();
                this.sideA.copy(this.right);
                this.sideB.crossVectors(this.right, this.tangent).normalize();

                const frac = i / (TRAIL_POINTS - 1);
                const width = (0.56 * (1 - frac * 0.78) + 0.08) * this.lightBlend;

                for (let plane = 0; plane < 2; plane++) {
                    const axis = plane === 0 ? this.sideA : this.sideB;
                    const base = (plane * TRAIL_POINTS * 2 + i * 2) * 3;
                    this.trailPositions[base] = cur.x - axis.x * width;
                    this.trailPositions[base + 1] = cur.y - axis.y * width;
                    this.trailPositions[base + 2] = cur.z - axis.z * width;
                    this.trailPositions[base + 3] = cur.x + axis.x * width;
                    this.trailPositions[base + 4] = cur.y + axis.y * width;
                    this.trailPositions[base + 5] = cur.z + axis.z * width;
                }
            }
            (this.trailGeo.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
            this.trailMat.uniforms.uTime.value = this.time;
            this.trailMat.uniforms.uAlpha.value = this.lightBlend;
            this.trailMesh.visible = true;
        } else {
            this.lightGroup.visible = false;
            this.trailMesh.visible = false;
            this.trailCount = 0;
        }

        // Morph burst ring
        if (this.burstAge < 0.36) {
            this.burstAge += dt;
            const p = Math.min(1, this.burstAge / 0.36);
            this.burstMesh.visible = true;
            this.burstMesh.scale.setScalar(1.5 + p * 4.6);
            this.burstMat.uniforms.uProgress.value = p;
            if (!this.lightGroup.visible) {
                this.lightGroup.visible = true;
                this.lightGroup.position.copy(this.lightPos);
                this.haloSprite.visible = false;
                this.coreFlareMesh.visible = false;
                if (this.escapeModel) this.escapeModel.visible = false;
                for (const c of this.clouds) c.sprite.visible = false;
                this.goldDust.visible = false;
                this.diamondShards.visible = false;
            }
        } else {
            this.burstMesh.visible = false;
        }
    }

    collectLights(pool: SpellLightPool) {
        if (this.lightBlend > 0.08) {
            pool.emit({
                x: this.lightPos.x,
                y: this.lightPos.y,
                z: this.lightPos.z,
                color: 0x72dcf2,
                intensity: 9.5 * this.lightBlend,
                distance: 24,
                priority: 3,
                // The fast-moving trail only needs fill light. Avoid six shadow passes per frame.
                castShadow: false,
            });
        }
    }

    clear() {
        for (let i = 0; i < MAX_RIPPLES; i++) {
            this.ripples[i].active = false;
            this.rippleMeshes[i].visible = false;
        }
        this.activeRipples = 0;
        this.hoverPad.visible = false;
        this.hoverPadMat.uniforms.uAlpha.value = 0;
        this.lightBlend = 0;
        this.wasEscapeLight = false;
        this.burstAge = 99;
        this.trailCount = 0;
        this.lightGroup.visible = false;
        this.trailMesh.visible = false;
        this.group.visible = false;
    }

    dispose() {
        this.disposed = true;
        this.rippleGeo.dispose();
        for (const m of this.rippleMeshes) (m.material as T.Material).dispose();
        this.hoverPadMat.dispose();
        this.haloMat.dispose();
        this.coreFlareMesh.geometry.dispose();
        this.coreFlareMat.dispose();
        this.burstMesh.geometry.dispose();
        this.burstMat.dispose();
        for (const c of this.clouds) c.sprite.material.dispose();
        if (this.escapeModel) {
            this.escapeModel.traverse(obj => {
                if (obj instanceof T.Mesh) obj.geometry.dispose();
            });
        }
        for (const mat of this.escapeUniformMaterials) mat.dispose();
        for (const tex of this.loadedTextures) tex.dispose();
        this.dummyTex.dispose();
        this.trailGeo.dispose();
        this.trailMat.dispose();
        this.goldDust.geometry.dispose();
        this.goldDustMat.dispose();
        this.diamondShards.geometry.dispose();
        this.diamondShardMat.dispose();
        this.group.removeFromParent();
    }
}
