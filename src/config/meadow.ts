/** Candidate density, geometry and hand-over distances. These do not change flight or terrain. */
export const meadowQuality={low:.45,medium:.85,high:1.15} as const;
export const meadowLayers=[
   {kind:'slender',type:0,leaves:3,density:64,segs:4,width:.022,height:.46,span:40,fade:[-1,0,14,20],root:1},
   {kind:'curved',type:1,leaves:3,density:28,segs:5,width:.032,height:.68,span:42,fade:[-1,0,15,21],root:1},
   {kind:'tuft',type:2,leaves:4,density:18,segs:4,width:.036,height:.78,span:42,fade:[-1,0,15,21],root:1},
   {kind:'mid',type:1,leaves:3,density:16,segs:2,width:.070,height:.66,span:172,fade:[14,20,68,84],root:.84},
   {kind:'far',type:1,leaves:3,density:5.8,segs:2,width:.165,height:.74,span:296,fade:[64,78,128,150],root:.66},
   {kind:'flowers',type:0,leaves:1,density:9.5,segs:0,width:.095,height:.68,span:66,fade:[-1,0,24,32],root:1},
   {kind:'flowers',type:1,leaves:1,density:3.2,segs:0,width:.22,height:.68,span:200,fade:[24,32,82,104],root:1}] as const;
