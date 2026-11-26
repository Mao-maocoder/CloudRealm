import * as T from 'three';

function periodicNoise(x: number, z: number, cells: number, seed: number) {
    const sx = x*cells, sz = z*cells, ix = Math.floor(sx), iz = Math.floor(sz);
    const u = sx-ix, v = sz-iz, a = u*u*(3-2*u), b = v*v*(3-2*v);
    const hash = (px: number, pz: number) => {
        const n = Math.sin((px%cells)*127.1+(pz%cells)*311.7+seed*29.53)*43758.5453;
        return n-Math.floor(n);
    };
    return T.MathUtils.lerp(
        T.MathUtils.lerp(hash(ix,iz),hash(ix+1,iz),a),
        T.MathUtils.lerp(hash(ix,iz+1),hash(ix+1,iz+1),a),b,
    );
}

export function makeCloudField() {
    const size = 256, data = new Uint8Array(size*size*4);
    for (let z=0; z<size; z++) for (let x=0; x<size; x++) {
        const u=(x+.5)/size, v=(z+.5)/size, i=(z*size+x)*4;
        data[i] = 255*(.70*periodicNoise(u,v,4,7)+.22*periodicNoise(u,v,9,16)+.08*periodicNoise(u,v,21,31));
        data[i+1] = 255*(.58*periodicNoise(u,v,12,17)+.29*periodicNoise(u,v,25,6)+.13*periodicNoise(u,v,49,23));
        data[i+2] = 255*(.72*periodicNoise(u,v,5,11)+.28*periodicNoise(u,v,14,5));
        data[i+3] = 255;
    }
    const texture = new T.DataTexture(data,size,size,T.RGBAFormat);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
}

export const panoramaGLSL = /* glsl */ `
uniform sampler2D uCloudField;

float skyAzimuth(vec2 p) {
    return atan(p.y,p.x+0.000001)/6.28318530718+.5;
}

vec3 cloudBank(vec3 background,vec3 ray,float height,vec2 drift,float strength,float sun) {
    const float limit=22500.;
    float t=(cameraPosition.y-height)/max(.001,-ray.y);
    vec2 world=cameraPosition.xz+ray.xz*t+drift*uTime;
    vec2 uv=world/4100.;
    vec3 broad=texture2D(uCloudField,uv).rgb;
    vec2 warped=uv+vec2(broad.b-.5,broad.g-.5)*.18;
    vec3 rolled=texture2D(uCloudField,warped+vec2(.28,.39)).rgb;
    float field=.53*broad.r+.32*rolled.r+.15*rolled.g;
    float density=smoothstep(.38,.61,field);
    float lit=clamp(.55+.65*(rolled.g-.5)+.72*(field-.48),0.,1.);
    vec3 bank=mix(uCloudShadow,uCloudLit,lit)+uGlow*.12*sun*(1.-uNightFactor*.65);
    float distant=1.-exp(-max(0.,t)*.00005);
    bank=mix(bank,uHorizon,.74*distant);
    float fade=(1.-smoothstep(limit*.46,limit,t))*smoothstep(28.,130.,cameraPosition.y-height);
    return mix(background,bank,density*fade*strength);
}

vec3 cumulusDeck(vec3 sky,vec3 ray,float sun,float moon) {
    if (ray.y<.012) return sky;
    float t=1500./max(.02,ray.y);
    vec2 world=cameraPosition.xz+ray.xz*t+vec2(uTime*2.2,uTime*.9);
    vec2 uv=world/9000.;
    vec3 broad=texture2D(uCloudField,uv).rgb;
    vec3 detail=texture2D(uCloudField,uv*2.6+vec2(.31,.17)).rgb;
    float field=.52*broad.r+.28*broad.g+.20*broad.b;
    float density=smoothstep(.48,.62,field)*(.72+.28*detail.r);
    float lit=clamp(.44+.62*broad.g+.26*detail.r,0.,1.);
    float altitude=smoothstep(.02,.24,ray.y);
    vec3 cloud=mix(uCloudShadow,uCloudLit,lit*mix(.72,1.,altitude));
    float rim=pow(sun,4.)*(.28+uDuskFactor*.55)*(1.-uNightFactor)+pow(moon,6.)*uNightFactor*.42;
    cloud+=uGlow*rim*(.35+.65*lit);
    float fade=smoothstep(.01,.15,ray.y)*(1.-smoothstep(.84,.99,ray.y));
    return mix(sky,cloud,clamp(density*fade*(.88-.18*uNightFactor),0.,1.));
}

vec3 paintPanorama(vec3 sky,vec3 ray,float sun,float moon) {
    sky=mix(cumulusDeck(sky,ray,sun,moon),sky,smoothstep(.18,.92,-ray.z)*.73);
    if (ray.y<0. && cameraPosition.y>226.) {
        sky=cloudBank(sky,ray,198.,vec2(-2.5,1.6),.98,sun);
        sky=cloudBank(sky,ray,312.,vec2(-3.7,.85),.78,sun);
    }
    return sky;
}
`;
