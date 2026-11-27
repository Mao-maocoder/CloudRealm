import * as T from 'three';
import { detectDevice } from '../config/device';
import { SwordRainFX } from './sword-rain-fx';
import type { SpellLightPool } from './spell-lights';

const loopDuration = 12;
const formationHeight = 17;
const formationWidth = 40;
const rainStart = .82;
const waveInterval = .27;
const openingWaveCount = 16;
const waveCount = openingWaveCount + 40;
const openingSwordsPerWave = 25;
const sustainedSwordsPerWave = 15;
const waveStagger = .13;
const maxFallTime = .82;
const embeddedTime = .64;
const longestLife = maxFallTime + embeddedTime + waveStagger;
const maxSwords = (Math.ceil(longestLife / waveInterval) + 1) * openingSwordsPerWave;
const up = new T.Vector3(0, 1, 0);

type FallingSword = {
    x: number;
    z: number;
    top: number;
    ground: number;
    water: boolean;
    size: number;
    yaw: number;
    start: number;
    flight: number;
    tip?: number;
    struck: Set<number>;
};

export interface SwordRainContact {
    x: number;
    z: number;
    fromY: number;
    toY: number;
    landed: boolean;
    struck: Set<number>;
}

function canDecodeWebm(): boolean {
    if (typeof document === 'undefined') return false;
    if (detectDevice().isIOS) return false;
    const probe = document.createElement('video');
    return Boolean(probe.canPlayType('video/webm; codecs="vp9"') || probe.canPlayType('video/webm; codecs="vp8"'));
}

function videoClip(url: URL, loop: boolean, supported: boolean) {
    const video = document.createElement('video');
    video.muted = video.defaultMuted = true;
    video.playsInline = true;
    video.preload = !supported || detectDevice().isMobile ? 'none' : 'metadata';
    video.loop = loop;
    if (supported) video.src = url.href;
    const texture = new T.VideoTexture(video);
    texture.colorSpace = T.SRGBColorSpace;
    return { video, texture };
}

/**
 * Procedural concentric celestial sword-formation shader used on iOS Safari / WebKit
 * (or when WebM alpha video is unavailable), costing 0 MB video bandwidth.
 */
function proceduralArrayMaterial() {
    return new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        toneMapped: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                float r = length(vUv);
                if (r > 1.0 || uOpacity <= 0.004) discard;
                float a = atan(vUv.y, vUv.x);
                float outerRing = exp(-pow((r - 0.88) / 0.022, 2.0)) + 0.55 * exp(-pow((r - 0.80) / 0.014, 2.0));
                float midRing = exp(-pow((r - 0.54) / 0.018, 2.0)) + 0.5 * exp(-pow((r - 0.30) / 0.015, 2.0));
                float runesOuter = (0.5 + 0.5 * sin(a * 24.0 - uTime * 1.6)) * exp(-pow((r - 0.84) / 0.032, 2.0));
                float runesMid = (0.5 + 0.5 * cos(a * 12.0 + uTime * 2.3)) * exp(-pow((r - 0.42) / 0.038, 2.0));
                float spokes = pow(max(0.0, cos(a * 8.0 + uTime * 0.65)), 18.0) * smoothstep(0.16, 0.32, r) * (1.0 - smoothstep(0.84, 0.94, r));
                float core = exp(-r * r * 18.0) * (0.85 + 0.15 * sin(uTime * 6.0));
                float halo = exp(-r * r * 2.8) * 0.22;
                float intensity = outerRing * 0.95 + midRing * 0.82 + runesOuter * 0.65 + runesMid * 0.55 + spokes * 0.5 + core * 1.15 + halo;
                float alpha = clamp(intensity * uOpacity, 0.0, 1.0) * (1.0 - smoothstep(0.92, 1.0, r));
                if (alpha < 0.006) discard;
                vec3 deep = vec3(0.10, 0.62, 1.0);
                vec3 bright = vec3(0.86, 0.99, 1.0);
                vec3 col = mix(deep, bright, clamp(intensity * 0.65, 0.0, 1.0));
                gl_FragColor = vec4(col * 1.25, alpha);
                #include <colorspace_fragment>
            }
        `,
    });
}

/**
 * Merges and spatially clusters all sword meshes in sword-local coordinates into a single
 * lightweight vertex-colored BufferGeometry (~1,200 tris instead of 97 meshes / 235k verts)
 * so 150 falling rain swords render in 1 single InstancedMesh draw call!
 */
function buildMergedRainSwordGeometry(model: T.Object3D, toSword: T.Matrix4): T.BufferGeometry | undefined {
    const cells = new Map<string, number>();
    const vertices: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const counts: number[] = [];
    const faces = new Set<string>();
    const index: number[] = [];

    const posV = new T.Vector3();
    const normV = new T.Vector3();
    const normalMat = new T.Matrix3();
    const localMat = new T.Matrix4();
    const baseCol = new T.Color();

    model.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        const geom = object.geometry;
        const posAttr = geom.getAttribute('position');
        const normAttr = geom.getAttribute('normal');
        if (!posAttr || !normAttr) return;

        localMat.copy(toSword).multiply(object.matrixWorld);
        normalMat.getNormalMatrix(localMat);

        const mats = Array.isArray(object.material) ? object.material : [object.material];
        const mat = mats[0] as T.MeshStandardMaterial | undefined;
        baseCol.setRGB(0.82, 0.9, 0.96);
        if (mat && 'color' in mat && mat.color instanceof T.Color) {
            baseCol.copy(mat.color);
            if ('emissive' in mat && mat.emissive instanceof T.Color) {
                baseCol.r = Math.min(1.4, baseCol.r + mat.emissive.r * 0.75);
                baseCol.g = Math.min(1.4, baseCol.g + mat.emissive.g * 0.75);
                baseCol.b = Math.min(1.4, baseCol.b + mat.emissive.b * 0.75);
            }
        }

        const remap = new Uint32Array(posAttr.count);
        for (let i = 0; i < posAttr.count; i++) {
            posV.fromBufferAttribute(posAttr, i).applyMatrix4(localMat);
            normV.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
            const key = `${Math.round(posV.x / .028)},${Math.round(posV.y / .028)},${Math.round(posV.z / .065)},${Math.sign(normV.y || 1)}`;
            let cell = cells.get(key);
            if (cell === undefined) {
                cell = counts.length;
                cells.set(key, cell);
                vertices.push(0, 0, 0);
                normals.push(0, 0, 0);
                colors.push(0, 0, 0);
                counts.push(0);
            }
            remap[i] = cell;
            counts[cell]++;
            vertices[cell * 3] += posV.x;
            vertices[cell * 3 + 1] += posV.y;
            vertices[cell * 3 + 2] += posV.z;
            normals[cell * 3] += normV.x;
            normals[cell * 3 + 1] += normV.y;
            normals[cell * 3 + 2] += normV.z;
            colors[cell * 3] += baseCol.r;
            colors[cell * 3 + 1] += baseCol.g;
            colors[cell * 3 + 2] += baseCol.b;
        }

        const triIdx = geom.getIndex();
        const triCount = triIdx ? triIdx.count : posAttr.count;
        for (let i = 0; i + 2 < triCount; i += 3) {
            const a = remap[triIdx ? triIdx.getX(i) : i];
            const b = remap[triIdx ? triIdx.getX(i + 1) : i + 1];
            const c = remap[triIdx ? triIdx.getX(i + 2) : i + 2];
            if (a === b || b === c || c === a) continue;
            const low = Math.min(a, b, c), high = Math.max(a, b, c);
            const fKey = `${low},${a + b + c - low - high},${high}`;
            if (faces.has(fKey)) continue;
            faces.add(fKey);
            index.push(a, b, c);
        }
    });

    if (!index.length) return undefined;
    const dir = new T.Vector3();
    for (let cell = 0; cell < counts.length; cell++) {
        const c = counts[cell];
        const off = cell * 3;
        vertices[off] /= c;
        vertices[off + 1] /= c;
        vertices[off + 2] /= c;
        dir.fromArray(normals, off).normalize().toArray(normals, off);
        colors[off] /= c;
        colors[off + 1] /= c;
        colors[off + 2] /= c;
    }

    const reduced = new T.BufferGeometry();
    reduced.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    reduced.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    reduced.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    reduced.setIndex(index);
    reduced.computeBoundingBox();
    reduced.computeBoundingSphere();
    return reduced;
}

function lightMaterial(core = false) {
    return new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        vertexShader: `
            varying vec2 vBeamUv;
            void main() {
                vBeamUv = uv;
                vec4 p = vec4(position, 1.0);
                #ifdef USE_INSTANCING
                    p = instanceMatrix * p;
                #endif
                gl_Position = projectionMatrix * modelViewMatrix * p;
            }
        `,
        fragmentShader: core ? `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vBeamUv;
            void main() {
                float ends = smoothstep(0.0, 0.08, vBeamUv.y) * (1.0 - smoothstep(0.88, 1.0, vBeamUv.y));
                float pulse = 0.85 + 0.15 * sin(uTime * 18.0 - vBeamUv.y * 12.0);
                vec3 color = vec3(0.86, 0.99, 1.0) * 1.45;
                gl_FragColor = vec4(color, uOpacity * ends * pulse);
                #include <colorspace_fragment>
            }
        ` : `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vBeamUv;
            void main() {
                float ends = smoothstep(0.0, 0.12, vBeamUv.y) * (1.0 - smoothstep(0.85, 1.0, vBeamUv.y));
                float spiral = 0.5 + 0.5 * sin(6.283 * (3.0 * vBeamUv.x + 1.7 * vBeamUv.y) - 11.0 * uTime);
                float filament = pow(spiral, 3.2);
                vec3 color = mix(vec3(0.04, 0.52, 0.96), vec3(0.75, 0.99, 1.0), filament) * 1.25;
                gl_FragColor = vec4(color, uOpacity * ends * (0.42 + 0.58 * filament));
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
}

function tipOrbMaterial() {
    return new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                vec2 scale = vec2(length(modelViewMatrix[0].xyz), length(modelViewMatrix[1].xyz));
                mv.xy += position.xy * scale;
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                vec2 p = vUv * 2.0 - 1.0;
                float r = length(p);
                float a = atan(p.y, p.x);
                float core = exp(-r * r * 24.0);
                float rays = pow(max(0.0, cos(a * 4.0 + uTime * 2.2)), 14.0) * exp(-r * 4.2) * 0.72;
                float alpha = (core * 0.85 + rays) * (1.0 - smoothstep(0.72, 1.0, r)) * uOpacity;
                if (alpha < 0.005) discard;
                vec3 col = mix(vec3(0.22, 0.78, 1.0), vec3(0.92, 0.99, 1.0), clamp(core, 0.0, 1.0));
                gl_FragColor = vec4(col, alpha * 0.85);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
}

function createSkyMotes(): T.Points<T.BufferGeometry, T.ShaderMaterial> {
    const count = 120;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const s1 = (Math.sin(i * 127.1 + 11.7) * 43758.5453) % 1;
        const s2 = (Math.sin(i * 269.5 + 31.3) * 43758.5453) % 1;
        const s3 = (Math.sin(i * 419.2 + 57.1) * 43758.5453) % 1;
        const r1 = s1 < 0 ? s1 + 1 : s1;
        const r2 = s2 < 0 ? s2 + 1 : s2;
        const r3 = s3 < 0 ? s3 + 1 : s3;
        const angle = r1 * Math.PI * 2;
        const radius = 2.2 + Math.sqrt(r2) * 15.5;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        seeds[i * 3] = r3;
        seeds[i * 3 + 1] = 0.65 + r1 * 0.7;
        seeds[i * 3 + 2] = r2;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 3));
    const material = new T.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        vertexShader: `
            attribute vec3 aSeed;
            uniform float uTime;
            uniform float uOpacity;
            varying float vAlpha;
            varying float vTint;
            void main() {
                float p = fract(aSeed.x + uTime * 0.24 * aSeed.y);
                vec3 pos = position;
                float swirl = uTime * 0.55 + aSeed.z * 6.283;
                pos.x += sin(swirl + p * 4.0) * 0.55;
                pos.z += cos(swirl + p * 4.0) * 0.55;
                pos.y = -p * 16.5;
                vec4 mv = modelViewMatrix * vec4(pos, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = clamp((24.0 + 18.0 * aSeed.z) / max(2.0, -mv.z), 2.0, 12.0);
                float env = smoothstep(0.0, 0.14, p) * (1.0 - smoothstep(0.68, 1.0, p));
                vAlpha = env * uOpacity * 0.78;
                vTint = aSeed.z;
            }
        `,
        fragmentShader: `
            varying float vAlpha;
            varying float vTint;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float glow = smoothstep(0.5, 0.05, d);
                float alpha = glow * glow * vAlpha;
                if (alpha < 0.005) discard;
                vec3 col = mix(vec3(0.32, 0.85, 1.0), vec3(0.92, 0.99, 1.0), vTint);
                gl_FragColor = vec4(col * 1.35, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
    const points = new T.Points(geometry, material);
    points.name = 'Sword Array Spirit Motes';
    points.frustumCulled = false;
    return points;
}

export class SwordArray {
    private readonly videoSupported = canDecodeWebm();
    private readonly opening = videoClip(new URL('../../resource/skill/sword-array/sword-array-open.webm', import.meta.url), false, this.videoSupported);
    private readonly loop = videoClip(new URL('../../resource/skill/sword-array/sword-array-loop.webm', import.meta.url), true, this.videoSupported);
    private readonly group = new T.Group();
    private readonly videoMaterial = new T.MeshBasicMaterial({
        map: this.opening.texture,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        forceSinglePass: true,
        toneMapped: false,
    });
    private readonly fallbackMaterial = proceduralArrayMaterial();
    // Top-down orthographic render: 1:1 square plane keeps all concentric rings perfectly circular.
    private readonly mesh = new T.Mesh<T.PlaneGeometry, T.Material>(
        new T.PlaneGeometry(formationWidth, formationWidth),
        this.videoSupported ? this.videoMaterial : this.fallbackMaterial,
    );
    private readonly blades: { instances: T.InstancedMesh; local: T.Matrix4; ownsGeometry: boolean; ownsMaterial?: boolean }[] = [];
    private proceduralMode = !this.videoSupported;
    private proceduralTime = 0;
    private readonly rain: FallingSword[] = [];
    private readonly rainFx = new SwordRainFX(this.group, maxSwords);
    private readonly lightGeometry = new T.CylinderGeometry(.75, 1, 1, 10, 1, true);
    private readonly beam = new T.Mesh(this.lightGeometry, lightMaterial(false));
    private readonly beamCore = new T.Mesh(this.lightGeometry, lightMaterial(true));
    private readonly skyMotes = createSkyMotes();
    private readonly chargeGroup = new T.Group();
    private readonly tipOrb = new T.Mesh(new T.PlaneGeometry(.48, .48), tipOrbMaterial());
    private chargeTime = 0;
    private burstAge = -1;
    private readonly placement = new T.Object3D();
    private readonly beamOrigin = new T.Vector3();
    private readonly bladeMatrix = new T.Matrix4();
    private readonly bladeDown = new T.Quaternion();
    private tipOffset = 0;
    private bladeLength = 0;
    private nextWave = 0;
    private tip?: T.Object3D;
    private sampleBeamOrigin = false;
    private phase?: ReturnType<typeof videoClip>;
    private playback = 0;
    private loopAge = 0;
    private paused = false;
    private groundY = 0;
    private currentOpacity = 0;
    private currentBeamAlpha = 0;
    private currentOrbAlpha = 0;

    constructor(
        scene: T.Scene,
        private surfaceAt: (x: number, z: number, fromY: number) => { height: number; water: boolean },
        private onError: (error: unknown) => void,
        private onContact?: (sword: SwordRainContact) => void,
    ) {
        this.group.name = '万剑归宗';
        this.group.visible = false;
        this.mesh.name = 'Sword Array';
        this.mesh.rotation.x = -Math.PI / 2;
        this.beam.name = 'Sword Array Casting Beam';
        this.beamCore.name = 'Sword Array Casting Beam Core';
        this.group.add(this.mesh, this.skyMotes, this.beam, this.beamCore);
        scene.add(this.group);

        this.chargeGroup.name = 'Sword Array Caster Charge';
        this.chargeGroup.visible = false;
        this.tipOrb.name = 'Sword Array Tip Flare';
        this.tipOrb.renderOrder = 5;
        this.chargeGroup.add(this.tipOrb);
        scene.add(this.chargeGroup);
        this.opening.video.addEventListener('ended', this.opened);
        this.opening.video.addEventListener('error', this.mediaError);
        this.loop.video.addEventListener('error', this.mediaError);
    }

    load() {
        return this.rainFx.load();
    }

    attachSword(sword: T.Object3D, tip: T.Object3D) {
        const model = sword.getObjectByName('AzureSword_Grip');
        if (!model) throw new Error('Character.glb is missing AzureSword_Grip');
        this.tip = tip;
        this.tipOffset = tip.position.length();
        this.bladeDown.setFromUnitVectors(tip.position.clone().normalize(), up.clone().negate());
        sword.updateWorldMatrix(true, true);
        const toSword = sword.matrixWorld.clone().invert();
        const merged = buildMergedRainSwordGeometry(model, toSword);
        if (!merged || !merged.boundingBox || merged.boundingBox.isEmpty()) {
            throw new Error('AzureSword_Grip contains no sword meshes');
        }
        const bladeMaterial = new T.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.76,
            roughness: 0.24,
            emissive: new T.Color(0x165e82),
            emissiveIntensity: 0.32,
            side: T.DoubleSide,
        });
        const instances = new T.InstancedMesh(merged, bladeMaterial, maxSwords);
        instances.name = 'Sword Rain · Merged Blade';
        instances.count = 0;
        instances.instanceMatrix.setUsage(T.DynamicDrawUsage);
        instances.frustumCulled = false;
        this.blades.push({ instances, local: new T.Matrix4(), ownsGeometry: true, ownsMaterial: true });
        this.group.add(instances);
        this.bladeLength = merged.boundingBox.max.z - merged.boundingBox.min.z;
    }

    get warmObjects(): T.Object3D[] {
        return [this.group, this.chargeGroup];
    }

    get framing() {
        if (!this.group.visible) return;
        if (this.proceduralMode) {
            if (this.proceduralTime > 5.8) return;
            const weight = T.MathUtils.smoothstep(this.proceduralTime, 0, .74) * (1 - T.MathUtils.smoothstep(this.proceduralTime, 4.4, 5.65));
            if (weight > 0) return { center: this.group.position, weight, radius: formationWidth * .44 };
            return;
        }
        if (this.videoMaterial.map !== this.opening.texture) return;
        const time = this.opening.video.currentTime;
        const weight = T.MathUtils.smoothstep(time, 0, .74) * (1 - T.MathUtils.smoothstep(time, 4.4, 5.65));
        if (weight > 0) return { center: this.group.position, weight, radius: formationWidth * .44 };
    }

    start(position: T.Vector3) {
        this.clear();
        this.groundY = position.y;
        this.group.position.copy(position);
        this.group.position.y += formationHeight;
        this.sampleBeamOrigin = true;
        this.burstAge = 0;
        this.mesh.scale.setScalar(.18);
        if (this.proceduralMode) {
            this.mesh.material = this.fallbackMaterial;
            this.proceduralTime = 0;
            this.fallbackMaterial.uniforms.uOpacity.value = 0;
            this.group.visible = true;
            return;
        }
        this.mesh.material = this.videoMaterial;
        this.videoMaterial.opacity = 0;
        this.phase = this.opening;
        this.opening.video.currentTime = 0;
        if (this.loop.video.preload === 'none') this.loop.video.preload = 'auto';
        this.play();
    }

    private opened = () => {
        if (this.phase !== this.opening || !this.opening.video.ended) return;
        this.phase = this.loop;
        this.loop.video.currentTime = 0;
        this.play();
    };

    private play() {
        const phase = this.phase;
        if (!phase || this.paused) return;
        const playback = ++this.playback;
        void phase.video.play().then(() => {
            if (playback !== this.playback) return;
            this.videoMaterial.map = phase.texture;
            if (phase === this.loop) this.mesh.scale.setScalar(1);
            this.group.visible = true;
        }, () => {
            if (playback !== this.playback) return;
            // Seamlessly switch to procedural shader array if WebM playback fails on this browser.
            this.activateProceduralFallback();
        });
    }

    private activateProceduralFallback() {
        this.proceduralMode = true;
        this.opening.video.pause();
        this.loop.video.pause();
        this.phase = undefined;
        this.mesh.material = this.fallbackMaterial;
        this.proceduralTime = 0;
        this.group.visible = true;
    }

    private mediaError = (event: Event) => {
        const video = this.phase?.video;
        if (video && event.currentTarget === video && video.error) {
            this.activateProceduralFallback();
        }
    };

    private fail(error: unknown) {
        this.clear();
        this.onError(error);
    }

    setPaused(paused: boolean) {
        if (paused === this.paused) return;
        this.paused = paused;
        if (paused) {
            this.playback++;
            this.phase?.video.pause();
        } else if (this.phase === this.opening && this.opening.video.ended) {
            this.opened();
        } else {
            this.play();
        }
    }

    updateCharge(dt: number, raisingTime?: number) {
        this.chargeTime += dt;
        const charging = raisingTime !== undefined;
        if (this.burstAge >= 0) {
            this.burstAge += dt;
            if (this.burstAge > .42) this.burstAge = -1;
        }
        const orbAlpha = charging
            ? T.MathUtils.smoothstep(raisingTime, 0.14, 0.54) * (1 - T.MathUtils.smoothstep(raisingTime, 0.85, 1.25))
            : this.burstAge >= 0
                ? 1 - this.burstAge / .42
                : 0;
        if (orbAlpha < 0.01 || !this.tip) {
            this.currentOrbAlpha = 0;
            this.chargeGroup.visible = false;
            return;
        }
        this.currentOrbAlpha = orbAlpha;
        this.chargeGroup.visible = true;
        this.tip.getWorldPosition(this.tipOrb.position);
        const pulse = .65 + .45 * orbAlpha + (this.burstAge >= 0 ? Math.exp(-this.burstAge * 8) * .55 : 0);
        this.tipOrb.scale.setScalar(pulse);
        this.tipOrb.material.uniforms.uTime.value = this.chargeTime;
        this.tipOrb.material.uniforms.uOpacity.value = orbAlpha;
    }

    update(dt: number) {
        if (this.sampleBeamOrigin) {
            this.sampleBeamOrigin = false;
            this.beamOrigin.set(0, 2.2 - formationHeight, 0);
            if (this.tip) this.tip.getWorldPosition(this.beamOrigin).sub(this.group.position);
        }
        if (!this.group.visible) return;
        let time = 0;
        let opacity = 1;
        if (this.proceduralMode) {
            if (!this.paused) this.proceduralTime += dt;
            const totalDuration = 6 + loopDuration;
            if (this.proceduralTime >= totalDuration) {
                this.clear();
                return;
            }
            time = this.proceduralTime;
            opacity = time < 6 ? T.MathUtils.smoothstep(time, 0, .24)
                : T.MathUtils.clamp((totalDuration - time) / .7, 0, 1);
            this.fallbackMaterial.uniforms.uTime.value = time;
            this.fallbackMaterial.uniforms.uOpacity.value = opacity;
        } else {
            const opening = this.videoMaterial.map === this.opening.texture;
            if (!opening) {
                if (!this.loop.video.paused && this.loop.video.readyState >= this.loop.video.HAVE_FUTURE_DATA)
                    this.loopAge += dt;
                if (this.loopAge >= loopDuration) {
                    this.clear();
                    return;
                }
            }
            time = opening ? this.opening.video.currentTime : this.opening.video.duration + this.loopAge;
            opacity = opening ? T.MathUtils.smoothstep(time, 0, .24)
                : T.MathUtils.clamp((loopDuration - this.loopAge) / .7, 0, 1);
            this.videoMaterial.opacity = opacity;
        }
        const expansion = T.MathUtils.smoothstep(time, 0, .76);
        this.mesh.scale.setScalar(.18 + .82 * expansion);
        this.currentOpacity = opacity;
        this.skyMotes.material.uniforms.uTime.value = time;
        this.skyMotes.material.uniforms.uOpacity.value = opacity * T.MathUtils.smoothstep(time, .45, 1.25);
        this.updateRain(time, opacity);
        this.updateBeam(time);
    }

    private updateBeam(time: number) {
        const alpha = T.MathUtils.smoothstep(time, 0, .12) * (1 - T.MathUtils.smoothstep(time, .64, 1.65));
        this.currentBeamAlpha = alpha;
        this.beam.visible = this.beamCore.visible = alpha > 0;
        if (!this.beam.visible) return;
        const axis = this.placement.position.copy(this.beamOrigin).negate();
        const reach = T.MathUtils.smoothstep(time, 0, .20);
        const len = axis.length() * reach;
        const mid = this.beam.position.copy(this.beamOrigin).addScaledVector(axis, reach * .5);
        this.beamCore.position.copy(mid);
        const radius = .24 + .16 * alpha;
        this.beam.scale.set(radius, len, radius);
        this.beamCore.scale.set(radius * .42, len, radius * .42);
        this.beam.quaternion.setFromUnitVectors(up, axis.normalize());
        this.beamCore.quaternion.copy(this.beam.quaternion);
        this.beam.material.uniforms.uTime.value = time;
        this.beam.material.uniforms.uOpacity.value = alpha;
        this.beamCore.material.uniforms.uTime.value = time;
        this.beamCore.material.uniforms.uOpacity.value = alpha * .95;
    }

    private spawnWave(wave: number, start: number) {
        const angleOffset = wave * 2.39996;
        const sky = this.group.position;
        const swordsPerWave = wave < openingWaveCount ? openingSwordsPerWave : sustainedSwordsPerWave;
        for (let i = 0; i < swordsPerWave; i++) {
            const angle = angleOffset + (i + Math.random() * .68) * 2 * Math.PI / swordsPerWave;
            const radius = 3 + 13.6 * Math.sqrt(Math.random());
            const x = radius * Math.cos(angle);
            const z = radius * Math.sin(angle);
            const size = 2.25 + Math.random() * .60;
            const top = -.24 - this.tipOffset * size;
            // Each sword falls vertically, so a single surface probe gives its entire collision result.
            const surface = this.surfaceAt(sky.x + x, sky.z + z, sky.y + top);
            const ground = surface.height - sky.y;
            const distance = top - ground;
            if (distance < .6) continue;
            const flight = T.MathUtils.clamp(Math.sqrt(distance / 16) * (.45 + Math.random() * .14), .25, maxFallTime);
            this.rain.push({ x, z, top, ground, water: surface.water, size, yaw: angle + .3, start: start + waveStagger * i / swordsPerWave, flight, struck: new Set() });
        }
    }

    private updateRain(time: number, opacity: number) {
        if (!this.blades.length) return;
        const firstLiveWave = Math.ceil((time - rainStart - longestLife) / waveInterval);
        this.nextWave = Math.max(this.nextWave, firstLiveWave);
        while (this.nextWave < waveCount) {
            const start = rainStart + this.nextWave * waveInterval;
            if (start > time) break;
            this.spawnWave(this.nextWave++, start);
        }

        const placement = this.placement;
        this.rainFx.clear();
        let active = 0, swordCount = 0;
        for (const drop of this.rain) {
            const age = time - drop.start;
            const landedFor = age - drop.flight;
            if (age < 0) {
                this.rain[active++] = drop;
                continue;
            }

            const progress = Math.min(age / drop.flight, 1);
            const fall = progress * (.36 + .64 * progress);
            const fallingTip = T.MathUtils.lerp(drop.top, drop.ground, fall);
            const previousTip = drop.tip ?? drop.top;
            if (fallingTip < previousTip) {
                const sky = this.group.position;
                drop.tip = fallingTip;
                this.onContact?.({
                    x: sky.x + drop.x, z: sky.z + drop.z,
                    fromY: sky.y + previousTip, toY: sky.y + fallingTip,
                    landed: progress === 1, struck: drop.struck,
                });
            }
            if (landedFor >= embeddedTime) continue;
            this.rain[active++] = drop;
            const sink = T.MathUtils.smoothstep(landedFor, 0, .105) * this.bladeLength * drop.size * .5;
            const size = drop.size * (1 - T.MathUtils.smoothstep(landedFor, .39, embeddedTime));
            const tipY = fallingTip - sink;
            const gripY = tipY + this.tipOffset * size;
            placement.position.set(drop.x, gripY, drop.z);
            placement.quaternion.setFromAxisAngle(up, drop.yaw).multiply(this.bladeDown);
            placement.scale.setScalar(size);
            placement.updateMatrix();
            for (const {instances, local} of this.blades)
                instances.setMatrixAt(swordCount, this.bladeMatrix.copy(placement.matrix).multiply(local));
            swordCount++;

            if (landedFor < 0) {
                const trail = Math.min(6.2, drop.top - tipY);
                const width = (.135 + .038 * progress) * size;
                this.rainFx.trail(drop.x, gripY + .16, drop.z, drop.yaw, trail, width, opacity);
                if (age < .28) this.rainFx.portal?.(drop.x, -.12, drop.z, drop.yaw, age, opacity);
            } else {
                this.rainFx.impact(drop.x, drop.ground, drop.z, drop.yaw, landedFor, opacity, drop.water);
            }
        }
        this.rain.length = active;

        for (const {instances} of this.blades) {
            instances.count = swordCount;
            instances.instanceMatrix.needsUpdate = true;
        }
        this.rainFx.upload();
    }

    collectLights(pool: SpellLightPool) {
        // 1) Spirit flare on raised sword tip during opening charge.
        if (this.chargeGroup.visible && this.currentOrbAlpha > 0.02) {
            const p = this.tipOrb.position;
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0x4ceaff,
                intensity: 3.8 * this.currentOrbAlpha,
                distance: 11,
                priority: 72,
                castShadow: false,
            });
        }
        // 2) Active Sword Array: soft cyan domain light over the battlefield + overhead array glow.
        if (this.group.visible && this.currentOpacity > 0.02) {
            const p = this.group.position;
            const pulse = 0.92 + 0.08 * Math.sin(this.chargeTime * 7.5);
            pool.emit({
                x: p.x,
                y: this.groundY + 6.5,
                z: p.z,
                color: 0x38e2ff,
                intensity: (34 + 14 * this.currentBeamAlpha) * this.currentOpacity * pulse,
                distance: 28,
                priority: 95,
                castShadow: false,
            });
            pool.emit({
                x: p.x,
                y: p.y - 2.0,
                z: p.z,
                color: 0x52eeff,
                intensity: 54 * this.currentOpacity,
                distance: 32,
                priority: 55,
                castShadow: false,
            });
        }
    }

    clear() {
        this.playback++;
        this.currentOpacity = 0;
        this.currentBeamAlpha = 0;
        this.currentOrbAlpha = 0;
        this.opening.video.pause();
        this.loop.video.pause();
        this.phase = undefined;
        this.loopAge = 0;
        this.proceduralTime = 0;
        this.nextWave = 0;
        this.rain.length = 0;
        this.group.visible = false;
        this.sampleBeamOrigin = false;
        this.burstAge = -1;
        this.chargeGroup.visible = false;
        for (const {instances} of this.blades) instances.count = 0;
        this.rainFx.clear();
    }

    dispose() {
        this.clear();
        this.opening.video.removeEventListener('ended', this.opened);
        for (const {video, texture} of [this.opening, this.loop]) {
            video.removeEventListener('error', this.mediaError);
            texture.dispose();
            video.removeAttribute('src');
            video.load();
        }
        this.group.removeFromParent();
        this.mesh.geometry.dispose();
        this.videoMaterial.dispose();
        this.fallbackMaterial.dispose();
        for (const {instances, ownsGeometry, ownsMaterial} of this.blades) {
            instances.dispose();
            if (ownsGeometry) instances.geometry.dispose();
            if (ownsMaterial) (instances.material as T.Material).dispose();
        }
        this.rainFx.dispose();
        this.beam.material.dispose();
        this.beamCore.material.dispose();
        this.lightGeometry.dispose();
        this.skyMotes.geometry.dispose();
        this.skyMotes.material.dispose();
        this.chargeGroup.removeFromParent();
        this.tipOrb.geometry.dispose();
        this.tipOrb.material.dispose();
    }
}
