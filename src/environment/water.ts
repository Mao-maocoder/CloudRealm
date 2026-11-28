import{waterSurfaceAt}from '../world/geo/geo-core';
import{WaterSpray}from '../effects/water-spray';
import{SurfaceWake,surfaceWakeGLSL}from '../effects/surface-wake';
import{makeWaveNormalTexture}from '../rendering/wave-texture';
import * as T from 'three';
import { heightAt, waterHeight } from '../world/geo/height';
import type { Player } from '../player/controller';
import {reliefGLSL,waterLevelAt} from '../world/geo/relief';

import {makeGeographyTexture,heightTextureGLSL} from '../rendering/geography-texture';
import {riverGeometry} from '../world/biomes/river-geometry';
import {valleyArtGLSL} from '../world/geo/valley-art';
import {bridgePool} from '../world/geo/bridge-look';
import {BridgeReflection} from './bridge-reflection';
import {aerialPerspectiveGLSL, atmosphereUniforms} from '../rendering/aerial-perspective';
import {spellLightUniforms} from '../effects/spell-lights';
import {CascadeDetails} from './cascade-details';
import type { SpawnShoreGrass } from '../rendering/spawn-shore-grass';
const WAKE_POINTS = 16;

/**
 * Stylised river / lake surface. The shader re-derives a compact version of the
 * terrain height field, so depth tint, shoreline foam and lapping waves follow
 * the real channel instead of a flat colour. Wake rings are fed by a short CPU
 * trail and cost one extra branch per active point.
 */
export class Water {
    readonly mesh: T.Mesh;readonly spray:WaterSpray;
    readonly falls:T.Mesh;
    private readonly cascadeDetails:CascadeDetails;
    private geographyTexture=makeGeographyTexture();
    private ripple=makeWaveNormalTexture();
    readonly sunDirection: T.Vector3;
    private uniforms: {
        uTime: { value: number };
        uSun: { value: T.Vector3 };
        uWake: { value: T.Vector4[] };
        [key: string]: { value: unknown };
    };
    private trail: { x: number; z: number; born: number; strength: number }[] = [];
    private lastEmit = -1;
    readonly bridgeReflection: BridgeReflection;

    constructor(scene: T.Scene, sunDirection: T.Vector3, spawnShoreGrass?: SpawnShoreGrass) {
        this.cascadeDetails=new CascadeDetails(scene,spawnShoreGrass);
        this.sunDirection = sunDirection;this.spray=new WaterSpray(scene);
        this.bridgeReflection = new BridgeReflection(scene);
        const wake = Array.from({ length: WAKE_POINTS }, () => new T.Vector4());
        const uniforms = T.UniformsUtils.merge([
            T.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uSun: { value: sunDirection },
                uWake: { value: wake },uPlayerWater:{value:new T.Vector4()},uWaterDirection:{value:new T.Vector2(0,1)},
            },
        ]) as Water['uniforms'];
        uniforms.uGeography={value:this.geographyTexture};uniforms.uRipple={value:this.ripple};uniforms.uSurfaceTex={value:null};uniforms.uSurfaceWindow={value:new T.Vector4()};this.uniforms = uniforms;
        Object.assign(uniforms,this.bridgeReflection.uniforms,atmosphereUniforms,spellLightUniforms);
        const material = new T.ShaderMaterial({
            transparent: true,
            fog: true,
            depthWrite: true,
            uniforms,
            vertexShader: `attribute vec2 stream;varying vec2 vStream;attribute vec2 flow;varying vec2 vFlow;attribute float aRiverFade;varying float vRiverFade;varying vec3 vWPos; varying vec3 vSurfaceNormal;
                
                #include <fog_pars_vertex>
                void main(){
                    vec4 world = modelMatrix * vec4(position, 1.0);
                    vSurfaceNormal=normalize(mat3(modelMatrix)*normal);
                    vWPos = world.xyz;vFlow=flow;vStream=stream;vRiverFade=aRiverFade;
                    vec4 mvPosition = viewMatrix * world;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }`,
            fragmentShader: `varying vec2 vStream;varying vec2 vFlow;varying float vRiverFade;uniform vec4 uPlayerWater;uniform vec2 uWaterDirection;varying vec3 vWPos; varying vec3 vSurfaceNormal;
                uniform float uTime;
                uniform vec3 uSun;
                uniform vec4 uWake[${WAKE_POINTS}];
                uniform sampler2D uRipple;
                uniform sampler2D uBridgeReflection;
                uniform mat4 uBridgeMirrorMatrix;
                uniform float uBridgeMirrorOn;
                uniform vec4 uSpellLightPos[2];
                uniform vec4 uSpellLightCol[2];
                uniform vec4 uOmenShock;
                ${surfaceWakeGLSL.replaceAll('uWakeTex','uSurfaceTex').replaceAll('uWake','uSurfaceWindow')}
                #include <fog_pars_fragment>
                
                float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
                float wNoise(vec2 p){
                    vec2 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
                               mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
                }
                float wFbm(vec2 p){
                    float sum = 0.0, amp = 0.5;
                    for (int i = 0; i < 3; i++) { sum += wNoise(p) * amp; p = p * 2.03 + 7.1; amp *= 0.5; }
                    return sum;
                }
                ${heightTextureGLSL}
                ${valleyArtGLSL}
                ${aerialPerspectiveGLSL}
                void main(){
                    vec3 eye = normalize(cameraPosition - vWPos);
                    float rawDepth=vWPos.y-plannedHeight(vWPos.xz);
                    // Perturb the shallow margin with multi-frequency noise so shorelines
                    // meander organically around coves and pebble spits instead of straight edges.
                    float shoreWarp=(wFbm(vWPos.xz*.095+vec2(4.3,9.1))-.5)*.92+(wNoise(vWPos.xz*.34+vec2(17.2,3.8))-.5)*.34;
                    float edgeDepth=rawDepth+shoreWarp*(1.-smoothstep(.45,2.5,max(0.,rawDepth)));
                    if(edgeDepth < -.10 || vRiverFade < .01)discard;
                    float depth = clamp(edgeDepth, 0.0, 8.0);
                    float valley=valleyArtAt(vWPos.xz);

                    // Gentle multi-frequency ripple normal.
                    float t = uTime;
                    float slope=1.0-clamp(vSurfaceNormal.y,0.0,1.0);
                    float flowSpeed=mix(.55,2.4,clamp(length(vFlow),0.0,1.0)) + slope*5.0;
                    vec2 q = vWPos.xz;vec2 advected=vec2(vStream.y,vStream.x-uTime*flowSpeed);
                    vec2 flowWarp=vec2(wNoise(advected*.058+vec2(t*.035,7.)),wNoise(advected*.047+vec2(17.,-t*.028)))*3.2;
                    // Remove details smaller than a pixel before they flicker at altitude.
                    float footprint = max(length(dFdx(q)), length(dFdy(q)));
                    float wave1 = 1.0 - smoothstep(0.4, 1.4, footprint * 0.37);
                    float wave2 = 1.0 - smoothstep(0.4, 1.4, footprint * 0.55);
                    float wave3 = 1.0 - smoothstep(0.4, 1.4, footprint * 0.93);
                    float dx = 0.0, dz = 0.0;
                    float p1 = advected.x * 0.36 + advected.y * 0.10+flowWarp.x;
                    dx += cos(p1) * 0.36 * 0.19 * wave1; dz += cos(p1) * 0.10 * 0.085 * wave1;
                    float p2 = advected.x * -0.12 + advected.y * 0.53+flowWarp.y;
                    dx += cos(p2) * -0.12 * 0.12 * wave2; dz += cos(p2) * 0.53 * 0.070 * wave2;
                    float p3 = advected.x * 0.83 + advected.y * -0.41+flowWarp.x*.7;
                    dx += cos(p3) * 0.83 * 0.055 * wave3; dz += cos(p3) * -0.41 * 0.030 * wave3;
                    vec2 warped=advected+flowWarp*valley*vec2(.93,2.3);
                    vec4 rippleA=texture2D(uRipple,warped/mix(vec2(13.,19.),vec2(9.7,24.1),valley));
                    vec4 rippleB=texture2D(uRipple,warped.yx/vec2(4.7,6.1)+valley*vec2(.071,-.033)*t);
                    vec4 surfaceWake=surfaceWakeAt(q);
                    // Phase-4 Celestial Omen shockwave expands a visible concentric ripple band across the river & lake
                    if(uOmenShock.w>.002){
                        vec2 sDelta=q-uOmenShock.xy;
                        float sDist=length(sDelta);
                        float sBand=exp(-pow((sDist-uOmenShock.z)/32.,2.))*uOmenShock.w;
                        vec2 sDir=sDist>.01?sDelta/sDist:vec2(1.,0.);
                        float sWave=sin((sDist-uOmenShock.z)*.45-t*6.)*sBand*.36;
                        dx+=sDir.x*sWave; dz+=sDir.y*sWave;
                    }
                    vec2 rippleSlope=(rippleA.xy-.5)*.48*wave1+(rippleB.yx-.5)*.24*wave3;
                    vec2 rippleXZ=vec2(-dx,dz)*mix(1.,.40,valley)+rippleSlope*mix(1.,.48,valley);
                    vec2 downstream=length(vFlow)>.05?normalize(vFlow):vec2(0.,1.);
                    vec2 worldSlope=vec2(-downstream.y,downstream.x)*rippleXZ.x + downstream*rippleXZ.y;
                    vec3 n = normalize(vSurfaceNormal+vec3(worldSlope.x, 0.0, worldSlope.y));

                    float bedDetail=mix(.5,wNoise(q*1.65+worldSlope*.8),1.-smoothstep(.2,1.,footprint));
                    vec3 riverBed=mix(vec3(.12,.13,.09),vec3(.38,.35,.24),bedDetail);
                    float pebbles=smoothstep(.49,.72,bedDetail);
                    vec3 shoal=mix(vec3(.155,.165,.107),vec3(.545,.474,.306),.22+.62*pebbles);
                    float caustic=pow(max(0.,1.-abs(wNoise(q*.72+worldSlope*7.+vec2(.11,-.08)*t)-.55)*8.),3.);
                    caustic*=1.-smoothstep(.55,1.9,depth);
                    float bay=1.-smoothstep(.73,1.31,length((q-vec2(340.,962.))/vec2(510.,550.)));
                    float alpine=smoothstep(85.,190.,vWPos.y);
                    float marsh=1.-smoothstep(.56,1.17,length((q-vec2(-640.,620.))/vec2(505.,450.)));
                    riverBed=mix(riverBed,shoal+caustic*vec3(.047,.057,.027),max(valley,.76));
                    vec3 transmission=exp(-depth*vec3(.95,.42,.36));
                    vec3 col=riverBed*transmission + vec3(.025,.18,.21)*(1.-transmission);
                    float gfWater = uGuofengStyle;
                    vec3 valleyTransmission=mix(exp(-depth*vec3(.76,.37,.28)),exp(-depth*vec3(.38,.22,.22)),gfWater);
                    vec3 deep=mix(vec3(.010,.285,.345),vec3(.018,.335,.435),bay);
                    deep=mix(deep,vec3(.046,.185,.255),alpine);
                    deep=mix(deep,vec3(.032,.127,.104),marsh*.58);
                    vec3 gfDeep=mix(vec3(.038,.128,.138),vec3(.034,.118,.148),bay*.75);
                    gfDeep=mix(gfDeep,vec3(.036,.098,.132),alpine*.65);
                    gfDeep=mix(gfDeep,vec3(.034,.105,.092),marsh*.60);
                    deep=mix(deep,gfDeep,gfWater*.92);
                    vec3 clearBed=mix(riverBed,shoal*1.12+caustic*vec3(.095,.092,.068),gfWater*.75);
                    vec3 jade=clearBed*valleyTransmission+deep*(1.-valleyTransmission);
                    col=mix(col,jade,max(valley,.76));
                    float shallowsTint=bay*smoothstep(.04,.52,depth)*(1.-smoothstep(1.7,3.3,depth));
                    float sandGrain=wNoise(q*.072+flowWarp*.66);
                    vec3 paleBank=mix(vec3(.122,.355,.263),vec3(.235,.462,.358),sandGrain);
                    col=mix(col,paleBank,shallowsTint*.52);
                    float currentShade=wNoise(advected*vec2(.28,.12)+flowWarp);
                    col*=.85+.28*currentShade;
                    // Tint water body by unified time-of-day waterBodyTint BEFORE sky reflection & specular
                    // so night rivers stay deep sapphire-indigo (never self-lit neon cyan!).
                    col*=uWaterBodyTint;

                    // Fresnel sky reflection and directional sun/moon glints.
                    float fres = .025+.975*pow(1.0-clamp(dot(n,eye),0.0,1.0),5.0);
                    vec3 refl = reflect(-eye, n);
                    vec3 skyRef = mix(uWaterSkyLow, uWaterSkyHigh, smoothstep(-.01, .24, refl.y));
                    skyRef = mix(skyRef, vec3(.12, .20, .16) * uWaterBodyTint, 1. - smoothstep(.18, 2.0, depth));
                    vec3 valleySky = mix(uWaterSkyLow * .90, uWaterSkyHigh * .92, smoothstep(-.02, .35, refl.y));
                    float softReflection = max(valley, bay * .92);
                    float reflWeight = fres * mix(.86, mix(.72, .68, gfWater), softReflection);
                    col = mix(col, mix(skyRef, valleySky, softReflection), reflWeight);
                    float bridgeWater=1.-smoothstep(.20,1.,length((q-vec2(${bridgePool.x},${bridgePool.z}.))/vec2(44.,73.)));
                    if(uBridgeMirrorOn>.5 && bridgeWater>.001) {
                        vec4 mirrored=uBridgeMirrorMatrix*vec4(vWPos,1.);
                        vec2 uv=mirrored.xy/max(.0001,mirrored.w)+worldSlope*vec2(.055,.085);
                        vec2 border=min(uv,1.-uv);
                        float valid=smoothstep(.004,.065,min(border.x,border.y))*step(.001,mirrored.w);
                        vec3 reflected=texture2D(uBridgeReflection,clamp(uv,0.,1.)).rgb;
                        float strength=bridgeWater*valid*(mix(.20,.10,gfWater)+mix(.77,.58,gfWater)*fres)*smoothstep(.12,1.12,depth);
                        col=mix(col,reflected*mix(vec3(.83,.99,.95),vec3(.90,.93,.91),gfWater),strength);
                    }
                    vec3 lightDir = normalize(uAtmoSunDir);
                    vec3 halfV = normalize(lightDir + eye);
                    float specPower = mix(110.0, 28.0, smoothstep(0.1, 2.0, footprint));
                    float spec = pow(max(dot(n, halfV), 0.0), specPower) * (specPower / 110.0);
                    float broadShimmer = pow(max(dot(n, halfV), 0.0), 38.0) * .22;
                    float sparkleVisibility = 1.0 - smoothstep(0.3, 1.0, footprint * 7.0);
                    float sparkle = mix(0.30, smoothstep(0.52, 0.92, wNoise(q * 9.5 + vec2(t * 2.6, -t * 1.9))), sparkleVisibility);
                    float glintFade = 0.14 + 0.86 * pow(1.0 - clamp(eye.y, 0.0, 1.0), 2.1);
                    vec3 waterGlint = uWaterSpec * (spec * (0.35 + sparkle * 0.95) + broadShimmer) * glintFade * uWaterSpecPower * mix(1., .72, softReflection);

                    // Lapping shoreline foam, broken by noise.
                    float foamVisibility = 1.0 - smoothstep(0.3, 1.4, footprint * 5.8);
                    float foamNoise = mix(0.5, wFbm(q * 1.4 + vec2(t * 0.35, -t * 0.22)), foamVisibility);
                    float shore = 1.-smoothstep(0.02, .9, depth);
                    float lapVisibility = 1.0 - smoothstep(0.5, 2.0, fwidth(depth) * 20.0);
                    float lap = wNoise(q*.48+flowWarp+vec2(-t*.16,t*.11))*lapVisibility;
                    float foam = smoothstep(.58,.87,shore*(.25+foamNoise*.72)*(.62+lap*.5));
                    float rapids=1.-smoothstep(.64,.985,vSurfaceNormal.y);
                    float verticalTravel=vStream.x-t*10.;
                    float streak=.77*wNoise(vec2(vStream.y*.40,verticalTravel*.051))
                        +.23*wNoise(vec2(vStream.y*.82,verticalTravel*.19));
                    float plunge=smoothstep(.28,.90,rapids);
                    foam=max(foam,rapids*smoothstep(.28,.71,streak)*(.46+.54*foamVisibility));
                    float shoalBreak=wNoise(advected*vec2(.212,.081)+flowWarp*.82);
                    float shallows=smoothstep(.18,.52,depth)*(1.-smoothstep(.66,1.84,depth));
                    float foamGrain=1.-smoothstep(1.2,6.4,footprint);
                    foam=max(foam,shallows*smoothstep(.66,.86,shoalBreak)*foamGrain*.39);
                    float foamThread=wNoise((advected+flowWarp)*vec2(.29,.078));
                    float brokenCurrent=smoothstep(.57,.82,shoalBreak)*smoothstep(.54,.73,foamThread);
                    foam=max(foam,(1.-bay*.92)*brokenCurrent*(.43+.35*shallows)*mix(1.,.22,gfWater));
                    // Flow-aligned ribbons split into thin fingers behind shallow shelves.
                    float snowReach=(1.-smoothstep(-390.,120.,q.y))*smoothstep(-1760.,-1540.,q.y);
                    float lace=wNoise(vec2(advected.x*.24+flowWarp.x*.42,advected.y*.105));
                    float braid=abs(sin(advected.x*.51+lace*5.4+advected.y*.033));
                    float slip=smoothstep(.51,.78,wNoise(advected*vec2(.094,.16)+flowWarp*.42));
                    float sourceFoam=(1.-smoothstep(.10,.46,braid))*slip;
                    foam=max(foam,sourceFoam*snowReach*(.24+.50*shallows));
                    float cloudReflection=wFbm((q+refl.xz*90.)*vec2(.014,.036)+worldSlope*1.4);
                    col=mix(col,vec3(.56,.77,.85),bay*fres*smoothstep(.60,.82,cloudReflection)*.65);

                    // Expanding wake rings from the player trail.
                    float wakeFoam = 0.0;
                    for (int i = 0; i < ${WAKE_POINTS}; i++) {
                        vec4 w = uWake[i];
                        if (w.w <= 0.001) continue;
                        float dist = distance(q, w.xy);
                        float radius = w.z * 1.7;
                        float ring = 0.5 + 0.5 * sin((dist - radius) * 8.5 - t * 5.0);
                        float band = exp(-pow((dist - radius) * 1.15, 2.0));
                        wakeFoam += ring * band * w.w * exp(-dist * 0.12) * exp(-w.z * 1.1);
                    }
                    vec2 relative=q-uPlayerWater.xy;float behind=-dot(relative,uWaterDirection),across=abs(dot(relative,vec2(-uWaterDirection.y,uWaterDirection.x)));float vWake=exp(-pow((across-behind*.25)/.48,2.)) * smoothstep(.5,2.5,behind)*(1.-smoothstep(12.,32.,behind))*uPlayerWater.w;
                    float foamAge=clamp(-log(max(surfaceWake.a,.0001))/3.3,0.,1.);
                    float foamCut=.24+.62*sqrt(foamAge);
                    float foamLace=rippleA.b*.6+rippleB.a*.4;
                    float fieldFoam=smoothstep(foamCut,foamCut+.16,foamLace)*(1.-smoothstep(.8,1.,foamAge))*step(.003,surfaceWake.a);
                    float wake = clamp(max(wakeFoam*.3+vWake*.4,fieldFoam), 0.0, 1.0);
                    vec3 foamTint = mix(uWaterSkyLow * 0.88, vec3(0.95, 0.98, 0.96), smoothstep(0.38, 0.95, uAtmoLight));
                    col = mix(col, foamTint, wake * 0.62);
                    col = mix(col, foamTint * .96, min(1., foam * (.52 + rapids * .58)));
                    col = mix(col, mix(uWaterSkyLow, vec3(.64, .85, .94), uAtmoLight), plunge * (.30 + .42 * smoothstep(.30, .76, streak)));
                    col += waterGlint;
                    // Dynamic spell light glow & ripple specular reflection on the water surface (dramatic at night).
                    for (int s = 0; s < 2; s++) {
                        float spStrength = uSpellLightCol[s].a;
                        if (spStrength <= 0.005) continue;
                        vec3 toSp = uSpellLightPos[s].xyz - vWPos;
                        float spDist = length(toSp);
                        float spRange = uSpellLightPos[s].w;
                        float spAtten = clamp(1.0 - spDist / spRange, 0.0, 1.0);
                        spAtten = spAtten * spAtten;
                        vec3 spDir = toSp / max(spDist, 0.001);
                        vec3 spHalf = normalize(spDir + eye);
                        float spSpec = pow(max(dot(n, spHalf), 0.0), 42.0) * 1.45;
                        float spDiff = max(dot(n, spDir), 0.0) * 0.28 + 0.14;
                        col += uSpellLightCol[s].rgb * spStrength * spAtten * (spDiff + spSpec * (0.45 + 0.55 * fres));
                    }

                    float alpha = mix(mix(.27, .12, gfWater), mix(.98, .88, gfWater), max(fres*mix(.8,mix(.64,.52,gfWater),valley),smoothstep(0.0, mix(3.,mix(3.6,5.2,gfWater),valley), depth)));
                    alpha = max(alpha, max(foam, wake) * mix(0.55, 0.38, gfWater));
                    float shoreAA=max(.10,fwidth(edgeDepth));
                    alpha*=smoothstep(-shoreAA,shoreAA*1.4,edgeDepth)*vRiverFade;
                    col=mix(col,applyAerialPerspective(col,vWPos),smoothstep(130.,480.,distance(cameraPosition.xz,q)));
                    gl_FragColor = vec4(col, alpha);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`
        });
        this.mesh = new T.Mesh(riverGeometry(), material);
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
        this.falls=new T.Mesh(riverGeometry(true),material);scene.add(this.falls);
        scene.add(this.mesh);
    }

    update(time: number, camera: T.Camera, player: Player) {
        this.cascadeDetails.update(time,camera);
        this.uniforms.uTime.value = time;
        // Authored water shelves stay on a fixed world grid, avoiding snapping artefacts.

        const speed = player.velocity.length();
        const surface=waterSurfaceAt(player.position.x,player.position.z),height=player.position.y-surface;
        const overWater=Number.isFinite(surface);const strength=overWater?T.MathUtils.clamp((5.5-height)/4,0,1)*T.MathUtils.clamp(speed/45,0,1):0;const direction=(this.uniforms.uWaterDirection.value as T.Vector2);if(Math.hypot(player.velocity.x,player.velocity.z)>.1)direction.set(player.velocity.x,player.velocity.z).normalize();(this.uniforms.uPlayerWater.value as T.Vector4).set(player.position.x,player.position.z,height,strength);this.spray.update(time,player.position,direction,overWater?surface:0,height<3.5?strength:0);
        if (speed > 3.5 && height > 0 && height < 5.5 && overWater && time - this.lastEmit > 0.075) {
            this.lastEmit = time;
            const strength = T.MathUtils.clamp((5.5 - height) / 4, 0, 1) * T.MathUtils.clamp(speed / 42, 0, 1);
            this.trail.push({ x: player.position.x, z: player.position.z, born: time, strength });
            if (this.trail.length > WAKE_POINTS)
                this.trail.shift();
        }
        if (this.trail.length && time - this.trail[0].born > 2.6)
            this.trail.shift();
        for (let i = 0; i < WAKE_POINTS; i++) {
            const point = this.trail[this.trail.length - 1 - i];
            const value = this.uniforms.uWake.value[i];
            if (point)
                value.set(point.x, point.z, time - point.born, point.strength);
            else
                value.set(0, 0, 0, 0);
        }
    }

    setWake(wake:SurfaceWake){this.uniforms.uSurfaceTex=wake.uniforms.uWakeTex;this.uniforms.uSurfaceWindow=wake.uniforms.uWake;}

    dispose() {
        this.cascadeDetails.dispose();
        this.bridgeReflection.dispose();
        this.spray.dispose();this.ripple.dispose();this.mesh.geometry.dispose();this.falls.geometry.dispose();this.geographyTexture.dispose();
        (this.mesh.material as T.Material).dispose();
    }
}

