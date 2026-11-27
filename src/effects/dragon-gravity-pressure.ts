import * as T from 'three';
import type { SpellLightPool } from './spell-lights';

const GRAV_LINE_COUNT = 84;
const SHARD_COUNT = 22;
const DESCEND_RING_COUNT = 5;
const SLAM_RING_COUNT = 4;

export type GravityPressureTheme = 'dragon' | 'nascent';

export interface GravityPressureOptions {
    theme?: GravityPressureTheme;
    scale?: number;
}

interface ThemePalette {
    shadowCol: T.Color;
    craterPrimary: T.Color;
    craterCore: T.Color;
    ringDescend: T.Color;
    ringSlam: T.Color;
    lineHex: number;
    shardHex: number;
    lightHex: number;
}

const PALETTES: Record<GravityPressureTheme, ThemePalette> = {
    dragon: {
        shadowCol: new T.Color(0.08, 0.02, 0.20),
        craterPrimary: new T.Color(0.62, 0.26, 1.0),
        craterCore: new T.Color(0.95, 0.88, 1.0),
        ringDescend: new T.Color(0.64, 0.34, 1.0),
        ringSlam: new T.Color(0.90, 0.82, 1.0),
        lineHex: 0xd9c6ff,
        shardHex: 0x3b3348,
        lightHex: 0x9b5cff,
    },
    nascent: {
        shadowCol: new T.Color(0.02, 0.14, 0.24),
        craterPrimary: new T.Color(0.24, 0.84, 1.0),
        craterCore: new T.Color(1.0, 0.94, 0.74),
        ringDescend: new T.Color(0.32, 0.90, 1.0),
        ringSlam: new T.Color(1.0, 0.90, 0.62),
        lineHex: 0xaef4ff,
        shardHex: 0x3a4d5c,
        lightHex: 0x5ce0ff,
    },
};

function smooth01(a: number, b: number, x: number): number {
    if (b <= a) return x >= b ? 1 : 0;
    const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Ground depression shadow disc (gives tangible crushing weight in bright daylight).
 */
function createGroundShadowMaterial(shadowCol: T.Color): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        uniforms: {
            uOpacity: { value: 0 },
            uCol: { value: shadowCol.clone() },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uOpacity;
            uniform vec3 uCol;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float falloff = smoothstep(1.0, 0.15, r);
                float alpha = falloff * falloff * 0.48 * uOpacity;
                if (alpha < 0.006) discard;
                gl_FragColor = vec4(uCol, alpha);
            }
        `,
    });
    mat.customProgramCacheKey = () => 'grav-pressure-shadow-v1';
    return mat;
}

/**
 * Radial + concentric spiderweb ground fracture decal.
 */
function createSpiderwebCraterMaterial(primaryCol: T.Color, coreCol: T.Color): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
            uReveal: { value: 1 },
            uPrimaryCol: { value: primaryCol.clone() },
            uCoreCol: { value: coreCol.clone() },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uOpacity;
            uniform float uReveal;
            uniform vec3 uPrimaryCol;
            uniform vec3 uCoreCol;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float reveal = smoothstep(uReveal + 0.06, uReveal - 0.14, r);
                // Crisp jagged radial & concentric spiderweb fractures
                float jag = 0.045 * sin(r * 26.0 + a * 3.0);
                float spokes = pow(max(0.0, cos((a + jag) * 9.0)), 26.0) * (1.0 - smoothstep(0.65, 0.98, r));
                float ring1 = exp(-pow((r - 0.28 + 0.024 * sin(a * 7.0)) / 0.014, 2.0));
                float ring2 = exp(-pow((r - 0.56 + 0.026 * cos(a * 9.0)) / 0.013, 2.0));
                float ring3 = exp(-pow((r - 0.82 + 0.020 * sin(a * 11.0)) / 0.012, 2.0));
                float core = exp(-r * r * 16.0) * 0.55;
                float pulse = 0.90 + 0.10 * sin(uTime * 10.0);
                float intensity = (spokes * 0.95 + ring1 * 0.80 + ring2 * 0.70 + ring3 * 0.54 + core) * reveal * pulse;
                float fade = 1.0 - smoothstep(0.88, 1.0, r);
                vec3 col = mix(uPrimaryCol, uCoreCol, clamp(intensity * 0.65, 0.0, 1.0));
                gl_FragColor = vec4(col * 1.25, clamp(intensity * fade * uOpacity, 0.0, 0.90));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'grav-pressure-spiderweb-v3';
    return mat;
}

/**
 * Razor-thin horizontal air-compression shockwave ring.
 */
function createCompressionRingMaterial(ringCol: T.Color): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        uniforms: {
            uOpacity: { value: 0 },
            uCol: { value: ringCol.clone() },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uOpacity;
            uniform vec3 uCol;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float ring = exp(-pow((r - 0.88) / 0.042, 2.0));
                float innerHalo = exp(-pow((r - 0.82) / 0.095, 2.0)) * 0.25;
                float alpha = (ring + innerHalo) * (1.0 - smoothstep(0.95, 1.0, r)) * uOpacity;
                if (alpha < 0.006) discard;
                gl_FragColor = vec4(uCol * 1.35, clamp(alpha, 0.0, 0.88));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'grav-pressure-ring-v3';
    return mat;
}

/**
 * Anime Gravity-Field Pressure VFX (重力场威压):
 * Clean, dome-free vertical downward gravity streaks, descending air-compression rings,
 * ground depression shadow + spiderweb fractures, radial air-blast shockwaves, and small angular rock splinters.
 */
export class DragonGravityPressureFX {
    private readonly group = new T.Group();
    private readonly shadowMesh: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly craterMesh: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly descendRings: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>[] = [];
    private readonly slamRings: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>[] = [];
    private readonly gravLines: T.InstancedMesh<T.CylinderGeometry, T.MeshBasicMaterial>;
    private readonly lineSeeds: { x: number; z: number; len: number; speed: number; phase: number; r: number }[] = [];
    private readonly rockShards: T.InstancedMesh<T.DodecahedronGeometry, T.MeshStandardMaterial>;
    private readonly shardSeeds: { x: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number; phase: number }[] = [];

    private readonly dummy = new T.Object3D();
    private readonly fxScale: number;
    private readonly lightHex: number;
    private active = false;
    private age = 0;
    private duration = 3.2;

    constructor(scene: T.Scene, options: GravityPressureOptions = {}) {
        const theme = options.theme ?? 'dragon';
        const palette = PALETTES[theme];
        this.fxScale = options.scale ?? 1.0;
        this.lightHex = palette.lightHex;
        this.group.name = theme === 'nascent' ? '元婴威压 · 重力场域' : '蚀渊古龙 · 重力场威压';
        this.group.scale.setScalar(this.fxScale);
        this.group.visible = false;

        // 1) Ground Depression Shadow + Spiderweb Fracture Decal (compact ~13m base diameter)
        this.shadowMesh = new T.Mesh(new T.PlaneGeometry(14.5, 14.5), createGroundShadowMaterial(palette.shadowCol));
        this.shadowMesh.rotation.x = -Math.PI / 2;
        this.shadowMesh.position.y = 0.08;

        this.craterMesh = new T.Mesh(new T.PlaneGeometry(13.0, 13.0), createSpiderwebCraterMaterial(palette.craterPrimary, palette.craterCore));
        this.craterMesh.rotation.x = -Math.PI / 2;
        this.craterMesh.position.y = 0.13;

        // 2) Descending Horizontal Air-Compression Rings + Ground-Slam Radial Shockwaves
        const ringGeo = new T.PlaneGeometry(2, 2);
        for (let i = 0; i < DESCEND_RING_COUNT; i++) {
            const m = new T.Mesh(ringGeo, createCompressionRingMaterial(palette.ringDescend));
            m.rotation.x = -Math.PI / 2;
            this.descendRings.push(m);
            this.group.add(m);
        }
        for (let i = 0; i < SLAM_RING_COUNT; i++) {
            const m = new T.Mesh(ringGeo, createCompressionRingMaterial(palette.ringSlam));
            m.rotation.x = -Math.PI / 2;
            m.position.y = 0.20;
            this.slamRings.push(m);
            this.group.add(m);
        }

        // 3) 84 Tapered Vertical Downward-Plunging Anime Gravity Streaks (needle-sharp, no solid bubble!)
        const lineGeo = new T.CylinderGeometry(0.008, 0.028, 1.0, 4);
        this.gravLines = new T.InstancedMesh(
            lineGeo,
            new T.MeshBasicMaterial({
                color: palette.lineHex,
                transparent: true,
                opacity: 0,
                blending: T.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
            }),
            GRAV_LINE_COUNT,
        );
        this.gravLines.frustumCulled = false;
        for (let i = 0; i < GRAV_LINE_COUNT; i++) {
            const a = (i / GRAV_LINE_COUNT) * Math.PI * 2 + (i % 7) * 0.27;
            const r = 0.65 + Math.sqrt(((i * 37) % 100) / 100) * 5.8;
            this.lineSeeds.push({
                x: Math.cos(a) * r,
                z: Math.sin(a) * r,
                len: 2.2 + ((i * 19) % 11) * 0.36,
                speed: 1.75 + ((i * 13) % 9) * 0.20,
                phase: ((i * 41) % 100) / 100,
                r: 0.65 + ((i * 7) % 5) * 0.18,
            });
        }

        // 4) 22 Small Angular Crushed Rock Splinters hugging the crater rim
        const shardGeo = new T.DodecahedronGeometry(0.32, 0);
        this.rockShards = new T.InstancedMesh(
            shardGeo,
            new T.MeshStandardMaterial({
                color: palette.shardHex,
                roughness: 0.90,
                metalness: 0.06,
                flatShading: true,
            }),
            SHARD_COUNT,
        );
        this.rockShards.frustumCulled = false;
        this.rockShards.castShadow = false;
        this.rockShards.receiveShadow = false;
        for (let i = 0; i < SHARD_COUNT; i++) {
            const a = (i / SHARD_COUNT) * Math.PI * 2 + ((i * 17) % 10) * 0.04;
            const r = 3.8 + ((i * 23) % 10) * 0.22;
            this.shardSeeds.push({
                x: Math.cos(a) * r,
                z: Math.sin(a) * r,
                sx: 0.65 + ((i * 13) % 6) * 0.16,
                sy: 0.32 + ((i * 5) % 4) * 0.09,
                sz: 0.55 + ((i * 19) % 5) * 0.15,
                rx: ((i * 7) % 10) * 0.25,
                ry: a,
                rz: ((i * 11) % 10) * 0.22,
                phase: ((i * 29) % 100) / 100,
            });
        }

        this.group.add(this.shadowMesh, this.craterMesh, this.gravLines, this.rockShards);
        scene.add(this.group);
    }

    get isActive(): boolean {
        return this.active;
    }

    get warmObjects(): readonly T.Object3D[] {
        return [this.group];
    }

    trigger(groundPos: T.Vector3, duration = 3.2) {
        this.active = true;
        this.age = 0;
        this.duration = duration;
        this.group.position.copy(groundPos);
        this.group.visible = true;
    }

    update(dt: number) {
        if (!this.active) return;
        this.age += dt;
        if (this.age >= this.duration) {
            this.clear();
            return;
        }
        const t = this.age;
        const fadeIn = smooth01(0, 0.20, t);
        const fadeOut = 1 - smooth01(this.duration - 0.50, this.duration, t);
        const alpha = fadeIn * fadeOut;

        // 1) Ground Depression Shadow + Spiderweb Fractures
        this.shadowMesh.material.uniforms.uOpacity.value = alpha;
        this.craterMesh.material.uniforms.uTime.value = t;
        this.craterMesh.material.uniforms.uOpacity.value = alpha * 0.94;
        this.craterMesh.material.uniforms.uReveal.value = smooth01(0.06, 0.50, t);

        // 2) Descending Horizontal Air-Compression Rings (accelerate downward & slam!)
        for (let i = 0; i < DESCEND_RING_COUNT; i++) {
            const cyc = (t * 1.45 + i / DESCEND_RING_COUNT) % 1;
            const eased = cyc * cyc; // gravity acceleration downward
            const m = this.descendRings[i];
            m.position.y = T.MathUtils.lerp(10.5, 0.18, eased);
            m.scale.setScalar(T.MathUtils.lerp(3.6, 6.8, eased));
            m.material.uniforms.uOpacity.value = smooth01(0, 0.14, cyc) * (1 - smooth01(0.80, 1.0, cyc)) * alpha * 0.82;
        }
        for (let i = 0; i < SLAM_RING_COUNT; i++) {
            const cyc = (t * 1.25 + i / SLAM_RING_COUNT) % 1;
            const m = this.slamRings[i];
            m.scale.setScalar(1.4 + 8.6 * (1 - Math.pow(1 - cyc, 2.2)));
            m.material.uniforms.uOpacity.value = Math.pow(1 - cyc, 1.65) * alpha * 0.88;
        }

        // 3) Tapered Vertical Downward-Plunging Anime Gravity Streaks
        (this.gravLines.material as T.MeshBasicMaterial).opacity = alpha * 0.72;
        const dummy = this.dummy;
        for (let i = 0; i < GRAV_LINE_COUNT; i++) {
            const s = this.lineSeeds[i];
            const cyc = (s.phase + t * s.speed) % 1;
            const y = T.MathUtils.lerp(11.5, -0.3, cyc);
            dummy.position.set(s.x, y, s.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(s.r, s.len, s.r);
            dummy.updateMatrix();
            this.gravLines.setMatrixAt(i, dummy.matrix);
        }
        this.gravLines.count = GRAV_LINE_COUNT;
        this.gravLines.instanceMatrix.needsUpdate = true;

        // 4) Small Angular Rock Splinters trembling under crushing gravity
        const shardPop = smooth01(0.10, 0.40, t) * (1 - smooth01(this.duration - 0.40, this.duration, t));
        for (let i = 0; i < SHARD_COUNT; i++) {
            const s = this.shardSeeds[i];
            const tremor = Math.sin(t * 28 + s.phase * 12) * 0.03;
            dummy.position.set(s.x, 0.08 * shardPop + Math.max(0, tremor), s.z);
            dummy.rotation.set(s.rx, s.ry, s.rz);
            dummy.scale.set(s.sx * shardPop, s.sy * shardPop, s.sz * shardPop);
            dummy.updateMatrix();
            this.rockShards.setMatrixAt(i, dummy.matrix);
        }
        this.rockShards.count = SHARD_COUNT;
        this.rockShards.instanceMatrix.needsUpdate = true;
    }

    collectLights(pool: SpellLightPool) {
        if (!this.active) return;
        const alpha = smooth01(0, 0.20, this.age) * (1 - smooth01(this.duration - 0.45, this.duration, this.age));
        pool.emit({
            x: this.group.position.x,
            y: this.group.position.y + 4.0 * this.fxScale,
            z: this.group.position.z,
            color: this.lightHex,
            intensity: 44 * this.fxScale * alpha,
            distance: 18 * this.fxScale,
            priority: 108,
            castShadow: false,
        });
    }

    clear() {
        this.active = false;
        this.age = 0;
        this.group.visible = false;
        this.gravLines.count = 0;
        this.rockShards.count = 0;
    }

    dispose() {
        this.clear();
        this.group.removeFromParent();
        this.shadowMesh.geometry.dispose();
        this.shadowMesh.material.dispose();
        this.craterMesh.geometry.dispose();
        this.craterMesh.material.dispose();
        if (this.descendRings.length) this.descendRings[0].geometry.dispose();
        for (const r of this.descendRings) r.material.dispose();
        for (const r of this.slamRings) r.material.dispose();
        this.gravLines.geometry.dispose();
        (this.gravLines.material as T.Material).dispose();
        this.gravLines.dispose();
        this.rockShards.geometry.dispose();
        (this.rockShards.material as T.Material).dispose();
        this.rockShards.dispose();
    }
}
