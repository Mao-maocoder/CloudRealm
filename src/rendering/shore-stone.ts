import * as T from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRockDetailTexture } from './peakland-stone';

// Offsets are distances to fracture planes on an otherwise rounded block.
const faces = [
    [[.14,1,-.23,.78],[.94,.32,.46,.78],[-1,.22,.40,.83],[.42,.25,-1,.91],[0,-1,.12,.87]],
    [[-.21,1,.13,.76],[.81,.26,.59,.89],[-.75,.28,.64,.85],[.62,-.19,-.84,.79],[.10,-1,-.20,.88]],
    [[.33,1,.34,.79],[1,.14,-.46,.83],[-.76,.37,-.54,.78],[-.36,.27,1,.87],[-.14,-1,.17,.87]],
] as const;

export function makeShoreStoneGeometry(form = 0, detail = 3) {
    const shell = new T.IcosahedronGeometry(1, detail);
    shell.deleteAttribute('normal');
    shell.deleteAttribute('uv');
    const geometry = mergeVertices(shell);
    shell.dispose();

    const planes = faces[form].map(([x,y,z,offset]) => ({
        normal:new T.Vector3(x,y,z).normalize(), offset,
    }));
    const positions = geometry.getAttribute('position');
    const direction = new T.Vector3();
    for(let i=0;i<positions.count;i++){
        direction.fromBufferAttribute(positions,i).normalize();
        const {x,y,z}=direction;
        let radius=1+.071*Math.sin(x*4.6+z*3.8+form*.82)*Math.cos(y*5.4-z*3.4)
            +.034*Math.sin(x*9.3+y*8.7-z*7.1+form);
        for(const plane of planes){
            const toward=plane.normal.dot(direction);
            if(toward<=0) continue;
            const stop=plane.offset/toward;
            const bevel=Math.max(0,.125-Math.abs(stop-radius));
            radius=Math.min(radius,stop)-bevel*bevel/.50;
        }
        positions.setXYZ(i,(x+.095*y)*radius,y*radius,(z-.043*y)*radius);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
}

/** Weathering and grain in world metres, shared by the instanced stone batches. */
export function makeShoreStoneMaterial(wetness:number) {
    const detail=makeRockDetailTexture();
    const material=new T.MeshStandardMaterial({roughness:.9,metalness:0});
    material.customProgramCacheKey=()=>'weathered-shore-stone';
    material.onBeforeCompile=shader=>{
        shader.uniforms.uBankStoneDetail={value:detail};
        shader.uniforms.uBankStoneWetness={value:wetness};
        shader.vertexShader='varying vec3 vBankStoneWorld,vBankStoneLocal;\n'+shader.vertexShader
            .replace('#include <begin_vertex>',`#include <begin_vertex>
                vBankStoneLocal=position;
                vec4 stonePosition=vec4(transformed,1.);
                #ifdef USE_INSTANCING
                    stonePosition=instanceMatrix*stonePosition;
                #endif
                vBankStoneWorld=(modelMatrix*stonePosition).xyz;`);
        shader.fragmentShader=`
            uniform sampler2D uBankStoneDetail;
            uniform float uBankStoneWetness;
            varying vec3 vBankStoneWorld,vBankStoneLocal;
            vec4 bankStoneGrain(vec3 p,vec3 up) {
                vec3 w=pow(abs(up),vec3(4.));
                w/=max(.001,w.x+w.y+w.z);
                return texture2D(uBankStoneDetail,p.zy)*w.x
                    +texture2D(uBankStoneDetail,p.xz)*w.y
                    +texture2D(uBankStoneDetail,p.xy)*w.z;
            }
        `+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            vec3 stoneP=vBankStoneWorld, localStone=vBankStoneLocal;
            vec3 stoneFace=normalize(cross(dFdx(stoneP),dFdy(stoneP)));
            float rockPixel=max(length(dFdx(stoneP)),length(dFdy(stoneP)));
            vec4 grain=bankStoneGrain(stoneP*.64,stoneFace);
            vec4 stain=texture2D(uBankStoneDetail,(stoneP.xz+stoneP.y*vec2(.63,-.48))*.134);
            float bed=localStone.y*1.36+localStone.x*.26-localStone.z*.24+(stain.b-.5)*.22;
            float band=abs(fract(bed+.5)-.5);
            float seam=(1.-smoothstep(.025,.107,band))*(1.-smoothstep(.12,.55,fwidth(bed)));
            seam*=smoothstep(.35,.64,stain.b);
            float damp=uBankStoneWetness*(1.-smoothstep(-.30,.25,localStone.y+(stain.r-.6)*.57));
            vec3 base=diffuseColor.rgb*(.77+grain.r*.28+stain.b*.22-grain.g*.13);
            base*=mix(vec3(1.),vec3(.52,.64,.66),damp*.76);
            vec3 deposit=mix(vec3(.148,.185,.106),vec3(.32,.39,.16),grain.b);
            float moss=smoothstep(.45,.77,stain.b+grain.b*.25)*smoothstep(.20,.84,stoneFace.y);
            moss*=smoothstep(-.17,.63,localStone.y)*mix(.67,.93,uBankStoneWetness);
            base=mix(base,deposit,moss*.60);
            float fleck=smoothstep(.16,.51,grain.a)*(1.-damp*.72);
            base=mix(base,vec3(.62,.61,.51),fleck*.19);
            diffuseColor.rgb=base*(1.-seam*.27);
            float stoneRelief=((grain.r-.62)*.055-grain.g*.009-seam*.025)
                *(1.-smoothstep(.10,.58,rockPixel));
        `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
            roughnessFactor=mix(.91,.62,damp);`)
            .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
            vec3 stoneDx=dFdx(-vViewPosition),stoneDy=dFdy(-vViewPosition);
            vec3 s1=cross(stoneDy,normal),s2=cross(normal,stoneDx);
            float stoneDet=dot(stoneDx,s1);
            vec3 reliefGradient=sign(stoneDet)*(dFdx(stoneRelief)*s1+dFdy(stoneRelief)*s2);
            normal=normalize(max(abs(stoneDet),.00001)*normal-reliefGradient);`);
    };
    return material;
}
