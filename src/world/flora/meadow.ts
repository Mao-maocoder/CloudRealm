// Blade geometry, Bezier bending and distance shells adapted from Petalwake (MIT).
// Copyright (c) 2026 Jacob Miller. See public/PETALWAKE_LICENSE.txt.
import * as T from 'three';
import { geographyGrid, gridWidth, gridDepth, gridStep, roadDistanceAt } from '../geo/geography';
import { bounds } from '../geo/geo-core';
import type { SurfaceWake } from '../../effects/surface-wake';
import { createGrassScorchUniforms } from '../../effects/fireball-impact';
import { detectDevice } from '../../config/device';
import type { Quality } from '../../config/settings';
import { heightAt, slopeAt, trailDistance, valueNoise } from '../geo/height';
import { waterSurfaceAt } from '../geo/geo-core';
import { meadowHabitatAt } from '../geo/meadow-distribution';
import { floatingIslands, islandRimRadius, islandSurfaceAt } from '../geo/regions';
import { formations, templeGrassClearance } from '../geo/peakland-plan';
import { rockGeometry } from '../biomes/peakland-rock';
import { bladeGeometry, flowerGeometry } from './meadow-geometry';
import { placementGLSL, flowerPlacementGLSL, flowerFragmentGLSL, flowerColourGLSL } from '../../rendering/meadow-shaders';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../../rendering/aerial-perspective';
import { meadowLayers, meadowQuality } from '../../config/meadow';
import { valleyArtAt, valleySward, valleyWoodland } from '../geo/valley-art';
import { regionalHabitatAt } from '../geo/regional-habitat';
import { canyonNorth, canyonSouth } from '../geo/canyon-plan';
import type { CanyonRockField } from '../biomes/canyon-rock';

function meadowField(data: Float32Array<ArrayBuffer>, x: number, z: number, step: number, width: number, height: number) {
    const texture = new T.DataTexture(data, width, height, T.RGBAFormat, T.FloatType);
    texture.minFilter = texture.magFilter = T.NearestFilter;
    texture.needsUpdate = true;
    const samplesPerCell=4, extent=step*samplesPerCell;
    const columns=Math.ceil((width-1)/samplesPerCell), rows=Math.ceil((height-1)/samplesPerCell);
    const ranges=new Float32Array(columns*rows*2);
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        let lower=Infinity,upper=-Infinity;
        for(let dz=0;dz<=samplesPerCell&&row*samplesPerCell+dz<height;dz++)
            for(let dx=0;dx<=samplesPerCell&&col*samplesPerCell+dx<width;dx++){
                const index=((row*samplesPerCell+dz)*width+col*samplesPerCell+dx)*4;
                if(data[index+1]<=0)continue;
                lower=Math.min(lower,data[index]);
                upper=Math.max(upper,data[index]);
            }
        ranges[(row*columns+col)*2]=lower;
        ranges[(row*columns+col)*2+1]=upper;
    }
    return {texture,origin:new T.Vector3(x,z,step),size:new T.Vector2(width,height),
        surfaceBounds:{extent,columns,rows,ranges}};
}

function groundField() {
    const heights = geographyGrid(), data = new Float32Array(heights.length * 4);
    for (let z = 0; z < gridDepth; z++) for (let x = 0; x < gridWidth; x++) {
        const i = z * gridWidth + x, h = heights[i], wx = bounds.left + x * gridStep, wz = bounds.north + z * gridStep;
        const dx = (heights[z * gridWidth + Math.min(gridWidth-1,x+1)] - heights[z * gridWidth + Math.max(0,x-1)]) / (gridStep*2);
        const dz = (heights[Math.min(gridDepth-1,z+1) * gridWidth + x] - heights[Math.max(0,z-1) * gridWidth + x]) / (gridStep*2);
        const slope=Math.hypot(dx,dz);
        const habitat = meadowHabitatAt(wx,wz,h,slope);
        data[i*4] = h;
        const upgrade = valleyArtAt(wx,wz);
        const shade = upgrade ? valleyWoodland(wx,wz,habitat.moisture) : 0;
        const region=regionalHabitatAt(wx,wz,h,slope,habitat.shoreDistance);
        const regionalCover=1-(1-upgrade)*region.woodland*.45;
        data[i*4+1] = habitat.cover*regionalCover*(1-upgrade*(1-valleySward(wx,wz,habitat.moisture)*(1-shade*.24)));
        data[i*4+2] = Math.max(habitat.moisture, region.moisture*(1-upgrade));
        data[i*4+3] = Math.min(64,roadDistanceAt(wx,wz));
    }
    return meadowField(data,bounds.left,bounds.north,gridStep,gridWidth,gridDepth);
}

/** Small height/cover map for the four separate, non-overlapping island tops. */
function islandField() {
    const step = 1.4;
    const extent = floatingIslands.map(island => ({ island, pad: island.r * 1.23 + step * 2 }));
    const left = Math.floor(Math.min(...extent.map(({island,pad})=>island.x-pad)));
    const north = Math.floor(Math.min(...extent.map(({island,pad})=>island.z-pad)));
    const width = 1 + Math.ceil((Math.max(...extent.map(({island,pad})=>island.x+pad))-left)/step);
    const height = 1 + Math.ceil((Math.max(...extent.map(({island,pad})=>island.z+pad))-north)/step);
    const data = new Float32Array(width * height * 4);
    for (const {island,pad} of extent) {
        const x0 = Math.max(0,Math.floor((island.x-pad-left)/step)), x1 = Math.min(width-1,Math.ceil((island.x+pad-left)/step));
        const z0 = Math.max(0,Math.floor((island.z-pad-north)/step)), z1 = Math.min(height-1,Math.ceil((island.z+pad-north)/step));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const wx = left+x*step, wz = north+z*step, dx = wx-island.x, dz = wz-island.z;
            const rim = islandRimRadius(island,Math.atan2(dz,dx));
            const shoreDistance = rim - Math.hypot(dx,dz);
            if (shoreDistance < -step*2) continue;
            const i = (z*width+x)*4;
            data[i] = islandSurfaceAt(wx,wz,island);
            const patch=valueNoise(wx*.055,wz*.055,53);
            data[i+1] = .84+.16*patch;
            data[i+2] = .38;
            data[i+3] = shoreDistance;
        }
    }
    return meadowField(data,left,north,step,width,height);
}

/** Height/cover map for one side of the canyon mesas and mid-cliff grassy shelves. */
function canyonField(canyon: CanyonRockField, side: -1 | 1) {
    const step = 6;
    const box = canyon.mesaBounds(side);
    const left = Math.floor(box.min.x / step) * step - step;
    const north = Math.floor(box.min.z / step) * step - step;
    const width = 1 + Math.ceil((box.max.x + step - left) / step);
    const height = 1 + Math.ceil((box.max.z + step - north) / step);
    const heights = new Float32Array(width * height);
    const sods = new Float32Array(width * height);
    const empty = -1e6;
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const i = z * width + x, wx = left + x * step, wz = north + z * step;
        const surface = canyon.surfaceInfoAt(wx, wz);
        if (surface) {
            const ground = heightAt(wx, wz);
            if (surface.y > ground + 2) {
                heights[i] = surface.y;
                sods[i] = surface.sod;
                continue;
            }
        }
        heights[i] = empty;
        sods[i] = 0;
    }
    const data = new Float32Array(width * height * 4);
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const i = z * width + x, h = heights[i], sod = sods[i];
        data[i * 4] = h > empty * .5 ? h : 0;
        if (sod <= .42 || x === 0 || z === 0 || x === width - 1 || z === height - 1) continue;
        let maxJump = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            maxJump = Math.max(maxJump, Math.abs(heights[(z + dz) * width + (x + dx)] - h));
        }
        if (maxJump > 6.5) continue;
        const wx = left + x * step, wz = north + z * step;
        if (trailDistance(wx, wz) < 5 || Number.isFinite(waterSurfaceAt(wx, wz, 2))) continue;
        const hx = (heights[i + 1] - heights[i - 1]) / (step * 2);
        const hz = (heights[i + width] - heights[i - width]) / (step * 2);
        const slope = Math.hypot(hx, hz);
        if (slope >= .85) continue;
        const sodCover = T.MathUtils.smoothstep(sod, .42, .82);
        const slopeFade = 1 - T.MathUtils.smoothstep(slope, .48, .85);
        const patch = .78 + .22 * valueNoise(wx * .045, wz * .045, 53);
        data[i * 4 + 1] = sodCover * slopeFade * patch;
        data[i * 4 + 2] = .28 + .22 * valueNoise(wx * .025, wz * .025, 71);
        data[i * 4 + 3] = sodCover;
    }
    return meadowField(data, left, north, step, width, height);
}

/** Grass around the temples uses a 1m grid so blades hug plinths and paving tightly without bald gaps. */
function peakTerraceField() {
    const step = 1;
    const left = 2216, north = -1624, right = 2600, south = -1408;
    const width = 1 + Math.ceil((right - left) / step);
    const height = 1 + Math.ceil((south - north) / step);
    const data = new Float32Array(width * height * 4);
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
        const wx = left + x * step, wz = north + z * step;
        const h = heightAt(wx, wz);
        const i = (z * width + x) * 4;
        data[i] = h;
        if (h < 540) continue;
        const slope = slopeAt(wx, wz);
        if (slope > .58) continue;
        const edge = 1 - T.MathUtils.smoothstep(slope, .30, .58);
        writePeakGrass(data, i, wx, wz, edge, templeGrassClearance(wx, wz) - .15);
    }
    return meadowField(data, left, north, step, width, height);
}

function writePeakGrass(data: Float32Array, i: number, x: number, z: number, edge: number, clearance: number) {
    const moisture = .26 + .22 * valueNoise(x * .025, z * .025, 71);
    data[i + 1] = edge * valleySward(x, z, moisture);
    data[i + 2] = moisture;
    data[i + 3] = Math.min(edge, Math.max(-2, clearance));
}

/** Rasterize the upward summit triangles of the same mesh used by nearby rocks. */
function peakSummitField() {
    const step = 4;
    const left = 1520, north = -2480, right = 4160, south = -630;
    const width = 1 + Math.ceil((right - left) / step);
    const height = 1 + Math.ceil((south - north) / step);
    const heights = new Float32Array(width * height).fill(-1e6);
    for (const p of formations) {
        const geometry = rockGeometry(p, 1);
        const positions = geometry.getAttribute('position'), triangles = geometry.index!;
        for (let i = 0; i < triangles.count; i += 3) {
            const a = triangles.getX(i), b = triangles.getX(i+1), c = triangles.getX(i+2);
            const ay = positions.getY(a), by = positions.getY(b), cy = positions.getY(c);
            if (Math.min(ay, by, cy) < p.top - 62) continue;
            const ax = positions.getX(a), bx = positions.getX(b), cx = positions.getX(c);
            const az = positions.getZ(a), bz = positions.getZ(b), cz = positions.getZ(c);
            const dx = bx-ax, dz = bz-az, ex = cx-ax, ez = cz-az;
            const area = dz*ex-dx*ez;
            if (area <= .01) continue;
            const x0 = Math.max(1, Math.ceil((Math.min(ax,bx,cx)-left)/step));
            const x1 = Math.min(width-2, Math.floor((Math.max(ax,bx,cx)-left)/step));
            const z0 = Math.max(1, Math.ceil((Math.min(az,bz,cz)-north)/step));
            const z1 = Math.min(height-2, Math.floor((Math.max(az,bz,cz)-north)/step));
            for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
                const wx = left+x*step-ax, wz = north+z*step-az;
                const u = (wz*ex-wx*ez)/area, v = (dz*wx-dx*wz)/area;
                if (u < -.0001 || v < -.0001 || u+v > 1.0001) continue;
                const index = z*width+x;
                heights[index] = Math.max(heights[index], ay + u*(by-ay) + v*(cy-ay));
            }
        }
        geometry.dispose();
    }
    const data = new Float32Array(width * height * 4);
    for (let z = 1; z < height - 1; z++) for (let x = 1; x < width - 1; x++) {
        const idx = z * width + x, h = heights[idx];
        if (h < 0) continue;
        const i = idx * 4;
        data[i] = h;
        const maxJump = Math.max(
            Math.abs(heights[idx - 1] - h),
            Math.abs(heights[idx + 1] - h),
            Math.abs(heights[idx - width] - h),
            Math.abs(heights[idx + width] - h),
        );
        if (maxJump > 3) continue;
        const slope = Math.hypot((heights[idx + 1] - heights[idx - 1]) / (step * 2),
            (heights[idx + width] - heights[idx - width]) / (step * 2));
        if (slope > .82) continue;
        const wx = left + x * step, wz = north + z * step;
        const aboveTerrain = h - heightAt(wx, wz);
        if (aboveTerrain < .4) continue;
        const edge = (1 - T.MathUtils.smoothstep(slope, .4, .82)) * T.MathUtils.smoothstep(aboveTerrain, 0, 1.2);
        writePeakGrass(data, i, wx, wz, edge, Infinity);
    }
    return meadowField(data, left, north, step, width, height);
}

type Field = ReturnType<typeof meadowField>;
interface Shell {
    mesh: T.Mesh<T.InstancedBufferGeometry,T.MeshLambertMaterial>;
    spacing: number;
    grid: number;
    range: number;
    flower: boolean;
    nearDetail: boolean;
    field: Field;
}

function hasGrassInRange(field:Field,p:T.Vector3,range:number) {
    const {extent,columns,rows,ranges}=field.surfaceBounds;
    const x=p.x-field.origin.x,z=p.z-field.origin.y;
    const fromX=Math.max(0,Math.floor((x-range)/extent)), toX=Math.min(columns-1,Math.floor((x+range)/extent));
    const fromZ=Math.max(0,Math.floor((z-range)/extent)), toZ=Math.min(rows-1,Math.floor((z+range)/extent));
    for(let row=fromZ;row<=toZ;row++)for(let col=fromX;col<=toX;col++){
        const dx=Math.max(0,col*extent-x,x-(col+1)*extent);
        const dz=Math.max(0,row*extent-z,z-(row+1)*extent);
        const index=(row*columns+col)*2;
        const dy=Math.max(0,ranges[index]-p.y,p.y-ranges[index+1]);
        if(dx*dx+dy*dy+dz*dz<=range*range)return true;
    }
    return false;
}

/** World-anchored blades on both heightfields, with the same species, shading and distance layers. */
export class Meadow {
    readonly group = new T.Group();
    readonly time = { value: 0 };
    private readonly focalPixels={value:570};
    private readonly ground = groundField();
    private islands?: Field;
    private canyonFields?: Field[];
    private peakFields?: Field[];
    private shells: Shell[] = [];
    private direction = new T.Vector3();

    constructor(scene: T.Scene, private wake: SurfaceWake, private quality: Quality,
        private villageGround: {value:T.Texture}, private riverbank: {value:T.Texture},
        private regionalHabitat: {value:T.Texture}, private clearingLight: {value:T.Texture},
        private riverCorridor: {value:T.Texture}, private canyon?: CanyonRockField,
        private fireballScorches = createGrassScorchUniforms()) {
        scene.add(this.group);
        this.addShells(this.ground, 0, this.compactGround);
    }

    private get compactGround() {
        return detectDevice().isMobile && this.quality === 'low';
    }

    private addShells(field: Field, islandTint = 0, compact = false) {
        const density = meadowQuality[this.quality];
        for (const [i,d] of meadowLayers.entries()) {
            // Compact mode for Peakland fields skips redundant tuft/far layers to prevent camera-turn stutter.
            if (compact && (i === 2 || i === 4 || i === 6)) continue;
            const flower = d.kind === 'flowers', spacing = 1/Math.sqrt(d.density*densityScale(density, flower)), grid = Math.ceil(d.span/spacing);
            const geometry = flower ? flowerGeometry(d.type === 0) : bladeGeometry(d.segs,d.leaves);
            geometry.instanceCount = 0;
            const material = new T.MeshLambertMaterial({ side:T.DoubleSide, alphaToCoverage:flower });
            const uniforms = {
                uMeadow:{value:field.texture},uField:{value:field.origin},uFieldSize:{value:field.size},uIslandField:{value:field!==this.ground},
                uIslandTint:{value:islandTint},
                uShell:{value:new T.Vector4(...d.fade)},uBlade:{value:new T.Vector4(d.width,d.height,d.root,i+1)},
                uType:{value:d.type},uOrigin:{value:new T.Vector2()},uGrid:{value:grid},uSpacing:{value:spacing},uDetail:{value:!flower&&i<3},
                uVillageGround:this.villageGround,uRiverbank:this.riverbank,
                uRegionalHabitat:this.regionalHabitat,uClearingLight:this.clearingLight,
                uRiverCorridor:this.riverCorridor,...this.wake.uniforms,
                ...this.fireballScorches,
                uFocalPixels:this.focalPixels,
            };
            material.userData.uniforms = uniforms;
            material.customProgramCacheKey = () => flower ? 'meadow-flowers-v4' : 'meadow-grass-v4';
            material.onBeforeCompile = shader => {
                Object.assign(shader.uniforms, uniforms, atmosphereUniforms);
                shader.vertexShader = 'varying vec3 vBladeWorld;\n' + (flower?flowerPlacementGLSL:placementGLSL)+'\n'+shader.vertexShader
                    .replace('#include <beginnormal_vertex>','vec3 bladePosition,bladeNormal;placeBlade(bladePosition,bladeNormal);vec3 objectNormal=bladeNormal;')
                    .replace('#include <begin_vertex>','vec3 transformed=bladePosition;vBladeWorld=bladePosition;');
                shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>',T.ShaderChunk.lights_lambert_pars_fragment
                    .replace('float dotNL = saturate( dot( geometryNormal, directLight.direction ) );','float dotNL = saturate( dot( geometryNormal, directLight.direction ) * .38 + .62 );'));
                shader.fragmentShader = (flower?flowerFragmentGLSL:'')
                    +`${aerialPerspectiveGLSL}\nuniform vec3 uVegTransColor,uVegRimColor;uniform float uVegTransStrength,uVegRimStrength;\n`
                    +'varying vec3 vBladeTint,vBladeWorld;varying float vBladeTip;\n'+shader.fragmentShader
                    .replace('#include <fog_fragment>', '')
                    .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.rgb*=vBladeTint;'+(flower?flowerColourGLSL:''))
                    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                        float bladeDirectLuma = dot(reflectedLight.directDiffuse, vec3(.30, .59, .11));
                        float bladeSunLit = smoothstep(.03, .28, bladeDirectLuma);
                        // Completely matte painterly Ghibli shading: cool fresh emerald in shade, warm vibrant spring-lime in sun.
                        vec3 grassShadeTone = mix(vec3(.78, .92, 1.0), vec3(.56, 1.04, .98), uAtmoLight);
                        vec3 grassSunTone = mix(vec3(1.0, 1.02, .98), vec3(1.06, 1.15, .64), uAtmoLight);
                        reflectedLight.indirectDiffuse *= mix(grassShadeTone, vec3(1.04, 1.10, .78), bladeSunLit);
                        reflectedLight.directDiffuse *= mix(vec3(1.), grassSunTone, bladeSunLit * .78);
                        vec3 bladeView = normalize(cameraPosition - vBladeWorld);
                        vec3 bladeLight = normalize(uAtmoSunDir);
                        float backTrans = pow(max(0., dot(bladeView, -bladeLight)), 2.2);
                        float tipMask = smoothstep(.18, 1., vBladeTip);
                        vec3 vegGlow = uVegTransColor * uVegTransStrength * (.32 + .68 * backTrans) * tipMask;
                        reflectedLight.directDiffuse += vegGlow * diffuseColor.rgb * (.05 + .52 * bladeSunLit);`)
                    .replace('#include <tonemapping_fragment>',`
                        float bladeDist = length(cameraPosition - vBladeWorld);
                        gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vBladeWorld), smoothstep(130., 470., bladeDist));
                        #include <tonemapping_fragment>`);
            };
            const mesh = new T.Mesh(geometry,material);
            mesh.frustumCulled = false;
            // Only near grass (<20m) samples the PCF shadow map; mid/far grass & flowers use painterly matte shading.
            mesh.receiveShadow = !flower && i < 3;
            mesh.renderOrder = 2;
            mesh.visible = false;
            this.group.add(mesh);
            const nearDetail = (!flower && i < 3) || (flower && i === 5);
            this.shells.push({mesh,spacing,grid,range:d.fade[3]+1.4,flower,nearDetail,field});
        }
    }

    private releaseShells() {
        for (const {mesh} of this.shells) {
            this.group.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.shells = [];
    }

    setQuality(quality: Quality) {
        if (this.quality === quality) return;
        this.quality = quality;
        this.releaseShells();
        this.addShells(this.ground, 0, this.compactGround);
        if (this.islands) this.addShells(this.islands, .55, this.compactGround);
        if (this.canyonFields) for (const field of this.canyonFields) this.addShells(field, 0, this.compactGround);
        if (this.peakFields) for (const field of this.peakFields) this.addShells(field, 0, true);
    }

    /** Bake canyon, floating-island, and peakland grass fields behind the welcome screen so flight never hitches. */
    preloadSecondaryFields() {
        if (this.canyon && !this.canyonFields) {
            this.canyonFields = [canyonField(this.canyon, -1), canyonField(this.canyon, 1)];
            for (const field of this.canyonFields) this.addShells(field, 0, this.compactGround);
        }
        if (!this.islands) {
            this.islands = islandField();
            this.addShells(this.islands, .55, this.compactGround);
        }
        if (!this.peakFields) {
            this.peakFields = [peakTerraceField(), peakSummitField()];
            for (const field of this.peakFields) this.addShells(field, 0, true);
        }
    }

    async preloadSecondaryFieldsAsync(nextFrame: () => Promise<void>, isDisposed: () => boolean) {
        if (detectDevice().isMobile) return; // Stream secondary regional grass fields on demand on mobile to save ~25 MB RAM/VRAM at startup.
        if (this.canyon && !this.canyonFields) {
            const left = canyonField(this.canyon, -1);
            await nextFrame();
            if (isDisposed()) { left.texture.dispose(); return; }
            const right = canyonField(this.canyon, 1);
            this.canyonFields = [left, right];
            for (const field of this.canyonFields) this.addShells(field, 0, this.compactGround);
            await nextFrame();
            if (isDisposed()) return;
        }
        if (!this.islands) {
            this.islands = islandField();
            this.addShells(this.islands, .55, this.compactGround);
            await nextFrame();
            if (isDisposed()) return;
        }
        if (!this.peakFields) {
            const terrace = peakTerraceField();
            await nextFrame();
            if (isDisposed()) { terrace.texture.dispose(); return; }
            const summit = peakSummitField();
            this.peakFields = [terrace, summit];
            for (const field of this.peakFields) this.addShells(field, 0, true);
        }
    }

    update(time: number, camera: T.Camera, viewportHeight=720) {
        this.time.value = time;
        this.focalPixels.value = Math.abs(camera.projectionMatrix.elements[5])*viewportHeight*.5;
        camera.getWorldDirection(this.direction);
        const dir = this.direction, horizontal = Math.hypot(dir.x,dir.z);
        const pos = camera.position;
        let sector: [number,number,number,number] | undefined;
        // Keep horizontal frustum-sector culling active up to ~65 deg pitch up/down (previously dropped at 25.8 deg,
        // causing rear-facing grass behind the camera to double GPU vertex workload when looking up at sky or flying!).
        if (camera instanceof T.PerspectiveCamera && horizontal > .42) {
            const yaw = Math.atan2(dir.z, dir.x);
            const half = Math.min(Math.PI, Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov * .5)) * camera.aspect / horizontal) + .34);
            if (half < Math.PI - 0.05) {
                const angles = [yaw - half, yaw + half];
                for (let i = -4; i <= 4; i++) {
                    const a = i * Math.PI * .5;
                    if (Math.abs(a - yaw) < half) angles.push(a);
                }
                const x = angles.map(Math.cos), z = angles.map(Math.sin);
                sector = [Math.min(0, ...x), Math.min(0, ...z), Math.max(0, ...x), Math.max(0, ...z)];
            }
        }
        let islandAltitude = Infinity;
        for (const island of floatingIslands) {
            if (Math.hypot(pos.x-island.x,pos.z-island.z) < island.r+270)
                islandAltitude = Math.min(islandAltitude,Math.abs(pos.y-island.y));
        }
        if (!this.islands && islandAltitude < 290) {
            this.islands = islandField();
            this.addShells(this.islands, .55, this.compactGround);
        }
        if (this.canyon && !this.canyonFields && pos.z < canyonSouth + 260 && pos.z > canyonNorth - 260 && Math.abs(pos.x) < 1900) {
            this.canyonFields = [canyonField(this.canyon, -1), canyonField(this.canyon, 1)];
            for (const field of this.canyonFields) this.addShells(field, 0, this.compactGround);
        }
        if (detectDevice().isMobile && !this.peakFields && pos.x > 1950 && pos.z < -600) {
            this.peakFields = [peakTerraceField(), peakSummitField()];
            for (const field of this.peakFields) this.addShells(field, 0, true);
        }
        const aboveGround = pos.y - heightAt(pos.x, pos.z);
        const skipNearGround = aboveGround > 22;
        for (const {mesh,spacing,grid,range,nearDetail,field} of this.shells) {
            if (skipNearGround && nearDetail && field === this.ground) {
                mesh.visible = false;
                continue;
            }
            mesh.visible = hasGrassInRange(field,pos,range);
            if (!mesh.visible) continue;
            const half = Math.floor(grid/2), cx = Math.floor(pos.x/spacing), cz = Math.floor(pos.z/spacing);
            let x0 = cx-half, z0 = cz-half, x1 = x0+grid, z1 = z0+grid;
            if(sector){
                const pad=Math.ceil(3.6/spacing);
                x0=Math.max(x0,cx+Math.floor(sector[0]*half)-pad);
                z0=Math.max(z0,cz+Math.floor(sector[1]*half)-pad);
                x1=Math.min(x1,cx+Math.ceil(sector[2]*half)+pad);
                z1=Math.min(z1,cz+Math.ceil(sector[3]*half)+pad);
            }
            if (field !== this.ground) {
                x0 = Math.max(x0,Math.floor(field.origin.x/spacing));
                z0 = Math.max(z0,Math.floor(field.origin.y/spacing));
                x1 = Math.min(x1,Math.ceil((field.origin.x+(field.size.x-1)*field.origin.z)/spacing));
                z1 = Math.min(z1,Math.ceil((field.origin.y+(field.size.y-1)*field.origin.z)/spacing));
            }
            const columns = x1-x0, rows = z1-z0;
            mesh.visible = columns > 0 && rows > 0;
            if (!mesh.visible) continue;
            const uniforms = mesh.material.userData.uniforms;
            uniforms.uOrigin.value.set(x0,z0);
            uniforms.uGrid.value = columns;
            mesh.geometry.instanceCount = columns*rows;
        }
    }

    get stats() {
        return {
            batches:this.shells.length,
            grassCandidates:this.shells.filter(s=>!s.flower&&s.mesh.visible).reduce((n,s)=>n+s.mesh.geometry.instanceCount,0),
            flowerCandidates:this.shells.filter(s=>s.flower&&s.mesh.visible).reduce((n,s)=>n+s.mesh.geometry.instanceCount,0),
            maximumCandidates:this.shells.reduce((n,s)=>n+s.grid*s.grid,0),
        };
    }

    dispose() {
        this.releaseShells();
        this.group.removeFromParent();
        this.ground.texture.dispose();
        this.islands?.texture.dispose();
        if (this.canyonFields) for (const field of this.canyonFields) field.texture.dispose();
        if (this.peakFields) for (const field of this.peakFields) field.texture.dispose();
    }
}

function densityScale(quality: number, flower: boolean) {
    return flower ? .55+.45*quality : quality;
}
