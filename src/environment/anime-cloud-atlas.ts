import * as T from 'three';
/** Layered painted cloud silhouettes baked once on CPU; no per-frame ray marching. */
export class AnimeCloudAtlas{
 readonly target:{texture:T.CanvasTexture};
 constructor(_sun:T.Vector3){const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=512;const c=canvas.getContext('2d')!;const rand=(i:number)=>{const v=Math.sin(i*127.1+31.7)*43758.5453;return v-Math.floor(v);};
  for(let layer=0;layer<3;layer++)for(let i=0;i<19;i++){const seed=i+layer*61,x=rand(seed)*2048,y=210+layer*83+rand(seed+21)*63,w=45+rand(seed+2)*125,h=15+rand(seed+3)*35;const shape=new Path2D();shape.moveTo(x-w,y);shape.bezierCurveTo(x-w*1.2,y-h*.6,x-w*.55,y-h*1.4,x-w*.3,y-h*.7);shape.bezierCurveTo(x-w*.18,y-h*2.2,x+w*.34,y-h*2,x+w*.43,y-h*.7);shape.bezierCurveTo(x+w*.8,y-h*1.5,x+w*1.2,y-h*.5,x+w,y);shape.bezierCurveTo(x+w*.7,y+h*.3,x-w*.65,y+h*.25,x-w,y);const g=c.createLinearGradient(x,y-h*2,x,y+h*.3);g.addColorStop(0,'rgba(255,247,226,.98)');g.addColorStop(.44,'rgba(246,242,231,.98)');g.addColorStop(.74,'rgba(208,220,229,.96)');g.addColorStop(1,'rgba(156,184,208,.88)');c.fillStyle=g;c.fill(shape);}
  c.strokeStyle='rgba(245,248,249,.18)';c.lineWidth=2;for(let i=0;i<8;i++){c.beginPath();const x=rand(i+88)*2048,y=70+rand(i+98)*100;c.moveTo(x,y);c.bezierCurveTo(x+80,y-12,x+200,y-10,x+320,y-30);c.stroke();}
 const texture=new T.CanvasTexture(canvas);texture.wrapS=T.RepeatWrapping;texture.colorSpace=T.SRGBColorSpace;this.target={texture};}
 step(_renderer:T.WebGLRenderer){return true;}
 dispose(){this.target.texture.dispose();}
}
