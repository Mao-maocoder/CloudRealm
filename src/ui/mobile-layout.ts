import { detectDevice } from '../config/device';

const device = detectDevice();
const app = document.querySelector<HTMLElement>('#app')!;
const welcome = document.querySelector<HTMLElement>('#welcome')!;
const hint = document.querySelector<HTMLElement>('#mobile-rotate')!;
const copyEl = document.querySelector<HTMLElement>('#mobile-rotate-copy');
const lockBtn = document.querySelector<HTMLButtonElement>('#mobile-rotate-lock');
const dismissBtn = document.querySelector<HTMLButtonElement>('#mobile-rotate-dismiss');

let dismissed = false;
let mobileActive = device.isMobile;

function isPortraitViewport(): boolean {
    if (typeof window === 'undefined') return false;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    return vh > vw * 1.02;
}

/**
 * Best-effort fullscreen + landscape orientation lock (works on Android Chrome / Edge / Quark / Firefox).
 * On iOS Safari or browsers without orientation.lock support, falls back gracefully to a gentle rotation tip.
 */
async function requestLandscapeFullscreen(showFallbackHint = false): Promise<boolean> {
    const docEl = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
        if (!document.fullscreenElement) {
            if (typeof docEl.requestFullscreen === 'function') {
                await docEl.requestFullscreen();
            } else if (typeof docEl.webkitRequestFullscreen === 'function') {
                await docEl.webkitRequestFullscreen();
            }
        }
    } catch {
        // Ignore fullscreen rejection (e.g., iOS Safari or restricted WebView)
    }
    try {
        const ori = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
        if (ori && typeof ori.lock === 'function') {
            await ori.lock('landscape');
            sync();
            return true;
        }
    } catch {
        // Orientation lock unavailable or denied
    }
    if (showFallbackHint && copyEl && isPortraitViewport()) {
        copyEl.textContent = device.isIOS
            ? '请关闭控制中心竖屏锁定并横置手机，或直接竖屏游玩'
            : '当前浏览器不支持自动横屏，请横置手机或直接竖屏游玩';
    }
    sync();
    return false;
}

async function toggleFullscreenLandscape(): Promise<boolean> {
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
    if (document.fullscreenElement) {
        try {
            const ori = screen.orientation as ScreenOrientation & { unlock?: () => void };
            ori?.unlock?.();
        } catch {}
        try {
            if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
            else if (typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
        } catch {}
        sync();
        return false;
    }
    return requestLandscapeFullscreen(true);
}

function sync() {
    const narrowTouch = (device.isTouch || mobileActive) && Math.min(window.innerWidth, window.innerHeight) <= 960;
    const isMobileNow = mobileActive || narrowTouch;
    const portrait = isPortraitViewport();
    const compactPortrait = portrait && window.innerWidth <= 820;

    document.documentElement.classList.toggle('mobile-layout', isMobileNow);
    document.documentElement.classList.toggle('mobile-portrait', isMobileNow && portrait);
    document.documentElement.classList.toggle('mobile-landscape', isMobileNow && !portrait);
    document.documentElement.classList.toggle('portrait-view', compactPortrait);

    // Non-blocking landscape recommendation bar on mobile portrait (user can dismiss and play in portrait!)
    if (!portrait) dismissed = false;
    hint.hidden = !(isMobileNow && portrait && !dismissed);

    // Never lock the user out of #app in portrait mode — only keep #app inert while the welcome screen is visible.
    app.inert = !welcome.hidden;
}

lockBtn?.addEventListener('click', () => {
    void requestLandscapeFullscreen(true);
});

dismissBtn?.addEventListener('click', () => {
    dismissed = true;
    hint.hidden = true;
});

window.addEventListener('resize', sync);
window.addEventListener('orientationchange', () => {
    sync();
    window.setTimeout(sync, 140);
});
window.visualViewport?.addEventListener('resize', sync);
if (!mobileActive) {
    window.addEventListener('touchstart', () => {
        if (Math.min(window.innerWidth, window.innerHeight) <= 960) {
            mobileActive = true;
            sync();
        }
    }, { passive: true, once: true });
}
sync();

export const mobileLayout = {
    get isMobile() { return mobileActive || document.documentElement.classList.contains('mobile-layout'); },
    get isPortrait() { return isPortraitViewport(); },
    /** Kept for backwards compatibility; portrait mode is now supported instead of hard-blocked. */
    get blocked() { return false; },
    sync,
    requestLandscapeFullscreen,
    toggleFullscreenLandscape,
};
