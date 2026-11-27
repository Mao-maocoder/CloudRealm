import { smooth, waterLevelAt, waterSurfaceAt } from './geo-core';
import { valueNoise } from './height';

// The shared landscape field runs from the upper tributary to the bay. Its
// fringe also covers the western hills that appear behind the main river.
export const corridorField={left:-1504,north:-2192,step:8,width:379,depth:482};

type Belt = readonly [x:number,z:number,length:number,width:number,angle:number];
const woodlandBelts:Belt[]=[
    [-462,-563,238,129,.76],[-325,-153,151,88,1.18],[-533,155,227,99,1.08],
    [-340,487,206,118,.78],[-181,827,237,110,-.39],[-92,1259,192,102,-.23],
    [228,-476,198,104,-.54],[600,-654,199,107,-.24],[787,-273,253,128,-.65],
    [406,-23,239,108,-.67],[277,326,177,108,.26],[369,602,206,94,-.58],
    [687,534,210,124,.88],[852,869,208,111,.28],[807,1228,214,110,-.44],
    [-164,-1354,168,70,-.61],[-243,-1572,140,85,.78],
    [215,-1392,134,58,.46],[274,-1768,143,66,.70],[-154,-2058,118,57,.53],
];
const meadowGlades:Belt[]=[
    [117,206,171,103,.22],[643,-452,153,96,-.28],[-250,295,176,104,-.36],
    [-163,645,177,102,.61],[70,1013,210,125,.84],[220,1360,325,134,-.14],
    [124,-1564,92,50,.24],[9,-1841,160,90,1.3],
];

// Ribbons follow foothill creases and connect with irregular lower groves.
// They leave the plain between the west forest and the river open.
const forestSpines=[
    [[-1250,-791,197],[-1054,-589,148],[-1110,-363,131],[-880,-184,162],[-933,49,115],[-791,281,145]],
    [[-1244,179,136],[-1149,414,184],[-947,606,142],[-1001,823,152],[-841,1069,142],[-637,1253,125]],
    [[-605,-498,116],[-491,-290,85],[-552,-97,82],[-466,109,93],[-577,259,105]],
    [[-493,588,105],[-411,795,111],[-283,944,90],[-102,1015,68],[21,918,64],[156,900,58]],
    [[1017,-774,105],[923,-578,114],[767,-397,77],[801,-232,93],[716,-119,80],[638,51,88]],
    [[831,352,120],[903,524,141],[790,691,99],[849,811,75],[802,1024,58],[771,1249,83]],
    [[115,469,70],[182,537,66],[234,661,94],[302,731,67],[474,734,80],[546,646,112]],
    [[-1400,650,139],[-1270,485,112],[-1220,278,95],[-1165,147,112],[-1250,-62,117],[-1120,-275,152]],
    [[-965,408,118],[-784,288,132],[-711,110,83],[-660,-134,78],[-835,-312,137]],
    [[-1135,-571,141],[-1027,-737,112],[-916,-884,85],[-805,-964,119]],
    [[-1330,-1330,127],[-1164,-1260,141],[-1020,-1380,101],[-898,-1497,127],[-692,-1580,99],[-518,-1658,103],[-288,-1690,93]],
    [[-510,-1018,110],[-336,-1048,115],[-276,-1170,108],[-222,-1296,77],[-160,-1484,93],[-185,-1696,92]],
    [[277,-1521,118],[418,-1529,133],[621,-1377,146],[808,-1306,139],[976,-1151,142]],
    [[112,-950,87],[209,-841,95],[340,-814,105],[479,-865,96],[654,-902,89]],
    [[29,-662,88],[121,-537,105],[209,-472,93],[292,-435,84]],
    [[532,-165,89],[406,-122,115],[292,-21,87],[226,53,72]],
 ] as const;
const forestSegments=forestSpines.flatMap(line=>line.slice(1).map(([x,z,width],i)=>{
    const [px,pz,from]=line[i],dx=x-px,dz=z-pz,max=Math.max(width,from);
    return {x:px,z:pz,dx,dz,inv:1/(dx*dx+dz*dz),from,to:width,
        left:Math.min(x,px)-max,right:Math.max(x,px)+max,north:Math.min(z,pz)-max,south:Math.max(z,pz)+max};
}));

function corridorForestAt(x:number,z:number) {
    let strength=0;
    for(const segment of forestSegments){
        if(x<segment.left||x>segment.right||z<segment.north||z>segment.south)continue;
        const dx=x-segment.x,dz=z-segment.z;
        const t=Math.min(1,Math.max(0,(dx*segment.dx+dz*segment.dz)*segment.inv));
        const distance=Math.hypot(dx-segment.dx*t,dz-segment.dz*t);
        const width=segment.from+(segment.to-segment.from)*t;
        strength=Math.max(strength,1-smooth(.27,1,distance/width));
    }
    return strength;
}

function masks(belts:Belt[]) {
    return belts.map(([x,z,length,width,angle])=>({x,z,length,width,cos:Math.cos(angle),sin:Math.sin(angle)}));
}
const woods=masks(woodlandBelts), clearings=masks(meadowGlades);

function beltAt(x:number,z:number,belts:ReturnType<typeof masks>) {
    let cover=0;
    for(const belt of belts){
        const dx=x-belt.x, dz=z-belt.z;
        if(Math.abs(dx)>belt.length*1.3||Math.abs(dz)>belt.length*1.3)continue;
        const u=(dx*belt.cos+dz*belt.sin)/belt.length, v=(-dx*belt.sin+dz*belt.cos)/belt.width;
        cover=Math.max(cover,1-smooth(.37,1.12,Math.hypot(u,v)));
    }
    return cover;
}

export function corridorHabitatAt(x:number,z:number,height:number,slope:number,shoreDistance:number) {
    const {left,north,step,width,depth}=corridorField;
    // Keep the noisy eastern fade strictly inside the texture's right boundary (x = 1520)
    // so the DataTexture never hard-clamps a non-zero alpha into a straight vertical seam!
    const eastNoise=(valueNoise(x*.0028,z*.0028,911)-.72)*240+(valueNoise(x*.0075,z*.0075,919)-.5)*70;
    const eastEdge=(left+(width-1)*step-24)-x+eastNoise;
    const edge=Math.min(x-left,z-north,left+(width-1)*step-x,north+(depth-1)*step-z);
    if(edge<=0||eastEdge<=0)return {strength:0,woodland:0,wet:0,sediment:0,pasture:0};
    const alpine=(1-smooth(-920,-730,z))*(1-smooth(505,665,height));
    const eastFade=smooth(0,440,eastEdge);
    const strength=smooth(0,185,edge)*eastFade*Math.max(.88*alpine,1-smooth(290,480,height));
    if(strength<=0)return {strength:0,woodland:0,wet:0,sediment:0,pasture:0};
    const broad=valueNoise(x*.0041,z*.0041,117), variation=valueNoise(x*.013,z*.013,419);
    const warpX=x+(broad-.5)*52, warpZ=z+(variation-.5)*55;
    const glade=beltAt(warpX,warpZ,clearings)*(.88+.12*variation);
    const belt=Math.max(beltAt(warpX,warpZ,woods)*.80,corridorForestAt(warpX,warpZ));
    const level=shoreDistance<110?waterSurfaceAt(x,z,112):waterLevelAt(z);
    const aboveWater=height-(Number.isFinite(level)?level:waterLevelAt(z));
    const drainage=(1-smooth(18,116,shoreDistance))*(1-smooth(2.5,20.,aboveWater));
    const wet=smooth(-1.5,4,shoreDistance)*drainage*(.47+.53*smooth(.19,.63,broad*.48+variation*.52));
    const sediment=(1-smooth(1,12+variation*13,shoreDistance))
        *(1-smooth(.3,2.4+variation*3.1,aboveWater))*smooth(-2,0,shoreDistance);
    const brokenEdge=valueNoise(x*.027,z*.027,594);
    const groves=smooth(.18,.73,belt*(.49+.47*broad+.32*brokenEdge)+.19*variation);
    const woodLand=groves*Math.max(0,1-glade*.94)*(1-smooth(.45,.87,slope));
    const riverside=drainage*.70*smooth(10,36,shoreDistance)*smooth(.29,.72,variation+broad*.14)
        *(1-glade*.75)*(1-smooth(.28,.60,slope));
    const woodland=Math.min(1,Math.max(woodLand,riverside))*smooth(0,7,aboveWater);
    const pasture=smooth(.16,.78,broad*.60+variation*.40)*(.65+.35*glade);
    return {strength,woodland,wet,sediment,pasture};
}
