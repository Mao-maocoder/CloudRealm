import * as T from 'three';
import { HouseGeometry, archedOpening, chimney, frameWall, gableRoof, masonry, squareWindow, timberGable } from './house-geometry';
export type HouseKind = 'cottage' | 'overhang' | 'manor' | 'crooked' | 'belltower' | 'mushroom' | 'thatch' | 'forge';

const cream = '#d9c8aa', darkWood = '#624237', cedar = '#995236', brown = '#795749';
const slate = '#4f6572', limestone = '#a3a49b', redTile = ['#bd694d','#ab634a','#c28054'] as const;

function threshold(b: HouseGeometry, x: number, z: number, width: number, color: string, y=.18) {
    b.box(x,y/2,z+.51,width+.27,y,.92,color,'stone');
    b.box(x,y+.08,z+.18,width,.16,.56,color,'stone');
}

function sideWindow(b: HouseGeometry, x: number, y: number, z: number, side: number, frame: string, width=.82) {
    b.box(x+side*.032,y,z,.125,1.13,width+.18,frame,'wood');
    b.box(x+side*.106,y,z,.048,.91,width,'#c59a63','glass');
    b.box(x+side*.134,y,z,.065,.055,width,frame,'wood');
    b.box(x+side*.134,y,z,.065,.91,.055,frame,'wood');
    b.box(x+side*.17,y-.55,z,.29,.13,width+.24,frame,'wood');
}

function cottage(b: HouseGeometry, variant: number) {
    const tile=redTile[variant], wood=variant===1?'#7d4632':'#9a5638';
    const width=4.6, depth=3.8, wall=3.05, eave=wall+.08, rise=2.58;
    masonry(b,0,0,4.95,4.16,0,.47,'#667c89');
    frameWall(b,0,0,width,depth,.42,wall,'#e1d6c0',wood);
    archedOpening(b,0,.47,depth/2,1.27,1.94,'#719099',false,true);
    threshold(b,0,depth/2,1.63,'#80909a');
    sideWindow(b,width/2,1.72,.44,1,wood,.89);
    sideWindow(b,-width/2,1.72,-.30,-1,wood,.89);
    squareWindow(b,-.60,1.63,-depth/2-.19,1.02,1.03,wood);
    for (const side of [-1,1]) {
        timberGable(b,0,side*depth/2,width/2,wall,rise,'#dfd3bb',wood,1.62,false);
        b.box(side*.37,wall+.14,depth/2,.25,.20,.24,wood,'wood');
    }
    archedOpening(b,0,wall+.34,depth/2,1.0,1.27,wood,true);
    gableRoof(b,0,0,5.62,4.75,eave,rise,tile,wood,1.62,.31);
    chimney(b,1.11,-.89,wall+1.14,1.33,.49,'#8d7d6c');
    // A small side dormer makes the silhouette readable from the lane.
    if (variant!==2) {
        b.box(1.31,wall+.57,.10,1.13,.89,.91,wood,'wood');
        squareWindow(b,1.31,wall+.76,.562,.40,.49,darkWood);
        gableRoof(b,1.31,.10,1.47,1.16,wall+.97,.66,tile,wood,1.26,.08);
    }
}

function overhang(b: HouseGeometry) {
    const wood='#756252', board='#a08d72', plaster='#cdc6b5';
    masonry(b,0,0,5.14,4.46,0,.43,'#a8a39a');
    frameWall(b,0,-.07,4.95,4.15,.40,2.68,plaster,wood);
    archedOpening(b,-.62,.43,2.02,1.02,1.89,wood,false);
    const deck=2.65, top=5.03, face=2.52;
    frameWall(b,0,.21,5.60,4.62,deck,top,plaster,wood);
    for(const [i,x] of [-1.76,0,1.76].entries()){
        squareWindow(b,x,3.72,face,1.13,1.37,wood);
        if (i<2) b.box(x+.88,3.82,face,.15,2.22,.17,wood,'wood');
        b.beam([x,2.02,2.04],[x,2.67,2.44],.16,.18,wood);
    }
    for(const s of [-1,1]) sideWindow(b,s*2.8,3.73,1.15,s,wood);
    for (const z of [-2.10,face])
        timberGable(b,0,z,2.81,top,2.48,board,wood,1.16);
    for(let i=-9;i<=9;i++){
        const x=i*.28, h=2.42*(1-Math.abs(x)/2.84)**1.16;
        b.box(x,top+h*.43,face+.019,.024,h*.82,.034,'#776451','wood');
    }
    gableRoof(b,0,.20,6.25,5.30,top+.08,2.68,'#91736a',wood,1.17,.08);
    frameWall(b,2.44,-1.17,2.28,1.88,.41,4.15,plaster,wood,true);
    gableRoof(b,2.44,-1.17,2.80,2.21,4.13,1.09,'#9a776a',wood,1.22);
    chimney(b,.92,-.58,top+1.06,2.25,.66,'#b0a69a',.07);
}

function manor(b: HouseGeometry) {
    const width=5.8, depth=4.70, floor=2.94, eave=5.75;
    masonry(b,0,0,6.07,4.97,0,.63,limestone);
    frameWall(b,0,0,width,depth,.60,floor,'#ccbea4',brown);
    frameWall(b,0,.21,width+.42,depth+.49,floor-.04,eave,cream,darkWood,true);
    archedOpening(b,0,.64,depth/2,1.22,2.02,darkWood,false);
    threshold(b,0,depth/2,1.44,limestone);
    for(const x of [-1.80,1.80]){
        squareWindow(b,x,1.60,depth/2,.90,1.08,darkWood);
        squareWindow(b,x,4.34,2.805,1.16,1.47,brown);
        b.beam([x,2.25,depth/2],[x,2.98,2.70],.20,.20,darkWood);
    }
    squareWindow(b,0,4.35,2.805,1.26,1.60,brown);
    for(const s of [-1,1]){
        sideWindow(b,s*3.11,4.22,.90,s,brown,1.06);
        timberGable(b,0,.21+s*(depth+.49)/2,width*.53,eave,2.94,cream,brown,1.29);
    }
    gableRoof(b,0,.21,7.0,5.98,eave+.02,3.12,slate,darkWood,1.29);
    // A separate protruding front gable breaks up the long timber elevation.
    frameWall(b,-.78,2.69,2.45,1.48,3.38,eave+.56,cream,brown,true);
    timberGable(b,-.78,3.43,1.225,eave+.53,1.93,cream,brown,1.19);
    gableRoof(b,-.78,2.66,2.98,1.98,eave+.54,1.98,'#60727b',darkWood,1.19);
    squareWindow(b,-.78,5.05,3.43,.87,1.16,brown);
    chimney(b,1.72,-.64,6.39,2.03,.85,limestone);
    chimney(b,-1.68,-.75,6.53,1.58,.64,'#aaa392');
}

function tierRoof(b: HouseGeometry, x: number, z: number, y: number, height: number, width: number, depth: number,
                  tip: number, tile: string, lean = 0, sides = 4) {
    const rows=Math.max(9,Math.ceil(height/.47)), stone='#637780';
    const at = (t: number,a: number, extra=0): [number,number,number] => {
        const tamed=t**.72, radius=1-(1-tip)*tamed+extra;
        const angle=Math.PI*2*a+(sides===4?Math.PI/4:0);
        return [x+lean*t*t+Math.cos(angle)*width*radius,y+height*t,z+Math.sin(angle)*depth*radius];
    };
    for(let j=0;j<rows;j++){
        const t0=j/rows,t1=(j+1)/rows;
        for(let s=0;s<sides;s++){
            const a=s/sides,c=(s+1)/sides;
            b.face([at(t0,a),at(t1,a),at(t1,c),at(t0,c)],[0,1,2,0,2,3],tile,'tile');
            const n=sides===4?6:2;
            for(let i=0;i<n;i++){
                const u=T.MathUtils.lerp(a,c,(i+.025)/n),v=T.MathUtils.lerp(a,c,(i+.975)/n);
                const a0=new T.Vector3(...at(t0,a,.013)), a1=new T.Vector3(...at(t0,c,.013));
                const b0=new T.Vector3(...at(t1,a,.006)), b1=new T.Vector3(...at(t1,c,.006));
                const p0=a0.clone().lerp(a1,(u-a)/(c-a)),p1=a0.clone().lerp(a1,(v-a)/(c-a));
                const p2=b0.clone().lerp(b1,(v-a)/(c-a)),p3=b0.clone().lerp(b1,(u-a)/(c-a));
                b.face([p0.toArray(),p1.toArray(),p2.toArray(),p3.toArray()],[0,1,2,0,2,3],tile,'tile');
            }
            if(j===0) b.beam(at(t0,a,.018),at(t0,c,.018),.19,.20,stone,'tile');
        }
    }
    const crown: [number,number,number]=[x+lean,y+height,z];
    for(let i=0;i<sides;i++)
        b.face([crown,at(1,i/sides),at(1,(i+1)/sides)],[0,2,1],tile,'tile');
}

function crooked(b: HouseGeometry) {
    const blue='#638894', trim='#96664f', tile='#585e4e';
    masonry(b,0,0,5.65,4.88,0,.44,'#828b89');
    frameWall(b,0,0,5.42,4.65,.42,2.45,blue,darkWood);
    archedOpening(b,-.31,.45,2.325,1.01,1.74,trim,false);
    squareWindow(b,1.45,1.36,2.325,.83,.97,trim);
    tierRoof(b,0,0,2.4,1.68,4.65,3.92,.45,tile);
    frameWall(b,.98,-.07,3.20,3.15,3.54,6.35,blue,darkWood);
    for (const y of [4.25,5.60]) squareWindow(b,1.25,y,1.51,.93,1.03,trim);
    tierRoof(b,1.0,-.10,6.27,1.50,2.87,2.73,.40,tile,-.22);
    // Offset tower, supported by long braces under its projecting timber frame.
    frameWall(b,-1.02,.18,3.06,2.88,4.51,9.28,'#557b88',trim);
    for (let i=-6;i<=6;i++) {
        const x=-1.02+i*.216;
        b.box(x,7.02,1.635,.034,4.24,.05,'#486673','wood');
    }
    for (const x of [-2.34,.18]){
        b.beam([x,2.90,1.00],[x+.21,4.61,1.62],.17,.19,darkWood);
        b.beam([x,3.09,1.15],[x+.63,4.63,1.56],.17,.18,brown);
    }
    for (const y of [5.37,7.04]) squareWindow(b,-1.25,y,1.64,.89,1.12,trim);
    archedOpening(b,-.66,7.85,1.64,1.10,1.03,trim,true);
    b.box(-.66,7.85,1.93,1.40,.13,.47,trim,'wood');
    for(const x of [-1.24,-.85,-.37,-.08]) b.box(x,8.10,2.10,.075,.43,.07,trim,'wood');
    b.box(-.66,8.32,2.12,1.29,.092,.11,brown,'wood');
    tierRoof(b,-1.09,.14,9.20,3.36,2.71,2.48,.12,tile,-.28);
    chimney(b,1.43,-.29,6.78,6.78,.75,'#8c8170',.52);
}

function belltower(b: HouseGeometry) {
    const roof='#426a86', stone='#c2bfb0', wood='#795142';
    masonry(b,0,0,7,5.5,0,.68,'#939c9b');
    frameWall(b,-2.10,.18,2.60,4.15,.65,4.42,stone,wood);
    frameWall(b,2.03,-.16,3.04,4.75,.65,5.37,stone,wood,true);
    for (const [x,y,w,d,z] of [[-2.1,4.4,3.22,4.89,.18],[2.03,5.34,3.58,5.33,-.16]]) {
        timberGable(b,x,z+d*.43,w*.43,y,2.30,stone,wood,1.28);
        gableRoof(b,x,z,w,d,y,2.44,roof,wood,1.28,.12);
    }
    for (const x of [-2.54,1.35,2.68]) archedOpening(b,x,1.52,x<0?2.26:2.24,.66,1.22,wood,true,true);
    const x=-.36, z=-.20, width=2.23, depth=2.52;
    b.box(x,4.79,z,width,8.56,depth,stone,'stone');
    for (let row=0;row<15;row++){
        const yy=1.05+row*.48;
        for (const s of [-1,1])
            b.box(x+s*1.03,yy,z+1.23,.25,.42,.24,limestone,'stone');
    }
    archedOpening(b,x,.65,z+depth/2,1.06,2.23,wood,false,true);
    archedOpening(b,x,5.77,z+depth/2,.53,1.66,'#a39d8e',true,true);
    archedOpening(b,x,7.57,z+depth/2,.65,1.15,wood,true);
    for (const yy of [7.33,8.98]) {
        b.box(x,yy,z,2.64,.26,2.86,wood,'wood');
    }
    b.add(new T.CylinderGeometry(.39,.58,.53,12).translate(x,8.01,z+1.30),'#ae8150','stone');
    tierRoof(b,x,z,8.98,6.47,2.08,2.25,.035,roof,.09);
    b.beam([x+.09,15.18,z],[x+.09,16.03,z],.075,.075,'#5a5448','stone');
    chimney(b,2.65,-.38,6.40,2.19,.59,'#989d9d');
    gableRoof(b,-.33,1.71,2.1,2.06,2.64,1.46,roof,wood,1.17);
}

function mushroomCap(b: HouseGeometry, x: number, y: number, z: number, radius: number, height: number, tint: string, spots: number) {
    const radial=28, rings=12;
    const point=(t: number, a: number) => {
        const phase=a*Math.PI*2;
        const r=radius*t*(1+.11*Math.sin(phase*3+.61)+.065*Math.cos(phase*5));
        return new T.Vector3(x+Math.cos(phase)*r+.31*(1-t),y+height*(1-t**2.03)**.82+.17*t*Math.cos(phase*2+.4),z+Math.sin(phase)*r*.87);
    };
    const pos: number[] = [], indices: number[] = [];
    for(let j=0;j<=rings;j++)for(let i=0;i<=radial;i++){
        pos.push(...point(j/rings,i/radial).toArray());
        if(j<rings&&i<radial){
            const a=j*(radial+1)+i;
            if(j>0)indices.push(a,a+1,a+radial+1);
            indices.push(a+1,a+radial+2,a+radial+1);
        }
    }
    const cap=new T.BufferGeometry();
    cap.setAttribute('position',new T.Float32BufferAttribute(pos,3));cap.setIndex(indices);cap.computeVertexNormals();
    b.add(cap,tint,'tile',.04);
    for(let i=0;i<radial;i++){
        const a=point(1,i/radial), c=point(1,(i+1)/radial);
        b.beam(a.toArray(),c.toArray(),.16,.18,'#aa503c','tile');
        b.face([[x,y-.27,z],a.toArray(),c.toArray()],[0,2,1],i%2?'#c79570':'#deb291','wood');
    }
    for(let i=0;i<spots;i++){
        const angle=b.random(), t=.12+.83*Math.sqrt(b.random()), size=radius*(.018+.046*b.random());
        const p=point(t,angle), u=point(Math.min(1,t+.001),angle).sub(p), v=point(t,angle+.001).sub(p);
        const normal=v.cross(u).normalize();
        const spot=new T.SphereGeometry(1,8,5).scale(size,.023+size*.12,size*.79);
        spot.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),normal));
        spot.translate(p.x,p.y,p.z);
        b.add(spot,'#efd8b1','plaster');
    }
}

function mushroom(b: HouseGeometry, variant: number) {
    masonry(b,0,0,4.32,3.80,0,.38,'#899388');
    b.add(new T.CylinderGeometry(1.63,2.10,4.48,22).scale(1,1,.84).translate(0,2.59,0),'#eedcc0','plaster');
    b.box(0,1.43,1.42,2.14,2.17,.40,'#ead8bc','plaster');
    archedOpening(b,0,.36,1.64,1.32,1.95,'#a58266',false,true);
    threshold(b,0,1.64,1.60,'#9a9385');
    archedOpening(b,.53,2.62,1.48,.58,.77,brown,true);
    archedOpening(b,-.57,3.14,1.44,.72,.84,brown,true);
    mushroomCap(b,-.11,4.32,-.02,2.98,2.35,variant===1?'#c87b53':'#c56354',25);
    b.add(new T.CylinderGeometry(.66,.86,1.80,14).translate(-1.73,1.33,.32),'#e8d0ae','plaster');
    mushroomCap(b,-1.78,2.13,.38,1.23,.84,'#c87a5d',12);
    chimney(b,1.13,-.58,4.5,1.65,.48,'#aaa092');
    for (const x of [-.86,.87]){
        b.box(x,2.49,1.57,.13,.22,.16,'#d3a46a','glass');
        b.box(x,2.64,1.57,.22,.07,.22,darkWood,'wood');
    }
}

function thatch(b: HouseGeometry) {
    masonry(b,0,0,3.52,3.35,0,.38,'#999281');
    b.add(new T.CylinderGeometry(1.47,1.63,4.22,16).translate(0,2.49,0),'#dcca9e','plaster');
    b.box(0,1.35,1.35,1.81,1.96,.48,'#e6cca0','plaster');
    archedOpening(b,0,.38,1.60,1.17,1.83,brown,false);
    threshold(b,0,1.60,1.55,limestone);
    archedOpening(b,-.13,3.02,1.48,.75,1.08,brown,true);
    tierRoof(b,-.04,.03,2.56,.94,2.25,2.24,.75,'#a9783e',0,12);
    const point=(t: number,a: number): [number,number,number] => {
        const curl=Math.max(0,(t-.58)/.42), rotation=curl*3.9;
        const radius=2.02*(1-t)**1.4;
        return [Math.cos(a)*radius + .23*t+.68*curl*Math.sin(rotation),
            4.37+4.1*t+.82*curl*Math.cos(rotation),Math.sin(a)*radius +.15*t];
    };
    for(let j=0;j<21;j++)for(let i=0;i<20;i++){
        const t=j/21, end=(j+1)/21, a=i*Math.PI/10, c=(i+1)*Math.PI/10;
        b.face([point(t,a),point(t,c),point(end,c),point(end,a)],[0,1,2,0,2,3],j%4===3?'#99622f':'#c39455','tile');
        if(j%4===0) b.beam(point(t,a),point(t,c),.079,.069,'#ad7940','tile');
    }
    chimney(b,-1.14,-.82,4.21,1.17,.45,'#9c9290',-.11);
}

function forge(b: HouseGeometry) {
    masonry(b,0,0,4.24,3.62,0,.58,'#9a9487');
    frameWall(b,0,0,4.1,3.55,.54,2.86,'#bdb39f','#60483a',true);
    timberGable(b,0,1.775,2.05,2.84,2.03,'#c5b69e',darkWood,1.48);
    gableRoof(b,0,0,5.3,4.38,2.83,2.45,'#876655','#654c3c',1.53,.19);
    // Deep stone surround with a warm opening in the front of the workshop.
    archedOpening(b,0,.65,1.775,1.66,1.63,'#8a8173',false,true);
    const open=new T.Shape();
    open.moveTo(-.60,.72);open.lineTo(.60,.72);open.lineTo(.60,1.38);
    open.absarc(0,1.38,.60,0,Math.PI,false);open.lineTo(-.60,.72);
    b.add(new T.ShapeGeometry(open,14).translate(0,0,1.93),'#58332a','wood');
    const fire=new T.Shape();
    fire.moveTo(-.44,.74);fire.quadraticCurveTo(-.40,1.18,-.17,1.38);
    fire.quadraticCurveTo(-.19,1.05,.04,1.57);fire.quadraticCurveTo(.04,1.25,.27,1.41);
    fire.quadraticCurveTo(.54,1.08,.46,.74);fire.lineTo(-.44,.74);
    b.add(new T.ShapeGeometry(fire,7).translate(0,0,1.955),'#f29c40','glass');
    threshold(b,0,1.76,1.71,'#908982');
    chimney(b,.92,-.53,3.45,2.18,.72,'#8a8379',.06);
    b.box(-1.11,.68,2.33,.54,.14,.23,'#565953','stone');
    b.add(new T.CylinderGeometry(.24,.31,.57,9).translate(-1.11,.285,2.33),'#83674d','wood');
}

export function makeHouse(kind: HouseKind, variant = 0) {
    const b=new HouseGeometry(12041+variant*197+kind.length*53);
    switch(kind) {
        case 'cottage': cottage(b,variant); break;
        case 'overhang': overhang(b); break;
        case 'manor': manor(b); break;
        case 'crooked': crooked(b); break;
        case 'belltower': belltower(b); break;
        case 'mushroom': mushroom(b,variant); break;
        case 'thatch': thatch(b); break;
        case 'forge': forge(b); break;
    }
    return b.finish();
}
