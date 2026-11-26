import { bounds, rawHeightAt, waterSurfaceAt } from './geo-core';
import { plannedRoads } from './route-plan';
export const gridStep = 8;
export const gridWidth = 1 + (bounds.right - bounds.left) / gridStep;
export const gridDepth = 1 + (bounds.south - bounds.north) / gridStep;
let data: Float32Array | undefined;
interface Segment {
    a: {
        x: number;
        y: number;
        z: number;
        bridge: boolean;
    };
    b: Segment['a'];
}
const roadCells = new Map<string, Segment[]>();
function nearbyRoad(x: number, z: number) { return roadCells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []; }
function project(x: number, z: number, s: Segment) { const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (z - s.a.z) * dz) / (dx * dx + dz * dz || 1))); return { t, d: Math.hypot(x - s.a.x - t * dx, z - s.a.z - t * dz) }; }
export function geographyGrid() {
    if (data)
        return data;
    data = new Float32Array(gridWidth * gridDepth);
    for (let z = 0; z < gridDepth; z++)
        for (let x = 0; x < gridWidth; x++)
            data[z * gridWidth + x] = rawHeightAt(bounds.left + x * gridStep, bounds.north + z * gridStep);
    const roads = plannedRoads();
    for (const road of roads)
        for (let i = 1; i < road.points.length; i++) {
            const a = road.points[i - 1], b = road.points[i];
            for (let z = Math.floor((Math.min(a.z, b.z) - 16) / 64); z <= Math.floor((Math.max(a.z, b.z) + 16) / 64); z++)
                for (let x = Math.floor((Math.min(a.x, b.x) - 16) / 64); x <= Math.floor((Math.max(a.x, b.x) + 16) / 64); x++) {
                    const key = `${x},${z}`, list = roadCells.get(key) ?? [];
                    list.push({ a, b });
                    roadCells.set(key, list);
                }
        }
    // Nearest-road grading is a single deterministic pass, not repeated order-dependent blends.
    for (let iz = 0; iz < gridDepth; iz++)
        for (let ix = 0; ix < gridWidth; ix++) {
            const x = bounds.left + ix * gridStep, z = bounds.north + iz * gridStep, i = iz * gridWidth + ix;
            const segments = nearbyRoad(x,z);
            if (!segments.length || data[i] < waterSurfaceAt(x, z) + .6)
                continue;
            let d = Infinity, target = 0;
            for (const segment of segments) {
                if (segment.a.bridge || segment.b.bridge)
                    continue;
                const q = project(x, z, segment);
                if (q.d < d) {
                    d = q.d;
                    target = segment.a.y + (segment.b.y - segment.a.y) * q.t - .18;
                }
            }
            const u = Math.max(0, Math.min(1, (12 - d) / 9)), weight = u * u * (3 - 2 * u);
            data[i] = data[i] * (1 - weight) + target * weight;
        }
    for (const road of roads)
        for (const p of road.points)
            if (!p.bridge)
                p.y = worldHeightAt(p.x, p.z) + .18;
    return data;
}
export function worldHeightAt(x: number, z: number) {
    if (x < bounds.left || x > bounds.right || z < bounds.north || z > bounds.south) return rawHeightAt(x,z);
    const a = geographyGrid(), fx = (x-bounds.left)/gridStep, fz = (z-bounds.north)/gridStep;
    const ix = Math.min(gridWidth-2, Math.floor(fx)), iz = Math.min(gridDepth-2, Math.floor(fz));
    const u = fx-ix, v = fz-iz, i = iz*gridWidth+ix;
    return (a[i]*(1-u)+a[i+1]*u)*(1-v) + (a[i+gridWidth]*(1-u)+a[i+gridWidth+1]*u)*v;
}
export function roadDistanceAt(x: number, z: number) { geographyGrid(); let best = Infinity; for (const s of nearbyRoad(x, z))
    best = Math.min(best, project(x, z, s).d); return best; }
