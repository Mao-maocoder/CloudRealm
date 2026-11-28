import * as T from 'three';
import { heightAt, slopeAt } from '../geo/height';
import { waterSurfaceAt } from '../geo/geo-core';
import { formations, geologyRandom, gorgeDistance, peakCreek, terraces } from '../geo/peakland-plan';
import { rockPoint, rockSupport } from '../biomes/peakland-rock';
import { makeLeafTexture, makeTreeCanopy, makeTreeTrunk, makeValleyShrub } from './flora-geometry';
import { loadSharedGuofengTreeKit, windify, type WindUniforms } from './vegetation';
import { readArtStyle } from '../../config/settings';

type Plant = 'pine' | 'broadleaf' | 'shrub' | 'stone';
type Placement = { x:number; y:number; z:number; size:number; angle:number; lean:number; green:number };
type Tile = { x:number; z:number; kind:Plant; plants:Placement[] };

function stoneGeometry(detailed: boolean) {
    const geo = new T.IcosahedronGeometry(1, detailed ? 1 : 0).scale(1.04, .63, .84).translate(0, .31, 0);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const lift = .68 + .24 * T.MathUtils.clamp(pos.getY(i), 0, 1);
        colors[i * 3] = lift * .60;
        colors[i * 3 + 1] = lift * .58;
        colors[i * 3 + 2] = lift * .50;
    }
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    return geo;
}

const rockSamples=formations.map(p=>({p, shape:rockSupport(p)}));
// Spatial index for the "is this candidate inside/next to another pillar" test.
// The old code scanned all ~228 formations for every plant candidate.
type RockSample=typeof rockSamples[number];
const rockCell=256;
const rockGrid=new Map<string,RockSample[]>();
const noRocks:RockSample[]=[];
for(const sample of rockSamples){
    const p=sample.p,padX=p.rx*1.7,padZ=p.rz*1.9;
    for(let ix=Math.floor((p.x-padX)/rockCell);ix<=Math.floor((p.x+padX)/rockCell);ix++)
        for(let iz=Math.floor((p.z-padZ)/rockCell);iz<=Math.floor((p.z+padZ)/rockCell);iz++){
            const key=ix+','+iz,list=rockGrid.get(key);
            if(list)list.push(sample);else rockGrid.set(key,[sample]);
        }
}
const nearbyRocks=(x:number,z:number)=>rockGrid.get(Math.floor(x/rockCell)+','+Math.floor(z/rockCell))??noRocks;
const tileWidth=1024;

export class PeaklandFlora extends T.Group {
    private readonly batches:{mesh:T.InstancedMesh;fine:T.BufferGeometry;coarse:T.BufferGeometry;length:number}[]=[];
    private nextView=0;
    readonly counts={ valley:0, ledges:0, summits:0, courts:0 };

    constructor(excluded:(x:number,z:number)=>boolean,wind?:WindUniforms) {
        super();
        this.name='peakland-ecology';
        const tiles=new Map<string,Tile>();
        const scatter=(bucket:keyof typeof this.counts,kind:Plant,x:number,y:number,z:number,size:number,seed:number,light:number,lean=.13)=>{
            if(excluded(x,z))return;
            const ix=Math.floor(x/tileWidth),iz=Math.floor(z/tileWidth),key=[ix,iz,kind].join(',');
            const tile=tiles.get(key)??{x:ix*tileWidth,z:iz*tileWidth,kind,plants:[]};
            tile.plants.push({x,y,z,size,angle:geologyRandom(seed,31)*Math.PI*2,lean,green:.73+.22*light+.19*geologyRandom(seed,87)});
            tiles.set(key,tile);
            this.counts[bucket]++;
        };

        // Roots on the creek margins need aerated soil above the channel, a
        // shallow enough slope, and water close enough to sustain broadleaf cover.
        for(let i=0;i<peakCreek.length;i++){
            const p=peakCreek[i],prev=peakCreek[Math.max(0,i-1)],next=peakCreek[Math.min(i+1,peakCreek.length-1)];
            const dx=next.x-prev.x,dz=next.z-prev.z,w=Math.hypot(dx,dz);
            for(let j=0;j<23;j++){
                const id=i*37+j+778, lateral=(j%2?1:-1)*(14+geologyRandom(id,9)*110), along=(geologyRandom(id,13)-.5)*39;
                const x=p.x+(dz*lateral+dx*along)/w,z=p.z+(-dx*lateral+dz*along)/w,y=heightAt(x,z);
                if(y<waterSurfaceAt(x,z,1.7)+.20||y>p.y+105)continue;
                const slope=slopeAt(x,z),moisture=(1-Math.min(1,Math.abs(lateral)/130))*.66+(1-Math.min(1,Math.max(0,y-p.y)/105))*.34;
                const type=geologyRandom(id,4),rooting=(1-T.MathUtils.smoothstep(slope,.25,1.35))*(.40+.6*moisture);
                if(type>rooting+.07)continue;
                if(nearbyRocks(x,z).some(({p,shape})=>Math.abs(x-p.x)<p.rx*1.6&&Math.abs(z-p.z)<p.rz*1.8
                    &&(shape.contact(x,y+.9,z,5.5)||shape.contact(x,y+4.2,z,4.2))))continue;
                const size=.75+geologyRandom(id,15)*.73;
                const kind:Plant=slope>.60||type<.19?'shrub':type<.27?'stone':moisture>.30?'broadleaf':'pine';
                scatter('valley',kind,x,y,z,kind==='shrub'?size*1.35:size,id,geologyRandom(id,17));
            }
        }

        for(const {p,shape} of rockSamples){
            const height=p.top-p.bottom, count=p.zone==='far'?14:p.kind==='cliff'||p.kind==='wall'?44:28;
            const crownFloor=(x:number,z:number)=>shape.floor(x,z,p.top+2);
            const sameSoil=(x:number,z:number,y:number,probe:number,ridge:boolean)=>{
                const soil=(sx:number,sz:number)=>ridge?crownFloor(sx,sz):shape.floor(sx,sz,y+probe*2.5);
                // Two probes (instead of four) roughly halve the floor queries;
                // the doubled count keeps the rooting odds comparable.
                const values=[soil(x-probe,z),soil(x,z-probe)];
                return values.filter(h=>Number.isFinite(h)&&Math.abs(h-y)<probe*.9).length*2;
            };
            for(let i=0;i<count;i++){
                const id=p.id*110+i, a=i*2.399+geologyRandom(id,17), ridge=i%2===0;
                const t=ridge?.87+.12*geologyRandom(id,19):.28+.55*geologyRandom(id,32);
                const q=rockPoint(p,p.bottom+height*t,a);
                const inset=ridge?.42+.53*geologyRandom(id,3):.985;
                const x=T.MathUtils.lerp(p.x,q[0],inset),z=T.MathUtils.lerp(p.z,q[2],inset);
                const base=heightAt(x,z);
                const y=ridge?crownFloor(x,z):shape.floor(x,z,q[1]+height*.077);
                if(!Number.isFinite(y))continue;
                if(y<=base+11||!ridge&&Math.abs(y-q[1])>height*.12)continue;
                const sun=.5+.5*Math.cos(a+1.05),altitude=T.MathUtils.smoothstep(y,465,790);
                const soil=sameSoil(x,z,y,ridge?2.3:1.25,ridge);
                const sheltered=1-sun, fissure=geologyRandom(p.id,i+303);
                const rooting=ridge?.20+soil*.19:.19+soil*.12+.22*sheltered+.13*fissure;
                if(geologyRandom(id,7)>rooting-altitude*.16)continue;
                const kind:Plant=soil>=2&&geologyRandom(id,5)>.38?'pine':geologyRandom(id,9)>.19?'shrub':'stone';
                if(nearbyRocks(x,z).some(({p:other,shape:rock})=>other!==p&&Math.abs(x-other.x)<other.rx*1.37&&
                    Math.abs(z-other.z)<other.rz*1.56&&rock.contact(x,y+1.1,z,.25)))continue;
                const size=kind==='pine'?(.64+geologyRandom(id,241)*.58)*(1-altitude*.22):.65+geologyRandom(id,242)*1.07;
                scatter(ridge?'summits':'ledges',kind,x,y-.12,z,size,id,sun,ridge?.10:.32+fissure*.19);
            }
        }

        for(let i=0;i<470;i++){
            const x=1500+geologyRandom(i,534)*1250,z=-1780+geologyRandom(i,535)*1160,y=heightAt(x,z);
            const court=(x>2220&&x<2580&&z> -1620&&z< -1420&&y>520);
            const slope=slopeAt(x,z),{closest,level}=gorgeDistance(x,z);
            if(slope>(court?.67:.88)||(!court&&closest<140)||y<waterSurfaceAt(x,z,2)+.50||level>y+10)continue;
            if(nearbyRocks(x,z).some(({p,shape})=>Math.abs(x-p.x)<p.rx*1.4&&Math.abs(z-p.z)<p.rz*1.6&&shape.contact(x,y+2,z,.7)))continue;
            const fertile=geologyRandom(i,536);
            if(fertile<.37)continue;
            scatter(court?'courts':'valley',fertile>.74?'pine':'shrub',x,y,z,.69+geologyRandom(i,537)*.9,i+9000,.61);
        }

        // Sheltered strips between the existing eaves and the irregular crest.
        for(const [siteIndex,p] of terraces.slice(0,3).entries())for(let i=0;i<24;i++){
            const id=siteIndex*41+i+24000,a=i*2.399+geologyRandom(id,3);
            const r=.46+geologyRandom(id,4)*.28;
            const x=p.x+Math.cos(a)*p.rx*r,z=p.z+Math.sin(a)*p.rz*r,y=heightAt(x,z);
            if(Math.abs(y-p.top)>3||slopeAt(x,z)>.62)continue;
            const size=.76+.40*geologyRandom(id,9);
            scatter('courts',i%3?'pine':'shrub',x,y,z,size,id,.66);
        }

        const isGuofeng = readArtStyle() === 'guofeng';
        const leafTexture = makeLeafTexture(false, isGuofeng);
        const barkMaterial = new T.MeshLambertMaterial({ color: isGuofeng ? '#5c4a3a' : '#705844', vertexColors: true });
        const leafMaterial = new T.MeshLambertMaterial({
            map: leafTexture, alphaTest: isGuofeng ? .34 : .36, alphaToCoverage: !isGuofeng, vertexColors: true, side: T.DoubleSide,
        });
        const stoneMaterial = new T.MeshLambertMaterial({ vertexColors: true });
        if (wind) windify(leafMaterial, wind, .16, 7.5);

        const pineTrunk = makeTreeTrunk('pine');
        const pineFine = makeTreeCanopy('pine', true);
        const pineCoarse = makeTreeCanopy('pine', false);
        const broadTrunk = makeTreeTrunk('broadleaf');
        const broadFine = makeTreeCanopy('broadleaf', true);
        const broadCoarse = makeTreeCanopy('broadleaf', false);
        const shrubGeo = makeValleyShrub();
        const stoneFine = stoneGeometry(true);
        const stoneCoarse = stoneGeometry(false);

        const gfPeakBatches: Array<{ kind: 'pine' | 'broadleaf'; trunkEntry: { mesh: T.InstancedMesh; fine: T.BufferGeometry; coarse: T.BufferGeometry; length: number }; crownEntry: { mesh: T.InstancedMesh; fine: T.BufferGeometry; coarse: T.BufferGeometry; length: number } }> = [];
        const dummy=new T.Object3D(),tint=new T.Color();
        for(const tile of tiles.values()){
            if (tile.kind === 'pine' || tile.kind === 'broadleaf') {
                const trunkGeo = tile.kind === 'pine' ? pineTrunk : broadTrunk;
                const fine = tile.kind === 'pine' ? pineFine : broadFine;
                const coarse = tile.kind === 'pine' ? pineCoarse : broadCoarse;
                const trunk = new T.InstancedMesh(trunkGeo, barkMaterial, tile.plants.length);
                const crown = new T.InstancedMesh(coarse, leafMaterial, tile.plants.length);
                trunk.instanceMatrix.setUsage(T.StaticDrawUsage);
                crown.instanceMatrix.setUsage(T.StaticDrawUsage);
                for (const [i, p] of tile.plants.entries()) {
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.rotation.set(p.lean * .42, p.angle, p.lean * .46, 'YXZ');
                    dummy.scale.set(p.size, p.size * (.84 + .26 * geologyRandom(i, 105)), p.size);
                    dummy.updateMatrix();
                    trunk.setMatrixAt(i, dummy.matrix);
                    crown.setMatrixAt(i, dummy.matrix);
                    if (tile.kind === 'pine') {
                        tint.setHSL(.34 + (i % 5) * .014, isGuofeng ? .22 : .38, .44 * p.green + .14);
                    } else {
                        tint.setHSL(.25 + (i % 5) * .018, isGuofeng ? .26 : .48, .46 * p.green + .16);
                    }
                    crown.setColorAt(i, tint);
                }
                trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
                if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
                trunk.computeBoundingSphere();
                crown.geometry = fine;
                crown.computeBoundingSphere();
                crown.geometry = coarse;
                trunk.receiveShadow = crown.receiveShadow = false;
                this.add(trunk, crown);
                const trunkEntry = { mesh: trunk, fine: trunkGeo, coarse: trunkGeo, length: 12 };
                const crownEntry = { mesh: crown, fine, coarse, length: 12 };
                this.batches.push(trunkEntry, crownEntry);
                if (isGuofeng) gfPeakBatches.push({ kind: tile.kind, trunkEntry, crownEntry });
            } else {
                const fine = tile.kind === 'shrub' ? shrubGeo : stoneFine;
                const coarse = tile.kind === 'shrub' ? shrubGeo : stoneCoarse;
                const mat = tile.kind === 'shrub' ? leafMaterial : stoneMaterial;
                const mesh = new T.InstancedMesh(coarse, mat, tile.plants.length);
                mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
                for (const [i, p] of tile.plants.entries()) {
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.rotation.set(p.lean * .35, p.angle, p.lean * .35, 'YXZ');
                    const s = tile.kind === 'shrub' ? p.size * 1.45 : p.size;
                    dummy.scale.set(s, s * (.80 + .28 * geologyRandom(i, 107)), s);
                    dummy.updateMatrix();
                    mesh.setMatrixAt(i, dummy.matrix);
                    if (tile.kind === 'shrub') {
                        tint.setHSL(.26 + (i % 4) * .022, .46, .48 * p.green + .12);
                    } else {
                        tint.setRGB(p.green * 1.04, p.green * .96, p.green * .84);
                    }
                    mesh.setColorAt(i, tint);
                }
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                mesh.geometry = fine;
                mesh.computeBoundingSphere();
                mesh.geometry = coarse;
                mesh.receiveShadow = false;
                this.add(mesh);
                this.batches.push({ mesh, fine, coarse, length: 3.4 });
            }
        }
        if (isGuofeng && gfPeakBatches.length) {
            void loadSharedGuofengTreeKit().then(kit => {
                if (!kit) return;
                for (const item of gfPeakBatches) {
                    const pair = item.kind === 'pine' ? kit.pine : kit.oak;
                    if (!pair) continue;
                    item.trunkEntry.fine = pair.trunk;
                    item.trunkEntry.coarse = pair.trunk;
                    item.trunkEntry.mesh.geometry = pair.trunk;
                    const wasFine = item.crownEntry.mesh.geometry === item.crownEntry.fine;
                    item.crownEntry.fine = pair.canopy;
                    item.crownEntry.coarse = pair.canopyFar;
                    item.crownEntry.mesh.geometry = wasFine ? pair.canopy : pair.canopyFar;
                }
            });
        }
    }

    update(time:number,camera:T.PerspectiveCamera,viewHeight:number,budget:number) {
        if(time<this.nextView)return;
        this.nextView=time+.25;
        const focal=viewHeight/(2*Math.tan(camera.fov*Math.PI/360));
        for(const b of this.batches){
            const sphere=b.mesh.boundingSphere!;
            const distance=Math.max(5,sphere.center.distanceTo(camera.position)-sphere.radius*.63);
            if(b.length<5&&distance>520){
                b.mesh.visible=false;
                continue;
            }
            const pixels=focal*b.length/distance;
            b.mesh.visible=pixels>.72*budget;
            if(!b.mesh.visible)continue;
            b.mesh.receiveShadow=distance<240;
            b.mesh.geometry=pixels>(b.mesh.geometry===b.fine?18:23)*budget?b.fine:b.coarse;
        }
    }

    collectVariants(geometries:Set<T.BufferGeometry>) {
        for(const b of this.batches){geometries.add(b.fine);geometries.add(b.coarse);}
    }
}
