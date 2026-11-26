import * as T from 'three';
import { daylight } from '../config/art';

/**
 * Unified atmospheric & material lighting uniforms shared by reference across
 * terrain, water, sky, clouds, grass, foliage, cliffs, and distant mountains.
 * Updated once per frame by EnvironmentLightingController.
 */
export const atmosphereUniforms = {
    uAtmoAir: { value: new T.Color('#448ac4') },
    uAtmoSunAir: { value: new T.Color('#b5d6e6') },
    uAtmoMist: { value: new T.Color('#cce8f7') },
    uAtmoSunDir: { value: new T.Vector3(...daylight).normalize() },
    uAtmoLight: { value: 1.0 },
    uNightFactor: { value: 0.0 },
    uDuskFactor: { value: 0.0 },
    uHeightFogDensity: { value: 0.12 },
    uWaterBodyTint: { value: new T.Color('#ffffff') },
    uWaterSkyLow: { value: new T.Color('#70cce0') },
    uWaterSkyHigh: { value: new T.Color('#1872cc') },
    uWaterSpec: { value: new T.Color('#fff6d4') },
    uWaterSpecPower: { value: 1.2 },
    uVegTransColor: { value: new T.Color('#d2f862') },
    uVegTransStrength: { value: 0.42 },
    uVegRimColor: { value: new T.Color('#e8ff9c') },
    uVegRimStrength: { value: 0.22 },
    uOmenWind: { value: 0.0 },
    uOmenShock: { value: new T.Vector4(0, 0, 0, 0) },
    uSenseOrigin: { value: new T.Vector3(0, 0, 0) },
    /** x: current wave radius (m), y: wave band width (m), z: pulse strength (0..1), w: astral field radius (0 when off) */
    uSensePulse: { value: new T.Vector4(0, 12, 0, 0) },
    uSenseColor: { value: new T.Color('#8ee6c8') },
    /** 0..1 smooth perceptual clarity blend when Divine Sense is active (gentle painterly cool desaturation). */
    uSenseFocus: { value: 0.0 },
};

/** Analytic distance + height fog with directional sun/moon scatter. */
export const aerialPerspectiveGLSL = `
uniform vec3 uAtmoAir;
uniform vec3 uAtmoSunAir;
uniform vec3 uAtmoMist;
uniform vec3 uAtmoSunDir;
uniform float uAtmoLight;
uniform float uNightFactor;
uniform float uDuskFactor;
uniform float uHeightFogDensity;
uniform vec3 uWaterBodyTint;
uniform vec3 uWaterSkyLow;
uniform vec3 uWaterSkyHigh;
uniform vec3 uWaterSpec;
uniform float uWaterSpecPower;
uniform vec3 uSenseOrigin;
uniform vec4 uSensePulse;
uniform vec3 uSenseColor;
uniform float uSenseFocus;
float valleyMistCell(vec3 camera,vec3 point,vec3 center,vec3 radii) {
    vec3 origin=(camera-center)/radii;
    vec3 ray=(point-camera)/radii;
    float squaredLength=max(.001,dot(ray,ray));
    float t=-dot(origin,ray)/squaredLength;
    vec3 nearPoint=origin+ray*clamp(t,0.,1.);
    float crossSection=dot(nearPoint,nearPoint);
    if(crossSection>1.36||t<=0.)return 0.;
    float remainder=clamp((1.-t)*sqrt(squaredLength),-.7,1.);
    float folds=.84+.16*sin(nearPoint.x*18.+nearPoint.z*8.)
                +.10*cos(nearPoint.z*13.-nearPoint.x*7.);
    return (1.-smoothstep(.04,1.30,crossSection*folds))*smoothstep(-.58,.85,remainder);
}
vec3 applyAerialPerspective(vec3 color, vec3 point) {
    vec3 path=point-cameraPosition;
    float distanceToPoint=length(path);
    float lower=max(0.,min(cameraPosition.y,point.y));
    float span=abs(max(0.,cameraPosition.y)-max(0.,point.y))/190.;
    float density=exp(-lower/190.)*(span>.01 ? (1.-exp(-span))/span : 1.-span*.5);
    float depth=distanceToPoint*(.000072+.000218*density);
    float sunward=max(0.,dot(normalize(path+vec3(.00001)),normalize(uAtmoSunDir)));
    vec3 air=mix(uAtmoAir,uAtmoSunAir,pow(sunward,2.4)*.62);
    float overlook=smoothstep(95.,225.,cameraPosition.y)*(1.-smoothstep(605.,860.,cameraPosition.y));
    float valley=overlook*(1.-smoothstep(710.,1550.,length((cameraPosition.xz-vec2(260.,-70.))*vec2(.92,1.))));
    depth*=mix(1.,mix(.62,.91,smoothstep(1450.,5200.,distanceToPoint)),valley);
    air=mix(air,uAtmoAir*1.04,valley*.42);
    vec3 throughAir=mix(air,color,exp(-depth));

    // Smooth low-elevation valley height fog (soft dawn mist / twilight veil / moonlit valley haze).
    float lowElev=exp(-max(0.,point.y-6.)/92.);
    float distRamp=smoothstep(90.,580.,distanceToPoint)*(1.-exp(-distanceToPoint*.0015));
    float hFog=clamp(lowElev*distRamp*uHeightFogDensity,0.,.52);
    vec3 mistTint=mix(uAtmoMist,uAtmoSunAir,pow(sunward,3.)*.45);
    throughAir=mix(throughAir,mistTint,hFog);

    // Soft distant valley wisps (gentle & tinted by time of day, never harsh white stripes).
    float wispScale=.45+.55*uAtmoLight;
    if(valley>.025&&distanceToPoint>820.){
        float wisps=valleyMistCell(cameraPosition,point,vec3(-1250.,141.,734.),vec3(289.,29.,140.))*.42;
        wisps+=valleyMistCell(cameraPosition,point,vec3(-1470.,195.,199.),vec3(335.,27.,104.))*.45;
        wisps+=valleyMistCell(cameraPosition,point,vec3(-1060.,207.,-541.),vec3(257.,23.,90.))*.38;
        throughAir=mix(throughAir,uAtmoMist*.92,clamp(wisps*valley*wispScale,0.,.42));
    }
    if(path.z < -220. && point.z < -1020.){
        float wisps=valleyMistCell(cameraPosition,point,vec3(-688.,366.,-1565.),vec3(284.,20.,90.))*.38;
        wisps+=valleyMistCell(cameraPosition,point,vec3(-368.,256.,-1231.),vec3(207.,17.,68.))*.44;
        wisps+=valleyMistCell(cameraPosition,point,vec3(411.,293.,-1502.),vec3(204.,19.,111.))*.42;
        wisps+=valleyMistCell(cameraPosition,point,vec3(825.,293.,-1244.),vec3(229.,23.,99.))*.36;
        throughAir=mix(throughAir,uAtmoMist,clamp(wisps*wispScale,0.,.46));
    }

    // Divine Sense (神识) subtle perceptual clarity & 3D spherical scan wavefront — zero-cost when inactive.
    if(uSenseFocus > .001){
        float luma = dot(throughAir, vec3(0.299, 0.587, 0.114));
        vec3 spiritTint = mix(vec3(luma), vec3(luma) * mix(vec3(0.84, 0.96, 1.02), uSenseColor * 1.08, 0.28), 0.55);
        throughAir = mix(throughAir, spiritTint, uSenseFocus * 0.24);
    }
    if(uSensePulse.z > .001 || uSensePulse.w > 1.){
        vec3 sRel = point - uSenseOrigin;
        float sDist = length(sRel);
        if(uSensePulse.z > .001){
            float sBand = max(3.5, uSensePulse.y);
            float delta = sDist - uSensePulse.x;
            // Crisp leading edge + painterly ink-jade trailing veil
            float frontEdge = exp(-pow(delta / (sBand * 0.24), 2.0));
            float trailVeil = smoothstep(-sBand * 2.4, 0.0, delta) * (1.0 - smoothstep(0.0, sBand * 0.28, delta));
            float azimuth = atan(sRel.z, sRel.x);
            float brushFlow = 0.72 + 0.28 * sin(azimuth * 10.0 + sDist * 0.09) * cos(point.y * 0.18 - sDist * 0.05);
            // Delicate topographic elevation contour rings in ink-gold spirit light
            float contour = pow(0.5 + 0.5 * cos(point.y * 1.15), 14.0);
            float waveMask = (frontEdge * (0.78 + 0.42 * brushFlow) + trailVeil * (0.16 + 0.34 * contour)) * uSensePulse.z;
            vec3 inkGold = mix(uSenseColor, vec3(0.99, 0.91, 0.68), frontEdge * 0.48 + contour * 0.32);
            throughAir = mix(throughAir, inkGold, clamp(waveMask * 0.56, 0.0, 0.62));
            throughAir += inkGold * frontEdge * uSensePulse.z * 0.22;
        }
        if(uSensePulse.w > 1.){
            // Astral Divine Sense mode: soft ethereal rim & visible mountain-painted outer sphere boundary
            float edgeDist = abs(sDist - uSensePulse.w);
            float boundRing = exp(-pow(edgeDist / max(8.0, uSensePulse.w * 0.032), 2.0));
            float outside = smoothstep(uSensePulse.w * 0.94, uSensePulse.w * 1.08, sDist);
            float mistTone = mix(0.05, 0.26, outside);
            vec3 astralHue = mix(uSenseColor * 0.75, vec3(0.14, 0.24, 0.30), outside * 0.65);
            throughAir = mix(throughAir, astralHue, mistTone);
            throughAir += mix(uSenseColor, vec3(0.98, 0.90, 0.68), 0.38) * boundRing * 0.38;
        }
    }
    return throughAir;
}
`;
