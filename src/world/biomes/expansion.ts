import {addSolid, releaseSolids} from '../physics/solid-world';
import * as T from 'three';
import {canPlantTree, heightAt, randomAt, trailDistance} from '../geo/height';
import {
    floatingIslands, islandTop as analyticIslandTop, islandSurfaceAt as islandTop,
    islandLayerRadius, islandRadiusAt, islandRimRadius, islandRockHeight, islandLayers, islandSides, islandTopRings, regions, type Region,
} from '../geo/regions';
import { detectDevice } from '../../config/device';
import {toonMaterial} from '../../rendering/materials';
import {makePeaklandStone} from '../../rendering/peakland-stone';
import {makeSakuraCrown, makeSakuraTrunk, windify, type Vegetation} from '../flora/vegetation';
import {inBuildingLot, populateBuildingLayout} from './building-layout';
import {peakland} from '../geo/peakland-plan';
import {populatePeakland} from './peakland-scene';
import {PeakRockField} from './peakland-rock';
import {PeaklandFlora} from '../flora/peakland-flora';
import {makeLeafTexture, makeValleyShrub} from '../flora/flora-geometry';
import {regionalHabitatAt} from '../geo/regional-habitat';
import {shoreDistanceAt} from '../geo/meadow-distribution';
import {slopeAt, valueNoise} from '../geo/height';
import {aerialPerspectiveGLSL, atmosphereUniforms} from '../../rendering/aerial-perspective';
import {populateValleyStoneRing} from './valley-stone-ring';
import {populateBayShore} from './bay-shore-details';
import {ValleyCrops} from '../flora/valley-crops';
import {populateBambooGrove} from './bamboo-grove';
import {populateCreekIdyll} from './creek-idyll';
import {populateSpawnShrine, SpawnShrine} from './spawn-shrine';
import type { SpawnShoreGrass } from '../../rendering/spawn-shore-grass';

function grove(group: T.Group, cx: number, cz: number, radius: number, count: number, wind: Vegetation['uniforms'], island?: typeof floatingIslands[number]) {
    const trunk = new T.InstancedMesh(makeSakuraTrunk(), toonMaterial('#856b59', { vertexColors: true }), count);
    const crown = new T.InstancedMesh(makeSakuraCrown(),new T.MeshLambertMaterial({
        map:makeLeafTexture(true),alphaTest:.36,alphaToCoverage:true,vertexColors:true,side:T.DoubleSide,
    }),count);
    const dummy = new T.Object3D(), tint = new T.Color();
    trunk.castShadow = trunk.receiveShadow = crown.castShadow = crown.receiveShadow = true;
    windify(crown.material, wind, .16, 5.8);
    let written = 0;
    for (let i = 0; i < count * (island ? 2.6 : 1.6) && written < count; i++) {
        const angle = i * 2.4, distance = Math.sqrt(randomAt(cx + i, cz, 10)) * radius;
        const x = cx + Math.cos(angle) * distance, z = cz + Math.sin(angle) * distance;
        const scale = island ? 1.35 + randomAt(x, z) * 1.15 : .9 + randomAt(x, z) * 1.1;
        if (!island && (!canPlantTree(x, z, 1.65 * scale) || trailDistance(x, z) < 4.5))
            continue;
        if (inBuildingLot(x,z,5*scale,island ? floatingIslands.indexOf(island) : undefined))
            continue;
        const y = island ? islandTop(x, z, island) : heightAt(x, z);
        const groveWeight=island ? valueNoise(x*.053,z*.053,217)
            : regionalHabitatAt(x,z,y,slopeAt(x,z),shoreDistanceAt(x,z)).woodland;
        if(!island && randomAt(x,z,227)>.24+.96*groveWeight)continue;
        if(island && randomAt(x,z,227)>.48+.75*groveWeight)continue;
        dummy.position.set(x, y, z);
        dummy.scale.setScalar(scale);
        dummy.rotation.y = angle;
        dummy.updateMatrix();
        trunk.setMatrixAt(written, dummy.matrix);
        crown.setMatrixAt(written, dummy.matrix);
        const blossom = island
            ? (randomAt(x,z)<.36 ? '#ffe2f0' : randomAt(x,z)<.72 ? '#ffb8d9' : '#ff9ac8')
            : (randomAt(x,z)<.42 ? '#ffeaf3' : '#ffcbe1');
        crown.setColorAt(written,tint.set(blossom).multiplyScalar(.96+randomAt(z,x)*.18));
        const r = .47 * scale;
        addSolid(group, { minX: x-r, maxX: x+r, minZ: z-r, maxZ: z+r, minY: y, maxY: y+4*scale, radius: r });
        written++;
    }
    trunk.count = crown.count = written;
    trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    trunk.computeBoundingSphere();
    crown.computeBoundingSphere();
    group.add(trunk, crown);
}

function islandGeometry(island: typeof floatingIslands[number], underside: boolean) {
    const pos: number[] = [], colors: number[] = [], indices: number[] = [];
    const rings = underside ? islandLayers : Array.from({length:islandTopRings+1},(_,i)=>({depth:0,radius:i/islandTopRings}));
    const n = islandSides;
    const stone = new T.Color('#d8c4a0'), shale = new T.Color('#969896'), lip = new T.Color('#4d8e34');
    const meadow = new T.Color('#4f9438'), grass = new T.Color('#a8d64a'), color = new T.Color();
    for (let j = 0; j < rings.length; j++)
        for (let i = 0; i < n; i++) {
            const angle = i/n*Math.PI*2, layer = rings[j];
            const r = islandLayerRadius(island,angle,layer.depth,layer.radius);
            const x = island.x + Math.cos(angle)*r, z = island.z + Math.sin(angle)*r;
            const y = underside ? islandRockHeight(island,layer.depth,angle) : analyticIslandTop(x,z,island);
            pos.push(x,y,z);
            if (underside) {
                const strata = .51 + .20*Math.sin(layer.depth*5+angle*2+island.phase) + .10*Math.sin(angle*7+island.phase);
                color.copy(shale).lerp(stone,strata);
                color.lerp(lip,(1-T.MathUtils.smoothstep(layer.depth,0,.13))*(.38+.29*Math.cos(angle*7+island.phase)));
                if (j === 0) color.copy(lip);
            } else {
                const patches = valueNoise(x*.055,z*.055,53);
                color.copy(meadow).lerp(grass,patches).lerp(lip,T.MathUtils.smoothstep(layer.radius,.83,1));
            }
            colors.push(color.r,color.g,color.b);
            if (j < rings.length-1) {
                const a = j*n+i, b = j*n+(i+1)%n, c = a+n, d = b+n;
                if (layer.radius > 0) indices.push(a,b,c);
                if (rings[j+1].radius > 0) indices.push(b,d,c);
            }
        }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const profile = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < profile.length; i += 2) { profile[i] = island.phase * 1.7; profile[i + 1] = island.phase * 997; }
    g.setAttribute('aGeologicProfile', new T.BufferAttribute(profile, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const normals = g.getAttribute('normal'), pole = underside ? (rings.length-1)*n : 0;
    const average = new T.Vector3();
    for (let i = pole; i < pole+n; i++) average.add(new T.Vector3().fromBufferAttribute(normals,i));
    average.normalize();
    for (let i = pole; i < pole+n; i++) normals.setXYZ(i,average.x,average.y,average.z);
    return g;
}

function decorateFloatingIslands(group: T.Group, wind: Vegetation['uniforms']) {
    // Rim shrubs and sandstone boulders tucked naturally along the floating island grass edges.
    const shrubGeo = makeValleyShrub();
    const shrubMat = new T.MeshLambertMaterial({
        map: makeLeafTexture(),
        alphaTest: .36,
        alphaToCoverage: true,
        vertexColors: true,
        side: T.DoubleSide,
    });
    windify(shrubMat, wind, .14, 6.2);

    const boulderGeo = new T.IcosahedronGeometry(1, 1).scale(1.15, .58, .92);
    const boulderMat = new T.MeshLambertMaterial({ color: '#c8b08a' });

    const shrubSpots: { x: number; y: number; z: number; yaw: number; s: number; shade: number }[] = [];
    const boulderSpots: { x: number; y: number; z: number; yaw: number; s: number; shade: number }[] = [];

    for (const [idx, island] of floatingIslands.entries()) {
        const rimCount = Math.max(12, Math.floor(island.r * 0.52));
        for (let i = 0; i < rimCount; i++) {
            const angle = (i / rimCount) * Math.PI * 2 + randomAt(idx * 47 + i, 2, 81) * 0.25;
            const r = islandRimRadius(island, angle) * (0.86 + randomAt(idx, i, 82) * 0.12);
            const x = island.x + Math.cos(angle) * r;
            const z = island.z + Math.sin(angle) * r;
            const y = islandTop(x, z, island) - 0.15;
            if (i % 3 === 0) {
                boulderSpots.push({ x, y: y + 0.2, z, yaw: angle, s: 1.1 + randomAt(idx, i, 83) * 1.8, shade: randomAt(idx, i, 84) });
            } else {
                shrubSpots.push({ x, y, z, yaw: angle, s: 1.3 + randomAt(idx, i, 85) * 1.6, shade: randomAt(idx, i, 86) });
            }
        }
    }

    const dummy = new T.Object3D(), tint = new T.Color();

    if (shrubSpots.length) {
        const shrubs = new T.InstancedMesh(shrubGeo, shrubMat, shrubSpots.length);
        shrubs.name = 'floating-island-rim-shrubs';
        shrubs.instanceMatrix.setUsage(T.StaticDrawUsage);
        for (const [i, s] of shrubSpots.entries()) {
            dummy.position.set(s.x, s.y, s.z);
            dummy.rotation.set(0, s.yaw, 0);
            dummy.scale.set(s.s, s.s * .78, s.s);
            dummy.updateMatrix();
            shrubs.setMatrixAt(i, dummy.matrix);
            shrubs.setColorAt(i, tint.setHSL(.25 + s.shade * .05, .48, .42 + s.shade * .14));
        }
        shrubs.instanceMatrix.needsUpdate = true;
        if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
        shrubs.computeBoundingSphere();
        shrubs.receiveShadow = true;
        group.add(shrubs);
    }

    if (boulderSpots.length) {
        boulderGeo.computeBoundingBox();
        const boulderBase = boulderGeo.boundingBox!, boulderBox = new T.Box3();
        const boulders = new T.InstancedMesh(boulderGeo, boulderMat, boulderSpots.length);
        boulders.name = 'floating-island-rim-boulders';
        boulders.instanceMatrix.setUsage(T.StaticDrawUsage);
        for (const [i, b] of boulderSpots.entries()) {
            dummy.position.set(b.x, b.y, b.z);
            dummy.rotation.set(b.shade * .3, b.yaw, (b.shade - .5) * .25);
            dummy.scale.set(b.s, b.s * (.7 + b.shade * .4), b.s);
            dummy.updateMatrix();
            boulders.setMatrixAt(i, dummy.matrix);
            boulders.setColorAt(i, tint.setRGB(.85 + b.shade * .15, .78 + b.shade * .12, .66 + b.shade * .10));
            boulderBox.copy(boulderBase).applyMatrix4(dummy.matrix);
            const r = Math.min(boulderBox.max.x - boulderBox.min.x, boulderBox.max.z - boulderBox.min.z) * .44;
            addSolid(group, {
                minX: boulderBox.min.x, maxX: boulderBox.max.x,
                minY: boulderBox.min.y, maxY: boulderBox.max.y - .04,
                minZ: boulderBox.min.z, maxZ: boulderBox.max.z,
                radius: r, step: boulderBox.max.y - b.y < .55,
            });
        }
        boulders.instanceMatrix.needsUpdate = true;
        if (boulders.instanceColor) boulders.instanceColor.needsUpdate = true;
        boulders.computeBoundingSphere();
        boulders.receiveShadow = true;
        group.add(boulders);
    }
}

export class MapExpansion {
    private active = new Map<string, T.Group>();
    private time = { value: 0 };
    private preloading = false;
    private spawnShrine?: SpawnShrine;
    private floraWind={time:this.time,player:{value:new T.Vector3(1e6,1e6,1e6)},playerVel:{value:new T.Vector3()}};
    constructor(private scene: T.Scene, private spawnShoreGrass?: SpawnShoreGrass) { }
    setWind(uniforms:Vegetation['uniforms']){this.floraWind=uniforms;}
    /**
     * Build the two landmark regions once, while the character GLB is still
     * loading, so they never pop in (or hitch) when the player flies towards
     * them. Both stay resident for the whole session.
     */
    preloadLandmarks() {
        if (this.preloading) return;
        this.preloading = true;
        const started = performance.now();
        for (const id of [peakland.id, 'sky', 'village']) {
            this.ensureRegion(id);
        }
        this.preloading = false;
        if (import.meta.env.DEV) console.log('landmarks preload', (performance.now() - started).toFixed(0) + 'ms');
    }

    async preloadLandmarksAsync(nextFrame: () => Promise<void>, isDisposed: () => boolean) {
        if (this.preloading) return;
        this.preloading = true;
        const ids = detectDevice().isMobile ? ['village', 'sky'] : ['village', 'sky', peakland.id];
        for (const id of ids) {
            if (isDisposed()) break;
            this.ensureRegion(id);
            await nextFrame();
        }
        if (!isDisposed()) await this.spawnShrine?.ready;
        this.preloading = false;
    }

    private ensureRegion(id: string) {
        if (this.active.has(id)) return;
        const region = regions.find(r => r.id === id);
        if (!region) return;
        try {
            const built = this.create(region);
            built.name = id;
            this.scene.add(built);
            this.active.set(id, built);
        } catch (error) {
            console.error('远景预载失败', id, error);
        }
    }

    /**
     * Low-priority idle warmup for remaining scenic regions on desktop after entering the valley
     * so high-speed 95 m/s Nascent Escape Light flights across the 6km map never trigger mid-flight pop-build hitches.
     */
    async preloadRemainingRegionsIdle(isDisposed: () => boolean) {
        if (detectDevice().isMobile) return;
        const rest = regions.map(r => r.id).filter(id => !this.active.has(id));
        const yieldIdle = () => new Promise<void>(resolve => {
            const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
            if (ric) ric(() => resolve(), { timeout: 1200 });
            else window.setTimeout(resolve, 450);
        });
        for (const id of rest) {
            await yieldIdle();
            if (isDisposed()) return;
            this.ensureRegion(id);
        }
    }

    update(time: number, position: T.Vector3, camera?: T.PerspectiveCamera, velocity = new T.Vector3(), viewHeight = 720, pixelBudget = 1, highSpeed = false) {
        this.time.value = time;
        const evictRadius = detectDevice().isMobile ? 2200 : 4200;
        for (const [id, group] of this.active) {
            const region = regions.find(r => r.id === id)!;
            if (id === peakland.id || id === 'sky' || id === 'village') continue;
            if (Math.hypot(position.x - region.x, position.z - region.z) > evictRadius) {
                this.scene.remove(group);
                this.release(group);
                this.active.delete(id);
            }
        }
        if (!highSpeed) {
            let best: Region | undefined;
            let bestDist = Infinity;
            for (const r of regions) {
                if (this.active.has(r.id)) continue;
                const d = Math.hypot(position.x - r.x, position.z - r.z);
                const limit = r.id === 'lake' ? 1580 : r.id === peakland.id ? 1750 : 1350;
                if (d < limit && d < bestDist) {
                    best = r;
                    bestDist = d;
                }
            }
            if (best) {
                const group = this.create(best);
                this.scene.add(group);
                this.active.set(best.id, group);
            }
        }
        const region = this.active.get(peakland.id);
        const rocks = region?.children.find(o => o instanceof PeakRockField);
        const plants = region?.children.find(o => o instanceof PeaklandFlora);
        if (camera && rocks instanceof PeakRockField) rocks.update(time,camera,velocity,viewHeight,pixelBudget);
        if (camera && plants instanceof PeaklandFlora) plants.update(time,camera,viewHeight,pixelBudget);
        const crops=this.active.get('village')?.children.find(o=>o instanceof ValleyCrops);
        if(camera && crops instanceof ValleyCrops)crops.update(camera);
        if(camera && this.spawnShrine)this.spawnShrine.update(camera);
    }
    private create(r: Region) {
        const group = new T.Group();
        if (r.id === peakland.id) {
            group.name = 'peakland';
            populatePeakland(group,this.time,this.floraWind);
            return group;
        }
        populateBuildingLayout(group,r,this.time);
        if(r.id==='village'){
            populateValleyStoneRing(group);
            populateCreekIdyll(group,this.floraWind);
            this.spawnShrine = populateSpawnShrine(group,this.time,this.floraWind,this.spawnShoreGrass);
            group.add(new ValleyCrops(this.floraWind));
        }
        if(r.id==='lake')populateBayShore(group,this.floraWind);
        if (r.id === 'sakura')
            grove(group, r.x, r.z, 210, 90, this.floraWind);
        if (r.id === 'bamboo')
            populateBambooGrove(group, r, this.floraWind);
        if (r.id === 'sky') {
            const rock = makePeaklandStone(this.time);
            // Cool sky-blue bounce fills floating island undersides while sunlit faces stay warm sandstone.
            rock.emissive = new T.Color('#5c7894');
            rock.emissiveIntensity = .34;
            const turf = new T.MeshLambertMaterial({ vertexColors: true });
            turf.onBeforeCompile=shader=>{
                Object.assign(shader.uniforms, atmosphereUniforms);
                shader.vertexShader='varying vec3 vIslandPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>',
                    '#include <begin_vertex>\nvIslandPoint=(modelMatrix*vec4(transformed,1.)).xyz;');
                shader.fragmentShader='varying vec3 vIslandPoint;\n'+aerialPerspectiveGLSL+shader.fragmentShader
                    .replace('#include <fog_fragment>','')
                    .replace('#include <tonemapping_fragment>',`gl_FragColor.rgb=mix(gl_FragColor.rgb,
                        applyAerialPerspective(gl_FragColor.rgb,vIslandPoint),smoothstep(85.,330.,length(vViewPosition)));
                        #include <tonemapping_fragment>`);
            };
            for (const island of floatingIslands) {
                const extent = island.r*1.24;
                addSolid(group,{
                    minX:island.x-extent,maxX:island.x+extent,minZ:island.z-extent,maxZ:island.z+extent,
                    minY:island.y-island.r*islandLayers.at(-1)!.depth,maxY:island.y+island.r*.11,
                    contains:(x,z,margin=0)=>{
                        const dx=x-island.x,dz=z-island.z;
                        return Math.hypot(dx,dz)<=islandRimRadius(island,Math.atan2(dz,dx))+margin;
                    },
                    volume:true,roof:(x,z)=>islandTop(x,z,island),
                    radiusAt:(y,angle)=>islandRadiusAt(island,y,angle),
                });
                for (const lower of [false, true]) {
                    const mesh = new T.Mesh(islandGeometry(island, lower), lower ? rock : turf);
                    mesh.castShadow = mesh.receiveShadow = true;
                    group.add(mesh);
                }
                grove(group, island.x, island.z, island.r * .74, Math.max(7, Math.floor(island.r / 3.8)), this.floraWind, island);
            }
            decorateFloatingIslands(group, this.floraWind);
        }
        return group;
    }
    get loadedRegions() { return this.active.size; }
    private release(group: T.Group) {releaseSolids(group); const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>(); group.traverse(o => { if (o instanceof PeaklandFlora || o instanceof PeakRockField) o.collectVariants(geometries); if (o instanceof T.Mesh || o instanceof T.Points) {
        geometries.add(o.geometry);
        if (o instanceof T.InstancedMesh)
            o.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            materials.add(m);
            const std = m as T.MeshStandardMaterial;
            if (std.map) textures.add(std.map);
            if (std.normalMap) textures.add(std.normalMap);
        }
    } }); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); }
    dispose() { for (const group of this.active.values()) {
        this.scene.remove(group);
        this.release(group);
    } this.active.clear(); this.spawnShrine = undefined; }
}







