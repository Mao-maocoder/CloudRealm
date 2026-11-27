import * as T from 'three';
import type { Quality } from '../config/settings';
import { atmosphereUniforms } from '../rendering/aerial-perspective';

const PULSE_DURATION = 2.35;

/**
 * Orchestrates the Divine Sense (神识) visual & state system:
 * 1. Drives the zero-extra-drawcall 3D world scan wavefront via `atmosphereUniforms`.
 * 2. Renders lightweight Guofeng 3D FX:
 *    - Rotating Dao-rune meditation lotus beneath the seated body during Astral Projection
 *    - Delicate glowing curved silk tether connecting body to floating consciousness
 *    - Soft spirit-veil boundary dome that shimmers only when consciousness nears `senseRadius`
 *    - Rotating ink-gold Dao lock reticle around the locked combat target during Divine Sense
 */
export class DivineSense {
    readonly group = new T.Group();
    readonly pulseOrigin = new T.Vector3();
    readonly bodyPosition = new T.Vector3();

    pulseActive = false;
    pulseAge = 0;
    pulseMaxRadius = 120;
    senseEnabled = false;

    astralActive = false;
    astralRadius = 350;
    astralEdgeRatio = 0;
    bodyHeading = 0;

    private elapsed = 0;
    private edgeBlend = 0;
    private triggerRippleAge = 99;
    private alertPulse = 0;
    private readonly themeColor = new T.Color('#8ee6c8');
    private readonly tmpVecA = new T.Vector3();
    private readonly tmpVecB = new T.Vector3();
    private readonly tmpVecC = new T.Vector3();
    private readonly tmpMid = new T.Vector3();

    private readonly edgeQuad: T.Mesh;
    private readonly edgeMat: T.ShaderMaterial;

    private readonly meditateRing: T.Mesh;
    private readonly meditateMat: T.ShaderMaterial;

    private readonly lockReticle: T.Mesh;
    private readonly lockMat: T.ShaderMaterial;

    private readonly boundaryDome: T.Mesh;
    private readonly boundaryMat: T.ShaderMaterial;

    private readonly tetherLine: T.Line;
    private readonly tetherPositions: Float32Array;
    private readonly tetherGeo: T.BufferGeometry;
    private readonly tetherMat: T.ShaderMaterial;
    private readonly tetherSegments = 28;

    readonly warmObjects: T.Object3D[];

    constructor(scene: T.Scene) {
        this.group.name = 'Divine Sense FX';

        // 0. Screen-space Divine Sense peripheral perception VFX (1 fullscreen quad, 0 render-target passes):
        //    Combines organic creeping sumi-ink vignette, flowing psychic silk distortion waves,
        //    drifting edge spirit motes, subtle chromatic shimmer, and an opening radial spirit-eye ripple.
        this.edgeMat = new T.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            uniforms: {
                uTime: { value: 0 },
                uAspect: { value: 1.6 },
                uStrength: { value: 0 },
                uAstral: { value: 0 },
                uRipple: { value: 1.5 },
                uAlert: { value: 0 },
                uColor: { value: new T.Color('#8ee6c8') },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uAspect;
                uniform float uStrength;
                uniform float uAstral;
                uniform float uRipple;
                uniform float uAlert;
                uniform vec3 uColor;
                varying vec2 vUv;

                float hash21(vec2 p) {
                    p = fract(p * vec2(127.1, 311.7));
                    p += dot(p, p + 34.53);
                    return fract(p.x * p.y);
                }

                float noise2(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float a = hash21(i);
                    float b = hash21(i + vec2(1.0, 0.0));
                    float c = hash21(i + vec2(0.0, 1.0));
                    float d = hash21(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }

                float fbm(vec2 p) {
                    float v = 0.0;
                    float amp = 0.52;
                    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
                    for (int i = 0; i < 4; i++) {
                        v += amp * noise2(p);
                        p = rot * p * 2.04 + vec2(1.7, 9.2);
                        amp *= 0.50;
                    }
                    return v;
                }

                void main() {
                    if (uStrength <= 0.001 && uRipple >= 1.2) discard;

                    // Centered coordinates normalized so corners reach ~1.0 cleanly across all aspect ratios
                    vec2 p = vUv * 2.0 - 1.0;
                    vec2 pa = vec2(p.x * min(1.38, max(0.82, uAspect * 0.68)), p.y);
                    float rad = length(p * vec2(0.92, 1.0));
                    float ang = atan(pa.y, pa.x);

                    // Slow meditative breathing rhythm (~13 cycles/min, Daoist qi circulation)
                    float breath = 0.88 + 0.12 * sin(uTime * 1.45);

                    // Domain-warped ink & ethereal spirit flow along the screen perimeter
                    vec2 flowUv = pa * 2.15;
                    vec2 warp = vec2(
                        fbm(flowUv + vec2(uTime * 0.14, -uTime * 0.11)),
                        fbm(flowUv + vec2(-uTime * 0.12, uTime * 0.16) + vec2(5.2, 1.3))
                    );
                    float inkCloud = fbm(flowUv * 1.35 + (warp - 0.5) * 1.45 + vec2(0.0, -uTime * 0.09));

                    // Organic ink-wash creep from corners/edges inward — never obscures central 62% gameplay view
                    float edgeDist = rad + (inkCloud - 0.5) * 0.34;
                    float outerMask = smoothstep(0.56, 1.18, edgeDist);
                    float innerMist = smoothstep(0.48, 1.06, edgeDist) * (0.45 + 0.55 * inkCloud);

                    // Flowing psychic refraction ribbons (sinuous spirit tendrils weaving around perimeter)
                    float wave1 = sin(ang * 5.0 + uTime * 0.85 + warp.x * 5.2 - rad * 4.5);
                    float wave2 = cos(ang * 8.0 - uTime * 0.62 + warp.y * 4.6 + rad * 3.8);
                    float filament = pow(max(0.0, 0.5 + 0.5 * (wave1 * 0.6 + wave2 * 0.4)), 4.5);
                    float silkRing = smoothstep(0.54, 0.84, edgeDist) * smoothstep(1.32, 0.88, edgeDist) * filament;

                    // Delicate chromatic split / psychic refraction shimmer along the silk edge
                    float shimmer = pow(max(0.0, sin(ang * 14.0 - uTime * 1.9 + inkCloud * 7.5)), 6.0);
                    float rimHalo = smoothstep(0.68, 1.05, edgeDist) * (0.35 + 0.65 * shimmer);

                    // Subtle drifting peripheral spirit motes (zero extra particle geometry)
                    vec2 moteUv = vec2(ang * 3.8 + uTime * 0.16, rad * 9.0 - uTime * 0.38);
                    vec2 mCell = floor(moteUv);
                    vec2 mFrac = fract(moteUv) - 0.5;
                    float mRand = hash21(mCell);
                    vec2 mOff = vec2(hash21(mCell + 11.3) - 0.5, hash21(mCell + 27.1) - 0.5) * 0.58;
                    float mDot = smoothstep(0.16, 0.02, length(mFrac - mOff)) * step(0.62, mRand);
                    float mTwinkle = 0.45 + 0.55 * sin(uTime * (2.2 + mRand * 3.0) + mRand * 6.28);
                    float motes = mDot * mTwinkle * smoothstep(0.62, 0.92, rad) * smoothstep(1.22, 0.96, rad);

                    // Opening radial spirit-eye shockwave ripple when pressing Z or G
                    float rippleMask = 0.0;
                    if (uRipple < 1.15) {
                        float rRad = uRipple * 1.48;
                        float rDist = abs(rad - rRad) + (inkCloud - 0.5) * 0.07;
                        float rBand = exp(-pow(rDist / 0.065, 2.0));
                        float rFade = smoothstep(0.0, 0.08, uRipple) * (1.0 - smoothstep(0.35, 1.12, uRipple));
                        rippleMask = rBand * rFade * (0.65 + 0.35 * sin(ang * 9.0 + uTime * 4.0));
                    }

                    // Color composition: deep sumi-indigo/jade outer wash + luminous realm-tinted psychic filaments + warm gold accents
                    vec3 deepInk = mix(vec3(0.02, 0.07, 0.10), uColor * 0.16, 0.32 + 0.18 * uAstral);
                    vec3 spiritGlow = mix(uColor, vec3(0.98, 0.92, 0.72), 0.28 + 0.25 * shimmer);
                    vec3 prismCyan = mix(vec3(0.48, 0.94, 0.92), uColor, 0.55);
                    if (uAlert > 0.01) {
                        spiritGlow = mix(spiritGlow, vec3(1.0, 0.34, 0.28), uAlert * 0.75);
                        deepInk = mix(deepInk, vec3(0.18, 0.03, 0.04), uAlert * 0.45);
                    }

                    float s = uStrength * breath;
                    float alphaDark = outerMask * (0.48 + 0.16 * uAstral) * s;
                    float alphaMist = innerMist * (0.16 + 0.08 * uAstral) * s;
                    float alphaSilk = (silkRing * 0.42 + rimHalo * 0.24 + motes * 0.58) * s;
                    float alphaRipple = rippleMask * 0.52;

                    vec3 color = deepInk * (alphaDark + alphaMist * 0.45)
                        + mix(prismCyan, spiritGlow, 0.62) * (alphaSilk + alphaMist * 0.55)
                        + mix(uColor, vec3(1.0, 0.95, 0.78), 0.45) * alphaRipple;
                    float totalAlpha = clamp(alphaDark + alphaMist * 0.65 + alphaSilk * 0.85 + alphaRipple, 0.0, 0.84);
                    // Un-premultiply safely so standard alpha blending preserves vibrant luminous filaments
                    vec3 outRgb = totalAlpha > 0.002 ? color / totalAlpha : color;
                    gl_FragColor = vec4(outRgb, totalAlpha);
                }
            `,
        });
        this.edgeQuad = new T.Mesh(new T.PlaneGeometry(2, 2), this.edgeMat);
        this.edgeQuad.name = 'Divine Sense Edge Overlay';
        this.edgeQuad.frustumCulled = false;
        this.edgeQuad.renderOrder = 999;
        this.edgeQuad.visible = false;

        // 1. Seated meditation Dao lotus ring (visible under body in Astral Projection)
        this.meditateMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new T.Color('#8ee6c8') },
                uAlpha: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv * 2.0 - 1.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uAlpha;
                varying vec2 vUv;
                void main() {
                    float r = length(vUv);
                    if (r > 1.0) discard;
                    float ang = atan(vUv.y, vUv.x);
                    float outerRing = exp(-pow((r - 0.86) / 0.036, 2.0));
                    float innerRing = exp(-pow((r - 0.52) / 0.028, 2.0));
                    float petals = smoothstep(0.18, 0.96, cos(ang * 8.0 - uTime * 0.75)) * exp(-pow((r - 0.69) / 0.14, 2.0));
                    float glyphs = (0.45 + 0.55 * sin(ang * 24.0 + uTime * 1.4)) * exp(-pow((r - 0.86) / 0.07, 2.0));
                    float coreGlow = exp(-r * r * 5.2) * 0.35;
                    float mask = (outerRing * 0.85 + innerRing * 0.65 + petals * 0.42 + glyphs * 0.32 + coreGlow) * smoothstep(1.0, 0.88, r);
                    vec3 col = mix(uColor, vec3(0.99, 0.92, 0.72), innerRing * 0.5 + outerRing * 0.3);
                    gl_FragColor = vec4(col, clamp(mask * uAlpha, 0.0, 0.95));
                }
            `,
        });
        this.meditateRing = new T.Mesh(new T.PlaneGeometry(4.4, 4.4), this.meditateMat);
        this.meditateRing.rotation.x = -Math.PI / 2;
        this.meditateRing.renderOrder = 6;
        this.meditateRing.visible = false;

        // 2. Rotating Dao-rune combat lock reticle around locked beast
        this.lockMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: T.AdditiveBlending,
            side: T.DoubleSide,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new T.Color('#f6d479') },
                uAlpha: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv * 2.0 - 1.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uAlpha;
                varying vec2 vUv;
                void main() {
                    float r = length(vUv);
                    if (r > 1.0) discard;
                    float ang = atan(vUv.y, vUv.x);
                    float ringA = exp(-pow((r - 0.82) / 0.042, 2.0));
                    float ringB = exp(-pow((r - 0.58) / 0.025, 2.0));
                    float notches = smoothstep(0.62, 0.95, cos(ang * 4.0 + uTime * 2.1)) * smoothstep(0.45, 0.96, r);
                    float ticks = smoothstep(0.5, 0.9, sin(ang * 16.0 - uTime * 1.2)) * exp(-pow((r - 0.82) / 0.09, 2.0));
                    float mask = (ringA * 0.9 + ringB * 0.55 + notches * 0.85 + ticks * 0.4) * smoothstep(1.0, 0.9, r);
                    vec3 col = mix(uColor, vec3(1.0, 0.95, 0.82), notches * 0.45);
                    gl_FragColor = vec4(col, clamp(mask * uAlpha, 0.0, 0.92));
                }
            `,
        });
        this.lockReticle = new T.Mesh(new T.PlaneGeometry(2.6, 2.6), this.lockMat);
        this.lockReticle.rotation.x = -Math.PI / 2;
        this.lockReticle.renderOrder = 8;
        this.lockReticle.visible = false;

        // 3. Subtle spherical Divine Sense boundary dome (only shimmers when consciousness nears the sphere edge)
        this.boundaryMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            side: T.BackSide,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new T.Color('#f6d479') },
                uAlpha: { value: 0 },
            },
            vertexShader: `
                varying vec3 vNormalDir;
                varying vec3 vLocalDir;
                varying vec3 vWorldPos;
                void main() {
                    vLocalDir = normalize(position);
                    vNormalDir = normalize(normalMatrix * normal);
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uAlpha;
                varying vec3 vNormalDir;
                varying vec3 vLocalDir;
                varying vec3 vWorldPos;
                void main() {
                    float az = atan(vLocalDir.z, vLocalDir.x);
                    float el = asin(clamp(vLocalDir.y, -1.0, 1.0));
                    float band = pow(0.5 + 0.5 * sin(el * 18.0 + uTime * 0.8), 10.0);
                    float silk = 0.55 + 0.45 * sin(az * 12.0 - uTime * 0.5 + el * 6.0);
                    float horizon = smoothstep(-0.35, 0.08, vLocalDir.y) * smoothstep(0.92, 0.25, vLocalDir.y);
                    float alpha = (0.14 + band * 0.48 * silk) * horizon * uAlpha;
                    vec3 col = mix(uColor, vec3(0.98, 0.90, 0.68), band * 0.45);
                    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.42));
                }
            `,
        });
        this.boundaryDome = new T.Mesh(new T.IcosahedronGeometry(1, 3), this.boundaryMat);
        this.boundaryDome.renderOrder = 7;
        this.boundaryDome.frustumCulled = false;
        this.boundaryDome.visible = false;

        // 4. Spirit tether silk line connecting seated body back to floating astral consciousness
        const count = this.tetherSegments + 1;
        this.tetherPositions = new Float32Array(count * 3);
        const tProgress = new Float32Array(count);
        for (let i = 0; i < count; i++) tProgress[i] = i / this.tetherSegments;
        this.tetherGeo = new T.BufferGeometry();
        this.tetherGeo.setAttribute('position', new T.BufferAttribute(this.tetherPositions, 3));
        this.tetherGeo.setAttribute('aProgress', new T.BufferAttribute(tProgress, 1));
        this.tetherMat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new T.Color('#f6d479') },
                uAlpha: { value: 0 },
            },
            vertexShader: `
                attribute float aProgress;
                varying float vProgress;
                void main() {
                    vProgress = aProgress;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uAlpha;
                varying float vProgress;
                void main() {
                    float ends = smoothstep(0.0, 0.08, vProgress) * smoothstep(1.0, 0.84, vProgress);
                    float flow = 0.55 + 0.45 * sin(vProgress * 22.0 - uTime * 5.2);
                    vec3 col = mix(uColor, vec3(1.0, 0.95, 0.78), flow * 0.45);
                    gl_FragColor = vec4(col, ends * flow * uAlpha);
                }
            `,
        });
        this.tetherLine = new T.Line(this.tetherGeo, this.tetherMat);
        this.tetherLine.frustumCulled = false;
        this.tetherLine.renderOrder = 7;
        this.tetherLine.visible = false;

        this.group.add(this.edgeQuad, this.meditateRing, this.lockReticle, this.boundaryDome, this.tetherLine);
        scene.add(this.group);
        this.warmObjects = [this.edgeQuad, this.meditateRing, this.lockReticle, this.boundaryDome, this.tetherLine];
    }

    get insightActive(): boolean {
        return this.senseEnabled || this.astralActive;
    }

    get currentPulseRadius(): number {
        if (!this.pulseActive) return 0;
        const t = T.MathUtils.clamp(this.pulseAge / PULSE_DURATION, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2.35);
        return eased * this.pulseMaxRadius;
    }

    /** Manually opens Divine Sense (stays continuously active until closed or mana runs out) and fires an opening scan wave. */
    openSense(origin: T.Vector3, maxRadius: number, realmColor: string): boolean {
        this.senseEnabled = true;
        this.pulseOrigin.copy(origin);
        this.pulseMaxRadius = Math.max(40, maxRadius);
        this.pulseAge = 0;
        this.pulseActive = true;
        this.triggerRippleAge = 0;
        this.themeColor.set(realmColor);
        return true;
    }

    /** Alias kept for compatibility. */
    triggerPulse(origin: T.Vector3, maxRadius: number, realmColor: string): boolean {
        return this.openSense(origin, maxRadius, realmColor);
    }

    /** Manually closes continuous Divine Sense perception (screen-edge veil fades out smoothly). */
    closeSense() {
        this.senseEnabled = false;
    }

    /** Brief crimson pulse along screen edge when a high-rank beast counter-senses the cultivator. */
    notifyCounterAlert() {
        this.alertPulse = 1.0;
    }

    /** Enters out-of-body Astral Divine Sense mode while the cultivator meditates in place. */
    enterAstral(bodyPos: T.Vector3, bodyHeading: number, radius: number, realmColor: string) {
        this.astralActive = true;
        this.senseEnabled = true;
        this.bodyPosition.copy(bodyPos);
        this.bodyHeading = bodyHeading;
        this.astralRadius = Math.max(120, radius);
        this.astralEdgeRatio = 0;
        this.themeColor.set(realmColor);
        // Emit a gentle initial pulse from the seated body so nearby beasts immediately reveal
        this.pulseOrigin.copy(bodyPos);
        this.pulseMaxRadius = this.astralRadius;
        this.pulseAge = 0;
        this.pulseActive = true;
        this.triggerRippleAge = 0;
    }

    exitAstral() {
        if (!this.astralActive) return;
        this.astralActive = false;
        this.astralEdgeRatio = 0;
        this.meditateRing.visible = false;
        this.boundaryDome.visible = false;
        this.tetherLine.visible = false;
    }

    clear() {
        this.pulseActive = false;
        this.pulseAge = 0;
        this.edgeBlend = 0;
        this.triggerRippleAge = 99;
        this.alertPulse = 0;
        this.senseEnabled = false;
        this.exitAstral();
        this.edgeQuad.visible = false;
        this.lockReticle.visible = false;
        atmosphereUniforms.uSensePulse.value.set(0, 12, 0, 0);
        atmosphereUniforms.uSenseFocus.value = 0;
    }

    setQuality(_q: Quality) {
        // Already ultra-lightweight (3 quads/lines + 1 shader branch in aerialPerspectiveGLSL)
    }

    update(
        dt: number,
        camera: T.Camera,
        realmColor: string,
        lockedTarget?: { position: T.Vector3; radius: number; color: string },
    ) {
        this.elapsed += dt;
        this.themeColor.set(realmColor);

        // 1. Update global 3D shader scan wavefront & astral boundary uniforms
        let waveRadius = 0;
        let bandWidth = 14;
        let waveStrength = 0;
        if (this.pulseActive) {
            this.pulseAge += dt;
            const t = T.MathUtils.clamp(this.pulseAge / PULSE_DURATION, 0, 1);
            const eased = 1 - Math.pow(1 - t, 2.35);
            waveRadius = eased * this.pulseMaxRadius;
            bandWidth = Math.max(9, this.pulseMaxRadius * 0.052);
            const fadeIn = T.MathUtils.smoothstep(t, 0, 0.07);
            const fadeOut = 1 - T.MathUtils.smoothstep(t, 0.62, 1.0);
            waveStrength = fadeIn * fadeOut * 0.95;
            if (this.pulseAge >= PULSE_DURATION) {
                this.pulseActive = false;
                waveStrength = 0;
            }
        }

        const origin = this.astralActive && !this.pulseActive ? this.bodyPosition : this.pulseOrigin;
        atmosphereUniforms.uSenseOrigin.value.copy(origin);
        atmosphereUniforms.uSenseColor.value.copy(this.themeColor);
        atmosphereUniforms.uSensePulse.value.set(
            waveRadius,
            bandWidth,
            waveStrength,
            this.astralActive ? this.astralRadius : 0,
        );

        // 1b. Update Screen-Space Peripheral Psychic Perception Shader (creeping ink mist + flowing spirit silk + trigger ripple)
        const targetEdge = this.astralActive
            ? 1.0
            : this.senseEnabled
                ? 0.92
                : 0;
        const rate = targetEdge > this.edgeBlend ? 4.8 : 2.6;
        this.edgeBlend = T.MathUtils.damp(this.edgeBlend, targetEdge, rate, dt);
        if (this.edgeBlend < 0.002 && targetEdge === 0) this.edgeBlend = 0;
        if (this.triggerRippleAge < 1.5) this.triggerRippleAge += dt * 1.15;
        if (this.alertPulse > 0) this.alertPulse = Math.max(0, this.alertPulse - dt * 0.65);

        atmosphereUniforms.uSenseFocus.value = this.edgeBlend;
        const showEdge = this.edgeBlend > 0.002 || this.triggerRippleAge < 1.18;
        this.edgeQuad.visible = showEdge;
        if (showEdge) {
            const aspect = camera instanceof T.PerspectiveCamera ? camera.aspect : 1.6;
            this.edgeMat.uniforms.uTime.value = this.elapsed;
            this.edgeMat.uniforms.uAspect.value = aspect;
            this.edgeMat.uniforms.uStrength.value = this.edgeBlend;
            this.edgeMat.uniforms.uAstral.value = this.astralActive ? 1.0 : 0.0;
            this.edgeMat.uniforms.uRipple.value = this.triggerRippleAge;
            this.edgeMat.uniforms.uAlert.value = this.alertPulse;
            this.edgeMat.uniforms.uColor.value.copy(this.themeColor);
        }

        // 2. Update Astral Projection 3D FX (seated meditate ring, spirit tether, boundary dome)
        if (this.astralActive) {
            this.meditateRing.visible = true;
            this.meditateRing.position.set(this.bodyPosition.x, this.bodyPosition.y + 0.14, this.bodyPosition.z);
            this.meditateMat.uniforms.uTime.value = this.elapsed;
            this.meditateMat.uniforms.uColor.value.copy(this.themeColor);
            this.meditateMat.uniforms.uAlpha.value = 0.78 + 0.14 * Math.sin(this.elapsed * 2.2);

            const dist = camera.position.distanceTo(this.bodyPosition);
            this.astralEdgeRatio = T.MathUtils.clamp(dist / Math.max(1, this.astralRadius), 0, 1);

            const domeAlpha = T.MathUtils.smoothstep(this.astralEdgeRatio, 0.62, 0.96);
            this.boundaryDome.visible = domeAlpha > 0.01;
            if (this.boundaryDome.visible) {
                this.boundaryDome.position.copy(this.bodyPosition);
                this.boundaryDome.scale.setScalar(this.astralRadius);
                this.boundaryMat.uniforms.uTime.value = this.elapsed;
                this.boundaryMat.uniforms.uColor.value.copy(this.themeColor);
                this.boundaryMat.uniforms.uAlpha.value = domeAlpha;
            }

            // Curved glowing silk spirit tether from body brow toward floating consciousness
            this.tetherLine.visible = dist > 5.5;
            if (this.tetherLine.visible) {
                this.tmpVecA.copy(this.bodyPosition);
                this.tmpVecA.y += 1.48;
                // End point trails slightly below & behind camera view so it reads as an ethereal spirit filament
                camera.getWorldDirection(this.tmpVecC);
                this.tmpVecB.copy(camera.position).addScaledVector(this.tmpVecC, 2.2);
                this.tmpVecB.y -= 1.35;
                this.tmpMid.copy(this.tmpVecA).lerp(this.tmpVecB, 0.5);
                this.tmpMid.y += Math.min(24, dist * 0.12) + Math.sin(this.elapsed * 1.8) * 0.8;

                const pos = this.tetherPositions;
                const n = this.tetherSegments;
                for (let i = 0; i <= n; i++) {
                    const u = i / n;
                    const inv = 1 - u;
                    const x = inv * inv * this.tmpVecA.x + 2 * inv * u * this.tmpMid.x + u * u * this.tmpVecB.x;
                    const y = inv * inv * this.tmpVecA.y + 2 * inv * u * this.tmpMid.y + u * u * this.tmpVecB.y;
                    const z = inv * inv * this.tmpVecA.z + 2 * inv * u * this.tmpMid.z + u * u * this.tmpVecB.z;
                    pos[i * 3] = x;
                    pos[i * 3 + 1] = y;
                    pos[i * 3 + 2] = z;
                }
                (this.tetherGeo.attributes.position as T.BufferAttribute).needsUpdate = true;
                this.tetherMat.uniforms.uTime.value = this.elapsed;
                this.tetherMat.uniforms.uColor.value.copy(this.themeColor);
                this.tetherMat.uniforms.uAlpha.value = T.MathUtils.clamp((dist - 5.5) / 14, 0, 1) * 0.58;
            }
        } else {
            this.meditateRing.visible = false;
            this.boundaryDome.visible = false;
            this.tetherLine.visible = false;
            this.astralEdgeRatio = 0;
        }

        // 3. Rotating Dao-rune combat lock reticle around locked beast when Divine Sense is active
        if (this.insightActive && lockedTarget) {
            this.lockReticle.visible = true;
            this.lockReticle.position.set(lockedTarget.position.x, lockedTarget.position.y + 0.22, lockedTarget.position.z);
            const scale = Math.max(1.2, lockedTarget.radius * 1.85);
            this.lockReticle.scale.setScalar(scale);
            this.lockMat.uniforms.uTime.value = this.elapsed;
            this.lockMat.uniforms.uColor.value.set(lockedTarget.color);
            this.lockMat.uniforms.uAlpha.value = 0.85;
        } else {
            this.lockReticle.visible = false;
        }
    }

    dispose() {
        this.clear();
        this.edgeQuad.geometry.dispose();
        this.edgeMat.dispose();
        this.meditateRing.geometry.dispose();
        this.meditateMat.dispose();
        this.lockReticle.geometry.dispose();
        this.lockMat.dispose();
        this.boundaryDome.geometry.dispose();
        this.boundaryMat.dispose();
        this.tetherGeo.dispose();
        this.tetherMat.dispose();
        this.group.removeFromParent();
    }
}
