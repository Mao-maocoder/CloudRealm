import * as T from 'three';
import { makeRockDetailTexture } from './peakland-stone';
import { aerialPerspectiveGLSL, atmosphereUniforms } from './aerial-perspective';
import { cascadeCliffGLSL } from './cascade-cliff';
import { grassCanopyGLSL, makeGrassCanopyTexture } from './grass-canopy-texture';
import { makePastureTexture } from './terrain-material';
import { meadowWindGLSL } from '../effects/meadow-trail';

export function makeCanyonStone() {
    const stone=new T.MeshLambertMaterial();
    const detail=makeRockDetailTexture();
    const grassCanopy=makeGrassCanopyTexture();
    const pasture=makePastureTexture();
    const uniforms={uTime:{value:0}};
    stone.userData.uniforms=uniforms;
    stone.addEventListener('dispose',()=>{detail.dispose();grassCanopy.dispose();pasture.dispose();});
    stone.customProgramCacheKey=()=> 'canyon-stone-sod-v3';
    stone.onBeforeCompile=shader=>{
        shader.uniforms.uCanyonGrain={value:detail};
        shader.uniforms.uGrassCanopy={value:grassCanopy};
        shader.uniforms.uPasture={value:pasture};
        shader.uniforms.uTime=uniforms.uTime;
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader=`
            attribute float aCanyonSod;
            varying vec3 vCanyonPoint,vCanyonNormal;
            varying float vCanyonSod;
        `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
            vCanyonPoint=(modelMatrix*vec4(transformed,1.)).xyz;
            vCanyonNormal=normalize(mat3(modelMatrix)*objectNormal);
            vCanyonSod=aCanyonSod;`);
        shader.fragmentShader=`
            uniform sampler2D uCanyonGrain;
            uniform sampler2D uPasture;
            uniform float uTime;
            varying vec3 vCanyonPoint,vCanyonNormal;
            varying float vCanyonSod;
            float tHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
            float tNoise(vec2 p){
                vec2 i=floor(p),f=fract(p); f*=f*(3.-2.*f);
                return mix(mix(tHash(i),tHash(i+vec2(1.,0.)),f.x),
                    mix(tHash(i+vec2(0.,1.)),tHash(i+vec2(1.)),f.x),f.y);
            }
            float tFbm(vec2 p){
                float sum=0.,amp=.5;
                for(int i=0;i<4;i++){sum+=tNoise(p)*amp;p=p*2.03+11.7;amp*=.5;}
                return sum;
            }
            vec4 rockTriplanar(vec3 p,vec3 n,float scale){
                // Tight but smooth weights: no smeared double image where projections meet.
                vec3 w=pow(abs(n),vec3(4.)); w/=max(.001,w.x+w.y+w.z);
                return texture2D(uCanyonGrain,p.zy*scale)*w.x+
                    texture2D(uCanyonGrain,p.xz*scale)*w.y+texture2D(uCanyonGrain,p.xy*scale)*w.z;
            }
            ${aerialPerspectiveGLSL}
            ${cascadeCliffGLSL}
            ${grassCanopyGLSL}
            ${meadowWindGLSL}
        `+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            vec3 p=vCanyonPoint, n=normalize(vCanyonNormal);
            vec2 worldUV=p.xz;
            float footprint=max(length(dFdx(p)),length(dFdy(p)));
            float xzFootprint=max(length(dFdx(worldUV)),length(dFdy(worldUV)));
            float fineFade=1.-smoothstep(.3,1.8,xzFootprint);
            vec4 stoneLayer=cascadeCliff(p,n,1.-max(0.,n.y),footprint);
            vec2 warp=vec2(tNoise(worldUV*.014+vec2(3.7,9.1)),tNoise(worldUV*.017+vec2(72.1,5.9)))*16.;
            float macro=tFbm((worldUV+warp)*.037);
            float mott=tNoise(worldUV*.065)*.6+tNoise(worldUV*.19+9.3)*.4;
            float fine=tNoise((worldUV+warp)*.72);
            float verdure=tNoise(worldUV*.035+vec2(3.,11.));
            float turf=smoothstep(.23,.88,vCanyonSod+(verdure-.48)*.37)
                *smoothstep(.04,.70,n.y+.16);
            // Match the valley & corridor grass canopy system so the mountain
            // tops transition seamlessly from 3D Meadow blades to mid/far turf.
            vec2 swale=worldUV+warp*1.8;
            float pastureNoise=tNoise(swale*vec2(.019,.031))*.53+macro*.30+mott*.17;
            float sunlit=smoothstep(.30,.69,pastureNoise);
            vec3 green=mix(vec3(.085,.238,.066),vec3(.385,.495,.092),sunlit);
            float tussock=tNoise(swale*vec2(.85,1.24)+fine*.42);
            float strokes=smoothstep(.45,.78,tussock)*fineFade;
            float brush=texture2D(uPasture,(worldUV+.25*warp)/13.).r;
            green*=(.82+.22*mott+.18*strokes)*(.58+.80*brush);
            green+=vec3(.07,.055,.008)*strokes*sunlit;
            green*=1.+meadowGust(worldUV,uTime)*.045;
            vec2 crownSlope=vec2(0.);
            vec2 crownUV=worldUV+warp*.43;
            vec2 crownDx=dFdx(crownUV), crownDz=dFdy(crownUV);
            if(turf>.006){
                float surfaceDistance=length(cameraPosition-p);
                float canopyHandoff=max(smoothstep(21.,100.,surfaceDistance),smoothstep(.045,.24,xzFootprint));
                mat2 rotation=mat2(.81,-.59,.59,.81);
                vec4 clumps=grassCanopyAt(crownUV,crownDx,crownDz,57.);
                vec4 tufts=grassCanopyAt(rotation*crownUV+vec2(29.,-37.),rotation*crownDx,rotation*crownDz,16.);
                vec4 masses=grassCanopyAt(rotation*crownUV+vec2(85.,18.),rotation*crownDx,rotation*crownDz,151.);
                float tuftVisibility=1.-smoothstep(.14,.63,xzFootprint);
                float clumpVisibility=1.-smoothstep(1.8,7.5,xzFootprint);
                float crownLight=(clumps.r-.47)*.52*clumpVisibility+(tufts.r-.47)*.29*tuftVisibility+(masses.r-.47)*.37;
                crownSlope=(clumps.gb*2.-1.)*.68*clumpVisibility
                    +transpose(rotation)*(tufts.gb*2.-1.)*.47*tuftVisibility;
                float softSlope=dot(crownSlope,vec2(-.45,-.90));
                float groundTuft=clumps.a-.4;
                vec3 rimTint=mix(vec3(.035,.074,.029),vec3(.12,.146,.046),sunlit);
                vec3 crownColor=green*(1.02+crownLight+softSlope*.16)+rimTint*(.31+groundTuft*.88);
                float grainBlend=mix(.22,.92,canopyHandoff);
                green=mix(green,crownColor,grainBlend);
                crownSlope*=turf*grainBlend*.29;
            }
            float contactShade=1.-.23*smoothstep(.14,.57,vCanyonSod)*(1.-smoothstep(.60,.92,n.y));
            diffuseColor.rgb=mix(stoneLayer.rgb,green,turf)*contactShade;
            float canyonRelief=stoneLayer.a*(1.-turf);
        `).replace('#include <fog_fragment>','')
            .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
                // Derivative bump from the cliff relief height (metres), so
                // beds, fissures and buttresses shade with the light.
                vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);
                vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);
                float det=dot(dpx,r1);
                vec3 grad=sign(det)*(dFdx(canyonRelief)*r1+dFdy(canyonRelief)*r2);
                normal=normalize(max(abs(det),.000001)*normal-grad);
                normal=normalize(normal+mat3(viewMatrix)*vec3(crownSlope.x,0.,crownSlope.y));`)
            .replace('#include <tonemapping_fragment>',`
                gl_FragColor.rgb=applyAerialPerspective(gl_FragColor.rgb,vCanyonPoint);
                #include <tonemapping_fragment>`);
    };
    return stone;
}
