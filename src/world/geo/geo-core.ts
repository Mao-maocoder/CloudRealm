/** Pure global geography, shared by the renderer, worker, road planner and validators. */
import { peakCreek, peakland, peaklandRelief } from './peakland-plan';
import { basinHeight, basinInfluence, gorgeInfluence } from './canyon-plan';
export const bounds = { left: -2048, right: peakland.eastEnd, north: -2400, south: 1696 };
export const seed = 741103;
export const riverBankOverlap = .35;
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const riverX = (z: number) => 42 * Math.sin(z / 170) + 20 * Math.sin(z / 73)
    + 650 * smooth(450, 1696, z) - 62 * Math.exp(-(((z + 850) / 185) ** 2))
    + (1-smooth(-1650,-1559,z))*(57*Math.sin((z+1536)*.011)+13*Math.sin((z+1536)*.022));
const knots = [[-2400, 250], [-1720, 218], [-1536, 205], [-1488, 125], [-1250, 100], [-1000, 100], [-880, 92], [-832, 28], [-350, 15], [330, 8], [570, 4], [1300, 4], [1696, 1]];
export function waterLevelAt(z: number) { for (let i = 1; i < knots.length; i++)
    if (z <= knots[i][0]) {
        const [a, h] = knots[i - 1], [b, k] = knots[i];
        const t=Math.max(0,Math.min(1,(z-a)/(b-a)));
        return h+(k-h)*(Math.abs(k-h)>30?smooth(0,1,t):t);
    } return 1; }
export const upliftAt = (z: number) => 170 * (1 - smooth(-2300, -350, z));
export interface RiverPoint {
    x: number;
    z: number;
    waterLevel: number;
    halfWidth: number;
    bedLevel: number;
    flowX: number;
    flowZ: number;
}
export interface River {
    id: string;
    source: {
        x: number;
        z: number;
    };
    outlet: {
        x: number;
        z: number;
    };
    joins?: string;
    tributaries: string[];
    samples: RiverPoint[];
}
function makeRiver(id: string, points: {
    x: number;
    z: number;
}[], width: (t: number) => number, level: (p: {
    x: number;
    z: number;
}, t: number) => number, joins?: string): River { return { id, source: points[0], outlet: points.at(-1)!, joins, tributaries: [], samples: points.map((p, i) => { const t = i / (points.length - 1), a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], length = Math.hypot(b.x - a.x, b.z - a.z), waterLevel = level(p, t); return { ...p, waterLevel, halfWidth: width(t), bedLevel: waterLevel - (id === 'main' ? 5.5 : 2.5), flowX: (b.x - a.x) / length, flowZ: (b.z - a.z) / length }; }) }; }
export const ridges = [
    [{ x: -1050, z: -2200, h: 380 }, { x: -600, z: -2020, h: 680 }, { x: -100, z: -2200, h: 760 }, { x: 400, z: -2060, h: 720 }, { x: 950, z: -2350, h: 470 }],
    [{ x: -600, z: -2020, h: 640 }, { x: -850, z: -1550, h: 390 }, { x: -1120, z: -1050, h: 230 }, { x: -1300, z: -400, h: 100 }],
    [{ x: 400, z: -2060, h: 680 }, { x: 750, z: -1590, h: 390 }, { x: 1050, z: -950, h: 220 }, { x: 1280, z: -320, h: 90 }],
    [{ x: -600, z: -2020, h: 650 }, { x: -430, z: -1620, h: 420 }, { x: -570, z: -1150, h: 170 }],
    [{ x: 400, z: -2060, h: 660 }, { x: 520, z: -1720, h: 430 }, { x: 340, z: -1310, h: 230 }, { x: 480, z: -860, h: 70 }],
    [{ x: -850, z: -1550, h: 390 }, { x: -1260, z: -1300, h: 260 }, { x: -1510, z: -760, h: 70 }],
];
const ridgeCurves = ridges.map(line => { const output: {
    x: number;
    z: number;
    h: number;
}[] = []; for (let i = 0; i < line.length - 1; i++)
    for (let j = 0; j < 6; j++) {
        const t = j / 6, a = line[Math.max(0, i - 1)], b = line[i], c = line[i + 1], d = line[Math.min(line.length - 1, i + 2)], p = { x: 0, z: 0, h: 0 };
        for (const key of ['x', 'z', 'h'] as const)
            p[key] = .5 * ((2 * b[key]) + (-a[key] + c[key]) * t + (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * t * t + (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * t * t * t);
        output.push(p);
    } output.push(line.at(-1)!); return output; });
// Broad folds shape the shelf and opposing foothills. Creek sources also
// sample these spurs, so the profile is initialized before the river network.
const valleySpurs = [
    [-1285,720,490,345,172,.68], [-1210,135,405,355,205,-.43],
    [-1080,-450,490,270,152,.48], [-875,-825,370,240,123,-.64],
    [-647,225,260,305,46,.64], [-520,-350,290,210,49,-.33],
    [342,-461,265,151,29,.62], [569,219,250,215,19,-.51],
] as const;
const spurAxes=valleySpurs.map(([x,z,width,depth,height,angle])=>
    ({x,z,width,depth,height,cos:Math.cos(angle),sin:Math.sin(angle)}));
export const mainRiver = makeRiver('main', Array.from({ length: 513 }, (_, i) => {
    const z = bounds.north + i * 8;
    return { x: riverX(z), z };
}), t => {
    const z=bounds.north+t*4096;
    const width=12+15*t+8*smooth(.66,.9,t)
        +(2.6*Math.sin(t*111)+1.5*Math.sin(t*227))*(smooth(.42,.52,t)-smooth(.74,.81,t));
    const upper=smooth(-1620,-1539,z)*(1-smooth(-1479,-1394,z));
    const lower=smooth(-969,-891,z)*(1-smooth(-816,-718,z));
    return width*(1+upper*1.20+lower*.84);
}, p => waterLevelAt(p.z));
function tributary(id: string, start: {
    x: number;
    z: number;
}, joinZ: number) { const end = { x: riverX(joinZ), z: joinZ }, c1 = { x: start.x + (end.x - start.x) * .3, z: start.z + (end.z - start.z) * .15 }, c2 = { x: end.x, z: end.z - 100 }; const points = Array.from({ length: 97 }, (_, i) => { const t = i / 96, u = 1 - t; return { x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x, z: u * u * u * start.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * end.z }; }); const target = waterLevelAt(joinZ), bankHeights = points.map((p, i) => { const a = points[Math.max(0, i - 1)], b = points[Math.min(96, i + 1)], length = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length, w = (10 + 8 * i / 96) * 1.6; return Math.min(...[-w, 0, w].map(d => landformBaseHeightAt(p.x + nx * d, p.z + nz * d))) - 1.5; }), source = Math.max(target + 2, bankHeights[0]); let ceiling = source; const levels = points.map((p, i) => { const t = i / 96; ceiling = Math.min(ceiling, bankHeights[i]); const separation=Math.abs(p.x-riverX(p.z));const joinCeiling=waterLevelAt(p.z)+Math.max(0,separation-55)*.12;
 ceiling=Math.min(ceiling,joinCeiling);return Math.max(target, Math.min(ceiling, source * (1 - t) + target * t)); }); return makeRiver(id, points, t => 10 + 8 * t, (_p, t) => levels[Math.round(t * 96)], 'main'); }
const creekSample = (t:number) => peakCreek[Math.round(t*(peakCreek.length-1))];
export const rivers = [mainRiver, tributary('west-creek', { x: -870, z: -1080 }, -420), tributary('sakura-creek', { x: 850, z: -420 }, 150),
    makeRiver('peakland-creek', peakCreek, t => {
        const p=creekSample(t);
        const gorge=smooth(45,162,Math.hypot(p.x-2355,p.z+1547));
        return 7.3+gorge*(1.4+2.2*t+1.2*Math.sin(t*13)**2);
    }, (_p,t) => creekSample(t).y)];
mainRiver.tributaries.push('west-creek', 'sakura-creek');
export const lakes = [{ id: 'mountain-lake', x: riverX(-1120), z: -1120, rx: 140, rz: 115, y: 100 }, { id: 'southeast-bay', x: 390, z: 1050, rx: 370, rz: 245, y: 4 }];
type Lake = typeof lakes[number];
const bayBanks=[.91,.83,.94,1.08,1.15,.90,.81,.96,1.13,1.08,1.24,1.16,
    1.28,1.79,2.04,1.94,1.56,1.05,.92,1.04];
const mountainBanks=[.93,.81,.92,1.08,1.03,.84,.78,.95,1.10,1.07,1.17,.95,
    .84,.93,1.12,1.18,1.04,.86,.80,.90];
export const bayPavilionIsland = { x: 237, z: 919 };

function lakeShoreScale(lake:Lake,angle:number) {
    const banks=lake.id==='southeast-bay'?bayBanks:mountainBanks;
    const tau=Math.PI*2,count=banks.length;
    const index=((angle+tau)%tau)/tau*count, at=Math.floor(index), t=index-at;
    const a=banks[(at+count-1)%count], b=banks[at], c=banks[(at+1)%count], d=banks[(at+2)%count];
    const authored=b+.5*t*((c-a)+t*((2*a-5*b+4*c-d)+t*(3*b-3*c+d-a)));
    return authored+Math.sin(angle*17+.6)*.019+Math.sin(angle*31-.7)*.009;
}

export function lakeShorePoint(lake:Lake,angle:number,margin=0) {
    const dx=Math.cos(angle)*lake.rx,dz=Math.sin(angle)*lake.rz;
    const scale=lakeShoreScale(lake,angle)+margin/Math.hypot(dx,dz);
    return {x:lake.x+dx*scale,z:lake.z+dz*scale};
}

/** Signed world-space distance along an ellipse ray, zero at the authored bank. */
export function lakeShoreDistance(lake:Lake,x:number,z:number) {
    const nx=(x-lake.x)/lake.rx,nz=(z-lake.z)/lake.rz;
    const radius=Math.hypot(nx,nz), edge=Math.min(lake.rx,lake.rz);
    if(radius===0)return -edge;
    if(lake.id==='mountain-lake'&&radius>2.5)return (radius-1.25)*edge;
    if(radius>3)return (radius-2.25)*edge;
    return (radius-lakeShoreScale(lake,Math.atan2(nz,nx)))*Math.hypot(x-lake.x,z-lake.z)/radius;
}
export const waterfalls = [{ id: 'upper-fall', river: 'main', north: -1536, south: -1488 }, { id: 'valley-fall', river: 'main', north: -880, south: -832 }];
function distance(x: number, z: number, a: {
    x: number;
    z: number;
}, b: {
    x: number;
    z: number;
}) { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))); return { d: Math.hypot(x - a.x - t * dx, z - a.z - t * dz), t }; }
const riverCells = new Map<string, {
    a: RiverPoint;
    b: RiverPoint;
    id: string;
}[]>();
for (const river of rivers)
    for (let i = 1; i < river.samples.length; i++) {
        const a = river.samples[i - 1], b = river.samples[i], pad = 200;
        for (let z = Math.floor((Math.min(a.z, b.z) - pad) / 128); z <= Math.floor((Math.max(a.z, b.z) + pad) / 128); z++)
            for (let x = Math.floor((Math.min(a.x, b.x) - pad) / 128); x <= Math.floor((Math.max(a.x, b.x) + pad) / 128); x++) {
                const key = `${x},${z}`, list = riverCells.get(key) ?? [];
                list.push({ a, b, id: river.id });
                riverCells.set(key, list);
            }
    }
export function riverSamplesAt(x: number, z: number) { return riverCells.get(`${Math.floor(x / 128)},${Math.floor(z / 128)}`) ?? []; }
export function waterSurfaceAt(x: number, z: number, bankMargin = 0) { let level = -Infinity; for (const lake of lakes)
    if (lakeShoreDistance(lake,x,z)<bankMargin)
        level = Math.max(level, lake.y); const nearest = new Map<string, {
    distance: number;
    water: number;
    width: number;
}>(); for (const { id, a, b } of riverSamplesAt(x, z)) {
    const q = distance(x, z, a, b), prior = nearest.get(id);
    if (!prior || q.d < prior.distance)
        nearest.set(id, { distance: q.d, water: a.waterLevel + (b.waterLevel - a.waterLevel) * q.t, width: a.halfWidth + (b.halfWidth - a.halfWidth) * q.t });
} for (const sample of nearest.values())
    if (sample.distance < sample.width + bankMargin)
        level = Math.max(level, sample.water); return level; }
// Continuous world-space relief; shared by collision, worker and water carving.
function reliefNoise(x:number,z:number){
 const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);
 const hash=(a:number,b:number)=>{const n=Math.sin(a*127.1+b*311.7+seed)*43758.5453;return n-Math.floor(n);};
 return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
}
function valleyLandform(x:number,z:number) {
    if (x < -2048 || x > 1120 || z < -1350 || z > 1450) return 0;
    const dx = (reliefNoise(x*.004,z*.004)-.5)*140;
    const dz = (reliefNoise(x*.004+24,z*.004-31)-.5)*120;
    let uplift = 0;
    for (const s of spurAxes) {
        if (Math.abs(x-s.x)>s.width+s.depth || Math.abs(z-s.z)>s.width+s.depth) continue;
        const px=x+dx-s.x,pz=z+dz-s.z;
        const u=(px*s.cos+pz*s.sin)/s.width,v=(-px*s.sin+pz*s.cos)/s.depth;
        const radius=Math.hypot(u,v);
        uplift+=s.height*(1-smooth(.06,1.23,radius))*(1-.23*smooth(.02,.28,Math.abs(u)));
    }
    const striation=reliefNoise((x+dx)*.013,(z+dz)*.022);
    const ledges=smooth(.34,.73,striation)-.42;
    const ravines=1-smooth(.035,.31,Math.abs(2*reliefNoise((x-dz)*.007,(z+dx)*.012)-1));
    const detail=(reliefNoise(x*.061,z*.055)-.5)*4;
    const fade=smooth(-2048,-1770,x)*(1-smooth(805,1120,x))
        *smooth(-1350,-1040,z)*(1-smooth(1250,1450,z));
    return fade*(uplift + Math.min(25,uplift*.25)*(ledges*.72-ravines*.67)+detail);
}
export function landformBaseHeightAt(x: number, z: number) {
    let ridge = 0;
    for (const line of ridgeCurves)
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1], b = line[i], q = distance(x, z, a, b);
            const h = a.h + (b.h - a.h) * q.t;
            ridge = Math.max(ridge, h * Math.exp(-Math.pow(q.d / 230, 1.35)));
        }
    // Macro relief follows ridges. Biomes affect vegetation, not fixed target elevations.
    const valleyDistance = Math.abs(x - riverX(z));
    ridge *= smooth(110, 560, valleyDistance);
    let h = 20 + 260 * (1 - smooth(-2400, -100, z)) + 5 * Math.sin(x / 180 + z / 240) + 3 * Math.sin(x / 55) * Math.cos(z / 83) + ridge;
    const valley = Math.abs(x - riverX(z));
    h += 30 * smooth(100, 700, valley) * (1 - smooth(0, 900, z));
    const mountain=smooth(70,300,ridge)*smooth(100,250,valleyDistance);
    const warp=reliefNoise(x*.004,z*.004)*65;
    h+=mountain*((reliefNoise((x+warp)*.012,z*.012)-.5)*48+(reliefNoise(x*.035,(z+warp)*.035)-.5)*12);
    // Branching cuts shape the ridge silhouette and continue down its flanks.
    const gullies = Math.abs(2 * reliefNoise((x + warp) * .0065, (z - warp) * .0105) - 1);
    h -= mountain * (1 - smooth(.03, .50, gullies)) * (16 + 28 * smooth(180, 550, ridge));
    const ordinary=h+valleyLandform(x,z);
    const basin=basinInfluence(x,z);
    return peaklandRelief(x,z,basin>0?ordinary+(basinHeight(x,z,waterLevelAt(z))-ordinary)*basin:ordinary);
}
export function rawHeightAt(x: number, z: number) {
    let h = landformBaseHeightAt(x, z);
    const villageDistance=Math.hypot((x-191)/147,(z-230)/141);
    const shelf=1-smooth(.44,1.33,villageDistance);
    h+=(31.5+(x-191)*.032-h)*shelf;
    let lakeInterior = 0;
    for (const lake of lakes) {
        if(lake.id==='southeast-bay'){
            const shore=lakeShoreDistance(lake,x,z);
            if(shore>104)continue;
            const bed=lake.y+(shore<0?-7.4*smooth(0,105,-shore):3.8*smooth(0,26,shore));
            const weight=1-smooth(19,104,shore);
            h=h*(1-weight)+bed*weight;
            lakeInterior=Math.max(lakeInterior,1-smooth(-16,21,shore));
            continue;
        }
        const nx=(x-lake.x)/lake.rx,nz=(z-lake.z)/lake.rz,r=Math.hypot(nx,nz);
        if(r>=1.7)continue;
        const d=r/lakeShoreScale(lake,Math.atan2(nz,nx)), weight = 1 - smooth(.75, 1.35, d);
        h = h * (1 - weight) + (lake.y - 7 + 4 * d * d) * weight;
        lakeInterior = Math.max(lakeInterior, 1 - smooth(.90, 1.04, d));
    }
    // Break the former round island into a long gravel tongue with a higher
    // core. The existing river still carves the channel through the basin.
    const islandX=x-424,islandZ=z-1105;
    const islandU=islandX*.81+islandZ*.586,islandV=-islandX*.586+islandZ*.81;
    h+=23*Math.exp(-((islandU/112)**2+((islandV+.0017*islandU**2)/56)**2));
    h+=5.3*Math.exp(-(((x-475)/46)**2+((z-1154)/23)**2));
    const isleX=x-bayPavilionIsland.x,isleZ=z-bayPavilionIsland.z;
    const isleU=isleX*.773+isleZ*.635,isleV=-isleX*.635+isleZ*.773;
    h+=21*Math.exp(-((isleU/66)**2+((isleV+.0027*isleU**2)/35)**2));
    // Evaluate each river once at its nearest segment; adjacent samples must not repeatedly excavate the same bank.
    const nearest=new Map<string,{a:RiverPoint;b:RiverPoint;d:number;t:number}>();
    for(const {id,a,b} of riverSamplesAt(x,z)){const q=distance(x,z,a,b);if(q.d<(nearest.get(id)?.d??Infinity))nearest.set(id,{a,b,...q});}
    // Carve last, using the exact samples that create the visible water ribbons.
    const uncarved=h;let channel=Infinity;
    for (const [id,{ a, b, d, t }] of nearest) {
        h=uncarved;
        const w = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
        if (d > w * 5)
            continue;
        const water = a.waterLevel + (b.waterLevel - a.waterLevel) * t, depth = water - (a.bedLevel + (b.bedLevel - a.bedLevel) * t);
        const across = d / w;
        const bankShape = smooth(1, 1 + riverBankOverlap, across);
        const bankHeight = 1.35 + 3.5 * reliefNoise(x * .033, z * .033);
        const bed = across <= 1 ? water - depth * (1 - across ** 2) : water + bankShape * bankHeight;
        // Carry both banks above the waterline before blending into the hillside.
        // Omit the raised shoulder where a stream feeds into a lake.
        const outerBlend = smooth(1 + riverBankOverlap, 5, across);
        const bank = bed + Math.max(0, h - bed) * smooth(1, 3.5, across);
        const support = across <= 1 ? bed : bank;
        let shaped = support * (1 - outerBlend) + h * outerBlend;
        const gorge=id==='main'?gorgeInfluence(z):0;
        if(gorge>0&&across>1){
            const ledge=bed+Math.max(0,h-bed)*smooth(1.19,2.25,across);
            shaped+=(ledge-shaped)*gorge;
        }
        h = shaped + (Math.min(shaped, uncarved) - shaped) * lakeInterior;
        channel=Math.min(channel,h);
    }
    return Number.isFinite(channel)?channel:uncarved;
}
export const geographyGLSL = `float mapUplift(float z){return 170.*(1.-smoothstep(-2300.,-350.,z));}float mapWaterLevel(float z){${knots.slice(1).map((p, i) => `if(z<=${p[0].toFixed(1)})return mix(${knots[i][1].toFixed(1)},${p[1].toFixed(1)},clamp((z-(${knots[i][0].toFixed(1)}))/${(p[0] - knots[i][0]).toFixed(1)},0.,1.));`).join('')}return 1.;}float mapRelief(vec2 p,float h){return h;}`;
