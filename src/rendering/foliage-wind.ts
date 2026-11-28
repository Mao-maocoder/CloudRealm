import * as T from 'three';
import { art } from '../config/art';
import { meadowWindGLSL } from '../effects/meadow-trail';
import { surfaceWakeGLSL } from '../effects/surface-wake';
import { aerialPerspectiveGLSL, atmosphereUniforms } from './aerial-perspective';
import { valleyArtGLSL } from '../world/geo/valley-art';

export interface WindUniforms {
    time: { value: number };
    player: { value: T.Vector3 };
    playerVel: { value: T.Vector3 };
    wakeTexture?: { value: T.Texture | null };
    wakeWindow?: { value: T.Vector4 };
}

/**
 * Add wind sway (and optionally low-flight grass disturbance) to a foliage material.
 * `amplitude` is expressed in local metres at the tip of the geometry.
 */
export function windify(
    material: T.Material,
    uniforms: WindUniforms,
    amplitude: number,
    heightDivisor: number,
    playerInteraction = false,
    fadeWithDistance = false,
    mid = false,
) {
    material.customProgramCacheKey = () =>
        `meadow-trail4-${amplitude}-${heightDivisor}-${playerInteraction}-${fadeWithDistance}-${mid}`;
    material.onBeforeCompile = shader => {
        shader.uniforms.uTime = uniforms.time;
        shader.uniforms.uPlayer = uniforms.player;
        shader.uniforms.uPlayerVel = uniforms.playerVel;
        shader.uniforms.uWakeTex = uniforms.wakeTexture ?? { value: null };
        shader.uniforms.uWake = uniforms.wakeWindow ?? { value: new T.Vector4() };
        Object.assign(shader.uniforms, atmosphereUniforms);
        const interaction = playerInteraction
            ? `uniform vec3 uPlayer;
               uniform vec3 uPlayerVel;${surfaceWakeGLSL}`
            : '';
        shader.vertexShader = `uniform float uTime;varying float vMeadowGust;varying vec3 vLeafWorld;varying float vLeafCrown;varying vec3 vLeafCrownNormal;
            ${meadowWindGLSL}
            ${interaction}
            ${fadeWithDistance ? 'varying float vViewDist;' : ''}
            ` + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            #ifdef USE_INSTANCING
                vec3 origin = instanceMatrix[3].xyz;
                vLeafCrownNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
            #else
                vec3 origin = vec3(0.0);
                vLeafCrownNormal = normalize(mat3(modelMatrix) * normal);
            #endif
                ${fadeWithDistance ? `vViewDist = length(origin - cameraPosition); transformed.y *= 1.0-smoothstep(${mid ? art.grassMidFade[0] : art.grassFade[0]}.0,${mid ? art.grassMidFade[1] : art.grassFade[1]}.0,vViewDist);` : ''}
                float phase = origin.x * 0.17 + origin.z * 0.11;
                float bend = clamp(position.y / ${heightDivisor.toFixed(2)}, 0.0, 1.6);
                vLeafCrown = clamp(bend, 0.0, 1.0);
                float gust = meadowGust(origin.xz,uTime);vMeadowGust=gust;
                float sway = (sin(uTime * 1.55 + phase) * 0.22 + gust * 0.78) * ${amplitude.toFixed(3)};
                vec2 worldForce=vec2(sway, gust*${(amplitude * .6).toFixed(3)}) + omenShockBend(origin.xz) * ${(amplitude * 2.2).toFixed(3)};
                ${playerInteraction ? `
                #ifdef USE_INSTANCING
                  vec3 bladeBaseW = (modelMatrix * instanceMatrix * vec4(transformed.x, 0.0, transformed.z, 1.0)).xyz;
                #else
                  vec3 bladeBaseW = (modelMatrix * vec4(transformed.x, 0.0, transformed.z, 1.0)).xyz;
                #endif
                vec2 toBlade = bladeBaseW.xz - uPlayer.xz;
                float playerDist = length(toBlade);
                float verticalMatch = 1.0 - smoothstep(0.6, 2.0, abs(bladeBaseW.y - uPlayer.y));
                float partStrength = (1.0 - smoothstep(0.18, 1.55, playerDist)) * verticalMatch;
                vec2 partDir = playerDist > 0.01 ? toBlade / playerDist : vec2(1.0, 0.0);
                worldForce += partDir * partStrength * 1.05 + surfaceWakeAt(bladeBaseW.xz).xy;` : ''}
                worldForce*=min(1.,1.35/max(.001,length(worldForce)));
                #ifdef USE_INSTANCING
                  vec3 force3=vec3(worldForce.x,0.,worldForce.y);vec3 bx=instanceMatrix[0].xyz,bz=instanceMatrix[2].xyz;
                  transformed.x+=dot(force3,bx)/max(.001,dot(bx,bx))*bend*bend;
                  transformed.z+=dot(force3,bz)/max(.001,dot(bz,bz))*bend*bend;
                  ${playerInteraction ? 'transformed.y-=min(position.y*.58,length(worldForce)*.28*bend*bend);' : ''}
                  vLeafWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
                #else
                  transformed.xz+=worldForce*bend*bend;
                  ${playerInteraction ? 'transformed.y-=min(position.y*.58,length(worldForce)*.28*bend*bend);' : ''}
                  vLeafWorld=(modelMatrix*vec4(transformed,1.)).xyz;
                #endif
            `,
        );
        shader.fragmentShader = `${aerialPerspectiveGLSL}\n${valleyArtGLSL}\nuniform vec3 uVegTransColor,uVegRimColor;uniform float uVegTransStrength,uVegRimStrength;varying vec3 vLeafWorld;varying float vLeafCrown;varying vec3 vLeafCrownNormal;\n`
            + shader.fragmentShader
                .replace('#include <fog_fragment>', '')
                .replace('#include <alphatest_fragment>', `
                if (uGuofengStyle > 0.5) {
                    float mipDist = length(cameraPosition - vLeafWorld);
                    diffuseColor.a = clamp(diffuseColor.a * (1.0 + smoothstep(28.0, 200.0, mipDist) * 0.45), 0.0, 1.0);
                }
                #include <alphatest_fragment>`)
                .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                vec3 leafCN = normalize(vLeafCrownNormal);
                vec3 leafSunN = normalize(uAtmoSunDir);
                float leafSunWrap = smoothstep(-.45, .74, dot(leafCN, leafSunN));
                float leafSkyUp = smoothstep(-.55, .68, leafCN.y);
                float leafLitMix = clamp(leafSkyUp * .52 + leafSunWrap * .48, 0., 1.);
                float gfLeaf = uGuofengStyle;
                float dayGate = 1.0 - uNightFactor * 0.85;
                // Dreamy turquoise-teal undersides contrasting with airy sunlit chartreuse-lime tops.
                vec3 coolShadeTint = mix(vec3(.66, .84, .96), vec3(.44, .90, 1.04), uAtmoLight);
                vec3 warmCrownTint = mix(vec3(.92, .96, 1.0), vec3(1.18, 1.24, .76), uAtmoLight);
                // Guofeng: natural cool jade-green underside (never crushed black), warm sunlit upper crown, clean moonlit night.
                vec3 gfCoolShade = mix(vec3(.62, .78, .92), vec3(.78, .94, .88), uAtmoLight);
                vec3 gfWarmCrown = mix(vec3(.82, .94, 1.06), vec3(1.36, 1.32, .96), uAtmoLight);
                coolShadeTint = mix(coolShadeTint, gfCoolShade, gfLeaf);
                warmCrownTint = mix(warmCrownTint, gfWarmCrown, gfLeaf);
                reflectedLight.indirectDiffuse *= mix(coolShadeTint, warmCrownTint, leafLitMix);
                // Soft sky-hemisphere & crown-volume bounce so top-down aerial views of trees stay lush & readable (never dark silhouettes).
                reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(vec3(.07, .10, .14), vec3(.24, .25, .18), uAtmoLight) * (.42 + .58 * leafLitMix) * gfLeaf;
                vec3 directCrownTint = mix(
                    mix(vec3(.84, 1.02, 1.08), vec3(1.12, 1.18, .74), leafSunWrap * uAtmoLight),
                    mix(vec3(.78, .92, 1.00), vec3(1.24, 1.18, .86), leafSunWrap * uAtmoLight),
                    gfLeaf
                );
                reflectedLight.directDiffuse *= directCrownTint;
                vec3 leafViewDir = normalize(cameraPosition - vLeafWorld);
                float leafBackLit = pow(max(0., dot(leafViewDir, -leafSunN)), 2.1);
                float leafSunGlow = leafSunWrap * (.34 + .66 * leafBackLit) * (.45 + .55 * smoothstep(.15, .92, vLeafCrown));
                reflectedLight.indirectDiffuse += diffuseColor.rgb * uVegTransColor * uVegTransStrength * leafSunGlow * mix(.95, .72 * dayGate, gfLeaf);
                float leafRim = pow(1. - abs(dot(leafViewDir, leafCN)), 2.0) * (.35 + .65 * leafSkyUp) * (.42 + .58 * leafSunWrap);
                // Suppress harsh grazing white/grey rim sparkles at night in Guofeng mode.
                reflectedLight.indirectDiffuse += diffuseColor.rgb * uVegRimColor * uVegRimStrength * leafRim * mix(.85, .36 * dayGate, gfLeaf);`)
                .replace('#include <tonemapping_fragment>', `
                float leafDist = length(cameraPosition - vLeafWorld);
                float aerialStart = mix(130., 185., uGuofengStyle);
                float aerialEnd = mix(470., 680., uGuofengStyle);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vLeafWorld), smoothstep(aerialStart, aerialEnd, leafDist));
                #include <tonemapping_fragment>`);
        shader.fragmentShader = 'varying float vMeadowGust;\n' + shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n diffuseColor.rgb *= .96 + vMeadowGust*.065;',
        );
        if (fadeWithDistance) {
            shader.fragmentShader = 'varying float vViewDist;\n' + shader.fragmentShader.replace(
                'void main() {',
                `void main() {
                float fade = 1.0-smoothstep(${mid ? art.grassMidFade[0] : art.grassFade[0]}.0, ${mid ? art.grassMidFade[1] : art.grassFade[1]}.0, vViewDist);
                if (fade < 0.015) discard;`,
            );
        }
    };
}

/** Painterly sculpted bark with vertical fissures, mossy roots, cool shadow fill, and woodland mist. */
export function makePainterlyBarkMaterial(color: T.ColorRepresentation) {
    const material = new T.MeshLambertMaterial({ color, vertexColors: true });
    material.customProgramCacheKey = () => `painterly-bark-v1-${new T.Color(color).getHexString()}`;
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, atmosphereUniforms);
        shader.vertexShader = 'varying vec3 vBarkLocal;varying vec3 vBarkWorld;varying vec3 vBarkWorldN;\n' + shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vBarkLocal = position;
            #ifdef USE_INSTANCING
                vBarkWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
                vBarkWorldN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
            #else
                vBarkWorld = (modelMatrix * vec4(transformed, 1.)).xyz;
                vBarkWorldN = normalize(mat3(modelMatrix) * normal);
            #endif`,
        );
        shader.fragmentShader = `${aerialPerspectiveGLSL}\n${valleyArtGLSL}\nvarying vec3 vBarkLocal;varying vec3 vBarkWorld;varying vec3 vBarkWorldN;\n`
            + shader.fragmentShader
                .replace('#include <fog_fragment>', '')
                .replace('#include <color_fragment>', `#include <color_fragment>
                float barkAngle = atan(vBarkLocal.z, vBarkLocal.x);
                float barkY = vBarkLocal.y;
                float barkDetail = 1. - smoothstep(.018, .15, max(length(dFdx(vBarkLocal)), length(dFdy(vBarkLocal))));
                float grooveA = sin(barkAngle * 14. + sin(barkY * 1.1 + barkAngle * 3.) * 1.65);
                float grooveB = sin(barkAngle * 27. - barkY * 1.6 + sin(barkAngle * 7. + barkY * .8) * 1.3);
                float barkPlate = sin(barkY * 5.2 + grooveA * 1.4) * .25 + grooveA * .52 + grooveB * .23;
                float ridge = smoothstep(-.35, .58, barkPlate);
                float gfBark = uGuofengStyle;
                vec3 furrowTint = mix(vec3(.62, .56, .60), vec3(1.26, 1.14, .96), ridge);
                diffuseColor.rgb *= mix(vec3(1.), furrowTint, barkDetail * .86);
                diffuseColor.rgb *= mix(vec3(1.), vec3(.58, .52, .46), gfBark);
                // Soft root moss & ground bounce near the grass line.
                float rootMoss = (1. - smoothstep(-.15, 1.35, barkY)) * (.52 + .48 * ridge);
                diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(.28, .50, .32), vec3(.20, .32, .20), gfBark), rootMoss * .38);`)
                .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
                vec3 barkN = normalize(vBarkWorldN);
                float barkSun = smoothstep(-.45, .72, dot(barkN, normalize(uAtmoSunDir)));
                reflectedLight.indirectDiffuse *= mix(vec3(.88, .92, 1.02), vec3(1.22, 1.14, .98), barkSun);
                reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(.10, .12, .13) * uAtmoLight;`)
                .replace('#include <tonemapping_fragment>', `
                float barkDist = length(cameraPosition - vBarkWorld);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, applyAerialPerspective(gl_FragColor.rgb, vBarkWorld), smoothstep(130., 470., barkDist));
                #include <tonemapping_fragment>`);
    };
    return material;
}
