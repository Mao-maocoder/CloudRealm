import type { GroundSample } from '../effects/fireball-trajectory';

const BGM_WORLD_URL = new URL('../../resource/audio/bgm_world.mp3', import.meta.url).href;
const DRAGON_BACKLASH_URL = new URL('../../resource/audio/dragon_backlash.mp3', import.meta.url).href;
const GIANT_SWORD_CAST_URL = new URL('../../resource/audio/giant_sword_cast.mp3', import.meta.url).href;
const GIANT_SWORD_IMPACT_URL = new URL('../../resource/audio/giant_sword_impact.mp3', import.meta.url).href;
const SWORD_ARRAY_START_URL = new URL('../../resource/audio/sword_array_start.mp3', import.meta.url).href;
const SWORD_ARRAY_RAIN_URL = new URL('../../resource/audio/sword_array_rain.mp3', import.meta.url).href;

export type SurfaceKind = GroundSample['kind'];

const AUDIO_PREFS_KEY = 'yunjing-audio-v1';

interface AudioPrefs {
    muted: boolean;
    bgmVolume: number;
    sfxVolume: number;
}

/**
 * Unified Web Audio engine for 《云境》:
 * - World BGM (`bgm_world.mp3`) with smooth fade-in, dynamic Boss/Backlash ducking, and auto-unlock
 * - Surface-aligned footsteps & landings (grass / soil / water / stone)
 * - Continuous speed-modulated sword/void flight wind loop
 * - Xianxia skill SFX (sword wave, fireball, giant sword, sword array, divine sense, breakthrough)
 * - Ancient Dragon Boss SFX (roar, wingbeat, flame breath, seismic slam, blood-pressure heartbeat & backlash)
 */
export class AudioManager {
    private ctx?: AudioContext;
    private masterGain?: GainNode;
    private bgmGain?: GainNode;
    private sfxGain?: GainNode;
    private noiseBuffer?: AudioBuffer;
    private readonly sfxBuffers = new Map<string, AudioBuffer>();
    private readonly sfxLoading = new Set<string>();
    private activeGiantCast: Array<{ src: AudioBufferSourceNode; gain: GainNode }> = [];
    private activeSwordArray: Array<{ src: AudioBufferSourceNode; gain: GainNode }> = [];
    private swordArrayActiveUntil = 0;

    // World BGM element
    private bgmEl?: HTMLAudioElement;
    private bgmSource?: MediaElementAudioSourceNode;
    private bgmStarted = false;
    private targetBgmDuck = 1.0;

    // Continuous flight wind nodes
    private windSource?: AudioBufferSourceNode;
    private windFilter?: BiquadFilterNode;
    private windGain?: GainNode;

    // Boss tension sub-drone
    private bossDroneOsc?: OscillatorNode;
    private bossDroneGain?: GainNode;

    // Footstep & continuous SFX pacing
    private stepAccum = 0;
    private wasGrounded = true;
    private lastAirVy = 0;
    private heartbeatAccum = 0;
    private lastRainHitTime = 0;
    private lastDragonBreathTime = 0;
    private lastWingFlapTime = 0;

    // Preferences
    muted = false;
    bgmVolume = 0.48;
    sfxVolume = 0.72;

    // HUD utility audio toggle button (mounted side-by-side with #settings)
    private uiBtn?: HTMLButtonElement;
    private uiIcon?: SVGSVGElement;
    private disposed = false;

    constructor() {
        this.loadPrefs();
    }

    private loadPrefs() {
        try {
            if (typeof localStorage === 'undefined') return;
            const raw = localStorage.getItem(AUDIO_PREFS_KEY);
            if (!raw) return;
            const p = JSON.parse(raw) as Partial<AudioPrefs>;
            if (typeof p.muted === 'boolean') this.muted = p.muted;
            if (typeof p.bgmVolume === 'number') this.bgmVolume = Math.max(0, Math.min(1, p.bgmVolume));
            if (typeof p.sfxVolume === 'number') this.sfxVolume = Math.max(0, Math.min(1, p.sfxVolume));
        } catch {}
    }

    private savePrefs() {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({
                muted: this.muted,
                bgmVolume: this.bgmVolume,
                sfxVolume: this.sfxVolume,
            }));
        } catch {}
    }

    /** Binds the native HUD `.util-btn#audio-toggle` button right beside the settings gear. */
    bindToggleButton() {
        if (typeof document === 'undefined') return;
        const btn = document.getElementById('audio-toggle') as HTMLButtonElement | null;
        const ico = document.getElementById('audio-toggle-ico') as SVGSVGElement | null;
        if (!btn) return;
        this.uiBtn = btn;
        this.uiIcon = ico ?? undefined;
        btn.onclick = e => {
            e.stopPropagation();
            this.unlock();
            this.toggleMute();
        };
        this.syncToggleIcon();
    }

    private syncToggleIcon() {
        if (!this.uiBtn) return;
        this.uiBtn.style.opacity = this.muted ? '0.58' : '1';
        if (this.uiIcon) {
            this.uiIcon.innerHTML = this.muted
                ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="currentColor"/>'
                : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/>';
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        this.savePrefs();
        this.syncToggleIcon();
        this.applyGains();
    }

    /** Must be called from a user gesture (click / keydown) to unlock Web Audio & fade in World BGM. */
    unlock() {
        if (this.disposed || typeof window === 'undefined') return;
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            this.ctx = ctx;

            this.masterGain = ctx.createGain();
            this.bgmGain = ctx.createGain();
            this.sfxGain = ctx.createGain();

            this.bgmGain.connect(this.masterGain);
            this.sfxGain.connect(this.masterGain);
            this.masterGain.connect(ctx.destination);

            // Pre-bake 2s white noise buffer for footsteps, wind, fire, splashes & impacts
            const len = ctx.sampleRate * 2;
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
            this.noiseBuffer = buf;

            // World BGM element
            const el = new Audio(BGM_WORLD_URL);
            el.loop = true;
            el.preload = 'auto';
            el.crossOrigin = 'anonymous';
            this.bgmEl = el;
            this.bgmSource = ctx.createMediaElementSource(el);
            this.bgmSource.connect(this.bgmGain);

            // Continuous flight wind loop
            const wind = ctx.createBufferSource();
            wind.buffer = buf;
            wind.loop = true;
            const wf = ctx.createBiquadFilter();
            wf.type = 'bandpass';
            wf.frequency.value = 340;
            wf.Q.value = 1.6;
            const wg = ctx.createGain();
            wg.gain.value = 0;
            wind.connect(wf);
            wf.connect(wg);
            wg.connect(this.sfxGain);
            wind.start();
            this.windSource = wind;
            this.windFilter = wf;
            this.windGain = wg;

            // Low ominous Boss tension drone
            const drone = ctx.createOscillator();
            drone.type = 'sawtooth';
            drone.frequency.value = 46;
            const df = ctx.createBiquadFilter();
            df.type = 'lowpass';
            df.frequency.value = 125;
            const dg = ctx.createGain();
            dg.gain.value = 0;
            drone.connect(df);
            df.connect(dg);
            dg.connect(this.sfxGain);
            drone.start();
            this.bossDroneOsc = drone;
            this.bossDroneGain = dg;

            this.applyGains();
            this.preloadSfxAssets(ctx);
        }

        if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        if (this.bgmEl && !this.bgmStarted) {
            this.bgmStarted = true;
            this.bgmEl.play().catch(() => {
                this.bgmStarted = false;
            });
        }
    }

    private applyGains() {
        if (!this.ctx || !this.masterGain || !this.bgmGain || !this.sfxGain) return;
        const now = this.ctx.currentTime;
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.06);
        this.bgmGain.gain.setTargetAtTime(this.bgmVolume * this.targetBgmDuck, now, 0.35);
        this.sfxGain.gain.setTargetAtTime(this.sfxVolume, now, 0.06);
    }

    private ready(): AudioContext | undefined {
        if (this.disposed || this.muted || !this.ctx || this.ctx.state !== 'running') return undefined;
        return this.ctx;
    }

    // =========================================================================
    // FRAME UPDATE: BGM DUCKING, FOOTSTEPS, FLIGHT WIND, BOSS PRESSURE HEARTBEAT
    // =========================================================================
    update(
        dt: number,
        opts: {
            grounded: boolean;
            horizontalSpeed: number;
            verticalVelocity: number;
            flying: boolean;
            voidFlying: boolean;
            boosting: boolean;
            surface: SurfaceKind;
            bossCombat: boolean;
            dragonPressure: number;
            paused: boolean;
        },
    ) {
        if (!this.ctx || this.disposed) return;
        const cdt = Math.min(dt, 0.05);
        const now = this.ctx.currentTime;

        // 1. Dynamic BGM ducking & Boss tension drone
        const desiredDuck = opts.paused ? 0.25 : opts.dragonPressure > 0.25 ? 0.32 : opts.bossCombat ? 0.58 : 1.0;
        if (Math.abs(desiredDuck - this.targetBgmDuck) > 0.01) {
            this.targetBgmDuck = desiredDuck;
            this.bgmGain?.gain.setTargetAtTime(this.bgmVolume * this.targetBgmDuck, now, 0.45);
        }
        if (this.bossDroneGain) {
            const droneLvl = opts.paused ? 0 : opts.bossCombat ? 0.065 : 0;
            this.bossDroneGain.gain.setTargetAtTime(droneLvl, now, 0.35);
        }

        if (opts.paused || this.muted || this.ctx.state !== 'running') {
            this.windGain?.gain.setTargetAtTime(0, now, 0.12);
            return;
        }

        // 2. Landing impact detection
        if (opts.grounded && !this.wasGrounded && this.lastAirVy < -3.2) {
            const impact = Math.min(1, Math.abs(this.lastAirVy) / 18);
            this.playLanding(opts.surface, impact);
        }
        this.wasGrounded = opts.grounded;
        this.lastAirVy = opts.verticalVelocity;

        // 3. Surface-aligned footsteps (grass / soil / water / stone)
        if (opts.grounded && !opts.flying && opts.horizontalSpeed > 0.85) {
            const running = opts.horizontalSpeed > 6.5;
            const strideDist = running ? 2.55 : 1.95;
            this.stepAccum += opts.horizontalSpeed * cdt;
            if (this.stepAccum >= strideDist) {
                this.stepAccum %= strideDist;
                this.playFootstep(opts.surface, running);
            }
        } else {
            this.stepAccum = Math.min(this.stepAccum, 0.5);
        }

        // 4. Continuous flight wind (sword flight & void flight)
        if (this.windGain && this.windFilter) {
            if (opts.flying && opts.horizontalSpeed > 2.0) {
                const spdNorm = Math.min(1, opts.horizontalSpeed / (opts.voidFlying ? 85 : 55));
                const vol = (0.04 + spdNorm * 0.16) * (opts.boosting ? 1.3 : 1.0);
                const freq = (opts.voidFlying ? 320 : 240) + spdNorm * (opts.boosting ? 760 : 480);
                this.windGain.gain.setTargetAtTime(vol, now, 0.12);
                this.windFilter.frequency.setTargetAtTime(freq, now, 0.12);
            } else {
                this.windGain.gain.setTargetAtTime(0, now, 0.18);
            }
        }

        // 5. Blood-red Divine Sense pressure uses the dedicated dragon_backlash.mp3 asset on trigger (no extra synth heartbeat).
        this.heartbeatAccum = 0;
    }

    // =========================================================================
    // SURFACE-ALIGNED FOOTSTEPS & LANDINGS (GRASS / SOIL / WATER / STONE)
    // =========================================================================
    playFootstep(surface: SurfaceKind, running: boolean) {
        const ctx = this.ready();
        if (!ctx || !this.sfxGain || !this.noiseBuffer) return;
        const now = ctx.currentTime;
        const jitter = 0.92 + Math.random() * 0.16;
        const vol = running ? 0.24 : 0.15;

        if (surface === 'water') {
            // Water splash + liquid bubble droplets
            this.spawnNoiseBurst(ctx, now, 0.16, 'bandpass', 1800 * jitter, 1.4, vol * 1.15);
            this.spawnNoiseBurst(ctx, now + 0.025, 0.14, 'highpass', 3200 * jitter, 0.8, vol * 0.65);
            this.spawnTone(ctx, now, 0.09, 'sine', 520 * jitter, 1280 * jitter, vol * 0.32);
            this.spawnTone(ctx, now + 0.04, 0.07, 'sine', 780 * jitter, 1680 * jitter, vol * 0.22);
        } else if (surface === 'grass') {
            // Soft leafy brush rustle + muffled earth pad
            this.spawnNoiseBurst(ctx, now, 0.11, 'bandpass', 2600 * jitter, 1.1, vol * 0.72);
            this.spawnTone(ctx, now, 0.065, 'sine', 115 * jitter, 58, vol * 0.42);
        } else if (surface === 'soil') {
            // Gritty dirt road crunch + dry earth tap
            this.spawnNoiseBurst(ctx, now, 0.085, 'bandpass', 1050 * jitter, 1.6, vol * 0.88);
            this.spawnNoiseBurst(ctx, now + 0.022, 0.06, 'bandpass', 2200 * jitter, 2.2, vol * 0.45);
            this.spawnTone(ctx, now, 0.055, 'triangle', 148 * jitter, 72, vol * 0.55);
        } else {
            // Stone / ancient ruins crisp heel tap
            this.spawnNoiseBurst(ctx, now, 0.055, 'bandpass', 1650 * jitter, 2.4, vol * 0.85);
            this.spawnTone(ctx, now, 0.05, 'triangle', 260 * jitter, 95, vol * 0.65);
        }
    }

    playLanding(surface: SurfaceKind, impact: number) {
        const ctx = this.ready();
        if (!ctx || !this.sfxGain || !this.noiseBuffer) return;
        const now = ctx.currentTime;
        const v = 0.22 + impact * 0.32;
        if (surface === 'water') {
            this.spawnNoiseBurst(ctx, now, 0.34, 'bandpass', 1400, 0.9, v * 1.1);
            this.spawnTone(ctx, now, 0.18, 'sine', 240, 680, v * 0.45);
        } else if (surface === 'grass') {
            this.spawnNoiseBurst(ctx, now, 0.18, 'bandpass', 2200, 0.9, v * 0.75);
            this.spawnTone(ctx, now, 0.14, 'sine', 120, 42, v * 0.85);
        } else if (surface === 'soil') {
            this.spawnNoiseBurst(ctx, now, 0.16, 'bandpass', 950, 1.3, v * 0.95);
            this.spawnTone(ctx, now, 0.15, 'sine', 135, 48, v * 0.9);
        } else {
            this.spawnNoiseBurst(ctx, now, 0.12, 'bandpass', 1500, 1.8, v * 0.9);
            this.spawnTone(ctx, now, 0.14, 'triangle', 190, 58, v * 0.95);
        }
    }

    // =========================================================================
    // PLAYER SKILLS & CULTIVATION SFX
    // =========================================================================
    playMeleeSlash() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnNoiseBurst(ctx, now, 0.14, 'bandpass', 1600, 1.4, 0.28);
        this.spawnTone(ctx, now, 0.12, 'triangle', 680, 260, 0.16);
    }

    playSwordWave() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        // Crisp sword-ring harmonic + razor air slice
        this.spawnTone(ctx, now, 0.36, 'sine', 1480, 1120, 0.18);
        this.spawnTone(ctx, now, 0.28, 'triangle', 2240, 1660, 0.11);
        this.spawnNoiseBurst(ctx, now, 0.22, 'bandpass', 2400, 1.8, 0.28);
    }

    playFireballRelease(power = 0.5) {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        const s = 0.75 + power * 0.5;
        this.spawnNoiseBurst(ctx, now, 0.38, 'bandpass', 520, 0.9, 0.36 * s);
        this.spawnTone(ctx, now, 0.28, 'sawtooth', 190, 75, 0.22 * s, 420);
    }

    playFireballImpact(power = 0.5) {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        const s = 0.7 + power * 0.55;
        this.spawnTone(ctx, now, 0.45, 'sine', 135, 32, 0.52 * s);
        this.spawnNoiseBurst(ctx, now, 0.52, 'lowpass', 780, 0.7, 0.46 * s);
    }

    playGiantSwordCast(isNascent = false) {
        const ctx = this.ready();
        if (!ctx) return;
        this.stopGiantSwordCast(0.08);
        if (isNascent) {
            const played = this.playSfxBuffer(ctx, 'giantSwordCast', GIANT_SWORD_CAST_URL, {
                gain: 0.95,
                fadeIn: 0.025,
                fadeOut: 0.14,
            });
            if (played) {
                this.activeGiantCast = [played];
                played.src.onended = () => this.untrackGiantCast(played);
                return;
            }
            this.playSfxFallbackAudio(GIANT_SWORD_CAST_URL, 0.95);
            return;
        }
        // Pre-Nascent Giant Sword (筑基/结丹): compact 2.1s cast (burst at 1.23s, launch at 1.89s).
        // Remix real MP3 into two tightly-synced layers: gathering hum -> burst & launch whoosh.
        const gather = this.playSfxBuffer(ctx, 'giantSwordCast', GIANT_SWORD_CAST_URL, {
            offset: 0.0,
            duration: 1.45,
            playbackRate: 1.15,
            gain: 0.84,
            fadeIn: 0.02,
            fadeOut: 0.22,
        });
        const launch = this.playSfxBuffer(ctx, 'giantSwordCast', GIANT_SWORD_CAST_URL, {
            delay: 1.12,
            offset: 2.10,
            duration: 1.35,
            playbackRate: 1.14,
            gain: 0.92,
            fadeIn: 0.06,
            fadeOut: 0.18,
        });
        if (gather || launch) {
            this.activeGiantCast = [];
            if (gather) {
                this.activeGiantCast.push(gather);
                gather.src.onended = () => this.untrackGiantCast(gather);
            }
            if (launch) {
                this.activeGiantCast.push(launch);
                launch.src.onended = () => this.untrackGiantCast(launch);
            }
            return;
        }
        this.playSfxFallbackAudio(GIANT_SWORD_CAST_URL, 0.88);
    }

    stopGiantSwordCast(fadeSec = 0.12) {
        if (!this.activeGiantCast.length || !this.ctx) {
            this.activeGiantCast = [];
            return;
        }
        const nodes = this.activeGiantCast;
        this.activeGiantCast = [];
        for (const n of nodes) this.fadeOutNode(this.ctx, n.src, n.gain, fadeSec);
    }

    playGiantSwordImpact(isNascent = false) {
        const ctx = this.ready();
        if (!ctx) return;
        const played = this.playSfxBuffer(ctx, 'giantSwordImpact', GIANT_SWORD_IMPACT_URL, isNascent
            ? { gain: 1.05, playbackRate: 0.96, fadeIn: 0.008, fadeOut: 0.16 }
            : { gain: 0.92, playbackRate: 1.12, duration: 1.55, fadeIn: 0.008, fadeOut: 0.22 });
        if (!played) {
            this.playSfxFallbackAudio(GIANT_SWORD_IMPACT_URL, isNascent ? 1.0 : 0.9);
        }
    }

    playSwordArrayStart(isNascent = false) {
        const ctx = this.ready();
        if (!ctx) return;
        this.stopSwordArray(0.1);
        const now = ctx.currentTime;
        if (isNascent) {
            const startNode = this.playSfxBuffer(ctx, 'swordArrayStart', SWORD_ARRAY_START_URL, {
                gain: 0.92,
                fadeIn: 0.02,
                fadeOut: 0.32,
            });
            const rainDelay = 3.15;
            const rainNode = this.playSfxBuffer(ctx, 'swordArrayRain', SWORD_ARRAY_RAIN_URL, {
                delay: rainDelay,
                gain: 0.90,
                fadeIn: 0.25,
                fadeOut: 0.28,
            });
            if (startNode || rainNode) {
                if (startNode) this.trackSwordArrayNode(startNode);
                if (rainNode) this.trackSwordArrayNode(rainNode);
                const rainDur = this.sfxBuffers.get('swordArrayRain')?.duration ?? 8.6;
                this.swordArrayActiveUntil = now + rainDelay + rainDur;
                return;
            }
            this.playSfxFallbackAudio(SWORD_ARRAY_START_URL, 0.92);
            return;
        }
        // Pre-Nascent Sword Array (结丹): rain begins at 0.82s and 56 waves finish landing around ~16.9s.
        // Remix: crisp 1.1s sword unsheathing -> three crossfaded pure-rain passes covering the full ~17s barrage.
        const openNode = this.playSfxBuffer(ctx, 'swordArrayStart', SWORD_ARRAY_START_URL, {
            offset: 0.0,
            duration: 1.45,
            playbackRate: 1.18,
            gain: 0.88,
            fadeIn: 0.015,
            fadeOut: 0.30,
        });
        const rainPasses = [
            this.playSfxBuffer(ctx, 'swordArrayRain', SWORD_ARRAY_RAIN_URL, {
                delay: 0.78,
                offset: 0.55,
                duration: 5.75,
                playbackRate: 1.02,
                gain: 0.84,
                fadeIn: 0.24,
                fadeOut: 0.45,
            }),
            this.playSfxBuffer(ctx, 'swordArrayRain', SWORD_ARRAY_RAIN_URL, {
                delay: 6.00,
                offset: 0.65,
                duration: 5.75,
                playbackRate: 0.98,
                gain: 0.84,
                fadeIn: 0.42,
                fadeOut: 0.45,
            }),
            this.playSfxBuffer(ctx, 'swordArrayRain', SWORD_ARRAY_RAIN_URL, {
                delay: 11.45,
                offset: 0.60,
                duration: 5.60,
                playbackRate: 1.00,
                gain: 0.82,
                fadeIn: 0.42,
                fadeOut: 0.85,
            }),
        ];
        if (openNode || rainPasses.some(Boolean)) {
            if (openNode) this.trackSwordArrayNode(openNode);
            for (const n of rainPasses) if (n) this.trackSwordArrayNode(n);
            this.swordArrayActiveUntil = now + 17.05;
            return;
        }
        this.playSfxFallbackAudio(SWORD_ARRAY_START_URL, 0.88);
    }

    stopSwordArray(fadeSec = 0.15) {
        this.swordArrayActiveUntil = 0;
        if (!this.activeSwordArray.length || !this.ctx) {
            this.activeSwordArray = [];
            return;
        }
        const nodes = this.activeSwordArray;
        this.activeSwordArray = [];
        for (const n of nodes) this.fadeOutNode(this.ctx, n.src, n.gain, fadeSec);
    }

    playSwordRainHit() {
        // Real sword-rain audio (`sword_array_rain.mp3`) covers the barrage; old synth beeps removed.
    }

    playDivineSensePulse() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnTone(ctx, now, 0.75, 'sine', 432, 864, 0.18);
        this.spawnTone(ctx, now + 0.05, 0.65, 'sine', 648, 1296, 0.10);
    }

    playAstralToggle(entering: boolean) {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnTone(ctx, now, 0.6, 'sine', entering ? 360 : 720, entering ? 720 : 360, 0.20);
        this.spawnNoiseBurst(ctx, now, 0.35, 'bandpass', 1400, 2.4, 0.14);
    }

    playBreakthrough() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        const chord = [261.63, 392.0, 523.25, 659.25, 783.99, 1046.5];
        chord.forEach((f, i) => {
            this.spawnTone(ctx, now + i * 0.09, 1.4, 'sine', f, f * 1.005, 0.14);
        });
        this.spawnTone(ctx, now, 1.1, 'sine', 95, 42, 0.38);
    }

    playItemUse(kind: 'heal' | 'pill') {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        const base = kind === 'heal' ? 523.25 : 587.33;
        this.spawnTone(ctx, now, 0.32, 'sine', base, base * 1.5, 0.16);
        this.spawnTone(ctx, now + 0.09, 0.38, 'sine', base * 1.25, base * 2.0, 0.12);
    }

    playPlayerHit() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnTone(ctx, now, 0.18, 'sawtooth', 160, 48, 0.34, 380);
        this.spawnNoiseBurst(ctx, now, 0.14, 'lowpass', 600, 0.9, 0.30);
    }

    // =========================================================================
    // ANCIENT DRAGON BOSS & BLOOD-SENSE BACKLASH SFX
    // =========================================================================
    playDragonRoar() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnTone(ctx, now, 1.55, 'sawtooth', 108, 48, 0.42, 340);
        this.spawnTone(ctx, now + 0.06, 1.4, 'sawtooth', 162, 68, 0.28, 520);
        this.spawnNoiseBurst(ctx, now, 1.45, 'bandpass', 380, 1.1, 0.44);
    }

    playDragonWingFlap() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        if (now - this.lastWingFlapTime < 0.65) return;
        this.lastWingFlapTime = now;
        this.spawnNoiseBurst(ctx, now, 0.36, 'lowpass', 260, 0.8, 0.32);
        this.spawnTone(ctx, now, 0.28, 'sine', 85, 36, 0.25);
    }

    playDragonFireBreath() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        if (now - this.lastDragonBreathTime < 0.22) return;
        this.lastDragonBreathTime = now;
        this.spawnNoiseBurst(ctx, now, 0.34, 'bandpass', 480 + Math.random() * 180, 0.75, 0.34);
        this.spawnNoiseBurst(ctx, now, 0.28, 'highpass', 1800, 0.6, 0.14);
    }

    playDragonImpact() {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        this.spawnTone(ctx, now, 0.62, 'sine', 96, 24, 0.62);
        this.spawnNoiseBurst(ctx, now, 0.55, 'lowpass', 460, 0.7, 0.48);
    }

    playHeartbeat(intensity: number) {
        const ctx = this.ready();
        if (!ctx) return;
        const now = ctx.currentTime;
        const v = 0.16 + intensity * 0.32;
        this.spawnTone(ctx, now, 0.14, 'sine', 64, 34, v);
        this.spawnTone(ctx, now + 0.16, 0.12, 'sine', 56, 30, v * 0.75);
    }

    private preloadSfxAssets(ctx: AudioContext) {
        this.preloadSfxBuffer(ctx, 'dragonBacklash', DRAGON_BACKLASH_URL);
        this.preloadSfxBuffer(ctx, 'giantSwordCast', GIANT_SWORD_CAST_URL);
        this.preloadSfxBuffer(ctx, 'giantSwordImpact', GIANT_SWORD_IMPACT_URL);
        this.preloadSfxBuffer(ctx, 'swordArrayStart', SWORD_ARRAY_START_URL);
        this.preloadSfxBuffer(ctx, 'swordArrayRain', SWORD_ARRAY_RAIN_URL);
    }

    private preloadSfxBuffer(ctx: AudioContext, key: string, url: string) {
        if (this.sfxBuffers.has(key) || this.sfxLoading.has(key)) return;
        this.sfxLoading.add(key);
        void fetch(url)
            .then(res => res.arrayBuffer())
            .then(buf => ctx.decodeAudioData(buf))
            .then(decoded => {
                this.sfxLoading.delete(key);
                if (!this.disposed) this.sfxBuffers.set(key, decoded);
            })
            .catch(() => {
                this.sfxLoading.delete(key);
            });
    }

    private playSfxBuffer(
        ctx: AudioContext,
        key: string,
        url: string,
        opts: {
            gain?: number;
            delay?: number;
            offset?: number;
            duration?: number;
            playbackRate?: number;
            fadeIn?: number;
            fadeOut?: number;
        } = {},
    ): { src: AudioBufferSourceNode; gain: GainNode } | undefined {
        if (!this.sfxGain) return undefined;
        this.preloadSfxBuffer(ctx, key, url);
        const buffer = this.sfxBuffers.get(key);
        if (!buffer) return undefined;
        const rate = opts.playbackRate ?? 1.0;
        const offset = Math.max(0, Math.min(opts.offset ?? 0, Math.max(0, buffer.duration - 0.05)));
        const srcSpan = Math.min(opts.duration ?? (buffer.duration - offset), buffer.duration - offset);
        const playDur = srcSpan / rate;
        const startAt = ctx.currentTime + (opts.delay ?? 0);
        const peak = opts.gain ?? 1.0;
        const fadeIn = Math.min(opts.fadeIn ?? 0.01, playDur * 0.25);
        const fadeOut = Math.min(opts.fadeOut ?? 0.06, playDur * 0.4);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = rate;
        const gain = ctx.createGain();
        if (fadeIn > 0.001) {
            gain.gain.setValueAtTime(0.0001, startAt);
            gain.gain.linearRampToValueAtTime(peak, startAt + fadeIn);
        } else {
            gain.gain.setValueAtTime(peak, startAt);
        }
        const fadeOutStart = startAt + Math.max(fadeIn, playDur - fadeOut);
        gain.gain.setValueAtTime(peak, fadeOutStart);
        gain.gain.linearRampToValueAtTime(0.0001, startAt + playDur);

        src.connect(gain);
        gain.connect(this.sfxGain);
        src.start(startAt, offset, srcSpan);
        return { src, gain };
    }

    private untrackGiantCast(node: { src: AudioBufferSourceNode; gain: GainNode }) {
        const idx = this.activeGiantCast.indexOf(node);
        if (idx >= 0) this.activeGiantCast.splice(idx, 1);
    }

    private trackSwordArrayNode(node: { src: AudioBufferSourceNode; gain: GainNode }) {
        this.activeSwordArray.push(node);
        node.src.onended = () => {
            const idx = this.activeSwordArray.indexOf(node);
            if (idx >= 0) this.activeSwordArray.splice(idx, 1);
        };
    }

    private fadeOutNode(ctx: AudioContext, src: AudioBufferSourceNode, gain: GainNode, fadeSec: number) {
        const now = ctx.currentTime;
        try {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
            gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
            src.stop(now + fadeSec + 0.02);
        } catch {}
    }

    private playSfxFallbackAudio(url: string, gain = 1.0) {
        if (this.muted || this.disposed) return;
        const el = new Audio(url);
        el.volume = Math.max(0, Math.min(1, this.sfxVolume * gain));
        void el.play().catch(() => {});
    }

    playDragonSenseBacklash() {
        const ctx = this.ready();
        if (!ctx || !this.sfxGain) return;
        if (this.playSfxBuffer(ctx, 'dragonBacklash', DRAGON_BACKLASH_URL, { gain: 1.05, fadeIn: 0.005, fadeOut: 0.05 })) {
            return;
        }
        this.playSfxFallbackAudio(DRAGON_BACKLASH_URL, 1.0);
    }

    // =========================================================================
    // LOW-LEVEL SYNTHESIS PRIMITIVES
    // =========================================================================
    private spawnTone(
        ctx: AudioContext,
        startTime: number,
        duration: number,
        type: OscillatorType,
        freqStart: number,
        freqEnd: number,
        gainPeak: number,
        lowpassHz?: number,
    ) {
        if (!this.sfxGain) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(gainPeak, startTime + Math.min(0.02, duration * 0.2));
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        if (lowpassHz) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = lowpassHz;
            osc.connect(lp);
            lp.connect(gain);
        } else {
            osc.connect(gain);
        }
        gain.connect(this.sfxGain);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.02);
    }

    private spawnNoiseBurst(
        ctx: AudioContext,
        startTime: number,
        duration: number,
        filterType: BiquadFilterType,
        freqHz: number,
        q: number,
        gainPeak: number,
    ) {
        if (!this.sfxGain || !this.noiseBuffer) return;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        // Start from random offset so consecutive footsteps never sound identical
        const offset = Math.random() * Math.max(0.1, this.noiseBuffer.duration - duration - 0.05);
        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(freqHz, startTime);
        filter.Q.value = q;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(gainPeak, startTime + Math.min(0.015, duration * 0.25));
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        src.start(startTime, offset, duration + 0.02);
    }

    dispose() {
        this.disposed = true;
        this.stopGiantSwordCast(0.02);
        this.stopSwordArray(0.02);
        if (this.uiBtn) this.uiBtn.onclick = null;
        this.bgmEl?.pause();
        this.bgmEl = undefined;
        try { this.windSource?.stop(); } catch {}
        try { this.bossDroneOsc?.stop(); } catch {}
        void this.ctx?.close();
    }
}
