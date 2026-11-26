import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export const SWORD_SLASH_DURATION = 2.5;

const FRAME_COLUMNS = 5;
const FRAME_ROWS = 6;
const FRAME_COUNT = FRAME_COLUMNS * FRAME_ROWS;
const SOURCE_TRAVEL = 2.79;
const flightTrack = [
    1.31, 1.267273, 1.217671, 1.161022, 1.097167, 1.026282,
    0.948877, 0.865475, 0.7766, 0.682776, 0.584527, 0.482375,
    0.376837, 0.26822, 0.156627, 0.042151, -0.075113, -0.195073,
    -0.317635, -0.442706, -0.570192, -0.7, -0.831247, -0.959895,
    -1.081116, -1.190084, -1.281971, -1.352234, -1.402894, -1.442527,
    -1.48,
];

const vertexShader = `
  varying vec2 vTileUV;

  void main() {
    vTileUV = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uAtlas;
  uniform vec2 uFrameA;
  uniform vec2 uFrameB;
  uniform float uFrameMix;
  uniform float uIntensity;
  uniform float uAge;
  varying vec2 vTileUV;

  vec4 sampleAtlas(vec2 tileUV) {
    const vec2 grid = vec2(${FRAME_COLUMNS}.0, ${FRAME_ROWS}.0);
    vec4 a = texture2D(uAtlas, (uFrameA + tileUV) / grid);
    vec4 b = texture2D(uAtlas, (uFrameB + tileUV) / grid);
    return mix(a, b, uFrameMix);
  }

  vec4 cuttingLight(float along, float behind) {
    float point = smoothstep(0., .067, min(along, 1. - along));
    float frontFade = smoothstep(0., .09, behind);
    float activeBody = frontFade * (1. - smoothstep(.33, .93, behind));
    float blade = frontFade * (1. - smoothstep(.18, .39, behind));
    float crest = smoothstep(.07, .12, behind) * (1. - smoothstep(.19, .28, behind));
    float bands = pow(max(0., sin(86. * along + 8. * behind - 21. * uAge
      + 2.2 * sin(28. * along))), 5.);
    float fibers = bands * smoothstep(.16, .37, behind) * (1. - smoothstep(.55, .88, behind));
    vec3 jade = mix(vec3(.018, .28, .51), vec3(.10, .83, .94), blade);
    jade = mix(jade, vec3(.83, 1.12, 1.13), crest * .91);
    jade += vec3(.027, .22, .29) * fibers;
    float release = 1. - smoothstep(.15, .66, uAge);
    float fade = 1. - smoothstep(1.29, ${SWORD_SLASH_DURATION}, uAge);
    float energy = min(1.25, uIntensity * (.73 + .46 * release)) * fade;
    return vec4(jade, point * (activeBody * .65 + blade * .40 + fibers * .19) * energy);
  }

  void main() {
    vec4 sampleColor = sampleAtlas(vTileUV);
    float alpha = sampleColor.a;
    vec3 emission = sampleColor.rgb * (6.0 / max(.001, alpha));
    float peak = max(max(emission.r, emission.g), emission.b);
    float crest = smoothstep(.78, 1.62, peak * pow(alpha, .35));
    vec3 tint = mix(vec3(.075, .59, 1.), vec3(.78, .98, 1.), crest);
    vec3 light = mix(emission, tint * peak, .58) * (1.15 * uIntensity) * alpha;

    if (vTileUV.y < .5) {
      float behind = clamp((.47533 - vTileUV.y) / .46053, 0., 1.);
      float crestAlpha = sampleAtlas(vec2(vTileUV.x, 128.5 / 304.)).a;
      float present = smoothstep(.015, .65, crestAlpha);
      vec4 edge = cuttingLight(vTileUV.x, behind);
      float coverage = clamp(edge.a * present, 0., 1.);
      float underlay = mix(1., mix(.34, 1., smoothstep(.25, .69, behind)), present);
      light = light * (underlay * (1. - coverage)) + edge.rgb * coverage;
      alpha = alpha * underlay * (1. - coverage) + coverage;
    }

    if (alpha < .001) discard;
    gl_FragColor = vec4(light / alpha, alpha);
    #include <colorspace_fragment>
  }
`;

export interface SwordSlashCreateOptions {
    loop?: boolean;
    travel?: number;
    intensity?: number;
    renderOrder?: number;
}

export interface SwordSlashInstance {
    readonly object: T.Group;
    readonly finished: boolean;
    seek(seconds: number): void;
    update(deltaSeconds: number): void;
    travelPoint(target?: T.Vector3): T.Vector3;
    dispose(): void;
}

export interface SwordSlashAsset {
    create(options?: SwordSlashCreateOptions): SwordSlashInstance;
    dispose(): void;
}

function setTile(target: T.Vector2, frame: number) {
    target.set(frame % FRAME_COLUMNS, Math.floor(frame / FRAME_COLUMNS));
}

function namedMesh(gltf: GLTF, name: string): T.Mesh {
    const mesh = gltf.scene.getObjectByName(name);
    if (!(mesh instanceof T.Mesh) || !mesh.geometry.hasAttribute('uv')) {
        throw new Error(`Sword slash GLB is missing the ${name} mesh or its atlas UVs`);
    }
    return mesh;
}

export async function loadSwordSlash({ manager }: { manager?: T.LoadingManager } = {}): Promise<SwordSlashAsset> {
    const meshURL = new URL('../../resource/attack/sword-slash/sword-slash.glb', import.meta.url);
    const atlasURL = new URL('../../resource/attack/sword-slash/sword-slash-atlas.png', import.meta.url);
    const [gltf, atlas] = await Promise.all([
        new GLTFLoader(manager).loadAsync(meshURL.href),
        new T.TextureLoader(manager).loadAsync(atlasURL.href),
    ]);

    atlas.colorSpace = T.SRGBColorSpace;
    atlas.flipY = false;
    atlas.generateMipmaps = false;
    atlas.minFilter = T.LinearFilter;
    atlas.magFilter = T.LinearFilter;
    atlas.needsUpdate = true;

    const crescent = namedMesh(gltf, 'Crescent');
    const wake = namedMesh(gltf, 'Wake');
    const sourceMeshes = [crescent, wake];
    const instances = new Set<() => void>();
    let assetDisposed = false;

    function create({ loop = false, travel = SOURCE_TRAVEL, intensity = 1, renderOrder = 0 }: SwordSlashCreateOptions = {}): SwordSlashInstance {
        if (assetDisposed) throw new Error('Sword slash asset has been disposed');
        if (!Number.isFinite(travel) || travel < 0 || !Number.isFinite(intensity) || intensity < 0 || !Number.isFinite(renderOrder)) {
            throw new RangeError('Sword slash expects non-negative travel and intensity, and a finite renderOrder');
        }

        const object = new T.Group();
        object.name = 'Sword Slash';
        object.renderOrder = renderOrder;
        const flight = new T.Group();
        flight.renderOrder = renderOrder;
        object.add(flight);
        const material = new T.ShaderMaterial({
            name: 'Sword Slash Atlas',
            uniforms: {
                uAtlas: { value: atlas },
                uFrameA: { value: new T.Vector2() },
                uFrameB: { value: new T.Vector2() },
                uFrameMix: { value: 0 },
                uIntensity: { value: intensity },
                uAge: { value: 0 },
            },
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            side: T.DoubleSide,
            forceSinglePass: true,
            toneMapped: false,
        });

        for (const [index, source] of sourceMeshes.entries()) {
            const mesh = new T.Mesh(source.geometry, material);
            mesh.name = source.name;
            mesh.position.copy(source.position);
            mesh.quaternion.copy(source.quaternion);
            mesh.scale.copy(source.scale);
            mesh.renderOrder = renderOrder + index;
            flight.add(mesh);
        }

        let elapsed = 0;
        let finished = false;
        let instanceDisposed = false;

        function seek(seconds: number) {
            if (instanceDisposed) return;
            if (!Number.isFinite(seconds)) throw new RangeError('Sword slash time must be finite');
            const time = Math.max(seconds, 0);
            elapsed = loop ? time % SWORD_SLASH_DURATION : Math.min(time, SWORD_SLASH_DURATION);
            finished = !loop && elapsed >= SWORD_SLASH_DURATION;
            object.visible = !finished;
            const sample = elapsed * FRAME_COUNT / SWORD_SLASH_DURATION;
            const current = Math.min(Math.floor(sample), FRAME_COUNT - 1);
            const next = current + 1;
            const fraction = sample - current;
            setTile(material.uniforms.uFrameA.value, current);
            setTile(material.uniforms.uFrameB.value, next % FRAME_COUNT);
            material.uniforms.uFrameMix.value = fraction;
            material.uniforms.uAge.value = elapsed;
            const from = flightTrack[current];
            const trackPosition = from + (flightTrack[next] - from) * fraction;
            flight.position.x = (trackPosition - flightTrack[0]) * travel / SOURCE_TRAVEL;
        }

        function update(deltaSeconds: number) {
            seek(elapsed + Math.max(deltaSeconds, 0));
        }

        function dispose() {
            if (instanceDisposed) return;
            instanceDisposed = true;
            object.removeFromParent();
            material.dispose();
            instances.delete(dispose);
        }

        instances.add(dispose);
        seek(0);
        return {
            object,
            seek,
            update,
            dispose,
            travelPoint: (target = new T.Vector3()) => flight.getWorldPosition(target),
            get finished() { return finished; },
        };
    }

    function dispose() {
        if (assetDisposed) return;
        assetDisposed = true;
        for (const remove of instances) remove();
        for (const geometry of new Set(sourceMeshes.map(mesh => mesh.geometry))) geometry.dispose();
        for (const material of new Set(sourceMeshes.flatMap(mesh => [mesh.material].flat()))) material.dispose();
        atlas.dispose();
    }

    return { create, dispose };
}
