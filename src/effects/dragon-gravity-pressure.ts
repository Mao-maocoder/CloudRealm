import * as T from 'three';
import type { SpellLightPool } from './spell-lights';

const GRAV_LINE_COUNT = 72;
const SLAB_COUNT = 28;
const DESCEND_RING_COUNT = 4;
const SLAM_RING_COUNT = 4;

function smooth01(a: number, b: number, x: number): number {
    if (b <= a) return x >= b ? 1 : 0;
    const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Translucent violet-silver atmospheric compression dome shader (Fujitora / Aizen gravity crush!).
 */
function createGravityDomeMaterial(isInner: boolean): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
        uniforms: {
            uTime: { value: 0 },
            uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            varying vec3 vLocalPos;
            void main() {
                vLocalPos = position;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vNormalView = normalize(normalMatrix * normal);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vNormalView;
            varying vec3 vViewDir;
            varying vec3 vLocalPos;
            void main() {
                if (uOpacity <= 0.004) discard;
                float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
                float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), ${isInner ? '2.0' : '2.3'});
                // Downward-scrolling atmospheric compression wave bands
                float bands = 0.5 + 0.5 * sin(vLocalPos.y * 2.2 + uTime * 7.5);
                float alpha = (rim * ${isInner ? '0.62' : '0.56'} + bands * 0.10) * uOpacity;
                if (alpha < 0.008) discard;
                vec3 deepCol = vec3(0.14, 0.06, 0.36);
                vec3 rimCol = ${isInner ? 'vec3(0.84, 0.72, 1.0)' : 'vec3(0.62, 0.38, 1.0)'};
                vec3 col = mix(deepCol, rimCol, clamp(rim * 1.15 + bands * 0.2, 0.0, 1.0));
                gl_FragColor = vec4(col * 1.25, clamp(alpha, 0.0, 0.72));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => `dragon-grav-dome-${isInner ? 'in' : 'out'}-v1`;
    return mat;
}

function createSpiderwebCraterMaterial(): T.ShaderMaterial {
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
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uOpacity;
            uniform float uReveal;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float reveal = smoothstep(uReveal + 0.06, uReveal - 0.14, r);
                // Jagged radial & concentric spiderweb pressure fractures
                float jag = 0.04 * sin(r * 24.0 + a * 3.0);
                float spokes = pow(max(0.0, cos((a + jag) * 10.0)), 22.0) * (1.0 - smoothstep(0.68, 0.98, r));
                float ring1 = exp(-pow((r - 0.30 + 0.025 * sin(a * 7.0)) / 0.018, 2.0));
                float ring2 = exp(-pow((r - 0.58 + 0.028 * cos(a * 9.0)) / 0.016, 2.0));
                float ring3 = exp(-pow((r - 0.84 + 0.022 * sin(a * 11.0)) / 0.015, 2.0));
                float core = exp(-r * r * 14.0) * 0.65;
                float intensity = (spokes * 0.95 + ring1 * 0.78 + ring2 * 0.68 + ring3 * 0.52 + core) * reveal;
                float fade = 1.0 - smoothstep(0.90, 1.0, r);
                vec3 violet = vec3(0.56, 0.28, 1.0);
                vec3 white = vec3(0.92, 0.86, 1.0);
                vec3 col = mix(violet, white, clamp(intensity * 0.65, 0.0, 1.0));
                gl_FragColor = vec4(col * 1.25, clamp(intensity * fade * uOpacity, 0.0, 0.92));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => 'dragon-grav-spiderweb-v1';
    return mat;
}

function createCompressionRingMaterial(isAirWhite: boolean): T.ShaderMaterial {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float ring = exp(-pow((r - 0.86) / 0.068, 2.0));
                float alpha = ring * (1.0 - smoothstep(0.95, 1.0, r)) * uOpacity;
                if (alpha < 0.006) discard;
                vec3 col = ${isAirWhite ? 'vec3(0.86, 0.78, 1.0)' : 'vec3(0.58, 0.30, 1.0)'};
                gl_FragColor = vec4(col * 1.32, clamp(alpha, 0.0, 0.88));
                #include <colorspace_fragment>
            }
        `,
    });
    mat.customProgramCacheKey = () => `dragon-grav-ring-${isAirWhite ? 'w' : 'v'}-v1`;
    return mat;
}

/**
 * Ancient Dragon Boss Gravity-Field Suppression VFX (重力场威压):
 * Descending translucent violet-silver compression domes, vertical downward gravity speed-lines,
 * spiderweb ground fractures, tilted crushed rim slabs, and horizontal ground-slam air shockwaves.
 */
export class DragonGravityPressureFX {
    private readonly group = new T.Group();
    private readonly outerDome: T.Mesh<T.SphereGeometry, T.ShaderMaterial>;
    private readonly innerDome: T.Mesh<T.SphereGeometry, T.ShaderMaterial>;
    private readonly craterMesh: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
    private readonly descendRings: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>[] = [];
    private readonly slamRings: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>[] = [];
    private readonly gravLines: T.InstancedMesh<T.CylinderGeometry, T.MeshBasicMaterial>;
    private readonly lineSeeds: { x: number; z: number; len: number; speed: number; phase: number; r: number }[] = [];
    private readonly crushedSlabs: T.InstancedMesh<T.BoxGeometry, T.MeshStandardMaterial>;
    private readonly slabSeeds: { x: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number }[] = [];

    private readonly dummy = new T.Object3D();
    private active = false;
    private age = 0;
    private duration = 3.2;

    constructor(scene: T.Scene) {
        this.group.name = '蚀渊古龙 · 重力场威压';
        this.group.visible = false;

        // 1) Dual Descending Atmospheric Compression Domes
        const domeGeo = new T.SphereGeometry(1, 36, 24);
        this.outerDome = new T.Mesh(domeGeo, createGravityDomeMaterial(false));
        this.innerDome = new T.Mesh(domeGeo, createGravityDomeMaterial(true));

        // 2) Spiderweb Ground Fracture Decal
        this.craterMesh = new T.Mesh(new T.PlaneGeometry(24, 24), createSpiderwebCraterMaterial());
        this.craterMesh.rotation.x = -Math.PI / 2;
        this.craterMesh.position.y = 0.12;

        // 3) Descending Horizontal Pressure Rings + Ground-Slam Air-Blast Rings
        const ringGeo = new T.PlaneGeometry(2, 2);
        for (let i = 0; i < DESCEND_RING_COUNT; i++) {
            const m = new T.Mesh(ringGeo, createCompressionRingMaterial(false));
            m.rotation.x = -Math.PI / 2;
            this.descendRings.push(m);
            this.group.add(m);
        }
        for (let i = 0; i < SLAM_RING_COUNT; i++) {
            const m = new T.Mesh(ringGeo, createCompressionRingMaterial(true));
            m.rotation.x = -Math.PI / 2;
            m.position.y = 0.22;
            this.slamRings.push(m);
            this.group.add(m);
        }

        // 4) 72 Vertical Downward-Plunging Anime Gravity Speed-Lines
        const lineGeo = new T.CylinderGeometry(0.03, 0.03, 1.0, 5);
        this.gravLines = new T.InstancedMesh(
            lineGeo,
            new T.MeshBasicMaterial({
                color: 0xd4c2ff,
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
            const r = 1.1 + Math.sqrt(((i * 37) % 100) / 100) * 10.5;
            this.lineSeeds.push({
                x: Math.cos(a) * r,
                z: Math.sin(a) * r,
                len: 3.8 + ((i * 19) % 11) * 0.65,
                speed: 1.45 + ((i * 13) % 9) * 0.16,
                phase: ((i * 41) % 100) / 100,
                r: 0.7 + ((i * 7) % 5) * 0.22,
            });
        }

        // 5) 28 Tilted Fractured Stone Slabs ringing the crushed rim
        const slabGeo = new T.BoxGeometry(1, 1, 1);
        this.crushedSlabs = new T.InstancedMesh(
            slabGeo,
            new T.MeshStandardMaterial({
                color: 0x3b3548,
                roughness: 0.88,
                metalness: 0.08,
                flatShading: true,
            }),
            SLAB_COUNT,
        );
        this.crushedSlabs.frustumCulled = false;
        this.crushedSlabs.castShadow = false;
        this.crushedSlabs.receiveShadow = false;
        for (let i = 0; i < SLAB_COUNT; i++) {
            const a = (i / SLAB_COUNT) * Math.PI * 2 + ((i * 17) % 10) * 0.02;
            const r = 8.4 + ((i * 23) % 10) * 0.32;
            const tilt = 0.28 + ((i * 11) % 7) * 0.055;
            this.slabSeeds.push({
                x: Math.cos(a) * r,
                z: Math.sin(a) * r,
                sx: 0.75 + ((i * 13) % 7) * 0.16,
                sy: 0.18 + ((i * 5) % 5) * 0.05,
                sz: 0.65 + ((i * 19) % 6) * 0.14,
                rx: Math.sin(a) * tilt,
                ry: a,
                rz: -Math.cos(a) * tilt,
            });
        }

        this.group.add(this.outerDome, this.innerDome, this.craterMesh, this.gravLines, this.crushedSlabs);
        scene.add(this.group);
    }

    get isActive(): boolean {
        return this.active;
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
        const fadeIn = smooth01(0, 0.25, t);
        const fadeOut = 1 - smooth01(this.duration - 0.55, this.duration, t);
        const alpha = fadeIn * fadeOut;

        // 1) Heavy descending compression domes pulsing downward onto the trapped player
        const descend = smooth01(0, 0.65, t);
        const pulse = Math.sin(t * 7.5) * 0.35;
        this.outerDome.position.y = T.MathUtils.lerp(16.0, 3.6, descend) + pulse;
        this.outerDome.scale.set(11.5, 7.6, 11.5);
        this.outerDome.material.uniforms.uTime.value = t;
        this.outerDome.material.uniforms.uOpacity.value = alpha * 0.92;

        this.innerDome.position.y = T.MathUtils.lerp(14.5, 2.4, descend) + pulse * 0.8;
        this.innerDome.scale.set(7.6, 5.2, 7.6);
        this.innerDome.material.uniforms.uTime.value = t;
        this.innerDome.material.uniforms.uOpacity.value = alpha * 0.85;

        // 2) Spiderweb Ground Fractures
        this.craterMesh.material.uniforms.uTime.value = t;
        this.craterMesh.material.uniforms.uOpacity.value = alpha * 0.94;
        this.craterMesh.material.uniforms.uReveal.value = smooth01(0.08, 0.62, t);

        // 3) Descending Horizontal Pressure Rings & Ground-Slam Radial Shockwaves
        for (let i = 0; i < DESCEND_RING_COUNT; i++) {
            const cyc = (t * 1.15 + i / DESCEND_RING_COUNT) % 1;
            const m = this.descendRings[i];
            m.position.y = T.MathUtils.lerp(15.5, 0.2, cyc);
            m.scale.setScalar(T.MathUtils.lerp(6.8, 12.8, cyc));
            m.material.uniforms.uOpacity.value = smooth01(0, 0.15, cyc) * (1 - smooth01(0.75, 1.0, cyc)) * alpha * 0.85;
        }
        for (let i = 0; i < SLAM_RING_COUNT; i++) {
            const cyc = (t * 1.05 + i / SLAM_RING_COUNT) % 1;
            const m = this.slamRings[i];
            m.scale.setScalar(2.4 + 18.5 * (1 - Math.pow(1 - cyc, 2.0)));
            m.material.uniforms.uOpacity.value = Math.pow(1 - cyc, 1.6) * alpha * 0.92;
        }

        // 4) Vertical Downward-Plunging Anime Gravity Speed-Lines
        (this.gravLines.material as T.MeshBasicMaterial).opacity = alpha * 0.65;
        const dummy = this.dummy;
        for (let i = 0; i < GRAV_LINE_COUNT; i++) {
            const s = this.lineSeeds[i];
            const cyc = (s.phase + t * s.speed) % 1;
            const y = T.MathUtils.lerp(18.5, -0.5, cyc);
            dummy.position.set(s.x, y, s.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(s.r, s.len, s.r);
            dummy.updateMatrix();
            this.gravLines.setMatrixAt(i, dummy.matrix);
        }
        this.gravLines.count = GRAV_LINE_COUNT;
        this.gravLines.instanceMatrix.needsUpdate = true;

        // 5) Tilted Fractured Rim Slabs rising slightly out of the crushed ground
        const slabPop = smooth01(0.15, 0.52, t) * (1 - smooth01(this.duration - 0.45, this.duration, t));
        for (let i = 0; i < SLAB_COUNT; i++) {
            const s = this.slabSeeds[i];
            dummy.position.set(s.x, 0.10 * slabPop, s.z);
            dummy.rotation.set(s.rx, s.ry, s.rz);
            dummy.scale.set(s.sx * slabPop, s.sy * slabPop, s.sz * slabPop);
            dummy.updateMatrix();
            this.crushedSlabs.setMatrixAt(i, dummy.matrix);
        }
        this.crushedSlabs.count = SLAB_COUNT;
        this.crushedSlabs.instanceMatrix.needsUpdate = true;
    }

    collectLights(pool: SpellLightPool) {
        if (!this.active) return;
        const alpha = smooth01(0, 0.25, this.age) * (1 - smooth01(this.duration - 0.5, this.duration, this.age));
        pool.emit({
            x: this.group.position.x,
            y: this.group.position.y + 6.5,
            z: this.group.position.z,
            color: 0x9b5cff,
            intensity: 58 * alpha,
            distance: 28,
            priority: 108,
            castShadow: false,
        });
    }

    clear() {
        this.active = false;
        this.age = 0;
        this.group.visible = false;
        this.gravLines.count = 0;
        this.crushedSlabs.count = 0;
    }

    dispose() {
        this.clear();
        this.group.removeFromParent();
        this.outerDome.geometry.dispose();
        this.outerDome.material.dispose();
        this.innerDome.material.dispose();
        this.craterMesh.geometry.dispose();
        this.craterMesh.material.dispose();
        if (this.descendRings.length) this.descendRings[0].geometry.dispose();
        for (const r of this.descendRings) r.material.dispose();
        for (const r of this.slamRings) r.material.dispose();
        this.gravLines.geometry.dispose();
        (this.gravLines.material as T.Material).dispose();
        this.gravLines.dispose();
        this.crushedSlabs.geometry.dispose();
        (this.crushedSlabs.material as T.Material).dispose();
        this.crushedSlabs.dispose();
    }
}
