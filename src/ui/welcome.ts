const screen = document.querySelector<HTMLElement>('#welcome')!;
const button = screen.querySelector<HTMLButtonElement>('#start')!;
const loading = screen.querySelector<HTMLElement>('.welcome-loading')!;
const progress = screen.querySelector<HTMLProgressElement>('#welcome-progress')!;
const status = screen.querySelector<HTMLElement>('#welcome-status')!;
const percent = screen.querySelector<HTMLElement>('#welcome-percent')!;

function syncProgress(ratio: number) {
    const clamped = Math.max(0, Math.min(1, ratio));
    const percentage = `${Math.round(clamped * 100)}%`;
    percent.textContent = percentage;
    screen.style.setProperty('--welcome-progress', percentage);
    screen.style.setProperty('--welcome-ratio', clamped.toFixed(4));
    screen.style.setProperty('--welcome-tip-x', `${(35 + clamped * 688).toFixed(1)}px`);
    screen.style.setProperty('--welcome-tip-opacity', clamped > 0.01 ? '1' : '0');
}

export const welcome = {
    get visible() {
        return !screen.hidden;
    },
    bind(onStart: () => void) {
        button.onclick = () => {
            onStart();
        };
    },
    hide() {
        screen.hidden = true;
    },
    setStatus(message: string) {
        if (screen.dataset.state === 'loading') status.textContent = message;
    },
    advance(message?: string) {
        if (screen.dataset.state !== 'loading') return;
        progress.value = Math.min(progress.max, progress.value + 1);
        syncProgress(progress.position);
        if (message) status.textContent = message;
    },
    ready() {
        if (screen.dataset.state !== 'loading') return;
        progress.value = progress.max;
        syncProgress(1);
        status.textContent = '加载完成';
        screen.dataset.state = 'finishing';
        window.setTimeout(() => {
            if (screen.dataset.state !== 'finishing') return;
            loading.hidden = true;
            screen.dataset.state = 'ready';
            button.disabled = false;
            button.hidden = false;
        }, 360);
    },
    fail(message: string) {
        screen.dataset.state = 'error';
        status.textContent = message;
        button.disabled = true;
    },
};
