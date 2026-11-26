/** The east escarpment shares its bedrock and drainage across all formations. */
export const peakland = {
    id: 'peaks', name: '千柱云庭',
    eastStart: 1460, eastEnd: 4096,
    center: { x: 2464, z: -1520 },
    arrival: [2016, 672, -1176] as [number, number, number],
    outlook: { x: 2350, y: 646, z: -1650 },
    gate: { x: 2288, z: -1560, y: 612 },
    temple: { x: 2464, z: -1520, y: 623 },
    bridge: [{ x: 2317, z: -1555.3 }, { x: 2396, z: -1538 }],
};

export const templeSites = [
    // West bridgehead welcome pavilion
    { x: 2284, z: -1560, w: 14, d: 12, h: 7, tiers: 1, open: true },
    // East bridgehead gate pavilion aligned with cloud bridge exit
    { x: 2420, z: -1534, w: 13, d: 11, h: 6.8, tiers: 1, open: true },
    // Main grand hall centered on the main courtyard, clear of side pavilion and east stairs
    { x: 2468, z: -1488, w: 34, d: 20, h: 9.5, tiers: 2, open: false },
    // West side viewing pavilion with open courtyard space from the main hall
    { x: 2430, z: -1494, w: 12, d: 10, h: 6.5, tiers: 1, open: true },
    // Summit three-tier pagoda on upper mound
    { x: 2480, z: -1547, w: 15, d: 15, h: 6.5, tiers: 3, open: false },
    // East lower terrace retreat hall
    { x: 2536, z: -1474, w: 18, d: 13, h: 6.8, tiers: 1, open: false },
];

export const templePaths = [
    [{ x: 2293, z: -1560 }, peakland.bridge[0]],
    [peakland.bridge[1], { x: 2420, z: -1534 }, { x: 2448, z: -1518 }, { x: 2468, z: -1502 }, { x: 2504, z: -1504 }],
    [{ x: 2448, z: -1518 }, { x: 2430, z: -1502 }],
];

export function templeGrassClearance(x: number, z: number) {
    let distance = Infinity;
    for (const site of templeSites) {
        const dx = Math.abs(x - site.x) - site.w / 2 - 2;
        const dz = Math.abs(z - site.z) - site.d / 2 - 2;
        distance = Math.min(distance, Math.max(dx, dz));
        distance = Math.min(distance, Math.max(Math.abs(x - site.x) - site.w * .17, z - (site.z + site.d / 2 + 5), site.z + site.d / 2 + 2 - z));
    }
    distance = Math.min(distance, Math.max(Math.abs(x - 2504) - 2.2, z + 1506, -1530 - z));
    for (const path of [...templePaths, peakland.bridge]) {
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            const halfWidth = path === peakland.bridge ? 4.58 : 2.45;
            distance = Math.min(distance, traceDistance(x, z, [a.x, a.z, 0], [b.x, b.z, 0]).d - halfWidth);
        }
    }
    return distance;
}

export type Landform = 'needle' | 'wall' | 'cluster' | 'cliff' | 'ridge';
export interface Formation {
    id: number;
    kind: Landform;
    x: number;
    z: number;
    rx: number;
    rz: number;
    bottom: number;
    top: number;
    strike: number;
    leanX: number;
    leanZ: number;
    salt: number;
    zone: 'foothill' | 'forest' | 'far';
}

const blend = (a: number, b: number, t: number) => a + (b-a)*t;
function band(a: number, b: number, x: number) {
    const t = Math.min(1,Math.max(0,(x-a)/(b-a)));
    return t*t*(3-2*t);
}
export function geologyRandom(i: number, j: number) {
    let n = Math.imul(i+131, 374761393)+Math.imul(j+814,668265263);
    n = Math.imul(n ^ (n >>> 13),1274126177);
    return ((n^(n >>> 16))>>>0)/4294967296;
}
function noise(x: number,z: number) {
    const i=Math.floor(x),j=Math.floor(z),u=band(0,1,x-i),v=band(0,1,z-j);
    return blend(blend(geologyRandom(i,j),geologyRandom(i+1,j),u),
        blend(geologyRandom(i,j+1),geologyRandom(i+1,j+1),u),v);
}

export function peaklandWeight(x: number, z: number) {
    return band(peakland.eastStart,2300,x)*(1-band(-690,1090,z));
}

type Trace = readonly [number,number,number];
function curve(points: readonly Trace[], spacing: number) {
    const path: Trace[]=[];
    for(let i=0;i<points.length-1;i++){
        const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
        const segments=Math.ceil(Math.hypot(c[0]-b[0],c[1]-b[1])/spacing);
        for(let j=0;j<segments;j++){
            const t=j/segments,t2=t*t,t3=t2*t;
            const at=(k:0|1)=>.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3);
            path.push([at(0),at(1),blend(b[2],c[2],t)]);
        }
    }
    path.push(points[points.length-1]);
    return path;
}

// Parallel faults rise northeast. Transverse joints offset individual masses,
// opening a winding drainage gorge between the two strongest chains.
const faults = [
    { zone:'foothill' as const, reach:140, line:curve([[1535,-1460,205],[1730,-1435,277],[1870,-1550,347],[1990,-1690,405],[2120,-1870,556]],90) },
    { zone:'forest' as const, reach:169, line:curve([[1940,-1670,650],[2055,-1766,810],[2200,-1940,856],[2470,-2000,733],[2650,-2150,785],[2910,-2230,668]],93) },
    { zone:'forest' as const, reach:155, line:curve([[2140,-1200,371],[2270,-1312,510],[2495,-1395,605],[2710,-1455,744],[2840,-1610,765],[3120,-1720,710]],106) },
    { zone:'forest' as const, reach:140, line:curve([[2590,-1750,667],[2720,-1900,782],[2920,-1900,830],[3140,-2070,753],[3330,-2196,694]],96) },
    { zone:'far' as const, reach:141, line:curve([[2930,-1180,492],[3100,-1360,648],[3290,-1497,778],[3480,-1610,698],[3650,-1745,784],[3910,-1840,747]],96) },
    { zone:'far' as const, reach:132, line:curve([[3275,-2080,736],[3460,-2140,763],[3650,-2260,871],[3890,-2290,773],[4000,-2140,733]],94) },
    { zone:'far' as const, reach:152, line:curve([[3210,-760,312],[3500,-961,447],[3670,-1205,575],[3860,-1320,642],[4010,-1365,550]],115) },
];
export const peakCreek = curve([
    [4070,-2130,216], [3800,-2035,194], [3570,-1920,172], [3280,-1850,156],
    [3050,-1850,143], [2820,-1720,130], [2650,-1660,120], [2460,-1655,111],
    [2355,-1547,105], [2290,-1430,102], [2100,-1355,94], [1960,-1190,85], [1835,-1100,80],
],24).map(([x,z,y])=>({x,z,y}));

interface TraceSegment { a: Trace; b:Trace; width:number; }
const cells = new Map<string, TraceSegment[]>();
const drainage = new Map<string, TraceSegment[]>();
const cellSize = 192;
function indexTrace(target: Map<string,TraceSegment[]>,line: readonly Trace[],width:number) {
    for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i],pad=width*2;
        for(let iz=Math.floor((Math.min(a[1],b[1])-pad)/cellSize);iz<=Math.floor((Math.max(a[1],b[1])+pad)/cellSize);iz++){
            for(let ix=Math.floor((Math.min(a[0],b[0])-pad)/cellSize);ix<=Math.floor((Math.max(a[0],b[0])+pad)/cellSize);ix++){
                const key=ix+','+iz;
                const list=target.get(key)??[];
                list.push({a,b,width});
                target.set(key,list);
            }
        }
    }
}
for(const fault of faults) indexTrace(cells,fault.line,fault.reach);
indexTrace(drainage,peakCreek.map(p=>[p.x,p.z,p.y]),125);
function traceDistance(x: number,z: number,a:Trace,b:Trace) {
    const dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return {t,d:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)};
}
export function gorgeDistance(x:number,z:number) {
    let closest=Infinity,level=0;
    for(const {a,b} of drainage.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))??[]){
        const q=traceDistance(x,z,a,b);
        if(q.d<closest){closest=q.d;level=blend(a[2],b[2],q.t);}
    }
    return {closest,level};
}

// Precise landing envelopes for the original courts and both bridgeheads.
export const terraces = [
    {x:2288,z:-1560,rx:62,rz:56,top:612,crown:.74,strike:.22},
    {x:2464,z:-1520,rx:122,rz:99,top:623,crown:.72,strike:-.14},
    {x:2480,z:-1547,rx:43,rz:38,top:649,crown:.70,strike:-.14},
    {x:2537,z:-1474,rx:62,rz:53,top:570,crown:.67,strike:-.27},
];

export const formations: Formation[]=[];
function formation(kind:Landform,x:number,z:number,rx:number,rz:number,top:number,strike:number,zone:Formation['zone']) {
    const id=formations.length+1;
    const k=geologyRandom(id,331);
    formations.push({id,kind,x,z,rx,rz,top,strike,zone,bottom:zone==='foothill'?96:77,
        leanX:(geologyRandom(id,53)-.45)*rx*(kind==='needle'?.92:.59),
        leanZ:(geologyRandom(id,54)-.48)*rz*(kind==='needle'?.93:.64),salt:k*997});
}
function clearsCreek(x:number,z:number,rx:number,rz:number) {
    // Peak bases flare up to ~1.35x their nominal radius; keep the river channel and banks open.
    return gorgeDistance(x,z).closest >= Math.max(rx,rz)*1.38 + 26;
}
// Recognisable bluffs along the first flight corridor, including forked tors
// on a connected fault wall and shoulders enclosing the courts.
formation('wall',2047,-1731,149,87,727,-.89,'forest');
formation('needle',2008,-1695,47,43,779,-.29,'forest');
formation('needle',2088,-1759,51,38,814,-.86,'forest');
formation('cliff',2182,-1887,94,48,812,-.54,'forest');
formation('ridge',1750,-1415,159,104,334,-.68,'foothill');
formation('cliff',1865,-1494,98,68,414,-.67,'foothill');
formation('ridge',1870,-1158,128,61,296,-.24,'foothill');
formation('cluster',2172,-1255,62,48,449,-.75,'forest');
formation('needle',2162,-1475,32,34,511,-.83,'forest');
formation('ridge',2264,-1624,62,48,566,-.43,'forest');
formation('cliff',2478,-1556,64,26,586,-.08,'forest');
formation('cluster',2542,-1536,59,54,534,-.70,'forest');
formation('cliff',2461,-1428,76,41,603,.10,'forest');
formation('ridge',2235,-1534,60,36,527,-.37,'forest');

for(const [f,fault] of faults.entries()) {
    for(const [i,p] of fault.line.entries()){
        if(p[0]<1940 || (f===1 && p[0]<2210) || (f===2 && p[0]<2580)) continue;
        const prev=fault.line[Math.max(0,i-1)],next=fault.line[Math.min(fault.line.length-1,i+1)];
        const strike=Math.atan2(next[1]-prev[1],next[0]-prev[0]);
        const r=geologyRandom(f+55,i+6), direction=r<.5?-1:1;
        const x=p[0]-Math.sin(strike)*direction*(18+54*r),z=p[1]+Math.cos(strike)*direction*(18+48*r);
        if(x<1840||x>4038||z< -2365||gorgeDistance(x,z).closest<72)continue;
        if(terraces.some(t=>Math.hypot(t.x-x,t.z-z)<t.rx+35))continue;
        const size=53+geologyRandom(f+88,i+10)*37;
        const kind:Landform=r<.19?'wall':r<.39?'cliff':r<.58?'ridge':r<.81?'cluster':'needle';
        const long=kind==='wall'||kind==='ridge';
        const rx=size*(long?1.73:.95), rz=size*(long?.69:.82);
        if(!clearsCreek(x,z,rx,rz))continue;
        const top=p[2]*(.72+.28*geologyRandom(f+78,i+51));
        formation(kind,x,z,rx,rz,top,strike,fault.zone);
        if(r>.30){
            const n=r>.68?3:2;
            for(let j=0;j<n;j++){
                const offset=(j-(n-1)/2)*size*.80;
                const jitter=(geologyRandom(f+i*8,j+71)-.44)*size*.95;
                const sx=x+Math.cos(strike)*offset-Math.sin(strike)*jitter;
                const sz=z+Math.sin(strike)*offset+Math.cos(strike)*jitter;
                const srx=size*(.43+geologyRandom(f+i*5,j+63)*.38);
                const srz=size*(.33+geologyRandom(f+i*6,j+61)*.25);
                if(!clearsCreek(sx,sz,srx,srz))continue;
                formation(j===0&&r>.82?'needle':j===1&&r<.70?'ridge':'cluster',sx,sz,srx,
                    srz,top*(.74+.42*geologyRandom(f+i*9,j+21)),strike+.32*(j-1),fault.zone);
            }
        }
    }
}

export function peaklandRelief(x: number,z: number,original: number) {
    if(x<=peakland.eastStart||z>=1090)return original;
    const weight=peaklandWeight(x,z);
    const wrinkle=noise(x*.010,z*.010),warp=noise(x*.003,z*.003)*46;
    const foundation=112+48*noise((x+warp)*.0046,z*.0049)+25*wrinkle+43*band(3520,4110,x);
    const key=Math.floor(x/cellSize)+','+Math.floor(z/cellSize);
    let shoulder=0;
    for(const {a,b,width} of cells.get(key)??[]){
        const q=traceDistance(x+warp*.45,z-warp*.23,a,b);
        const relief=Math.min(166,blend(a[2],b[2],q.t)*.21);
        shoulder=Math.max(shoulder,relief*(1-band(.16,1.38,q.d/width)));
    }
    const coupling=band(1470,1900,x)*(1-band(2040,2460,x))*(1-band(-770,-170,z));
    let hill=original*(1-weight)+(foundation+shoulder)*weight+coupling*(24+54*wrinkle);
    const gorge=gorgeDistance(x,z);
    if(gorge.closest<134){
        const bottom=gorge.level-6+(wrinkle-.5)*4;
        hill=blend(Math.min(hill,bottom),hill,band(17,126,gorge.closest));
    }
    const bedrock=hill;
    for(const terrace of terraces){
        const dx=x-terrace.x,dz=z-terrace.z;
        if(Math.abs(dx)>234||Math.abs(dz)>212)continue;
        const c=Math.cos(terrace.strike),s=Math.sin(terrace.strike);
        const u=(dx*c+dz*s)/terrace.rx,v=(dz*c-dx*s)/terrace.rz;
        const theta=Math.atan2(v,u);
        const r=Math.sqrt(Math.sqrt(u**4+v**4))/(1+.018*Math.sin(theta*5)+.012*Math.cos(theta*11));
        const rimDistance = r - terrace.crown;
        const [westLanding, eastLanding] = peakland.bridge;
        const bridgeClearance = Math.min(Math.hypot(x-westLanding.x,z-westLanding.z), Math.hypot(x-eastLanding.x,z-eastLanding.z));
        const stairClearance = Math.hypot(x-2504, Math.max(0, -1534-z, z+1501));
        // The court and landings stay level while the falling slopes form the cliff.
        const rockFace = band(.015,.115,rimDistance) * band(11,27,bridgeClearance) * band(5,14,stairClearance);
        const seed = terrace.strike * 13;
        const ribs = .057*Math.sin(theta*3+seed) + .041*Math.sin(theta*7+seed*.53)
            + .024*Math.cos(theta*11-seed);
        const gullies = .066*Math.max(0,Math.cos(theta*5+seed))**5;
        const ledges = .027*Math.sin(rimDistance*39+1.4*Math.sin(theta*3+seed));
        const contour = r + rockFace * (ribs + gullies + ledges);
        const body=1-band(terrace.crown,1.06,contour);
        const skirt=(22+rockFace*175*ribs)*(1-band(.83,1.58,contour));
        hill=Math.max(hill,bedrock+(terrace.top-bedrock)*body+skirt*(1-body));
    }
    return original+(hill-original)*band(peakland.eastStart,1750,x);
}
