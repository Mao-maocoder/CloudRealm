export class Input {
    readonly keys = new Set<string>();
    private readonly pressed = new Set<string>();
    yaw = 0;
    pitch = -.12;
    /** Analog horizontal movement in [-1, 1] from virtual joystick. */
    moveX = 0;
    /** Analog forward movement in [-1, 1] from virtual joystick (+1 = forward). */
    moveZ = 0;
    /** Analog sprint/boost flag from outer joystick ring or touch dash button. */
    sprint = false;

    private dragging = false;
    private attackStart?: number;
    private lookTouchId?: number;
    private lastTouchX = 0;
    private lastTouchY = 0;

    private readonly down = (e: KeyboardEvent) => {
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            e.preventDefault();
            for (const code of this.keys) if (code !== 'AltLeft' && code !== 'AltRight') this.keys.delete(code);
            this.pressed.clear();
            this.dragging = false;
            this.attackStart = undefined;
            this.keys.add(e.code);
            if (document.pointerLockElement === this.canvas) document.exitPointerLock();
            return;
        }
        if (this.cursorFree) return;
        if (e.target instanceof HTMLElement && e.target.matches('input,select,button')) return;
        if (['Space', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
        if (!e.repeat && !this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
    };

    private readonly up = (e: KeyboardEvent) => {
        if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
        if (this.keys.delete(e.code) && e.code === 'KeyE') this.pressed.add('FireballRelease');
    };

    private readonly blur = () => {
        this.keys.clear();
        this.pressed.clear();
        this.dragging = false;
        this.attackStart = undefined;
        this.lookTouchId = undefined;
        this.moveX = 0;
        this.moveZ = 0;
        this.sprint = false;
    };

    private readonly move = (e: MouseEvent) => {
        if (this.cursorFree || (document.pointerLockElement !== this.canvas && !this.dragging)) return;
        this.addLookDelta(e.movementX * .0025, e.movementY * .002);
    };

    private readonly pointer = (e: MouseEvent) => {
        if (this.cursorFree || e.altKey) return;
        if (e.button === 2) this.dragging = true;
        if (e.button === 0) this.attackStart = e.timeStamp;
    };

    private readonly release = (e: MouseEvent) => {
        if (e.button === 2) this.dragging = false;
        if (e.button !== 0 || this.attackStart === undefined) return;
        if (!this.cursorFree && !e.altKey) {
            this.pressed.add(e.timeStamp - this.attackStart >= 400 ? 'AttackHeavy' : 'AttackLight');
        }
        this.attackStart = undefined;
    };

    private readonly touchStart = (e: TouchEvent) => {
        if (this.lookTouchId !== undefined) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            // Reserve bottom-left quadrant for virtual joystick; allow camera drag everywhere else on canvas.
            if (t.clientX < window.innerWidth * 0.42 && t.clientY > window.innerHeight * 0.45) continue;
            this.lookTouchId = t.identifier;
            this.lastTouchX = t.clientX;
            this.lastTouchY = t.clientY;
            e.preventDefault();
            break;
        }
    };

    private readonly touchMove = (e: TouchEvent) => {
        if (this.lookTouchId === undefined) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier !== this.lookTouchId) continue;
            const dx = t.clientX - this.lastTouchX;
            const dy = t.clientY - this.lastTouchY;
            this.lastTouchX = t.clientX;
            this.lastTouchY = t.clientY;
            this.addLookDelta(dx * .0048, dy * .0038);
            e.preventDefault();
            break;
        }
    };

    private readonly touchEnd = (e: TouchEvent) => {
        if (this.lookTouchId === undefined) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === this.lookTouchId) {
                this.lookTouchId = undefined;
                break;
            }
        }
    };

    private readonly lockChanged = () => {
        if (document.pointerLockElement === this.canvas) return;
        this.attackStart = undefined;
        this.pressed.delete('AttackLight');
        this.pressed.delete('AttackHeavy');
    };

    private readonly menu = (e: Event) => e.preventDefault();

    constructor(private canvas: HTMLCanvasElement) {
        window.addEventListener('keydown', this.down);
        window.addEventListener('keyup', this.up);
        window.addEventListener('blur', this.blur);
        window.addEventListener('mousemove', this.move);
        window.addEventListener('mouseup', this.release);
        document.addEventListener('pointerlockchange', this.lockChanged);
        canvas.addEventListener('mousedown', this.pointer);
        canvas.addEventListener('contextmenu', this.menu);
        canvas.addEventListener('touchstart', this.touchStart, { passive: false });
        window.addEventListener('touchmove', this.touchMove, { passive: false });
        window.addEventListener('touchend', this.touchEnd);
        window.addEventListener('touchcancel', this.touchEnd);
    }

    addLookDelta(dYaw: number, dPitch: number) {
        this.yaw += dYaw;
        this.pitch = Math.max(-1.25, Math.min(1.2, this.pitch - dPitch));
    }

    /** Trigger a one-shot action token (`KeyF`, `KeyQ`, `AttackLight`, `AttackHeavy`, `FireballRelease`, etc.). */
    trigger(code: string) {
        this.pressed.add(code);
    }

    /** Hold or release a continuous virtual key (`Space`, `ControlLeft`, `ShiftLeft`, `KeyE`). */
    setHeld(code: string, active: boolean) {
        if (active) {
            if (!this.keys.has(code)) this.pressed.add(code);
            this.keys.add(code);
        } else if (this.keys.delete(code) && code === 'KeyE') {
            this.pressed.add('FireballRelease');
        }
    }

    take(k: string) {
        const p = this.pressed.has(k);
        this.pressed.delete(k);
        return p;
    }

    has(k: string) {
        return this.keys.has(k);
    }

    get cursorFree() {
        return this.has('AltLeft') || this.has('AltRight');
    }

    clear() {
        this.blur();
    }

    dispose() {
        window.removeEventListener('keydown', this.down);
        window.removeEventListener('keyup', this.up);
        window.removeEventListener('blur', this.blur);
        window.removeEventListener('mousemove', this.move);
        window.removeEventListener('mouseup', this.release);
        document.removeEventListener('pointerlockchange', this.lockChanged);
        this.canvas.removeEventListener('mousedown', this.pointer);
        this.canvas.removeEventListener('contextmenu', this.menu);
        this.canvas.removeEventListener('touchstart', this.touchStart);
        window.removeEventListener('touchmove', this.touchMove);
        window.removeEventListener('touchend', this.touchEnd);
        window.removeEventListener('touchcancel', this.touchEnd);
    }
}
