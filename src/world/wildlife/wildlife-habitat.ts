import { bounds, riverX, smooth, waterSurfaceAt } from '../geo/geo-core';
import { fbm, heightAt, randomAt, slopeAt, trailDistance } from '../geo/height';
import { floatingIslands, islandSurfaceAt, type FloatingIsland } from '../geo/regions';
import { blocksCreature } from '../physics/solid-world';
import { meadowHabitatAt } from '../geo/meadow-distribution';
import { inBuildingLot } from '../biomes/building-layout';
import { poissonDisk } from '../geo/poisson';
import { canyonFootprint } from '../geo/canyon-plan';

export type Temperament = 'skittish' | 'defensive' | 'hunter' | 'ambush' | 'territorial';
export interface Species {
    name: string;
    temperament: Temperament;
    height: number;
    authoredHeight: number;
    radius: number;
    bodyHalfLength?: number;
    walk: number;
    run: number;
    stride: [number, number];
    sense: number;
    reach: number;
    health: number;
    damage: number;
    cooldown: number;
    respawn: number;
    knockback?: number;
}

export const species = {
    flower: { name: '花灵', temperament: 'skittish', height: 1.40, authoredHeight: 2.6, radius: .54, walk: .96, run: 2.55, stride: [.65, 1.02], sense: 7, reach: 1.3, health: 28, damage: 5, cooldown: 3.5, respawn: 42, knockback: .62 },
    'stone-boar': { name: '岩甲野猪', temperament: 'defensive', height: 1.62, authoredHeight: 2.13, radius: .78, bodyHalfLength: .30, walk: 1.45, run: 4.25, stride: [.68, 1.18], sense: 11, reach: 2.3, health: 78, damage: 13, cooldown: 2.5, respawn: 68, knockback: .42 },
    water: { name: '水灵', temperament: 'skittish', height: 1.52, authoredHeight: 2.6, radius: .44, walk: 1.35, run: 3.45, stride: [.83, 1.25], sense: 8, reach: 1.45, health: 34, damage: 7, cooldown: 3, respawn: 48, knockback: .55 },
    wolf: { name: '棘狼', temperament: 'hunter', height: 1.97, authoredHeight: 2.09, radius: .79, bodyHalfLength: .42, walk: 2.10, run: 6.3, stride: [1.15, 2.05], sense: 25, reach: 2.1, health: 92, damage: 16, cooldown: 2.25, respawn: 85, knockback: .40 },
    mantis: { name: '螳螂妖', temperament: 'ambush', height: 2.22, authoredHeight: 2.6, radius: .65, walk: 1.85, run: 5.25, stride: [1, 1.65], sense: 14, reach: 2.55, health: 108, damage: 20, cooldown: 2.7, respawn: 100, knockback: .36 },
    'crystal-boar': { name: '晶甲野猪', temperament: 'territorial', height: 2.15, authoredHeight: 1.78, radius: 1.02, bodyHalfLength: .55, walk: 1.8, run: 5.2, stride: [.83, 1.42], sense: 22, reach: 3, health: 160, damage: 25, cooldown: 3.15, respawn: 130, knockback: .27 },
} satisfies Record<string, Species>;
export type SpeciesId = keyof typeof species;

type Biome = 'meadow' | 'bank' | 'forest' | 'ridge' | 'island';
export interface Habitat {
    id: string;
    region: string;
    biome: Biome;
    species: SpeciesId;
    x: number;
    z: number;
    count: number;
    range: number;
    island?: FloatingIsland;
}

export const habitats: Habitat[] = [
    { id: 'valley-flowers', region: 'village', biome: 'meadow', species: 'flower', x: 90, z: 128, count: 5, range: 26 },
    { id: 'valley-bank', region: 'village', biome: 'bank', species: 'water', x: riverX(91) + 27, z: 91, count: 4, range: 36 },
    { id: 'valley-boars', region: 'village', biome: 'forest', species: 'stone-boar', x: 123, z: 95, count: 2, range: 29 },
    { id: 'valley-east-meadow', region: 'village', biome: 'meadow', species: 'flower', x: 185, z: 165, count: 5, range: 42 },
    { id: 'valley-north-boars', region: 'village', biome: 'forest', species: 'stone-boar', x: 168, z: -25, count: 4, range: 48 },
    { id: 'valley-west-wolves', region: 'village', biome: 'forest', species: 'wolf', x: -120, z: 180, count: 4, range: 52 },
    { id: 'sakura-flowers', region: 'sakura', biome: 'meadow', species: 'flower', x: 600, z: -390, count: 6, range: 60 },
    { id: 'sakura-boars', region: 'sakura', biome: 'forest', species: 'stone-boar', x: 780, z: -355, count: 4, range: 65 },
    { id: 'sakura-mantis', region: 'sakura', biome: 'forest', species: 'mantis', x: 806, z: -563, count: 1, range: 66 },
    { id: 'sakura-east-meadow', region: 'sakura', biome: 'meadow', species: 'flower', x: 880, z: -430, count: 5, range: 56 },
    { id: 'autumn-boars', region: 'autumn', biome: 'forest', species: 'stone-boar', x: -657, z: -383, count: 5, range: 60 },
    { id: 'autumn-flowers', region: 'autumn', biome: 'meadow', species: 'flower', x: -840, z: -542, count: 5, range: 58 },
    { id: 'autumn-wolves', region: 'autumn', biome: 'forest', species: 'wolf', x: -866, z: -538, count: 5, range: 68 },
    { id: 'autumn-north-wolves', region: 'autumn', biome: 'forest', species: 'wolf', x: -740, z: -690, count: 4, range: 62 },
    { id: 'sakura-waters', region: 'sakura', biome: 'bank', species: 'water', x: 683, z: -418, count: 5, range: 68 },
    { id: 'bamboo-mantis', region: 'bamboo', biome: 'forest', species: 'mantis', x: -715, z: 544, count: 2, range: 52 },
    { id: 'bamboo-boars', region: 'bamboo', biome: 'forest', species: 'stone-boar', x: -720, z: 736, count: 4, range: 54 },
    { id: 'bamboo-west-wolves', region: 'bamboo', biome: 'forest', species: 'wolf', x: -860, z: 650, count: 4, range: 58 },
    { id: 'bay-waters', region: 'lake', biome: 'bank', species: 'water', x: 192, z: 1282, count: 6, range: 70 },
    { id: 'bay-flowers', region: 'lake', biome: 'meadow', species: 'flower', x: 145, z: 1244, count: 5, range: 60 },
    { id: 'lake-west-flowers', region: 'lake', biome: 'meadow', species: 'flower', x: -120, z: 1260, count: 5, range: 62 },
    { id: 'snow-wolves', region: 'snow', biome: 'ridge', species: 'wolf', x: 139, z: -1550, count: 5, range: 72 },
    { id: 'snow-elite', region: 'snow', biome: 'ridge', species: 'crystal-boar', x: -105, z: -1590, count: 1, range: 80 },
    { id: 'summit-elite', region: 'snow', biome: 'ridge', species: 'crystal-boar', x: 251, z: -1870, count: 2, range: 88 },
    { id: 'snow-west-wolves', region: 'snow', biome: 'ridge', species: 'wolf', x: -240, z: -1460, count: 4, range: 74 },
    { id: 'sky-flowers', region: 'sky', biome: 'island', species: 'flower', x: 1537, z: -1111, count: 5, range: 28, island: floatingIslands[0] },
    { id: 'sky-elite', region: 'sky', biome: 'island', species: 'crystal-boar', x: 1593, z: -1184, count: 1, range: 30, island: floatingIslands[0] },
    { id: 'peaks-bank', region: 'peaks', biome: 'bank', species: 'water', x: 1910, z: -1150, count: 5, range: 91 },
    { id: 'peaks-foothill', region: 'peaks', biome: 'forest', species: 'mantis', x: 1935, z: -1015, count: 2, range: 76 },
    { id: 'valley-south-meadow', region: 'village', biome: 'meadow', species: 'flower', x: 137, z: 306, count: 6, range: 54 },
    { id: 'valley-south-thicket', region: 'village', biome: 'forest', species: 'mantis', x: 233, z: 271, count: 2, range: 48 },
    { id: 'valley-upstream', region: 'village', biome: 'bank', species: 'water', x: riverX(-86) + 30, z: -86, count: 5, range: 58 },
    { id: 'sakura-south-meadow', region: 'sakura', biome: 'meadow', species: 'flower', x: 540, z: -263, count: 5, range: 48 },
    { id: 'sakura-approach', region: 'sakura', biome: 'forest', species: 'stone-boar', x: 641, z: -277, count: 4, range: 50 },
    { id: 'sakura-west-woods', region: 'sakura', biome: 'forest', species: 'wolf', x: 477, z: -354, count: 5, range: 60 },
    { id: 'sakura-ravine', region: 'sakura', biome: 'forest', species: 'mantis', x: 415, z: -598, count: 2, range: 70 },
    { id: 'autumn-arrival-meadow', region: 'autumn', biome: 'meadow', species: 'flower', x: -597, z: -307, count: 6, range: 52 },
    { id: 'autumn-south-wolves', region: 'autumn', biome: 'forest', species: 'wolf', x: -732, z: -252, count: 5, range: 58 },
    { id: 'autumn-pass', region: 'autumn', biome: 'forest', species: 'mantis', x: -935, z: -719, count: 2, range: 67 },
    { id: 'bamboo-south-boars', region: 'bamboo', biome: 'forest', species: 'stone-boar', x: -624, z: 814, count: 5, range: 58 },
    { id: 'bamboo-arrival-mantis', region: 'bamboo', biome: 'forest', species: 'mantis', x: -492, z: 756, count: 2, range: 45 },
    { id: 'bamboo-south-meadow', region: 'bamboo', biome: 'meadow', species: 'flower', x: -510, z: 895, count: 6, range: 69 },
    { id: 'lake-south-meadow', region: 'lake', biome: 'meadow', species: 'flower', x: 135, z: 1414, count: 6, range: 60 },
    { id: 'lake-approach-boars', region: 'lake', biome: 'forest', species: 'stone-boar', x: 244, z: 1381, count: 4, range: 64 },
    { id: 'lake-east-shallows', region: 'lake', biome: 'bank', species: 'water', x: 531, z: 1285, count: 5, range: 68 },
    { id: 'lake-north-wood', region: 'lake', biome: 'forest', species: 'mantis', x: 590, z: 800, count: 2, range: 75 },
    { id: 'snow-approach-wolves', region: 'snow', biome: 'ridge', species: 'wolf', x: 174, z: -1380, count: 5, range: 64 },
    { id: 'snow-east-elite', region: 'snow', biome: 'ridge', species: 'crystal-boar', x: 245, z: -1448, count: 2, range: 64 },
    { id: 'snow-creek', region: 'snow', biome: 'bank', species: 'water', x: riverX(-1120) + 142, z: -1120, count: 5, range: 75 },
    { id: 'sky-east-meadow', region: 'sky', biome: 'island', species: 'flower', x: 1801, z: -1008, count: 4, range: 24, island: floatingIslands[3] },
    { id: 'sky-west-mantis', region: 'sky', biome: 'island', species: 'mantis', x: 1448, z: -895, count: 2, range: 28, island: floatingIslands[1] },
    { id: 'sky-high-elite', region: 'sky', biome: 'island', species: 'crystal-boar', x: 1817, z: -1311, count: 2, range: 33, island: floatingIslands[2] },
    { id: 'peaks-cliff-meadow', region: 'peaks', biome: 'meadow', species: 'flower', x: 2423, z: -1505, count: 5, range: 34 },
    { id: 'peaks-east-cliff', region: 'peaks', biome: 'ridge', species: 'crystal-boar', x: 2519, z: -1482, count: 2, range: 34 },
    { id: 'peaks-north-creek', region: 'peaks', biome: 'bank', species: 'water', x: 2632, z: -1657, count: 6, range: 94 },
];

export function surface(habitat: Habitat, x: number, z: number) {
    const island = habitat.island;
    if (island) return Math.hypot(x-island.x, z-island.z) < island.r * .66 ? islandSurfaceAt(x, z, island) : undefined;
    if (x < bounds.left + 4 || x > bounds.right - 4 || z < bounds.north + 4 || z > bounds.south - 4) return;
    const y = heightAt(x, z);
    const water = waterSurfaceAt(x, z, .7);
    if (y >= water + .18) return y;
}

type Home = { x:number; y:number; z:number };
type Camp = { center:Home; homes:Home[] };
const weights: Record<SpeciesId, readonly number[]> = {
    flower: [.17,.20,.11,.42,.10], water:[.14,.17,.47,.13,.09],
    'stone-boar':[.17,.35,.08,.26,.14], wolf:[.27,.17,.06,.32,.18],
    mantis:[.13,.17,.13,.43,.14], 'crystal-boar':[.43,.26,.02,.09,.20],
};

/** A game suitability score. Weights are authored because there are no occurrence records to train MaxEnt on. */
export function habitatFit(habitat: Habitat,x:number,z:number) {
    if(!habitat.island&&canyonFootprint(x,z))return;
    const y=surface(habitat,x,z);
    const profile=species[habitat.species];
    if(y===undefined||inBuildingLot(x,z,profile.radius+3,habitat.island&&floatingIslands.indexOf(habitat.island)))return;
    const slope=habitat.island?0:slopeAt(x,z);
    const road=habitat.island?Infinity:trailDistance(x,z);
    if(road<4||slope>(habitat.biome==='ridge'?.62:habitat.biome==='bank'?.49:.46))return;
    if(habitat.biome==='bank'&&!Number.isFinite(waterSurfaceAt(x,z,22)))return;
    const shelteredTerrace=habitat.region==='peaks'&&habitat.biome==='meadow'&&y>580;
    const {shoreDistance,cover,moisture}=habitat.island||shelteredTerrace?{shoreDistance:Infinity,cover:.85,moisture:.31}:meadowHabitatAt(x,z,y,slope);
    const woodland=smooth(.29,.66,fbm(x*.008,z*.008,2,61));
    const kind=habitat.species, rock=kind==='stone-boar'||kind==='crystal-boar';
    const altitude=habitat.island||shelteredTerrace?1:kind==='crystal-boar'?smooth(98,450,y):kind==='wolf'? .52+.48*smooth(35,230,y):1-smooth(250,640,y);
    const footing=rock?.42+.58*smooth(.035,.36,slope):1-smooth(.08,.64,slope);
    const wet=kind==='water' ? 1-smooth(2,25,shoreDistance) :.39+.61*moisture;
    const plants=kind==='flower'||kind==='water'?cover:rock?.36+.64*woodland:.35*cover+.65*woodland;
    const factors=[altitude,footing,wet,plants,smooth(4,29,road)];
    const score=factors.reduce((sum,value,i)=>sum+value*weights[kind][i],0);
    if(score>=.40)return {x,y,z,score};
}

function makeCamp(h:Habitat,seed:number,neighbors:readonly (Camp&{region:string})[] = [],live=false):Camp|undefined {
    let index=0;
    const random=()=>randomAt(seed,index++,479);
    const profile=species[h.species];
    const fit=(x:number,z:number)=>{
        const p=habitatFit(h,x,z);
        if(p&&(!live||!blocksCreature(x,p.y,z,profile.radius,profile.height)))return p;
    };
    const candidates=poissonDisk(h,h.range,Math.max(3.5,h.range*.14),random)
        .map(p=>fit(p.x,p.z)).filter(p=>p!==undefined)
        .filter(p=>neighbors.every(n=>n.region!==h.region||Math.abs(p.y-n.center.y)>28||Math.hypot(p.x-n.center.x,p.z-n.center.z)>=16));
    candidates.sort((a,b)=>b.score-a.score+.12*(Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))/h.range);
    const minimum=profile.radius*2.7+1.4;
    for(const center of candidates.slice(0,12)){
        const groupRadius=Math.min(h.range,Math.max(11,h.count*4.7));
        const homes:Home[]=[center];
        if(h.count===1)return {center,homes};
        for(const p of poissonDisk(center,groupRadius,minimum,random,100)){
            if(Math.hypot(p.x-h.x,p.z-h.z)>h.range+2||Math.hypot(p.x-center.x,p.z-center.z)<minimum)continue;
            const home=fit(p.x,p.z);
            if(!home||Math.abs(home.y-center.y)>3.8)continue;
            if(h.biome==='bank'){
                const steps=Math.ceil(Math.hypot(home.x-center.x,home.z-center.z)/2.1);
                let separated=false;
                for(let i=1;i<steps&&!separated;i++)separated=surface(h,center.x+(home.x-center.x)*i/steps,center.z+(home.z-center.z)*i/steps)===undefined;
                if(separated)continue;
            }
            homes.push(home);
            if(homes.length===h.count)return {center,homes};
        }
    }
}

export function seedsFor(habitat: Habitat, seed: number) {
    return makeCamp(habitat,seed,[],true)?.homes??[];
}

type PlannedCamp = Camp & { region:string; habitat:Habitat; index:number };
let campPlan: PlannedCamp[] | undefined;
export function planHabitatCamps(): readonly PlannedCamp[] {
    if(campPlan)return campPlan;
    const planned:PlannedCamp[]=[];
    for(const [index,habitat] of habitats.entries()){
        const camp=makeCamp(habitat,index+1,planned);
        if(camp)planned.push({...camp,region:habitat.region,habitat,index});
    }
    campPlan=planned;
    return campPlan;
}
