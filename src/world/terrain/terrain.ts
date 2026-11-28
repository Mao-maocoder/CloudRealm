import * as T from 'three';
import { config, qualities, type Quality } from '../../config/settings';
import { detectDevice } from '../../config/device';
import { Vegetation } from '../flora/vegetation';
import { createTerrainMaterial } from '../../rendering/terrain-material';
import { TerrainLOD } from './terrain-lod';
import { bounds } from '../geo/geo-core';
import { DistantCorridorWoodland } from '../flora/distant-corridor-woodland';
import { CanyonRockField } from '../biomes/canyon-rock';
import { heightAt } from '../geo/height';

interface Chunk {
    plants?: T.Group;
    lod: number;
}

interface PendingChunk {
    key: string;
    x: number;
    z: number;
    score: number;
}

/** Ground is selected immediately on the GPU grid; only vegetation streams in paced CPU batches with LRU reuse. */
export class Terrain {
    readonly chunks = new Map<string, Chunk>();
    readonly vegetation = new Vegetation();
    readonly material = createTerrainMaterial();
    readonly lod = new TerrainLOD(this.material);
    readonly distantWoodland = new DistantCorridorWoodland();
    readonly canyon = new CanyonRockField(this.vegetation.uniforms);
    queue = 0;
    debug = false;

    private nextDetail = 0;
    private lastCx = Number.NaN;
    private lastCz = Number.NaN;
    private lastQuality: Quality;
    private pending: PendingChunk[] = [];
    private readonly wanted = new Map<string, PendingChunk>();
    private readonly cache = new Map<string, Chunk>();
    private readonly maxCache = detectDevice().isMobile ? 6 : 20;
    private readonly disposeQueue: Chunk[] = [];
    private streamCooldown = 0;
    private chunksDirty = true;

    constructor(private scene: T.Scene, public quality: Quality) {
        this.lastQuality = quality;
        scene.add(this.lod.mesh, this.distantWoodland, this.canyon);
    }

    update(p: T.Vector3, v: T.Vector3, camera: T.Camera) {
        this.lod.update(camera, qualities[this.quality].terrainRange);
        this.canyon.update(camera, this.quality);

        const q = qualities[this.quality];
        const cx = Math.floor(p.x / 128);
        const cz = Math.floor(p.z / 128);
        const speed = v.length();
        const flyingSpeed = speed > 20;
        const highSpeed = speed > 52;
        const highFlight = p.y - heightAt(p.x, p.z) > 120;

        // Only recompute wanted chunk grid & evictions when crossing a 128m chunk boundary (zero per-frame Map/String GC!)
        if (cx !== this.lastCx || cz !== this.lastCz || this.lastQuality !== this.quality) {
            this.lastCx = cx;
            this.lastCz = cz;
            this.lastQuality = this.quality;
            this.wanted.clear();
            const pxPred = (p.x + v.x * 2) / 128;
            const pzPred = (p.z + v.z * 2) / 128;
            for (let z = cz - q.radius; z <= cz + q.radius; z++) {
                for (let x = cx - q.radius; x <= cx + q.radius; x++) {
                    if (x * 128 >= bounds.right || (x + 1) * 128 <= bounds.left || z * 128 >= bounds.south || (z + 1) * 128 <= bounds.north) continue;
                    const d = Math.hypot(x - cx, z - cz);
                    if (d > q.radius + .5) continue;
                    const key = `${x},${z}`;
                    this.wanted.set(key, { x, z, key, score: Math.min(d, Math.hypot(x - pxPred, z - pzPred) + .7) });
                }
            }

            // Move leaving chunks into the LRU cache instead of immediately trashing GPU buffers & physics solids
            for (const [key, c] of this.chunks) {
                if (this.wanted.has(key)) continue;
                if (c.plants) c.plants.visible = false;
                this.chunks.delete(key);
                this.cache.delete(key);
                this.cache.set(key, c);
                this.chunksDirty = true;
            }
            while (this.cache.size > this.maxCache) {
                const oldestKey = this.cache.keys().next().value as string;
                const oldest = this.cache.get(oldestKey)!;
                this.cache.delete(oldestKey);
                this.disposeQueue.push(oldest);
            }

            // Immediately restore any wanted chunks that are warm in the LRU cache (0.01ms, zero hitch!)
            this.pending.length = 0;
            for (const [key, entry] of this.wanted) {
                if (this.chunks.has(key)) continue;
                const cached = this.cache.get(key);
                if (cached) {
                    this.cache.delete(key);
                    if (cached.plants) cached.plants.visible = true;
                    this.chunks.set(key, cached);
                    this.chunksDirty = true;
                } else {
                    this.pending.push(entry);
                }
            }
            this.pending.sort((a, b) => a.score - b.score);
        }

        // Spread actual chunk disposal (releaseSolids + GPU free) to at most 1 per frame so eviction never stalls
        if (this.disposeQueue.length > 0) {
            const stale = this.disposeQueue.shift()!;
            if (stale.plants) {
                this.scene.remove(stale.plants);
                this.vegetation.release(stale.plants);
            }
        }

        this.queue = this.pending.length;

        // Pace procedural chunk creation smoothly during normal & high-speed flight so chunk crossings never spike frame time.
        if (this.pending.length > 0) {
            if (this.streamCooldown > 0) {
                this.streamCooldown--;
            } else {
                const uploadStart = performance.now();
                const maxUploads = (highFlight || flyingSpeed) ? 1 : config.uploadsPerFrame;
                const budgetMs = (highFlight || flyingSpeed) ? 2.0 : 3.2;
                let uploaded = 0;
                while (uploaded < maxUploads && this.pending.length > 0) {
                    if (uploaded > 0 && performance.now() - uploadStart > budgetMs) break;
                    const next = this.pending.shift()!;
                    if (!this.wanted.has(next.key) || this.chunks.has(next.key)) continue;
                    const plants = this.vegetation.create(next.x * 128, next.z * 128, q.vegetation, 0, false);
                    this.scene.add(plants);
                    this.chunks.set(next.key, { plants, lod: 0 });
                    this.chunksDirty = true;
                    uploaded++;
                }
                this.queue = this.pending.length;
                if (uploaded > 0) {
                    this.streamCooldown = highSpeed ? 6 : flyingSpeed ? 2 : 0;
                }
            }
        }

        // Only update the distant corridor canopy coverage texture when active chunks actually changed
        if (this.chunksDirty) {
            this.chunksDirty = false;
            this.distantWoodland.update(this.chunks.keys());
        }

        const now = performance.now();
        if (now >= this.nextDetail) {
            this.nextDetail = now + (highSpeed ? 280 : 160);
            const treeRange = this.quality === 'low' ? 56 : this.quality === 'high' ? 112 : 78;
            for (const { plants } of this.chunks.values()) {
                if (plants) this.vegetation.updateDetail(plants, camera, treeRange);
            }
        }
    }

    /**
     * Pre-builds the closest vegetation chunks around the spawn point in gentle 2-chunk slices behind
     * the welcome screen so clicking Start lands in an already-built valley with zero startup chunk storm.
     */
    async prewarmSpawnAsync(
        p: T.Vector3,
        camera: T.Camera,
        nextFrame: () => Promise<void>,
        isDisposed: () => boolean,
        maxChunks = 20,
    ) {
        const zero = new T.Vector3();
        this.update(p, zero, camera);
        const q = qualities[this.quality];
        let built = 0;
        while (built < maxChunks && this.pending.length > 0) {
            if (isDisposed()) return;
            const batch = Math.min(2, maxChunks - built);
            for (let i = 0; i < batch && this.pending.length > 0; i++) {
                const next = this.pending.shift()!;
                if (!this.wanted.has(next.key) || this.chunks.has(next.key)) continue;
                const plants = this.vegetation.create(next.x * 128, next.z * 128, q.vegetation, 0, false);
                this.scene.add(plants);
                this.chunks.set(next.key, { plants, lod: 0 });
                this.chunksDirty = true;
                built++;
            }
            this.queue = this.pending.length;
            await nextFrame();
        }
        if (this.chunksDirty) {
            this.chunksDirty = false;
            this.distantWoodland.update(this.chunks.keys());
        }
    }

    private clearAllChunks() {
        for (const c of this.chunks.values()) {
            if (c.plants) {
                this.scene.remove(c.plants);
                this.vegetation.release(c.plants);
            }
        }
        for (const c of this.cache.values()) {
            if (c.plants) {
                this.scene.remove(c.plants);
                this.vegetation.release(c.plants);
            }
        }
        for (const c of this.disposeQueue) {
            if (c.plants) {
                this.scene.remove(c.plants);
                this.vegetation.release(c.plants);
            }
        }
        this.chunks.clear();
        this.cache.clear();
        this.disposeQueue.length = 0;
        this.pending.length = 0;
        this.lastCx = Number.NaN;
        this.lastCz = Number.NaN;
        this.chunksDirty = true;
    }

    setQuality(q: Quality) {
        if (q === this.quality) return;
        this.quality = q;
        this.clearAllChunks();
    }

    setTime(time: number) {
        this.material.userData.uniforms.uTime.value = time;
        this.canyon.setTime(time);
    }

    setDebug(on: boolean) {
        this.debug = on;
        this.material.wireframe = on;
    }

    get instances() {
        let count = 0;
        for (const c of this.chunks.values()) {
            c.plants?.traverse(o => {
                if (o instanceof T.InstancedMesh) count += o.count;
            });
        }
        return count;
    }

    dispose() {
        this.clearAllChunks();
        this.distantWoodland.dispose();
        this.canyon.dispose();
        this.lod.dispose();
        this.material.dispose();
        this.vegetation.dispose();
    }
}
