import * as T from 'three';
import {config,qualities,type Quality} from '../../config/settings';
import {Vegetation} from '../flora/vegetation';
import {createTerrainMaterial} from '../../rendering/terrain-material';
import {TerrainLOD} from './terrain-lod';
import {bounds} from '../geo/geo-core';
import {DistantCorridorWoodland} from '../flora/distant-corridor-woodland';
import {CanyonRockField} from '../biomes/canyon-rock';
import {heightAt} from '../geo/height';
interface Chunk{plants?:T.Group;lod:number}
/** Ground is selected immediately on the GPU grid; only vegetation streams in CPU batches. */
export class Terrain{
 readonly chunks=new Map<string,Chunk>();
 readonly vegetation=new Vegetation();
 readonly material=createTerrainMaterial();
 readonly lod=new TerrainLOD(this.material);
 readonly distantWoodland=new DistantCorridorWoodland();
 readonly canyon=new CanyonRockField(this.vegetation.uniforms);
 queue=0;debug=false;
 private nextDetail=0;
 constructor(private scene:T.Scene,public quality:Quality){scene.add(this.lod.mesh,this.distantWoodland,this.canyon);}
 update(p:T.Vector3,v:T.Vector3,camera:T.Camera){
  this.lod.update(camera,qualities[this.quality].terrainRange);
  this.canyon.update(camera,this.quality);
  const q=qualities[this.quality],cx=Math.floor(p.x/128),cz=Math.floor(p.z/128);
  const wanted=new Map<string,{x:number;z:number;score:number}>();
  for(let z=cz-q.radius;z<=cz+q.radius;z++)for(let x=cx-q.radius;x<=cx+q.radius;x++){
   if(x*128>=bounds.right||(x+1)*128<=bounds.left||z*128>=bounds.south||(z+1)*128<=bounds.north)continue;
   const d=Math.hypot(x-cx,z-cz);if(d>q.radius+.5)continue;
   wanted.set(`${x},${z}`,{x,z,score:Math.min(d,Math.hypot(x-(p.x+v.x*2)/128,z-(p.z+v.z*2)/128)+.7)});
  }
  for(const [key,c]of this.chunks)if(!wanted.has(key)){if(c.plants){this.scene.remove(c.plants);this.vegetation.release(c.plants);}this.chunks.delete(key);}
  const work=[...wanted].filter(([key])=>!this.chunks.has(key)).sort((a,b)=>a[1].score-b[1].score);
  this.queue=work.length;
  const uploadStart=performance.now();
  const highFlight=p.y-heightAt(p.x,p.z)>120;
  const maxUploads=highFlight?1:config.uploadsPerFrame;
  const budgetMs=highFlight?2.5:5;
  let uploaded=0;
  for(const [key,n]of work.slice(0,maxUploads)){
   if(uploaded>0&&performance.now()-uploadStart>budgetMs)break;
   const plants=this.vegetation.create(n.x*128,n.z*128,q.vegetation,0,false);this.scene.add(plants);this.chunks.set(key,{plants,lod:0});
   uploaded++;
  }
  this.distantWoodland.update(this.chunks.keys());
  const now=performance.now();
  if(now>=this.nextDetail){
   this.nextDetail=now+150;
   const treeRange=this.quality==='low'?75:this.quality==='high'?154:112;
   for(const {plants} of this.chunks.values())if(plants)this.vegetation.updateDetail(plants,camera,treeRange);
  }
 }
 setQuality(q:Quality){if(q===this.quality)return;this.quality=q;for(const c of this.chunks.values())if(c.plants){this.scene.remove(c.plants);this.vegetation.release(c.plants);}this.chunks.clear();}
 setTime(time:number){this.material.userData.uniforms.uTime.value=time;this.canyon.setTime(time);}
 setDebug(on:boolean){this.debug=on;this.material.wireframe=on;}
 get instances(){let count=0;for(const c of this.chunks.values())c.plants?.traverse(o=>{if(o instanceof T.InstancedMesh)count+=o.count;});return count;}
 dispose(){for(const c of this.chunks.values())if(c.plants){this.scene.remove(c.plants);this.vegetation.release(c.plants);}this.chunks.clear();this.distantWoodland.dispose();this.canyon.dispose();this.lod.dispose();this.material.dispose();this.vegetation.dispose();}
}
