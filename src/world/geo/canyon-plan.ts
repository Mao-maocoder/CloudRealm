/** Longitudinal survey of the north valley. X values are distances from its centre. */
type Station = readonly [z:number, toe:number, rim:number, relief:number];
export const canyonNorth = -2400;
export const canyonSouth = -1168;
export const canyonRims = [
    {side:-1, stations:[
        [-2400,680,860,130],[-2304,600,770,332],[-2192,510,690,397],
        [-2064,430,640,422],[-1984,397,552,464],[-1888,338,482,489],
        [-1808,295,451,463],[-1728,299,444,439],[-1656,366,516,354],
        [-1560,404,565,282],[-1472,426,567,239],[-1384,475,637,209],
        [-1304,549,727,170],[-1240,645,774,115],[-1168,755,863,32],
    ] as readonly Station[]},
    {side:1, stations:[
        [-2400,670,810,120],[-2288,572,725,358],[-2160,497,626,438],
        [-2048,416,567,471],[-1944,384,543,505],[-1816,373,529,517],
        [-1728,385,553,511],[-1632,398,565,461],[-1544,419,586,396],
        [-1448,469,630,353],[-1360,510,672,307],[-1296,565,729,217],
        [-1224,667,811,138],[-1168,791,906,39],
    ] as readonly Station[]},
] as const;
export type CanyonRim = typeof canyonRims[number];

// A shorter, lower outcrop projects in front of the west escarpment.
export const westButtress:CanyonRim={side:-1,stations:[
    [-1664,415,512,0],[-1616,370,480,125],[-1568,293,387,146],
    [-1504,300,399,116],[-1432,339,448,108],[-1360,408,512,56],[-1312,466,560,0],
]};
const farSpurs:readonly CanyonRim[]=[
    {side:-1,stations:[
        [-2400,414,532,0],[-2336,274,377,173],[-2240,219,332,219],
        [-2152,232,341,204],[-2072,294,404,165],[-1984,400,497,0],
    ]},
    {side:1,stations:[
        [-2400,448,558,0],[-2328,299,413,137],[-2232,264,357,199],
        [-2144,251,357,216],[-2056,311,410,167],[-1976,405,513,0],
    ]},
];
export const canyonLandforms=[...canyonRims,westButtress,...farSpurs];

export function ramp(a:number,b:number,x:number) {
    const t=Math.max(0,Math.min(1,(x-a)/(b-a)));
    return t*t*(3-2*t);
}

export function rimAt(rim:CanyonRim,z:number) {
    const stations=rim.stations;
    let i=1;
    while(i<stations.length-1&&z>stations[i][0])i++;
    const a=stations[i-1],b=stations[i];
    const t=ramp(a[0],b[0],z);
    const wobble=Math.sin(z*.035+rim.side)*13+Math.sin(z*.077-rim.side)*7;
    return {
        toe:a[1]+(b[1]-a[1])*t+wobble,
        rim:a[2]+(b[2]-a[2])*t+wobble*.72,
        relief:(a[3]+(b[3]-a[3])*t)*ramp(stations[0][0],stations[0][0]+56,z)
            *(1-ramp(stations.at(-1)![0]-96,stations.at(-1)![0],z)),
    };
}

export function canyonFootprint(x:number,z:number) {
    if(z<=canyonNorth||z>=canyonSouth||Math.abs(x)<209||Math.abs(x)>1670)return false;
    return canyonLandforms.some(rim=>{
        if(x*rim.side<0||z<rim.stations[0][0]||z>rim.stations.at(-1)![0])return false;
        const section=rimAt(rim,z);
        return section.relief>45&&Math.abs(x)>section.toe+36&&Math.abs(x)<section.rim+590;
    });
}

export function basinInfluence(x:number,z:number) {
    return ramp(-2416,-2254,z)*(1-ramp(-1225,-1104,z))*(1-ramp(1220,1750,Math.abs(x)));
}

/** Soil surface supporting the independent outcrops. The gorge is carved separately. */
export function basinHeight(x:number,z:number,water:number) {
    const apron=1-ramp(-1497,-1251,z);
    const upper=1-ramp(-1900,-1536,z);
    const banks=ramp(58,520,Math.abs(x));
    const rim=ramp(415,1000,Math.abs(x));
    const lowerPool=ramp(-1330,-1200,z);
    const terraces=Math.max(water+9,(206+upper*28)*apron+(126-22*lowerPool)*(1-apron));
    return terraces + banks*(25+18*Math.sin(x*.004+z*.009))
        +rim*(61+32*Math.cos(z*.006-x*.004))+4.5*Math.sin(z*.023+x*.017)*banks;
}

export function gorgeInfluence(z:number) {
    return ramp(-1554,-1496,z)*(1-ramp(-1339,-1237,z));
}
