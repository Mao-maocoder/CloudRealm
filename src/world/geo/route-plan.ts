import { bounds, rawHeightAt, waterLevelAt, waterSurfaceAt, riverX } from './geo-core';
import { ruinCenter } from './valley-landmarks';
import { canyonFootprint } from './canyon-plan';
export const roadNodes = [{ id: 'village', x: 96, z: 192, type: 'Settlement' }, { id: 'sakura', x: 688, z: -464, type: 'Settlement' }, { id: 'snow', x: 128, z: -1568, type: 'Landmark' }, { id: 'autumn', x: -752, z: -480, type: 'Landmark' }, { id: 'pine', x: -800, z: -1136, type: 'Junction' }, { id: 'bamboo', x: -608, z: 656, type: 'Landmark' }, { id: 'lake', x: 760, z: 1050, type: 'Trailhead' }, { id: 'bridge-east', x: riverX(-85) + 46, z: -85, type: 'Bridge' }, { id: 'bridge-west', x: riverX(-85) - 46, z: -85, type: 'Bridge' }, { id: 'exit', x: 1250, z: 1696, type: 'MapExit' }];
export const roadLinks = [['village', 'sakura'], ['village', 'snow'], ['village', 'autumn'], ['autumn', 'pine'], ['pine', 'snow'], ['village', 'bamboo'], ['village', 'lake'], ['sakura', 'lake'], ['lake', 'exit'], ['village','valley-ruin']];
const westBridgePads = [
    {id:'west-creek-lower-south',x:-544,z:-864,type:'Bridge'},
    {id:'west-creek-lower-north',x:-512,z:-896,type:'Bridge'},
    {id:'west-creek-upper-north',x:-736,z:-1056,type:'Bridge'},
    {id:'west-creek-upper-south',x:-768,z:-992,type:'Bridge'},
];
roadNodes.push({id:'valley-ruin',x:ruinCenter.x-16,z:ruinCenter.z+24,type:'Landmark'},...westBridgePads);
roadNodes.push({id:'snow-rim-approach',x:128,z:-1152,type:'Junction'});
const snowRimTrail=[
    {x:113,z:-1222},{x:97,z:-1277},{x:142,z:-1332},{x:145,z:-1373},
    {x:113,z:-1419},{x:126,z:-1460},{x:153,z:-1505},
];
export interface RoutePoint {
    x: number;
    y: number;
    z: number;
    bridge: boolean;
}
export interface Route {
    from: string;
    to: string;
    via: string[];
    points: RoutePoint[];
}
let routes: Route[] | undefined;

type PlanPoint = Pick<RoutePoint, 'x' | 'z'> & { gradeHeight?: number };

function roundRoad(polygon: PlanPoint[]): PlanPoint[] {
    const result = [polygon[0]];
    for (let i = 1; i < polygon.length - 1; i++) {
        const [a, b, c] = polygon.slice(i - 1, i + 2);
        const incoming = Math.hypot(b.x - a.x, b.z - a.z);
        const outgoing = Math.hypot(c.x - b.x, c.z - b.z);
        if (Math.min(incoming, outgoing) < 1) {
            result.push(b);
            continue;
        }
        const ux = (b.x - a.x) / incoming, uz = (b.z - a.z) / incoming;
        const vx = (c.x - b.x) / outgoing, vz = (c.z - b.z) / outgoing;
        const angle = Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
        if (Math.abs(angle) < .01 || Math.abs(angle) > Math.PI - .01) {
            result.push(b);
            continue;
        }
        const side = Math.sign(angle);
        const crossesWater = rawHeightAt(b.x, b.z) < waterSurfaceAt(b.x, b.z) + .5;
        let accepted: PlanPoint[] = [b];
        for (const fraction of [.43, .32, .23, .15, .12, .09]) {
            const trim = Math.min(incoming, outgoing) * fraction;
            const radius = trim / Math.tan(Math.abs(angle) / 2);
            const entry = { x: b.x - ux * trim, z: b.z - uz * trim };
            const cx = entry.x - uz * radius * side, cz = entry.z + ux * radius * side;
            const start = Math.atan2(entry.z - cz, entry.x - cx);
            const count = Math.max(4, Math.ceil(Math.abs(angle) * radius / 2));
            const arc = Array.from({ length: count + 1 }, (_, j) => {
                const t = start + angle * j / count;
                return { x: cx + Math.cos(t) * radius, z: cz + Math.sin(t) * radius };
            });
            const samples = arc.map(p => {
                const ground = rawHeightAt(p.x, p.z), water = waterSurfaceAt(p.x, p.z);
                const wet = ground < water + .5;
                return { ground, wet, height: wet ? water + 2.2 : ground };
            });
            const safe = samples.every((p, j) => {
                if (!crossesWater && p.wet)
                    return false;
                const run = j ? Math.hypot(arc[j].x - arc[j - 1].x, arc[j].z - arc[j - 1].z) : 1;
                return j === 0 || Math.abs(p.height - samples[j - 1].height) <= (crossesWater ? .89 : .82) * run;
            });
            if (safe) {
                accepted = arc;
                break;
            }
            if (crossesWater || fraction > .15 || samples.some(p => p.wet))
                continue;
            // Grade a short, dry corner when its natural surface is too steep for a direct fillet.
            const from = samples[0].ground, rise = samples[count].ground - from;
            if (Math.abs(rise) <= .77 * Math.abs(angle) * radius
                && samples.every((p, j) => Math.abs(p.ground - from - rise * j / count) <= 1.2)) {
                accepted = arc.map((p, j) => ({ ...p, gradeHeight: from + rise * j / count }));
                break;
            }
        }
        result.push(...accepted);
    }
    result.push(polygon.at(-1)!);
    return result;
}
export function plannedRoads() {
    if (routes)
        return routes;
    const step = 32, n = 129, heights = new Float32Array(n * n);
    for (let z = 0; z < n; z++)
        for (let x = 0; x < n; x++)
            heights[z * n + x] = rawHeightAt(bounds.left + x * step, bounds.north + z * step);
    for (const node of roadNodes)
        if (node.type !== 'Bridge') {
            node.x = bounds.left + Math.round((node.x - bounds.left) / 32) * 32;
            node.z = bounds.north + Math.round((node.z - bounds.north) / 32) * 32;
        }
    const fine = new Map<string, number>();
    const sample = (x: number, z: number) => { const k = x + ',' + z; let h = fine.get(k); if (h === undefined) {
        h = rawHeightAt(x, z);
        fine.set(k, h);
    } return h; };
    const key = (p: {
        x: number;
        z: number;
    }) => Math.max(0, Math.min(n - 1, Math.round((p.z - bounds.north) / step))) * n + Math.max(0, Math.min(n - 1, Math.round((p.x - bounds.left) / step)));
    const pos = (i: number) => ({ x: bounds.left + i % n * step, z: bounds.north + Math.floor(i / n) * step });
    function astar(a: typeof roadNodes[number], b: typeof a, dryOnly: boolean) {
        const start = key(a), end = key(b), g = new Float64Array(n * n).fill(Infinity), parent = new Int32Array(n * n).fill(-1), closed = new Uint8Array(n * n), heap: {
            i: number;
            f: number;
        }[] = [];
        const push = (i: number, f: number) => { let j = heap.length; heap.push({ i, f }); while (j > 0) {
            const p = (j - 1) >> 1;
            if (heap[p].f <= f)
                break;
            heap[j] = heap[p];
            j = p;
        } heap[j] = { i, f }; };
        const pop = () => { const first = heap[0], last = heap.pop()!; if (heap.length) {
            let j = 0;
            while (j * 2 + 1 < heap.length) {
                let c = j * 2 + 1;
                if (c + 1 < heap.length && heap[c + 1].f < heap[c].f)
                    c++;
                if (heap[c].f >= last.f)
                    break;
                heap[j] = heap[c];
                j = c;
            }
            heap[j] = last;
        } return first.i; };
        g[start] = 0;
        push(start, 0);
        while (heap.length) {
            const i = pop();
            if (closed[i])
                continue;
            if (i === end)
                break;
            closed[i] = 1;
            const p = pos(i);
            for (let dz = -1; dz <= 1; dz++)
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dz)
                        continue;
                    const x = i % n + dx, z = Math.floor(i / n) + dz;
                    if (x < 0 || x >= n || z < 0 || z >= n)
                        continue;
                    const j = z * n + x;
                    if (closed[j])
                        continue;
                    const q = pos(j), dist = step * Math.hypot(dx, dz), slope = Math.abs(heights[j] - heights[i]) / dist;
                    if (slope > 1.05 || canyonFootprint(q.x,q.z))
                        continue;
                    let valid = true, previous = heights[i], wet = false;
                    for (let k = 1; k <= 8; k++) {
                        const x = p.x + (q.x - p.x) * k / 8, z = p.z + (q.z - p.z) * k / 8, h = sample(x, z), water = waterSurfaceAt(x, z);
                        if (Math.abs(h - previous) / (dist / 8) > .85) {
                            valid = false;
                            break;
                        }
                        previous = h;
                        wet ||= h < water + .5;
                    }
                    if (!valid || (dryOnly && wet))
                        continue;
                    const cost = dist * (1 + 65 * slope * slope + (wet ? 38 : 0));
                    if (g[i] + cost < g[j]) {
                        g[j] = g[i] + cost;
                        parent[j] = i;
                        push(j, g[j] + Math.hypot(q.x - b.x, q.z - b.z));
                    }
                }
        }
        if (start !== end && parent[end] < 0)
            throw new Error(`Road search failed ${a.id} -> ${b.id}`);
        const list = [];
        for (let i = end; i !== -1; i = parent[i]) {
            list.push(pos(i));
            if (i === start)
                break;
        }
        list.reverse();
        list[0] = { x: a.x, z: a.z };
        list[list.length - 1] = { x: b.x, z: b.z };
        return list;
    }
    routes = roadLinks.map(([from, to]) => {
        const a = roadNodes.find(n => n.id === from)!, b = roadNodes.find(n => n.id === to)!;
        const cross = (a.x - riverX(a.z)) * (b.x - riverX(b.z)) < 0;
        const westTrail = from === 'autumn' && to === 'pine';
        const via = westTrail ? westBridgePads.map(p=>p.id)
            : cross ? (a.x > riverX(a.z) ? ['bridge-east', 'bridge-west'] : ['bridge-west', 'bridge-east']) : [];
        if(to==='snow')via.push('snow-rim-approach');
        const stops = [a, ...via.map(id => roadNodes.find(n => n.id === id)!), b], points: RoutePoint[] = [];
        for (let s = 1; s < stops.length; s++) {
            const bridge = westTrail ? s===2||s===4 : cross&&s===2;
            const localTrail = to === 'valley-ruin' && !cross;
            const coarse: PlanPoint[] = bridge ? [stops[s - 1], stops[s]]
                : stops[s-1].id==='snow-rim-approach' ? roundRoad([stops[s-1],...snowRimTrail,stops[s]])
                : localTrail ? roundRoad([a,{x:117,z:235},{x:153,z:244},{x:205,z:251},
                    {x:221,z:270},{x:205,z:315},{x:287,z:327},{x:398,z:268},{x:475,z:234},b])
                : roundRoad(astar(stops[s - 1], stops[s], westTrail));
            for (let i = 1; i < coarse.length; i++) {
                const a = coarse[i - 1], b = coarse[i], count = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
                for (let j = 0; j < count; j++) {
                    const t = j / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
                    const ground = rawHeightAt(x, z), wet = ground < waterSurfaceAt(x, z) + .5;
                    const arch = rawHeightAt(stops[s - 1].x, stops[s - 1].z) * (1 - t) + rawHeightAt(stops[s].x, stops[s].z) * t + 8 * Math.sin(Math.PI * t);
                    const groundGrade = a.gradeHeight === undefined || b.gradeHeight === undefined
                        ? ground : a.gradeHeight + (b.gradeHeight - a.gradeHeight) * t;
                    points.push({ x, z, y: bridge ? arch + .18 : wet ? waterSurfaceAt(x, z) + 2.2 : groundGrade + .18, bridge: bridge || wet });
                }
            }
        }
        points.push({ ...b, y: rawHeightAt(b.x, b.z) + .18, bridge: false });
        // The village crossing begins on the dry shoulders. Its flared approaches
        // span the flood terrace as part of the same walkable deck.
        if(from==='village'&&(to==='autumn'||to==='bamboo')){
            const terrace=points.filter(p=>p.z>=-29&&p.z<=22&&Math.abs(p.x-p.z-160)<2);
            if(terrace.some(p=>p.bridge)){
                const first=terrace[0],last=terrace.at(-1)!;
                const start=first.y,end=last.y;
                const length=Math.hypot(last.x-first.x,last.z-first.z);
                for(const p of terrace){
                    const t=Math.hypot(p.x-first.x,p.z-first.z)/length;
                    p.bridge=true;
                    p.y=start+(end-start)*t+Math.sin(Math.PI*t)*7.2;
                }
            }
        }
        return { from, to, via, points };
    });
    for (const road of routes) {
        for (let i = 0; i < road.points.length; i++) {
            if (!road.points[i].bridge)
                continue;
            const start = i;
            while (i + 1 < road.points.length && road.points[i + 1].bridge)
                i++;
            const p = road.points[Math.floor((start + i) / 2)], id = 'crossing-' + road.from + '-' + road.to + '-' + start;
            roadNodes.push({ id, x: p.x, z: p.z, type: 'Bridge' });
            road.via.push(id);
        }
    }
    const junctions = new Map<string, {
        x: number;
        z: number;
        dirs: Set<number>;
        owners: Set<number>;
    }>();
    routes.forEach((road, index) => road.points.forEach((p, i) => { const key = p.x.toFixed(3) + ',' + p.z.toFixed(3), entry = junctions.get(key) ?? { x: p.x, z: p.z, dirs: new Set<number>(), owners: new Set<number>() }; entry.owners.add(index); for (const n of [road.points[i - 1], road.points[i + 1]])
        if (n)
            entry.dirs.add(Math.round(Math.atan2(n.z - p.z, n.x - p.x) * 8 / Math.PI)); junctions.set(key, entry); }));
    for (const [key, j] of junctions)
        if (j.owners.size > 1 && j.dirs.size > 2) {
            const id = 'junction-' + key;
            roadNodes.push({ id, x: j.x, z: j.z, type: 'Junction' });
            for (const owner of j.owners)
                routes[owner].via.push(id);
        }
    return routes;
}
export function roadConnectivity() { const roads = plannedRoads(), adj = new Map(roadNodes.map(n => [n.id, new Set<string>()])); for (const r of roads) {
    const ids = [r.from, ...r.via, r.to];
    for (let i = 1; i < ids.length; i++) {
        adj.get(ids[i - 1])!.add(ids[i]);
        adj.get(ids[i])!.add(ids[i - 1]);
    }
} const seen = new Set<string>(), queue = ['village']; while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id))
        continue;
    seen.add(id);
    for (const n of adj.get(id)!)
        queue.push(n);
} return { connected: seen.size === roadNodes.length, unreachable: roadNodes.filter(n => !seen.has(n.id)).map(n => n.id) }; }
