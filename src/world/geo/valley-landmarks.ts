import { smooth } from './geo-core';

// Adjacent parcels share the curve of the slope. Their ends turn to follow
// banks and access paths, while their row directions stay aligned.
type Parcel = readonly [
    west:number, east:number, north:number, south:number,
    westShift:number, eastShift:number, maturity:number, bankBend:number,
];
const hillsides: readonly {
    origin:number; slope:number; arc:number; parcels:readonly Parcel[];
}[] = [
    {origin:275,slope:.22,arc:.0026,parcels:[
        [239,278,228,246,-5,-2,.79,-4],
        [284,319,228,250,-3,6,.45,5],
        [232,275,250,270,-2,1,.95,-2],
        [281,326,254,274,-1,-4,.84,4],
        [230,271,274,293,2,-2,.63,1],
        [278,322,278,294,-6,-6,.97,2],
        [231,267,297,312,-4,4,.89,3],
        [277,309,298,306,-3,-5,.59,-1],
    ]},
    {origin:169,slope:-.23,arc:.0038,parcels:[
        [149,193,255,271,-7,1,.47,4],
        [139,194,275,290,5,-2,.91,2],
        [146,192,294,310,11,4,.72,1],
    ]},
];
export const farmRowSpacing = 1.02;
export const valleyParcels = hillsides.flatMap(({origin,slope,arc,parcels}) =>
    parcels.map(bounds=>({origin,slope,arc,bounds})));
export type ValleyParcel = typeof valleyParcels[number];
export const ruinCenter={x:551,z:205,radius:25};

export function parcelCurve({origin,slope,arc}:ValleyParcel,x:number) {
    const dx=x-origin;
    return (slope+dx*arc)*dx;
}

export function parcelSpan(parcel:ValleyParcel,row:number) {
    const [west,east,north,south,westShift,eastShift]=parcel.bounds;
    const t=Math.max(0,Math.min(1,(row-north)/(south-north)));
    return [west+westShift*t,east+eastShift*t] as const;
}

export function parcelMargin(parcel:ValleyParcel,x:number,row:number) {
    const [,,north,south,,,,bend]=parcel.bounds;
    const [west,east]=parcelSpan(parcel,row);
    const side=Math.max(0,Math.min(1,(x-west)/(east-west)));
    const bank=bend*4*side*(1-side);
    return Math.min(x-west,east-x,row-north-bank,south+bank*.55-row);
}

export function valleyFieldsAt(x:number,z:number) {
    if(x<130||x>330||z<215||z>333)return 0;
    let edge=-3;
    for(const parcel of valleyParcels){
        const row=z-parcelCurve(parcel,x);
        edge=Math.max(edge,parcelMargin(parcel,x,row));
    }
    return smooth(-1.3,.25,edge);
}

export const valleyLandmarksGLSL=`
void farmParcel(inout vec4 field,vec2 p,vec4 bounds,vec2 skew,float ripe,float bend) {
    float t=clamp((p.y-bounds.z)/(bounds.w-bounds.z),0.,1.);
    vec2 ends=bounds.xy+skew*t;
    float side=clamp((p.x-ends.x)/(ends.y-ends.x),0.,1.);
    float bank=bend*4.*side*(1.-side);
    float edge=min(min(p.x-ends.x,ends.y-p.x),min(p.y-bounds.z-bank,bounds.w+bank*.55-p.y));
    if(edge>field.w)field=vec4(smoothstep(-1.3,.25,edge),ripe,p.y/${farmRowSpacing},edge);
}
vec4 valleyFields(vec2 p) {
    vec4 field=vec4(0.,0.,0.,-3.);
    if(any(lessThan(p,vec2(130.,215.)))||any(greaterThan(p,vec2(330.,333.))))return field;
    ${hillsides.map(({origin,slope,arc,parcels},i)=>`
    float dx${i}=p.x-${origin}.;
    vec2 row${i}=vec2(p.x,p.y-(${slope}+dx${i}*${arc})*dx${i});
    ${parcels.map(([west,east,north,south,westShift,eastShift,ripe,bend])=>`
    farmParcel(field,row${i},vec4(${west}.,${east}.,${north}.,${south}.),vec2(${westShift}.,${eastShift}.),${ripe},${bend}.);`).join('')}`).join('')}
    return field;
}
float valleyRuinGround(vec2 p) {
    return 1.-smoothstep(13.5,24.5,length(p-vec2(${ruinCenter.x}.,${ruinCenter.z}.)));
}
`;
