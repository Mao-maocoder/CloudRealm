import * as T from 'three';
import { daylight } from '../config/art';
import { allCorridorTrees } from '../world/flora/corridor-trees';
import { smooth } from '../world/geo/geo-core';
import { corridorField } from '../world/geo/river-corridor';

const {left,north,step,width,depth}=corridorField;
const sizeX=(width-1)*step,sizeZ=(depth-1)*step,pixel=3;
const nx=Math.ceil(sizeX/pixel),nz=Math.ceil(sizeZ/pixel);

/** Project diffuse crown shadows beyond the player's real-time shadow map. */
export function makeCanopyShade() {
    const shade=new Uint8Array(nx*nz);
    for (const {x,z,scale,kind} of allCorridorTrees()) {
        const h=(kind==='pine'?7.2:5.6)*scale;
        const cx=(x-left-h*daylight[0]/daylight[1])/pixel;
        const cz=(z-north-h*daylight[2]/daylight[1])/pixel;
        const radius=(kind==='pine'?3.5:5.1)*scale/pixel;
        const pad=Math.ceil(radius*1.65);
        for(let iz=Math.max(0,Math.floor(cz-pad));iz<Math.min(nz,Math.ceil(cz+pad));iz++)
            for(let ix=Math.max(0,Math.floor(cx-pad));ix<Math.min(nx,Math.ceil(cx+pad));ix++){
                const dx=ix+.5-cx,dz=iz+.5-cz;
                const r=Math.hypot((dx+dz)*.55,(dz-dx)*.71)/radius;
                const coverage=(1-smooth(.40,1.17,r))*.93;
                const i=iz*nx+ix;
                shade[i]=Math.max(shade[i],Math.round(coverage*255));
            }
    }
    const texture=new T.DataTexture(shade,nx,nz,T.RedFormat);
    texture.generateMipmaps=true;
    texture.minFilter=T.LinearMipmapLinearFilter;
    texture.magFilter=T.LinearFilter;
    texture.needsUpdate=true;
    return texture;
}

export const canopyShadeGLSL=`
uniform sampler2D uCanopyShade;
float canopyShade(vec2 p) {
    vec2 uv=(p-vec2(${left}.,${north}.))/vec2(${nx*pixel}.,${nz*pixel}.);
    if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
    return texture2D(uCanopyShade,uv).r;
}
`;
