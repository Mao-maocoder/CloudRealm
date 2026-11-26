import * as T from 'three';
import { heightAt,randomAt } from '../geo/height';
import { ruinCenter } from '../geo/valley-landmarks';
import { addSolid } from '../physics/solid-world';

/** A low stone circle on the sloping meadow above the eastern tributary. */
export function populateValleyStoneRing(group:T.Group) {
    const {x,z}=ruinCenter;
    const perimeter=48, positions:number[]=[], colors:number[]=[], indices:number[]=[];
    const rings=[0,4,4.6,6.5,7.15,11.5,13.6,14.4,16.1];
    const palette=['#a5a78f','#9e9e81','#c5b79b','#9d9f89','#c1b69b','#9a9c86','#aaa88f','#c8bca2','#a7a38c'];
    for(const [r,radius] of rings.entries())for(let i=0;i<perimeter;i++){
        const angle=i/perimeter*Math.PI*2, px=x+Math.cos(angle)*radius, pz=z+Math.sin(angle)*radius;
        const rise=r===rings.length-1?.09:.23;
        positions.push(px,heightAt(px,pz)+rise,pz);
        const shade=new T.Color(palette[r]).multiplyScalar(.91+randomAt(i,r,715)*.16);
        colors.push(shade.r,shade.g,shade.b);
        if(r>0){
            const a=(r-1)*perimeter+i,b=(r-1)*perimeter+(i+1)%perimeter;
            indices.push(a,b,a+perimeter,b,b+perimeter,a+perimeter);
        }
    }
    const floor=new T.BufferGeometry();
    floor.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    floor.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    floor.setIndex(indices);floor.computeVertexNormals();
    const paving=new T.Mesh(floor,new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
    paving.receiveShadow=true;group.add(paving);

    const pillar=new T.IcosahedronGeometry(1,0);
    const p=pillar.getAttribute('position');
    for(let i=0;i<p.count;i++){
        const y=p.getY(i);
        p.setXYZ(i,p.getX(i)*(.93-.20*y)+.18*y,Math.max(-.87,Math.min(.85,y)),p.getZ(i)*(.89-.21*y));
    }
    pillar.computeVertexNormals();
    const columns=new T.InstancedMesh(pillar,new T.MeshLambertMaterial({color:'#b7b29e'}),30);
    const dummy=new T.Object3D();
    for(let i=0;i<30;i++){
        const upright=i<10;
        const angle=i*2.39996,r=upright?17.7+randomAt(i,0,706)*3.2:17+randomAt(i,1,710)*10.1;
        const px=x+Math.cos(angle)*r,pz=z+Math.sin(angle)*r,y=heightAt(px,pz);
        const height=upright?4.1+randomAt(i,2,710)*6.3:.35+randomAt(i,3,711)*1.55;
        dummy.position.set(px,y+height*.40,pz);
        dummy.scale.set(upright?1.45:.99,height*.61,upright?1.11:.87);
        dummy.rotation.set((randomAt(i,4,712)-.5)*.28,angle,(randomAt(i,5,713)-.5)*.30);
        dummy.updateMatrix();columns.setMatrixAt(i,dummy.matrix);
        if(upright)addSolid(group,{minX:px-1.05,maxX:px+1.05,minZ:pz-1.05,maxZ:pz+1.05,minY:y,maxY:y+height*.92,radius:1.05});
    }
    columns.castShadow=columns.receiveShadow=true;
    group.add(columns);
}
