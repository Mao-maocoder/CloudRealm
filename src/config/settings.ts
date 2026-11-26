import { detectDevice } from './device';

export type Quality = 'low' | 'medium' | 'high';
export const config = { chunkSize: 128, fixedStep: 1 / 120, maxFrame: .1, maxSubSteps: 6, walkSpeed: 6, runSpeed: 11, cruise: 30, slow: 15, boost: 65, clearance: 1.4, predictionSeconds: 3, maxChunks: 150, uploadsPerFrame: 2 };
export const qualities = {
    low: { radius: 3, detail: 24, vegetation: .4, pixelRatio: .85, far: 2800, terrainRange: 224 },
    medium: { radius: 4, detail: 32, vegetation: .7, pixelRatio: 1.15, far: 3700, terrainRange: 288 },
    high: { radius: 5, detail: 48, vegetation: 1, pixelRatio: 1.5, far: 5000, terrainRange: 352 },
};
export function readQuality(): Quality {
    try {
        const q = localStorage.getItem('yunjing-quality');
        if (q === 'low' || q === 'medium' || q === 'high') return q;
    } catch {
        // Ignore storage restrictions in private webviews.
    }
    return detectDevice().isMobile ? 'low' : 'medium';
}
