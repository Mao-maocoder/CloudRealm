// Adapted from Petalwake, Copyright (c) 2026 Jacob Miller, MIT.
// See public/PETALWAKE_LICENSE.txt, commit 25443cef0eba802052d9ef24c94ba3c4157b6f2e.
import * as T from 'three';
export function bladeGeometry(segs:number,leaves=1){
 const p:number[]=[],n:number[]=[],idx:number[]=[];
 for(let leaf=0;leaf<leaves;leaf++){const base=p.length/3;for(let i=0;i<segs;i++){p.push(-1,i/segs,leaf,1,i/segs,leaf);n.push(0,1,0,0,1,0);}p.push(0,1,leaf);n.push(0,1,0);
 for(let i=0;i<segs-1;i++){const a=base+i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}const a=base+(segs-1)*2;idx.push(a,a+1,a+2);}
 const g=new T.InstancedBufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('normal',new T.Float32BufferAttribute(n,3));g.setIndex(idx);return g;
}
export function flowerGeometry(near:boolean){
 const positions:number[]=[],indices:number[]=[];if(near){for(let i=0;i<=2;i++)positions.push(-1,i/2,0,1,i/2,0);for(let i=0;i<2;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}}
 // The fragment shader draws the scalloped petal outline within a unit disc.
 // Circumscribe that disc so fewer rim vertices still enclose every petal tip.
 const base=positions.length/3,segments=near?6:4;
 const radius=1/Math.cos(Math.PI/segments);
 positions.push(0,0,1);
 for(let i=0;i<segments;i++){
     const angle=i/segments*Math.PI*2;
     positions.push(radius*Math.cos(angle),radius*Math.sin(angle),1);
     indices.push(base,base+1+i,base+1+(i+1)%segments);
 }
 const g=new T.InstancedBufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(Array.from({length:positions.length},(_,i)=>i%3===1?1:0),3));g.setIndex(indices);return g;
}
