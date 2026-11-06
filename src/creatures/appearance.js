// Per-species appearance: geometry generator + parameters, swim mode, colours (sRGB) and GLSL pattern.
// Patterns write: col (linear albedo), rough, metal, emis (emissive radiance), alpha.
// Available: t (0 nose..1 tail), lat (-1..1, |lat|>1 on paired fins), ht (-1 belly..1 back; >1 on median fins),
// part ids (0 body,1 caudal,2 dorsal,3 pectoral,4 pelvic,5 anal,6 eye,7 spine,8 extra,9 lure,10 arm,11 bell,12 tentacle,13 shell),
// lp (local position / length), vCUv, uC0..uC5, vAnim (x phase, y speed, z turn, w state), uWTime.
import { SWIM } from './CreatureMaterial.js';

const shark = (o) => ({
  gen: 'body', swim: SWIM.SHARK, amp: 0.07, freq: 0.75, wave: 1.05,
  body: {
    length: o.length, seg: 34, rad: 18, exponent: 2.1, belly: 0.85,
    height: o.height || [[0, 0.015], [0.05, 0.07], [0.28, 0.155], [0.55, 0.125], [0.85, 0.045], [1, 0.032]],
    width: o.width || [[0, 0.03], [0.06, 0.1], [0.3, 0.155], [0.6, 0.11], [1, 0.022]],
    center: [[0, -0.005], [0.2, 0], [1, 0.01]],
    caudal: { type: 'hetero', len: o.caudalLen ?? 0.21, span: o.caudalSpan ?? 0.27 },
    dorsal: o.dorsal || [{ t0: 0.3, t1: 0.45, h: 0.12, sweep: 0.7, skew: 0.42 }, { t0: 0.73, t1: 0.79, h: 0.035, sweep: 0.6, skew: 0.5 }],
    anal: o.anal || [{ t0: 0.74, t1: 0.8, h: 0.03, sweep: 0.5, skew: 0.5 }],
    pectoral: o.pectoral || { t: 0.24, h: -0.45, len: 0.2, w: 0.085, angle: 1.05, up: -0.32 },
    pelvic: { t: 0.6, h: -0.8, len: 0.06, w: 0.03, angle: 0.8, up: -0.4 },
    eye: { t: 0.075, up: 0.15, out: 0.92, r: 0.0085 },
  },
});

const reefFish = (o) => ({ gen: 'body', swim: SWIM.FISH, amp: 0.1, freq: 2.2, wave: 0.95, ...o });

export const APPEARANCE = {
  // ------------------------------------------------------------------------------------- reef
  green_turtle: {
    gen: 'turtle', params: { length: 1.0 }, swim: SWIM.TURTLE, freq: 0.32, rough: 0.55, wrap: 0.25,
    colors: ['#5a4a2c', '#8c6c34', '#241a10', '#6a6a52', '#cdbd8e', '#d8d0ac'],
    pattern: `
      if (isPart(0.0) > 0.5) {
        float rad = gnoise(vec3(atan(lp.x, lp.z) * 6.0, length(lp.xz) * 18.0, 1.0)) * 0.5 + 0.5;
        col = mix(uC0, uC1, rad * 0.7);
        float cell = worley3(vec3(lp.x * 4.0, 2.0, lp.z * 3.2));
        col = mix(col, uC2, smoothstep(0.06, 0.0, cell - 0.38) * 0.5);
        col *= 0.75 + 0.35 * smoothstep(0.0, 0.5, cell);
        col = mix(uC4, col, smoothstep(-0.55, -0.25, ht));
        rough = 0.45;
      } else {
        float sc = worley3(lp * 38.0);
        col = mix(uC5, uC3 * 0.55, smoothstep(0.12, 0.35, sc));
        rough = 0.7;
      }
    `,
  },
  hawksbill: {
    gen: 'turtle', params: { length: 0.8, hawksbill: true }, swim: SWIM.TURTLE, freq: 0.38, rough: 0.4,
    colors: ['#7a4c1c', '#c89646', '#2e1a0c', '#5a4a34', '#d8c898', '#d0c090'],
    pattern: `
      if (isPart(0.0) > 0.5) {
        float n = gnoise(vec3(lp.x * 7.0, lp.z * 5.0, 2.0)) * 0.5 + 0.5;
        float streak = gnoise(vec3(atan(lp.x, lp.z + 0.2) * 9.0, length(lp.xz) * 6.0, 4.0)) * 0.5 + 0.5;
        col = mix(uC2, uC1, smoothstep(0.35, 0.75, n * 0.6 + streak * 0.5));
        col = mix(col, uC0, 0.35);
        float cell = worley3(vec3(lp.x * 3.6, 5.0, lp.z * 3.0));
        col *= 0.7 + 0.4 * smoothstep(0.0, 0.45, cell);
        col = mix(uC4, col, smoothstep(-0.55, -0.25, ht));
        rough = 0.32;
      } else {
        float sc = worley3(lp * 34.0);
        col = mix(uC5, uC3 * 0.5, smoothstep(0.12, 0.33, sc));
      }
    `,
  },
  reef_manta: {
    gen: 'ray', params: { span: 3.5, kind: 'manta' }, swim: SWIM.RAY, amp: 0.13, freq: 0.24, rough: 0.55, length: 3.5,
    colors: ['#141618', '#d6dadb', '#e8ecea', '#1c1e20', '#3a3d40', '#a0a4a6'],
    pattern: `
      if (ht > 0.0) {
        col = uC0;
        float sx = abs(lat);
        // pale shoulder patches, V-shaped, behind the head
        float shp = smoothstep(0.06, 0.0, abs(sx - 0.2 - (t - 0.2) * 0.6)) * band(t, 0.33, 0.12, 0.05) * step(0.08, sx);
        col = mix(col, uC1, shp * 0.85);
        col *= 0.9 + 0.1 * gnoise(lp * 30.0);
      } else {
        col = uC2;
        // unique dark spots between the gill slits + dark trailing margins
        float sp = spotsW(vec3(lp.x * 2.0, 0.0, lp.z), 9.0, 0.32) * band(t, 0.42, 0.12, 0.05) * step(abs(lat), 0.18);
        col = mix(col, uC3, sp);
        col = mix(col, uC4, smoothstep(0.75, 1.0, abs(lat)) * 0.8);
        col = mix(col, uC4, smoothstep(0.82, 1.0, t) * 0.6);
      }
      if (isPart(8.0) > 0.5 || isPart(1.0) > 0.5 || isPart(2.0) > 0.5) col = uC0;
    `,
  },
  blacktip_reef: {
    ...shark({ length: 1.5 }), rough: 0.5, colors: ['#8c8a7c', '#e4e4de', '#0c0c0e', '#b8b6a8', '#6a6a60', '#d0d0c8'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.35, 0.15, ht));
      col = mix(col, uC3, band(ht, -0.2, 0.08, 0.1) * step(0.35, t) * step(t, 0.8) * 0.6);
      float tip = finTip();
      if (isFin() > 0.5) { col = mix(uC0, uC2, smoothstep(0.62, 0.8, tip)); if (isPart(2.0) > 0.5) col = mix(col, uC5, band(tip, 0.55, 0.06, 0.06) * 0.7); }
      rough = 0.5; metal = 0.05;
    `,
  },
  whitetip_reef: {
    ...shark({ length: 1.5, height: [[0, 0.02], [0.05, 0.07], [0.3, 0.13], [0.6, 0.1], [0.88, 0.035], [1, 0.028]], dorsal: [{ t0: 0.34, t1: 0.48, h: 0.1, sweep: 0.6, skew: 0.45 }, { t0: 0.72, t1: 0.78, h: 0.04, sweep: 0.5, skew: 0.5 }] }),
    colors: ['#7c7e80', '#dededa', '#f2f2ee', '#3a3c3e', '#9a9c9e', '#5a5c5e'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.35, 0.1, ht));
      col = mix(col, uC3, spotsW(lp, 14.0, 0.18) * step(0.0, ht) * 0.5);
      float tip = finTip();
      if (isPart(2.0) > 0.5 || (isPart(1.0) > 0.5 && ht > 0.2)) col = mix(uC0, uC2, smoothstep(0.62, 0.8, tip));
      else if (isFin() > 0.5) col = uC0;
    `,
  },
  moorish_idol: reefFish({
    swim: SWIM.FISH, amp: 0.07, freq: 2.0,
    body: {
      length: 0.2, seg: 26, rad: 16, exponent: 2.3,
      height: [[0, 0.04], [0.12, 0.08], [0.22, 0.5], [0.4, 0.74], [0.62, 0.55], [0.85, 0.12], [1, 0.08]],
      width: [[0, 0.03], [0.15, 0.06], [0.4, 0.1], [0.8, 0.05], [1, 0.03]],
      center: [[0, -0.05], [0.15, -0.04], [0.4, 0.04], [1, 0]],
      caudal: { type: 'lunate', len: 0.17, span: 0.32 },
      dorsal: [{ t0: 0.28, t1: 0.58, h: 0.4, sweep: 2.4, shape: [[0, 0.3], [0.15, 1.0], [0.3, 0.6], [1, 0.2]] }],
      anal: [{ t0: 0.4, t1: 0.65, h: 0.3, sweep: 0.8, skew: 0.5 }],
      pectoral: { t: 0.34, h: -0.1, len: 0.12, w: 0.05, angle: 0.6 },
      spines: [{ t: 0.36, len: 0.95, r: 0.008, lean: 1.05, curl: 0.25 }],
      eye: { t: 0.2, up: 0.1, r: 0.03 },
    },
    colors: ['#f2f0e8', '#0e0e10', '#ecc21e', '#e46a1a', '#fafafa', '#202020'],
    pattern: `
      col = uC0;
      col = mix(col, uC2, smoothstep(0.42, 0.55, t) * smoothstep(-0.2, 0.4, ht) * 0.9);
      float b1 = band(t, 0.31, 0.09, 0.015), b2 = band(t, 0.66, 0.06, 0.015);
      col = mix(col, uC1, max(b1, b2));
      col = mix(col, uC3, band(t, 0.1, 0.06, 0.03) * step(0.15, ht));
      if (isPart(1.0) > 0.5) col = mix(uC1, uC4, smoothstep(0.86, 0.95, vCUv.x));
      if (isPart(7.0) > 0.5) col = uC4;
      if (isPart(2.0) > 0.5) col = mix(uC4, uC1, band(t, 0.33, 0.07, 0.02));
      if (isPart(5.0) > 0.5) col = mix(uC2, uC1, band(t, 0.6, 0.06, 0.02));
      rough = 0.4;
    `,
  }),
  bumphead: reefFish({
    amp: 0.07, freq: 1.1,
    body: {
      length: 1.2, seg: 28, rad: 16, exponent: 2.2,
      height: [[0, 0.12], [0.05, 0.3], [0.15, 0.43], [0.4, 0.42], [0.75, 0.24], [1, 0.1]],
      width: [[0, 0.1], [0.15, 0.2], [0.4, 0.22], [0.8, 0.1], [1, 0.05]],
      center: [[0, 0.0], [0.08, 0.05], [0.3, 0.02], [1, 0]],
      caudal: { type: 'truncate', len: 0.16, span: 0.3 },
      dorsal: [{ t0: 0.25, t1: 0.82, h: 0.08, sweep: 0.2 }], anal: [{ t0: 0.6, t1: 0.82, h: 0.07, sweep: 0.2 }],
      pectoral: { t: 0.3, h: -0.1, len: 0.11, w: 0.06, angle: 0.5 }, pelvic: { t: 0.36, h: -0.85, len: 0.07, w: 0.03, angle: 0.4 },
      eye: { t: 0.12, up: 0.0, r: 0.012 },
    },
    colors: ['#4f5e52', '#7c8c7c', '#d8cfb2', '#2a3430', '#5f6f62', '#9aa89a'],
    pattern: `
      float sc = worley3(lp * 26.0);
      col = mix(uC0, uC1, smoothstep(0.08, 0.0, t) * 0.7 + smoothstep(0.3, 0.0, t) * smoothstep(0.2, 0.8, ht) * 0.3);
      col *= 0.85 + 0.2 * smoothstep(0.05, 0.4, sc);
      if (t < 0.035 && abs(ht) < 0.35) col = uC2;
      if (isFin() > 0.5) col = uC3 * 1.3;
      rough = 0.55;
    `,
  }),
  napoleon: reefFish({
    amp: 0.06, freq: 1.0,
    body: {
      length: 1.4, seg: 28, rad: 16, exponent: 2.2,
      height: [[0, 0.1], [0.06, 0.24], [0.2, 0.36], [0.45, 0.38], [0.8, 0.2], [1, 0.12]],
      width: [[0, 0.08], [0.2, 0.17], [0.45, 0.18], [0.85, 0.08], [1, 0.05]],
      center: [[0, -0.02], [0.15, 0.03], [0.4, 0.01], [1, 0]],
      caudal: { type: 'round', len: 0.17, span: 0.32 },
      dorsal: [{ t0: 0.22, t1: 0.84, h: 0.09, sweep: 0.25 }], anal: [{ t0: 0.6, t1: 0.86, h: 0.09, sweep: 0.3 }],
      pectoral: { t: 0.3, h: -0.1, len: 0.12, w: 0.07, angle: 0.5 }, pelvic: { t: 0.34, h: -0.85, len: 0.08, w: 0.03 },
      eye: { t: 0.11, up: 0.2, r: 0.011 },
    },
    colors: ['#2f6a62', '#4e8a7c', '#c68a5a', '#183632', '#9ec0b0', '#1e4a46'],
    pattern: `
      vec3 cells = vec3(worley3(vec3(lp.x * 18.0, lp.y * 18.0, lp.z * 24.0)));
      col = mix(uC0, uC1, smoothstep(0.0, 0.5, cells.x));
      col = mix(col, uC3, smoothstep(0.12, 0.02, cells.x) * 0.6);
      float maze = abs(sin(gnoise(lp * 14.0) * 9.0));
      col = mix(col, uC2, smoothstep(0.85, 0.98, maze) * smoothstep(0.28, 0.1, t));
      col = mix(col, uC3, band(ht, 0.25, 0.05, 0.04) * band(t, 0.16, 0.06, 0.03));
      if (isFin() > 0.5) col = mix(uC1, uC5, 0.5);
      rough = 0.45;
    `,
  }),
  palette_tang: reefFish({
    amp: 0.1, freq: 2.5,
    body: {
      length: 0.25, seg: 24, rad: 16, exponent: 2.2,
      height: [[0, 0.1], [0.1, 0.3], [0.35, 0.44], [0.65, 0.36], [0.9, 0.12], [1, 0.08]],
      width: [[0, 0.05], [0.3, 0.12], [0.7, 0.08], [1, 0.04]],
      caudal: { type: 'truncate', len: 0.17, span: 0.32 },
      dorsal: [{ t0: 0.18, t1: 0.86, h: 0.08, sweep: 0.2 }], anal: [{ t0: 0.45, t1: 0.86, h: 0.07, sweep: 0.2 }],
      pectoral: { t: 0.27, h: -0.05, len: 0.13, w: 0.06, angle: 0.55 }, pelvic: { t: 0.32, h: -0.85, len: 0.07, w: 0.03 },
      eye: { t: 0.14, up: 0.2, r: 0.032 },
    },
    colors: ['#1a48c0', '#0a0a16', '#f0d020', '#2c64e0', '#101828', '#f4e060'],
    pattern: `
      col = uC0;
      // the black 'palette': a loop from the eye along the upper flank towards the tail
      float up = band(ht, 0.42 + (t - 0.4) * 0.4, 0.12, 0.05) * band(t, 0.48, 0.32, 0.05);
      float loop = band(ht, 0.05, 0.1, 0.05) * band(t, 0.6, 0.2, 0.05);
      float dors = smoothstep(0.82, 0.95, ht);
      col = mix(col, uC1, max(max(up, loop), dors));
      if (isPart(1.0) > 0.5) col = mix(uC2, uC1, smoothstep(0.7, 0.9, abs(ht)));
      if (isPart(3.0) > 0.5) col = uC5;
      if (isPart(2.0) > 0.5 || isPart(5.0) > 0.5) col = mix(uC3, uC1, 0.6);
      rough = 0.4; metal = 0.05;
    `,
  }),
  anemonefish: reefFish({
    amp: 0.09, freq: 3.2,
    body: {
      length: 0.13, seg: 22, rad: 14, exponent: 2.2,
      height: [[0, 0.12], [0.1, 0.3], [0.35, 0.38], [0.7, 0.3], [0.92, 0.12], [1, 0.1]],
      width: [[0, 0.07], [0.3, 0.16], [0.7, 0.11], [1, 0.05]],
      caudal: { type: 'round', len: 0.2, span: 0.32 },
      dorsal: [{ t0: 0.22, t1: 0.82, h: 0.12, sweep: 0.2, skew: 0.6 }], anal: [{ t0: 0.58, t1: 0.82, h: 0.12, sweep: 0.2 }],
      pectoral: { t: 0.28, h: -0.2, len: 0.14, w: 0.07, angle: 0.6 }, pelvic: { t: 0.34, h: -0.85, len: 0.1, w: 0.04 },
      eye: { t: 0.12, up: 0.25, r: 0.04 },
    },
    colors: ['#2a1810', '#e4eef6', '#f07418', '#f4f4ee', '#100806', '#d06010'],
    iris: 'vec3(0.5, 0.25, 0.05)',
    pattern: `
      col = uC0;
      float b1 = band(t, 0.18, 0.05, 0.012), b2 = band(t, 0.5, 0.055, 0.012);
      float edge1 = band(t, 0.18, 0.068, 0.01) - b1, edge2 = band(t, 0.5, 0.072, 0.01) - b2;
      col = mix(col, uC4, clamp(edge1 + edge2, 0.0, 1.0));
      col = mix(col, uC1, max(b1, b2));
      if (isPart(2.0) > 0.5 || isPart(5.0) > 0.5 || isPart(3.0) > 0.5 || isPart(4.0) > 0.5) col = mix(uC2, uC5, 0.2);
      if (isPart(1.0) > 0.5) col = uC3;
      rough = 0.35;
    `,
  }),
  lionfish: reefFish({
    amp: 0.04, freq: 1.2,
    body: {
      length: 0.33, seg: 26, rad: 16, exponent: 2.2,
      height: [[0, 0.1], [0.12, 0.24], [0.35, 0.29], [0.7, 0.2], [0.92, 0.09], [1, 0.07]],
      width: [[0, 0.08], [0.3, 0.16], [0.7, 0.1], [1, 0.04]],
      caudal: { type: 'round', len: 0.2, span: 0.26 },
      dorsal: [{ t0: 0.62, t1: 0.86, h: 0.12, sweep: 0.2 }], anal: [{ t0: 0.62, t1: 0.82, h: 0.1, sweep: 0.3 }],
      pectoral: { t: 0.28, h: -0.2, len: 0.48, w: 0.3, angle: 1.0, up: -0.15 },
      pelvic: { t: 0.32, h: -0.85, len: 0.2, w: 0.06, angle: 0.4 },
      spines: [0.18, 0.24, 0.3, 0.36, 0.42, 0.48, 0.54].map((t, i) => ({ t, len: 0.32 - i * 0.02, r: 0.006, lean: 0.35 })),
      eye: { t: 0.1, up: 0.35, r: 0.03 },
    },
    colors: ['#f0e6dc', '#741814', '#9a2a1e', '#f6f0e8', '#4a0e0a', '#d8c0b0'],
    pattern: `
      float st = sin(t * 64.0 + ht * 2.0 + gnoise(lp * 8.0) * 1.5);
      col = mix(uC0, uC1, smoothstep(-0.2, 0.25, st));
      float fine = sin(t * 150.0) ;
      col = mix(col, uC2, smoothstep(0.7, 0.95, fine) * 0.4);
      if (isPart(3.0) > 0.5 || isPart(4.0) > 0.5) { float r = sin(vCUv.y * 30.0 + vCUv.x * 4.0); float sp = sin(vCUv.x * 28.0); col = mix(uC3, uC1, smoothstep(0.3, 0.8, r * sp)); }
      if (isPart(7.0) > 0.5) col = mix(uC3, uC1, step(0.5, fract(ht * 6.0)));
      if (isPart(1.0) > 0.5 || isPart(2.0) > 0.5 || isPart(5.0) > 0.5) col = mix(uC3, uC1, spotsW(vec3(vCUv * 6.0, 0.0), 2.0, 0.3));
      rough = 0.5;
    `,
  }),
  giant_clam: {
    gen: 'bivalve', params: { length: 0.3, kind: 'clam' }, swim: SWIM.NONE, rough: 0.45, length: 0.3,
    colors: ['#c8bfae', '#14609c', '#18a08a', '#7ad8f4', '#0a2a4a', '#e8e0c8'],
    pattern: `
      if (isPart(13.0) > 0.5) {
        float ribs = 0.8 + 0.2 * sin(vCUv.x * 40.0);
        col = uC0 * ribs * (0.85 + 0.15 * gnoise(lp * 20.0));
        rough = 0.75;
      } else {
        float n = gnoise(lp * 16.0) * 0.5 + 0.5;
        col = mix(uC1, uC2, smoothstep(0.3, 0.7, n));
        col = mix(col, uC3, spotsW(lp, 28.0, 0.28) * 0.8);
        col = mix(col, uC4, smoothstep(0.85, 1.0, abs(lat)));
        rough = 0.22; metal = 0.25;
      }
    `,
  },
  day_octopus: {
    gen: 'octopus', params: { span: 0.8, kind: 'day' }, swim: SWIM.OCTO, freq: 0.5, length: 0.8, rough: 0.6, wrap: 0.4,
    colors: ['#6a4a30', '#c2a280', '#2a1a10', '#5a5a48', '#f0e8dc', '#8a3a26'],
    pattern: `
      float n = fbm3(lp * 9.0, 3) * 0.5 + 0.5;
      float w = worley3(lp * 22.0);
      vec3 camo = mix(uC3, uC1 * 0.8, smoothstep(0.35, 0.7, n));
      vec3 alarm = mix(uC5, uC2, smoothstep(0.3, 0.7, n));
      col = mix(camo, alarm, vAnim.w);
      col = mix(col, uC4, smoothstep(0.12, 0.0, w) * 0.35 * (1.0 - vAnim.w));
      col *= 0.85 + 0.2 * smoothstep(0.05, 0.3, w);
      if (isPart(10.0) > 0.5) col = mix(col, uC4 * 0.8, smoothstep(-0.2, -0.8, ht) * 0.3);
    `,
  },
  chromis: reefFish({
    amp: 0.1, freq: 3.4, metal: 0.35, rough: 0.3,
    body: {
      length: 0.08, seg: 20, rad: 12, exponent: 2.2,
      height: [[0, 0.1], [0.1, 0.3], [0.35, 0.42], [0.7, 0.3], [0.9, 0.12], [1, 0.08]],
      width: [[0, 0.06], [0.3, 0.15], [0.7, 0.1], [1, 0.04]],
      caudal: { type: 'forked', len: 0.26, span: 0.42 },
      dorsal: [{ t0: 0.24, t1: 0.84, h: 0.13, sweep: 0.25, skew: 0.5 }], anal: [{ t0: 0.56, t1: 0.82, h: 0.12, sweep: 0.3 }],
      pectoral: { t: 0.28, h: -0.1, len: 0.15, w: 0.06, angle: 0.6 }, pelvic: { t: 0.34, h: -0.85, len: 0.1, w: 0.04 },
      eye: { t: 0.12, up: 0.2, r: 0.045 },
    },
    colors: ['#3cb4b0', '#8edcd0', '#2a8ea0', '#c8f0e8', '#205a68', '#5ad0c0'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.4, 0.4, ht));
      if (isFin() > 0.5) col = mix(uC5, uC3, 0.4);
      metal = 0.35; rough = 0.3;
    `,
  }),
  cleaner_wrasse: reefFish({
    amp: 0.1, freq: 3.0,
    body: {
      length: 0.11, seg: 22, rad: 12, exponent: 2.2,
      height: [[0, 0.06], [0.12, 0.15], [0.4, 0.19], [0.8, 0.14], [1, 0.09]],
      width: [[0, 0.05], [0.3, 0.11], [0.8, 0.07], [1, 0.04]],
      caudal: { type: 'round', len: 0.16, span: 0.2 },
      dorsal: [{ t0: 0.25, t1: 0.86, h: 0.06, sweep: 0.2 }], anal: [{ t0: 0.55, t1: 0.85, h: 0.05, sweep: 0.2 }],
      pectoral: { t: 0.27, h: 0, len: 0.12, w: 0.05, angle: 0.6 },
      eye: { t: 0.1, up: 0.2, r: 0.025 },
    },
    colors: ['#c8d8e2', '#0e1218', '#2a76d2', '#e6eef2', '#5aa0e8', '#101418'],
    pattern: `
      col = mix(uC0, uC4, smoothstep(0.35, 0.9, t));
      float w = 0.1 + t * 0.2;
      col = mix(col, uC1, band(ht, 0.0, w, 0.06));
      if (isPart(1.0) > 0.5) col = mix(uC2, uC1, band(ht, 0.0, 0.3, 0.1));
      if (isPart(2.0) > 0.5 || isPart(5.0) > 0.5) col = mix(uC2, uC5, 0.4);
    `,
  }),
  // ------------------------------------------------------------------------------------- wall
  grey_reef: {
    ...shark({ length: 1.75 }), colors: ['#6a7074', '#e2e2de', '#0a0b0c', '#9ea4a8', '#4a4e52', '#c8ccce'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.35, 0.12, ht));
      col *= 0.95 + 0.08 * gnoise(lp * 18.0);
      if (isPart(1.0) > 0.5) col = mix(uC0, uC2, smoothstep(0.62, 0.85, vCUv.x) + smoothstep(0.8, 0.95, abs(ht)) * 0.6);
      else if (isPart(3.0) > 0.5 || isPart(4.0) > 0.5 || isPart(5.0) > 0.5) col = mix(uC0, uC2 * 3.0, smoothstep(0.55, 0.85, finTip()) * 0.85);
      else if (isPart(2.0) > 0.5) col = uC0;
      rough = 0.45; metal = 0.06;
    `,
  },
  chevron_barracuda: reefFish({
    amp: 0.05, freq: 1.4, wave: 1.0, metal: 0.65, rough: 0.28,
    body: {
      length: 0.9, seg: 30, rad: 14, exponent: 2.0,
      height: [[0, 0.03], [0.08, 0.08], [0.3, 0.13], [0.6, 0.12], [0.9, 0.06], [1, 0.05]],
      width: [[0, 0.03], [0.1, 0.08], [0.35, 0.11], [0.7, 0.09], [1, 0.04]],
      caudal: { type: 'forked', len: 0.16, span: 0.22 },
      dorsal: [{ t0: 0.36, t1: 0.44, h: 0.07, sweep: 0.4 }, { t0: 0.66, t1: 0.72, h: 0.05, sweep: 0.4 }], anal: [{ t0: 0.67, t1: 0.73, h: 0.045, sweep: 0.4 }],
      pectoral: { t: 0.27, h: -0.2, len: 0.07, w: 0.03, angle: 0.6 }, pelvic: { t: 0.42, h: -0.85, len: 0.05, w: 0.02 },
      eye: { t: 0.08, up: 0.25, r: 0.012 },
    },
    colors: ['#a8b2ba', '#3a4048', '#e8ecee', '#2a3038', '#6a747c', '#c0c8ce'],
    pattern: `
      col = mix(uC2, uC0, smoothstep(-0.5, 0.2, ht));
      float chev = fract(t * 20.0 + abs(ht) * 0.9);
      col = mix(col, uC1, smoothstep(0.08, 0.0, abs(chev - 0.5)) * step(0.15, t) * step(t, 0.92) * smoothstep(-0.6, 0.0, ht));
      if (isPart(1.0) > 0.5 || isPart(2.0) > 0.5) col = uC3;
      metal = mix(0.65, 0.2, isFin()); rough = 0.28;
    `,
  }),
  giant_trevally: reefFish({
    amp: 0.06, freq: 1.4, wave: 1.0, metal: 0.55, rough: 0.3,
    body: {
      length: 1.15, seg: 28, rad: 16, exponent: 2.1,
      height: [[0, 0.12], [0.06, 0.24], [0.25, 0.36], [0.55, 0.3], [0.85, 0.08], [1, 0.05]],
      width: [[0, 0.06], [0.25, 0.15], [0.6, 0.12], [1, 0.03]],
      center: [[0, -0.02], [0.2, 0.02], [1, 0]],
      caudal: { type: 'lunate', len: 0.2, span: 0.34 },
      dorsal: [{ t0: 0.34, t1: 0.4, h: 0.06, sweep: 0.4 }, { t0: 0.45, t1: 0.82, h: 0.1, sweep: 0.5, skew: 0.3 }], anal: [{ t0: 0.52, t1: 0.82, h: 0.08, sweep: 0.5, skew: 0.3 }],
      pectoral: { t: 0.28, h: -0.1, len: 0.22, w: 0.05, angle: 0.8, up: -0.05 }, pelvic: { t: 0.34, h: -0.85, len: 0.06, w: 0.03 },
      eye: { t: 0.09, up: 0.3, r: 0.014 },
    },
    colors: ['#9aa2a4', '#3e4648', '#d8dcdc', '#242a2c', '#6c7476', '#b8bebe'],
    pattern: `
      col = mix(uC2, uC0, smoothstep(-0.5, 0.0, ht));
      col = mix(col, uC1, smoothstep(0.2, 0.7, ht));
      col *= 0.9 + 0.12 * spotsW(lp, 40.0, 0.12);
      if (isFin() > 0.5) col = uC3;
      metal = mix(0.55, 0.1, isFin());
    `,
  }),
  eagle_ray: {
    gen: 'ray', params: { span: 2.0, kind: 'eagle' }, swim: SWIM.RAY, amp: 0.14, freq: 0.35, rough: 0.45, length: 2.0,
    colors: ['#26303a', '#e6e8e6', '#f0f2f0', '#12161a', '#3a444e', '#c8ccc8'],
    pattern: `
      if (ht > 0.0) {
        col = uC0;
        float w = worley3(vec3(lp.x * 9.0, 0.0, lp.z * 9.0));
        float ring = smoothstep(0.09, 0.05, abs(w - 0.18)) ;
        col = mix(col, uC1, max(ring, smoothstep(0.08, 0.02, w)) * step(t, 1.0) * 0.9);
      } else col = uC2;
      if (isPart(1.0) > 0.5) col = uC3;
      if (isPart(8.0) > 0.5) col = mix(uC2, uC0, smoothstep(-0.1, 0.3, ht));
    `,
  },
  giant_moray: {
    gen: 'body', swim: SWIM.EEL, amp: 0.12, freq: 0.6, wave: 0.55, rough: 0.35,
    body: {
      length: 2.2, seg: 46, rad: 12, exponent: 2.0,
      height: [[0, 0.03], [0.04, 0.07], [0.15, 0.085], [0.6, 0.075], [0.92, 0.04], [1, 0.005]],
      width: [[0, 0.03], [0.05, 0.06], [0.2, 0.07], [0.7, 0.05], [1, 0.004]],
      caudal: { type: 'none' },
      dorsal: [{ t0: 0.08, t1: 1.0, h: 0.022, sweep: 0.1, skew: 0.5, shape: [[0, 0.5], [0.1, 1], [0.9, 1], [1, 0.3]] }],
      anal: [{ t0: 0.48, t1: 1.0, h: 0.018, sweep: 0.1, shape: [[0, 0.5], [0.1, 1], [0.9, 1], [1, 0.3]] }],
      eye: { t: 0.025, up: 0.45, r: 0.004 },
    },
    colors: ['#6a5c34', '#161208', '#8a7a48', '#0a0806', '#4a3e22', '#a89a6a'],
    pattern: `
      col = uC0;
      float lep = spotsW(lp * vec3(1.0, 1.0, 0.6), 30.0, 0.32);
      col = mix(col, uC1, lep * 0.85);
      col = mix(col, uC2, smoothstep(-0.2, -0.8, ht) * 0.4);
      col = mix(col, uC3, band(t, 0.075, 0.012, 0.008) * band(ht, -0.1, 0.3, 0.1));
      if (t < 0.035 && ht < -0.1) col = mix(col, vec3(0.6, 0.15, 0.1), vAnim.w * 0.6);
      rough = 0.3;
    `,
  },
  // ------------------------------------------------------------------------------------- twilight
  lanternfish: reefFish({
    amp: 0.1, freq: 3.0, metal: 0.7, rough: 0.25,
    body: {
      length: 0.08, seg: 22, rad: 12, exponent: 2.1,
      height: [[0, 0.1], [0.12, 0.22], [0.4, 0.22], [0.85, 0.1], [1, 0.07]],
      width: [[0, 0.07], [0.3, 0.12], [0.8, 0.07], [1, 0.04]],
      caudal: { type: 'forked', len: 0.2, span: 0.3 },
      dorsal: [{ t0: 0.4, t1: 0.6, h: 0.1, sweep: 0.3 }], anal: [{ t0: 0.55, t1: 0.75, h: 0.08, sweep: 0.3 }],
      pectoral: { t: 0.26, h: -0.2, len: 0.12, w: 0.04 },
      eye: { t: 0.09, up: 0.1, r: 0.055 },
    },
    colors: ['#141a26', '#b8c4cc', '#40e0c8', '#0a0e16', '#2a3440', '#8090a0'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(0.0, 0.5, ht));
      // rows of photophores along the belly and lower flank
      float row = band(ht, -0.55, 0.05, 0.04) + band(ht, -0.2, 0.04, 0.03);
      float dots = smoothstep(0.35, 0.15, abs(fract(t * 16.0) - 0.5)) * row * step(0.12, t) * step(t, 0.88);
      emis = uC2 * dots * 2.4 * (0.75 + 0.25 * sin(uWTime * 1.7 + vAnim.x));
      metal = mix(0.7, 0.0, dots);
      if (isFin() > 0.5) { col = uC4; metal = 0.0; }
    `,
  }),
  hatchetfish: reefFish({
    amp: 0.08, freq: 3.0, metal: 0.92, rough: 0.12,
    body: {
      length: 0.07, seg: 22, rad: 12, exponent: 2.1,
      height: [[0, 0.16], [0.12, 0.48], [0.35, 0.56], [0.6, 0.3], [0.78, 0.08], [1, 0.06]],
      width: [[0, 0.04], [0.3, 0.08], [0.8, 0.04], [1, 0.03]],
      center: [[0, 0.1], [0.12, 0.0], [0.35, -0.06], [0.7, 0.04], [1, 0.05]],
      caudal: { type: 'forked', len: 0.2, span: 0.24 },
      dorsal: [{ t0: 0.42, t1: 0.54, h: 0.08, sweep: 0.3 }], anal: [{ t0: 0.58, t1: 0.72, h: 0.05, sweep: 0.3 }],
      pectoral: { t: 0.3, h: -0.3, len: 0.14, w: 0.04 },
      eye: { t: 0.1, up: 0.45, r: 0.06 },
    },
    colors: ['#c8d0d8', '#2a3038', '#3aa0ff', '#e8eef2', '#101418', '#9aa4b0'],
    pattern: `
      col = mix(uC3, uC1, smoothstep(0.55, 0.85, ht));
      float keel = smoothstep(-0.7, -0.9, ht);
      float dots = smoothstep(0.32, 0.12, abs(fract(t * 14.0) - 0.5)) * keel * step(0.1, t) * step(t, 0.7);
      emis = uC2 * dots * 2.0;
      metal = mix(0.92, 0.0, max(dots, isFin())); rough = 0.12;
      if (isFin() > 0.5) col = uC5 * 0.6;
    `,
  }),
  nautilus: {
    gen: 'nautilus', params: { size: 0.2 }, swim: SWIM.OCTO, freq: 0.3, length: 0.2, rough: 0.35, wrap: 0.3,
    colors: ['#f2ece0', '#a04e1c', '#7a5a40', '#d8c8b0', '#2a1a10', '#e8dcc8'],
    pattern: `
      if (isPart(13.0) > 0.5) {
        float stripe = smoothstep(0.1, 0.0, abs(fract(t * 22.0 + gnoise(lp * 10.0) * 0.3) - 0.5) - 0.18);
        float upper = smoothstep(-0.2, 0.4, ht) * smoothstep(0.05, 0.6, t);
        col = mix(uC0, uC1, stripe * upper);
        rough = 0.28;
      } else if (isPart(8.0) > 0.5) {
        col = mix(uC2, uC5, spotsW(lp, 30.0, 0.3));
      } else col = uC3;
    `,
  },
  sixgill: {
    ...shark({
      length: 4.0,
      height: [[0, 0.02], [0.05, 0.07], [0.3, 0.14], [0.6, 0.11], [0.8, 0.06], [1, 0.035]],
      width: [[0, 0.06], [0.05, 0.13], [0.3, 0.15], [0.6, 0.1], [1, 0.02]],
      dorsal: [{ t0: 0.62, t1: 0.68, h: 0.045, sweep: 0.6, skew: 0.45 }],
      caudalLen: 0.3, caudalSpan: 0.22,
      pectoral: { t: 0.24, h: -0.5, len: 0.12, w: 0.07, angle: 0.95, up: -0.3 },
    }),
    freq: 0.35, amp: 0.06,
    colors: ['#3a3632', '#6a645c', '#1a1816', '#8a8278', '#2a2622', '#4e4a44'],
    iris: 'vec3(0.1, 0.6, 0.35)',
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.4, 0.1, ht));
      col *= 0.9 + 0.12 * gnoise(lp * 12.0);
      float gills = step(0.13, t) * step(t, 0.21) * smoothstep(0.012, 0.0, abs(fract(t * 75.0) - 0.5) * 0.04) * band(ht, 0.0, 0.5, 0.1);
      col = mix(col, uC2, gills);
      if (isFin() > 0.5) col = uC4;
      rough = 0.6;
    `,
  },
  sperm_whale: {
    gen: 'whale', params: { length: 13 }, swim: SWIM.WHALE, amp: 0.05, freq: 0.12, wave: 1.2, length: 13, rough: 0.55,
    colors: ['#3a3836', '#2a2826', '#d8d4cc', '#5a5650', '#1e1c1a', '#6e6a64'],
    iris: 'vec3(0.05)',
    pattern: `
      float wr = abs(sin(lp.y * 220.0 + gnoise(lp * 40.0) * 3.0)) ;
      col = mix(uC0, uC3, smoothstep(0.8, 1.0, wr) * smoothstep(0.35, 0.8, t) * 0.4);
      col *= 0.9 + 0.15 * gnoise(lp * 20.0);
      float scar = smoothstep(0.004, 0.0, abs(gnoise(lp * vec3(30.0, 30.0, 6.0)))) * smoothstep(0.35, 0.0, t);
      col = mix(col, uC5, scar * 0.6);
      if (isPart(8.0) > 0.5) col = mix(uC2, uC0, smoothstep(-0.5, 0.5, ht));
      rough = 0.5;
    `,
  },
  siphonophore: {
    gen: 'siphonophore', params: { length: 15 }, swim: SWIM.SIPHON, length: 15, rough: 0.15, transparent: true, opacity: 0.45, translucent: 0.6, envGain: 1.5,
    colors: ['#cfe0f0', '#ffffff', '#5ab0ff', '#e0a0c0', '#a0c8e8', '#ffffff'],
    pattern: `
      col = uC0;
      if (isPart(11.0) > 0.5) { col = uC4; alpha = 0.3; }
      if (isPart(8.0) > 0.5) { col = uC3; alpha = 0.6; emis = uC2 * (0.35 + 0.35 * sin(uWTime * 2.0 + t * 40.0)); }
      if (isPart(12.0) > 0.5) { alpha = 0.5; }
    `,
  },
  comb_jelly: {
    gen: 'jelly', params: { diameter: 0.1, kind: 'comb' }, swim: SWIM.JELLY, freq: 0.15, length: 0.1, rough: 0.08, transparent: true, opacity: 0.22, translucent: 0.5, envGain: 2.0,
    colors: ['#dfeaf2', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
    pattern: `
      col = uC0;
      float a = atan(lp.z, lp.x) / 6.2831853 + 0.5;
      float comb = smoothstep(0.035, 0.0, abs(fract(a * 8.0) - 0.5) - 0.44) * smoothstep(0.08, 0.25, t) * smoothstep(0.92, 0.75, t);
      // diffraction from beating cilia: a moving rainbow that only appears where light falls on it
      col = mix(col, hue(fract(t * 3.0 - uWTime * 1.3 + a * 2.0)), comb);
      metal = comb; rough = mix(0.08, 0.02, comb);
      alpha = mix(0.2, 0.85, comb);
    `,
  },
  vampire_squid: {
    gen: 'octopus', params: { span: 0.3, kind: 'vampire' }, swim: SWIM.OCTO, freq: 0.35, length: 0.3, rough: 0.55, wrap: 0.3,
    colors: ['#3a0a0e', '#1a0406', '#4a1418', '#80a0ff', '#2a0608', '#5a1e22'],
    iris: 'vec3(0.25, 0.35, 0.8)',
    pattern: `
      col = mix(uC0, uC2, gnoise(lp * 10.0) * 0.5 + 0.5);
      if (isPart(11.0) > 0.5) col = mix(uC1, uC0, ht * 0.5 + 0.5);
      if (isPart(9.0) > 0.5) { col = uC3; emis = uC3 * (0.6 + 1.6 * vAnim.w) * (0.7 + 0.3 * sin(uWTime * 3.0 + lat * 20.0)); }
    `,
  },
  // ------------------------------------------------------------------------------------- midnight
  anglerfish: {
    gen: 'body', swim: SWIM.FISH, amp: 0.05, freq: 0.6, wave: 0.9, rough: 0.92,
    body: {
      length: 0.18, seg: 24, rad: 18, exponent: 2.0,
      height: [[0, 0.3], [0.06, 0.48], [0.3, 0.62], [0.65, 0.48], [0.9, 0.14], [1, 0.08]],
      width: [[0, 0.32], [0.15, 0.5], [0.4, 0.54], [0.8, 0.26], [1, 0.05]],
      caudal: { type: 'round', len: 0.18, span: 0.22 },
      dorsal: [{ t0: 0.62, t1: 0.78, h: 0.08, sweep: 0.2 }], anal: [{ t0: 0.64, t1: 0.78, h: 0.06, sweep: 0.2 }],
      pectoral: { t: 0.5, h: -0.1, len: 0.1, w: 0.06, angle: 0.4 },
      spines: [{ t: 0.12, len: 0.42, r: 0.008, lean: -0.45, curl: -0.1 }],
      eye: { t: 0.16, up: 0.45, r: 0.018 },
    },
    lure: { t: 0.12, len: 0.42, r: 0.035 },
    colors: ['#0a0a0c', '#16181a', '#70ffe0', '#2a2c2e', '#c8d0c8', '#000000'],
    pattern: `
      col = uC0 * (0.8 + 0.4 * gnoise(lp * 30.0));
      // gaping mouth with needle teeth
      float mouth = smoothstep(0.08, 0.02, t) * band(ht, -0.05, 0.45, 0.1);
      col = mix(col, uC5, mouth);
      float teeth = mouth * smoothstep(0.6, 0.95, sin(lat * 60.0)) * band(ht, 0.0, 0.5, 0.1);
      col = mix(col, uC4, teeth);
      if (isPart(9.0) > 0.5) { col = uC2; emis = uC2 * (1.2 + 0.8 * sin(uWTime * 1.1 + vAnim.x)) * (0.6 + vAnim.w); }
      if (isPart(7.0) > 0.5) col = uC3;
      rough = 0.9;
    `,
  },
  fangtooth: {
    gen: 'body', swim: SWIM.FISH, amp: 0.08, freq: 1.4, rough: 0.8,
    body: {
      length: 0.16, seg: 24, rad: 14, exponent: 2.1,
      height: [[0, 0.22], [0.08, 0.38], [0.3, 0.36], [0.7, 0.2], [0.9, 0.1], [1, 0.08]],
      width: [[0, 0.16], [0.15, 0.24], [0.5, 0.18], [1, 0.04]],
      caudal: { type: 'forked', len: 0.18, span: 0.26 },
      dorsal: [{ t0: 0.34, t1: 0.7, h: 0.1, sweep: 0.3 }], anal: [{ t0: 0.6, t1: 0.76, h: 0.08, sweep: 0.3 }],
      pectoral: { t: 0.32, h: -0.2, len: 0.12, w: 0.05 },
      spines: [-0.04, 0.0, 0.04].map((x, i) => ({ t: 0.02 + i * 0.01, x, len: 0.12, r: 0.006, lean: -0.9, bottom: false })),
      eye: { t: 0.12, up: 0.4, r: 0.03 },
    },
    colors: ['#1c1412', '#2e2420', '#e8e4d8', '#0c0806', '#3a2e28', '#000000'],
    pattern: `
      float sc = worley3(lp * 46.0);
      col = mix(uC0, uC1, smoothstep(0.1, 0.4, sc));
      col = mix(col, uC5, smoothstep(0.07, 0.02, t) * band(ht, -0.1, 0.4, 0.1));
      if (isPart(7.0) > 0.5) { col = uC2; rough = 0.2; }
      if (isFin() > 0.5) col = uC3;
    `,
  },
  gulper_eel: {
    gen: 'body', swim: SWIM.EEL, amp: 0.14, freq: 0.7, wave: 0.6, rough: 0.8,
    body: {
      length: 0.75, seg: 50, rad: 12, exponent: 2.0,
      height: [[0, 0.05], [0.04, 0.16], [0.12, 0.17], [0.2, 0.05], [0.5, 0.03], [0.9, 0.01], [1, 0.003]],
      width: [[0, 0.06], [0.06, 0.14], [0.14, 0.12], [0.22, 0.04], [0.6, 0.02], [1, 0.003]],
      caudal: { type: 'none' },
      eye: { t: 0.015, up: 0.6, r: 0.004 },
    },
    colors: ['#0c0c10', '#1a1a20', '#ff5a80', '#000000', '#30303a', '#000000'],
    pattern: `
      col = uC0;
      col = mix(col, uC3, band(ht, -0.15, 0.25, 0.1) * smoothstep(0.16, 0.06, t));
      float tip = smoothstep(0.95, 0.995, t);
      emis = uC2 * tip * (1.5 + 1.2 * sin(uWTime * 2.3 + vAnim.x));
      col = mix(col, uC2, tip);
    `,
  },
  loosejaw: {
    gen: 'body', swim: SWIM.FISH, amp: 0.1, freq: 1.6, rough: 0.55,
    body: {
      length: 0.25, seg: 30, rad: 12, exponent: 2.0,
      height: [[0, 0.05], [0.06, 0.12], [0.25, 0.12], [0.75, 0.09], [0.92, 0.05], [1, 0.04]],
      width: [[0, 0.04], [0.1, 0.08], [0.5, 0.07], [1, 0.03]],
      caudal: { type: 'truncate', len: 0.12, span: 0.13 },
      dorsal: [{ t0: 0.78, t1: 0.9, h: 0.06, sweep: 0.3 }], anal: [{ t0: 0.74, t1: 0.9, h: 0.06, sweep: 0.3 }],
      pectoral: { t: 0.2, h: -0.3, len: 0.07, w: 0.02 },
      eye: { t: 0.05, up: 0.3, r: 0.018 },
    },
    colors: ['#08080a', '#141416', '#ff2a10', '#4aa0ff', '#2a2a2e', '#000000'],
    pattern: `
      col = uC0 * (0.85 + 0.3 * gnoise(lp * 40.0));
      float red = smoothstep(0.035, 0.015, length(vec2((t - 0.075) * 4.0, ht + 0.15))) ;
      float blue = smoothstep(0.02, 0.008, length(vec2((t - 0.11) * 4.0, ht - 0.25)));
      emis = uC2 * red * 4.0 + uC3 * blue * 2.5;
      col = mix(col, uC2 * 0.4, red);
      if (isFin() > 0.5) col = uC4;
    `,
  },
  atolla: {
    gen: 'jelly', params: { diameter: 0.15, kind: 'atolla' }, swim: SWIM.JELLY, freq: 0.32, length: 0.15, rough: 0.25, translucent: 0.6, wrap: 0.6, envGain: 1.2,
    colors: ['#8a0e14', '#5a060a', '#3a8cff', '#b02a2a', '#2a0204', '#ffffff'],
    pattern: `
      col = mix(uC0, uC1, smoothstep(0.3, 0.9, t));
      col = mix(col, uC3, band(t, 0.55, 0.03, 0.03) * 0.6);
      if (isPart(12.0) > 0.5) col = uC3;
      // bioluminescent 'burglar alarm': a pinwheel of blue light running round the bell
      float a = atan(lp.z, lp.x) / 6.2831853 + 0.5;
      float wave = smoothstep(0.15, 0.0, abs(fract(a * 3.0 - uWTime * 1.6) - 0.5) - 0.38);
      emis = uC2 * vAnim.w * wave * smoothstep(0.4, 0.95, t) * 6.0 + uC2 * 0.03 * smoothstep(0.85, 1.0, t);
    `,
  },
  giant_squid: {
    gen: 'octopus', params: { span: 10, kind: 'giant' }, swim: SWIM.OCTO, freq: 0.2, length: 10, rough: 0.4, wrap: 0.35,
    colors: ['#a24a3a', '#c86a58', '#5a1a14', '#e8b0a0', '#3a0e0a', '#d8a090'],
    iris: 'vec3(0.06)',
    pattern: `
      float ch = spotsW(lp, 90.0, 0.3);
      col = mix(uC0, uC2, ch * 0.6);
      col = mix(col, uC3, smoothstep(-0.5, -1.0, ht) * 0.3);
      if (isPart(10.0) > 0.5) col = mix(uC1, uC4, ch * 0.5);
    `,
  },
  vent_mussel: {
    gen: 'bivalve', params: { length: 0.1, kind: 'mussel' }, swim: SWIM.NONE, length: 0.1, rough: 0.35,
    colors: ['#5a4630', '#c8b898', '#2a2014', '#8a7458', '#e0d4bc', '#3a3020'],
    pattern: `
      col = mix(uC0, uC3, gnoise(lp * 30.0) * 0.3 + 0.3);
      col = mix(col, uC1, smoothstep(0.35, 0.0, t) * 0.7);
      col *= 0.9 + 0.1 * sin(t * 90.0);
      rough = 0.32;
    `,
  },
  vent_shrimp: {
    gen: 'crustacean', params: { length: 0.04, kind: 'shrimp' }, swim: SWIM.CRUST, length: 0.04, rough: 0.35, translucent: 0.5,
    colors: ['#eadad2', '#f4ece8', '#c8a898', '#ffffff', '#b08878', '#e0c8c0'],
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 20.0) * 0.5 + 0.5);
      col *= 0.9 + 0.1 * sin(t * 50.0);
      if (isPart(10.0) > 0.5 || isPart(12.0) > 0.5) col = uC2;
    `,
  },
  vent_crab: {
    gen: 'crustacean', params: { length: 0.06, kind: 'crab' }, swim: SWIM.CRUST, length: 0.06, rough: 0.5,
    colors: ['#e8e0d6', '#d8ccbe', '#f4f0ea', '#b8a898', '#c8bcae', '#ffffff'],
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 14.0) * 0.5 + 0.5);
      if (isPart(10.0) > 0.5) col = uC3;
      if (isPart(8.0) > 0.5) col = uC2;
    `,
  },
  hairy_snail: {
    gen: 'snail', params: { size: 0.07 }, swim: SWIM.NONE, length: 0.07, rough: 0.95,
    colors: ['#3a2a1a', '#5a4430', '#1a120a', '#7a6248', '#2a1e12', '#a08a6a'],
    pattern: `
      float hair = gnoise(lp * 140.0) * 0.5 + 0.5;
      col = mix(uC2, uC1, hair);
      col = mix(col, uC5, smoothstep(0.8, 1.0, t) * 0.4);
      rough = 0.95;
    `,
  },
  // ------------------------------------------------------------------------------------- abyssal
  dumbo: {
    gen: 'octopus', params: { span: 0.25, kind: 'dumbo' }, swim: SWIM.OCTO, freq: 0.45, length: 0.25, rough: 0.45, translucent: 0.45, wrap: 0.5,
    colors: ['#e8c4bc', '#f4dcd4', '#c88a84', '#ffffff', '#b07068', '#e0b0a8'],
    iris: 'vec3(0.05)',
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 8.0) * 0.5 + 0.5);
      if (isPart(11.0) > 0.5) col = mix(uC2, uC0, -ht);
      if (isPart(3.0) > 0.5) col = uC5;
    `,
  },
  tripod: {
    gen: 'body', swim: SWIM.FISH, amp: 0.03, freq: 0.5, rough: 0.6,
    body: {
      length: 0.32, seg: 26, rad: 12, exponent: 2.1,
      height: [[0, 0.06], [0.1, 0.12], [0.4, 0.13], [0.85, 0.07], [1, 0.05]],
      width: [[0, 0.06], [0.15, 0.1], [0.5, 0.09], [1, 0.03]],
      caudal: { type: 'forked', len: 0.16, span: 0.2 },
      dorsal: [{ t0: 0.38, t1: 0.5, h: 0.1, sweep: 0.3 }],
      pectoral: { t: 0.18, h: 0.3, len: 0.6, w: 0.02, angle: 0.25, up: 0.35 },
      spines: [
        { t: 0.42, x: -0.035, len: 2.4, r: 0.006, lean: 0.12, bottom: true },
        { t: 0.42, x: 0.035, len: 2.4, r: 0.006, lean: 0.12, bottom: true },
        { t: 0.99, x: 0.0, len: 2.6, r: 0.006, lean: -0.08, bottom: true },
      ],
      eye: { t: 0.06, up: 0.4, r: 0.008 },
    },
    colors: ['#3a3a38', '#5a5a56', '#c8c0b0', '#2a2a28', '#8a8478', '#1a1a18'],
    pattern: `
      col = mix(uC1, uC0, smoothstep(-0.4, 0.4, ht));
      if (isPart(7.0) > 0.5) col = uC2;
      if (isPart(3.0) > 0.5) col = uC4;
      if (isPart(1.0) > 0.5 || isPart(2.0) > 0.5) col = uC3;
    `,
  },
  sea_pig: {
    gen: 'seapig', params: { length: 0.13 }, swim: SWIM.LIMBS, length: 0.13, rough: 0.4, translucent: 0.55, wrap: 0.55,
    colors: ['#e2aaa2', '#f2c8c0', '#c8807a', '#ffffff', '#b06a64', '#f0d0c8'],
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 12.0) * 0.5 + 0.5);
      if (isPart(10.0) > 0.5 || isPart(12.0) > 0.5) col = uC5;
    `,
  },
  glass_sponge: {
    gen: 'glasssponge', params: { height: 0.45 }, swim: SWIM.NONE, length: 0.45, rough: 0.2, translucent: 0.6, wrap: 0.6, envGain: 1.4,
    colors: ['#e6ece6', '#f6faf6', '#c8d4cc', '#ffffff', '#a8b4ac', '#d8e2da'],
    pattern: `
      col = mix(uC0, uC2, smoothstep(0.6, 1.0, abs(sin(vCUv.x * 60.0 + vCUv.y * 40.0))) * 0.5);
      if (isPart(7.0) > 0.5) { col = uC1; rough = 0.05; }
    `,
  },
  brittle_star: {
    gen: 'brittlestar', params: { span: 0.16 }, swim: SWIM.LIMBS, length: 0.16, rough: 0.6,
    colors: ['#c0a8a0', '#e0ccc4', '#8a7068', '#f0e0d8', '#a08880', '#d8c4bc'],
    pattern: `
      col = uC0;
      if (isPart(10.0) > 0.5) col = mix(uC1, uC2, step(0.5, fract(t * 14.0)));
    `,
  },
  grenadier: {
    gen: 'body', swim: SWIM.EEL, amp: 0.08, freq: 0.6, wave: 0.8, rough: 0.5,
    body: {
      length: 0.6, seg: 34, rad: 14, exponent: 2.0,
      height: [[0, 0.1], [0.06, 0.2], [0.25, 0.19], [0.5, 0.11], [0.85, 0.03], [1, 0.004]],
      width: [[0, 0.1], [0.1, 0.16], [0.3, 0.13], [0.6, 0.06], [1, 0.004]],
      center: [[0, -0.02], [0.1, 0.02], [1, 0]],
      caudal: { type: 'none' },
      dorsal: [{ t0: 0.2, t1: 0.28, h: 0.13, sweep: 0.3, skew: 0.4 }, { t0: 0.32, t1: 1.0, h: 0.02, sweep: 0.1, shape: [[0, 0.3], [0.1, 1], [1, 0.2]] }],
      anal: [{ t0: 0.3, t1: 1.0, h: 0.03, sweep: 0.1, shape: [[0, 0.3], [0.1, 1], [1, 0.2]] }],
      pectoral: { t: 0.2, h: -0.1, len: 0.1, w: 0.04 },
      eye: { t: 0.07, up: 0.35, r: 0.03 },
    },
    colors: ['#6a6458', '#8a8476', '#3a3630', '#a8a294', '#2a2620', '#c0bcb0'],
    iris: 'vec3(0.6, 0.6, 0.55)',
    pattern: `
      float sc = worley3(lp * 40.0);
      col = mix(uC1, uC0, smoothstep(-0.5, 0.4, ht));
      col *= 0.85 + 0.2 * smoothstep(0.05, 0.35, sc);
      if (isFin() > 0.5) col = uC2;
      rough = 0.45; metal = 0.15;
    `,
  },
  // ------------------------------------------------------------------------------------- hadal
  snailfish: {
    gen: 'body', swim: SWIM.EEL, amp: 0.1, freq: 0.9, wave: 0.85, rough: 0.35, translucent: 0.7, wrap: 0.6, transparent: true, opacity: 0.88,
    body: {
      length: 0.2, seg: 28, rad: 14, exponent: 2.0,
      height: [[0, 0.18], [0.1, 0.26], [0.35, 0.24], [0.75, 0.1], [1, 0.02]],
      width: [[0, 0.2], [0.15, 0.24], [0.4, 0.17], [1, 0.02]],
      caudal: { type: 'round', len: 0.08, span: 0.08 },
      dorsal: [{ t0: 0.3, t1: 1.0, h: 0.06, sweep: 0.15, shape: [[0, 0.4], [0.2, 1], [1, 0.3]] }],
      anal: [{ t0: 0.4, t1: 1.0, h: 0.05, sweep: 0.15, shape: [[0, 0.4], [0.2, 1], [1, 0.3]] }],
      pectoral: { t: 0.22, h: -0.3, len: 0.2, w: 0.14, angle: 0.8, up: -0.3 },
      eye: { t: 0.09, up: 0.3, r: 0.02 },
    },
    colors: ['#ecd2ca', '#f6e4de', '#c89a90', '#ffffff', '#b07a70', '#f0dcd4'],
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 10.0) * 0.5 + 0.5);
      col = mix(col, uC2, smoothstep(0.25, 0.6, t) * smoothstep(-0.2, -0.8, ht) * 0.4);
      if (isFin() > 0.5) { col = uC5; alpha = 0.6; }
    `,
  },
  amphipod: {
    gen: 'crustacean', params: { length: 0.03, kind: 'amphipod' }, swim: SWIM.CRUST, length: 0.03, rough: 0.3, translucent: 0.5,
    colors: ['#ecdcc6', '#f6ecdc', '#c8b498', '#ffffff', '#b8a080', '#e0ccb0'],
    pattern: `
      col = mix(uC0, uC1, sin(t * 60.0) * 0.5 + 0.5);
      if (isPart(10.0) > 0.5 || isPart(12.0) > 0.5) col = uC2;
    `,
  },
  xenophyophore: {
    gen: 'xeno', params: { size: 0.09 }, swim: SWIM.NONE, length: 0.09, rough: 1.0,
    colors: ['#8a7a66', '#a8987e', '#5a4c3e', '#c8b89c', '#6e604e', '#b0a088'],
    pattern: `
      float g = gnoise(lp * 50.0) * 0.5 + 0.5;
      col = mix(uC2, uC1, g);
      col *= 0.8 + 0.3 * worley3(lp * 70.0);
      rough = 1.0;
    `,
  },
  hadal_cucumber: {
    gen: 'cucumber', params: { length: 0.25 }, swim: SWIM.LIMBS, length: 0.25, rough: 0.35, translucent: 0.6, wrap: 0.55, transparent: true, opacity: 0.92,
    colors: ['#a8607a', '#c8829a', '#7a3a52', '#e8b8c8', '#5a2a3a', '#d8a0b4'],
    pattern: `
      col = mix(uC0, uC1, gnoise(lp * 9.0) * 0.5 + 0.5);
      col = mix(col, uC2, smoothstep(0.6, 1.0, abs(sin(t * 40.0))) * 0.3);
      if (isPart(3.0) > 0.5) col = uC3;
    `,
  },
};
