import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AdaptiveResolutionScaler, detectDevice } from '../config/device';
import { config, qualities, readQuality, type Quality } from '../config/settings';
import { openValleyReference } from '../dev/valley-reference';
import { Fireball } from '../effects/fireball';
import { FlightAirflow } from '../effects/flight-airflow';
import { GiantSword } from '../effects/giant-sword';
import { SpellLightPool } from '../effects/spell-lights';
import { SurfaceWake } from '../effects/surface-wake';
import { SwordArray } from '../effects/sword-array';
import { SwordEffects, swordWaveRange } from '../effects/sword-effects';
import { VoidFlightEffects } from '../effects/void-flight';
import { CelestialOmen } from '../effects/celestial-omen';
import { NascentBreakthrough } from '../effects/nascent-breakthrough';
import { DivineSense } from '../effects/divine-sense';
import { Atmosphere } from '../environment/atmosphere';
import { formatShichen } from '../environment/day-night';
import { FollowCamera } from '../player/camera';
import { Player } from '../player/controller';
import { xpForCreatureDefeat } from '../player/cultivation';
import { Input } from '../player/input';
import { PlayerVitals } from '../player/vitals';
import { HUD } from '../ui/hud';
import { TouchControls } from '../ui/touch-controls';
import { welcome } from '../ui/welcome';
import { WorldMap } from '../ui/world-map';
import { BridgeGrove } from '../world/biomes/bridge-grove';
import { bridgeReflectionLayer } from '../world/geo/bridge-look';
import { buildingViewTarget } from '../world/biomes/building-layout';
import { GeographyDebug } from '../world/terrain/debug';
import { MapExpansion } from '../world/biomes/expansion';
import { clearingEntrance, clearingTarget } from '../world/geo/forest-clearing';
import { ForestClearing } from '../world/biomes/forest-clearing-scene';
import { heightAt } from '../world/geo/height';
import { Meadow } from '../world/flora/meadow';
import { regionAt, type Region } from '../world/geo/regions';
import { RoadNetwork } from '../world/biomes/roads';
import { sampleSurfaceMaterial, sampleSwordRainSurface } from '../world/biomes/surface-query';
import { Terrain } from '../world/terrain/terrain';
import { Wildlife, giantSwordSplashRadius } from '../world/wildlife/wildlife';

function nextAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export class Game {
    private readonly device = detectDevice();
    private readonly resolutionScaler = new AdaptiveResolutionScaler(this.device.isMobile ? 0.6 : 0.72);
    readonly roads = new RoadNetwork();
    readonly geographyDebug = new GeographyDebug();
    readonly renderer: T.WebGLRenderer;
    readonly scene = new T.Scene();
    readonly swordEffects: SwordEffects;
    readonly spellLights: SpellLightPool;
    readonly swordArray: SwordArray;
    readonly fireball: Fireball;
    readonly giantSword: GiantSword;
    readonly camera = new T.PerspectiveCamera(65, innerWidth / innerHeight, .35, 5000);
    readonly input: Input;
    readonly player: Player;
    readonly follow: FollowCamera;
    readonly terrain: Terrain;
    readonly atmosphere: Atmosphere;
    readonly bridgeGrove: BridgeGrove;
    readonly forestClearing: ForestClearing;
    readonly hud: HUD;
    readonly touchControls: TouchControls;
    readonly expansion: MapExpansion;
    readonly worldMap: WorldMap;
    readonly surfaceWake: SurfaceWake;
    readonly flightAirflow: FlightAirflow;
    readonly voidFlight: VoidFlightEffects;
    readonly celestialOmen: CelestialOmen;
    readonly nascentBreakthrough: NascentBreakthrough;
    readonly divineSense: DivineSense;
    readonly meadow: Meadow;
    readonly wildlife: Wildlife;
    readonly vitals = new PlayerVitals();
    quality = readQuality();
    private last = 0;
    private time = 0;
    private accumulator = 0;
    private frames: number[] = [];
    private frameSum = 0;
    private sample = 0;
    private characterReady = false;
    private landmarksReady = false;
    private shadersWarmed = false;
    private readonly zeroVelocity = new T.Vector3();
    private disposed = false;
    private fireballPower?: number;
    private nightAnnounced = false;
    private lastShownTier = 0;
    private nascentAssetsPromise?: Promise<void>;
    private senseCombatTarget?: ReturnType<Wildlife['combatTarget']>;
    private readonly inkAnchorWorld = new T.Vector3();
    private readonly inkCamRight = new T.Vector3();
    paused = false;
    fps = 0;
    frameMs = 0;

    private readonly itemKey = (e: KeyboardEvent) => {
        if (!this.hud.started || this.worldMap.open || (e.target instanceof HTMLElement && e.target.matches('input,select,textarea'))) return;
        if (e.code === 'Escape' && !e.repeat && this.nascentBreakthrough.active) {
            this.skipBreakthroughCeremony();
            return;
        }
        if (e.code === 'Escape' && !e.repeat && this.divineSense.astralActive) {
            this.exitAstralProjection('神识归位 · 回归本体');
            return;
        }
        if (this.nascentBreakthrough.active) return;
        if (e.code === 'KeyZ' && !e.repeat) this.triggerDivineSensePulse();
        else if (e.code === 'KeyG' && !e.repeat) this.toggleAstralProjection();
        else if (e.code === 'Digit2' && !e.repeat && !this.divineSense.astralActive) this.hud.useItem('heal');
        else if (e.code === 'Digit3' && !e.repeat && !this.divineSense.astralActive) this.hud.useItem('pill');
        else if (e.code === 'KeyB' && !e.repeat && !this.divineSense.astralActive) this.triggerBreakthrough();
    };

    private triggerDivineSensePulse() {
        if (this.nascentBreakthrough.active) return;
        const stats = this.vitals.stats;
        if (this.divineSense.cooldownRemaining > 0) {
            this.vitals.announce(`神识回气中 · 请稍候 (${this.divineSense.cooldownRemaining.toFixed(1)}s)`, this.time, 1.4);
            return;
        }
        if (!this.vitals.spendSensePulse(this.time)) {
            this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            return;
        }
        const origin = this.divineSense.astralActive ? this.camera.position : this.player.position;
        this.divineSense.triggerPulse(origin, stats.senseRadius, stats.realmColor);
        const report = this.wildlife.applyDivineSensePulse(
            origin,
            stats.senseRadius,
            stats.realmIndex + 1,
            stats.senseSuppressMaxRank,
        );
        const parts: string[] = [`${stats.senseStageName} · 探查 ${stats.senseRadius}m`];
        if (report.detected > 0) parts.push(`感应 ${report.detected} 头妖兽`);
        else parts.push('方圆清宁，未见妖迹');
        if (report.suppressedCount > 0) parts.push(`威压震慑 ${report.suppressedCount} 头低阶妖兽`);
        if (report.alertedHighCount > 0) {
            this.divineSense.notifyCounterAlert();
            parts.push(`⚠ 触怒 ${report.alertedLeaderName ?? '高阶妖兽'} 反警觉！`);
        }
        this.vitals.announce(parts.join(' · '), this.time, report.alertedHighCount > 0 ? 3.8 : 3.0);
        this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
    }

    private toggleAstralProjection() {
        if (this.nascentBreakthrough.active) return;
        if (this.divineSense.astralActive) {
            this.exitAstralProjection('神识归位 · 回归本体');
            return;
        }
        if (!this.vitals.canStartAstral(this.time)) {
            this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            return;
        }
        void this.ensureNascentAssetsLoaded();
        const stats = this.vitals.stats;
        const groundY = this.player.floor(this.player.position.x, this.player.position.z);
        const seatPos = new T.Vector3(
            this.player.position.x,
            Math.max(groundY, this.player.position.y),
            this.player.position.z,
        );
        this.divineSense.enterAstral(seatPos, this.player.heading, stats.senseRadius, stats.realmColor);
        const startCam = this.camera.position.clone();
        startCam.y = Math.max(startCam.y, seatPos.y + 3.2);
        this.follow.beginAstral(startCam);
        this.wildlife.applyDivineSensePulse(
            seatPos,
            stats.senseRadius,
            stats.realmIndex + 1,
            stats.senseSuppressMaxRank,
        );
        this.vitals.announce(
            `神识离体 · ${stats.senseStageName}（半径 ${stats.senseRadius}m · WASD 巡游 · G / Esc 归位）`,
            this.time,
            3.4,
        );
        this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
    }

    private exitAstralProjection(notice?: string) {
        if (!this.divineSense.astralActive) return;
        this.divineSense.exitAstral();
        this.follow.endAstral();
        this.player.position.copy(this.divineSense.bodyPosition);
        this.player.velocity.set(0, 0, 0);
        const groundY = this.player.floor(this.player.position.x, this.player.position.z);
        if (this.player.position.y <= groundY + 0.9) {
            this.player.position.y = groundY;
            this.player.grounded = true;
            this.player.flying = false;
        }
        this.player.syncRender(1);
        if (notice) {
            this.vitals.announce(notice, this.time, 2.4);
            this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
        }
    }

    private syncFlightProfile() {
        this.player.setFlightProfile(this.vitals.stats.flight);
        if (this.vitals.realmIndex >= 2) {
            void this.ensureNascentAssetsLoaded();
        }
    }

    /** Idempotent lazy loader for Nascent Soul flight/breakthrough clips, escape-light VFX, and Celestial Omen volumetric clouds. */
    private ensureNascentAssetsLoaded(): Promise<void> {
        if (this.nascentAssetsPromise) return this.nascentAssetsPromise;
        if (!this.voidFlight || !this.celestialOmen) return Promise.resolve();
        this.nascentAssetsPromise = Promise.all([
            new GLTFLoader().loadAsync(new URL('../../resource/fly/nascent/Nascent_Flight_Anim.glb', import.meta.url).href)
                .then(gltf => this.player.avatar.installNascentFlightClips(gltf)),
            new GLTFLoader().loadAsync(new URL('../../resource/fly/nascent/Nascent_Breakthrough_Anim.glb', import.meta.url).href)
                .then(gltf => this.player.avatar.installBreakthroughClips(gltf)),
            this.voidFlight.load(),
            this.celestialOmen.load(),
        ]).then(() => {}).catch(error => {
            console.warn('元婴期扩展资源加载失败', error);
            this.nascentAssetsPromise = undefined;
        });
        return this.nascentAssetsPromise;
    }

    private startNascentBreakthroughCeremony() {
        if (this.nascentBreakthrough.active) return;
        if (this.divineSense.astralActive) this.exitAstralProjection();
        void this.ensureNascentAssetsLoaded();
        if (this.vitals.realmIndex < 3) {
            this.vitals.setRealm(3, 0, this.time);
            this.syncFlightProfile();
        }
        if (document.pointerLockElement) {
            try { document.exitPointerLock(); } catch {}
        }
        this.input.clear();
        const groundY = this.player.floor(this.player.position.x, this.player.position.z);
        const anchor = new T.Vector3(this.player.position.x, Math.max(groundY, this.player.position.y - 4), this.player.position.z);
        const heading = this.player.heading;
        this.celestialOmen.trigger(anchor, 0, true);
        this.hud.setOmenActive(true);
        this.lastShownTier = this.vitals.stats.tier;
        this.nascentBreakthrough.start(anchor, heading, () => {
            this.player.finishBreakthroughHover(this.nascentBreakthrough.currentAnchor, heading);
            this.hud.setCinemaOverlay(false);
            this.hud.showRealmInkBadge(this.vitals.stats.fullLabel, this.vitals.stats.realmColor, 4.6);
            this.vitals.announce('元婴初成 · 肉身御空、踏空而行、极速遁光已开启！', this.time, 4.5);
            this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
        });
    }

    private skipBreakthroughCeremony() {
        if (!this.nascentBreakthrough.active) return;
        this.nascentBreakthrough.skip();
        this.celestialOmen.stop();
    }

    private triggerBreakthrough() {
        const prevRealm = this.vitals.realmIndex;
        if (this.vitals.attemptBreakthrough(this.time)) {
            this.syncFlightProfile();
            if (prevRealm < 3 && this.vitals.realmIndex === 3) {
                this.startNascentBreakthroughCeremony();
            }
        }
    }

    constructor() {
        this.renderer = new T.WebGLRenderer({
            antialias: !this.device.isMobile,
            powerPreference: 'high-performance',
            stencil: false,
        });
        document.querySelector('#app')!.append(this.renderer.domElement);
        this.renderer.toneMapping = T.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        this.spellLights = new SpellLightPool(this.scene, 512, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = this.device.isMobile || this.quality === 'low' ? T.PCFShadowMap : T.PCFSoftShadowMap;

        this.swordEffects = new SwordEffects(this.scene, (from, to, struck) => this.wildlife.swordTravel(from, to, struck));
        this.fireball = new Fireball(
            this.scene,
            sampleSurfaceMaterial,
            (from, to) => this.wildlife.fireballContact(from, to),
            (point, power, directHit) => this.wildlife.fireballBlast(point, power, directHit),
        );
        this.giantSword = new GiantSword(
            this.scene,
            sampleSurfaceMaterial,
            (from, to) => this.wildlife.giantSwordContact(from, to),
            (point, directHit) => this.wildlife.giantSwordBlast(point, directHit),
            giantSwordSplashRadius,
        );
        this.input = new Input(this.renderer.domElement);
        this.swordArray = new SwordArray(
            this.scene,
            (x, z, fromY) => sampleSwordRainSurface((sx, sz, fy) => this.player.floor(sx, sz, fy), x, z, fromY),
            error => {
                console.error('剑阵素材播放失败', error);
                this.hud.showHint('剑阵素材播放失败 · 按 Q 可重试');
            },
            sword => this.wildlife.rainContact(sword),
        );
        this.player = new Player(
            this.input,
            this.scene,
            (position, heading) => {
                const senseOn = this.divineSense?.insightActive ?? false;
                const lockRange = senseOn ? Math.max(swordWaveRange, this.vitals.stats.senseLockRange * 0.65) : swordWaveRange;
                this.swordEffects.release(position, heading, this.wildlife.swordTarget(position, heading, lockRange, senseOn));
            },
            position => this.swordArray.start(position),
            (position, heading) => this.wildlife.melee(position, heading),
            (position, previous, velocity) => this.wildlife.simulation.resolvePlayer(position, previous, velocity),
            power => { this.fireballPower = power; },
            {
                canStartFlight: () => this.vitals.canStartFlight(this.time, true),
                onFlightStep: (dt, intensity) => this.vitals.drainFlightMana(dt, intensity, this.time),
                canCastSkill: skill => this.vitals.canCastSkill(skill, this.time, true),
                onConsumeSkill: skill => this.vitals.spendSkillMana(skill, this.time),
                onSkywalkToggle: sky => this.vitals.announce(
                    sky ? '踏空而行 · 凌虚漫步 (V 切回御空)' : '御空飞行 · 按 Shift 化作遁光 (V 踏空)',
                    this.time,
                    2.4,
                ),
                shouldHideBody: () => this.voidFlight.escapeBlend > 0.45,
            },
        );
        this.syncFlightProfile();
        this.lastShownTier = this.vitals.stats.tier;
        this.follow = new FollowCamera(this.camera, this.player, this.input);
        this.terrain = new Terrain(this.scene, this.quality);
        this.atmosphere = new Atmosphere(this.scene, this.quality);
        this.bridgeGrove = new BridgeGrove(this.atmosphere.sunDirection, this.terrain.vegetation.uniforms);
        this.forestClearing = new ForestClearing(this.atmosphere.sunDirection, this.terrain.vegetation.uniforms);
        this.scene.add(this.bridgeGrove, this.forestClearing);
        this.terrain.lod.mesh.layers.enable(bridgeReflectionLayer);
        this.scene.traverse(object => {
            if (object instanceof T.Light) object.layers.enable(bridgeReflectionLayer);
        });
        this.surfaceWake = new SurfaceWake(this.renderer, this.quality);
        this.flightAirflow = new FlightAirflow(this.scene, this.quality);
        this.voidFlight = new VoidFlightEffects(this.scene);
        this.celestialOmen = new CelestialOmen(this.scene, this.quality);
        this.nascentBreakthrough = new NascentBreakthrough(this.scene);
        this.divineSense = new DivineSense(this.scene);
        if (this.vitals.realmIndex >= 2) {
            void this.ensureNascentAssetsLoaded();
        }
        const { uVillageGround, uRiverbank, uRegionalHabitat, uClearingLight, uRiverCorridor } = this.terrain.material.userData.uniforms;
        this.meadow = new Meadow(
            this.scene, this.surfaceWake, this.quality,
            uVillageGround, uRiverbank, uRegionalHabitat, uClearingLight, uRiverCorridor,
            this.terrain.canyon, this.fireball.grassScorches,
        );
        this.terrain.vegetation.setWake(this.surfaceWake);
        this.atmosphere.water.setWake(this.surfaceWake);

        this.hud = new HUD(
            () => {
                this.touchControls.setVisible(true);
                this.capture();
            },
            q => this.setQuality(q),
            v => {
                this.follow.roll = v;
                try { localStorage.setItem('yunjing-roll', String(v)); } catch {}
            },
            v => {
                this.terrain.setDebug(v);
                this.roads.setDebug(v);
                this.geographyDebug.visible = import.meta.env.DEV && v;
            },
            this.quality,
        );
        this.touchControls = new TouchControls(this.input);
        this.expansion = new MapExpansion(this.scene);
        this.expansion.setWind(this.terrain.vegetation.uniforms);
        this.wildlife = new Wildlife(
            this.scene,
            (damage, attacker) => {
                const hit = this.vitals.receiveHit(damage, attacker.displayName, this.time);
                if (hit && this.divineSense.astralActive) {
                    this.exitAstralProjection(`本体遭 ${attacker.displayName} 袭击 · 神识瞬息归位！`);
                }
            },
            {
                enableRanks: true,
                damageMultiplier: () => this.vitals.rollDamageScale(),
                onDefeat: creature => {
                    const xp = xpForCreatureDefeat(creature.profile.health, creature.rank.rank - 1);
                    this.vitals.gainXp(xp, this.time, `斩杀 ${creature.displayName}`);
                    this.syncFlightProfile();
                    if (creature.rank.rank >= 2 || Math.random() < 0.4) {
                        this.hud.addItem(Math.random() < 0.55 ? 'pill' : 'heal', 1);
                    }
                },
            },
        );
        this.worldMap = new WorldMap(
            r => this.travelTo(r),
            () => this.input.clear(),
            (x, z) => Math.max(heightAt(x, z), this.terrain.canyon.surfaceAt(x, z)),
        );
        this.hud.bindActions(
            () => this.worldMap.toggle(),
            kind => this.vitals.useItem(kind, this.time),
            held => this.input.setHeld('KeyE', held),
            () => this.input.trigger('KeyQ'),
            () => this.input.trigger('Digit1'),
        );
        this.hud.bindCultivation(
            () => {
                this.triggerBreakthrough();
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            },
            realmIndex => {
                this.vitals.setRealm(realmIndex, 0, this.time);
                this.syncFlightProfile();
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            },
            () => {
                this.vitals.fillToBreakthrough(this.time);
                this.syncFlightProfile();
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            },
            () => {
                this.vitals.advanceOneTier(this.time);
                this.syncFlightProfile();
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            },
            () => {
                const isNight = this.atmosphere.dayNight.state.nightFactor > 0.4;
                this.atmosphere.dayNight.setHours(isNight ? 10 : 22.5);
                this.wildlife.focus();
                this.vitals.announce(
                    isNight ? '时辰切至白昼 · 妖气收敛' : '时辰切至月夜 · 妖兽刷新率与高阶率大幅提升',
                    this.time,
                    2.8,
                );
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            },
            () => {
                void this.ensureNascentAssetsLoaded();
                const on = this.celestialOmen.toggle(this.player.position);
                this.vitals.announce(
                    on ? '天地异象降临 · 紫霄雷涡蔽日，灵光贯空' : '异象渐散 · 风云归宁',
                    this.time,
                    3.2,
                );
                this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
                return on;
            },
            () => {
                this.startNascentBreakthroughCeremony();
            },
            () => {
                this.skipBreakthroughCeremony();
            },
        );
        this.hud.bindDivineSense(
            () => this.triggerDivineSensePulse(),
            () => this.toggleAstralProjection(),
        );
        this.hud.updateVitals(this.vitals.snapshot(), '');
        this.hud.bindTimeControl(
            hours => this.atmosphere.dayNight.setHours(hours),
            auto => { this.atmosphere.dayNight.auto = auto; },
        );
        window.addEventListener('keydown', this.itemKey);
        try {
            this.follow.roll = localStorage.getItem('yunjing-roll') !== 'false';
        } catch {
            this.follow.roll = true;
        }
        this.hud.setRollChecked(this.follow.roll);
        this.scene.add(this.roads, this.geographyDebug);
        this.geographyDebug.bind(this.terrain, this.roads);
        this.setQuality(this.quality);
        window.addEventListener('resize', this.resize);
        document.addEventListener('visibilitychange', this.visibility);
        this.renderer.domElement.addEventListener('click', this.capture);
        this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);

        welcome.advance('正在载入角色与技能资源…');
        void this.loadCharacter();
        this.renderer.setAnimationLoop(this.frame);

        void new Promise<void>(resolve => window.setTimeout(resolve, this.device.isMobile ? 280 : 520)).then(async () => {
            if (this.disposed) return;
            const isDisposed = () => this.disposed;
            await this.expansion.preloadLandmarksAsync(nextAnimationFrame, isDisposed);
            if (this.disposed) return;
            await this.meadow.preloadSecondaryFieldsAsync(nextAnimationFrame, isDisposed);
            if (this.disposed) return;
            this.landmarksReady = true;
            welcome.advance();
            if (this.characterReady) this.finishPreload();
        }).catch(error => {
            console.error('云境远景生成失败', error);
            if (!this.disposed) welcome.fail('远景生成失败，请刷新页面');
        });
    }

    /** Pre-compile scene & hidden effect shaders behind the welcome screen to prevent first-flight hitches. */
    private finishPreload() {
        if (!this.shadersWarmed && !this.disposed) {
            this.shadersWarmed = true;
            const restore: { object: T.Object3D; visible: boolean }[] = [];
            const reveal = (object?: T.Object3D) => {
                if (!object || object.visible) return;
                restore.push({ object, visible: false });
                object.visible = true;
            };
            reveal(this.swordEffects.windMesh);
            reveal(this.flightAirflow.group);
            for (const object of this.voidFlight.warmObjects) reveal(object);
            for (const object of this.celestialOmen.warmObjects) reveal(object);
            for (const object of this.nascentBreakthrough.warmObjects) reveal(object);
            for (const object of this.divineSense.warmObjects) reveal(object);
            for (const object of this.swordArray.warmObjects) reveal(object);
            let grassRevealed = false, flowerRevealed = false;
            for (const child of this.meadow.group.children) {
                if (!(child instanceof T.Mesh)) continue;
                const key = (child.material as T.Material).customProgramCacheKey?.() ?? '';
                const isFlower = key.startsWith('meadow-flowers');
                if (isFlower && !flowerRevealed) { reveal(child); flowerRevealed = true; }
                else if (!isFlower && !grassRevealed) { reveal(child); grassRevealed = true; }
                if (grassRevealed && flowerRevealed) break;
            }
            try {
                this.renderer.compile(this.scene, this.camera);
            } catch (error) {
                console.warn('Shader pre-compile skipped', error);
            } finally {
                for (const entry of restore) entry.object.visible = entry.visible;
            }
        }
        welcome.ready();
        // Low-priority background prefetch on desktop after valley entry so first Nascent/Omen trigger has zero hitch
        if (!this.device.isMobile && !this.disposed) {
            const schedulePrefetch = () => {
                if (!this.disposed) void this.ensureNascentAssetsLoaded();
            };
            window.setTimeout(() => {
                if (this.disposed) return;
                const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
                if (ric) ric(schedulePrefetch, { timeout: 4000 });
                else schedulePrefetch();
            }, 4500);
        }
    }

    private async loadCharacter() {
        try {
            await Promise.all([
                new GLTFLoader().loadAsync(new URL('../../resource/Character.glb', import.meta.url).href)
                    .then(gltf => this.player.avatar.install(gltf)),
                new GLTFLoader().loadAsync(new URL('../../resource/skill/giant-sword/Skill_GiantSword_Anim.glb', import.meta.url).href)
                    .then(gltf => this.player.avatar.installGiantSwordClip(gltf)),
                this.swordEffects.load(),
                this.swordArray.load(),
                this.fireball.load(),
                this.giantSword.load(),
            ].map(load => load.then(() => {
                if (!this.disposed) welcome.advance();
            })));
            if (this.disposed) return;
            const sword = this.player.avatar.swordMotion;
            const tip = sword?.getObjectByName('SwordTip');
            if (!sword || !tip) throw new Error('Character.glb is missing SwordMotion or SwordTip');
            this.swordEffects.attach(sword, tip);
            this.swordArray.attachSword(sword, tip);
            this.giantSword.attachSword(sword, tip);
            this.characterReady = true;
            if (this.landmarksReady) this.finishPreload();
            else welcome.setStatus('正在生成远景峰林与浮岛…');

            const view = new URLSearchParams(location.search).get('valleyView');
            if (view === 'reference' || view === 'cascade' || view === 'canyon') openValleyReference(this, view);
            if (import.meta.env.DEV && new URLSearchParams(location.search).get('grove') === 'visit') {
                this.travelTo({
                    id: 'forest-clearing', name: '林下草甸', subtitle: '长风谷林坡',
                    ...clearingTarget, color: '#98b283',
                    arrival: [clearingEntrance.x, heightAt(clearingEntrance.x, clearingEntrance.z) + 2, clearingEntrance.z],
                });
                this.input.pitch = -.05;
                this.follow.reset();
            }
            const devView = import.meta.env.DEV ? new URLSearchParams(location.search).get('devView') : null;
            if (devView) {
                const params = new URLSearchParams(location.search);
                const [vx, vz, heading = 260, hours = 12.58] = devView.split(',').map(Number);
                if (Number.isFinite(vx) && Number.isFinite(vz)) {
                    this.setQuality('high');
                    this.atmosphere.dayNight.auto = false;
                    this.atmosphere.dayNight.setHours(hours);
                    const pitchParam = Number(params.get('devPitch'));
                    const pitch = Number.isFinite(pitchParam) ? pitchParam : -.04;
                    const devFly = params.get('devFly') === '1';
                    const groundY = heightAt(vx, vz);
                    this.player.teleport(vx, devFly ? groundY + 62 : groundY, vz, T.MathUtils.degToRad(heading), pitch);
                    this.player.flying = devFly;
                    if (devFly) {
                        this.player.grounded = false;
                        this.player.velocity.set(Math.sin(T.MathUtils.degToRad(heading)) * 18, 0, -Math.cos(T.MathUtils.degToRad(heading)) * 18);
                    }
                    this.follow.reset();
                    const devFree = params.get('devFree');
                    if (devFree) {
                        const [fx, fy, fz] = devFree.split(',').map(Number);
                        if (Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz)) {
                            this.follow.free = true;
                            this.follow.freePosition.set(fx, fy, fz);
                            this.camera.position.set(fx, fy, fz);
                        }
                    }
                    const devOmen = Number(params.get('devOmen'));
                    const devRitual = Number(params.get('devRitual'));
                    const devRealmParam = params.get('devRealm');
                    const devSense = params.get('devSense') === '1';
                    const devAstral = params.get('devAstral') === '1';
                    if (devRealmParam !== null) {
                        const rIdx = Number(devRealmParam);
                        if (Number.isFinite(rIdx)) {
                            this.vitals.setRealm(rIdx, 0, this.time);
                            this.syncFlightProfile();
                            this.lastShownTier = this.vitals.stats.tier;
                        }
                    }
                    if ((devOmen >= 1 && devOmen <= 5) || (Number.isFinite(devRitual) && devRitual > 0) || devAstral) {
                        await this.ensureNascentAssetsLoaded();
                    }
                    if (devOmen >= 1 && devOmen <= 5) {
                        this.celestialOmen.setPhaseForDev(devOmen as 1 | 2 | 3 | 4 | 5, this.player.position);
                        this.hud.setOmenActive(devOmen < 5);
                    }
                    if (Number.isFinite(devRitual) && devRitual > 0) {
                        this.vitals.setRealm(3, 0, this.time);
                        this.syncFlightProfile();
        this.lastShownTier = this.vitals.stats.tier;
                        const groundAnchor = new T.Vector3(vx, groundY, vz);
                        const hRad = T.MathUtils.degToRad(heading);
                        this.celestialOmen.setBreakthroughTimeForDev(devRitual, groundAnchor);
                        this.nascentBreakthrough.jumpToTimeForDev(devRitual, groundAnchor, hRad, () => {
                            this.player.finishBreakthroughHover(this.nascentBreakthrough.currentAnchor, hRad);
                            this.hud.setCinemaOverlay(false);
                            this.hud.showRealmInkBadge(this.vitals.stats.fullLabel, this.vitals.stats.realmColor, 4.6);
                        });
                        this.nascentBreakthrough.update(0.016, this.renderer.getPixelRatio());
                        this.player.stepRitual(
                            0.016,
                            this.nascentBreakthrough.currentAnchor,
                            hRad,
                            this.nascentBreakthrough.avatarPose === 'burst' ? 'burst' : 'meditate',
                        );
                    }
                    if (params.get('devDebug') === '1') {
                        this.hud.debug.classList.remove('hidden');
                    }
                    this.hud.started = true;
                    welcome.hide();
                    if (devSense) {
                        this.triggerDivineSensePulse();
                        // Advance wave slightly so screenshot catches the luminous mountain-spanning wavefront
                        this.divineSense.pulseAge = 0.72;
                    }
                    if (devAstral) {
                        if (this.vitals.realmIndex < 2) {
                            this.vitals.setRealm(2, 0, this.time);
                            this.syncFlightProfile();
                            this.lastShownTier = this.vitals.stats.tier;
                        }
                        this.toggleAstralProjection();
                        const hRad = T.MathUtils.degToRad(heading);
                        this.follow.astralPosition.set(
                            vx - Math.sin(hRad) * 18,
                            groundY + 11,
                            vz + Math.cos(hRad) * 18,
                        );
                        this.camera.position.copy(this.follow.astralPosition);
                    }
                }
            }
        } catch (error) {
            console.error('云境角色资源加载失败', error);
            if (!this.disposed) welcome.fail('游戏资源加载失败，请刷新页面');
        }
    }

    private readonly capture = (e?: MouseEvent) => {
        if (this.device.isTouch && !window.matchMedia?.('(pointer: fine)').matches) return;
        if (this.hud.started && !this.paused && !this.input.cursorFree && !e?.altKey) {
            this.renderer.domElement.requestPointerLock?.()?.catch(() => {
                this.hud.showHint('鼠标捕获不可用 · 按住右键转动视角 · Alt / Esc 释放鼠标');
            });
        }
    };

    travelTo(region: Region) {
        if (!this.characterReady) return;
        this.input.clear();
        this.swordEffects.clear();
        this.flightAirflow.clear();
        this.voidFlight.clear();
        this.swordArray.clear();
        this.fireball.clear();
        this.giantSword.clear();
        this.divineSense.clear();
        const [x, y, z] = region.arrival, target = buildingViewTarget(region);
        const dx = target.x - x, dz = target.z - z;
        const yaw = Math.atan2(dx, -dz), pitch = T.MathUtils.clamp(Math.atan2(target.y - y, Math.hypot(dx, dz)), -.65, .3);
        this.player.teleport(x, y, z, yaw, pitch);
        this.wildlife.focus();
        this.follow.reset();
        this.hud.started = true;
        welcome.hide();
        this.hud.setCrosshairVisible(true);
        this.touchControls.setVisible(true);
    }

    private returnToValley() {
        this.player.reset();
        this.fireballPower = undefined;
        this.swordEffects.clear();
        this.flightAirflow.clear();
        this.voidFlight.clear();
        this.swordArray.clear();
        this.fireball.clear();
        this.giantSword.clear();
        this.divineSense.clear();
        this.follow.reset();
        this.input.clear();
        this.wildlife.focus();
    }

    private readonly contextLost = (e: Event) => {
        e.preventDefault();
        this.paused = true;
        this.swordArray.setPaused(true);
        this.hud.mode.textContent = '图形上下文丢失，请刷新页面恢复';
    };

    private readonly visibility = () => {
        this.paused = document.hidden;
        this.swordArray.setPaused(this.paused);
        this.input.clear();
        this.last = 0;
        this.accumulator = 0;
    };

    private applyPixelRatio() {
        const cap = qualities[this.quality].pixelRatio;
        const base = Math.min(devicePixelRatio, cap);
        this.renderer.setPixelRatio(Math.max(0.5, base * this.resolutionScaler.scale));
    }

    private readonly resize = () => {
        this.applyPixelRatio();
        this.renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
    };

    setQuality(q: Quality) {
        this.quality = q;
        this.resolutionScaler.reset();
        this.spellLights.setShadowSlots(this.device.isMobile || q === 'low' ? 0 : q === 'medium' ? 1 : 2);
        try { localStorage.setItem('yunjing-quality', q); } catch {}
        this.renderer.shadowMap.type = this.device.isMobile || q === 'low' ? T.PCFShadowMap : T.PCFSoftShadowMap;
        this.terrain.setQuality(q);
        this.meadow.setQuality(q);
        this.camera.far = qualities[q].far;
        this.atmosphere.setQuality(q);
        this.flightAirflow.setQuality(q);
        this.celestialOmen.setQuality(q);
        this.nascentBreakthrough.setQuality(q);
        this.divineSense.setQuality(q);
        this.resize();
    }

    private readonly frame = (stamp: number) => {
        const raw = this.last ? (stamp - this.last) / 1000 : 1 / 60;
        this.last = stamp;
        if (this.paused) return;
        if (this.hud.started && this.input.take('KeyR')) {
            this.returnToValley();
        }
        if (this.hud.started && this.resolutionScaler.sample(raw)) {
            this.applyPixelRatio();
        }
        const dt = Math.min(config.maxFrame, raw);
        this.time += dt;
        this.accumulator += dt;
        const inRitual = this.nascentBreakthrough.active;
        const inAstral = this.divineSense.astralActive && !inRitual;
        if (inRitual) {
            this.accumulator = 0;
            this.nascentBreakthrough.update(dt, this.renderer.getPixelRatio());
            if (this.nascentBreakthrough.active) {
                this.player.stepRitual(
                    dt,
                    this.nascentBreakthrough.currentAnchor,
                    this.player.heading,
                    this.nascentBreakthrough.avatarPose === 'burst' ? 'burst' : 'meditate',
                );
            }
        } else if (inAstral) {
            this.accumulator = 0;
            this.player.stepMeditate(dt, this.divineSense.bodyPosition, this.divineSense.bodyHeading, this.time);
            if (!this.vitals.drainAstralMana(dt, this.time)) {
                this.exitAstralProjection();
            }
        } else {
            let subSteps = 0;
            while (this.accumulator >= config.fixedStep && subSteps < config.maxSubSteps) {
                if (this.hud.started) {
                    this.player.step(config.fixedStep, !this.follow.free && !this.worldMap.open);
                }
                this.accumulator -= config.fixedStep;
                subSteps++;
            }
            if (subSteps === config.maxSubSteps) {
                this.accumulator = Math.min(this.accumulator, config.fixedStep);
            }
            this.player.syncRender(this.accumulator / config.fixedStep);
        }

        const { avatar, heading } = this.player;
        const canInteract = this.hud.started && !this.follow.free && !this.divineSense.astralActive && !this.worldMap.open && !this.nascentBreakthrough.active;
        this.touchControls.setVisible(canInteract);
        this.touchControls.syncState(this.player.flying, this.player.boosting);

        this.swordArray.updateCharge(dt, avatar.raisingSwordTime);
        this.swordArray.update(dt);
        this.follow.update(
            dt,
            this.worldMap.open ? undefined : this.giantSword.framing ?? this.swordArray.framing,
            this.nascentBreakthrough.cameraPose,
            this.divineSense.astralActive
                ? { origin: this.divineSense.bodyPosition, radius: this.divineSense.astralRadius }
                : undefined,
            this.divineSense.insightActive && !this.divineSense.astralActive,
        );
        if (this.nascentBreakthrough.active) {
            const rt = this.nascentBreakthrough.title;
            this.hud.setCinemaOverlay(true, rt.title, rt.subtitle, rt.visible ? rt.alpha : 0);
        } else {
            this.hud.setCinemaOverlay(false);
        }
        this.fireball.update(dt);
        this.fireball.updateSeals(avatar.fireballHead, avatar.fireballTime, heading, this.player.fireballPower);
        if (this.fireballPower !== undefined) {
            this.vitals.spendFireballCharge(this.fireballPower, this.time);
            this.fireball.release(this.camera, this.player.position, this.fireballPower);
            this.fireballPower = undefined;
        }
        this.giantSword.updateCast(avatar.giantSwordTime, this.camera, this.player.position, heading, this.vitals.realmIndex >= 3,
            this.divineSense.insightActive ? this.senseCombatTarget : undefined);
        this.giantSword.update(dt);
        this.swordEffects.update(dt, this.player.boosting && this.player.avatar.riding && !this.player.voidFlying && canInteract);
        this.voidFlight.update(
            dt,
            avatar.position,
            this.player.velocity,
            heading,
            this.player.voidFlying && canInteract,
            this.player.skyWalking,
            this.player.escapeLight,
            this.renderer.getPixelRatio(),
        );
        this.spellLights.beginFrame();
        this.swordEffects.collectLights(this.spellLights);
        this.voidFlight.collectLights(this.spellLights);
        this.fireball.collectLights(this.spellLights);
        this.giantSword.collectLights(this.spellLights);
        this.swordArray.collectLights(this.spellLights);
        this.nascentBreakthrough.collectLights(this.spellLights);
        this.spellLights.setShadowEnabled(this.renderer.shadowMap.enabled);
        const dn = this.atmosphere.dayNight.state;
        this.spellLights.commit(dn.nightFactor, dn.duskFactor);
        this.flightAirflow.update(dt, this.player, canInteract, this.renderer.getPixelRatio());

        const detachedCam = this.follow.free || this.divineSense.astralActive;
        const center = detachedCam ? this.camera.position : this.player.position;
        this.expansion.update(
            this.time, center, this.camera, this.player.velocity,
            this.renderer.domElement.clientHeight,
            this.quality === 'low' ? 1.65 : this.quality === 'medium' ? 1.22 : 1,
        );
        this.wildlife.update(
            dt, center, this.player.position, this.quality, this.hud.started, canInteract || this.divineSense.astralActive, this.camera,
            detachedCam ? undefined : this.player.velocity,
            detachedCam || this.player.flying,
            this.renderer.domElement.clientHeight,
            dn.nightFactor,
        );
        if (this.hud.started) {
            if (dn.nightFactor >= 0.45 && !this.nightAnnounced) {
                this.nightAnnounced = true;
                this.vitals.announce('夜幕降临 · 妖气涌动，高阶妖兽出没率大幅提升', this.time, 3.4);
            } else if (dn.nightFactor < 0.25) {
                this.nightAnnounced = false;
            }
        }

        const activeSkill = avatar.casting || avatar.giantSwordCasting || avatar.fireballTime !== undefined || this.divineSense.astralActive;
        const speedNow = this.player.velocity.length();
        const exerting = this.player.boosting || (this.player.grounded && speedNow > config.walkSpeed + .4);
        const calm = this.player.grounded && speedNow <= config.walkSpeed + .4 && !activeSkill;
        if (this.vitals.step(dt, this.time, activeSkill, exerting, calm, this.player.flying)) {
            this.returnToValley();
        }

        const senseStats = this.vitals.stats;
        const senseLockRange = this.divineSense.insightActive ? senseStats.senseLockRange : 42;
        const lockedBeast = (canInteract || this.divineSense.astralActive)
            ? this.wildlife.combatTarget(center, this.camera, senseLockRange, this.divineSense.insightActive)
            : undefined;
        this.senseCombatTarget = this.divineSense.insightActive ? lockedBeast : undefined;
        this.divineSense.update(
            dt,
            this.camera,
            senseStats.realmColor,
            lockedBeast
                ? { position: lockedBeast.position, radius: lockedBeast.profile.radius * lockedBeast.rank.sizeScale, color: lockedBeast.rank.color }
                : undefined,
        );
        const senseOrigin = this.divineSense.astralActive ? this.divineSense.bodyPosition : this.player.position;
        const senseOverlay = this.hud.started && !this.nascentBreakthrough.active
            ? this.wildlife.collectSenseOverlay(
                this.player.position,
                senseOrigin,
                this.camera,
                this.divineSense.insightActive,
                senseStats.senseRadius,
                senseStats.realmIndex + 1,
                innerWidth,
                innerHeight,
                lockedBeast?.id,
            )
            : { markers: [], mapBlips: [], danger: { active: false, angleDeg: 180, urgency: 0, label: '' } };
        const senseRing = this.divineSense.insightActive
            ? {
                x: senseOrigin.x,
                z: senseOrigin.z,
                radius: senseStats.senseRadius,
                color: senseStats.realmColor,
                pulseRadius: this.divineSense.currentPulseRadius,
            }
            : undefined;

        this.terrain.update(center, detachedCam ? this.zeroVelocity : this.player.velocity, this.camera);
        this.geographyDebug.update();
        this.worldMap.update(avatar.position, senseOverlay.mapBlips, senseRing);
        this.celestialOmen.update(dt, center, this.renderer.getPixelRatio(), this.camera.position.y);
        this.atmosphere.setOmen(
            this.celestialOmen.atmosphereWeight,
            this.celestialOmen.lightningFlash,
            this.celestialOmen.goldLightWeight,
            this.celestialOmen.windStrength,
            this.celestialOmen.shockwave,
        );
        this.atmosphere.sky.bake(this.renderer);
        this.atmosphere.update(this.time, this.camera, this.player, dt);
        this.renderer.toneMappingExposure = this.atmosphere.dayNight.state.exposure * (1.02 + this.celestialOmen.lightningFlash * 0.045);
        this.terrain.setTime(this.time);
        this.terrain.vegetation.update(
            this.time, this.player.position, this.player.velocity,
            Math.max(0, this.player.position.y - this.player.floor(this.player.position.x, this.player.position.z)),
        );
        this.surfaceWake.update(dt, this.time, this.player);
        this.meadow.update(this.time, this.camera, this.renderer.domElement.height);
        this.atmosphere.water.bridgeReflection.render(this.renderer, this.camera);
        this.renderer.render(this.scene, this.camera);

        this.hud.updateDivineSense(senseOverlay.markers, senseOverlay.danger, {
            insightActive: this.divineSense.insightActive,
            astralActive: this.divineSense.astralActive,
            astralDist: this.divineSense.astralActive ? this.camera.position.distanceTo(this.divineSense.bodyPosition) : 0,
            astralRadius: this.divineSense.astralRadius,
            astralEdgeRatio: this.divineSense.astralEdgeRatio,
            canAstral: senseStats.canAstralProject,
            senseRadius: senseStats.senseRadius,
            senseStageName: senseStats.senseStageName,
            realmColor: senseStats.realmColor,
        });

        // Automatically show the character-side brush-calligraphy ink realm plaque on every realm/tier increase
        // (For Nascent Soul breakthrough ceremony, wait until the ceremony finishes in onComplete!)
        const curTier = this.vitals.stats.tier;
        if (curTier > this.lastShownTier && !this.nascentBreakthrough.active) {
            this.lastShownTier = curTier;
            this.hud.showRealmInkBadge(this.vitals.stats.fullLabel, this.vitals.stats.realmColor);
        } else if (curTier < this.lastShownTier) {
            this.lastShownTier = curTier;
        }
        if (this.hud.realmInkBadgeActive) {
            this.inkCamRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
            this.inkAnchorWorld.copy(this.player.avatar.position)
                .addScaledVector(this.inkCamRight, 0.92);
            this.inkAnchorWorld.y += 1.65;
            this.inkAnchorWorld.project(this.camera);
            const inView = this.inkAnchorWorld.z >= -1 && this.inkAnchorWorld.z <= 1;
            const sx = (this.inkAnchorWorld.x * 0.5 + 0.5) * innerWidth;
            const sy = (-this.inkAnchorWorld.y * 0.5 + 0.5) * innerHeight - 66;
            this.hud.updateRealmInkBadge(dt, sx, sy, inView);
        }

        const liveHeading = ((T.MathUtils.radToDeg(this.input.yaw) % 360) + 360) % 360;
        this.hud.updateCompass(liveHeading);

        const frameMsSample = raw * 1000;
        this.frames.push(frameMsSample);
        this.frameSum += frameMsSample;
        if (this.frames.length > 180) {
            this.frameSum -= this.frames.shift()!;
        }
        this.sample += dt;
        if (this.sample > .25) {
            this.sample = 0;
            this.frameMs = this.frameSum / Math.max(1, this.frames.length);
            this.fps = 1000 / Math.max(0.1, this.frameMs);
            const speed = this.player.velocity.length();
            this.hud.setOmenActive(this.celestialOmen.active);
            this.hud.updateVitals(this.vitals.snapshot(), this.vitals.activeNotice(this.time));
            this.hud.speed.textContent = (speed * 3.6).toFixed(0);
            this.hud.altitude.textContent = (detachedCam ? this.camera.position.y : this.player.position.y).toFixed(0);
            this.hud.mode.textContent = this.divineSense.astralActive ? `神识离体 · ${senseStats.senseStageName}`
                : this.follow.free ? '观景镜头 · 角色悬停'
                : avatar.mounting ? '正在踏剑'
                : this.player.escapeLight ? '元婴 · 遁光破空'
                : this.player.voidFlying && this.player.skyWalking ? (speed > 9 ? '元婴 · 踏空疾行 (V)' : speed > .4 ? '元婴 · 踏空而行 (V)' : '元婴 · 踏空悬停 (V)')
                : this.player.voidFlying ? (speed > 2.2 ? '元婴 · 御空飞行 (V)' : '元婴 · 凌空悬停 (V)')
                : this.player.boosting ? '御剑 · 加速'
                : this.player.flying ? '御剑 · 巡航'
                : this.player.swimming ? (speed > .4 ? '涉水 · 畅游' : '涉水 · 浮水')
                : avatar.casting ? '施法 · 万剑归宗'
                : avatar.giantSwordCasting ? '施法 · 巨剑术'
                : avatar.fireballTime !== undefined ? '施法 · 火球术'
                : this.player.grounded ? (avatar.swordDrawn
                    ? (speed > config.walkSpeed + .4 ? '持剑 · 奔跑' : '持剑 · 戒备')
                    : (speed > config.walkSpeed + .4 ? '奔跑' : '步行 · 循溪而行')) : '腾空';
            const pos = detachedCam ? this.camera.position : this.player.position;
            const region = regionAt(pos.x, pos.z);
            this.hud.updateTelemetry({
                x: pos.x,
                y: pos.y,
                z: pos.z,
                heading: liveHeading,
                regionName: region.name,
                regionSub: region.id === 'village' ? 'CHANGFENG VALLEY' : region.subtitle.toUpperCase(),
                flying: this.player.flying,
                boosting: this.player.boosting,
                sprinting: this.player.grounded && speed > config.walkSpeed + .4,
                casting: avatar.casting,
                fireball: avatar.fireballTime !== undefined,
                giantSword: avatar.giantSwordCasting,
                swordDrawn: avatar.swordDrawn,
                spirit: this.vitals.spirit,
                stamina: this.vitals.stamina,
                hours: this.atmosphere.dayNight.hours,
                timeLabel: formatShichen(this.atmosphere.dayNight.hours),
            });
            this.worldMap.renderMinimap(this.hud.minimapCanvas, pos, this.hud.minimapZoom, senseOverlay.mapBlips, senseRing);
            if (!this.hud.debug.classList.contains('hidden')) {
                const s = this.snapshot();
                this.hud.debug.textContent = `${this.fps.toFixed(1)} FPS / ${this.frameMs.toFixed(1)} ms (DPR×${this.resolutionScaler.scale.toFixed(2)})\nDraw calls   ${s.calls}\nTriangles    ${s.triangles.toLocaleString()}\nChunks       ${s.chunks} / ${config.maxChunks}\nTerrain nodes ${s.terrainNodes}\nLoad queue   ${s.queue}\nWildlife     ${s.wildlife.rendered} / ${s.wildlife.active}\nInstances    ${s.instances.toLocaleString()}\nGeometries   ${s.geometries}\nGPU estimate ${s.estimatedMiB.toFixed(1)} MiB*\nSpeed        ${s.speed.toFixed(1)} m/s\nGround gap   ${s.clearance.toFixed(2)} m\n* buffers only; excludes driver memory`;
            }
        }
    };

    snapshot() {
        const info = this.renderer.info;
        let bytes = 0, instances = 0;
        const seen = new Set<T.BufferGeometry>();
        this.scene.traverse(o => {
            if (o instanceof T.Mesh) {
                if (!seen.has(o.geometry)) {
                    seen.add(o.geometry);
                    for (const a of Object.values(o.geometry.attributes) as T.BufferAttribute[])
                        bytes += a.array.byteLength;
                    bytes += o.geometry.index?.array.byteLength ?? 0;
                }
                if (o instanceof T.InstancedMesh) {
                    bytes += o.instanceMatrix.array.byteLength + (o.instanceColor?.array.byteLength ?? 0);
                    instances += o.count;
                } else if (o.geometry instanceof T.InstancedBufferGeometry) {
                    instances += o.geometry.instanceCount;
                }
            }
        });
        const lods = [0, 0, 0];
        for (const c of this.terrain.chunks.values()) lods[c.lod]++;
        return {
            fps: this.fps,
            frameMs: this.frameMs,
            position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
            speed: this.player.velocity.length(),
            clearance: this.player.position.y - this.player.floor(this.player.position.x, this.player.position.z),
            flying: this.player.flying,
            grounded: this.player.grounded,
            freeCamera: this.follow.free,
            heading: ((this.input.yaw * 180 / Math.PI) % 360 + 360) % 360,
            terrainNodes: this.terrain.lod.nodes.length,
            terrainTriangles: this.terrain.lod.nodes.length * 512,
            quality: this.quality,
            chunks: this.terrain.chunks.size,
            lods,
            queue: this.terrain.queue,
            instances,
            calls: info.render.calls,
            triangles: info.render.triangles,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            estimatedMiB: bytes / 1048576,
            wildlife: this.wildlife.stats(),
            resolution: { width: this.renderer.domElement.width, height: this.renderer.domElement.height },
            webgl: this.renderer.getContext().getParameter(this.renderer.getContext().VERSION),
        };
    }

    dispose() {
        this.disposed = true;
        this.renderer.setAnimationLoop(null);
        window.removeEventListener('resize', this.resize);
        window.removeEventListener('keydown', this.itemKey);
        document.removeEventListener('visibilitychange', this.visibility);
        this.renderer.domElement.removeEventListener('click', this.capture);
        this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
        this.input.dispose();
        this.touchControls.dispose();
        this.worldMap.dispose();
        this.wildlife.dispose();
        this.meadow.dispose();
        this.surfaceWake.dispose();
        this.expansion.dispose();
        this.bridgeGrove.dispose();
        this.forestClearing.dispose();
        this.terrain.dispose();
        this.atmosphere.dispose();
        this.spellLights.dispose();
        this.swordEffects.dispose();
        this.flightAirflow.dispose();
        this.voidFlight.dispose();
        this.celestialOmen.dispose();
        this.nascentBreakthrough.dispose();
        this.divineSense.dispose();
        this.swordArray.dispose();
        this.fireball.dispose();
        this.giantSword.dispose();
        this.player.dispose();
        this.roads.dispose();
        this.geographyDebug.dispose();
        this.hud.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
