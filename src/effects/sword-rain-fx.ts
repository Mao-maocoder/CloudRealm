import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const chipsPerImpact = 5;
const groundPuffsPerImpact = 3;
const dustyChipsPerImpact = 2;
type EffectMesh = T.InstancedMesh<T.BufferGeometry, T.Material>;

function batch(geometry: T.BufferGeometry, material: T.Material, max: number, name: string): EffectMesh {
    const instances = new T.InstancedMesh(geometry, material, max);
    instances.name = name;
    instances.count = 0;
    instances.frustumCulled = false;
    instances.instanceMatrix.setUsage(T.DynamicDrawUsage);
    return instances;
}

function luminous(map: T.Texture) {
    return new T.MeshBasicMaterial({
        map,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
        forceSinglePass: true,
        toneMapped: false,
        alphaTest: .004,
    });
}

function dustMaterial() {
    return new T.ShaderMaterial({
        vertexShader: `
            varying vec2 vDustUV;
            varying vec3 vDust;

            void main() {
                vDustUV = uv;
                vDust = instanceColor;
                mat4 transform = modelViewMatrix * instanceMatrix;
                vec4 center = transform[3];
                vec2 size = vec2(length(transform[0].xyz), length(transform[1].xyz));
                center.xy += position.xy * size;
                gl_Position = projectionMatrix * center;
            }
        `,
        fragmentShader: `
            varying vec2 vDustUV;
            varying vec3 vDust;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 s = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), s.x), s.y);
            }

            void main() {
                vec2 uv = vDustUV * 2.0 - 1.0;
                vec2 drift = vec2(vDust.g * 18.0, -vDust.b * 1.25);
                float density = noise(uv * 3.7 + drift);
                float detail = noise(uv * 8.8 + drift);
                float radius = length(uv);
                float edge = 1.0 - smoothstep(0.34, 0.98, radius);
                float body = 1.0 - smoothstep(0.18, 0.88, radius + 0.36 * (density - 0.48));
                float alpha = vDust.r * edge * body * (0.52 + 0.48 * detail);
                if (alpha < 0.008) discard;
                vec3 color = mix(vec3(0.22, 0.165, 0.106), vec3(0.57, 0.47, 0.32), density);
                gl_FragColor = vec4(color, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
    });
}

function spireGeometry() {
    // Crossed vertical planes for a crisp 3D sword-qi impact pillar visible from any angle.
    const a = new T.PlaneGeometry(1, 1);
    a.translate(0, 0.5, 0);
    const b = new T.PlaneGeometry(1, 1);
    b.rotateY(Math.PI / 2);
    b.translate(0, 0.5, 0);
    const posA = a.getAttribute('position') as T.BufferAttribute;
    const posB = b.getAttribute('position') as T.BufferAttribute;
    const uvA = a.getAttribute('uv') as T.BufferAttribute;
    const uvB = b.getAttribute('uv') as T.BufferAttribute;
    const idxA = a.getIndex()!;
    const idxB = b.getIndex()!;
    const positions = new Float32Array((posA.count + posB.count) * 3);
    positions.set(posA.array as Float32Array, 0);
    positions.set(posB.array as Float32Array, posA.count * 3);
    const uvs = new Float32Array((uvA.count + uvB.count) * 2);
    uvs.set(uvA.array as Float32Array, 0);
    uvs.set(uvB.array as Float32Array, uvA.count * 2);
    const indices = new Uint16Array(idxA.count + idxB.count);
    indices.set(idxA.array as Uint16Array, 0);
    for (let i = 0; i < idxB.count; i++) indices[idxA.count + i] = idxB.getX(i) + posA.count;
    a.dispose();
    b.dispose();
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new T.BufferAttribute(uvs, 2));
    geom.setIndex(new T.BufferAttribute(indices, 1));
    return geom;
}

function spireMaterial() {
    return new T.ShaderMaterial({
        vertexShader: `
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
                vUv = uv;
                vAlpha = instanceColor.r;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
                float across = abs(vUv.x - 0.5) * 2.0;
                float core = pow(max(0.0, 1.0 - across), 2.4);
                float vertical = smoothstep(0.0, 0.14, vUv.y) * pow(max(0.0, 1.0 - vUv.y), 1.45);
                float alpha = core * vertical * vAlpha;
                if (alpha < 0.005) discard;
                vec3 color = mix(vec3(0.16, 0.72, 1.0), vec3(0.86, 0.98, 1.0), core * 0.75);
                gl_FragColor = vec4(color * (1.05 + 0.35 * core), alpha * 0.85);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
        toneMapped: false,
    });
}

function portalMaterial() {
    return new T.ShaderMaterial({
        vertexShader: `
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
                vUv = uv;
                vAlpha = instanceColor.r;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying float vAlpha;
            void main() {
                vec2 p = vUv * 2.0 - 1.0;
                float r = length(p);
                float ring = exp(-pow((r - 0.62) * 5.5, 2.0));
                float core = exp(-r * r * 6.5);
                float alpha = (ring * 0.9 + core * 0.7) * (1.0 - smoothstep(0.82, 1.0, r)) * vAlpha;
                if (alpha < 0.005) discard;
                vec3 color = mix(vec3(0.24, 0.82, 1.0), vec3(0.92, 0.99, 1.0), core);
                gl_FragColor = vec4(color * 1.45, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
        toneMapped: false,
    });
}

export class SwordRainFX {
    private meshes?: {
        trail: EffectMesh;
        portal: EffectMesh;
        spire: EffectMesh;
        wave: EffectMesh;
        crack: EffectMesh;
        debris: EffectMesh;
        dust: EffectMesh;
    };
    private textures: T.Texture[] = [];
    private readonly placement = new T.Object3D();
    private readonly light = new T.Color();
    private disposed = false;

    constructor(private parent: T.Group, private capacity: number) {}

    async load() {
        const textures = new T.TextureLoader();
        const [gltf, trail, wave, crack] = await Promise.all([
            new GLTFLoader().loadAsync(new URL('../../resource/skill/sword-rain-fx/sword-rain-meshes.glb', import.meta.url).href),
            textures.loadAsync(new URL('../../resource/skill/sword-rain-fx/sword-rain-trail.png', import.meta.url).href),
            textures.loadAsync(new URL('../../resource/skill/sword-rain-fx/sword-rain-shockwave.png', import.meta.url).href),
            textures.loadAsync(new URL('../../resource/skill/sword-rain-fx/sword-rain-crack.png', import.meta.url).href),
        ]);
        const ribbon = gltf.scene.getObjectByName('RainTrail');
        const stone = gltf.scene.getObjectByName('RainShard');
        if (!(ribbon instanceof T.Mesh) || !(stone instanceof T.Mesh))
            throw new Error('Sword rain asset must contain RainTrail and RainShard meshes');

        this.textures = [trail, wave, crack];
        // The ribbon carries glTF UVs. The ground planes carry Three.js UVs.
        trail.flipY = false;
        for (const texture of this.textures) {
            texture.colorSpace = T.SRGBColorSpace;
            texture.needsUpdate = true;
        }
        for (const material of new Set([ribbon.material, stone.material].flat())) material.dispose();

        this.meshes = {
            trail: batch(ribbon.geometry, luminous(trail), this.capacity, 'Sword Rain Ribbon Trails'),
            portal: batch(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), portalMaterial(), this.capacity, 'Sword Rain Spawn Portals'),
            spire: batch(spireGeometry(), spireMaterial(), this.capacity, 'Sword Rain Impact Spires'),
            wave: batch(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), luminous(wave), this.capacity, 'Sword Rain Shockwaves'),
            crack: batch(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), luminous(crack), this.capacity, 'Sword Rain Crack Flashes'),
            debris: batch(stone.geometry, new T.MeshStandardMaterial({
                color: '#8b7964',
                roughness: .94,
                flatShading: true,
            }), this.capacity * chipsPerImpact, 'Sword Rain Stone Chips'),
            dust: batch(
                new T.PlaneGeometry(2, 2),
                dustMaterial(),
                this.capacity * (groundPuffsPerImpact + dustyChipsPerImpact),
                'Sword Rain Impact Dust',
            ),
        };
        this.meshes.dust.renderOrder = -1;
        if (this.disposed) {
            this.dispose();
            return;
        }
        for (const mesh of Object.values(this.meshes)) {
            mesh.setColorAt(0, this.light.setScalar(1));
            mesh.instanceColor!.setUsage(T.DynamicDrawUsage);
            this.parent.add(mesh);
        }
    }

    clear() {
        if (!this.meshes) return;
        for (const mesh of Object.values(this.meshes)) mesh.count = 0;
    }

    private place(mesh: EffectMesh, intensity: number, variation = intensity, age = intensity) {
        if (mesh.count === mesh.instanceMatrix.count) return;
        this.placement.updateMatrix();
        mesh.setMatrixAt(mesh.count, this.placement.matrix);
        mesh.setColorAt(mesh.count, this.light.setRGB(intensity, variation, age));
        mesh.count++;
    }

    trail(x: number, y: number, z: number, yaw: number, length: number, width: number, opacity: number) {
        if (!this.meshes || length < .10) return;
        const placement = this.placement;
        placement.position.set(x, y, z);
        placement.rotation.set(0, yaw, 0);
        placement.scale.set(width, length, width);
        this.place(this.meshes.trail, opacity * 1.15);
    }

    portal(x: number, y: number, z: number, yaw: number, age: number, opacity: number) {
        if (!this.meshes || age < 0 || age >= .28) return;
        const progress = age / .28;
        const placement = this.placement;
        placement.position.set(x, y, z);
        placement.rotation.set(0, yaw, 0);
        placement.scale.setScalar(.42 + 1.15 * (1 - (1 - progress) ** 2));
        this.place(this.meshes.portal, opacity * (1 - progress) ** 1.35);
    }

    impact(x: number, y: number, z: number, yaw: number, age: number, opacity: number, water: boolean) {
        if (!this.meshes) return;
        const placement = this.placement;
        placement.rotation.set(0, yaw, 0);
        if (age < .24) {
            const p = age / .24;
            placement.position.set(x, y + .05, z);
            const width = .55 + .85 * p;
            const height = (2.6 + 2.4 * (1 - (1 - p) ** 2)) * (1 - p * .35);
            placement.scale.set(width, height, width);
            this.place(this.meshes.spire, opacity * (1 - p) ** 1.5);
        }
        if (age < .38) {
            const progress = age / .38;
            placement.position.set(x, y + .085, z);
            placement.scale.setScalar(.36 + 2.45 * (1 - (1 - progress) ** 2));
            this.place(this.meshes.wave, opacity * 1.15 * (1 - progress) ** 1.5);
        }
        if (water) return;

        const dustProgress = age / .59;
        if (dustProgress < 1) {
            const grow = 1 - (1 - dustProgress) ** 2;
            const strength = opacity * .40 * T.MathUtils.smoothstep(age, 0, .055) * (1 - dustProgress) ** 1.28;
            for (let i = 0; i < groundPuffsPerImpact; i++) {
                const phase = yaw + i * 2.39996;
                const seed = .5 + .5 * Math.sin(phase * 5.93);
                const drift = .17 + (.72 + .28 * seed) * grow;
                placement.position.set(x + Math.cos(phase) * drift, y + .12 + .19 * grow, z + Math.sin(phase) * drift);
                placement.scale.set(.24 + (.47 + .19 * seed) * grow, .13 + .31 * grow, 1);
                this.place(this.meshes.dust, strength, seed, dustProgress);
            }
        }

        if (age < .49) {
            const reveal = T.MathUtils.smoothstep(age, 0, .105);
            const fade = 1 - T.MathUtils.smoothstep(age, .19, .49);
            placement.position.set(x, y + .105, z);
            placement.scale.setScalar(.64 + .78 * reveal);
            this.place(this.meshes.crack, opacity * fade * (.40 + .88 * Math.exp(-age * 12)));
        }
        for (let i = 0; i < chipsPerImpact; i++) {
            const phase = yaw + i * 2.39996;
            const random = .5 + .5 * Math.sin(phase * 8.71);
            const progress = age / (.34 + .17 * random);
            if (progress >= 1) continue;
            const reach = .11 + (.72 + .45 * i) * progress;
            const height = .075 + (.36 + .49 * random) * 4 * progress * (1 - progress);
            placement.position.set(x + Math.cos(phase) * reach, y + height, z + Math.sin(phase) * reach);
            placement.rotation.set(phase + progress * 5, yaw + progress * 4, i + progress * 7);
            const size = (.068 + .088 * random) * (1 - T.MathUtils.smoothstep(progress, .64, 1));
            placement.scale.set(size, size * (.63 + .46 * random), size * 1.14);
            this.place(this.meshes.debris, .68 + .53 * random);
            if (i < dustyChipsPerImpact && progress > .08) {
                const behind = Math.max(0, progress - .19);
                const drift = .11 + (.72 + .45 * i) * behind;
                const lift = .075 + (.36 + .49 * random) * 4 * behind * (1 - behind);
                placement.position.set(x + Math.cos(phase) * drift, y + lift, z + Math.sin(phase) * drift);
                placement.scale.set(.16 + .27 * progress, .12 + .18 * progress, 1);
                this.place(this.meshes.dust, opacity * .28 * (1 - progress), random, progress);
            }
        }
    }

    upload() {
        if (!this.meshes) return;
        for (const mesh of Object.values(this.meshes)) {
            if (!mesh.count) continue;
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor!.needsUpdate = true;
        }
    }

    dispose() {
        this.disposed = true;
        if (this.meshes) {
            for (const mesh of Object.values(this.meshes)) {
                mesh.removeFromParent();
                mesh.dispose();
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            this.meshes = undefined;
        }
        for (const texture of this.textures) texture.dispose();
        this.textures = [];
    }
}
