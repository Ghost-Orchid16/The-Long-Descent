import * as THREE from 'three';
import { patchMaterial } from '../render/water/patch.js';

export const SWIM = { NONE: 0, FISH: 1, EEL: 2, SHARK: 3, RAY: 4, TURTLE: 5, WHALE: 6, JELLY: 7, OCTO: 8, CRUST: 9, SIPHON: 10, LIMBS: 11 };

// aAnim per instance: x = swim phase (radians, integrated on the CPU so speed changes stay smooth),
// y = swim effort (1 = cruising), z = body bend (signed path curvature * length), w = state (alarm/display 0..1).
const SWIM_GLSL = /* glsl */ `
attribute vec4 aBody;
attribute vec4 aAnim;
uniform vec4 uSwim;
uniform float uLen;
varying vec4 vBody;
varying vec4 vAnim;
varying vec3 vLocal;
varying vec2 vCUv;
vec3 swimOffset(vec3 p, vec4 b, vec4 an) {
  float t = b.x; float part = b.w;
  float P = an.x; float spd = an.y; float turn = an.z; float st = an.w;
  float time = uWTime;
  float rnd = fract(sin(float(gl_InstanceID) * 12.9898 + 1.7) * 43758.5453) * 6.2831853;
  float A = uSwim.x * uLen * (0.3 + 0.7 * min(spd, 1.8));
  vec3 o = vec3(0.0);
  #if SWIM_MODE == 1 || SWIM_MODE == 3
    float env = pow(smoothstep(0.08, 1.0, t), SWIM_MODE == 3 ? 1.25 : 1.6);
    o.x += A * env * sin(6.2831853 * t / uSwim.z - P);
    float tt = t - 0.35;
    o.x += turn * uLen * 0.45 * tt * tt;
    if (abs(part - 3.0) < 0.5) o.y += sin(0.7 * P + 1.3) * uLen * 0.04 * (abs(b.y) - 1.0);
    if (abs(part - 2.0) < 0.5 || abs(part - 5.0) < 0.5) o.x += A * 0.4 * sin(P - 2.0) * (abs(b.z) - 1.0);
    #if SWIM_MODE == 3
      // agonistic display (grey reef shark): arched back, raised snout, pectorals depressed
      o.y += st * uLen * 0.03 * sin(3.14159 * clamp(t, 0.0, 1.0));
      o.y += st * uLen * 0.035 * pow(max(0.3 - t, 0.0) / 0.3, 2.0);
      if (abs(part - 3.0) < 0.5) o.y -= st * uLen * 0.1 * (abs(b.y) - 1.0);
    #endif
  #elif SWIM_MODE == 2
    float env = 0.3 + 0.7 * t;
    o.x += A * env * sin(6.2831853 * t / uSwim.z - P);
    o.x += turn * uLen * 0.4 * (t - 0.35) * (t - 0.35);
  #elif SWIM_MODE == 4
    float l = abs(b.y);
    o.y += A * pow(l, 1.45) * sin(P - l * 1.7 - clamp(t, 0.0, 1.0) * 1.1);
    if (t > 1.0) { o.x += sin(0.6 * P + t * 4.0) * uLen * 0.03 * (t - 1.0); o.y += cos(0.5 * P + t * 3.0) * uLen * 0.02 * (t - 1.0); }
    o.x += turn * uLen * 0.05 * l * l;
  #elif SWIM_MODE == 5
    if (abs(part - 3.0) < 0.5) { float l = abs(b.y); float s = sin(P); o.y += s * uLen * 0.25 * l * l; o.z += cos(P) * uLen * 0.1 * l; }
    if (abs(part - 4.0) < 0.5) { o.x += sin(P + 2.0) * uLen * 0.03 * b.y; }
    if (abs(part - 8.0) < 0.5) { o.y += sin(time * 0.7 + rnd) * uLen * 0.012; o.x += sin(time * 0.4 + rnd) * uLen * 0.01 + turn * uLen * 0.03; }
  #elif SWIM_MODE == 6
    float env = pow(smoothstep(0.3, 1.0, t), 1.7);
    o.y += A * env * sin(6.2831853 * t / uSwim.z - P);
    o.x += turn * uLen * 0.3 * (t - 0.35) * (t - 0.35);
  #elif SWIM_MODE == 7
    float pulse = pow(0.5 + 0.5 * sin(P), 2.0);
    if (abs(part - 11.0) < 0.5) { o.xz += p.xz * (-0.14 * pulse * smoothstep(0.2, 1.0, t)); o.y -= 0.06 * pulse * uLen * t; }
    if (abs(part - 12.0) < 0.5) { float d = max(-b.z, 0.0); o.x += sin(time * 0.9 + p.y * 7.0 + rnd) * uLen * 0.07 * d; o.z += cos(time * 0.7 + p.y * 5.0 + rnd) * uLen * 0.07 * d; }
  #elif SWIM_MODE == 8
    if (abs(part - 10.0) < 0.5 || abs(part - 12.0) < 0.5) { float u = max(t - 0.5, 0.0) * 2.0; o.y += sin(time * 1.3 + b.y * 6.28 + u * 4.0 + rnd) * uLen * 0.06 * u; o.x += cos(time * 1.05 + b.y * 6.28 + u * 3.0 + rnd) * uLen * 0.05 * u; }
    if (abs(part - 11.0) < 0.5) { float pulse = 0.5 + 0.5 * sin(P); o.y -= pulse * 0.05 * uLen * t; }
    if (abs(part - 3.0) < 0.5) { o.y += sin(P * 1.1) * uLen * 0.07 * abs(b.y); }
    if (abs(part - 0.0) < 0.5) { float br = 0.5 + 0.5 * sin(time * 1.7 + rnd); o += p * 0.03 * br; }
  #elif SWIM_MODE == 9
    if (abs(part - 10.0) < 0.5) o.z += sin(time * 8.0 + b.x * 22.0 + rnd) * uLen * 0.04 * abs(b.z) * (0.3 + 0.7 * min(spd, 1.0));
    if (abs(part - 12.0) < 0.5) o.x += sin(time * 2.6 + rnd + b.y) * uLen * 0.05 * b.z;
  #elif SWIM_MODE == 10
    o.x += sin(t * 9.0 - time * 0.35 + rnd) * 0.3 * t;
    o.y += sin(t * 6.0 - time * 0.27 + rnd) * 0.15 * t;
    if (abs(part - 12.0) < 0.5) o.x += sin(time * 0.8 + t * 30.0) * 0.06 * (-b.z);
    if (abs(part - 11.0) < 0.5) o.xz *= 1.0 + 0.08 * sin(P);
  #elif SWIM_MODE == 11
    if (abs(part - 10.0) < 0.5) { o.y += sin(time * 1.6 + b.y * 6.28 + t * 6.0 + rnd) * uLen * 0.03 * t * (0.4 + 0.6 * min(spd, 1.0)); o.x += cos(time * 1.3 + b.y * 6.28 + t * 5.0 + rnd) * uLen * 0.02 * t; }
    if (abs(part - 12.0) < 0.5) { o.x += sin(time * 1.2 + rnd) * uLen * 0.04 * (b.z - 1.0); }
  #endif
  return o;
}
`;

const PATTERN_HELPERS = /* glsl */ `
varying vec4 vBody;
varying vec4 vAnim;
varying vec3 vLocal;
varying vec2 vCUv;
uniform float uLen;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4; uniform vec3 uC5;
float isPart(float p) { return 1.0 - step(0.5, abs(vBody.w - p)); }
float band(float x, float c, float w, float s) { return 1.0 - smoothstep(w, w + s, abs(x - c)); }
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }
float spotsW(vec3 p, float scale, float size) { return 1.0 - smoothstep(size * 0.85, size, worley3(p * scale)); }
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
float finTip(void) {
  float p = vBody.w;
  if (abs(p - 2.0) < 0.5 || abs(p - 5.0) < 0.5) return clamp(abs(vBody.z) - 1.0, 0.0, 1.0);
  if (abs(p - 1.0) < 0.5) return clamp(max(vCUv.x, abs(vBody.z)), 0.0, 1.0);
  if (abs(p - 3.0) < 0.5 || abs(p - 4.0) < 0.5) return clamp(abs(vBody.y) - 1.0, 0.0, 1.0);
  return 0.0;
}
// Sea-turtle carapace scute layout (vertebral, costal, marginal plates). Returns the cell's local
// coordinate sd (-1..1 inside the plate) and a per-plate random hue0.
vec3 turtleScutes(vec3 lp, out vec2 sd, out float hue0) {
  vec2 q = vec2(lp.x, lp.z);
  float ax = abs(q.x);
  vec2 cc, cs;
  if (ax < 0.095) { float k = clamp(floor((0.36 - q.y) / 0.145), 0.0, 4.0); cc = vec2(0.0, 0.36 - (k + 0.5) * 0.145); cs = vec2(0.095, 0.0725); }
  else if (ax < 0.3) { float k = clamp(floor((0.31 - q.y) / 0.155), 0.0, 3.0); cc = vec2(sign(q.x) * 0.197, 0.31 - (k + 0.5) * 0.155); cs = vec2(0.102, 0.0775); }
  else { float k = floor((q.y + 0.5) / 0.065); cc = vec2(sign(q.x) * 0.36, (k + 0.5) * 0.065 - 0.5); cs = vec2(0.06, 0.0325); }
  sd = (q - cc) / cs;
  hue0 = fract(sin(dot(cc, vec2(12.9898, 78.233))) * 43758.5453);
  return vec3(0.0);
}
float isFin(void) { float p = vBody.w; return (p > 0.5 && p < 5.5) ? 1.0 : 0.0; }
`;

/**
 * Build the material for a species.
 * spec: { swim: SWIM.x, amp, freq, wave, length, colors: [hex...], pattern: GLSL, rough, metal, translucent, wrap,
 *         transparent, opacity, side, emissive (GLSL using emis), envGain }
 */
export function makeCreatureMaterial(spec) {
  const Mat = spec.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Mat({
    color: 0xffffff, roughness: spec.rough ?? 0.5, metalness: spec.metal ?? 0,
    transparent: !!spec.transparent, opacity: spec.opacity ?? 1, side: spec.side ?? THREE.FrontSide,
    depthWrite: spec.depthWrite ?? !spec.transparent,
  });
  const cols = (spec.colors || []).concat(Array(6).fill('#808080')).slice(0, 6).map((h) => new THREE.Color(h));
  const uniforms = {
    uSwim: { value: new THREE.Vector4(spec.amp ?? 0.08, spec.freq ?? 1.5, spec.wave ?? 0.9, 0) },
    uLen: { value: spec.length ?? 1 },
  };
  cols.forEach((c, i) => (uniforms['uC' + i] = { value: new THREE.Vector3(c.r, c.g, c.b) }));
  patchMaterial(mat, {
    key: 'creature:' + spec.id,
    wrap: spec.wrap ?? 0.25,
    translucent: spec.translucent ?? 0,
    envGain: spec.envGain ?? 1,
    uniforms,
    vertexHead: `#define SWIM_MODE ${spec.swim ?? SWIM.FISH}\n` + SWIM_GLSL,
    vertexNormal: /* glsl */ `
      {
        vec3 pp = position;
        float e = uLen * 0.03;
        vec3 o1 = swimOffset(pp + vec3(0.0, 0.0, e), aBody - vec4(e / uLen, 0.0, 0.0, 0.0), aAnim);
        vec3 o0 = swimOffset(pp - vec3(0.0, 0.0, e), aBody + vec4(e / uLen, 0.0, 0.0, 0.0), aAnim);
        vec3 dz = (o1 - o0) / (2.0 * e);
        vec3 nn = vec3(objectNormal.x, objectNormal.y, objectNormal.z - objectNormal.x * dz.x - objectNormal.y * dz.y);
        objectNormal = dot(nn, nn) > 1e-10 ? normalize(nn) : vec3(0.0, 1.0, 0.0);
      }
    `,
    vertexTransform: /* glsl */ `
      vLocal = transformed; vBody = aBody; vAnim = aAnim; vCUv = uv;
      transformed += swimOffset(transformed, aBody, aAnim);
    `,
    fragmentHead: PATTERN_HELPERS,
    fragmentColor: /* glsl */ `
      float t = vBody.x; float lat = vBody.y; float ht = vBody.z; float part = vBody.w;
      vec3 lp = vLocal / uLen;
      vec3 col = uC0; float rough = ${(spec.rough ?? 0.5).toFixed(3)}; float metal = ${(spec.metal ?? 0).toFixed(3)};
      vec3 emis = vec3(0.0); float alpha = ${(spec.opacity ?? 1).toFixed(3)};
      ${spec.pattern || ''}
      if (isPart(6.0) > 0.5) {
        float ee = abs(lat) - 1.0;
        col = mix(${spec.iris || 'vec3(0.22, 0.17, 0.08)'}, vec3(0.002), smoothstep(0.16, 0.23, ee));
        rough = 0.05; metal = 0.0;
        ${spec.eyeExtra || ''}
      }
      diffuseColor.rgb = col * diffuseColor.rgb;
      diffuseColor.a = alpha;
    `,
    fragmentNormal: 'if (!(dot(normal, normal) > 1e-6)) normal = vec3(0.0, 0.0, 1.0);',
    fragmentRoughness: 'roughnessFactor = rough;',
    fragmentMetalness: 'metalnessFactor = metal;',
    fragmentEmissive: 'totalEmissiveRadiance += emis;',
  });
  mat.userData.spec = spec;
  return mat;
}
