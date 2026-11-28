import * as T from 'three';
import { readArtStyle, type Quality } from '../config/settings';
import type { Player } from '../player/controller';
import { Sky } from './sky';
import { Water } from './water';
import { Petals } from './petals';
import { SkyBirds } from './sky-birds';
import { Fireflies } from './fireflies';
import { ValleyCloudSea } from './valley-cloud-sea';
import type { SpawnShoreGrass } from '../rendering/spawn-shore-grass';
import { DayNightCycle } from './day-night';
import { atmosphereUniforms } from '../rendering/aerial-perspective';
import { valleyArtAt } from '../world/geo/valley-art';
import { art } from '../config/art';
import { detectDevice } from '../config/device';

/**
 * Owns the atmospheric look & day-night cycle: global lighting, exponential
 * haze, the painted sky dome with stars & moon, stylised river/lake, and drifting petals.
 */
export class Atmosphere {
    readonly sky: Sky;
    readonly water: Water;
    readonly petals: Petals;
    readonly birds: SkyBirds;
    readonly fireflies: Fireflies;
    readonly cloudSea: ValleyCloudSea;
    readonly dayNight = new DayNightCycle();
    readonly sunDirection: T.Vector3;
    private quality: Quality;
    private readonly scene: T.Scene;
    private readonly sun: T.DirectionalLight;
    private readonly ambient: T.AmbientLight;
    private readonly hemi: T.HemisphereLight;
    private readonly fill: T.DirectionalLight;
    private omenIntensity = 0;
    private omenFlash = 0;
    private omenGold = 0;
    private omenWind = 0;
    private readonly omenShock = new T.Vector4(0, 0, 0, 0);
    private baseFogDensity = 0.00024;
    private readonly omenSunCol = new T.Color('#dfba74');
    private readonly omenSunStormCol = new T.Color('#8e9fc2');
    private readonly omenAmbCol = new T.Color('#242f49');
    private readonly omenHemiSky = new T.Color('#3a486b');
    private readonly omenHemiGnd = new T.Color('#131a2b');
    private readonly omenFogCol = new T.Color('#222c42');
    private readonly omenAirCol = new T.Color('#28334c');
    private readonly omenMistCol = new T.Color('#303d58');
    private readonly omenWaterBody = new T.Color('#687a96');
    private readonly omenWaterHigh = new T.Color('#0e1526');
    private readonly omenWaterLow = new T.Color('#2b3852');
    private readonly omenWaterSpecCol = new T.Color('#e2be76');
    private readonly omenVegRim = new T.Color('#ddb668');
    private readonly omenFlashTint = new T.Color('#a8b8e6');
    private readonly tmpOmenSun = new T.Color();
    private readonly isGuofeng = readArtStyle() === 'guofeng';
    private guofengRegionWeight = readArtStyle() === 'guofeng' ? 1 : 0;
    private readonly gfSunCol = new T.Color('#ffeed0');
    private readonly gfAmbCol = new T.Color('#8ba8c4');
    private readonly gfHemiSky = new T.Color('#9ec0dc');
    private readonly gfHemiGnd = new T.Color('#2c4435');
    private readonly gfFillCol = new T.Color('#7ca0bf');
    private readonly gfFogCol = new T.Color('#b6cce0');
    private readonly gfAirCol = new T.Color('#6b8fae');
    private readonly gfSunAirCol = new T.Color('#dce6ec');
    private readonly gfMistCol = new T.Color('#d8e5ee');
    private readonly gfDuskMistCol = new T.Color('#ebd8d3');
    private readonly gfDuskAirCol = new T.Color('#97a6c2');
    private readonly gfDuskSunAirCol = new T.Color('#f7dfca');
    private readonly gfWaterBody = new T.Color('#c8d4cf');
    private readonly gfWaterLow = new T.Color('#b8c8cf');
    private readonly gfWaterHigh = new T.Color('#6a8292');
    private readonly gfWaterSpec = new T.Color('#fff4dc');
    private readonly gfVegTrans = new T.Color('#c2c468');
    private readonly gfVegRim = new T.Color('#e2d8a6');
    private shadowFrame = 0;
    private readonly lastShadowPos = new T.Vector3(Infinity, Infinity, Infinity);

    setOmen(
        intensity: number,
        flash: number,
        goldWeight = 0,
        windStrength = intensity,
        shock?: { x: number; z: number; radius: number; strength: number },
    ) {
        this.omenIntensity = T.MathUtils.clamp(intensity, 0, 1);
        this.omenFlash = T.MathUtils.clamp(flash, 0, 1);
        this.omenGold = T.MathUtils.clamp(goldWeight, 0, 1);
        this.omenWind = T.MathUtils.clamp(windStrength, 0, 1);
        if (shock && shock.strength > 0.002) {
            this.omenShock.set(shock.x, shock.z, shock.radius, shock.strength);
        } else {
            this.omenShock.set(0, 0, 0, 0);
        }
    }

    constructor(scene: T.Scene, quality: Quality, spawnShoreGrass?: SpawnShoreGrass) {
        this.scene = scene;
        this.quality = quality;
        scene.fog = new T.FogExp2('#cfe4e2', 0.0011);
        this.ambient = new T.AmbientLight('#e2efff', .24);
        scene.add(this.ambient);
        this.hemi = new T.HemisphereLight('#d7ecff', '#5b7a45', .62);
        scene.add(this.hemi);
        const sun = new T.DirectionalLight('#fff6d6', art.shadowStrength * 1.15);
        sun.position.set(-250, 300, -380);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.left = -82;
        sun.shadow.camera.right = 82;
        sun.shadow.camera.top = 82;
        sun.shadow.camera.bottom = -82;
        sun.shadow.camera.near = 60;
        sun.shadow.camera.far = 760;
        sun.shadow.bias = -.0005;
        sun.shadow.normalBias = .045;
        sun.shadow.radius = 2.6;
        sun.shadow.intensity = .86;
        sun.target.position.set(0, 0, 0);
        scene.add(sun);
        scene.add(sun.target);
        this.sun = sun;
        this.fill = new T.DirectionalLight('#a8cde4', 0.14);
        this.fill.position.set(260, 140, 190);
        scene.add(this.fill);
        this.sky = new Sky(scene);
        this.sunDirection = this.sky.sunDirection;
        this.water = new Water(scene, this.sunDirection, spawnShoreGrass);
        this.petals = new Petals(scene, quality);
        this.birds = new SkyBirds(scene, quality, this.sunDirection);
        this.fireflies = new Fireflies(scene, quality);
        this.cloudSea = new ValleyCloudSea(scene);
        this.setQuality(quality);
        this.applyDayNight();
    }

    private applyDayNight() {
        const s = this.dayNight.state;
        this.sky.applyDayNight(s);
        this.sun.color.copy(s.sunColor);
        this.sun.intensity = art.shadowStrength * s.sunIntensity;
        this.ambient.color.copy(s.ambientColor);
        this.ambient.intensity = s.ambientIntensity;
        this.hemi.color.copy(s.hemiSky);
        this.hemi.groundColor.copy(s.hemiGround);
        this.hemi.intensity = s.hemiIntensity;
        this.fill.color.copy(s.fillColor);
        this.fill.intensity = s.fillIntensity;
        if (this.scene.fog instanceof T.FogExp2) {
            this.scene.fog.color.copy(s.fogColor);
        }
        atmosphereUniforms.uAtmoAir.value.copy(s.airColor);
        atmosphereUniforms.uAtmoSunAir.value.copy(s.sunAirColor);
        atmosphereUniforms.uAtmoMist.value.copy(s.mistColor);
        atmosphereUniforms.uAtmoSunDir.value.copy(s.lightDirection);
        atmosphereUniforms.uAtmoLight.value = s.atmoLight;
        atmosphereUniforms.uNightFactor.value = s.nightFactor;
        atmosphereUniforms.uDuskFactor.value = s.duskFactor;
        atmosphereUniforms.uHeightFogDensity.value = s.heightFogDensity;
        atmosphereUniforms.uWaterBodyTint.value.copy(s.waterBodyTint);
        atmosphereUniforms.uWaterSkyLow.value.copy(s.waterSkyLow);
        atmosphereUniforms.uWaterSkyHigh.value.copy(s.waterSkyHigh);
        atmosphereUniforms.uWaterSpec.value.copy(s.waterSpec);
        atmosphereUniforms.uWaterSpecPower.value = s.waterSpecPower;
        atmosphereUniforms.uVegTransColor.value.copy(s.vegTransColor);
        atmosphereUniforms.uVegTransStrength.value = s.vegTransStrength;
        atmosphereUniforms.uVegRimColor.value.copy(s.vegRimColor);
        atmosphereUniforms.uVegRimStrength.value = s.vegRimStrength;
        atmosphereUniforms.uOmenWind.value = this.omenWind;
        atmosphereUniforms.uOmenShock.value.copy(this.omenShock);
        if (this.scene.fog instanceof T.FogExp2) {
            this.scene.fog.density = this.baseFogDensity * (1 + this.omenIntensity * 0.45);
        }

        if (this.isGuofeng && this.guofengRegionWeight > 0.001) {
            const gf = this.guofengRegionWeight * (1 - s.nightFactor * 0.72);
            this.sky.applyGuofengBlend(this.guofengRegionWeight, s.dayFactor);
            this.sun.color.lerp(this.gfSunCol, gf * 0.72);
            this.sun.intensity *= T.MathUtils.lerp(1.0, 1.06, gf);
            this.sun.shadow.intensity = T.MathUtils.lerp(0.86, 0.90, gf);
            this.ambient.color.lerp(this.gfAmbCol, gf * 0.75);
            this.ambient.intensity *= T.MathUtils.lerp(1.0, 0.96, gf);
            this.hemi.color.lerp(this.gfHemiSky, gf * 0.75);
            this.hemi.groundColor.lerp(this.gfHemiGnd, gf * 0.75);
            this.hemi.intensity *= T.MathUtils.lerp(1.0, 0.96, gf);
            this.fill.color.lerp(this.gfFillCol, gf * 0.70);
            if (this.scene.fog instanceof T.FogExp2) {
                this.scene.fog.color.lerp(this.gfFogCol, gf * 0.78);
                this.scene.fog.density *= T.MathUtils.lerp(1.0, 1.05, gf);
            }
            atmosphereUniforms.uAtmoAir.value.lerp(this.gfAirCol, gf * 0.80);
            atmosphereUniforms.uAtmoSunAir.value.lerp(this.gfSunAirCol, gf * 0.74);
            atmosphereUniforms.uAtmoMist.value.lerp(this.gfMistCol, gf * 0.78);
            if (s.duskFactor > 0.02) {
                const dk = s.duskFactor * gf;
                atmosphereUniforms.uAtmoMist.value.lerp(this.gfDuskMistCol, dk * 0.80);
                atmosphereUniforms.uAtmoAir.value.lerp(this.gfDuskAirCol, dk * 0.72);
                atmosphereUniforms.uAtmoSunAir.value.lerp(this.gfDuskSunAirCol, dk * 0.76);
                if (this.scene.fog instanceof T.FogExp2) {
                    this.scene.fog.color.lerp(this.gfDuskMistCol, dk * 0.62);
                }
            }
            // Dedicated Guofeng moonlit night calibration: keep character & foliage readable in cool blue-green
            // without turning night into blue daytime or triggering white leaf rim speckles.
            if (s.nightFactor > 0.02) {
                const nk = s.nightFactor * this.guofengRegionWeight;
                this.ambient.intensity *= T.MathUtils.lerp(1.0, 1.26, nk);
                this.hemi.intensity *= T.MathUtils.lerp(1.0, 1.20, nk);
                this.fill.intensity *= T.MathUtils.lerp(1.0, 1.32, nk);
                this.sun.intensity *= T.MathUtils.lerp(1.0, 1.12, nk);
                atmosphereUniforms.uVegRimStrength.value *= T.MathUtils.lerp(1.0, 0.22, nk);
                atmosphereUniforms.uVegTransStrength.value *= T.MathUtils.lerp(1.0, 0.35, nk);
            }
            atmosphereUniforms.uHeightFogDensity.value = T.MathUtils.lerp(
                atmosphereUniforms.uHeightFogDensity.value,
                Math.max(atmosphereUniforms.uHeightFogDensity.value, 0.24),
                gf * 0.80,
            );
            atmosphereUniforms.uWaterBodyTint.value.lerp(this.gfWaterBody, gf * 0.76);
            atmosphereUniforms.uWaterSkyLow.value.lerp(this.gfWaterLow, gf * 0.76);
            atmosphereUniforms.uWaterSkyHigh.value.lerp(this.gfWaterHigh, gf * 0.72);
            atmosphereUniforms.uWaterSpec.value.lerp(this.gfWaterSpec, gf * 0.65);
            atmosphereUniforms.uVegTransColor.value.lerp(this.gfVegTrans, gf * 0.88);
            atmosphereUniforms.uVegTransStrength.value *= T.MathUtils.lerp(1.0, 0.65, gf);
            atmosphereUniforms.uVegRimColor.value.lerp(this.gfVegRim, gf * 0.82);
            atmosphereUniforms.uVegRimStrength.value *= T.MathUtils.lerp(1.0, 0.55, gf);
        } else {
            this.sun.shadow.intensity = 0.86;
        }

        if (this.omenIntensity > 0.001) {
            const k = this.omenIntensity;
            const f = this.omenFlash * k;
            const g = this.omenGold;
            this.sky.applyOmenBlend(k, this.omenFlash, g);

            // Valley dims smoothly under brooding storm clouds while localized golden sky-breaks warm peaks & canopies
            this.tmpOmenSun.copy(this.omenSunStormCol).lerp(this.omenSunCol, g);
            this.sun.color.lerp(this.tmpOmenSun, k * 0.78).lerp(this.omenFlashTint, f * 0.35);
            const targetSunI = T.MathUtils.lerp(0.32, 0.46, g) * (1 - s.nightFactor * 0.25);
            this.sun.intensity = T.MathUtils.lerp(this.sun.intensity, targetSunI, k * 0.78) + f * 0.28;

            this.ambient.color.lerp(this.omenAmbCol, k * 0.85).lerp(this.omenFlashTint, f * 0.30);
            this.ambient.intensity = T.MathUtils.lerp(this.ambient.intensity, 0.24, k * 0.72) + f * 0.18;

            this.hemi.color.lerp(this.omenHemiSky, k * 0.86).lerp(this.omenFlashTint, f * 0.35);
            this.hemi.groundColor.lerp(this.omenHemiGnd, k * 0.78);
            this.hemi.intensity = T.MathUtils.lerp(this.hemi.intensity, 0.42, k * 0.72) + f * 0.16;

            this.fill.intensity = T.MathUtils.lerp(this.fill.intensity, 0.10, k * 0.65);

            // Distant mountains enveloped in cool blue-gray storm atmospheric haze
            if (this.scene.fog instanceof T.FogExp2) {
                this.scene.fog.color.lerp(this.omenFogCol, k * 0.85).lerp(this.omenFlashTint, f * 0.22);
            }
            atmosphereUniforms.uAtmoAir.value.lerp(this.omenAirCol, k * 0.86).lerp(this.omenFlashTint, f * 0.20);
            atmosphereUniforms.uAtmoSunAir.value.lerp(this.omenSunCol, k * (0.35 + 0.45 * g));
            atmosphereUniforms.uAtmoMist.value.lerp(this.omenMistCol, k * 0.82);
            atmosphereUniforms.uAtmoLight.value = T.MathUtils.lerp(atmosphereUniforms.uAtmoLight.value, 0.42 + 0.14 * g, k * 0.75);
            atmosphereUniforms.uHeightFogDensity.value = T.MathUtils.lerp(atmosphereUniforms.uHeightFogDensity.value, 0.32, k * 0.72);

            // Water reflects brooding slate-indigo vortex & warm golden crevice glints + brief lightning shimmer
            atmosphereUniforms.uWaterBodyTint.value.lerp(this.omenWaterBody, k * 0.62);
            atmosphereUniforms.uWaterSkyHigh.value.lerp(this.omenWaterHigh, k * 0.88).lerp(this.omenFlashTint, f * 0.32);
            atmosphereUniforms.uWaterSkyLow.value.lerp(this.omenWaterLow, k * 0.84).lerp(this.omenFlashTint, f * 0.28);
            atmosphereUniforms.uWaterSpec.value.lerp(this.omenWaterSpecCol, k * (0.45 + 0.45 * g)).lerp(this.omenFlashTint, f * 0.45);
            atmosphereUniforms.uWaterSpecPower.value = T.MathUtils.lerp(atmosphereUniforms.uWaterSpecPower.value, 0.85 + 0.35 * g, k * 0.65) + f * 0.45;

            // Tree canopies & mountain foliage catch localized golden sky-break rim light
            atmosphereUniforms.uVegRimColor.value.lerp(this.omenVegRim, k * (0.45 + 0.50 * g));
            atmosphereUniforms.uVegRimStrength.value = Math.max(atmosphereUniforms.uVegRimStrength.value, (0.14 + 0.26 * g) * k);
        }
    }

    setQuality(quality: Quality) {
        this.quality = quality;
        this.baseFogDensity = quality === 'low' ? .00040 : .00024;
        if (this.scene.fog instanceof T.FogExp2) {
            this.scene.fog.density = this.baseFogDensity * (1 + this.omenIntensity * 0.45);
        }
        const isMobile = detectDevice().isMobile;
        const shadowSize = quality === 'low' ? 512 : isMobile ? (quality === 'high' ? 1024 : 768) : (quality === 'high' ? 2048 : 1024);
        if (this.sun.shadow.mapSize.x !== shadowSize) {
            this.sun.shadow.mapSize.set(shadowSize, shadowSize);
            this.sun.shadow.map?.dispose();
            this.sun.shadow.map = null;
        }
        this.water.bridgeReflection.enabled = quality !== 'low' && !isMobile;
        this.petals.setQuality(quality);
        this.birds.setQuality(quality);
        this.fireflies.setQuality(quality);
    }

    update(time: number, camera: T.Camera, player: Player, dt = 0) {
        if (this.isGuofeng) {
            this.guofengRegionWeight = 1;
        }
        this.dayNight.step(dt);
        this.applyDayNight();
        const lightDir = this.dayNight.state.lightDirection;
        this.sun.target.position.set(player.position.x, Math.min(player.position.y, camera.position.y), player.position.z);
        this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 500);
        this.sun.target.updateMatrixWorld();
        // Throttle directional shadow map updates to every 2nd frame (3rd during fast flight) while forcing immediate
        // refresh on teleports (>10 m). Cuts shadow-pass CPU draw calls & GPU fillrate by 50–67% with zero visual lag.
        const fastFlight = player.flying && player.velocity.lengthSq() > 42 * 42;
        const teleported = this.lastShadowPos.distanceToSquared(this.sun.target.position) > 100;
        const interval = fastFlight ? 3 : 2;
        this.sun.shadow.autoUpdate = false;
        if (teleported || (++this.shadowFrame % interval) === 0) {
            this.sun.shadow.needsUpdate = true;
            this.lastShadowPos.copy(this.sun.target.position);
        }
        this.sky.update(time, camera);
        this.water.update(time, camera, player);
        this.petals.update(time, camera);
        this.birds.update(time, camera);
        this.fireflies.update(time, player.position);
        this.cloudSea.update(time, camera);
    }

    dispose() {
        this.sky.dispose();
        this.water.dispose();
        this.petals.dispose();
        this.birds.dispose();
        this.fireflies.dispose();
        this.cloudSea.dispose();
    }
}
