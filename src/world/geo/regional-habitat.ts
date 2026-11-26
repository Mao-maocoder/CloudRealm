import { smooth, waterLevelAt } from './geo-core';
import { valueNoise } from './height';
import { regions } from './regions';

type Palette = readonly [number,number,number];
const profiles = [
    { id:'snow', extent:[560,580], grass:[.28,.34,.23], upland:[.51,.63,.66], woodland:.68, wet:.09, seed:21 },
    { id:'sakura', extent:[530,465], grass:[.30,.40,.14], upland:[.46,.39,.245], woodland:.84, wet:.12, seed:39 },
    { id:'autumn', extent:[540,430], grass:[.39,.34,.107], upland:[.48,.33,.17], woodland:.86, wet:.04, seed:48 },
    { id:'bamboo', extent:[505,450], grass:[.093,.31,.157], upland:[.19,.365,.175], woodland:.86, wet:.53, seed:74 },
    { id:'lake', extent:[590,420], grass:[.23,.42,.13], upland:[.38,.445,.20], woodland:.59, wet:.19, seed:152 },
    { id:'sky', extent:[490,510], grass:[.20,.38,.20], upland:[.38,.45,.35], woodland:.58, wet:.1, seed:223 },
    { id:'peaks', extent:[930,625], grass:[.16,.31,.15], upland:[.34,.34,.24], woodland:.76, wet:.13, seed:294 },
] as const;
const layouts = profiles.map(profile => {
    const region = regions.find(area=>area.id===profile.id)!;
    return {...profile,x:region.x,z:region.z};
});
const meadow:Palette = [.21,.348,.112];

/** Reserve the simplified pine silhouette for the upland tree line. */
export function isMountainPineHabitat(z:number,height:number,slope:number) {
    const aboveValley=height-waterLevelAt(z);
    if(z<-1240)return height>=185&&aboveValley>=62;
    return height>=198&&aboveValley>=110&&(slope>=.23||aboveValley>=230);
}

/** The same habitat controls canopy distribution, grass coverage and terrain colour. */
export function regionalHabitatAt(x:number,z:number,height:number,slope:number,shoreDistance:number) {
    let influence=0, moisture=0, forest=0, r=0, g=0, b=0;
    const above=Math.max(0,height-waterLevelAt(z));
    const bank=Math.exp(-Math.max(0,shoreDistance)/68);
    for (const profile of layouts) {
        const dx=(x-profile.x)/profile.extent[0], dz=(z-profile.z)/profile.extent[1];
        if (Math.abs(dx)>=1 || Math.abs(dz)>=1) continue;
        const weight=1-smooth(.48,1,Math.hypot(dx,dz));
        if (weight<=0) continue;
        const broad=valueNoise(x*.0049,z*.0049,profile.seed);
        const patch=valueNoise(x*.014,z*.014,profile.seed+7);
        const zones=broad*.77+patch*.23;
        const shelter=1-smooth(.27,.68,slope);
        const damp=profile.wet*(.56+.44*patch)*(.45+.55*shelter)+bank*.25;
        const grove=smooth(.34,.67,zones+damp*.16)*shelter;
        const foliage=profile.woodland*grove*(1-smooth(430,750,above));
        const ridge=smooth(.23,.78,zones)*.55+smooth(.26,.65,slope)*.35;
        moisture+=weight*damp;
        forest+=weight*foliage;
        r+=weight*(profile.grass[0]+(profile.upland[0]-profile.grass[0])*ridge);
        g+=weight*(profile.grass[1]+(profile.upland[1]-profile.grass[1])*ridge);
        b+=weight*(profile.grass[2]+(profile.upland[2]-profile.grass[2])*ridge);
        influence+=weight;
    }
    const fill=Math.max(0,1-influence), total=Math.max(1,influence);
    return {
        strength:Math.min(1,influence),
        moisture:moisture/total,
        woodland:forest/total,
        color:[(r+fill*meadow[0])/total,(g+fill*meadow[1])/total,(b+fill*meadow[2])/total] as Palette,
    };
}
