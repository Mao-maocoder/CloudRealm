import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addSolid } from '../physics/solid-world';
import { formations, geologyRandom, type Formation, type Landform } from '../geo/peakland-plan';

const tau = 2*Math.PI;
const profiles: Record<Landform, {width:number[]; depth:number[]; angularPower:number}> = {
    needle: { width:[1.12,.90,.82,.77,.72,.67,.59,.41,.19], depth:[1.06,.84,.78,.74,.68,.63,.54,.37,.15], angularPower:4.1 },
    wall: { width:[1.22,1.10,1.02,.99,.96,.92,.86,.71,.53], depth:[1.13,.97,.86,.89,.84,.78,.66,.55,.42], angularPower:5.2 },
    cluster: { width:[1.23,1.02,.98,.91,.87,.77,.68,.54,.33], depth:[1.19,1.00,.86,.87,.70,.66,.53,.43,.29], angularPower:3.7 },
    cliff: { width:[1.17,1.05,.97,.99,.87,.92,.85,.75,.60], depth:[1.12,.96,.83,.79,.62,.86,.74,.70,.55], angularPower:5.4 },
    ridge: { width:[1.24,1.05,.94,.88,.83,.73,.63,.49,.28], depth:[1.18,.94,.84,.75,.55,.58,.39,.30,.19], angularPower:3.3 },
};

interface Section { x:number; z:number; rx:number; rz:number; cos:number; sin:number; }
function curve(values:number[], t:number) {
    const v=t*(values.length-1), i=Math.min(values.length-2,Math.floor(v));
    const local=v-i;
    // Short, uneven shoulders preserve ledges without making every contour a stair.
    return T.MathUtils.lerp(values[i],values[i+1],local*.47+local*local*(3-2*local)*.53);
}
function section(p:Formation,t:number): Section {
    const profile=profiles[p.kind], s=p.salt;
    const pitch=Math.sin(t*Math.PI*.92+s)*.11, tectonic=Math.sin(t*7.13+s*.126)*Math.sin(Math.PI*t);
    const yaw=p.strike+pitch+t*(geologyRandom(p.id,561)-.5)*.24;
    const cut=1+.05*Math.sin(s)*t+.06*tectonic;
    return { x:p.x+p.leanX*t**1.57+tectonic*p.rx*.09, z:p.z+p.leanZ*t**1.33+Math.sin(t*5.6+s)*p.rz*.085*t,
        rx:p.rx*curve(profile.width,t)*cut, rz:p.rz*curve(profile.depth,t)*(2-cut), cos:Math.cos(yaw), sin:Math.sin(yaw) };
}
function contour(p:Formation,t:number,a:number) {
    const c=Math.cos(a),s=Math.sin(a),q=profiles[p.kind].angularPower;
    const form=(Math.abs(c)**q+Math.abs(s)**q)**(-1/q);
    const seed=p.salt, face=a+.1*Math.sin(t*5+seed);
    const split=Math.max(0,Math.cos(face*5+seed*.37))**9;
    const secondary=Math.max(0,Math.sin(face*9+seed*.63))**8;
    const groove=Math.max(0,Math.cos(face*6+seed*.53))**16;
    const fissure=Math.max(0,Math.cos(face*11+seed*.91))**24;
    const rib=.075*Math.sin(3*a+seed)+.048*Math.cos(7*a-seed*.17)+.026*Math.sin(13*a+t*8+seed*.24);
    const cracks=split*(.13+.13*Math.sin(t*4+seed)**2)+secondary*.055+groove*.075;
    const bedding=.019*Math.sin(t*23+face*.9+seed)*Math.sin(face*4+seed*.1);
    const broken=.014*Math.sin(t*76+a*17+seed)*Math.cos(a*22-t*31);
    // Broad shelves step the silhouette every ~50 m so even the coarse LOD
    // keeps a layered profile instead of a smooth clay cone.
    const shelfPhase=t*(p.top-p.bottom)*.020+seed*.17;
    const shelfLocal=shelfPhase-Math.floor(shelfPhase);
    const shelf=(Math.min(1,Math.max(0,shelfLocal/.06))*(1-Math.min(1,Math.max(0,(shelfLocal-.58)/.06)))-.46)*.055;
    return form*(1+rib-cracks+bedding+broken+shelf-fissure*.045);
}

function crownDrop(p:Formation,a:number) {
    const peak=(Math.sin(a*2+p.salt)+.44*Math.sin(a*5-p.salt*.3)+.20*Math.cos(a*9+p.salt))*.28+.51;
    return (p.top-p.bottom)*(.007+.036*peak)*(p.kind==='needle'?1.25:p.kind==='cliff'||p.kind==='wall'?.7:.95);
}

function crownWeight(t:number) { return Math.max(0,(t-.76)/.24)**1.25; }

function point(p:Formation,t:number,a:number,s=section(p,t)) {
    const r=contour(p,t,a), dx=Math.cos(a)*s.rx*r, dz=Math.sin(a)*s.rz*r;
    return [s.x+s.cos*dx-s.sin*dz,p.bottom+(p.top-p.bottom)*t-crownDrop(p,a)*crownWeight(t),s.z+s.sin*dx+s.cos*dz] as const;
}

export function rockSupport(p:Formation) {
    const height=p.top-p.bottom;
    function contact(x:number,y:number,z:number,margin:number) {
        if(y<p.bottom||y>p.top)return;
        let t=(y-p.bottom)/height,s=section(p,t),cap=1;
        if(t>.75){
            for(let i=0;i<4;i++){
                const dx=x-s.x,dz=z-s.z,angle=Math.atan2((dz*s.cos-dx*s.sin)/s.rz,(dx*s.cos+dz*s.sin)/s.rx);
                const drop=crownDrop(p,angle),corrected=(y+drop*crownWeight(t)-p.bottom)/height;
                t=Math.min(1,corrected);
                cap=corrected>=1?Math.max(0,(p.top-y)/drop):1;
                s=section(p,t);
            }
        }
        const dx=x-s.x,dz=z-s.z;
        const length=Math.hypot(dx,dz);
        const u=(dx*s.cos+dz*s.sin)/s.rx,v=(dz*s.cos-dx*s.sin)/s.rz;
        const angle=Math.atan2(v,u), rr=contour(p,t,angle);
        const reach=Math.hypot(s.rx*Math.cos(angle),s.rz*Math.sin(angle))*rr*cap;
        const depth=reach+margin-length;
        if(depth<=0)return;
        return length>.0001?{x:dx/length,z:dz/length,depth}:{x:s.cos,z:s.sin,depth};
    }
    function floor(x:number,z:number,fromY:number) {
        if(fromY<=p.bottom)return -Infinity;
        let above=Math.min(fromY,p.top);
        if(contact(x,above,z,0))return fromY>=p.top?p.top:-Infinity;
        const step=height/26;
        for(let below=above-step;below>=p.bottom-step;below-=step){
            const y=Math.max(p.bottom,below);
            if(contact(x,y,z,0)){
                let low=y,high=above;
                for(let i=0;i<7;i++){
                    const mid=(low+high)*.5;
                    if(contact(x,mid,z,0))low=mid;else high=mid;
                }
                return low;
            }
            above=y;
        }
        return -Infinity;
    }
    return { contact, floor };
}

const detail = [{sides:14,rings:12},{sides:28,rings:24}];

export function rockGeometry(p:Formation,level:number) {
    const {sides,rings}=detail[Math.min(level,detail.length-1)];
    const positions:number[]=[],indices:number[]=[];
    for(let row=0;row<=rings;row++){
        const t=row/rings,s=section(p,t);
        for(let col=0;col<sides;col++){
            const a=col/sides*tau;
            positions.push(...point(p,t,a,s));
            if(row<rings){
                const v=row*sides+col,w=row*sides+(col+1)%sides;
                indices.push(v,v+sides,w,w,v+sides,w+sides);
            }
        }
    }
    const s=section(p,1),center=positions.length/3;
    positions.push(s.x,p.top,s.z);
    for(let col=0;col<sides;col++)indices.push(center,rings*sides+(col+1)%sides,rings*sides+col);
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    const geology=new Float32Array((positions.length/3)*2);
    for(let i=0;i<geology.length;i+=2){geology[i]=p.strike;geology[i+1]=p.salt;}
    g.setAttribute('aGeologicProfile',new T.BufferAttribute(geology,2));
    g.setIndex(indices);
    g.computeVertexNormals();
    g.computeBoundingBox();g.computeBoundingSphere();
    return g;
}

export function rockPoint(p:Formation,y:number,angle:number) {
    return point(p,T.MathUtils.clamp((y-p.bottom)/(p.top-p.bottom),0,1),angle);
}

interface RockCluster {
    mesh:T.Mesh<T.BufferGeometry,T.Material>;
    near:T.BufferGeometry;
    far:T.BufferGeometry;
    bounds:T.Box3;
    level:number;
}

const clusterCell = 640;

/**
 * Spatial LOD clusters batch ~230 sandstone formations into ~14 draw calls
 * with zero runtime CPU geometry rebuilding during flight.
 */
export class PeakRockField extends T.Group {
    private readonly clusters:RockCluster[]=[];
    private nextView=0;

    constructor(owner:T.Group,surface:T.Material) {
        super();
        this.name='peakland-rock-field';
        const groups = new Map<string, Formation[]>();
        for(const peak of formations){
            const bounds=new T.Box3().setFromArray(rockBounds(peak));
            addSolid(owner,{minX:bounds.min.x,maxX:bounds.max.x,minY:bounds.min.y,maxY:bounds.max.y,
                minZ:bounds.min.z,maxZ:bounds.max.z,rock:rockSupport(peak)});
            const key=`${Math.floor(peak.x/clusterCell)},${Math.floor(peak.z/clusterCell)}`;
            const list=groups.get(key);
            if(list)list.push(peak);else groups.set(key,[peak]);
        }
        for(const [key,peaks] of groups){
            const nearParts=peaks.map(p=>rockGeometry(p,1));
            const farParts=peaks.map(p=>rockGeometry(p,0));
            const near=mergeGeometries(nearParts)!;
            const far=mergeGeometries(farParts)!;
            nearParts.forEach(g=>g.dispose());
            farParts.forEach(g=>g.dispose());
            near.computeBoundingBox();
            near.computeBoundingSphere();
            far.computeBoundingBox();
            far.computeBoundingSphere();
            const bounds=near.boundingBox!.clone();
            const mesh=new T.Mesh(far,surface);
            mesh.receiveShadow=false;
            mesh.name='peak-cluster-'+key;
            this.add(mesh);
            this.clusters.push({mesh,near,far,bounds,level:0});
        }
    }

    update(time:number,camera:T.PerspectiveCamera,_velocity:T.Vector3,_viewHeight:number,pixelBudget:number) {
        if(time<this.nextView)return;
        this.nextView=time+.20;
        const switchDist=420/Math.max(.75,pixelBudget);
        for(const c of this.clusters){
            const distance=c.bounds.distanceToPoint(camera.position);
            const want=distance<(c.level===1?switchDist+55:switchDist-55)?1:0;
            if(want!==c.level){
                c.level=want;
                c.mesh.geometry=want===1?c.near:c.far;
            }
            c.mesh.receiveShadow=distance<260;
        }
    }

    collectVariants(set:Set<T.BufferGeometry>) {
        for(const c of this.clusters){set.add(c.near);set.add(c.far);}
    }

    get levels(){return [this.clusters.filter(c=>c.level===0).length,this.clusters.filter(c=>c.level===1).length];}
}

function rockBounds(p:Formation) {
    const span=Math.max(p.rx,p.rz)*1.94+Math.hypot(p.leanX,p.leanZ);
    return [p.x-span,p.bottom,p.z-span,p.x+span,p.top,p.z+span];
}
