import * as T from 'three';
import { bayPavilionIsland,lakes,lakeShorePoint } from '../geo/geo-core';
import { heightAt,randomAt,trailDistance } from '../geo/height';
import { makeGrassTuft,makeLeafTexture,makeTreeCanopy,makeTreeTrunk } from '../flora/flora-geometry';
import { windify,type WindUniforms } from '../flora/vegetation';
import { addSolid } from '../physics/solid-world';
import { makeShoreStoneGeometry, makeShoreStoneMaterial } from '../../rendering/shore-stone';

function populateIslandPavilion(group:T.Group,wind:WindUniforms) {
    const x=bayPavilionIsland.x-12,z=bayPavilionIsland.z-7,y=heightAt(x,z);
    const pavilion=new T.Group();
    pavilion.name='镜潮湾 · 湖心亭';
    pavilion.position.set(x,y,z);
    pavilion.rotation.y=.32;
    const footing=new T.Mesh(new T.BoxGeometry(11,1.1,9),new T.MeshLambertMaterial({color:'#ad9a7e'}));
    footing.position.y=.4;
    pavilion.add(footing);
    const postGeometry=new T.BoxGeometry(.56,6.4,.56);
    const posts=new T.InstancedMesh(postGeometry,new T.MeshLambertMaterial({color:'#83523a'}),6);
    for(let i=0;i<6;i++)
        posts.setMatrixAt(i,new T.Matrix4().makeTranslation((i%3-1)*3.65,3.83,i<3?-2.75:2.75));
    pavilion.add(posts);
    // Three eave profiles preserve the curved silhouette when viewed across the water.
    const levels=[[6.5,5.2,4.4],[6.98,4.4,3.67],[8.15,3.27,2.35],[9.68,1.85,.39],[9.95,1.22,.13]];
    const vertices:number[]=[],triangles:number[]=[];
    const sides=48;
    for(const [level,[height,w,d]] of levels.entries())for(let i=0;i<sides;i++){
        const a=i/sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
        const square=Math.max(Math.abs(c),Math.abs(s));
        const tip=Math.min(Math.abs(c),Math.abs(s))/square;
        vertices.push(w*c/square,height+tip**5*(level<2?.65:.10),d*s/square);
        if(level){
            const b=level*sides+i,n=level*sides+(i+1)%sides;
            triangles.push(b-sides,b,n-sides,n-sides,b,n);
        }
    }
    const roofGeometry=new T.BufferGeometry();
    roofGeometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    roofGeometry.setIndex(triangles);
    roofGeometry.computeVertexNormals();
    const roof=new T.Mesh(roofGeometry,new T.MeshLambertMaterial({color:'#546a66',side:T.DoubleSide}));
    pavilion.add(roof);
    pavilion.traverse(o=>{if(o instanceof T.Mesh)o.castShadow=o.receiveShadow=true;});
    group.add(pavilion);
    for(let i=0;i<6;i++){
        const px=(i%3-1)*3.65,pz=i<3?-2.75:2.75;
        const cx=x+px*Math.cos(.32)+pz*Math.sin(.32),cz=z-px*Math.sin(.32)+pz*Math.cos(.32);
        addSolid(group,{minX:cx-.34,maxX:cx+.34,minZ:cz-.34,maxZ:cz+.34,minY:y,maxY:y+6.4});
    }
    const trees=[[20,13,1.58],[30,8,1.17],[35,20,1.35],[4,-17,1.18],[-20,-19,.95],[15,26,.96]];
    const trunk=new T.InstancedMesh(makeTreeTrunk('broadleaf'),
        new T.MeshLambertMaterial({color:'#84624d',vertexColors:true}),trees.length);
    const leaves=new T.MeshLambertMaterial({map:makeLeafTexture(),color:'#accd74',
        alphaTest:.36,alphaToCoverage:true,vertexColors:true,side:T.DoubleSide});
    windify(leaves,wind,.17,6.3);
    const crown=new T.InstancedMesh(makeTreeCanopy('broadleaf',false),leaves,trees.length);
    const placement=new T.Object3D();
    for(const [i,[dx,dz,scale]] of trees.entries()){
        const px=bayPavilionIsland.x+dx,pz=bayPavilionIsland.z+dz,ground=heightAt(px,pz);
        placement.position.set(px,ground,pz);
        placement.rotation.y=i*2.399;
        placement.scale.setScalar(scale);
        placement.updateMatrix();
        trunk.setMatrixAt(i,placement.matrix);crown.setMatrixAt(i,placement.matrix);
        const r=.44*scale;
        addSolid(group,{minX:px-r,maxX:px+r,minZ:pz-r,maxZ:pz+r,minY:ground,maxY:ground+4*scale,radius:r});
    }
    trunk.castShadow=trunk.receiveShadow=crown.castShadow=crown.receiveShadow=true;
    group.add(trunk,crown);
}

export function populateBayShore(group:T.Group,wind:WindUniforms) {
    populateIslandPavilion(group,wind);
    const bay=lakes.find(lake=>lake.id==='southeast-bay')!;
    const patches=[.07,.58,1.18,1.75,2.39,3.03,3.75,4.38,5.23,5.74];
    const rockGeometry=makeShoreStoneGeometry(2,2),reedGeometry=makeGrassTuft(7);
    rockGeometry.computeBoundingBox();
    const rockBase=rockGeometry.boundingBox!, rockBox=new T.Box3();
    const rocks=new T.InstancedMesh(rockGeometry,makeShoreStoneMaterial(.86),patches.length*15);
    const reedMaterial=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
    windify(reedMaterial,wind,.22,1.2);
    const reeds=new T.InstancedMesh(reedGeometry,reedMaterial,patches.length*24);
    rocks.name='镜潮湾 · 岸边碎石';reeds.name='镜潮湾 · 浅滩芦草';
    const transform=new T.Object3D(),color=new T.Color();
    let rockCount=0,reedCount=0;
    patches.forEach((angle,patch)=>{
        for(let i=0;i<24;i++){
            const seed=randomAt(i,patch,470), spread=randomAt(i,patch,471)-.5;
            const at=lakeShorePoint(bay,angle+spread*.14,i<15?1+11*seed:5.2+seed*22);
            const y=heightAt(at.x,at.z);
            if(trailDistance(at.x,at.z)<4.8||y<bay.y-.35||y>bay.y+5.0)continue;
            const size=.45+seed*.92;
            transform.position.set(at.x,y-.08,at.z);
            transform.rotation.set(.15*(seed-.5),seed*6.283,.18*spread);
            if(i<15){
                transform.scale.set(size*1.72,size*(.29+.25*seed),size*.89);
                transform.updateMatrix();
                rocks.setMatrixAt(rockCount,transform.matrix);
                rocks.setColorAt(rockCount++,color.set(seed>.6?'#aaa38a':'#838d7e').multiplyScalar(.8+seed*.24));
                rockBox.copy(rockBase).applyMatrix4(transform.matrix);
                const r=Math.min(rockBox.max.x-rockBox.min.x,rockBox.max.z-rockBox.min.z)*.44;
                if(r>.32) addSolid(group,{minX:rockBox.min.x,maxX:rockBox.max.x,minY:rockBox.min.y,maxY:rockBox.max.y-.04,minZ:rockBox.min.z,maxZ:rockBox.max.z,radius:r,step:rockBox.max.y-y<.55});
            }else{
                transform.scale.set(size,size*1.63,size);
                transform.updateMatrix();
                reeds.setMatrixAt(reedCount,transform.matrix);
                reeds.setColorAt(reedCount++,color.set(seed>.5?'#9da85d':'#6d995e'));
            }
        }
    });
    rocks.count=rockCount;reeds.count=reedCount;
    rocks.castShadow=rocks.receiveShadow=reeds.receiveShadow=true;
    group.add(rocks,reeds);
}
