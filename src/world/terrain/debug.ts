import * as T from 'three';
import { WorldPlan } from '../geo/world-plan';
import { heightAt } from '../geo/height';
import type { Terrain } from './terrain';
import type { RoadNetwork } from '../biomes/roads';
export class GeographyDebug extends T.Group {
    private terrain?: Terrain;
    private roads?: RoadNetwork;
    private mode = 'off';
    private boundaries = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    private signature = '';
    private panel?: HTMLElement;
    private key = (e: KeyboardEvent) => { if (e.code === 'F3') {
        e.preventDefault();
        const modes = ['off', 'height', 'slope', 'contours', 'network'];
        this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
    } };
    constructor() { super(); this.visible = false; if (!import.meta.env.DEV)
        return; for (const river of WorldPlan.RiverNetwork)
        for (const side of [-1, 0, 1]) {
            const points = river.samples.map(p => new T.Vector3(p.x - p.flowZ * p.halfWidth * side, p.waterLevel + 2, p.z + p.flowX * p.halfWidth * side));
            this.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: side ? 0x62dcff : 0xffffff, depthTest: false })));
        } this.add(this.boundaries); window.addEventListener('keydown', this.key); }
    bind(terrain: Terrain, roads: RoadNetwork) { if (!import.meta.env.DEV)
        return; this.terrain = terrain; this.roads = roads; const div = document.createElement('div'); div.style.cssText = 'position:fixed;left:26px;top:230px;z-index:8;background:#153846de;color:#fff4d5;padding:8px 12px;border-radius:8px;border:1px solid #ebd39766;font:11px Microsoft YaHei;pointer-events:auto;display:none'; div.innerHTML = '<label>F3 地理诊断 <select><option value="off">关闭</option><option value="height">高度图</option><option value="slope">坡度图</option><option value="contours">等高线</option><option value="network">河网 / 道路 / LOD</option></select></label>'; div.querySelector('select')!.onchange = e => this.setMode((e.target as HTMLSelectElement).value); document.body.append(div); this.panel = div; }
    setMode(mode: string) { if (!import.meta.env.DEV)
        return; this.mode = mode; this.visible = mode !== 'off'; this.roads?.setDebug(mode !== 'off'); if (this.terrain) {
        const u = this.terrain.material.userData.uniforms;
        u.uGeoDebug.value = ['off', 'height', 'slope', 'contours'].indexOf(mode);
        if (mode === 'network')
            u.uGeoDebug.value = 0;
    } if (this.panel) {
        this.panel.style.display = mode === 'off' ? 'none' : 'block';
        this.panel.querySelector('select')!.value = mode;
    } }
    update() { if (!this.visible || !this.terrain)
        return; const signature = this.terrain.lod.nodes.map(n=>`${n.x},${n.z},${n.level}`).join(';'); if (signature === this.signature)
        return; this.signature = signature; const pos: number[] = [], colors: number[] = [], palette = [new T.Color('#56ffc6'), new T.Color('#ffe684'), new T.Color('#ef97ff')]; for (const n of this.terrain.lod.nodes) {
        const {x,z,size}=n,corners=[[x,z],[x+size,z],[x+size,z+size],[x,z+size]];
        for (let i = 0; i < 4; i++)
            for (const p of [corners[i], corners[(i + 1) % 4]]) {
                pos.push(p[0], heightAt(p[0], p[1]) + 2, p[1]);
                const color = palette[n.level%palette.length];
                colors.push(color.r, color.g, color.b);
            }
    } this.boundaries.geometry.dispose(); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); this.boundaries.geometry = g; }
    dispose() { window.removeEventListener('keydown', this.key); this.panel?.remove(); this.traverse(o => { if (o instanceof T.Line) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
    } }); }
}
