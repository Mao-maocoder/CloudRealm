import * as T from 'three';
import { readArtStyle } from '../../config/settings';
import { bridgeArtEnabled, bridgeReflectionLayer, bridgeTrees } from '../geo/bridge-look';
import { makeBankFlowerCluster, makeBridgeTree, makeCloverPatch, makeGrassTuft, makeLeafTexture, makeValleyShrub } from '../flora/flora-geometry';
import { heightAt, randomAt, trailDistance } from '../geo/height';
import { riverX, waterLevelAt } from '../geo/geo-core';
import { addBoulderSolid, addSolid, releaseSolids } from '../physics/solid-world';
import { windify, type WindUniforms } from '../flora/vegetation';
import { makeShoreStoneGeometry, makeShoreStoneMaterial } from '../../rendering/shore-stone';

export class BridgeGrove extends T.Group {
    private readonly geometry: T.BufferGeometry[] = [];
    private readonly materials: T.Material[] = [];
    private leafTexture?: T.Texture;

    constructor(sunDirection: T.Vector3, wind: WindUniforms) {
        super();
        this.name = 'bridge-grove';
        if (!bridgeArtEnabled) return;

        this.leafTexture = makeLeafTexture();
        const leaves = new T.MeshLambertMaterial({
            map: this.leafTexture, color: '#e3e4b5', alphaTest: .36, alphaToCoverage: true,
            side: T.DoubleSide, vertexColors: true,
        });
        leaves.onBeforeCompile = shader => {
            shader.uniforms.uGroveSun = { value: sunDirection };
            shader.vertexShader = 'varying vec3 vCrownNormal;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>', '#include <begin_vertex>\nvCrownNormal=mat3(modelMatrix)*normal;');
            shader.fragmentShader = 'varying vec3 vCrownNormal; uniform vec3 uGroveSun;\n' + shader.fragmentShader.replace(
                '#include <lights_fragment_end>', `#include <lights_fragment_end>
                vec3 crownNormal=normalize(vCrownNormal);
                vec3 eye=normalize(vViewPosition);
                vec3 sunView=normalize(mat3(viewMatrix)*uGroveSun);
                float backlight=pow(max(0.,-dot(eye,sunView)),2.);
                float litRim=smoothstep(-.36,.72,dot(crownNormal,uGroveSun));
                reflectedLight.indirectDiffuse *= mix(.64,1.15,smoothstep(-.45,.62,crownNormal.y));
                reflectedLight.indirectDiffuse += diffuseColor.rgb*vec3(.83,.57,.18)*litRim*(.14+.62*backlight);`);
        };
        const bark = new T.MeshLambertMaterial({ vertexColors: true, color: '#897258' });
        bark.onBeforeCompile = shader => {
            shader.vertexShader = 'varying vec3 vGroveBark;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>', '#include <begin_vertex>\nvGroveBark=position;');
            shader.fragmentShader = 'varying vec3 vGroveBark;\n' + shader.fragmentShader.replace(
                '#include <color_fragment>', `#include <color_fragment>
                vec2 grain=vGroveBark.xz+vec2(.022,-.018)*sin(vGroveBark.y*4.);
                float furrow=sin(grain.x*38.+sin(grain.y*21.))*cos(grain.y*32.);
                diffuseColor.rgb *= .78+.26*smoothstep(-.7,.35,furrow);`);
        };
        this.materials.push(leaves,bark);
        bridgeTrees.forEach(({x,z,yaw,width,height}, i) => {
            const model = makeBridgeTree(width,height,i===0);
            const group = new T.Group();
            const y = heightAt(x,z);
            group.position.set(x,y,z);
            group.rotation.y = yaw;
            const trunk = new T.Mesh(model.trunk,bark), crown = new T.Mesh(model.canopy,leaves);
            crown.material.shadowSide = T.DoubleSide;
            crown.customDepthMaterial = new T.MeshDepthMaterial({
                depthPacking: T.RGBADepthPacking, map: this.leafTexture, alphaTest: .36, side: T.DoubleSide,
            });
            this.materials.push(crown.customDepthMaterial);
            if (i===1) {
                const tint=model.canopy.getAttribute('color');
                for (let v=0;v<tint.count;v++)
                    tint.setXYZ(v,tint.getX(v)*.76,tint.getY(v)*.97,tint.getZ(v)*1.16);
            }
            crown.castShadow = crown.receiveShadow = trunk.castShadow = trunk.receiveShadow = true;
            group.add(trunk,crown);
            this.add(group);
            this.geometry.push(model.trunk,model.canopy);
            const radius = i===0 ? .64 : .49;
            addSolid(this,{minX:x-radius,maxX:x+radius,minZ:z-radius,maxZ:z+radius,minY:y,maxY:y+4,radius});
        });
        this.traverse(object => object.layers.enable(bridgeReflectionLayer));
        this.addShoreDetails(wind);
    }

    private addShoreDetails(wind: WindUniforms) {
        const rock = makeShoreStoneGeometry(1);
        const material = makeShoreStoneMaterial(1);
        // Frame both the bridge reach AND the spawn-point river vista (west opposite bank + east ahead bank).
        const clusters: [number, number, number][] = [
            [-1,-117,3.6],[1,-111,3.0],[-1,-72,3.1],[1,-64,4.1],[-1,-50,2.5],[1,-35,3.5],
            [-1,-12,3.2],[1,-6,2.8],[-1,22,3.4],[1,30,3.1],[-1,56,3.3],[1,64,2.9],
            [-1,92,3.5],[1,98,3.2],[-1,126,3.6],[1,132,3.0],[-1,158,3.4],[1,164,2.8],[-1,188,3.0],
        ];
        const stones = new T.InstancedMesh(rock,material,clusters.length*7);
        const blades = makeGrassTuft(9);
        const grass = new T.MeshLambertMaterial({vertexColors:true, side:T.DoubleSide});
        windify(grass,wind,.16,.9,true);
        const sedges = new T.InstancedMesh(blades,grass,clusters.length*56);
        const flowerGeo = makeBankFlowerCluster();
        const flowerMat = new T.MeshLambertMaterial({vertexColors:true, side:T.DoubleSide});
        const bankFlowers = new T.InstancedMesh(flowerGeo,flowerMat,clusters.length*22);
        const cloverGeo = makeCloverPatch();
        const cloverMat = new T.MeshLambertMaterial({vertexColors:true, side:T.DoubleSide});
        const clovers = new T.InstancedMesh(cloverGeo,cloverMat,clusters.length*12);
        const shrubGeo = makeValleyShrub();
        const shrubMat = new T.MeshLambertMaterial({
            map: this.leafTexture, alphaTest: .44, alphaToCoverage: true, side: T.DoubleSide, vertexColors: true,
        });
        windify(shrubMat,wind,.14,2.6);
        const bankShrubs = new T.InstancedMesh(shrubGeo,shrubMat,clusters.length*6);
        const isGuofeng = readArtStyle() === 'guofeng';
        const instance = new T.Object3D();
        const fresh=new T.Color(isGuofeng ? '#5d7342' : '#b6e854'), deep=new T.Color(isGuofeng ? '#2c4a35' : '#4a9d4e'), color=new T.Color();
        const bloomPalette=isGuofeng ? ['#eeeae0','#e2d49a','#f2efe6','#9acbb8'] : ['#ffe44d','#fffaf0','#66b8ff','#ff8db8','#be92ff'];
        const shrubPalette=isGuofeng ? ['#4b6140','#3d543c','#5a6842','#344a3a'] : ['#a4dc64','#76c872','#56ae76','#92d86a'];
        const rockBase = rock.boundingBox!;
        const rockBox = new T.Box3();
        let count = 0;
        for (const [side,centerZ,largest] of clusters) for (let i=0;i<7;i++) {
            const z = centerZ+(randomAt(i,centerZ,209)-.5)*11;
            const offset = 21.5+randomAt(i,centerZ,210)*4.8;
            const x = riverX(z)+offset*side;
            if (trailDistance(x,z)<5) continue;
            const size = i===0 ? largest : largest * (.20+.42*randomAt(i,centerZ,211));
            const water = waterLevelAt(z);
            const groundY = heightAt(x,z);
            const y = Math.max(water-.46,Math.min(water+.95,groundY-.18));
            instance.position.set(x,y,z);
            instance.rotation.set(.12,randomAt(i,centerZ,212)*6.28,-.16);
            instance.scale.set(size,size*.51,size*.71);
            instance.updateMatrix();
            stones.setMatrixAt(count,instance.matrix);
            stones.setColorAt(count++,color.set(randomAt(i,centerZ,242)>.51?'#9ea68e':'#8c9884'));
            rockBox.copy(rockBase).applyMatrix4(instance.matrix);
            if (Math.max(rockBox.max.x - rockBox.min.x, rockBox.max.z - rockBox.min.z) > .55 && rockBox.max.y > water - .25) {
                addBoulderSolid(this, rockBox.min.x, rockBox.max.x, rockBox.min.y, rockBox.max.y, rockBox.min.z, rockBox.max.z, groundY);
            }
        }
        stones.count=count;
        stones.castShadow=stones.receiveShadow=true;
        stones.layers.enable(bridgeReflectionLayer);
        let sedgeCount=0, flowerCount=0, cloverCount=0, shrubCount=0;
        for (const [side,centerZ] of clusters) {
            for (let i=0;i<56;i++) {
                const z=centerZ+(randomAt(i,centerZ,214)-.5)*32;
                const x=riverX(z)+side*(20.4+randomAt(i,centerZ,215)*16.5);
                const y=heightAt(x,z);
                if (y<waterLevelAt(z)+.04 || trailDistance(x,z)<3.4) continue;
                const size=.82+randomAt(i,centerZ,216)*1.22;
                instance.position.set(x,y-.06,z);
                instance.rotation.set(0,randomAt(i,centerZ,217)*6.28,0);
                instance.scale.set(size*1.32,size*1.62,size*1.32);
                instance.updateMatrix();
                sedges.setMatrixAt(sedgeCount,instance.matrix);
                sedges.setColorAt(sedgeCount++,color.copy(fresh).lerp(deep,randomAt(i,centerZ,218)));
            }
            for (let i=0;i<(isGuofeng ? 8 : 22);i++) {
                const z=centerZ+(randomAt(i,centerZ,231)-.5)*30;
                const x=riverX(z)+side*(21.8+randomAt(i,centerZ,232)*15.0);
                const y=heightAt(x,z);
                if (y<waterLevelAt(z)+.18 || trailDistance(x,z)<3.6) continue;
                const size=.72+randomAt(i,centerZ,233)*.74;
                instance.position.set(x,y-.02,z);
                instance.rotation.set(0,randomAt(i,centerZ,234)*6.28,0);
                instance.scale.set(size*1.12,size*1.08,size*1.12);
                instance.updateMatrix();
                bankFlowers.setMatrixAt(flowerCount,instance.matrix);
                bankFlowers.setColorAt(flowerCount++,color.set(bloomPalette[(i+Math.abs(centerZ))%bloomPalette.length]));
            }
            for (let i=0;i<12;i++) {
                const z=centerZ+(randomAt(i,centerZ,241)-.5)*28;
                const x=riverX(z)+side*(23.4+randomAt(i,centerZ,242)*15.5);
                const y=heightAt(x,z);
                if (y<waterLevelAt(z)+.22 || trailDistance(x,z)<3.4) continue;
                const size=.90+randomAt(i,centerZ,243)*.85;
                instance.position.set(x,y,z);
                instance.rotation.set(0,randomAt(i,centerZ,244)*6.28,0);
                instance.scale.set(size*1.25,size*.95,size*1.25);
                instance.updateMatrix();
                clovers.setMatrixAt(cloverCount,instance.matrix);
                clovers.setColorAt(cloverCount++,color.set('#78c448').lerp(new T.Color('#4a9844'),randomAt(i,centerZ,245)));
            }
            for (let i=0;i<6;i++) {
                const z=centerZ+(randomAt(i,centerZ,251)-.5)*30;
                const x=riverX(z)+side*(24.6+randomAt(i,centerZ,252)*17.5);
                const y=heightAt(x,z);
                // Keep the opening spawn sightline around (79, 160) clean and unobstructed.
                if (y<waterLevelAt(z)+.42 || trailDistance(x,z)<5.5 || Math.hypot(x-79,z-160)<14) continue;
                const size=.78+randomAt(i,centerZ,253)*.84;
                instance.position.set(x,y-.08,z);
                instance.rotation.set(0,randomAt(i,centerZ,254)*6.28,0);
                instance.scale.set(size*1.18,size*.78,size*1.18);
                instance.updateMatrix();
                bankShrubs.setMatrixAt(shrubCount,instance.matrix);
                bankShrubs.setColorAt(shrubCount++,color.set(shrubPalette[(i+Math.abs(centerZ))%shrubPalette.length]));
            }
        }
        sedges.count=sedgeCount;
        sedges.receiveShadow=true;
        bankFlowers.count=flowerCount;
        bankFlowers.receiveShadow=true;
        clovers.count=cloverCount;
        clovers.receiveShadow=true;
        bankShrubs.count=shrubCount;
        bankShrubs.castShadow=bankShrubs.receiveShadow=true;
        this.add(stones,sedges,bankFlowers,clovers,bankShrubs);
        this.geometry.push(rock,blades,flowerGeo,cloverGeo,shrubGeo);
        this.materials.push(material,grass,flowerMat,cloverMat,shrubMat);
    }

    dispose() {
        this.removeFromParent();
        releaseSolids(this);
        this.traverse(object=>{ if(object instanceof T.InstancedMesh) object.dispose(); });
        this.geometry.forEach(geometry=>geometry.dispose());
        this.materials.forEach(material=>material.dispose());
        this.leafTexture?.dispose();
    }
}
