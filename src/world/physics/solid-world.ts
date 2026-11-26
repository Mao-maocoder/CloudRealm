/** Static structure collision, independent of render batches. Heightfield stays authoritative for ground. */
interface Vector {
    x: number;
    y: number;
    z: number;
}
interface Solid {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    step?: boolean;
    radius?: number;
    radiusAt?: (y: number, angle: number) => number;
    volume?: boolean;
    thickness?: number;
    contains?: (x: number, z: number, margin?: number) => boolean;
    pushOut?: (x: number, z: number, radius: number) => { x: number; z: number; nx: number; nz: number } | undefined;
    roof?: (x: number, z: number) => number;
    underside?: (x: number, z: number) => number;
    rock?: {
        floor(x: number, z: number, fromY: number): number;
        contact(x: number, y: number, z: number, margin: number): { x: number; z: number; depth: number } | undefined;
    };
}
const owned = new Map<object, Solid[]>(), cells = new Map<string, Solid[]>();
const neighborhoods=new Map<string,Solid[]>();
function rebuild() { cells.clear();neighborhoods.clear(); for (const list of owned.values())
    for (const b of list)
        for (let z = Math.floor(b.minZ / 64); z <= Math.floor(b.maxZ / 64); z++)
            for (let x = Math.floor(b.minX / 64); x <= Math.floor(b.maxX / 64); x++) {
                const key = `${x},${z}`, a = cells.get(key) ?? [];
                a.push(b);
                cells.set(key, a);
            } }
export function addSolid(owner: object, solid: Solid) { neighborhoods.clear();const list = owned.get(owner) ?? []; list.push(solid); owned.set(owner, list); for (let z = Math.floor(solid.minZ / 64); z <= Math.floor(solid.maxZ / 64); z++)
    for (let x = Math.floor(solid.minX / 64); x <= Math.floor(solid.maxX / 64); x++) {
        const key = `${x},${z}`, a = cells.get(key) ?? [];
        a.push(solid);
        cells.set(key, a);
    } }

/** Register an elliptical, domed boulder collider so players and projectiles collide accurately with the stone surface. */
export function addBoulderSolid(owner: object, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, groundY: number) {
    const cx = (minX + maxX) * .5, cz = (minZ + maxZ) * .5;
    const rx = Math.max(.18, (maxX - minX) * .47), rz = Math.max(.18, (maxZ - minZ) * .47);
    const topY = maxY - .03;
    const midY = minY + (topY - minY) * .42;
    const rise = Math.max(.05, topY - midY);
    addSolid(owner, {
        minX, maxX, minY, maxY: topY, minZ, maxZ,
        volume: true,
        step: topY - groundY < .55,
        contains: (x, z, margin = 0) => {
            const dx = (x - cx) / (rx + margin), dz = (z - cz) / (rz + margin);
            return dx * dx + dz * dz <= 1;
        },
        pushOut: (x, z, margin) => {
            const ax = rx + margin, az = rz + margin;
            const ux = (x - cx) / ax, uz = (z - cz) / az;
            const q = Math.hypot(ux, uz);
            if (q >= 1) return undefined;
            const scale = q > 1e-4 ? 1 / q : 1;
            const px = cx + (q > 1e-4 ? ux * scale : 1) * ax;
            const pz = cz + (q > 1e-4 ? uz * scale : 0) * az;
            const gx = (px - cx) / (ax * ax), gz = (pz - cz) / (az * az);
            const gn = Math.max(1e-4, Math.hypot(gx, gz));
            return { x: px, z: pz, nx: gx / gn, nz: gz / gn };
        },
        roof: (x, z) => {
            const dx = (x - cx) / rx, dz = (z - cz) / rz;
            const q = Math.min(1, dx * dx + dz * dz);
            return midY + rise * Math.sqrt(Math.max(.08, 1 - .74 * q));
        },
    });
}
export function releaseSolids(owner: object) {
 const list=owned.get(owner);if(!list)return;owned.delete(owner);neighborhoods.clear();
 const removed=new Set(list),touched=new Set<string>();
 for(const b of list)for(let z=Math.floor(b.minZ/64);z<=Math.floor(b.maxZ/64);z++)for(let x=Math.floor(b.minX/64);x<=Math.floor(b.maxX/64);x++)touched.add(x+','+z);
 for(const key of touched){const keep=(cells.get(key)??[]).filter(s=>!removed.has(s));if(keep.length)cells.set(key,keep);else cells.delete(key);}
}
function nearby(x: number, z: number) { const cx = Math.floor(x / 64), cz = Math.floor(z / 64),key=`${cx},${cz}`,cached=neighborhoods.get(key);if(cached)return cached;const result = new Set<Solid>();for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
        for (const b of cells.get(`${cx + dx},${cz + dz}`) ?? [])
            result.add(b); const array=[...result];neighborhoods.set(key,array);return array; }
export function blocksCreature(x: number, y: number, z: number, radius: number, height: number) {
    for (const b of nearby(x, z)) {
        if (x < b.minX-radius || x > b.maxX+radius || z < b.minZ-radius || z > b.maxZ+radius || y > b.maxY || y+height < b.minY) continue;
        if (b.rock) {
            if (b.rock.contact(x,y+.13,z,radius) || b.rock.contact(x,y+height*.67,z,radius)) return true;
            continue;
        }
        if (b.contains && !b.contains(x, z, radius)) continue;
        const dx = x-(b.minX+b.maxX)*.5, dz = z-(b.minZ+b.maxZ)*.5;
        const extent = b.radiusAt?.(y+height*.5, Math.atan2(dz, dx)) ?? b.radius;
        if (extent !== undefined && Math.hypot(dx, dz) > extent+radius) continue;
        const top = b.roof?.(x, z) ?? b.maxY;
        const bottom = b.underside?.(x, z) ?? (b.roof && !b.volume ? top-(b.thickness ?? .18) : b.minY);
        if (y < top-.1 && y+height > bottom) return true;
    }
    return false;
}
export function structureFloor(x: number, z: number, y: number) { let floor = -Infinity; for (const b of nearby(x, z))
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && (!b.contains || b.contains(x, z)) && (!b.radius || Math.hypot(x - (b.minX + b.maxX) / 2, z - (b.minZ + b.maxZ) / 2) < b.radius)) {
        const h = b.rock?.floor(x,z,y+.6) ?? (b.roof ? b.roof(x, z) : b.maxY);
        if (y >= h - .6)
            floor = Math.max(floor, h);
    } return floor; }
export const playerCollider = { radius: .48, height: 2.3 };
export function resolveStructures(p: Vector, previous: Vector, velocity: Vector, allowStep = false) {
    const { radius, height } = playerCollider;
    for (let repeat = 0; repeat < 2; repeat++)
        for (const b of nearby(p.x, p.z)) {
            if (p.x < b.minX - radius || p.x > b.maxX + radius || p.z < b.minZ - radius || p.z > b.maxZ + radius || p.y>b.maxY+.01 ||p.y+height<b.minY-.01)
                continue;
            if (b.rock) {
                const floor = b.rock.floor(p.x,p.z,previous.y+.11);
                if (p.y < floor && previous.y >= floor-.11) {
                    p.y = floor;
                    velocity.y = Math.max(0,velocity.y);
                }
                const contacts = [b.rock.contact(p.x,p.y+.12,p.z,radius), b.rock.contact(p.x,p.y+height*.54,p.z,radius),
                    b.rock.contact(p.x,p.y+height-.10,p.z,radius)];
                let deepest = contacts[0];
                for (const hit of contacts) if (hit && hit.depth>(deepest?.depth ?? 0)) deepest=hit;
                if (deepest) {
                    p.x+=deepest.x*deepest.depth;
                    p.z+=deepest.z*deepest.depth;
                    const inward=velocity.x*deepest.x+velocity.z*deepest.z;
                    if (inward<0) { velocity.x-=deepest.x*inward; velocity.z-=deepest.z*inward; }
                }
                continue;
            }
            const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, r = b.radiusAt ? b.radiusAt(p.y + height * .5, Math.atan2(p.z - cz, p.x - cx)) : b.radius;
            if (r !== undefined && Math.hypot(p.x - cx, p.z - cz) > r + radius)
                continue;
            if (b.contains && !b.contains(p.x, p.z, radius))
                continue;
            const top = b.roof ? b.roof(p.x, p.z) : b.maxY;
            const bottom = b.underside?.(p.x,p.z) ?? (b.roof && !b.volume ? top - (b.thickness ?? .18) : b.minY);
            if (p.y >= top || p.y + height <= bottom)
                continue;
            if (previous.y >= top - .1) {
                p.y = top;
                velocity.y = Math.max(0, velocity.y);
                continue;
            }
            if (previous.y + height <= bottom + .1) {
                p.y = bottom - height;
                velocity.y = Math.min(0, velocity.y);
                continue;
            }
            if (allowStep && b.step && top - previous.y <= .55 && top >= previous.y - .05) {
                p.y = top;
                velocity.y = Math.max(0, velocity.y);
                continue;
            }
            if (b.pushOut) {
                const hit = b.pushOut(p.x, p.z, radius);
                if (hit) {
                    p.x = hit.x;
                    p.z = hit.z;
                    const into = velocity.x * hit.nx + velocity.z * hit.nz;
                    if (into < 0) {
                        velocity.x -= into * hit.nx;
                        velocity.z -= into * hit.nz;
                    }
                    continue;
                }
            }
            if (b.roof && !b.volume) {
                p.y = bottom - height;
                velocity.y = Math.min(0, velocity.y);
                continue;
            }
            if (r !== undefined) {
                const d = Math.max(.001, Math.hypot(p.x - cx, p.z - cz)), nx = (p.x - cx) / d, nz = (p.z - cz) / d;
                p.x = cx + nx * (r + radius);
                p.z = cz + nz * (r + radius);
                const into = velocity.x * nx + velocity.z * nz;
                if (into < 0) {
                    velocity.x -= into * nx;
                    velocity.z -= into * nz;
                }
                continue;
            }
            const distances = [Math.abs(p.x - (b.minX - radius)), Math.abs(p.x - (b.maxX + radius)), Math.abs(p.z - (b.minZ - radius)), Math.abs(p.z - (b.maxZ + radius))], i = distances.indexOf(Math.min(...distances));
            if (i < 2) {
                p.x = i === 0 ? b.minX - radius : b.maxX + radius;
                velocity.x = 0;
            }
            else {
                p.z = i === 2 ? b.minZ - radius : b.maxZ + radius;
                velocity.z = 0;
            }
        }
}
export function clipStructureCamera(a: Vector, b: Vector) { for (let i = 1; i <= 16; i++) {
    const t = i / 16, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    for (const s of nearby(x, z)) {
        if (x < s.minX - .15 || x > s.maxX + .15 || z < s.minZ - .15 || z > s.maxZ + .15 || y < s.minY - .2 || y > s.maxY + .2 || (s.contains && !s.contains(x, z, .15)))
            continue;
        if (s.rock) {
            if (s.rock.contact(x,y,z,.15)) return Math.max(.06,(i-1)/16);
            continue;
        }
        const radius = s.radiusAt ? s.radiusAt(y, Math.atan2(z - (s.minZ + s.maxZ) / 2, x - (s.minX + s.maxX) / 2)) : s.radius;
        if (radius !== undefined && Math.hypot(x - (s.minX + s.maxX) / 2, z - (s.minZ + s.maxZ) / 2) > radius + .15)
            continue;
        const top = s.roof ? s.roof(x, z) : s.maxY;
        const bottom = s.underside?.(x,z) ?? (s.roof && !s.volume ? top - (s.thickness ?? .18) : s.minY);
        if (y >= bottom - .15 && y <= top + .15)
            return Math.max(.06, (i - 1) / 16);
    }
} return 1; }
