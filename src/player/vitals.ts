import { MathUtils } from 'three';
import {
    computeRealmStats,
    evaluateSkillAvailability,
    FIREBALL_CHARGE_EXTRA_COST,
    mitigateIncomingDamage,
    PILL_XP_BONUS,
    REALMS,
    SKILL_LABEL,
    SKILL_MANA_COST,
    type CultivationStats,
    type SkillAvailability,
    type SkillId,
} from './cultivation';

const STORAGE_KEY = 'yunjing-cultivation-v2';

interface SavedCultivation {
    realmIndex: number;
    stageIndex: number;
    xp: number;
}

export interface VitalsSnapshot {
    hp: number;
    maxHp: number;
    hpPct: number;
    mp: number;
    maxMp: number;
    mpPct: number;
    sp: number;
    maxSp: number;
    spPct: number;
    xp: number;
    needXp: number;
    xpPct: number;
    canBreakthrough: boolean;
    nextRealmName?: string;
    stats: CultivationStats;
    skills: Record<SkillId, SkillAvailability>;
}

/**
 * Encapsulates player cultivation progression (炼气一~九层 / 筑基 / 结丹 / 元婴),
 * formula-driven HP / MP / SP / ATK / DEF / CRIT / Power, skill & flight mana gating,
 * consumable effects, and short-lived HUD combat notices.
 */
export class PlayerVitals {
    realmIndex = 0;
    stageIndex = 0;
    xp = 0;
    stats: CultivationStats;
    hp: number;
    mp: number;
    sp: number;

    private lastInjury = -Infinity;
    private lastCastTime = -Infinity;
    private message = '';
    private messageUntil = 0;

    constructor(loadSaved = true) {
        if (loadSaved) this.restore();
        this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
        this.hp = this.stats.maxHp;
        this.mp = this.stats.maxMp;
        this.sp = this.stats.maxSp;
    }

    /** Normalized 0..100 health percentage for HUD compatibility. */
    get health(): number {
        return (this.hp / Math.max(1, this.stats.maxHp)) * 100;
    }

    /** Normalized 0..100 spirit/mana percentage. */
    get spirit(): number {
        return (this.mp / Math.max(1, this.stats.maxMp)) * 100;
    }

    /** Normalized 0..100 stamina percentage. */
    get stamina(): number {
        return (this.sp / Math.max(1, this.stats.maxSp)) * 100;
    }

    get canBreakthrough(): boolean {
        return this.stats.isPeakOfRealm && this.xp >= this.stats.needXp;
    }

    private persist() {
        try {
            if (typeof localStorage === 'undefined') return;
            const payload: SavedCultivation = {
                realmIndex: this.realmIndex,
                stageIndex: this.stageIndex,
                xp: Math.floor(this.xp),
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {}
    }

    private restore() {
        try {
            if (typeof localStorage === 'undefined') return;
            const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('yunjing-cultivation-v1');
            if (!raw) return;
            const parsed = JSON.parse(raw) as Partial<SavedCultivation>;
            if (typeof parsed.realmIndex === 'number' && Number.isFinite(parsed.realmIndex)) {
                this.realmIndex = MathUtils.clamp(Math.floor(parsed.realmIndex), 0, REALMS.length - 1);
            }
            const maxStage = REALMS[this.realmIndex].stages.length - 1;
            if (typeof parsed.stageIndex === 'number' && Number.isFinite(parsed.stageIndex)) {
                this.stageIndex = MathUtils.clamp(Math.floor(parsed.stageIndex), 0, maxStage);
            }
            if (typeof parsed.xp === 'number' && Number.isFinite(parsed.xp) && parsed.xp >= 0) {
                this.xp = parsed.xp;
            }
        } catch {}
    }

    announce(text: string, now: number, duration = 2.4) {
        this.message = text;
        this.messageUntil = now + duration;
    }

    /** Evaluates whether a skill can be cast under the current realm's MaxMP & live MP. */
    checkSkill(skill: SkillId): SkillAvailability {
        return evaluateSkillAvailability(skill, this.mp, this.stats.maxMp);
    }

    /** Checks mana availability and posts an explicit Xianxia HUD notice if blocked. */
    canCastSkill(skill: SkillId, now: number, notify = true): boolean {
        const status = this.checkSkill(skill);
        if (status.canCast) return true;
        if (notify) {
            const label = SKILL_LABEL[skill];
            if (status.reason === 'cap') {
                this.announce(
                    `${label}需 ${status.cost} 灵力 · 当前上限 ${this.stats.maxMp} 不足，请突破至${status.requiredRealmName}期`,
                    now,
                    3.0,
                );
            } else {
                this.announce(
                    `灵力不足 · ${label}需 ${status.cost}，当前 ${Math.floor(this.mp)}`,
                    now,
                    2.0,
                );
            }
        }
        return false;
    }

    /** Deducts a skill's mana cost when cast begins (returns false if insufficient). */
    spendSkillMana(skill: SkillId, now: number, extraMana = 0): boolean {
        if (!this.canCastSkill(skill, now, true)) return false;
        const total = SKILL_MANA_COST[skill] + Math.max(0, extraMana);
        this.mp = Math.max(0, this.mp - total);
        this.lastCastTime = now;
        return true;
    }

    /** Deducts extra mana proportional to Fireball charge power (0..1) on release. */
    spendFireballCharge(power: number, now: number) {
        const extra = Math.round(MathUtils.clamp(power, 0, 1) * FIREBALL_CHARGE_EXTRA_COST);
        if (extra > 0) {
            this.mp = Math.max(0, this.mp - extra);
            this.lastCastTime = now;
        }
    }

    /** Checks whether the player has enough spirit to initiate sword flight / void flight. */
    canStartFlight(now: number, notify = true): boolean {
        const minMp = this.stats.flight.minMp;
        if (this.mp >= minMp) return true;
        if (notify) {
            const modeLabel = this.stats.flight.mode === 'void' ? '御空飞行' : '御剑飞行';
            this.announce(`灵力不足 · ${modeLabel}需至少 ${minMp} 灵力`, now, 2.2);
        }
        return false;
    }

    /** Drains low continuous mana during flight; returns false when spirit runs out. */
    drainFlightMana(dt: number, intensity: 'hover' | 'cruise' | 'boost', now: number): boolean {
        const f = this.stats.flight;
        const rate = intensity === 'boost' ? f.boostDrain : intensity === 'cruise' ? f.cruiseDrain : f.hoverDrain;
        this.mp = Math.max(0, this.mp - rate * dt);
        this.lastCastTime = now;
        if (this.mp <= 0.01) {
            this.mp = 0;
            this.announce(f.mode === 'void' ? '灵力耗尽 · 遁光散去，暂落凡尘' : '灵力耗尽 · 收剑落地调息', now, 2.6);
            return false;
        }
        return true;
    }

    /** Applies heavy cultivation Divine Sense backlash (direct % MaxHP & % MaxMP loss, non-lethal floor 1 HP). */
    applyDivineSenseBacklash(hpRatio: number, mpRatio: number, now: number, notice?: string) {
        const hpLoss = Math.round(this.stats.maxHp * MathUtils.clamp(hpRatio, 0, 0.95));
        const mpLoss = Math.round(this.stats.maxMp * MathUtils.clamp(mpRatio, 0, 1));
        this.hp = Math.max(1, this.hp - hpLoss);
        this.mp = Math.max(0, this.mp - mpLoss);
        this.lastInjury = now;
        this.lastCastTime = now;
        if (notice) {
            this.announce(notice, now, 4.2);
        }
    }

    /** Rolls player outgoing damage multiplier (ATK ratio × optional critical hit 1.5x). */
    rollDamageScale(): { scale: number; crit: boolean } {
        const crit = Math.random() < this.stats.critRate;
        return { scale: this.stats.damageScale * (crit ? 1.5 : 1), crit };
    }

    /** Adds cultivation XP, auto-advancing minor stages and flagging major-realm bottlenecks. */
    gainXp(amount: number, now: number, sourceLabel?: string) {
        if (amount <= 0 || this.stats.isMaxTier) return;
        this.xp += amount;

        let advancedStage = false;
        while (!this.stats.isMaxTier && !this.stats.isPeakOfRealm && this.xp >= this.stats.needXp) {
            this.xp -= this.stats.needXp;
            this.stageIndex++;
            this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
            this.hp = this.stats.maxHp;
            this.mp = this.stats.maxMp;
            this.sp = this.stats.maxSp;
            advancedStage = true;
        }

        if (this.stats.isPeakOfRealm && this.xp >= this.stats.needXp) {
            this.xp = this.stats.needXp;
            const nextRealm = REALMS[this.realmIndex + 1];
            this.announce(`修为圆满 · 按 B 突破至【${nextRealm.name}${nextRealm.stages[0]}】`, now, 3.8);
        } else if (advancedStage) {
            this.announce(`修为精进 · 晋升至【${this.stats.fullLabel}】`, now, 3.2);
        } else if (sourceLabel) {
            this.announce(`${sourceLabel} · 修为 +${Math.round(amount)}`, now, 1.9);
        }
        this.persist();
    }

    /** Fills XP to the current bottleneck for quick testing in Settings. */
    fillToBreakthrough(now: number) {
        if (this.stats.isMaxTier) {
            this.announce('已臻元婴大圆满 · 灵海通天', now, 2.2);
            return;
        }
        const maxStage = REALMS[this.realmIndex].stages.length - 1;
        this.stageIndex = maxStage;
        this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
        this.xp = this.stats.needXp;
        this.hp = this.stats.maxHp;
        this.mp = this.stats.maxMp;
        this.sp = this.stats.maxSp;
        if (this.stats.isPeakOfRealm) {
            const nextRealm = REALMS[this.realmIndex + 1];
            this.announce(`修为已圆满 · 按 B 突破至【${nextRealm.name}${nextRealm.stages[0]}】`, now, 3.4);
        } else {
            this.announce(`已臻【${this.stats.fullLabel}】`, now, 2.6);
        }
        this.persist();
    }

    /** Attempts a major-realm breakthrough when at a peak bottleneck (炼气九层 / 各境大圆满). */
    attemptBreakthrough(now: number): boolean {
        if (!this.canBreakthrough) {
            if (this.stats.isMaxTier) {
                this.announce('已臻元婴大圆满 · 灵海通天', now, 2.2);
            } else {
                const remain = Math.max(0, Math.ceil(this.stats.needXp - this.xp));
                this.announce(`修为尚未圆满 · 还差 ${remain} 点修为`, now, 2.2);
            }
            return false;
        }
        this.realmIndex++;
        this.stageIndex = 0;
        this.xp = 0;
        this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
        this.hp = this.stats.maxHp;
        this.mp = this.stats.maxMp;
        this.sp = this.stats.maxSp;

        const unlockHint = this.realmIndex === 1
            ? ' · 已可催动【巨剑术】，御剑提速'
            : this.realmIndex === 2
                ? ' · 已可结阵【万剑归宗】，全速御剑'
                : this.realmIndex === 3
                    ? ' · 肉身御空，遁光破空、踏空而行'
                    : '';
        this.announce(`破境成功 · 踏入【${this.stats.fullLabel}】${unlockHint}`, now, 4.4);
        this.persist();
        return true;
    }

    /** Direct realm setter for quick testing of all 4 major realms. */
    setRealm(realmIndex: number, stageIndex = 0, now = 0) {
        this.realmIndex = MathUtils.clamp(Math.floor(realmIndex), 0, REALMS.length - 1);
        const maxStage = REALMS[this.realmIndex].stages.length - 1;
        this.stageIndex = MathUtils.clamp(Math.floor(stageIndex), 0, maxStage);
        this.xp = 0;
        this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
        this.hp = this.stats.maxHp;
        this.mp = this.stats.maxMp;
        this.sp = this.stats.maxSp;
        if (now > 0) {
            const extra = this.realmIndex === 3 ? ' · 解锁遁光御空与踏空(V)' : '';
            this.announce(`境界切换至【${this.stats.fullLabel}】· 灵力 ${this.stats.maxMp} · 法术威力 ×${this.stats.damageScale.toFixed(2)}${extra}`, now, 3.2);
        }
        this.persist();
    }

    /** Advances exactly one minor stage (or breaks through to the next major realm) for quick testing. */
    advanceOneTier(now = 0): boolean {
        if (this.stats.isMaxTier) {
            if (now > 0) this.announce('已臻元婴大圆满 · 灵海通天', now, 2.2);
            return false;
        }
        const maxStage = REALMS[this.realmIndex].stages.length - 1;
        if (this.stageIndex < maxStage) {
            this.stageIndex++;
        } else {
            this.realmIndex++;
            this.stageIndex = 0;
        }
        this.xp = 0;
        this.stats = computeRealmStats(this.realmIndex, this.stageIndex);
        this.hp = this.stats.maxHp;
        this.mp = this.stats.maxMp;
        this.sp = this.stats.maxSp;
        if (now > 0) {
            this.announce(`一键晋升【${this.stats.fullLabel}】· 灵力 ${this.stats.maxMp} · 法术威力 ×${this.stats.damageScale.toFixed(2)}`, now, 3.0);
        }
        this.persist();
        return true;
    }

    receiveHit(rawDamage: number, attackerName: string, now: number, minCooldown = .72): boolean {
        if (now - this.lastInjury < minCooldown || this.hp <= 0) return false;
        const scaledRaw = rawDamage * 2.6;
        const finalDamage = mitigateIncomingDamage(scaledRaw, this.stats.def);
        this.hp = Math.max(0, this.hp - finalDamage);
        this.lastInjury = now;
        this.announce(`${attackerName} · −${finalDamage}`, now, minCooldown < 0.4 ? 1.1 : 1.7);
        return true;
    }

    /** Consumes mana when opening Divine Sense (initial scan wave). */
    spendSensePulse(now: number): boolean {
        const cost = this.stats.sensePulseCost;
        if (this.mp < cost) {
            this.announce(`灵力不足 · 开启神识需 ${cost} 灵力`, now, 2.0);
            return false;
        }
        this.mp = Math.max(0, this.mp - cost);
        this.lastCastTime = now;
        return true;
    }

    /** Continuously drains gentle mana while Divine Sense stays open; returns false when spirit runs out. */
    drainSenseMana(dt: number, now: number): boolean {
        const rate = this.stats.senseDrain;
        if (rate <= 0) return true;
        this.mp = Math.max(0, this.mp - rate * dt);
        this.lastCastTime = now;
        if (this.mp <= 0.5) {
            this.mp = 0;
            this.announce('灵力耗尽 · 神识自动收回', now, 2.6);
            return false;
        }
        return true;
    }

    /** Checks minimum mana & realm gating to enter out-of-body Astral Divine Sense. */
    canStartAstral(now: number): boolean {
        if (!this.stats.canAstralProject) {
            this.announce('神识尚未化液 · 踏入【结丹期】方可神识离体漫游', now, 2.8);
            return false;
        }
        const minMp = Math.max(25, this.stats.senseAstralDrain * 2);
        if (this.mp < minMp) {
            this.announce(`灵力不足 · 神识离体至少需 ${minMp} 灵力`, now, 2.2);
            return false;
        }
        return true;
    }

    /** Drains gentle mana per second while consciousness is projected away from the body. */
    drainAstralMana(dt: number, now: number): boolean {
        const rate = this.stats.senseAstralDrain;
        if (rate <= 0) return true;
        this.mp = Math.max(0, this.mp - rate * dt);
        this.lastCastTime = now;
        if (this.mp <= 0.5) {
            this.mp = 0;
            this.announce('灵力耗尽 · 离体神识已归位', now, 2.6);
            return false;
        }
        return true;
    }

    useItem(kind: 'heal' | 'pill', now: number) {
        if (kind === 'heal') {
            const gain = Math.round(this.stats.maxHp * 0.45);
            this.hp = Math.min(this.stats.maxHp, this.hp + gain);
            this.announce(`服下回复药 · 生命 +${gain}`, now, 2.2);
        } else {
            const mpGain = Math.round(this.stats.maxMp * 0.65);
            this.mp = Math.min(this.stats.maxMp, this.mp + mpGain);
            this.sp = this.stats.maxSp;
            if (!this.stats.isMaxTier) {
                this.gainXp(PILL_XP_BONUS, now);
                if (!this.canBreakthrough) {
                    this.announce(`服下筑基丹 · 灵力 +${mpGain} · 修为 +${PILL_XP_BONUS}`, now, 2.6);
                }
            } else {
                this.announce(`服下筑基丹 · 灵力 +${mpGain} · 体力回满`, now, 2.2);
            }
        }
    }

    /** Steps HP/MP/SP regeneration & gentle ambient meditation XP, returning true on exhaustion respawn. */
    step(dt: number, now: number, activeSkill: boolean, exerting: boolean, calm = false, flying = false): boolean {
        let exhausted = false;
        if (this.hp <= 0) {
            this.hp = this.stats.maxHp;
            this.mp = this.stats.maxMp;
            this.sp = this.stats.maxSp;
            this.announce('力竭 · 已回到长风谷', now, 3.5);
            exhausted = true;
        } else if (now - this.lastInjury > 8 && this.hp < this.stats.maxHp) {
            this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * 0.055 * dt);
        }

        // Natural spirit regeneration pauses during active casts or active flight
        if (!activeSkill && !flying && now - this.lastCastTime > 0.45 && this.mp < this.stats.maxMp) {
            this.mp = Math.min(this.stats.maxMp, this.mp + this.stats.mpRegen * dt);
        }

        const spRate = exerting ? -14 : 20;
        this.sp = MathUtils.clamp(this.sp + spRate * dt, 0, this.stats.maxSp);

        // Passive ambient heaven-and-earth qi intake while calm & not at breakthrough cap
        if (calm && !activeSkill && !exerting && !flying && now - this.lastInjury > 5 && !this.stats.isMaxTier) {
            const passiveRate = REALMS[this.realmIndex].idleXpRate;
            if (!this.stats.isPeakOfRealm || this.xp < this.stats.needXp) {
                const nextXp = this.xp + passiveRate * dt;
                if (this.stats.isPeakOfRealm) {
                    const reached = this.xp < this.stats.needXp && nextXp >= this.stats.needXp;
                    this.xp = Math.min(this.stats.needXp, nextXp);
                    if (reached) {
                        const nextRealm = REALMS[this.realmIndex + 1];
                        this.announce(`吐纳圆满 · 按 B 突破至【${nextRealm.name}${nextRealm.stages[0]}】`, now, 3.6);
                        this.persist();
                    }
                } else if (nextXp >= this.stats.needXp) {
                    this.gainXp(passiveRate * dt, now);
                } else {
                    this.xp = nextXp;
                }
            }
        }
        return exhausted;
    }

    snapshot(): VitalsSnapshot {
        const s = this.stats;
        const nextRealmName = s.realmIndex < REALMS.length - 1 ? REALMS[s.realmIndex + 1].name : undefined;
        return {
            hp: Math.round(this.hp),
            maxHp: s.maxHp,
            hpPct: (this.hp / Math.max(1, s.maxHp)) * 100,
            mp: Math.round(this.mp),
            maxMp: s.maxMp,
            mpPct: (this.mp / Math.max(1, s.maxMp)) * 100,
            sp: Math.round(this.sp),
            maxSp: s.maxSp,
            spPct: (this.sp / Math.max(1, s.maxSp)) * 100,
            xp: Math.floor(this.xp),
            needXp: s.needXp,
            xpPct: s.isMaxTier ? 100 : Math.min(100, (this.xp / Math.max(1, s.needXp)) * 100),
            canBreakthrough: this.canBreakthrough,
            nextRealmName,
            stats: s,
            skills: {
                swordWave: this.checkSkill('swordWave'),
                fireball: this.checkSkill('fireball'),
                giantSword: this.checkSkill('giantSword'),
                swordArray: this.checkSkill('swordArray'),
            },
        };
    }

    activeNotice(now: number): string {
        return now < this.messageUntil ? this.message : '';
    }
}
