import * as T from 'three';
import { art } from '../../config/art';
import { inBuildingLot } from '../biomes/building-layout';
import { heightAt, randomAt, trailDistance } from '../geo/height';
import { farmRowSpacing, parcelCurve, parcelMargin, parcelSpan, valleyParcels } from '../geo/valley-landmarks';
import { windify, type WindUniforms } from './vegetation';
import { villageYardAt } from '../biomes/village-ground';

function grainClump() {
    const vertices:number[]=[], colors:number[]=[], indices:number[]=[];
    // A pair of triangles gives each leaf or grain head a tapered silhouette.
    function ribbon(x:number,z:number,y:number,angle:number,length:number,rise:number,width:number,tone:number) {
        const alongX=Math.cos(angle), alongZ=Math.sin(angle);
        const sideX=-alongZ*width,sideZ=alongX*width;
        const midX=x+alongX*length*.42,midZ=z+alongZ*length*.42;
        const base=vertices.length/3;
        vertices.push(x,y,z, midX-sideX,y+rise*.63,midZ-sideZ,
            midX+sideX,y+rise*.63,midZ+sideZ, x+alongX*length,y+rise,z+alongZ*length);
        for(const shade of [.77,.96,1,1.12])
            colors.push(tone*shade,tone*shade,tone*shade*.92);
        indices.push(base,base+1,base+2,base+1,base+3,base+2);
    }
    for(let i=0;i<4;i++){
        const angle=i*2.399+1.1, x=.12*Math.cos(angle),z=.12*Math.sin(angle);
        const h=.49+.11*(i%3);
        ribbon(x,z,0,angle,.065,h,.015,.67);
        ribbon(x,z,h*.31,angle+1.4,.25,.20,.029,.77);
        ribbon(x,z,h*.5,angle-1.65,.19,.14,.024,.88);
        const tipX=x+.063*Math.cos(angle),tipZ=z+.063*Math.sin(angle);
        ribbon(tipX,tipZ,h-.03,angle,.101,.19,.037,1.19);
        ribbon(tipX,tipZ,h-.03,angle+Math.PI/2,.058,.18,.032,1.12);
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

/** Near and middle distance crop rows. The ground shader shades the same plots at altitude. */
export class ValleyCrops extends T.Group {
    private readonly beds:T.InstancedMesh[]=[];

    constructor(wind:WindUniforms) {
        super();
        this.name='长风乡 · 稻田';
        const geometry=grainClump();
        const material=new T.MeshLambertMaterial({vertexColors:true,side:T.DoubleSide});
        windify(material,wind,.13,.85,true,true,true);
        const plant=new T.Object3D(), fresh=new T.Color('#b4c250'), ripe=new T.Color('#f0c85a'), tint=new T.Color();
        for(const [index,parcel] of valleyParcels.entries()){
            const [,,north,south,,,maturity,bend]=parcel.bounds;
            const roots:{x:number;z:number;seed:number}[]=[];
            const inset=1.3;
            const firstRow=Math.ceil((north+Math.min(0,bend)+inset)/farmRowSpacing);
            const end=south+Math.max(0,bend*.55)-inset;
            for(let rowIndex=firstRow;rowIndex*farmRowSpacing<end;rowIndex++){
                const row=rowIndex*farmRowSpacing;
                const [west,east]=parcelSpan(parcel,row);
                const spacing=.83,offset=randomAt(rowIndex,index,739)*spacing;
                for(let u=west+inset+offset;u<east-inset;u+=spacing){
                    const seed=randomAt(u,row,index+720);
                    const x=u+(seed-.5)*.28;
                    const furrow=row+(randomAt(u,row,740)-.5)*.30;
                    if(parcelMargin(parcel,x,furrow)<inset)continue;
                    const z=furrow+parcelCurve(parcel,x);
                    if(trailDistance(x,z)<4.2||villageYardAt(x,z)>.15||inBuildingLot(x,z,1))continue;
                    roots.push({x,z,seed});
                }
            }
            const mesh=new T.InstancedMesh(geometry,material,roots.length);
            roots.forEach(({x,z,seed},i)=>{
                plant.position.set(x,heightAt(x,z)-.04,z);
                plant.scale.set(1.02+seed*.42,.87+randomAt(z,x,743)*.43,1.03+seed*.37);
                plant.rotation.y=seed*Math.PI*2;
                plant.updateMatrix();
                mesh.setMatrixAt(i,plant.matrix);
                mesh.setColorAt(i,tint.copy(fresh).lerp(ripe,maturity).multiplyScalar(.79+seed*.37));
            });
            mesh.receiveShadow=true;
            mesh.computeBoundingSphere();
            mesh.boundingSphere!.radius+=1;
            this.add(mesh);
            this.beds.push(mesh);
        }
    }

    update(camera:T.Camera) {
        const range=art.grassMidFade[1];
        for(const bed of this.beds)
            bed.visible=bed.boundingSphere!.distanceToPoint(camera.position)<range;
    }
}
