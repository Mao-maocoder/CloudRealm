import * as T from 'three';
import { readArtStyle } from '../../config/settings';
import { clearingPoint, clearingTrees } from '../geo/forest-clearing';
import { makeBridgeTree,makeLeafTexture,makeValleyShrub,makeValleyTree } from '../flora/flora-geometry';
import { heightAt } from '../geo/height';
import { addSolid,releaseSolids } from '../physics/solid-world';
import { loadSharedGuofengTreeKit, windify,type WindUniforms } from '../flora/vegetation';

/** A compact woodland with deliberately placed gaps between its canopy groups. */
export class ForestClearing extends T.Group {
    private readonly isGuofeng = readArtStyle() === 'guofeng';
    private readonly leafTexture=makeLeafTexture(false, this.isGuofeng);
    private readonly batches:T.InstancedMesh[]=[];
    private readonly sharedGeos = new Set<T.BufferGeometry>();
    private disposed = false;
    private readonly leafDepth=new T.MeshDepthMaterial({
        map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .36,side:T.DoubleSide,depthPacking:T.RGBADepthPacking,
    });

    constructor(sun:T.Vector3,wind:WindUniforms) {
        super();
        this.name='forest-clearing';
        const leaves=new T.MeshLambertMaterial({
            map:this.leafTexture,alphaTest:this.isGuofeng ? .34 : .36,alphaToCoverage:!this.isGuofeng,side:T.DoubleSide,vertexColors:true,
        });
        windify(leaves,wind,.19,8);
        if (!this.isGuofeng) {
            const sway=leaves.onBeforeCompile;
            const cache=leaves.customProgramCacheKey;
            leaves.customProgramCacheKey=()=>cache()+'-clearing-transmission';
            leaves.onBeforeCompile=(shader,renderer)=>{
                sway(shader,renderer);
                shader.uniforms.uClearingSun={value:sun};
                shader.vertexShader='varying vec3 vClearingCrown;\n'+shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\nvClearingCrown=mat3(modelMatrix)*mat3(instanceMatrix)*normal;');
                shader.fragmentShader='varying vec3 vClearingCrown;uniform vec3 uClearingSun;\n'+shader.fragmentShader.replace(
                    '#include <lights_fragment_end>',`#include <lights_fragment_end>
                    vec3 n=normalize(vClearingCrown);
                    float upward=smoothstep(-.61,.65,n.y);
                    float light=smoothstep(-.45,.74,dot(n,uClearingSun));
                    float through=pow(max(0.,-dot(normalize(vViewPosition),normalize(mat3(viewMatrix)*uClearingSun))),1.45);
                    reflectedLight.indirectDiffuse*=mix(vec3(.50,.76,.86),vec3(1.06,1.15,.89),upward);
                    reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(1.12,1.04,.34)*light*(.44+.53*through);`);
            };
        }
        const bark=new T.MeshLambertMaterial({vertexColors:true,color:this.isGuofeng ? '#5e4c3c' : '#82725b'});
        bark.onBeforeCompile=shader=>{
            shader.vertexShader='varying vec3 vBarkPoint;\n'+shader.vertexShader.replace(
                '#include <begin_vertex>','#include <begin_vertex>\nvBarkPoint=position;');
            shader.fragmentShader='varying vec3 vBarkPoint;\n'+shader.fragmentShader.replace(
                '#include <color_fragment>',`#include <color_fragment>
                vec2 p=vBarkPoint.xz;
                float y=vBarkPoint.y;
                float grain=sin(p.x*27.+sin(p.y*13.+y*.46)*2.+sin(y*1.2+p.y*3.)*.72);
                float crossGrain=sin(p.y*41.+sin(p.x*14.+y*.72)*1.9);
                float detail=1.-smoothstep(.012,.12,max(length(dFdx(vBarkPoint)),length(dFdy(vBarkPoint))));
                float fissure=smoothstep(.16,.78,grain*.67+crossGrain*.33);
                diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.64,.68,.70),vec3(1.16,1.10,.93),fissure),detail*.9);`);
        };
        const models=[makeBridgeTree(6.8,9.2,true),makeBridgeTree(6.1,10.8,false),makeValleyTree(0,true,this.isGuofeng)];
        const anchor=new T.Object3D(), tint=new T.Color();
        const colors=this.isGuofeng
            ? ['#98ad6e','#849e68','#769268','#a4b472','#80986e']
            : ['#e0ea97','#b6df8e','#83cba6','#bedc82','#91bca6'];
        const treePairs: Array<{ form: number; trunk: T.InstancedMesh; crown: T.InstancedMesh }> = [];
        for(const [form,model] of models.entries()){
            const trees=clearingTrees.filter(tree=>tree.form===form);
            const trunk=new T.InstancedMesh(model.trunk,bark,trees.length);
            const crown=new T.InstancedMesh(model.canopy,leaves,trees.length);
            crown.customDepthMaterial=this.leafDepth;
            trees.forEach(({x,z,scale,yaw,i},index)=>{
                const y=heightAt(x,z);
                anchor.position.set(x,y,z);
                anchor.scale.setScalar(scale);
                anchor.rotation.y=yaw;
                anchor.updateMatrix();
                trunk.setMatrixAt(index,anchor.matrix);
                crown.setMatrixAt(index,anchor.matrix);
                crown.setColorAt(index,tint.set(colors[(i*3+form)%colors.length]));
                const r=scale*(form===0?.63:.49);
                addSolid(this,{minX:x-r,maxX:x+r,minZ:z-r,maxZ:z+r,minY:y,maxY:y+scale*4,radius:r});
            });
            this.addBatch(trunk);
            this.addBatch(crown);
            treePairs.push({ form, trunk, crown });
        }
        if (this.isGuofeng) {
            void loadSharedGuofengTreeKit().then(kit => {
                if (!kit || this.disposed) return;
                const map = [kit.elm, kit.oak, kit.pine];
                for (const item of treePairs) {
                    const pair = map[item.form] ?? kit.oak;
                    if (!pair) continue;
                    item.trunk.geometry.dispose();
                    item.crown.geometry.dispose();
                    item.trunk.geometry = pair.trunk;
                    item.crown.geometry = pair.canopy;
                    this.sharedGeos.add(pair.trunk);
                    this.sharedGeos.add(pair.canopy);
                }
            });
        }
        const edgePlants=[
            [4,-4.7,1.3],[6,5.1,1.0],[9,-9,1.0],[14,6.2,.82],[20,-9.3,1.05],
            [25,12.8,1.55],[32,3.7,1.12],[40,-7.8,.96],[48,-17,1.39],[48,9,1.12],
            [53,-23,.95],[64,15,1.35],[68,-4.6,1.03],[67,24,1.4],[18,-21,1.1],
        ];
        const shrubs=new T.InstancedMesh(makeValleyShrub(this.isGuofeng),leaves,edgePlants.length);
        shrubs.customDepthMaterial=this.leafDepth;
        for(const [i,[depth,side,scale]] of edgePlants.entries()){
            const {x,z}=clearingPoint(depth,side);
            anchor.position.set(x,heightAt(x,z)-.05,z);
            anchor.scale.set(scale,scale*.72,scale);
            anchor.rotation.y=i*2.4;
            anchor.updateMatrix();
            shrubs.setMatrixAt(i,anchor.matrix);
            shrubs.setColorAt(i,tint.set(this.isGuofeng ? (i%2?'#7c9462':'#68825e') : (i%2?'#a1cb83':'#82b99b')));
        }
        this.addBatch(shrubs);
    }

    private addBatch(mesh:T.InstancedMesh) {
        mesh.castShadow=mesh.receiveShadow=true;
        mesh.computeBoundingSphere();
        this.batches.push(mesh);
        this.add(mesh);
    }

    dispose() {
        this.disposed = true;
        this.removeFromParent();
        releaseSolids(this);
        const materials=new Set<T.Material>();
        for(const mesh of this.batches){
            mesh.dispose();
            if (!this.sharedGeos.has(mesh.geometry)) mesh.geometry.dispose();
            materials.add(mesh.material as T.Material);
        }
        materials.forEach(material=>material.dispose());
        this.leafDepth.dispose();
        this.leafTexture.dispose();
    }
}
