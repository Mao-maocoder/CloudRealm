import * as T from 'three';
import type { Quality } from '../config/settings';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../rendering/aerial-perspective';

const MAX_BIRDS = 126;
const TILE_SPAN = 1500;

function seeded(n: number) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
}

/** Graceful soaring crane/swallow silhouette with wing-flex weights for GPU flapping. */
function makeBirdGeometry() {
    // Local space: +Z forward (beak), +X right wing, +Y up.
    const pos: number[] = [];
    const wing: number[] = [];
    const shade: number[] = [];
    const idx: number[] = [];

    const pushV = (x: number, y: number, z: number, w: number, s: number) => {
        pos.push(x, y, z);
        wing.push(w);
        shade.push(s);
        return pos.length / 3 - 1;
    };

    // Slender fuselage + forked tail
    const beak = pushV(0, .02, 1.05, 0, 1.0);
    const chestL = pushV(-.14, -.04, .25, .05, .86);
    const chestR = pushV(.14, -.04, .25, .05, .86);
    const back = pushV(0, .10, .15, 0, 1.05);
    const tailRoot = pushV(0, .02, -.55, 0, .92);
    const tailL = pushV(-.24, .04, -1.05, .12, .80);
    const tailR = pushV(.24, .04, -1.05, .12, .80);

    idx.push(
        beak, back, chestL,
        beak, chestR, back,
        back, tailRoot, chestL,
        back, chestR, tailRoot,
        tailRoot, tailL, tailR,
    );

    // Swept tapered wings (inner + outer segments for realistic arched flapping)
    for (const side of [-1, 1]) {
        const rootF = pushV(side * .12, .05, .32, .08, .98);
        const rootB = pushV(side * .12, .02, -.22, .08, .88);
        const midF = pushV(side * .88, .12, .22, .52, 1.04);
        const midB = pushV(side * .78, .06, -.28, .48, .84);
        const tip = pushV(side * 1.78, .08, -.32, 1.0, .62);

        if (side > 0) {
            idx.push(
                rootF, rootB, midF,
                midF, rootB, midB,
                midF, midB, tip,
            );
        } else {
            idx.push(
                rootF, midF, rootB,
                midF, midB, rootB,
                midF, tip, midB,
            );
        }
    }

    const base = new T.BufferGeometry();
    base.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    base.setAttribute('aWing', new T.Float32BufferAttribute(wing, 1));
    base.setAttribute('aShade', new T.Float32BufferAttribute(shade, 1));
    base.setIndex(idx);
    base.computeVertexNormals();

    const inst = new T.InstancedBufferGeometry();
    inst.index = base.index;
    inst.attributes.position = base.attributes.position;
    inst.attributes.normal = base.attributes.normal;
    inst.attributes.aWing = base.attributes.aWing;
    inst.attributes.aShade = base.attributes.aShade;

    // 14 flocks arranged in V-formations and loose soaring arcs across 75m..420m altitude.
    const flockCenter = new Float32Array(MAX_BIRDS * 4); // x, y, z, orbitRadius
    const flockOffset = new Float32Array(MAX_BIRDS * 4); // forward, right, up, scale
    const birdPhase = new Float32Array(MAX_BIRDS * 4);   // speed, phase, flapRate, tint

    const flockCount = 14;
    let cursor = 0;
    for (let f = 0; f < flockCount && cursor < MAX_BIRDS; f++) {
        const fx = (seeded(f * 13 + 1) - .5) * TILE_SPAN;
        const fz = (seeded(f * 13 + 2) - .5) * TILE_SPAN;
        // Spread flocks from low valley sky (75m) up to high sword-flight altitude (410m).
        const fy = 75 + seeded(f * 13 + 3) * 335;
        const orbit = 95 + seeded(f * 13 + 4) * 165;
        const speed = (.09 + seeded(f * 13 + 5) * .08) * (f % 2 === 0 ? 1 : -1);
        const fPhase = seeded(f * 13 + 6) * Math.PI * 2;
        const members = Math.min(MAX_BIRDS - cursor, 7 + Math.floor(seeded(f * 13 + 7) * 5));

        for (let m = 0; m < members; m++) {
            const i4 = cursor * 4;
            const rank = m === 0 ? 0 : Math.ceil(m / 2);
            const wingSide = m % 2 === 0 ? 1 : -1;
            const jitterX = (seeded(cursor * 19 + 1) - .5) * 4.5;
            const jitterY = (seeded(cursor * 19 + 2) - .5) * 3.8;
            const jitterZ = (seeded(cursor * 19 + 3) - .5) * 4.5;

            flockCenter[i4] = fx;
            flockCenter[i4 + 1] = fy;
            flockCenter[i4 + 2] = fz;
            flockCenter[i4 + 3] = orbit;

            flockOffset[i4] = -rank * 6.2 + jitterZ;               // trail behind leader
            flockOffset[i4 + 1] = wingSide * rank * 5.8 + jitterX; // V-formation lateral spread
            flockOffset[i4 + 2] = rank * .65 + jitterY;
            flockOffset[i4 + 3] = 1.05 + seeded(cursor * 19 + 4) * .75;

            birdPhase[i4] = speed;
            birdPhase[i4 + 1] = fPhase;
            birdPhase[i4 + 2] = 4.6 + seeded(cursor * 19 + 5) * 1.8;
            birdPhase[i4 + 3] = seeded(cursor * 19 + 6);
            cursor++;
        }
    }

    inst.setAttribute('aFlockCenter', new T.InstancedBufferAttribute(flockCenter, 4));
    inst.setAttribute('aFlockOffset', new T.InstancedBufferAttribute(flockOffset, 4));
    inst.setAttribute('aBirdPhase', new T.InstancedBufferAttribute(birdPhase, 4));
    inst.instanceCount = MAX_BIRDS;
    return inst;
}

/**
 * Single-draw-call GPU-animated soaring bird flocks that wrap seamlessly around
 * the camera, giving high-altitude sword flight life and depth.
 */
export class SkyBirds {
    private readonly mesh: T.Mesh;
    private readonly uniforms = {
        uTime: { value: 0 },
        uCenter: { value: new T.Vector3() },
        uSun: { value: new T.Vector3(0.4, 0.7, 0.5).normalize() },
    };

    constructor(scene: T.Scene, quality: Quality, sunDirection: T.Vector3) {
        this.uniforms.uSun.value.copy(sunDirection);
        const geometry = makeBirdGeometry();
        const material = new T.ShaderMaterial({
            transparent: true,
            depthWrite: true,
            side: T.DoubleSide,
            uniforms: { ...this.uniforms, ...atmosphereUniforms },
            vertexShader: `
                attribute float aWing;
                attribute float aShade;
                attribute vec4 aFlockCenter;
                attribute vec4 aFlockOffset;
                attribute vec4 aBirdPhase;
                uniform float uTime;
                uniform vec3 uCenter;
                varying vec3 vWorld;
                varying vec3 vNormal;
                varying float vShade;
                varying float vTint;
                varying float vFade;

                void main() {
                    float speed = aBirdPhase.x;
                    float theta = aBirdPhase.y + uTime * speed;
                    float orbit = aFlockCenter.w;

                    // Wrap flock anchor smoothly inside a tile centred on the camera.
                    vec2 anchor = aFlockCenter.xz + vec2(uTime * 3.8, -uTime * 2.1);
                    anchor = uCenter.xz + mod(anchor - uCenter.xz + ${(TILE_SPAN * .5).toFixed(1)}, ${TILE_SPAN.toFixed(1)}) - ${(TILE_SPAN * .5).toFixed(1)};

                    vec2 circle = vec2(cos(theta), sin(theta)) * orbit;
                    vec2 forwardXZ = normalize(vec2(-sin(theta), cos(theta)) * sign(speed));
                    vec2 rightXZ = vec2(-forwardXZ.y, forwardXZ.x);

                    // Flap-and-glide cadence so birds alternate active beats with serene soaring.
                    float glideWave = sin(uTime * .42 + aBirdPhase.y * 3.7 + aBirdPhase.w * 6.28);
                    float flapEnv = mix(.14, 1.0, smoothstep(.05, .62, glideWave));
                    float flap = sin(uTime * aBirdPhase.z + aBirdPhase.w * 6.283 + aBirdPhase.y) * flapEnv;

                    vec3 local = position;
                    // Wing arch & vertical beat proportional to span distance aWing.
                    local.y += flap * aWing * .62 + aWing * aWing * .16 * (1. - flapEnv);
                    local *= aFlockOffset.w;

                    // Gentle bank into the turn.
                    float bank = sign(speed) * .24;
                    float cb = cos(bank), sb = sin(bank);
                    local.xy = mat2(cb, -sb, sb, cb) * local.xy;

                    vec3 worldPos = vec3(
                        anchor.x + circle.x + forwardXZ.x * aFlockOffset.x + rightXZ.x * aFlockOffset.y,
                        aFlockCenter.y + aFlockOffset.z + sin(theta * 2. + aBirdPhase.w * 5.) * 6.5,
                        anchor.y + circle.y + forwardXZ.y * aFlockOffset.x + rightXZ.y * aFlockOffset.y
                    );
                    worldPos += vec3(
                        rightXZ.x * local.x + forwardXZ.x * local.z,
                        local.y,
                        rightXZ.y * local.x + forwardXZ.y * local.z
                    );

                    vWorld = worldPos;
                    vNormal = normalize(vec3(rightXZ.x * normal.x + forwardXZ.x * normal.z, normal.y, rightXZ.y * normal.x + forwardXZ.y * normal.z));
                    vShade = aShade;
                    vTint = aBirdPhase.w;
                    float edgeDist = max(abs(worldPos.x - uCenter.x), abs(worldPos.z - uCenter.z));
                    vFade = 1. - smoothstep(${(TILE_SPAN * .38).toFixed(1)}, ${(TILE_SPAN * .49).toFixed(1)}, edgeDist);

                    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.);
                }
            `,
            fragmentShader: `
                uniform vec3 uSun;
                varying vec3 vWorld;
                varying vec3 vNormal;
                varying float vShade;
                varying float vTint;
                varying float vFade;
                ${aerialPerspectiveGLSL}

                void main() {
                    if (vFade < .02) discard;
                    vec3 n = normalize(vNormal);
                    if (!gl_FrontFacing) n = -n;
                    float lit = .48 + .52 * max(0., dot(n, uSun));
                    vec3 ivory = mix(vec3(.96, .95, .90), vec3(.86, .91, .95), vTint * .55);
                    ivory = mix(ivory, vec3(1.06, 1.05, 1.02), uGuofengStyle * .65);
                    vec3 col = ivory * mix(vShade, .72 + .34 * vShade, uGuofengStyle) * lit * mix(vec3(.30, .40, .60), vec3(1.), uAtmoLight);
                    col = mix(col, applyAerialPerspective(col, vWorld), mix(.48, .28, uGuofengStyle));
                    gl_FragColor = vec4(col, vFade);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
        });

        this.mesh = new T.Mesh(geometry, material);
        this.mesh.name = 'sky-soaring-birds';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;
        scene.add(this.mesh);
        this.setQuality(quality);
    }

    setQuality(quality: Quality) {
        const geo = this.mesh.geometry as T.InstancedBufferGeometry;
        geo.instanceCount = quality === 'low' ? 70 : quality === 'medium' ? 105 : MAX_BIRDS;
    }

    update(time: number, camera: T.Camera) {
        this.uniforms.uTime.value = time;
        this.uniforms.uCenter.value.copy(camera.position);
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        (this.mesh.material as T.Material).dispose();
    }
}
