import * as T from 'three';

const size=256, mask=size-1;

/** Seamless grass height, albedo and signed slopes with shared mip filtering. */
export function makeGrassCanopyTexture() {
    const height=new Float32Array(size*size);
    const tint=new Float32Array(size*size);
    let seed=958481;
    const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
    // Small curved fans overlap larger cushions, giving two useful scales in
    // the mip chain. The root and sunward shoulder use distinct values.
    for(let tuft=0;tuft<640;tuft++){
        const cx=rand()*size,cz=rand()*size, angle=rand()*Math.PI*2;
        const radius=3.5+rand()*8.4, tone=.22+rand()*.78;
        const c=Math.cos(angle),s=Math.sin(angle), reach=Math.ceil(radius*1.52);
        for(let j=-reach;j<=reach;j++)for(let i=-reach;i<=reach;i++){
            const along=(i*c+j*s)/radius, side=(-i*s+j*c)/(radius*.72);
            const dome=Math.max(0,1-along*along*.66-side*side);
            if(dome===0)continue;
            const ridge=.80+.20*Math.cos(side*13.5+along*6.2);
            const shape=dome*dome*ridge*(.64+.36*tone);
            const index=((Math.floor(cz)+j)&mask)*size+((Math.floor(cx)+i)&mask);
            if(shape>height[index]){
                height[index]=shape;
                tint[index]=tone*dome;
            }
        }
    }
    const sample=(x:number,z:number)=>height[(z&mask)*size+(x&mask)];
    const data=new Uint8Array(height.length*4);
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
        const i=z*size+x;
        const alongX=(sample(x-1,z)-sample(x+1,z))*.5;
        const alongZ=(sample(x,z-1)-sample(x,z+1))*.5;
        data[i*4]=Math.round((.16+.52*height[i]+.24*tint[i])*255);
        data[i*4+1]=Math.round(T.MathUtils.clamp(.5+alongX*1.95,0,1)*255);
        data[i*4+2]=Math.round(T.MathUtils.clamp(.5+alongZ*1.95,0,1)*255);
        data[i*4+3]=Math.round(height[i]*255);
    }
    const texture=new T.DataTexture(data,size,size,T.RGBAFormat);
    texture.wrapS=texture.wrapT=T.RepeatWrapping;
    texture.generateMipmaps=true;
    texture.magFilter=T.LinearFilter;
    texture.minFilter=T.LinearMipmapLinearFilter;
    texture.anisotropy=8;
    texture.needsUpdate=true;
    return texture;
}

export const grassCanopyGLSL=`
uniform sampler2D uGrassCanopy;
vec4 grassCanopyAt(vec2 p,vec2 dx,vec2 dz,float metres) {
    return textureGrad(uGrassCanopy,p/metres,dx/metres,dz/metres);
}
`;
