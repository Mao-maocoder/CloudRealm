import * as T from 'three';
import { bounds, smooth } from '../world/geo/geo-core';
import { worldHeightAt } from '../world/geo/geography';
import { fbm, randomAt, valueNoise } from '../world/geo/height';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../rendering/aerial-perspective';

const originZ = -350;
const sectors = 512;
const offsets = [-1260,-1020,-820,-625,-440,-260,-115,-36,0,48,108,180,260,350,460,580,710,850,1010,1190,1400,1620,
    1840,2100,2370,2670,2960,3280,3600,3970,4360,4780,5230,5710,6260,6850,7600]
    .flatMap((offset,i,list)=>i>0&&offset<4780?[(list[i-1]+offset)*.5,offset]:[offset]);
const ranges = [
    { center:560,  span:450,  height:310,  seed:19, ridge:.34 },
    { center:1900, span:790,  height:780,  seed:31, ridge:.56 },
    { center:3950, span:1260, height:1360, seed:52, ridge:.72 },
];

function terrainEdge(dx: number, dz: number) {
    const x = dx === 0 ? Infinity : (dx > 0 ? bounds.right : bounds.left)/dx;
    const z = dz === 0 ? Infinity : (dz > 0 ? bounds.south-originZ : bounds.north-originZ)/dz;
    return Math.min(x,z);
}

function ridged(x: number, z: number, octaves: number, seed: number) {
    let sum = 0, amp = .54, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
        const n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + i * 19) * 2 - 1);
        sum += n * n * amp;
        norm += amp;
        freq *= 2.08;
        amp *= .48;
    }
    return sum / norm;
}

function elevation(dx: number, dz: number, offset: number, edge: number, home: number) {
    const radius=edge+offset, x=dx*radius, z=originZ+dz*radius;
    if(offset<0)return worldHeightAt(x,z)-6;
    const outer=smooth(0,460,offset);
    // Gentle rolling foothill apron bridges the playable edge into the mountain base.
    const apron=smooth(45,460,offset)*(1-smooth(520,1220,offset))*(ridged(x*.0011,z*.0011,2,113)*42);
    let h=28+outer*(fbm(x*.0013,z*.0013,3,90)*74-18)+apron;
    for(const range of ranges){
        const u=dx+range.seed, v=dz-range.seed;
        const warpX=(fbm(x*.00045,z*.00045,2,range.seed+3)-.5)*340;
        const warpZ=(fbm(x*.00045+7.1,z*.00045-4.3,2,range.seed+9)-.5)*340;
        const mass=fbm((x+warpX)*.00042,(z+warpZ)*.00042,3,range.seed);
        const peak=ridged((x+warpX)*.00058,(z+warpZ)*.00058,3,range.seed+7);
        const spur=ridged(x*.00165,z*.00165,2,range.seed+23);
        const center=range.center+520*(valueNoise(u*3.1,v*3.1,range.seed)-.5);
        const profile=Math.exp(-(Math.abs((offset-center)/range.span)**1.58));
        const shape=(1-range.ridge)*(.18+.82*mass)+range.ridge*(.14+.68*peak+.22*spur);
        h+=profile*range.height*shape;
    }
    return T.MathUtils.lerp(home-6,h,outer);
}

function addCanopyLobe(
    positions: number[],
    indices: number[],
    canopy: number[],
    groves: number[],
    cx: number,
    cy: number,
    cz: number,
    height: number,
    width: number,
    twist: number,
) {
    const sides = 6;
    const apex = positions.length / 3;
    positions.push(cx, cy + height, cz);
    canopy.push(1.0);
    groves.push(1.0);

    const shoulderStart = positions.length / 3;
    const shoulderY = cy + height * .56;
    const shoulderR = width * .74;
    for (let k = 0; k < sides; k++) {
        const angle = k * Math.PI * 2 / sides + twist;
        const wobble = .88 + .24 * Math.sin(k * 2.3 + twist * 3.1);
        positions.push(
            cx + Math.cos(angle) * shoulderR * wobble,
            shoulderY + (k % 2 === 0 ? height * .05 : -height * .04),
            cz + Math.sin(angle) * shoulderR * wobble,
        );
        canopy.push(.72);
        groves.push(1.0);
    }

    const baseStart = positions.length / 3;
    const baseY = cy - 3.6;
    for (let k = 0; k < sides; k++) {
        const angle = k * Math.PI * 2 / sides + twist + .22;
        const wobble = .90 + .20 * Math.cos(k * 1.9 - twist * 2.7);
        positions.push(
            cx + Math.cos(angle) * width * wobble,
            baseY,
            cz + Math.sin(angle) * width * wobble,
        );
        canopy.push(.22);
        groves.push(1.0);
    }

    for (let k = 0; k < sides; k++) {
        const next = (k + 1) % sides;
        const s0 = shoulderStart + k, s1 = shoulderStart + next;
        const b0 = baseStart + k, b1 = baseStart + next;
        indices.push(apex, s0, s1);
        indices.push(s0, b0, s1, s1, b0, b1);
    }
}

function mountainGeometry() {
    const positions: number[] = [], indices: number[] = [], canopy: number[] = [], groves: number[] = [];
    const bearings=Array.from({length:sectors},(_,i)=>{
        const angle=i/sectors*Math.PI*2, dx=Math.cos(angle), dz=Math.sin(angle);
        const edge=terrainEdge(dx,dz);
        return {dx,dz,edge,home:worldHeightAt(dx*(edge-12),originZ+dz*(edge-12))};
    });
    for (let ring=0;ring<offsets.length;ring++) {
        const offset=offsets[ring];
        for(let i=0;i<sectors;i++){
            const {dx,dz,edge,home}=bearings[i];
            const px = dx*(edge+offset), pz = originZ+dz*(edge+offset);
            positions.push(px,elevation(dx,dz,offset,edge,home),pz);
            canopy.push(0);
            groves.push(fbm(px*.0026,pz*.0026,3,68));
            if(ring>0){
                const a=(ring-1)*sectors+i, b=(ring-1)*sectors+(i+1)%sectors;
                indices.push(a,a+sectors,b,b,a+sectors,b+sectors);
            }
        }
    }
    // Clustered, rounded foothill woodland canopies anchored inside real forest groves
    // (replaces isolated dark spike-cones with soft organic treeline masses).
    const e1 = new T.Vector3(), e2 = new T.Vector3(), triN = new T.Vector3();
    for (let i=0;i<sectors;i++){
        for (let j=0;j<16;j++) {
            const seed=randomAt(i,j,86);
            const offset=145+j*42+(seed-.5)*64;
            const across=randomAt(i,j,63);
            const ring=offsets.findIndex(radius=>radius>offset)-1;
            if(ring<0 || ring>=offsets.length-1)continue;
            const along=(offset-offsets[ring])/(offsets[ring+1]-offsets[ring]);
            const a=ring*sectors+i, b=ring*sectors+(i+1)%sectors;
            const c=a+sectors, d=b+sectors;
            const upperTri=across+along<=1;
            const sample=(axis:number)=>upperTri
                ? positions[a*3+axis]*(1-across-along)+positions[b*3+axis]*across+positions[c*3+axis]*along
                : positions[b*3+axis]*(1-along)+positions[c*3+axis]*(1-across)+positions[d*3+axis]*(across+along-1);
            const x=sample(0), y=sample(1), z=sample(2);
            // Skip sheer cliffs so canopy mounds only grow on natural wooded slopes.
            const t0 = upperTri ? a : b, t1 = upperTri ? c : c, t2 = upperTri ? b : d;
            e1.set(positions[t1*3]-positions[t0*3], positions[t1*3+1]-positions[t0*3+1], positions[t1*3+2]-positions[t0*3+2]);
            e2.set(positions[t2*3]-positions[t0*3], positions[t2*3+1]-positions[t0*3+1], positions[t2*3+2]-positions[t0*3+2]);
            triN.crossVectors(e1, e2).normalize();
            if(Math.abs(triN.y) < .74)continue;

            const grove=fbm(x*.0026,z*.0026,3,68);
            if(y<48 || y>345 || grove<.52 || seed>smooth(.49,.74,grove))continue;

            const height=10+across*10.5;
            const width=height*(.58+seed*.32);
            const twist=seed*Math.PI*2;
            addCanopyLobe(positions, indices, canopy, groves, x, y, z, height, width, twist);

            // Companion overlapping crown gives a natural rolling forest clump silhouette.
            const sideAngle=twist+1.9+across*1.4;
            const sideDist=width*(.48+seed*.24);
            const subH=height*(.74+randomAt(i,j,41)*.22);
            const subW=width*(.76+randomAt(i,j,42)*.20);
            addCanopyLobe(
                positions, indices, canopy, groves,
                x+Math.cos(sideAngle)*sideDist, y-.8, z+Math.sin(sideAngle)*sideDist,
                subH, subW, twist+1.1,
            );
        }
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('aCanopy',new T.Float32BufferAttribute(canopy,1));
    geometry.setAttribute('aGrove',new T.Float32BufferAttribute(groves,1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** A world-anchored background heightfield adjoining the playable terrain. */
export function makeDistantMountains(sun: T.Vector3) {
    const material=new T.ShaderMaterial({
        side:T.DoubleSide,
        uniforms:{uSun:{value:sun},...atmosphereUniforms},
        vertexShader:`
            attribute float aCanopy,aGrove;
            varying vec3 vMountainPoint,vMountainNormal;
            varying float vCanopy,vGrove;
            void main() {
                vMountainPoint=position;
                vMountainNormal=normal;
                vCanopy=aCanopy;
                vGrove=aGrove;
                vec4 viewPoint=modelViewMatrix*vec4(position,1.);
                gl_Position=projectionMatrix*viewPoint;
                // Background-only depth range. The main terrain keeps the game's
                // normal near/far planes and receives a fresh depth buffer.
                const float far=19000., near=8.;
                gl_Position.z=(far+near)/(far-near)*gl_Position.w-2.*far*near/(far-near);
            }`,
        fragmentShader:`
            varying vec3 vMountainPoint,vMountainNormal;
            varying float vCanopy,vGrove;
            uniform vec3 uSun;
            ${aerialPerspectiveGLSL}
            float mountainHash(vec2 p) {
                return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
            }
            float mountainNoise(vec2 p) {
                vec2 i=floor(p),f=fract(p);
                f=f*f*(3.-2.*f);
                return mix(mix(mountainHash(i),mountainHash(i+vec2(1.,0.)),f.x),
                           mix(mountainHash(i+vec2(0.,1.)),mountainHash(i+1.),f.x),f.y);
            }
            float mountainFbm(vec2 p) {
                const mat2 rot=mat2(.80,-.60,.60,.80);
                float v=0., a=.52;
                for(int i=0;i<3;i++){
                    v+=mountainNoise(p)*a;
                    p=rot*p*2.04+vec2(13.7,-7.3);
                    a*=.48;
                }
                return v;
            }
            float mountainRidged(vec2 p) {
                const mat2 rot=mat2(.80,-.60,.60,.80);
                float v=0., a=.55, norm=0.;
                for(int i=0;i<3;i++){
                    float n=1.-abs(mountainNoise(p)*2.-1.);
                    v+=n*n*a;
                    norm+=a;
                    p=rot*p*2.07+vec2(-9.1,17.4);
                    a*=.48;
                }
                return v/norm;
            }
            void main() {
                vec3 n=normalize(vMountainNormal);
                if(n.y<0.)n=-n;
                vec2 p=vMountainPoint.xz;
                float y=vMountainPoint.y;
                float distToCam=length(vMountainPoint-cameraPosition);

                // Multi-scale procedural geological relief & analytic normal detail.
                float macro=mountainFbm(p*.0016+vec2(3.7,-5.2));
                vec2 warp=vec2(macro*1.4,-macro*1.1);
                float ridge=mountainRidged(p*.0038+warp);
                float gully=mountainRidged(p*.0115+vec2(y*.004,-y*.003));
                float strata=sin(y*.048+macro*5.2+ridge*2.4)*.5+.5;

                float eps=16.;
                float hC=ridge*.62+gully*.38;
                float hX=mountainRidged((p+vec2(eps,0.))*.0038+warp)*.62
                        +mountainRidged((p+vec2(eps,0.))*.0115+vec2(y*.004,-y*.003))*.38;
                float hZ=mountainRidged((p+vec2(0.,eps))*.0038+warp)*.62
                        +mountainRidged((p+vec2(0.,eps))*.0115+vec2(y*.004,-y*.003))*.38;
                vec2 grad=vec2(hX-hC,hZ-hC)/eps;
                float distDamp=1.-smoothstep(2800.,6800.,distToCam)*.45;
                float reliefStrength=mix(11.5,1.6,smoothstep(.05,.35,vCanopy))*distDamp;
                vec3 detailN=normalize(n-vec3(grad.x*reliefStrength,0.,grad.y*reliefStrength));
                float slope=1.-detailN.y;

                // Harmonized valley pasture & lush contiguous mountain woodland belts
                // locked to the CPU grove field so every canopy cluster sits inside real woods.
                vec3 pasture=mix(vec3(.175,.335,.135),vec3(.345,.455,.175),smoothstep(.18,.82,macro*.65+ridge*.35));
                float groveDetail=mountainFbm(p*.011+vec2(11.3,7.9));
                float groveMask=vGrove*.76+groveDetail*.24;
                float canopyGrain=mountainNoise(p*.042+vec2(y*.012,-y*.014))*.62
                                 +mountainNoise(p*.095+vec2(-y*.02,y*.015))*.38;
                float treeline=smoothstep(24.,92.,y)*(1.-smoothstep(390.,670.,y+(macro-.5)*190.));
                float ravineBonus=smoothstep(.56,.20,ridge)*.22;
                float forest=treeline
                    *smoothstep(.30,.60,groveMask+ravineBonus)
                    *(1.-smoothstep(.19,.45,slope));
                float valleyWood=(1.-smoothstep(55.,165.,y))*smoothstep(.40,.70,groveMask)*.72;
                forest=clamp(max(forest,valleyWood),0.,1.);

                vec3 woodsDeep=mix(vec3(.048,.138,.102),vec3(.085,.202,.128),macro);
                vec3 woodsCrown=mix(vec3(.115,.252,.138),vec3(.215,.342,.152),canopyGrain);
                vec3 woods=mix(woodsDeep,woodsCrown,smoothstep(.26,.78,canopyGrain*.72+detailN.y*.28));

                // Stratified granite/limestone crags with mossy lower crevices.
                float cliffMask=smoothstep(.17,.38,slope+(gully-.48)*.18)*smoothstep(95.,340.,y);
                float alpineScree=smoothstep(520.,860.,y+(ridge-.5)*180.)*smoothstep(.08,.28,slope+.08);
                float rockWeight=clamp(max(cliffMask,alpineScree*.88),0.,1.);
                vec3 rockDark=vec3(.195,.248,.295);
                vec3 rockWarm=mix(vec3(.44,.43,.39),vec3(.58,.54,.46),strata);
                vec3 stone=mix(rockDark,rockWarm,smoothstep(.22,.78,ridge*.55+strata*.28+gully*.17));
                float rockMoss=(1.-smoothstep(220.,520.,y))*smoothstep(.52,.80,detailN.y+(macro-.5)*.35);
                stone=mix(stone,woodsDeep*1.15,rockMoss*.42);

                // Subtle alpine snow crests along the distant northern peaks.
                float northSector=1.-smoothstep(-1450.,-900.,vMountainPoint.z);
                float snowMask=northSector*smoothstep(640.,980.,y+(ridge-.5)*260.)*(1.-smoothstep(.32,.62,slope));
                vec3 snowCol=mix(vec3(.68,.78,.88),vec3(.95,.96,.99),smoothstep(.25,.75,ridge));

                vec3 color=mix(mix(pasture,woods,forest*.92),stone,rockWeight);
                color=mix(color,snowCol,snowMask*.86);

                if(vCanopy>.001){
                    // Soft sunlit crown gradient on foothill forest clusters.
                    float crownGrad=smoothstep(.22,.95,vCanopy);
                    vec3 canopyCol=mix(woodsDeep*.88,woodsCrown*1.06,crownGrad);
                    color=mix(color,canopyCol,smoothstep(.0,.28,vCanopy));
                }

                // Painterly warm-sun / cool-sky-shadow lighting with subtle valley depth AO.
                vec3 sunDir=normalize(uSun);
                float sunlit=smoothstep(-.12,.76,dot(detailN,sunDir));
                vec3 shadowTint=mix(vec3(.48,.63,.80),vec3(.64,.78,.90),detailN.y*.5+.5);
                vec3 sunTint=vec3(1.24,1.18,1.06);
                float troughAO=.85+.15*smoothstep(20.,360.,y);
                color*=mix(shadowTint,sunTint,sunlit)*troughAO*mix(vec3(.22,.32,.52),vec3(1.),uAtmoLight);

                // Layered inter-range valley mist softens the map-edge seam and separates depth planes.
                float mistBand=exp(-max(0.,y-24.)/150.);
                float mistNoise=.76+.24*mountainNoise(p*.00095+vec2(2.3,-4.1));
                float rangeMist=mistBand*smoothstep(720.,2900.,distToCam)*mistNoise*(.34+.28*uHeightFogDensity);
                float farVeil=smoothstep(2600.,6800.,distToCam)*exp(-max(0.,y-160.)/520.)*.26;
                vec3 layerMistCol=mix(uAtmoMist,uAtmoAir,.32);
                color=mix(color,layerMistCol,clamp(rangeMist+farVeil,0.,.58));

                // Guofeng ink-wash distant mountain silhouettes: dissolve lower bases into luminous mist
                // and step ridge depth into soft blue-grey / lavender-grey watercolor planes.
                if(uGuofengStyle>.5){
                    float inkLuma=dot(color,vec3(.30,.59,.11));
                    vec3 inkRidge=mix(uAtmoAir*.62,uAtmoMist*.88,smoothstep(.15,.85,inkLuma));
                    float inkFade=smoothstep(1250.,4600.,distToCam);
                    color=mix(color,inkRidge,inkFade*.72);
                    // Dissolve mountain base completely into valley horizon mist so no hard terrain seam appears
                    float baseDissolve=exp(-max(0.,y-18.)/245.)*smoothstep(650.,2400.,distToCam);
                    vec3 horizonMist=mix(uAtmoMist,uAtmoSunAir,.35*uDuskFactor+.18);
                    color=mix(color,horizonMist,clamp(baseDissolve*.88,0.,.88));
                }

                color=applyAerialPerspective(color,vMountainPoint);
                gl_FragColor=vec4(color,1.);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const mesh=new T.Mesh(mountainGeometry(),material);
    mesh.name='distant mountain ranges';
    mesh.frustumCulled=false;
    mesh.renderOrder=-1000;
    mesh.onAfterRender=renderer=>renderer.clearDepth();
    return mesh;
}
