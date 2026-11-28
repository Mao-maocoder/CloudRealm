import {CloudBake} from './cloud-bake';
import {makeCloudField,panoramaGLSL} from './sky-panorama';
import {makeDistantMountains} from './distant-mountains';
import {daylight} from '../config/art';
import {readArtStyle} from '../config/settings';
import type {DayNightState} from './day-night';
import * as T from 'three';

/** Baked high clouds, world-anchored panorama, and anime-grade day-night sky with dual-tone clouds, stars & full moon. */
export class Sky {
    readonly mesh: T.Mesh;
    private cloudBake: CloudBake;
    private panoTexture?: T.Texture;
    private readonly isGuofeng = readArtStyle() === 'guofeng';
    readonly sunDirection = new T.Vector3(...daylight).normalize();
    readonly moonDirection = new T.Vector3(-daylight[0], -daylight[1], -daylight[2]).normalize();
    private readonly cloudField = makeCloudField();
    private readonly mountains = makeDistantMountains(this.sunDirection);
    private uniforms = {
        uCloudTex: { value: null as T.Texture | null },
        uCloudOn: { value: 0 },
        uPanoTex: { value: null as T.Texture | null },
        uPanoOn: { value: 0 },
        uOmenMix: { value: 0 },
        uTime: { value: 0 },
        uSun: { value: this.sunDirection },
        uMoon: { value: this.moonDirection },
        uCloudField: { value: this.cloudField },
        uZenith: { value: new T.Color('#0842b8') },
        uMid: { value: new T.Color('#1c78e0') },
        uHorizon: { value: new T.Color('#7cc6f2') },
        uGlow: { value: new T.Color('#ffd285') },
        uCloudLit: { value: new T.Color('#ffffff') },
        uCloudShadow: { value: new T.Color('#9cc0e6') },
        uDayFactor: { value: 1.0 },
        uNightFactor: { value: 0.0 },
        uDuskFactor: { value: 0.0 },
    };

    constructor(scene: T.Scene) {
        this.cloudBake = new CloudBake(this.sunDirection);
        this.uniforms.uCloudTex.value = this.cloudBake.target.texture;
        if (this.isGuofeng && typeof window !== 'undefined') {
            const url = new URL('../../resource/sky/guofeng_sky_pano.jpg', import.meta.url).href;
            const tex = new T.TextureLoader().load(url, loaded => {
                loaded.colorSpace = T.SRGBColorSpace;
                loaded.wrapS = T.RepeatWrapping;
                loaded.wrapT = T.ClampToEdgeWrapping;
                // Disable mipmaps to prevent GPU dFdx(atan) derivative wrap-around seam line at ±π meridian.
                loaded.generateMipmaps = false;
                loaded.minFilter = T.LinearFilter;
                loaded.magFilter = T.LinearFilter;
                loaded.needsUpdate = true;
                this.uniforms.uPanoTex.value = loaded;
                this.uniforms.uPanoOn.value = 1;
            });
            this.panoTexture = tex;
        }
        const material = new T.ShaderMaterial({
            side: T.BackSide,
            depthWrite: false,
            depthTest: true,
            fog: false,
            uniforms: this.uniforms,
            vertexShader: `varying vec3 vDir;
                void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
            fragmentShader: `varying vec3 vDir;
                uniform float uTime, uDayFactor, uNightFactor, uDuskFactor, uOmenMix;
                uniform vec3 uSun, uMoon, uZenith, uMid, uHorizon, uGlow, uCloudLit, uCloudShadow;
                uniform sampler2D uCloudTex;
                uniform float uCloudOn;
                uniform sampler2D uPanoTex;
                uniform float uPanoOn;
                ${panoramaGLSL}
                float starHash(vec3 p) {
                    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                    p += dot(p, p.yzx + 19.19);
                    return fract((p.x + p.y) * p.z);
                }
                float starField(vec3 dir, float t) {
                    vec3 grid = dir * 185.;
                    vec3 cell = floor(grid);
                    vec3 f = fract(grid) - .5;
                    float rnd = starHash(cell);
                    if (rnd < .985) return 0.;
                    float d = length(f);
                    float size = mix(.08, .22, fract(rnd * 73.1));
                    float twinkle = .70 + .30 * sin(t * (1.8 + fract(rnd * 19.7) * 3.4) + rnd * 62.8);
                    return smoothstep(size, 0., d) * twinkle * mix(.45, 1.4, fract(rnd * 31.3));
                }
                void main(){
                    vec3 d = normalize(vDir);
                    float h = d.y;
                    float sun = max(dot(d, uSun), 0.0);
                    float moon = max(dot(d, uMoon), 0.0);

                    // Multi-stop anime sky gradient with warm horizon scatter band at dawn/dusk.
                    float horizonBand = 1. - smoothstep(-.02, .34, abs(h));
                    vec3 horizon = uHorizon + uGlow * (.34 * pow(sun, 2.8) * (.55 + uDuskFactor * 1.45) + .16 * horizonBand * uDuskFactor);
                    vec3 c = mix(horizon, uMid, smoothstep(-.05, .28, h));
                    c = mix(c, uZenith, smoothstep(.22, .84, h));
                    float skylight = smoothstep(.20, .89, -d.z) * smoothstep(.015, .34, h);
                    c = mix(c, uMid * .82, skylight * .22 * uDayFactor);
                    c = mix(c, uHorizon * 1.04, smoothstep(.02, .54, -h));

                    // Luminous sun disc, warm Mie scattering corona & subtle golden rays at low elevation.
                    float sunVis = smoothstep(-.05, .07, uSun.y);
                    float sunHalo = (.18 * pow(sun, 6.) + .45 * pow(sun, 48.)) * (1. + uDuskFactor * 1.1);
                    c += uGlow * sunHalo * sunVis;
                    c += vec3(1., .96, .84) * 3.2 * smoothstep(.99962, .99988, sun) * sunVis;

                    // Full luminous pearl Moon, wide sapphire halo & twinkling starfield at night.
                    if (uNightFactor > .02 && h > -.02) {
                        float skyVis = smoothstep(0., .24, h) * uNightFactor;
                        float stars = starField(d, uTime) * skyVis;
                        c += mix(vec3(.80, .90, 1.), vec3(1., .95, .86), fract(d.x * 13.7)) * stars * 1.1;
                        float moonVis = smoothstep(-.02, .10, uMoon.y) * uNightFactor;
                        c += vec3(.45, .70, 1.0) * (.22 * pow(moon, 7.) + .48 * pow(moon, 56.)) * moonVis;
                        float disc = smoothstep(.99865, .99905, moon) * moonVis;
                        float maria = .84 + .16 * sin(d.x * 210. + d.y * 165.) * cos(d.z * 195. - d.x * 110.);
                        c = mix(c, vec3(.96, .98, 1.0) * maria * 1.55, disc);
                    }

                    if (uPanoOn > .5 && uNightFactor < .98) {
                        // Seamless 360° equirectangular realistic sky dome with slow cloud drift & dynamic time-of-day tinting
                        float az = fract(atan(d.z, d.x) / 6.2831853 + .5 + uTime * .0009);
                        float el = clamp(asin(clamp(d.y, -1., 1.)) / 3.14159265 + .5, .002, .998);
                        vec3 pano = texture2D(uPanoTex, vec2(az, el)).rgb;
                        float panoLuma = dot(pano, vec3(.30, .59, .11));
                        // Re-tint realistic clouds/sky gracefully during Dawn/Dusk & Celestial Omen
                        vec3 duskTint = mix(vec3(.68, .54, .68), vec3(1.18, .76, .52), smoothstep(.32, .85, panoLuma));
                        pano = mix(pano, pano * duskTint, uDuskFactor * .78);
                        pano = mix(pano, vec3(.14, .19, .30) * (.55 + .85 * panoLuma), uOmenMix * .86);
                        // Blend smoothly into night sky at twilight; preserve dynamic sun disc & lower cloud sea
                        float panoWeight = (1. - smoothstep(.12, .88, uNightFactor)) * smoothstep(-.12, .05, h);
                        c = mix(c, pano, panoWeight);
                        // Re-add crisp live sun corona & disc over the realistic sky
                        c += uGlow * sunHalo * sunVis * .45 * panoWeight;
                        c += vec3(1., .96, .86) * 2.4 * smoothstep(.99962, .99988, sun) * sunVis * panoWeight;
                        // Keep high-altitude lower cloud sea when flying above 226m
                        if (d.y < 0. && cameraPosition.y > 226.) {
                            c = cloudBank(c, d, 198., vec2(-2.5, 1.6), .95, sun);
                            c = cloudBank(c, d, 312., vec2(-3.7, .85), .75, sun);
                        }
                    } else {
                    if (h > 0.) {
                        float cirrusDistance = (4940. - cameraPosition.y) / max(.12, h);
                        vec2 highCloud = (cameraPosition.xz + d.xz * cirrusDistance + vec2(-8., 3.) * uTime) / 18500.;
                        highCloud = mat2(.86, .50, -.50, .86) * highCloud;
                        vec3 veil = texture2D(uCloudField, highCloud * vec2(.65, 1.63) + vec2(.18, .64)).rgb;
                        float wisps = smoothstep(.50, .74, veil.r * .66 + veil.g * .34) * smoothstep(.15, .50, h);
                        vec3 wispCol = mix(uCloudShadow, uCloudLit, .75 + .25 * pow(sun, 3.));
                        c = mix(c, wispCol, wisps * .28 * (.45 + .55 * uDayFactor + .30 * uDuskFactor));
                        if (uCloudOn > .5) {
                            vec3 eye = cameraPosition - vec3(0., 80., 0.);
                            float along = dot(eye, d);
                            float reach = sqrt(max(0., along * along + 7100. * 7100. - dot(eye, eye))) - along;
                            vec3 worldRay = normalize(eye + d * reach + vec3(uTime * 1.8, 0., -uTime * .52));
                            vec2 uv = vec2(skyAzimuth(worldRay.xz), sqrt(asin(clamp(worldRay.y, 0., 1.)) / 1.5707963));
                            vec4 cloud = texture2D(uCloudTex, uv);
                            if (cloud.a > .005) {
                                // Dual-tone anime cloud shading: lit crests vs rich shadow bellies + sun/moon silver lining!
                                vec3 unpremul = cloud.rgb / max(cloud.a, .005);
                                float luma = clamp(dot(unpremul, vec3(.30, .59, .11)), 0., 1.2);
                                float litMask = smoothstep(.28, .92, luma);
                                vec3 shaded = mix(uCloudShadow, uCloudLit, litMask);
                                float rimGlow = (pow(sun, 5.) * sunVis * (.35 + uDuskFactor * .85) + pow(moon, 9.) * uNightFactor * .85);
                                shaded += uGlow * rimGlow * (.25 + .75 * litMask);
                                c = mix(c, shaded, cloud.a * (1. - uNightFactor * .15));
                            }
                        }
                    }
                    c = paintPanorama(c, d, sun, moon);
                    }
                    gl_FragColor = vec4(c, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`
        });
        this.mesh = new T.Mesh(new T.SphereGeometry(1, 48, 32), material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -1001;
        scene.add(this.mountains, this.mesh);
    }

    applyDayNight(s: DayNightState) {
        this.sunDirection.copy(s.sunDirection);
        this.moonDirection.copy(s.moonDirection);
        this.uniforms.uZenith.value.copy(s.skyZenith);
        this.uniforms.uMid.value.copy(s.skyMid);
        this.uniforms.uHorizon.value.copy(s.skyHorizon);
        this.uniforms.uGlow.value.copy(s.skyGlow);
        this.uniforms.uCloudLit.value.copy(s.cloudLit);
        this.uniforms.uCloudShadow.value.copy(s.cloudShadow);
        this.uniforms.uDayFactor.value = s.dayFactor;
        this.uniforms.uNightFactor.value = s.nightFactor;
        this.uniforms.uDuskFactor.value = s.duskFactor;
        this.uniforms.uOmenMix.value = 0;
    }

    private readonly omenZenith = new T.Color('#080d1b');
    private readonly omenMid = new T.Color('#131b30');
    private readonly omenHorizon = new T.Color('#232d45');
    private readonly omenGlow = new T.Color('#c89c52');
    private readonly omenCloudLit = new T.Color('#4a5878');
    private readonly omenCloudShadow = new T.Color('#101728');
    private readonly omenFlashCol = new T.Color('#8c9cc9');
    private readonly gfZenith = new T.Color('#1d4f94');
    private readonly gfMid = new T.Color('#5184b8');
    private readonly gfHorizon = new T.Color('#c8dce8');
    private readonly gfCloudLit = new T.Color('#faf6ed');
    private readonly gfCloudShadow = new T.Color('#7c98b8');

    applyGuofengBlend(weight: number, dayFactor: number) {
        const k = T.MathUtils.clamp(weight * dayFactor, 0, 1);
        if (k <= 0.001) return;
        this.uniforms.uZenith.value.lerp(this.gfZenith, k * 0.78);
        this.uniforms.uMid.value.lerp(this.gfMid, k * 0.80);
        this.uniforms.uHorizon.value.lerp(this.gfHorizon, k * 0.82);
        this.uniforms.uCloudLit.value.lerp(this.gfCloudLit, k * 0.65);
        this.uniforms.uCloudShadow.value.lerp(this.gfCloudShadow, k * 0.72);
    }

    applyOmenBlend(intensity: number, flash: number, goldWeight = 0) {
        if (intensity <= 0.001) return;
        const k = T.MathUtils.clamp(intensity, 0, 1);
        this.uniforms.uOmenMix.value = k;
        const f = T.MathUtils.clamp(flash * k * 0.22, 0, 0.28);
        const g = T.MathUtils.clamp(goldWeight, 0, 1);
        this.uniforms.uZenith.value.lerp(this.omenZenith, k * 0.90).lerp(this.omenFlashCol, f * 0.35);
        this.uniforms.uMid.value.lerp(this.omenMid, k * 0.88).lerp(this.omenFlashCol, f * 0.50);
        this.uniforms.uHorizon.value.lerp(this.omenHorizon, k * 0.84).lerp(this.omenFlashCol, f * 0.42);
        this.uniforms.uGlow.value.lerp(this.omenGlow, k * (0.55 + 0.35 * g));
        this.uniforms.uCloudLit.value.lerp(this.omenCloudLit, k * 0.86).lerp(this.omenFlashCol, f * 0.75);
        this.uniforms.uCloudShadow.value.lerp(this.omenCloudShadow, k * 0.90);
    }

    update(time: number, camera: T.Camera) {
        this.uniforms.uTime.value = time;
        this.mesh.position.copy(camera.position);
    }

    get cloudsBaked() {
        return this.cloudBake.done;
    }

    bake(renderer: T.WebGLRenderer) {
        if (this.cloudBake.step(renderer)) this.uniforms.uCloudOn.value = 1;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.cloudBake.dispose();
        this.panoTexture?.dispose();
        this.cloudField.dispose();
        this.mountains.removeFromParent();
        this.mountains.geometry.dispose();
        this.mountains.material.dispose();
        this.mesh.geometry.dispose();
        (this.mesh.material as T.Material).dispose();
    }
}
