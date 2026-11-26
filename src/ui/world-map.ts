import { heightAt } from '../world/geo/height';
import { waterLevelAt } from '../world/geo/relief';
import { mapBounds, regions, type Region } from '../world/geo/regions';
import { planHabitatCamps, species } from '../world/wildlife/wildlife-habitat';
import { peaklandWeight } from '../world/geo/peakland-plan';
import type { Vector3 } from 'three';
import type { SenseMapBlip } from '../world/wildlife/wildlife';
import { welcome } from './welcome';
import './world-map.css';

function hslToRgb(hDeg: number, sPct: number, lPct: number): [number, number, number] {
    const h = ((hDeg % 360) + 360) % 360 / 60;
    const s = sPct / 100;
    const l = Math.max(0, Math.min(1, lPct / 100));
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 1) { r = c; g = x; }
    else if (h < 2) { r = x; g = c; }
    else if (h < 3) { g = c; b = x; }
    else if (h < 4) { g = x; b = c; }
    else if (h < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export class WorldMap {
    readonly root = document.createElement('div');
    open = false;
    private readonly panel: HTMLElement;
    private readonly dot: HTMLElement;
    private readonly atlasCanvas: HTMLCanvasElement;
    private readonly atlasSenseCanvas: HTMLCanvasElement;
    private readonly atlasSenseCtx: CanvasRenderingContext2D | null;
    private minimapTarget?: HTMLCanvasElement;
    private minimapCtx?: CanvasRenderingContext2D | null;
    private lastX = 0;
    private lastZ = 0;

    private readonly key = (e: KeyboardEvent) => {
        if (!welcome.visible && e.code === 'KeyM' && !(e.target instanceof HTMLElement && e.target.matches('input,select,textarea'))) {
            e.preventDefault();
            if (!e.repeat) this.toggle();
        }
        if (e.code === 'Escape' && this.open) this.toggle(false);
    };

    constructor(
        private readonly onTravel: (r: Region) => void,
        private readonly onOpen: () => void,
        private readonly surface = heightAt,
    ) {
        this.root.className = 'world-map';
        this.root.innerHTML = `<div class="atlas hidden"><div class="atlas-head"><span>云境山河志<small>${regions.length} 处行旅地 · ${((mapBounds.right - mapBounds.left) / 1000).toFixed(1)} × ${((mapBounds.south - mapBounds.north) / 1000).toFixed(1)} km</small></span><button class="atlas-close" aria-label="关闭地图">×</button></div><div class="atlas-content"><div class="atlas-chart"><canvas class="atlas-base" width="480" height="320"></canvas><canvas class="atlas-sense" width="480" height="320" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas><span class="atlas-north">N<br>↑</span><span class="atlas-player" title="当前位置"></span></div><div class="atlas-list"><p>循水向北，踏雪入云</p>${regions.map((r, i) => `<button data-region="${r.id}"><small>0${i + 1}</small><span>${r.name}<em>${r.subtitle}</em></span><b>前往 ↗</b></button>`).join('')}<footer>点击地区可快速前往，也可沿河谷自由飞行。<br>按 M 收起 · 点击圆盘小地图亦可开启</footer></div></div></div>`;
        document.body.append(this.root);
        this.panel = this.root.querySelector('.atlas')!;
        this.dot = this.root.querySelector('.atlas-player')!;
        this.atlasCanvas = this.root.querySelector('canvas.atlas-base')!;
        this.atlasSenseCanvas = this.root.querySelector('canvas.atlas-sense')!;
        this.atlasSenseCtx = this.atlasSenseCanvas.getContext('2d');
        this.root.querySelector<HTMLButtonElement>('.atlas-close')!.onclick = () => this.toggle(false);
        this.root.querySelectorAll<HTMLButtonElement>('[data-region]').forEach(button => {
            button.onclick = () => {
                this.onTravel(regions.find(r => r.id === button.dataset.region)!);
                this.toggle(false);
                button.blur();
            };
        });
        window.addEventListener('keydown', this.key);
        this.paint();
    }

    toggle(open = !this.open) {
        this.open = open;
        this.panel.classList.toggle('hidden', !open);
        if (open) {
            if (document.pointerLockElement) document.exitPointerLock();
            this.syncPlayerDot(this.lastX, this.lastZ);
            this.onOpen();
        }
    }

    private syncPlayerDot(x: number, z: number) {
        const { left, right, north, south } = mapBounds;
        this.dot.style.left = Math.max(0, Math.min(100, (x - left) / (right - left) * 100)).toFixed(2) + '%';
        this.dot.style.top = Math.max(0, Math.min(100, (z - north) / (south - north) * 100)).toFixed(2) + '%';
    }

    private paint() {
        const canvas = this.atlasCanvas;
        const ctx = canvas.getContext('2d')!;
        const w = canvas.width, h = canvas.height;
        const { left, right, north, south } = mapBounds;
        const img = ctx.createImageData(w, h);
        const buf = img.data;

        for (let py = 0; py < h; py += 2) {
            const z = north + py / h * (south - north);
            const water = waterLevelAt(z);
            for (let px = 0; px < w; px += 2) {
                const x = left + px / w * (right - left);
                const elev = this.surface(x, z);
                let r = 68, g = 140, b = 155;
                if (peaklandWeight(x, z) > .4) {
                    [r, g, b] = hslToRgb(154, 20, Math.min(75, 32 + elev * .051));
                } else if (elev < water) {
                    r = 68; g = 140; b = 155;
                } else if (z < -1450 && elev > water + 90) {
                    [r, g, b] = hslToRgb(200, 23, Math.min(87, 55 + elev * .045));
                } else if (x < -360 && z < -100 && z > -1000) {
                    [r, g, b] = hslToRgb(40, 30, 40 + elev * .05);
                } else {
                    [r, g, b] = hslToRgb(122, 21, Math.max(24, 62 - elev * .035));
                }
                for (let dy = 0; dy < 2 && py + dy < h; dy++) {
                    const rowBase = ((py + dy) * w + px) * 4;
                    for (let dx = 0; dx < 2 && px + dx < w; dx++) {
                        const idx = rowBase + dx * 4;
                        buf[idx] = r;
                        buf[idx + 1] = g;
                        buf[idx + 2] = b;
                        buf[idx + 3] = 255;
                    }
                }
            }
        }
        ctx.putImageData(img, 0, 0);

        ctx.strokeStyle = '#efdfb580';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            ctx.beginPath();
            ctx.moveTo(i * w / 6, 0);
            ctx.lineTo(i * w / 6, h);
            ctx.stroke();
        }
        for (let i = 0; i <= 4; i++) {
            ctx.beginPath();
            ctx.moveTo(0, i * h / 4);
            ctx.lineTo(w, i * h / 4);
            ctx.stroke();
        }

        const camps = planHabitatCamps();
        for (const { habitat, center } of camps) {
            const x = (center.x - left) / (right - left) * w;
            const y = (center.z - north) / (south - north) * h;
            ctx.beginPath();
            ctx.arc(x, y, habitat.species === 'crystal-boar' ? 3.1 : 2.1, 0, 2 * Math.PI);
            ctx.fillStyle = habitat.species === 'crystal-boar' ? '#ef937c' : '#fae6aa';
            ctx.strokeStyle = '#283b39';
            ctx.fill();
            ctx.stroke();
        }

        const footer = this.root.querySelector('.atlas-list footer')!;
        footer.insertAdjacentHTML('afterbegin', '<span class="atlas-wildlife-key">● 栖息地</span>　<span class="atlas-elite-key">● 精英领地</span><br>');
        const chart = this.root.querySelector('.atlas-chart')!;
        for (const r of regions) {
            const marker = document.createElement('button');
            marker.className = 'atlas-pin';
            marker.style.left = (r.x - left) / (right - left) * 100 + '%';
            marker.style.top = (r.z - north) / (south - north) * 100 + '%';
            marker.style.borderColor = r.color;
            marker.textContent = r.name;
            const wildlife = [...new Set(camps.filter(c => c.region === r.id).map(c => species[c.habitat.species].name))];
            const description = wildlife.length ? `${r.name} · ${wildlife.join('、')}` : r.subtitle;
            marker.title = description;
            this.root.querySelector<HTMLButtonElement>(`[data-region="${r.id}"]`)!.title = description;
            marker.onclick = () => { this.onTravel(r); this.toggle(false); marker.blur(); };
            chart.append(marker);
        }
    }

    update(
        position: Vector3,
        senseBlips?: readonly SenseMapBlip[],
        senseRing?: { x: number; z: number; radius: number; color: string },
    ) {
        this.lastX = position.x;
        this.lastZ = position.z;
        if (!this.open) return;
        this.syncPlayerDot(position.x, position.z);
        const ctx = this.atlasSenseCtx;
        if (!ctx) return;
        const w = this.atlasSenseCanvas.width, h = this.atlasSenseCanvas.height;
        ctx.clearRect(0, 0, w, h);
        const { left, right, north, south } = mapBounds;
        const spanX = right - left, spanZ = south - north;
        if (senseRing && senseRing.radius > 1) {
            const cx = (senseRing.x - left) / spanX * w;
            const cy = (senseRing.z - north) / spanZ * h;
            const rx = (senseRing.radius / spanX) * w;
            const ry = (senseRing.radius / spanZ) * h;
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.strokeStyle = senseRing.color;
            ctx.globalAlpha = 0.68;
            ctx.lineWidth = 1.6;
            ctx.setLineDash([5, 4]);
            ctx.stroke();
            ctx.fillStyle = senseRing.color;
            ctx.globalAlpha = 0.09;
            ctx.fill();
            ctx.restore();
        }
        if (senseBlips && senseBlips.length) {
            for (const b of senseBlips) {
                const bx = (b.x - left) / spanX * w;
                const by = (b.z - north) / spanZ * h;
                ctx.beginPath();
                ctx.arc(bx, by, b.threat === 'high' ? 3.8 : 2.7, 0, Math.PI * 2);
                ctx.fillStyle = b.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(8, 16, 20, 0.85)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    renderMinimap(
        target: HTMLCanvasElement,
        position: Vector3,
        zoom = 1,
        senseBlips?: readonly SenseMapBlip[],
        senseRing?: { x: number; z: number; radius: number; color: string; pulseRadius?: number },
    ) {
        if (this.minimapTarget !== target) {
            this.minimapTarget = target;
            this.minimapCtx = target.getContext('2d');
        }
        const ctx = this.minimapCtx;
        if (!ctx) return;
        const src = this.atlasCanvas;
        const { left, right, north, south } = mapBounds;
        const spanX = right - left, spanZ = south - north;
        const u = (position.x - left) / spanX * src.width;
        const v = (position.z - north) / spanZ * src.height;
        const span = Math.max(28, Math.min(140, 74 / Math.max(.5, zoom)));
        ctx.fillStyle = '#24525a';
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(src, u - span / 2, v - span / 2, span, span, 0, 0, target.width, target.height);

        const toMiniX = (wx: number) => (((wx - left) / spanX * src.width) - (u - span / 2)) / span * target.width;
        const toMiniY = (wz: number) => (((wz - north) / spanZ * src.height) - (v - span / 2)) / span * target.height;
        const scaleX = (src.width / spanX) / span * target.width;
        const scaleY = (src.height / spanZ) / span * target.height;

        if (senseRing && senseRing.radius > 1) {
            const cx = toMiniX(senseRing.x);
            const cy = toMiniY(senseRing.z);
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, senseRing.radius * scaleX, senseRing.radius * scaleY, 0, 0, Math.PI * 2);
            ctx.strokeStyle = senseRing.color;
            ctx.globalAlpha = 0.52;
            ctx.lineWidth = 1.25;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.fillStyle = senseRing.color;
            ctx.globalAlpha = 0.08;
            ctx.fill();
            if (senseRing.pulseRadius && senseRing.pulseRadius > 2) {
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.ellipse(cx, cy, senseRing.pulseRadius * scaleX, senseRing.pulseRadius * scaleY, 0, 0, Math.PI * 2);
                ctx.globalAlpha = 0.85;
                ctx.lineWidth = 1.8;
                ctx.stroke();
            }
            ctx.restore();
        }

        if (senseBlips && senseBlips.length) {
            for (const b of senseBlips) {
                const mx = toMiniX(b.x);
                const my = toMiniY(b.z);
                if (mx < -6 || mx > target.width + 6 || my < -6 || my > target.height + 6) continue;
                ctx.beginPath();
                ctx.arc(mx, my, b.threat === 'high' ? 3.5 : 2.5, 0, Math.PI * 2);
                ctx.fillStyle = b.color;
                ctx.fill();
                ctx.strokeStyle = 'rgba(6, 16, 20, 0.88)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }

    dispose() {
        window.removeEventListener('keydown', this.key);
        this.root.remove();
    }
}
