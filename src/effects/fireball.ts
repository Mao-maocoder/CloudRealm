import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { fireballRaiseTime, fireballReleaseTime } from '../player/avatar';
import { FireballImpact } from './fireball-impact';
import { NascentFireball } from './nascent-fireball';
import { fireballAim, fireballArc, fireballGravity, traceFireballWorld, type SampleGround } from './fireball-trajectory';
import type { SpellLightPool } from './spell-lights';

const sealUrl = new URL('../../resource/fireball/Crimson_Flame_Seal_RGBA.png', import.meta.url).href;
const modelUrl = new URL('../../resource/fireball/Flying_Fireball_3D.glb', import.meta.url).href;
const emberCount = 24;
const up = new T.Vector3(0, 1, 0);

export interface FireballLockTarget {
    state: string;
    position: T.Vector3;
    profile: { height: number };
}

interface Projectile {
    object: T.Group;
    mixer: T.AnimationMixer;
    action: T.AnimationAction;
    embers: T.InstancedMesh;
    velocity: T.Vector3;
    duration: number;
    power: number;
    age: number;
    inUse: boolean;
    homing?: FireballLockTarget;
    homingSpeed?: number;
}

function tuneFlameModel(model: GLTF, time: { value: number }) {
    const tuned = new Set<T.Material>();
    model.scene.traverse(object => {
        if (!(object instanceof T.Mesh) || !(object.material instanceof T.MeshStandardMaterial)) return;
        const material = object.material;
        if (tuned.has(material)) return;
        tuned.add(material);
        switch (material.name) {
            case 'White hot fire core':
                // Incandescent white-gold plasma core with molten orange-crimson cracks.
                material.color.set('#ff9933');
                material.toneMapped = false;
                material.customProgramCacheKey = () => 'fireball-core-v1';
                material.onBeforeCompile = shader => {
                    shader.uniforms.fireballTime = time;
                    shader.vertexShader = `varying vec3 fireballPosition;\n` + shader.vertexShader.replace(
                        '#include <project_vertex>', 'fireballPosition = transformed;\n#include <project_vertex>',
                    );
                    shader.fragmentShader = `
                        uniform float fireballTime;
                        varying vec3 fireballPosition;

                        float fireballHash(vec3 p) {
                            p = fract(p * 0.3183099 + 0.17) * 17.0;
                            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                        }

                        float fireballNoise(vec3 p) {
                            vec3 i = floor(p), f = fract(p);
                            f = f * f * (3.0 - 2.0 * f);
                            return mix(
                                mix(mix(fireballHash(i), fireballHash(i + vec3(1,0,0)), f.x),
                                    mix(fireballHash(i + vec3(0,1,0)), fireballHash(i + vec3(1,1,0)), f.x), f.y),
                                mix(mix(fireballHash(i + vec3(0,0,1)), fireballHash(i + vec3(1,0,1)), f.x),
                                    mix(fireballHash(i + vec3(0,1,1)), fireballHash(i + vec3(1,1,1)), f.x), f.y), f.z);
                        }
                    ` + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
                        #include <emissivemap_fragment>
                        vec3 flow = fireballPosition * vec3(7.5, 7.5, 4.5) + vec3(0.0, -1.2, 4.2) * fireballTime;
                        float broad = fireballNoise(flow);
                        float grain = fireballNoise(flow * 2.6 + 0.8 * broad);
                        float plasma = clamp(0.68 * broad + 0.32 * grain, 0.0, 1.0);
                        vec3 crimson = vec3(1.15, 0.22, 0.03);
                        vec3 gold = vec3(1.45, 0.78, 0.16);
                        vec3 whiteHot = vec3(1.65, 1.48, 0.95);
                        totalEmissiveRadiance = mix(crimson, gold, smoothstep(0.18, 0.62, plasma));
                        totalEmissiveRadiance = mix(totalEmissiveRadiance, whiteHot, smoothstep(0.55, 0.90, plasma));
                    `);
                };
                break;
            case 'Rolling flames':
                material.emissiveIntensity = 1.95;
                material.emissive.set('#ffaa38');
                material.color.set('#ff6a1a');
                material.opacity = .88;
                material.alphaTest = .04;
                material.toneMapped = false;
                break;
            case 'Dissolving red wisps':
                material.emissiveIntensity = 1.45;
                material.emissive.set('#ff5c18');
                material.opacity = .85;
                material.alphaTest = .04;
                material.toneMapped = false;
                break;
            case 'Turbulent wake':
                material.emissiveIntensity = 1.75;
                material.emissive.set('#ffbf48');
                material.alphaTest = .04;
                material.toneMapped = false;
                break;
        }
    });
}

function disposeModel(model: GLTF) {
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    const textures = new Set<T.Texture>();
    model.scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of [object.material].flat()) materials.add(material);
    });
    for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
        material.dispose();
    }
    const images = new Set<ImageBitmap>();
    for (const texture of textures) {
        texture.dispose();
        if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image);
    }
    for (const image of images) image.close();
    for (const geometry of geometries) geometry.dispose();
}

function makeCometTailGeometry() {
    // Two crossed tapered ribbons extending along -Z behind the fireball core.
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const segs = 10, length = 3.2;
    for (const rot of [0, Math.PI / 2]) {
        const base = pos.length / 3;
        const c = Math.cos(rot), s = Math.sin(rot);
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const z = .18 - t * length;
            const halfW = .62 * (1 - t * .88) * (.55 + .45 * Math.sin(Math.min(1, t * 2.4) * Math.PI * .5));
            for (const side of [-1, 1]) {
                pos.push(c * side * halfW, s * side * halfW, z);
                uv.push(side < 0 ? 0 : 1, t);
            }
            if (i < segs) {
                const k = base + i * 2;
                idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            }
        }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
}

function makeCometTailMaterial(time: { value: number }) {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        uniforms: { uTime: time },
        vertexShader: `varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            }`,
        fragmentShader: `varying vec2 vUv;
            uniform float uTime;
            float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float n(vec2 p){
                vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
                return mix(mix(h(i), h(i + vec2(1., 0.)), f.x),
                           mix(h(i + vec2(0., 1.)), h(i + 1.), f.x), f.y);
            }
            void main() {
                float across = abs(vUv.x - .5) * 2.;
                float along = vUv.y;
                float scroll = n(vec2(vUv.x * 3.5, along * 5.2 - uTime * 7.5)) * .62
                             + n(vec2(vUv.x * 7.5 + 3.1, along * 11. - uTime * 12.5)) * .38;
                float core = (1. - smoothstep(.0, .95 - along * .25, across + (scroll - .5) * .48));
                float fade = smoothstep(0., .10, along) * pow(1. - along, 1.35);
                float intensity = core * fade * (.55 + .85 * scroll);
                if (intensity < .02) discard;
                vec3 col = mix(vec3(1.15, .24, .03), vec3(1.35, .72, .14), smoothstep(.15, .75, intensity));
                col = mix(col, vec3(1.5, 1.35, .85), smoothstep(.62, .95, intensity) * (1. - along));
                gl_FragColor = vec4(col, intensity * .78);
                #include <colorspace_fragment>
            }`,
    });
    mat.customProgramCacheKey = () => 'fireball-tail-v1';
    return mat;
}

function makeFireHaloMaterial() {
    const mat = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: T.AdditiveBlending,
        vertexShader: `varying vec2 vUv;
            void main() {
                vUv = uv;
                // Camera-facing billboard around the fireball origin.
                vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.);
                mv.xy += (uv - .5) * 2.15;
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `varying vec2 vUv;
            void main() {
                float r = length(vUv - .5) * 2.;
                if (r >= 1.) discard;
                float inner = pow(max(0., 1. - r), 2.6);
                float outer = pow(max(0., 1. - r), 1.45);
                vec3 col = mix(vec3(1.0, .28, .04), vec3(1.35, .95, .42), inner);
                gl_FragColor = vec4(col, outer * .58);
                #include <colorspace_fragment>
            }`,
    });
    mat.customProgramCacheKey = () => 'fireball-halo-v1';
    return mat;
}

export class Fireball {
    private readonly sealGeometry = new T.PlaneGeometry(1, 1);
    private readonly sealMaterial = new T.MeshBasicMaterial({
        transparent: true, side: T.DoubleSide, depthWrite: false, toneMapped: false, forceSinglePass: true,
    });
    private readonly seals = [-1, 1].map(side => ({ side, mesh: new T.Mesh(this.sealGeometry, this.sealMaterial) }));
    private readonly emberGeometry = new T.IcosahedronGeometry(1, 0);
    private readonly emberMaterial = new T.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    private readonly tailGeometry = makeCometTailGeometry();
    private readonly haloGeometry = new T.PlaneGeometry(1, 1);
    private readonly haloMaterial = makeFireHaloMaterial();
    private readonly emberPose = new T.Object3D();
    private readonly emberColor = new T.Color();
    private readonly hotEmber = new T.Color('#fff0a6');
    private readonly coolingEmber = new T.Color('#ff4410');
    private readonly flameTime = { value: 0 };
    private readonly tailMaterial = makeCometTailMaterial(this.flameTime);
    private readonly sealPower = { value: 0 };
    private readonly projectilePool: Projectile[] = [];
    private readonly next = new T.Vector3();
    private readonly steerTo = new T.Vector3();
    private readonly steerDir = new T.Vector3();
    private readonly curDir = new T.Vector3();
    private readonly impact: FireballImpact;
    private readonly nascent: NascentFireball;
    readonly grassScorches;
    private model?: GLTF;
    private loop?: T.AnimationClip;
    private disposed = false;

    get warmObjects(): T.Object3D[] {
        const list: T.Object3D[] = [
            ...this.nascent.warmObjects,
            ...this.impact.warmObjects,
            this.seals[0].mesh,
        ];
        if (this.projectilePool.length > 0) list.push(this.projectilePool[0].object);
        return list;
    }

    constructor(
        private scene: T.Scene,
        private sampleGround: SampleGround,
        private traceCreature: (from: T.Vector3, to: T.Vector3) => number | undefined,
        private blast: (point: T.Vector3, power: number, directHit: boolean, radiusScale?: number) => void,
    ) {
        this.impact = new FireballImpact(scene, sampleGround);
        this.nascent = new NascentFireball(scene, sampleGround, traceCreature, blast, this.impact);
        this.grassScorches = this.impact.grassScorches;
        this.sealMaterial.customProgramCacheKey = () => 'fireball-seal-v1';
        this.sealMaterial.onBeforeCompile = shader => {
            shader.uniforms.sealClock = this.flameTime;
            shader.uniforms.sealPower = this.sealPower;
            shader.fragmentShader = 'uniform float sealClock, sealPower;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
                #ifdef USE_MAP
                    vec2 radial = vMapUv - .5;
                    float r = length(radial);
                    float rim = smoothstep(.27, .39, r) * (1. - smoothstep(.45, .52, r));
                    float angle = atan(radial.y, radial.x);
                    float wave = sin(angle * 13. - sealClock * 5. + r * 28.) + .5 * sin(angle * 31. + sealClock * 6.);
                    vec2 rippleUV = vMapUv + radial * wave * rim * .022;
                    vec4 rune = texture2D(map, rippleUV);
                    float center = 1. - smoothstep(.04, .21, r);
                    float breath = .5 + .5 * sin(sealClock * (5. + 3. * sealPower) - r * 22.);
                    rune.rgb *= 1. + center * breath * (.23 + .61 * sealPower) + rim * wave * .05;
                    diffuseColor *= rune;
                #endif
            `);
        };
        for (const { side, mesh } of this.seals) {
            mesh.name = side < 0 ? 'Crimson Flame Seal Left' : 'Crimson Flame Seal Right';
            mesh.visible = false;
            mesh.renderOrder = 4;
            scene.add(mesh);
        }
    }

    async load() {
        await Promise.all([
            this.impact.load(),
            new T.TextureLoader().loadAsync(sealUrl).then(texture => {
                if (this.disposed) texture.dispose();
                else {
                    texture.colorSpace = T.SRGBColorSpace;
                    this.sealMaterial.map = texture;
                    this.sealMaterial.needsUpdate = true;
                }
            }),
            new GLTFLoader().loadAsync(modelUrl).then(model => {
                const clip = T.AnimationClip.findByName(model.animations, 'Fireball_Loop');
                if (this.disposed || !clip) disposeModel(model);
                if (!clip) throw new Error('Flying_Fireball_3D.glb is missing Fireball_Loop');
                if (this.disposed) return;
                tuneFlameModel(model, this.flameTime);
                this.model = model;
                this.loop = clip;
                // Pre-allocate 4 pooled small fireballs so casting never clones GLTFs or allocates InstancedMeshes mid-frame
                for (let i = 0; i < 4; i++) {
                    const object = new T.Group();
                    object.name = `Flying Fireball ${i}`;
                    object.visible = false;
                    const flame = model.scene.clone();
                    flame.scale.set(.78, .78, 1.48);
                    const tail = new T.Mesh(this.tailGeometry, this.tailMaterial);
                    tail.name = 'Fireball Comet Tail';
                    tail.renderOrder = 4;
                    const halo = new T.Mesh(this.haloGeometry, this.haloMaterial);
                    halo.name = 'Fireball Glow Halo';
                    halo.renderOrder = 5;
                    const embers = new T.InstancedMesh(this.emberGeometry, this.emberMaterial, emberCount);
                    embers.name = 'Trailing Embers';
                    embers.instanceMatrix.setUsage(T.DynamicDrawUsage);
                    embers.frustumCulled = false;
                    embers.renderOrder = 5;
                    object.add(flame, tail, halo, embers);
                    const mixer = new T.AnimationMixer(flame);
                    const action = mixer.clipAction(clip);
                    action.play();
                    mixer.update(0);
                    this.scene.add(object);
                    this.projectilePool.push({
                        object,
                        mixer,
                        action,
                        embers,
                        velocity: new T.Vector3(),
                        duration: 2,
                        power: 0.5,
                        age: 0,
                        inUse: false,
                    });
                }
            }),
        ]);
    }

    updateSeals(head: T.Object3D | undefined, time: number | undefined, heading: number, power: number, nascent = false) {
        if (nascent) {
            for (const { mesh } of this.seals) mesh.visible = false;
            this.nascent.updateCharge(head, time, power);
            return;
        }
        this.nascent.updateCharge(undefined, undefined, 0);
        if (!head || time === undefined || time <= fireballRaiseTime || time >= 1.08 || !this.sealMaterial.map) {
            for (const { mesh } of this.seals) mesh.visible = false;
            return;
        }
        const open = T.MathUtils.smoothstep(time, fireballRaiseTime, .55);
        const close = T.MathUtils.smoothstep(time, .91, 1.08);
        const pulse = T.MathUtils.smoothstep(time, .7, fireballReleaseTime) * (1 - close);
        const energy = this.sealPower.value = Math.max(power, pulse);
        const sin = Math.sin(heading), cos = Math.cos(heading);
        this.sealMaterial.opacity = open * (1 - close) * (.94 + .06 * pulse);
        for (const { side, mesh } of this.seals) {
            const lateral = side * (.83 + .1 * open);
            head.getWorldPosition(mesh.position);
            mesh.position.x += lateral * cos + .14 * sin;
            mesh.position.y += .9 + .11 * open + .1 * pulse;
            mesh.position.z += lateral * sin - .14 * cos;
            mesh.rotation.set(.2, -heading - side * .32, side * (.24 - open * .31 + this.flameTime.value * .68), 'YXZ');
            const breathing = Math.sin(this.flameTime.value * 6 + side * .45) * .045 * energy;
            mesh.scale.setScalar(T.MathUtils.lerp(.35, 1.16, open) + .12 * pulse + breathing - .23 * close);
            mesh.visible = true;
        }
    }

    release(camera: T.Camera, caster: T.Vector3, power: number, lockedTarget?: FireballLockTarget, nascent = false) {
        if (nascent) {
            this.nascent.release(camera, caster, power, lockedTarget);
            return;
        }
        const homing = lockedTarget && lockedTarget.state !== 'Dead' ? lockedTarget : undefined;
        const aim = homing
            ? new T.Vector3(homing.position.x, homing.position.y + homing.profile.height * 0.52, homing.position.z)
            : fireballAim(camera, caster, power, this.sampleGround);
        const landing = this.sampleGround(aim.x, aim.z, aim.y + .3);
        const onGround = !homing && Math.abs(aim.y - landing.height) < .08;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        right.y = 0;
        right.normalize();
        for (const { side, mesh } of this.seals) {
            if (!mesh.visible) continue;
            const target = aim.clone();
            if (onGround) {
                target.addScaledVector(right, side * .56);
                target.y = this.sampleGround(target.x, target.z, aim.y + .48).height - .04;
            }
            this.launch(mesh.position, target, power, homing, homing ? right.clone().multiplyScalar(side * 6.5) : undefined);
        }
    }

    private launch(origin: T.Vector3, target: T.Vector3, power: number, homing?: FireballLockTarget, fanVelocity?: T.Vector3) {
        if (!this.projectilePool.length) return;
        let shot = this.projectilePool.find(p => !p.inUse);
        if (!shot) shot = this.projectilePool[0];
        shot.object.position.copy(origin);
        let velocity: T.Vector3;
        let duration: number;
        let homingSpeed: number | undefined;
        if (homing) {
            // Spirit-guided homing fireball: fans out gracefully from the twin seals then curves directly into the locked beast
            homingSpeed = T.MathUtils.lerp(36, 48, power);
            const dist = origin.distanceTo(target);
            velocity = target.clone().sub(origin).normalize().multiplyScalar(homingSpeed);
            if (fanVelocity) {
                velocity.add(fanVelocity);
                velocity.y += 3.2;
                velocity.normalize().multiplyScalar(homingSpeed);
            }
            duration = Math.max(2.6, dist / homingSpeed + 2.2);
        } else {
            const arc = fireballArc(origin, target, power);
            velocity = arc.velocity;
            duration = arc.duration;
        }
        // The supplied model has its flame core at the origin and its wake along -Z.
        shot.velocity.copy(velocity);
        shot.duration = duration;
        shot.power = power;
        shot.age = 0;
        shot.homing = homing;
        shot.homingSpeed = homingSpeed;
        shot.inUse = true;
        shot.object.lookAt(this.next.copy(origin).add(velocity));
        shot.action.reset().play();
        shot.mixer.update(0);
        shot.object.visible = true;
        this.updateEmbers(shot);
    }

    private updateEmbers({ embers, age }: Projectile) {
        const pose = this.emberPose;
        const ignition = T.MathUtils.smoothstep(age, 0, .11);
        for (let i = 0; i < emberCount; i++) {
            const drift = (i * .618 + age * (2.6 + (i % 5) * .24)) % 1;
            const angle = i * 2.4 + drift * (i % 2 === 0 ? .85 : -.85);
            const radius = (.15 + drift * .36) * (.65 + (i % 4) * .2);
            pose.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius + .44 * drift ** 2,
                -.19 - drift * (2.35 + (i % 3) * .61));
            pose.rotation.set(.18 * Math.sin(angle), -.26 * Math.cos(angle), 0);
            const size = ignition * (1 - drift) * (.032 + (i % 4) * .009);
            pose.scale.set(size, size, size * (4.2 + i % 4));
            pose.updateMatrix();
            embers.setMatrixAt(i, pose.matrix);
            embers.setColorAt(i, this.emberColor.copy(this.hotEmber).lerp(this.coolingEmber, drift));
        }
        embers.instanceMatrix.needsUpdate = true;
        embers.instanceColor!.needsUpdate = true;
    }

    update(dt: number) {
        this.flameTime.value += dt;
        this.impact.update(dt);
        this.nascent.update(dt);
        for (const shot of this.projectilePool) {
            if (!shot.inUse) continue;
            const step = Math.min(dt, shot.duration + .55 - shot.age);
            const from = shot.object.position;
            const activeHoming = shot.homing && shot.homing.state !== 'Dead' ? shot.homing : undefined;
            if (!activeHoming) shot.homing = undefined;

            if (activeHoming && shot.homingSpeed) {
                this.steerTo.set(
                    activeHoming.position.x,
                    activeHoming.position.y + activeHoming.profile.height * 0.52,
                    activeHoming.position.z,
                );
                this.steerDir.subVectors(this.steerTo, from);
                const dist = this.steerDir.length();
                if (dist > 0.05) {
                    this.steerDir.multiplyScalar(1 / dist);
                    this.curDir.copy(shot.velocity).normalize();
                    // Stronger close-range convergence so fast/fleeing beasts cannot outrun Divine Sense lock
                    const turn = dist < 14 ? 13.5 : 7.8;
                    const blend = 1 - Math.exp(-turn * step);
                    this.curDir.lerp(this.steerDir, blend).normalize();
                    shot.velocity.copy(this.curDir).multiplyScalar(shot.homingSpeed);
                }
            }

            const gravityTerm = activeHoming ? 0 : -.5 * fireballGravity * step * step;
            const next = this.next.copy(from).addScaledVector(shot.velocity, step).addScaledVector(up, gravityTerm);
            const world = traceFireballWorld(from, next, this.sampleGround, .13);
            const creature = this.traceCreature(from, next);
            const contact = Math.min(world?.t ?? Infinity, creature ?? Infinity);
            if (contact <= 1) {
                next.lerpVectors(from, next, contact);
                const directHit = creature !== undefined && (world === undefined || creature <= world.t);
                const surface = world && world.t === contact ? world.ground : undefined;
                if (surface) next.y = surface.height;
                const below = surface ?? this.sampleGround(next.x, next.z, next.y + .4);
                const nearGround = surface !== undefined || (directHit && Math.abs(next.y - below.height) < 1.8);
                const groundHeight = surface ? surface.height : nearGround ? below.height : undefined;
                this.impact.play(next, surface ? surface.kind : directHit ? below.kind : 'stone', nearGround, shot.power, groundHeight);
                this.blast(next, shot.power, directHit);
                this.remove(shot);
                continue;
            }
            from.copy(next);
            if (!activeHoming) shot.velocity.y -= fireballGravity * step;
            shot.object.lookAt(this.next.copy(from).add(shot.velocity));
            shot.mixer.update(step);
            shot.age += step;
            this.updateEmbers(shot);
            if (shot.age >= shot.duration + .55) this.remove(shot);
        }
    }

    private remove(shot: Projectile) {
        shot.inUse = false;
        shot.homing = undefined;
        shot.object.visible = false;
    }

    collectLights(pool: SpellLightPool) {
        this.nascent.collectLights(pool);
        const t = this.flameTime.value;
        // 1) Fireball rune seals flanking the caster while charging/casting.
        const sealOpacity = this.sealMaterial.opacity;
        const energy = this.sealPower.value;
        for (const { side, mesh } of this.seals) {
            if (!mesh.visible || sealOpacity < 0.04) continue;
            const flicker = 0.90 + 0.10 * Math.sin(t * 24 + side * 1.7);
            pool.emit({
                x: mesh.position.x,
                y: mesh.position.y,
                z: mesh.position.z,
                color: 0xff5a18,
                intensity: (1.5 + 1.3 * energy) * sealOpacity * flicker,
                distance: 10,
                priority: side < 0 ? 68 : 64,
                castShadow: false,
            });
        }
        // 2) Flying fireballs arcing through the air (shadow-free for smooth frame pacing).
        for (const shot of this.projectilePool) {
            if (!shot.inUse) continue;
            const p = shot.object.position;
            const flicker = 0.90 + 0.10 * Math.sin(t * 34 + shot.age * 11);
            pool.emit({
                x: p.x,
                y: p.y,
                z: p.z,
                color: 0xff8022,
                intensity: (6.5 + 3.5 * shot.power) * flicker,
                distance: 16,
                priority: 90,
                castShadow: false,
            });
        }
        // 3) Fireball explosions & lingering ground embers.
        this.impact.collectLights(pool, t);
    }

    clear() {
        this.nascent.clear();
        for (const { mesh } of this.seals) mesh.visible = false;
        for (const shot of this.projectilePool) this.remove(shot);
        this.impact.clear();
    }

    dispose() {
        this.disposed = true;
        this.clear();
        for (const { mesh } of this.seals) mesh.removeFromParent();
        for (const shot of this.projectilePool) {
            shot.mixer.stopAllAction();
            shot.mixer.uncacheRoot(shot.mixer.getRoot());
            shot.embers.dispose();
            shot.object.removeFromParent();
        }
        this.projectilePool.length = 0;
        this.sealGeometry.dispose();
        this.sealMaterial.map?.dispose();
        this.sealMaterial.dispose();
        this.emberGeometry.dispose();
        this.emberMaterial.dispose();
        this.tailGeometry.dispose();
        this.tailMaterial.dispose();
        this.haloGeometry.dispose();
        this.haloMaterial.dispose();
        this.impact.dispose();
        this.nascent.dispose();
        if (this.model) disposeModel(this.model);
    }
}
