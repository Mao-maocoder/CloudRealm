import * as T from 'three';
import {VortexWake} from '../vendor/petalwake/vortex';
import {Wake} from '../vendor/petalwake/wake';
import {heightAt} from '../world/geo/height';
import {waterSurfaceAt} from '../world/geo/geo-core';
import {floatingFloor} from '../world/geo/regions';
import { detectDevice } from '../config/device';
import type { Quality } from '../config/settings';
import type {Player} from '../player/controller';

/** Adapter only: the existing player and terrain remain the authority. */
export class SurfaceWake {
 private footCursor=1;private footAnchor=new T.Vector3(1e9,1e9,1e9);
 readonly uniforms={uWalkTrail:{value:Array.from({length:8},()=>new T.Vector4(0,-10000,0,0))},uTime:{value:0},uWakeTex:{value:null as T.Texture|null},uWake:{value:new T.Vector4()}};
 readonly vortex=new VortexWake({heightAt:(x:number,z:number)=>Math.max(heightAt(x,z),waterSurfaceAt(x,z))});
 readonly field:Wake;
 private forward=new T.Vector3();private previous=new T.Vector3(1e9,1e9,1e9);
 constructor(renderer:T.WebGLRenderer, quality: Quality = 'medium'){
  const wakeSize = detectDevice().isMobile || quality === 'low' ? 256 : 512;
  this.field=new Wake(renderer,this.vortex,this.uniforms,wakeSize,256);
 }
 update(dt:number,time:number,player:Player){
  const p=player.position,speed=player.velocity.length();this.uniforms.uTime.value=time;
  for(const stamp of this.uniforms.uWalkTrail.value)stamp.w*=Math.exp(-dt*3.5);
  if(this.previous.distanceTo(p)>80)for(const stamp of this.uniforms.uWalkTrail.value)stamp.w=0;
  const groundHeight=Math.max(heightAt(p.x,p.z),floatingFloor(p.x,p.z,p.y+.45));
  const contact=!player.flying&&Math.abs(p.y-groundHeight)<1.1;
  if(contact){
   const active=this.uniforms.uWalkTrail.value[0];
   if(this.footAnchor.distanceTo(p)>.35){
    if(this.footAnchor.distanceTo(p)<80)this.uniforms.uWalkTrail.value[1+(this.footCursor++%7)].copy(active);
    this.footAnchor.copy(p);
   }
   active.set(p.x,p.y,p.z,1);
  }
  if(this.previous.distanceTo(p)>80){this.vortex.reset();this.field.reset();}
  this.previous.copy(p);this.forward.copy(player.velocity);if(speed>.1)this.forward.divideScalar(speed);else this.forward.set(Math.sin(player.heading),0,-Math.cos(player.heading));
  const water=waterSurfaceAt(p.x,p.z),ground=Math.max(groundHeight,water);
  // Only shed the wide aerial vortex wind-field while flying; walking uses local underfoot uWalkTrail parting only.
  const airborne=Boolean(player.flying);
  const wakeSpeed=airborne?speed:0;
  const wakeAgl=airborne?Math.max(0,p.y-ground):99;
  const flight={pos:p,fwd:this.forward,yaw:player.heading,roll:player.bank,speed:wakeSpeed,boosting:airborne&&speed>45?1:0,agl:wakeAgl,overWater:airborne&&Number.isFinite(water)&&water>=groundHeight};
  this.vortex.update(dt,flight,time,undefined);this.field.update(dt,flight);
 }
 dispose(){this.field.dispose();this.vortex.dispose();}
}
export const surfaceWakeGLSL=`uniform sampler2D uWakeTex;uniform vec4 uWake;
vec4 surfaceWakeAt(vec2 p){vec2 uv=(p-uWake.xy)*uWake.z+.5;vec2 e=min(uv,1.-uv);return texture2D(uWakeTex,uv)*smoothstep(0.,.04,min(e.x,e.y));}`;
