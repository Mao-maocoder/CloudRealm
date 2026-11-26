import * as T from 'three';
import { detectDevice } from '../config/device';
import { heightAt, randomAt } from '../world/geo/height';
import type { Quality } from '../config/settings';

const MAX_PETALS = 1000;
const counts: Record<Quality, number> = { low: 180, medium: 520, high: 1000 };

/**
 * Drifting sakura petals. A single Points draw call; positions wrap in a box
 * around the camera so the effect follows the player across the valley.
 */
export class Petals {
    readonly points: T.Points;
    private uniforms = {
        uTime: { value: 0 },
        uCam: { value: new T.Vector3() },
        uSize: { value: 0.5 },
    };
    private quality: Quality;

    constructor(scene: T.Scene, quality: Quality) {
        this.quality = quality;
        const positions = new Float32Array(MAX_PETALS * 3), seeds = new Float32Array(MAX_PETALS);
        for (let i = 0; i < MAX_PETALS; i++) {
            positions[i * 3] = randomAt(i, 1, 11) * 120;
            positions[i * 3 + 1] = randomAt(i, 2, 12) * 120;
            positions[i * 3 + 2] = randomAt(i, 3, 13) * 120;
            seeds[i] = randomAt(i, 4, 14);
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
        geometry.setAttribute('aSeed', new T.BufferAttribute(seeds, 1));
        geometry.setDrawRange(0, counts[quality]);
        const material = new T.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: this.uniforms,
            vertexShader: `attribute float aSeed;
                varying float vSeed;
                varying float vAlpha;
                uniform float uTime;
                uniform vec3 uCam;
                uniform float uSize;
                void main(){
                    float box = 120.0;
                    vec3 p = position;
                    p += vec3(2.4, -0.8, 1.5) * uTime;
                    p.x += sin(uTime * 0.7 + aSeed * 6.28) * 2.2;
                    p.y += sin(uTime * 0.55 + aSeed * 4.1) * 1.4;
                    p.z += cos(uTime * 0.62 + aSeed * 3.3) * 2.0;
                    vec3 rel = mod(p - uCam, box) - box * 0.5;
                    vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp(uSize * (0.55 + aSeed * 1.15) * (300.0 / max(1.0, -mv.z)), 1.5, 16.0);
                    vAlpha = smoothstep(0.0, 6.0, -mv.z) * smoothstep(104.0, 58.0, length(rel));
                    vSeed = aSeed;
                }`,
            fragmentShader: `varying float vSeed;
                varying float vAlpha;
                void main(){
                    if (vAlpha < 0.01) discard;
                    vec2 uv = gl_PointCoord - 0.5;
                    float ang = vSeed * 6.283 + 0.6;
                    float c = cos(ang), s = sin(ang);
                    uv = mat2(c, -s, s, c) * uv;
                    float d = length(uv * vec2(1.0, 0.48));
                    float petal = smoothstep(0.34, 0.04, d) * (0.75 + 0.25 * smoothstep(0.0, -0.3, uv.y));
                    float alpha = petal * vAlpha * 0.85;
                    if (alpha < 0.008) discard;
                    vec3 col = mix(vec3(1.0, 0.78, 0.85), vec3(1.0, 0.96, 0.92), vSeed);
                    gl_FragColor = vec4(col, alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`
        });
        this.points = new T.Points(geometry, material);
        this.points.frustumCulled = false;
        scene.add(this.points);
    }

    update(time: number, camera: T.Camera) {
        this.points.visible=camera.position.y-heightAt(camera.position.x,camera.position.z)<64;
        if(!this.points.visible)return;
        this.uniforms.uTime.value = time;
        this.uniforms.uCam.value.copy(camera.position);
    }

    setQuality(quality: Quality) {
        this.quality = quality;
        const scale = detectDevice().isMobile ? 0.65 : 1;
        this.points.geometry.setDrawRange(0, Math.round(counts[this.quality] * scale));
    }

    dispose() {
        this.points.removeFromParent();
        this.points.geometry.dispose();
        (this.points.material as T.Material).dispose();
    }
}
