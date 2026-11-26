import {WorldPlan} from './world-plan';
import {peakland} from './peakland-plan';
export interface Region {
    id: string;
    name: string;
    subtitle: string;
    x: number;
    z: number;
    color: string;
    arrival: [
        number,
        number,
        number
    ];
}
export const mapBounds = WorldPlan.bounds;
export const regions: Region[] = [
    { id: 'village', name: '长风乡', subtitle: '溪谷草甸 · 石拱桥', x: 80, z: 180, color: '#d9ca8f', arrival: [95, 48, 250] },
    { id: 'snow', name: '霁雪天阶', subtitle: '雪岭山道 · 双层飞瀑', x: 20, z: -1680, color: '#d3ecf5', arrival: [130, 390, -1410] },
    { id: 'sakura', name: '绯樱台', subtitle: '樱林童话村 · 蘑菇屋与卷顶茅屋', x: 690, z: -460, color: '#efb2ce', arrival: [580, 200, -270] },
    { id: 'autumn', name: '丹枫峡', subtitle: '赤金枫林 · 山脊栈道', x: -740, z: -470, color: '#e5a460', arrival: [-650, 170, -260] },
    { id: 'bamboo', name: '听竹泽', subtitle: '竹海湿地 · 林间小径', x: -640, z: 620, color: '#9ac49b', arrival: [-560, 130, 810] },
    { id: 'lake', name: '镜潮湾', subtitle: '湖湾群岛 · 南岸草甸', x: 170, z: 1080, color: '#91d3d3', arrival: [180, 135, 1380] },
    { id: 'sky', name: '浮岚群屿', subtitle: '东麓上空 · 悬岛花甸', x: 1570, z: -1150, color: '#d7cbf1', arrival: [1675, 605, -870] },
    { id: peakland.id, name: peakland.name, subtitle: '石柱峰林 · 云峡石桥 · 峰顶道观', ...peakland.center, color: '#a2d3b9', arrival: peakland.arrival },
];
export const floatingIslands = [
    { x: 1570, z: -1150, y: 520, r: 105, phase: .3 },
    { x: 1440, z: -900, y: 430, r: 56, phase: 2.5 },
    { x: 1830, z: -1330, y: 640, r: 72, phase: 4.2 },
    { x: 1800, z: -1010, y: 505, r: 35, phase: 1.4 },
];
export type FloatingIsland = typeof floatingIslands[number];
export const islandSides = 72, islandTopRings = 8;
export const islandLayers = Array.from({length: 37}, (_, i) => {
    const t = i / 36;
    return { depth: t * 1.02, radius: (1 - t ** 1.32) ** .64 };
});

export function islandLayerRadius(island: FloatingIsland, angle: number, depth: number, scale: number) {
    const shape = 1 + .085*Math.sin(angle*3+island.phase) + .053*Math.cos(angle*5-island.phase)
        + .026*Math.sin(angle*11+island.phase) + .016*Math.cos(angle*17+depth*2.9);
    const rockSpurs = depth * (.36*Math.sin(angle+island.phase) + .17*Math.cos(angle*4+island.phase) + .11*Math.sin(angle*8-depth*3));
    const erosion = .06*Math.sin(depth*8+angle*3+island.phase)*Math.sin(Math.PI*depth/1.02);
    return island.r * scale * (shape + rockSpurs + erosion);
}

export function islandRimRadius(island: FloatingIsland, angle: number) {
    const tau = Math.PI*2, step = tau/islandSides;
    const normalized = (angle+tau)%tau, a = Math.floor(normalized/step)*step;
    const f = normalized-a;
    const r0 = islandLayerRadius(island,a,0,1), r1 = islandLayerRadius(island,a+step,0,1);
    return r0*r1*Math.sin(step)/(r1*Math.sin(step-f)+r0*Math.sin(f));
}

export function islandTop(x: number, z: number, island: FloatingIsland) {
    const dx = (x-island.x)/island.r, dz = (z-island.z)/island.r;
    return island.y + island.r*(.048*(1-dx*dx-dz*dz) + .030*Math.sin(dx*4+island.phase)*Math.cos(dz*3) + .022*Math.cos(dz*6+dx*2));
}

export function islandRockHeight(island: FloatingIsland, depth: number, angle: number) {
    if (depth >= .25) return island.y - depth * island.r;
    const r = islandLayerRadius(island,angle,0,1);
    const rim = islandTop(island.x+Math.cos(angle)*r,island.z+Math.sin(angle)*r,island)-island.y;
    const t = depth/.25;
    return island.y-depth*island.r+rim*(1-t*t*(3-2*t));
}

export function islandSurfaceAt(x: number, z: number, island: FloatingIsland) {
    const tau = Math.PI*2, theta = (Math.atan2(z-island.z,x-island.x)+tau)%tau;
    const sector = Math.floor(theta/tau*islandSides);
    const dist = Math.hypot(x-island.x,z-island.z)/island.r;
    const j = Math.min(islandTopRings-1,Math.floor(dist*islandTopRings));
    const vertex = (ring: number, i: number) => {
        const angle = i/islandSides*tau, r = islandLayerRadius(island,angle,0,ring/islandTopRings);
        const px = island.x+Math.cos(angle)*r, pz = island.z+Math.sin(angle)*r;
        return { x: px, z: pz, y: islandTop(px,pz,island) };
    };
    for (let row = Math.max(0,j-2); row <= Math.min(islandTopRings-1,j+2); row++) {
        const a=vertex(row,sector), b=vertex(row,sector+1), c=vertex(row+1,sector), d=vertex(row+1,sector+1);
        for (const [v0,v1,v2] of [[a,b,c],[b,d,c]]) {
            const denominator = (v1.z-v2.z)*(v0.x-v2.x)+(v2.x-v1.x)*(v0.z-v2.z);
            if (Math.abs(denominator)<1e-9) continue;
            const u=((v1.z-v2.z)*(x-v2.x)+(v2.x-v1.x)*(z-v2.z))/denominator;
            const v=((v2.z-v0.z)*(x-v2.x)+(v0.x-v2.x)*(z-v2.z))/denominator, w=1-u-v;
            if (u>=-.0001&&v>=-.0001&&w>=-.0001) return u*v0.y+v*v1.y+w*v2.y;
        }
    }
    return islandTop(x,z,island);
}

export function islandRadiusAt(island: FloatingIsland, y: number, angle: number) {
    if (y >= islandRockHeight(island,0,angle)) return islandLayerRadius(island,angle,0,1);
    if (y < island.y-island.r*islandLayers.at(-1)!.depth) return 0;
    const index = islandLayers.findIndex(layer => islandRockHeight(island,layer.depth,angle) <= y);
    const a = islandLayers[index-1], b = islandLayers[index];
    const ya = islandRockHeight(island,a.depth,angle), yb = islandRockHeight(island,b.depth,angle);
    const t = (ya-y)/(ya-yb);
    const from = islandLayerRadius(island,angle,a.depth,a.radius);
    return from + (islandLayerRadius(island,angle,b.depth,b.radius)-from)*t;
}
export function floatingFloor(x: number, z: number, y: number) { let floor = -Infinity; for (const island of floatingIslands) {
    const dx = x-island.x, dz = z-island.z;
    if (Math.hypot(dx,dz) < islandRimRadius(island,Math.atan2(dz,dx)) && y >= islandSurfaceAt(x, z, island) - .6)
        floor = Math.max(floor, islandSurfaceAt(x, z, island));
} return floor; }
export function regionAt(x: number, z: number) {
    if (x >= peakland.arrival[0]-8 && z < -865) return regions.find(r => r.id === peakland.id)!;
    return regions.reduce((a, b) => Math.hypot(x - a.x, z - a.z) < Math.hypot(x - b.x, z - b.z) ? a : b);
}

/** Normalized distance from the centre of 听竹泽 (< 1 is inside the Bamboo Sea). */
export function bambooSeaRadius(x: number, z: number) {
    return Math.hypot((x + 640) / 320, (z - 620) / 290);
}
