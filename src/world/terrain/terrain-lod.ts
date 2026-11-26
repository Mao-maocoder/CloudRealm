// CDLOD selection and geomorph adapted from Petalwake (MIT), Jacob Miller.
// Reference: src/world/terrain.js, blob 717b8f8ecf7312e7c2afdeab1d9301806334090f.
// License: public/PETALWAKE_LICENSE.txt. Shared height data stays authoritative.
import * as T from 'three';
import {heightAt} from '../geo/height';
import {bounds} from '../geo/geo-core';
import {geographyGrid,gridWidth,gridStep} from '../geo/geography';
import {heightTextureGLSL,normalTextureGLSL} from '../../rendering/geography-texture';
export const LOD_GRID=16,LOD_LEAF=32,LOD_RANGE=192;
export interface TerrainNode{x:number;z:number;size:number;level:number}
export function selectTerrainNodes(x:number,z:number,altitude:number,range=LOD_RANGE,visible?:(x:number,z:number,size:number,level:number)=>boolean){
 const nodes:TerrainNode[]=[];
 const visit=(nx:number,nz:number,size:number,level:number)=>{
  if(visible&&!visible(nx,nz,size,level))return;
  const dx=Math.max(nx-x,0,x-nx-size),dz=Math.max(nz-z,0,z-nz-size);
  if(level>0&&Math.hypot(dx,dz,altitude)<range*2**(level-1)){
   const half=size/2;for(const oz of [0,half])for(const ox of [0,half])visit(nx+ox,nz+oz,half,level-1);
  }else nodes.push({x:nx,z:nz,size,level});
 };
 visit(bounds.left,bounds.north,4096,7);
 // Two aligned roots share samples and geomorph thresholds with the west block.
 for(let z=bounds.north;z<bounds.south;z+=2048)visit(bounds.left+4096,z,2048,6);
 return nodes;
}

function terrainBounds(){
 const height=geographyGrid(),levels:Float32Array[]=[];
 for(let level=0;level<=7;level++){
  const size=LOD_LEAF*2**level,tilesX=Math.floor((bounds.right-bounds.left)/size),tilesZ=(bounds.south-bounds.north)/size,cells=size/gridStep;
  const extrema=new Float32Array(tilesX*tilesZ*2);
  for(let z=0;z<tilesZ;z++)for(let x=0;x<tilesX;x++){
   let min=Infinity,max=-Infinity;
   if(level===0){
    for(let j=z*cells;j<=(z+1)*cells;j++)for(let i=x*cells;i<=(x+1)*cells;i++){
     const h=height[j*gridWidth+i];min=Math.min(min,h);max=Math.max(max,h);
    }
   }else{
    const children=levels[level-1],stride=Math.floor((bounds.right-bounds.left)/(size*.5));
    for(const j of [0,1])for(const i of [0,1]){
     const child=((z*2+j)*stride+x*2+i)*2;
     min=Math.min(min,children[child]);max=Math.max(max,children[child+1]);
    }
   }
   const index=(z*tilesX+x)*2;extrema[index]=min;extrema[index+1]=max;
  }
  levels.push(extrema);
 }
 return levels;
}
export function morphTerrainVertex(node:TerrainNode,u:number,v:number,x:number,z:number,altitude:number,range=LOD_RANGE){
 const px=node.x+u*node.size,pz=node.z+v*node.size;
 const k=T.MathUtils.clamp((Math.hypot(px-x,pz-z,altitude)/(range*2**node.level)-.75)/.22,0,1);
 return [px-((u*LOD_GRID/2)%1)*2/LOD_GRID*node.size*k,pz-((v*LOD_GRID/2)%1)*2/LOD_GRID*node.size*k];
}
export class TerrainLOD{
 readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.MeshLambertMaterial>;
 readonly uniforms={uLodCamera:{value:new T.Vector3()},uLodRange:{value:LOD_RANGE},uLodAltitude:{value:0}};
 nodes:TerrainNode[]=[];
 private attr:T.InstancedBufferAttribute;
 private readonly extrema=terrainBounds();
 private readonly frustum=new T.Frustum();
 private readonly projection=new T.Matrix4();
 private readonly box=new T.Box3();
 private readonly visible=(x:number,z:number,size:number,level:number)=>{
  const tiles=Math.floor((bounds.right-bounds.left)/size);
  const i=((z-bounds.north)/size*tiles+(x-bounds.left)/size)*2;
  const extrema=this.extrema[level];
  this.box.min.set(x,extrema[i],z);
  this.box.max.set(x+size,extrema[i+1],z+size);
  return this.frustum.intersectsBox(this.box);
 };
 constructor(material:T.MeshLambertMaterial){
  const pos:number[]=[],norm:number[]=[],colors:number[]=[],idx:number[]=[];
  for(let z=0;z<=LOD_GRID;z++)for(let x=0;x<=LOD_GRID;x++){pos.push(x/LOD_GRID,0,z/LOD_GRID);norm.push(0,1,0);colors.push(1,1,1);}
  for(let z=0;z<LOD_GRID;z++)for(let x=0;x<LOD_GRID;x++){const a=z*(LOD_GRID+1)+x,b=a+1,c=a+LOD_GRID+1,d=c+1;if((x+z)%2)idx.push(a,c,b,b,c,d);else idx.push(a,c,d,a,d,b);}
  const g=new T.InstancedBufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('normal',new T.Float32BufferAttribute(norm,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);
  this.attr=new T.InstancedBufferAttribute(new Float32Array(16384*4),4);this.attr.setUsage(T.DynamicDrawUsage);g.setAttribute('aNode',this.attr);g.instanceCount=0;
  const original=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{
   original(shader,renderer);Object.assign(shader.uniforms,this.uniforms);
   shader.vertexShader=`attribute vec4 aNode;uniform vec3 uLodCamera;uniform float uLodRange,uLodAltitude;${heightTextureGLSL}\n${normalTextureGLSL}\n`+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`vec2 normalXZ=aNode.xy+position.xz*aNode.z;vec3 objectNormal=plannedNormal(normalXZ);`);
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`vec2 grid=position.xz;
    vec2 xz=aNode.xy+grid*aNode.z;
    float dist=length(vec2(distance(xz,uLodCamera.xz),uLodAltitude));
    float morph=clamp((dist/(uLodRange*exp2(aNode.w))-.75)/.22,0.,1.);
    xz-=fract(grid*8.)/8.*aNode.z*morph;
    vec3 transformed=vec3(xz.x,plannedHeight(xz),xz.y);`);
   shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',`#include <color_vertex>
    vec2 tintXZ=aNode.xy+position.xz*aNode.z;
    float tintH=plannedGeography(tintXZ).r;
    vColor=mix(vec3(.30,.39,.16),vec3(.43,.46,.43),smoothstep(180.,380.,tintH));
    vColor=mix(vColor,vec3(.76,.83,.85),smoothstep(480.,720.,tintH));`);
  };
  material.customProgramCacheKey=()=> 'terrain-cdlod-1';
  this.mesh=new T.Mesh(g,material);this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;
 }
 update(view:T.Camera,range=LOD_RANGE){
  view.updateMatrixWorld();
  this.projection.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse);
  this.frustum.setFromProjectionMatrix(this.projection,view.coordinateSystem,view.reversedDepth);
  const camera=this.uniforms.uLodCamera.value.setFromMatrixPosition(view.matrixWorld);
  const altitude=Math.max(0,camera.y-heightAt(camera.x,camera.z)-60)*.7;
  this.uniforms.uLodRange.value=range;this.uniforms.uLodAltitude.value=altitude;
  this.nodes=selectTerrainNodes(camera.x,camera.z,altitude,range,this.visible);
  if(this.nodes.length>this.attr.count)throw new Error('Terrain LOD instance capacity exceeded');
  this.nodes.forEach((n,i)=>this.attr.setXYZW(i,n.x,n.z,n.size,n.level));
  this.mesh.geometry.instanceCount=this.nodes.length;
  if(this.nodes.length){
   this.attr.clearUpdateRanges();
   this.attr.addUpdateRange(0,this.nodes.length*4);
   this.attr.needsUpdate=true;
  }
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();}
}
