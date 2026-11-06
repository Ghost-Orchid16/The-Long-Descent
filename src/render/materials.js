import * as THREE from 'three';
import { patchMaterial } from './water/patch.js';
import { TRI_FUNCS_GLSL } from './glsl/triplanar.js';

/**
 * Material for sessile organisms (corals, sponges, fans, anemones).
 * Base colour comes from per-instance colour; tips blend to uTipColor; triplanar detail adds polyps/cavities.
 */
export function makeOrganicMaterial(lib, {
  detail = 'coral', detailScale = 1 / 0.3, detailStrength = 0.6, normalStrength = 1,
  tipColor = [1, 1, 1], tipAmount = 0, baseColor = [1, 1, 1],
  sway = false, swayAmp = 1, wrap = 0.3, translucent = 0, roughness = 0.75, metalness = 0,
  emissiveTips = 0, side = THREE.FrontSide, key = '', tipReplace = false,
  macro = null, macroScale = 1 / 0.9, macroStrength = 0.6, mottle = 0.25,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...baseColor), roughness, metalness, side });
  const det = detail ? lib[detail + 'A'] : null;
  const detN = detail ? lib[detail + 'N'] : null;
  const uniforms = {
    uTipColor: { value: new THREE.Vector3(...tipColor) },
    uTipAmt: { value: tipAmount },
    tDet: { value: det }, tDetN: { value: detN },
    uDetScale: { value: detailScale }, uDetStr: { value: detailStrength }, uNrmStr: { value: normalStrength },
    uEmTip: { value: emissiveTips },
    tMacN: { value: macro ? lib[macro + 'N'] : null }, uMacS: { value: macroScale }, uMacK: { value: macroStrength },
    tMot: { value: lib.noise }, uMot: { value: mottle },
  };
  patchMaterial(mat, {
    sway, swayAmp, ao: true, wrap, translucent,
    key: 'organic' + (detail || 'none') + key + (tipReplace ? 'R' : '') + (macro ? 'M' + macro : ''),
    uniforms,
    vertexHead: 'attribute float aTip; varying float vTip; varying vec3 vOrgN;',
    vertexEnd: /* glsl */ `
      vTip = aTip;
      vec3 orgN = objectNormal;
      #ifdef USE_INSTANCING
        orgN = mat3(instanceMatrix) * orgN;
      #endif
      vOrgN = normalize(mat3(modelMatrix) * orgN);
    `,
    fragmentHead: /* glsl */ `
      uniform vec3 uTipColor; uniform float uTipAmt; uniform sampler2D tDet; uniform sampler2D tDetN;
      uniform float uDetScale; uniform float uDetStr; uniform float uNrmStr; uniform float uEmTip;
      uniform sampler2D tMacN; uniform float uMacS; uniform float uMacK; uniform sampler2D tMot; uniform float uMot;
      varying float vTip; varying vec3 vOrgN;
      ${TRI_FUNCS_GLSL}
    `,
    fragmentColor: /* glsl */ `
      vec3 orgNw = normalize(vOrgN);
      vec3 orgW = triW(orgNw);
      ${detail ? 'vec4 orgDet = triS(tDet, vWaterWorldPos, orgW, uDetScale);' : 'vec4 orgDet = vec4(1.0);'}
      ${tipReplace ? 'diffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, clamp(vTip * uTipAmt, 0.0, 1.0));' : 'diffuseColor.rgb *= mix(vec3(1.0), uTipColor, clamp(vTip * uTipAmt, 0.0, 1.0));'}
      diffuseColor.rgb *= mix(1.0, orgDet.r, uDetStr);
      // mottling: irregular lighter/darker patches across a colony
      vec4 mot = triS(tMot, vWaterWorldPos, orgW, 1.0 / 1.7);
      diffuseColor.rgb *= 1.0 + (mot.r - 0.5) * 2.0 * uMot + (mot.g - 0.5) * uMot;
    `,
    fragmentNormal: detail ? /* glsl */ `
      {
        vec3 nd = triNrm(tDetN, vWaterWorldPos, orgNw, orgW, uDetScale);
        vec3 nw = normalize(mix(orgNw, nd, uNrmStr));
        ${macro ? 'nw = normalize(nw + (triNrm(tMacN, vWaterWorldPos, orgNw, orgW, uMacS) - orgNw) * uMacK);' : ''}
        vec3 geoNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        nw = normalize(geoNw + (nw - orgNw));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }
    ` : '',
    fragmentEmissive: emissiveTips > 0 ? 'totalEmissiveRadiance += diffuseColor.rgb * uEmTip * vTip;' : '',
  });
  return mat;
}

/** Rock / reef substrate with triplanar rock texture and per-instance tint. */
export function makeRockMaterial(lib, { tex = 'rock', scale = 1 / 2.2, roughness = 0.9, key = '' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  patchMaterial(mat, {
    ao: true,
    key: 'rock' + tex + key,
    uniforms: { tRA: { value: lib[tex + 'A'] }, tRN: { value: lib[tex + 'N'] }, uRS: { value: scale } },
    vertexHead: 'varying vec3 vRkN;',
    vertexEnd: /* glsl */ `
      vec3 rkN = objectNormal;
      #ifdef USE_INSTANCING
        rkN = mat3(instanceMatrix) * rkN;
      #endif
      vRkN = normalize(mat3(modelMatrix) * rkN);
    `,
    fragmentHead: 'uniform sampler2D tRA; uniform sampler2D tRN; uniform float uRS; varying vec3 vRkN;\n' + TRI_FUNCS_GLSL,
    fragmentColor: /* glsl */ `
      vec3 rkNw = normalize(vRkN);
      vec3 rkW = triW(rkNw);
      diffuseColor.rgb *= triS(tRA, vWaterWorldPos, rkW, uRS).rgb * 1.15;
    `,
    fragmentNormal: /* glsl */ `
      {
        vec3 nw = triNrm(tRN, vWaterWorldPos, rkNw, rkW, uRS);
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }
    `,
  });
  return mat;
}

/** Plain PBR material with the water model (hulls, man-made objects, simple props). */
export function makeBasicPBR({ color = 0x888888, roughness = 0.7, metalness = 0, map = null, normalMap = null, emissive = 0x000000, emissiveIntensity = 1, side = THREE.FrontSide, transparent = false, opacity = 1, key = '' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, map, normalMap, emissive, emissiveIntensity, side, transparent, opacity });
  patchMaterial(mat, { key: 'basic' + key });
  return mat;
}

/** Fine mesh for gorgonian fans: anti-aliased net lines that fade to average coverage with distance. */
export function makeFanNetMaterial(lib, { cells = 110 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  patchMaterial(mat, {
    sway: true, swayAmp: 0.12, ao: true, wrap: 0.7, translucent: 0.35, key: 'fannet2',
    uniforms: { uCells: { value: cells } },
    vertexHead: 'varying vec2 vNetUv;',
    vertexEnd: 'vNetUv = uv;',
    fragmentHead: 'uniform float uCells; varying vec2 vNetUv;',
    fragmentColor: /* glsl */ `
      {
        vec3 w = worleyP(vNetUv, int(uCells), 0.85);
        float d = w.y - w.x;
        float fw = fwidth(d) + 1e-4;
        float line = 1.0 - smoothstep(0.085 - fw, 0.085 + fw, d);
        float far = clamp((fw - 0.28) * 3.0, 0.0, 1.0);
        float cover = mix(line, 0.5, far);
        // irregular outline: lobed, wider towards the top, ragged edge
        vec2 c = vNetUv - vec2(0.5, 0.55);
        float lobes = gnoise(vec3(atan(c.y, c.x) * 1.6, 1.0, 3.0)) * 0.22 + gnoise(vec3(vNetUv * 5.0, 7.0)) * 0.12;
        float rad = length(c * vec2(1.0, 1.25));
        float inside = smoothstep(0.52 + lobes, 0.47 + lobes, rad) * smoothstep(0.0, 0.08, vNetUv.y);
        float holes = smoothstep(-0.35, -0.2, gnoise(vec3(vNetUv * 3.0, 11.0)));
        cover *= inside * holes;
        diffuseColor.a = cover;
        diffuseColor.rgb *= 0.85 + 0.15 * w.z;
      }
    `,
  });
  return mat;
}

/**
 * Wreck steel: triplanar rust with fouling. Upward faces carry coralline crust and silt, sides show rust streaks
 * and encrusting sponge patches; roughness and normals from the rust texture.
 */
export function makeWreckMaterial(lib, { side = THREE.DoubleSide, key = '', foul = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05, side });
  patchMaterial(mat, {
    key: 'wreck' + key, ao: false, wrap: 0.2,
    uniforms: {
      tRA: { value: lib.rustA }, tRN: { value: lib.rustN }, tCA: { value: lib.reefA }, tCN: { value: lib.reefN }, tNz: { value: lib.noise },
      uFoul: { value: foul },
    },
    vertexHead: 'varying vec3 vWkN;',
    vertexEnd: 'vWkN = normalize(mat3(modelMatrix) * objectNormal);',
    fragmentHead: 'uniform sampler2D tRA; uniform sampler2D tRN; uniform sampler2D tCA; uniform sampler2D tCN; uniform sampler2D tNz; uniform float uFoul; varying vec3 vWkN;\n' + TRI_FUNCS_GLSL,
    fragmentColor: /* glsl */ `
      vec3 wkN = normalize(vWkN);
      #ifdef DOUBLE_SIDED
        if (!gl_FrontFacing) wkN = -wkN;
      #endif
      vec3 wkW = triW(wkN);
      vec4 rust = triS(tRA, vWaterWorldPos, wkW, 1.0 / 1.6);
      vec4 crust = triS(tCA, vWaterWorldPos, wkW, 1.0 / 2.4);
      vec4 nz = triS(tNz, vWaterWorldPos, wkW, 1.0 / 3.5);
      vec4 nz2 = triS(tNz, vWaterWorldPos * 0.23, wkW, 1.0 / 2.0);
      vec3 steel = rust.rgb * vec3(0.95, 0.78, 0.66);
      // rust streaks running down vertical plates
      float streak = smoothstep(0.55, 0.9, nz.g) * (1.0 - abs(wkN.y));
      steel = mix(steel, steel * vec3(0.55, 0.32, 0.2), streak * 0.6);
      // fouling: coralline crust + silt on top faces, sponge patches on the sides
      float up = smoothstep(0.15, 0.75, wkN.y);
      float foulA = clamp(up * (0.6 + 0.6 * nz2.r) + smoothstep(0.62, 0.8, nz2.g) * 0.55, 0.0, 1.0) * uFoul;
      vec3 crustCol = crust.rgb * mix(vec3(0.82, 0.62, 0.72), vec3(0.78, 0.74, 0.62), nz.b);
      vec3 col = mix(steel, crustCol, foulA);
      float sponge = smoothstep(0.7, 0.78, nz2.b) * (1.0 - up) * uFoul;
      col = mix(col, mix(vec3(0.85, 0.42, 0.12), vec3(0.62, 0.3, 0.55), step(0.5, nz.r)), sponge * 0.85);
      col = mix(col, col * vec3(0.92, 0.9, 0.82) + vec3(0.04, 0.035, 0.03), up * 0.35 * uFoul); // silt
      diffuseColor.rgb *= col;
      float wkRough = mix(0.82, 0.95, foulA);
    `,
    fragmentRoughness: 'roughnessFactor = wkRough;',
    fragmentNormal: /* glsl */ `
      {
        vec3 nR = triNrm(tRN, vWaterWorldPos, wkN, wkW, 1.0 / 1.6);
        vec3 nC = triNrm(tCN, vWaterWorldPos, wkN, wkW, 1.0 / 2.4);
        vec3 nd = normalize(mix(nR, nC, foulA));
        vec3 geoNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 nw = normalize(geoNw + (nd - wkN) * 0.9);
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }
    `,
  });
  return mat;
}
