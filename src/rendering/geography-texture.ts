import * as T from 'three';
import{geographyGrid,gridWidth,gridDepth,gridStep}from '../world/geo/geography';
import{waterSurfaceAt,bounds}from '../world/geo/geo-core';
let geographyData: Float32Array<ArrayBuffer> | undefined;
let sharedGeographyTex: T.DataTexture | undefined;
let geographyRefs = 0;

function makeRefCountedTexture(create: () => T.DataTexture, getShared: () => T.DataTexture | undefined, setShared: (t: T.DataTexture | undefined) => void, addRef: (delta: number) => number): T.DataTexture {
    let tex = getShared();
    if (!tex) {
        tex = create();
        const rawDispose = tex.dispose.bind(tex);
        tex.dispose = () => {
            if (addRef(-1) <= 0) {
                setShared(undefined);
                rawDispose();
            }
        };
        setShared(tex);
    }
    addRef(1);
    return tex;
}
const horizonOffsets = [2, 7, 18].flatMap(d => [
    [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [-d, -d], [d, -d],
].map(([x, z]) => ({ x, z, inverseRun: 1 / Math.hypot(x * gridStep, z * gridStep) })));

function bakeGeography() {
    const heights = geographyGrid(), data = new Float32Array(heights.length * 4);
    for (let i = 0; i < heights.length; i++) {
        const x = i % gridWidth, z = Math.floor(i / gridWidth), h = heights[i];
        const level = waterSurfaceAt(bounds.left + x * gridStep, bounds.north + z * gridStep, 12);
        const wet = Number.isFinite(level);
        let occlusion = 0;
        for (const offset of horizonOffsets) {
            const nx = Math.max(0, Math.min(gridWidth - 1, x + offset.x));
            const nz = Math.max(0, Math.min(gridDepth - 1, z + offset.z));
            const slope = (heights[nz * gridWidth + nx] - h) * offset.inverseRun;
            occlusion += Math.max(0, Math.min(1, slope));
        }
        data[i * 4] = h;
        data[i * 4 + 1] = wet ? level : 0;
        data[i * 4 + 2] = wet ? 1 : 0;
        data[i * 4 + 3] = 1 - occlusion / horizonOffsets.length;
    }
    return data;
}

export function makeGeographyTexture() {
    return makeRefCountedTexture(
        () => {
            geographyData ??= bakeGeography();
            const texture = new T.DataTexture(geographyData, gridWidth, gridDepth, T.RGBAFormat, T.FloatType);
            texture.minFilter = texture.magFilter = T.NearestFilter;
            texture.needsUpdate = true;
            return texture;
        },
        () => sharedGeographyTex,
        t => { sharedGeographyTex = t; },
        d => (geographyRefs = Math.max(0, geographyRefs + d)),
    );
}

let geographyNormalData: Uint8Array<ArrayBuffer> | undefined;
let sharedNormalTex: T.DataTexture | undefined;
let normalRefs = 0;
/**
 * Per-grid-point normals, bilinearly sampled. Deriving the normal in the
 * fragment shader from the bilinear height makes the gradient jump at every
 * 8 m cell edge, which shows as a checkerboard on big cliffs; interpolating
 * baked point normals is smooth instead.
 */
function bakeGeographyNormals() {
    const heights = geographyGrid(), data = new Uint8Array(gridWidth * gridDepth * 4);
    const at = (x: number, z: number) => heights[Math.max(0, Math.min(gridDepth - 1, z)) * gridWidth + Math.max(0, Math.min(gridWidth - 1, x))];
    for (let z = 0; z < gridDepth; z++) for (let x = 0; x < gridWidth; x++) {
        const nx = -(at(x + 1, z) - at(x - 1, z)) / (2 * gridStep);
        const nz = -(at(x, z + 1) - at(x, z - 1)) / (2 * gridStep);
        const length = Math.hypot(nx, 1, nz), i = (z * gridWidth + x) * 4;
        data[i] = Math.round((nx / length * .5 + .5) * 255);
        data[i + 1] = Math.round((1 / length * .5 + .5) * 255);
        data[i + 2] = Math.round((nz / length * .5 + .5) * 255);
        data[i + 3] = 255;
    }
    return data;
}

export function makeGeographyNormalTexture() {
    return makeRefCountedTexture(
        () => {
            geographyNormalData ??= bakeGeographyNormals();
            const texture = new T.DataTexture(geographyNormalData, gridWidth, gridDepth, T.RGBAFormat);
            texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
            texture.minFilter = texture.magFilter = T.LinearFilter;
            texture.needsUpdate = true;
            return texture;
        },
        () => sharedNormalTex,
        t => { sharedNormalTex = t; },
        d => (normalRefs = Math.max(0, normalRefs + d)),
    );
}

export const normalTextureGLSL = `uniform sampler2D uGeoNormal;
vec3 plannedNormal(vec2 p){
    vec2 dimensions=vec2(${gridWidth}.0,${gridDepth}.0);
    vec2 uv=((p-vec2(${bounds.left}.0,${bounds.north}.0))/${gridStep}.0+.5)/dimensions;
    return normalize(texture2D(uGeoNormal,clamp(uv,vec2(0.),vec2(1.))).rgb*2.-1.);
}`;

export const heightTextureGLSL = `uniform sampler2D uGeography;
vec4 plannedGeography(vec2 p){
    const vec2 dimensions=vec2(${gridWidth}.0,${gridDepth}.0), texel=1./dimensions;
    vec2 q=clamp((p-vec2(${bounds.left}.0,${bounds.north}.0))/${gridStep}.0,vec2(0.),dimensions-1.);
    vec2 i=min(floor(q),dimensions-2.),f=q-i,uv=(i+.5)*texel;
    vec4 a=texture2D(uGeography,uv),b=texture2D(uGeography,uv+vec2(texel.x,0.));
    vec4 c=texture2D(uGeography,uv+vec2(0.,texel.y)),d=texture2D(uGeography,uv+texel);
    vec4 result=mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    result.g/=max(.0001,result.b);return result;
}
vec4 cubicWeights(float t){
    float t2=t*t, t3=t2*t;
    return vec4(-.5*t3+t2-.5*t, 1.5*t3-2.5*t2+1., -1.5*t3+2.*t2+.5*t, .5*t3-.5*t2);
}
// Bilinear height keeps the terrain vertex cost low; the old grid artifact came
// from the fragment bump, not this interpolation, so the baked normal map is
// enough to keep large cliffs smooth.
float plannedHeight(vec2 p){return plannedGeography(p).r;}`;
