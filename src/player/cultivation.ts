export type SkillId = 'swordWave' | 'fireball' | 'giantSword' | 'swordArray';
export type FlightMode = 'sword' | 'void';

export interface FlightProfile {
    readonly mode: FlightMode;
    /** Base slow/idle airspeed (m/s). 0 means true mid-air hover. */
    readonly slow: number;
    /** Forward cruise airspeed (m/s). */
    readonly cruise: number;
    /** Shift boost / escape-light airspeed (m/s). */
    readonly boost: number;
    /** Minimum mana required to initiate flight. */
    readonly minMp: number;
    /** Mana per second while hovering or sky-walking. */
    readonly hoverDrain: number;
    /** Mana per second during normal flight. */
    readonly cruiseDrain: number;
    /** Mana per second during boost / escape-light flight. */
    readonly boostDrain: number;
}

export interface SenseProfile {
    readonly stageName: string;
    /** Base Divine Sense scan & astral radius (m) at stage 0 of the realm. */
    readonly minRadius: number;
    /** Peak Divine Sense radius (m) at the top minor stage of the realm. */
    readonly maxRadius: number;
    /** Mana cost when opening Divine Sense (initial scan wave). */
    readonly pulseCost: number;
    /** Continuous mana per second while Divine Sense stays open. */
    readonly sustainDrain: number;
    /** Mana per second while projecting consciousness out of body. */
    readonly astralDrain: number;
    /** Highest beast rank (0..3) intimidated into fleeing by realm pressure. */
    readonly suppressMaxRank: number;
    /** Whether out-of-body Astral Divine Sense projection (G) is unlocked. */
    readonly canAstralProject: boolean;
    /** Base combat target lock range (m) when Divine Sense insight is active. */
    readonly lockMinRange: number;
    /** Peak combat target lock range (m) when Divine Sense insight is active. */
    readonly lockMaxRange: number;
}

export interface RealmDefinition {
    readonly id: 'qi' | 'foundation' | 'core' | 'nascent';
    readonly name: string;
    readonly color: string;
    readonly stages: readonly string[];
    /** Base maximum Spirit/Mana anchor at the first minor stage of the realm. */
    readonly baseMp: number;
    /** Passive meditation XP gained per second while calm. */
    readonly idleXpRate: number;
    readonly flight: FlightProfile;
    readonly sense: SenseProfile;
}

export const REALMS: readonly RealmDefinition[] = [
    {
        id: 'qi',
        name: '炼气',
        color: '#8ee6c8',
        stages: ['一层', '二层', '三层', '四层', '五层', '六层', '七层', '八层', '九层'],
        baseMp: 160,
        idleXpRate: 2.5,
        flight: { mode: 'sword', slow: 9, cruise: 18, boost: 36, minMp: 15, hoverDrain: 2, cruiseDrain: 3, boostDrain: 8 },
        sense: { stageName: '灵觉微芒', minRadius: 70, maxRadius: 120, pulseCost: 20, sustainDrain: 3, astralDrain: 0, suppressMaxRank: 0, canAstralProject: false, lockMinRange: 38, lockMaxRange: 50 },
    },
    {
        id: 'foundation',
        name: '筑基',
        color: '#6fd8ff',
        stages: ['初期', '中期', '后期', '大圆满'],
        baseMp: 520,
        idleXpRate: 6.5,
        flight: { mode: 'sword', slow: 12, cruise: 24, boost: 50, minMp: 15, hoverDrain: 2, cruiseDrain: 3, boostDrain: 8 },
        sense: { stageName: '神识初生', minRadius: 180, maxRadius: 260, pulseCost: 35, sustainDrain: 5, astralDrain: 0, suppressMaxRank: 1, canAstralProject: false, lockMinRange: 64, lockMaxRange: 84 },
    },
    {
        id: 'core',
        name: '结丹',
        color: '#f6d479',
        stages: ['初期', '中期', '后期', '大圆满'],
        baseMp: 1500,
        idleXpRate: 16,
        flight: { mode: 'sword', slow: 15, cruise: 30, boost: 65, minMp: 15, hoverDrain: 2, cruiseDrain: 3, boostDrain: 8 },
        sense: { stageName: '神识化液', minRadius: 350, maxRadius: 480, pulseCost: 55, sustainDrain: 8, astralDrain: 10, suppressMaxRank: 2, canAstralProject: true, lockMinRange: 100, lockMaxRange: 132 },
    },
    {
        id: 'nascent',
        name: '元婴',
        color: '#d7a8ff',
        stages: ['初期', '中期', '后期', '大圆满'],
        baseMp: 3800,
        idleXpRate: 36,
        flight: { mode: 'void', slow: 0, cruise: 40, boost: 95, minMp: 15, hoverDrain: 1, cruiseDrain: 4, boostDrain: 14 },
        sense: { stageName: '神识大成', minRadius: 700, maxRadius: 1000, pulseCost: 80, sustainDrain: 12, astralDrain: 14, suppressMaxRank: 3, canAstralProject: true, lockMinRange: 155, lockMaxRange: 210 },
    },
] as const;

/**
 * Mana costs designed so lower realms naturally lack the MaxMP pool required for higher arts:
 * - 炼气 MaxMP: 160 ~ 248   -> 剑气 (15)、御剑 (3~8/s)、火球术 (45) 可用；巨剑术 (360) & 剑阵 (1200) 上限不足。
 * - 筑基 MaxMP: 520 ~ 806   -> 巨剑术 (360) 解锁；剑阵 (1200) 上限仍不足。
 * - 结丹 MaxMP: 1500 ~ 2325 -> 万剑归宗 (1200) 解锁；原版全速御剑 (30 / 65 m/s)。
 * - 元婴 MaxMP: 3800 ~ 5890 -> 灵力化海，肉身御空、遁光极速 (95 m/s) 与踏空而行。
 */
export const SKILL_MANA_COST: Record<SkillId, number> = {
    swordWave: 15,
    fireball: 45,
    giantSword: 360,
    swordArray: 1200,
};

export const SKILL_LABEL: Record<SkillId, string> = {
    swordWave: '剑气斩',
    fireball: '火球术',
    giantSword: '巨剑术',
    swordArray: '万剑归宗',
};

export const FIREBALL_CHARGE_EXTRA_COST = 15;
export const PILL_XP_BONUS = 180;

export interface BeastRankDefinition {
    readonly rank: 1 | 2 | 3 | 4;
    readonly label: string;
    readonly color: string;
    readonly hpScale: number;
    readonly dmgScale: number;
    readonly xpScale: number;
    readonly sizeScale: number;
}

/** Beast ranks mapped 1:1 to human major realms (一阶=炼气, 二阶=筑基, 三阶=结丹, 四阶=元婴). */
export const BEAST_RANKS: readonly BeastRankDefinition[] = [
    { rank: 1, label: '一阶', color: '#8ee6c8', hpScale: 1.0, dmgScale: 1.0, xpScale: 1.0, sizeScale: 1.0 },
    { rank: 2, label: '二阶', color: '#6fd8ff', hpScale: 2.1, dmgScale: 1.75, xpScale: 2.5, sizeScale: 1.07 },
    { rank: 3, label: '三阶', color: '#f6d479', hpScale: 4.4, dmgScale: 2.9, xpScale: 6.2, sizeScale: 1.14 },
    { rank: 4, label: '四阶', color: '#d7a8ff', hpScale: 8.6, dmgScale: 4.8, xpScale: 14.0, sizeScale: 1.22 },
] as const;

const REGION_BEAST_WEIGHTS: Record<string, readonly [number, number, number, number]> = {
    village: [0.68, 0.24, 0.07, 0.01],
    lake:    [0.52, 0.34, 0.12, 0.02],
    sakura:  [0.42, 0.38, 0.16, 0.04],
    bamboo:  [0.34, 0.40, 0.21, 0.05],
    autumn:  [0.32, 0.40, 0.22, 0.06],
    peaks:   [0.16, 0.32, 0.36, 0.16],
    snow:    [0.12, 0.28, 0.38, 0.22],
    sky:     [0.10, 0.24, 0.40, 0.26],
};

const SPECIES_RANK_BIAS: Record<string, readonly [number, number, number, number]> = {
    flower:         [1.45, 0.95, 0.55, 0.35],
    water:          [1.30, 1.05, 0.65, 0.40],
    'stone-boar':   [1.00, 1.20, 0.95, 0.65],
    wolf:           [0.90, 1.25, 1.15, 0.80],
    mantis:         [0.75, 1.15, 1.35, 1.05],
    'crystal-boar': [0.45, 0.95, 1.55, 1.75],
};

/**
 * Weighted random beast rank (1..4) influenced by region danger, species nature,
 * and nighttime妖气 surge (nightFactor 0..1 substantially increases 三阶 / 四阶 odds).
 */
export function rollBeastRank(region: string, speciesId: string, rand: number, nightFactor = 0): BeastRankDefinition {
    const base = REGION_BEAST_WEIGHTS[region] ?? [0.40, 0.34, 0.20, 0.06];
    const bias = SPECIES_RANK_BIAS[speciesId] ?? [1, 1, 1, 1];
    const n = Math.max(0, Math.min(1, nightFactor));
    const nightMul = [
        1 - 0.55 * n,
        1 + 0.35 * n,
        1 + 1.85 * n,
        1 + 3.60 * n,
    ];
    const weights = [
        base[0] * bias[0] * nightMul[0],
        base[1] * bias[1] * nightMul[1],
        base[2] * bias[2] * nightMul[2],
        base[3] * bias[3] * nightMul[3],
    ];
    const total = weights[0] + weights[1] + weights[2] + weights[3];
    const u = Math.max(0, Math.min(0.999999, rand)) * total;
    let acc = 0;
    for (let i = 0; i < BEAST_RANKS.length; i++) {
        acc += weights[i];
        if (u <= acc) return BEAST_RANKS[i];
    }
    return BEAST_RANKS[0];
}

export interface CultivationStats {
    realmIndex: number;
    stageIndex: number;
    stageCount: number;
    tier: number;
    realmName: string;
    stageName: string;
    realmColor: string;
    fullLabel: string;
    maxHp: number;
    maxMp: number;
    maxSp: number;
    mpRegen: number;
    atk: number;
    def: number;
    critRate: number;
    damageScale: number;
    power: number;
    needXp: number;
    flight: FlightProfile;
    senseStageName: string;
    senseRadius: number;
    sensePulseCost: number;
    senseDrain: number;
    senseAstralDrain: number;
    senseSuppressMaxRank: number;
    canAstralProject: boolean;
    senseLockRange: number;
    isPeakOfRealm: boolean;
    isMaxTier: boolean;
}

const BASE_ATK_TIER0 = 38;
const MAJOR_REALM_BASE_XP = [45, 360, 1100, 3200] as const;

/**
 * Commercial RPG exponential-realm × smooth-substage formula:
 * - 炼气 spans 9 classical layers (一层 ~ 九层); 筑基 / 结丹 / 元婴 span 4 stages (初期 / 中期 / 后期 / 大圆满).
 * - Each major realm breakthrough delivers a 2x~3x qualitative leap in MaxMP, MaxHP, ATK, DEF & flight speed.
 */
export function computeRealmStats(realmIndex: number, stageIndex: number): CultivationStats {
    const r = Math.max(0, Math.min(REALMS.length - 1, Math.floor(realmIndex)));
    const realm = REALMS[r];
    const stageCount = realm.stages.length;
    const s = Math.max(0, Math.min(stageCount - 1, Math.floor(stageIndex)));
    const p = stageCount > 1 ? s / (stageCount - 1) : 1;

    const maxMp = Math.round(realm.baseMp * (1 + 0.55 * p));
    const maxHp = Math.round(260 * Math.pow(2.15, r) * (1 + 0.45 * p));
    const maxSp = 100 + 25 * r + Math.round(15 * p);
    const mpRegen = 10 + 0.045 * maxMp;

    const atk = Math.round(BASE_ATK_TIER0 * Math.pow(1.95, r) * (1 + 0.42 * p));
    const def = Math.round(24 * Math.pow(1.90, r) * (1 + 0.40 * p));
    const critRate = 0.08 + 0.045 * r + 0.03 * p;
    const damageScale = atk / BASE_ATK_TIER0;

    const power = Math.round(
        maxHp * 0.35 +
        maxMp * 0.45 +
        atk * 6.2 +
        def * 3.8 +
        critRate * 1800,
    );

    const isPeakOfRealm = s === stageCount - 1 && r < REALMS.length - 1;
    const isMaxTier = r === REALMS.length - 1 && s === stageCount - 1;
    const needXp = isMaxTier
        ? 0
        : r === 0
            ? Math.round(MAJOR_REALM_BASE_XP[0] + 22 * s)
            : Math.round(MAJOR_REALM_BASE_XP[r] * (1 + 0.55 * s));

    let tierOffset = 0;
    for (let i = 0; i < r; i++) tierOffset += REALMS[i].stages.length;

    const senseRadius = Math.round(realm.sense.minRadius + (realm.sense.maxRadius - realm.sense.minRadius) * p);
    const senseLockRange = Math.round(realm.sense.lockMinRange + (realm.sense.lockMaxRange - realm.sense.lockMinRange) * p);

    return {
        realmIndex: r,
        stageIndex: s,
        stageCount,
        tier: tierOffset + s + 1,
        realmName: realm.name,
        stageName: realm.stages[s],
        realmColor: realm.color,
        fullLabel: `${realm.name}${realm.stages[s]}`,
        maxHp,
        maxMp,
        maxSp,
        mpRegen,
        atk,
        def,
        critRate,
        damageScale,
        power,
        needXp,
        flight: realm.flight,
        senseStageName: realm.sense.stageName,
        senseRadius,
        sensePulseCost: realm.sense.pulseCost,
        senseDrain: realm.sense.sustainDrain,
        senseAstralDrain: realm.sense.astralDrain,
        senseSuppressMaxRank: realm.sense.suppressMaxRank,
        canAstralProject: realm.sense.canAstralProject,
        senseLockRange,
        isPeakOfRealm,
        isMaxTier,
    };
}

/** Hyperbolic armor mitigation formula: DamageTaken = Raw * 100 / (100 + DEF). */
export function mitigateIncomingDamage(rawDamage: number, def: number): number {
    return Math.max(1, Math.round(rawDamage * (100 / (100 + Math.max(0, def)))));
}

/** Derives the earliest major realm whose first-stage MaxMP can cast a given mana cost. */
export function requiredRealmForMana(cost: number): RealmDefinition {
    for (const realm of REALMS) {
        if (realm.baseMp >= cost) return realm;
    }
    return REALMS[REALMS.length - 1];
}

/** Cultivation XP awarded for defeating a wildlife beast based on its base health and rank tier. */
export function xpForCreatureDefeat(baseHealth: number, rankIndex = 0): number {
    const rank = BEAST_RANKS[Math.max(0, Math.min(BEAST_RANKS.length - 1, rankIndex))];
    return Math.max(20, Math.round(baseHealth * 1.15 * rank.xpScale));
}

export type SkillCastBlockReason = 'cap' | 'mana' | undefined;

export interface SkillAvailability {
    cost: number;
    canCast: boolean;
    reason: SkillCastBlockReason;
    requiredRealmName: string;
}

export function evaluateSkillAvailability(
    skill: SkillId,
    currentMp: number,
    maxMp: number,
): SkillAvailability {
    const cost = SKILL_MANA_COST[skill];
    const req = requiredRealmForMana(cost);
    if (maxMp < cost) {
        return { cost, canCast: false, reason: 'cap', requiredRealmName: req.name };
    }
    if (currentMp < cost) {
        return { cost, canCast: false, reason: 'mana', requiredRealmName: req.name };
    }
    return { cost, canCast: true, reason: undefined, requiredRealmName: req.name };
}
