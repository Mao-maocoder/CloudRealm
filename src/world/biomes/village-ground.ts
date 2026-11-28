import * as T from 'three';
import { readArtStyle } from '../../config/settings';
import {heightAt, randomAt, slopeAt, smooth, trailDistance} from '../geo/height';
import {valleyArtAt} from '../geo/valley-art';
import {makeLeafTexture,makeValleyShrub} from '../flora/flora-geometry';
import {atmosphereUniforms} from '../../rendering/aerial-perspective';

const courtyards = [
    [125,197,7,5], [142,197,6,5], [161,201,6.5,4.6], [180,207,6,4],
    [135,221,7.5,6], [160,221,9,6.5], [185,223,6.5,5], [194,218,5,5],
    [110,224,7,4], [102,247,6,5], [175,181,8,5], [196,188,7,5],
    [221,201,9,6], [128,239,6,4], [222,237,7,4],
    [244,175,8,5], [270,164,8,6], [294,184,11,6],
    [263,178,7,5], [281,190,7,5], [308,189,7,5],
] as const;
const lanes = [
    [[96,192],[113,202],[133,208],[155,210],[179,213],[194,216]],
    [[125,196],[124,201],[126,207]], [[142,196],[142,208]],
    [[161,201],[160,211]], [[180,205],[179,213]],
    [[135,221],[133,215],[133,208]], [[160,221],[159,211]], [[185,223],[184,214]],
    [[110,224],[115,226],[118,236],[128,239]], [[102,247],[109,245],[118,236]],
    [[175,181],[174,186],[174,206]], [[196,188],[196,205],[194,216],[210,227],[222,237]],
    [[221,201],[212,205],[196,205]],
    [[221,201],[232,188],[244,175],[259,171],[270,164]],
    [[259,171],[263,178],[279,182],[294,184],[308,189]],
    [[279,182],[281,190],[280,214],[276,222]],
] as const;

export function villageYardAt(x: number, z: number) {
    let yard=0;
    for(const [cx,cz,w,d] of courtyards) {
        if(Math.abs(x-cx)>w*1.1||Math.abs(z-cz)>d*1.1)continue;
        yard=Math.max(yard,.88*(1-smooth(.55,1.10,Math.hypot((x-cx)/w,(z-cz)/d))));
    }
    const wobble=(randomAt(Math.floor(x*2),Math.floor(z*2),88)-.5)*.33;
    for(const lane of lanes)for(let i=1;i<lane.length;i++){
        const [ax,az]=lane[i-1],[bx,bz]=lane[i],dx=bx-ax,dz=bz-az;
        if(x<Math.min(ax,bx)-2||x>Math.max(ax,bx)+2||z<Math.min(az,bz)-2||z>Math.max(az,bz)+2)continue;
        const along=T.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
        yard=Math.max(yard,1-smooth(.67,1.73,Math.hypot(x-ax-dx*along,z-az-dz*along)+wobble));
    }
    return yard*valleyArtAt(x,z);
}

const width=460, depth=208, left=88, north=150, step=.52;
export function makeVillageGroundTexture() {
    const data=new Uint8Array(width*depth);
    for(let z=0;z<depth;z++)for(let x=0;x<width;x++)
        data[z*width+x]=Math.round(villageYardAt(left+(x+.5)*step,north+(z+.5)*step)*255);
    const map=new T.DataTexture(data,width,depth,T.RedFormat);
    map.minFilter=map.magFilter=T.LinearFilter;
    map.needsUpdate=true;
    return map;
}

export const villageGroundGLSL=`
uniform sampler2D uVillageGround;
float villageGround(vec2 p) {
    vec2 uv=(p-vec2(${left}.,${north}.))/vec2(${width*step},${depth*step});
    if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
    return texture2D(uVillageGround,uv).r;
}
`;

export function populateVillageDetails(group: T.Group, time?: { value:number }) {
    const isGuofeng = readArtStyle() === 'guofeng';
    const boards: T.Matrix4[] = [], stones: T.Matrix4[] = [], shrubs: T.Matrix4[] = [];
    const slabs: T.Matrix4[] = [], vats: T.Matrix4[] = [], firewood: T.Matrix4[] = [];
    const object=new T.Object3D(), up=new T.Vector3(0,1,0);
    function place(list: T.Matrix4[], x: number, z: number, elevation: number, w: number, h: number, d: number, angle: number) {
        object.position.set(x,heightAt(x,z)+elevation,z);
        object.scale.set(w,h,d);object.rotation.set(0,angle,0);
        object.updateMatrix();list.push(object.matrix.clone());
    }
    for(const [i,[x,z,w,d]] of courtyards.entries()) {
        if(valleyArtAt(x,z)<.35)continue;
        const side=i%2?1:-1, fx=x+side*(w-.6), from=z-d*.40;
        for(let post=0;post<=3;post++){
            const pz=from+post*1.70;
            if(trailDistance(fx,pz)>4.8)place(boards,fx,pz,.48,.14,1.04,.15,post*.12);
            if(post===3||trailDistance(fx,pz)<4.8||trailDistance(fx,pz+1.7)<4.8)continue;
            const a=heightAt(fx,pz), b=heightAt(fx,pz+1.7);
            for(const rise of [.33,.71]){
                object.position.set(fx,(a+b)*.5+rise,pz+.85);
                object.scale.set(.13,Math.hypot(1.7,b-a),.11);
                object.quaternion.setFromUnitVectors(up,new T.Vector3(0,b-a,1.7).normalize());
                object.updateMatrix();boards.push(object.matrix.clone());
            }
        }
        if (isGuofeng) {
            // Entry flagstone stepping slabs connecting courtyard entrance to the village lane
            for (let s = 0; s < 4; s++) {
                const sx = x + side * (s * 1.15 - 1.2);
                const sz = z + (i % 2 === 0 ? d * .55 : -d * .55) + (randomAt(i, s, 301) - .5) * .35;
                if (trailDistance(sx, sz) > 1.8) place(slabs, sx, sz, .04, .92 + randomAt(i, s, 302) * .35, .10, .68 + randomAt(i, s, 303) * .28, randomAt(i, s, 304) * .35);
            }
            // Ceramic water vat beside courtyard corner
            const vx = x - side * (w * .52), vz = z + (i % 3 === 0 ? -d * .35 : d * .32);
            if (trailDistance(vx, vz) > 3.2) place(vats, vx, vz, .42, .48, .82, .48, i * .7);
            // Stacked firewood & drying rack logs
            const wx = x + side * (w * .45), wz = z - d * .42;
            if (trailDistance(wx, wz) > 3.4) {
                for (let row = 0; row < 3; row++) {
                    place(firewood, wx + (row - 1) * .22, wz, .14 + (row % 2) * .18, .18, .18, 1.15, (i % 2) * 1.57 + (randomAt(i, row, 309) - .5) * .12);
                }
            }
        }
        for(let k=0;k<12;k++){
            const t=randomAt(i,k,73)*6.283, r=.82+randomAt(i,k,74)*.31;
            const px=x+Math.cos(t)*w*r,pz=z+Math.sin(t)*d*r;
            if(trailDistance(px,pz)<2.5||slopeAt(px,pz)>.65)continue;
            const s=.11+randomAt(i,k,75)*.19;
            if(k%4===0&&villageYardAt(px,pz)<.55)place(shrubs,px,pz,-.04,s*3.1,s*2.6,s*2.65,t);
            else place(stones,px,pz,.044,s,s*.47,s*.68,t);
        }
    }
    const vatGeo = new T.CylinderGeometry(.72, .56, 1, 9);
    const logGeo = new T.CylinderGeometry(.5, .5, 1, 6);
    logGeo.rotateX(Math.PI / 2);
    const batches=[
        [boards,new T.BoxGeometry(),isGuofeng ? '#5d4736' : '#856043','village-fences'],
        [stones,new T.IcosahedronGeometry(1,0),isGuofeng ? '#7c7b70' : '#a19679','yard-stones'],
        [shrubs,makeValleyShrub(isGuofeng),isGuofeng ? '#849664' : '#d5d9a5','yard-shrubs'],
        [slabs,new T.BoxGeometry(),'#7e8076','yard-flagstones'],
        [vats,vatGeo,'#5a4a3e','yard-water-vats'],
        [firewood,logGeo,'#6b4f3a','yard-firewood'],
    ] as const;
    for(const [matrices,geometry,color,name] of batches) {
        if(!matrices.length){geometry.dispose();continue;}
        const material=new T.MeshLambertMaterial({color});
        if(matrices===shrubs){
            material.map=makeLeafTexture(false,isGuofeng);
            material.alphaTest=.36;
            material.alphaToCoverage=true;
            material.side=T.DoubleSide;
            material.vertexColors=true;
        }
        const mesh=new T.InstancedMesh(geometry,material,matrices.length);
        mesh.name=name;
        matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
        mesh.instanceMatrix.needsUpdate=true;
        mesh.castShadow=matrices===boards || matrices===vats;mesh.receiveShadow=true;
        group.add(mesh);
    }
    if(time) populateHearthSmoke(group,time);
}

function populateHearthSmoke(group:T.Group,time:{value:number}) {
    const geometry=new T.BufferGeometry();
    // Origins match the roofs on the eastern row of the settlement.
    const positions:number[]=[],seeds:number[]=[];
    for(const [x,z] of [[207.5,216],[225.8,194.7]])for(let i=0;i<10;i++){
        positions.push(x,heightAt(x,z)+9.8,z);
        seeds.push(i/10);
    }
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('aAge',new T.Float32BufferAttribute(seeds,1));
    const material=new T.ShaderMaterial({
        uniforms:{
            uTime:time,
            uNightFactor:atmosphereUniforms.uNightFactor,
            uDuskFactor:atmosphereUniforms.uDuskFactor,
        },
        transparent:true,depthWrite:false,
        vertexShader:`
            uniform float uTime, uNightFactor;
            attribute float aAge;
            varying float vAge;
            void main() {
                vAge=fract(aAge+uTime*.19);
                vec3 drift=vec3(vAge*vAge*9.,vAge*27.,vAge*4.+sin(vAge*10.)*vAge);
                vec4 view=modelViewMatrix*vec4(position+drift,1.);
                gl_Position=projectionMatrix*view;
                float dayVis=1.-smoothstep(.18,.72,uNightFactor);
                gl_PointSize=dayVis>.005 ? clamp((3.9+vAge*7.)*530./max(1.,-view.z),1.,48.) : 0.;
            }`,
        fragmentShader:`
            uniform float uNightFactor, uDuskFactor;
            varying float vAge;
            void main() {
                float dayVis=1.-smoothstep(.18,.72,uNightFactor);
                if(dayVis<=.005) discard;
                vec2 p=gl_PointCoord-.5;
                float opacity=(1.-smoothstep(.10,.50,length(p)))*(1.-vAge)*smoothstep(0.,.13,vAge);
                vec3 col=mix(vec3(.78,.82,.80),vec3(.96,.80,.68),uDuskFactor*.55);
                gl_FragColor=vec4(col,opacity*.62*dayVis);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const smoke=new T.Points(geometry,material);
    smoke.name='长风乡 · 炊烟';
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius+=33;
    group.add(smoke);
}
