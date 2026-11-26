import type { GroundSample } from '../../effects/fireball-trajectory';
import { waterSurfaceAt } from '../geo/geo-core';
import { heightAt, slopeAt, trailDistance } from '../geo/height';
import { meadowHabitatAt } from '../geo/meadow-distribution';
import { floatingFloor } from '../geo/regions';
import { structureFloor } from '../physics/solid-world';
import { valleyFieldsAt } from '../geo/valley-landmarks';
import { villageYardAt } from './village-ground';

/**
 * Classifies the highest physical surface at `(x, z)` below `fromY` for VFX aftermath
 * (fireball scorches, soot decals, water splashes, and sword rain ripples).
 */
export function sampleSurfaceMaterial(x: number, z: number, fromY: number): GroundSample {
    const terrain = heightAt(x, z);
    const rock = structureFloor(x, z, fromY);
    const island = floatingFloor(x, z, fromY);
    const water = waterSurfaceAt(x, z);
    const height = Math.max(terrain, rock, island, water);
    if (height === water) return { height, kind: 'water' };
    if (rock > Math.max(terrain, island) + .18) return { height, kind: 'stone' };
    if (height === island) return { height, kind: 'grass' };
    const slope = slopeAt(x, z);
    const bare = trailDistance(x, z) <= 4.6 || villageYardAt(x, z) >= .22 || valleyFieldsAt(x, z) >= .22;
    if (!bare && meadowHabitatAt(x, z, height, slope).cover > .32) return { height, kind: 'grass' };
    return { height, kind: slope > .68 || height > 278 ? 'stone' : 'soil' };
}

export function sampleSwordRainSurface(floorAt: (x: number, z: number, fromY: number) => number, x: number, z: number, fromY: number) {
    const height = floorAt(x, z, fromY);
    return { height, water: Math.abs(height - waterSurfaceAt(x, z)) < .04 };
}
