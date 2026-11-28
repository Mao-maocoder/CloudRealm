import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readArtStyle } from '../../config/settings';
import { valleyArtAt } from '../geo/valley-art';
import { heightAt, randomAt } from '../geo/height';
import { addSolid } from '../physics/solid-world';

type Point = Pick<T.Vector3, 'x' | 'y' | 'z'>;
type Vertex = [number, number, number];
type Profile = (x: number) => number;

class Masonry {
    private positions: number[] = [];
    private colors: number[] = [];

    private face(a: Vertex, b: Vertex, c: Vertex, d: Vertex, color: T.Color, shade: number) {
        for (const v of [a, b, c, a, c, d]) {
            this.positions.push(...v);
            this.colors.push(color.r * shade, color.g * shade, color.b * shade);
        }
    }

    prism(x0: number, x1: number, z0: number, z1: number, lo: Profile, hi: Profile, color: T.Color) {
        const a: Vertex = [x0, lo(x0), z0], b: Vertex = [x0, lo(x0), z1];
        const c: Vertex = [x0, hi(x0), z0], d: Vertex = [x0, hi(x0), z1];
        const e: Vertex = [x1, lo(x1), z0], f: Vertex = [x1, lo(x1), z1];
        const g: Vertex = [x1, hi(x1), z0], h: Vertex = [x1, hi(x1), z1];
        this.face(c,d,h,g,color,1.12);
        this.face(a,e,f,b,color,.69);
        this.face(a,c,g,e,color,.89);
        this.face(b,f,h,d,color,.95);
        this.face(a,b,d,c,color,.93);
        this.face(e,g,h,f,color,.86);
    }

    beam(a: T.Vector3, b: T.Vector3, width: number, color: T.Color) {
        const direction = b.clone().sub(a);
        const block = new T.BoxGeometry(width, direction.length() + .045, width * .82);
        block.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0), direction.normalize()));
        block.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
        const vertices = block.getAttribute('position'), index = block.index!;
        for (let i = 0; i < index.count; i++) {
            const v = index.getX(i);
            this.positions.push(vertices.getX(v),vertices.getY(v),vertices.getZ(v));
            this.colors.push(color.r,color.g,color.b);
        }
        block.dispose();
    }

    finish(roughness: number) {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(this.colors, 3));
        geometry.computeVertexNormals();
        const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness }));
        mesh.castShadow = mesh.receiveShadow = true;
        return mesh;
    }
}

export type BridgeStyle = 'classic' | 'rustic' | 'mountain';

export function makeStoneBridge(
    start: Point,
    end: Point,
    halfWidth: number,
    owner: object,
    foundationDepth = Infinity,
    warmStone = false,
    style: BridgeStyle = 'classic',
) {
    const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz);
    const ux = dx / length, uz = dz / length;
    const rise = style === 'rustic'
        ? T.MathUtils.clamp(length * .105, 2.8, 7.2)
        : T.MathUtils.clamp(length * .116, 3.2, 9.2);
    const base: Profile = x => T.MathUtils.lerp(start.y, end.y, x / length);
    const deck: Profile = x => base(x) + rise * Math.sin(Math.PI * x / length);
    const stationCount = Math.ceil(length / .85), step = length / stationCount;
    const width = halfWidth + .28;
    let foot = Math.min(start.y, end.y);
    for (let i = 0; i <= stationCount; i++) {
        const x = i * step;
        for (const z of [-width, 0, width])
            foot = Math.min(foot, heightAt(start.x + ux*x - uz*z, start.z + uz*x + ux*z));
    }
    foot = Math.max(foot-.65, Math.min(start.y,end.y)-foundationDepth);
    const crown = deck(length / 2) - T.MathUtils.clamp(length * .032, 1.0, 2.8);
    const arch: Profile = x => {
        const t = (x / length - .5) / (style === 'rustic' ? .445 : .425);
        return Math.min(deck(x) - .62, foot + (crown - foot) * Math.sqrt(Math.max(0, 1 - t*t)));
    };
    const sample = (profile: Profile) => {
        const values = Array.from({ length: stationCount + 1 }, (_, i) => profile(i * step));
        return (x: number) => {
            const t = T.MathUtils.clamp(x / step, 0, stationCount);
            const i = Math.min(stationCount - 1, Math.floor(t));
            return T.MathUtils.lerp(values[i], values[i+1], t-i);
        };
    };
    const top = sample(deck), bottom = sample(arch);
    const isGuofengValley = readArtStyle() === 'guofeng' && style !== 'mountain';
    const mortar = new T.Color(isGuofengValley ? '#523b2a' : style === 'rustic' ? '#515e52' : style === 'mountain' ? '#363d44' : warmStone ? '#75685a' : '#414a53');
    const slate = new T.Color(isGuofengValley ? '#5e4532' : style === 'rustic' ? '#8c9487' : style === 'mountain' ? '#6a747e' : warmStone ? '#c3b594' : '#8392a3');
    const moss = new T.Color('#6f8556');
    const paving = new T.Color(isGuofengValley ? '#6f543d' : style === 'rustic' ? '#b8b099' : style === 'mountain' ? '#82878c' : warmStone ? '#d6c2a0' : '#93979c');
    const cedar = new T.Color(isGuofengValley ? '#5a412e' : style === 'rustic' ? '#7b5a3c' : '#834b2e'), stone = new Masonry(), timber = new Masonry();
    if (isGuofengValley) {
        // Reference-matched Arched Timber Bridge adapted for wide river crossings:
        // Mossy stone abutments at both ends + sturdy stone/timber river piers breaking long spans into balanced bays.
        const beamDepth = length > 30 ? 1.02 : .76;
        const abutmentCol = new T.Color('#7a7e76');
        const abutmentDark = new T.Color('#5a605a');
        // 1. Stone bridge abutments anchoring both bank approaches (shortens visual free-span)
        const abutLen = Math.min(length * .14, 6.2);
        for (const [ax0, ax1] of [[0, abutLen], [length - abutLen, length]] as const) {
            stone.prism(ax0, ax1, -(width + .22), width + .22, () => foot - .4, x => top(x) - .10, abutmentCol);
            stone.prism(ax0, ax1, -(width + .30), width + .30, () => foot - .4, x => Math.min(top(x) - .35, foot + 1.4), abutmentDark);
        }
        // 2. Twin mossy stone river piers + angled wooden knee braces for long spans (> 26m)
        const pierFracs = length > 26 ? [0.34, 0.66] : [];
        for (const pf of pierFracs) {
            const px = length * pf;
            // Solid stone river pier rising from riverbed
            stone.prism(px - 1.15, px + 1.15, -(width + .18), width + .18, () => foot - .8, x => top(x) - beamDepth - .35, abutmentCol);
            stone.prism(px - 1.38, px + 1.38, -(width + .32), width + .32, () => foot - .8, () => foot + 1.35, abutmentDark);
            // Twin heavy timber knee braces fanning up from each pier into the arch beams
            for (const side of [-1, 1]) {
                const bz = side * (width - .14);
                const pierTopY = top(px) - beamDepth - .55;
                for (const dir of [-1, 1]) {
                    const bx = px + dir * 3.2;
                    timber.beam(new T.Vector3(px, pierTopY, bz), new T.Vector3(bx, top(bx) - .24, bz), .34, cedar);
                }
            }
        }
        // 3. Twin heavy curved timber arch beams + inner stringer
        for (let i = 0; i < stationCount; i++) {
            const x0 = i * step, x1 = (i + 1) * step;
            for (const side of [-1, 1]) {
                const z0 = side * (width - .36), z1 = side * (width + .08);
                timber.prism(x0, x1, Math.min(z0, z1), Math.max(z0, z1), x => top(x) - beamDepth, x => top(x) - .04, cedar);
            }
            timber.prism(x0, x1, -.30, .30, x => top(x) - beamDepth * .72, x => top(x) - .08, mortar);
        }
        // 4. Transverse weathered timber deck planks with natural wood-tone variation
        const plankCount = Math.ceil(length / .58);
        for (let p = 0; p < plankCount; p++) {
            const x0 = (p + .055) * length / plankCount;
            const x1 = (p + .945) * length / plankCount;
            const tone = .82 + randomAt(p, 7, 511) * .32;
            timber.prism(x0, x1, -(width - .04), width - .04, x => top(x) - .14, top, paving.clone().multiplyScalar(tone));
        }
        // 5. Center verdigris-iron arch bracket plate + twin brass rivets on both sides
        const ironCol = new T.Color('#526761');
        const bronzeCol = new T.Color('#be974f');
        const midX = length * .5;
        for (const side of [-1, 1]) {
            const zOut = side * (width + .11);
            const zIn = side * (width + .03);
            stone.prism(midX - .78, midX + .78, Math.min(zIn, zOut), Math.max(zIn, zOut), x => top(x) - beamDepth - .08, x => top(x) - .02, ironCol);
            for (const dxR of [-.30, .30]) {
                const rz0 = side * (width + .10), rz1 = side * (width + .16);
                stone.prism(midX + dxR - .10, midX + dxR + .10, Math.min(rz0, rz1), Math.max(rz0, rz1), x => top(x) - beamDepth * .58, x => top(x) - beamDepth * .38, bronzeCol);
            }
        }
        // 6. Curved twin wooden handrails + intermediate balusters connecting 6 pairs of carved posts
        const postStations = length > 26 ? [0.02, 0.21, 0.40, 0.60, 0.79, 0.98] : [0.02, 0.34, 0.66, 0.98];
        for (const side of [-1, 1]) {
            const z = side * (halfWidth - .04);
            for (let s = 0; s < postStations.length - 1; s++) {
                const a = length * postStations[s], b = length * postStations[s + 1];
                const subSegs = 4;
                for (let k = 0; k < subSegs; k++) {
                    const x0 = T.MathUtils.lerp(a, b, k / subSegs);
                    const x1 = T.MathUtils.lerp(a, b, (k + 1) / subSegs);
                    timber.beam(new T.Vector3(x0, top(x0) + 1.18, z), new T.Vector3(x1, top(x1) + 1.18, z), .17, cedar.clone().multiplyScalar(1.06));
                    timber.beam(new T.Vector3(x0, top(x0) + .68, z), new T.Vector3(x1, top(x1) + .68, z), .13, cedar);
                }
                const midBal = (a + b) * .5;
                timber.beam(new T.Vector3(midBal, top(midBal) + .04, z), new T.Vector3(midBal, top(midBal) + 1.16, z), .16, cedar);
            }
        }
    } else {
    for (let i = 0; i < stationCount; i++)
        stone.prism(i*step,(i+1)*step,-width,width,bottom,x => top(x)-.085,mortar);

    const courses = Math.max(10, Math.ceil(length / (style === 'rustic' ? 1.45 : 1.7)));
    for (const side of [-1,1]) {
        const inner = side * (width - .13), outer = side * (width + (style === 'rustic' ? .24 : .18));
        const z0 = Math.min(inner,outer), z1 = Math.max(inner,outer);
        for (let i = 0; i < courses; i++) {
            const x0 = (i + .032) * length / courses, x1 = (i + .968) * length / courses;
            const cut: Profile = x => Math.min(top(x)-.24, bottom(x) + .68 + length*.008);
            const blockColor = slate.clone().multiplyScalar(.82 + randomAt(i,side,336)*.34);
            if (style === 'rustic' && randomAt(i, side, 412) > .56) blockColor.lerp(moss, .35);
            stone.prism(x0,x1,z0,z1,x => bottom(x)+.035,cut,blockColor);
        }
        // Stagger the stone joints across the exposed wall above the arch ring.
        const rows = Math.max(3, Math.ceil(rise / (style === 'rustic' ? 1.15 : 1.4)));
        for (let row = 0; row < rows; row++) {
            const seam = row % 2 ? .5 : 0;
            const courseBase: Profile = x => Math.min(top(x)-.24, bottom(x)+.73+length*.008);
            const course: Profile = x => T.MathUtils.lerp(courseBase(x), top(x)-.16, row/rows);
            const next: Profile = x => T.MathUtils.lerp(courseBase(x), top(x)-.16, (row+1)/rows);
            for (let i = -1; i < courses; i++) {
                const x0 = Math.max(0, (i+seam+.028)*length/courses);
                const x1 = Math.min(length, (i+seam+.972)*length/courses);
                if (x1 <= x0 || next((x0+x1)/2)-course((x0+x1)/2) < .12) continue;
                const blockColor = slate.clone().multiplyScalar(.70+randomAt(i,row+side*13,334)*.32);
                if (style === 'rustic' && row === 0 && randomAt(i, side, 419) > .45) blockColor.lerp(moss, .42);
                stone.prism(x0,x1,z0+.035,z1-.035,course,x => next(x)-.048,blockColor);
            }
        }
    }
    // Jointed flagstones. Narrow seams expose the dark bed below each paver.
    const pavingRows = Math.ceil(length / 1.18);
    for (let row = 0; row < pavingRows; row++) {
        const x0 = (row+.022)*length/pavingRows, x1 = (row+.978)*length/pavingRows;
        for (let lane = 0; lane < 5; lane++) {
            const joint = (k: number) => (k/5*2-1)*width + (k === 0 || k === 5 ? 0 : (randomAt(row,k,105)-.5)*.44);
            stone.prism(x0,x1,joint(lane)+.026,joint(lane+1)-.026,x => top(x)-.115,top,paving.clone().multiplyScalar(.78+randomAt(row,lane,108)*.32));
        }
    }
    if (style === 'rustic') {
        // Ghibli-style rustic stone arch: low mossy stone curb + slender curved wooden pole railing.
        const railSections = Math.ceil(length / 2.6);
        for (const side of [-1, 1]) {
            const z = side * (halfWidth - .10);
            const curbZ0 = Math.min(side * (halfWidth - .24), side * (width + .10));
            const curbZ1 = Math.max(side * (halfWidth - .24), side * (width + .10));
            for (let i = 0; i < railSections; i++) {
                const x0 = T.MathUtils.lerp(.25, length - .25, i / railSections);
                const x1 = T.MathUtils.lerp(.25, length - .25, (i + 1) / railSections);
                const curbColor = slate.clone().lerp(moss, randomAt(i, side, 421) * .45).multiplyScalar(.82 + randomAt(i, side, 422) * .26);
                stone.prism(x0 + .04, x1 - .04, curbZ0, curbZ1, u => top(u) - .10, u => top(u) + .24, curbColor);
            }
            for (let i = 0; i <= railSections; i++) {
                const x = T.MathUtils.lerp(.45, length - .45, i / railSections);
                const h = 1.02 + (randomAt(i, side, 425) - .5) * .08;
                const lean = (randomAt(i, side, 426) - .5) * .06;
                timber.beam(new T.Vector3(x, top(x) + .16, z), new T.Vector3(x + lean, top(x) + h, z), .13, cedar);
                if (i < railSections) {
                    const next = T.MathUtils.lerp(.45, length - .45, (i + 1) / railSections);
                    timber.beam(new T.Vector3(x, top(x) + .96, z), new T.Vector3(next, top(next) + .96, z), .13, cedar.clone().multiplyScalar(1.08));
                    timber.beam(new T.Vector3(x, top(x) + .54, z), new T.Vector3(next, top(next) + .54, z), .085, cedar);
                }
            }
        }
    } else if (style === 'mountain') {
        // Mountain stone bridge: solid low stone parapet walls with stepped capstones.
        const segs = Math.ceil(length / 2.2);
        for (const side of [-1, 1]) {
            const z0 = Math.min(side * (halfWidth - .34), side * (width + .06));
            const z1 = Math.max(side * (halfWidth - .34), side * (width + .06));
            for (let i = 0; i < segs; i++) {
                const x0 = T.MathUtils.lerp(.15, length - .15, i / segs);
                const x1 = T.MathUtils.lerp(.15, length - .15, (i + 1) / segs);
                const wallColor = slate.clone().multiplyScalar(.78 + randomAt(i, side, 431) * .28);
                stone.prism(x0 + .03, x1 - .03, z0, z1, u => top(u) - .10, u => top(u) + .74, wallColor);
                stone.prism(x0, x1, z0 - .05, z1 + .05, u => top(u) + .72, u => top(u) + .88, paving.clone().multiplyScalar(.88 + randomAt(i, side, 432) * .20));
            }
        }
    } else {
        const railSections = Math.ceil(length / 3.8);
        for (const side of [-1,1]) {
            const z = side * (halfWidth-.16);
            for (let i = 0; i <= railSections; i++) {
                const x = T.MathUtils.lerp(.32,length-.32,i/railSections);
                const endPier = i === 0 || i === railSections;
                const postHeight = endPier ? 1.40 : 1.1;
                if (endPier) {
                    const x0 = x-.32, x1 = x+.32;
                    stone.prism(x0,x1,z-.33,z+.33,u => top(u)-.23,u => top(u)+postHeight,slate);
                    stone.prism(x0-.06,x1+.06,z-.4,z+.4,u => top(u)+postHeight-.05,u => top(u)+postHeight+.15,paving);
                } else {
                    timber.beam(new T.Vector3(x,top(x)+.03,z),new T.Vector3(x,top(x)+postHeight,z),.22,cedar);
                }
                if (i < railSections) {
                    const next = T.MathUtils.lerp(.32,length-.32,(i+1)/railSections);
                    timber.beam(new T.Vector3(x,top(x)+1.05,z),new T.Vector3(next,top(next)+1.05,z),.22,cedar);
                    timber.beam(new T.Vector3(x,top(x)+.49,z),new T.Vector3(next,top(next)+.49,z),.12,cedar);
                }
            }
        }
    }
    }

    const group = new T.Group();
    group.name = 'stone-arch-bridge';
    group.position.set(start.x, 0, start.z);
    group.rotation.y = -Math.atan2(dz, dx);
    group.add(stone.finish(.92));
    if (style !== 'mountain') group.add(timber.finish(.82));
    if (isGuofengValley && typeof window !== 'undefined') {
        // Attach 1 shared InstancedMesh of Blender-modeled reference-matched posts along arch
        const postStations = length > 26 ? [0.02, 0.21, 0.40, 0.60, 0.79, 0.98] : [0.02, 0.34, 0.66, 0.98];
        const postMatrices: T.Matrix4[] = [];
        const dummy = new T.Object3D();
        for (const frac of postStations) {
            const x = length * frac;
            const y = top(x) - .06;
            const isEnd = frac < 0.05 || frac > 0.95;
            const s = isEnd ? 1.24 : 1.10;
            for (const side of [-1, 1]) {
                dummy.position.set(x, y, side * (halfWidth - .04));
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                postMatrices.push(dummy.matrix.clone());
            }
        }
        void attachGuofengBridgePosts(group, postMatrices);
    }
    const along = (x: number,z: number) => (x-start.x)*ux+(z-start.z)*uz;
    const across = (x: number,z: number) => -(x-start.x)*uz+(z-start.z)*ux;
    addSolid(owner, {
        minX: Math.min(start.x,end.x)-width, maxX: Math.max(start.x,end.x)+width,
        minZ: Math.min(start.z,end.z)-width, maxZ: Math.max(start.z,end.z)+width,
        minY: foot, maxY: Math.max(start.y,end.y)+rise,
        step: true,
        contains: (x,z,margin=0) => along(x,z)>=-margin && along(x,z)<=length+margin && Math.abs(across(x,z))<=width+margin,
        pushOut: (x,z,margin) => {
            const s = along(x,z), t = across(x,z);
            const dSide = width + margin - Math.abs(t);
            const dStart = s + margin;
            const dEnd = length + margin - s;
            if (dSide <= 0 || dStart <= 0 || dEnd <= 0) return;
            if (dSide <= dStart && dSide <= dEnd) {
                const sign = t >= 0 ? 1 : -1;
                const nx = -uz * sign, nz = ux * sign;
                return { x: x + nx * dSide, z: z + nz * dSide, nx, nz };
            }
            if (dStart <= dEnd) {
                return { x: x - ux * dStart, z: z - uz * dStart, nx: -ux, nz: -uz };
            }
            return { x: x + ux * dEnd, z: z + uz * dEnd, nx: ux, nz: uz };
        },
        roof: (x,z) => top(along(x,z)),
        underside: (x,z) => bottom(along(x,z)),
    });
    return { group, length, surface: top, underside: bottom };
}

let bridgePostGeoPromise: Promise<T.BufferGeometry | undefined> | undefined;
function loadBridgePostGeo() {
    if (!bridgePostGeoPromise) {
        const loader = new GLTFLoader();
        const url = new URL('../../../resource/architecture/guofeng_bridge_post.glb', import.meta.url).href;
        bridgePostGeoPromise = loader.loadAsync(url).then(gltf => {
            let geo: T.BufferGeometry | undefined;
            gltf.scene.traverse(o => {
                if (o instanceof T.Mesh && !geo) geo = o.geometry.clone();
            });
            return geo;
        }).catch(err => {
            console.warn('Guofeng bridge post GLB failed to load:', err);
            return undefined;
        });
    }
    return bridgePostGeoPromise;
}

async function attachGuofengBridgePosts(group: T.Group, matrices: T.Matrix4[]) {
    const geo = await loadBridgePostGeo();
    if (!geo || !matrices.length) return;
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: T.DoubleSide });
    const mesh = new T.InstancedMesh(geo, mat, matrices.length);
    mesh.name = 'guofeng-bridge-posts';
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
}
