import {fbm, smooth, valueNoise} from './height';

// The sample includes the east bank, the village junction and the first row of houses.
const sample = import.meta.env?.DEV && new URLSearchParams(location.search).get('valleyArt') === 'sample';
export const valleyArtArea = sample ? [88, 180, 50, 50] : [165, 105, 720, 760];
const feather = sample ? 12 : 340;
const [x, z, width, depth] = valleyArtArea;

export function valleyArtAt(px: number, pz: number) {
    const warp = sample ? 0 : Math.sin(pz * 0.0045 + px * 0.0018) * 58 + Math.cos(px * 0.0038 - pz * 0.0029) * 42;
    const edge = Math.max(Math.abs(px - x) - width, Math.abs(pz - z) - depth) + warp;
    return 1 - smooth(-feather, 40, edge);
}

export const valleyArtGLSL = `
float valleyArtAt(vec2 p) {
    float warp = ${sample ? '0.' : 'sin(p.y * 0.0045 + p.x * 0.0018) * 58. + cos(p.x * 0.0038 - p.y * 0.0029) * 42.'};
    vec2 edge = abs(p - vec2(${x}., ${z}.)) - vec2(${width}., ${depth}.);
    return 1. - smoothstep(-${feather}., 40., max(edge.x, edge.y) + warp);
}
`;

export function valleyWoodland(x: number, z: number, moisture: number) {
    const forest = fbm(x*.015, z*.015, 3, 61);
    const clearing = 1-smooth(.6, 1.15, Math.hypot((x-153)/72,(z-206)/53));
    const ridge = Math.exp(-Math.pow((x-118)/26,2)-Math.pow((z-143)/23,2));
    return Math.max(ridge*.85,smooth(.40,.68,forest+moisture*.10))*(1-.94*clearing);
}

export function valleySward(x: number, z: number, moisture: number) {
    const broad = valueNoise(x*.043, z*.043, 53);
    const small = valueNoise(x*.14, z*.14, 79);
    return .64 + .36*smooth(.19,.79,broad*.75+small*.25+moisture*.12);
}

const blossomGroves = [
    [367,-401,95,65],[302,-488,86,51],[435,-507,95,65],
    [422,-299,72,54],[515,99,70,46],[629,159,70,60],
    [-548,-555,109,67],[-668,-625,112,68],[-420,-631,95,77],
    [-105,631,75,69],[260,779,65,54],
] as const;

export function valleyBlossomAt(x:number,z:number) {
    if(x < -800 || x > 740 || z < -770 || z > 850)return 0;
    let cover=0;
    for(const [cx,cz,w,d] of blossomGroves){
        if(Math.abs(x-cx)>w*1.3||Math.abs(z-cz)>d*1.3) continue;
        cover=Math.max(cover,1-smooth(.22,1.10,Math.hypot((x-cx)/w,(z-cz)/d)));
    }
    return cover*(.57+.43*valueNoise(x*.056,z*.056,313));
}
