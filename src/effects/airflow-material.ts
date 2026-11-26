import * as T from 'three';

export interface AirflowMaterialOptions {
    alphaMap: T.Texture;
    flowMap: T.Texture;
    variant?: 'film' | 'fiber';
    speed?: number;
}

/**
 * Airflow shader for the exported sword boost ribbon meshes.
 * UV convention of the exported GLB: tip v=0, tail v=1.
 */
export function createAirflowMaterial({
    alphaMap,
    flowMap,
    variant = 'film',
    speed = 0.38,
}: AirflowMaterialOptions): T.ShaderMaterial {
    const isFiber = variant === 'fiber';
    const uniforms = {
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uAlphaMap: { value: alphaMap },
        uFlowMap: { value: flowMap },
        uBaseAlpha: { value: isFiber ? 0.48 : 0.42 },
        uEdgeAlpha: { value: isFiber ? 0.85 : 0.70 },
        uEmission: { value: isFiber ? 5.2 : 4.3 },
        uDeepColor: { value: new T.Color(0x0a3c60) },
        uBrightColor: { value: new T.Color(0x6ceaff) },
    };

    const material = new T.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
            varying vec2 vUv;
            varying vec3 vNormalV;
            varying vec3 vViewDir;

            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vNormalV = normalize(normalMatrix * normal);
                vViewDir = normalize(-mvPosition.xyz);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D uAlphaMap;
            uniform sampler2D uFlowMap;
            uniform float uTime;
            uniform float uSpeed;
            uniform float uBaseAlpha;
            uniform float uEdgeAlpha;
            uniform float uEmission;
            uniform vec3 uDeepColor;
            uniform vec3 uBrightColor;

            varying vec2 vUv;
            varying vec3 vNormalV;
            varying vec3 vViewDir;

            void main() {
                float mask = texture2D(uAlphaMap, vUv).r;
                if (mask < 0.004) discard;
                float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);

                float f1 = texture2D(uFlowMap, vec2(vUv.x, vUv.y - uTime * uSpeed)).r;
                float f2 = texture2D(uFlowMap, vec2(vUv.x + 0.23, vUv.y - uTime * uSpeed * 1.85 + 0.37)).r;
                float raw = f1 * 0.70 + f2 * 0.30;
                float flow = smoothstep(0.04, 0.40, raw);
                float energy = smoothstep(0.18, 0.65, raw);

                float alpha = mask * min(1.0, uBaseAlpha + uEdgeAlpha * fres) * (0.74 + 0.26 * flow);
                if (alpha < 0.005) discard;
                vec3 color = mix(uDeepColor, uBrightColor, clamp(0.12 + energy * 0.80 + fres * 0.60, 0.0, 1.0));
                float glow = uEmission * (0.12 + energy * 1.0 + fres * 0.30);

                gl_FragColor = vec4(color * (0.22 + glow), alpha);
                #include <colorspace_fragment>
            }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: T.DoubleSide,
        blending: T.NormalBlending,
        toneMapped: false,
    });

    material.userData.airflow = uniforms;
    return material;
}
