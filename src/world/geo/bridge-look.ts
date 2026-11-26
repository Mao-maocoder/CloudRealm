import { riverX, waterLevelAt } from './geo-core';

export const bridgeArtEnabled = !(import.meta.env?.DEV
    && new URLSearchParams(location.search).get('bridgeArt') === 'baseline');
export const bridgeReflectionLayer = 7;
export const mainBridgeZ = -85;
export const bridgePool = { x: riverX(mainBridgeZ), z: mainBridgeZ, y: waterLevelAt(mainBridgeZ) };

export const bridgeTrees = [
    { x: -80, z: -109, yaw: -.72, width: 7.7, height: 9.3 },
    { x: 5, z: -61, yaw: .83, width: 6.2, height: 7.0 },
] as const;

// Low-frequency canopy occlusion stays anchored to these trees when the
// real-time shadow camera follows the player or the player gains altitude.
export const bridgeShadeGLSL = `
float bridgeShade(vec2 p) {
    ${bridgeArtEnabled ? `
    if(any(lessThan(p,vec2(-90.,-116.)))||any(greaterThan(p,vec2(17.,-47.)))) return 0.;
    vec2 a=(p-vec2(-78.,-105.))/vec2(9.4,8.7);
    vec2 b=(p-vec2(7.,-57.))/vec2(7.6,6.9);
    float breaks=.07*sin(p.x*1.31+p.y*.62)+.055*sin(p.y*1.82-p.x*.46);
    return (1.-smoothstep(.17,1.17,min(dot(a,a),dot(b,b))+breaks))*.86;
    ` : 'return 0.;'}
}
`;
