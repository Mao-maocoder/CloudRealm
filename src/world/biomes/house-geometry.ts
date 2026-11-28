import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { aerialPerspectiveGLSL, atmosphereUniforms } from '../../rendering/aerial-perspective';
import { valleyArtGLSL } from '../geo/valley-art';

type Point = [number, number, number];
export type Surface = 'wood' | 'stone' | 'plaster' | 'tile' | 'glass';
const surfaceIndex: Record<Surface, number> = { wood: 0, stone: 1, plaster: 2, tile: 3, glass: 4 };
const up = new T.Vector3(0, 1, 0);

export class HouseGeometry {
    private readonly parts: T.BufferGeometry[] = [];
    private readonly lights: T.BufferGeometry[] = [];
    private seed: number;

    constructor(seed: number) { this.seed = seed; }

    random() {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    add(geometry: T.BufferGeometry, tint: T.ColorRepresentation, surface: Surface, variation = .12) {
        const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
        if (mesh !== geometry) geometry.dispose();
        mesh.deleteAttribute('uv');
        const count = mesh.getAttribute('position').count;
        const colors = new Float32Array(count * 3);
        const shade = 1 + (this.random() - .5) * variation;
        const color = new T.Color(tint).multiplyScalar(shade);
        for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
        mesh.setAttribute('color', new T.BufferAttribute(colors,3));
        mesh.setAttribute('houseSurface', new T.BufferAttribute(new Float32Array(count).fill(surfaceIndex[surface]),1));
        (surface === 'glass' ? this.lights : this.parts).push(mesh);
    }

    box(x: number, y: number, z: number, w: number, h: number, d: number, color: T.ColorRepresentation, surface: Surface) {
        this.add(new T.BoxGeometry(w,h,d).translate(x,y,z),color,surface);
    }

    beam(from: Point, to: Point, width: number, depth: number, color: T.ColorRepresentation, surface: Surface = 'wood') {
        const a = new T.Vector3(...from), b = new T.Vector3(...to), delta = b.clone().sub(a);
        const beam = new T.BoxGeometry(width,delta.length(),depth);
        beam.applyQuaternion(new T.Quaternion().setFromUnitVectors(up,delta.normalize()));
        beam.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);
        this.add(beam,color,surface);
    }

    face(points: Point[], indices: number[], color: T.ColorRepresentation, surface: Surface) {
        const g = new T.BufferGeometry();
        g.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));
        g.setIndex(indices);
        g.computeVertexNormals();
        this.add(g,color,surface);
    }

    finish(normalize = true) {
        const bake = (parts: T.BufferGeometry[]) => {
            if (!parts.length) return undefined;
            const geometry = mergeGeometries(parts);
            if (!geometry) throw new Error('Building mesh attributes do not match');
            parts.forEach(part=>part.dispose());
            return geometry;
        };
        const shell = bake(this.parts)!;
        const glow = bake(this.lights);
        if (!normalize) return { shell, glow };
        shell.computeBoundingBox();
        const bounds = shell.boundingBox!, size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
        const base = bounds.min.y;
        for (const geometry of glow ? [shell,glow] : [shell]) {
            geometry.translate(-center.x,-base,-center.z);
            geometry.scale(1/size.x,1/size.y,1/size.z);
            geometry.computeBoundingSphere();
        }
        return { shell, glow };
    }
}

export function makeHouseMaterial(detailScale = 1) {
    const material = new T.MeshStandardMaterial({ vertexColors:true, roughness:.89, metalness:0, side:T.DoubleSide });
    material.customProgramCacheKey = () => `house-painted-material-v3:${detailScale}`;
    material.onBeforeCompile = shader => {
        shader.uniforms.uHouseDetailScale = { value: detailScale };
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader = 'attribute float houseSurface; varying vec4 vHouse; varying vec3 vHouseWorld;\n' + shader.vertexShader
            .replace('#include <begin_vertex>','#include <begin_vertex>\nvHouse=vec4(position,houseSurface);\nvHouseWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
        shader.fragmentShader = `
            varying vec4 vHouse;
            varying vec3 vHouseWorld;
            uniform float uHouseDetailScale;
            ${aerialPerspectiveGLSL}
            ${valleyArtGLSL}
            float houseHash(vec2 p){
                return fract(sin(dot(p,vec2(121.7,311.9)))*43758.5453);
            }
            float houseNoise(vec2 p){
                vec2 i=floor(p), f=fract(p);
                f=f*f*(3.-2.*f);
                return mix(mix(houseHash(i),houseHash(i+vec2(1.,0.)),f.x),
                    mix(houseHash(i+vec2(0.,1.)),houseHash(i+1.),f.x),f.y);
            }
        ` + shader.fragmentShader
            .replace('#include <fog_fragment>', '')
            .replace('#include <color_fragment>',`#include <color_fragment>
            {
                vec3 p=vHouse.xyz*uHouseDetailScale;
                vec2 q=vec2(p.x+p.z,p.y+.19*p.z);
                float weathering=houseNoise(q*10.+p.z*3.);
                float grain=houseNoise(q*vec2(96.,15.));
                float detail=1.-smoothstep(.02,.07,max(length(dFdx(q)),length(dFdy(q))));
                float wood=1.-step(.5,vHouse.w);
                float stone=step(.5,vHouse.w)*(1.-step(1.5,vHouse.w));
                float plaster=step(1.5,vHouse.w)*(1.-step(2.5,vHouse.w));
                float tile=step(2.5,vHouse.w)*(1.-step(3.5,vHouse.w));
                float mineral=step(.5,vHouse.w)*(1.-step(2.5,vHouse.w));
                float dirt=1.-smoothstep(.025,.28,p.y);
                diffuseColor.rgb*=.88+.24*weathering+.12*detail*(grain-.5)+.19*wood*detail*(grain-.5);
                diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.68,.77,.66),dirt*mineral*.29);
                // Eastern ancient village palette & stronger foundation contact AO across all regions in Guofeng mode.
                float gfHouse=uGuofengStyle;
                if(gfHouse>.001){
                    vec3 qingWa=mix(vec3(.20,.25,.29),vec3(.31,.36,.40),weathering);
                    vec3 oldWood=diffuseColor.rgb*vec3(.64,.56,.50);
                    vec3 ashPlaster=mix(diffuseColor.rgb,vec3(.76,.74,.68)*(.90+.16*weathering),.55);
                    vec3 mossStone=mix(diffuseColor.rgb,vec3(.42,.44,.41)*(.86+.24*weathering),.50);
                    vec3 gfCol=diffuseColor.rgb;
                    gfCol=mix(gfCol,qingWa,tile*.82);
                    gfCol=mix(gfCol,oldWood,wood*.78);
                    gfCol=mix(gfCol,ashPlaster,plaster*.75);
                    gfCol=mix(gfCol,mossStone,stone*.65);
                    float baseAO=1.-smoothstep(.0,.42,p.y);
                    gfCol*=mix(1.,.58,baseAO*.68);
                    gfCol=mix(gfCol,vec3(.22,.28,.20),baseAO*stone*.34);
                    diffuseColor.rgb=mix(diffuseColor.rgb,gfCol,gfHouse);
                }
            }
        `)
            .replace('#include <tonemapping_fragment>', `
            float houseDist = length(cameraPosition - vHouseWorld);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vHouseWorld), smoothstep(130., 470., houseDist));
            #include <tonemapping_fragment>`);
    };
    return material;
}

export function masonry(b: HouseGeometry, x: number, z: number, width: number, depth: number, y: number,
                        height: number, color: string, courses = 2) {
    b.box(x,y+height/2,z,width-.14,height,depth-.14,color,'stone');
    for (let row=0;row<courses;row++) {
        const yy = y + height*(row+.5)/courses, blockHeight = height/courses-.033;
        for (const side of [-1,1]) {
            const lay = (span: number, across: boolean) => {
                const count = Math.max(2,Math.ceil(span/.74)), size = span/count, offset = row % 2 ? size*.44 : 0;
                for (let i=-1;i<count;i++) {
                    const start = Math.max(0,i*size+offset)+.021;
                    const end = Math.min(span,(i+1)*size+offset)-.021;
                    if (start >= end) continue;
                    const position = (start+end-span)/2, length=end-start;
                    if (across) b.box(x+position,yy,z+side*depth/2,length,blockHeight,.19,color,'stone');
                    else b.box(x+side*width/2,yy,z+position,.19,blockHeight,length,color,'stone');
                }
            };
            lay(width,true);
            lay(depth,false);
        }
    }
}

export function chimney(b: HouseGeometry, x: number, z: number, base: number, height: number, size: number,
                        color: string, lean = 0) {
    const rows = Math.ceil(height/.36), course = height/rows;
    for (let i=0;i<rows;i++) {
        const t = (i+.5)/rows, width = size*(1-.15*t);
        const cx=x+lean*t;
        b.box(cx,base+t*height,z,width,course+.002,width*.83,color,'stone');
        for (const side of [-1,1]) {
            const offset = side*width*.235 + (i%2-.5)*width*.09;
            b.box(cx+offset,base+t*height,z+width*.415,width*.44,course-.018,.085,color,'stone');
        }
    }
    b.box(x+lean,base+height,z,size*1.13,.16,size,color,'stone');
    b.box(x+lean,base+height+.16,z,size*.57,.20,size*.50,'#484039','stone');
}

export function archedOpening(b: HouseGeometry, x: number, y: number, z: number, width: number, height: number,
                              frame: string, glass: boolean, stoneFrame = false) {
    const radius=width/2, spring=y+height-radius, edge=glass?.082:.15;
    const material: Surface = stoneFrame ? 'stone' : 'wood';
    const outline = (r: number, bottom: number) => {
        const s = new T.Shape();
        s.moveTo(x-r,bottom);
        s.lineTo(x+r,bottom);
        s.lineTo(x+r,spring);
        s.absarc(x,spring,r,0,Math.PI,false);
        s.lineTo(x-r,bottom);
        return s;
    };
    b.add(new T.ShapeGeometry(outline(radius,y),14).translate(0,0,z+.015),'#352620','wood');
    const face = new T.ShapeGeometry(outline(radius-edge,y+edge*.62),14).translate(0,0,z+.036);
    b.add(face,glass?'#e6ba76':'#78503a',glass?'glass':'wood');
    for (const side of [-1,1]) {
        b.box(x+side*(radius+edge*.19),(y+spring)/2,z+.05,edge,spring-y,edge*1.5,frame,material);
    }
    if (stoneFrame) {
        for (let i=0;i<8;i++) {
            const a=(i+.045)*Math.PI/8, c=(i+.955)*Math.PI/8, r=radius+edge;
            const corner=(angle: number,dist: number,depth: number): Point=>[x+Math.cos(angle)*dist,spring+Math.sin(angle)*dist,z+depth];
            b.face([corner(a,radius,.10),corner(a,r,.10),corner(c,r,.10),corner(c,radius,.10),
                corner(a,radius,.015),corner(a,r,.015),corner(c,r,.015),corner(c,radius,.015)],
            [0,1,2,0,2,3,1,5,6,1,6,2,0,3,7,0,7,4],frame,'stone');
        }
    } else {
        for (let i=0;i<10;i++) {
            const a=i*Math.PI/10, c=(i+1)*Math.PI/10, r=radius;
            b.beam([x+Math.cos(a)*r,spring+Math.sin(a)*r,z+.065],[x+Math.cos(c)*r,spring+Math.sin(c)*r,z+.065],edge,edge,frame);
        }
    }
    if (glass) {
        b.box(x,y+height*.48,z+.062,width*.86,edge*.61,edge,frame,'wood');
        b.box(x,y+height*.5,z+.062,edge*.61,height*.88,edge,frame,'wood');
        b.box(x,y-.04,z+.12,width+.19,.12,.26,frame,material);
    } else {
        for (let i=-2;i<=2;i++)
            b.box(x+i*width*.16,(y+spring)/2,z+.055,.032,spring-y-.085,.033,'#3e2821','wood');
        for (const t of [.24,.76])
            b.box(x,y+(spring-y)*t,z+.075,width*.91,.075,.085,frame,'wood');
        b.add(new T.SphereGeometry(.071,7,4).translate(x+width*.23,y+(spring-y)*.48,z+.13),'#ac8246','stone');
    }
}

export function squareWindow(b: HouseGeometry, x: number, y: number, z: number, width: number, height: number, frame: string) {
    b.box(x,y,z+.035,width+.18,height+.18,.15,frame,'wood');
    b.box(x,y,z+.12,width,height,.045,'#bd985f','glass');
    b.box(x,y,z+.155,width,.056,.07,frame,'wood');
    b.box(x,y,z+.155,.065,height,.07,frame,'wood');
    b.box(x,y-height/2-.08,z+.15,width+.25,.096,.29,frame,'wood');
}

/** Curved, overlapping shingle courses, with exposed noses and staggered seams. */
export function gableRoof(b: HouseGeometry, x: number, z: number, width: number, depth: number, eave: number,
                          rise: number, tile: string, fascia: string, curve = 1.55, ridgeCurl = .18) {
    const rows = Math.max(5, Math.ceil(rise/.42));
    const tiles = Math.max(5,Math.ceil(depth/.55));
    const pitch = (side: number, t: number, v: number, lift = 0): Point => {
        const end = Math.abs(v-.5)*2;
        return [x+side*width/2*(1-t), eave+rise*t**curve+ridgeCurl*end**7*t*t+lift, z+depth*(v-.5)];
    };
    for (const side of [-1,1]) {
        for (let row=0;row<rows;row++) {
            const a=row/rows, c=(row+1)/rows;
            b.face([pitch(side,a,0),pitch(side,a,1),pitch(side,c,1),pitch(side,c,0)],
                side<0?[0,1,2,0,2,3]:[0,2,1,0,3,2],tile,'tile');
            const shift = row%2 ? .48 : 0;
            for (let i=-1;i<tiles;i++) {
                const start=Math.max(0,(i+shift+.024)/tiles);
                const end=Math.min(1,(i+shift+.976)/tiles);
                if (start>=end) continue;
                const top = Math.min(1,c+.14/rows), bottom=Math.max(0,a-.13/rows);
                const p = pitch(side,bottom,start,.06), q = pitch(side,bottom,end,.06);
                const r = pitch(side,top,end,.027), s = pitch(side,top,start,.027);
                b.face([p,q,r,s,pitch(side,bottom,start,-.022),pitch(side,bottom,end,-.022)],
                    side<0?[0,1,2,0,2,3,0,4,5,0,5,1]:[0,2,1,0,3,2,0,5,4,0,1,5],tile,'tile');
            }
            for (const end of [0,1])
                b.beam(pitch(side,a,end,-.028),pitch(side,c,end,-.028),.15,.17,fascia);
        }
    }
    const ridgePieces=Math.ceil(depth/.46);
    for(let i=0;i<ridgePieces;i++)
        b.beam(pitch(1,1,i/ridgePieces,.055),pitch(1,1,(i+1)/ridgePieces,.055),.20,.22,tile,'tile');
}

export function timberGable(b: HouseGeometry, x: number, z: number, half: number, y: number, rise: number,
                            plaster: string, beam: string, curve: number, braced = true) {
    const points: Point[]=[[x,y-.04,z],[x-half,y-.04,z]];
    const indices: number[]=[];
    for (let i=0;i<=12;i++) {
        const t=i/6-1;
        points.push([x+half*t,y+.045+rise*(1-.87*Math.abs(t))**curve,z]);
        indices.push(0,i+1,i+2);
    }
    points.push([x+half,y-.04,z]);
    indices.push(0,14,15);
    b.face(points,indices,plaster,'plaster');
    b.box(x,y,z+.035,half*2,.18,.15,beam,'wood');
    if (braced) {
        b.beam([x,y,z+.058],[x,y+rise*.92,z+.058],.13,.12,beam);
        for (const side of [-1,1])
            b.beam([x+side*half*.44,y+.02,z+.06],[x,y+rise*.48,z+.06],.12,.13,beam);
    }
}

export function frameWall(b: HouseGeometry, x: number, z: number, width: number, depth: number, bottom: number,
                          top: number, plaster: string, timber: string, braces = false) {
    b.box(x,(bottom+top)/2,z,width,top-bottom,depth,plaster,'plaster');
    for (const sx of [-1,1]) for (const sz of [-1,1])
        b.box(x+sx*(width/2-.04),(bottom+top)/2,z+sz*(depth/2-.04),.22,top-bottom+.12,.22,timber,'wood');
    for (const y of [bottom+.04,top-.05]) {
        for (const side of [-1,1]) {
            b.box(x,y,z+side*depth/2,width+.15,.16,.21,timber,'wood');
            b.box(x+side*width/2,y,z,.20,.16,depth+.15,timber,'wood');
        }
    }
    if (braces) {
        for (const side of [-1,1]) {
            const zz=z+side*(depth/2+.072);
            for (const half of [-1,1]) {
                const a=x+half*width*.47, c=x+half*width*.23;
                b.beam([a,bottom+.17,zz],[c,top-.14,zz],.14,.12,timber);
                b.beam([a,top-.14,zz],[c,bottom+.17,zz],.14,.12,timber);
            }
        }
    }
}
