import * as T from 'three';
import type {Game} from '../app/game';
import {heightAt} from '../world/geo/height';
import {qualities} from '../config/settings';
import {welcome} from '../ui/welcome';

export type MeadowView='near'|'mid'|'wide';
/** Reproducible art review in the real world, with the same sun, pose and time. */
export async function openMeadowLab(g:Game,view:MeadowView='mid'){
 const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 g.setQuality('medium');g.input.clear();g.hud.started=false;welcome.hide();
 const x=220,z=500,h=heightAt(x,z);g.player.teleport(x,h+1.8,z,0,0);g.player.avatar.visible=false;g.player.shadow.visible=false;g.follow.free=true;
 const pose=view==='near'?[x,h+.88,z+1.8,-.09,55]:view==='wide'?[x,h+10,z+60,-.13,65]:[x,h+2.7,z+15,-.12,62];
 g.follow.freePosition.set(pose[0],pose[1],pose[2]);g.input.yaw=0;g.input.pitch=pose[3];
 for(let i=0;i<100&&(g.terrain.queue>0||g.terrain.chunks.size<60);i++)await wait(200);await wait(1500);
 // Freeze only after streaming finishes; the playable game keeps its own loop.
 g.renderer.setAnimationLoop(null);g.camera.position.set(pose[0],pose[1],pose[2]);g.camera.fov=pose[4];g.camera.updateProjectionMatrix();g.camera.up.set(0,1,0);g.camera.lookAt(g.camera.position.clone().add(new T.Vector3(0,Math.sin(pose[3]),-Math.cos(pose[3]))));
 g.terrain.lod.update(g.camera,qualities.medium.terrainRange);
 g.atmosphere.update(30,g.camera,g.player);g.terrain.setTime(30);g.terrain.vegetation.update?.(30,g.player.position,new T.Vector3(),1.8);g.surfaceWake?.update(1/60,30,g.player);g.meadow?.update(30,g.camera);g.renderer.render(g.scene,g.camera);
 return{view,world:{x,z,h},camera:g.camera.position.toArray(),pitch:pose[3],fov:pose[4],time:30,quality:'medium',grass:g.meadow?.stats,snapshot:g.snapshot(),programsOK:g.renderer.info.programs!.every(p=>(p as T.WebGLProgram&{diagnostics?:{runnable:boolean}}).diagnostics?.runnable!==false)};
}
