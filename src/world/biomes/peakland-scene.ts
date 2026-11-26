import * as T from 'three';
import { heightAt, slopeAt } from '../geo/height';
import { HouseGeometry, makeHouseMaterial, masonry } from './house-geometry';
import { peakland, formations, geologyRandom, templeSites, templePaths, templeGrassClearance } from '../geo/peakland-plan';
import { PeakRockField } from './peakland-rock';
import { makePeaklandStone } from '../../rendering/peakland-stone';
import { PeaklandFlora } from '../flora/peakland-flora';
import { addSolid } from '../physics/solid-world';
import { makeStoneBridge } from './stone-bridge';
import type { WindUniforms } from '../flora/vegetation';

const stone = '#9c9581', wood = '#614334', trim = '#a28b5c', wall = '#cfbea1';
const tiles = ['#3b5251','#435958','#3d5155','#405457'];
const roofEdge = '#a18d68';
type Point = [number, number, number];

function reserved(x:number,z:number) {
    return templeGrassClearance(x,z) < 3 ||
        templeSites.some(p=>Math.abs(x-p.x)<p.w/2+7&&Math.abs(z-p.z)<p.d/2+7);
}

function solidBox(owner: T.Group, x: number, z: number, w: number, d: number, bottom: number, top: number, step = false) {
    addSolid(owner, { minX:x-w/2, maxX:x+w/2, minZ:z-d/2, maxZ:z+d/2, minY:bottom, maxY:top, step });
}

function roof(b: HouseGeometry, x: number, y: number, z: number, w: number, d: number, rise: number, ridgeWidth: number) {
    const eave = rise*.26;
    const point = (side: number, across: number, t: number): Point => {
        const hx = T.MathUtils.lerp(w/2, ridgeWidth/2, t), hz = Math.max(.10,d/2*(1-t));
        const perimeter: [number, number][] = [[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]];
        const p = perimeter[side], q = perimeter[(side+1)%4];
        const curve = Math.abs(across*2-1)**5;
        return [x+T.MathUtils.lerp(p[0],q[0],across),y+rise*(.27*t+.73*t**1.75)+eave*curve*(1-t)**2,z+T.MathUtils.lerp(p[1],q[1],across)];
    };
    for (let side = 0; side < 4; side++) {
        const channels = Math.ceil((side % 2 ? d : w) / .84), columns = channels * 6;
        const courses = Math.ceil((side % 2 ? w - ridgeWidth : d) / 2.5), rows = courses * 3;
        const points: Point[] = [], indices: number[] = [];
        for (let row = 0; row <= rows; row++) {
            const t = row / rows;
            for (let col = 0; col <= columns; col++) {
                const p = point(side, col / columns, t);
                const edge = Math.min(1, col / 6, (columns - col) / 6);
                const roll = .15 * Math.sin(Math.PI * (col % 6) / 6) ** 2;
                const lap = row % 3 === 1 ? .045 : 0;
                p[1] += (roll + lap) * edge * (1 - t);
                points.push(p);
                if (row === rows || col === columns) continue;
                const a = row * (columns + 1) + col, c = a + columns + 1;
                indices.push(a, c, a + 1, a + 1, c, c + 1);
            }
        }
        b.face(points, indices, tiles[side], 'tile');
        // Close the eave with a continuous fascia, sharing the tile profile along its upper edge.
        const fascia: Point[] = [], fasciaIndices: number[] = [];
        for (let col = 0; col <= columns; col++) {
            const p = points[col];
            fascia.push(p, [p[0], point(side, col / columns, 0)[1] - .21, p[2]]);
            const a = col * 2;
            if (col < columns) fasciaIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        b.face(fascia, fasciaIndices, roofEdge, 'tile');
        for (let i = 0; i < 12; i++)
            b.beam(point(side,0,i/12),point(side,0,(i+1)/12),.28,.27,roofEdge,'tile');
    }
    b.beam([x-ridgeWidth/2,y+rise,z],[x+ridgeWidth/2,y+rise,z],.4,.36,roofEdge,'tile');
    for (const side of [-1,1]) {
        b.beam([x+side*ridgeWidth*.5,y+rise,z],[x+side*(ridgeWidth*.5+.66),y+rise+.9,z],.23,.28,trim,'tile');
    }
}

function steps(b: HouseGeometry, owner: T.Group, x: number, z: number, w: number, from: number, to: number, length: number, direction: 1|-1) {
    if (to <= from+.03) return;
    const exponent=length>12?2.30:1;
    const count = Math.ceil((to-from)*exponent/.27), tread = length/count;
    const stairY=(t:number)=>T.MathUtils.lerp(from,to,1-(1-t)**exponent);
    let bottom=from;
    for (let i = 0; i < count; i++) {
        const zz = z+direction*(i+.5)*tread;
        const top = stairY((i+1)/count);
        const floor = Math.min(from,heightAt(x,zz))-.35;
        bottom=Math.min(bottom,floor);
        b.box(x,(top+floor)/2,zz,w,top-floor,tread,i%2 ? stone : '#aaa28d','stone');
    }
    // A continuous support surface avoids radius-expanded risers hitting ahead of the feet.
    addSolid(owner,{minX:x-w/2,maxX:x+w/2,minZ:Math.min(z,z+direction*length),maxZ:Math.max(z,z+direction*length),
        minY:bottom,maxY:to,volume:true,step:true,
        roof:(_x,zz)=>stairY(T.MathUtils.clamp((zz-z)*direction/length,0,1))});
}

function shrine(b: HouseGeometry, owner: T.Group, site: typeof templeSites[number]) {
    const {x,z,w,d,h,tiers,open} = site;
    const y = heightAt(x,z), base = y+.65;
    masonry(b,x,z,w+3.4,d+3.5,y-1.43,1.64,stone,3);
    b.box(x,base-.38,z,w+3.58,.12,d+3.68,'#8e8572','stone');
    b.box(x,base-.16,z,w+3.9,.32,d+4,'#b9ae94','stone');
    solidBox(owner,x,z,w+3.9,d+4,y-1.42,base,true);
    const front = z+d/2+2;
    steps(b,owner,x,front+3,w*.34,heightAt(x,front+3),base,3,-1);
    const wallX = w/2-.85, wallZ = d/2-1;
    const bays = w > 30 ? 6 : 4, coreHeight = h*.86;
    for (const side of [-1,1]) for (let i = 0; i < bays; i++) {
        const xx = x+T.MathUtils.lerp(-wallX,wallX,i/(bays-1));
        const zz = z+side*wallZ;
        b.add(new T.CylinderGeometry(.38,.49,h-.65,16).translate(xx,base+(h+.43)/2,zz),wood,'wood');
        b.box(xx,base+.15,zz,1.22,.30,1.22,stone,'stone');
        b.box(xx,base+.37,zz,.94,.14,.94,'#b0a68f','stone');
        b.box(xx,base+h-.75,zz,1.22,.29,1.24,trim,'wood');
        b.box(xx,base+h-.51,zz,1.63,.19,1.69,wood,'wood');
        b.box(xx,base+h-.29,zz,2.06,.25,2.24,trim,'wood');
        for (const corbel of [-1,1]) {
            b.beam([xx,base+h-1.06,zz], [xx+corbel*.82,base+h-.48,zz], .21,.36,wood);
        }
        solidBox(owner,xx,zz,.86,.86,base,base+h);
        if (i < bays-1 && !open) {
            const span = wallX*2/(bays-1), mx = xx+span/2;
            const pane = (i===Math.floor(bays/2)-1 && side===1) ? '#65534a' : '#6d7971';
            b.box(mx,base+coreHeight*.48,zz,span-.16,coreHeight*.96,.38,wall,'plaster');
            b.box(mx,base+coreHeight*.48,zz+side*.22,span*.68,coreHeight*.65,.22,wood,'wood');
            b.box(mx,base+coreHeight*.50,zz+side*.35,span*.58,coreHeight*.56,.11,pane,'wood');
            for (let slat = -2; slat <= 2; slat++)
                b.box(mx+slat*span*.096,base+coreHeight*.50,zz+side*.43,.115,coreHeight*.56,.15,wood,'wood');
            b.box(mx,base+coreHeight*.52,zz+side*.45,span*.61,.16,.15,wood,'wood');
            b.box(mx,base+coreHeight*.20,zz+side*.38,span*.72,.22,.34,trim,'wood');
        }
    }
    for (const side of [-1,1]) {
        b.box(x,base+h-.23,z+side*wallZ,w+.6,.60,.69,wood,'wood');
        b.box(x+side*wallX,base+h-.23,z,.69,.60,2*wallZ-.69,wood,'wood');
        if (!open) {
            const xx = x+side*wallX;
            b.box(xx,base+coreHeight*.48,z,.39,coreHeight*.96,d-2,wall,'plaster');
            b.box(xx+side*.24,base+.52,z,.26,1.04,d-1.8,stone,'stone');
            for (const offset of [-.25, 0, .25])
                b.box(xx+side*.29,base+coreHeight*.49,z+offset*d,.23,coreHeight*.98,.23,wood,'wood');
        }
    }
    if (!open) solidBox(owner,x,z,w-1.4,d-1.56,base,base+coreHeight);
    let yy = base+h*.94;
    for (let tier=0; tier<tiers; tier++) {
        const scale = .69**tier, rise = (w>30 ? 6.5 : 4.8) * scale;
        if (tier > 0) {
            const upperWidth = w*.78*scale, upperDepth = d*.64*scale;
            b.box(x,yy-1.45*scale,z,upperWidth,2.9*scale,upperDepth,wall,'plaster');
            for (const side of [-1,1]) {
                const faceZ = z+side*(upperDepth/2+.09);
                b.box(x,yy-.42*scale,faceZ,upperWidth,.30*scale,.27,wood,'wood');
                for (const bay of [-2,-1,0,1,2]) {
                    const bayX = x+bay*upperWidth/5;
                    b.box(bayX,yy-1.30*scale,faceZ,upperWidth*.15,1.32*scale,.25,wood,'wood');
                    b.box(bayX,yy-1.30*scale,faceZ+side*.135,upperWidth*.105,.90*scale,.09,'#687669','wood');
                }
            }
        }
        roof(b,x,yy,z,(w+5.8)*scale,(d+5.6)*scale,rise,w*(tiers>2 ? .26 : .42)*scale);
        yy += rise+2.2*scale;
    }
    if (tiers>1) b.add(new T.SphereGeometry(.34,8,5).translate(x,yy-1,z),trim,'tile');
}

function paving(b: HouseGeometry, points: {x:number;z:number}[]) {
    for (let i=1; i<points.length; i++) {
        const a = points[i-1], c = points[i], distance = Math.hypot(c.x-a.x,c.z-a.z);
        const n = Math.ceil(distance/2.35), angle = Math.atan2(c.x-a.x,c.z-a.z);
        for (let j=0; j<n; j++) {
            const t = (j+.5)/n, x = T.MathUtils.lerp(a.x,c.x,t), z = T.MathUtils.lerp(a.z,c.z,t);
            if (slopeAt(x,z) > .32) continue;
            const shade = j%3 ? '#a69b84' : '#c1b59b';
            const setback = j === 0 || j === n-1 ? .34 : .06;
            b.add(new T.BoxGeometry(4.9,.14,distance/n-setback).rotateY(angle).translate(x,heightAt(x,z)-.015,z),shade,'stone');
        }
    }
}


function mist(owner: T.Group, time: { value: number }) {
    // 1) Terrain-feathered undulating sea-of-clouds deck in the deep gorge (zero hard slope seams).
    const seaX = 2880, seaY = 258, seaZ = -1520;
    const seaGeo = new T.PlaneGeometry(2600, 1900, 40, 30).rotateX(-Math.PI / 2);
    const seaPos = seaGeo.getAttribute('position');
    const clearance = new Float32Array(seaPos.count);
    for (let i = 0; i < seaPos.count; i++) {
        const wx = seaPos.getX(i) + seaX;
        const wz = seaPos.getZ(i) + seaZ;
        clearance[i] = seaY - heightAt(wx, wz);
    }
    seaGeo.setAttribute('aClearance', new T.BufferAttribute(clearance, 1));
    const seaMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide,
        uniforms: { uTime: time },
        vertexShader: `attribute float aClearance;
            varying vec3 vWorld;
            varying float vClearance;
            uniform float uTime;
            void main() {
                vec4 p = modelMatrix * vec4(position, 1.);
                float lift = sin(p.x * .0055 + p.z * .0042 + uTime * .11) * 18.
                           + cos(p.z * .0078 - p.x * .0095 - uTime * .08) * 12.;
                p.y += lift;
                vWorld = p.xyz;
                vClearance = aClearance + lift;
                gl_Position = projectionMatrix * viewMatrix * p;
            }`,
        fragmentShader: `varying vec3 vWorld;
            varying float vClearance;
            uniform float uTime;
            float hash(vec2 p){ return fract(sin(dot(p, vec2(123.34, 345.65))) * 43758.5453); }
            float noise(vec2 p){
                vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
                return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
                           mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y);
            }
            void main() {
                if (vClearance < -22.) discard;
                float gate = smoothstep(1540., 2020., vWorld.x) * (1. - smoothstep(3920., 4220., vWorld.x))
                    * smoothstep(-2420., -2160., vWorld.z) * (1. - smoothstep(-940., -580., vWorld.z));
                if (gate < .008) discard;
                vec2 drift = vec2(uTime * 2.4, -uTime * 1.25);
                vec2 p = vWorld.xz + drift;
                vec2 warp = vec2(noise(p * .0026 + 3.1), noise(p * .0029 + 11.7)) * 210.;
                float a = noise((p + warp) * .0042);
                float b = noise((p - warp * .45) * .012 + 6.4);
                float c = noise(p * .028 - 8.1);
                float billow = .52 * a + .34 * b + .14 * c;
                // Feather out smoothly wherever the deck approaches valley slopes.
                float shoreFeather = smoothstep(-6., 42., vClearance + (billow - .45) * 28.);
                float d = length(cameraPosition - vWorld);
                float alpha = smoothstep(.30, .74, billow) * shoreFeather * gate * smoothstep(22., 95., d) * .84;
                if (alpha < .01) discard;
                vec3 trough = vec3(.66, .82, .94);
                vec3 crest = vec3(1.0, .995, .98);
                vec3 col = mix(trough, crest, smoothstep(.34, .76, billow));
                gl_FragColor = vec4(col, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const sea = new T.Mesh(seaGeo, seaMat);
    sea.position.set(seaX, seaY, seaZ);
    sea.renderOrder = 1;
    sea.name = 'peakland-cloud-sea';
    owner.add(sea);

    // 2) Instanced billowing 3D cloud pillows & mist ribbons (lean count to prevent east-flight overdraw).
    const puffCount = 44;
    const puffGeo = new T.PlaneGeometry(1, 1, 4, 4);
    // Dome each cloud puff so it catches sunlit volume from oblique angles.
    const pos = puffGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), v = pos.getY(i);
        pos.setZ(i, (1 - Math.min(1, (u * u + v * v) * 3.4)) * .32);
    }
    puffGeo.rotateX(-Math.PI / 2);

    const puffMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide,
        uniforms: { uTime: time },
        vertexShader: `varying vec2 vUv;
            varying vec3 vWorld;
            varying float vSeed;
            varying float vDome;
            uniform float uTime;
            void main() {
                vUv = uv;
                vDome = position.y;
                vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.);
                vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
                float drift = uTime * (1.8 + vSeed * 2.2);
                world.x += sin(uTime * .08 + vSeed * 6.283) * 38. + mod(drift, 260.) - 130.;
                world.y += sin(uTime * .22 + vSeed * 9.4) * 8.;
                vWorld = world.xyz;
                gl_Position = projectionMatrix * viewMatrix * world;
            }`,
        fragmentShader: `varying vec2 vUv;
            varying vec3 vWorld;
            varying float vSeed;
            varying float vDome;
            uniform float uTime;
            float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p){
                vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
                return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
                           mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y);
            }
            void main() {
                vec2 c = (vUv - .5) * 2.;
                float r2 = dot(c, c);
                if (r2 >= 1.) discard;
                vec3 toCam = cameraPosition - vWorld;
                float camDist = length(toCam);
                if (camDist > 1650.) discard;
                float angleFade = smoothstep(.04, .22, abs(toCam.y) / max(camDist, .001));
                if (angleFade < .01) discard;
                float radial = pow(1. - r2, 1.55);
                vec2 np = vUv * 3.4 + vec2(vSeed * 19. + uTime * .025, vSeed * 7. - uTime * .014);
                float wisp = noise(np) * .64 + noise(np * 2.4 + 4.2) * .36;
                float distFade = smoothstep(22., 95., camDist) * (1. - smoothstep(1250., 1650., camDist));
                float alpha = radial * smoothstep(.20, .74, wisp) * angleFade * distFade * .62;
                if (alpha < .01) discard;
                float lit = clamp(smoothstep(.26, .78, wisp) * (.50 + .50 * radial) + vDome * .65, 0., 1.);
                vec3 shade = mix(vec3(.70, .84, .95), vec3(1.0, .995, .975), lit);
                gl_FragColor = vec4(shade, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });

    const puffs = new T.InstancedMesh(puffGeo, puffMat, puffCount);
    puffs.instanceMatrix.setUsage(T.StaticDrawUsage);
    const dummy = new T.Object3D();
    for (let i = 0; i < puffCount; i++) {
        let x: number, y: number, z: number, sx: number, sz: number, sy: number;
        if (i < 30) {
            const anchor = formations[(i * 7 + 3) % formations.length];
            const a = geologyRandom(i, 401) * Math.PI * 2;
            const spread = 28 + geologyRandom(i, 402) * 145;
            x = T.MathUtils.clamp(anchor.x + Math.cos(a) * spread, 1720, 3920);
            z = T.MathUtils.clamp(anchor.z + Math.sin(a) * spread, -2280, -860);
            y = 240 + geologyRandom(i, 403) * 260;
            sx = 190 + geologyRandom(i, 404) * 250;
            sz = 125 + geologyRandom(i, 405) * 175;
            sy = 34 + geologyRandom(i, 409) * 26;
        } else {
            // Foreground chasm & valley-slope cloud wisps curling softly between the islands and spires.
            const j = i - 30;
            x = 1780 + geologyRandom(j, 421) * 1150;
            z = -1880 + geologyRandom(j, 422) * 920;
            const ground = heightAt(x, z);
            y = Math.max(ground + 16, 248 + geologyRandom(j, 423) * 95);
            sx = 145 + geologyRandom(j, 424) * 195;
            sz = 105 + geologyRandom(j, 425) * 145;
            sy = 28 + geologyRandom(j, 429) * 22;
        }
        dummy.position.set(x, y, z);
        dummy.rotation.set(
            (geologyRandom(i, 406) - .5) * .12,
            geologyRandom(i, 407) * Math.PI * 2,
            (geologyRandom(i, 408) - .5) * .12,
        );
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        puffs.setMatrixAt(i, dummy.matrix);
    }
    puffs.instanceMatrix.needsUpdate = true;
    puffs.computeBoundingSphere();
    puffs.renderOrder = 1.2;
    puffs.name = 'peakland-cloud-ribbons';
    owner.add(puffs);
}

export function populatePeakland(owner: T.Group, time: { value: number }, wind?: WindUniforms) {
    const architecture = makeHouseMaterial(.065);
    for (const [index, site] of templeSites.entries()) {
        const model = new HouseGeometry(88173 + index);
        shrine(model,owner,site);
        const temple = new T.Mesh(model.finish(false).shell, architecture);
        temple.castShadow = temple.receiveShadow = true;
        temple.name = `peakland-temple-${index}`;
        owner.add(temple);
    }
    const ends = peakland.bridge.map(p=>({ ...p,y:heightAt(p.x,p.z)+.03 }));
    const bridge = makeStoneBridge(ends[0],ends[1],4.3,owner,20);
    bridge.group.name = 'peakland-cloud-bridge';
    owner.add(bridge.group);
    const b = new HouseGeometry(88200);
    for (const path of templePaths) paving(b,path);
    steps(b,owner,2504,-1506,4.4,heightAt(2504,-1506),heightAt(2504,-1530)+.14,24,-1);
    const courts = new T.Mesh(b.finish(false).shell,architecture);
    courts.receiveShadow = true;
    courts.name = 'peakland-temple-courts';
    owner.add(courts);
    const stone = makePeaklandStone(time);
    owner.add(new PeakRockField(owner, stone));
    owner.add(new PeaklandFlora(reserved, wind));
    mist(owner,time);
}
