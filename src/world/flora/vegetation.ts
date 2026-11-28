import {addBoulderSolid,addSolid,releaseSolids} from '../physics/solid-world';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt, randomAt, slopeAt, trailDistance, waterHeight, riverX, canPlantTree,fbm,smooth } from '../geo/height';
import { toonMaterial } from '../../rendering/materials';
import {upliftAt,waterLevelAt} from '../geo/relief';
import {makeTreeTrunk,makeTreeCanopy,makeValleyTree,makeValleyShrub,makeLeafTexture,makeCloverPatch,makeBankFlowerCluster,makeGrassTuft,valleyTreeCount} from './flora-geometry';
import {shoreDistanceAt} from '../geo/meadow-distribution';
import {valleyArtAt,valleyWoodland} from '../geo/valley-art';
import {bankField,riverbankEnabled,riverbankHabitatAt} from '../geo/riverbank-habitat';
import {bridgeArtEnabled,bridgeTrees} from '../geo/bridge-look';
import {art} from '../../config/art';
import {readArtStyle} from '../../config/settings';
import { bounds, riverSamplesAt, waterSurfaceAt } from '../geo/geo-core';
import { inBuildingLot } from '../biomes/building-layout';
import { bossTreeClearance, inBossTerritory } from '../geo/boss-territories';
import { peaklandWeight } from '../geo/peakland-plan';
import { isMountainPineHabitat,regionalHabitatAt } from '../geo/regional-habitat';
import { clearingCoverage } from '../geo/forest-clearing';
import { corridorTreesAt } from './corridor-trees';
import { ruinCenter,valleyFieldsAt } from '../geo/valley-landmarks';
import { bambooSeaRadius } from '../geo/regions';
import { makeShoreStoneGeometry, makeShoreStoneMaterial } from '../../rendering/shore-stone';
import { makePainterlyBarkMaterial, windify, type WindUniforms } from '../../rendering/foliage-wind';
import type { SurfaceWake } from '../../effects/surface-wake';
export { windify, type WindUniforms };

export type GuofengTreePair = {
    trunk: T.BufferGeometry;
    canopy: T.BufferGeometry;
    canopyFar: T.BufferGeometry;
};
export type GuofengTreeKit = {
    elm?: GuofengTreePair;
    pine?: GuofengTreePair;
    oak?: GuofengTreePair;
};
let sharedGuofengTreeKitPromise: Promise<GuofengTreeKit | undefined> | undefined;

/** Shared cached loader for the 3 Blender-modeled Guofeng tree GLBs (reused across all biomes). */
export function loadSharedGuofengTreeKit(): Promise<GuofengTreeKit | undefined> {
    if (typeof window === 'undefined') return Promise.resolve(undefined);
    if (!sharedGuofengTreeKitPromise) {
        const loader = new GLTFLoader();
        const loadPair = async (url: string): Promise<GuofengTreePair | undefined> => {
            const gltf = await loader.loadAsync(url);
            let trunk: T.BufferGeometry | undefined;
            let canopy: T.BufferGeometry | undefined;
            let canopyFar: T.BufferGeometry | undefined;
            gltf.scene.traverse(obj => {
                if (!(obj instanceof T.Mesh)) return;
                const g = obj.geometry.clone();
                g.computeBoundingBox();
                g.computeBoundingSphere();
                const lname = obj.name.toLowerCase();
                if (lname.includes('trunk')) trunk = g;
                else if (lname.includes('canopyfar')) canopyFar = g;
                else if (lname.includes('canopy')) canopy = g;
            });
            return trunk && canopy ? { trunk, canopy, canopyFar: canopyFar ?? canopy } : undefined;
        };
        const elmUrl = new URL('../../../resource/flora/guofeng_elm.glb', import.meta.url).href;
        const pineUrl = new URL('../../../resource/flora/guofeng_pine.glb', import.meta.url).href;
        const oakUrl = new URL('../../../resource/flora/guofeng_oak.glb', import.meta.url).href;
        sharedGuofengTreeKitPromise = Promise.all([
            loadPair(elmUrl),
            loadPair(pineUrl),
            loadPair(oakUrl),
        ]).then(([elm, pine, oak]) => ({ elm, pine, oak }))
            .catch(err => {
                console.warn('Guofeng Blender tree GLBs failed to load, keeping procedural fallback:', err);
                return undefined;
            });
    }
    return sharedGuofengTreeKitPromise;
}

/**
 * Instanced, procedurally modelled valley flora. Everything shares a handful of
 * geometries per chunk: sakura + pine trees, grass tufts, flowers, shrubs,
 * shoreline rocks and reeds. Wind and player wake are injected into the toon
 * materials so the CPU only updates a few uniforms per frame.
 */
export class Vegetation {
    private sakuraTrunk: T.BufferGeometry;
    private sakuraCrown: T.BufferGeometry;
    private pineTrunk: T.BufferGeometry;
    private pineCrown: T.BufferGeometry;
    private broadTrunk=makeTreeTrunk('broadleaf');
    private broadCrown=makeTreeCanopy('broadleaf');
    private broadMid=makeTreeCanopy('broadleaf',false);
    private sakuraMid=makeTreeCanopy('sakura',false);
    private pineMid=makeTreeCanopy('pine',false);
    private readonly isGuofeng = readArtStyle() === 'guofeng';
    private valleyTrees = Array.from({length:valleyTreeCount},(_,kind)=>({
        near:makeValleyTree(kind,true,this.isGuofeng), far:makeValleyTree(kind,false,this.isGuofeng),
    }));
    private leafTexture=makeLeafTexture(false,this.isGuofeng);
    private blossomTexture=makeLeafTexture(true);
    private leafDepth=new T.MeshDepthMaterial({
        map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .42,side:T.DoubleSide,depthPacking:T.RGBADepthPacking,
    });
    private blossomDepth=new T.MeshDepthMaterial({
        map:this.blossomTexture,alphaTest:.40,side:T.DoubleSide,depthPacking:T.RGBADepthPacking,
    });
    private broad=new T.MeshLambertMaterial({
        map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .42,alphaToCoverage:!this.isGuofeng,vertexColors:true,side:T.DoubleSide,
    });
    private valleyLeaves = new T.MeshLambertMaterial({map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .42,alphaToCoverage:!this.isGuofeng,vertexColors:true,side:T.DoubleSide});
    private valleyBark = makePainterlyBarkMaterial('#9c7e62');
    private valleyShrub=makeValleyShrub(this.isGuofeng);
    private cloverGeo=makeCloverPatch();
    private bankFlowerGeo=makeBankFlowerCluster();
    private bankSedgeGeo=makeGrassTuft(9);
    private cloverMat=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    private bankFlowerMat=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    private bankSedgeMat=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    private valleyBatches = new WeakMap<T.Group,{mesh:T.InstancedMesh;near:T.BufferGeometry;far:T.BufferGeometry;form?:number;part?:'trunk'|'canopy'}[]>();
    private activeValleyEntries = new Set<{mesh:T.InstancedMesh;near:T.BufferGeometry;far:T.BufferGeometry;form:number;part:'trunk'|'canopy'}>();
    private disposed = false;
    private grassFarGeo:T.BufferGeometry;
    private grassFar:T.MeshLambertMaterial;
    private rockGeo: T.BufferGeometry;
    private grassGeo: T.BufferGeometry;
    private flowerGeo: T.BufferGeometry;
    private reedGeo: T.BufferGeometry;
    private grassTexture: T.Texture;

    private bark: T.MeshLambertMaterial;
    private sakura: T.MeshLambertMaterial;
    private pine: T.MeshLambertMaterial;
    private grass: T.MeshLambertMaterial;
    private flower: T.MeshToonMaterial;
    private rock: T.MeshStandardMaterial;
    private pebble: T.MeshStandardMaterial;
    private reed: T.MeshToonMaterial;

    readonly uniforms:WindUniforms = {
        time: { value: 0 },
        player: { value: new T.Vector3() },
        playerVel: { value: new T.Vector3() },
    };

    constructor() {
        this.sakuraTrunk = makeSakuraTrunk();
        this.sakuraCrown = makeSakuraCrown();
        this.pineTrunk = makePineTrunk();
        this.pineCrown = makePineCrown();
        this.rockGeo = makeShoreStoneGeometry(2,2);
        this.grassTexture = makeGrassTexture();
        this.grassGeo = makeGrassCard();
        this.grassFarGeo = makeGrassCard();
        this.flowerGeo = makeFlower();
        this.reedGeo = makeBladeCluster(6, 1.5, 2.3, 0.026, 0.08);

        this.bark = makePainterlyBarkMaterial('#a8886b');
        this.sakura = new T.MeshLambertMaterial({
            map:this.blossomTexture,alphaTest:.36,alphaToCoverage:!this.isGuofeng,vertexColors:true,side:T.DoubleSide,
        });
        this.pine = new T.MeshLambertMaterial({
            map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .36,alphaToCoverage:!this.isGuofeng,vertexColors:true,side:T.DoubleSide,
        });
        this.grass = new T.MeshLambertMaterial({map:this.grassTexture,alphaTest:.28,alphaToCoverage:true,side:T.DoubleSide,vertexColors:true,color:'#ffffff'});
        this.grassFar = new T.MeshLambertMaterial({map:this.grassTexture,alphaTest:.32,alphaToCoverage:true,side:T.DoubleSide,vertexColors:true});
        this.flower = toonMaterial('#ffffff', { vertexColors: true, side: T.DoubleSide });
        this.rock = makeShoreStoneMaterial(.20);
        this.pebble = makeShoreStoneMaterial(.79);
        this.reed = toonMaterial('#ffffff', { vertexColors: true, side: T.DoubleSide });
        windify(this.sakura, this.uniforms, .16, 5.8);
        windify(this.pine, this.uniforms, .10, 6.5);
        windify(this.broad,this.uniforms,.18,6.3);
        windify(this.valleyLeaves,this.uniforms,.27,9.0);
        windify(this.grass, this.uniforms, 0.14, 1.0, true, true);
        windify(this.grassFar,this.uniforms,.10,1,true,true,true);
        windify(this.flower, this.uniforms, 0.07, 1.0, true);
        windify(this.reed, this.uniforms, 0.22, 1.0, true);
        windify(this.bankSedgeMat, this.uniforms, 0.18, 1.0, true);
        if (this.isGuofeng && typeof window !== 'undefined') {
            void this.loadGuofengTreeAssets();
        }
    }

    private async loadGuofengTreeAssets() {
        const kit = await loadSharedGuofengTreeKit();
        if (!kit || this.disposed) return;
        const { elm, pine, oak } = kit;
        const mapping = [elm, pine, oak, oak, pine];
        const oldGeos = new Set<T.BufferGeometry>();
        for (let form = 0; form < this.valleyTrees.length; form++) {
            const pair = mapping[form];
            if (!pair) continue;
            oldGeos.add(this.valleyTrees[form].near.trunk);
            oldGeos.add(this.valleyTrees[form].near.canopy);
            oldGeos.add(this.valleyTrees[form].far.trunk);
            oldGeos.add(this.valleyTrees[form].far.canopy);
            this.valleyTrees[form].near = { trunk: pair.trunk, canopy: pair.canopy };
            this.valleyTrees[form].far = { trunk: pair.trunk, canopy: pair.canopyFar };
            for (const entry of this.activeValleyEntries) {
                if (entry.form !== form) continue;
                const nextNear = entry.part === 'trunk' ? pair.trunk : pair.canopy;
                const nextFar = entry.part === 'trunk' ? pair.trunk : pair.canopyFar;
                const wasFar = entry.mesh.geometry === entry.far;
                entry.near = nextNear;
                entry.far = nextFar;
                entry.mesh.geometry = wasFar ? nextFar : nextNear;
            }
        }
        // Also upgrade upland broadleaf & mountain pine trees across high ridges (霁雪天阶, 丹枫峡, 青崖峰林)
        if (oak) {
            oldGeos.add(this.broadTrunk);
            oldGeos.add(this.broadCrown);
            oldGeos.add(this.broadMid);
            this.broadTrunk = oak.trunk;
            this.broadCrown = oak.canopy;
            this.broadMid = oak.canopyFar;
            for (const entry of this.activeValleyEntries) {
                if (entry.form !== 100) continue;
                const nextNear = entry.part === 'trunk' ? oak.trunk : oak.canopy;
                const nextFar = entry.part === 'trunk' ? oak.trunk : oak.canopyFar;
                const wasFar = entry.mesh.geometry === entry.far;
                entry.near = nextNear;
                entry.far = nextFar;
                entry.mesh.geometry = wasFar ? nextFar : nextNear;
            }
        }
        if (pine) {
            oldGeos.add(this.pineTrunk);
            oldGeos.add(this.pineCrown);
            oldGeos.add(this.pineMid);
            this.pineTrunk = pine.trunk;
            this.pineCrown = pine.canopy;
            this.pineMid = pine.canopyFar;
            for (const entry of this.activeValleyEntries) {
                if (entry.form !== 101) continue;
                const nextNear = entry.part === 'trunk' ? pine.trunk : pine.canopy;
                const nextFar = entry.part === 'trunk' ? pine.trunk : pine.canopyFar;
                const wasFar = entry.mesh.geometry === entry.far;
                entry.near = nextNear;
                entry.far = nextFar;
                entry.mesh.geometry = wasFar ? nextFar : nextNear;
            }
        }
        oldGeos.forEach(g => g.dispose());
    }

    create(x: number, z: number, density: number,lod=0,groundGrass=true): T.Group {
        const group = new T.Group(), dummy = new T.Object3D(), color = new T.Color(), sakuraAlt = new T.Color('#ffc3d9');
        const sakuraTrees: number[][] = [], pineTrees: number[][] = [],broadTrees:number[][]=[], grasses: number[][] = [], flowers: number[][] = [], rocks: number[][] = [], reeds: number[][] = [];
        const valleyTrees: number[][][] = Array.from({length:valleyTreeCount},()=>[]);
        const pebbles: number[][]=[], shrubs: number[][]=[], clovers: number[][]=[], bankFlowers: number[][]=[], bankSedges: number[][]=[];
        const treeAttempts = Math.max(10, Math.round(art.treeAttempts * density));
        const corridor=corridorTreesAt(x/128,z/128);
        for(const tree of corridor){
            const batch=tree.kind==='pine'?pineTrees:tree.kind==='sakura'?sakuraTrees:broadTrees;
            batch.push([tree.x,tree.y,tree.z,tree.scale]);
        }

        const valleyChunk=[0,64,128].some(dx=>[0,64,128].some(dz=>valleyArtAt(x+dx,z+dz)>.02));
        // Peakland flora is authored separately by PeaklandFlora; skip redundant per-chunk ground loops when wholly inside Peakland.
        if (!valleyChunk && corridor.length === 0
            && peaklandWeight(x + 64, z + 64) > .68
            && peaklandWeight(x, z) > .68 && peaklandWeight(x + 128, z) > .68
            && peaklandWeight(x, z + 128) > .68 && peaklandWeight(x + 128, z + 128) > .68) {
            return group;
        }
        const candidates=Math.ceil(treeAttempts*(valleyChunk?1.58:1.42));
        const bankChunk = riverbankEnabled && x + 128 > bankField.left && x < bankField.left + (bankField.width - 1) * bankField.step
            && z + 128 > bankField.north && z < bankField.north + (bankField.depth - 1) * bankField.step;
        const groveCandidates = bankChunk ? treeAttempts * 2 : 0;
        for (let i = 0; i < candidates + groveCandidates; i++) {
            const px = x + randomAt(x + i, z, 1) * 128, pz = z + randomAt(x, z + i, 2) * 128, h = heightAt(px, pz);
            if (h > upliftAt(pz)+180 || trailDistance(px, pz) < 4.5 || peaklandWeight(px,pz) > .63)
                continue;
            if (bridgeArtEnabled && bridgeTrees.some(tree=>Math.hypot(px-tree.x,pz-tree.z)<tree.width*1.2))
                continue;
            if (clearingCoverage(px,pz)>.46)
                continue;
            if(valleyFieldsAt(px,pz)>.12||Math.hypot(px-ruinCenter.x,pz-ruinCenter.z)<ruinCenter.radius+3)
                continue;
            if(bambooSeaRadius(px,pz)<.94)
                continue;
            if(corridor.some(tree=>Math.hypot(px-tree.x,pz-tree.z)<4.7))
                continue;
            const slope = slopeAt(px, pz);
            if (slope > 0.78)
                continue;
            const grove = fbm(px*.008,pz*.008,2,61);
            const upgrade = valleyArtAt(px,pz);
            const valley = randomAt(px,pz,222) < upgrade;
            const bank = valley ? riverbankHabitatAt(px,pz) : undefined;
            const oldMoisture = valley ? Math.exp(-Math.max(0,shoreDistanceAt(px,pz))/32) : 0;
            const baseWoodland = valley ? valleyWoodland(px,pz,oldMoisture) : 0;
            const woodland = bank ? T.MathUtils.lerp(baseWoodland,bank.woodland,bank.blend) : baseWoodland;
            const moisture = bank ? T.MathUtils.lerp(oldMoisture,bank.moisture,bank.blend) : oldMoisture;
            const extra = i >= candidates;
            const chance = extra ? (bank?.blend ?? 0) * smooth(.26,.71,woodland) * .86
                : T.MathUtils.lerp(.09+.87*baseWoodland,.04+.91*woodland,bank?.blend ?? 0);
            const region=valley||extra?undefined:regionalHabitatAt(px,pz,h,slope,shoreDistanceAt(px,pz));
            if(!valley&&i>=treeAttempts&&(!region||region.strength<.22))continue;
            const regionalChance=region ? (1-region.strength)*(grove>=.35?1:0)
                +region.strength*(.13+.84*smooth(.05,.65,region.woodland)) : 0;
            if (randomAt(px,pz,25) >= (valley||extra?chance:regionalChance))
                continue;
            const scale = .75 + randomAt(px, pz, 3) * .85;
            if (!canPlantTree(px, pz, 1.65 * scale) || inBuildingLot(px,pz,4.6*scale) || bossTreeClearance(px, pz, 4.5 * scale))
                continue;
            const pinkGrove=Math.hypot((px-690)/360,(pz+460)/430)<1 || Math.hypot((px-110)/160,(pz+230)/220)<1;
            const pineSuit=isMountainPineHabitat(pz,h,slope);
            if (valley && !pineSuit) {
                if (valleyTrees.some(batch=>batch.some(([x,,z])=>Math.hypot(px-x,pz-z)<4.2))) continue;
                const rank = randomAt(px,pz,24);
                const form = moisture > .58 ? 4 : woodland < .24 ? (rank < .51 ? 0 : 1) : rank < .25 ? 0 : rank < .48 ? 1 : rank < .77 ? 2 : 3;
                valleyTrees[form].push([px,h,pz,scale]);
                continue;
            }
            (pineSuit?pineTrees:pinkGrove&&randomAt(px,pz,24)>.2?sakuraTrees:broadTrees).push([px,h,pz,scale]);
        }

        // Ground grass now has its own bounded GPU shells; retain this path for other surfaces.
        const grassAttempts = groundGrass ? Math.floor((lod===0?art.grassNearAttempts:art.grassMidAttempts)*density) : 0;
        const grid=Math.ceil(Math.sqrt(grassAttempts));
        for (let i = 0; i < grassAttempts; i++) {
            const px=x+(i%grid+.1+.8*randomAt(x+i,z,3))/grid*128;
            const pz=z+(Math.floor(i/grid)+.1+.8*randomAt(x,z+i,4))/grid*128;
            const h = heightAt(px, pz);
            if (h < waterLevelAt(pz)+1.1 || h > upliftAt(pz)+175 || trailDistance(px, pz) < 2.2)
                continue;
            const slope=slopeAt(px,pz),altitude=h-waterLevelAt(pz),fertility=(1-smooth(.42,1.05,slope))*(1-smooth(120,260,altitude));
            if(randomAt(px,pz,83)>fertility*.9)continue;
            const scale = .68 + randomAt(px, pz, 5) * .72;
            if(groundGrass)grasses.push([px, h, pz, scale]);
            if (groundGrass && i % 80 === 0 && altitude < 100)
                flowers.push([px, h, pz, .95 + randomAt(px, pz, 6) * .75]);
        }

        for (let i = 0; i < Math.max(8, Math.round(38 * density)); i++) {
            const px = x + randomAt(x + i, z, 10) * 128, pz = z + randomAt(x, z + i, 11) * 128, h = heightAt(px, pz);
            if (h < waterHeight + .1 || h > 82)
                continue;
            const slope = slopeAt(px, pz);
            const gfMeadowStone = this.isGuofeng && valleyArtAt(px, pz) > .25 && trailDistance(px, pz) > 6 && !inBuildingLot(px, pz, 5) && randomAt(px, pz, 118) > .68;
            if (!gfMeadowStone && slope < .38 && h > 6)
                continue;
            rocks.push([px, h, pz, .35 + randomAt(px, pz, 12) * 1.25]);
        }

        for (let i = 0; i < Math.max(10, Math.round(80 * density)); i++) {
            const px = x + randomAt(x + i, z, 13) * 128, pz = z + randomAt(x, z + i, 14) * 128, h = heightAt(px, pz);
            if (h < waterHeight + .05 || h > 5.2 || Math.abs(px - riverX(pz)) > 44)
                continue;
            reeds.push([px, h, pz, .7 + randomAt(px, pz, 15) * .8]);
        }

        // Tabular stones mark exposed bends and shoals along the valley channels.
        for(const {id,a} of riverSamplesAt(x+64,z+64)){
            if((id!=='main'&&id!=='sakura-creek')||a.z < -900||a.z > 640)continue;
            for(const side of [-1,1]){
                const rank=randomAt(a.x,a.z,880+side);
                if(rank<.38)continue;
                const offset=a.halfWidth*side*(.89+.29*rank);
                const px=a.x-a.flowZ*offset,pz=a.z+a.flowX*offset;
                if(px<x||px>=x+128||pz<z||pz>=z+128||trailDistance(px,pz)<5)continue;
                const terrain=heightAt(px,pz);
                if(terrain<a.waterLevel-1.75||terrain>a.waterLevel+3.1)continue;
                const scale=.65+2.15*rank**3;
                pebbles.push([px,terrain,pz,scale]);
                if(rank>.75&&terrain>a.waterLevel+.5)
                    shrubs.push([px,terrain,pz,1.3+rank*.9]);
            }
        }

        // A jittered grid follows the existing water footprint, including tributaries.
        const bankGrid=Math.ceil(Math.sqrt(520*density));
        for(let i=0;i<bankGrid*bankGrid;i++){
            const px=x+(i%bankGrid+randomAt(x+i,z,99))*128/bankGrid;
            const pz=z+(Math.floor(i/bankGrid)+randomAt(x,z+i,100))*128/bankGrid;
            const upgrade=valleyArtAt(px,pz);
            if(randomAt(px,pz,98)>=upgrade||trailDistance(px,pz)<3.6||inBuildingLot(px,pz,1.4))continue;
            const roll=randomAt(px,pz,104);
            const shore=shoreDistanceAt(px,pz);
            if(shore>-1.2&&shore<13.5){
                const water=waterSurfaceAt(px,pz,14), height=heightAt(px,pz);
                if(Number.isFinite(water)&&height>water-.28&&height<water+5.6){
                    const size=.18+.68*roll*roll;
                    if(shore<4.5&&(roll<.36||height<water+.16))pebbles.push([px,height,pz,size]);
                    else if(roll<.68)bankSedges.push([px,height-.04,pz,.85+randomAt(px,pz,106)*1.05]);
                    else if(roll<.84){
                        if(!this.isGuofeng || randomAt(px,pz,119)<.30)
                            bankFlowers.push([px,height-.02,pz,.65+randomAt(px,pz,109)*.62]);
                    }
                    else if(roll<.93)clovers.push([px,height,pz,.80+randomAt(px,pz,110)*.65]);
                    else if(Math.hypot(px-79,pz-160)>14)shrubs.push([px,height-.06,pz,.68+randomAt(px,pz,107)*.68]);
                }
            }
            else if(slopeAt(px,pz)<.57){
                const height=heightAt(px,pz);
                if(roll>.82&&roll<=.93&&trailDistance(px,pz)<16)
                    clovers.push([px,height,pz,.85+randomAt(px,pz,111)*.75]);
                else if(roll>.935){
                    const oldWoodland=valleyWoodland(px,pz,Math.exp(-Math.max(0,shore)/36));
                    const bank=riverbankHabitatAt(px,pz);
                    const woodland=bank ? T.MathUtils.lerp(oldWoodland,bank.woodland,bank.blend) : oldWoodland;
                    if(woodland>(bank ? .22-.04*bank.blend : .22)&&woodland<.86)
                        shrubs.push([px,height-.05,pz,.60+randomAt(px,pz,108)*1.05]);
                }
            }
        }

        // Lush stylized woodland bushes hugging select broadleaf bases and dotted across rolling meadows.
        for (const [tx, , tz, ts] of broadTrees) {
            if (randomAt(tx, tz, 412) > .62) continue;
            const angle = randomAt(tx, tz, 413) * 6.283;
            const dist = 2.2 + randomAt(tx, tz, 414) * 4.2 * ts;
            const sx = tx + Math.cos(angle) * dist, sz = tz + Math.sin(angle) * dist;
            if (trailDistance(sx, sz) < 3.6 || inBuildingLot(sx, sz, 2.2) || !canPlantTree(sx, sz, .65)) continue;
            const sy = heightAt(sx, sz);
            if (slopeAt(sx, sz) > .52 || sy > upliftAt(sz) + 150) continue;
            shrubs.push([sx, sy - .06, sz, 1.10 + randomAt(sx, sz, 415) * 1.05]);
        }
        const meadowShrubAttempts = Math.max(12, Math.round(42 * density));
        for (let i = 0; i < meadowShrubAttempts; i++) {
            const sx = x + randomAt(x + i, z, 421) * 128, sz = z + randomAt(x, z + i, 422) * 128;
            if (trailDistance(sx, sz) < 4.0 || inBuildingLot(sx, sz, 2.5) || bossTreeClearance(sx, sz, 2.0) || peaklandWeight(sx, sz) > .55) continue;
            if (bambooSeaRadius(sx, sz) < .92 || valleyFieldsAt(sx, sz) > .12 || clearingCoverage(sx, sz) > .42) continue;
            const sy = heightAt(sx, sz);
            if (sy < waterLevelAt(sz) + 1.4 || sy > upliftAt(sz) + 145 || !canPlantTree(sx, sz, .7)) continue;
            const slope = slopeAt(sx, sz);
            if (slope > .48) continue;
            const region = regionalHabitatAt(sx, sz, sy, slope, shoreDistanceAt(sx, sz));
            if (randomAt(sx, sz, 423) > .30 + region.woodland * .52) continue;
            shrubs.push([sx, sy - .08, sz, .95 + randomAt(sx, sz, 424) * 1.25]);
        }

        const batch = (geometry: T.BufferGeometry, material: T.Material, points: number[][], kind: number, valleyForm?: number) => {
            points = points.filter(([x,,z]) => x >= bounds.left && x <= bounds.right && z >= bounds.north && z <= bounds.south);
            if (!points.length)
                return;
            const mesh = new T.InstancedMesh(geometry, material, points.length);
            mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
            if ((kind === -1 || kind === 5 || kind === 9) && !geometry.boundingBox) geometry.computeBoundingBox();
            const baseBox = (kind === -1 || kind === 5 || kind === 9) ? geometry.boundingBox! : undefined;
            const box = new T.Box3();
            let k = 0;
            for (const [px, h, pz, s] of points) {
                dummy.position.set(px, h, pz);
                const tree = kind===0 || kind===1 || kind===7 || kind===8;
                dummy.rotation.set(0, randomAt(px, pz, tree?29:30 + kind) * 6.283, 0);
                dummy.scale.setScalar(s);
                if (kind === 0) {
                    dummy.scale.set(s, s * (.9 + randomAt(px, pz, 31) * .25), s);
                    if(px < -360 && pz < -100 && pz > -1000) {
                        color.set(this.isGuofeng ? '#c8663a' : '#f69b60').multiplyScalar(.88+randomAt(px,pz,33)*.22);
                    } else if (this.isGuofeng) {
                        color.set('#e8c8ce').lerp(new T.Color('#d6a8b6'), randomAt(px, pz, 32))
                            .multiplyScalar(.92 + randomAt(px, pz, 34) * .14);
                    } else {
                        color.set('#ffd9e5').lerp(sakuraAlt,randomAt(px,pz,32))
                            .multiplyScalar(.91+randomAt(px,pz,34)*.17);
                    }
                }
                else if (kind === 1) {
                    dummy.scale.set(s * .9, s * (.9 + randomAt(px, pz, 35) * .3), s * .9);
                    if (this.isGuofeng) {
                        color.setHSL(.34 + randomAt(px, pz, 36) * .05, .20 + randomAt(px, pz, 37) * .10, .44 + randomAt(px, pz, 38) * .12);
                    } else {
                        color.setHSL(.36 + randomAt(px, pz, 36) * .06, .26 + randomAt(px, pz, 37) * .14, .46 + randomAt(px, pz, 38) * .14);
                    }
                }
                else if (kind === 2) {
                    dummy.position.y-=.08;dummy.scale.set(s * 1.1, s * (.72 + randomAt(px, pz, 39) * .3), s * 1.1);
                    dummy.rotation.z = (randomAt(px, pz, 39) - .5) * .12;
                    color.setHSL(.225 + randomAt(px, pz, 40) * .055, .38 + randomAt(px, pz, 41) * .16, .37 + randomAt(px, pz, 42) * .11);
                }
                else if (kind === 3) {
                    const palette = [[.96, .72, .66], [.03, .65, .72], [.13, .70, .70], [.16, .62, .76], [.10, .35, .82], [.92, .55, .72]];
                    const pick = palette[Math.floor(randomAt(px, pz, 43) * palette.length)];
                    color.setHSL(pick[0], pick[1], pick[2] + randomAt(px, pz, 44) * .05);
                    dummy.position.y += .30;
                    dummy.scale.setScalar(s * 1.15);
                }
                else if (kind === 5) {
                    dummy.scale.y*=.73;
                    color.setHSL(.54, .07, .48 + randomAt(px, pz, 50) * .17);
                    dummy.rotation.set(randomAt(px, pz, 51) * .5, randomAt(px, pz, 52) * 6.283, randomAt(px, pz, 53) * .5);
                }
                else if(kind===7){
                    dummy.scale.set(s*(1.05+randomAt(px,pz,85)*.3),s*(.96+randomAt(px,pz,87)*.22),s*.98);
                    if(px < -360 && pz < -100 && pz > -1000) {
                        const autumn = this.isGuofeng
                            ? ['#e26d46','#ee964c','#f0c05a','#cf583e','#e4a44e']
                            : ['#fa8054','#f5a953','#ffe36d','#eb6a53','#fac66c'];
                        color.set(autumn[Math.floor(randomAt(px,pz,86)*autumn.length)])
                            .multiplyScalar(this.isGuofeng ? (.98+randomAt(px,pz,88)*.16) : (1.20+randomAt(px,pz,88)*.35));
                    } else if (this.isGuofeng) {
                        const guofeng=['#b0c488','#9cb680','#bccb8e','#8eac80','#c2cf92','#96b084'];
                        const pick = Math.floor(randomAt(px,pz,86)*guofeng.length);
                        color.set(guofeng[pick]).multiplyScalar(.96+randomAt(px,pz,88)*.16);
                    } else {
                        // Painterly sunlit chartreuse-lime, fresh emerald, and dreamy ocean-teal canopies.
                        const ghibli=['#e0f78e','#c8f080','#9de088','#78cf96','#3eaeb6','#2f98ad','#d4f488'];
                        const pick = Math.floor(randomAt(px,pz,86)*ghibli.length);
                        color.set(ghibli[pick]).multiplyScalar(.96+randomAt(px,pz,88)*.18);
                    }
                }
                else if(kind===8) {
                    const palette = this.isGuofeng
                        ? ['#b6c88a','#a2ba82','#90ae80','#c2ce8e','#88a684']
                        : ['#d4ee82','#a8df84','#7fd18e','#c8eb7c','#4cb3a4'];
                    color.set(palette[valleyForm!]).multiplyScalar(.96+randomAt(px,pz,93)*.16);
                }
                else if(kind===9) {
                    dummy.scale.set(s*1.30,s*.48,s);
                    dummy.position.y-=s*.12;
                    color.set('#8d8e7e').lerp(new T.Color('#85755c'),randomAt(px,pz,121)).multiplyScalar(.71+randomAt(px,pz,122)*.30);
                }
                else if(kind===10) {
                    dummy.scale.set(s*(this.isGuofeng ? 1.18 : 1.12),s*(this.isGuofeng ? .70 : .78),s*(this.isGuofeng ? 1.04 : 1.12));
                    const shrubPalette = this.isGuofeng
                        ? ['#849764','#728960','#929d68','#687e60','#7e8f66']
                        : ['#a8e072','#78ca84','#52b292','#90d67c','#449f96'];
                    color.set(shrubPalette[Math.floor(randomAt(px,pz,123)*shrubPalette.length)])
                        .multiplyScalar(.90+randomAt(px,pz,124)*.20);
                }
                else if(kind===11) {
                    dummy.scale.set(s*1.15,s*.95,s*1.15);
                    const cA = this.isGuofeng ? '#4b633c' : '#73be46';
                    const cB = this.isGuofeng ? '#324a34' : '#4b9c42';
                    color.set(cA).lerp(new T.Color(cB),randomAt(px,pz,125))
                        .multiplyScalar(.92+randomAt(px,pz,126)*.18);
                }
                else if(kind===12) {
                    dummy.scale.set(s*1.05,s*1.02,s*1.05);
                    const bankBlooms = this.isGuofeng
                        ? ['#f0ece2','#e5d89e','#f4f1e8','#9bcbb8']
                        : ['#ffe44d','#fffaf0','#66b8ff','#ff8db8','#be92ff'];
                    color.set(bankBlooms[Math.floor(randomAt(px,pz,127)*bankBlooms.length)])
                        .multiplyScalar(.96+randomAt(px,pz,128)*.10);
                }
                else if(kind===13) {
                    dummy.scale.set(s*1.08,s*1.35,s*1.08);
                    const sA = this.isGuofeng ? '#5e7042' : '#a8de54';
                    const sB = this.isGuofeng ? '#304935' : '#48a04b';
                    color.set(sA).lerp(new T.Color(sB),randomAt(px,pz,129))
                        .multiplyScalar(.92+randomAt(px,pz,130)*.18);
                }
                else {
                    color.setHSL(.18 + randomAt(px, pz, 54) * .07, .30 + randomAt(px, pz, 55) * .12, .38 + randomAt(px, pz, 56) * .14);
                }
                dummy.updateMatrix();
                mesh.setMatrixAt(k, dummy.matrix);
                // Collision follows the transformed instance, not a separate placement pass.
                if(baseBox){
                    box.copy(baseBox).applyMatrix4(dummy.matrix);
                    if(kind===5 || kind===9){
                        addBoulderSolid(group,box.min.x,box.max.x,box.min.y,box.max.y,box.min.z,box.max.z,h);
                    }
                    else {const r=.32*s;addSolid(group,{minX:px-r,maxX:px+r,minY:h,maxY:Math.min(box.max.y,h+4*s),minZ:pz-r,maxZ:pz+r,radius:r});}
                }
                if (kind >= 0)
                    mesh.setColorAt(k, color);
                k++;
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor)
                mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.boundingSphere!.radius+=.6;
            // Only trees & large rocks cast shadows; skip alpha-tested shrub shadow passes to save ~35% shadow-map fill.
            mesh.castShadow = kind !== 2 && kind !== 3 && kind !== 6 && kind !== 9 && kind < 10;
            mesh.receiveShadow = kind === -1 || kind === 0 || kind === 1 || (kind === 2&&lod===0) || kind === 5 || kind === 7 || kind === 8;
            if (kind === 0) mesh.customDepthMaterial = this.blossomDepth;
            else if (kind === 1 || kind === 7 || kind === 8 || kind === 10) mesh.customDepthMaterial = this.leafDepth;
            group.add(mesh);
            return mesh;
        };

        const detailBatches: NonNullable<ReturnType<typeof this.valleyBatches.get>> = [];
        batch(this.sakuraTrunk, this.bark, sakuraTrees, -1);
        const blossoms=batch(this.sakuraCrown, this.sakura, sakuraTrees, 0);
        if(blossoms)detailBatches.push({mesh:blossoms,near:this.sakuraCrown,far:this.sakuraMid});
        const pineT = batch(this.pineTrunk, this.bark, pineTrees, -1);
        const pines = batch(this.pineCrown, this.pine, pineTrees, 1);
        if (pineT && pines) {
            const ptEntry = { mesh: pineT, near: this.pineTrunk, far: this.pineTrunk, form: 101, part: 'trunk' as const };
            const pcEntry = { mesh: pines, near: this.pineCrown, far: this.pineMid, form: 101, part: 'canopy' as const };
            detailBatches.push(ptEntry, pcEntry);
            this.activeValleyEntries.add(ptEntry);
            this.activeValleyEntries.add(pcEntry);
        }
        const broadT = batch(this.broadTrunk, this.bark, broadTrees, -1);
        const broad = batch(this.broadCrown, this.broad, broadTrees, 7);
        if (broadT && broad) {
            const btEntry = { mesh: broadT, near: this.broadTrunk, far: this.broadTrunk, form: 100, part: 'trunk' as const };
            const bcEntry = { mesh: broad, near: this.broadCrown, far: this.broadMid, form: 100, part: 'canopy' as const };
            detailBatches.push(btEntry, bcEntry);
            this.activeValleyEntries.add(btEntry);
            this.activeValleyEntries.add(bcEntry);
        }
        for (const [form,points] of valleyTrees.entries()){
            const {near,far}=this.valleyTrees[form];
            const trunk=batch(near.trunk,this.valleyBark,points,-1);
            const canopy=batch(near.canopy,this.valleyLeaves,points,8,form);
            if(trunk&&canopy){
                const tEntry = {mesh:trunk,near:near.trunk,far:far.trunk,form,part:'trunk' as const};
                const cEntry = {mesh:canopy,near:near.canopy,far:far.canopy,form,part:'canopy' as const};
                detailBatches.push(tEntry,cEntry);
                this.activeValleyEntries.add(tEntry);
                this.activeValleyEntries.add(cEntry);
            }
        }
        if(detailBatches.length)this.valleyBatches.set(group,detailBatches);
        batch(lod===0?this.grassGeo:this.grassFarGeo, lod===0?this.grass:this.grassFar, grasses, 2);
        batch(this.flowerGeo, this.flower, flowers, 3);
        batch(this.rockGeo, this.rock, rocks, 5);
        batch(this.reedGeo, this.reed, reeds, 6);
        batch(this.rockGeo,this.pebble,pebbles,9);
        batch(this.valleyShrub,this.valleyLeaves,shrubs,10);
        batch(this.cloverGeo,this.cloverMat,clovers,11);
        batch(this.bankFlowerGeo,this.bankFlowerMat,bankFlowers,12);
        batch(this.bankSedgeGeo,this.bankSedgeMat,bankSedges,13);
        return group;
    }

    setWake(wake:SurfaceWake){this.uniforms.wakeTexture=wake.uniforms.uWakeTex;this.uniforms.wakeWindow=wake.uniforms.uWake;}
    updateDetail(group: T.Group, camera: T.Camera, range: number) {
        const batches=this.valleyBatches.get(group);
        if(batches){
            for(const {mesh,near,far} of batches) {
                const distance=mesh.boundingSphere!.distanceToPoint(camera.position);
                const useFar=distance>range+(mesh.geometry===far?-13:13);
                mesh.geometry=useFar?far:near;
                mesh.castShadow=distance<78;
            }
        }
        // Only cast shadows inside the directional sun's ±70 m shadow frustum.
        for(const child of group.children){
            if(!(child instanceof T.InstancedMesh)||!child.boundingSphere)continue;
            if(child.castShadow||child.userData.shadowCaster){
                child.userData.shadowCaster=true;
                child.castShadow=child.boundingSphere.distanceToPoint(camera.position)<78;
            }
        }
    }
    update(time:number,position:T.Vector3,velocity:T.Vector3,_clearance:number){this.uniforms.time.value=time;this.uniforms.player.value.copy(position);this.uniforms.playerVel.value.copy(velocity);}
    release(g: T.Group) {
        releaseSolids(g);
        const batches = this.valleyBatches.get(g);
        if (batches) {
            for (const entry of batches) {
                if (entry.form !== undefined && entry.part !== undefined) {
                    this.activeValleyEntries.delete(entry as {mesh:T.InstancedMesh;near:T.BufferGeometry;far:T.BufferGeometry;form:number;part:'trunk'|'canopy'});
                }
            }
        }
        g.traverse(o => {
            if (o instanceof T.InstancedMesh)
                o.dispose();
        });
    }

    dispose() {
        this.disposed = true;
        this.activeValleyEntries.clear();
        const uniqueGeos = new Set<T.BufferGeometry>();
        for(const {near,far} of this.valleyTrees)for(const {trunk,canopy} of [near,far]){
            uniqueGeos.add(trunk);
            uniqueGeos.add(canopy);
        }
        uniqueGeos.forEach(g => g.dispose());
        this.valleyLeaves.dispose();this.leafTexture.dispose();
        this.blossomTexture.dispose();
        this.leafDepth.dispose();
        this.blossomDepth.dispose();
        this.valleyBark.dispose();
        this.valleyShrub.dispose();
        this.cloverGeo.dispose();this.bankFlowerGeo.dispose();this.bankSedgeGeo.dispose();
        this.cloverMat.dispose();this.bankFlowerMat.dispose();this.bankSedgeMat.dispose();
        this.broadMid.dispose();this.sakuraMid.dispose();this.pineMid.dispose();
        for (const g of [this.sakuraTrunk, this.sakuraCrown, this.pineTrunk, this.pineCrown, this.broadTrunk,this.broadCrown,this.grassFarGeo,this.rockGeo, this.grassGeo, this.flowerGeo, this.reedGeo])
            g.dispose();
        for (const m of [this.bark, this.sakura, this.pine, this.broad,this.grassFar,this.grass, this.flower, this.rock, this.pebble, this.reed])
            m.dispose();
        this.grassTexture.dispose();
    }
}

export function makeSakuraTrunk() { return makeTreeTrunk('sakura'); }

export function makeSakuraCrown() { return makeTreeCanopy('sakura'); }

function makePineTrunk() { return makeTreeTrunk('pine'); }

function makePineCrown() { return makeTreeCanopy('pine'); }


/** Painted alpha card: several tapered blades on transparency, tinted per instance. */
export function makeGrassTexture() {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;
 for(let i=0;i<46;i++){const x=22+randomAt(i,7,70)*212,h=70+randomAt(i,8,71)*165,bend=(randomAt(i,9,72)-.5)*100,w=3+randomAt(i,10,73)*5;const gradient=ctx.createLinearGradient(x,256,x+bend,256-h);gradient.addColorStop(0,'#899465');gradient.addColorStop(.4,'#ced5a0');gradient.addColorStop(1,'#fff5ca');ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(x-w,256);ctx.bezierCurveTo(x-w,256-h*.5,x+bend-w,256-h*.88,x+bend,256-h);ctx.bezierCurveTo(x+bend+w,256-h*.80,x+w,256-h*.33,x+w,256);ctx.closePath();ctx.fill();}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;return texture;
}

/** Two crossed alpha cards; far cheaper than modelling every blade. */
export function makeGrassCard() {
    const a = new T.PlaneGeometry(1.25, .9,1,2);
    a.translate(0, .45, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const merged = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    const position = merged.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
        const shade = .60 + .60 * T.MathUtils.clamp(position.getY(i), 0, 1);
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
    }
    merged.setAttribute('color', new T.BufferAttribute(colors, 3));
    merged.computeVertexNormals();
    return merged;
}

/** A tuft of tapered blades with baked base-to-tip vertex shading. */
function makeBladeCluster(count: number, minHeight: number, maxHeight: number, width: number, spread: number) {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let b = 0; b < count; b++) {
        const a = b / count * Math.PI * 2 + .4;
        const dx = Math.cos(a), dz = Math.sin(a);
        const h = minHeight + randomAt(b, count, 60) * (maxHeight - minHeight);
        const spreadR = spread * (.7 + .6 * randomAt(b, count, 61));
        const w = width * (.8 + .5 * randomAt(b, count, 62));
        const bx = dx * spreadR, bz = dz * spreadR;
        const mx = bx + dx * h * .10, mz = bz + dz * h * .10;
        const tx = bx + dx * h * .26, tz = bz + dz * h * .26;
        const base = positions.length / 3;
        positions.push(bx - dz * w, 0, bz + dx * w, bx + dz * w, 0, bz - dx * w);
        positions.push(mx - dz * w * .62, h * .55, mz + dx * w * .62, mx + dz * w * .62, h * .55, mz - dx * w * .62);
        positions.push(tx, h, tz);
        for (const shade of [.52, .52, .82, .82, 1.12])
            colors.push(shade, shade, shade);
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
}

export function makeFlower() {
    const positions: number[] = [], indices: number[] = [];
    for (let b = 0; b < 3; b++) {
        const a0 = b * 2.1;
        const cx = Math.cos(a0) * .075, cz = Math.sin(a0) * .075, cy = .12 + b * .028;
        for (let p = 0; p < 5; p++) {
            const a = p / 5 * Math.PI * 2 + b * .7;
            const base = positions.length / 3;
            positions.push(cx, cy, cz);
            positions.push(cx + Math.cos(a - .42) * .055, cy + .018, cz + Math.sin(a - .42) * .055);
            positions.push(cx + Math.cos(a) * .115, cy + .052, cz + Math.sin(a) * .115);
            positions.push(cx + Math.cos(a + .42) * .055, cy + .018, cz + Math.sin(a + .42) * .055);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    // Baked darker base / brighter petal tips; instance colour supplies the hue.
    const n = positions.length / 3, color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const shade = positions[i * 3 + 1] > .15 ? 1.15 : .82;
        color[i * 3] = color[i * 3 + 1] = color[i * 3 + 2] = shade;
    }
    g.setAttribute('color', new T.BufferAttribute(color, 3));
    return g;
}

