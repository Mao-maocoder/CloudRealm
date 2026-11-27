import * as T from 'three';
import type { ImpactGround, SampleGround } from './fireball-trajectory';
import type { SpellLightPool } from './spell-lights';

const atlasUrl = new URL('../../resource/fireball/Fireball_Impact_Atlas.png', import.meta.url).href;
const columns = 8, rows = 5, frameRate = 24, frames = 40, tile = 128;
const residueTime = 13;
export const fireballScorchSlots = 6;

export function createGrassScorchUniforms() {
    return {
        uFireballScorches: { value: Array.from({ length: fireballScorchSlots }, () => new T.Vector4()) },
        uFireballScorchRadii: { value: Array.from({ length: fireballScorchSlots }, () => 1) },
        uFireballScorchCount: { value: 0 },
    };
}

type Impact = {
    position: T.Vector3;
    age: number;
    power: number;
    scale: number;
    sprite?: T.Sprite;
    ring?: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
    embers?: T.Points<T.BufferGeometry, T.ShaderMaterial>;
    soot?: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
    grass: boolean;
};

function shockwaveMaterial() {
    const mat = new T.ShaderMaterial({
        uniforms: { age: { value: 0 } },
        vertexShader: `varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            }`,
        fragmentShader: `varying vec2 vUv;
            uniform float age;
            void main() {
                float t = clamp(age / .48, 0., 1.);
                if (t >= 1.) discard;
                float r = length(vUv - .5) * 2.;
                if (r >= 1.) discard;
                float waveRadius = mix(.12, .94, 1. - pow(1. - t, 2.2));
                float width = mix(.18, .08, t);
                float ring = exp(-pow((r - waveRadius) / width, 2.));
                float flash = exp(-r * r * 7.5) * pow(1. - t, 2.4);
                float alpha = (ring * (1. - t) * .88 + flash * 1.15);
                if (alpha < .02) discard;
                vec3 col = mix(vec3(1.15, .28, .04), vec3(1.5, 1.18, .55), clamp(flash + ring * .55, 0., 1.));
                gl_FragColor = vec4(col, alpha);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, blending: T.AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.customProgramCacheKey = () => 'fireball-impact-shock-v1';
    return mat;
}

function emberGeometry() {
    const geometry = new T.BufferGeometry();
    const seeds: number[] = [], kinds: number[] = [];
    // 112 particles: first 36 are fast detonation sparks, remaining 76 are swirling rising embers.
    for (let i = 0; i < 112; i++) {
        seeds.push(
            i * 2.39996,
            (i * .618034) % 1,
            (i * .754878) % 1,
        );
        kinds.push(i < 36 ? 1 : 0);
    }
    geometry.setAttribute('position', new T.Float32BufferAttribute(seeds, 3));
    geometry.setAttribute('aSparkKind', new T.Float32BufferAttribute(kinds, 1));
    return geometry;
}

function emberMaterial() {
    const mat = new T.ShaderMaterial({
        uniforms: { age: { value: 0 }, power: { value: .5 }, uScale: { value: 1 } },
        vertexShader: `
            uniform float age, power, uScale;
            attribute float aSparkKind;
            varying float heat;
            varying float sparkKind;
            void main() {
                float angle = position.x;
                float rSeed = position.y;
                float seed = position.z;
                bool isBurst = aSparkKind > .5;
                sparkKind = aSparkKind;
                vec2 radial = vec2(cos(angle), sin(angle));
                vec3 drift;
                if (isBurst) {
                    // Initial ballistic spark spray bursting out of the crater with gravity arc.
                    float life = mix(.65, 1.55, seed) * mix(1., 1.35, clamp(uScale - 1., 0., 1.));
                    float t = clamp(age / life, 0., 1.);
                    float speed = mix(2.4, 6.2, rSeed) * (.85 + .45 * power) * uScale;
                    float vy = mix(2.2, 5.4, fract(seed * 7.13)) * (.85 + .35 * power) * mix(1., 1.45, clamp((uScale - 1.) * .6, 0., 1.));
                    float dist = speed * (1. - exp(-age * 2.4)) / 2.4;
                    float y = max(.04, .18 + vy * age - 4.6 * age * age);
                    drift = vec3(radial.x * dist, y, radial.y * dist);
                    heat = pow(1. - t, 1.45) * smoothstep(0., .04, age);
                } else {
                    // Swirling thermal convection embers drifting and curling upward from the scorched ground.
                    float cycle = fract(age * mix(.28, .64, seed) + seed * 1.37);
                    float baseRadius = (.18 + (2.0 + .9 * power) * uScale * sqrt(rSeed)) * (1. + cycle * .22);
                    float swirl = angle + cycle * mix(1.4, 3.2, rSeed) * (seed > .5 ? 1. : -1.);
                    vec2 posXZ = vec2(cos(swirl), sin(swirl)) * baseRadius
                        + vec2(sin(cycle * 7.5 + angle), cos(cycle * 6.3 - angle)) * (.16 + .24 * cycle) * uScale;
                    float rise = .06 + pow(cycle, .92) * mix(.65, 2.55, seed) * mix(1., 1.55, clamp((uScale - 1.) * .6, 0., 1.));
                    drift = vec3(posXZ.x, rise, posXZ.y);
                    float fadeLife = smoothstep(.10, .45, age) * (1. - smoothstep(2.6, 8.8, age));
                    float flicker = .62 + .38 * sin(age * (16. + seed * 14.) + angle * 3.7);
                    heat = sin(cycle * 3.1415926) * (1. - cycle * .45) * fadeLife * flicker;
                }
                vec4 point = modelViewMatrix * vec4(drift, 1.);
                float sizeBoost = mix(1., 1.35, clamp((uScale - 1.) * .5, 0., 1.));
                float baseSize = (isBurst ? (4.5 + 32. * heat) : (3.6 + 44. * heat)) * sizeBoost;
                gl_PointSize = heat > .01 ? clamp(baseSize / max(.35, -point.z), 1.6, isBurst ? 12. : 14.5) : 0.;
                gl_Position = projectionMatrix * point;
            }
        `,
        fragmentShader: `
            varying float heat;
            varying float sparkKind;
            void main() {
                if (heat <= .01) discard;
                vec2 uv = gl_PointCoord - .5;
                float r = length(uv) * 2.;
                if (r >= 1.) discard;
                float core = exp(-r * r * (sparkKind > .5 ? 9.5 : 7.0));
                float halo = pow(max(0., 1. - r), 2.1);
                vec3 coolCol = vec3(.98, .18, .02);
                vec3 midCol = vec3(1.38, .62, .08);
                vec3 hotCol = vec3(1.75, 1.50, .88);
                vec3 col = mix(coolCol, midCol, smoothstep(.10, .62, heat));
                col = mix(col, hotCol, smoothstep(.52, 1.0, heat) * (.55 + .45 * core));
                float alpha = clamp((core * 1.15 + halo * .58) * heat, 0., 1.);
                gl_FragColor = vec4(col, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending,
    });
    mat.customProgramCacheKey = () => 'fireball-impact-embers-v2';
    return mat;
}

function scorchMaterial(surfaceKind: 'stone' | 'soil' | 'grass') {
    const soilMode = surfaceKind === 'soil' ? 1.0 : surfaceKind === 'grass' ? 2.0 : 0.0;
    const mat = new T.ShaderMaterial({
        uniforms: { age: { value: 0 }, uSurface: { value: soilMode } },
        vertexShader: `
            varying vec2 sootUV;
            varying float sootDepth;
            void main() {
                sootUV = uv;
                sootDepth = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            }
        `,
        fragmentShader: `
            uniform float age, uSurface;
            varying vec2 sootUV;
            varying float sootDepth;
            float sHash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            float sNoise(vec2 p) {
                vec2 i = floor(p), f = fract(p);
                f = f * f * (3. - 2. * f);
                return mix(mix(sHash(i), sHash(i + vec2(1., 0.)), f.x),
                           mix(sHash(i + vec2(0., 1.)), sHash(i + vec2(1., 1.)), f.x), f.y);
            }
            float sFbm(vec2 p) {
                return sNoise(p) * .56 + sNoise(p * 2.13 + 7.4) * .29 + sNoise(p * 4.41 - 3.2) * .15;
            }
            void main() {
                vec2 p = sootUV * 2. - 1.;
                float r = length(p);
                if (r >= 1.) discard;
                float angle = atan(p.y, p.x);
                float n = sFbm(p * 4.2 + 2.3);
                float rays = .5 + .5 * sin(angle * 11. + n * 4.5);
                float edge = r + (n - .5) * .28 + (rays - .5) * .09 * smoothstep(.18, .85, r);
                float grow = mix(.22, .94, smoothstep(0., .45, age));
                float outer = 1. - smoothstep(grow - .34, grow, edge);
                float inner = 1. - smoothstep(.05, grow * .62, edge);
                float ring = smoothstep(grow - .42, grow - .16, edge) * outer;
                float fade = 1. - smoothstep(7.5, 13., age);
                float depthMask = 1. - smoothstep(.55, 1.15, abs(sootDepth));
                float sootStrength = uSurface > 1.5 ? .72 : uSurface > .5 ? .92 : .86;
                float charAlpha = (.58 * inner + .34 * outer + .22 * ring) * fade * (.72 + .28 * n) * depthMask * sootStrength;

                // Glowing molten ember veins & smoldering hot coals cooling down inside the impact crater.
                float coalNoise = sNoise(p * 12.5 + vec2(3.1, -5.7));
                float vein = 1. - smoothstep(.04, .24, abs(sFbm(p * 6.5 - vec2(1.7, 4.2)) - .50));
                float hotSpots = smoothstep(.62, .90, coalNoise) * .85 + vein * .68;
                float emberCool = smoothstep(.02, .22, age) * (1. - smoothstep(1.6, 7.6, age));
                float pulse = .74 + .26 * sin(age * 6.8 + coalNoise * 14.0);
                float emberMask = hotSpots * inner * emberCool * pulse * depthMask;

                vec3 charCol = uSurface > .5 ? vec3(.052, .034, .022) : vec3(.032, .028, .026);
                vec3 emberCol = mix(vec3(1.15, .20, .02), vec3(1.65, .96, .28), smoothstep(.20, .92, emberCool * (.65 + .35 * coalNoise)));
                vec3 finalCol = mix(charCol, emberCol, clamp(emberMask * 1.35, 0., 1.));
                float alpha = clamp(max(charAlpha, emberMask * .92), 0., .95);
                if (alpha < .01) discard;
                gl_FragColor = vec4(finalCol, alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true,
        polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.customProgramCacheKey = () => 'fireball-impact-scorch-v1';
    return mat;
}

export class FireballImpact {
    readonly grassScorches = createGrassScorchUniforms();
    readonly warmObjects: T.Object3D[] = [];
    private readonly warmGroup = new T.Group();
    private readonly warmGeo = new T.PlaneGeometry(1, 1);
    private readonly warmMats: T.Material[] = [];
    private readonly embers = emberGeometry();
    private readonly impacts = new Set<Impact>();
    private atlas?: T.Texture;
    private disposed = false;

    constructor(private scene: T.Scene, private sampleGround: SampleGround) {
        this.warmGroup.name = 'FireballImpact_WarmGroup';
        this.warmGroup.visible = false;
        const wShockMat = shockwaveMaterial();
        const wEmberMat = emberMaterial();
        const wScorchMat = scorchMaterial('grass');
        this.warmMats.push(wShockMat, wEmberMat, wScorchMat);
        this.warmGroup.add(
            new T.Mesh(this.warmGeo, wShockMat),
            new T.Points(this.embers, wEmberMat),
            new T.Mesh(this.warmGeo, wScorchMat),
        );
        this.warmObjects.push(this.warmGroup);
    }

    async load() {
        const texture = await new T.TextureLoader().loadAsync(atlasUrl);
        if (this.disposed) { texture.dispose(); return; }
        texture.colorSpace = T.SRGBColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = T.LinearFilter;
        this.atlas = texture;
        // Add hidden flipbook sprite to warmGroup so its onBeforeCompile shader pre-compiles too
        const warmSpriteMat = this.createFlipbookMaterial(texture);
        this.warmMats.push(warmSpriteMat);
        this.warmGroup.add(new T.Sprite(warmSpriteMat));
    }

    private createFlipbookMaterial(atlas: T.Texture) {
        const tileOffset = { value: new T.Vector2() };
        const tileRepeat = { value: new T.Vector2((tile - 1) / (columns * tile), (tile - 1) / (rows * tile)) };
        const material = new T.SpriteMaterial({ map: atlas, transparent: true, depthWrite: false, toneMapped: false });
        material.userData.tileOffset = tileOffset;
        material.customProgramCacheKey = () => 'fireball-impact-flipbook';
        material.onBeforeCompile = shader => {
            shader.uniforms.uTileOffset = tileOffset;
            shader.uniforms.uTileRepeat = tileRepeat;
            shader.fragmentShader = 'uniform vec2 uTileOffset, uTileRepeat;\n' + shader.fragmentShader.replace(
                '#include <map_fragment>',
                `#ifdef USE_MAP
                    diffuseColor *= texture2D(map, vMapUv * uTileRepeat + uTileOffset);
                #endif`,
            );
        };
        return material;
    }

    play(position: T.Vector3, ground?: ImpactGround, onSurface = false, power = .5, groundHeight?: number, scale = 1) {
        const surfacePos = groundHeight !== undefined
            ? new T.Vector3(position.x, groundHeight, position.z)
            : position.clone();
        const impact: Impact = { position: surfacePos.clone(), age: 0, power, scale, grass: ground === 'grass' && onSurface };
        if (this.atlas) {
            const material = this.createFlipbookMaterial(this.atlas);
            const sprite = impact.sprite = new T.Sprite(material);
            sprite.name = 'Fireball Impact Blender Flipbook';
            // Orthographic projection of the ground contact in the source bake.
            sprite.center.set(.5, .35);
            sprite.position.copy(position).y += .07;
            sprite.scale.setScalar(((ground === 'water' ? 6.0 : 7.6) + power * 2.2) * scale);
            sprite.renderOrder = 5;
            this.setFrame(sprite, 0);
            this.scene.add(sprite);
        }
        impact.ring = this.shockwaveMesh(surfacePos, (5.2 + power * 3.0) * scale);
        if (ground !== 'water') {
            const mat = emberMaterial();
            mat.uniforms.power.value = power;
            mat.uniforms.uScale.value = scale;
            const embers = impact.embers = new T.Points(this.embers, mat);
            embers.name = 'Fireball Ground Embers';
            embers.position.copy(surfacePos);
            embers.frustumCulled = false;
            embers.renderOrder = 5;
            this.scene.add(embers);
        }
        if (onSurface && (ground === 'stone' || ground === 'soil' || ground === 'grass')) {
            impact.soot = this.scorchMark(surfacePos, ground, power, scale);
        }
        this.impacts.add(impact);
        if (this.impacts.size > 24) this.remove(this.impacts.values().next().value!);
    }

    private setFrame(sprite: T.Sprite, frame: number) {
        const offset = (sprite.material.userData.tileOffset as { value: T.Vector2 } | undefined)?.value;
        if (!offset) return;
        offset.set((frame % columns + .5 / tile) / columns,
            (rows - 1 - Math.floor(frame / columns) + .5 / tile) / rows);
    }

    private shockwaveMesh(position: T.Vector3, diameter = 6.8) {
        const geometry = new T.PlaneGeometry(diameter, diameter, 10, 10).rotateX(-Math.PI / 2);
        const vertices = geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++) {
            const ground = this.sampleGround(position.x + vertices.getX(i), position.z + vertices.getZ(i), position.y + 1.8);
            vertices.setY(i, ground.height - position.y + .09);
        }
        const ring = new T.Mesh(geometry, shockwaveMaterial());
        ring.name = 'Fireball Shockwave Ring';
        ring.position.copy(position);
        ring.renderOrder = 4;
        this.scene.add(ring);
        return ring;
    }

    private scorchMark(position: T.Vector3, surfaceKind: 'stone' | 'soil' | 'grass', power = .5, scale = 1) {
        const diameter = (4.9 + power * 2.1) * scale;
        const segs = scale > 1.5 ? 18 : 14;
        const geometry = new T.PlaneGeometry(diameter, diameter, segs, segs).rotateX(-Math.PI / 2);
        const vertices = geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++) {
            const ground = this.sampleGround(position.x + vertices.getX(i), position.z + vertices.getZ(i), position.y + 1.5);
            vertices.setY(i, ground.kind === 'water' ? -1.4 : ground.height - position.y + .055);
        }
        const mark = new T.Mesh(geometry, scorchMaterial(surfaceKind));
        mark.name = surfaceKind === 'stone'
            ? 'Fireball Stone Scorch'
            : surfaceKind === 'soil'
                ? 'Fireball Soil Scorch'
                : 'Fireball Grass Scorch';
        mark.position.copy(position);
        mark.renderOrder = 1;
        this.scene.add(mark);
        return mark;
    }

    update(dt: number) {
        for (const impact of this.impacts) {
            impact.age += dt;
            if (impact.sprite) {
                const frame = Math.floor(impact.age * frameRate);
                // Fade out the late-frame grey smoke puffs smoothly so they never linger as solid cotton balls.
                if (frame < 28) {
                    this.setFrame(impact.sprite, frame);
                    impact.sprite.material.opacity = 1 - T.MathUtils.smoothstep(frame, 13, 27);
                } else this.removeSprite(impact);
            }
            if (impact.ring) {
                if (impact.age < .48) impact.ring.material.uniforms.age.value = impact.age;
                else {
                    impact.ring.removeFromParent();
                    impact.ring.geometry.dispose();
                    impact.ring.material.dispose();
                    impact.ring = undefined;
                }
            }
            if (impact.embers) {
                impact.embers.visible = impact.age < 9.0;
                impact.embers.material.uniforms.age.value = impact.age;
            }
            if (impact.soot) impact.soot.material.uniforms.age.value = impact.age;
            if (impact.age >= (impact.grass || impact.soot ? residueTime : impact.embers ? 9.0 : frames / frameRate)) this.remove(impact);
        }
        const marks = this.grassScorches.uFireballScorches.value;
        const radii = this.grassScorches.uFireballScorchRadii.value;
        let i = 0;
        for (const impact of Array.from(this.impacts).reverse()) {
            if (!impact.grass) continue;
            const strength = T.MathUtils.smoothstep(impact.age, 0, .5) * (1 - T.MathUtils.smoothstep(impact.age, 7, residueTime));
            marks[i].set(impact.position.x, impact.position.y, impact.position.z, strength);
            radii[i] = impact.scale;
            i++;
            if (i === marks.length) break;
        }
        this.grassScorches.uFireballScorchCount.value = i;
    }

    private removeSprite(impact: Impact) {
        const sprite = impact.sprite;
        if (!sprite) return;
        sprite.removeFromParent();
        sprite.material.dispose();
        impact.sprite = undefined;
    }

    private remove(impact: Impact) {
        this.removeSprite(impact);
        impact.ring?.removeFromParent();
        impact.ring?.geometry.dispose();
        impact.ring?.material.dispose();
        impact.embers?.removeFromParent();
        impact.embers?.material.dispose();
        impact.soot?.removeFromParent();
        impact.soot?.geometry.dispose();
        impact.soot?.material.dispose();
        this.impacts.delete(impact);
    }

    collectLights(pool: SpellLightPool, clock: number) {
        for (const impact of this.impacts) {
            const p = impact.position;
            if (impact.age < 0.95) {
                // Intense molten detonation flash casting dynamic radial shadows.
                const rise = T.MathUtils.smoothstep(impact.age, 0, 0.05);
                const decay = Math.pow(Math.max(0, 1 - impact.age / 0.95), 1.85);
                const flicker = 0.90 + 0.10 * Math.sin(clock * 46 + p.x);
                pool.emit({
                    x: p.x,
                    y: p.y + 1.45,
                    z: p.z,
                    color: 0xff922b,
                    intensity: (14 + 6 * impact.power) * rise * decay * flicker,
                    distance: 20 + 4 * impact.power,
                    priority: 100,
                    castShadow: false,
                });
            } else if (impact.embers && impact.age < 6.8) {
                // Lingering glowing embers & smoldering coals on scorched ground.
                const fade = 1 - T.MathUtils.smoothstep(impact.age, 1.4, 6.8);
                const flicker = 0.78 + 0.22 * Math.sin(clock * 19 + p.z * 3.1);
                pool.emit({
                    x: p.x,
                    y: p.y + 0.72,
                    z: p.z,
                    color: 0xff4c12,
                    intensity: 1.45 * fade * flicker * Math.min(2.2, impact.scale),
                    distance: 8.5 * Math.min(2.4, impact.scale),
                    priority: 40,
                    castShadow: false,
                });
            }
        }
    }

    clear() {
        for (const impact of this.impacts) this.remove(impact);
        this.grassScorches.uFireballScorchCount.value = 0;
    }

    dispose() {
        this.disposed = true;
        this.clear();
        this.warmGroup.removeFromParent();
        this.warmGeo.dispose();
        for (const mat of this.warmMats) mat.dispose();
        this.embers.dispose();
        this.atlas?.dispose();
    }
}
