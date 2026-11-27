import { Vector3 } from 'three';
import { planHabitatCamps, seedsFor, species, surface, type Habitat, type Species, type SpeciesId } from './wildlife-habitat';
import { heightAt, randomAt, slopeAt, trailDistance } from '../geo/height';
import { waterSurfaceAt } from '../geo/geo-core';
import { regionAt } from '../geo/regions';
import { blocksCreature, clipStructureCamera, playerCollider } from '../physics/solid-world';
import { findWildlifePath, walkEdge, walkHeight } from './wildlife-navigation';
import { BEAST_RANKS, rollBeastRank, type BeastRankDefinition } from '../../player/cultivation';

export type WildlifeState = 'Idle' | 'Roam' | 'Forage' | 'Alert' | 'Flee' | 'Pursue' | 'Return' | 'Attack' | 'Hit' | 'Defeat';
export type WildlifeClip = 'Idle' | 'Walk' | 'Run' | 'Forage' | 'Attack' | 'Hit' | 'Defeat';

export class Creature {
    readonly profile: Species;
    readonly position;
    readonly goal;
    rank: BeastRankDefinition;
    maxHealth: number;
    attackDamage: number;
    health: number;
    ready = false;
    state: WildlifeState = 'Idle';
    since = 0;
    thinkAt = 0;
    attackAt = 0;
    impact = false;
    respawnAt = 0;
    angerUntil = 0;
    attentionUntil = 0;
    fightUntil = 0;
    intimidatedUntil = 0;
    senseMarkedUntil = 0;
    tickAt = 0;
    routeAt = 0;
    route:Vector3[] = [];
    routeGoal = new Vector3();
    speed = 0;
    blocked = 0;
    readonly recoil = new Vector3();
    recoilLeft = 0;
    yaw;
    hunger;
    hunt?: Creature;
    nocturnal = false;
    private draw = 0;

    constructor(readonly id: number, readonly habitat: Habitat, readonly home: Vector3, readonly camp = home, rank: BeastRankDefinition = BEAST_RANKS[0]) {
        this.position = home.clone();
        this.goal = home.clone();
        this.profile = species[habitat.species];
        this.rank = rank;
        this.maxHealth = Math.round(this.profile.health * rank.hpScale);
        this.attackDamage = Math.round(this.profile.damage * rank.dmgScale);
        this.health = this.maxHealth;
        this.yaw = this.random() * 2 * Math.PI;
        this.hunger = .21 + .55 * this.random();
    }

    applyRank(rank: BeastRankDefinition) {
        this.rank = rank;
        this.maxHealth = Math.round(this.profile.health * rank.hpScale);
        this.attackDamage = Math.round(this.profile.damage * rank.dmgScale);
        this.health = this.maxHealth;
    }

    get displayName(): string {
        return `${this.rank.label} · ${this.profile.name}`;
    }

    random() { return randomAt(this.id, this.draw++, 93); }

    get motion(): WildlifeClip {
        switch (this.state) {
            case 'Idle': case 'Forage': case 'Attack': case 'Hit': case 'Defeat': return this.state;
        }
        return this.speed < .05 ? 'Idle' : this.speed > this.profile.walk * 1.18 ? 'Run' : 'Walk';
    }
}

const attackDuration = 26 / 24;
const strikeTime = attackDuration * .52;
const localStep = 1 / 30;
const fullRadius = 60, simulationRadius = 150, cellSize = 128;
const respawnClearance = 39;
const recoilDuration = .24;
const territory = (a: Creature) => Math.max(17, Math.min(45, a.habitat.range * .66));
const flatDistance = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const horizontalHit = (a: Creature, position: Vector3, extra = 0) => Math.abs(position.y - a.position.y) < a.profile.height + extra;
const navigationOffsets = [0, .62, -.62, 1.16, -1.16, 1.85, -1.85];
export interface WildlifeFocus {
    velocity?:Vector3;
    flying?:boolean;
    nightFactor?:number;
    visible?:(position:Vector3, height:number)=>boolean;
}

function bodyOffset(out: Vector3, a: Creature, x: number, z: number, atX: number, atZ: number, yaw = a.yaw) {
    const dx = x - atX, dz = z - atZ;
    const length = a.profile.bodyHalfLength ?? 0;
    const axisX = Math.sin(yaw), axisZ = Math.cos(yaw);
    const along = Math.max(-length, Math.min(length, dx*axisX + dz*axisZ));
    return out.set(dx - axisX*along, 0, dz - axisZ*along);
}

function bodyHeightsOverlap(a: Creature, y: number, playerY: number) {
    return playerY < y + a.profile.height && playerY + playerCollider.height > y;
}

function turnToward(yaw: number, angle: number, limit: number) {
    const delta = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
    return yaw + Math.min(limit, Math.max(-limit, delta));
}

export interface WildlifeSimulationOptions {
    enableRanks?: boolean;
    onDefeat?: (creature: Creature) => void;
}

export interface DivineSensePulseReport {
    detected: number;
    highThreatCount: number;
    suppressedCount: number;
    alertedHighCount: number;
    alertedLeaderName?: string;
}

export class WildlifeSimulation {
    readonly agents: Creature[] = [];
    active: Creature[] = [];
    readonly preload = new Set<SpeciesId>();
    time = 0;
    private readonly cells = new Map<string, ReturnType<typeof planHabitatCamps>[number][]>();
    private readonly visited = new Set<number>();
    private focusAt = 0;
    private searchAt = 0;
    private pressure = 0;
    private respiteUntil = 0;
    private accumulator = 0;
    private readonly probe = new Vector3();
    private readonly rayStart = new Vector3();
    private readonly rayEnd = new Vector3();
    private readonly contact = new Vector3();
    private readonly prediction = new Vector3();
    private readonly enableRanks: boolean;
    private readonly onDefeat?: (creature: Creature) => void;
    private nightFactor = 0;
    private nightSpawnAt = 0;
    private nextNocturnalId = 900000;

    constructor(private playerDamage: (damage: number, attacker: Creature) => void, options: WildlifeSimulationOptions = {}) {
        this.enableRanks = Boolean(options.enableRanks);
        this.onDefeat = options.onDefeat;
        for(const camp of planHabitatCamps()){
            const id=`${Math.floor(camp.center.x/cellSize)},${Math.floor(camp.center.z/cellSize)}`;
            const cell=this.cells.get(id)??[];
            cell.push(camp);
            this.cells.set(id,cell);
        }
    }

    update(dt: number, center: Vector3, player: Vector3 | undefined, limit: number, running = true, playerBody = player, focus:WildlifeFocus = {}) {
        this.focusAt -= dt;
        if (this.focusAt <= 0) {
            this.focusAt = .35;
            this.focus(center, playerBody, limit, focus);
        }
        if (!running) return;
        this.pressure=Math.max(0,this.pressure-dt*.13);
        this.accumulator += dt;
        while (this.accumulator >= localStep) {
            this.accumulator -= localStep;
            this.time += localStep;
            for (const a of this.active) {
                const distance=a.position.distanceToSquared(center);
                const urgent=a.fightUntil>this.time||a.recoilLeft>0||a.state==='Attack';
                if(distance>simulationRadius**2&&!urgent){a.speed=0;continue;}
                const near=distance<=fullRadius**2||urgent;
                if(!near&&this.time<a.tickAt)continue;
                a.tickAt=this.time+(near?0:.25);
                this.step(a,center,player,playerBody,near?localStep:.25);
            }
        }
    }

    refresh() { this.focusAt = 0; }

    resolvePlayer(position: Vector3, previous: Vector3, velocity: Vector3) {
        const { radius, height } = playerCollider;
        for (let pass = 0; pass < 2; pass++) {
            let collided = false;
            for (const a of this.active) {
                if (!a.ready || a.health <= 0 || !bodyHeightsOverlap(a, a.position.y, position.y)) continue;
                const boundary = radius + a.profile.radius;
                const bound = boundary + (a.profile.bodyHalfLength ?? 0);
                if (Math.abs(position.x-a.position.x) >= bound || Math.abs(position.z-a.position.z) >= bound) continue;
                const normal = bodyOffset(this.contact, a, position.x, position.z, a.position.x, a.position.z);
                const distance = normal.length();
                if (distance >= boundary) continue;
                if (distance < .001) {
                    bodyOffset(normal, a, previous.x, previous.z, a.position.x, a.position.z);
                    if (normal.lengthSq() < .000001) normal.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
                }
                normal.normalize();
                const separation = boundary - distance + .004;
                const x = position.x + normal.x*separation, z = position.z + normal.z*separation;
                if (blocksCreature(x, position.y, z, radius, height)) {
                    position.x = previous.x;
                    position.z = previous.z;
                } else {
                    position.x = x;
                    position.z = z;
                }
                const inward = velocity.x*normal.x + velocity.z*normal.z;
                if (inward < 0) velocity.addScaledVector(normal, -inward);
                collided = true;
            }
            if (!collided) break;
        }
    }

    private focus(center: Vector3, player: Vector3 | undefined,limit:number, focus:WildlifeFocus) {
        this.nightFactor = Math.max(0, Math.min(1, focus.nightFactor ?? 0));
        const loadRadius = focus.flying ? 360 : 240;
        const retainRadius = loadRadius + 38;
        const warmRadius = retainRadius + 70;
        const elevationScale = focus.flying ? .49 : .86;
        const predicted=this.prediction.copy(center);
        if(focus.velocity)predicted.addScaledVector(focus.velocity,focus.flying?3.2:2.6);
        const x0=Math.floor((Math.min(center.x,predicted.x)-warmRadius)/cellSize),x1=Math.floor((Math.max(center.x,predicted.x)+warmRadius)/cellSize);
        const z0=Math.floor((Math.min(center.z,predicted.z)-warmRadius)/cellSize),z1=Math.floor((Math.max(center.z,predicted.z)+warmRadius)/cellSize);
        this.preload.clear();
        for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
            for(const { index,habitat,center:camp,homes } of this.cells.get(`${x},${z}`)??[]){
                const range=Math.min(Math.hypot(center.x-camp.x,center.z-camp.z),Math.hypot(predicted.x-camp.x,predicted.z-camp.z));
                const elevation=Math.min(Math.abs(center.y-camp.y),Math.abs(predicted.y-camp.y));
                if(range>warmRadius||elevation*elevationScale>warmRadius)continue;
                this.preload.add(habitat.species);
                if(this.visited.has(index)||Math.hypot(center.x-camp.x,center.z-camp.z)>retainRadius+12)continue;
                const p=species[habitat.species];
                const available=homes.some(h=>blocksCreature(h.x,h.y,h.z,p.radius,p.height))?seedsFor(habitat,index+1):homes;
                if(!available.length)continue;
                this.visited.add(index);
                const anchor=available[0];
                const group=new Vector3(anchor.x,anchor.y,anchor.z);
                for(const [slot,home] of available.entries()){
                    const rank=this.enableRanks?rollBeastRank(habitat.region,habitat.species,Math.random(),this.nightFactor):BEAST_RANKS[0];
                    this.agents.push(new Creature((index+1)*10+slot,habitat,new Vector3(home.x,home.y,home.z),group,rank));
                }
            }
        }

        // Nighttime surge: dynamically spawn extra nocturnal & high-rank beasts near the player
        if (this.enableRanks) {
            if (this.nightFactor >= 0.35 && this.time >= this.nightSpawnAt) {
                this.nightSpawnAt = this.time + Math.max(3.2, 6.5 - this.nightFactor * 3.0);
                this.spawnNocturnalProwlers(center, player, focus);
            } else if (this.nightFactor < 0.25) {
                for (let i = this.agents.length - 1; i >= 0; i--) {
                    const a = this.agents[i];
                    if (!a.nocturnal) continue;
                    const distSq = a.position.distanceToSquared(center);
                    if (a.state === 'Defeat' || (a.fightUntil <= this.time && distSq > 110 ** 2)) {
                        this.agents.splice(i, 1);
                    }
                }
            }
        }

        const previous = new Set(this.active);
        const candidates: { a: Creature; score: number }[] = [];
        const committed:Creature[]=[];
        for (const a of this.agents) {
            if (a.state === 'Defeat') {
                if (a.nocturnal) {
                    if (this.time - a.since >= 3.5) continue;
                } else {
                    if (this.nightFactor >= 0.35) {
                        a.respawnAt = Math.min(a.respawnAt, a.since + a.profile.respawn / (1 + 1.35 * this.nightFactor));
                    }
                    const safe = a.home.distanceToSquared(center) > respawnClearance ** 2 &&
                        (!player || a.home.distanceToSquared(player) > respawnClearance ** 2);
                    if (safe && this.time >= a.respawnAt && !focus.visible?.(a.home,a.profile.height)) this.revive(a);
                    else if (this.time - a.since >= 3.5) continue;
                }
            }
            const distance = Math.hypot(a.position.x-center.x,a.position.z-center.z,(a.position.y-center.y)*elevationScale);
            if(a.ready&&previous.has(a)&&(a.fightUntil>this.time||a.state==='Attack')&&
                (player??center).distanceToSquared(a.position)<96**2){committed.push(a);continue;}
            if (distance > (previous.has(a) ? retainRadius : loadRadius)) continue;
            if(this.time>=this.respiteUntil||previous.has(a))candidates.push({a,score:distance-(previous.has(a)?9:0)});
        }
        this.active = committed.concat(candidates.sort((a,b) => a.score-b.score).slice(0,Math.max(0,limit-committed.length)).map(entry=>entry.a));
        const selected = new Set(this.active);
        for (const a of previous) {
            if (selected.has(a) || a.state === 'Defeat') continue;
            a.hunt = undefined;
            a.thinkAt = 0;
            this.set(a, 'Idle');
        }
    }

    private spawnNocturnalProwlers(center: Vector3, player: Vector3 | undefined, focus: WildlifeFocus) {
        const nocturnalAlive = this.agents.filter(a => a.nocturnal && a.state !== 'Defeat').length;
        const maxNocturnal = Math.round(8 + 8 * this.nightFactor);
        if (nocturnalAlive >= maxNocturnal) return;

        const nocturnalPool: readonly SpeciesId[] = ['wolf', 'mantis', 'stone-boar', 'crystal-boar', 'wolf', 'mantis'];
        const toSpawn = Math.min(2, maxNocturnal - nocturnalAlive);
        const region = regionAt(center.x, center.z).id;

        for (let s = 0; s < toSpawn; s++) {
            const sp = nocturnalPool[Math.floor(Math.random() * nocturnalPool.length)];
            const prof = species[sp];
            this.preload.add(sp);
            for (let attempt = 0; attempt < 12; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 42 + Math.random() * 88;
                const x = center.x + Math.cos(angle) * dist;
                const z = center.z + Math.sin(angle) * dist;
                const y = heightAt(x, z);
                const water = waterSurfaceAt(x, z, .7);
                if (y < water + .35 || slopeAt(x, z) > .48 || trailDistance(x, z) < 3.5) continue;
                if (blocksCreature(x, y, z, prof.radius, prof.height)) continue;
                const pos = new Vector3(x, y, z);
                if (player && pos.distanceToSquared(player) < respawnClearance ** 2) continue;
                if (focus.visible?.(pos, prof.height)) continue;

                const hab: Habitat = {
                    id: `night-${this.nextNocturnalId}`,
                    region,
                    biome: 'forest',
                    species: sp,
                    x,
                    z,
                    count: 1,
                    range: 46,
                };
                const rank = rollBeastRank(region, sp, Math.random(), Math.max(0.65, this.nightFactor));
                const beast = new Creature(this.nextNocturnalId++, hab, pos, pos, rank);
                beast.nocturnal = true;
                this.agents.push(beast);
                break;
            }
        }
    }

    private revive(a: Creature) {
        a.position.copy(a.home);
        a.goal.copy(a.home);
        if (this.enableRanks) {
            a.applyRank(rollBeastRank(a.habitat.region, a.habitat.species, Math.random(), this.nightFactor));
        } else {
            a.health = a.maxHealth;
        }
        a.hunt = undefined;
        a.angerUntil = a.attentionUntil = a.fightUntil = a.intimidatedUntil = a.senseMarkedUntil = 0;
        a.attackAt = a.thinkAt = this.time;
        a.hunger = .2;
        a.blocked = 0;
        a.recoilLeft = 0;
        a.route.length=0;
        this.set(a, 'Idle');
    }

    private set(a: Creature, state: WildlifeState) {
        if (a.state === state) return;
        a.state = state;
        a.since = this.time;
        a.speed = 0;
        a.route.length=0;
        if (state === 'Attack') a.impact = false;
    }

    private step(a: Creature, center: Vector3, player: Vector3 | undefined, playerBody: Vector3 | undefined, dt:number) {
        if (a.recoilLeft > 0) this.knockback(a, playerBody);
        const elapsed = this.time - a.since;
        if (a.state === 'Defeat') return;
        if (a.state === 'Alert' && elapsed < (a.profile.temperament==='ambush'?.25:.45)) return;
        if (a.state === 'Hit' && elapsed < .49) return;
        if (a.state === 'Attack' && elapsed < attackDuration) {
            if (!a.impact && elapsed >= strikeTime) {
                a.impact = true;
                this.strike(a, player);
            }
            return;
        }

        a.hunger = Math.min(1, a.hunger + dt / 95);
        if (this.time >= a.thinkAt || a.state === 'Attack' || a.state === 'Hit') {
            const distance = a.position.distanceTo(center);
            a.thinkAt = this.time + (distance < fullRadius ? .21 : .46) + a.random() * .08;
            this.decide(a, player);
        }

        const state = a.state;
        if (state !== 'Flee' && state !== 'Pursue' && state !== 'Return' && state !== 'Roam') return;
        const speed = state === 'Flee' || state === 'Pursue' ? a.profile.run : a.profile.walk;
        if (flatDistance(a.position, a.goal) <= .65) {
            a.speed = 0;
            if (state === 'Return' || state === 'Roam') a.thinkAt = this.time;
            return;
        }
        this.move(a, speed, playerBody,dt);
    }

    private decide(a: Creature, player: Vector3 | undefined) {
        const p = a.profile;
        const homeDistance = flatDistance(a.home, a.position);
        const playerDistance = player && a.ready && horizontalHit(a, player, 1) ? flatDistance(a.position, player) : Infinity;
        const angry = this.time < a.angerUntil;
        const shy = p.temperament === 'skittish';
        const distanceLimit = territory(a);
        if (this.time < a.intimidatedUntil && player) {
            a.hunt = undefined;
            const angle = Math.atan2(a.position.x - player.x, a.position.z - player.z);
            a.goal.copy(a.position).addScaledVector(this.probe.set(Math.sin(angle), 0, Math.cos(angle)), 14);
            if (flatDistance(a.goal, a.home) > distanceLimit * 1.45) a.goal.lerp(a.home, .42);
            this.set(a, 'Flee');
            return;
        }
        if (homeDistance > distanceLimit * (shy ? 1.30 : 1.14) ||
            (a.state === 'Return' && homeDistance > 2.2 && (playerDistance > p.reach || !angry))) {
            a.hunt = undefined;
            a.goal.copy(a.home);
            this.set(a, 'Return');
            return;
        }

        if (shy) {
            const hunter = this.closest(a, b => b.profile.temperament === 'hunter' && b.ready && b.health > 0, p.sense * 1.7);
            const threat = hunter?.position ?? (playerDistance < p.sense * (angry ? 1.9 : 1) && (angry||a.habitat.species==='water') ? player : undefined);
            if (threat) {
                const angle = Math.atan2(a.position.x-threat.x, a.position.z-threat.z);
                a.goal.copy(a.position).addScaledVector(this.probe.set(Math.sin(angle),0,Math.cos(angle)), 9);
                if (flatDistance(a.goal, a.home) > distanceLimit) a.goal.lerp(a.home, .56);
                if (player && angry && a.blocked > .35 && playerDistance < p.reach && this.time >= a.attackAt && this.clearStrike(a, player)) {
                    this.beginAttack(a, player);
                } else this.set(a, 'Flee');
                return;
            }
        } else {
            const sense = p.temperament === 'defensive' ? p.sense * (angry ? 1.85 : .54)
                : p.temperament === 'ambush' ? p.sense * (angry ? 1.7 : .68) : p.sense * (angry ? 1.6 : 1);
            const canChasePlayer = player && playerDistance < sense && flatDistance(a.home, player) < distanceLimit * 1.32;
            a.hunt = canChasePlayer || p.temperament !== 'hunter' || a.hunger < .46 ? undefined
                : this.closest(a, b => b.profile.temperament === 'skittish' && b.ready && b.health > 0 && flatDistance(a.home, b.position) < distanceLimit, p.sense);
            const target = canChasePlayer ? player : a.hunt?.position;
            if (target) {
                const distance = flatDistance(a.position, target);
                if(canChasePlayer){
                    const first=a.fightUntil<=this.time;
                    a.fightUntil=this.time+5;
                    if(first&&!angry&&(p.temperament==='hunter'||p.temperament==='ambush')){
                        this.face(a,target,Math.PI);
                        this.set(a,'Alert');
                        if(p.temperament==='hunter')for(const b of this.active){
                            if(b!==a&&b.habitat===a.habitat&&flatDistance(b.position,a.position)<24){
                                b.angerUntil=Math.max(b.angerUntil,this.time+4);
                                b.thinkAt=Math.min(b.thinkAt,this.time+.45);
                            }
                        }
                        return;
                    }
                }
                a.goal.copy(target);
                if (distance < p.reach && this.time >= a.attackAt && this.clearStrike(a, target)) this.beginAttack(a, target);
                else if (distance < p.reach * .81) {
                    this.face(a, target, 1);
                    this.set(a, 'Idle');
                } else this.set(a, 'Pursue');
                return;
            }
        }

        if (a.state === 'Forage' && this.time - a.since < 2.45) return;
        if (a.state === 'Roam' && flatDistance(a.position,a.goal) > .9 && this.time - a.since < 12 && a.blocked < .58) return;
        if (a.state === 'Idle' && this.time - a.since < 1.2 + a.id % 5 * .38) return;
        if (a.hunger > .47 && p.temperament !== 'hunter') {
            this.set(a, 'Forage');
            a.hunger *= .31;
            return;
        }
        if (a.state !== 'Idle' && a.random() < .50) {
            this.set(a, 'Idle');
            return;
        }
        const radius = territory(a) * (p.temperament === 'ambush' ? .36 : .72);
        for (let i = 0; i < 8; i++) {
            const angle = a.random() * Math.PI * 2, range = radius * (.25 + a.random() * .75);
            const leader=p.temperament==='hunter'?this.active.find(b=>b.habitat===a.habitat&&b.ready&&b.health>0&&b.id<a.id):undefined;
            const center=leader?.position??(a.habitat.species==='stone-boar'?a.home:a.camp);
            const distance=leader?Math.min(7,range):range;
            const x = center.x + Math.sin(angle) * distance, z = center.z + Math.cos(angle) * distance;
            const y = this.walkable(a, x, z);
            if (y === undefined || flatDistance(a.position,this.probe.set(x,y,z)) < 2.3) continue;
            a.goal.set(x,y,z);
            a.blocked = 0;
            this.set(a, 'Roam');
            return;
        }
        this.set(a, 'Idle');
    }

    private closest(a: Creature, test: (other: Creature) => boolean, radius: number) {
        let best: Creature | undefined;
        for (const other of this.active) {
            if (other === a || !test(other) || Math.abs(other.position.y - a.position.y) > 2.2) continue;
            const d = flatDistance(a.position, other.position);
            if (d >= radius) continue;
            radius = d;
            best = other;
        }
        return best;
    }

    private walkable(a: Creature, x: number, z: number) {
        const y = surface(a.habitat, x, z);
        if (y === undefined || blocksCreature(x, y, z, a.profile.radius, a.profile.height)) return;
        if (a.habitat.island || a.state === 'Flee' || a.state === 'Pursue' || a.state === 'Return' || trailDistance(x, z) > 1.6) return y;
    }

    private entersPlayer(a: Creature, x: number, y: number, z: number, player: Vector3 | undefined, yaw = a.yaw) {
        if (!player || !a.ready || a.health <= 0 || !bodyHeightsOverlap(a, y, player.y)) return false;
        const boundary = a.profile.radius + playerCollider.radius;
        const next = bodyOffset(this.contact, a, player.x, player.z, x, z, yaw).lengthSq();
        if (next >= boundary ** 2) return false;
        const previous = bodyOffset(this.contact, a, player.x, player.z, a.position.x, a.position.z).lengthSq();
        return next <= previous || !bodyHeightsOverlap(a, a.position.y, player.y);
    }

    private move(a: Creature, speed: number, player: Vector3 | undefined,dt=localStep) {
        if(a.route.length&&a.routeGoal.distanceToSquared(a.goal)>6**2)a.route.length=0;
        if(a.route.length&&flatDistance(a.position,a.route[0])<.6)a.route.shift();
        if(!a.route.length&&this.time>=a.routeAt&&this.time>=this.searchAt){
            a.routeAt=this.time+.31;
            const distance=flatDistance(a.position,a.goal), look=Math.min(2.7,distance);
            const direct=distance>0?look/distance:0;
            if(a.blocked>.18||walkEdge(a,a.position,a.position.x+(a.goal.x-a.position.x)*direct,
                a.position.z+(a.goal.z-a.position.z)*direct)===undefined){
                a.routeAt=this.time+1.08;
                this.searchAt=this.time+.16;
                a.route=findWildlifePath(a,a.position,a.goal);
                a.routeGoal.copy(a.goal);
            }
        }
        const target=a.route[0]??a.goal;
        let dx = target.x - a.position.x, dz = target.z - a.position.z;
        const length = Math.hypot(dx,dz);
        if(length<.001){a.speed=0;return;}
        dx /= length;
        dz /= length;
        const separate = (p: Vector3, desired: number) => {
            if (Math.abs(p.y-a.position.y) > 1.4) return;
            const x = a.position.x-p.x, z = a.position.z-p.z, distance = Math.hypot(x,z);
            if (distance > .001 && distance < desired) {
                const push = (1-distance/desired) * 1.35 / distance;
                dx += x*push;
                dz += z*push;
            }
        };
        for (const b of this.active) if (b !== a && b.health > 0) separate(b.position, (a.profile.radius+b.profile.radius) * 1.7);
        if (player && a.state !== 'Pursue') separate(player, a.profile.radius + 1.2);
        const heading = Math.atan2(dx, dz);
        const stride = Math.min(length, speed * dt);
        for (const offset of navigationOffsets) {
            const angle = heading + offset;
            const sx = Math.sin(angle), sz = Math.cos(angle);
            const x = a.position.x + sx * stride, z = a.position.z + sz * stride;
            const look = Math.max(stride, a.profile.radius * .7);
            if (walkEdge(a,a.position,a.position.x+sx*look,a.position.z+sz*look)===undefined) continue;
            const y = walkEdge(a,a.position,x,z);
            const yaw = turnToward(a.yaw, angle, dt * 8);
            if (y === undefined || this.entersPlayer(a, x, y, z, player, yaw)) continue;
            a.position.set(x,y,z);
            a.yaw = yaw;
            a.speed = speed;
            a.blocked = 0;
            return;
        }
        a.speed = 0;
        a.blocked += dt;
        const yaw = turnToward(a.yaw, heading, dt * 5);
        if (!this.entersPlayer(a, a.position.x, a.position.y, a.position.z, player, yaw)) a.yaw = yaw;
    }

    private face(a: Creature, target: Vector3, limit: number) {
        a.yaw = turnToward(a.yaw, Math.atan2(target.x-a.position.x, target.z-a.position.z), limit);
    }

    private clearStrike(a: Creature, position: Vector3) {
        this.rayStart.copy(a.position).y += a.profile.height * .45;
        this.rayEnd.copy(position).y += .7;
        return clipStructureCamera(this.rayStart, this.rayEnd) === 1;
    }

    private beginAttack(a: Creature, target: Vector3) {
        this.face(a, target, Math.PI);
        a.attackAt = this.time + a.profile.cooldown;
        this.set(a, 'Attack');
    }

    private strike(a: Creature, player: Vector3 | undefined) {
        const prey = a.hunt;
        const target = prey?.position ?? player;
        if (!a.ready || !target || (prey && prey.health === 0) || !horizontalHit(a,target,.25)) return;
        const dx = target.x-a.position.x, dz = target.z-a.position.z, distance = Math.hypot(dx,dz);
        if (distance > a.profile.reach + .28 || dx*Math.sin(a.yaw)+dz*Math.cos(a.yaw) < distance*.50 || !this.clearStrike(a,target)) return;
        if (prey) {
            this.damage(prey, a.attackDamage * .86, false, a.position);
            if (prey.health === 0) a.hunger *= .18;
        } else {
            a.attentionUntil = this.time + 4;
            this.pressure+=a.profile.damage/27;
            if(this.pressure>=.88){
                this.respiteUntil=this.time+5.5;
                this.pressure*=.48;
            }
            this.playerDamage(a.attackDamage,a);
        }
    }

    private knockback(a: Creature, player: Vector3 | undefined) {
        const from = a.recoilLeft;
        a.recoilLeft = Math.max(0, a.recoilLeft-localStep);
        const progress = (from*from-a.recoilLeft*a.recoilLeft)/(recoilDuration*recoilDuration);
        const x = a.position.x+a.recoil.x*progress, z = a.position.z+a.recoil.z*progress;
        const y = walkHeight(a,x,z,a.position.y);
        const heightLimit = .12 + a.recoil.length()*progress*.65;
        if (y === undefined || Math.abs(a.position.y-y) > heightLimit ||
            this.entersPlayer(a, x, y, z, player)) {
            a.recoilLeft = 0;
            return;
        }
        a.position.set(x, y, z);
    }

    damage(a: Creature, amount: number, byPlayer = true, origin?: Vector3) {
        if (!a.ready || a.health <= 0) return false;
        a.health = Math.max(0, a.health - amount);
        if (byPlayer) {
            a.attentionUntil = this.time + 4;
            a.angerUntil = this.time + 9;
            a.fightUntil = this.time + 7;
            if (a.profile.temperament === 'defensive' || a.profile.temperament === 'hunter') {
                for (const b of this.active) {
                    if (b.habitat === a.habitat && b.health > 0 && flatDistance(a.position,b.position) < 18) {
                        b.angerUntil = Math.max(b.angerUntil, this.time + 7);
                        b.thinkAt = this.time;
                    }
                }
            }
        }
        this.set(a, a.health > 0 ? 'Hit' : 'Defeat');
        a.since = this.time;
        const distance = a.profile.knockback ?? 0;
        if (distance > 0) {
            a.recoil.set(a.position.x-(origin?.x ?? a.position.x), 0, a.position.z-(origin?.z ?? a.position.z));
            if (a.recoil.lengthSq() < .001) a.recoil.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
            a.recoil.normalize().multiplyScalar(distance);
            a.recoilLeft = recoilDuration;
        }
        if (a.health <= 0) {
            a.respawnAt = this.time + a.profile.respawn / (1 + 1.35 * this.nightFactor);
            if (byPlayer) this.onDefeat?.(a);
        }
        return true;
    }

    /**
     * Sweeps a Divine Sense (神识) pulse across beasts within `radius`:
     * - Marks all living beasts inside `radius` for HUD/minimap insight.
     * - Intimidates lower-rank beasts (`rank <= suppressMaxRank`) into fleeing.
     * - Alerts higher-rank beasts (`rank > playerRealmRank`) that sense the cultivator's probe.
     */
    applyDivineSensePulse(
        origin: Vector3,
        radius: number,
        playerRealmRank: number,
        suppressMaxRank: number,
    ): DivineSensePulseReport {
        // Materialize unvisited nearby habitat camps within scan range (capped at 460m for fast response)
        const campSpan = Math.min(radius, 460);
        const x0 = Math.floor((origin.x - campSpan) / cellSize);
        const x1 = Math.floor((origin.x + campSpan) / cellSize);
        const z0 = Math.floor((origin.z - campSpan) / cellSize);
        const z1 = Math.floor((origin.z + campSpan) / cellSize);
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                for (const { index, habitat, center: camp, homes } of this.cells.get(`${x},${z}`) ?? []) {
                    if (this.visited.has(index)) continue;
                    if (Math.hypot(origin.x - camp.x, origin.z - camp.z) > campSpan) continue;
                    const p = species[habitat.species];
                    const available = homes.some(h => blocksCreature(h.x, h.y, h.z, p.radius, p.height))
                        ? seedsFor(habitat, index + 1) : homes;
                    if (!available.length) continue;
                    this.visited.add(index);
                    const anchor = available[0];
                    const group = new Vector3(anchor.x, anchor.y, anchor.z);
                    for (const [slot, home] of available.entries()) {
                        const rank = this.enableRanks
                            ? rollBeastRank(habitat.region, habitat.species, Math.random(), this.nightFactor)
                            : BEAST_RANKS[0];
                        this.agents.push(new Creature((index + 1) * 10 + slot, habitat, new Vector3(home.x, home.y, home.z), group, rank));
                    }
                }
            }
        }

        let detected = 0;
        let highThreatCount = 0;
        let suppressedCount = 0;
        let alertedHighCount = 0;
        let alertedLeaderName: string | undefined;
        let alertedLeaderRank = 0;

        const rSq = radius * radius;
        const suppressRadius = Math.min(radius, 210);
        const counterSenseRadius = Math.min(radius, 150);

        for (const a of this.agents) {
            if (a.state === 'Defeat' || a.health <= 0) continue;
            const distSq = a.position.distanceToSquared(origin);
            if (distSq > rSq) continue;
            const dist = Math.sqrt(distSq);

            detected++;
            a.senseMarkedUntil = Math.max(a.senseMarkedUntil, this.time + 11.5);

            if (a.rank.rank > playerRealmRank) highThreatCount++;

            if (suppressMaxRank > 0 && a.rank.rank <= suppressMaxRank && dist <= suppressRadius) {
                a.intimidatedUntil = Math.max(a.intimidatedUntil, this.time + 8.0);
                a.angerUntil = 0;
                a.fightUntil = 0;
                a.hunt = undefined;
                const fleeAngle = Math.atan2(a.position.x - origin.x, a.position.z - origin.z);
                a.goal.copy(a.position).addScaledVector(this.probe.set(Math.sin(fleeAngle), 0, Math.cos(fleeAngle)), 16);
                if (dist <= 55) {
                    a.recoil.set(Math.sin(fleeAngle), 0, Math.cos(fleeAngle)).multiplyScalar(1.35);
                    a.recoilLeft = recoilDuration * 0.75;
                }
                this.set(a, 'Flee');
                a.thinkAt = this.time + 0.35;
                suppressedCount++;
            } else if (a.rank.rank > playerRealmRank && dist <= counterSenseRadius) {
                this.face(a, origin, Math.PI);
                a.angerUntil = Math.max(a.angerUntil, this.time + 8.5);
                a.fightUntil = Math.max(a.fightUntil, this.time + 7.5);
                a.attentionUntil = Math.max(a.attentionUntil, this.time + 10.0);
                if (a.state === 'Idle' || a.state === 'Roam' || a.state === 'Forage') {
                    this.set(a, 'Alert');
                }
                a.thinkAt = this.time + 0.35;
                alertedHighCount++;
                if (a.rank.rank >= alertedLeaderRank) {
                    alertedLeaderRank = a.rank.rank;
                    alertedLeaderName = a.displayName;
                }
            }
        }

        return { detected, highThreatCount, suppressedCount, alertedHighCount, alertedLeaderName };
    }

    /**
     * Nascent Soul Gravity-Field Pressure (元婴威压):
     * Crushes, staggers, and intimidates wild beasts within `radius` (does not affect Boss entities).
     */
    applyNascentPressure(origin: Vector3, radius: number, duration = 4.2, baseDamage = 48): number {
        let count = 0;
        const rSq = radius * radius;
        for (const a of this.active) {
            if (!a.ready || a.state === 'Defeat' || a.health <= 0) continue;
            const dx = a.position.x - origin.x;
            const dz = a.position.z - origin.z;
            if (dx * dx + dz * dz > rSq) continue;
            a.angerUntil = 0;
            a.fightUntil = 0;
            a.hunt = undefined;
            a.intimidatedUntil = Math.max(a.intimidatedUntil, this.time + duration);
            a.thinkAt = Math.max(a.thinkAt, this.time + Math.min(duration, 2.8));
            a.speed = 0;
            this.damage(a, baseDamage, true, origin);
            count++;
        }
        return count;
    }
}
