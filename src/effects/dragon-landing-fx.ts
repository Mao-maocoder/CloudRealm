import * as THREE from 'three';

export type DragonLandingEventName =
    | 'wing_brake_gust'
    | 'hind_foot_touchdown'
    | 'front_foot_impact'
    | 'wing_settle_gust';

export interface DragonLandingEvent {
    name: DragonLandingEventName;
    frame: number;
    timeSec: number;
    localOffset: [number, number, number];
    intensity: number;
}

/**
 * Decoupled animation-event timeline matching output/dragon_landing/landing_events.json
 * (120 frames @ 24 fps = 5.0 s). Triggered from Three.js AnimationAction.time without
 * baking any 3D sphere smoke geometry into the GLB.
 */
export const DRAGON_LANDING_EVENTS: readonly DragonLandingEvent[] = [
    { name: 'wing_brake_gust',     frame: 28, timeSec: 28 / 24, localOffset: [0.0, 0.0,  0.22], intensity: 0.65 },
    { name: 'hind_foot_touchdown', frame: 42, timeSec: 42 / 24, localOffset: [0.0, 0.0,  0.08], intensity: 0.55 },
    { name: 'front_foot_impact',   frame: 47, timeSec: 47 / 24, localOffset: [0.0, 0.0, -0.16], intensity: 1.00 },
    { name: 'wing_settle_gust',    frame: 53, timeSec: 53 / 24, localOffset: [0.0, 0.0, -0.05], intensity: 0.45 },
];

interface DustParticle {
    active: boolean;
    age: number;
    life: number;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    drag: number;
    sizeStart: number;
    sizeEnd: number;
    rot: number;
    rotSpeed: number;
    opacity: number;
    warmth: number;
}

interface PebbleParticle {
    active: boolean;
    age: number;
    life: number;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    rot: THREE.Euler;
    rotVel: THREE.Vector3;
    baseScale: number;
    groundY: number;
    bounces: number;
}

interface GustRing {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    age: number;
    life: number;
    maxRadius: number;
    intensity: number;
}

function createAnimeDustTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, size, size);
        // Layered stylized anime smoke lobes (soft outer feather + crisp cel-like core)
        const lobes = [
            { x: 64, y: 66, r: 44, a: 0.55 },
            { x: 46, y: 60, r: 30, a: 0.50 },
            { x: 84, y: 62, r: 28, a: 0.48 },
            { x: 62, y: 46, r: 30, a: 0.45 },
            { x: 56, y: 76, r: 26, a: 0.42 },
            { x: 76, y: 74, r: 24, a: 0.40 },
        ];
        for (const l of lobes) {
            const g = ctx.createRadialGradient(l.x, l.y, l.r * 0.12, l.x, l.y, l.r);
            g.addColorStop(0.0, `rgba(255, 250, 240, ${l.a})`);
            g.addColorStop(0.58, `rgba(225, 214, 196, ${l.a * 0.72})`);
            g.addColorStop(0.85, `rgba(182, 168, 148, ${l.a * 0.28})`);
            g.addColorStop(1.0, 'rgba(160, 148, 130, 0.0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

const DUST_VERT = /* glsl */ `
    attribute float aSize;
    attribute float aAlpha;
    attribute float aRot;
    attribute float aWarmth;
    varying float vAlpha;
    varying float vRot;
    varying float vWarmth;
    uniform float uPixelRatio;

    void main() {
        vAlpha = aAlpha;
        vRot = aRot;
        vWarmth = aWarmth;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float dist = max(0.5, -mvPosition.z);
        gl_PointSize = aSize * uPixelRatio * (320.0 / dist);
    }
`;

const DUST_FRAG = /* glsl */ `
    uniform sampler2D uMap;
    varying float vAlpha;
    varying float vRot;
    varying float vWarmth;

    void main() {
        if (vAlpha <= 0.002) discard;
        vec2 uv = gl_PointCoord - 0.5;
        float c = cos(vRot);
        float s = sin(vRot);
        vec2 ruv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
        vec4 tex = texture2D(uMap, ruv);
        // Subtle anime cel-shading ramp: warm cream highlight on upper half, dusty shadow near ground
        float cel = smoothstep(0.18, 0.82, 1.0 - gl_PointCoord.y);
        vec3 shadowCol = mix(vec3(0.56, 0.52, 0.46), vec3(0.66, 0.58, 0.48), vWarmth);
        vec3 litCol    = mix(vec3(0.92, 0.89, 0.83), vec3(0.98, 0.92, 0.82), vWarmth);
        vec3 col = mix(shadowCol, litCol, cel);
        float alpha = tex.a * vAlpha;
        if (alpha <= 0.005) discard;
        gl_FragColor = vec4(col, alpha);
    }
`;

const GUST_VERT = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const GUST_FRAG = /* glsl */ `
    uniform float uProgress;
    uniform float uIntensity;
    varying vec2 vUv;

    void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float angle = atan(p.y, p.x);

        // Expanding low ground-skimming wind ring with stylized radial streaks
        float ringRadius = mix(0.18, 0.94, pow(uProgress, 0.65));
        float ringWidth  = mix(0.16, 0.07, uProgress);
        float band = exp(-pow((r - ringRadius) / ringWidth, 2.0));
        float streaks = 0.65 + 0.35 * sin(angle * 14.0 + uProgress * 4.0) * sin(angle * 7.0 - uProgress * 2.0);
        float fade = smoothstep(0.0, 0.14, uProgress) * (1.0 - smoothstep(0.35, 1.0, uProgress));
        float alpha = band * streaks * fade * 0.42 * uIntensity;
        if (alpha <= 0.005) discard;

        vec3 col = mix(vec3(0.84, 0.82, 0.78), vec3(0.98, 0.97, 0.94), band);
        gl_FragColor = vec4(col, alpha);
    }
`;

/**
 * Decoupled anime-style dragon landing VFX for real-time Three.js rendering:
 * - Low-profile radial billboard dust particles (custom GLSL shader + procedural smoke texture)
 * - Ground-skimming wing braking air-gust rings (custom GLSL shader)
 * - Small ballistic bouncing rock chips (InstancedMesh)
 * Zero 3D sphere clouds.
 */
export class DragonLandingFX {
    readonly group = new THREE.Group();
    private readonly dustTex: THREE.CanvasTexture;
    private readonly dustGeo: THREE.BufferGeometry;
    private readonly dustMat: THREE.ShaderMaterial;
    private readonly dustPoints: THREE.Points;
    private readonly maxDust = 160;
    private readonly dust: DustParticle[] = [];
    private readonly dustPosArr: Float32Array;
    private readonly dustSizeArr: Float32Array;
    private readonly dustAlphaArr: Float32Array;
    private readonly dustRotArr: Float32Array;
    private readonly dustWarmthArr: Float32Array;

    private readonly maxPebbles = 28;
    private readonly pebbles: PebbleParticle[] = [];
    private readonly pebbleMesh: THREE.InstancedMesh;
    private readonly pebbleGeo: THREE.BufferGeometry;
    private readonly pebbleMat: THREE.MeshStandardMaterial;
    private readonly dummy = new THREE.Object3D();

    private readonly gustGeo: THREE.PlaneGeometry;
    private readonly gusts: GustRing[] = [];
    private lastAnimTime = -1;

    constructor(scene: THREE.Scene, pixelRatio = 1) {
        this.group.name = 'DragonLandingFX';
        scene.add(this.group);

        // 1. Billboard anime dust particle system
        this.dustTex = createAnimeDustTexture();
        this.dustPosArr = new Float32Array(this.maxDust * 3);
        this.dustSizeArr = new Float32Array(this.maxDust);
        this.dustAlphaArr = new Float32Array(this.maxDust);
        this.dustRotArr = new Float32Array(this.maxDust);
        this.dustWarmthArr = new Float32Array(this.maxDust);

        for (let i = 0; i < this.maxDust; i++) {
            this.dust.push({
                active: false,
                age: 0,
                life: 1,
                pos: new THREE.Vector3(),
                vel: new THREE.Vector3(),
                drag: 2.5,
                sizeStart: 0.4,
                sizeEnd: 1.4,
                rot: 0,
                rotSpeed: 0,
                opacity: 0.5,
                warmth: 0.5,
            });
        }

        this.dustGeo = new THREE.BufferGeometry();
        this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPosArr, 3));
        this.dustGeo.setAttribute('aSize', new THREE.BufferAttribute(this.dustSizeArr, 1));
        this.dustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.dustAlphaArr, 1));
        this.dustGeo.setAttribute('aRot', new THREE.BufferAttribute(this.dustRotArr, 1));
        this.dustGeo.setAttribute('aWarmth', new THREE.BufferAttribute(this.dustWarmthArr, 1));

        this.dustMat = new THREE.ShaderMaterial({
            vertexShader: DUST_VERT,
            fragmentShader: DUST_FRAG,
            uniforms: {
                uMap: { value: this.dustTex },
                uPixelRatio: { value: Math.min(2, pixelRatio) },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
        });

        this.dustPoints = new THREE.Points(this.dustGeo, this.dustMat);
        this.dustPoints.frustumCulled = false;
        this.group.add(this.dustPoints);

        // 2. Angular low-poly rock chips (InstancedMesh, ballistic arc + bounce)
        this.pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
        this.pebbleMat = new THREE.MeshStandardMaterial({
            color: 0x6e675d,
            roughness: 0.92,
            metalness: 0.05,
        });
        this.pebbleMesh = new THREE.InstancedMesh(this.pebbleGeo, this.pebbleMat, this.maxPebbles);
        this.pebbleMesh.frustumCulled = false;
        for (let i = 0; i < this.maxPebbles; i++) {
            this.pebbles.push({
                active: false,
                age: 0,
                life: 1,
                pos: new THREE.Vector3(),
                vel: new THREE.Vector3(),
                rot: new THREE.Euler(),
                rotVel: new THREE.Vector3(),
                baseScale: 0.04,
                groundY: 0,
                bounces: 0,
            });
            this.dummy.scale.setScalar(0);
            this.dummy.updateMatrix();
            this.pebbleMesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.pebbleMesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.pebbleMesh);

        // 3. Shared ground-skimming air gust ring geometry
        this.gustGeo = new THREE.PlaneGeometry(1, 1);
        this.gustGeo.rotateX(-Math.PI / 2);
    }

    /**
     * Trigger effects automatically when a Three.js AnimationAction plays Dragon_Landing.
     * Resets cleanly when animation loops or rewinds.
     */
    syncWithAnimationTime(
        animTimeSec: number,
        dragonWorldPos: THREE.Vector3,
        dragonYawRad: number,
        worldScale = 1.0,
    ): void {
        if (this.lastAnimTime < 0 || animTimeSec < this.lastAnimTime) {
            this.lastAnimTime = Math.max(0, animTimeSec - 1e-4);
        }
        const cosY = Math.cos(dragonYawRad);
        const sinY = Math.sin(dragonYawRad);

        for (const ev of DRAGON_LANDING_EVENTS) {
            if (ev.timeSec > this.lastAnimTime && ev.timeSec <= animTimeSec) {
                const lx = ev.localOffset[0] * worldScale;
                const lz = ev.localOffset[2] * worldScale;
                const wx = dragonWorldPos.x + lx * cosY + lz * sinY;
                const wz = dragonWorldPos.z - lx * sinY + lz * cosY;
                const pos = new THREE.Vector3(wx, dragonWorldPos.y, wz);
                this.triggerEvent(ev.name, pos, ev.intensity, worldScale);
            }
        }
        this.lastAnimTime = animTimeSec;
    }

    resetSync(): void {
        this.lastAnimTime = -1;
    }

    triggerEvent(
        eventName: DragonLandingEventName,
        groundPos: THREE.Vector3,
        intensity = 1.0,
        scale = 1.0,
    ): void {
        if (eventName === 'wing_brake_gust' || eventName === 'wing_settle_gust') {
            this.spawnGustRing(groundPos, (eventName === 'wing_brake_gust' ? 2.8 : 2.1) * scale, intensity);
            this.spawnDustRing(groundPos, 16, 0.35 * scale, 1.2 * scale, 0.25 * scale, intensity * 0.55, scale);
            return;
        }
        if (eventName === 'hind_foot_touchdown') {
            this.spawnDustRing(groundPos, 24, 0.16 * scale, 1.0 * scale, 0.22 * scale, intensity * 0.85, scale);
            this.spawnPebbles(groundPos, 7, intensity * 0.75, scale);
            return;
        }
        if (eventName === 'front_foot_impact') {
            // Heavy low-profile radial dust cloud + subtle ground gust + bouncing rock chips
            this.spawnGustRing(groundPos, 2.4 * scale, intensity * 0.8);
            this.spawnDustRing(groundPos, 54, 0.22 * scale, 1.85 * scale, 0.32 * scale, intensity, scale);
            this.spawnPebbles(groundPos, 16, intensity, scale);
        }
    }

    private spawnDustRing(
        origin: THREE.Vector3,
        count: number,
        spawnRadius: number,
        radialSpeed: number,
        upSpeed: number,
        intensity: number,
        scale: number,
    ): void {
        let spawned = 0;
        for (const p of this.dust) {
            if (p.active) continue;
            const angle = (spawned / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
            const r = spawnRadius * (0.6 + Math.random() * 0.7);
            const speed = radialSpeed * (0.65 + Math.random() * 0.65);

            p.active = true;
            p.age = 0;
            p.life = 0.85 + Math.random() * 0.75;
            p.pos.set(
                origin.x + Math.cos(angle) * r,
                origin.y + (0.04 + Math.random() * 0.08) * scale,
                origin.z + Math.sin(angle) * r,
            );
            // Low-profile radial spread hugging the ground!
            p.vel.set(
                Math.cos(angle) * speed,
                upSpeed * (0.25 + Math.random() * 0.55),
                Math.sin(angle) * speed,
            );
            p.drag = 2.2 + Math.random() * 1.1;
            p.sizeStart = (0.24 + Math.random() * 0.18) * scale;
            p.sizeEnd = (0.85 + Math.random() * 0.55) * scale;
            p.rot = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 1.8;
            p.opacity = (0.34 + Math.random() * 0.22) * intensity;
            p.warmth = Math.random();

            spawned++;
            if (spawned >= count) break;
        }
    }

    private spawnPebbles(origin: THREE.Vector3, count: number, intensity: number, scale: number): void {
        let spawned = 0;
        for (const pb of this.pebbles) {
            if (pb.active) continue;
            const angle = Math.random() * Math.PI * 2;
            const r = (0.12 + Math.random() * 0.22) * scale;
            const horiz = (0.6 + Math.random() * 1.2) * intensity * scale;

            pb.active = true;
            pb.age = 0;
            pb.life = 1.1 + Math.random() * 0.55;
            pb.groundY = origin.y + 0.015 * scale;
            pb.pos.set(origin.x + Math.cos(angle) * r, pb.groundY + 0.02 * scale, origin.z + Math.sin(angle) * r);
            pb.vel.set(Math.cos(angle) * horiz, (1.4 + Math.random() * 1.6) * intensity * scale, Math.sin(angle) * horiz);
            pb.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
            pb.rotVel.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
            pb.baseScale = (0.016 + Math.random() * 0.020) * scale;
            pb.bounces = 0;

            spawned++;
            if (spawned >= count) break;
        }
    }

    private spawnGustRing(origin: THREE.Vector3, maxRadius: number, intensity: number): void {
        const mat = new THREE.ShaderMaterial({
            vertexShader: GUST_VERT,
            fragmentShader: GUST_FRAG,
            uniforms: {
                uProgress: { value: 0 },
                uIntensity: { value: intensity },
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(this.gustGeo, mat);
        mesh.position.set(origin.x, origin.y + 0.02, origin.z);
        mesh.scale.setScalar(maxRadius);
        this.group.add(mesh);
        this.gusts.push({ mesh, age: 0, life: 0.65, maxRadius, intensity });
    }

    update(dt: number): void {
        const clampedDt = Math.min(dt, 0.05);

        // Update billboard dust particles
        for (let i = 0; i < this.maxDust; i++) {
            const p = this.dust[i];
            if (!p.active) {
                this.dustAlphaArr[i] = 0;
                this.dustSizeArr[i] = 0;
                continue;
            }
            p.age += clampedDt;
            if (p.age >= p.life) {
                p.active = false;
                this.dustAlphaArr[i] = 0;
                this.dustSizeArr[i] = 0;
                continue;
            }
            const u = p.age / p.life;
            const damp = Math.exp(-p.drag * clampedDt);
            p.vel.x *= damp;
            p.vel.z *= damp;
            p.vel.y *= Math.exp(-1.8 * clampedDt);
            p.pos.addScaledVector(p.vel, clampedDt);
            p.rot += p.rotSpeed * clampedDt * (1.0 - u * 0.6);

            // Fast fade-in, smooth long fade-out as dust expands & dissipates
            const env = Math.min(1.0, u / 0.14) * Math.pow(1.0 - u, 1.45);
            this.dustPosArr[i * 3] = p.pos.x;
            this.dustPosArr[i * 3 + 1] = p.pos.y;
            this.dustPosArr[i * 3 + 2] = p.pos.z;
            this.dustSizeArr[i] = p.sizeStart + (p.sizeEnd - p.sizeStart) * Math.pow(u, 0.55);
            this.dustAlphaArr[i] = p.opacity * env;
            this.dustRotArr[i] = p.rot;
            this.dustWarmthArr[i] = p.warmth;
        }
        this.dustGeo.attributes.position.needsUpdate = true;
        this.dustGeo.attributes.aSize.needsUpdate = true;
        this.dustGeo.attributes.aAlpha.needsUpdate = true;
        this.dustGeo.attributes.aRot.needsUpdate = true;
        this.dustGeo.attributes.aWarmth.needsUpdate = true;

        // Update ballistic pebbles (gravity + 1 ground bounce + gentle fade-out scale)
        const gravity = 9.8;
        let pebblesDirty = false;
        for (let i = 0; i < this.maxPebbles; i++) {
            const pb = this.pebbles[i];
            if (!pb.active) continue;
            pebblesDirty = true;
            pb.age += clampedDt;
            if (pb.age >= pb.life) {
                pb.active = false;
                this.dummy.scale.setScalar(0);
                this.dummy.updateMatrix();
                this.pebbleMesh.setMatrixAt(i, this.dummy.matrix);
                continue;
            }
            pb.vel.y -= gravity * clampedDt;
            pb.pos.addScaledVector(pb.vel, clampedDt);
            if (pb.pos.y <= pb.groundY) {
                pb.pos.y = pb.groundY;
                if (pb.bounces < 1 && Math.abs(pb.vel.y) > 0.35) {
                    pb.vel.y = -pb.vel.y * 0.32;
                    pb.vel.x *= 0.55;
                    pb.vel.z *= 0.55;
                    pb.bounces++;
                } else {
                    pb.vel.set(0, 0, 0);
                    pb.rotVel.multiplyScalar(0.5);
                }
            }
            pb.rot.x += pb.rotVel.x * clampedDt;
            pb.rot.y += pb.rotVel.y * clampedDt;
            pb.rot.z += pb.rotVel.z * clampedDt;

            const u = pb.age / pb.life;
            const shrink = u > 0.72 ? 1.0 - (u - 0.72) / 0.28 : 1.0;
            this.dummy.position.copy(pb.pos);
            this.dummy.rotation.copy(pb.rot);
            this.dummy.scale.set(pb.baseScale * 1.3 * shrink, pb.baseScale * 0.75 * shrink, pb.baseScale * shrink);
            this.dummy.updateMatrix();
            this.pebbleMesh.setMatrixAt(i, this.dummy.matrix);
        }
        if (pebblesDirty) {
            this.pebbleMesh.instanceMatrix.needsUpdate = true;
        }

        // Update ground-skimming air gust rings
        for (let i = this.gusts.length - 1; i >= 0; i--) {
            const g = this.gusts[i];
            g.age += clampedDt;
            if (g.age >= g.life) {
                this.group.remove(g.mesh);
                g.mesh.material.dispose();
                this.gusts.splice(i, 1);
                continue;
            }
            g.mesh.material.uniforms.uProgress.value = g.age / g.life;
        }
    }

    dispose(): void {
        for (const g of this.gusts) {
            this.group.remove(g.mesh);
            g.mesh.material.dispose();
        }
        this.gusts.length = 0;
        this.dustTex.dispose();
        this.dustGeo.dispose();
        this.dustMat.dispose();
        this.pebbleGeo.dispose();
        this.pebbleMat.dispose();
        this.gustGeo.dispose();
        this.group.removeFromParent();
    }
}
