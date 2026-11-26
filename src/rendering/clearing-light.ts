import * as T from 'three';
import { bakeClearingLight, clearingField } from '../world/geo/forest-clearing';

const { left,north,step,width,depth } = clearingField;
export function makeClearingLight() {
    const light=new T.DataTexture(bakeClearingLight(),width,depth);
    light.minFilter=light.magFilter=T.LinearFilter;
    light.needsUpdate=true;
    return light;
}

export const clearingLightGLSL=`
uniform sampler2D uClearingLight;
vec4 clearingLight(vec2 p) {
    vec2 uv=((p-vec2(${left}.,${north}.))/${step}+.5)/vec2(${width}.,${depth}.);
    if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec4(0.);
    return texture2D(uClearingLight,uv);
}
`;
