import assert from 'node:assert/strict';import fs from 'node:fs';
import{WorldPlan,worldHeightAt}from '../output/tests/runtime/world/geo/world-plan.js';
import{riverGeometry}from '../output/tests/runtime/world/biomes/river-geometry.js';
import{lakeShoreDistance,lakeShorePoint,riverBankOverlap}from '../output/tests/runtime/world/geo/geo-core.js';
import{PerspectiveCamera,MeshLambertMaterial}from 'three';
const plan=WorldPlan;const results={bounds:plan.bounds,roadConnectivity:plan.RoadNetwork.validate(),rivers:[],roadSamples:0,buriedRoadSamples:0,maxRoadGrade:0};
const width=plan.bounds.right-plan.bounds.left,depth=plan.bounds.south-plan.bounds.north;
assert.equal(width,6144);assert.equal(depth,4096);assert.equal(results.roadConnectivity.connected,true);
for(const river of plan.RiverNetwork){let minimumDepth=Infinity,maxWidthChange=0;for(let i=0;i<river.samples.length;i++){const p=river.samples[i];minimumDepth=Math.min(minimumDepth,p.waterLevel-worldHeightAt(p.x,p.z));if(i){assert.ok(p.waterLevel<=river.samples[i-1].waterLevel+1e-6);maxWidthChange=Math.max(maxWidthChange,Math.abs(p.halfWidth-river.samples[i-1].halfWidth));}}results.rivers.push({id:river.id,samples:river.samples.length,minimumDepth,maxWidthChange});assert.ok(minimumDepth>.1,river.id+' blocked by terrain');}
for(const road of plan.RoadNetwork.routes){assert.ok(road.points.length>1);for(let i=0;i<road.points.length;i++){const p=road.points[i];results.roadSamples++;if(!p.bridge&&worldHeightAt(p.x,p.z)>p.y+.6)results.buriedRoadSamples++;if(i){const a=road.points[i-1],d=Math.hypot(p.x-a.x,p.z-a.z);if(d>.01)results.maxRoadGrade=Math.max(results.maxRoadGrade,Math.abs(p.y-a.y)/d);}}}
assert.equal(results.buriedRoadSamples,0);assert.ok(results.maxRoadGrade<.95);fs.mkdirSync('output/geography',{recursive:true});fs.writeFileSync('output/geography/validation.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
// A ribbon must stay connected around bends; separate quads leave visible wedges.
const water=riverGeometry(),index=water.index.array,parent=new Map();const find=x=>{if(parent.get(x)!==x)parent.set(x,find(parent.get(x)));return parent.get(x);};
for(const i of index)parent.set(i,i);for(let i=0;i<index.length;i+=3){parent.set(find(index[i]),find(index[i+1]));parent.set(find(index[i]),find(index[i+2]));}
const components=new Set([...parent.keys()].map(find)).size;assert.equal(components,WorldPlan.RiverNetwork.length+WorldPlan.Waterfalls.length+WorldPlan.Lakes.length);assert.equal(water.getAttribute('flow').count,water.getAttribute('position').count);water.dispose();console.log('PASS continuous river ribbons and flow attributes');



// Dijkstra over the authored road graph: every named destination needs a finite route cost.
const graph=new Map(plan.RoadNetwork.nodes.map(n=>[n.id,[]]));
for(const route of plan.RoadNetwork.routes){
 const length=route.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-route.points[i].x,p.y-route.points[i].y,p.z-route.points[i].z),0);
 const ids=[route.from,...route.via,route.to];
 for(let i=1;i<ids.length;i++){graph.get(ids[i-1]).push([ids[i],length/(ids.length-1)]);graph.get(ids[i]).push([ids[i-1],length/(ids.length-1)]);}
 for(let i=1;i<route.points.length;i++)assert.ok(Math.hypot(route.points[i].x-route.points[i-1].x,route.points[i].z-route.points[i-1].z)<40,'physical road gap');
}
const costs=new Map([...graph.keys()].map(id=>[id,Infinity])),remaining=new Set(graph.keys());costs.set('village',0);
while(remaining.size){let current;for(const id of remaining)if(current===undefined||costs.get(id)<costs.get(current))current=id;if(!Number.isFinite(costs.get(current)))break;remaining.delete(current);for(const [next,weight]of graph.get(current))costs.set(next,Math.min(costs.get(next),costs.get(current)+weight));}
assert.ok([...costs.values()].every(Number.isFinite));
// Test physical tributary joins against parent segments, not just declared metadata.
for(const river of plan.RiverNetwork){if(!river.joins)continue;const parentRiver=plan.RiverNetwork.find(r=>r.id===river.joins);assert.ok(parentRiver);const end=river.samples.at(-1);let nearest=Infinity,joinLevel=0;
 for(let i=1;i<parentRiver.samples.length;i++){const a=parentRiver.samples[i-1],b=parentRiver.samples[i],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((end.x-a.x)*dx+(end.z-a.z)*dz)/(dx*dx+dz*dz)));const d=Math.hypot(end.x-a.x-t*dx,end.z-a.z-t*dz);if(d<nearest){nearest=d;joinLevel=a.waterLevel+(b.waterLevel-a.waterLevel)*t;}}
 assert.ok(nearest<1,'tributary disconnected in space');assert.ok(Math.abs(end.waterLevel-joinLevel)<.15,'tributary water step');
 const seen=new Set([river.id]);let next=parentRiver;while(next){assert.ok(!seen.has(next.id),'river cycle');seen.add(next.id);next=plan.RiverNetwork.find(r=>r.id===next.joins);}
}
fs.writeFileSync('output/geography/connectivity.json',JSON.stringify({algorithm:'Dijkstra',roadCosts:Object.fromEntries(costs),physicalRiverJoins:true},null,2));
console.log('PASS Dijkstra road reachability, physical road gaps, river joins and directed acyclic drainage');

const flowing=riverGeometry();assert.equal(flowing.getAttribute('stream').count,flowing.getAttribute('position').count);
let riverOffset=0;for(const river of plan.RiverNetwork){for(let i=1;i<river.samples.length;i++)assert.ok(flowing.getAttribute('stream').getX(riverOffset+i*9)>flowing.getAttribute('stream').getX(riverOffset+(i-1)*9));riverOffset+=river.samples.length*9;}flowing.dispose();
console.log('PASS river texture coordinates increase strictly downstream');

// The visible shore must be an intersection with the banks, not the end of a suspended strip.
const riverMesh = riverGeometry(), waterPositions = riverMesh.getAttribute('position');
let base = 0, bankSamples = 0, minimumBankCover = Infinity;
for (const river of plan.RiverNetwork) {
 for (let row = 1; row < river.samples.length - 1; row++) for (const edge of [0, 8]) {
  const index = base + row * 9 + edge;
  const x = waterPositions.getX(index), y = waterPositions.getY(index), z = waterPositions.getZ(index);
  if (z < plan.bounds.north || z > plan.bounds.south ||
      plan.Waterfalls.some(f => z >= f.north - 12 && z <= f.south + 12) ||
      plan.Lakes.some(lake => lakeShoreDistance(lake,x,z)<(lake.id==='southeast-bay'?24:12)) ||
      plan.RiverNetwork.some(other => other !== river && other.samples.some(p => Math.hypot(x - p.x, z - p.z) < p.halfWidth * (1 + riverBankOverlap))))
   continue;
  minimumBankCover = Math.min(minimumBankCover, worldHeightAt(x, z) - y);
  bankSamples++;
 }
 base += river.samples.length * 9;
}
riverMesh.dispose();
assert.ok(bankSamples > 1000 && minimumBankCover > 0, 'an ordinary river edge sits above its bank');
console.log('PASS river edges overlap terrain', {bankSamples, minimumBankCover});

const bay=plan.Lakes.find(lake=>lake.id==='southeast-bay');
for(let i=0;i<192;i++){
 const angle=i/192*Math.PI*2, rim=lakeShorePoint(bay,angle), outer=lakeShorePoint(bay,angle,24);
 assert.ok(Math.abs(lakeShoreDistance(bay,rim.x,rim.z))<1e-5,'water and terrain disagree on the bay profile');
 assert.ok(lakeShoreDistance(bay,outer.x,outer.z)>23.99,'bay water mesh must overlap the bank');
}

// CDLOD tiles cover the world once, have bounded submission and converge to the parent grid.
const {selectTerrainNodes,morphTerrainVertex,TerrainLOD}=await import('../output/tests/runtime/world/terrain/terrain-lod.js');
for(const [x,z,altitude]of [[79,160,0],[0,-1500,100],[700,-400,400],[-2048,-2400,0],[2048,-1420,70],[2470,-1520,45]]){
 const nodes=selectTerrainNodes(x,z,altitude);assert.ok(nodes.length<16384);assert.equal(nodes.reduce((sum,n)=>sum+n.size*n.size,0),width*depth);
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];assert.ok(Math.min(a.x+a.size,b.x+b.size)<=Math.max(a.x,b.x)||Math.min(a.z+a.size,b.z+b.size)<=Math.max(a.z,b.z),'overlapping LOD nodes');}
 const tile={x:0,z:0,size:32,level:0};const near=morphTerrainVertex(tile,1/16,3/16,2,6,0),far=morphTerrainVertex(tile,1/16,3/16,10000,10000,0);assert.deepEqual(near,[2,6]);assert.deepEqual(far,[0,4]);
 console.log('PASS CDLOD coverage / non-overlap', {x,z,altitude,nodes:nodes.length,triangles:nodes.length*512});
}

const lodMaterial = new MeshLambertMaterial(), terrain = new TerrainLOD(lodMaterial);
const view = new PerspectiveCamera(65, 16 / 9, .35, 3700);
view.position.set(80, worldHeightAt(80, 160) + 12, 160);
view.lookAt(0, 200, -1600);
terrain.update(view, 288);
const visibleNorth = terrain.nodes;
const unculled = selectTerrainNodes(80, 160, 0, 288);
assert.ok(visibleNorth.length > 0 && visibleNorth.length < unculled.length);
view.lookAt(80, 20, 1300);
terrain.update(view, 288);
assert.ok(terrain.nodes.length > 0 && terrain.nodes.some(n => n.z > view.position.z));
assert.ok(visibleNorth.some(n => n.z + n.size < view.position.z));
terrain.dispose();
lodMaterial.dispose();
console.log('PASS camera frustum selects different terrain when facing north and south',
 {northNodes:visibleNorth.length,southNodes:terrain.nodes.length,unculled:unculled.length});

// Coarse/fine boundaries must coincide after geomorph, including the interpolated height.
for(const [x,z,altitude]of [[79,160,0],[0,-1500,100],[700,-400,400],[2048,-1420,80]]){
 const nodes=selectTerrainNodes(x,z,altitude);let joins=0;
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  let a=nodes[i],b=nodes[j];if(a.size>b.size)[a,b]=[b,a];if(a.size===b.size)continue;
  let vertical=false,fixed=0,start=0,end=0;
  if((a.x+a.size===b.x||b.x+b.size===a.x)&&Math.min(a.z+a.size,b.z+b.size)>Math.max(a.z,b.z)){vertical=true;fixed=a.x+a.size===b.x?b.x:a.x;start=Math.max(a.z,b.z);end=Math.min(a.z+a.size,b.z+b.size);}
  else if((a.z+a.size===b.z||b.z+b.size===a.z)&&Math.min(a.x+a.size,b.x+b.size)>Math.max(a.x,b.x)){fixed=a.z+a.size===b.z?b.z:a.z;start=Math.max(a.x,b.x);end=Math.min(a.x+a.size,b.x+b.size);}
  else continue;
  assert.equal(b.size,a.size*2,'adjacent LOD gap');
  const coarse=[];for(let k=0;k<=16;k++){const wx=vertical?fixed:b.x+k*b.size/16,wz=vertical?b.z+k*b.size/16:fixed;coarse.push(morphTerrainVertex(b,(wx-b.x)/b.size,(wz-b.z)/b.size,x,z,altitude));}
  for(let k=0;k<=16;k++){const along=start+(end-start)*k/16,wx=vertical?fixed:along,wz=vertical?along:fixed;const fine=morphTerrainVertex(a,(wx-a.x)/a.size,(wz-a.z)/a.size,x,z,altitude);assert.ok(coarse.some(c=>Math.hypot(c[0]-fine[0],c[1]-fine[1])<1e-6),'LOD edge did not collapse onto parent');}
  joins++;
 }console.log('PASS CDLOD matched coarse/fine boundaries',joins);
}
