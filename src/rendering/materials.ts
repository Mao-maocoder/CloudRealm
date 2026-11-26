import * as T from 'three';

/**
 * Shared stylised rendering helpers: cel-shading ramps, ink outlines and
 * tiny procedurally generated textures. Everything is generated at runtime so
 * the project keeps working without external art downloads.
 */

let gradientMap: T.DataTexture | undefined;

/** Four soft steps: keeps large shapes readable without turning them into flat silhouettes. */
export function toonRamp(): T.DataTexture {
    if (!gradientMap) {
        const data = new Uint8Array([58, 118, 186, 240, 255]);
        gradientMap = new T.DataTexture(data, data.length, 1, T.RedFormat);
        gradientMap.minFilter = T.NearestFilter;
        gradientMap.magFilter = T.NearestFilter;
        gradientMap.generateMipmaps = false;
        gradientMap.needsUpdate = true;
    }
    return gradientMap;
}

export function toonMaterial(color: T.ColorRepresentation, options: { vertexColors?: boolean; transparent?: boolean; opacity?: number; side?: T.Side } = {}) {
    const material = new T.MeshToonMaterial({
        color,
        gradientMap: toonRamp(),
        vertexColors: options.vertexColors ?? false,
        transparent: options.transparent ?? false,
        opacity: options.opacity ?? 1,
        side: options.side ?? T.FrontSide,
    });
    return material;
}

const outlineMaterial = new T.MeshBasicMaterial({ color: '#26313b', side: T.BackSide, fog: true });

/** Classic inverted-hull ink line. Returns a sibling mesh that follows the source transform. */
export function outlineOf(mesh: T.Mesh, thickness = 1.035) {
    const outline = new T.Mesh(mesh.geometry, outlineMaterial);
    outline.position.copy(mesh.position);
    outline.rotation.copy(mesh.rotation);
    outline.scale.copy(mesh.scale).multiplyScalar(thickness);
    outline.renderOrder = -1;
    return outline;
}

/** Soft round alpha texture used for contact shadows and lantern halos (no DOM required). */
export function radialAlphaTexture(size = 64, hardness = 0.15): T.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const center = (size - 1) / 2;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const r = Math.hypot(x - center, y - center) / (size / 2);
            const a = Math.max(0, 1 - T.MathUtils.smoothstep(r, hardness, 1));
            const i = (y * size + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.round(Math.pow(a, 1.35) * 255);
        }
    const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
    texture.minFilter = T.LinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

export function radialShadowTexture() {
    return radialAlphaTexture(48, 0.5);
}
