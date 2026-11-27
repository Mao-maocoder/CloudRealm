const BACKLASH_ART_URL = new URL('../../resource/boss/dragon_sense_backlash.jpg', import.meta.url).href;

const STYLE_ID = 'dragon-sense-pressure-style';

function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.dragon-pressure-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 48;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.14s ease-out;
}
.dragon-pressure-root.active {
    opacity: 1;
}
.dragon-pressure-vignette {
    position: absolute;
    inset: -6%;
    background:
        radial-gradient(ellipse at 50% 48%,
            rgba(120, 4, 12, 0.04) 18%,
            rgba(155, 8, 18, 0.48) 58%,
            rgba(110, 0, 10, 0.90) 92%,
            rgba(48, 0, 4, 0.98) 100%);
    mix-blend-mode: multiply;
    opacity: var(--dp-shroud, 0);
    will-change: opacity, transform;
}
.dragon-pressure-crimson-tint {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(circle at 50% 45%,
            rgba(220, 18, 28, 0.14) 0%,
            rgba(185, 8, 20, 0.42) 65%,
            rgba(120, 0, 8, 0.74) 100%);
    opacity: var(--dp-tint, 0);
    will-change: opacity;
}
.dragon-pressure-stage {
    position: absolute;
    inset: -6%;
    transform: scale(var(--dp-gaze-scale, 1.12)) translate3d(var(--dp-shake-x, 0px), var(--dp-shake-y, 0px), 0);
    will-change: transform;
}
.dragon-pressure-gaze {
    position: absolute;
    inset: 0;
    background-image: url("${BACKLASH_ART_URL}");
    background-size: cover;
    background-position: center;
    opacity: var(--dp-gaze, 0);
    filter: url(#dragon-backlash-warp) contrast(1.2) saturate(1.36);
    will-change: opacity, filter;
}
.dragon-pressure-gaze-ghost {
    position: absolute;
    inset: 0;
    background-image: url("${BACKLASH_ART_URL}");
    background-size: cover;
    background-position: center;
    opacity: var(--dp-ghost, 0);
    mix-blend-mode: screen;
    transform: translate3d(var(--dp-split-x, 0px), var(--dp-split-y, 0px), 0) scale(1.025);
    filter: saturate(2.2) contrast(1.3) hue-rotate(-8deg);
    will-change: opacity, transform;
}
.dragon-eye-glow {
    position: absolute;
    top: 41.2%;
    width: 22vmax;
    height: 14vmax;
    margin-left: -11vmax;
    margin-top: -7vmax;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 50%,
        rgba(255, 238, 210, 0.95) 0%,
        rgba(255, 72, 42, 0.85) 22%,
        rgba(235, 12, 24, 0.52) 52%,
        rgba(140, 0, 12, 0.0) 78%);
    mix-blend-mode: screen;
    opacity: var(--dp-eye, 0);
    transform: scale(var(--dp-eye-scale, 1));
    filter: blur(4px);
    will-change: opacity, transform;
}
.dragon-eye-glow.left { left: 32.2%; }
.dragon-eye-glow.right { left: 68.4%; }
.dragon-eye-flare {
    position: absolute;
    top: 41.2%;
    width: 44vmax;
    height: 3.2vmax;
    margin-left: -22vmax;
    margin-top: -1.6vmax;
    border-radius: 50%;
    background: radial-gradient(ellipse at 50% 50%,
        rgba(255, 245, 220, 0.92) 0%,
        rgba(255, 58, 38, 0.72) 26%,
        rgba(210, 8, 22, 0.25) 60%,
        rgba(120, 0, 10, 0) 100%);
    mix-blend-mode: screen;
    opacity: var(--dp-flare, 0);
    transform: scaleX(var(--dp-flare-sx, 1)) scaleY(var(--dp-flare-sy, 1));
    filter: blur(2.5px);
    will-change: opacity, transform;
}
.dragon-eye-flare.left { left: 32.2%; }
.dragon-eye-flare.right { left: 68.4%; }
.dragon-pressure-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    mix-blend-mode: screen;
    opacity: var(--dp-fx-canvas, 0);
    will-change: opacity;
}
.dragon-pressure-flash {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 50%,
        rgba(255, 195, 190, 0.92) 0%,
        rgba(255, 38, 42, 0.78) 38%,
        rgba(140, 0, 10, 0.65) 100%);
    opacity: var(--dp-flash, 0);
    mix-blend-mode: screen;
    will-change: opacity;
}
.dragon-pressure-ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 24vmin;
    height: 24vmin;
    margin-left: -12vmin;
    margin-top: -12vmin;
    border-radius: 50%;
    border: 3px solid rgba(255, 58, 52, 0.92);
    box-shadow:
        0 0 32px rgba(255, 22, 32, 0.95),
        inset 0 0 28px rgba(255, 48, 36, 0.75);
    opacity: 0;
    transform: scale(0.2);
    will-change: transform, opacity;
}
.dragon-pressure-ring.fire {
    animation: dragonBacklashRing 1.05s cubic-bezier(0.12, 0.82, 0.25, 1) forwards;
}
.dragon-pressure-ring.fire.r2 {
    animation-delay: 0.11s;
    border-width: 2px;
}
.dragon-pressure-ring.fire.r3 {
    animation-delay: 0.22s;
    border-width: 1.5px;
}
@keyframes dragonBacklashRing {
    0%   { opacity: 0.98; transform: scale(0.18); }
    35%  { opacity: 0.85; }
    100% { opacity: 0;    transform: scale(7.4); }
}
`;
    document.head.appendChild(style);
}

interface BloodEmber {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    maxLife: number;
    kind: 'eyeFlame' | 'spark';
}

/**
 * Full-screen cultivation Divine Sense oppression & backlash VFX for the Ancient Dragon Boss:
 * - Gradual blood-red mist shroud & heartbeat pulse as a lower-realm (< 元婴中期) player probes closer
 * - Real-time animated SVG turbulence/displacement warp + chromatic ghost split
 * - Dual pulsing crimson eye-flame halos, anamorphic blood flares, and procedural rising eye-flame wisps/sparks
 * - Concentric crimson shockwave rings + violent tremor on backlash
 */
export class DragonSensePressureFX {
    private readonly root: HTMLDivElement;
    private readonly rings: HTMLDivElement[] = [];
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D | null;
    private readonly turbEl: SVGFETurbulenceElement | null;
    private readonly dispEl: SVGFEDisplacementMapElement | null;
    private readonly embers: BloodEmber[] = [];

    private smoothPressure = 0;
    private pulsePhase = 0;
    private elapsed = 0;
    private backlashAge = -1;
    private readonly backlashDuration = 2.8;
    private canvasW = 0;
    private canvasH = 0;

    constructor() {
        ensureStyles();
        this.root = document.createElement('div');
        this.root.className = 'dragon-pressure-root';
        this.root.innerHTML = `
            <svg width="0" height="0" style="position:absolute;pointer-events:none" aria-hidden="true">
                <defs>
                    <filter id="dragon-backlash-warp" x="-10%" y="-10%" width="120%" height="120%">
                        <feTurbulence id="dragon-warp-turb" type="fractalNoise" baseFrequency="0.012 0.022" numOctaves="2" seed="7" result="noise"/>
                        <feDisplacementMap id="dragon-warp-disp" in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>
                    </filter>
                </defs>
            </svg>
            <div class="dragon-pressure-vignette"></div>
            <div class="dragon-pressure-crimson-tint"></div>
            <div class="dragon-pressure-stage">
                <div class="dragon-pressure-gaze"></div>
                <div class="dragon-pressure-gaze-ghost"></div>
                <div class="dragon-eye-glow left"></div>
                <div class="dragon-eye-glow right"></div>
                <div class="dragon-eye-flare left"></div>
                <div class="dragon-eye-flare right"></div>
                <canvas class="dragon-pressure-canvas"></canvas>
            </div>
            <div class="dragon-pressure-flash"></div>
            <div class="dragon-pressure-ring r1"></div>
            <div class="dragon-pressure-ring r2"></div>
            <div class="dragon-pressure-ring r3"></div>
        `;
        this.rings.push(
            this.root.querySelector('.r1') as HTMLDivElement,
            this.root.querySelector('.r2') as HTMLDivElement,
            this.root.querySelector('.r3') as HTMLDivElement,
        );
        this.canvas = this.root.querySelector('.dragon-pressure-canvas') as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.turbEl = this.root.querySelector('#dragon-warp-turb');
        this.dispEl = this.root.querySelector('#dragon-warp-disp');
        document.body.appendChild(this.root);
    }

    private ensureCanvasSize() {
        const w = Math.max(320, Math.floor(window.innerWidth * 0.6));
        const h = Math.max(180, Math.floor(window.innerHeight * 0.6));
        if (w !== this.canvasW || h !== this.canvasH) {
            this.canvasW = w;
            this.canvasH = h;
            this.canvas.width = w;
            this.canvas.height = h;
        }
    }

    private spawnEyeFlame(burst = false) {
        if (this.embers.length > 90) return;
        const leftEye = Math.random() < 0.5;
        const ex = (leftEye ? 0.322 : 0.684) * this.canvasW;
        const ey = 0.412 * this.canvasH;
        const isSpark = Math.random() < (burst ? 0.55 : 0.35);
        const angle = isSpark
            ? (Math.random() - 0.5) * Math.PI * 2
            : -Math.PI * 0.5 + (Math.random() - 0.5) * 1.15;
        const speed = isSpark
            ? (burst ? 160 + Math.random() * 240 : 65 + Math.random() * 110)
            : (42 + Math.random() * 95);
        this.embers.push({
            x: ex + (Math.random() - 0.5) * this.canvasW * 0.05,
            y: ey + (Math.random() - 0.5) * this.canvasH * 0.025,
            vx: Math.cos(angle) * speed + (leftEye ? -18 : 18),
            vy: Math.sin(angle) * speed - (isSpark ? 20 : 48),
            size: isSpark ? (2.0 + Math.random() * 3.5) : (16 + Math.random() * 26),
            life: 0,
            maxLife: isSpark ? (0.35 + Math.random() * 0.45) : (0.45 + Math.random() * 0.55),
            kind: isSpark ? 'spark' : 'eyeFlame',
        });
    }

    private stepCanvasFx(dt: number, intensity: number, burstActive: boolean) {
        if (!this.ctx) return;
        this.ensureCanvasSize();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvasW, this.canvasH);

        const spawnRate = (burstActive ? 75 : 28) * intensity;
        let toSpawn = Math.floor(spawnRate * dt) + (Math.random() < (spawnRate * dt) % 1 ? 1 : 0);
        while (toSpawn-- > 0) {
            this.spawnEyeFlame(burstActive);
        }

        // Draw flickering blood-flame wisps & crackling sparks around both eyes
        for (let i = this.embers.length - 1; i >= 0; i--) {
            const p = this.embers[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                this.embers.splice(i, 1);
                continue;
            }
            const u = p.life / p.maxLife;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.kind === 'eyeFlame') {
                p.vx += Math.sin(this.elapsed * 9 + i) * 38 * dt;
                p.vy -= 55 * dt;
                const r = p.size * (0.7 + u * 0.9);
                const alpha = Math.sin(u * Math.PI) * 0.52 * intensity;
                const grad = ctx.createRadialGradient(p.x, p.y, r * 0.08, p.x, p.y, r);
                grad.addColorStop(0.0, `rgba(255, 220, 165, ${alpha})`);
                grad.addColorStop(0.35, `rgba(255, 52, 28, ${alpha * 0.85})`);
                grad.addColorStop(0.75, `rgba(175, 6, 18, ${alpha * 0.42})`);
                grad.addColorStop(1.0, 'rgba(90, 0, 8, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            } else {
                p.vx *= Math.exp(-2.2 * dt);
                p.vy *= Math.exp(-2.2 * dt);
                const alpha = (1 - u) * 0.92 * intensity;
                ctx.strokeStyle = `rgba(255, ${Math.floor(140 * (1 - u))}, 60, ${alpha})`;
                ctx.lineWidth = p.size * (1 - u * 0.5);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
                ctx.stroke();
            }
        }
    }

    /** Fires the violent full-screen crimson dragon-eyes gaze + concentric shockwave backlash! */
    triggerBacklash() {
        this.backlashAge = 0;
        this.smoothPressure = 1;
        this.root.classList.add('active');
        this.ensureCanvasSize();
        for (let i = 0; i < 28; i++) {
            this.spawnEyeFlame(true);
        }
        for (const ring of this.rings) {
            ring.classList.remove('fire');
            void ring.offsetWidth;
            ring.classList.add('fire');
        }
    }

    update(dt: number, targetPressure: number) {
        const cdt = Math.min(Math.max(dt, 0), 0.05);
        this.elapsed += cdt;
        this.pulsePhase += cdt * (3.2 + targetPressure * 5.4);
        const damp = targetPressure > this.smoothPressure ? 5.5 : 3.2;
        this.smoothPressure += (targetPressure - this.smoothPressure) * (1 - Math.exp(-damp * cdt));
        if (this.smoothPressure < 0.004 && this.backlashAge < 0) {
            this.smoothPressure = 0;
            this.embers.length = 0;
            this.root.classList.remove('active');
            return;
        }

        this.root.classList.add('active');
        const heartbeat = 0.86 + 0.14 * Math.sin(this.pulsePhase);
        const flicker = 0.88 + 0.12 * Math.sin(this.elapsed * 23.0) * Math.cos(this.elapsed * 13.7);

        let shroud = Math.min(1, this.smoothPressure * 1.05) * heartbeat;
        let tint = Math.pow(this.smoothPressure, 1.15) * 0.72 * heartbeat;
        let gaze = Math.max(0, (this.smoothPressure - 0.48) / 0.52) * 0.38 * heartbeat;
        let gazeScale = 1.16 - this.smoothPressure * 0.06;
        let eyeGlow = Math.max(0, (this.smoothPressure - 0.45) / 0.55) * 0.55 * flicker;
        let eyeScale = 0.92 + 0.16 * heartbeat;
        let flare = Math.max(0, (this.smoothPressure - 0.58) / 0.42) * 0.45 * flicker;
        let flareSx = 0.85 + 0.35 * flicker;
        let flareSy = 0.85 + 0.25 * heartbeat;
        let ghost = 0;
        let splitX = 0;
        let splitY = 0;
        let flash = 0;
        let shakeX = 0;
        let shakeY = 0;
        let warpScale = this.smoothPressure * 14.0;
        let fxCanvas = gaze > 0.04 ? Math.min(1, gaze * 1.4) : 0;

        const burstActive = this.backlashAge >= 0;
        if (burstActive) {
            this.backlashAge += cdt;
            const t = this.backlashAge / this.backlashDuration;
            if (t >= 1) {
                this.backlashAge = -1;
            } else {
                const gazeAlpha = t < 0.08
                    ? t / 0.08
                    : t < 0.44
                        ? 0.96
                        : 0.96 * Math.pow(1 - (t - 0.44) / 0.56, 1.45);
                gaze = Math.max(gaze, gazeAlpha);
                gazeScale = t < 0.16
                    ? 1.25 - (t / 0.16) * 0.18
                    : 1.07 - (t - 0.16) * 0.05;
                eyeGlow = Math.max(eyeGlow, gazeAlpha * 1.08 * flicker);
                eyeScale = 1.05 + (t < 0.2 ? (1 - t / 0.2) * 0.48 : 0.12 * Math.sin(this.elapsed * 16));
                flare = Math.max(flare, gazeAlpha * (t < 0.25 ? 1.0 : 0.72) * flicker);
                flareSx = t < 0.22 ? 1.35 + (1 - t / 0.22) * 0.9 : 1.05 + 0.22 * flicker;
                flareSy = t < 0.22 ? 1.25 + (1 - t / 0.22) * 0.6 : 0.95;
                flash = t < 0.22 ? Math.pow(1 - t / 0.22, 1.8) * 0.95 : 0;
                shroud = Math.max(shroud, (1 - t) * 1.0);
                tint = Math.max(tint, (1 - t) * 0.85);
                fxCanvas = Math.max(fxCanvas, gazeAlpha);

                // Dynamic spiritual distortion wave: intense shock ripple -> living blood heat-haze
                const shockRipple = t < 0.35 ? Math.pow(1 - t / 0.35, 1.3) * 34 : 0;
                warpScale = Math.max(warpScale, 11 + shockRipple + Math.sin(this.elapsed * 14) * 4.5);

                // Chromatic soul-shock ghost split + concussion tremor during initial 0.7s
                if (t < 0.32) {
                    const amp = 1 - t / 0.32;
                    ghost = amp * 0.55;
                    splitX = Math.sin(this.elapsed * 55) * 18 * amp;
                    splitY = Math.cos(this.elapsed * 42) * 8 * amp;
                    shakeX = (Math.random() - 0.5) * 2 * (26 * amp);
                    shakeY = (Math.random() - 0.5) * 2 * (26 * amp);
                }
            }
        } else if (this.smoothPressure > 0.55) {
            const amp = ((this.smoothPressure - 0.55) / 0.45) * 4.8;
            shakeX = (Math.random() - 0.5) * 2 * amp;
            shakeY = (Math.random() - 0.5) * 2 * amp;
            ghost = ((this.smoothPressure - 0.55) / 0.45) * 0.16 * heartbeat;
            splitX = Math.sin(this.elapsed * 18) * 4.5;
        }

        // Animate SVG fractal noise frequency & displacement scale every frame for organic heat-haze warping!
        if (this.turbEl && this.dispEl) {
            const fx = 0.011 + 0.004 * Math.sin(this.elapsed * 2.7);
            const fy = 0.020 + 0.006 * Math.cos(this.elapsed * 3.4);
            this.turbEl.setAttribute('baseFrequency', `${fx.toFixed(4)} ${fy.toFixed(4)}`);
            this.dispEl.setAttribute('scale', warpScale.toFixed(1));
        }

        if (fxCanvas > 0.02) {
            this.stepCanvasFx(cdt, fxCanvas, burstActive && this.backlashAge < 0.9);
        }

        const st = this.root.style;
        st.setProperty('--dp-shroud', shroud.toFixed(3));
        st.setProperty('--dp-tint', tint.toFixed(3));
        st.setProperty('--dp-gaze', gaze.toFixed(3));
        st.setProperty('--dp-gaze-scale', gazeScale.toFixed(4));
        st.setProperty('--dp-eye', eyeGlow.toFixed(3));
        st.setProperty('--dp-eye-scale', eyeScale.toFixed(3));
        st.setProperty('--dp-flare', flare.toFixed(3));
        st.setProperty('--dp-flare-sx', flareSx.toFixed(3));
        st.setProperty('--dp-flare-sy', flareSy.toFixed(3));
        st.setProperty('--dp-ghost', ghost.toFixed(3));
        st.setProperty('--dp-split-x', `${splitX.toFixed(1)}px`);
        st.setProperty('--dp-split-y', `${splitY.toFixed(1)}px`);
        st.setProperty('--dp-fx-canvas', fxCanvas.toFixed(3));
        st.setProperty('--dp-flash', flash.toFixed(3));
        st.setProperty('--dp-shake-x', `${shakeX.toFixed(1)}px`);
        st.setProperty('--dp-shake-y', `${shakeY.toFixed(1)}px`);
    }

    dispose() {
        this.embers.length = 0;
        this.root.remove();
    }
}
