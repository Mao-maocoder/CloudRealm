import * as T from 'three';
import { bounds } from '../geo/geo-core';
import { allCorridorTrees } from './corridor-trees';
import { randomAt } from '../geo/height';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../../rendering/aerial-perspective';

const tile=128, left=bounds.left/tile, north=Math.floor(bounds.north/tile);
const width=(bounds.right-bounds.left)/tile, depth=Math.ceil(bounds.south/tile)-north;

/** The streamed trees take over the same positions as their distant crowns. */
export class DistantCorridorWoodland extends T.Group {
    private readonly loaded=new Uint8Array(width*depth);
    private readonly staging=new Uint8Array(width*depth);
    private readonly coverage=new T.DataTexture(this.loaded,width,depth,T.RedFormat);
    private readonly material=new T.MeshBasicMaterial({vertexColors:true});
    readonly trees:number;

    constructor(){
        super();
        this.name='river-corridor-canopy';
        this.coverage.needsUpdate=true;
        this.material.onBeforeCompile=shader=>{
            shader.uniforms.uLoadedTreeChunks={value:this.coverage};
            Object.assign(shader.uniforms, atmosphereUniforms);
            shader.vertexShader=`uniform sampler2D uLoadedTreeChunks;
                attribute vec2 aTreeChunk;
                varying vec3 vCanopyWorld;
            `+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
                vCanopyWorld=position;
                if(texture2D(uLoadedTreeChunks,aTreeChunk).r>.5)gl_Position=vec4(2.,2.,2.,1.);`);
            shader.fragmentShader='varying vec3 vCanopyWorld;\n'+aerialPerspectiveGLSL+shader.fragmentShader
                .replace('#include <fog_fragment>','')
                .replace('#include <tonemapping_fragment>',`vec3 canopyDayTint=mix(vec3(.22,.34,.52),vec3(1.),smoothstep(.35,.92,uAtmoLight));
                    vec3 canopyLit=gl_FragColor.rgb*canopyDayTint;
                    float canopyDist=length(cameraPosition-vCanopyWorld);
                    gl_FragColor.rgb=mix(canopyLit,applyAerialPerspective(canopyLit,vCanopyWorld),smoothstep(130.,470.,canopyDist));
                    #include <tonemapping_fragment>`);
        };
        const tiles=new Map<string,{positions:number[];colors:number[];chunks:number[]}>();
        const crown=new T.IcosahedronGeometry(1,0), indexedPine=new T.ConeGeometry(1,2,6,1,true);
        const pine=indexedPine.toNonIndexed();
        indexedPine.dispose();
        const trees=allCorridorTrees();
        this.trees=trees.length;
        const tint=new T.Color(), dark=new T.Color();
        for(const {x,y,z,scale,kind} of trees){
            const key=`${Math.floor(x/384)},${Math.floor(z/384)}`;
            const data=tiles.get(key)??{positions:[],colors:[],chunks:[]};
            tiles.set(key,data);
            const evergreen=kind==='pine';
            const source=(evergreen?pine:crown).getAttribute('position');
            const rank=randomAt(x,z,612), rotation=rank*6.283;
            const c=Math.cos(rotation), s=Math.sin(rotation);
            const u=(Math.floor(x/tile)-left+.5)/width,v=(Math.floor(z/tile)-north+.5)/depth;
            const autumn=x<-360&&z<-100&&z>-1000;
            tint.set(kind==='sakura'?'#efa1cf':evergreen?'#579271':autumn?'#a67e4e':'#83ad4c');
            dark.set(kind==='sakura'?'#a15898':evergreen?'#244f49':autumn?'#755945':'#315b41');
            for(let lobe=0;lobe<2;lobe++){
                const radius=scale*(evergreen?2.35-lobe*.48:3.66-lobe*.90);
                const base=y+scale*(evergreen?5.8+lobe*2.33:5.27+lobe*1.65);
                for(let i=0;i<source.count;i++){
                    const px=source.getX(i), py=source.getY(i), pz=source.getZ(i);
                    const offset=evergreen?0:lobe===0?-1.11:1.28;
                    data.positions.push(x+(px*c-pz*s)*radius+offset*c*scale,
                        base+py*scale*(evergreen?3.25-lobe*.86:2.28-lobe*.41),
                        z+(px*s+pz*c)*radius+offset*s*scale);
                    const shade=T.MathUtils.clamp((py+1)*.32+px*.14+pz*.12+rank*.2,.11,.98);
                    data.colors.push(T.MathUtils.lerp(dark.r,tint.r,shade),
                        T.MathUtils.lerp(dark.g,tint.g,shade),T.MathUtils.lerp(dark.b,tint.b,shade));
                    data.chunks.push(u,v);
                }
            }
        }
        crown.dispose();pine.dispose();
        for(const {positions,colors,chunks} of tiles.values()){
            const geo=new T.BufferGeometry();
            geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
            geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
            geo.setAttribute('aTreeChunk',new T.Float32BufferAttribute(chunks,2));
            this.add(new T.Mesh(geo,this.material));
        }
    }

    update(chunks:Iterable<string>){
        this.staging.fill(0);
        for(const key of chunks){
            const comma=key.indexOf(',');
            const x=Number(key.slice(0,comma))-left,z=Number(key.slice(comma+1))-north;
            this.staging[z*width+x]=255;
        }
        if(this.staging.every((value,i)=>value===this.loaded[i]))return;
        this.loaded.set(this.staging);
        this.coverage.needsUpdate=true;
    }

    dispose(){
        this.removeFromParent();
        for(const child of this.children)(child as T.Mesh).geometry.dispose();
        this.material.dispose();
        this.coverage.dispose();
    }
}
