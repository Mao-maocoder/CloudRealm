/**
 * Device capability detection & adaptive dynamic-resolution controller.
 * Keeps hardware heuristics isolated from game logic and rendering subsystems.
 */
export interface DeviceProfile {
    readonly isMobile: boolean;
    readonly isTouch: boolean;
    readonly isIOS: boolean;
    readonly lowMemory: boolean;
    readonly maxTextureSizeCap: number;
}

let cachedProfile: DeviceProfile | undefined;

export function detectDevice(): DeviceProfile {
    if (cachedProfile) return cachedProfile;
    if (typeof navigator === 'undefined') {
        cachedProfile = { isMobile: false, isTouch: false, isIOS: false, lowMemory: false, maxTextureSizeCap: 4096 };
        return cachedProfile;
    }
    const navMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const lowMemory = navMem !== undefined && navMem <= 4;
    const maxTextureSizeCap = lowMemory ? 2048 : 4096;
    // Desktop-only build: never misclassify touchscreen laptops or high-DPI screens as mobile.
    cachedProfile = { isMobile: false, isTouch: false, isIOS: false, lowMemory, maxTextureSizeCap };
    return cachedProfile;
}

/**
 * Smooth hysteresis-based dynamic resolution scaler.
 * Lowers pixelRatio scale when sustained frame times exceed target budget
 * (e.g. during heavy VFX or thermal throttling on mobile) and recovers gradually.
 */
export class AdaptiveResolutionScaler {
    scale = 1;
    private emaMs = 16.6;
    private cooldown = 0;

    constructor(
        private readonly minScale = 0.62,
        private readonly stepDownThresholdMs = 18.8,
        private readonly stepUpThresholdMs = 13.0,
    ) {}

    reset() {
        this.scale = 1;
        this.emaMs = 16.6;
        this.cooldown = 0;
    }

    /** Returns true when `scale` changed enough to warrant `renderer.setPixelRatio(...)`. */
    sample(rawDtSeconds: number): boolean {
        const ms = Math.min(100, Math.max(4, rawDtSeconds * 1000));
        this.emaMs = this.emaMs * 0.88 + ms * 0.12;
        this.cooldown = Math.max(0, this.cooldown - rawDtSeconds);
        if (this.cooldown > 0) return false;

        if (this.emaMs > this.stepDownThresholdMs && this.scale > this.minScale + 0.01) {
            this.scale = Math.max(this.minScale, +(this.scale - 0.1).toFixed(2));
            this.cooldown = 0.85;
            return true;
        }
        if (this.emaMs < this.stepUpThresholdMs && this.scale < 0.99) {
            this.scale = Math.min(1, +(this.scale + 0.06).toFixed(2));
            this.cooldown = 1.6;
            return true;
        }
        return false;
    }
}
