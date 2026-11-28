// Adapted from Petalwake, Copyright (c) 2026 Jacob Miller, MIT.
// See public/PETALWAKE_LICENSE.txt, commit 25443cef0eba802052d9ef24c94ba3c4157b6f2e.
import {surfaceWakeGLSL} from '../effects/surface-wake';
import {meadowWindGLSL} from '../effects/meadow-trail';
import {villageGroundGLSL} from '../world/biomes/village-ground';
import {riverbankGLSL} from './riverbank-texture';
import {bridgeShadeGLSL} from '../world/geo/bridge-look';
import {regionalTextureGLSL} from './regional-texture';
import {valleyArtGLSL} from '../world/geo/valley-art';
import {clearingLightGLSL} from './clearing-light';
import {riverCorridorGLSL} from './river-corridor-texture';
import {valleyLandmarksGLSL} from '../world/geo/valley-landmarks';
import {shrinePathGLSL} from '../world/geo/spawn-site';
import {spawnShoreGrassGLSL} from './spawn-shore-grass';
import {fireballScorchSlots} from '../effects/fireball-impact';
const fieldGLSL=`uniform vec4 uWalkTrail[8];
vec2 walkBend(vec2 p,float ground){vec2 bend=vec2(0.);float strongest=0.;for(int i=0;i<8;i++){vec4 stamp=uWalkTrail[i];vec2 delta=p-stamp.xz;float d=length(delta);float strength=(1.-smoothstep(.2,1.35,d))*stamp.w*(1.-smoothstep(.5,1.8,abs(ground-stamp.y)));if(strength>strongest){strongest=strength;bend=delta/max(d,.12)*strength;}}float len=length(bend);return bend/max(1.,len)*1.1;}
uniform sampler2D uMeadow;uniform vec4 uShell,uBlade;uniform vec2 uOrigin;uniform float uGrid,uSpacing,uTime,uType;varying vec3 vBladeTint;varying float vBladeTip;
uniform vec3 uField;uniform vec2 uFieldSize;uniform bool uIslandField,uDetail;
uniform float uIslandTint;
uniform float uFocalPixels;
${surfaceWakeGLSL}
${meadowWindGLSL}
${villageGroundGLSL}
${riverbankGLSL}
${bridgeShadeGLSL}
${regionalTextureGLSL}
${valleyArtGLSL}
${clearingLightGLSL}
${riverCorridorGLSL}
${valleyLandmarksGLSL}
#if MEADOW_GUOFENG
${shrinePathGLSL}
#endif
#if MEADOW_SHORE_MASK
${spawnShoreGrassGLSL}
#endif
vec4 mHash(vec2 p){return fract(sin(vec4(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)),dot(p,vec2(419.2,371.9)),dot(p,vec2(173.8,217.1))))*43758.5453);}
float mNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mHash(i).x,mHash(i+vec2(1.,0.)).x,f.x),mix(mHash(i+vec2(0.,1.)).x,mHash(i+1.).x,f.x),f.y);}
uniform vec4 uFireballScorches[${fireballScorchSlots}];
uniform float uFireballScorchRadii[${fireballScorchSlots}];
uniform int uFireballScorchCount;
vec3 scorchBlade(vec3 color, vec3 root, float seed){
 float burn=0.;
 for(int i=0;i<${fireballScorchSlots};i++){
   if(i>=uFireballScorchCount)break;
   vec4 stamp=uFireballScorches[i];
   float rScale=max(1.,uFireballScorchRadii[i]);
   float radius=length(root.xz-stamp.xz)+.46*(seed-.5);
   float shape=(1.-smoothstep(1.56*rScale,2.85*rScale,radius))*(1.-smoothstep(.47*rScale,1.42*rScale,abs(root.y-stamp.y)));
   burn=max(burn,shape*stamp.w);
 }
 return mix(color, mix(vec3(.062,.037,.018),vec3(.153,.074,.026),seed),burn*.91);
}
vec4 meadowAt(vec2 p){
 vec2 q=(p-uField.xy)/uField.z;
 if(any(lessThan(q,vec2(0.)))||any(greaterThan(q,uFieldSize-1.)))return vec4(0.);
 vec2 i=min(floor(q),uFieldSize-2.),f=q-i,uv=(i+.5)/uFieldSize,d=1./uFieldSize;
 return mix(mix(texture2D(uMeadow,uv),texture2D(uMeadow,uv+vec2(d.x,0.)),f.x),
            mix(texture2D(uMeadow,uv+vec2(0.,d.y)),texture2D(uMeadow,uv+d),f.x),f.y);
}
void applyBankHabitat(vec2 p,inout vec4 field){
 if(!uIslandField){
   vec4 bank=riverbankHabitat(p);
   float foliage=mix(.92,1.42,smoothstep(.26,.68,bank.r))*(1.-.45*bank.g);
   foliage*=1.-.94*smoothstep(.07,.55,bank.b);
   field.g=min(1.,field.g*mix(1.,foliage,bank.a))*(1.-.18*bridgeShade(p));
   field.b=mix(field.b,bank.r,bank.a);
 }
}
bool outsideShell(vec2 p){
 vec2 offset=p-cameraPosition.xz;
 return dot(offset,offset)>=uShell.w*uShell.w;
}
float groundMask(vec4 field, vec2 margins){
 return uIslandField ? smoothstep(.04,.28,field.a) : smoothstep(margins.x,margins.y,field.a);
}
float projectedCoverage(vec3 root,float distanceToEye,float width,float height){
 float angle=abs(cameraPosition.y-root.y)/max(.01,distanceToEye);
 float upright=sqrt(max(0.,1.-angle*angle));
 float pixels=uFocalPixels*max(width,height*upright)/max(.25,distanceToEye);
 return smoothstep(.55,1.8,pixels);
}
void hideBlade(out vec3 P,out vec3 N){
 P=cameraPosition+vec3(0.,-10000.,0.);
 N=vec3(0.,1.,0.);
 vBladeTint=vec3(0.);
 vBladeTip=0.;
}
`;
export const placementGLSL=fieldGLSL+`
void placeBlade(out vec3 P,out vec3 N){
 float id=float(gl_InstanceID);vec2 cell=uOrigin+vec2(mod(id,uGrid),floor(id/uGrid));vec4 rnd=mHash(cell+uBlade.w*17.31);vec2 xz=(cell+mix(vec2(.08),vec2(.92),rnd.xy))*uSpacing;
 if(outsideShell(xz)){hideBlade(P,N);return;}
 vec4 field=meadowAt(xz);vec3 root=vec3(xz.x,field.r-.035,xz.y);float d=distance(root,cameraPosition);
 float fade=smoothstep(uShell.x,uShell.y,d)*(1.-smoothstep(uShell.z,uShell.w,d));
 float visibleSize=projectedCoverage(root,d,uBlade.x*2.,uBlade.y);
 fade*=smoothstep(rnd.x*.69-.16,rnd.x*.69+.29,visibleSize)*visibleSize;
 vec4 clip=projectionMatrix*viewMatrix*vec4(root,1.);
 if(abs(clip.x)>clip.w*1.12||abs(clip.y)>clip.w*1.2||clip.w<0.)fade=0.;
 if(fade<.002){hideBlade(P,N);return;}
 #if MEADOW_SHORE_MASK
 if(!uIslandField)fade*=shoreGrassCover(xz);
 if(fade<.002){hideBlade(P,N);return;}
 #endif
 applyBankHabitat(xz,field);
 vec4 clearing=uIslandField?vec4(0.):clearingLight(xz);
 vec4 corridor=uIslandField?vec4(0.):riverCorridor(xz);
 float mud=smoothstep(.12,.73,1.-corridor.r*2.);
 float groves=smoothstep(.12,.72,corridor.g);
 float damp=smoothstep(.06,.66,corridor.r*2.-1.);
 float corridorBlend=corridor.a*(1.-clearing.r)*(1.-.66*valleyArtAt(xz));
 field.g*=mix(1.,(1.-mud*.86)*(1.-groves*.28)*(1.+damp*.11),corridorBlend);
 field.g=mix(field.g,max(field.g,.94-clearing.a*.18),clearing.r);
 float yard=uIslandField?0.:villageGround(xz);
 float shoulder=groundMask(field,vec2(1.9,5.8))*(1.-yard);
 if(!uIslandField)shoulder*=1.-max(valleyFields(xz).x,valleyRuinGround(xz));
 #if MEADOW_GUOFENG
 if(!uIslandField)shoulder*=shrineGrassCover(xz);
 #endif
 fade*=smoothstep(.02,.28,field.g)*step(rnd.z,field.g*1.58)*shoulder;
 if(fade<.002){hideBlade(P,N);return;}
 vec4 cl=mHash(floor(xz/.63));
 const float gfValley=float(MEADOW_GUOFENG);
 float dryPatch=0.;
 vec4 ecoClump=vec4(0.);
 #if MEADOW_GUOFENG
 // Multi-scale ecological patches for clump-level density, height, lean, and dry-grass variation.
 float ecoPatch=mNoise(xz*.014+vec2(11.3,-6.7))*.62+mNoise(xz*.038+vec2(-8.2,14.1))*.38;
 dryPatch=smoothstep(.46,.84,mNoise(xz*.021+vec2(-19.4,8.6))*.68+mNoise(xz*.072+vec2(6.1,-13.4))*.32);
 float clumpEco=mNoise(xz*.11+vec2(3.7,-12.9));
 // Natural ecological gaps: thin grass over dry/rocky patches, dense canopy shade, and village aprons so exposed soil reads cleanly.
 float villageApron=smoothstep(.04,.42,yard);
 fade*=smoothstep(.14,.42,ecoPatch*.75+clumpEco*.25)*(1.-dryPatch*.48)*(1.-villageApron*.85);
 if(fade<.002){hideBlade(P,N);return;}
 ecoClump=mHash(floor(xz/1.45));
 #endif
 float leaf=position.z, form=mod(uType*2.+step(.49,rnd.w),6.);
 // A shared fan direction within each tuft, with uneven spacing and lengths.
 float leafVariation=fract(rnd.z*13.73+leaf*.618);
 float angle=rnd.y*6.283+(leaf-1.)*mix(.68,1.97,cl.w)+.54*(leafVariation-.5);
 vec2 rdir=vec2(cos(angle),sin(angle));
 // Mid/far grass fans widen gently with distance so opposite riverbanks read as lush full tufts, not sparse ticks.
 float distSpread=uDetail?1.:1.+smoothstep(22.,105.,d)*2.35;
 float radius=(.032+leaf*.020)*mix(.65,1.65,cl.y)*distSpread;
 root.xz+=rdir*radius;
 float gust=meadowGust(xz,uTime);
 float arch=mix(.12,.66,form/5.)+gfValley*.30;
 vec2 clumpFlow=vec2(cos(ecoClump.x*6.283),sin(ecoClump.x*6.283))*.34*gfValley;
 vec2 lean=rdir*(arch+.20*cl.y+.10*leaf)+clumpFlow+vec2(.85,.52)*(.21+.48*gust)+omenShockBend(xz)*1.15;
 lean+=vec2(-.52,.85)*sin(uTime*(1.2+rnd.x*.8)+rnd.y*6.28+leaf)*(.037+.018*gfValley);
 vec4 wake=surfaceWakeAt(xz);float whip=sin(uTime*21.+rnd.y*40.)*.35*min(wake.z,1.);lean+=walkBend(xz,field.r)+wake.xy*(1.+whip)+vec2(-wake.y,wake.x)*whip*.3;
 float ll=length(lean),tilt=min(ll,1.46);vec2 ldir=lean/max(ll,.0001);
 // Natural clumped botanical height rhythm: lush tall grass tufts rise organically above softer short sward.
 float clumpPatch=smoothstep(.26,.78,mNoise(xz*.22+vec2(4.1,-9.3))*.68+mNoise(xz*.62+vec2(-11.4,6.7))*.32);
 float bankLush=smoothstep(.22,.72,field.b);
 float heightRhythm=mix(.58,1.38,clumpPatch)*(1.+.26*bankLush);
 float gfHeightRhythm=mix(.48,1.48,clumpPatch*.60+ecoClump.y*.40)*(1.+.28*bankLush)*(1.-dryPatch*.26);
 heightRhythm=mix(heightRhythm,gfHeightRhythm,gfValley);
 float h=uBlade.y*heightRhythm*mix(1.,1.16,gfValley)*mix(.66,1.34,rnd.w)*mix(.76,1.16,cl.x)*(1.-.18*min(wake.z,1.))*(1.-leaf*.10);
 h*=mix(.86,1.14,leafVariation)*mix(.55,1.,shoulder)*mix(.82,1.08,smoothstep(.28,.72,field.g));
 h*=mix(1.,.94-.12*clearing.a,clearing.r);
 vec3 l3=vec3(ldir.x,0.,ldir.y),p2=vec3(0.,h*cos(tilt),0.)+l3*h*sin(tilt);
 vec3 p1=vec3(0.,h*mix(.52,.78,form/5.),0.)+l3*h*sin(tilt)*mix(.30,.12,form/5.);
 float t=position.y,it=1.-t;vec3 c=p1*(2.*it*t)+p2*t*t,tg=normalize(p1*(2.*it-2.*t)+p2*2.*t);
 vec3 side=normalize(cross(vec3(0.,1.,0.),vec3(rdir.x,0.,rdir.y)));
 side=normalize(side+vec3(rdir.x,0.,rdir.y)*t*(cl.z-.5)*.72);
 if(!uDetail){vec3 screenSide=normalize(cross(tg,normalize(cameraPosition-root-c)));side=normalize(mix(side,screenSide*sign(dot(side,screenSide)+.0001),.72));}
 float taper=mix(1.-pow(t,mix(1.25,2.5,form/5.)), pow(max(0.,1.-t),1.15), gfValley);
 float width=uBlade.x*mix(1.,.56,gfValley)*mix(.82,1.38,rnd.x)*taper*(.78+.22*smoothstep(0.,.22,t));
 if(!uDetail) width*=1.+smoothstep(28.,105.,d)*.55;
 width*=mix(1.,.80,clearing.r);
 // Smooth upward-aligned stylized normal eliminates shiny plastic per-blade striping.
 P=root+(c+side*position.x*width)*fade;
 N=normalize(vec3(0.,1.,0.)+l3*(.18*t)+cross(side,tg)*.14);
 float macro=mNoise(xz*.028+7.3);
 float wavePatch=mNoise(xz*.085+vec2(-14.2,8.6));
 // Warm sunlit spring-meadow green palette (matte Ghibli / Genshin lush meadow tone).
 vec3 tint=mix(vec3(.195,.465,.125),vec3(.485,.725,.145),smoothstep(.16,.84,macro*.65+wavePatch*.22+clumpPatch*.13));
 tint=mix(tint,vec3(.245,.555,.155),bankLush*.42);
 // Taller sunlit tufts catch a brighter golden-lime sheen while lower sward stays rich lush meadow green.
 tint=mix(tint,tint*vec3(1.10,1.12,.86)+vec3(.025,.035,.002),clumpPatch*.45);
 // Painterly Guofeng sage, olive, grey-green & subtle dry straw mix scoped to Changfeng Valley.
 if(gfValley>.001){
   vec3 sageDark=vec3(.115,.220,.128);
   vec3 oliveMid=vec3(.265,.340,.168);
   vec3 greyGreen=vec3(.195,.275,.210);
   vec3 dryStraw=vec3(.435,.385,.205);
   vec3 gfTint=mix(sageDark,oliveMid,smoothstep(.16,.84,macro*.55+ecoClump.z*.28+clumpPatch*.17));
   gfTint=mix(gfTint,greyGreen,smoothstep(.30,.78,wavePatch)*.42);
   gfTint=mix(gfTint,vec3(.135,.260,.155),bankLush*.44);
   gfTint=mix(gfTint,dryStraw,dryPatch*(.38+.35*ecoClump.w));
   gfTint=mix(gfTint,gfTint*vec3(1.12,1.06,.84)+vec3(.018,.016,.005),clumpPatch*.38);
   tint=mix(tint,gfTint,gfValley);
 }
 if(uIslandField)tint=mix(tint,vec3(.22,.52,.22),uIslandTint);
 else {
   vec4 region=regionalTerrain(xz);
   tint=mix(tint,region.rgb*(.90+.30*macro),.38*(1.-valleyArtAt(xz)));
 }
 vec3 forestGrass=mix(vec3(.36,.68,.16),vec3(.105,.355,.195),clearing.g);
 vec3 reach=mix(vec3(.22,.48,.13),vec3(.48,.71,.15),corridor.b);
 reach=mix(reach,vec3(.18,.49,.19),damp);
 reach=mix(reach,vec3(.105,.33,.165),groves*.52);
 tint=mix(tint,reach*(.94+.14*macro),corridorBlend*.56);
 tint=mix(tint,forestGrass*(.90+.20*macro),clearing.r);
 // Soft root-to-tip painterly gradient: bright warm tips, soft lush roots (no dark spiky plastic gaps).
 vec3 animeAiry=mix(tint*mix(.96,.80,uBlade.z),tint*1.20+vec3(.048,.055,.006),pow(t,1.15));
 vec3 gfAiry=mix(tint*mix(.54,.40,uBlade.z),tint*1.22+vec3(.052,.046,.016),pow(t,1.32));
 vec3 airy=mix(animeAiry,gfAiry,gfValley);
 // Distant blades approach the same warm sunlit meadow midtone as the terrain.
 float handoff=uDetail?0.:smoothstep(38.,96.,d);
 vBladeTint=mix(airy,tint*(.95+.15*t),handoff*.60)*mix(.93,1.08,rnd.w);
 vBladeTint*=mix(vec3(1.),vec3(.66,.84,.92),uIslandField?0.:bridgeShade(xz));vBladeTip=t;
 vBladeTint=scorchBlade(vBladeTint,root,rnd.w);
}`;

export const flowerPlacementGLSL=fieldGLSL+`varying vec2 vFlowerDisc;varying vec3 vFlowerShape;
vec4 flowerDrifts(vec2 xz, vec4 field, float bankDrift){
 float scallops=mNoise(xz*.184+vec2(49.,-15.));
 float gold=smoothstep(.46,.74,mNoise(xz*.055-vec2(27.,14.))*.72+scallops*.28)*(.82+.42*bankDrift);
 float blue=smoothstep(.46,.74,mNoise(xz*.062+vec2(15.,-29.))*.72+scallops*.28)*(.78+.46*bankDrift);
 float ivory=smoothstep(.58,.82,mNoise(xz*.068+12.)*.74+scallops*.26)*(.62+.24*(1.-field.b));
 float rose=smoothstep(.48,.74,mNoise(xz*.056+62.)*.74+scallops*.26)*(.76+.36*field.g);
 return vec4(gold,blue,ivory,rose);
}
float strongestDrift(vec4 drifts){
 return max(max(drifts.x,drifts.z),max(drifts.y,drifts.w));
}
void hideFlower(out vec3 P,out vec3 N){
 hideBlade(P,N);
 vFlowerDisc=vec2(0.);
 vFlowerShape=vec3(0.);
}
void placeBlade(out vec3 P,out vec3 N){
 float id=float(gl_InstanceID);vec2 cell=uOrigin+vec2(mod(id,uGrid),floor(id/uGrid));vec4 rnd=mHash(cell+uBlade.w*17.31);vec2 xz=(cell+mix(vec2(.06),vec2(.94),rnd.xy))*uSpacing;
 if(outsideShell(xz)){hideFlower(P,N);return;}
 vec4 field=meadowAt(xz);vec3 root=vec3(xz.x,field.r-.035,xz.y);float d=distance(root,cameraPosition);
 float share=smoothstep(uShell.x,uShell.y,d)*(1.-smoothstep(uShell.z,uShell.w,d));
 share*=projectedCoverage(root,d,uBlade.x*2.2,uBlade.y*.60);
 vec4 clip=projectionMatrix*viewMatrix*vec4(root,1.);
 if(share<=0.||abs(clip.x)>clip.w*1.1||abs(clip.y)>clip.w*1.2||clip.w<0.){
   hideFlower(P,N);return;
 }
 applyBankHabitat(xz,field);
 float groundFade=smoothstep(.10,.41,field.g)*groundMask(field,vec2(3.2,5.6));
 #if MEADOW_GUOFENG
 if(!uIslandField)groundFade*=shrineGrassCover(xz);
 #endif
 #if MEADOW_SHORE_MASK
 if(!uIslandField)groundFade*=shoreGrassCover(xz);
 #endif
 if(groundFade<.002){
   hideFlower(P,N);return;
 }
 vec4 clearing=uIslandField?vec4(0.):clearingLight(xz);
 float bankDrift=smoothstep(.25,.78,field.b);
 #if MEADOW_GUOFENG
 // Keep tight natural clusters. Species noise is only needed for surviving flowers.
 float pocket=smoothstep(.64,.86,mNoise(xz*.038+vec2(23.1,-11.7)))*smoothstep(.46,.80,mNoise(xz*.17+vec2(-7.3,19.4)));
 float ecoSite=clamp(.16+bankDrift*.65+clearing.r*.55+(uIslandField?.22:0.),0.,1.);
 float roadAvoid=uIslandField?1.:groundMask(field,vec2(5.2,9.8));
 float threshold=pocket*ecoSite*roadAvoid*mix(.30,.20,uType)*share;
 #else
 vec4 drifts=flowerDrifts(xz,field,bankDrift);
 float flowerCover=strongestDrift(drifts);
 float threshold=clamp(mix(flowerCover*mix(.34,.48,uType)*(1.+.32*bankDrift),clearing.b*.30,clearing.r),0.,1.)*share;
 #endif
 float rank=mHash(xz*7.31+4.7).x;
 if(rank>=threshold){hideFlower(P,N);return;}
 float yard=uIslandField?0.:villageGround(xz);
 if(!uIslandField)yard=max(yard,max(valleyFields(xz).x,valleyRuinGround(xz)));
 float fade=smoothstep(0.,.30*threshold+.00001,threshold-rank)*groundFade*(1.-smoothstep(.08,.5,yard));
 if(fade<.002){hideFlower(P,N);return;}
 const float gfValley=float(MEADOW_GUOFENG);
 float gust=meadowGust(xz,uTime);vec4 wk=surfaceWakeAt(xz);vec2 lean=vec2(.85,.52)*(.12+gust*.2)+vec2(cos(rnd.x*6.28),sin(rnd.x*6.28))*.16+wk.xy*.8+walkBend(xz,field.r)*.8+omenShockBend(xz)*.9;
 float h=uBlade.y*mix(.82,1.38,rnd.w)*(1.+.16*bankDrift)*(1.-min(wk.z,1.)*.12),tilt=min(length(lean),1.25);vec3 l3=normalize(vec3(lean.x,.00001,lean.y)),tip=vec3(0.,h*cos(tilt),0.)+l3*h*sin(tilt),p1=vec3(0.,h*.6,0.)+l3*h*sin(tilt)*.12;
 // Clustered botanical flower drifts: sunny yellow, sky-blue, crisp white daisy, and soft coral-pink / lavender.
 float spPick=fract(rnd.y*3.71+rnd.z*1.93);
 #if MEADOW_GUOFENG
 vec4 drifts=flowerDrifts(xz,field,bankDrift);
 float flowerCover=strongestDrift(drifts);
 #endif
 float species=drifts.x==flowerCover?0.:drifts.y==flowerCover?2.:drifts.w==flowerCover?3.:1.;
 if(spPick<.20)species=0.;
 else if(spPick<.36)species=2.;
 else if(spPick<.50)species=3.;
 else if(spPick>.88)species=4.;
 float count=species<.5?6.:species<1.5?9.:species<2.5?5.:species<3.5?8.:6.;
 vec3 petal=species<.5?vec3(1.0,.86,.18)
     :species<1.5?vec3(.99,.98,.93)
     :species<2.5?vec3(.42,.72,1.0)
     :species<3.5?vec3(1.0,.52,.66)
     :vec3(.74,.48,1.0);
 petal*=mix(.90,1.10,rnd.y);
 // Restrained natural ivory/pale-gold meadow blooms + rare jade-celadon Xianxia spirit herbs in damp hollows.
 vec3 gfBloom=spPick>.91&&bankDrift>.35?vec3(.56,.88,.76):spPick>.70?vec3(.90,.80,.48):vec3(.94,.93,.87);
 petal=mix(petal,gfBloom,gfValley*.92);
 petal*=mix(vec3(1.),vec3(.72,.86,.94),clearing.r*clearing.g);
 if(position.z<.5){float t=position.y,it=1.-t;vec3 c=p1*2.*it*t+tip*t*t,tangent=normalize(p1*(2.*it-2.*t)+tip*2.*t);vec3 side=normalize(cross(tangent,normalize(cameraPosition-root-c)));P=root+(c+side*position.x*.006)*fade;N=vec3(0.,1.,0.);vBladeTint=vec3(.20,.48,.14);vFlowerShape=vec3(0.,0.,0.);vFlowerDisc=vec2(0.);}
 else{float angle=rnd.x*6.283;vec3 hn=normalize(vec3(0.,1.,0.)+normalize(cameraPosition-root)*(.18+.42*uType)+vec3(cos(angle),0.,sin(angle))*.44),tx=normalize(cross(hn,vec3(cos(angle),.2,sin(angle)))),ty=cross(hn,tx);float radius=mix(.098,.165,uType)*mix(.68,1.48,rnd.w)*(1.+.16*bankDrift),r=length(position.xy);P=root+(tip+(tx*position.x+ty*position.y)*radius+hn*r*r*radius*.32)*fade;N=vec3(0.,1.,0.);vBladeTint=petal;vFlowerDisc=position.xy;vFlowerShape=vec3(count,species==1.?.30:.24,1.);}
 vBladeTint=scorchBlade(vBladeTint,root,rnd.w);
 vBladeTip=1.;
}`;
export const flowerFragmentGLSL=`varying vec2 vFlowerDisc;varying vec3 vFlowerShape;
`;
export const flowerColourGLSL=`
if(vFlowerShape.z>.5){float r=length(vFlowerDisc),angle=atan(vFlowerDisc.y,vFlowerDisc.x),count=vFlowerShape.x;float pa=abs(fract(angle*count/6.2831853+.5)-.5)*2.;float outline=mix(1.,.38,pow(pa,count>9.?1.15:2.1));float aa=max(fwidth(r)*1.2,.015);float coverage=1.-smoothstep(outline-aa,outline+aa,r);if(coverage<.02)discard;diffuseColor.a*=coverage;float eye=1.-smoothstep(vFlowerShape.y-.04,vFlowerShape.y+.04,r);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.92,.76,.22),eye);}
`;

