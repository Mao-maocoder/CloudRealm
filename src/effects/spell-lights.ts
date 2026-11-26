import * as T from 'three';

export interface SpellLightRequest {
    x: number;
    y: number;
    z: number;
    color: number;
    intensity: number;
    distance: number;
    priority: number;
    castShadow?: boolean;
}

const HERO_SHADOW_SLOTS = 2;
const FILL_SLOTS = 4;
const TOTAL_SLOTS = HERO_SHADOW_SLOTS + FILL_SLOTS;

/** Shared uniforms exposing the top 2 active spell lights to custom shaders (e.g., Water reflections). */
export const spellLightUniforms = {
    uSpellLightPos: { value: [new T.Vector4(0, -9999, 0, 1), new T.Vector4(0, -9999, 0, 1)] },
    uSpellLightCol: { value: [new T.Vector4(0, 0, 0, 0), new T.Vector4(0, 0, 0, 0)] },
};

/**
 * Fixed-size pool of dynamic PointLights for emissive spell VFX (sword waves,
 * fireball seals, flying fireballs, explosions, and sword array).
 *
 * `castShadow` flags change only when the quality setting changes, while
 * `shadow.autoUpdate = false` ensures idle shadow slots cost zero cubemap passes.
 */
export class SpellLightPool {
    private readonly lights: T.PointLight[] = [];
    private readonly requests: SpellLightRequest[] = [];
    private readonly tmpColor = new T.Color();
    private heroShadowSlots = 0;
    private shadowEnabled = true;

    constructor(scene: T.Scene, shadowMapSize = 512, heroShadowSlots = HERO_SHADOW_SLOTS) {
        for (let i = 0; i < TOTAL_SLOTS; i++) {
            const light = new T.PointLight(0xffffff, 0, 24, 2);
            light.name = `SpellFillLight_${i}`;
            light.position.set(0, -9999, 0);
            if (i < HERO_SHADOW_SLOTS) {
                light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
                light.shadow.camera.near = 0.35;
                light.shadow.camera.far = 32;
                light.shadow.bias = -0.0018;
                light.shadow.normalBias = 0.05;
                // Only render the 6-face shadow cubemap on frames when this slot is actively lit.
                light.shadow.autoUpdate = false;
                light.shadow.needsUpdate = false;
            }
            scene.add(light);
            this.lights.push(light);
        }
        this.setShadowSlots(heroShadowSlots);
    }

    setShadowSlots(slots: number) {
        const count = Math.max(0, Math.min(HERO_SHADOW_SLOTS, slots));
        if (count === this.heroShadowSlots) return;
        this.heroShadowSlots = count;
        for (const [i, light] of this.lights.entries()) {
            light.castShadow = i < count;
            light.name = light.castShadow ? `SpellHeroLight_${i}` : `SpellFillLight_${i - count}`;
            if (!light.castShadow && light.shadow.map) {
                light.shadow.map.dispose();
                light.shadow.map = null;
            }
            light.shadow.needsUpdate = false;
        }
    }

    setShadowEnabled(enabled: boolean) {
        this.shadowEnabled = enabled;
    }

    beginFrame() {
        this.requests.length = 0;
    }

    emit(request: SpellLightRequest) {
        if (request.intensity <= 0.01 || request.distance <= 0.1) return;
        this.requests.push(request);
    }

    commit(nightFactor: number, duskFactor: number) {
        // Subtle light spill in bright daytime; balanced, atmospheric glow at dusk/night without overexposing.
        const timeBoost = 0.55 + duskFactor * 0.25 + nightFactor * 0.45;

        if (this.requests.length > 1) {
            this.requests.sort((a, b) => (b.priority - a.priority) || (b.intensity - a.intensity));
        }

        const fillSlots = TOTAL_SLOTS - this.heroShadowSlots;
        const shadowReqs: SpellLightRequest[] = [];
        const fillReqs: SpellLightRequest[] = [];
        for (const req of this.requests) {
            if (req.castShadow !== false && shadowReqs.length < this.heroShadowSlots) {
                shadowReqs.push(req);
            } else if (fillReqs.length < fillSlots) {
                fillReqs.push(req);
            } else if (shadowReqs.length < this.heroShadowSlots) {
                shadowReqs.push(req);
            }
        }

        // Assign hero shadow-casting PointLights (slots 0..heroShadowSlots-1).
        for (let i = 0; i < this.heroShadowSlots; i++) {
            const light = this.lights[i];
            const req = shadowReqs[i];
            if (req) {
                light.position.set(req.x, req.y, req.z);
                light.color.setHex(req.color);
                light.intensity = req.intensity * timeBoost;
                light.distance = req.distance;
                light.shadow.camera.far = Math.max(12, Math.min(40, req.distance));
                light.shadow.camera.updateProjectionMatrix();
                light.shadow.needsUpdate = this.shadowEnabled && req.castShadow !== false;
            } else {
                light.intensity = 0;
                light.shadow.needsUpdate = false;
            }
        }

        // Assign non-shadow fill PointLights (slots heroShadowSlots..TOTAL_SLOTS-1).
        for (let i = 0; i < fillSlots; i++) {
            const light = this.lights[this.heroShadowSlots + i];
            const req = fillReqs[i];
            if (req) {
                light.position.set(req.x, req.y, req.z);
                light.color.setHex(req.color);
                light.intensity = req.intensity * timeBoost;
                light.distance = req.distance;
            } else {
                light.intensity = 0;
            }
        }

        // Sync top 2 active spell lights to shader uniforms for custom surfaces (water reflections).
        const posArr = spellLightUniforms.uSpellLightPos.value;
        const colArr = spellLightUniforms.uSpellLightCol.value;
        for (let i = 0; i < 2; i++) {
            const req = this.requests[i];
            if (req) {
                this.tmpColor.setHex(req.color);
                posArr[i].set(req.x, req.y, req.z, Math.max(4, req.distance));
                colArr[i].set(this.tmpColor.r, this.tmpColor.g, this.tmpColor.b, Math.min(1.15, Math.sqrt(req.intensity * timeBoost) * 0.20));
            } else {
                posArr[i].set(0, -9999, 0, 1);
                colArr[i].set(0, 0, 0, 0);
            }
        }
    }

    dispose() {
        for (const light of this.lights) {
            light.shadow?.map?.dispose();
            light.removeFromParent();
        }
        this.lights.length = 0;
        this.requests.length = 0;
        for (let i = 0; i < 2; i++) {
            spellLightUniforms.uSpellLightPos.value[i].set(0, -9999, 0, 1);
            spellLightUniforms.uSpellLightCol.value[i].set(0, 0, 0, 0);
        }
    }
}
