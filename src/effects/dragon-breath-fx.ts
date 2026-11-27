import * as THREE from 'three';

export type DragonBreathEventName = 'breath_charge' | 'breath_start' | 'breath_end';

export interface DragonBreathEvent {
    name: DragonBreathEventName;
    frame: number;
    timeSec: number;
    durationSec: number;
}

/**
 * Decoupled animation-event timeline matching output/dragon_breath/breath_events.json
 * (96 frames @ 24 fps = 4.0 s).
 */
export const DRAGON_BREATH_EVENTS: readonly DragonBreathEvent[] = [
    { name: 'breath_charge', frame: 10, timeSec: 10 / 24, durationSec: 0.65 },
    { name: 'breath_start',  frame: 26, timeSec: 26 / 24, durationSec: 1.75 },
    { name: 'breath_end',    frame: 68, timeSec: 68 / 24, durationSec: 0.40 },
];

interface FlameParticle {
    active: boolean;
    age: number;
    life: number;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    sizeStart: number;
    sizeEnd: number;
    rot: number;
    rotSpeed: number;
    heat: number; // 1 = white-gold core, 0 = dark crimson smoke
}

function createAnimeFlameTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.clearRect(0, 0, size, size);
        const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 58);
        g.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
        g.addColorStop(0.32, 'rgba(255, 210, 95, 0.92)');
        g.addColorStop(0.65, 'rgba(255, 95, 20, 0.58)');
        g.addColorStop(0.88, 'rgba(140, 24, 10, 0.22)');
        g.addColorStop(1.0, 'rgba(40, 12, 8, 0.0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(64, 64, 58, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

const FLAME_VERT = /* glsl */ `
    attribute float aSize;
    attribute float aAlpha;
    attribute float aRot;
    attribute float aHeat;
    varying float vAlpha;
    varying float vRot;
    varying float vHeat;
    uniform float uPixelRatio;

    void main() {
        vAlpha = aAlpha;
        vRot = aRot;
        vHeat = aHeat;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float dist = max(0.4, -mvPosition.z);
        gl_PointSize = aSize * uPixelRatio * (340.0 / dist);
    }
`;

const FLAME_FRAG = /* glsl */ `
    uniform sampler2D uMap;
    varying float vAlpha;
    varying float vRot;
    varying float vHeat;

    void main() {
        if (vAlpha <= 0.002) discard;
        vec2 uv = gl_PointCoord - 0.5;
        float c = cos(vRot);
        float s = sin(vRot);
        vec2 ruv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
        vec4 tex = texture2D(uMap, ruv);
        // Anime fire color ramp: white-gold core -> vivid orange -> crimson -> dark soot
        vec3 soot   = vec3(0.16, 0.08, 0.06);
        vec3 red    = vec3(0.95, 0.22, 0.04);
        vec3 orange = vec3(1.00, 0.62, 0.10);
        vec3 core   = vec3(1.00, 0.98, 0.85);
        vec3 col = mix(soot, red, smoothstep(0.0, 0.35, vHeat));
        col = mix(col, orange, smoothstep(0.30, 0.70, vHeat));
        col = mix(col, core, smoothstep(0.68, 1.00, vHeat));
        float alpha = tex.a * vAlpha;
        if (alpha <= 0.005) discard;
        gl_FragColor = vec4(col, alpha);
    }
`;

/**
 * Decoupled anime-style dragon fire-breath VFX for real-time Three.js rendering:
 * - Emits billowing additive flame stream from the dragon's Head/Mouth world position & forward aim
 * - Skims and deflects along the ground plane (y = groundY) to create a sweeping scorched fire wave
 * - Triggered by Dragon_Low_Flight_Breath animation time events
 */
export class DragonBreathFX {
    readonly group = new THREE.Group();
    private readonly tex: THREE.CanvasTexture;
    private readonly geo: THREE.BufferGeometry;
    private readonly mat: THREE.ShaderMaterial;
    private readonly points: THREE.Points;
    private readonly maxParticles = 260;
    private readonly particles: FlameParticle[] = [];
    private readonly posArr: Float32Array;
    private readonly sizeArr: Float32Array;
    private readonly alphaArr: Float32Array;
    private readonly rotArr: Float32Array;
    private readonly heatArr: Float32Array;

    private emitting = false;
    private charging = false;
    private emitAccum = 0;

    constructor(scene: THREE.Scene, pixelRatio = 1) {
        this.group.name = 'DragonBreathFX';
        scene.add(this.group);

        this.tex = createAnimeFlameTexture();
        this.posArr = new Float32Array(this.maxParticles * 3);
        this.sizeArr = new Float32Array(this.maxParticles);
        this.alphaArr = new Float32Array(this.maxParticles);
        this.rotArr = new Float32Array(this.maxParticles);
        this.heatArr = new Float32Array(this.maxParticles);

        for (let i = 0; i < this.maxParticles; i++) {
            this.particles.push({
                active: false,
                age: 0,
                life: 0.6,
                pos: new THREE.Vector3(),
                vel: new THREE.Vector3(),
                sizeStart: 0.2,
                sizeEnd: 1.0,
                rot: 0,
                rotSpeed: 0,
                heat: 1,
            });
        }

        this.geo = new THREE.BufferGeometry();
        this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
        this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1));
        this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1));
        this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rotArr, 1));
        this.geo.setAttribute('aHeat', new THREE.BufferAttribute(this.heatArr, 1));

        this.mat = new THREE.ShaderMaterial({
            vertexShader: FLAME_VERT,
            fragmentShader: FLAME_FRAG,
            uniforms: {
                uMap: { value: this.tex },
                uPixelRatio: { value: Math.min(2, pixelRatio) },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.points = new THREE.Points(this.geo, this.mat);
        this.points.frustumCulled = false;
        this.group.add(this.points);
    }

    /** Sync active charge / breath stream state directly from AnimationAction.time */
    syncWithAnimationTime(animTimeSec: number): void {
        const chargeStart = DRAGON_BREATH_EVENTS[0].timeSec;
        const fireStart = DRAGON_BREATH_EVENTS[1].timeSec;
        const fireEnd = DRAGON_BREATH_EVENTS[2].timeSec;
        this.charging = animTimeSec >= chargeStart && animTimeSec < fireStart;
        this.emitting = animTimeSec >= fireStart && animTimeSec <= fireEnd;
    }

    setEmitting(active: boolean): void {
        this.emitting = active;
    }

    update(
        dt: number,
        mouthWorldPos: THREE.Vector3,
        mouthAimDir: THREE.Vector3,
        groundY = 0,
        worldScale = 1.0,
    ): void {
        const cdt = Math.min(dt, 0.05);

        // Emit subtle mouth charge sparks during inhale
        if (this.charging) {
            this.emitAccum += cdt * 28;
            while (this.emitAccum >= 1) {
                this.emitAccum -= 1;
                this.spawnParticle(mouthWorldPos, mouthAimDir, true, worldScale);
            }
        } else if (this.emitting) {
            // High-density billowing dragon flame stream
            this.emitAccum += cdt * 150;
            while (this.emitAccum >= 1) {
                this.emitAccum -= 1;
                this.spawnParticle(mouthWorldPos, mouthAimDir, false, worldScale);
            }
        }

        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.particles[i];
            if (!p.active) {
                this.alphaArr[i] = 0;
                this.sizeArr[i] = 0;
                continue;
            }
            p.age += cdt;
            if (p.age >= p.life) {
                p.active = false;
                this.alphaArr[i] = 0;
                this.sizeArr[i] = 0;
                continue;
            }
            const u = p.age / p.life;
            p.pos.addScaledVector(p.vel, cdt);
            p.vel.multiplyScalar(Math.exp(-1.5 * cdt));
            // Deflect & billow along ground plane when flame strikes ground
            if (p.pos.y < groundY + 0.08 * worldScale) {
                p.pos.y = groundY + 0.08 * worldScale;
                p.vel.y = Math.abs(p.vel.y) * 0.25 + 0.45 * worldScale;
                p.vel.x *= 1.02;
                p.vel.z *= 1.02;
            } else {
                p.vel.y += 0.65 * worldScale * cdt; // Hot air buoyancy
            }
            p.rot += p.rotSpeed * cdt;

            const env = Math.min(1.0, u / 0.12) * Math.pow(1.0 - u, 1.35);
            this.posArr[i * 3] = p.pos.x;
            this.posArr[i * 3 + 1] = p.pos.y;
            this.posArr[i * 3 + 2] = p.pos.z;
            this.sizeArr[i] = p.sizeStart + (p.sizeEnd - p.sizeStart) * Math.pow(u, 0.6);
            this.alphaArr[i] = env * 0.85;
            this.rotArr[i] = p.rot;
            this.heatArr[i] = Math.max(0.0, p.heat * (1.0 - u * 0.92));
        }

        this.geo.attributes.position.needsUpdate = true;
        this.geo.attributes.aSize.needsUpdate = true;
        this.geo.attributes.aAlpha.needsUpdate = true;
        this.geo.attributes.aRot.needsUpdate = true;
        this.geo.attributes.aHeat.needsUpdate = true;
    }

    private spawnParticle(origin: THREE.Vector3, aimDir: THREE.Vector3, isCharge: boolean, scale: number): void {
        for (const p of this.particles) {
            if (p.active) continue;
            p.active = true;
            p.age = 0;
            const spread = isCharge ? 0.35 : 0.16;
            const dir = aimDir.clone().normalize();
            dir.x += (Math.random() - 0.5) * spread;
            dir.y += (Math.random() - 0.5) * spread;
            dir.z += (Math.random() - 0.5) * spread;
            dir.normalize();

            if (isCharge) {
                p.life = 0.22 + Math.random() * 0.18;
                p.pos.copy(origin).addScaledVector(dir, (Math.random() - 0.3) * 0.08 * scale);
                p.vel.copy(dir).multiplyScalar((0.4 + Math.random() * 0.5) * scale);
                p.sizeStart = 0.14 * scale;
                p.sizeEnd = 0.32 * scale;
                p.heat = 0.95;
            } else {
                p.life = 0.52 + Math.random() * 0.38;
                p.pos.copy(origin);
                p.vel.copy(dir).multiplyScalar((5.2 + Math.random() * 2.4) * scale);
                p.sizeStart = (0.20 + Math.random() * 0.12) * scale;
                p.sizeEnd = (1.15 + Math.random() * 0.65) * scale;
                p.heat = 0.85 + Math.random() * 0.15;
            }
            p.rot = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 4.0;
            break;
        }
    }

    dispose(): void {
        this.tex.dispose();
        this.geo.dispose();
        this.mat.dispose();
        this.group.removeFromParent();
    }
}
