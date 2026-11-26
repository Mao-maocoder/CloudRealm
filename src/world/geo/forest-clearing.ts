import { smooth } from './geo-core';
import { heightAt, valueNoise } from './height';

export const clearingEntrance = { x:155,z:-180 };
const forward = {x:.88,z:-.475};
export function clearingPoint(depth:number, side:number) {
    return { x:clearingEntrance.x+forward.x*depth-forward.z*side,
        z:clearingEntrance.z+forward.z*depth+forward.x*side };
}
export const clearingTarget = clearingPoint(30,-1);
export const clearingTrees = [
    [1,-10,1.22,0,.40],[7,7.9,1.35,0,-.85],[15,-10.5,1.04,1,2.1],
    [22,10.2,1.11,1,.7],[30,-6.7,1.20,0,.35],[38,4.8,1.09,1,1.65],
    [39,-22,1.02,0,2.42],[50,-4.7,.96,1,2.1],[54,13,1.17,0,1.84],
    [16,-24,.87,2,.6],[10,19,.92,2,2.7],[25,-31,.94,2,2.4],[32,22,.97,2,1.1],
    [49,-14,.99,2,2.6],[63,-20,.90,2,2.25],[63,3,1.11,2,3.11],
    [68,-32,1.04,2,.81],[71,19,1.03,2,2.4],[80,-12,.98,2,3.2],
    [88,8,1.1,2,1.6],[88,35,.99,2,.7],[68,33,1.21,2,2.49],
    [48,30,1.09,2,.9],[57,-37,.99,2,2.8],[82,-36,1.13,2,.33],
    [-4,21,.97,2,2.15],[32,-41,1.02,2,2.49],[31,38,1.09,2,2.3],
].map(([d,s,scale,form,yaw],i)=>({...clearingPoint(d,s),scale,form,yaw,i}));

const field = {left:103,north:-287,step:.5,width:337,depth:329};
const sun = {x:-.38,y:.52,z:-.76};
export {field as clearingField};

export function clearingCoverage(x:number,z:number) {
    const dx=x-clearingEntrance.x, dz=z-clearingEntrance.z;
    const along=dx*forward.x+dz*forward.z, side=-dx*forward.z+dz*forward.x;
    return smooth(-18,2,along)*(1-smooth(70,103,along))*(1-smooth(26,49,Math.abs(side)));
}

export function bakeClearingLight() {
    const crowns=clearingTrees.map(tree=>{
        const height=(tree.form===2?6.7:7.8)*tree.scale, width=(tree.form===2?3.3:5.2)*tree.scale;
        const x=tree.x-sun.x/sun.y*height, z=tree.z-sun.z/sun.y*height;
        const rise=heightAt(x,z)-heightAt(tree.x,tree.z);
        return {...tree,shadowX:x+sun.x/sun.y*rise,shadowZ:z+sun.z/sun.y*rise,width};
    });
    const data=new Uint8Array(field.width*field.depth*4);
    for(let z=0;z<field.depth;z++) for(let x=0;x<field.width;x++){
        // Zero border so linear sampling falls away before the texture edge.
        if(x===0||z===0||x===field.width-1||z===field.depth-1)continue;
        const wx=field.left+x*field.step,wz=field.north+z*field.step;
        const mask=clearingCoverage(wx,wz);
        if(mask<=0)continue;
        let shade=0, canopy=0;
        for(const tree of crowns){
            const dx=(wx-tree.shadowX)/tree.width, dz=(wz-tree.shadowZ)/tree.width;
            const edge=Math.hypot(dx*.86,dz*.77);
            if(edge<1.48){
                const warped=edge+(valueNoise(wx*.54,wz*.54,tree.i+12)-.5)*.32;
                shade=Math.max(shade,1-smooth(.53,1.32,warped));
            }
            canopy=Math.max(canopy,1-smooth(.21,1.5,Math.hypot(wx-tree.x,wz-tree.z)/tree.width));
        }
        const flowers=smooth(.26,.71,valueNoise(wx*.112,wz*.112,53))*(1-.38*canopy);
        const i=(z*field.width+x)*4;
        data[i]=Math.round(mask*255);
        data[i+1]=Math.round(shade*(.83+.17*valueNoise(wx*1.31,wz*1.31,74))*255);
        data[i+2]=Math.round(flowers*255);
        data[i+3]=Math.round(canopy*255);
    }
    return data;
}
