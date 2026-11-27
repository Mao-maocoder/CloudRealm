import * as T from 'three';
import { corridorField,corridorHabitatAt } from '../world/geo/river-corridor';
import { heightAt,slopeAt } from '../world/geo/height';
import { shoreDistanceAt } from '../world/geo/meadow-distribution';

const {left,north,step,width,depth}=corridorField;
export function makeCorridorTexture() {
    const data=new Uint8Array(width*depth*4);
    // Initialize R channel to neutral 128 (dampness = 0) so border texels clamped beyond corridorField
    // never decode as dampness = -1 (exposedGravel = 1), which caused a hard vertical seam at x = 1516!
    for(let i=0;i<data.length;i+=4)data[i]=128;
    for(let z=1;z<depth-1;z++)for(let x=1;x<width-1;x++){
        const wx=left+x*step,wz=north+z*step;
        const habitat=corridorHabitatAt(wx,wz,heightAt(wx,wz),slopeAt(wx,wz),shoreDistanceAt(wx,wz));
        const i=(z*width+x)*4;
        data[i]=Math.round((habitat.wet-habitat.sediment+1)*127.5);
        data[i+1]=Math.round(habitat.woodland*255);
        data[i+2]=Math.round(habitat.pasture*255);
        data[i+3]=Math.round(habitat.strength*255);
    }
    const texture=new T.DataTexture(data,width,depth);
    texture.minFilter=texture.magFilter=T.LinearFilter;
    texture.needsUpdate=true;
    return texture;
}

export const riverCorridorGLSL=`
uniform sampler2D uRiverCorridor;
vec4 riverCorridor(vec2 p) {
    vec2 uv=((p-vec2(${left}.,${north}.))/${step}.+.5)/vec2(${width}.,${depth}.);
    return texture2D(uRiverCorridor,uv);
}
`;
