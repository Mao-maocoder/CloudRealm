import * as T from 'three';
import { readArtStyle } from '../config/settings';
import { atmosphereUniforms } from '../rendering/aerial-perspective';

/**
 * Low-cost 2-layer drifting valley cloud sea for high-altitude overlooks
 * (inspired by Ni Shui Han / Eastern xianxia mountain overlooks).
 * Automatically fades in when camera climbs above ~95m and stays invisible
 * on the valley floor so ground gameplay is completely unobstructed.
 * Cost: 2 draw calls, 4 triangles total, zero raymarching.
 */
export class ValleyCloudSea {
    readonly group = new T.Group();
    private readonly layers: Array<{ mesh: T.Mesh; material: T.ShaderMaterial; minCamY: number }> = [];

    constructor(scene: T.Scene) {
        this.group.name = 'valley-cloud-sea';
        if (readArtStyle() !== 'guofeng') return;

        const configs = [
            // Lowland river-valley cloud sea (Changfeng / Bamboo / Lake / Autumn)
            { y: 62, scale: 0.00062, drift: new T.Vector2(11.0, -5.5), opacity: 0.86, seed: 1.7, minCamY: 95, fullCamY: 215 },
            // Mid-slope hillside mist ribbons
            { y: 145, scale: 0.00046, drift: new T.Vector2(-8.0, 4.5), opacity: 0.74, seed: 8.3, minCamY: 185, fullCamY: 320 },
            // High-alpine & karst-peakland cloud sea wrapping around 青崖峰林, 霁雪天阶 & 浮岚群屿
            { y: 315, scale: 0.00040, drift: new T.Vector2(9.5, 3.8), opacity: 0.78, seed: 14.9, minCamY: 350, fullCamY: 500 },
        ];

        for (const cfg of configs) {
            const geo = new T.PlaneGeometry(11500, 11500, 1, 1);
            geo.rotateX(-Math.PI / 2);
            const mat = new T.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: T.DoubleSide,
                uniforms: {
                    uTime: { value: 0 },
                    uScale: { value: cfg.scale },
                    uDrift: { value: cfg.drift },
                    uOpacity: { value: cfg.opacity },
                    uSeed: { value: cfg.seed },
                    uMinCamY: { value: cfg.minCamY },
                    uFullCamY: { value: cfg.fullCamY },
                    uAtmoMist: atmosphereUniforms.uAtmoMist,
                    uAtmoSunAir: atmosphereUniforms.uAtmoSunAir,
                    uAtmoAir: atmosphereUniforms.uAtmoAir,
                    uAtmoSunDir: atmosphereUniforms.uAtmoSunDir,
                    uAtmoLight: atmosphereUniforms.uAtmoLight,
                    uDuskFactor: atmosphereUniforms.uDuskFactor,
                    uNightFactor: atmosphereUniforms.uNightFactor,
                },
                vertexShader: `
                    varying vec3 vWorldPos;
                    void main() {
                        vec4 wp = modelMatrix * vec4(position, 1.0);
                        vWorldPos = wp.xyz;
                        gl_Position = projectionMatrix * viewMatrix * wp;
                    }
                `,
                fragmentShader: `
                    uniform float uTime, uScale, uOpacity, uSeed, uMinCamY, uFullCamY;
                    uniform float uAtmoLight, uDuskFactor, uNightFactor;
                    uniform vec2 uDrift;
                    uniform vec3 uAtmoMist, uAtmoSunAir, uAtmoAir, uAtmoSunDir;
                    varying vec3 vWorldPos;

                    float cHash(vec2 p) {
                        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                    }
                    float cNoise(vec2 p) {
                        vec2 i = floor(p), f = fract(p);
                        f = f * f * (3.0 - 2.0 * f);
                        return mix(
                            mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x),
                            mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x),
                            f.y
                        );
                    }
                    float cFbm(vec2 p) {
                        float v = 0.0, a = 0.54;
                        mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
                        for (int i = 0; i < 3; i++) {
                            v += a * cNoise(p);
                            p = rot * p * 2.04 + vec2(13.7, -9.2);
                            a *= 0.5;
                        }
                        return v;
                    }

                    void main() {
                        // Only visible when camera overlooks from altitude
                        float altVis = smoothstep(uMinCamY, uFullCamY, cameraPosition.y);
                        if (altVis < 0.004) discard;

                        vec2 delta = vWorldPos.xz - cameraPosition.xz;
                        float dist = length(delta);
                        // Keep immediate foreground crisp, let clouds billow across mid-valley & hide map-edge seams
                        float nearFade = smoothstep(140.0, 620.0, dist);
                        float farFade = 1.0 - smoothstep(3200.0, 5600.0, dist);

                        vec2 p = (vWorldPos.xz + uDrift * uTime) * uScale + vec2(uSeed * 3.1, -uSeed * 2.4);
                        vec2 warp = vec2(
                            cNoise(p * 0.95 + vec2(2.3, -4.1)),
                            cNoise(p * 0.95 + vec2(-6.7, 5.4))
                        );
                        float wisps = cFbm(p + (warp - 0.5) * 1.45);
                        float detail = cNoise(p * 3.4 - warp * 1.1);
                        // Organic ribbon pockets so hills, karst pillars, rivers & villages peek out cleanly between cloud streams
                        float density = smoothstep(0.28, 0.68, wisps * 0.82 + detail * 0.18);

                        // Thicken gently toward outer valley horizon to seamlessly veil the playable terrain boundary
                        float edgeVeil = smoothstep(1050.0, 2600.0, dist) * 0.48;
                        float alpha = clamp((density + edgeVeil * (0.45 + 0.55 * wisps)) * nearFade * farFade * altVis * uOpacity, 0.0, 0.92);
                        if (alpha < 0.005) discard;

                        // Luminous pearlescent sunlit tops + soft cool misty shadow hollows
                        vec3 viewDir = normalize(vWorldPos - cameraPosition);
                        float sunAlign = pow(max(0.0, dot(viewDir, normalize(uAtmoSunDir))), 2.6);
                        vec3 shadowCol = mix(uAtmoAir * 0.96, uAtmoMist * 0.92, 0.62);
                        vec3 litCol = mix(uAtmoMist * 1.12, vec3(1.0, 0.98, 0.95), 0.52 * uAtmoLight);
                        // Ethereal warm peach-gold scatter during Dawn/Dusk (like Ni Shui Han overlook)
                        litCol = mix(litCol, mix(vec3(0.96, 0.86, 0.80), uAtmoSunAir * 1.08, 0.5), uDuskFactor * 0.75);
                        // Quiet silver-blue moonlight at night
                        litCol = mix(litCol, vec3(0.24, 0.34, 0.52), uNightFactor * 0.85);
                        shadowCol = mix(shadowCol, vec3(0.11, 0.17, 0.30), uNightFactor * 0.85);

                        float crest = smoothstep(0.32, 0.82, wisps) * (0.62 + 0.38 * detail);
                        vec3 col = mix(shadowCol, litCol, crest);
                        col += uAtmoSunAir * sunAlign * 0.22 * (1.0 - uNightFactor * 0.75);

                        gl_FragColor = vec4(col, alpha);
                        #include <tonemapping_fragment>
                        #include <colorspace_fragment>
                    }
                `,
            });
            const mesh = new T.Mesh(geo, mat);
            mesh.position.set(400, cfg.y, -250);
            mesh.frustumCulled = false;
            mesh.renderOrder = 1;
            this.group.add(mesh);
            this.layers.push({ mesh, material: mat, minCamY: cfg.minCamY });
        }
        scene.add(this.group);
    }

    update(time: number, camera: T.Camera) {
        if (!this.layers.length) return;
        const camY = camera.position.y;
        const visible = camY > 92;
        this.group.visible = visible;
        if (!visible) return;
        for (const layer of this.layers) {
            const layerVis = camY > layer.minCamY;
            layer.mesh.visible = layerVis;
            if (!layerVis) continue;
            layer.material.uniforms.uTime.value = time;
            layer.mesh.position.x = camera.position.x;
            layer.mesh.position.z = camera.position.z;
        }
    }

    dispose() {
        for (const layer of this.layers) {
            layer.mesh.geometry.dispose();
            layer.material.dispose();
        }
        this.group.removeFromParent();
    }
}
