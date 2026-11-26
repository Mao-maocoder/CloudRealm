import * as T from 'three';
import {aerialPerspectiveGLSL, atmosphereUniforms} from './aerial-perspective';
import {grassCanopyGLSL, makeGrassCanopyTexture} from './grass-canopy-texture';

/**
 * Sedimentary sandstone for the peakland pillars.
 *
 * The reference cliffs read through three scales, and the previous material
 * collapsed them into one soft blob: thick beds a few metres tall, an
 * occasional metre-scale shelf that steps the wall, and vertical joints that
 * stain it dark and green. Large shapes stay procedural so they never repeat
 * across a 400 m cliff; two small tiling textures supply grain, pitting and
 * lichen. Relief is shaded with screen-space derivative bump mapping, so it
 * follows the surface at every terrain LOD.
 */

function hash2(i: number, j: number, seed: number) {
    let n = Math.imul(i + seed * 131, 374761393) + Math.imul(j + seed * 977, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that wraps every `period` cells, so the result tiles. */
function periodicNoise(x: number, y: number, period: number, seed: number) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const wrap = (v: number) => ((v % period) + period) % period;
    const a = hash2(wrap(ix), wrap(iy), seed), b = hash2(wrap(ix + 1), wrap(iy), seed);
    const c = hash2(wrap(ix), wrap(iy + 1), seed), d = hash2(wrap(ix + 1), wrap(iy + 1), seed);
    return T.MathUtils.lerp(T.MathUtils.lerp(a, b, sx), T.MathUtils.lerp(c, d, sx), sy);
}

function fbm(u: number, v: number, base: number, octaves: number, seed: number, ridged = false) {
    let sum = 0, amplitude = .5, total = 0, frequency = base;
    for (let o = 0; o < octaves; o++) {
        let n = periodicNoise(u * frequency, v * frequency, frequency, seed + o * 17);
        if (ridged) n = 1 - Math.abs(n * 2 - 1);
        sum += n * amplitude;
        total += amplitude;
        amplitude *= .5;
        frequency *= 2;
    }
    return sum / total;
}

/**
 * R fine grain / G pits / B mottle / A quartz flecks.
 * Values are linear heights, not colours; the shader treats them as relief and masks.
 */
function makeDetailTexture(size = 256) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, i = (y * size + x) * 4;
        // Domain warping breaks the grid corridors that plain value-noise fBm
        // shows when a single texel is magnified across the screen.
        const wx = (fbm(u, v, 3, 3, 901) - .5) * .16, wy = (fbm(u, v, 3, 3, 937) - .5) * .16;
        const wu = u + wx, wv = v + wy;
        const grain = fbm(wu, wv, 9, 5, 31) * .65 + fbm(wu, wv, 23, 3, 47) * .35;
        const pits = fbm(wu, wv, 5, 4, 71, true);
        const mottle = fbm(u, v, 3, 4, 109);
        const fleck = Math.max(0, fbm(wu, wv, 17, 3, 151) - .60) * 2.5;
        data[i] = Math.round(255 * .35 + 255 * .65 * grain);
        data[i + 1] = Math.round(255 * Math.pow(pits, 2.3));
        data[i + 2] = Math.round(255 * mottle);
        data[i + 3] = Math.round(255 * Math.min(1, fleck));
    }
    const tex = new T.DataTexture(data, size, size, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.magFilter = T.LinearFilter;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
}

let sharedDetail: T.DataTexture | undefined;
let sharedNoise: T.DataTexture | undefined;
/** Shared across terrain, pillar and island materials; generated once. */
export function makeRockDetailTexture() {
    return sharedDetail ??= makeDetailTexture();
}
function makeStoneNoiseTexture() {
    return sharedNoise ??= makeNoiseTexture();
}
function makeNoiseTexture(size = 128) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, i = (y * size + x) * 4;
        data[i] = Math.round(255 * fbm(u, v, 3, 5, 211));
        data[i + 1] = Math.round(255 * fbm(u, v, 7, 4, 233));
        data[i + 2] = Math.round(255 * fbm(u, v, 5, 4, 257));
        data[i + 3] = Math.round(255 * fbm(u, v, 2, 5, 281));
    }
    const tex = new T.DataTexture(data, size, size, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.magFilter = T.LinearFilter;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
}

export function makePeaklandStone(time?: { value: number }) {
    const detail = makeRockDetailTexture();
    const noise = makeStoneNoiseTexture();
    const grassCanopy = makeGrassCanopyTexture();
    const material = new T.MeshLambertMaterial();
    // Cool sky-blue bounce fills shadowed cliffs & undersides so warm sunlit sandstone pops.
    material.emissive = new T.Color('#5a728a');
    material.emissiveIntensity = .24;
    const uTime = time ?? { value: 0 };
    material.userData.uniforms = { uTime };
    material.addEventListener('dispose', () => grassCanopy.dispose());
    material.customProgramCacheKey = () => 'peakland-zhangjiajie-stone-v8';
    material.onBeforeCompile = shader => {
        shader.uniforms.uStoneDetail = { value: detail };
        shader.uniforms.uStoneNoise = { value: noise };
        shader.uniforms.uGrassCanopy = { value: grassCanopy };
        shader.uniforms.uTime = uTime;
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader = `attribute vec2 aGeologicProfile;
            varying vec3 vStonePoint,vStoneNormal;
            varying vec2 vStratum;
        ` + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            vStonePoint=(modelMatrix*vec4(transformed,1.)).xyz;
            vStoneNormal=normalize(mat3(modelMatrix)*objectNormal);
            vStratum=aGeologicProfile;`);
        shader.fragmentShader = `uniform sampler2D uStoneDetail,uStoneNoise;
            uniform float uTime;
            varying vec3 vStonePoint,vStoneNormal;
            varying vec2 vStratum;
            ${aerialPerspectiveGLSL}
            ${grassCanopyGLSL}
            float stoneHash1(float p){return fract(sin(p*127.1+3.1)*43758.5453);}
            vec4 stoneMacro(vec2 uv){return texture2D(uStoneNoise,uv);}
            vec4 stoneTri(vec3 p,vec3 n,float scale){
                vec3 w=pow(abs(n),vec3(4.));w/=max(dot(w,vec3(1.)),.0001);
                return texture2D(uStoneDetail,p.zy*scale)*w.x
                    +texture2D(uStoneDetail,p.xz*scale)*w.y
                    +texture2D(uStoneDetail,p.xy*scale)*w.z;
            }
        ` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 rockP=vStonePoint, rockN=normalize(vStoneNormal);
            vec2 strike=vec2(cos(vStratum.x),sin(vStratum.x));
            float across=dot(rockP.xz,strike), along=dot(rockP.xz,vec2(-strike.y,strike.x));
            float height=rockP.y;
            float footprint=max(length(dFdx(rockP)),length(dFdy(rockP)));
            float fineFade=1.-smoothstep(.35,2.2,footprint);

            // Fast 2-tap macro structure using all 4 RGBA channels of uStoneNoise.
            vec4 macroA=stoneMacro(vec2(across*.0042,along*.0042)+.37);
            vec4 macroB=stoneMacro(vec2(along*.016,height*.0085)+2.71);

            float buttress=macroA.b;
            float warp=(macroA.r-.5)*2.2+(macroB.g-.5)*1.0;
            float faultCoord=along*.024+(macroB.a-.5)*1.35;
            float faultCell=floor(faultCoord);
            float faultLocal=fract(faultCoord);
            float faultEdge=(1.-smoothstep(.0,.05,min(faultLocal,1.-faultLocal)))*(1.-smoothstep(.5,2.6,fwidth(faultCoord)*4.));

            // Broad, gentle geological bedding broken up by 3D noise so it never reads as zebra stripes.
            float groupPhase=height*.028+(macroA.a-.5)*1.6+faultCell*.18;
            float bedPhase=height*.095+warp*1.1+faultCell*.22;
            float group=fract(groupPhase), bed=fract(bedPhase);
            float groupFade=1.-smoothstep(.16,.58,fwidth(groupPhase));
            float bedFade=1.-smoothstep(.20,.68,fwidth(bedPhase));

            float shelf=smoothstep(.03,.12,group)*(1.-smoothstep(.54,.68,group));
            float underShelf=smoothstep(.54,.64,group)*(1.-smoothstep(.66,.94,group));
            float bedStep=smoothstep(.06,.22,bed)*(1.-smoothstep(.48,.64,bed));

            float seam=(1.-smoothstep(0.,.045,min(bed,1.-bed)))*bedFade*smoothstep(.48,.82,macroB.r);
            float shelfSeam=(1.-smoothstep(0.,.035,min(group,1.-group)))*groupFade*smoothstep(.35,.72,macroA.g)*.65;

            float fissurePhase=along*.042+height*.006+(macroB.b-.5)*1.8;
            float fissure=(1.-smoothstep(.0,.042,abs(fract(fissurePhase)-.5)))*(1.-smoothstep(.30,2.2,fwidth(fissurePhase)*6.));
            float joints=clamp(max(fissure,faultEdge*.85)*(.45+.55*macroB.a),0.,1.);

            // Multi-scale triplanar rock detail; skip mid & fine triplanar taps on distant spires.
            float midFade=1.-smoothstep(1.8,6.5,footprint);
            vec4 rockMid=midFade>.02?stoneTri(rockP,rockN,.065):vec4(.5,.25,macroA.b,0.);
            vec4 fine=fineFade>.02?stoneTri(rockP,rockN,.42):vec4(.5,.2,.5,0.);
            float grain=fine.r, pits=fine.g, mottle=rockMid.b;
            float facet=rockMid.r;

            float relief=(facet-.5)*2.4+(shelf-.45)*1.5*groupFade+(bedStep-.45)*.30*bedFade+(buttress-.5)*3.2;

            // Natural cohesive sandstone palette: broad 3D mottle & weathering instead of alternating stripes.
            vec3 sunDir=normalize(vec3(.49,.72,.49));
            float sunFacing=smoothstep(-.25,.75,dot(rockN,sunDir));
            float underside=smoothstep(.15,-.65,rockN.y);

            vec3 warmSand=vec3(.78,.66,.49);
            vec3 ochreRock=vec3(.65,.50,.35);
            vec3 coolSlate=vec3(.44,.50,.57);
            float broadTone=smoothstep(.22,.78,mottle*.55+macroA.r*.30+macroB.g*.15);
            vec3 sandstone=mix(ochreRock,warmSand,broadTone);
            sandstone=mix(sandstone,vec3(.66,.45,.30),.20*smoothstep(.55,.88,rockMid.g*macroB.r*1.5));
            sandstone=mix(sandstone,coolSlate,.28*smoothstep(.38,.82,macroA.a)*(1.-.55*sunFacing)+.22*underside);
            sandstone*=mix(.86,1.14,sunFacing);
            sandstone*=mix(.90,1.10,smoothstep(.24,.76,buttress*.6+facet*.4));
            sandstone*=1.-.14*seam-.20*shelfSeam-.14*underShelf*groupFade-.36*joints;
            sandstone*=mix(.90,1.10,grain)*(1.-.15*pits*fineFade);
            float streak=smoothstep(.54,.84,macroB.r)*(.40+.60*(1.-shelf));
            sandstone=mix(sandstone,vec3(.34,.38,.42),.16*streak);
            sandstone=mix(sandstone,vec3(.28,.34,.40),.22*joints);

            // Lush sunlit emerald moss on upward ledges & summit caps.
            float ledgeUp=smoothstep(.26,.78,rockN.y);
            float mossNoise=smoothstep(.36,.72,macroB.g*.6+mottle*.4)*(.48+.68*macroA.g);
            float moss=clamp(mossNoise*(.30+.68*ledgeUp+.36*seam+.28*joints),0.,1.);
            moss*=.38+.62*smoothstep(-.05,.48,rockN.y);
            vec3 mossDark=vec3(.075,.215,.082), mossLight=vec3(.285,.495,.135);
            vec3 mossColour=mix(mossDark,mossLight,.30+.52*macroA.g+.18*grain);
            sandstone=mix(sandstone,mossColour,.84*moss);

            float capGrowth=smoothstep(.53,.88,rockN.y);
            if(capGrowth>.01){
                vec3 capGrass=mix(vec3(.083,.253,.095),vec3(.365,.485,.098),macroA.g);
                if(footprint<3.5){
                    vec2 crownUV=rockP.xz;
                    vec2 crownDx=dFdx(crownUV),crownDz=dFdy(crownUV);
                    vec4 clumps=grassCanopyAt(crownUV,crownDx,crownDz,57.);
                    vec4 tufts=grassCanopyAt(crownUV+vec2(29.,-37.),crownDx,crownDz,14.);
                    capGrass*=.82+.52*clumps.r+.34*tufts.r;
                } else {
                    capGrass*=.96+.24*macroB.g;
                }
                sandstone=mix(sandstone,capGrass,.93*capGrowth);
            }

            diffuseColor.rgb*=sandstone;
            float reliefBump=relief*.54-joints*.58-faultEdge*.62+(rockMid.g-.5)*.45+(fine.b-.5)*.24*fineFade+(grain-.5)*.10*fineFade;
        `).replace('#include <fog_fragment>','')
        .replace('#include <tonemapping_fragment>',`
            // Distance-gated cloud-sea mist; skip texture taps for nearby or high-altitude pixels.
            float viewDist=length(vViewPosition);
            if(viewDist>120.&&vStonePoint.y<425.&&vStonePoint.x>1480.){
                vec2 mistUV=vStonePoint.xz*.0019+vec2(uTime*.006,-uTime*.0035);
                float mistWave=texture2D(uStoneNoise,mistUV).r;
                float mistCeiling=315.+mistWave*105.;
                float valleyMist=(1.-smoothstep(185.,mistCeiling,vStonePoint.y))
                    *smoothstep(1480.,1920.,vStonePoint.x)
                    *smoothstep(120.,420.,viewDist);
                vec3 mistColor=mix(vec3(.74,.86,.95),vec3(.96,.98,1.0),smoothstep(.30,.78,mistWave));
                gl_FragColor.rgb=mix(gl_FragColor.rgb,mistColor,valleyMist*.72);
            }
            gl_FragColor.rgb=mix(gl_FragColor.rgb,
                applyAerialPerspective(gl_FragColor.rgb,vStonePoint),smoothstep(140.,480.,viewDist));
            #include <tonemapping_fragment>`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            vec3 dp=dFdx(-vViewPosition),dq=dFdy(-vViewPosition);
            vec3 a=cross(dq,normal),b=cross(normal,dp);
            float determinant=dot(dp,a);
            vec3 gradient=sign(determinant)*(dFdx(reliefBump)*a+dFdy(reliefBump)*b);
            normal=normalize(max(abs(determinant),.000001)*normal-gradient);`);
    };
    return material;
}
