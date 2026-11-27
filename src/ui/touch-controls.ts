import { detectDevice } from '../config/device';
import type { Input } from '../player/input';
import iconBasicImg from './assets/skills/basic-attack.jpg';
import iconDashImg from './assets/skills/dash.jpg';
import iconSwordWaveImg from './assets/skills/sword-wave.jpg';
import iconSwordFlightImg from './assets/skills/sword-flight.jpg';
import './touch-controls.css';

/**
 * Multi-touch virtual joystick & ergonomic Xianxia combat/flight pad for mobile & tablet play.
 * Automatically stays hidden on desktop mouse/keyboard setups and activates on touch devices.
 */
export class TouchControls {
    readonly root = document.createElement('div');
    private readonly stickZone: HTMLElement;
    private readonly stickBase: HTMLElement;
    private readonly stickKnob: HTMLElement;
    private readonly flightBtn: HTMLButtonElement;
    private readonly descendBtn: HTMLButtonElement;
    private readonly boostBtn: HTMLButtonElement;
    private readonly jumpBtn: HTMLButtonElement;
    private readonly attackBtn: HTMLButtonElement;
    private readonly senseBtn: HTMLButtonElement;

    private stickTouchId?: number;
    private originX = 0;
    private originY = 0;
    private stickRadius = 52;
    private attackTimer?: number;
    private attackCharged = false;
    private senseTimer?: number;
    private senseLongFired = false;
    private onSensePulse?: () => void;
    private onAstralToggle?: () => void;
    private enabled = false;
    private lastFlying?: boolean;
    private lastBoosting?: boolean;

    private readonly revealOnTouch = () => {
        this.setEnabled(true);
        window.removeEventListener('touchstart', this.revealOnTouch);
    };

    constructor(private readonly input: Input) {
        this.root.className = 'touch-controls hidden';
        this.root.innerHTML = `
            <div class="touch-stick-zone" id="touch-stick-zone">
                <div class="touch-stick-base" id="touch-stick-base">
                    <div class="touch-stick-ring"></div>
                    <div class="touch-stick-knob" id="touch-stick-knob"></div>
                </div>
            </div>
            <div class="touch-action-pad">
                <button type="button" class="touch-btn sub-btn flight-btn" id="touch-flight" aria-label="御剑起降">
                    <img src="${iconSwordFlightImg}" alt="" draggable="false" />
                    <span>御剑</span>
                </button>
                <button type="button" class="touch-btn sub-btn wave-btn" id="touch-wave" aria-label="剑气">
                    <img src="${iconSwordWaveImg}" alt="" draggable="false" />
                    <span>剑气</span>
                </button>
                <button type="button" class="touch-btn sub-btn sense-btn" id="touch-sense" aria-label="神识探查，长按离体">
                    <i class="touch-glyph">识</i>
                    <span>神识</span>
                </button>
                <button type="button" class="touch-btn sub-btn dash-btn" id="touch-boost" aria-label="冲刺加速">
                    <img src="${iconDashImg}" alt="" draggable="false" />
                    <span>疾行</span>
                </button>
                <button type="button" class="touch-btn sub-btn jump-btn" id="touch-jump" aria-label="跳跃或上升">
                    <i class="touch-glyph">⇡</i>
                    <span id="touch-jump-label">腾跃</span>
                </button>
                <button type="button" class="touch-btn sub-btn descend-btn hidden" id="touch-descend" aria-label="飞行下降">
                    <i class="touch-glyph">⇣</i>
                    <span>俯降</span>
                </button>
                <button type="button" class="touch-btn primary-attack-btn" id="touch-attack" aria-label="挥砍或长按剑气">
                    <img src="${iconBasicImg}" alt="" draggable="false" />
                    <span>挥剑</span>
                </button>
            </div>
        `;
        document.body.append(this.root);

        const el = <T extends HTMLElement>(id: string) => this.root.querySelector<T>('#' + id)!;
        this.stickZone = el('touch-stick-zone');
        this.stickBase = el('touch-stick-base');
        this.stickKnob = el('touch-stick-knob');
        this.flightBtn = el<HTMLButtonElement>('touch-flight');
        this.descendBtn = el<HTMLButtonElement>('touch-descend');
        this.boostBtn = el<HTMLButtonElement>('touch-boost');
        this.jumpBtn = el<HTMLButtonElement>('touch-jump');
        this.attackBtn = el<HTMLButtonElement>('touch-attack');
        this.senseBtn = el<HTMLButtonElement>('touch-sense');

        this.bindJoystick();
        this.bindButtons(el<HTMLButtonElement>('touch-wave'));

        if (detectDevice().isMobile || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)) {
            this.setEnabled(true);
        } else {
            window.addEventListener('touchstart', this.revealOnTouch, { passive: true });
        }
    }

    private setEnabled(on: boolean) {
        this.enabled = on;
        document.documentElement.classList.toggle('touch-mode', on);
    }

    setVisible(visible: boolean) {
        const show = this.enabled && visible;
        const wasVisible = !this.root.classList.contains('hidden');
        this.root.classList.toggle('hidden', !show);
        if (!show && wasVisible) {
            this.resetStick();
            this.cancelAttack();
            for (const button of [this.boostBtn, this.jumpBtn, this.descendBtn]) button.classList.remove('pressed');
            for (const code of ['ShiftLeft', 'Space', 'ControlLeft']) this.input.setHeld(code, false);
        }
    }

    bindDivineSense(onSensePulse: () => void, onAstralToggle: () => void) {
        this.onSensePulse = onSensePulse;
        this.onAstralToggle = onAstralToggle;
    }

    syncState(flying: boolean, boosting: boolean, senseActive = false, astralActive = false) {
        if (!this.enabled) return;
        if (flying !== this.lastFlying) {
            this.lastFlying = flying;
            this.flightBtn.classList.toggle('active', flying);
            this.descendBtn.classList.toggle('hidden', !flying && !astralActive);
            const jumpLabel = this.jumpBtn.querySelector('span');
            if (jumpLabel) jumpLabel.textContent = (flying || astralActive) ? '抬升' : '腾跃';
        }
        if (astralActive) {
            this.descendBtn.classList.remove('hidden');
            const jumpLabel = this.jumpBtn.querySelector('span');
            if (jumpLabel) jumpLabel.textContent = '抬升';
        }
        this.senseBtn.classList.toggle('active', senseActive || astralActive);
        if (boosting !== this.lastBoosting) {
            this.lastBoosting = boosting;
            this.boostBtn.classList.toggle('active', boosting);
        }
    }

    private bindJoystick() {
        const onStart = (e: TouchEvent) => {
            if (this.stickTouchId !== undefined) return;
            const t = e.changedTouches[0];
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            this.stickTouchId = t.identifier;
            const rect = this.stickBase.getBoundingClientRect();
            this.stickRadius = rect.width * .44;
            this.originX = rect.left + rect.width / 2;
            this.originY = rect.top + rect.height / 2;
            this.stickBase.classList.add('active');
            this.updateStick(t.clientX, t.clientY);
        };

        const onMove = (e: TouchEvent) => {
            if (this.stickTouchId === undefined) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === this.stickTouchId) {
                    e.preventDefault();
                    this.updateStick(t.clientX, t.clientY);
                    break;
                }
            }
        };

        const onEnd = (e: TouchEvent) => {
            if (this.stickTouchId === undefined) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.stickTouchId) {
                    this.resetStick();
                    break;
                }
            }
        };

        this.stickZone.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
        this.cleanupFns.push(() => {
            this.stickZone.removeEventListener('touchstart', onStart);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
        });
    }

    private readonly cleanupFns: (() => void)[] = [];

    private updateStick(clientX: number, clientY: number) {
        const dx = clientX - this.originX;
        const dy = clientY - this.originY;
        const dist = Math.hypot(dx, dy);
        const clamped = Math.min(this.stickRadius, dist);
        const angle = Math.atan2(dy, dx);
        const kx = Math.cos(angle) * clamped;
        const ky = Math.sin(angle) * clamped;
        this.stickKnob.style.transform = `translate3d(${kx.toFixed(1)}px, ${ky.toFixed(1)}px, 0)`;

        const norm = dist < 6 ? 0 : clamped / this.stickRadius;
        this.input.moveX = norm * Math.cos(angle);
        this.input.moveZ = -norm * Math.sin(angle);
        this.input.sprint = dist > this.stickRadius * 0.88;
        this.stickBase.classList.toggle('sprint', this.input.sprint);
    }

    private resetStick() {
        this.stickTouchId = undefined;
        this.stickKnob.style.transform = 'translate3d(0, 0, 0)';
        this.stickBase.classList.remove('active', 'sprint');
        this.input.moveX = 0;
        this.input.moveZ = 0;
        this.input.sprint = false;
    }

    private bindHoldButton(btn: HTMLButtonElement, code: string) {
        const down = (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            btn.classList.add('pressed');
            this.input.setHeld(code, true);
        };
        const up = (e: PointerEvent) => {
            e.preventDefault();
            btn.classList.remove('pressed');
            this.input.setHeld(code, false);
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', up);
    }

    private readonly cancelAttack = () => {
        window.clearTimeout(this.attackTimer);
        this.attackBtn.classList.remove('pressed', 'charged');
        this.attackCharged = false;
    };

    private bindButtons(waveBtn: HTMLButtonElement) {
        this.flightBtn.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            this.input.trigger('KeyF');
        });
        waveBtn.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            this.input.trigger('AttackHeavy');
        });
        this.bindHoldButton(this.boostBtn, 'ShiftLeft');
        this.bindHoldButton(this.jumpBtn, 'Space');
        this.bindHoldButton(this.descendBtn, 'ControlLeft');

        const cancelSense = () => {
            window.clearTimeout(this.senseTimer);
            this.senseBtn.classList.remove('pressed');
        };
        this.senseBtn.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            this.senseLongFired = false;
            this.senseBtn.classList.add('pressed');
            window.clearTimeout(this.senseTimer);
            this.senseTimer = window.setTimeout(() => {
                this.senseLongFired = true;
                this.onAstralToggle?.();
                this.senseBtn.classList.remove('pressed');
            }, 430);
        });
        this.senseBtn.addEventListener('pointerup', e => {
            e.preventDefault();
            if (!this.senseLongFired) this.onSensePulse?.();
            cancelSense();
        });
        this.senseBtn.addEventListener('pointercancel', cancelSense);
        this.senseBtn.addEventListener('pointerleave', cancelSense);

        const startAttack = (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.attackCharged = false;
            this.attackBtn.classList.add('pressed');
            window.clearTimeout(this.attackTimer);
            this.attackTimer = window.setTimeout(() => {
                this.attackCharged = true;
                this.attackBtn.classList.add('charged');
            }, 360);
        };
        const endAttack = (e: PointerEvent) => {
            if (!this.attackBtn.classList.contains('pressed')) return;
            e.preventDefault();
            window.clearTimeout(this.attackTimer);
            this.attackBtn.classList.remove('pressed', 'charged');
            this.input.trigger(this.attackCharged ? 'AttackHeavy' : 'AttackLight');
            this.attackCharged = false;
        };
        this.attackBtn.addEventListener('pointerdown', startAttack);
        this.attackBtn.addEventListener('pointerup', endAttack);
        this.attackBtn.addEventListener('pointercancel', this.cancelAttack);
    }

    dispose() {
        window.removeEventListener('touchstart', this.revealOnTouch);
        window.clearTimeout(this.attackTimer);
        for (const fn of this.cleanupFns) fn();
        this.root.remove();
    }
}
