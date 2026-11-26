import assert from 'node:assert/strict';import{addSolid,releaseSolids,resolveStructures,structureFloor}from '../output/tests/runtime/world/physics/solid-world.js';
const owner={};addSolid(owner,{minX:0,maxX:2,minZ:0,maxZ:2,minY:0,maxY:4});let p={x:.1,y:1,z:1},v={x:10,y:0,z:0};resolveStructures(p,{x:-.6,y:1,z:1},v);assert.ok(p.x<=-.47);assert.equal(v.x,0);
p={x:1,y:3.8,z:1};v={x:0,y:-10,z:0};resolveStructures(p,{x:1,y:4.2,z:1},v);assert.equal(p.y,4);assert.equal(structureFloor(1,1,4),4);releaseSolids(owner);assert.equal(structureFloor(1,1,4),-Infinity);
addSolid(owner,{minX:0,maxX:4,minY:4,maxY:6,minZ:0,maxZ:4,roof:(x,z)=>5+x*.1});p={x:1,y:4.9,z:1};v={x:0,y:-1,z:0};resolveStructures(p,{x:1,y:5.3,z:1},v);assert.equal(p.y,5.1);releaseSolids(owner);
addSolid(owner,{minX:-3,maxX:3,minZ:-3,maxZ:3,minY:0,maxY:1,radius:2.7});assert.equal(structureFloor(2.8,2.8,2),-Infinity);releaseSolids(owner);console.log('PASS wall blocking, platform landing, sloped roof, ownership cleanup, no phantom platform corners');
addSolid(owner,{minX:0,maxX:2,minZ:0,maxZ:2,minY:4.5,maxY:5.2,roof:(x,z)=>5+x*.1,thickness:.45});p={x:1,y:2.9,z:1};v={x:0,y:20,z:0};resolveStructures(p,{x:1,y:2,z:1},v);assert.ok(p.y+2.3<=4.65+1e-6);assert.equal(v.y,0);releaseSolids(owner);console.log('PASS bridge underside blocks ascent');

addSolid(owner,{minX:0,maxX:2,minZ:0,maxZ:2,minY:0,maxY:.3,step:true});p={x:.1,y:0,z:1};v={x:2,y:0,z:0};resolveStructures(p,{x:-.5,y:0,z:1},v,true);assert.equal(p.y,.3);releaseSolids(owner);console.log('PASS walkable small step');

// Repeated small steps at flight speed cannot tunnel through a thin wall.
addSolid(owner,{minX:0,maxX:.12,minY:0,maxY:8,minZ:-3,maxZ:3});
p={x:-2,y:1,z:0};v={x:65,y:0,z:0};for(let i=0;i<20;i++){const before={...p};p.x+=v.x/120;resolveStructures(p,before,v);}assert.ok(p.x<=-.48);releaseSolids(owner);
// A circular trunk blocks shoulders while allowing movement outside its radius.
addSolid(owner,{minX:-.4,maxX:.4,minY:0,maxY:4,minZ:-.4,maxZ:.4,radius:.4});p={x:-.6,y:0,z:0};v={x:6,y:0,z:0};resolveStructures(p,{x:-1,y:0,z:0},v);assert.ok(p.x<=-.88);assert.equal(v.x,0);releaseSolids(owner);
console.log('PASS fast thin-wall collision and natural trunk footprint');

// Idle contact stays constant rather than receiving periodic decaying impulses.
const THREE=await import('three');
const {SurfaceWake}=await import('../output/tests/runtime/effects/surface-wake.js');
const {heightAt}=await import('../output/tests/runtime/world/geo/height.js');
const {canPlantTree}=await import('../output/tests/runtime/world/geo/height.js');
const {RoadNetwork}=await import('../output/tests/runtime/world/biomes/roads.js');
const {rivers,lakes,waterSurfaceAt,riverX}=await import('../output/tests/runtime/world/geo/geo-core.js');
const {floatingIslands,floatingFloor,islandSurfaceAt,islandLayers,islandLayerRadius,islandRimRadius,regions}=await import('../output/tests/runtime/world/geo/regions.js');
const {Meadow}=await import('../output/tests/runtime/world/flora/meadow.js');
const {meadowLayers}=await import('../output/tests/runtime/config/meadow.js');
const {templeSites}=await import('../output/tests/runtime/world/geo/peakland-plan.js');
const {makeVillageGroundTexture}=await import('../output/tests/runtime/world/biomes/village-ground.js');

const roads = new RoadNetwork();
const bridges = roads.children.filter(child => child.name === 'stone-arch-bridge');
assert.equal(bridges.length, 4);
assert.ok(roads.children.every(child => child === roads.debugGroup || child.name === 'stone-arch-bridge'));
const bridgeZ = -85, bridgeCenter = riverX(bridgeZ), water = waterSurfaceAt(bridgeCenter, bridgeZ);
const top = structureFloor(bridgeCenter, bridgeZ, 100);
assert.ok(top > water + 4);
assert.equal(structureFloor(bridgeCenter, bridgeZ, water + 2), -Infinity);
p = {x:bridgeCenter,y:water+.1,z:bridgeZ}; v = {x:0,y:2,z:0};
resolveStructures(p,{...p},v);
assert.equal(p.y,water+.1);
const landing = bridgeCenter+46;
assert.ok(Math.abs(structureFloor(landing-.01,bridgeZ,100)-heightAt(landing,bridgeZ))<.08);
roads.dispose();
assert.equal(structureFloor(bridgeCenter,bridgeZ,100),-Infinity);
console.log('PASS four unique arch bridges, clear spanning opening and ground-level landing; no stair meshes');

const { CanyonRockField } = await import('../output/tests/runtime/world/biomes/canyon-rock.js');
const { blocksCreature } = await import('../output/tests/runtime/world/physics/solid-world.js');
const canyon = new CanyonRockField();
for (const [x,z] of [[-593,-1784],[652,-1720]]) {
    const land = heightAt(x,z);
    const shelf = canyon.surfaceAt(x,z);
    assert.ok(shelf > land+135, 'canyon mesa is missing');
    assert.ok(Math.abs(structureFloor(x,z,shelf+2)-shelf)<.03,'mesh landing height differs from geology');
    assert.ok(blocksCreature(x,(land+shelf)*.5,z,.48,2.3),'cliff interior admits a moving character');
}
for (const p of rivers[0].samples.filter(p=>p.z>=-1536&&p.z<=-1250)) {
    for (const side of [-.60,0,.60]) {
        const offset=p.halfWidth*side;
        assert.ok(canyon.surfaceAt(p.x-p.flowZ*offset,p.z+p.flowX*offset)<p.waterLevel+.10,
            'a gorge wall breaks the inner waterfall ribbon');
    }
}
canyon.dispose();
assert.ok(!Number.isFinite(structureFloor(-593,-1784,1200)));
console.log('PASS independent canyon meshes support landing, stop intrusion and leave the fall core open');

for (const river of rivers) for (const point of river.samples)
    assert.equal(canPlantTree(point.x,point.z,1.65),false,river.id+' accepted a tree in the channel');
for (const lake of lakes) assert.equal(canPlantTree(lake.x,lake.z,1.65),false);
assert.equal(canPlantTree(450,250,1.65),true);
console.log('PASS planting mask excludes the main river, both tributaries and lakes');

const sky = regions.find(region=>region.id==='sky');
assert.equal(sky.x, floatingIslands[0].x);
assert.equal(sky.z, floatingIslands[0].z);
for (const island of floatingIslands) {
    assert.equal(floatingFloor(island.x,island.z,island.y+10),islandSurfaceAt(island.x,island.z,island));
    const clearance = island.y-island.r*islandLayers.at(-1).depth;
    for (let j=0;j<32;j++){
        const angle=j*Math.PI/16,radius=islandLayerRadius(island,angle,0,1);
        assert.ok(clearance>heightAt(island.x+Math.cos(angle)*radius,island.z+Math.sin(angle)*radius)+150);
    }
}
console.log('PASS eastern islands clear the terrain and share the rendered landing surface');

const walk=Object.create(SurfaceWake.prototype);
Object.assign(walk,{footCursor:1,footAnchor:new THREE.Vector3(1e9,1e9,1e9),previous:new THREE.Vector3(1e9,1e9,1e9),forward:new THREE.Vector3(),uniforms:{uWalkTrail:{value:Array.from({length:8},()=>new THREE.Vector4(0,-10000,0,0))},uTime:{value:0}},vortex:{reset(){},update(){}},field:{reset(){},update(){}}});
const walker={position:new THREE.Vector3(79,heightAt(79,160),160),velocity:new THREE.Vector3(),flying:false,heading:0,bank:0};
for(let i=0;i<600;i++){walk.update(1/60,i/60,walker);assert.equal(walk.uniforms.uWalkTrail.value[0].w,1);}
assert.equal(walk.uniforms.uWalkTrail.value.slice(1).filter(s=>s.w>0).length,0);
walker.flying=true;let last=1;for(let i=0;i<180;i++){walk.update(1/60,10+i/60,walker);const strength=walk.uniforms.uWalkTrail.value[0].w;assert.ok(strength<last);last=strength;}assert.ok(last<.0001);
console.log('PASS idle grass contact remains constant and releases monotonically');

const island = floatingIslands[0];
const villageGround=makeVillageGroundTexture();
const meadow = new Meadow(new THREE.Scene(),walk,'medium',{value:villageGround});
const islandView = new THREE.PerspectiveCamera(65,1,.35,3700);
islandView.position.set(island.x,islandSurfaceAt(island.x,island.z,island)+2,island.z);
islandView.lookAt(island.x+20,island.y,island.z-30);
meadow.update(0,islandView);
const islandGrass = meadow.group.children.slice(meadowLayers.length);
assert.equal(islandGrass.length,meadowLayers.length);
assert.ok(islandGrass.every(mesh=>mesh.visible&&mesh.geometry.instanceCount>0));
const field = islandGrass[0].material.userData.uniforms;
const x = Math.round((island.x-field.uField.value.x)/field.uField.value.z);
const z = Math.round((island.z-field.uField.value.y)/field.uField.value.z);
const data = field.uMeadow.value.image.data, index = (z*field.uFieldSize.value.x+x)*4;
assert.ok(Math.abs(data[index]-islandView.position.y+2)<.2 && data[index+1]>.8);
assert.equal(data[1],0);
const sampleField = (wx,wz,channel) => {
    const origin=field.uField.value, width=field.uFieldSize.value.x;
    const gx=(wx-origin.x)/origin.z, gz=(wz-origin.y)/origin.z, ix=Math.floor(gx), iz=Math.floor(gz);
    const u=gx-ix, v=gz-iz, i=(iz*width+ix)*4+channel;
    return (data[i]*(1-u)+data[i+4]*u)*(1-v)+(data[i+width*4]*(1-u)+data[i+width*4+4]*u)*v;
};
for (const testIsland of floatingIslands) for (let i=0;i<72;i++) {
    const angle=(i+.3)*Math.PI/36, rim=islandRimRadius(testIsland,angle);
    const x = distance=>testIsland.x+Math.cos(angle)*distance;
    const z = distance=>testIsland.z+Math.sin(angle)*distance;
    assert.ok(sampleField(x(rim-.75),z(rim-.75),1)>.8 && sampleField(x(rim-.75),z(rim-.75),3)>.28);
    assert.ok(sampleField(x(rim+.75),z(rim+.75),3)<0);
    const y=islandSurfaceAt(x(rim-.75),z(rim-.75),testIsland);
    assert.equal(floatingFloor(x(rim-.75),z(rim-.75),y+1),y);
}
walker.position.copy(islandView.position).y-=2;
walker.flying=false;
walk.update(1/60,14,walker);
assert.equal(walk.uniforms.uWalkTrail.value[0].w,1);
meadow.preloadSecondaryFields();
const distinctGrassFields = new Map();
for (const mesh of meadow.group.children) {
    const texture = mesh.material.userData.uniforms.uMeadow.value;
    if (!distinctGrassFields.has(texture)) distinctGrassFields.set(texture,mesh);
}
const [courtGrass, summitGrass] = [...distinctGrassFields.values()].slice(-2);
const courtField = courtGrass.material.userData.uniforms;
const courtSample = (x,z) => {
    const origin = courtField.uField.value;
    const column = Math.round((x-origin.x)/origin.z), row = Math.round((z-origin.y)/origin.z);
    const index = (row*courtField.uFieldSize.value.x+column)*4;
    return courtField.uMeadow.value.image.data.subarray(index,index+4);
};
const mainHall = templeSites.find(site=>site.w > 30);
let grassAroundHall = 0;
for (let z=mainHall.z-30;z<=mainHall.z+30;z+=2) for (let x=mainHall.x-40;x<=mainHall.x+40;x+=2) {
    const sample = courtSample(x,z);
    if (sample[1] > .28 && sample[3] > .28) grassAroundHall++;
}
assert.ok(grassAroundHall > 50, 'the courtyard meadow has no grass');
for (const site of templeSites)
    assert.ok(courtSample(site.x,site.z)[3] <= 0, 'grass grows through a temple foundation');
const summitField = summitGrass.material.userData.uniforms;
const summitData = summitField.uMeadow.value.image.data;
let summitSample = -1;
for (let i=0;i<summitData.length;i+=4) {
    if (summitData[i+1] > .55 && summitData[i+3] > .55) {
        summitSample = i/4;
        break;
    }
}
assert.ok(summitSample >= 0, 'the rock summits have no grass');
const summitOrigin = summitField.uField.value, summitWidth = summitField.uFieldSize.value.x;
const summitX = summitOrigin.x+(summitSample%summitWidth)*summitOrigin.z;
const summitZ = summitOrigin.y+Math.floor(summitSample/summitWidth)*summitOrigin.z;
const summitY = summitData[summitSample*4];
assert.ok(summitY > heightAt(summitX,summitZ)+.4, 'summit grass is rooted on the underlying terrain');
islandView.position.set(summitX,summitY+2,summitZ);
islandView.lookAt(summitX+10,summitY,summitZ);
meadow.update(15,islandView);
assert.ok(summitGrass.visible && summitGrass.geometry.instanceCount > 0);
meadow.dispose();
villageGround.dispose();
console.log('PASS island grass and flowers share meadow layers, cover the rim and react to footsteps');
console.log('PASS peakland grass covers courts and rock summits and clears temple foundations');
