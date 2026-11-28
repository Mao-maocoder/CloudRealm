import { readArtStyle, writeArtStyle, type ArtStyle, type Quality } from '../config/settings';
import type { VitalsSnapshot } from '../player/vitals';
import { REALMS, SKILL_MANA_COST } from '../player/cultivation';
import type { SenseDangerIndicator, SenseMarkerProjection } from '../world/wildlife/wildlife';
import { welcome } from './welcome';
import locationTitleSvg from './assets/hud-svg/location-title.svg';
import compassSvg from './assets/hud-svg/compass.svg';
import toolbarButtonSvg from './assets/hud-svg/toolbar-button.svg';
import minimapFrameSvg from './assets/hud-svg/minimap-frame.svg';
import characterPanelFrameSvg from './assets/hud-svg/character-panel-frame.svg';
import avatarFrameSvg from './assets/hud-svg/avatar-frame.svg';
import controlsPanelFrameSvg from './assets/hud-svg/controls-panel-frame.svg';
import skillSlotFrameSvg from './assets/hud-svg/skill-slot-frame.svg';
import cloudEdgeRightSvg from './assets/hud-svg/cloud-edge-right.svg';
import iconFireballImg from './assets/skills/fireball.jpg';
import iconSwordRainImg from './assets/skills/sword-rain.jpg';
import iconGiantSwordImg from './assets/skills/giant-sword.jpg';
import iconHealthPotionImg from './assets/skills/health-potion.jpg';
import iconFoundationPillImg from './assets/skills/foundation-pill.jpg';

const ICON_PRESSURE_URI = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><radialGradient id="g" cx="50%" cy="46%" r="54%"><stop offset="0%" stop-color="#fff4c4"/><stop offset="35%" stop-color="#5ce4ff"/><stop offset="75%" stop-color="#174c78"/><stop offset="100%" stop-color="#071324"/></radialGradient></defs><rect width="96" height="96" fill="url(#g)"/><g fill="none" stroke-linecap="round"><circle cx="48" cy="48" r="34" stroke="#8ff0ff" stroke-width="2.6" stroke-dasharray="10 6" opacity=".88"/><ellipse cx="48" cy="60" rx="28" ry="11" stroke="#ffe596" stroke-width="2.8"/><ellipse cx="48" cy="46" rx="21" ry="8" stroke="#9cf4ff" stroke-width="2" opacity=".82"/><path d="M48 16v38M34 22v28M62 22v28M24 30v18M72 30v18" stroke="#e2fbff" stroke-width="2.4" opacity=".92"/><path d="M40 46l8 10 8-10" stroke="#ffe596" stroke-width="3.2" stroke-linejoin="round"/></g></svg>`)}`;

export interface SkillSlotConfig {
    id: string;
    label: string;
    key: string;
    icon: string;
    kind: 'skill' | 'item';
    cost?: number;
    count?: number;
    title?: string;
    onClick?: () => void;
    onHoldChange?: (held: boolean) => void;
}

const SKILL_CLOUD_LEFT_SVG = `<svg class="skill-ornament cloud-left" viewBox="0 0 140 66" fill="none" aria-hidden="true"><defs><linearGradient id="sbCloudL" x1="0" y1=".9" x2="1" y2=".2"><stop stop-color="#A98747"/><stop offset=".39" stop-color="#F7E2A1"/><stop offset="1" stop-color="#BD9A53"/></linearGradient></defs><path d="M1 18C14 15 27 13 42 24c12 9 26 27 58 31-21 2-36-1-51-10-13-8-22-23-40-26z" fill="url(#sbCloudL)"/><path d="M30 15c10-11 25-13 33-6 4 4 2 10-3 11 4-7-4-13-12-10-7 2-6 8-4 11-6-3-6-8-3-11M59 15c6-4 12-2 16 2 6 5 9 9 18 9-9 2-15-1-21-5-4-3-8-4-13-3M39 28c8 0 15 5 22 9 7 4 11 6 20 5-11 4-20-1-28-6-5-3-10-6-15-5" fill="url(#sbCloudL)"/><path d="M54 48c9 10 28 14 50 8 11-3 22-4 34-2-13 0-23 2-35 6-22 5-38 2-49-12Z" fill="url(#sbCloudL)" opacity=".82"/><path d="M73 46c-4 2-8 2-13-1m12 12c15 3 25 0 40-2" stroke="#FFF1BD" stroke-opacity=".85" stroke-width=".7" fill="none"/></svg>`;

const SKILL_CREST_SVG = (pos: 'top' | 'bottom') => `<svg class="skill-ornament crest-${pos}" viewBox="0 0 128 24" fill="none" aria-hidden="true"><defs><linearGradient id="sbCrest-${pos}"><stop stop-color="#6CF4D7" stop-opacity="0"/><stop offset=".5" stop-color="#D2FFF6"/><stop offset="1" stop-color="#6CF4D7" stop-opacity="0"/></linearGradient></defs><path d="M0 12c30 0 37-3 50-3l14 2 14-2c13 0 20 3 50 3-30 0-37 3-50 3l-14-2-14 2C37 15 30 12 0 12Z" fill="url(#sbCrest-${pos})"/><path d="M64 3c2 5 4 7 9 9-5 2-7 4-9 9-2-5-4-7-9-9 5-2 7-4 9-9Z" fill="#BCFFEE"/><path d="M64 8l4 4-4 4-4-4z" fill="#127D76"/><path d="M64 10l2 2-2 2-2-2zM46 10l2 2-2 2-2-2zm36 0 2 2-2 2-2-2z" fill="#F3FFF5"/></svg>`;

const SKILL_DIVIDER_SVG = `<svg class="skill-divider-svg" viewBox="0 0 15 66" fill="none" aria-hidden="true"><defs><linearGradient id="sbDiv" x2="0" y2="1"><stop stop-color="#DCC88B" stop-opacity="0"/><stop offset=".5" stop-color="#DCC88B" stop-opacity=".68"/><stop offset="1" stop-color="#DCC88B" stop-opacity="0"/></linearGradient></defs><path d="M7.5 0v66M3 33l4.5-5 4.5 5-4.5 5z" stroke="url(#sbDiv)" fill="none"/></svg>`;

const REALM_INK_FRAME_SVG = `<svg class="realm-ink-svg" viewBox="0 0 72 172" preserveAspectRatio="none" fill="none" aria-hidden="true">
  <defs>
    <filter id="inkBrushFilter" x="-15%" y="-8%" width="130%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.065 0.035" numOctaves="3" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <linearGradient id="inkWashFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1018" stop-opacity="0.84"/>
      <stop offset="50%" stop-color="#111924" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#090e15" stop-opacity="0.86"/>
    </linearGradient>
    <linearGradient id="inkGoldAccent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f3d899" stop-opacity="0.78"/>
      <stop offset="50%" stop-color="#d4b26a" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#f3d899" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <g filter="url(#inkBrushFilter)">
    <path d="M12 10 C28 6, 48 7, 61 11 C64 52, 63 118, 60 161 C44 166, 26 165, 11 160 C8 118, 9 52, 12 10 Z" fill="url(#inkWashFill)"/>
    <path d="M11 10 C30 5, 50 7, 62 11 M61 9 C64 56, 63 116, 60 162 M61 161 C42 166, 24 165, 10 160 M11 161 C8 116, 9 52, 12 9" stroke="#06090e" stroke-width="4.2" stroke-linecap="round"/>
    <path d="M13 13 C32 9, 48 10, 59 13 M58 13 C60 56, 60 116, 58 158 M58 158 C42 162, 26 161, 13 157 M14 157 C12 115, 12 54, 14 13" stroke="url(#inkGoldAccent)" stroke-width="1.05" stroke-linecap="round"/>
    <path d="M7 22 C4 58, 5 112, 8 148 M65 26 C68 64, 67 118, 64 150" stroke="#0b1018" stroke-opacity="0.52" stroke-width="1.8" stroke-linecap="round"/>
  </g>
</svg>`;

export interface HudTelemetry {
    x: number;
    y: number;
    z: number;
    heading: number;
    regionName: string;
    regionSub: string;
    flying: boolean;
    boosting: boolean;
    sprinting: boolean;
    casting: boolean;
    fireball: boolean;
    giantSword?: boolean;
    swordDrawn: boolean;
    spirit: number;
    stamina: number;
    hours?: number;
    timeLabel?: string;
}

const PORTRAIT_SVG = `<svg viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="pBg" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#35686b"/>
      <stop offset="65%" stop-color="#193b42"/>
      <stop offset="100%" stop-color="#0d2228"/>
    </radialGradient>
    <linearGradient id="pHair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4e372c"/>
      <stop offset="100%" stop-color="#2b1c17"/>
    </linearGradient>
    <linearGradient id="pRobe" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e9ecd9"/>
      <stop offset="55%" stop-color="#b4c8bc"/>
      <stop offset="100%" stop-color="#2a575b"/>
    </linearGradient>
    <linearGradient id="pGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fae4a6"/>
      <stop offset="100%" stop-color="#b98f46"/>
    </linearGradient>
  </defs>
  <circle cx="44" cy="44" r="44" fill="url(#pBg)"/>
  <ellipse cx="44" cy="18" rx="9" ry="7.5" fill="url(#pHair)"/>
  <path d="M35 20 Q44 16 53 20" stroke="url(#pGold)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M51 16 L60 11" stroke="#f5d98e" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="60.5" cy="10.8" r="1.8" fill="#8ef0d8"/>
  <path d="M24 44 C22 58 21 72 25 84 L63 84 C67 72 66 58 64 44 C62 28 56 21 44 21 C32 21 26 28 24 44 Z" fill="url(#pHair)"/>
  <path d="M16 86 C20 68 30 62 44 62 C58 62 68 68 72 86 Z" fill="url(#pRobe)"/>
  <path d="M32 64 L44 77 L56 64" fill="none" stroke="#1f494f" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M34 64 L44 75 L54 64" fill="none" stroke="url(#pGold)" stroke-width="1.2"/>
  <rect x="39" y="54" width="10" height="12" rx="4" fill="#f2cbb4"/>
  <path d="M30 40 C30 53 36 60 44 60 C52 60 58 53 58 40 C58 29 52 24 44 24 C36 24 30 29 30 40 Z" fill="#fae0ce"/>
  <path d="M29 38 C31 27 38 22 44 22 C50 22 57 27 59 38 C56 32 52 29 48 30 C46 34 45 36 44 37 C43 34 41 30 38 29 C34 30 31 33 29 38 Z" fill="url(#pHair)"/>
  <path d="M28 40 C27 49 28 56 31 61" stroke="#3c2820" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M60 40 C61 49 60 56 57 61" stroke="#3c2820" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <ellipse cx="38" cy="43" rx="2.6" ry="2.2" fill="#2d201c"/>
  <ellipse cx="50" cy="43" rx="2.6" ry="2.2" fill="#2d201c"/>
  <circle cx="37.2" cy="42.2" r=".85" fill="#fff"/>
  <circle cx="49.2" cy="42.2" r=".85" fill="#fff"/>
  <path d="M34 38.5 Q38 37.2 41.5 38.5" stroke="#3b261e" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  <path d="M46.5 38.5 Q50 37.2 54 38.5" stroke="#3b261e" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  <path d="M41.2 52.2 Q44 54.2 46.8 52.2" stroke="#b96d5c" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  <ellipse cx="34.5" cy="47.5" rx="2.6" ry="1.3" fill="#e98e82" opacity=".32"/>
  <ellipse cx="53.5" cy="47.5" rx="2.6" ry="1.3" fill="#e98e82" opacity=".32"/>
</svg>`;

export class HUD {
    readonly root = document.createElement('div');
    readonly speed: HTMLElement;
    readonly altitude: HTMLElement;
    readonly mode: HTMLElement;
    readonly debug: HTMLElement;
    readonly compass: HTMLElement;
    readonly minimapCanvas: HTMLCanvasElement;
    private readonly minimapArrow: HTMLElement;
    private readonly compassTrack: HTMLElement;
    private readonly coordsEl: HTMLElement;
    private readonly clockEl: HTMLElement;
    private readonly timeSlider: HTMLInputElement;
    private readonly timeReadout: HTMLElement;
    private readonly regionNameEl: HTMLElement;
    private readonly regionSubEl: HTMLElement;
    private readonly hpFill: HTMLElement;
    private readonly hpText: HTMLElement;
    private readonly mpFill: HTMLElement;
    private readonly mpText: HTMLElement;
    private readonly spFill: HTMLElement;
    private readonly spText: HTMLElement;
    private readonly realmEl: HTMLElement;
    private readonly statAtkEl: HTMLElement;
    private readonly statDefEl: HTMLElement;
    private readonly statCritEl: HTMLElement;
    private readonly statPowerEl: HTMLElement;
    private readonly xpFill: HTMLElement;
    private readonly xpText: HTMLElement;
    private readonly breakthroughBtn: HTMLButtonElement;
    private readonly realmSelect: HTMLSelectElement;
    private readonly realmQuickBtns = new Map<number, HTMLButtonElement>();
    private readonly damageScaleEl: HTMLElement;
    private readonly testBarBody: HTMLElement;
    private readonly skillRow: HTMLElement;
    private readonly controlsPopover: HTMLElement;
    private readonly controlsToggleBtn: HTMLElement;
    private readonly hintEl: HTMLElement;
    private readonly crosshairEl: HTMLElement;
    private readonly rollInput: HTMLInputElement;
    private readonly skillSlotEls = new Map<string, HTMLElement>();
    private readonly skillLockEls = new Map<string, HTMLElement>();
    private readonly itemQtyEls = new Map<string, HTMLElement>();
    private readonly slots: SkillSlotConfig[];
    private readonly combatNotice = document.createElement('div');
    private onUseItem?: (kind: 'heal' | 'pill') => void;
    private onToggleMap?: () => void;
    private onFireballHold?: (held: boolean) => void;
    private onSwordArray?: () => void;
    private onGiantSword?: () => void;
    private onPressure?: () => void;
    private onBreakthrough?: () => void;
    private onSetRealm?: (realmIndex: number) => void;
    private onAdvanceTier?: () => void;
    private onFillXp?: () => void;
    private onToggleNight?: () => void;
    private onToggleOmen?: () => boolean;
    private onStartRitual?: () => void;
    private onSkipRitual?: () => void;
    private onTriggerSense?: () => void;
    private onToggleAstral?: () => void;
    private readonly cinemaRoot: HTMLElement;
    private readonly cinemaTitleWrap: HTMLElement;
    private readonly cinemaTitleEl: HTMLElement;
    private readonly cinemaSubEl: HTMLElement;
    private readonly realmInkEl: HTMLElement;
    private readonly realmInkTextEl: HTMLElement;
    private readonly senseMarkersLayer: HTMLElement;
    private readonly senseMarkerPool: {
        el: HTMLElement;
        glyph: HTMLElement;
        name: HTMLElement;
        dist: HTMLElement;
        hp: HTMLElement;
        tag: HTMLElement;
    }[] = [];
    private readonly astralOverlayEl: HTMLElement;
    private readonly astralDistEl: HTMLElement;
    private readonly senseDangerEl: HTMLElement;
    private readonly senseDangerArcEl: HTMLElement;
    private readonly senseQuickBtn: HTMLButtonElement;
    private readonly astralQuickBtn: HTMLButtonElement;
    private realmInkRemaining = 0;
    private realmInkDuration = 4.2;
    private onTimeChange?: (hours: number) => void;
    private onTimeAuto?: (auto: boolean) => void;
    private draggingTime = false;
    private lastCompassHeading = -999;
    private healCount = 5;
    private pillCount = 3;
    minimapZoom = 1;
    started = false;

    private readonly helpKey = (e: KeyboardEvent) => {
        if (e.code === 'KeyH' && !e.repeat && !(e.target instanceof HTMLElement && e.target.matches('input,select,textarea'))) {
            this.toggleControls();
        }
    };

    constructor(
        onStart: () => void,
        onQuality: (q: Quality) => void,
        onRoll: (v: boolean) => void,
        onDebug: (v: boolean) => void,
        q: Quality,
    ) {
        this.root.className = 'overlay';
        this.root.innerHTML = `
<div class="vignette"></div>

<header class="top-bar">
  <section class="char-card" id="char-card">
    <div class="char-panel-stage" id="char-panel-stage" title="点击收起 / 展开属性面板">
      <img class="char-frame-svg" src="${characterPanelFrameSvg}" alt="" aria-hidden="true"/>
      <div class="char-portrait-clip">${PORTRAIT_SVG}</div>
      <img class="char-avatar-ring-svg" src="${avatarFrameSvg}" alt="" aria-hidden="true"/>

      <div class="char-head-overlay">
        <div class="char-title-row">
          <strong class="char-name">云游者</strong>
          <span class="char-lv" id="char-realm">炼气一层</span>
        </div>
        <div class="char-class">
          <span class="class-badge">剑</span>
          <b>剑修</b>
          <em>Sword Cultivator</em>
        </div>
      </div>

      <div class="char-bar-layer bar-hp">
        <label>生命</label>
        <span class="bar-val" id="hp-text">260 / 260</span>
        <div class="bar-fill-wrap"><div class="bar-fill hp" id="hp-fill" style="width:100%"></div></div>
      </div>
      <div class="char-bar-layer bar-mp">
        <label>灵力</label>
        <span class="bar-val" id="mp-text">160 / 160</span>
        <div class="bar-fill-wrap"><div class="bar-fill mp" id="mp-fill" style="width:100%"></div></div>
      </div>
      <div class="char-bar-layer bar-sp">
        <label>体力</label>
        <span class="bar-val" id="sp-text">100 / 100</span>
        <div class="bar-fill-wrap"><div class="bar-fill sp" id="sp-fill" style="width:100%"></div></div>
      </div>

      <div class="char-stats-overlay">
        <div class="stat-col"><span>⚔ 攻击</span><b id="stat-atk">38</b></div>
        <div class="stat-col"><span>🛡 防御</span><b id="stat-def">24</b></div>
        <div class="stat-col"><span>✦ 暴击</span><b id="stat-crit">8.0%</b></div>
        <div class="stat-col power"><span>🔥 战力</span><b id="stat-power">637</b></div>
      </div>
    </div>
    <div class="cultivation-strip" id="cultivation-strip">
      <div class="xp-row">
        <span class="xp-label">修为</span>
        <div class="xp-track"><div class="xp-fill" id="xp-fill" style="width:0%"></div></div>
        <em class="xp-val" id="xp-text">0 / 45</em>
      </div>
      <button type="button" class="breakthrough-btn hidden" id="breakthrough-btn">✦ 破境 · 筑基 (B)</button>
    </div>
    <div class="telemetry-mini">
      <span id="mode">步行 · 循溪而行</span>
      <span class="tele-sep">·</span>
      <span><b id="speed">0</b> km/h</span>
      <span class="tele-sep">·</span>
      <span>海拔 <b id="altitude">0</b> m</span>
    </div>
    <div class="realm-test-bar" id="realm-test-bar">
      <div class="realm-test-head">
        <button type="button" class="realm-test-toggle" id="realm-test-toggle" title="折叠 / 展开修行测试按钮">测试 · 一键切境 ▾</button>
        <span class="realm-dmg-badge" id="realm-dmg-scale" title="技能伤害随境界提升倍率">威力 ×1.00</span>
      </div>
      <div class="realm-test-body" id="realm-test-body">
        <div class="realm-test-grid">
          ${REALMS.map((r, idx) => `<button type="button" class="realm-quick-btn" data-realm="${idx}" style="--realm-col:${r.color}">${r.name}</button>`).join('')}
        </div>
        <div class="realm-test-sub">
          <button type="button" id="quick-advance-btn" title="一键提升一个小境界或破境">＋升一阶</button>
          <button type="button" id="quick-night-btn" title="切换至月夜 (22:30)，夜间妖兽刷新率与高阶率大幅提升">☾ 月夜</button>
          <button type="button" id="quick-omen-btn" title="一键召唤 / 散去天地异象（元婴天兆）">✦ 异象</button>
          <button type="button" id="quick-ritual-btn" title="一键演练「碎丹凝婴」元婴破境大典全流程">✦ 结婴</button>
        </div>
        <div class="realm-test-sub sense-test-row">
          <button type="button" id="quick-sense-btn" title="释放神识探查脉冲 (Z) · 洞悉妖兽品阶、震慑低阶妖兽并延长锁敌">◎ 神识 (Z)</button>
          <button type="button" id="quick-astral-btn" title="神识离体漫游 (G) · 结丹期解锁，本体打坐，神念巡游山谷">✧ 离体 (G)</button>
        </div>
      </div>
    </div>
  </section>

  <div class="compass-bar">
    <img class="compass-frame-svg" src="${compassSvg}" alt="" aria-hidden="true"/>
    <div class="compass-tape-viewport">
      <div class="compass-tape-track" id="compass-track"></div>
    </div>
    <div class="compass-readout">
      <b id="heading">北 · 000°</b>
      <span class="compass-coords"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2a4 4 0 0 0-4 4c0 3 4 7.6 4 7.6s4-4.6 4-7.6a4 4 0 0 0-4-4zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor"/></svg><em id="coords">(0, 0)</em></span>
      <span class="compass-clock" id="hud-clock">巳时 · 10:00</span>
    </div>
  </div>

  <div class="top-right-cluster">
    <div class="utility-btns">
      <button class="util-btn" id="fullscreen-btn" title="切换全屏模式" aria-label="切换全屏模式">
        <img class="util-btn-bg" src="${toolbarButtonSvg}" alt="" aria-hidden="true"/>
        <svg class="util-btn-ico" viewBox="0 0 24 24"><path d="M4 9V4h5v2H6v3H4zm14-3h-3V4h5v5h-2V6zM6 15v3h3v2H4v-5h2zm12 3v-3h2v5h-5v-2h3z" fill="currentColor"/></svg>
      </button>
      <button class="util-btn" id="audio-toggle" title="切换背景音乐与音效" aria-label="切换背景音乐与音效">
        <img class="util-btn-bg" src="${toolbarButtonSvg}" alt="" aria-hidden="true"/>
        <svg class="util-btn-ico" id="audio-toggle-ico" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg>
      </button>
      <button class="util-btn" id="settings" title="画质与设置" aria-label="画质与设置">
        <img class="util-btn-bg" src="${toolbarButtonSvg}" alt="" aria-hidden="true"/>
        <svg class="util-btn-ico" viewBox="0 0 24 24"><path d="M19.4 13a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2-1.5-1.9-3.3-2.3.9a7.4 7.4 0 0 0-1.7-1L15.1 3h-3.8l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.3-.9L5 8.9 7 10.4a7.7 7.7 0 0 0-.1 1c0 .3 0 .7.1 1l-2 1.5 1.9 3.3 2.3-.9c.5.4 1.1.8 1.7 1l.4 2.5h3.8l.4-2.5c.6-.2 1.2-.6 1.7-1l2.3.9 1.9-3.3-2-1.5zM13.2 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/></svg>
      </button>
    </div>

    <div class="minimap-shell" id="minimap-shell" title="点击打开山河舆图 (M)">
      <div class="minimap-clip">
        <canvas id="minimap-canvas" width="144" height="144"></canvas>
        <div class="minimap-arrow" id="minimap-arrow"></div>
      </div>
      <img class="minimap-frame-svg" src="${minimapFrameSvg}" alt="" aria-hidden="true"/>
      <button type="button" class="minimap-zoom-btn zoom-in" id="minimap-in" aria-label="放大">+</button>
      <button type="button" class="minimap-zoom-btn zoom-out" id="minimap-out" aria-label="缩小">−</button>
    </div>
  </div>
</header>

<div class="hint hidden" id="hint">点击画面捕获鼠标 · Alt / Esc 释放 · 贴地飞行会扰动草叶与水面</div>
<div class="crosshair hidden" id="crosshair"></div>

<section class="panel hidden" id="panel">
  <h2>旅途设置</h2>
  <label>画质<select id="quality"><option value="low">轻盈 · 低</option><option value="medium">均衡 · 中</option><option value="high">清晰 · 高</option></select></label>
  <label>画风<select id="art-style"><option value="anime">青翠国漫（默认）</option><option value="guofeng">国风厚涂（全图）</option></select></label>
  <label>昼夜流转<input id="day-auto" type="checkbox" checked/></label>
  <div class="time-control">
    <div class="time-row"><span>当前时辰</span><b id="time-readout">巳时 · 10:00</b></div>
    <input id="time-slider" type="range" min="0" max="24" step="0.1" value="10"/>
    <div class="time-presets">
      <button type="button" data-hour="6.25">晨曦</button>
      <button type="button" data-hour="12">正午</button>
      <button type="button" data-hour="17.75">晚霞</button>
      <button type="button" data-hour="22.5">月夜</button>
    </div>
  </div>
  <div class="time-control">
    <div class="time-row"><span>修行境界</span><b>测试切换</b></div>
    <select id="realm-select" class="realm-select">
      ${REALMS.map((r, idx) => `<option value="${idx}">${r.name}${r.stages[0]} · 灵力 ${r.baseMp}</option>`).join('')}
    </select>
    <div class="cult-actions">
      <button type="button" id="fill-xp-btn">修为圆满</button>
      <button type="button" id="panel-break-btn">立刻破境</button>
    </div>
  </div>
  <label>镜头侧倾<input id="roll" type="checkbox" checked/></label>
  <label>性能监控<input id="monitor" type="checkbox"/></label>
  <label>地形网格 / LOD<input id="wire" type="checkbox"/></label>
  <p>低档降低渲染分辨率、植被、阴影与可视距离。切换画风将作用于全图并需重启页面生效。侧倾可关闭以减少眩晕。</p>
</section>

<div class="style-modal-backdrop hidden" id="style-restart-modal" role="dialog" aria-modal="true" aria-labelledby="style-modal-title">
  <div class="style-modal-card">
    <h3 id="style-modal-title">切换画风需要重启页面</h3>
    <p id="style-modal-desc">即将切换画风。为避免实时重建着色器与材质导致设备卡顿，确认后将保存设置并重新加载页面。</p>
    <div class="style-modal-actions">
      <button type="button" class="style-btn-cancel" id="style-modal-cancel">暂不切换</button>
      <button type="button" class="style-btn-confirm" id="style-modal-confirm">保存并重启</button>
    </div>
  </div>
</div>

<div class="debug hidden" id="debug"></div>

<div class="breakthrough-cinema" id="breakthrough-cinema" aria-live="polite">
  <div class="cinema-bar top"></div>
  <div class="cinema-bar bottom"></div>
  <div class="cinema-title-wrap" id="cinema-title-wrap" style="opacity:0">
    <strong id="cinema-title"></strong>
    <div class="cinema-title-rule"></div>
    <span id="cinema-sub"></span>
  </div>
  <button type="button" class="cinema-skip-btn" id="cinema-skip-btn">Esc 跳过演出</button>
</div>

<div class="realm-ink-badge" id="realm-ink-badge" aria-live="polite">
  ${REALM_INK_FRAME_SVG}
  <div class="realm-ink-body">
    <span class="realm-ink-text" id="realm-ink-text">炼气一层</span>
    <em class="realm-ink-seal" aria-hidden="true">境</em>
  </div>
</div>

<div class="sense-markers-layer" id="sense-markers-layer" aria-hidden="true"></div>

<div class="astral-overlay" id="astral-overlay" aria-live="polite">
  <div class="astral-vignette"></div>
  <div class="astral-banner">
    <span class="astral-seal">识</span>
    <div class="astral-banner-text">
      <strong>神识离体 · 巡游山河</strong>
      <small id="astral-dist">距本体 0 / 350 m · WASD 飞掠 · 按 G / Esc 归位</small>
    </div>
  </div>
</div>

<div class="sense-danger-ring" id="sense-danger-ring" aria-hidden="true">
  <div class="sense-danger-arc" id="sense-danger-arc"></div>
</div>

<footer class="bottom-hud">
  <div class="brand-block">
    <img class="brand-frame-svg" src="${locationTitleSvg}" alt="" aria-hidden="true"/>
    <div class="brand-logo">
      <strong>云境</strong>
      <small>Y U N J I N G</small>
    </div>
    <div class="brand-region">
      <span id="region-name">长风谷</span>
      <em id="region-sub">CHANGFENG VALLEY</em>
    </div>
  </div>

  <section class="skill-dock" aria-label="技能栏">
    <div class="skill-bar-dynamic">
      ${SKILL_CREST_SVG('top')}
      ${SKILL_CREST_SVG('bottom')}
      ${SKILL_CLOUD_LEFT_SVG}
      <img class="skill-ornament cloud-right" src="${cloudEdgeRightSvg}" alt="" aria-hidden="true"/>
      <div class="skill-slots-row" id="skill-slots-row"></div>
    </div>
  </section>

  <div class="controls-wrap">
    <section class="controls-card hidden" id="controls-popover">
      <img class="controls-frame-svg" src="${controlsPanelFrameSvg}" alt="" aria-hidden="true"/>
      <div class="controls-rows">
        <div class="ctrl-row"><span class="ctrl-label"><i class="ctrl-ico">◎</i>移动 / 加速</span><span class="ctrl-keys"><kbd>WASD</kbd><kbd>Shift</kbd></span></div>
        <div class="ctrl-row"><span class="ctrl-label"><i class="ctrl-ico">◉</i>挥砍 / 剑气</span><span class="ctrl-keys"><kbd class="wide">左键 / 长按</kbd></span></div>
        <div class="ctrl-row"><span class="ctrl-label"><i class="ctrl-ico">⇡</i>御剑 / 踏空</span><span class="ctrl-keys"><kbd>F</kbd><kbd>V</kbd></span></div>
        <div class="ctrl-row"><span class="ctrl-label"><i class="ctrl-ico">✦</i>神识 / 离体</span><span class="ctrl-keys"><kbd>Z</kbd><kbd>G</kbd></span></div>
        <div class="ctrl-row"><span class="ctrl-label"><i class="ctrl-ico">❖</i>破境 / 舆图</span><span class="ctrl-keys"><kbd>B</kbd><kbd>M</kbd></span></div>
      </div>
    </section>
    <button type="button" class="controls-toggle" id="controls-toggle" aria-expanded="false">
      <kbd>H</kbd><span>· 操作指南</span>
    </button>
  </div>
</footer>`;

        document.body.append(this.root);
        const el = <T extends HTMLElement>(id: string) => this.root.querySelector<T>('#' + id)!;
        this.speed = el('speed');
        this.altitude = el('altitude');
        this.mode = el('mode');
        this.debug = el('debug');
        this.compass = el('heading');
        this.minimapCanvas = el<HTMLCanvasElement>('minimap-canvas');
        this.minimapArrow = el('minimap-arrow');
        this.compassTrack = el('compass-track');
        this.coordsEl = el('coords');
        this.clockEl = el('hud-clock');
        this.timeSlider = el<HTMLInputElement>('time-slider');
        this.timeReadout = el('time-readout');
        this.buildCompassTape();
        this.regionNameEl = el('region-name');
        this.regionSubEl = el('region-sub');
        this.hpFill = el('hp-fill');
        this.hpText = el('hp-text');
        this.mpFill = el('mp-fill');
        this.mpText = el('mp-text');
        this.spFill = el('sp-fill');
        this.spText = el('sp-text');
        this.realmEl = el('char-realm');
        this.statAtkEl = el('stat-atk');
        this.statDefEl = el('stat-def');
        this.statCritEl = el('stat-crit');
        this.statPowerEl = el('stat-power');
        this.xpFill = el('xp-fill');
        this.xpText = el('xp-text');
        this.breakthroughBtn = el<HTMLButtonElement>('breakthrough-btn');
        this.realmSelect = el<HTMLSelectElement>('realm-select');
        this.damageScaleEl = el('realm-dmg-scale');
        this.testBarBody = el('realm-test-body');
        this.root.querySelectorAll<HTMLButtonElement>('.realm-quick-btn').forEach(btn => {
            const idx = parseInt(btn.dataset.realm ?? '0', 10);
            this.realmQuickBtns.set(idx, btn);
            btn.onclick = () => this.onSetRealm?.(idx);
        });
        el('realm-test-toggle').onclick = () => {
            const hidden = this.testBarBody.classList.toggle('hidden');
            el('realm-test-toggle').textContent = hidden ? '测试 · 一键切境 ▸' : '测试 · 一键切境 ▾';
        };
        el('quick-advance-btn').onclick = () => this.onAdvanceTier?.();
        el('quick-night-btn').onclick = () => this.onToggleNight?.();
        const omenBtn = el<HTMLButtonElement>('quick-omen-btn');
        omenBtn.onclick = () => {
            const on = Boolean(this.onToggleOmen?.());
            omenBtn.classList.toggle('active', on);
        };
        el<HTMLButtonElement>('quick-ritual-btn').onclick = () => this.onStartRitual?.();
        this.senseQuickBtn = el<HTMLButtonElement>('quick-sense-btn');
        this.astralQuickBtn = el<HTMLButtonElement>('quick-astral-btn');
        this.senseQuickBtn.onclick = () => this.onTriggerSense?.();
        this.astralQuickBtn.onclick = () => this.onToggleAstral?.();
        this.cinemaRoot = el('breakthrough-cinema');
        this.cinemaTitleWrap = el('cinema-title-wrap');
        this.cinemaTitleEl = el('cinema-title');
        this.cinemaSubEl = el('cinema-sub');
        this.realmInkEl = el('realm-ink-badge');
        this.realmInkTextEl = el('realm-ink-text');
        this.senseMarkersLayer = el('sense-markers-layer');
        this.astralOverlayEl = el('astral-overlay');
        this.astralDistEl = el('astral-dist');
        this.senseDangerEl = el('sense-danger-ring');
        this.senseDangerArcEl = el('sense-danger-arc');
        for (let i = 0; i < 14; i++) {
            const node = document.createElement('div');
            node.className = 'sense-marker hidden';
            node.innerHTML = `<i class="sm-glyph"></i><span class="sm-card"><em class="sm-tag hidden"></em><b class="sm-name"></b><small class="sm-dist"></small><span class="sm-hp-track"><span class="sm-hp-fill"></span></span></span>`;
            this.senseMarkersLayer.append(node);
            this.senseMarkerPool.push({
                el: node,
                glyph: node.querySelector('.sm-glyph')!,
                name: node.querySelector('.sm-name')!,
                dist: node.querySelector('.sm-dist')!,
                hp: node.querySelector('.sm-hp-fill')!,
                tag: node.querySelector('.sm-tag')!,
            });
        }
        el<HTMLButtonElement>('cinema-skip-btn').onclick = () => this.onSkipRitual?.();
        this.skillRow = el('skill-slots-row');
        this.controlsPopover = el('controls-popover');
        this.controlsToggleBtn = el('controls-toggle');
        this.hintEl = el('hint');
        this.crosshairEl = el('crosshair');
        this.rollInput = el<HTMLInputElement>('roll');

        el('fullscreen-btn').onclick = () => {
            if (document.fullscreenElement) {
                void document.exitFullscreen?.();
            } else {
                void document.documentElement.requestFullscreen?.();
            }
        };

        this.slots = [
            { id: 'fireball', label: '火球术', key: 'E', cost: SKILL_MANA_COST.fireball, icon: iconFireballImg, kind: 'skill', title: `按住蓄力、松开释放火球术 (E · 消耗 ${SKILL_MANA_COST.fireball} 灵力)`, onHoldChange: held => this.onFireballHold?.(held) },
            { id: 'array', label: '万剑归宗', key: 'Q', cost: SKILL_MANA_COST.swordArray, icon: iconSwordRainImg, kind: 'skill', title: `释放万剑归宗 (Q · 消耗 ${SKILL_MANA_COST.swordArray} 灵力 · 需结丹期)`, onClick: () => this.onSwordArray?.() },
            { id: 'giantSword', label: '巨剑术', key: '1', cost: SKILL_MANA_COST.giantSword, icon: iconGiantSwordImg, kind: 'skill', title: `召唤凌空巨剑 (1 · 消耗 ${SKILL_MANA_COST.giantSword} 灵力 · 需筑基期)`, onClick: () => this.onGiantSword?.() },
            { id: 'pressure', label: '元婴威压', key: 'R', cost: SKILL_MANA_COST.pressure, icon: ICON_PRESSURE_URI, kind: 'skill', title: `释放元婴重力场威压 (R · 消耗 ${SKILL_MANA_COST.pressure} 灵力 · 仅元婴期开放 · 仅对野怪生效)`, onClick: () => this.onPressure?.() },
            { id: 'heal', label: '回复药', key: '2', icon: iconHealthPotionImg, kind: 'item', count: this.healCount, title: '使用回复药恢复生命 (2)', onClick: () => this.useItem('heal') },
            { id: 'pill', label: '筑基丹', key: '3', icon: iconFoundationPillImg, kind: 'item', count: this.pillCount, title: '服用筑基丹回复灵力与修为 (3)', onClick: () => this.useItem('pill') },
        ];
        this.renderSkillBar();

        this.combatNotice.className = 'wildlife-notice hidden';
        this.combatNotice.setAttribute('role', 'status');
        this.root.append(this.combatNotice);

        el<HTMLSelectElement>('quality').value = q;
        const currentArtStyle: ArtStyle = readArtStyle();
        const artStyleSelect = el<HTMLSelectElement>('art-style');
        const styleModal = el('style-restart-modal');
        const styleModalDesc = el('style-modal-desc');
        let pendingArtStyle: ArtStyle | null = null;
        artStyleSelect.value = currentArtStyle;
        const closeStyleModal = () => {
            pendingArtStyle = null;
            artStyleSelect.value = currentArtStyle;
            styleModal.classList.add('hidden');
        };
        artStyleSelect.onchange = () => {
            const next = artStyleSelect.value as ArtStyle;
            if (next === currentArtStyle) return;
            pendingArtStyle = next;
            if (document.pointerLockElement) document.exitPointerLock?.();
            const label = next === 'guofeng' ? '国风厚涂（全图）' : '青翠国漫（默认）';
            styleModalDesc.textContent = `即将切换为「${label}」。为避免实时重建着色器与材质导致设备卡顿，确认后将保存设置并重新加载页面。`;
            styleModal.classList.remove('hidden');
        };
        el('style-modal-cancel').onclick = closeStyleModal;
        styleModal.onclick = e => {
            if (e.target === styleModal) closeStyleModal();
        };
        el('style-modal-confirm').onclick = () => {
            if (!pendingArtStyle) return;
            writeArtStyle(pendingArtStyle);
            window.location.reload();
        };
        welcome.bind(() => {
            this.started = true;
            welcome.hide();
            el('crosshair').classList.remove('hidden');
            onStart();
        });
        if (!import.meta.env.DEV) el('wire').parentElement!.classList.add('hidden');
        el('settings').onclick = () => el('panel').classList.toggle('hidden');
        el('char-panel-stage').onclick = () => el('char-card').classList.toggle('compact');
        this.controlsToggleBtn.onclick = () => this.toggleControls();
        el('minimap-shell').onclick = (e) => {
            if ((e.target as HTMLElement).closest('.minimap-zoom-btn')) return;
            this.onToggleMap?.();
        };
        el('minimap-in').onclick = (e) => {
            e.stopPropagation();
            this.minimapZoom = Math.min(2.2, this.minimapZoom + .3);
        };
        el('minimap-out').onclick = (e) => {
            e.stopPropagation();
            this.minimapZoom = Math.max(.6, this.minimapZoom - .3);
        };
        el<HTMLSelectElement>('quality').onchange = e => onQuality((e.target as HTMLSelectElement).value as Quality);
        el<HTMLInputElement>('roll').onchange = e => onRoll((e.target as HTMLInputElement).checked);
        el<HTMLInputElement>('monitor').onchange = e => this.debug.classList.toggle('hidden', !(e.target as HTMLInputElement).checked);
        el<HTMLInputElement>('wire').onchange = e => onDebug((e.target as HTMLInputElement).checked);
        el<HTMLInputElement>('day-auto').onchange = e => this.onTimeAuto?.((e.target as HTMLInputElement).checked);
        this.timeSlider.onpointerdown = () => { this.draggingTime = true; };
        this.timeSlider.onpointerup = () => { this.draggingTime = false; };
        this.timeSlider.oninput = () => this.onTimeChange?.(parseFloat(this.timeSlider.value));
        this.root.querySelectorAll<HTMLButtonElement>('.time-presets button').forEach(btn => {
            btn.onclick = () => {
                const h = parseFloat(btn.dataset.hour ?? '10');
                this.timeSlider.value = String(h);
                this.onTimeChange?.(h);
            };
        });
        this.breakthroughBtn.onclick = (e) => {
            e.stopPropagation();
            this.onBreakthrough?.();
        };
        this.realmSelect.onchange = () => {
            this.onSetRealm?.(parseInt(this.realmSelect.value, 10) || 0);
        };
        el('fill-xp-btn').onclick = () => this.onFillXp?.();
        el('panel-break-btn').onclick = () => this.onBreakthrough?.();
        window.addEventListener('keydown', this.helpKey);
    }

    private toggleControls() {
        const open = this.controlsPopover.classList.toggle('hidden') === false;
        this.controlsToggleBtn.setAttribute('aria-expanded', String(open));
        this.controlsToggleBtn.classList.toggle('open', open);
    }

    bindActions(
        onToggleMap: () => void,
        onUseItem: (kind: 'heal' | 'pill') => void,
        onFireballHold?: (held: boolean) => void,
        onSwordArray?: () => void,
        onGiantSword?: () => void,
    ) {
        this.onToggleMap = onToggleMap;
        this.onUseItem = onUseItem;
        this.onFireballHold = onFireballHold;
        this.onSwordArray = onSwordArray;
        this.onGiantSword = onGiantSword;
    }

    showHint(message: string) {
        this.hintEl.textContent = message;
        this.hintEl.classList.remove('hidden');
    }

    setRollChecked(checked: boolean) {
        this.rollInput.checked = checked;
    }

    setCrosshairVisible(visible: boolean) {
        this.crosshairEl.classList.toggle('hidden', !visible);
    }

    bindTimeControl(onTimeChange: (hours: number) => void, onTimeAuto: (auto: boolean) => void) {
        this.onTimeChange = onTimeChange;
        this.onTimeAuto = onTimeAuto;
    }

    bindCultivation(
        onBreakthrough: () => void,
        onSetRealm: (realmIndex: number) => void,
        onFillXp: () => void,
        onAdvanceTier?: () => void,
        onToggleNight?: () => void,
        onToggleOmen?: () => boolean,
        onStartRitual?: () => void,
        onSkipRitual?: () => void,
    ) {
        this.onBreakthrough = onBreakthrough;
        this.onSetRealm = onSetRealm;
        this.onFillXp = onFillXp;
        this.onAdvanceTier = onAdvanceTier;
        this.onToggleNight = onToggleNight;
        this.onToggleOmen = onToggleOmen;
        this.onStartRitual = onStartRitual;
        this.onSkipRitual = onSkipRitual;
    }

    setOmenActive(active: boolean) {
        this.root.querySelector('#quick-omen-btn')?.classList.toggle('active', active);
    }

    bindDivineSense(onTriggerSense: () => void, onToggleAstral: () => void) {
        this.onTriggerSense = onTriggerSense;
        this.onToggleAstral = onToggleAstral;
    }

    bindPressure(onPressure: () => void) {
        this.onPressure = onPressure;
    }

    /** Updates Divine Sense 3D-projected beast markers, astral overlay, quick buttons, and passive danger arc. */
    updateDivineSense(
        markers: readonly SenseMarkerProjection[],
        danger: SenseDangerIndicator,
        state: {
            insightActive: boolean;
            astralActive: boolean;
            astralDist: number;
            astralRadius: number;
            astralEdgeRatio: number;
            canAstral: boolean;
            senseRadius: number;
            senseStageName: string;
            realmColor: string;
        },
    ) {
        this.senseQuickBtn.classList.toggle('active', state.insightActive);
        this.senseQuickBtn.title = `神识探查脉冲 (Z) · ${state.senseStageName} · 半径 ${state.senseRadius} m`;
        this.astralQuickBtn.classList.toggle('active', state.astralActive);
        this.astralQuickBtn.classList.toggle('locked', !state.canAstral);

        this.astralOverlayEl.classList.toggle('active', state.astralActive);
        if (state.astralActive) {
            this.astralOverlayEl.style.setProperty('--astral-accent', state.realmColor);
            const nearEdge = state.astralEdgeRatio > 0.82;
            this.astralOverlayEl.classList.toggle('near-edge', nearEdge);
            const edgeNote = nearEdge ? ' · 已临神识极限' : ' · WASD 巡游 · G / Esc 归位';
            this.astralDistEl.textContent = `距本体 ${Math.round(state.astralDist)} / ${Math.round(state.astralRadius)} m${edgeNote}`;
        }

        // Passive off-screen / behind threat directional ink-vermilion arc
        this.senseDangerEl.classList.toggle('active', danger.active && !state.astralActive);
        if (danger.active && !state.astralActive) {
            this.senseDangerArcEl.style.transform = `translate(-50%, -50%) rotate(${danger.angleDeg.toFixed(1)}deg)`;
            this.senseDangerEl.style.setProperty('--danger-urgency', danger.urgency.toFixed(2));
        }

        // Pooled 3D-projected beast markers (zero DOM allocations per frame)
        const count = Math.min(markers.length, this.senseMarkerPool.length);
        for (let i = 0; i < this.senseMarkerPool.length; i++) {
            const slot = this.senseMarkerPool[i];
            if (i >= count) {
                slot.el.classList.add('hidden');
                continue;
            }
            const m = markers[i];
            slot.el.classList.remove('hidden');
            slot.el.className = `sense-marker threat-${m.threat}${m.locked ? ' locked' : ''}`;
            slot.el.style.setProperty('--sm-col', m.rankColor);
            slot.el.style.transform = `translate3d(${m.screenX.toFixed(1)}px, ${m.screenY.toFixed(1)}px, 0)`;
            if (slot.name.textContent !== m.label) slot.name.textContent = m.label;
            slot.dist.textContent = `${m.distance}m`;
            slot.hp.style.width = `${(m.hpRatio * 100).toFixed(0)}%`;
            if (m.statusTag) {
                slot.tag.classList.remove('hidden');
                slot.tag.textContent = m.statusTag;
                slot.tag.className = `sm-tag ${m.statusTag === '警' ? 'alert' : 'fear'}`;
            } else {
                slot.tag.classList.add('hidden');
            }
        }
    }

    setCinemaOverlay(active: boolean, title = '', subtitle = '', alpha = 0) {
        this.root.classList.toggle('cinema-mode', active);
        this.cinemaRoot.classList.toggle('active', active);
        if (!active) {
            this.cinemaTitleWrap.style.opacity = '0';
            return;
        }
        if (this.cinemaTitleEl.textContent !== title) this.cinemaTitleEl.textContent = title;
        if (this.cinemaSubEl.textContent !== subtitle) this.cinemaSubEl.textContent = subtitle;
        this.cinemaTitleWrap.style.opacity = alpha.toFixed(3);
    }

    get realmInkBadgeActive(): boolean {
        return this.realmInkRemaining > 0;
    }

    /** Shows the vertical brush-calligraphy ink plaque beside the character upon any realm/tier ascension. */
    showRealmInkBadge(label: string, realmColor: string, duration = 4.2) {
        this.realmInkTextEl.textContent = label;
        this.realmInkEl.style.setProperty('--ink-accent', realmColor);
        this.realmInkDuration = duration;
        this.realmInkRemaining = duration;
        this.realmInkEl.classList.remove('show', 'fade-out');
        // Force reflow so rapid consecutive tier-ups cleanly replay the brushstroke unfurl animation
        void this.realmInkEl.offsetWidth;
        this.realmInkEl.classList.add('show');
    }

    updateRealmInkBadge(dt: number, screenX: number, screenY: number, inView: boolean) {
        if (this.realmInkRemaining <= 0) return;
        this.realmInkRemaining = Math.max(0, this.realmInkRemaining - dt);
        if (this.realmInkRemaining <= 0) {
            this.realmInkEl.classList.remove('show', 'fade-out');
            return;
        }
        const elapsed = this.realmInkDuration - this.realmInkRemaining;
        const fadeTail = this.realmInkRemaining < 0.85;
        this.realmInkEl.classList.toggle('fade-out', fadeTail);
        const driftY = fadeTail ? -(1 - this.realmInkRemaining / 0.85) * 14 : Math.sin(elapsed * 2.2) * 2.5;
        const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const h = typeof window !== 'undefined' ? window.innerHeight : 800;
        const cx = Math.max(24, Math.min(w - 84, screenX));
        const cy = Math.max(76, Math.min(h - 178, screenY + driftY));
        this.realmInkEl.style.visibility = inView ? 'visible' : 'hidden';
        this.realmInkEl.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    }

    addItem(kind: 'heal' | 'pill', delta = 1) {
        if (delta <= 0) return;
        if (kind === 'heal') {
            this.healCount = Math.min(99, this.healCount + delta);
            const slot = this.slots.find(s => s.id === 'heal');
            if (slot) slot.count = this.healCount;
            const qty = this.itemQtyEls.get('heal');
            if (qty) qty.textContent = `×${this.healCount}`;
        } else {
            this.pillCount = Math.min(99, this.pillCount + delta);
            const slot = this.slots.find(s => s.id === 'pill');
            if (slot) slot.count = this.pillCount;
            const qty = this.itemQtyEls.get('pill');
            if (qty) qty.textContent = `×${this.pillCount}`;
        }
    }

    /** Dynamically append or replace a skill/item slot; the bar expands automatically. */
    addSkill(slot: SkillSlotConfig) {
        const idx = this.slots.findIndex(s => s.id === slot.id);
        if (idx >= 0) this.slots[idx] = slot;
        else if (slot.kind === 'skill') {
            const firstItem = this.slots.findIndex(s => s.kind === 'item');
            if (firstItem >= 0) this.slots.splice(firstItem, 0, slot);
            else this.slots.push(slot);
        } else {
            this.slots.push(slot);
        }
        this.renderSkillBar();
    }

    private renderSkillBar() {
        this.skillRow.innerHTML = '';
        this.skillSlotEls.clear();
        this.skillLockEls.clear();
        this.itemQtyEls.clear();
        const skills = this.slots.filter(s => s.kind === 'skill');
        const items = this.slots.filter(s => s.kind === 'item');
        const mount = (slot: SkillSlotConfig) => {
            const interactive = Boolean(slot.onClick || slot.onHoldChange);
            const node: HTMLElement = document.createElement(interactive ? 'button' : 'div');
            if (node instanceof HTMLButtonElement) node.type = 'button';
            node.className = `skill-slot${slot.kind === 'item' ? ' item-slot' : ''}`;
            if (slot.title) node.title = slot.title;
            const costTag = slot.cost !== undefined ? `<i class="slot-cost">${slot.cost}</i>` : '';
            const lockTag = slot.kind === 'skill' ? `<em class="slot-lock hidden"></em>` : '';
            node.innerHTML = `<div class="skill-orb"><span class="slot-icon-clip"><img class="slot-icon" src="${slot.icon}" alt="${slot.label}" draggable="false"/></span><img class="slot-frame" src="${skillSlotFrameSvg}" alt="" aria-hidden="true"/>${costTag}${lockTag}<kbd>${slot.key}</kbd>${slot.count !== undefined ? `<em class="item-qty">×${slot.count}</em>` : ''}</div><span>${slot.label}</span>`;
            if (slot.onHoldChange) {
                let holding = false;
                node.addEventListener('pointerdown', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    holding = true;
                    slot.onHoldChange!(true);
                });
                const release = (e: PointerEvent) => {
                    if (!holding) return;
                    e.preventDefault();
                    holding = false;
                    slot.onHoldChange!(false);
                };
                node.addEventListener('pointerup', release);
                node.addEventListener('pointercancel', release);
                node.addEventListener('pointerleave', release);
            } else if (slot.onClick) {
                node.onclick = slot.onClick;
            }
            this.skillRow.append(node);
            this.skillSlotEls.set(slot.id, node);
            const lock = node.querySelector<HTMLElement>('.slot-lock');
            if (lock) this.skillLockEls.set(slot.id, lock);
            const qty = node.querySelector<HTMLElement>('.item-qty');
            if (qty) this.itemQtyEls.set(slot.id, qty);
        };
        for (const s of skills) mount(s);
        if (skills.length && items.length) {
            const sep = document.createElement('div');
            sep.className = 'skill-sep-wrap';
            sep.setAttribute('aria-hidden', 'true');
            sep.innerHTML = SKILL_DIVIDER_SVG;
            this.skillRow.append(sep);
        }
        for (const item of items) mount(item);
    }

    useItem(kind: 'heal' | 'pill') {
        if (kind === 'heal') {
            if (this.healCount <= 0) return;
            this.healCount--;
            const slot = this.slots.find(s => s.id === 'heal');
            if (slot) slot.count = this.healCount;
            const qty = this.itemQtyEls.get('heal');
            if (qty) qty.textContent = `×${this.healCount}`;
            this.onUseItem?.('heal');
        } else {
            if (this.pillCount <= 0) return;
            this.pillCount--;
            const slot = this.slots.find(s => s.id === 'pill');
            if (slot) slot.count = this.pillCount;
            const qty = this.itemQtyEls.get('pill');
            if (qty) qty.textContent = `×${this.pillCount}`;
            this.onUseItem?.('pill');
        }
    }

    updateVitals(v: VitalsSnapshot, notice: string) {
        const { stats } = v;
        this.realmEl.textContent = stats.fullLabel;
        this.realmEl.style.color = stats.realmColor;
        if (this.realmSelect.value !== String(stats.realmIndex)) {
            this.realmSelect.value = String(stats.realmIndex);
        }

        this.hpFill.style.width = `${Math.max(0, Math.min(100, v.hpPct)).toFixed(1)}%`;
        this.hpText.textContent = `${v.hp} / ${v.maxHp}`;
        this.mpFill.style.width = `${Math.max(0, Math.min(100, v.mpPct)).toFixed(1)}%`;
        this.mpText.textContent = `${v.mp} / ${v.maxMp}`;
        this.spFill.style.width = `${Math.max(0, Math.min(100, v.spPct)).toFixed(1)}%`;
        this.spText.textContent = `${v.sp} / ${v.maxSp}`;

        this.statAtkEl.textContent = String(stats.atk);
        this.statDefEl.textContent = String(stats.def);
        this.statCritEl.textContent = `${(stats.critRate * 100).toFixed(1)}%`;
        this.statPowerEl.textContent = stats.power.toLocaleString();
        this.damageScaleEl.textContent = `法术威力 ×${stats.damageScale.toFixed(2)}`;
        for (const [idx, btn] of this.realmQuickBtns) {
            btn.classList.toggle('active', idx === stats.realmIndex);
        }

        this.xpFill.style.width = `${v.xpPct.toFixed(1)}%`;
        this.xpFill.style.background = `linear-gradient(90deg, ${stats.realmColor}, #fff5cf)`;
        this.xpText.textContent = stats.isMaxTier
            ? '圆满'
            : v.canBreakthrough
                ? '可破境'
                : `${v.xp} / ${v.needXp}`;

        this.breakthroughBtn.classList.toggle('hidden', !v.canBreakthrough);
        if (v.canBreakthrough && v.nextRealmName) {
            this.breakthroughBtn.textContent = `✦ 破境 · ${v.nextRealmName} (B)`;
        }

        const skillMap: readonly [string, keyof VitalsSnapshot['skills']][] = [
            ['fireball', 'fireball'],
            ['array', 'swordArray'],
            ['giantSword', 'giantSword'],
            ['pressure', 'pressure'],
        ];
        for (const [slotId, skillKey] of skillMap) {
            const slotEl = this.skillSlotEls.get(slotId);
            const lockEl = this.skillLockEls.get(slotId);
            const avail = v.skills[skillKey];
            if (slotEl) {
                slotEl.classList.toggle('locked-cap', avail.reason === 'cap');
                slotEl.classList.toggle('low-mana', avail.reason === 'mana');
            }
            if (lockEl) {
                lockEl.classList.toggle('hidden', avail.reason !== 'cap');
                if (avail.reason === 'cap') {
                    lockEl.textContent = `需${avail.requiredRealmName}`;
                }
            }
        }

        this.combatNotice.classList.toggle('hidden', !notice);
        if (this.combatNotice.textContent !== notice) this.combatNotice.textContent = notice;
    }

    private buildCompassTape() {
        const labels: Record<number, { text: string; major: boolean }> = {
            0: { text: 'N', major: true },
            45: { text: 'NE', major: false },
            90: { text: 'E', major: true },
            135: { text: 'SE', major: false },
            180: { text: 'S', major: true },
            225: { text: 'SW', major: false },
            270: { text: 'W', major: true },
            315: { text: 'NW', major: false },
        };
        const pxPerDeg = 2.2;
        const parts: string[] = [];
        for (let deg = -180; deg <= 540; deg += 15) {
            const norm = ((deg % 360) + 360) % 360;
            const x = (deg + 180) * pxPerDeg;
            const info = labels[norm];
            if (info) {
                parts.push(`<span class="compass-mark${info.major ? ' major' : ''}${norm === 0 ? ' cardinal-n' : ''}" style="left:${x}px"><em>${info.text}</em><i></i></span>`);
            } else {
                parts.push(`<span class="compass-tick" style="left:${x}px"></span>`);
            }
        }
        this.compassTrack.innerHTML = parts.join('');
    }

    /** Per-frame smooth compass tape & minimap arrow update (dirty-checked to avoid idle DOM mutations). */
    updateCompass(heading: number) {
        const h = ((heading % 360) + 360) % 360;
        if (Math.abs(h - this.lastCompassHeading) < 0.05) return;
        this.lastCompassHeading = h;
        const pxPerDeg = 2.2;
        const offset = -((h + 180) * pxPerDeg);
        this.compassTrack.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;
        this.compass.textContent = `${['北', '东', '南', '西'][Math.round(h / 90) % 4]} · ${h.toFixed(0).padStart(3, '0')}°`;
        this.minimapArrow.style.transform = `translate(-50%,-50%) rotate(${h.toFixed(1)}deg)`;
    }

    updateTelemetry(t: HudTelemetry) {
        this.coordsEl.textContent = `(${Math.round(t.x)}, ${Math.round(t.z)})`;
        this.regionNameEl.textContent = t.regionName;
        this.regionSubEl.textContent = t.regionSub;

        this.skillSlotEls.get('fireball')?.classList.toggle('active', t.fireball);
        this.skillSlotEls.get('array')?.classList.toggle('active', t.casting);
        this.skillSlotEls.get('giantSword')?.classList.toggle('active', Boolean(t.giantSword));
        if (t.timeLabel) {
            this.clockEl.textContent = t.timeLabel;
            this.timeReadout.textContent = t.timeLabel;
        }
        if (t.hours !== undefined && !this.draggingTime) {
            this.timeSlider.value = t.hours.toFixed(1);
        }
    }

    dispose() {
        window.removeEventListener('keydown', this.helpKey);
        this.root.remove();
    }
}
