const STYLE_ID = 'boss-health-bar-style';

function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.boss-hp-wrap {
    position: fixed;
    top: 22px;
    left: 50%;
    transform: translateX(-50%) translateY(-14px);
    width: min(560px, 76vw);
    pointer-events: none;
    z-index: 32;
    opacity: 0;
    transition: opacity 0.35s ease, transform 0.35s ease;
    font-family: "Microsoft YaHei", "PingFang SC", serif;
}
.boss-hp-wrap.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
.boss-hp-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
    padding: 0 4px;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.92), 0 0 14px rgba(180, 20, 28, 0.55);
}
.boss-hp-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f9ead8;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
}
.boss-hp-realm {
    font-size: 12px;
    font-weight: 700;
    color: #ff9a76;
    background: linear-gradient(90deg, rgba(135, 12, 22, 0.82), rgba(70, 8, 18, 0.88));
    border: 1px solid rgba(255, 118, 86, 0.58);
    padding: 1px 7px;
    border-radius: 3px;
    letter-spacing: 1px;
}
.boss-hp-nums {
    font-size: 12px;
    color: rgba(255, 226, 204, 0.92);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.5px;
}
.boss-hp-track {
    position: relative;
    height: 13px;
    border-radius: 3px;
    background: linear-gradient(180deg, rgba(18, 8, 12, 0.92), rgba(34, 12, 16, 0.88));
    border: 1px solid rgba(226, 178, 116, 0.62);
    box-shadow:
        0 4px 18px rgba(0, 0, 0, 0.72),
        inset 0 1px 4px rgba(0, 0, 0, 0.85),
        0 0 16px rgba(185, 24, 30, 0.28);
    overflow: hidden;
}
.boss-hp-trail {
    position: absolute;
    inset: 0;
    width: 100%;
    background: linear-gradient(90deg, #ffbe66, #ff6b44);
    transform-origin: left center;
    transition: width 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}
.boss-hp-fill {
    position: absolute;
    inset: 0;
    width: 100%;
    background: linear-gradient(90deg, #7e0c18 0%, #c91826 48%, #f03b2e 82%, #ff7a48 100%);
    box-shadow: inset 0 1px 2px rgba(255, 215, 190, 0.45);
    transition: width 0.12s ease-out;
}
.boss-hp-wrap.hit .boss-hp-track {
    box-shadow:
        0 4px 20px rgba(0, 0, 0, 0.72),
        0 0 22px rgba(255, 125, 65, 0.75);
}
`;
    document.head.appendChild(style);
}

export class BossHealthBar {
    private readonly root: HTMLDivElement;
    private readonly nameEl: HTMLSpanElement;
    private readonly realmEl: HTMLSpanElement;
    private readonly numsEl: HTMLSpanElement;
    private readonly trailEl: HTMLDivElement;
    private readonly fillEl: HTMLDivElement;
    private lastHp = -1;
    private hitFlashTimer = 0;

    constructor() {
        ensureStyles();
        this.root = document.createElement('div');
        this.root.className = 'boss-hp-wrap';
        this.root.innerHTML = `
            <div class="boss-hp-header">
                <div class="boss-hp-title">
                    <span class="boss-hp-name">潜龙晶渊 · 蚀渊古龙</span>
                    <span class="boss-hp-realm">元婴后期</span>
                </div>
                <span class="boss-hp-nums">18000 / 18000</span>
            </div>
            <div class="boss-hp-track">
                <div class="boss-hp-trail"></div>
                <div class="boss-hp-fill"></div>
            </div>
        `;
        this.nameEl = this.root.querySelector('.boss-hp-name') as HTMLSpanElement;
        this.realmEl = this.root.querySelector('.boss-hp-realm') as HTMLSpanElement;
        this.numsEl = this.root.querySelector('.boss-hp-nums') as HTMLSpanElement;
        this.trailEl = this.root.querySelector('.boss-hp-trail') as HTMLDivElement;
        this.fillEl = this.root.querySelector('.boss-hp-fill') as HTMLDivElement;
        document.body.appendChild(this.root);
    }

    update(dt: number, state: { visible: boolean; name: string; realm: string; hp: number; maxHp: number }) {
        if (!state.visible) {
            this.root.classList.remove('visible');
            return;
        }
        this.root.classList.add('visible');
        this.nameEl.textContent = state.name;
        this.realmEl.textContent = state.realm;
        const pct = Math.max(0, Math.min(100, (state.hp / Math.max(1, state.maxHp)) * 100));
        this.fillEl.style.width = `${pct.toFixed(2)}%`;
        this.trailEl.style.width = `${pct.toFixed(2)}%`;
        this.numsEl.textContent = `${Math.ceil(state.hp).toLocaleString()} / ${Math.ceil(state.maxHp).toLocaleString()}`;

        if (this.lastHp >= 0 && state.hp < this.lastHp) {
            this.hitFlashTimer = 0.24;
        }
        this.lastHp = state.hp;

        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
            this.root.classList.add('hit');
        } else {
            this.root.classList.remove('hit');
        }
    }

    dispose() {
        this.root.remove();
    }
}
