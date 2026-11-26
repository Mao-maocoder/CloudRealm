import * as T from 'three';
import { bankField, riverbankFieldData } from '../world/geo/riverbank-habitat';

export function makeRiverbankTexture() {
    const texture = new T.DataTexture(riverbankFieldData(), bankField.width, bankField.depth);
    texture.minFilter = texture.magFilter = T.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

const { left, north, step, width, depth } = bankField;
export const riverbankGLSL = `
uniform sampler2D uRiverbank;
vec4 riverbankHabitat(vec2 p) {
    vec2 cell = (p - vec2(${left}., ${north}.)) / ${step}.;
    return texture2D(uRiverbank, (cell + .5) / vec2(${width}., ${depth}.));
}
`;
