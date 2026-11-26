import * as T from 'three';
export const WIND_STAMPS=16;
/** Bounded world-space history. New stamps are altitude gated; old gusts spread and decay. */
export class MeadowTrail{
 readonly stamps={value:Array.from({length:WIND_STAMPS},()=>new T.Vector4(0,0,-100,0))};
 readonly directions={value:Array.from({length:WIND_STAMPS},()=>new T.Vector4())};
 readonly bounds={value:new T.Vector4(1e9,1e9,-1e9,-1e9)};
 private cursor=0;private last=-100;
 update(time:number,position:T.Vector3,velocity:T.Vector3,clearance:number){const speed=Math.hypot(velocity.x,velocity.z),strength=T.MathUtils.clamp(speed/50,0,1)*T.MathUtils.clamp((12-clearance)/9,0,1);
  if(strength>.035&&speed>4&&time-this.last>.075){this.last=time;const i=this.cursor++%WIND_STAMPS;this.stamps.value[i].set(position.x,position.z,time,strength);this.directions.value[i].set(velocity.x/speed,velocity.z/speed,speed,position.y);}
  const b=this.bounds.value;b.set(1e9,1e9,-1e9,-1e9);for(const s of this.stamps.value){const age=time-s.z;if(age>2.7){s.w=0;continue;}if(s.w<.001)continue;const r=8+age*12;b.x=Math.min(b.x,s.x-r);b.y=Math.min(b.y,s.y-r);b.z=Math.max(b.z,s.x+r);b.w=Math.max(b.w,s.y+r);}
 }
}
export const meadowWindGLSL=`
uniform float uOmenWind;
uniform vec4 uOmenShock;
float meadowGust(vec2 p,float time){
    float tMul=1.+uOmenWind*.85;
    float broad=sin(dot(p,vec2(.046,.024))-time*.78*tMul+sin(dot(p,vec2(.014,-.016))+time*.19*tMul)*.8);
    float gust=sin(dot(p,vec2(.119,.057))-time*1.31*tMul);
    float envelope=.35+.65*smoothstep(-.6,.85,sin(dot(p,vec2(.025,-.019))-time*.28*tMul));
    float squall=sin(dot(p,vec2(.085,-.062))-time*2.2)*uOmenWind*.36;
    return (broad*.55+gust*envelope*.31)*(1.+uOmenWind*1.15)+squall;
}
vec2 omenShockBend(vec2 p){
    if(uOmenShock.w<=.002)return vec2(0.);
    vec2 d=p-uOmenShock.xy;
    float dist=length(d);
    float ring=exp(-pow((dist-uOmenShock.z)/38.,2.))*uOmenShock.w;
    vec2 dir=dist>.01?d/dist:vec2(1.,0.);
    return dir*ring;
}
`;
