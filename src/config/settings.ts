import { detectDevice } from './device';

export type Quality = 'low' | 'medium' | 'high';
export type ArtStyle = 'anime' | 'guofeng';
export const config = { chunkSize: 128, fixedStep: 1 / 120, maxFrame: .1, maxSubSteps: 6, walkSpeed: 6, runSpeed: 11, cruise: 30, slow: 15, boost: 65, clearance: 1.4, predictionSeconds: 3, maxChunks: 150, uploadsPerFrame: 1 };
export const qualities = {
    low: { radius: 3, detail: 24, vegetation: .32, pixelRatio: .8, far: 2400, terrainRange: 200 },
    medium: { radius: 4, detail: 32, vegetation: .65, pixelRatio: 1.0, far: 3500, terrainRange: 272 },
    high: { radius: 5, detail: 48, vegetation: 1, pixelRatio: 1.25, far: 5000, terrainRange: 352 },
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
let cachedArtStyle: ArtStyle | undefined;
export function readArtStyle(): ArtStyle {
    if (cachedArtStyle !== undefined) return cachedArtStyle;
    try {
        const s = localStorage.getItem('yunjing-art-style');
        if (s === 'anime' || s === 'guofeng') {
            cachedArtStyle = s;
            return s;
        }
    } catch {
        // Ignore storage restrictions in private webviews.
    }
    cachedArtStyle = 'guofeng';
    return cachedArtStyle;
}
export function writeArtStyle(style: ArtStyle) {
    cachedArtStyle = style;
    try {
        localStorage.setItem('yunjing-art-style', style);
    } catch {
        // Ignore storage restrictions in private webviews.
    }
}
