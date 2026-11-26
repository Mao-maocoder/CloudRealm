import * as T from 'three';
import type { Quality } from '../config/settings';
import { heightAt } from '../world/geo/height';
import { atmosphereUniforms } from '../rendering/aerial-perspective';

const MAX_FIREFLIES = 120;
const SPAN = 68;

/**
 * Lightweight GPU-animated night fireflies drifting above valley meadows & creek banks.
 * Automatically fades in when nightFactor > 0.25 and hides completely during daytime.
 */
export class Fireflies {
    readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
    private readonly uniforms = {
        uTime: { value: 0 },
        uCenter: { value: new T.Vector3() },
        uNightFactor: atmosphereUniforms.uNightFactor,
    };

    constructor(scene: T.Scene, quality: Quality) {
        const positions = new Float32Array(MAX_FIREFLIES * 3);
        const seeds = new Float32Array(MAX_FIREFLIES * 4);
        let seed = 918273;
        const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        for (let i = 0; i < MAX_FIREFLIES; i++) {
            positions[i * 3] = (rand() - .5) * SPAN;
            positions[i * 3 + 1] = 0.7 + rand() * 2.6;
            positions[i * 3 + 2] = (rand() - .5) * SPAN;
            seeds[i * 4] = rand() * Math.PI * 2;
            seeds[i * 4 + 1] = 0.6 + rand() * 1.4;
            seeds[i * 4 + 2] = rand();
            seeds[i * 4 + 3] = 0.7 + rand() * 0.9;
        }
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(positions, 3));
        geo.setAttribute('aSeed', new T.BufferAttribute(seeds, 4));
        const mat = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            toneMapped: false,
            uniforms: this.uniforms,
            vertexShader: `
                attribute vec4 aSeed;
                uniform float uTime, uNightFactor;
                uniform vec3 uCenter;
                varying float vGlow;
                varying float vTint;
                void main() {
                    float vis = smoothstep(.28, .72, uNightFactor);
                    vec3 p = position;
                    p.x += sin(uTime * .45 * aSeed.y + aSeed.x) * 2.4;
                    p.z += cos(uTime * .38 * aSeed.y + aSeed.x * 1.3) * 2.4;
                    p.y += sin(uTime * 1.1 * aSeed.y + aSeed.x * 2.1) * .45;
                    vec3 world = vec3(uCenter.x + p.x, uCenter.y + p.y, uCenter.z + p.z);
                    vec4 mv = modelViewMatrix * vec4(world, 1.);
                    gl_Position = projectionMatrix * mv;
                    float dist = length(mv.xyz);
                    float pulse = .35 + .65 * pow(.5 + .5 * sin(uTime * (1.6 + aSeed.y) + aSeed.x * 3.7), 2.2);
                    float edge = 1. - smoothstep(${(SPAN * .34).toFixed(1)}, ${(SPAN * .5).toFixed(1)}, length(p.xz));
                    vGlow = vis * pulse * edge;
                    vTint = aSeed.z;
                    gl_PointSize = clamp((38. * aSeed.w) / max(2.5, dist), 2.0, 12.0) * step(.01, vGlow);
                }
            `,
            fragmentShader: `
                varying float vGlow;
                varying float vTint;
                void main() {
                    if (vGlow < .01) discard;
                    float d = length(gl_PointCoord - .5);
                    float core = smoothstep(.5, .04, d);
                    float alpha = core * core * vGlow;
                    if (alpha < .01) discard;
                    vec3 col = mix(vec3(.88, 1.0, .42), vec3(1.0, .86, .38), vTint);
                    gl_FragColor = vec4(col * 1.5, alpha * .92);
                    #include <colorspace_fragment>
                }
            `,
        });
        this.points = new T.Points(geo, mat);
        this.points.name = 'night-fireflies';
        this.points.frustumCulled = false;
        this.setQuality(quality);
        scene.add(this.points);
    }

    setQuality(quality: Quality) {
        const count = quality === 'low' ? 40 : quality === 'high' ? MAX_FIREFLIES : 80;
        this.points.geometry.setDrawRange(0, count);
    }

    update(time: number, playerPos: T.Vector3) {
        const visible = atmosphereUniforms.uNightFactor.value > .26 && playerPos.y < 180;
        this.points.visible = visible;
        if (!visible) return;
        this.uniforms.uTime.value = time;
        const gx = Math.round(playerPos.x / 8) * 8;
        const gz = Math.round(playerPos.z / 8) * 8;
        this.uniforms.uCenter.value.set(gx, heightAt(gx, gz), gz);
    }

    dispose() {
        this.points.removeFromParent();
        this.points.geometry.dispose();
        this.points.material.dispose();
    }
}
