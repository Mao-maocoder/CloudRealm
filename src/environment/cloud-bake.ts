// Adapted cloud density/lighting shader from Petalwake, Copyright (c) 2026 Jacob Miller, MIT.
// See public/PETALWAKE_LICENSE.txt. Runtime integration is specific to Yunjing.
import * as T from 'three';
import { readArtStyle } from '../config/settings';
const atmosphere = `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbGround;
vec3 skyBase(vec3 d){return mix(vec3(.60,.80,.82),vec3(.16,.43,.71),smoothstep(0.,.4,d.y));}
`;
export class CloudBake {
 private readonly isGuofeng = readArtStyle() === 'guofeng';
 private readonly bakeW = this.isGuofeng ? 768 : 512;
 private readonly bakeH = this.isGuofeng ? 192 : 128;
 readonly target=new T.WebGLRenderTarget(this.bakeW,this.bakeH,{type:T.HalfFloatType,depthBuffer:false,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
 private scene=new T.Scene();
 private camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 private material:T.ShaderMaterial;
 private geometry=new T.BufferGeometry();
 private cursor=0;
 constructor(sun:T.Vector3){
 this.geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
 this.material=new T.ShaderMaterial({uniforms:{uJitter:{value:.5},uWeight:{value:1},uSeed:{value:new T.Vector3(13.7,4.1,91.3)},uCoverage:{value:this.isGuofeng ? .50 : .56},uSoftCloud:{value:this.isGuofeng ? 1.0 : 0.0},uSunDir:{value:sun},uSunColor:{value:new T.Vector3(1,.94,.84)},uAmbGround:{value:new T.Vector3(.23,.28,.20)}},vertexShader:'varying vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:CLOUD_FRAG,depthTest:false,depthWrite:false});
 const mesh=new T.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 this.target.texture.wrapS=T.RepeatWrapping;
 }
 get done(){ return this.cursor>=16; }
 step(renderer:T.WebGLRenderer){
 if(this.cursor>=16)return true;
 const previous=renderer.getRenderTarget(),auto=renderer.autoClear;
 const stripH = this.bakeH / 16;
 renderer.autoClear=false;this.target.scissorTest=true;this.target.scissor.set(0,this.cursor*stripH,this.bakeW,stripH);
 renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);renderer.setRenderTarget(previous);renderer.autoClear=auto;
 this.cursor++;return this.cursor>=16;
 }
 dispose(){this.target.dispose();this.material.dispose();this.geometry.dispose();}
}
const CLOUD_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uJitter;
uniform float uWeight;
uniform vec3 uSeed;
uniform float uCoverage;
uniform float uSoftCloud;
${atmosphere}

const float RP = 520000.0;                 // a small planet pulls the cloud deck down to the horizon
const float H0 = 740.0, H1 = 3720.0;
const float SIGMA = 0.045;

float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float vn3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), u.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), u.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), u.x), u.y), u.z); }
float fbm2d(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vn2(p); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03; a *= 0.5; } return s / 0.9375; }
// inverted cellular noise: round billows
float worley(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = h33(i + g);
    vec3 r = g + o - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - sqrt(d);
}
float rm(float v, float a, float b){ return clamp((v - a) / (b - a), 0.0, 1.0); }

float coverageAt(vec2 xz){
  vec2 q = xz / 21000.0 + uSeed.xy;
  q += 0.42 * vec2(vn2(q * 1.9 + 3.1), vn2(q * 1.9 - 7.3)) - 0.21;
  float c = fbm2d(q);
  float scattered=smoothstep(0.73-uCoverage*.42,0.94-uCoverage*.30,c);
  vec2 east=(xz-vec2(7130.,-1950.))/vec2(4700.,2850.);
  vec2 south=(xz-vec2(5000.,6030.))/vec2(3300.,3350.);
  vec2 north=(xz-vec2(-1400.,-7900.))/vec2(3600.,4100.);
  vec2 west=(xz-vec2(-8550.,2900.))/vec2(3400.,2800.);
  float banks=max(max(exp(-dot(east,east)),exp(-dot(south,south))),
                  max(exp(-dot(north,north)),exp(-dot(west,west))));
  return clamp(scattered*.74+banks*.81,0.,1.);
}

// lod: 0 = full detail, 1 = light march (cheap)
float density(vec3 p, float alt, int lod){
  float hf = (alt - H0) / (H1 - H0);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float cov = coverageAt(p.xz);
  if (cov < 0.01) return 0.0;
  // every cell towers to its own height
  float topN = vn2(p.xz / 3400.0 + uSeed.yz);
  float top = mix(.25,1.07,smoothstep(.05,.92,topN*.63+cov*.45));
  float prof = smoothstep(0.0, 0.055, hf) * (1.0 - smoothstep(top * 0.42, top, hf));
  // bases are flat, tops are cauliflower
  vec3 q = p / 1880.0 + vec3(0.0, uSeed.z, 0.0);
  q.y *= 1.25;
  float shape = worley(q) * 0.62 + worley(q * 2.1 + 5.0) * 0.26 + vn3(q * 4.3) * 0.12;
  float base = rm(shape, 1.0 - cov * prof * 0.92, 1.0);
  if (base <= 0.0) return 0.0;
  if (lod == 0){
    float det = worley(q * 5.3 + 2.0) * 0.6 + vn3(q * 11.0) * 0.4;
    float eroded = rm(base, det * 0.46, 1.0);
    // Soft feathered smoothstep erosion removes stepped/blocky cloud silhouettes in Guofeng mode.
    float softEroded = smoothstep(det * 0.34, 0.94, base) * (0.86 + 0.14 * vn3(q * 7.5));
    base = mix(eroded, softEroded, uSoftCloud);
  }
  // denser toward the top where the updraft condenses
  return base * mix(0.75, 1.25, hf);
}

float hg(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }

vec2 shell(vec3 ro, vec3 rd, float r){
  // ro relative to planet centre; returns near/far hit (or -1)
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main(){
  // texel -> direction (must match cloudUV in sky.js)
  float az = (vUv.x - 0.5) * 6.2831853;
  float el = vUv.y * vUv.y * 1.5707963;
  vec3 rd = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
  vec3 C = vec3(0.0, -RP, 0.0);
  vec3 ro = vec3(0.0, 80.0, 0.0);
  vec3 col = vec3(0.0);
  float T = 1.0;
  float mu = dot(rd, uSunDir);

  // ---- cumulus
  float t0 = shell(ro - C, rd, RP + H0).y;
  float t1 = shell(ro - C, rd, RP + H1).y;
  if (t0 > 0.0 && t1 > t0){
    t1 = min(t1, t0 + 46000.0);
    const int STEPS = 44;
    float dt = (t1 - t0) / float(STEPS);
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uJitter);
    float t = t0 + dt * n;
    float phase = 0.74 + 2.3 * hg(mu, 0.80) + 0.5 * hg(mu, -0.3);
    for (int i = 0; i < STEPS; i++){
      vec3 p = ro + rd * t;
      float alt = length(p - C) - RP;
      float d = density(p, alt, 0);
      if (d > 0.002){
        // light march toward the sun
        float od = 0.0;
        float ls = 70.0;
        vec3 lp = p;
        for (int j = 0; j < 4; j++){
          lp += uSunDir * ls;
          float la = length(lp - C) - RP;
          od += density(lp, la, 1) * ls;
          ls *= 1.75;
        }
        float hf = clamp((alt - H0) / (H1 - H0), 0.0, 1.0);
        // multiple scattering keeps the sunlit side luminous instead of going grey
        float beer = max(exp(-od * SIGMA), 0.62 * exp(-od * SIGMA * 0.22));
        float powder = 1.0 - exp(-d * 90.0 * SIGMA * 2.0);
        vec3 sun = uSunColor * beer * mix(1.0, powder, 0.35) * phase;
        // sky light: lavender in the shaded bases, bright blue-white on top
        vec3 amb = mix(vec3(.38,.52,.72),vec3(.95,1.00,1.12),smoothstep(.02,.65,hf))*(.74+.26*hf);
        amb += uAmbGround * 0.3 * (1.0 - hf);
        vec3 S = sun * 1.02 + amb * .91;
        // aerial perspective: distant towers sink into the haze
        float fogT = exp(-t * 2.6e-5);
        S = mix(skyBase(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.5 + 0.03, rd.z))), S, fogT);
        float a = 1.0 - exp(-d * SIGMA * dt);
        col += T * S * a;
        T *= 1.0 - a;
        if (T < 0.012) break;
      }
      t += dt;
    }
  }

  // fade the deck out right at the horizon line so it meets the haze cleanly
  float hz = smoothstep(0.0, 0.035, rd.y);
  gl_FragColor = vec4(col * hz, (1.0 - T) * hz) * uWeight;
}
`;

