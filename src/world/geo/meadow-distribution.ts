import {lakeShoreDistance,lakes,riverSamplesAt,smooth,waterSurfaceAt} from './geo-core';
import {valueNoise} from './height';

export function shoreDistanceAt(x:number,z:number) {
 let shoreDistance=Infinity;
 for(const {a,b} of riverSamplesAt(x,z)){
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  shoreDistance=Math.min(shoreDistance,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)-(a.halfWidth+(b.halfWidth-a.halfWidth)*t));
 }
 for(const lake of lakes)shoreDistance=Math.min(shoreDistance,lakeShoreDistance(lake,x,z));
 return shoreDistance;
}

/** Shared placement data for the grass shells and river-edge plants. */
export function meadowHabitatAt(x:number,z:number,height:number,slope:number){
 const shoreDistance=shoreDistanceAt(x,z);
 let moisture=Math.exp(-Math.max(0,shoreDistance)/55);
 const bambooWetland=1-smooth(.55,1.25,Math.hypot((x+640)/260,(z-620)/300));moisture=Math.max(moisture,bambooWetland*.65);
 const water=waterSurfaceAt(x,z,7),patches=.76+.24*valueNoise(x*.026,z*.026,53),alpine=1-smooth(200,420,height);
 const cover=(1-smooth(.55,1.1,slope))*(1-smooth(300,420,height))*(Number.isFinite(water)?smooth(.31,1.8,height-water):1)*patches*(.88+.12*moisture)*(.9+.1*alpine);
 return{cover,moisture,shoreDistance};
}
