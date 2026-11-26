import * as T from 'three';
import { bounds } from '../world/geo/geo-core';
import { geographyGrid,gridStep,gridWidth,gridDepth } from '../world/geo/geography';
import { shoreDistanceAt } from '../world/geo/meadow-distribution';
import { regionalHabitatAt } from '../world/geo/regional-habitat';

const stride=2, step=gridStep*stride;
const width=Math.ceil((gridWidth-1)/stride)+1, depth=Math.ceil((gridDepth-1)/stride)+1;
export function makeRegionalTexture() {
    const height=geographyGrid(), data=new Uint8Array(width*depth*4);
    const at=(x:number,z:number)=>height[Math.max(0,Math.min(gridDepth-1,z))*gridWidth+Math.max(0,Math.min(gridWidth-1,x))];
    for(let z=0;z<depth;z++) for(let x=0;x<width;x++){
        const gx=x*stride, gz=z*stride, wx=bounds.left+x*step, wz=bounds.north+z*step;
        const slope=Math.hypot(at(gx+1,gz)-at(gx-1,gz),at(gx,gz+1)-at(gx,gz-1))/(2*gridStep);
        const habitat=regionalHabitatAt(wx,wz,at(gx,gz),slope,shoreDistanceAt(wx,wz));
        const i=(z*width+x)*4;
        data[i]=Math.round(habitat.color[0]*255);
        data[i+1]=Math.round(habitat.color[1]*255);
        data[i+2]=Math.round(habitat.color[2]*255);
        data[i+3]=Math.round(habitat.woodland*255);
    }
    const texture=new T.DataTexture(data,width,depth);
    texture.minFilter=texture.magFilter=T.LinearFilter;
    texture.needsUpdate=true;
    return texture;
}

export const regionalTextureGLSL=`
uniform sampler2D uRegionalHabitat;
vec4 regionalTerrain(vec2 p){
    return texture2D(uRegionalHabitat,((p-vec2(${bounds.left}.,${bounds.north}.))/${step}.+.5)/vec2(${width}.,${depth}.));
}
`;
