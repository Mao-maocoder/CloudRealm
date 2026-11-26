import { bounds } from '../geo/geo-core';
import { corridorField,corridorHabitatAt } from '../geo/river-corridor';
import { canPlantTree,heightAt,randomAt,slopeAt,trailDistance } from '../geo/height';
import { shoreDistanceAt } from '../geo/meadow-distribution';
import { inBuildingLot } from '../biomes/building-layout';
import { clearingCoverage } from '../geo/forest-clearing';
import { bridgeArtEnabled,bridgeTrees } from '../geo/bridge-look';
import { ruinCenter,valleyFieldsAt } from '../geo/valley-landmarks';
import { isMountainPineHabitat } from '../geo/regional-habitat';
import { valleyBlossomAt } from '../geo/valley-art';
import { bambooSeaRadius } from '../geo/regions';

export type CorridorTree={x:number;y:number;z:number;scale:number;kind:'pine'|'sakura'|'broad'};
const tile=128,cells=8,step=tile/cells;
const east=corridorField.left+(corridorField.width-1)*corridorField.step;
const south=corridorField.north+(corridorField.depth-1)*corridorField.step;
const cache=new Map<string,CorridorTree[]>();

/** Persistent positions are shared by the distant crowns and streamed trees. */
export function corridorTreesAt(cx:number,cz:number) {
    const key=`${cx},${cz}`, saved=cache.get(key);
    if(saved)return saved;
    const x0=cx*tile,z0=cz*tile, trees:CorridorTree[]=[];
    if(x0>=east||z0>=south||x0+tile<=corridorField.left||z0+tile<=corridorField.north)return trees;
    for(let v=0;v<cells;v++) for(let u=0;u<cells;u++) for(let layer=0;layer<2;layer++) {
        const gx=cx*cells+u,gz=cz*cells+v;
        const x=(gx+.06+.88*randomAt(gx,gz,601+layer*21))*step, z=(gz+.06+.88*randomAt(gx,gz,602+layer*21))*step;
        const bloom=valleyBlossomAt(x,z);
        const inValley=x>-1470&&x<990&&z>-1650&&z<975;
        const rank=randomAt(gx,gz,603+layer*21);
        if(layer&&bloom<.15&&(!inValley||rank>.35))continue;
        const y=heightAt(x,z), slope=slopeAt(x,z), shore=shoreDistanceAt(x,z);
        if(slope>.67||shore<6.2||x<bounds.left||x>bounds.right||z<bounds.north||z>bounds.south)continue;
        const habitat=corridorHabitatAt(x,z,y,slope,shore);
        const probability=Math.max(bloom*.88,habitat.strength*habitat.woodland**1.22*(layer?.61:.99));
        if(rank>=probability)continue;
        if(trailDistance(x,z)<6.5||clearingCoverage(x,z)>.17||valleyFieldsAt(x,z)>.1
            ||Math.hypot(x-ruinCenter.x,z-ruinCenter.z)<ruinCenter.radius+3
            ||bambooSeaRadius(x,z)<.94)continue;
        if(bridgeArtEnabled&&bridgeTrees.some(tree=>Math.hypot(x-tree.x,z-tree.z)<tree.width*1.5))continue;
        const scale=.76+randomAt(gx,gz,604+layer*21)*.80+(.24*bloom);
        if(inBuildingLot(x,z,6*scale)||!canPlantTree(x,z,1.7*scale))continue;
        if(trees.some(tree=>(tree.x-x)**2+(tree.z-z)**2<6.2**2))continue;
        const sakura=randomAt(gx,gz,605+layer*21)<Math.max(bloom*1.24,
            Math.hypot((x-690)/305,(z+460)/260)<1?.52:0);
        const kind=sakura?'sakura':isMountainPineHabitat(z,y,slope)?'pine':'broad';
        trees.push({x,y,z,scale,kind});
    }
    cache.set(key,trees);
    return trees;
}

export function allCorridorTrees() {
    const trees:CorridorTree[]=[];
    for(let z=Math.floor(corridorField.north/tile);z*tile<south;z++)
        for(let x=Math.floor(corridorField.left/tile);x*tile<east;x++)
            trees.push(...corridorTreesAt(x,z));
    return trees;
}
