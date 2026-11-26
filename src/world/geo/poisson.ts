/** Bridson's active-list sampler on a bounded disk, using the caller's seed. */
export function poissonDisk(origin: {x:number;z:number}, radius:number, spacing:number, random:()=>number, limit=160) {
    const points: {x:number;z:number}[] = [];
    const active: number[] = [];
    const grid = new Map<number,number>();
    const step = spacing/Math.SQRT2, size = Math.ceil(2*radius/step)+1;
    const left=origin.x-radius, north=origin.z-radius;
    const cell = (x:number,z:number)=>[Math.floor((x-left)/step),Math.floor((z-north)/step)] as const;
    const add = (x:number,z:number)=>{
        const [i,j]=cell(x,z);
        grid.set(j*size+i,points.length);
        active.push(points.length);
        points.push({x,z});
    };
    const first = random()*Math.PI*2, r = radius*Math.sqrt(random());
    add(origin.x+Math.cos(first)*r,origin.z+Math.sin(first)*r);
    while(active.length&&points.length<limit){
        const index=Math.floor(random()*active.length), source=points[active[index]];
        let found=false;
        for(let trial=0;trial<25&&!found;trial++){
            const angle=random()*Math.PI*2, distance=spacing*Math.sqrt(1+3*random());
            const x=source.x+Math.cos(angle)*distance,z=source.z+Math.sin(angle)*distance;
            if((x-origin.x)**2+(z-origin.z)**2>radius**2)continue;
            const [i,j]=cell(x,z);
            let clear=true;
            for(let iz=Math.max(0,j-2);iz<=Math.min(size-1,j+2)&&clear;iz++){
                for(let ix=Math.max(0,i-2);ix<=Math.min(size-1,i+2);ix++){
                    const k=grid.get(iz*size+ix);
                    if(k===undefined)continue;
                    const p=points[k];
                    if((p.x-x)**2+(p.z-z)**2<spacing**2){clear=false;break;}
                }
            }
            if(clear){add(x,z);found=true;}
        }
        if(!found){
            const last=active.pop()!;
            if(index<active.length)active[index]=last;
        }
    }
    return points;
}
