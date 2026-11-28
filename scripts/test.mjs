import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile the actual source for headless controller/terrain checks; no mirrored movement model.
const root = process.cwd(), target = path.join(root, 'output/tests/runtime');
async function compile(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await compile(file); continue; }
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    const out = path.join(target, path.relative(path.join(root, 'src'), file).replace(/\.ts$/, '.js'));
    const source = (await fs.readFile(file, 'utf8')).replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_, a, b, c) => a + b.replace(/\.ts$/, '') + '.js' + c);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
}
await compile(path.join(root, 'src'));
const {heightAt} = await import(pathToFileURL(path.join(target, 'world/geo/height.js')));
const {terrainData} = await import(pathToFileURL(path.join(target, 'world/terrain/geometry.js')));
const {Player} = await import(pathToFileURL(path.join(target, 'player/controller.js')));
const {Group, Matrix4, Object3D, PerspectiveCamera, Scene, Vector3} = await import('three');
const {habitats, planHabitatCamps, seedsFor, species, surface} = await import(pathToFileURL(path.join(target, 'world/wildlife/wildlife-habitat.js')));
const {Creature, WildlifeSimulation} = await import(pathToFileURL(path.join(target, 'world/wildlife/wildlife-simulation.js')));
const {Wildlife} = await import(pathToFileURL(path.join(target, 'world/wildlife/wildlife.js')));
const {SwordArray} = await import(pathToFileURL(path.join(target, 'effects/sword-array.js')));
const {FireballImpact} = await import(pathToFileURL(path.join(target, 'effects/fireball-impact.js')));
const {fireballAim, fireballArc, fireballGravity, traceFireballWorld} = await import(pathToFileURL(path.join(target, 'effects/fireball-trajectory.js')));
const {regions} = await import(pathToFileURL(path.join(target, 'world/geo/regions.js')));
const {findWildlifePath, walkEdge} = await import(pathToFileURL(path.join(target, 'world/wildlife/wildlife-navigation.js')));
const {makeStoneBridge} = await import(pathToFileURL(path.join(target, 'world/biomes/stone-bridge.js')));
const {peakland} = await import(pathToFileURL(path.join(target, 'world/geo/peakland-plan.js')));
const {waterSurfaceAt} = await import(pathToFileURL(path.join(target, 'world/geo/geo-core.js')));
const {addSolid, releaseSolids} = await import(pathToFileURL(path.join(target, 'world/physics/solid-world.js')));
const {BEAST_RANKS, REALMS, SKILL_MANA_COST, computeRealmStats, evaluateSkillAvailability, rollBeastRank, xpForCreatureDefeat} = await import(pathToFileURL(path.join(target, 'player/cultivation.js')));
const {PlayerVitals} = await import(pathToFileURL(path.join(target, 'player/vitals.js')));
const results=[];
function test(name, run) { run(); results.push({name,passed:true}); console.log('PASS',name); }
function makePlayer(){const keys=new Set(),pressed=new Set();const input={keys,yaw:0,pitch:0,has:k=>keys.has(k),take:k=>{const p=pressed.has(k);pressed.delete(k);return p;}};return{p:new Player(input,new Scene()),keys,pressed,input};}
const {AdaptiveResolutionScaler, RenderFrameClock} = await import(pathToFileURL(path.join(target, 'config/device.js')));
test('frame clock maintains the 60 FPS budget across desktop refresh rates', () => {
  for (const hz of [60, 75, 90, 120, 144, 165, 240]) {
    const clock = new RenderFrameClock();
    const scaler = new AdaptiveResolutionScaler();
    let rendered = 0;
    for (let tick = 0; tick < hz * 5; tick++) {
      const elapsed = clock.step(tick * 1000 / hz);
      if (!elapsed) continue;
      rendered++;
      scaler.sample(elapsed);
    }
    assert.ok(Math.abs(rendered - 300) <= 1, `${hz} Hz rendered ${rendered} frames`);
    assert.equal(scaler.scale, 1, `${hz} Hz should not trigger a resolution drop`);
  }
  const clock = new RenderFrameClock();
  assert.equal(clock.step(0), 1 / 60);
  assert.equal(clock.step(100), .1);
  assert.equal(clock.step(105), 0);
  clock.reset();
  assert.equal(clock.step(1000), 1 / 60);
});
test('fireball charge extends the centered aim and the arc falls onto the selected surface', () => {
  const ground = (x, z) => ({height: 0, kind: x < 0 ? 'water' : 'grass'});
  const camera = new PerspectiveCamera();
  camera.position.set(0, 4, 7);
  camera.lookAt(0, 3, -100);
  const player = new Vector3();
  const near = fireballAim(camera, player, 0, ground);
  const far = fireballAim(camera, player, 1, ground);
  assert.ok(-near.z > 11 && -near.z < 13 && -far.z > 54);
  const origin = new Vector3(1, 2.4, 0);
  const {velocity, duration} = fireballArc(origin, far, 1);
  const at = t => origin.clone().addScaledVector(velocity, t).add(new Vector3(0, -.5 * fireballGravity * t * t, 0));
  assert.ok(at(duration / 2).y > origin.y + 4);
  assert.ok(at(duration).distanceTo(far) < 1e-6);
  const hit = traceFireballWorld(at(duration - .08), at(duration + .08), ground, .13);
  assert.equal(hit.ground.kind, 'grass');
  assert.equal(traceFireballWorld(new Vector3(-5, 1, 0), new Vector3(-5, -1, 1), ground).ground.kind, 'water');
  const owner = {};
  addSolid(owner, {minX:-2,maxX:2,minY:0,maxY:5,minZ:-7,maxZ:-6});
  const wall = traceFireballWorld(new Vector3(0,2,0),new Vector3(0,2,-15),ground);
  const roof = traceFireballWorld(new Vector3(0,5.17,-6.5),new Vector3(0,5.12,-6.5),
    () => ({height: 5, kind: 'stone'}), .13);
  releaseSolids(owner);
  assert.ok(wall.t > .35 && wall.t < .45);
  assert.equal(wall.ground, undefined);
  assert.deepEqual(roof.ground, {height: 5, kind: 'stone'});
});
test('fireball aftermath distinguishes grass, stone, soil and water and clears the grass tint', () => {
  const scene = new Scene();
  const impact = new FireballImpact(scene, () => ({height: 0, kind: 'stone'}));
  impact.play(new Vector3(10, 0, 0), 'grass', true);
  impact.play(new Vector3(0, 0, 0), 'stone', true);
  impact.play(new Vector3(5, 0, 0), 'soil', true);
  impact.play(new Vector3(-10, 0, 0), 'water', true);
  impact.update(.6);
  assert.equal(scene.children.filter(object => object.name === 'Fireball Ground Embers').length, 3);
  assert.equal(scene.children.filter(object => object.name === 'Fireball Stone Scorch').length, 1);
  assert.equal(scene.children.filter(object => object.name === 'Fireball Soil Scorch').length, 1);
  assert.equal(scene.children.filter(object => object.name === 'Fireball Grass Scorch').length, 1);
  assert.equal(impact.grassScorches.uFireballScorchCount.value, 1);
  assert.deepEqual(impact.grassScorches.uFireballScorches.value[0].toArray(), [10, 0, 0, 1]);
  impact.update(13);
  assert.equal(scene.children.length, 0);
  assert.equal(impact.grassScorches.uFireballScorchCount.value, 0);
  impact.dispose();
});
test('deterministic global height, including negative chunk coordinates',()=>{for(let z=-2048;z<2048;z+=97)for(let x=-1024;x<1024;x+=127){assert.equal(heightAt(x,z),heightAt(x,z));assert.ok(Number.isFinite(heightAt(x,z)));}});
test('adjacent chunk edges share identical heights and positions',()=>{const a=terrainData(0,0,128,32),b=terrainData(128,0,128,32);for(let j=0;j<=32;j++){const ia=(j*33+32)*3,ib=j*33*3;assert.deepEqual([...a.positions.slice(ia,ia+3)],[...b.positions.slice(ib,ib+3)]);}});
test('walk speed and frame-rate independence at 30/60/144 Hz',()=>{const ends=[];for(const rate of[30,60,144]){const {p,keys}=makePlayer();keys.add('KeyW');for(let i=0;i<rate*4;i++)p.step(1/rate);assert.ok(Math.abs(p.velocity.length()-6)<.1);ends.push(p.position.z);p.avatar.dispose();}assert.ok(Math.max(...ends)-Math.min(...ends)<.15);});
test('jump and land without ground penetration',()=>{const {p,keys}=makePlayer();const start=p.position.y;keys.add('Space');p.step(1/120);keys.clear();let peak=p.position.y;for(let i=0;i<240;i++){p.step(1/120);peak=Math.max(peak,p.position.y);assert.ok(p.position.y>=p.floor(p.position.x,p.position.z)-1e-6);}assert.ok(peak>start+1);assert.ok(p.grounded);p.avatar.dispose();});
test('flight boost, inertia and turn-rate cap',()=>{const {p,keys,pressed,input}=makePlayer();p.position.y=300;pressed.add('KeyF');keys.add('ShiftLeft');for(let i=0;i<600;i++)p.step(1/120);assert.ok(Math.abs(p.velocity.length()-65)<.1);keys.clear();const before=p.velocity.length();p.step(1/120);assert.ok(p.velocity.length()>60&&p.velocity.length()<before);input.yaw=Math.PI;const old=p.heading;p.step(1/120);assert.ok(Math.abs(p.heading-old)<=1.6/120+1e-6);p.avatar.dispose();});
test('sustained high-speed dives never cross analytic ground',()=>{const {p,keys,pressed,input}=makePlayer();pressed.add('KeyF');keys.add('ShiftLeft');keys.add('ControlLeft');input.pitch=-1.2;for(let i=0;i<24000;i++){input.yaw=Math.sin(i/2400)*2;p.step(1/120);assert.ok(p.position.y-p.floor(p.position.x,p.position.z)>=1.4-1e-6);}p.avatar.dispose();});
test('reset restores the original grounded spawn',()=>{const{p,pressed}=makePlayer();pressed.add('KeyF');p.step(1/120);p.reset();assert.equal(p.flying,false);assert.equal(p.position.z,160);assert.equal(p.velocity.length(),0);p.avatar.dispose();});
test('wildlife camps deterministically fill every region and keep group members apart', () => {
  assert.equal(new Set(habitats.map(h => h.region)).size, 8);
  const camps=planHabitatCamps();
  assert.equal(camps.length, habitats.length);
  assert.deepEqual(camps,planHabitatCamps());
  for(const [i,a] of camps.entries()){
    for(const b of camps.slice(i+1))if(a.region===b.region&&Math.abs(a.center.y-b.center.y)<=28)
      assert.ok(Math.hypot(a.center.x-b.center.x,a.center.z-b.center.z)>=16);
    const gap=species[a.habitat.species].radius*2.7+1.4;
    for(const [j,p] of a.homes.entries())for(const q of a.homes.slice(j+1))assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=gap-1e-6);
  }
  for (const [i, habitat] of habitats.entries()) {
    const homes = seedsFor(habitat, i + 1);
    assert.equal(homes.length, habitat.count, habitat.id);
    assert.deepEqual(homes, seedsFor(habitat, i + 1));
    for (const home of homes) {
      assert.equal(surface(habitat, home.x, home.z), home.y);
      if (habitat.island) {
        assert.ok(home.y > habitat.island.y - habitat.island.r * .1);
        assert.ok(Math.hypot(home.x - habitat.island.x, home.z - habitat.island.z) < habitat.island.r * .66);
      }
      if (habitat.biome === 'bank') assert.ok(Number.isFinite(waterSurfaceAt(home.x, home.z, 22)));
    }
  }
});
test('wildlife attack telegraphs, respects height and cooldown, and alerts its herd on a hit', () => {
  const hits = [];
  const ecology = new WildlifeSimulation((damage, creature) => hits.push([damage, creature.id]));
  const center = new Vector3(79, heightAt(79, 160), 160);
  ecology.update(0, center, undefined, 12);
  const boars = ecology.active.filter(a => a.habitat.id === 'valley-boars');
  assert.equal(boars.length, 2);
  const [boar, herd] = boars;
  boar.ready = true;
  const player = boar.position.clone().add(new Vector3(0, 0, 1.2));
  ecology.update(.26, center, player.clone().add(new Vector3(0, 20, 0)), 12);
  assert.notEqual(boar.state, 'Attack');
  ecology.damage(boar, 1);
  assert.ok(herd.angerUntil > ecology.time);
  for (let i = 0; i < 9; i++) ecology.update(.1, player, player, 12);
  assert.equal(boar.state, 'Attack');
  assert.equal(hits.length, 0);
  for (let i = 0; i < 10; i++) ecology.update(.1, player, player, 12);
  assert.deepEqual(hits, [[boar.profile.damage, boar.id]]);
});
test('a defeated creature does not respawn within sight and returns to its original habitat', () => {
  const ecology = new WildlifeSimulation(() => assert.fail('unexpected attack'));
  const center = new Vector3(79, heightAt(79, 160), 160);
  ecology.update(0, center, undefined, 12);
  const creature = ecology.active.find(a => a.habitat.species === 'flower');
  assert.ok(creature);
  creature.ready = true;
  ecology.damage(creature, creature.profile.health);
  assert.equal(creature.state, 'Defeat');
  const home = creature.home.clone();
  for (let i = 0; i < creature.profile.respawn + 2; i++) ecology.update(1, home, undefined, 12);
  assert.equal(creature.health, 0);
  assert.ok(!ecology.active.includes(creature));
  const observer=home.clone().add(new Vector3(0,0,70));
  ecology.refresh();
  ecology.update(0,observer,observer,12,true,observer,{visible:()=>true});
  assert.equal(creature.health,0);
  ecology.refresh();
  ecology.update(0, observer, undefined, 12);
  assert.equal(creature.health, creature.profile.health);
  assert.ok(creature.position.equals(home));
});
test('hit recoil pushes away from the attacker and stops at solid obstacles', () => {
  const ecology = new WildlifeSimulation(() => {});
  const center = new Vector3(79, heightAt(79, 160), 160);
  ecology.update(0, center, undefined, 12);
  const flower = ecology.active.find(a => a.habitat.species === 'flower');
  assert.ok(flower);
  flower.ready = true;
  const origin = flower.home.clone().add(new Vector3(0, 0, -1));
  ecology.damage(flower, 1, true, origin);
  ecology.update(.30, center, undefined, 12);
  assert.equal(flower.state, 'Hit');
  assert.ok(flower.position.z - flower.home.z > .3);
  const at = flower.position.clone(), wall = {};
  const front = at.z+flower.profile.radius+.025;
  addSolid(wall, {minX:at.x-1,maxX:at.x+1,minY:at.y-1,maxY:at.y+3,minZ:front,maxZ:front+1});
  ecology.damage(flower, 1, true, origin);
  ecology.update(.30, center, undefined, 12);
  assert.ok(flower.position.z - at.z < .026);
  releaseSolids(wall);
});
test('flight lookahead warms future camps and a fighting creature keeps its active slot',()=>{
  const ecology=new WildlifeSimulation(()=>{});
  const destination=planHabitatCamps().find(c=>c.habitat.id==='peaks-bank');
  const from=new Vector3(destination.center.x+560,destination.center.y,destination.center.z);
  ecology.update(0,from,undefined,12,true,undefined,{flying:true});
  assert.ok(!ecology.preload.has('water'));
  ecology.refresh();
  ecology.update(0,from,undefined,12,true,undefined,{velocity:new Vector3(-65,0,0),flying:true});
  assert.ok(ecology.preload.has('water'));
  assert.ok(!ecology.active.some(a=>a.habitat.id==='peaks-bank'));
  const center=new Vector3(79,heightAt(79,160),160);
  ecology.refresh();ecology.update(0,center,center,12);
  const boar=ecology.active.find(a=>a.habitat.species==='stone-boar');
  boar.ready=true;ecology.damage(boar,1);
  ecology.refresh();ecology.update(0,center,boar.position,1);
  assert.deepEqual(ecology.active,[boar]);
});
test('local wildlife paths go around solids and cross a real deck over a gorge',()=>{
  const habitat=habitats.find(h=>h.id==='valley-boars'),walker={habitat,profile:species['stone-boar']};
  const point=(x,z)=>new Vector3(x,heightAt(x,z),z);
  const start=point(113,150),end=point(113,164),wall={};
  addSolid(wall,{minX:111,maxX:115,minZ:156.7,maxZ:157.3,minY:start.y-7,maxY:start.y+7});
  assert.equal(walkEdge(walker,start,end.x,end.z),undefined);
  const detour=findWildlifePath(walker,start,end);
  assert.ok(detour.at(-1)?.distanceTo(end)<.01);
  for(const [i,p] of detour.entries())assert.equal(walkEdge(walker,detour[i-1]??start,p.x,p.z),p.y);
  releaseSolids(wall);
  const [a,b]=peakland.bridge.map(p=>point(p.x,p.z));
  assert.equal(walkEdge(walker,a,b.x,b.z),undefined);
  const crossing=makeStoneBridge({...a,y:a.y+.03},{...b,y:b.y+.03},4.3,wall,20);
  assert.ok(Math.abs(walkEdge(walker,a,b.x,b.z)-(b.y+.03))<.04);
  releaseSolids(wall);
  crossing.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('the player can walk and run onto the peak bridge from both terraces', () => {
  const owner = {};
  const [a,b] = peakland.bridge.map(({x,z}) => ({x,z,y:heightAt(x,z)+.03}));
  const bridge = makeStoneBridge(a,b,4.3,owner,20);
  const dx = (b.x-a.x)/bridge.length, dz = (b.z-a.z)/bridge.length;
  for (const direction of [1,-1]) for (const offset of [-3,0,3]) {
    const {p,input,keys} = makePlayer();
    const start = direction === 1 ? a : b;
    p.position.set(start.x-direction*dx*2-offset*dz,0,start.z-direction*dz*2+offset*dx);
    p.position.y = heightAt(p.position.x,p.position.z);
    input.yaw = Math.atan2(direction*dx,-direction*dz);
    keys.add('KeyW');
    if (offset !== 0) keys.add('ShiftLeft');
    let crossed = false;
    for (let i = 0; i < 1800; i++) {
      p.step(1/60);
      const distance = (p.position.x-a.x)*dx+(p.position.z-a.z)*dz;
      if (distance >= 0 && distance <= bridge.length)
        assert.ok(p.position.y >= bridge.surface(distance)-.02, 'player sank below the visible paving');
      if (direction === 1 ? distance > bridge.length+1 : distance < -1) {
        crossed = true;
        break;
      }
    }
    assert.ok(crossed, `failed to cross the peak bridge (direction ${direction}, offset ${offset})`);
  }
  releaseSolids(owner);
  bridge.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('every regional arrival has several wildlife species and high overflight keeps residents selected',()=>{
  const ecology=new WildlifeSimulation(()=>{});
  for(const region of regions){
    const p=new Vector3(...region.arrival);
    ecology.refresh();ecology.update(0,p,p,18,true,p,{flying:true});
    assert.ok(ecology.active.length>=4,region.id);
    assert.ok(new Set(ecology.active.map(a=>a.habitat.species)).size>=2,region.id);
  }
  const camp=planHabitatCamps().find(c=>c.habitat.id==='valley-boars').center;
  const above=new Vector3(camp.x,camp.y+380,camp.z);
  ecology.refresh();ecology.update(0,above,above,18,true,above,{flying:true});
  assert.ok(ecology.active.some(a=>a.habitat.id==='valley-boars'));
});
test('each rain sword reports its falling segment in world coordinates and lands once',()=>{
  const contacts=[],rain=Object.create(SwordArray.prototype),group=new Group();
  group.position.set(450,70,-740);
  Object.assign(rain,{group,nextWave:100,placement:new Object3D(),bladeMatrix:new Matrix4(),bladeDown:new Object3D().quaternion,
    tipOffset:.3,bladeLength:1,blades:[{local:new Matrix4(),instances:{setMatrixAt(){},instanceMatrix:{}}}],
    rainFx:{clear(){},trail(){},impact(){},upload(){}},onContact:e=>contacts.push(e),
    rain:[{x:2,z:-8,top:0,ground:-12,water:false,size:2,yaw:0,start:1,flight:.6,struck:new Set()}]});
  for(const time of [1.2,1.49,1.63,1.7,2.4])rain.updateRain(time,1);
  assert.equal(contacts.length,3);
  assert.equal(contacts[0].fromY,70);
  assert.equal(contacts.at(-1).toY,58);
  assert.ok(contacts.every(c=>c.x===452&&c.z===-748&&c.struck===contacts[0].struck));
  assert.deepEqual(contacts.map(c=>c.landed),[false,false,true]);
});
test('independent rain swords both hurt, but neither can double-hit the same creature',()=>{
  const world=new Wildlife(new Scene(),()=>{}),habitat=habitats.find(h=>h.id==='valley-boars');
  const boar=new Creature(991,habitat,new Vector3(454,58,-748));
  const below=new Creature(992,habitat,new Vector3(454,50,-748));
  boar.yaw=below.yaw=0;
  boar.ready=below.ready=true;
  world.simulation.active=[boar,below];
  const first={x:454,z:-748,fromY:72,toY:58.7,landed:false,struck:new Set()};
  world.rainContact(first);
  assert.equal(boar.health,boar.profile.health-17);
  world.rainContact({...first,fromY:58.7,toY:58,landed:true});
  assert.equal(boar.health,boar.profile.health-17);
  world.rainContact({...first,fromY:72,toY:58,landed:true,struck:new Set()});
  assert.equal(boar.health,boar.profile.health-34);
  world.rainContact({...first,x:455.4,toY:58,landed:true,struck:new Set()});
  assert.equal(boar.health,boar.profile.health-45);
  assert.equal(below.health,below.profile.health);
  world.dispose();
});
test('cultivation formulas enforce 21 tiers, skill MaxMP gates, tiered flight speeds, and breakthroughs', () => {
  assert.equal(REALMS[0].stages.length, 9);
  assert.equal(REALMS[1].stages.length, 4);
  assert.equal(REALMS[2].stages.length, 4);
  assert.equal(REALMS[3].stages.length, 4);

  const qi1 = computeRealmStats(0, 0);
  const qi9 = computeRealmStats(0, 8);
  const found0 = computeRealmStats(1, 0);
  const found3 = computeRealmStats(1, 3);
  const core0 = computeRealmStats(2, 0);
  const nasc0 = computeRealmStats(3, 0);
  const nasc3 = computeRealmStats(3, 3);

  assert.equal(qi1.fullLabel, '炼气一层');
  assert.equal(qi9.fullLabel, '炼气九层');
  assert.equal(nasc3.tier, 21);

  // Skill MaxMP gates: 火球术/剑气 -> 炼气; 巨剑术 -> 筑基; 万剑归宗 -> 结丹
  assert.equal(evaluateSkillAvailability('swordWave', qi1.maxMp, qi1.maxMp).canCast, true);
  assert.equal(evaluateSkillAvailability('fireball', qi1.maxMp, qi1.maxMp).canCast, true);
  assert.equal(evaluateSkillAvailability('giantSword', qi9.maxMp, qi9.maxMp).reason, 'cap');
  assert.equal(evaluateSkillAvailability('giantSword', found0.maxMp, found0.maxMp).canCast, true);
  assert.equal(evaluateSkillAvailability('swordArray', found3.maxMp, found3.maxMp).reason, 'cap');
  assert.equal(evaluateSkillAvailability('swordArray', core0.maxMp, core0.maxMp).canCast, true);

  // Tiered flight speeds: 炼气 < 筑基 < 结丹 (65 m/s) < 元婴遁光 (95 m/s)
  assert.ok(qi1.flight.boost < found0.flight.boost);
  assert.ok(found0.flight.boost < core0.flight.boost);
  assert.equal(core0.flight.boost, 65);
  assert.equal(nasc0.flight.mode, 'void');
  assert.equal(nasc0.flight.slow, 0);
  assert.equal(nasc0.flight.boost, 95);

  // Breakthrough flow
  const vitals = new PlayerVitals(false);
  vitals.fillToBreakthrough(1);
  assert.equal(vitals.canBreakthrough, true);
  assert.equal(vitals.attemptBreakthrough(2), true);
  assert.equal(vitals.stats.fullLabel, '筑基初期');
  assert.equal(vitals.spendSkillMana('giantSword', 3), true);
  assert.equal(vitals.mp, found0.maxMp - SKILL_MANA_COST.giantSword);
});
test('Nascent Soul void flight hovers at 0 m/s, toggles skywalk on KeyV, and morphs into escape light on Shift', () => {
  const {p, keys, pressed} = makePlayer();
  p.setFlightProfile(REALMS[3].flight);
  p.position.y = 200;
  pressed.add('KeyF');
  p.step(1/120);
  assert.equal(p.voidFlying, true);
  assert.equal(p.skyWalking, false);
  // Idle in void flight damps to 0 m/s hover
  for (let i = 0; i < 240; i++) p.step(1/120);
  assert.ok(p.velocity.length() < 0.1);
  // Shift -> escape light at 95 m/s
  keys.add('ShiftLeft');
  for (let i = 0; i < 600; i++) p.step(1/120);
  assert.equal(p.escapeLight, true);
  assert.ok(Math.abs(p.velocity.length() - 95) < 0.5);
  keys.clear();
  // KeyV -> Skywalk; Shift inside skywalk sprints horizontally instead of escape light
  pressed.add('KeyV');
  keys.add('KeyW');
  keys.add('ShiftLeft');
  for (let i = 0; i < 240; i++) p.step(1/120);
  assert.equal(p.skyWalking, true);
  assert.equal(p.escapeLight, false);
  assert.ok(Math.hypot(p.velocity.x, p.velocity.z) > 12 && Math.hypot(p.velocity.x, p.velocity.z) < 14);
  p.avatar.dispose();
});
test('beast rank system maps 一阶..四阶 and rewards scaled cultivation XP on defeat', () => {
  assert.deepEqual(BEAST_RANKS.map(r => r.label), ['一阶', '二阶', '三阶', '四阶']);
  const rLow = rollBeastRank('village', 'flower', 0.05);
  const rHigh = rollBeastRank('sky', 'crystal-boar', 0.99);
  assert.equal(rLow.rank, 1);
  assert.equal(rHigh.rank, 4);
  assert.ok(xpForCreatureDefeat(100, 3) > xpForCreatureDefeat(100, 0) * 10);

  const defeated = [];
  const ecology = new WildlifeSimulation(() => {}, { enableRanks: true, onDefeat: c => defeated.push(c) });
  const center = new Vector3(79, heightAt(79, 160), 160);
  ecology.update(0, center, undefined, 18);
  const target = ecology.active[0];
  assert.ok(target && target.rank.rank >= 1 && target.rank.rank <= 4);
  target.ready = true;
  ecology.damage(target, target.maxHealth + 10, true);
  assert.equal(defeated.length, 1);
  assert.equal(defeated[0], target);

  // Nighttime significantly raises high-rank beast odds & triggers nocturnal spawns
  let dayHigh = 0, nightHigh = 0;
  for (let i = 0; i < 200; i++) {
    const u = (i + 0.5) / 200;
    if (rollBeastRank('village', 'wolf', u, 0).rank >= 3) dayHigh++;
    if (rollBeastRank('village', 'wolf', u, 1).rank >= 3) nightHigh++;
  }
  assert.ok(nightHigh > dayHigh * 2, `expected night high-rank surge (${nightHigh} vs ${dayHigh})`);

  const nightSim = new WildlifeSimulation(() => {}, { enableRanks: true });
  nightSim.update(0, center, undefined, 26, true, center, { nightFactor: 1 });
  assert.ok(nightSim.agents.some(a => a.nocturnal), 'expected nocturnal prowlers to spawn at night');
});
test('skill damage scales strictly upward with cultivation realm', () => {
  const qi = new PlayerVitals(false);
  const nascent = new PlayerVitals(false);
  nascent.setRealm(3, 0, 0);
  assert.ok(nascent.stats.damageScale > qi.stats.damageScale * 7);

  const world = new Wildlife(new Scene(), () => {}, { damageMultiplier: () => ({ scale: nascent.stats.damageScale, crit: false }) });
  const habitat = habitats.find(h => h.id === 'valley-boars');
  const boar = new Creature(995, habitat, new Vector3(10, 0, 10), undefined, BEAST_RANKS[3]);
  boar.ready = true;
  world.simulation.active = [boar];
  const before = boar.health;
  world.giantSwordBlast(new Vector3(10, 0, 10), true);
  const dealt = before - boar.health;
  assert.ok(dealt > 600, `expected Nascent Soul giantSword direct hit > 600, got ${dealt}`);
  world.dispose();
});
test('divine sense scales across realms, gates astral projection, suppresses low-rank beasts, and alerts high-rank beasts', () => {
  const qi = computeRealmStats(0, 0);
  const fnd = computeRealmStats(1, 0);
  const core = computeRealmStats(2, 0);
  const nascentPeak = computeRealmStats(3, 3);
  assert.equal(qi.senseRadius, 70);
  assert.equal(qi.canAstralProject, false);
  assert.equal(qi.senseSuppressMaxRank, 0);
  assert.equal(fnd.senseSuppressMaxRank, 1);
  assert.equal(fnd.canAstralProject, false);
  assert.equal(core.canAstralProject, true);
  assert.equal(core.senseSuppressMaxRank, 2);
  assert.equal(nascentPeak.senseRadius, 1000);
  assert.equal(nascentPeak.senseSuppressMaxRank, 3);
  assert.ok(nascentPeak.senseLockRange > qi.senseLockRange * 4);

  const vitals = new PlayerVitals(false);
  assert.equal(vitals.canStartAstral(1), false);
  assert.equal(vitals.spendSensePulse(1), true);
  assert.equal(vitals.mp, vitals.stats.maxMp - vitals.stats.sensePulseCost);
  assert.ok(vitals.stats.senseDrain > 0);
  // Continuous Divine Sense drains mana and auto-closes (returns false) once MP is exhausted
  assert.equal(vitals.drainSenseMana(1, 2), true);
  assert.equal(vitals.drainSenseMana(999, 3), false);
  assert.equal(vitals.mp, 0);
  vitals.setRealm(2, 0, 4);
  assert.equal(vitals.canStartAstral(4), true);
  assert.equal(vitals.drainAstralMana(1, 5), true);

  const ecology = new WildlifeSimulation(() => {}, { enableRanks: true });
  const habitat = habitats.find(h => h.id === 'valley-boars');
  const origin = new Vector3(79, heightAt(79, 160), 160);
  const lowBeast = new Creature(9901, habitat, origin.clone().add(new Vector3(18, 0, 0)), undefined, BEAST_RANKS[0]);
  const highBeast = new Creature(9902, habitat, origin.clone().add(new Vector3(0, 0, 28)), undefined, BEAST_RANKS[3]);
  lowBeast.ready = true;
  highBeast.ready = true;
  ecology.agents.push(lowBeast, highBeast);
  ecology.active = [lowBeast, highBeast];

  // Core-formation cultivator (realmRank 3, suppressMaxRank 2) scans both rank-1 and rank-4 beasts
  const report = ecology.applyDivineSensePulse(origin, 350, 3, 2);
  assert.ok(report.detected >= 2);
  assert.ok(report.suppressedCount >= 1);
  assert.ok(report.alertedHighCount >= 1);
  assert.equal(lowBeast.state, 'Flee');
  assert.ok(lowBeast.intimidatedUntil > ecology.time);
  assert.ok(highBeast.angerUntil > ecology.time);
  assert.ok(highBeast.senseMarkedUntil > ecology.time);
});
test('sword wave heavy attack releases while moving without locking movement', () => {
  const {p, keys, pressed} = makePlayer();
  const dummyAction = (duration = 0.5) => ({
    time: 0,
    paused: false,
    reset() { this.time = 0; this.paused = false; return this; },
    setEffectiveWeight() { return this; },
    setEffectiveTimeScale(r) { this._rate = r; return this; },
    setLoop() { return this; },
    play() { return this; },
    crossFadeFrom() { return this; },
    fadeIn() { return this; },
    fadeOut() { return this; },
    stop() { return this; },
    getClip() { return { duration }; },
    _rate: 1,
  });
  const actions = new Map([
    ['Idle', dummyAction(1)],
    ['Walk', dummyAction(1)],
    ['Run', dummyAction(1)],
    ['Light_Draw', dummyAction(0.42)],
    ['Attack_Slash', dummyAction(0.75)],
    ['Sword_Ready', dummyAction(1)],
    ['Sword_Walk', dummyAction(1)],
    ['Sword_Run', dummyAction(1)],
  ]);
  const gaits = new Map([['Idle', dummyAction(1)], ['Walk', dummyAction(1)], ['Run', dummyAction(1)]]);
  Object.assign(p.avatar, {
    actions,
    gaits,
    mixer: {
      update(dt) {
        const a = p.avatar.action;
        if (!a || a.paused) return;
        a.time += dt * (a._rate ?? 1);
        if (a.time >= a.getClip().duration) { a.time = a.getClip().duration; a.paused = true; }
      },
      stopAllAction() {},
    },
  });
  let heavyReleased = 0;
  p.onHeavyHit = () => { heavyReleased++; };
  keys.add('KeyW');
  keys.add('ShiftLeft');
  for (let i = 0; i < 60; i++) p.step(1 / 60);
  const speedBefore = Math.hypot(p.velocity.x, p.velocity.z);
  assert.ok(speedBefore > 10.5);
  pressed.add('AttackHeavy');
  let minSpeedDuringCast = Infinity;
  let sawHeavyAttack = false;
  for (let i = 0; i < 90; i++) {
    p.step(1 / 60);
    assert.equal(p.avatar.movementLocked, false);
    if (p.avatar.heavyAttacking) {
      sawHeavyAttack = true;
      minSpeedDuringCast = Math.min(minSpeedDuringCast, Math.hypot(p.velocity.x, p.velocity.z));
    }
  }
  assert.equal(sawHeavyAttack, true);
  assert.equal(heavyReleased, 1);
  assert.ok(minSpeedDuringCast > 10.5, `expected full run speed during sword wave, got ${minSpeedDuringCast}`);
  p.avatar.dispose();
});
await fs.writeFile(path.join(root,'output/tests/unit-results.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));

