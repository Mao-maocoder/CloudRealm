/** Candidate density, geometry and hand-over distances. These do not change flight or terrain. */
export const meadowQuality={low:.24,medium:.46,high:.78} as const;
export const meadowLayers=[
   {kind:'slender',type:0,leaves:3,density:36,segs:2,width:.030,height:.46,span:36,fade:[-1,0,13,18],root:1},
   {kind:'curved',type:1,leaves:3,density:16,segs:2,width:.041,height:.68,span:38,fade:[-1,0,14,19],root:1},
   {kind:'tuft',type:2,leaves:3,density:10,segs:2,width:.046,height:.78,span:38,fade:[-1,0,14,19],root:1},
   {kind:'mid',type:1,leaves:2,density:8.2,segs:1,width:.105,height:.66,span:164,fade:[13,18,64,80],root:.84},
   {kind:'far',type:1,leaves:1,density:3.0,segs:1,width:.255,height:.74,span:288,fade:[60,74,124,146],root:.66},
   {kind:'flowers',type:0,leaves:1,density:6.0,segs:0,width:.112,height:.68,span:60,fade:[-1,0,22,30],root:1},
   {kind:'flowers',type:1,leaves:1,density:1.7,segs:0,width:.260,height:.68,span:192,fade:[22,30,78,100],root:1}] as const;
