import * as T from 'three';
import { heightAt } from '../geo/height';
import { floatingIslands, islandSurfaceAt, type Region } from '../geo/regions';
import { addSolid } from '../physics/solid-world';
import { peakland } from '../geo/peakland-plan';
import { HouseGeometry, makeHouseMaterial, masonry } from './house-geometry';
import { makeHouse, type HouseKind } from './house-models';
import { atmosphereUniforms } from '../../rendering/aerial-perspective';
import {populateVillageDetails} from './village-ground';

type Lot = readonly [
    x: number, z: number, width: number, depth: number, height: number, island?: number,
];

/** Plot envelopes in metres. Each row is one independently movable building. */
export const buildingLots: Readonly<Record<string, readonly Lot[]>> = {
    village: [
        // Two rows frame the common ground. The west side opens towards the main path.
        [125, 188, 14, 10, 8],
        [145, 188, 14, 10, 8],
        [164, 192, 16, 11, 9],
        [185, 200, 14, 10, 8],
        [135, 232, 17, 13, 9],
        [161, 232, 24, 16, 12],
        [187, 232, 15, 11, 9],
        [206, 218, 13, 10, 8],
        [111, 214, 14, 9, 7],
        [101, 236, 13, 10, 7],
        [174, 171, 16, 11, 9],
        [197, 178, 16, 11, 9],
        [225, 192, 17, 12, 10],
        [129, 249, 13, 9, 7],
        [222, 247, 13, 11, 8],
        // Courtyard at the bridge road and a lower row facing the fields.
        [245, 165, 19, 13, 10],
        [271, 153, 18, 12, 9],
        [294, 170, 24, 16, 12],
        [261, 187, 16, 11, 8],
        [282, 200, 16, 11, 8],
        [318, 190, 17, 12, 9],
    ],
    sakura: [
        // The hall sits at the back of a south-facing courtyard.
        [620, -424, 13, 10, 7],
        [642, -435, 22, 13, 10],
        [668, -418, 14, 10, 7],
        [600, -403, 10, 9, 6],
        [639, -395, 11, 9, 6],
        [667, -392, 10, 9, 6],
    ],
    snow: [
        // The uphill hall is visible between the smaller buildings at the entrance.
        [130, -1628, 24, 16, 13],
        [108, -1611, 14, 11, 8],
        [154, -1611, 14, 11, 8],
    ],
    autumn: [
        // Small hillside hamlet with its open side towards the trail.
        [-741, -438, 15, 11, 7],
        [-720, -445, 10, 8, 5],
        [-748, -417, 10, 8, 5],
    ],
    bamboo: [
        // A central hall and two small buildings follow the clearing beside the trail.
        [-610, 623, 17, 12, 8],
        [-590, 610, 10, 8, 6],
        [-576, 619, 12, 9, 6],
    ],
    lake: [
        // One shore settlement facing open water, with its larger building set back.
        [160, 1351, 17, 11, 7],
        [186, 1337, 12, 9, 6],
        [137, 1337, 10, 8, 5],
    ],
    sky: [
        // Group the buildings on the main island's west terrace, leaving the eastern meadow open.
        [1520, -1179, 22, 15, 10, 0],
        [1508, -1156, 11, 10, 7, 0],
        [1542, -1153, 14, 10, 8, 0],
    ],
};

const allLots = Object.values(buildingLots).flat();
type Facade = readonly [kind: HouseKind, turn: number, variant?: number];
const facades: Readonly<Record<string, readonly Facade[]>> = {
    village: [
        ['cottage',0,1], ['cottage',0,0], ['cottage',0,2], ['cottage',0,1],
        ['cottage',2,2], ['manor',2], ['cottage',2,0], ['cottage',3,1],
        ['overhang',1], ['cottage',2,1], ['belltower',0], ['cottage',1,2],
        ['overhang',3], ['cottage',2,2], ['cottage',2,0],
        ['overhang',0], ['cottage',3,1], ['manor',0],
        ['cottage',2,1], ['cottage',2,2], ['overhang',3],
    ],
    sakura: [['forge',0],['mushroom',0],['thatch',3],['mushroom',1,1],['thatch',2],['mushroom',3]],
    snow: [['belltower',0],['cottage',1,1],['cottage',3,2]],
    autumn: [['crooked',1],['cottage',3,2],['cottage',2,1]],
    bamboo: [['manor',0],['cottage',0,1],['cottage',3,0]],
    lake: [['overhang',2],['cottage',2,1],['cottage',1,2]],
    sky: [['belltower',0],['cottage',1,0],['cottage',3,2]],
};
const specialScale: Partial<Record<HouseKind,readonly [footprint: number, height: number]>> = {
    overhang:[.93,1.26], manor:[.94,1.25], crooked:[.70,1.79],
    belltower:[.76,1.63], mushroom:[.88,1.14], thatch:[.76,1.22],
};

export function inBuildingLot(x: number, z: number, margin: number, island?: number) {
    return allLots.some(([cx,cz,width,depth,,lotIsland]) =>
        lotIsland === island && Math.abs(x-cx) < width/2+margin && Math.abs(z-cz) < depth/2+margin,
    );
}

export function buildingViewTarget(region: Region) {
    if (region.id === peakland.id) return peakland.outlook;
    const lots = buildingLots[region.id];
    if (!lots?.length) return { x:region.x, y:heightAt(region.x,region.z)+15, z:region.z };
    let x = 0, y = 0, z = 0;
    for (const [cx,cz,,,height,island] of lots) {
        x += cx;
        z += cz;
        y += (island === undefined ? heightAt(cx,cz) : islandSurfaceAt(cx,cz,floatingIslands[island])) + height*.65;
    }
    return { x:x/lots.length, y:y/lots.length, z:z/lots.length };
}

export function populateBuildingLayout(group: T.Group, region: Region, time?: {value:number}) {
    const lots = buildingLots[region.id];
    if (!lots?.length) return;

    const regionFacades=facades[region.id];
    if (lots.length !== regionFacades?.length)
        throw new Error('Building list and plot count disagree for '+region.id);
    const material = makeHouseMaterial();
    const glass = new T.MeshBasicMaterial({ vertexColors:true, side:T.DoubleSide });
    glass.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.fragmentShader = 'uniform float uAtmoLight;\n' + shader.fragmentShader.replace(
            '#include <tonemapping_fragment>',
            `float nightGlow = 1.0 - smoothstep(0.42, 0.86, uAtmoLight);
            gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.88, vec3(1.95, 1.32, 0.56), nightGlow * 0.92);
            #include <tonemapping_fragment>`
        );
    };
    const instance = new T.Object3D();
    const buildings = new T.Group();
    buildings.name = 'building-layout-' + region.id;
    group.add(buildings);
    const batches = new Map<string,{kind:HouseKind; variant:number; matrices:T.Matrix4[]}>();
    const footings: T.Matrix4[] = [];
    for (const [index, [x,z,width,depth,height,island]] of lots.entries()) {
        const [kind, turns, variant=0]=regionFacades[index];
        const [footprint, rise]=specialScale[kind]??[.91,.95];
        const w=width*footprint, d=depth*footprint;
        const halfX=w*.38, halfZ=d*.38;
        const minX=x-halfX, maxX=x+halfX, minZ=z-halfZ, maxZ=z+halfZ;
        const columns = Math.ceil(halfX), rows = Math.ceil(halfZ);
        let base = Infinity, high = -Infinity;
        for (let i = 0; i <= columns; i++) for (let j = 0; j <= rows; j++) {
            const px = minX+2*halfX*i/columns, pz = minZ+2*halfZ*j/rows;
            const y = island === undefined ? heightAt(px,pz) : islandSurfaceAt(px,pz,floatingIslands[island]);
            base = Math.min(base,y);
            high = Math.max(high,y);
        }
        const floor=high+.055, modelHeight=height*rise;
        const modelKey=kind+':'+variant;
        const batch=batches.get(modelKey)??{kind,variant,matrices:[]};
        instance.position.set(x,floor,z);
        instance.rotation.y=turns*Math.PI/2;
        instance.scale.set(turns%2 ? d : w,modelHeight,turns%2 ? w : d);
        instance.updateMatrix();
        batch.matrices.push(instance.matrix.clone());
        batches.set(modelKey,batch);

        instance.position.set(x,base-.21,z);
        instance.rotation.y=0;
        instance.scale.set(halfX*2,floor-base+.21,halfZ*2);
        instance.updateMatrix();
        footings.push(instance.matrix.clone());
        addSolid(group,{minX,maxX,minY:base-.21,maxY:floor+modelHeight*.54,minZ,maxZ});
        if (kind==='belltower'||kind==='crooked') {
            addSolid(group,{
                minX:x-w*.12,maxX:x+w*.12,minZ:z-d*.17,maxZ:z+d*.17,
                minY:floor+modelHeight*.50,maxY:floor+modelHeight*.80,
            });
        }
    }
    const addBatch = (geometry:T.BufferGeometry, surface:T.Material, matrices:T.Matrix4[], name:string, opaque:boolean) => {
        const mesh = new T.InstancedMesh(geometry,surface,matrices.length);
        mesh.name=name;
        matrices.forEach((matrix,index)=>mesh.setMatrixAt(index,matrix));
        mesh.instanceMatrix.needsUpdate=true;
        mesh.computeBoundingSphere();
        mesh.castShadow=mesh.receiveShadow=opaque;
        buildings.add(mesh);
    };
    for (const batch of batches.values()) {
        const { shell,glow }=makeHouse(batch.kind,batch.variant);
        addBatch(shell,material,batch.matrices,batch.kind,true);
        if (glow) addBatch(glow,glass,batch.matrices,batch.kind+'-windows',false);
    }
    const foundation=new HouseGeometry(83);
    masonry(foundation,0,0,3.74,3.74,0,.66,'#899297',2);
    addBatch(foundation.finish().shell,material,footings,'stone-footings',true);
    if(region.id==='village')populateVillageDetails(buildings,time);
}
