import { releaseSolids } from '../physics/solid-world';
import * as T from 'three';
import { WorldPlan } from '../geo/world-plan';
import { heightAt } from '../geo/height';
import { makeStoneBridge } from './stone-bridge';
import { bridgeReflectionLayer, mainBridgeZ } from '../geo/bridge-look';
export { roadNodes } from '../geo/route-plan';
const dev = import.meta.env?.DEV === true;
export class RoadNetwork extends T.Group {
    readonly edges: {
        from: string;
        to: string;
        points: T.Vector3[];
        bridges: number;
    }[] = [];
    readonly debugGroup = new T.Group();
    readonly disconnected: string[] = [];
    constructor() {
        super();
        const bridges = new Map<string, ReturnType<typeof makeStoneBridge>>();
        for (const route of WorldPlan.RoadNetwork.routes) {
            const points = route.points.map(p => new T.Vector3(p.x, heightAt(p.x, p.z), p.z));
            for (let i = 0; i < points.length-1; i++) {
                if (!route.points[i].bridge) continue;
                const main = Math.abs(points[i].z - mainBridgeZ) < .001;
                const begin = main ? i : Math.max(0,i-1);
                while (route.points[i+1]?.bridge) i++;
                const end = Math.min(i+1,points.length-1);
                const a = points[begin].clone(), b = points[end].clone();
                const reversed = a.x > b.x || (a.x === b.x && a.z > b.z);
                const [start, finish] = reversed ? [b,a] : [a,b];
                const key = [start.x,start.z,finish.x,finish.z].map(v=>v.toFixed(3)).join(',');
                let bridge = bridges.get(key);
                if (!bridge) {
                    start.y += .045;
                    finish.y += .045;
                    const valleyCrossing=start.x>70&&finish.x<290&&Math.abs(start.z)<150&&Math.abs(finish.z)<150;
                    const style = valleyCrossing ? 'rustic' : main ? 'classic' : 'mountain';
                    bridge = makeStoneBridge(start,finish, valleyCrossing ? 3.8 : main ? 3.4 : 2.7,
                        this,Infinity,valleyCrossing,style);
                    if (main) bridge.group.traverse(object=>object.layers.enable(bridgeReflectionLayer));
                    bridges.set(key,bridge);
                    this.add(bridge.group);
                }
                for (let j = begin; j <= end; j++) {
                    const t = (j-begin)/(end-begin);
                    points[j].lerpVectors(a,b,t);
                    points[j].y = bridge.surface((reversed ? 1-t : t) * bridge.length);
                }
            }
            this.edges.push({ from: route.from, to: route.to, points, bridges: route.points.filter((p, i) => p.bridge && !route.points[Math.max(0, i - 1)].bridge).length });
            if (dev) {
                const line = new T.Line(new T.BufferGeometry().setFromPoints(points.map(p => p.clone().add(new T.Vector3(0, 3, 0)))), new T.LineBasicMaterial({ color: 0xffce69, depthTest: false }));
                line.renderOrder = 20;
                this.debugGroup.add(line);
            }
        }
        const result = WorldPlan.RoadNetwork.validate();
        this.disconnected.push(...result.unreachable);
        if (dev)
            for (const n of WorldPlan.RoadNetwork.nodes) {
                const marker = new T.Mesh(new T.SphereGeometry(9, 8, 6), new T.MeshBasicMaterial({ color: result.unreachable.includes(n.id) ? 0xff2244 : 0x65ffd6, depthTest: false }));
                marker.position.set(n.x, heightAt(n.x, n.z) + 8, n.z);
                this.debugGroup.add(marker);
            }
        this.debugGroup.visible = false;
        this.add(this.debugGroup);
    }
    setDebug(on: boolean) { this.debugGroup.visible = dev && on; }
    dispose() { releaseSolids(this); const materials = new Set<T.Material>(); this.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
    } }); materials.forEach(m => m.dispose()); }
}
