import * as T from 'three';
import { rivers, lakes, lakeShorePoint, waterfalls, riverBankOverlap } from '../geo/geo-core';
export function riverGeometry(fallsOnly = false) {
    const pos: number[] = [], indices: number[] = [],flow:number[]=[],stream:number[]=[],fade:number[]=[];
    const springs: Array<{ base: number; source: typeof rivers[number]['samples'][number] }> = [];
    for (const river of rivers){
        // Adjacent segments must share their rows, including their tangent at a bend.
        const base=pos.length/3;
        const isTributary = river.id === 'west-creek' || river.id === 'sakura-creek';
        if (!fallsOnly && river.id !== 'main') springs.push({ base, source: river.samples[0] });
        let travel=0;
        const total = river.samples.length - 1;
        for(const [sampleIndex,p] of river.samples.entries()){
        if(sampleIndex){const a=river.samples[sampleIndex-1];travel+=Math.hypot(p.x-a.x,p.z-a.z,p.waterLevel-a.waterLevel);}
        const tEnd = total > 0 ? sampleIndex / total : 0;
        // Smoothly fade tributary ribbon alpha & depress slightly near confluence to eliminate hard seam lines.
        const tribAlpha = isTributary ? 1 - T.MathUtils.smoothstep(tEnd, 0.90, 0.995) : 1;
        const tribDrop = isTributary ? T.MathUtils.smoothstep(tEnd, 0.88, 1.0) * 0.035 : 0;
        for(let j=0;j<=8;j++){
            // The water mesh overlaps the banks so terrain depth defines the visible shore.
            const offset=(j/8*2-1)*p.halfWidth*(1+riverBankOverlap);
            pos.push(p.x-p.flowZ*offset,p.waterLevel-tribDrop,p.z+p.flowX*offset);flow.push(p.flowX,p.flowZ);stream.push(travel,offset);fade.push(tribAlpha);
        }
        }
        for (let i = 1; i < river.samples.length; i++) {
            const a = river.samples[i - 1], b = river.samples[i], isFall = river.id === 'main' && waterfalls.some(f => (a.z + b.z) / 2 >= f.north && (a.z + b.z) / 2 <= f.south);
            if (isFall !== fallsOnly)
                continue;
            const row=base+(i-1)*9;
            for (let j = 0; j < 8; j++)
                indices.push(row + j, row + j + 1, row + 9 + j, row + j + 1, row + 10 + j, row + 9 + j);
        }
    }
    for (const {base, source} of springs) {
        // The distance field already carves a round basin behind the first sample.
        // Cap the water there as well so the creek emerges along a real bank.
        const radius = source.halfWidth * (1 + riverBankOverlap), segments = 16;
        let previous = base;
        for (let i = 1; i <= segments; i++) {
            const angle = Math.PI * i / segments, offset = -radius * Math.cos(angle);
            const upstream = -radius * Math.sin(angle);
            const next = i === segments ? base + 8 : pos.length / 3;
            if (i < segments) {
                pos.push(source.x - source.flowZ * offset + source.flowX * upstream, source.waterLevel,
                    source.z + source.flowX * offset + source.flowZ * upstream);
                flow.push(source.flowX, source.flowZ);
                stream.push(upstream, offset);
                fade.push(1);
            }
            indices.push(base + 4, previous, next);
            previous = next;
        }
    }
    if (!fallsOnly)
        for (const lake of lakes) {
            const base = pos.length / 3;
            pos.push(lake.x, lake.y + .015, lake.z);flow.push(.1,.05);stream.push(lake.z,0);fade.push(1);
            const segments=lake.id==='southeast-bay'?192:96;
            for (let i = 0; i <= segments; i++) {
                const a = i / segments * Math.PI * 2;
                const shore=lakeShorePoint(lake,a,lake.id==='southeast-bay'?24:12);
                pos.push(shore.x,lake.y+.015,shore.z);
                flow.push(-Math.sin(a)*.12,Math.cos(a)*.12);
                stream.push(shore.z,shore.x-lake.x);
                fade.push(1);
                if (i < segments)
                    indices.push(base, base + i + 2, base + i + 1);
            }
        }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('flow',new T.Float32BufferAttribute(flow,2));g.setAttribute('stream',new T.Float32BufferAttribute(stream,2));g.setAttribute('aRiverFade',new T.Float32BufferAttribute(fade,1));g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
}
