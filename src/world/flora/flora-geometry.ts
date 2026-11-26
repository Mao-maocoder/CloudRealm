import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export type TreeKind = 'sakura' | 'broadleaf' | 'pine';
const up = new T.Vector3(0, 1, 0);
function combine(parts: T.BufferGeometry[]) { const merged = mergeGeometries(parts); if (!merged)
    throw new Error('Flora geometry attributes do not match'); parts.forEach(g => g.dispose()); merged.computeVertexNormals(); return merged; }
/** Curved branch with a genuinely tapered cross-section, rather than a fixed tube. */
function branch(points: T.Vector3[], radius: number, tip: number, segments = 7, sides = 7) {
    const curve = new T.CatmullRomCurve3(points), pos: number[] = [], uv: number[] = [], colors: number[] = [], idx: number[] = [];
    const q = new T.Quaternion();
    for (let j = 0; j <= segments; j++) {
        const t = j / segments, p = curve.getPoint(t);
        q.setFromUnitVectors(up, curve.getTangent(t));
        const r = T.MathUtils.lerp(radius, tip, t ** .8);
        for (let i = 0; i <= sides; i++) {
            const a = i / sides * Math.PI * 2;
            const ridge = 1 + .12 * Math.cos(a * 3 + t * 3) * (1 - t);
            const v = new T.Vector3(Math.cos(a) * r * ridge, 0, Math.sin(a) * r * ridge).applyQuaternion(q).add(p);
            pos.push(v.x, v.y, v.z);
            uv.push(i / sides, t);
            const shade = .78 + .17 * Math.cos(a * 3 + t * 3) ** 2 + .05 * t;
            colors.push(shade, shade * .95, shade * .88);
        }
        if (j < segments)
            for (let i = 0; i < sides; i++) {
                const a = j * (sides + 1) + i;
                idx.push(a, a + sides + 1, a + 1, a + 1, a + sides + 1, a + sides + 2);
            }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}
export function makeTreeTrunk(kind: TreeKind) {
    const h = kind === 'pine' ? 9.5 : kind === 'broadleaf' ? 8.3 : 6.7, parts: T.BufferGeometry[] = [];
    const lean = kind === 'sakura' ? 1.05 : kind === 'pine' ? .32 : .72;
    const spine = [new T.Vector3(0, -.46, 0), new T.Vector3(-.10, h * .27, -.12), new T.Vector3(lean * .50, h * .63, .26), new T.Vector3(lean, h, 0)];
    const trunk = new T.CatmullRomCurve3(spine);
    const trunkSides = kind === 'broadleaf' ? 9 : 7;
    parts.push(branch(spine, kind === 'pine' ? .39 : kind === 'broadleaf' ? .64 : .57, .055, 12, trunkSides));
    const roots = kind === 'broadleaf' ? 6 : 5;
    for (let i = 0; i < roots; i++) {
        const a = i * (Math.PI * 2 / roots) + (i % 2) * .28, x = Math.cos(a), z = Math.sin(a), length = (kind === 'broadleaf' ? 1.24 : 1.03) + .24 * Math.sin(i * 7);
        parts.push(branch([new T.Vector3(0, .82, 0), new T.Vector3(x * .56, .16, z * .56), new T.Vector3(x * length, -.32, z * length)], kind === 'broadleaf' ? .23 : .19, .028, 4, 6));
    }
    const count = kind === 'pine' ? 10 : kind === 'broadleaf' ? 8 : 7;
    for (let i = 0; i < count; i++) {
        const a = i * 2.399 + .3, level = kind === 'pine' ? 3.5 + i * .46 : kind === 'broadleaf' ? 3.1 + (i % 4) * .74 : 2.8 + (i % 4) * .58;
        const r = kind === 'pine' ? 2.65 - i * .15 : kind === 'broadleaf' ? 2.15 + (i % 3) * .68 : 1.7 + (i % 3) * .53;
        const root = trunk.getPoint(Math.min(.92, level / h));
        const end = new T.Vector3(Math.cos(a) * r + lean * .55, kind === 'pine' ? level + .36 : level + (kind === 'broadleaf' ? 2.55 : 2.15), Math.sin(a) * r);
        const bend = root.clone().lerp(end, .54);
        bend.y += kind === 'pine' ? -.28 : .52;
        parts.push(branch([root, bend, end], kind === 'pine' ? .13 : kind === 'broadleaf' ? .23 : .20, .025, 6, 6));
        if (kind !== 'pine') {
            const twig = end.clone().add(new T.Vector3(Math.cos(a + .65) * .88, .82, Math.sin(a + .65) * .88));
            parts.push(branch([bend.clone().lerp(end, .55), end, twig], .085, .014, 3, 5));
        }
    }
    return combine(parts);
}
/** Compact closed clusters with lobed outlines and light-to-dark interior foliage. */
function foliageCluster(rx: number, ry: number, rz: number, seed: number, pine: boolean, sides = 11, rings = 5, tone = 1) {
    const pos: number[] = [], color: number[] = [], idx: number[] = [];
    for (let j = 0; j <= rings; j++)
        for (let i = 0; i <= sides; i++) {
            const a = i / sides * Math.PI * 2, t = j / rings;
            const shell = Math.sin(Math.PI * t), lobe = 1 + .16 * Math.sin(a * 4 + seed + t * 2) + .11 * Math.sin(a * 7 - seed);
            const radius = shell * lobe * (pine ? 1.4 - t * .82 : 1);
            const y = ry * (-Math.cos(Math.PI * t) + .18 * shell * Math.sin(a * 3 + seed));
            pos.push(Math.cos(a) * rx * radius, y, Math.sin(a) * rz * radius);
            const shade = (.48 + .56 * t + .13 * shell * Math.sin(a * 5 + seed + t * 8))*tone;
            color.push(shade*(.87+.13*t), shade, shade * (pine ? 1.07 : 1.03 - .12*t));
            if (j < rings && i < sides) {
                const p = j * (sides + 1) + i;
                if (j < rings - 1) idx.push(p, p + sides + 1, p + sides + 2);
                if (j > 0) idx.push(p, p + sides + 2, p + 1);
            }
        }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(color, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

const valleyTrees = [
    {height:9.0, width:5.3, radius:.57, lean:.9, rise:.58, crown:1.63, spread:.91, arms:7}, // Mature oak
    {height:7.8, width:4.9, radius:.45, lean:2.2, rise:.68, crown:1.38, spread:.47, arms:6}, // Wind-shaped elm
    {height:12.3,width:3.2, radius:.47, lean:.72,rise:.75, crown:1.14, spread:.78, arms:8}, // Tall ash
    {height:6.7, width:2.5, radius:.30, lean:.44,rise:.71, crown:1.01, spread:.86, arms:5}, // Young birch
    {height:8.5, width:4.9, radius:.47, lean:1.1, rise:.55, crown:1.42, spread:.61, arms:7}, // Low river alder
] as const;
export const valleyTreeCount = valleyTrees.length;

// One shared cutout of a painterly leafy spray. Soft overlapping brushstrokes retain airy skylights.
export function makeLeafTexture(blossom = false): T.Texture {
    if (typeof document === 'undefined') {
        const data = new Uint8Array([165, 206, 152, 255]);
        const fallback = new T.DataTexture(data, 1, 1, T.RGBAFormat);
        fallback.needsUpdate = true;
        return fallback;
    }
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d')!;
    let state=5819;
    const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/4294967296);
    for(let i=0;i<44;i++){
        const angle=i*2.39996, radius=Math.sqrt(random())*92;
        const cx=128+Math.cos(angle)*radius, cy=130+Math.sin(angle)*radius*.90;
        const light=random()*.28+(1-cy/256)*.46;
        // Smaller inner painterly anchor dab so outer edges stay lacy & airy with sky gaps
        ctx.fillStyle=blossom?'#ddb8c2':'#96c6a2';
        ctx.beginPath();ctx.ellipse(cx,cy,13,10,angle,0,Math.PI*2);ctx.fill();
        for(let j=0;j<12;j++){
            const a=random()*Math.PI*2, r=4+Math.sqrt(random())*28;
            const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
            const v=Math.min(1,light+random()*.30);
            ctx.fillStyle=blossom
                ? 'rgb('+Math.round(205+50*v)+','+Math.round(150+102*v)+','+Math.round(168+84*v)+')'
                : 'rgb('+Math.round(142+110*v)+','+Math.round(196+58*v)+','+Math.round(148+64*v)+')';
            ctx.beginPath();
            ctx.ellipse(x,y,7.5+random()*9,4.2+random()*4.5,a*.62,0,Math.PI*2);
            ctx.fill();
        }
    }
    const texture=new T.CanvasTexture(canvas);
    texture.colorSpace=T.SRGBColorSpace;
    texture.anisotropy=4;
    return texture;
}

// Convex, overlapping leaf sprays face outwards and upwards around each branch.
function leafSprays(at:T.Vector3,size:number,seed:number,detail:boolean,shade:number,volumeNormals=false) {
    const pos:number[]=[], uv:number[]=[], indices:number[]=[], colors:number[]=[], normals:number[]=[];
    const count=detail?11:7;
    for(let i=0;i<count;i++){
        const a=seed+i*2.39996, level=(i+.5)/count;
        const ring=Math.sqrt(1-level*level);
        const n=new T.Vector3(Math.cos(a)*ring,level,Math.sin(a)*ring);
        const side=new T.Vector3(-Math.sin(a),0,Math.cos(a));
        const lift=side.clone().cross(n).normalize();
        const center=at.clone().addScaledVector(n,size*.79);
        center.y-=size*.24;
        const base=pos.length/3, tone=(.74+.40*level)*shade;
        for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,0]]){
            const vertex=center.clone().addScaledVector(side,x*size*1.18)
                .addScaledVector(lift,y*size*.87).addScaledVector(n,x===0?size*.25:0);
            pos.push(...vertex.toArray());uv.push((x+1)*.5,(y+1)*.5);
            colors.push(tone*(.94+.09*y),tone*(1+.055*y),tone*(1.06-.09*y));
            if(volumeNormals) normals.push(...vertex.clone().sub(at).normalize().toArray());
        }
        for(let j=0;j<4;j++)indices.push(base+j,base+4,base+(j+1)%4);
    }
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    g.setIndex(indices);
    if(volumeNormals)g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
    else g.computeVertexNormals();
    return g;
}

/** Hand-shaped branch scaffold for the two bridge-side silhouettes. */
export function makeBridgeTree(width: number, height: number, spreading: boolean) {
    const p = (x: number, y: number, z: number) => new T.Vector3(x * width, y * height, z * width);
    const trunk = [p(0,-.04,0), p(-.065,.25,.025), p(.035,.47,.045), p(.16,.75,0), p(.23,.95,-.08)];
    const bark = [branch(trunk, spreading ? .63 : .48, .045, 15, 10)];
    const leaves: T.BufferGeometry[] = [];
    const arms = [
        [p(-.05,.27,0), p(-.27,.52,.09), p(-.71,.68,.22)],
        [p(-.02,.36,.04), p(.27,.52,.12), p(.70,.71,.36)],
        [p(.04,.47,.03), p(.30,.61,-.16), p(.55,.79,-.55)],
        [p(.04,.48,.03), p(-.26,.69,-.20), p(-.47,.82,-.49)],
        [p(.10,.58,.01), p(-.02,.75,.21), p(-.29,.92,.55)],
        [p(.16,.73,0), p(.24,.89,-.05), p(.32,.98,-.16)],
    ];
    arms.forEach(([root, joint, tip], i) => {
        if (!spreading && i < 2) tip.y -= .78;
        const thickness = (spreading ? .35 : .26) - i * .028;
        bark.push(branch([root,joint,tip],thickness,.018,8,7));
        const outward = tip.clone().sub(joint).normalize();
        for (let fork = 0; fork < 3; fork++) {
            const lateral = new T.Vector3(-outward.z,0,outward.x).normalize();
            const end = joint.clone().lerp(tip,.57+fork*.19)
                .addScaledVector(lateral,(fork-1)*width*.24);
            end.y += [.72,1.21,.38][fork];
            bark.push(branch([joint, joint.clone().lerp(end,.52), end],thickness*.43,.009,5,5));
            const size = width * [.233,.251,.196][fork];
            leaves.push(leafSprays(end,size,i*4+fork,true,.95+fork*.085,true));
            const skirt = end.clone().addScaledVector(outward,size*.74);
            skirt.y -= .54;
            leaves.push(leafSprays(skirt,size*.69,i*6+fork+31,true,.83+fork*.05,true));
        }
    });
    for (let i=0;i<6;i++) {
        const a=i*2.4, foot=new T.Vector3(Math.cos(a),0,Math.sin(a));
        bark.push(branch([new T.Vector3(0,.68,0),foot.clone().multiplyScalar(.76).setY(.16),
            foot.multiplyScalar(1.35+(i%3)*.24).setY(-.15)],.25,.018,5,7));
    }
    // Keep the crown normals authored in leafSprays through the merge.
    const canopy=mergeGeometries(leaves)!;
    leaves.forEach(leaf=>leaf.dispose());
    return { trunk: combine(bark), canopy };
}
export function makeValleyTree(type: number, detail: boolean) {
    const profile=valleyTrees[type], {height,width,radius,lean,rise,crown,spread,arms}=profile;
    const stem=[new T.Vector3(0,-.24,0),new T.Vector3(-lean*.16,height*.25,.10),
        new T.Vector3(lean*.45,height*.66,-.17),new T.Vector3(lean,height,0)];
    const trunk=new T.CatmullRomCurve3(stem);
    const bark=[branch(stem,radius,.043,detail?10:4,detail?8:5)], foliage: T.BufferGeometry[]=[];
    function tuft(p: T.Vector3, size: number, seed: number, shade: number) {
        foliage.push(leafSprays(p,size,seed,detail,shade));
    }
    if(detail)for(let i=0;i<4;i++){
        const a=i*2.43;
        bark.push(branch([new T.Vector3(0,.58,0),new T.Vector3(Math.cos(a)*radius,.14,Math.sin(a)*radius),
            new T.Vector3(Math.cos(a)*radius*2.05,-.18,Math.sin(a)*radius*2.05)],radius*.39,.021,3,5));
    }
    for(let i=0;i<arms;i++){
        const a=i*2.399+type*.56, side=Math.cos(a);
        const progress=(i+.6)/arms, start=trunk.getPoint(.31+progress*.48);
        const reach=width*(.56+.43*Math.sin((progress*.71+.20)*Math.PI))*(spread+(1-spread)*side);
        const end=new T.Vector3(side*reach+lean*.57,height*(rise+.25*progress),Math.sin(a)*reach*.83);
        const elbow=start.clone().lerp(end,.55).add(new T.Vector3(0,-height*.048,0));
        bark.push(branch([start,elbow,end],radius*(.42-.19*progress),.022,detail?5:2,detail?6:4));
        const size=crown*(1.09+.21*Math.sin(i*5.1));
        tuft(end,size,i+type*11,1);
        if(detail){
            const fork=end.clone().add(new T.Vector3(Math.cos(a+.96)*size*.92,size*(type===4?-.28:.48),Math.sin(a+.96)*size*.88));
            bark.push(branch([elbow.clone().lerp(end,.36),end.clone().lerp(fork,.32),fork],radius*.13,.012,3,5));
            tuft(fork,size*.67,i+type*13+19,.91);
        }
    }
    tuft(stem.at(-1)!,crown*(type===0?1.25:.98),type+21,1.05);
    return {trunk:combine(bark),canopy:combine(foliage)};
}

export function makeValleyShrub() {
    const shoots = [
        [-.64,.28,.24,.46,.82], [.02,.56,.06,.56,1.04], [.58,.30,.26,.44,.94],
        [-.32,.46,-.36,.46,1.06], [.38,.40,-.40,.38,.96], [.08,.24,.58,.36,.86],
        [-.52,.36,-.12,.38,.90], [.44,.48,.02,.42,1.02],
    ];
    const parts = shoots.map(([x,y,z,size,tone],i) =>
        leafSprays(new T.Vector3(x,y,z),size,.7+i*2.399,false,tone,true));
    const mesh = mergeGeometries(parts)!;
    parts.forEach(part=>part.dispose());
    return mesh;
}
export function makeTreeCanopy(kind: TreeKind, detail = true) {
    const parts: T.BufferGeometry[] = [];
    if (kind === 'pine') {
        const step = detail ? 1 : 2;
        for (let i = 0; i < 10; i += step) {
            const a = i * 2.399 + .3, level = 3.5 + i * .46, r = 2.45 - i * .15;
            const end = new T.Vector3(Math.cos(a) * r + .18, level + .48, Math.sin(a) * r);
            const size = (1.18 - i * .055) * (detail ? 1 : 1.26);
            parts.push(leafSprays(end, size, i * 1.9 + 5, false, .82 + (i / 10) * .26, true));
            if (detail && i < 6) {
                const inner = new T.Vector3(Math.cos(a + .5) * r * .52 + .18, level + .62, Math.sin(a + .5) * r * .52);
                parts.push(leafSprays(inner, size * .86, i * 2.7 + 19, false, .78 + (i / 10) * .22, true));
            }
        }
        parts.push(leafSprays(new T.Vector3(.26, 8.95, .04), detail ? 1.05 : 1.2, 41, false, 1.04, true));
        parts.push(leafSprays(new T.Vector3(.32, 9.75, 0), detail ? .76 : .9, 53, false, 1.1, true));
        const canopy = mergeGeometries(parts)!;
        parts.forEach(part => part.dispose());
        return canopy;
    }
    else {
        const blossom = kind === 'sakura';
        const count = blossom ? 12 : 14;
        for (let i = 0; i < count; i += detail ? 1 : 2) {
            const a = i * 2.399;
            const isTop = i < 3;
            const r = isTop ? .42 + i * .34 : 1.65 + (i % 4) * .56;
            const rx = blossom ? 1.02 + (i % 3) * .23 : isTop ? 1.58 - i * .10 : 1.32 + (i % 3) * .30;
            const cy = blossom
                ? 5.1 + (i < 2 ? 2.2 : (i % 4) * .66)
                : 6.2 + (isTop ? 2.75 - i * .22 : (i % 4) * .76);
            const center=new T.Vector3(Math.cos(a)*r+(blossom?.83:.54), cy, Math.sin(a)*r);
            parts.push(leafSprays(center,rx*(detail?1:1.25),i*1.4,detail && !blossom && i < 8,.88+(isTop?.16:(i%4)*.055),true));
        }
        const canopy=mergeGeometries(parts)!;
        parts.forEach(part=>part.dispose());
        return canopy;
    }
}
/** Lush curved, gracefully arching grass/sedge tuft with matte upward-aligned painterly normals. */
export function makeGrassTuft(blades = 7) { const pos: number[] = [], colors: number[] = [], idx: number[] = []; for (let blade = 0; blade < blades; blade++) {
    const a = blade * 2.39996, h = .44 + ((blade * 7) % 11) / 11 * .64, lean = .28 + (blade % 4) * .06, rootX = Math.cos(a) * .16, rootZ = Math.sin(a) * .16;
    const base = pos.length / 3;
    for (let j = 0; j <= 5; j++) {
        const t = j / 5, width = (.034 + .012 * (blade % 3)) * Math.sin(Math.PI * (.08 + .92 * t)) * (1 - t * .45), twist = a + Math.PI / 2 + t * .42;
        for (const side of [-1, 1]) {
            const x = rootX + Math.cos(a) * lean * t * t + Math.cos(twist) * width * side, z = rootZ + Math.sin(a) * lean * t * t + Math.sin(twist) * width * side;
            pos.push(x, h * (t - .22 * t ** 4), z);
            const shade = .78 + .38 * t;
            colors.push(shade * .98, shade * 1.04, shade * .78);
        }
        if (j < 5) {
            const p = base + j * 2;
            idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        }
    }
} const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); g.setIndex(idx); g.computeVertexNormals(); const normals = g.getAttribute('normal'), n = new T.Vector3(); for (let i = 0; i < normals.count; i++) {
    n.set(normals.getX(i) * .20, Math.abs(normals.getY(i)) * .25 + .95, normals.getZ(i) * .20).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
} return g; }

/** Low stylized broadleaf clover / groundcover rosette cluster for rich meadow layering. */
export function makeCloverPatch() {
    const pos: number[] = [], colors: number[] = [], normals: number[] = [], idx: number[] = [];
    const leaves = 13;
    for (let l = 0; l < leaves; l++) {
        const a = l * 2.39996 + .35;
        const dist = l < 3 ? .06 + l * .05 : .18 + ((l * 5) % 7) / 7 * .38;
        const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
        const cy = .05 + (1 - dist * .8) * .11 + (l % 3) * .025;
        const radius = .13 + (l % 4) * .032;
        const tilt = .18 + dist * .35;
        const base = pos.length / 3;
        const tone = .82 + (l % 5) * .06 + (1 - dist) * .08;
        pos.push(cx, cy + .018, cz);
        colors.push(tone * .88, tone * 1.02, tone * .68);
        normals.push(0, 1, 0);
        const segs = 7;
        for (let i = 0; i < segs; i++) {
            const pa = a + i / segs * Math.PI * 2;
            const lobe = .84 + .22 * Math.sin(i / segs * Math.PI * 6);
            const lx = Math.cos(pa) * radius * lobe, lz = Math.sin(pa) * radius * lobe;
            const ly = -Math.cos(pa - a) * radius * tilt * .45;
            pos.push(cx + lx, Math.max(.02, cy + ly), cz + lz);
            colors.push(tone * 1.04, tone * 1.12, tone * .72);
            normals.push(lx * .25, 1, lz * .25);
        }
        for (let i = 0; i < segs; i++) {
            idx.push(base, base + 1 + i, base + 1 + (i + 1) % segs);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    g.setIndex(idx);
    g.normalizeNormals();
    return g;
}

/** Delicate multi-blossom stylized wildflower cluster with slender stems and separated star/daisy petals. */
export function makeBankFlowerCluster() {
    const pos: number[] = [], colors: number[] = [], normals: number[] = [], idx: number[] = [];
    const blooms = 6;
    for (let b = 0; b < blooms; b++) {
        const a0 = b * 2.39996 + .3;
        const r0 = b === 0 ? .04 : .12 + (b % 3) * .09;
        const cx = Math.cos(a0) * r0, cz = Math.sin(a0) * r0;
        const cy = .22 + (b % 4) * .085;
        // Slender crossed green stem beneath each bloom
        const stemW = .012;
        for (const [sx, sz] of [[stemW, 0], [0, stemW]]) {
            const sb = pos.length / 3;
            pos.push(cx * .55 - sx, 0, cz * .55 - sz, cx * .55 + sx, 0, cz * .55 + sz,
                cx - sx * .6, cy, cz - sz * .6, cx + sx * .6, cy, cz + sz * .6);
            colors.push(.22, .48, .18, .22, .48, .18, .34, .64, .22, .34, .64, .22);
            normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            idx.push(sb, sb + 1, sb + 2, sb + 1, sb + 3, sb + 2);
        }
        // Five distinct separated delicate petals (not a solid polygon disc)
        const petals = 5;
        const radius = .072 + (b % 3) * .018;
        for (let p = 0; p < petals; p++) {
            const pa = p / petals * Math.PI * 2 + b * .65;
            const c = Math.cos(pa), s = Math.sin(pa);
            const px = -s * radius * .36, pz = c * radius * .36;
            const pb = pos.length / 3;
            pos.push(cx, cy + .004, cz);
            pos.push(cx + c * radius * .52 + px, cy + .018, cz + s * radius * .52 + pz);
            pos.push(cx + c * radius, cy + .028, cz + s * radius);
            pos.push(cx + c * radius * .52 - px, cy + .018, cz + s * radius * .52 - pz);
            colors.push(1.0, .92, .42, 1.06, 1.06, 1.04, 1.12, 1.12, 1.10, 1.06, 1.06, 1.04);
            normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            idx.push(pb, pb + 1, pb + 2, pb, pb + 2, pb + 3);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    g.setIndex(idx);
    return g;
}
