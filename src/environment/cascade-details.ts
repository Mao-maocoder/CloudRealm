import * as T from 'three';
import { mainRiver, rivers, waterfalls } from '../world/geo/geo-core';
import { heightAt, randomAt, trailDistance } from '../world/geo/height';
import { addSolid, releaseSolids } from '../world/physics/solid-world';
import { makeShoreStoneGeometry, makeShoreStoneMaterial } from '../rendering/shore-stone';
import { spawnShoreBounds, type SpawnShoreGrass } from '../rendering/spawn-shore-grass';
import { shrineFloor, shrineRadius, valleySpawn } from '../world/geo/spawn-site';

/** Stones and spray follow the same stream samples as the water and carved bed. */
export class CascadeDetails extends T.Group {
    private readonly time = {value:0};
    private readonly bankMaterial = makeShoreStoneMaterial(.92);
    private readonly bankGeometry = Array.from({length:3}, (_, form) => ({
        near: makeShoreStoneGeometry(form),
        far: makeShoreStoneGeometry(form, 1),
    }));
    private readonly banks: {mesh: T.InstancedMesh; form: number}[];
    private readonly spray:T.InstancedMesh<T.PlaneGeometry,T.ShaderMaterial>;
    private nextBankDetail = -Infinity;

    constructor(scene:T.Scene, private spawnShoreGrass?: SpawnShoreGrass) {
        super();
        this.name='雪岭水岸与瀑底水雾';
        this.banks=this.makeBanks();
        this.spray=this.makeSpray();
        this.add(...this.banks.map(({mesh}) => mesh),this.spray);
        scene.add(this);
    }

    private makeBanks() {
        const placements:{x:number;y:number;z:number;size:number;rank:number}[]=[];
        for(const river of rivers.filter(r=>r===mainRiver||r.id==='sakura-creek'||r.id==='west-creek')){
            for(const [i,p] of river.samples.entries()){
                if(p.z < -1595 || p.z > 186)continue;
                const fall=river===mainRiver&&waterfalls.some(f=>p.z>=f.north-30&&p.z<=f.south+41);
                for(const side of [-1,1]){
                    const rank=randomAt(i,side,468+river.id.length);
                    if(rank < (fall?.11:.30))continue;
                    const along=(randomAt(i,side,493)-.5)*5;
                    const offset=p.halfWidth*side*(.94+rank*.32);
                    const x=p.x-p.flowZ*offset+p.flowX*along,z=p.z+p.flowX*offset+p.flowZ*along;
                    const y=heightAt(x,z);
                    if(y<p.waterLevel-2.6||y>p.waterLevel+5.2||trailDistance(x,z)<5.4)continue;
                    const size=(fall?1.45:.82)+(fall?4.0:2.8)*rank**2;
                    placements.push({x,y,z,size,rank});
                }
            }
        }
        const batches = new Map<string, {form: number; stones: typeof placements}>();
        for(const placement of placements){
            const {x,z} = placement;
            const form=Math.floor(randomAt(x,z,661)*this.bankGeometry.length);
            const key = `${Math.floor(x/256)},${Math.floor(z/256)},${form}`;
            const batch = batches.get(key) ?? {form, stones: []};
            batch.stones.push(placement);
            batches.set(key, batch);
        }
        const transform=new T.Object3D(), color=new T.Color(), box=new T.Box3();
        return [...batches.values()].map(({form, stones:batch})=>{
            const { near, far } = this.bankGeometry[form];
            const stones=new T.InstancedMesh(near,this.bankMaterial,batch.length);
            stones.name='河岸 · 岩塊 '+(form+1);
            batch.forEach(({x,y,z,size,rank},i)=>{
                const tone=randomAt(x,z,663);
                transform.position.set(x,y-size*.18,z);
                transform.scale.set(size*(1.13+rank*.42),size*(.62+tone*.11),size*(.76+.42*rank));
                transform.rotation.set((rank-.5)*.35,rank*6.28,(rank-.48)*.4);
                transform.updateMatrix();
                if (this.spawnShoreGrass && x > valleySpawn.x - 9 && x < valleySpawn.x
                    && Math.abs(z - valleySpawn.z) < 8) {
                    box.copy(near.boundingBox!).applyMatrix4(transform.matrix);
                    const dx = Math.max(box.min.x - valleySpawn.x, valleySpawn.x - box.max.x, 0);
                    const dz = Math.max(box.min.z - valleySpawn.z, valleySpawn.z - box.max.z, 0);
                    if (box.max.y > shrineFloor - .15 && dx * dx + dz * dz < shrineRadius ** 2) {
                        // Set the overlapping bank rock back from the paved rim.
                        x -= 1.65;
                        y = heightAt(x,z);
                        transform.position.set(x,y-size*.18,z);
                        transform.updateMatrix();
                    }
                }
                if (this.spawnShoreGrass) {
                    const pad = size * 2 + spawnShoreBounds.reach;
                    if (x + pad >= spawnShoreBounds.left && x - pad <= spawnShoreBounds.right
                        && z + pad >= spawnShoreBounds.north && z - pad <= spawnShoreBounds.south) {
                        box.copy(far.boundingBox!).applyMatrix4(transform.matrix);
                        this.spawnShoreGrass.addStone(far, transform.matrix, box);
                    }
                }
                stones.setMatrixAt(i,transform.matrix);
                stones.setColorAt(i,color.set(tone>.67?'#c9bd9f':tone>.35?'#adb2aa':'#939b98'));
                if(size>2.1){
                    const r=size*.68;
                    addSolid(this,{minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r,minY:y-.1,maxY:y+size*.42,radius:r});
                }
            });
            stones.receiveShadow=true;
            stones.computeBoundingSphere();
            const nearBounds = stones.boundingSphere!.clone();
            stones.geometry = far;
            stones.computeBoundingSphere();
            stones.boundingSphere!.union(nearBounds);
            return {mesh: stones, form};
        });
    }

    private makeSpray() {
        const count=28,geometry=new T.PlaneGeometry(2,2);
        const seeds=new Float32Array(count*waterfalls.length*3);
        const material=new T.ShaderMaterial({
            uniforms:{uTime:this.time},transparent:true,depthWrite:false,
            vertexShader:`
                attribute vec3 aMist;
                uniform float uTime;
                varying vec2 vDisc;
                varying float vAge,vStrength;
                void main() {
                    vAge=fract(aMist.z+uTime*(.18+aMist.x*.10));
                    vStrength=aMist.y;
                    vDisc=uv*2.-1.;
                    vec3 root=instanceMatrix[3].xyz;
                    root+=vec3((aMist.x-.5)*17.*vAge,2.+26.*vAge,17.*vAge);
                    vec4 view=modelViewMatrix*vec4(root,1.);
                    float size=(4.+aMist.y*7.)*(.59+vAge*1.95);
                    vec2 offset=position.xy*vec2(1.48,.67)*size;
                    gl_Position=projectionMatrix*(view+vec4(offset,0.,0.));
                }`,
            fragmentShader:`
                varying vec2 vDisc;
                varying float vAge,vStrength;
                void main() {
                    float edge=length(vDisc)*(.97+.07*sin(11.*vDisc.x+9.*vDisc.y+vStrength*6.));
                    float opacity=(1.-smoothstep(.14,1.,edge))
                        *smoothstep(0.,.13,vAge)*(1.-smoothstep(.45,1.,vAge));
                    gl_FragColor=vec4(.66+vStrength*.23,.81+vStrength*.14,.91,opacity*.26);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        const mesh=new T.InstancedMesh(geometry,material,count*waterfalls.length);
        const transform=new T.Matrix4();
        waterfalls.forEach((fall,index)=>{
            const p=mainRiver.samples.find(sample=>sample.z>=fall.south)!;
            for(let j=0;j<count;j++){
                const i=index*count+j, rank=randomAt(j,index,527);
                const side=p.halfWidth*(rank-.5)*1.8, a=2+randomAt(j,index,532)*27;
                transform.makeTranslation(p.x-p.flowZ*side+p.flowX*a,p.waterLevel+.25,p.z+p.flowX*side+p.flowZ*a);
                mesh.setMatrixAt(i,transform);
                seeds.set([rank,randomAt(j,index,529),randomAt(j,index,531)],i*3);
            }
        });
        geometry.setAttribute('aMist',new T.InstancedBufferAttribute(seeds,3));
        mesh.computeBoundingSphere();
        mesh.boundingSphere!.radius+=55;
        mesh.renderOrder=4;
        return mesh;
    }

    update(time:number, camera:T.Camera) {
        this.time.value=time;
        if (time < this.nextBankDetail) return;
        this.nextBankDetail = time + .15;
        for (const {mesh, form} of this.banks) {
            const {near, far} = this.bankGeometry[form];
            const distance = mesh.boundingSphere!.distanceToPoint(camera.position);
            mesh.geometry = distance < (mesh.geometry === near ? 240 : 200) ? near : far;
        }
    }

    dispose() {
        releaseSolids(this);
        this.removeFromParent();
        for(const {mesh} of this.banks) mesh.dispose();
        for(const {near,far} of this.bankGeometry) {
            near.dispose();
            far.dispose();
        }
        this.bankMaterial.dispose();
        this.spray.dispose();
        this.spray.geometry.dispose();
        this.spray.material.dispose();
    }
}
