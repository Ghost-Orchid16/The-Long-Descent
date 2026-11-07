import * as THREE from 'three';
import { WATER_UNIFORMS_GLSL, WATER_FUNCS_GLSL, buildLightsChunk } from './waterGLSL.js';
import { NOISE_GLSL } from '../glsl/noise.js';

let LIGHTS_CHUNK = null;
let PHYS_PARS = null;
function physParsChunk() {
  if (PHYS_PARS) return PHYS_PARS;
  const a = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );';
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(a)) throw new Error('[waterPatch] physical pars chunk changed');
  PHYS_PARS = src.replace(a, `
    #ifdef W_WRAP
      float wWrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + W_WRAP ) / ( 1.0 + W_WRAP ) );
      reflectedLight.directDiffuse += wWrapNL * directLight.color * diffuseBRDF * ( 1.0 - F );
    #else
      ${a}
    #endif
    #ifdef W_TRANSLUCENT
      float wBack = saturate( dot( -geometryNormal, directLight.direction ) );
      reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( 0.35 * wBack + 0.12 ) * W_TRANSLUCENT;
    #endif
  `);
  return PHYS_PARS;
}
function lightsChunk() {
  if (!LIGHTS_CHUNK) LIGHTS_CHUNK = buildLightsChunk(THREE.ShaderChunk.lights_fragment_begin);
  return LIGHTS_CHUNK;
}

let sharedUniforms = null;

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
/** Called once by WaterEnv so every patched material shares the same uniform objects. */
export function setSharedWaterUniforms(u) { sharedUniforms = u; }
export function getSharedWaterUniforms() { return sharedUniforms; }

const PROJECT_VERTEX = /* glsl */ `
  vec4 wLocalPos = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    wLocalPos = batchingMatrix * wLocalPos;
  #endif
  #ifdef USE_INSTANCING
    wLocalPos = instanceMatrix * wLocalPos;
  #endif
  vec4 wWorld = modelMatrix * wLocalPos;
  #ifdef W_SWAY
    {
      float wsPh = dot( wWorld.xz, vec2( 0.21, 0.13 ) ) + aSwayPhase;
      float wsS = sin( uWTime * 0.55 + wsPh ) * 0.7 + sin( uWTime * 1.37 + wsPh * 1.9 ) * 0.3;
      float wsW = aSway * aSway * uWSurgeAmp * W_SWAY_AMP;
      wWorld.xz += uWSurge * wsS * wsW;
      wWorld.y -= abs( wsS ) * wsW * 0.18;
    }
  #endif
  W_WORLD_HOOK
  vWaterWorldPos = wWorld.xyz;
  vec4 mvPosition = viewMatrix * wWorld;
  gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a three.js material (Standard/Physical/Lambert/Basic) with the underwater model.
 * @param {THREE.Material} mat
 * @param {object} o options
 */
export function patchMaterial(mat, o = {}) {
  const key = 'w2|' + hashString(JSON.stringify([
    !!o.sway, o.swayAmp ?? 1, !!o.ao, !!o.additive, !!o.noMedium, o.key || '', o.wrap || 0, o.translucent || 0,
    o.varyings, o.vertexHead, o.vertexTransform, o.vertexNormal, o.worldHook, o.vertexEnd,
    o.fragmentHead, o.fragmentColor, o.fragmentNormal, o.fragmentRoughness, o.fragmentEmissive,
    o.fragmentPreLights, o.fragmentOutput, o.fragmentFinal, o.fragmentMetalness, o.envGain ?? 1,
  ]));
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (sharedUniforms) Object.assign(shader.uniforms, sharedUniforms);
    if (o.uniforms) Object.assign(shader.uniforms, o.uniforms);

    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    const defs = [];
    if (o.sway) defs.push('#define W_SWAY', '#define W_SWAY_AMP ' + (o.swayAmp ?? 1).toFixed(3));
    if (o.ao) defs.push('#define W_AO');
    if (o.wrap) defs.push('#define W_WRAP ' + o.wrap.toFixed(3));
    defs.push('#define W_ENV_GAIN ' + (o.envGain ?? 1).toFixed(3));
    if (o.translucent) defs.push('#define W_TRANSLUCENT ' + o.translucent.toFixed(3));
    const defStr = defs.join('\n') + '\n';

    const vHead = defStr + WATER_UNIFORMS_GLSL + `
      varying vec3 vWaterWorldPos;
      #ifdef W_SWAY
        attribute float aSway;
        attribute float aSwayPhase;
      #endif
      #ifdef W_AO
        attribute float aAO;
        varying float vWaterAO;
      #endif
      ${o.varyings || ''}
      ${o.vertexHead || ''}
    `;
    vs = vs.replace('#include <common>', '#include <common>\n' + vHead);
    if (o.vertexTransform) {
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + o.vertexTransform);
    }
    if (o.vertexNormal) {
      vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + o.vertexNormal);
    }
    vs = vs.replace('#include <project_vertex>', PROJECT_VERTEX.replace('W_WORLD_HOOK', o.worldHook || ''));
    vs = vs.replace('#include <fog_vertex>', `#include <fog_vertex>
      #ifdef W_AO
        vWaterAO = aAO;
      #endif
      ${o.vertexEnd || ''}`);

    const fHead = defStr + WATER_UNIFORMS_GLSL + NOISE_GLSL + WATER_FUNCS_GLSL + `
      varying vec3 vWaterWorldPos;
      #ifdef W_AO
        varying float vWaterAO;
      #endif
      vec3 wLightAtten( float l ) { return ( uWAbove > 0.5 && wDepth( vWaterWorldPos ) <= 0.0 ) ? vec3( 1.0 ) : wLightPath( l ); }
      ${o.varyings || ''}
      ${o.fragmentHead || ''}
    `;
    fs = fs.replace('#include <common>', '#include <common>\n' + fHead);
    if (o.fragmentColor) {
      fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + o.fragmentColor);
    }
    if (o.fragmentNormal) {
      fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + o.fragmentNormal);
    }
    if (o.fragmentRoughness) {
      fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + o.fragmentRoughness);
    }
    if (o.fragmentMetalness) {
      fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + o.fragmentMetalness);
    }
    if (o.fragmentEmissive) {
      fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + o.fragmentEmissive);
    }
    if ((o.wrap || o.translucent) && fs.includes('#include <lights_physical_pars_fragment>')) {
      fs = fs.replace('#include <lights_physical_pars_fragment>', physParsChunk());
    }
    if (fs.includes('#include <lights_fragment_begin>')) {
      fs = fs.replace('#include <lights_fragment_begin>', `
        #ifdef W_AO
          float wAO = vWaterAO;
        #else
          float wAO = 1.0;
        #endif
        if ( !( dot( normal, normal ) > 1e-6 ) ) normal = vec3( 0.0, 0.0, 1.0 );
        ${o.fragmentPreLights || ''}
        ${lightsChunk()}`);
    }
    if (fs.includes('#include <lights_fragment_maps>')) {
      fs = fs.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        #if defined( RE_IndirectSpecular ) && !defined( USE_ENVMAP )
        if ( uWAbove < 0.5 ) {
          vec3 wN = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
          vec3 wV = normalize( ( vec4( geometryViewDir, 0.0 ) * viewMatrix ).xyz );
          vec3 wR = reflect( -wV, wN );
          float wPD = max( wDepth( vWaterWorldPos ), 0.0 );
          // the water body as an environment: bright above (towards the light), dark below
          radiance += ( wInScatter( wPD, wR, 80.0 ) * 1.6 + ( uWSunColor * 0.25 + uWSkyColor ) * exp( -uWKd * wPD ) * pow( max( wR.y, 0.0 ), 3.0 ) * 0.12 ) * W_ENV_GAIN;
        }
        #endif`);
    }
    if (o.fragmentOutput) {
      fs = fs.replace('#include <opaque_fragment>', o.fragmentOutput + '\n#include <opaque_fragment>');
    }
    let medium = '';
    if (!o.noMedium) {
      medium = o.additive
        ? 'gl_FragColor.rgb = wApplyMediumAdditive( gl_FragColor.rgb, vWaterWorldPos );'
        : 'gl_FragColor.rgb = wApplyMedium( gl_FragColor.rgb, vWaterWorldPos );';
    }
    fs = fs.replace('#include <fog_fragment>', medium + '\n' + (o.fragmentFinal || ''));

    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (prevCompile) prevCompile(shader, renderer);
    if (o.onShader) o.onShader(shader);
  };
  mat.customProgramCacheKey = () => key;
  mat.userData.waterPatched = true;
  return mat;
}
