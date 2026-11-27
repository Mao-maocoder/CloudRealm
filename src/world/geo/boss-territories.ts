import { smooth, valueNoise } from './height';

export interface BossTerritorySpec {
    readonly id: 'boss1' | 'boss2';
    readonly name: string;
    readonly subtitle: string;
    readonly x: number;
    readonly z: number;
    /** Approximate outer horizontal radius of the placed territory model in metres. */
    readonly radius: number;
    /** Uniform world scale applied to the normalized (~1.12m) GLB asset. */
    readonly scale: number;
    /** Y-axis rotation (radians) to orient the entrance naturally toward the valley. */
    readonly yaw: number;
    /** Extra vertical clearance (m) above the highest terrain point under the inner arena floor. */
    readonly lift: number;
    readonly accentColor: string;
}

/**
 * Two grand Boss Territories on the eastern plain:
 * - 古阵遗台 (boss1): Ancient ruined sword altar with wind-blown crimson cloth on the giant stone sword.
 * - 潜龙晶渊 (boss2): Desolate dragon crystal cavern surrounded by a barren, treeless wasteland.
 * Boss & minion NPCs are intentionally omitted until their skeletal animations are rigged.
 */
export const BOSS_TERRITORIES: readonly BossTerritorySpec[] = [
    {
        id: 'boss1',
        name: '古阵遗台',
        subtitle: '上古剑阵遗迹 · 东原荒台',
        x: 1620,
        z: 150,
        radius: 102,
        scale: 186,
        yaw: -0.65,
        lift: 0.85,
        accentColor: '#7be8e0',
    },
    {
        id: 'boss2',
        name: '潜龙晶渊',
        subtitle: '古龙晶窟 · 荒原灵渊',
        x: 2160,
        z: 480,
        radius: 122,
        scale: 210,
        yaw: 0.42,
        lift: 1.05,
        accentColor: '#68c8ff',
    },
] as const;

/** True when (x, z) lies inside any Boss Territory model footprint (+ optional margin in metres). */
export function inBossTerritory(x: number, z: number, margin = 0): boolean {
    for (const t of BOSS_TERRITORIES) {
        const r = t.radius + margin;
        const dx = x - t.x;
        const dz = z - t.z;
        if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
}

/**
 * Clears trees cleanly inside boss1's ruin clearing and carves a wide, organic, desolate
 * treeless wasteland (~330m–410m) around the Dragon Lair (boss2) so it feels stark and ominous.
 */
export function bossTreeClearance(x: number, z: number, margin = 0): boolean {
    // 1. Ancient Sword Altar clearing (organic 128m..168m boundary)
    const b1 = BOSS_TERRITORIES[0];
    const d1 = Math.hypot(x - b1.x, z - b1.z);
    if (d1 < b1.radius + 26 + margin) return true;
    if (d1 < b1.radius + 72) {
        const n = valueNoise(x * 0.015, z * 0.015, 731);
        if (d1 < b1.radius + 26 + n * 46) return true;
    }

    // 2. Dragon Lair desolate wasteland: completely treeless inside 295m, sparsely thinning out to 415m
    const b2 = BOSS_TERRITORIES[1];
    const d2 = Math.hypot(x - b2.x, z - b2.z);
    if (d2 < 295 + margin) return true;
    if (d2 < 425) {
        const n = valueNoise(x * 0.011, z * 0.011, 743);
        const sparsity = 1 - smooth(295, 425, d2);
        if (n < sparsity * 0.92) return true;
    }
    return false;
}

/**
 * Smooth meadow grass mask:
 * - boss1: clears tall grass inside the stone altar (r < 0.78 R), feathering gently across the mossy skirt.
 * - boss2: suppresses lush valley grass across the desolate dragon wasteland (r < 215m..330m).
 */
export function bossTerritoryGrassMask(x: number, z: number): number {
    const b1 = BOSS_TERRITORIES[0];
    const d1 = Math.hypot(x - b1.x, z - b1.z);
    let mask = 1;
    if (d1 < b1.radius * 1.12) {
        mask = Math.min(mask, smooth(b1.radius * 0.78, b1.radius * 1.06, d1));
    }

    const b2 = BOSS_TERRITORIES[1];
    const d2 = Math.hypot(x - b2.x, z - b2.z);
    if (d2 < 350) {
        const warp = (valueNoise(x * 0.014, z * 0.014, 757) - 0.5) * 65;
        mask = Math.min(mask, smooth(195, 325, d2 + warp));
    }
    return mask;
}

/** Returns the Boss Territory if the player/camera is within its visual landmark zone (~1.9x radius). */
export function bossTerritoryAt(x: number, z: number): BossTerritorySpec | undefined {
    for (const t of BOSS_TERRITORIES) {
        const d = Math.hypot(x - t.x, z - t.z);
        if (d < t.radius * 1.9) return t;
    }
    return undefined;
}

/**
 * GLSL helpers injected into `terrain-material.ts` to paint:
 * - `.x`: wide desolate weathered ash-slate / dry ochre wasteland around the Dragon Lair (boss2)
 * - `.y`: subtle weathered ancient stone-earth clearing around the Sword Altar (boss1)
 */
export const bossWastelandGLSL = `
vec2 bossGroundWeights(vec2 p, float nWarp) {
    float d2 = length(p - vec2(2160., 480.)) + (nWarp - 0.5) * 82.;
    float dragonWaste = 1. - smoothstep(145., 375., d2);
    float d1 = length(p - vec2(1620., 150.)) + (nWarp - 0.5) * 42.;
    float ruinEarth = 1. - smoothstep(82., 168., d1);
    return vec2(dragonWaste, ruinEarth);
}
`;
