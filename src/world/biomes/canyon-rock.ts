import * as T from 'three';
import { heightAt, randomAt, trailDistance } from '../geo/height';
import { mainRiver, riverX, waterSurfaceAt } from '../geo/geo-core';
import { addSolid, releaseSolids } from '../physics/solid-world';
import { makeCanyonStone } from '../../rendering/canyon-stone';
import { canyonLandforms, canyonRims, gorgeInfluence, ramp, rimAt, type CanyonRim } from '../geo/canyon-plan';
import { makeLeafTexture, makeTreeCanopy, makeTreeTrunk, makeValleyTree } from '../flora/flora-geometry';
import { windify, type WindUniforms } from '../flora/vegetation';
import { toonMaterial } from '../../rendering/materials';
import type { Quality } from '../../config/settings';

// Each cross-section runs from the valley to the back of the mesa. Some
// courses lean out above the course below, which a height map cannot express.
const west = [
    [0,0,.90],[.21,.105,.84],[.39,.17,.36],[.44,.33,.04],[.39,.44,.01],
    [.50,.51,.27],[.76,.54,.92],[.92,.58,.56],[.94,.70,.04],[.89,.82,.02],
    [1.03,.968,.02],[1.18,1,.83],[1.72,.994,1],[2.55,.967,.98],[3.40,.84,.91],[4.38,.36,.87],[4.91,0,.91],
] as const;
const east = [
    [0,0,.90],[.24,.115,.85],[.40,.20,.32],[.45,.39,.04],[.42,.51,.02],
    [.60,.57,.27],[.78,.59,.79],[.91,.633,.23],[.92,.76,.025],[.85,.90,0],
    [.99,.972,.07],[1.15,1,.85],[1.73,1,1],[2.44,.986,.94],[3.24,.92,.87],[4.22,.36,.85],[4.86,0,.91],
] as const;

interface Point {x:number;y:number;z:number;sod:number}
type Rows=Point[][];

function rimRow(rim:CanyonRim,z:number):Point[] {
    const {toe,rim:crest,relief}=rimAt(rim,z);
    const base=heightAt(rim.side*toe,z)-7;
    const profile=rim.side<0?west:east;
    const joint=10*Math.sin(z*.085+rim.side)+5*Math.sin(z*.193);
    const ribs=19*Math.sin(z*.027+rim.side*.9)+12*Math.cos(z*.046);
    return profile.map(([run,rise,sod],i)=>{
        const outline=(joint*(1-sod)*.78+ribs*Math.sin(rise*4.87+.35))*ramp(0,.4,run)*(1-ramp(1.4,2.3,run));
        const x=rim.side*(toe+(crest-toe)*run+outline), ground=heightAt(x,z)-8;
        const top=base+relief*rise+16*Math.sin(z*.018+run*.7)*Math.min(rise,.4);
        const join=Math.max(1-ramp(0,.25,rise),ramp(3.18,4.91,run));
        const y=top+(ground-top)*join;
        return {x,y,z,sod};
    });
}

function gorgeRow(side:number,z:number):Point[] {
    const i=(z-mainRiver.samples[0].z)/8,row=Math.floor(i),t=i-row;
    const a=mainRiver.samples[row],b=mainRiver.samples[row+1];
    const width=T.MathUtils.lerp(a.halfWidth,b.halfWidth,t)
        /Math.max(.75,Math.abs(T.MathUtils.lerp(a.flowZ,b.flowZ,t)));
    const water=T.MathUtils.lerp(a.waterLevel,b.waterLevel,t);
    const centre=riverX(z);
    const rim=heightAt(centre+side*2.4*width,z);
    const cut=gorgeInfluence(z),jag=(Math.sin(z*.27+side)*2.7+Math.sin(z*.49)*1.35)*cut;
    const courses=[[1.17,0,0],[1.24,.20,0],[1.32,.43,.03],[1.29,.64,.04],
        [1.54,.82,.07],[1.76,.96,.14],[2.08,1,.86],[2.52,1,.99],[2.94,1,1]];
    let shore=width*1.16;
    while(shore<width*1.75&&Number.isFinite(waterSurfaceAt(centre+side*shore,z,3)))shore+=3;
    return courses.map(([run,rise,sod],k)=>{
        const x=centre+side*(shore+width*(run-1.17)+jag*(1-sod)*ramp(1.17,1.65,run));
        const ground=heightAt(x,z)-.9;
        const wall=water-4+(rim-water+5.5)*rise;
        const weight=k===0||k>=7?0:cut;
        return {x,y:ground+(wall-ground)*weight,z,sod};
    });
}

function geometry(rows:Rows,side:number) {
    const positions:number[]=[], sod:number[]=[], indices:number[]=[];
    const count=rows[0].length;
    rows.forEach((row,i)=>row.forEach((v,j)=>{
        positions.push(v.x,v.y,v.z);
        sod.push(v.sod);
        if(i===0||j===0)return;
        const d=i*count+j,c=d-1,b=d-count,a=b-1;
        if(side>0)indices.push(a,c,b,b,c,d);
        else indices.push(a,b,c,b,d,c);
    }));
    const mesh=new T.BufferGeometry();
    mesh.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    mesh.setAttribute('aCanyonSod',new T.Float32BufferAttribute(sod,1));
    mesh.setIndex(indices);
    mesh.computeVertexNormals();
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
}

// A strip is linear between its two survey rows. Sample its very same
// triangles in the horizontal plane for landing or in the vertical plane
// for lateral collisions, including the undersides of protruding courses.
function support(rows:Rows,side:number) {
    const start=rows[0][0].z,end=rows.at(-1)![0].z;
    const count=rows[0].length;
    function intersect(p:number,z:number,axis:'x'|'y',visit:(hit:number,sod:number)=>void) {
        if(z<start||z>end)return;
        const i=Math.min(rows.length-2,Math.floor((z-start)/(end-start)*(rows.length-1)));
        const a=rows[i], b=rows[i+1];
        const t=(z-a[0].z)/(b[0].z-a[0].z), other=axis==='x'?'y':'x';
        for(let j=0;j<count-1;j++){
            const left=a[j][axis]*(1-t)+b[j][axis]*t;
            const diagonal=a[j+1][axis]*(1-t)+b[j][axis]*t;
            const right=a[j+1][axis]*(1-t)+b[j+1][axis]*t;
            const low=a[j][other]*(1-t)+b[j][other]*t;
            const mid=a[j+1][other]*(1-t)+b[j][other]*t;
            const high=a[j+1][other]*(1-t)+b[j+1][other]*t;
            const sLow=a[j].sod*(1-t)+b[j].sod*t;
            const sMid=a[j+1].sod*(1-t)+b[j].sod*t;
            const sHigh=a[j+1].sod*(1-t)+b[j+1].sod*t;
            if(p>=Math.min(left,diagonal)&&p<=Math.max(left,diagonal)&&Math.abs(diagonal-left)>.00001){
                const u=(p-left)/(diagonal-left);
                visit(low+(mid-low)*u,sLow+(sMid-sLow)*u);
            }
            if(p>=Math.min(diagonal,right)&&p<=Math.max(diagonal,right)&&Math.abs(right-diagonal)>.00001){
                const u=(p-diagonal)/(right-diagonal);
                visit(mid+(high-mid)*u,sMid+(sHigh-sMid)*u);
            }
        }
    }
    function floor(x:number,z:number,fromY:number) {
        let top=-Infinity;
        intersect(x,z,'x',y=>{if(y<=fromY)top=Math.max(top,y);});
        return top;
    }
    function surface(x:number,z:number) {
        let top=-Infinity, topSod=0;
        intersect(x,z,'x',(y,sod)=>{if(y>top){top=y;topSod=sod;}});
        return Number.isFinite(top)?{y:top,sod:topSod}:undefined;
    }
    function contact(x:number,y:number,z:number,margin:number) {
        let front=Infinity,back=-Infinity;
        intersect(y,z,'y',edge=>{front=Math.min(front,edge*side);back=Math.max(back,edge*side);});
        if(!Number.isFinite(front))return;
        if(back-front<.01)back=Math.max(back,rows[0].at(-1)!.x*side);
        const inside=x*side, inner=inside-front+margin, outer=back-inside+margin;
        if(inner<=0||outer<=0)return;
        if(inside>=front&&inside<=back&&y>floor(x,z,Infinity)+.05)return;
        return inner<outer?{x:-side,z:0,depth:inner}:{x:side,z:0,depth:outer};
    }
    return {floor,surface,contact};
}

interface WallTile {
    near:T.BufferGeometry; far:T.BufferGeometry; mesh:T.Mesh; bounds:T.Box3;
    rock:ReturnType<typeof support>; side:number; gorge:boolean;
}

interface TreeDetailBatch {
    mesh:T.InstancedMesh; near:T.BufferGeometry; far:T.BufferGeometry;
}

export class CanyonRockField extends T.Group {
    private readonly material=makeCanyonStone();
    private readonly tiles:WallTile[]=[];
    private readonly woods:T.InstancedMesh[]=[];
    private readonly treeBatches:TreeDetailBatch[]=[];
    private readonly ownedGeometries:T.BufferGeometry[]=[];
    private readonly ownedMaterials:T.Material[]=[];
    private leafTexture?:T.Texture;

    constructor(wind?:WindUniforms) {
        super();
        this.name='霁雪峡谷岩层';
        const growth:T.Vector3[]=[];
        for(const rim of canyonLandforms){
            const north=rim.stations[0][0],south=rim.stations.at(-1)![0];
            // 6 m rows: the profile wobble (joint/ribs) was sampled too coarsely at
            // 12 m and the polyline creased into a regular vertical grid.
            this.buildStrip(north,south,rim.side,6,z=>rimRow(rim,z),false);
            for(let z=north+56;z<south-80;z+=17){
                if(randomAt(z,rim.side,611)<.27)continue;
                const row=rimRow(rim,z);
                for(const [a,b] of [[6,7],[11,12],[12,13],[13,14]]){
                    const t=.21+randomAt(z,a,rim.side)*.60;
                    const x=T.MathUtils.lerp(row[a].x,row[b].x,t);
                    const y=this.surfaceAt(x,z);
                    if(Number.isFinite(y)&&y>heightAt(x,z)+5)
                        growth.push(new T.Vector3(x,y-.16,z));
                }
            }
        }
        for(const {side} of canyonRims)this.buildStrip(-1554,-1237,side,4,z=>gorgeRow(side,z),true);
        this.plantShelves(growth,wind);
    }

    setTime(time:number) {
        this.material.userData.uniforms.uTime.value=time;
    }

    surfaceAt(x:number,z:number) {
        let height=-Infinity;
        for(const t of this.tiles){
            if(z<t.bounds.min.z||z>t.bounds.max.z||x<t.bounds.min.x||x>t.bounds.max.x)continue;
            height=Math.max(height,t.rock.floor(x,z,Infinity));
        }
        return height;
    }

    surfaceInfoAt(x:number,z:number) {
        let best:{y:number;sod:number}|undefined;
        for(const t of this.tiles){
            if(z<t.bounds.min.z||z>t.bounds.max.z||x<t.bounds.min.x||x>t.bounds.max.x)continue;
            const hit=t.rock.surface(x,z);
            if(hit&&(!best||hit.y>best.y))best=hit;
        }
        return best;
    }

    mesaBounds(side:-1|1) {
        const box=new T.Box3();
        for(const t of this.tiles)if(!t.gorge&&t.side===side)box.union(t.bounds);
        return box;
    }

    private buildStrip(north:number,south:number,side:number,step:number,row:(z:number)=>Point[],gorge:boolean) {
        for(let start=north;start<south;start+=144){
            const end=Math.min(south,start+144);
            const segments=2*Math.ceil((end-start)/(2*step));
            const rows=Array.from({length:segments+1},(_,i)=>row(start+(end-start)*i/segments));
            const near=geometry(rows,side),far=geometry(rows.filter((_,i)=>i%2===0),side);
            const bounds=near.boundingBox!;
            const rock=support(rows,side);
            addSolid(this,{
                minX:bounds.min.x,maxX:bounds.max.x,minY:bounds.min.y,maxY:bounds.max.y,
                minZ:bounds.min.z-.001,maxZ:bounds.max.z+.001,rock,
            });
            const mesh=new T.Mesh(near,this.material);
            mesh.name='canyon-rock';
            mesh.receiveShadow=true;
            this.tiles.push({near,far,mesh,bounds,rock,side,gorge});
            this.add(mesh);
        }
    }

    private plantShelves(positions:T.Vector3[],wind?:WindUniforms) {
        const valleyForms=[0,1,2] as const;
        const valleyModels=valleyForms.map(form=>({
            near:makeValleyTree(form,true),
            far:makeValleyTree(form,false),
        }));
        const pineTrunkGeo=makeTreeTrunk('pine');
        const pineCrownGeo=makeTreeCanopy('pine',true);
        const pineCrownFar=makeTreeCanopy('pine',false);
        for(const model of valleyModels)
            this.ownedGeometries.push(model.near.trunk,model.near.canopy,model.far.trunk,model.far.canopy);
        this.ownedGeometries.push(pineTrunkGeo,pineCrownGeo,pineCrownFar);

        this.leafTexture=makeLeafTexture();
        const valleyLeaves=new T.MeshLambertMaterial({
            map:this.leafTexture,alphaTest:.36,alphaToCoverage:true,vertexColors:true,side:T.DoubleSide,
        });
        const valleyBark=new T.MeshLambertMaterial({color:'#73513a',vertexColors:true});
        const pineBark=toonMaterial('#856b59',{vertexColors:true});
        const pineCrownMat=new T.MeshLambertMaterial({
            map:this.leafTexture,alphaTest:.36,alphaToCoverage:true,vertexColors:true,side:T.DoubleSide,
        });
        if(wind){
            windify(valleyLeaves,wind,.27,9.0);
            windify(pineCrownMat,wind,.12,6.5);
        }
        this.ownedMaterials.push(valleyLeaves,valleyBark,pineBark,pineCrownMat);

        type Placed={p:T.Vector3;scale:number;yaw:number};
        const valleyBuckets:Placed[][]=valleyForms.map(()=>[]);
        const pineBucket:Placed[]=[];
        for(const p of positions){
            if(trailDistance(p.x,p.z)<7||Number.isFinite(waterSurfaceAt(p.x,p.z,2)))continue;
            const scale=.76+randomAt(p.x,p.z,839)*.84;
            const yaw=randomAt(p.x,p.z,838)*Math.PI*2;
            const pineChance=p.y>460?.52:.32;
            if(randomAt(p.x,p.z,841)<pineChance){
                pineBucket.push({p,scale,yaw});
            } else {
                const form=Math.floor(randomAt(p.x,p.z,842)*valleyForms.length);
                valleyBuckets[form].push({p,scale,yaw});
            }
            const radius=scale*.34;
            addSolid(this,{minX:p.x-radius,maxX:p.x+radius,minY:p.y,maxY:p.y+scale*4,
                minZ:p.z-radius,maxZ:p.z+radius,radius});
        }

        const transform=new T.Object3D(),shade=new T.Color();
        const valleyPalette=['#c8d88e','#aad096','#bfd6a4'];
        valleyBuckets.forEach((items,form)=>{
            if(!items.length)return;
            const {near,far}=valleyModels[form];
            const trunk=new T.InstancedMesh(near.trunk,valleyBark,items.length);
            const crown=new T.InstancedMesh(near.canopy,valleyLeaves,items.length);
            trunk.instanceMatrix.setUsage(T.StaticDrawUsage);
            crown.instanceMatrix.setUsage(T.StaticDrawUsage);
            items.forEach(({p,scale,yaw},i)=>{
                transform.position.copy(p);
                transform.rotation.set(0,yaw,0);
                transform.scale.setScalar(scale);
                transform.updateMatrix();
                trunk.setMatrixAt(i,transform.matrix);
                crown.setMatrixAt(i,transform.matrix);
                shade.set(valleyPalette[form]).multiplyScalar(.82+randomAt(p.x,p.z,843)*.32);
                crown.setColorAt(i,shade);
            });
            trunk.instanceMatrix.needsUpdate=true;
            crown.instanceMatrix.needsUpdate=true;
            if(crown.instanceColor)crown.instanceColor.needsUpdate=true;
            trunk.computeBoundingSphere();
            crown.computeBoundingSphere();
            trunk.castShadow=trunk.receiveShadow=true;
            crown.castShadow=crown.receiveShadow=true;
            trunk.name=`canyon-broadleaf-trunks-${form}`;
            crown.name=`canyon-broadleaf-crowns-${form}`;
            this.woods.push(trunk,crown);
            this.treeBatches.push({mesh:trunk,near:near.trunk,far:far.trunk},{mesh:crown,near:near.canopy,far:far.canopy});
            this.add(trunk,crown);
        });

        if(pineBucket.length){
            const trunk=new T.InstancedMesh(pineTrunkGeo,pineBark,pineBucket.length);
            const crown=new T.InstancedMesh(pineCrownGeo,pineCrownMat,pineBucket.length);
            trunk.instanceMatrix.setUsage(T.StaticDrawUsage);
            crown.instanceMatrix.setUsage(T.StaticDrawUsage);
            pineBucket.forEach(({p,scale,yaw},i)=>{
                transform.position.copy(p);
                transform.rotation.set(0,yaw,0);
                transform.scale.set(scale*.9,scale*(.9+randomAt(p.x,p.z,844)*.3),scale*.9);
                transform.updateMatrix();
                trunk.setMatrixAt(i,transform.matrix);
                crown.setMatrixAt(i,transform.matrix);
                shade.setHSL(.36+randomAt(p.x,p.z,845)*.06,.26+randomAt(p.x,p.z,846)*.14,.46+randomAt(p.x,p.z,847)*.14);
                crown.setColorAt(i,shade);
            });
            trunk.instanceMatrix.needsUpdate=true;
            crown.instanceMatrix.needsUpdate=true;
            if(crown.instanceColor)crown.instanceColor.needsUpdate=true;
            trunk.computeBoundingSphere();
            crown.computeBoundingSphere();
            trunk.castShadow=trunk.receiveShadow=true;
            crown.castShadow=crown.receiveShadow=true;
            trunk.name='canyon-pine-trunks';
            crown.name='canyon-pine-crowns';
            this.woods.push(trunk,crown);
            this.treeBatches.push({mesh:trunk,near:pineTrunkGeo,far:pineTrunkGeo},{mesh:crown,near:pineCrownGeo,far:pineCrownFar});
            this.add(trunk,crown);
        }
    }

    update(camera:T.Camera,quality:Quality) {
        const threshold=quality==='low'?360:quality==='medium'?670:1020;
        for(const tile of this.tiles){
            const distance=tile.bounds.distanceToPoint(camera.position);
            if(distance>threshold+45)tile.mesh.geometry=tile.far;
            else if(distance<threshold-45)tile.mesh.geometry=tile.near;
        }
        const treeRange=quality==='low'?120:quality==='high'?260:180;
        for(const batch of this.treeBatches){
            const distance=batch.mesh.boundingSphere!.distanceToPoint(camera.position);
            const useFar=distance>treeRange+(batch.mesh.geometry===batch.far?-20:20);
            batch.mesh.geometry=useFar?batch.far:batch.near;
            batch.mesh.castShadow=distance<treeRange+60;
        }
    }

    dispose() {
        releaseSolids(this);
        for(const tile of this.tiles){tile.near.dispose();tile.far.dispose();}
        for(const mesh of this.woods)mesh.dispose();
        for(const geo of this.ownedGeometries)geo.dispose();
        for(const mat of this.ownedMaterials)mat.dispose();
        this.leafTexture?.dispose();
        this.material.dispose();
        this.removeFromParent();
    }
}
