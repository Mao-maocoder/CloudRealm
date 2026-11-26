import * as T from 'three';

export interface EnvironmentLightingState {
    hours: number;
    dayFactor: number;
    duskFactor: number;
    nightFactor: number;
    sunDirection: T.Vector3;
    moonDirection: T.Vector3;
    lightDirection: T.Vector3;
    sunColor: T.Color;
    sunIntensity: number;
    ambientColor: T.Color;
    ambientIntensity: number;
    hemiSky: T.Color;
    hemiGround: T.Color;
    hemiIntensity: number;
    fillColor: T.Color;
    fillIntensity: number;
    fogColor: T.Color;
    skyZenith: T.Color;
    skyMid: T.Color;
    skyHorizon: T.Color;
    skyGlow: T.Color;
    cloudLit: T.Color;
    cloudShadow: T.Color;
    airColor: T.Color;
    sunAirColor: T.Color;
    mistColor: T.Color;
    heightFogDensity: number;
    waterBodyTint: T.Color;
    waterSkyLow: T.Color;
    waterSkyHigh: T.Color;
    waterSpec: T.Color;
    waterSpecPower: number;
    vegTransColor: T.Color;
    vegTransStrength: number;
    vegRimColor: T.Color;
    vegRimStrength: number;
    atmoLight: number;
    exposure: number;
}

export type DayNightState = EnvironmentLightingState;

interface Keyframe {
    h: number;
    sun: string;
    sunI: number;
    amb: string;
    ambI: number;
    hemiSky: string;
    hemiGnd: string;
    hemiI: number;
    fill: string;
    fillI: number;
    fog: string;
    zenith: string;
    mid: string;
    horizon: string;
    glow: string;
    cloudLit: string;
    cloudShadow: string;
    air: string;
    sunAir: string;
    mist: string;
    hFog: number;
    waterBody: string;
    waterLow: string;
    waterHigh: string;
    waterSpec: string;
    waterSpecPow: number;
    vegTrans: string;
    vegTransI: number;
    vegRim: string;
    vegRimI: number;
    atmoLight: number;
    exposure: number;
}

/**
 * Physically-grounded anime open-world lighting keyframes calibrated against
 * the 4 concept references (Dawn 06:15, Noon 12:00, Sunset 17:45, Moonlit Night 22:30).
 */
const KEYS: Keyframe[] = [
    {
        // 00:00 月夜: 银白月光 + 幽蓝山谷 + 深蓝灰云腹(非纯白) + 深蓝宝石河体 + 局部银白月波
        h: 0, sun: '#a8d0ff', sunI: .72, amb: '#2d528c', ambI: .42,
        hemiSky: '#4a7bc2', hemiGnd: '#17323d', hemiI: .74, fill: '#3c69a8', fillI: .22,
        fog: '#112752', zenith: '#040f2e', mid: '#0a2254', horizon: '#183c75', glow: '#8ac0ff',
        cloudLit: '#426aa6', cloudShadow: '#0b1a3b', air: '#122b59', sunAir: '#2d5491', mist: '#22447a', hFog: .34,
        waterBody: '#071738', waterLow: '#0e2b5c', waterHigh: '#04102b', waterSpec: '#f0f8ff', waterSpecPow: 1.95,
        vegTrans: '#4474a8', vegTransI: .12, vegRim: '#a8d4ff', vegRimI: .28,
        atmoLight: .38, exposure: 1.03,
    },
    {
        // 04:45 破晓前
        h: 4.75, sun: '#a8c8f0', sunI: .64, amb: '#3c5d91', ambI: .42,
        hemiSky: '#5b82bf', hemiGnd: '#213c45', hemiI: .72, fill: '#4c72ab', fillI: .20,
        fog: '#213e6e', zenith: '#091940', mid: '#183770', horizon: '#3b5a8a', glow: '#cf9b8c',
        cloudLit: '#7084ab', cloudShadow: '#1c325e', air: '#203c6b', sunAir: '#5e6b94', mist: '#3d5c8a', hFog: .42,
        waterBody: '#152d52', waterLow: '#234678', waterHigh: '#0b2047', waterSpec: '#dfebff', waterSpecPow: 1.75,
        vegTrans: '#6e96b8', vegTransI: .16, vegRim: '#bfd6f5', vegRimI: .22,
        atmoLight: .48, exposure: 1.04,
    },
    {
        // 06:15 晨曦: 清新薄雾 + 淡金斜光 + 冷青蓝背光补光 + 嫩绿透射草尖 + 淡金河面反光
        h: 6.25, sun: '#ffd485', sunI: 1.34, amb: '#94bce0', ambI: .34,
        hemiSky: '#c2def5', hemiGnd: '#46704b', hemiI: .78, fill: '#79b2e6', fillI: .22,
        fog: '#b8cfe0', zenith: '#194fa8', mid: '#4e8cd4', horizon: '#f7c48e', glow: '#ffd978',
        cloudLit: '#ffe8c4', cloudShadow: '#889fc7', air: '#739fc9', sunAir: '#f7cc94', mist: '#d8e3ec', hFog: .56,
        waterBody: '#5394b5', waterLow: '#b5b8cc', waterHigh: '#2463a3', waterSpec: '#ffdc85', waterSpecPow: 2.35,
        vegTrans: '#dcf774', vegTransI: .52, vegRim: '#ffe594', vegRimI: .38,
        atmoLight: .88, exposure: 1.07,
    },
    {
        // 09:30 清朗上午: 澄澈蔚蓝晴空 + 冷翠树影 + 暖黄绿透光林冠 + 低雾通透远景
        h: 9.5, sun: '#fff5d8', sunI: 1.42, amb: '#c4e4f8', ambI: .27,
        hemiSky: '#bce4ff', hemiGnd: '#2f7a5c', hemiI: .80, fill: '#7cc6e8', fillI: .20,
        fog: '#9ecde8', zenith: '#0a4ec4', mid: '#2382e6', horizon: '#8fd1f7', glow: '#ffdf9e',
        cloudLit: '#ffffff', cloudShadow: '#93b7de', air: '#4a92cc', sunAir: '#bce0f0', mist: '#cde8f7', hFog: .10,
        waterBody: '#94d4e0', waterLow: '#70cde0', waterHigh: '#1875cc', waterSpec: '#fff8db', waterSpecPow: 1.35,
        vegTrans: '#cff65e', vegTransI: .40, vegRim: '#e8ff9c', vegRimI: .20,
        atmoLight: 1.0, exposure: 1.06,
    },
    {
        // 13:30 正午: 澄澈鲜活晴空 + 饱满春绿阳光草坡 + 冷翡翠树影层次 + 通透远山
        h: 13.5, sun: '#fff7de', sunI: 1.46, amb: '#c8e8fa', ambI: .27,
        hemiSky: '#c0e7ff', hemiGnd: '#317f5e', hemiI: .82, fill: '#82cae8', fillI: .20,
        fog: '#a3d1ec', zenith: '#0a50c9', mid: '#2687eb', horizon: '#94d5f8', glow: '#ffe2a6',
        cloudLit: '#ffffff', cloudShadow: '#95b9e0', air: '#4b95cf', sunAir: '#c0e2f2', mist: '#d0eaf8', hFog: .09,
        waterBody: '#9bdbe6', waterLow: '#75d1e3', waterHigh: '#1979d1', waterSpec: '#fff9e0', waterSpecPow: 1.40,
        vegTrans: '#d4f864', vegTransI: .42, vegRim: '#ecffa2', vegRimI: .22,
        atmoLight: 1.0, exposure: 1.07,
    },
    {
        // 17:45 晚霞: 橙金逆光 + 蓝紫冷调阴影(草地保绿不发红褐) + 橙粉晚霞云 + 河面金色反光带
        h: 17.75, sun: '#ffa84f', sunI: 1.36, amb: '#8496cc', ambI: .34,
        hemiSky: '#b8aedb', hemiGnd: '#3b5c47', hemiI: .76, fill: '#758bc9', fillI: .24,
        fog: '#b599b5', zenith: '#1f367d', mid: '#d4747e', horizon: '#ff8e4d', glow: '#ffc766',
        cloudLit: '#ffcf80', cloudShadow: '#6d5885', air: '#6d709c', sunAir: '#ffaa6b', mist: '#cfa5ab', hFog: .36,
        waterBody: '#355873', waterLow: '#e89568', waterHigh: '#2d4c85', waterSpec: '#ffce6e', waterSpecPow: 2.45,
        vegTrans: '#f5dc54', vegTransI: .58, vegRim: '#ffcb63', vegRimI: .48,
        atmoLight: .82, exposure: 1.08,
    },
    {
        // 19:15 暮色入夜
        h: 19.25, sun: '#a8a2de', sunI: .68, amb: '#3c558c', ambI: .40,
        hemiSky: '#5878ba', hemiGnd: '#203945', hemiI: .70, fill: '#4b6ca8', fillI: .20,
        fog: '#233b6e', zenith: '#091840', mid: '#1c346e', horizon: '#525680', glow: '#cc8278',
        cloudLit: '#706c94', cloudShadow: '#1b2d5c', air: '#223c6e', sunAir: '#6a5e85', mist: '#3e5482', hFog: .36,
        waterBody: '#142c4f', waterLow: '#2b4978', waterHigh: '#0a1f47', waterSpec: '#e6d4e0', waterSpecPow: 1.75,
        vegTrans: '#6e8ec2', vegTransI: .18, vegRim: '#c2c8f0', vegRimI: .24,
        atmoLight: .50, exposure: 1.05,
    },
    {
        // 21:00 银月蓝夜
        h: 21, sun: '#a8d0ff', sunI: .72, amb: '#2d528c', ambI: .42,
        hemiSky: '#4a7bc2', hemiGnd: '#17323d', hemiI: .74, fill: '#3c69a8', fillI: .22,
        fog: '#112752', zenith: '#040f2e', mid: '#0a2254', horizon: '#183c75', glow: '#8ac0ff',
        cloudLit: '#426aa6', cloudShadow: '#0b1a3b', air: '#122b59', sunAir: '#2d5491', mist: '#22447a', hFog: .34,
        waterBody: '#071738', waterLow: '#0e2b5c', waterHigh: '#04102b', waterSpec: '#f0f8ff', waterSpecPow: 1.95,
        vegTrans: '#4474a8', vegTransI: .12, vegRim: '#a8d4ff', vegRimI: .28,
        atmoLight: .38, exposure: 1.03,
    },
];

const SHICHEN = ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'];

export function formatShichen(hours: number): string {
    const h = ((hours % 24) + 24) % 24;
    const idx = Math.floor(((h + 1) % 24) / 2);
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${SHICHEN[idx]} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export class EnvironmentLightingController {
    hours = 10.0;
    auto = true;
    speed = 0.08;

    readonly state: EnvironmentLightingState = {
        hours: 10.0,
        dayFactor: 1,
        duskFactor: 0,
        nightFactor: 0,
        sunDirection: new T.Vector3(),
        moonDirection: new T.Vector3(),
        lightDirection: new T.Vector3(),
        sunColor: new T.Color('#fff5dc'),
        sunIntensity: 1.36,
        ambientColor: new T.Color('#cde7ff'),
        ambientIntensity: .28,
        hemiSky: new T.Color('#bce2ff'),
        hemiGround: new T.Color('#598744'),
        hemiIntensity: .76,
        fillColor: new T.Color('#8ec7eb'),
        fillIntensity: .18,
        fogColor: new T.Color('#9ecde8'),
        skyZenith: new T.Color('#0a4ec4'),
        skyMid: new T.Color('#2382e6'),
        skyHorizon: new T.Color('#8fd1f7'),
        skyGlow: new T.Color('#ffdf9e'),
        cloudLit: new T.Color('#ffffff'),
        cloudShadow: new T.Color('#93b7de'),
        airColor: new T.Color('#4a92cc'),
        sunAirColor: new T.Color('#bce0f0'),
        mistColor: new T.Color('#cde8f7'),
        heightFogDensity: .14,
        waterBodyTint: new T.Color('#94d4e0'),
        waterSkyLow: new T.Color('#70cde0'),
        waterSkyHigh: new T.Color('#1875cc'),
        waterSpec: new T.Color('#fff8db'),
        waterSpecPower: 1.35,
        vegTransColor: new T.Color('#ccf266'),
        vegTransStrength: .32,
        vegRimColor: new T.Color('#ecffb5'),
        vegRimStrength: .18,
        atmoLight: 1.0,
        exposure: 1.06,
    };

    private readonly tmpA = new T.Color();
    private readonly tmpB = new T.Color();
    private readonly tmpDayDir = new T.Vector3();
    private readonly tmpNightDir = new T.Vector3();

    constructor() {
        this.evaluate();
    }

    setHours(hours: number) {
        this.hours = ((hours % 24) + 24) % 24;
        this.evaluate();
    }

    step(dt: number) {
        if (this.auto && dt > 0) {
            this.hours = (this.hours + dt * this.speed) % 24;
        }
        this.evaluate();
    }

    private lerpColor(target: T.Color, aHex: string, bHex: string, t: number) {
        this.tmpA.set(aHex);
        this.tmpB.set(bHex);
        target.copy(this.tmpA).lerp(this.tmpB, t);
    }

    private evaluate() {
        const h = this.hours;
        const s = this.state;
        s.hours = h;

        let a = KEYS[KEYS.length - 1], b = KEYS[0];
        let span = 24 - a.h + b.h;
        let offset = h >= a.h ? h - a.h : (24 - a.h) + h;
        for (let i = 0; i < KEYS.length - 1; i++) {
            if (h >= KEYS[i].h && h < KEYS[i + 1].h) {
                a = KEYS[i];
                b = KEYS[i + 1];
                span = b.h - a.h;
                offset = h - a.h;
                break;
            }
        }
        const rawT = span > 0 ? Math.max(0, Math.min(1, offset / span)) : 0;
        const t = rawT * rawT * (3 - 2 * rawT);

        // Scenic celestial arc matching all 4 concept art compositions:
        // Dawn (06:15) & Sunset (17:45) sit low over the left-northern valley horizon, casting diagonal
        // golden rays across the river & right-hand grassy slope; Noon peaks high; Moon shines over the north pass.
        const angle = ((h - 6) / 24) * Math.PI * 2;
        const sinA = Math.sin(angle);
        const cosA = Math.cos(angle);
        s.sunDirection.set(-0.42 - cosA * 0.06, sinA * 0.78 + 0.11, -0.88 + Math.abs(sinA) * 0.28).normalize();
        s.moonDirection.set(-0.22 + cosA * 0.24, Math.max(-0.45, -sinA * 0.28 + 0.03), -0.92).normalize();

        s.dayFactor = T.MathUtils.smoothstep(sinA, -0.06, 0.28);
        s.nightFactor = 1 - T.MathUtils.smoothstep(sinA, -0.20, 0.06);
        s.duskFactor = Math.max(0, 1 - Math.abs(sinA - 0.03) / 0.26) * (1 - s.nightFactor * 0.45);

        // Smooth handoff of shadow-casting directional light between Sun (day) and Moon (night).
        const lightBlend = T.MathUtils.smoothstep(sinA, -0.10, 0.04);
        const dayDir = this.tmpDayDir.copy(s.sunDirection);
        dayDir.y = Math.max(0.18, dayDir.y);
        dayDir.normalize();
        const nightDir = this.tmpNightDir.copy(s.moonDirection);
        nightDir.y = Math.max(0.28, nightDir.y);
        nightDir.normalize();
        s.lightDirection.copy(nightDir).lerp(dayDir, lightBlend).normalize();

        this.lerpColor(s.sunColor, a.sun, b.sun, t);
        s.sunIntensity = T.MathUtils.lerp(a.sunI, b.sunI, t);
        this.lerpColor(s.ambientColor, a.amb, b.amb, t);
        s.ambientIntensity = T.MathUtils.lerp(a.ambI, b.ambI, t);
        this.lerpColor(s.hemiSky, a.hemiSky, b.hemiSky, t);
        this.lerpColor(s.hemiGround, a.hemiGnd, b.hemiGnd, t);
        s.hemiIntensity = T.MathUtils.lerp(a.hemiI, b.hemiI, t);
        this.lerpColor(s.fillColor, a.fill, b.fill, t);
        s.fillIntensity = T.MathUtils.lerp(a.fillI, b.fillI, t);
        this.lerpColor(s.fogColor, a.fog, b.fog, t);
        this.lerpColor(s.skyZenith, a.zenith, b.zenith, t);
        this.lerpColor(s.skyMid, a.mid, b.mid, t);
        this.lerpColor(s.skyHorizon, a.horizon, b.horizon, t);
        this.lerpColor(s.skyGlow, a.glow, b.glow, t);
        this.lerpColor(s.cloudLit, a.cloudLit, b.cloudLit, t);
        this.lerpColor(s.cloudShadow, a.cloudShadow, b.cloudShadow, t);
        this.lerpColor(s.airColor, a.air, b.air, t);
        this.lerpColor(s.sunAirColor, a.sunAir, b.sunAir, t);
        this.lerpColor(s.mistColor, a.mist, b.mist, t);
        s.heightFogDensity = T.MathUtils.lerp(a.hFog, b.hFog, t);
        this.lerpColor(s.waterBodyTint, a.waterBody, b.waterBody, t);
        this.lerpColor(s.waterSkyLow, a.waterLow, b.waterLow, t);
        this.lerpColor(s.waterSkyHigh, a.waterHigh, b.waterHigh, t);
        this.lerpColor(s.waterSpec, a.waterSpec, b.waterSpec, t);
        s.waterSpecPower = T.MathUtils.lerp(a.waterSpecPow, b.waterSpecPow, t);
        this.lerpColor(s.vegTransColor, a.vegTrans, b.vegTrans, t);
        s.vegTransStrength = T.MathUtils.lerp(a.vegTransI, b.vegTransI, t);
        this.lerpColor(s.vegRimColor, a.vegRim, b.vegRim, t);
        s.vegRimStrength = T.MathUtils.lerp(a.vegRimI, b.vegRimI, t);
        s.atmoLight = T.MathUtils.lerp(a.atmoLight, b.atmoLight, t);
        s.exposure = T.MathUtils.lerp(a.exposure, b.exposure, t);
    }
}

export { EnvironmentLightingController as DayNightCycle };
