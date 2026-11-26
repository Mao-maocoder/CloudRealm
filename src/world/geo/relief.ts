// Compatibility API: geography now comes from WorldPlan, not per-biome target heights.
export{upliftAt,waterLevelAt}from './geo-core';
export{geographyGLSL as reliefGLSL}from './geo-core';
/** Legacy hook retained for callers; new terrain is authored in geo-core.ts. */
export function modifyHeight(_x:number,_z:number,base:number){return base;}
