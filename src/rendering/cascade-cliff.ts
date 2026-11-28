/**
 * Stylised sandstone cliff paint, shared by the terrain escarpments above the
 * falls and the canyon rock meshes.
 *
 * Everything is built from continuous, domain-warped 3D noise evaluated in
 * world space, so no feature is tied to a lattice, a height step or a
 * projection axis:
 *   - large scale: block tone and hue (cream / warm grey / grey-brown)
 *   - medium scale: sedimentary beds as iso-contours of a horizontally
 *     stretched noise field (irregular spacing, pinching, breaks), meandering
 *     weathering fissures as iso-contours of a vertically stretched field,
 *     runoff streaks and erosion mottling
 *   - small scale: tiling grain texture, faded with distance
 * The returned alpha is a height in metres for derivative bump mapping.
 */
export const cascadeCliffGLSL = `
float ccHash(vec3 p){
    p=fract(p*.1031);
    p+=dot(p,p.zyx+31.32);
    return fract((p.x+p.y)*p.z);
}
float ccNoise(vec3 p){
    vec3 i=floor(p), f=fract(p);
    vec3 u=f*f*f*(f*(f*6.-15.)+10.);
    float a=ccHash(i),               b=ccHash(i+vec3(1.,0.,0.));
    float c=ccHash(i+vec3(0.,1.,0.)), d=ccHash(i+vec3(1.,1.,0.));
    float e=ccHash(i+vec3(0.,0.,1.)), g=ccHash(i+vec3(1.,0.,1.));
    float h=ccHash(i+vec3(0.,1.,1.)), k=ccHash(i+vec3(1.,1.,1.));
    return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z);
}
// Each octave is rotated so lattice axes never line up into a visible grid.
const mat3 ccRot=mat3(.00,.80,.60,-.80,.36,-.48,-.60,-.48,.64);
float ccFbm2(vec3 p){
    float s=ccNoise(p)*.66; p=ccRot*p*2.07+17.3;
    s+=ccNoise(p)*.34;
    return s;
}
float ccFbm3(vec3 p){
    float s=ccNoise(p)*.533; p=ccRot*p*2.03+11.7;
    s+=ccNoise(p)*.300; p=ccRot*p*2.11+5.1;
    s+=ccNoise(p)*.167;
    return s;
}
// Anti-aliased thin line along the 0.5 iso-contour of a noise field. The
// filter width comes from the pixel footprint rather than fwidth, so the
// function stays valid inside the terrain shader's non-uniform branch.
float ccContour(float n,float width,float aa){
    aa+=.0005;
    float line=1.-smoothstep(width,width+aa,abs(n-.5));
    return line*(1.-smoothstep(.05,.16,aa));
}

vec4 cascadeCliff(vec3 p,vec3 up,float slope,float footprint) {
    float fineFade=1.-smoothstep(.35,2.2,footprint);
    float midFade=1.-smoothstep(2.5,10.,footprint);

    // --- large scale: block faces and hue ---------------------------------
    vec3 warp=vec3(ccFbm2(p*.0042+1.7),ccFbm2(p*.0042+8.3),ccFbm2(p*.0042+4.9))-.5;
    float macro=ccFbm3(p*.0055+warp*.9+3.1);
    float blocks=ccFbm2(vec3(p.x*.013,p.y*.019,p.z*.013)+warp*1.6+7.0);

    // --- sedimentary beds: warped, tilted, uneven thickness ----------------
    float bedY=p.y+warp.x*46.+warp.z*18.+(p.x*.035-p.z*.021);
    vec3 bedP=vec3(p.x*.0058,bedY*.036,p.z*.0058)+warp*.35;
    float strata=ccFbm3(bedP);
    float breakup=ccNoise(vec3(p.x*.016,p.y*.028,p.z*.016)+21.);
    float bedWidth=.012+.030*ccNoise(p*.021+4.4);
    float bedAA=footprint*.060;
    float bedLine=ccContour(strata,bedWidth,bedAA)*smoothstep(.30,.62,breakup);
    float bedLine2=ccContour(strata+.16,bedWidth*.7,bedAA)*smoothstep(.48,.74,breakup)*.6;
    bedLine=max(bedLine,bedLine2)*midFade;
    float bedTop=smoothstep(.40,.72,strata);

    // --- weathering fissures: meandering, interrupted, irregularly spaced --
    vec3 crackP=vec3(p.x*.021,p.y*.0034,p.z*.021)+warp*1.3+vec3(0.,ccNoise(p*.03)*.35,0.);
    float crackField=ccFbm2(crackP);
    float crackWidth=.010+.022*ccNoise(p*.017+9.1);
    float crackRun=smoothstep(.44,.70,ccNoise(vec3(p.x*.028,p.y*.011,p.z*.028)+13.));
    float crack=ccContour(crackField,crackWidth,footprint*.035)*crackRun*midFade;
    float hairField=ccNoise(vec3(p.x*.065,p.y*.012,p.z*.065)+warp*2.+31.);
    float hairline=ccContour(hairField,.018,footprint*.10)
        *smoothstep(.52,.78,ccNoise(vec3(p.x*.05,p.y*.03,p.z*.05)+3.3))*fineFade*.55;

    // --- erosion: runoff streaks and mid-scale mottling --------------------
    float streak=ccNoise(vec3(p.x*.085,p.y*.0065,p.z*.085)+warp*.8+41.);
    float runoff=smoothstep(.56,.86,streak)*(.45+.55*(1.-bedTop));
    float mottle=ccFbm2(p*.055+warp*2.5+2.0);
    vec4 grain=rockTriplanar(p,up,.29);

    // --- colour -------------------------------------------------------------
    vec3 cream=mix(vec3(.77,.67,.51),vec3(.56,.54,.49),uGuofengStyle);
    vec3 sand=mix(vec3(.67,.56,.41),vec3(.45,.46,.46),uGuofengStyle);
    vec3 warmGrey=mix(vec3(.57,.54,.48),vec3(.38,.42,.45),uGuofengStyle);
    vec3 greyBrown=mix(vec3(.45,.38,.30),vec3(.28,.32,.36),uGuofengStyle);
    vec3 shade=mix(vec3(.29,.30,.31),vec3(.16,.20,.24),uGuofengStyle);
    vec3 rock=mix(greyBrown,sand,smoothstep(.26,.70,macro));
    rock=mix(rock,cream,bedTop*smoothstep(.35,.75,macro*.5+blocks*.5)*.80);
    rock=mix(rock,warmGrey,smoothstep(.50,.80,blocks)*.50);
    rock*=.88+.22*mottle+.10*(blocks-.5);
    rock*=mix(1.,mix(.92,1.07,grain.r)*(1.-.10*grain.g),fineFade);
    rock*=1.-.22*bedLine;
    rock=mix(rock,shade*.85,.20*runoff);
    rock=mix(rock,shade*.55,crack*.58+hairline*.28);

    // Grass only takes hold on gentle ledges.
    float plantable=(1.-smoothstep(.18,.525,slope))*(1.-smoothstep(770.,920.,p.y));
    float growth=ccFbm2(p*.025+warp*1.2+6.6);
    float sod=plantable*smoothstep(.40,.72,growth*.62+bedTop*.38);
    vec3 grass=mix(
        mix(vec3(.126,.245,.057),vec3(.30,.419,.096),mottle),
        mix(vec3(.135,.215,.120),vec3(.265,.335,.165),mottle),
        uGuofengStyle
    );
    rock=mix(rock,grass,sod);

    float relief=(macro-.5)*2.4+(blocks-.5)*1.5+bedTop*.80
        -bedLine*.22-crack*.42-hairline*.12
        +((mottle-.5)*.25+(grain.r-.5)*.10)*fineFade;
    relief*=1.-sod;
    return vec4(rock,relief);
}
`;
