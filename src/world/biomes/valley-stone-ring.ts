import * as T from 'three';
import { readArtStyle } from '../../config/settings';
import { heightAt,randomAt } from '../geo/height';
import { ruinCenter } from '../geo/valley-landmarks';
import { addSolid } from '../physics/solid-world';

/** A low stone circle on the sloping meadow above the eastern tributary. */
export function populateValleyStoneRing(group:T.Group) {
    const isGuofeng = readArtStyle() === 'guofeng';
    const {x,z}=ruinCenter;
    const perimeter=48, positions:number[]=[], colors:number[]=[], indices:number[]=[];
    const rings=[0,4,4.6,6.5,7.15,11.5,13.6,14.4,16.1];
    const palette=isGuofeng
        ? ['#6e756e','#656d66','#7c7c72','#626b65','#7a7a6f','#5f6862','#6f756e','#807f75','#6a7069']
        : ['#a5a78f','#9e9e81','#c5b79b','#9d9f89','#c1b69b','#9a9c86','#aaa88f','#c8bca2','#a7a38c'];
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
    const columns=new T.InstancedMesh(pillar,new T.MeshLambertMaterial({color:isGuofeng ? '#6e7670' : '#b7b29e'}),30);
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

    if (isGuofeng) {
        // Ancient weathered Xianxia stele (残破古碑) + mountain approach stone steps (古道石阶)
        const cy = heightAt(x, z);
        const steleBase = new T.Mesh(new T.BoxGeometry(2.8, .65, 1.5), new T.MeshLambertMaterial({ color: '#5c645f' }));
        steleBase.position.set(x, cy + .32, z);
        steleBase.castShadow = steleBase.receiveShadow = true;
        const steleBody = new T.Mesh(new T.BoxGeometry(1.75, 4.4, .58), new T.MeshLambertMaterial({ color: '#68736d' }));
        steleBody.position.set(x, cy + 2.65, z);
        steleBody.rotation.z = .05;
        steleBody.castShadow = steleBody.receiveShadow = true;
        const runeStrip = new T.Mesh(
            new T.BoxGeometry(.22, 2.6, .62),
            new T.MeshBasicMaterial({ color: '#86c8b6', transparent: true, opacity: .62 }),
        );
        runeStrip.position.set(x, cy + 2.55, z);
        runeStrip.rotation.z = .05;
        group.add(steleBase, steleBody, runeStrip);
        addSolid(group, { minX: x - 1.2, maxX: x + 1.2, minZ: z - .8, maxZ: z + .8, minY: cy, maxY: cy + 4.8, radius: 1.1 });

        const stepCount = 12;
        const steps = new T.InstancedMesh(new T.BoxGeometry(3.2, .26, .95), new T.MeshLambertMaterial({ color: '#727870' }), stepCount);
        for (let s = 0; s < stepCount; s++) {
            const sx = x - 16.5 - s * 1.15;
            const sz = z + s * .42;
            const sy = heightAt(sx, sz);
            dummy.position.set(sx, sy + .10, sz);
            dummy.rotation.set(0, .34, 0);
            dummy.scale.set(1 + (s % 3) * .06, 1, 1);
            dummy.updateMatrix();
            steps.setMatrixAt(s, dummy.matrix);
        }
        steps.instanceMatrix.needsUpdate = true;
        steps.receiveShadow = true;
        group.add(steps);
    }
}
