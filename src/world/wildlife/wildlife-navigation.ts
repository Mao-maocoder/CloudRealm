import { Vector3 } from 'three';
import { blocksCreature, structureFloor } from '../physics/solid-world';
import { surface, type Habitat, type Species } from './wildlife-habitat';

interface Walker { habitat:Habitat; profile:Species; }
const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;

/** The same terrain, water, bridge decks and solids used by the player. */
export function walkHeight(walker:Walker,x:number,z:number, previousY:number) {
    const ground=surface(walker.habitat,x,z);
    const deck=walker.habitat.island?-Infinity:structureFloor(x,z,previousY+.08);
    const y=Math.max(ground??-Infinity,deck);
    if(Number.isFinite(y)&&Math.abs(y-previousY)<=.54&&!blocksCreature(x,y,z,walker.profile.radius,walker.profile.height)) return y;
}

/** Validate the whole edge. Sampling just its endpoints misses thin gullies and walls. */
export function walkEdge(walker:Walker,from:Vector3,x:number,z:number) {
    const distance=Math.hypot(x-from.x,z-from.z), steps=Math.max(1,Math.ceil(distance/.55));
    let y=from.y;
    for(let i=1;i<=steps;i++){
        const f=i/steps,px=from.x+(x-from.x)*f,pz=from.z+(z-from.z)*f;
        const next=walkHeight(walker,px,pz,y);
        if(next===undefined||Math.abs(next-y)>.12+distance/steps*.73)return;
        y=next;
    }
    return y;
}

interface Node { p:Vector3; cost:number; score:number; parent?:Node; }

/** Local A* is requested when steering cannot make progress. The budget is per request. */
export function findWildlifePath(walker:Walker,from:Vector3,goal:Vector3) {
    const step=2.15, maxRange=Math.min(64,Math.max(18,from.distanceTo(goal)+15));
    const heuristic=(p:Vector3)=>Math.hypot(p.x-goal.x,p.z-goal.z)+Math.min(12,Math.abs(p.y-goal.y))*.40;
    const key=(p:Vector3)=>`${Math.round((p.x-from.x)/step)},${Math.round((p.z-from.z)/step)},${Math.round(p.y/1.6)}`;
    const start:Node={p:from.clone(),cost:0,score:heuristic(from)};
    const queue=[start], costs=new Map([[key(from),0]]);
    let best=start;
    for(let expanded=0;expanded<196&&queue.length;expanded++){
        let index=0;
        for(let i=1;i<queue.length;i++)if(queue[i].score<queue[index].score)index=i;
        const current=queue[index],last=queue.pop()!;
        if(index<queue.length)queue[index]=last;
        if(current.cost>(costs.get(key(current.p))??Infinity))continue;
        if(heuristic(current.p)<heuristic(best.p))best=current;
        const remaining=Math.hypot(current.p.x-goal.x,current.p.z-goal.z);
        if(remaining<step*2.1){
            const y=walkEdge(walker,current.p,goal.x,goal.z);
            if(y!==undefined&&Math.abs(goal.y-y)<1.45){
                best={p:new Vector3(goal.x,y,goal.z),cost:0,score:0,parent:current};
                break;
            }
        }
        for(const [dx,dz] of directions){
            const x=current.p.x+dx*step,z=current.p.z+dz*step;
            if(Math.hypot(x-from.x,z-from.z)>maxRange)continue;
            const y=walkEdge(walker,current.p,x,z);
            if(y===undefined)continue;
            const p=new Vector3(x,y,z), id=key(p), cost=current.cost+Math.hypot(dx*step,y-current.p.y,dz*step);
            if(cost>=(costs.get(id)??Infinity))continue;
            costs.set(id,cost);
            queue.push({p,cost,score:cost+heuristic(p)*1.12,parent:current});
        }
    }
    if(best===start||best.score!==0&&heuristic(best.p)>heuristic(start.p)-1.5)return [];
    const path:Vector3[]=[];
    for(let node:Node|undefined=best;node?.parent;node=node.parent)path.push(node.p);
    return path.reverse();
}
