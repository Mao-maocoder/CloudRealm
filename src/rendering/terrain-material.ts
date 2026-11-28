import{makeRoadDistanceTexture,roadDistanceGLSL}from './road-distance-texture';
import{makeGeographyTexture,heightTextureGLSL,makeGeographyNormalTexture,normalTextureGLSL}from './geography-texture';
import{makeRockDetailTexture}from './peakland-stone';
import * as T from 'three';
import {reliefGLSL} from '../world/geo/relief';
import {meadowWindGLSL} from '../effects/meadow-trail';
import {valleyArtGLSL} from '../world/geo/valley-art';
import {makeVillageGroundTexture,villageGroundGLSL} from '../world/biomes/village-ground';
import {makeRiverbankTexture,riverbankGLSL} from './riverbank-texture';
import {bridgeShadeGLSL} from '../world/geo/bridge-look';
import {aerialPerspectiveGLSL, atmosphereUniforms} from './aerial-perspective';
import {makeRegionalTexture,regionalTextureGLSL} from './regional-texture';
import {makeClearingLight,clearingLightGLSL} from './clearing-light';
import {makeCorridorTexture,riverCorridorGLSL} from './river-corridor-texture';
import {makeGrassCanopyTexture,grassCanopyGLSL} from './grass-canopy-texture';
import {valleyLandmarksGLSL} from '../world/geo/valley-landmarks';
import {bossWastelandGLSL} from '../world/geo/boss-territories';
import {canopyShadeGLSL,makeCanopyShade} from './canopy-shade';
import {cascadeCliffGLSL} from './cascade-cliff';

// A seamless square of short, overlapping grass strokes, filtered into the
// terrain mipmaps as individual blades disappear across the valley.
export function makePastureTexture(): T.Texture {
    if (typeof document === 'undefined') {
        const data = new Uint8Array([136, 136, 136, 255]);
        const fallback = new T.DataTexture(data, 1, 1, T.RGBAFormat);
        fallback.wrapS = fallback.wrapT = T.RepeatWrapping;
        fallback.needsUpdate = true;
        return fallback;
    }
    const canvas=document.createElement('canvas');
    const size=canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#888888';
    ctx.fillRect(0,0,size,size);
    let seed=12345;
    const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    for(let i=0;i<2400;i++){
        const x=rand()*size,y=rand()*size, angle=.65*Math.sin(y/size*2*Math.PI)+rand()*.85;
        const tone=Math.round(65+rand()*155), length=2+rand()*7;
        ctx.fillStyle='rgb('+tone+','+tone+','+tone+')';
        for(const dx of (x<10?[0,size]:x>size-10?[0,-size]:[0]))
            for(const dy of (y<10?[0,size]:y>size-10?[0,-size]:[0])){
                ctx.beginPath();ctx.ellipse(x+dx,y+dy,length,1+(i%7)*.22,angle,0,Math.PI*2);ctx.fill();
            }
    }
    const map=new T.CanvasTexture(canvas);
    map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=8;
    return map;
}


/**
 * Lambert base + world-space paint pass. Vertex colours do the broad biome
 * painting; this shader adds non-repeating meadow speckle, rock strata,
 * a wet waterline and slow-moving cloud shadows so the valley feels alive.
 */
export function createTerrainMaterial() {
    const material = new T.MeshLambertMaterial({ vertexColors: true });const geography=makeGeographyTexture(),geoNormal=makeGeographyNormalTexture(),roadSDF=makeRoadDistanceTexture();const rockDetail=makeRockDetailTexture();material.addEventListener('dispose',()=>roadSDF.dispose());material.addEventListener('dispose',()=>geography.dispose());material.addEventListener('dispose',()=>geoNormal.dispose());
    const villageGround=makeVillageGroundTexture();
    const pasture=makePastureTexture();
    const riverbank=makeRiverbankTexture();
    material.addEventListener('dispose',()=>pasture.dispose());
    material.addEventListener('dispose',()=>riverbank.dispose());
    material.addEventListener('dispose',()=>villageGround.dispose());
    const regional=makeRegionalTexture();
    const clearing=makeClearingLight();
    const corridor=makeCorridorTexture();
    const grassCanopy=makeGrassCanopyTexture();
    const canopyShade=makeCanopyShade();
    material.addEventListener('dispose',()=>regional.dispose());
    material.addEventListener('dispose',()=>clearing.dispose());
    material.addEventListener('dispose',()=>corridor.dispose());
    material.addEventListener('dispose',()=>grassCanopy.dispose());
    material.addEventListener('dispose',()=>canopyShade.dispose());
    const uniforms = { uTime: { value: 0 },uGeoDebug:{value:0},uVillageGround:{value:villageGround},
        uRiverbank:{value:riverbank},uRegionalHabitat:{value:regional},uClearingLight:{value:clearing},
        uRiverCorridor:{value:corridor} };
    material.onBeforeCompile = shader => {
        shader.uniforms.uRoadDistance={value:roadSDF};shader.uniforms.uGeography={value:geography};shader.uniforms.uTime = uniforms.uTime;shader.uniforms.uGeoDebug=uniforms.uGeoDebug;shader.uniforms.uRockDetail={value:rockDetail};shader.uniforms.uGeoNormal={value:geoNormal};
        shader.uniforms.uVillageGround=uniforms.uVillageGround;
        shader.uniforms.uPasture={value:pasture};
        shader.uniforms.uRiverbank=uniforms.uRiverbank;
        shader.uniforms.uRegionalHabitat=uniforms.uRegionalHabitat;
        shader.uniforms.uClearingLight=uniforms.uClearingLight;
        shader.uniforms.uRiverCorridor=uniforms.uRiverCorridor;
        shader.uniforms.uGrassCanopy={value:grassCanopy};
        shader.uniforms.uCanopyShade={value:canopyShade};
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vSlope;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vWNormal = normalize(mat3(modelMatrix) * normal);
            vSlope = 1.0 - clamp(normal.y, 0.0, 1.0);`
        );
        shader.fragmentShader = `varying vec3 vWPos;
        varying vec3 vWNormal;
        varying float vSlope;
        uniform float uTime; uniform float uGeoDebug;
        uniform sampler2D uRockDetail;
        uniform sampler2D uPasture;
        ${heightTextureGLSL}
        ${normalTextureGLSL}
        ${roadDistanceGLSL}
        ${reliefGLSL}
        ${meadowWindGLSL}
        ${valleyArtGLSL}
        ${villageGroundGLSL}
        ${riverbankGLSL}
        ${bridgeShadeGLSL}
        ${aerialPerspectiveGLSL}
        ${regionalTextureGLSL}
        ${clearingLightGLSL}
        ${riverCorridorGLSL}
        ${grassCanopyGLSL}
        ${valleyLandmarksGLSL}
        ${bossWastelandGLSL}
        ${canopyShadeGLSL}
        vec4 rockTriplanar(vec3 p,vec3 n,float scale){
            vec3 w=pow(abs(n),vec3(4.));w/=max(dot(w,vec3(1.)),.0001);
            vec4 x=texture2D(uRockDetail,p.zy*scale),y=texture2D(uRockDetail,p.xz*scale),z=texture2D(uRockDetail,p.xy*scale);
            return x*w.x+y*w.y+z*w.z;
        }
        float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float tNoise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                       mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float tFbm(vec2 p){
            float sum = 0.0, amp = 0.5;
            for (int i = 0; i < 4; i++) { sum += tNoise(p) * amp; p = p * 2.03 + 11.7; amp *= 0.5; }
            return sum;
        }
        ${cascadeCliffGLSL}
        ` + shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            vec4 geo=plannedGeography(vWPos.xz);
            // Keep the opaque riverbed beneath transparent water.
            vec2 worldUV=vWPos.xz;
            vec2 warp=vec2(tNoise(worldUV*.014+vec2(3.7,9.1)),tNoise(worldUV*.017+vec2(72.1,5.9)))*16.0;
            float macro=tFbm((worldUV+warp)*.037);
            float valley=valleyArtAt(worldUV);
            float gfValley=uGuofengStyle;
            float footprint=max(length(dFdx(worldUV)),length(dFdy(worldUV)));
            float fineFade=1.-smoothstep(.3,1.8,footprint);
            // Height-derived shading remains stable when the rendered mesh changes LOD.
            // Normals come from a baked per-grid-point field so no 8 m cell edges
            // can leak into the cliff shading or the slope masks.
            vec3 terrainNormal=plannedNormal(worldUV);
            float terrainSlope=1.-terrainNormal.y;
            float fine=tNoise((worldUV+warp)*.72);
            diffuseColor.rgb*=.9+.17*macro+(.055*fine-.025)*fineFade;
            float rock=smoothstep(.09,.34,terrainSlope);
            float strataPosition=vWPos.y*.115+worldUV.x*.018-worldUV.y*.012+3.2*tNoise(worldUV*.009);
            float strata=tNoise(vec2(strataPosition,worldUV.x*.022+worldUV.y*.017));
            float darkSeam=(1.-smoothstep(.018,.12,abs(fract(strataPosition*.72)-.5)))*(1.-smoothstep(.16,.65,fwidth(strataPosition)));
            float veins=tNoise(vec2(worldUV.x*.115+vWPos.y*.045,worldUV.y*.082-vWPos.y*.036));
            float veinsFade=1.-smoothstep(1.8,7.,footprint);
            vec3 mineral=mix(vec3(.16,.185,.205),vec3(.46,.405,.338),smoothstep(.18,.80,macro*.49+strata*.51));
            mineral*=.90+.19*strata+.13*veins*veinsFade-.14*darkSeam*veins;
            mineral=mix(mineral,vec3(.51,.50,.46),.20*smoothstep(.64,.92,veins)*veinsFade);
            float mountainSlope=smoothstep(85.,220.,vWPos.y);
            if(mountainSlope>.001) {
                // Mineral facets track the hillside and break the old parallel strata.
                vec2 p=worldUV+warp*2.1;
                vec2 downslope=terrainNormal.xz;
                vec2 gully=p+downslope*(tNoise(p*.004)*95.);
                float face=tNoise(gully*.008)*.66+tNoise(gully*.026)*.34;
                float outcrop=smoothstep(.34,.70,face+(terrainSlope-.15)*.7);
                vec3 faceColor=mix(vec3(.055,.075,.09),vec3(.34,.365,.35),outcrop);
                // Vertical cracks and strata keep the high peaks from reading as
                // smooth plaster when the mesh is far away.
                float crag=tNoise(vec2(p.x*.055,p.y*.018)+vWPos.y*.012);
                faceColor*=.74+.38*outcrop-.22*smoothstep(.50,.76,crag);
                mineral=mix(mineral,faceColor,mountainSlope*.90);
            }
            float exposedRock=rock*(1.-.28*smoothstep(510.,730.,vWPos.y));
            diffuseColor.rgb=mix(diffuseColor.rgb,mineral,exposedRock*.76);
            float shoreHeight=geo.r-geo.g;
            float shoreCoverage=smoothstep(.12,.50,geo.b);
            float wet=0.,shore=0.;
            if(shoreCoverage>0.){
                float organicShore=shoreHeight;
                if(shoreHeight<4.2){
                    float bankWarp=(tFbm(worldUV*.095+vec2(4.3,9.1))-.5)*1.05+(tNoise(worldUV*.34+vec2(17.2,3.8))-.5)*.45;
                    organicShore-=bankWarp*(1.-smoothstep(.8,4.2,max(0.,shoreHeight)));
                }
                wet=(1.-smoothstep(.0,1.35+macro*.85,organicShore))*shoreCoverage;
                shore=(1.-smoothstep(.95,3.6+macro*1.35,organicShore))*shoreCoverage;
            }
            float meadow=(1.-smoothstep(.08,.3,terrainSlope))*(1.-smoothstep(300.,420.,vWPos.y))*(1.-shore*.9);
            float fieldDistance=distance(cameraPosition.xz,worldUV);
            float surfaceDistance=length(cameraPosition-vWPos);
            vec4 biome=regionalTerrain(worldUV);
            float farSward=smoothstep(45.,150.,fieldDistance);
            float mott=tNoise(worldUV*.065)*.6+tNoise(worldUV*.19+9.3)*.4;
            vec3 sward=mix(vec3(.20,.46,.125),vec3(.30,.56,.135),farSward)*(.82+.24*macro+.22*mott);
            // Warm sunlit spring-meadow green with painterly grass-clump variation matching 3D blades.
            vec2 swale=worldUV+warp*1.8;
            float pasture=tNoise(swale*vec2(.019,.031))*.50+macro*.30+mott*.20;
            float sunlit=smoothstep(.24,.72,pasture);
            vec3 valleyGrass=mix(vec3(.175,.455,.125),vec3(.485,.715,.142),sunlit);
            vec3 gfValleyGrass=mix(vec3(.125,.245,.125),vec3(.345,.415,.195),sunlit);
            valleyGrass=mix(valleyGrass,gfValleyGrass,gfValley);
            float tussock=tNoise(swale*vec2(.85,1.24)+fine*.42);
            float strokes=smoothstep(.42,.78,tussock)*fineFade;
            valleyGrass*=.84+.22*mott+.20*strokes;
            valleyGrass+=mix(vec3(.085,.088,.008),vec3(.048,.046,.016),gfValley)*strokes*sunlit;
            vec2 brushUV=(worldUV+.25*warp);
            float brush=texture2D(uPasture,brushUV/11.5).r;
            valleyGrass*=.66+.70*brush;
            valleyGrass=mix(valleyGrass,mix(vec3(.145,.42,.155),vec3(.105,.225,.135),gfValley),wet*.45);
            vec3 uplandGrass=mix(vec3(.19,.49,.145),biome.rgb*(.86+.26*macro+.22*mott+.18*strokes),.60)*(.84+.28*brush);
            if(gfValley>.001){
                float uLuma=dot(uplandGrass,vec3(.30,.59,.11));
                vec3 gfUpland=mix(vec3(uLuma)*vec3(.92,.96,.88),uplandGrass*vec3(.84,.72,.80),.58);
                uplandGrass=mix(uplandGrass,gfUpland,gfValley*.82);
            }
            float forestFloor=smoothstep(.19,.76,biome.a);
            uplandGrass=mix(uplandGrass,uplandGrass*vec3(.56,.82,.82),forestFloor*.40);
            sward=mix(sward,uplandGrass,.84);
            sward=mix(sward,valleyGrass,valley);
            diffuseColor.rgb=mix(diffuseColor.rgb,sward,meadow*mix(.72,.96,valley));
            diffuseColor.rgb*=1.+meadow*meadowGust(worldUV,uTime)*.045;
            float spring=smoothstep(.07,.21,biome.rgb.r-biome.rgb.b)*(1.-forestFloor*.8);
            float bloom=smoothstep(.57,.79,tNoise(worldUV*.024+vec2(19.,7.)));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.57,.43,.39),
                meadow*smoothstep(140.,230.,fieldDistance)*bloom*spring*.085*(1.-valley));
            // Delicate speckled wildflower drifts so the hillside stays lush green
            // instead of smearing into flat purple/yellow patches at grazing angles.
            float flowerSpeck = smoothstep(.36, .78, tNoise(worldUV * .48 + vec2(13., 29.)));
            float flowerField = smoothstep(.50, .76, tNoise(worldUV * .017 + vec2(31., 7.))) * (.35 + .65 * flowerSpeck);
            float flowerSpecies = tNoise(worldUV * .008 + 3.7);
            vec3 flowerWash = flowerSpecies < .30 ? vec3(.48, .38, .66)
                : flowerSpecies < .62 ? vec3(.84, .74, .22) : vec3(.78, .48, .58);
            flowerWash = mix(flowerWash, vec3(.82, .81, .74), gfValley * .85);
            diffuseColor.rgb = mix(diffuseColor.rgb, flowerWash, meadow * valley * flowerField * mix(.20, .07, gfValley));
            float pinkField = smoothstep(.56, .78, tNoise(worldUV * .011 + vec2(5., 9.))) * (.35 + .65 * flowerSpeck);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(.66, .40, .50), vec3(.78, .77, .70), gfValley), meadow * valley * pinkField * mix(.14, .04, gfValley));
            float gravel=mix(.5,tNoise(worldUV*2.7+warp),fineFade);
            vec3 bank=mix(vec3(.37,.34,.25),vec3(.64,.60,.46),gravel);
            vec3 dampBank=mix(vec3(.19,.144,.097),vec3(.42,.359,.251),.62*gravel+.38*macro);
            vec3 valleyBank=mix(dampBank,vec3(.38,.343,.242),1.-wet);
            float brokenBank=shore*mix(.64,1.,smoothstep(.23,.69,mott));
            diffuseColor.rgb=mix(diffuseColor.rgb,mix(bank,valleyBank,valley),mix(shore*.46,brokenBank*.79,valley));
            float bankPatch=shore*(1.-smoothstep(.54,.77,mott*.61+fine*.39));
            vec3 exposedBank=mix(dampBank,biome.rgb*.68,wet*.20);
            diffuseColor.rgb=mix(diffuseColor.rgb,exposedBank,bankPatch*(1.-valley)*.6);
            diffuseColor.rgb*=1.-wet*mix(.18,.29,valley);
            vec4 habitat=riverbankHabitat(worldUV);
            vec4 corridor=riverCorridor(worldUV);
            float dampness=(corridor.r-.5)*2.;
            float wetBand=smoothstep(.08,.71,dampness)*corridor.a;
            float exposedGravel=smoothstep(.12,.73,-dampness)*corridor.a;
            float forestBand=smoothstep(.13,.70,corridor.g);
            float openPasture=smoothstep(.15,.83,corridor.b);
            vec3 corridorPasture=mix(vec3(.142,.310,.058),vec3(.43,.53,.099),openPasture);
            corridorPasture=mix(corridorPasture,biome.rgb,.22);
            vec3 floodplain=mix(vec3(.063,.247,.128),vec3(.153,.37,.181),mott);
            vec3 woodland=mix(vec3(.040,.115,.087),vec3(.100,.254,.129),mott*.59+macro*.41);
            vec3 corridorColor=mix(mix(corridorPasture,floodplain,wetBand*.93),woodland,forestBand*.91);
            corridorColor*=.82+.29*brush+.08*strokes;
            vec3 shoal=mix(vec3(.19,.150,.112),vec3(.52,.43,.29),gravel*.78+mott*.22);
            corridorColor=mix(corridorColor,shoal,exposedGravel);
            float longView=smoothstep(105.,370.,surfaceDistance);
            float corridorLand=(1.-smoothstep(.16,.46,terrainSlope))*(1.-smoothstep(260.,447.,vWPos.y));
            float drySurface=mix(1.,smoothstep(-.4,.7,shoreHeight),shoreCoverage);
            float protectedBank=1.-habitat.a*.92;
            float groundBlend=corridor.a*max(corridorLand,exposedGravel)*drySurface*protectedBank;
            diffuseColor.rgb=mix(diffuseColor.rgb,corridorColor,groundBlend*mix(.30,.92,longView));
            float wetMeadow=smoothstep(.22,.68,habitat.r);
            vec3 dryMeadow=mix(vec3(.21,.49,.135),vec3(.51,.72,.15),
                               smoothstep(.24,.72,.52*macro+.48*mott));
            vec3 wetGrass=mix(vec3(.115,.385,.155),vec3(.27,.57,.165),mott);
            dryMeadow=mix(dryMeadow,mix(vec3(.140,.255,.128),vec3(.345,.415,.198),smoothstep(.24,.72,.52*macro+.48*mott)),gfValley);
            wetGrass=mix(wetGrass,mix(vec3(.095,.215,.128),vec3(.195,.320,.162),mott),gfValley);
            vec3 bankCover=mix(dryMeadow,wetGrass,wetMeadow);
            bankCover=mix(bankCover,vec3(.095,.285,.145),smoothstep(.14,.79,habitat.g)*.68);
            bankCover*=(.70+.64*brush)*(.94+.22*strokes);
            // Lush sunlit riverbank wildflower ribbons painted into the bank sward so distant banks bloom richly.
            float bankFlowerBand=smoothstep(.18,.68,habitat.r)*(1.-smoothstep(.15,.55,habitat.b));
            float bankBloom=smoothstep(.46,.76,tNoise(worldUV*.055+vec2(17.,-9.)))*smoothstep(.38,.78,tNoise(worldUV*.42+vec2(-5.,11.)));
            float bankHue=tNoise(worldUV*.032+4.3);
            vec3 bankFlowerCol=bankHue<.38?vec3(.96,.84,.22):bankHue<.68?vec3(.48,.74,.98):vec3(.98,.94,.88);
            bankFlowerCol=mix(bankFlowerCol,vec3(.92,.91,.85),gfValley*.85);
            bankCover=mix(bankCover,bankFlowerCol,bankFlowerBand*bankBloom*mix(.42,.18,gfValley));
            vec3 sediment=mix(vec3(.31,.215,.135),vec3(.50,.39,.245),.57*gravel+.43*mott);
            bankCover=mix(bankCover,sediment,smoothstep(.10,.57,habitat.b));
            float plantedSlope=1.-smoothstep(.16,.43,terrainSlope);
            diffuseColor.rgb=mix(diffuseColor.rgb,bankCover,habitat.a*max(plantedSlope,smoothstep(.10,.57,habitat.b)));
            float cloud=tNoise(worldUV*.0024+vec2(uTime*.0045,uTime*.0016));
            diffuseColor.rgb*=1.-.075*smoothstep(.42,.84,cloud);
            float grassRoadMask=1.;
            float yard=villageGround(worldUV);
            if(vWPos.x>-2048.&&vWPos.x<2048.&&vWPos.z>-2400.&&vWPos.z<1696.){
                float roadDistance=plannedRoadDistance(worldUV);
                float shoulder=3.8+(tNoise(worldUV*.42)-.5)*mix(.9,2.15,valley);
                float aa=min(2.0,footprint*.35);
                float trail=(1.-smoothstep(max(0.,1.35-aa),shoulder+aa,roadDistance))*(1.-wet*.9);
                vec3 packed=mix(vec3(.31,.24,.17),vec3(.52,.43,.30),.4+.35*macro+.25*gravel);
                float grains=smoothstep(.72,.92,tNoise(worldUV*9.7+warp))*fineFade;
                vec3 clay=mix(vec3(.39,.30,.18),vec3(.67,.55,.34),smoothstep(.22,.83,.45*macro+.35*gravel+.2*fine));
                clay*=1.-grains*.29;
                clay=mix(clay,sward,.25*smoothstep(1.25,3.85,roadDistance)*fine);
                float pathMask=max(trail*.92,yard);
                grassRoadMask=1.-smoothstep(.06,.62,pathMask);
                diffuseColor.rgb=mix(diffuseColor.rgb,mix(packed,clay,valley),pathMask);
            }
            diffuseColor.rgb*=mix(vec3(1.),vec3(.64,.80,.91),bridgeShade(worldUV));
            vec4 clearing=clearingLight(worldUV);
            vec3 clearingGrass=mix(vec3(.24,.44,.135),vec3(.029,.178,.105),clearing.g);
            clearingGrass*=.82+.20*mott+.22*brush;
            diffuseColor.rgb=mix(diffuseColor.rgb,clearingGrass,clearing.r*.94);
            // High ground is painted by slope: grass on the sheep backs, dark
            // bedded rock on the faces, snow only on the crests. Without this the
            // distant peaks read as one smooth pale mass.
            float alpine=smoothstep(300.,520.,vWPos.y);
            float ridgeStreak=tNoise(vec2(worldUV.x*.027+vWPos.y*.018,worldUV.y*.013-vWPos.y*.008));
            float alpineSteep=smoothstep(.155,.39,terrainSlope+(ridgeStreak-.49)*.14);
            float cascadeRange=(1.-smoothstep(-1180.,-930.,worldUV.y))
                *(1.-smoothstep(1060.,1430.,abs(worldUV.x)))*smoothstep(55.,166.,abs(worldUV.x));
            float cliffExposure=cascadeRange*smoothstep(175.,330.,vWPos.y)
                *smoothstep(.065,.24,terrainSlope+(ridgeStreak-.49)*.09);
            float alpineRock=alpine*alpineSteep*(1.-cliffExposure*.9);
            if(alpineRock>.001){
                vec2 ap=worldUV+warp*1.4;
                float crag=tNoise(ap*.018+vec2(vWPos.y*.006,3.7));
                float band=tNoise(vec2(vWPos.y*.11,ap.x*.02+ap.y*.015))*.6+tNoise(ap*.055)*.4;
                vec3 cragColor=mix(vec3(.095,.155,.215),vec3(.52,.48,.38),smoothstep(.27,.71,crag*.62+ridgeStreak*.38));
                cragColor*=.72+.46*band;
                cragColor*=.88+.18*smoothstep(-.4,.6,terrainNormal.x);
                diffuseColor.rgb=mix(diffuseColor.rgb,cragColor,alpineRock*.94);
            }
            float ledge=smoothstep(.13,.61,terrainNormal.y+(ridgeStreak-.55)*.22);
            float alpineGrass=alpine*(1.-alpineSteep)*ledge*(1.-smoothstep(690.,880.,vWPos.y));
            if(alpineGrass>.001){
                vec3 tundra=mix(vec3(.086,.227,.068),vec3(.315,.438,.108),smoothstep(.16,.84,mott*.54+ridgeStreak*.46));
                tundra*=.82+.25*macro;
                diffuseColor.rgb=mix(diffuseColor.rgb,tundra,alpineGrass*.72);
            }
            float north=1.-smoothstep(-1310.,-1120.,worldUV.y);
            float snowline=smoothstep(574.,805.,vWPos.y+(ridgeStreak-.48)*244.);
            float drifts=smoothstep(454.,610.,vWPos.y)*smoothstep(.60,.78,macro*.49+ridgeStreak*.51)*.56;
            float snowPatch=smoothstep(.36,.62,tNoise(worldUV*.032+vec2(vWPos.y*.012,4.2)))*.66+.34;
            float deposits=north*max(snowline,drifts)*snowPatch*(1.-smoothstep(.34,.66,terrainSlope));
            float cliffRelief=0.;
            // 3D pixel footprint (the xz one collapses on vertical faces);
            // taken outside the branch so the derivatives stay well defined.
            float cliffFootprint=max(length(dFdx(vWPos)),length(dFdy(vWPos)));
            if(cliffExposure>.005){
                vec4 cliffs=cascadeCliff(vWPos,terrainNormal,terrainSlope,cliffFootprint);
                diffuseColor.rgb=mix(diffuseColor.rgb,cliffs.rgb,cliffExposure*.96);
                cliffRelief=cliffs.a*cliffExposure;
            }
            deposits*=mix(1.,.12+.62*smoothstep(850.,1030.,vWPos.y),cascadeRange);
            vec3 powder=mix(vec3(.62,.74,.84),vec3(.96,.97,.99),smoothstep(.16,.76,mott));
            powder*=.92+.10*smoothstep(.2,.8,terrainNormal.y);
            diffuseColor.rgb=mix(diffuseColor.rgb,powder,deposits*.97);
            float woodlandDistance=smoothstep(380.,680.,fieldDistance);
            if(woodlandDistance>.001&&vWPos.y>92.&&vWPos.y<412.){
                float treeline=smoothstep(93.,155.,vWPos.y)*(1.-smoothstep(270.,405.,vWPos.y+macro*63.));
                float forest=tNoise(worldUV*.006+warp*.014)*.72+mott*.28;
                float belt=max(smoothstep(.38,.66,forest)*.76,forestFloor)*(1.-smoothstep(.10,.33,terrainSlope));
                vec3 forestColor=mix(vec3(.048,.131,.088),vec3(.109,.245,.134),mott);
                diffuseColor.rgb=mix(diffuseColor.rgb,forestColor,treeline*belt*woodlandDistance*.91*(1.-deposits*.88)*(1.-corridor.a*.65));
            }
            // The geographic horizon AO is sampled on the same 8 m grid and was
            // tinting whole cells; keep the rock colour continuous instead.
            float peakland=smoothstep(1460.,2320.,worldUV.x)*(1.-smoothstep(-690.,1090.,worldUV.y));
            float terrainRockRelief=0.,peakRock=0.,peakGrass=0.;
            vec3 faceNormal=cross(dFdx(vWPos),dFdy(vWPos));
            float faceSlope=1.-abs(faceNormal.y)/max(length(faceNormal),.00001);
            if(peakland>.001){
                float peakSlope=max(terrainSlope,faceSlope*.87);
                float slopeFace=smoothstep(.11,.44,peakSlope);
                vec2 pWarp=worldUV+warp*1.8;
                float broad=tNoise(pWarp*.011+vec2(vWPos.y*.004,3.1));
                float fault=tNoise(pWarp*.036+vec2(-vWPos.y*.010,7.4));
                float strata=tNoise(vec2(vWPos.y*.042+(broad-.5)*2.4,pWarp.x*.010+pWarp.y*.009));
                float crag=tNoise(pWarp*.085+vec2(vWPos.y*.035,-vWPos.y*.022));
                vec4 rockMid=rockTriplanar(vWPos,terrainNormal,.065);
                vec4 rockFine=fineFade>.02?rockTriplanar(vWPos,terrainNormal,.42):vec4(.5,.22,.5,0.);
                float rockTexture=smoothstep(.26,.78,rockMid.b*.58+broad*.42);
                vec3 cream=vec3(.74,.65,.51), ochre=vec3(.56,.46,.35), grey=vec3(.41,.46,.50);
                vec3 wall=mix(ochre,cream,smoothstep(.20,.80,strata*.55+broad*.45));
                wall=mix(wall,grey,.32*smoothstep(.45,.86,fault));
                wall*=mix(.86,1.12,smoothstep(.24,.76,rockMid.r*.55+crag*.45));
                wall*=mix(.84,1.14,rockTexture)*mix(.90,1.10,rockFine.r)*(1.-.22*rockMid.g);
                float damp=tNoise(vec2(pWarp.x*.028+pWarp.y*.019,vWPos.y*.006)+vec2(3.1,8.4));
                wall=mix(wall,vec3(.30,.30,.26),.18*smoothstep(.54,.82,damp));
                float moss=tNoise(worldUV*.022+vec2(vWPos.y*.009,-vWPos.y*.007));
                float mossBreak=tNoise(vec2(worldUV.x*.055+vWPos.y*.022,worldUV.y*.047+vWPos.y*.061)+vec2(2.7,5.1));
                float ledgeUp=smoothstep(.34,.82,terrainNormal.y);
                float growth=(.52*moss+.28*broad+.20*fault)*(.54+.82*mossBreak);
                vec3 canopy=mix(vec3(.055,.155,.068),vec3(.205,.355,.115),smoothstep(.16,.86,moss));
                wall=mix(wall,canopy,.44*smoothstep(.50,.72,growth)*(.12+.88*ledgeUp));
                peakGrass=smoothstep(510.,580.,vWPos.y)*(1.-smoothstep(.12,.43,peakSlope+(mossBreak-.5)*.09));
                vec3 sod=mix(canopy,sward,peakGrass*.86);
                vec3 peakColour=mix(sod,wall,slopeFace*(1.-peakGrass));
                peakColour=mix(peakColour,biome.rgb*.74,(1.-slopeFace)*forestFloor*.43*(1.-peakGrass));
                // The 8 m planned height grid used to tint whole cliff cells green;
                // grass now lives on ledges and summits only.
                diffuseColor.rgb=mix(diffuseColor.rgb,peakColour,peakland);
                peakRock=peakland*slopeFace*(1.-peakGrass);
                terrainRockRelief=peakRock*((rockMid.r-.5)*1.15+(rockMid.g-.5)*.95
                    +(crag-.5)*.55+(rockFine.b-.5)*.38*fineFade);
            }

            // Blend from individually lit blades into a filtered grass canopy.
            // The projected footprint also handles oblique views and fast dives.
            float canopyHandoff=max(smoothstep(21.,100.,surfaceDistance),smoothstep(.045,.24,footprint));
            float grassCoverage=max(meadow,corridorLand*corridor.a*.84)*drySurface*grassRoadMask;
            vec4 crop=valleyFields(worldUV);
            float farmCoverage=crop.x*grassRoadMask*drySurface;
            float ruinCoverage=valleyRuinGround(worldUV);
            vec2 bossW=bossGroundWeights(worldUV,macro);
            grassCoverage*=(1.-max(exposedGravel*.94,wet*.80))*(1.-deposits)*(1.-peakland)
                *(1.-max(farmCoverage,ruinCoverage*.95))*(1.-bossW.x*.94)*(1.-bossW.y*.55);
            grassCoverage=max(grassCoverage,peakGrass*peakland);
            vec2 crownSlope=vec2(0.);
            vec2 crownUV=worldUV+warp*.43;
            vec2 crownDx=dFdx(crownUV), crownDz=dFdy(crownUV);
            if(grassCoverage>.006) {
                mat2 rotation=mat2(.81,-.59,.59,.81);
                vec4 clumps=grassCanopyAt(crownUV,crownDx,crownDz,57.);
                vec4 tufts=grassCanopyAt(rotation*crownUV+vec2(29.,-37.),rotation*crownDx,rotation*crownDz,14.);
                vec4 fineTufts=grassCanopyAt(crownUV+vec2(-17.,43.),crownDx*.55,crownDz*.55,6.5);
                vec4 masses=grassCanopyAt(rotation*crownUV+vec2(85.,18.),rotation*crownDx,rotation*crownDz,151.);
                // Keep mid-range grass tufts crisp across grazing views (e.g. opposite riverbanks).
                float midCrisp=1.-smoothstep(55.,240.,surfaceDistance);
                float tuftVisibility=max(1.-smoothstep(.28,1.45,footprint),midCrisp*.82);
                float fineTuftVis=(1.-smoothstep(32.,155.,surfaceDistance))*(1.-smoothstep(.65,2.6,footprint));
                float clumpVisibility=max(1.-smoothstep(2.4,10.5,footprint),(1.-smoothstep(180.,520.,surfaceDistance))*.72);
                float crownLight=(clumps.r-.46)*.58*clumpVisibility+(tufts.r-.46)*.46*tuftVisibility
                    +(fineTufts.r-.46)*.40*fineTuftVis+(masses.r-.46)*.36;
                crownSlope=(clumps.gb*2.-1.)*.74*clumpVisibility
                          +transpose(rotation)*(tufts.gb*2.-1.)*.64*tuftVisibility
                          +(fineTufts.gb*2.-1.)*.48*fineTuftVis;
                float softSlope=dot(crownSlope,vec2(-.45,-.90));
                float groundTuft=clumps.a*.65+tufts.a*.35-.4;
                vec3 rimTint=mix(vec3(.055,.105,.025),vec3(.165,.195,.038),
                                 max(openPasture,valley*.75)*(1.-forestBand*.72)*(1.-wetBand*.45));
                rimTint=mix(rimTint,vec3(.078,.082,.038),gfValley*.82);
                vec3 crownColor=diffuseColor.rgb*(1.04+crownLight+softSlope*.24);
                crownColor+=rimTint*(.34+groundTuft*.95);
                crownColor=mix(crownColor,crownColor*vec3(.76,.92,.88),forestBand*.20);
                float grainBlend=grassCoverage*mix(.34,.96,canopyHandoff);
                diffuseColor.rgb=mix(diffuseColor.rgb,crownColor,grainBlend);
                crownSlope*=grainBlend*.42;
            }
            float rowPhase=crop.z+(mott-.5)*.28;
            float rowSoftness=1.-smoothstep(.25,.82,fwidth(crop.z));
            float rows=smoothstep(.07,.40,abs(fract(rowPhase+.5)-.5));
            float edge=crop.w+(mott-.5)*1.05;
            float bed=smoothstep(.55,1.64,edge);
            float raisedLip=smoothstep(-1.1,-.24,edge)*(1.-smoothstep(.20,1.10,edge));
            vec3 berm=mix(vec3(.275,.238,.102),vec3(.34,.392,.106),mott);
            berm*=.89+.23*raisedLip;
            vec3 furrow=mix(vec3(.255,.265,.069),vec3(.494,.410,.076),crop.y);
            vec3 ears=mix(vec3(.365,.485,.076),vec3(.82,.683,.086),smoothstep(.37,.98,crop.y));
            float tufts=tNoise(worldUV*vec2(.97,1.87));
            float canopy=.74+.19*mott+.13*tufts;
            float planted=mix(.72,1.-rows*.69,rowSoftness);
            vec3 harvest=mix(berm,mix(furrow,ears*canopy,planted),bed);
            diffuseColor.rgb=mix(diffuseColor.rgb,harvest,farmCoverage);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.285,.302,.208)*(.84+.16*gravel),ruinCoverage*.68);
            // Desolate weathered ash-slate & scorched ochre wasteland around Dragon Lair (boss2) + ancient stone-earth around Sword Altar (boss1)
            if(bossW.x>.002){
                float wCrack=tNoise(worldUV*.085+warp*.18);
                vec3 ashSlate=mix(vec3(.23,.24,.23),vec3(.39,.34,.25),smoothstep(.22,.82,macro*.65+wCrack*.35));
                ashSlate*=.82+.28*gravel;
                diffuseColor.rgb=mix(diffuseColor.rgb,ashSlate,bossW.x*.90);
            }
            if(bossW.y>.002){
                vec3 ruinSoil=mix(vec3(.30,.33,.20),vec3(.42,.39,.29),smoothstep(.25,.78,macro));
                diffuseColor.rgb=mix(diffuseColor.rgb,ruinSoil,bossW.y*.48);
            }
            float overlook=smoothstep(85.,242.,cameraPosition.y-vWPos.y);
            float sunPatch=smoothstep(.29,.72,tNoise(worldUV*.0034+vec2(3.1,-7.2))*.78+mott*.22);
            vec3 fieldLight=mix(vec3(.84,.91,.92),vec3(1.22,1.30,1.12),sunPatch);
            float overviewCoverage=max(grassCoverage*(1.-forestBand*.64),farmCoverage*.79);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*fieldLight,
                overviewCoverage*overlook*corridor.a*.83);
            float canopyCover=canopyShade(worldUV);
            float canopyShadow=canopyCover*smoothstep(65.,220.,surfaceDistance);
            diffuseColor.rgb*=mix(vec3(1.),vec3(.50,.62,.68),canopyShadow*drySurface);
            // Multi-layer natural ground transition for Changfeng Valley (dry soil, damp earth, gravel, fallen leaves, dry grass).
            if(gfValley>.001){
                float ecoDry=smoothstep(.46,.82,tNoise(worldUV*.021+vec2(-19.4,8.6))*.68+tNoise(worldUV*.072+vec2(6.1,-13.4))*.32);
                float litterMask=clamp(canopyCover*1.15+forestBand*.55+clearing.g*.45,0.,1.)*drySurface*grassRoadMask;
                float screeMask=smoothstep(.12,.30,terrainSlope)*(.45+.55*gravel);
                vec3 dryEarth=mix(vec3(.29,.23,.16),vec3(.41,.34,.24),gravel*.65+macro*.35);
                vec3 dampEarth=mix(vec3(.13,.11,.08),vec3(.21,.18,.13),mott);
                vec3 gravelScree=mix(vec3(.30,.30,.27),vec3(.46,.44,.39),gravel);
                vec3 leafLitter=mix(vec3(.21,.17,.11),vec3(.33,.27,.16),fine*.55+mott*.45);
                vec3 drySward=mix(vec3(.34,.31,.18),vec3(.44,.39,.22),mott);
                // Blend dry straw/earth patches across rolling slopes
                diffuseColor.rgb=mix(diffuseColor.rgb,mix(drySward,dryEarth,smoothstep(.58,.86,ecoDry)*.65),meadow*ecoDry*.52*gfValley);
                // Fallen leaves & humus under tree canopies
                diffuseColor.rgb=mix(diffuseColor.rgb,leafLitter,litterMask*.54*gfValley);
                // Damp dark soil along wet river margins
                diffuseColor.rgb=mix(diffuseColor.rgb,dampEarth,wet*.46*gfValley);
                // Gravel & exposed rock scree on steeper inclines
                diffuseColor.rgb=mix(diffuseColor.rgb,gravelScree,screeMask*.42*gfValley);
                // Regional ground identity: fallen bamboo leaves in 听竹泽 & golden-russet maple litter in 丹枫峡
                float bambooDist=length((worldUV-vec2(-640.,620.))/vec2(345.,315.));
                float bambooGround=(1.-smoothstep(.45,1.02,bambooDist))*drySurface*grassRoadMask;
                if(bambooGround>.005){
                    float bLeaf=tNoise(worldUV*.38+warp*.12)*.55+tNoise(worldUV*1.15)*.45;
                    vec3 bambooFloor=mix(vec3(.13,.19,.11),vec3(.30,.28,.16),smoothstep(.35,.78,bLeaf));
                    diffuseColor.rgb=mix(diffuseColor.rgb,bambooFloor,bambooGround*.52*gfValley);
                }
                float autumnDist=length((worldUV-vec2(-740.,-470.))/vec2(380.,340.));
                float autumnGround=(1.-smoothstep(.35,1.02,autumnDist))*drySurface*grassRoadMask*(1.-smoothstep(.18,.38,terrainSlope));
                if(autumnGround>.005){
                    float mLeaf=tNoise(worldUV*.24+warp*.16)*.60+tNoise(worldUV*.85)*.40;
                    vec3 mapleFloor=mix(vec3(.36,.20,.10),vec3(.56,.36,.14),smoothstep(.30,.78,mLeaf));
                    diffuseColor.rgb=mix(diffuseColor.rgb,mapleFloor,autumnGround*smoothstep(.28,.72,mLeaf)*.46*gfValley);
                }
                // Global 3D triplanar stratified cliff rock for all steep mountain walls
                // Strictly uses smooth baked terrainNormal/terrainSlope (NEVER per-triangle faceSlope)
                // so 8 m CDLOD grid facets can never create checkerboard/stair-step blocks.
                float cliffBreak=tNoise(worldUV*.024+warp*.18)*.62+tNoise(worldUV*.075+vec2(vWPos.y*.018,4.1))*.38;
                float gfCliffMask=smoothstep(.16,.38,terrainSlope+(cliffBreak-.50)*.14)*(1.-peakland*.88)*(1.-cliffExposure*.88);
                if(gfCliffMask>.002){
                    vec3 cliffN=normalize(terrainNormal);
                    vec4 cRock=rockTriplanar(vWPos,cliffN,.038);
                    float cWarp=(cRock.r-.5)*14.+(macro-.5)*18.;
                    float cStrata=tNoise(vec2((vWPos.y+cWarp)*.048,(worldUV.x*.009-worldUV.y*.007)+cRock.b*.6));
                    float cFissure=smoothstep(.48,.82,cRock.g*.62+cRock.b*.38);
                    // Stylized Eastern mountain limestone & slate: cool blue-grey, weathered grey, warm ochre accents
                    vec3 deepSlate=vec3(.19,.23,.27);
                    vec3 midStone=vec3(.36,.38,.39);
                    vec3 warmStrata=vec3(.48,.44,.38);
                    vec3 cliffCol=mix(deepSlate,midStone,smoothstep(.18,.74,cStrata*.55+cRock.r*.45));
                    cliffCol=mix(cliffCol,warmStrata,.36*smoothstep(.46,.84,cRock.b*.55+cStrata*.45));
                    cliffCol*=.78+.38*cRock.r-.22*cFissure;
                    // Organic moss & soil clinging to gentler rock ledges
                    float cLedge=smoothstep(.64,.88,cliffN.y)*smoothstep(.32,.70,macro);
                    cliffCol=mix(cliffCol,vec3(.17,.24,.15),cLedge*.48);
                    diffuseColor.rgb=mix(diffuseColor.rgb,cliffCol,gfCliffMask*.94*gfValley);
                    terrainRockRelief+=gfCliffMask*gfValley*((cRock.r-.5)*.82+(cRock.g-.5)*.54);
                }
                // Trampled packed soil & stone grit apron around village foundations & lanes
                vec3 villageGrit=mix(dryEarth,gravelScree,.42*gravel);
                diffuseColor.rgb=mix(diffuseColor.rgb,villageGrit,smoothstep(.05,.62,yard)*.72*gfValley);
            }
            // Vibrant speckled wildflower drifts along valley slopes & riverbanks.
            float wildFlower=meadow*valley*grassRoadMask*(1.-farmCoverage)*(1.-ruinCoverage);
            if(wildFlower>.001){
                float shoreBoost=1.+.95*(1.-smoothstep(2.,18.,max(0.,shoreHeight)));
                float finePatch=tNoise(worldUV*.16+vec2(7.,3.));
                float dots=smoothstep(.40,.80,tNoise(worldUV*.58+vec2(21.,13.)));
                float flowerPatch=smoothstep(.45,.74,tNoise(worldUV*.024+vec2(31.,7.)))
                    *smoothstep(.28,.70,finePatch)*(.34+.66*dots);
                float species=tNoise(worldUV*.014+3.7);
                vec3 wash=species<.28?vec3(.46,.74,.99):species<.62?vec3(.98,.86,.20):species<.82?vec3(.98,.96,.90):vec3(.95,.54,.68);
                wash=mix(wash,vec3(.92,.91,.85),gfValley*.90);
                diffuseColor.rgb=mix(diffuseColor.rgb,wash,min(.52,wildFlower*flowerPatch*mix(.30,.12,gfValley)*shoreBoost));
                float goldDrift=smoothstep(.52,.78,tNoise(worldUV*.018+vec2(5.,9.)))
                    *smoothstep(.30,.70,finePatch)*(.32+.68*dots);
                diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(.98,.84,.18),vec3(.88,.84,.66),gfValley),min(.44,wildFlower*goldDrift*mix(.24,.08,gfValley)*shoreBoost));
            }
            float snowMeadow=(1.-smoothstep(-350.,-165.,worldUV.y))*smoothstep(-1080.,-740.,worldUV.y);
            float bloomBank=snowMeadow*grassCoverage*(1.-forestBand*.79)*(1.-wetBand*.66);
            if(bloomBank>.012){
                float drift=smoothstep(.50,.77,tNoise((worldUV+warp*.84)*vec2(.020,.038)));
                float heads=smoothstep(.50,.78,tNoise(worldUV*.64+warp*.08));
                heads=mix(.34,heads,1.-smoothstep(.94,3.4,footprint));
                vec3 flowers=mix(vec3(.78,.72,.27),vec3(.70,.51,.78),smoothstep(.35,.68,mott));
                flowers=mix(flowers,vec3(.86,.84,.76),gfValley*.82);
                diffuseColor.rgb=mix(diffuseColor.rgb,flowers,bloomBank*drift*heads*mix(.69,.18,gfValley));
            }
            `
        );
        shader.fragmentShader=shader.fragmentShader
            .replace('#include <fog_fragment>','')
            .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                float terrainDirect = dot(reflectedLight.directDiffuse, vec3(.30, .59, .11));
                float terrainSunLit = smoothstep(.03, .28, terrainDirect);
                vec3 terrainShadeTone = mix(vec3(.80, .92, 1.0), vec3(.54, 1.03, 1.04), uAtmoLight);
                vec3 terrainSunTone = mix(vec3(1.), vec3(1.06, 1.18, .60), uAtmoLight * grassCoverage);
                vec3 gfTerrainShade = mix(vec3(.76, .84, .92), vec3(.48, .64, .72), uAtmoLight);
                vec3 gfTerrainSun = mix(vec3(1.), vec3(1.10, 1.02, .80), uAtmoLight * grassCoverage);
                terrainShadeTone = mix(terrainShadeTone, gfTerrainShade, gfValley);
                terrainSunTone = mix(terrainSunTone, gfTerrainSun, gfValley);
                vec3 terrainIndirectLit = mix(vec3(1.05, 1.12, .74), vec3(.96, .95, .82), gfValley);
                reflectedLight.indirectDiffuse *= mix(terrainShadeTone, terrainIndirectLit, terrainSunLit);
                reflectedLight.directDiffuse *= mix(vec3(1.), terrainSunTone, terrainSunLit * .84);`)
            .replace('#include <tonemapping_fragment>',`gl_FragColor.rgb=mix(gl_FragColor.rgb,
                applyAerialPerspective(gl_FragColor.rgb,vWPos),smoothstep(130.,470.,fieldDistance));
                #include <tonemapping_fragment>`)
            .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          vec3 geoNormal=normalize(cross(dFdx(vWPos),dFdy(vWPos)));
          if(geoNormal.y<0.)geoNormal=-geoNormal;
          // Faceted triangle normals read as a voxel/grid wall on cliffs, so those
          // faces lean on the smooth baked normal even up close.
          float smoothNormal=max(max(smoothstep(75.,420.,surfaceDistance)*.84,cliffExposure*.82),max(peakRock*.80,uGuofengStyle*mix(.92,1.,smoothstep(.06,.22,terrainSlope))));
          normal=normalize(mat3(viewMatrix)*mix(geoNormal,terrainNormal,smoothNormal));
          // A screen-space derivative bump on the 8 m height grid amplified its
          // facets into a visible checkerboard, so only fine grain is restored.
          float detail=tNoise(vWPos.xz*.9+vec2(11.7,3.1))*.030;
          float pixelSize=max(length(dFdx(vWPos.xz)),length(dFdy(vWPos.xz)));
          detail=detail*(1.-smoothstep(.4,2.0,pixelSize))+cliffRelief+terrainRockRelief;
          vec3 dpdx=dFdx(-vViewPosition),dpdy=dFdy(-vViewPosition);
          vec3 r1=cross(dpdy,normal),r2=cross(normal,dpdx);
          float determinant=dot(dpdx,r1);
          vec3 gradient=sign(determinant)*(dFdx(detail)*r1+dFdy(detail)*r2);
          normal=normalize(max(abs(determinant),.000001)*normal-gradient);
          normal=normalize(normal+mat3(viewMatrix)*vec3(crownSlope.x,0.,crownSlope.y));
        `);
    };
    const original=material.onBeforeCompile;material.onBeforeCompile=(shader,renderer)=>{original(shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
gl_FragColor.rgb+=vec3(.075,.062,.042)*peakland*exposedRock;
if(uGeoDebug>0.5&&uGeoDebug<1.5)gl_FragColor.rgb=mix(vec3(.1,.25,.38),vec3(.96,.85,.5),clamp(vWPos.y/750.,0.,1.));
if(uGeoDebug>1.5&&uGeoDebug<2.5)gl_FragColor.rgb=mix(vec3(.15,.7,.4),vec3(.9,.2,.1),smoothstep(.0,.5,vSlope));
if(uGeoDebug>2.5)gl_FragColor.rgb*=smoothstep(0.,.12,abs(fract(vWPos.y/20.)-.5))*.7+.3;`);};
    material.userData.uniforms = uniforms;
    return material;
}






