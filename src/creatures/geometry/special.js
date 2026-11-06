import * as THREE from 'three';
import { CMesh, PART, buildBody, curve } from './body.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/** Grid-based surface helper: f(u, v) -> [x, y, z, t, l, h, part] with u,v in [0,1]. */
function surface(m, nu, nv, f, { closeU = false, flip = false } = {}) {
  const base = m.count;
  const P = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(f(i / nu, j / nv));
  const nrm = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const idx = (i, j) => j * (nu + 1) + i;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const q = P[idx(i, j)];
    const iu = closeU ? (i + 1) % nu : Math.min(nu, i + 1), il = closeU ? (i - 1 + nu) % nu : Math.max(0, i - 1);
    const qu = P[idx(iu, j)], ql = P[idx(il, j)];
    const qv = P[idx(i, Math.min(nv, j + 1))], qd = P[idx(i, Math.max(0, j - 1))];
    a.set(qu[0] - ql[0], qu[1] - ql[1], qu[2] - ql[2]); b.set(qv[0] - qd[0], qv[1] - qd[1], qv[2] - qd[2]);
    nrm.crossVectors(a, b);
    if (!(nrm.lengthSq() > 1e-16)) nrm.set(0, 1, 0);
    nrm.normalize();
    if (flip) nrm.negate();
    m.v(q[0], q[1], q[2], nrm.x, nrm.y, nrm.z, i / nu, j / nv, q[3], q[4], q[5], q[6]);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const A = base + idx(i, j), B = base + idx(i + 1, j), C = base + idx(i, j + 1), D = base + idx(i + 1, j + 1);
    if (flip) { m.tri(A, C, B); m.tri(B, C, D); } else { m.tri(A, B, C); m.tri(B, D, C); }
  }
}

// ------------------------------------------------------------------------------------------- turtles
export function buildTurtle({ length = 1.0, hawksbill = false } = {}) {
  const L = length;
  // carapace + plastron as one lofted, flattened body
  const m = buildBody({
    length: L, seg: 24, rad: 22, exponent: 1.7, belly: 0.32,
    height: [[0, 0.06], [0.12, 0.25], [0.45, 0.33], [0.8, 0.24], [1, 0.06]],
    width: [[0, 0.2], [0.15, 0.62], [0.45, 0.8], [0.8, 0.6], [1, 0.12]],
  });
  // head + neck
  const hr = L * (hawksbill ? 0.085 : 0.1);
  m.tube([[0, 0, L * 0.42], [0, L * 0.01, L * 0.56], [0, L * 0.02, L * 0.64]], [hr * 0.85, hr * 0.9, hr * 0.8], 10, (k, u) => ({ t: -0.05 - u * 0.1, l: 0, h: 0, part: PART.EXTRA }));
  m.sphere(0, L * 0.025, L * 0.68, hr, { t: -0.18, l: 0, h: 0, part: PART.EXTRA }, { sx: 0.9, sy: 0.8, sz: hawksbill ? 1.5 : 1.2 });
  for (const s of [-1, 1]) m.sphere(s * hr * 0.75, L * 0.05, L * 0.71, hr * 0.18, { t: -0.2, l: s, h: 0.5, part: PART.EYE }, { ws: 8, hs: 5 });
  // flippers: long fore flippers, short hind flippers (flat paddles, two-sided)
  for (const s of [-1, 1]) {
    const root = [s * L * 0.3, -L * 0.03, L * 0.25];
    const fore = [root, [s * L * 0.62, -L * 0.06, L * 0.12], [s * L * 0.78, -L * 0.08, -L * 0.05], [s * L * 0.6, -L * 0.06, -L * 0.02], [s * L * 0.3, -L * 0.04, L * 0.12]];
    m.flat(fore, V(0, 1, 0), (q) => ({ t: 0.2, l: s * (Math.abs(q[0]) / (L * 0.78)), h: 0, part: PART.PECTORAL }));
    const hroot = [s * L * 0.22, -L * 0.04, -L * 0.3];
    const hind = [hroot, [s * L * 0.38, -L * 0.05, -L * 0.36], [s * L * 0.36, -L * 0.05, -L * 0.48], [s * L * 0.18, -L * 0.04, -L * 0.4]];
    m.flat(hind, V(0, 1, 0), (q) => ({ t: 0.8, l: s * (Math.abs(q[0]) / (L * 0.38)), h: 0, part: PART.PELVIC }));
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- rays
/** Batoid planform. manta: broad wings, cephalic fins, short tail. eagle: pointed wings, bill, whip tail. */
export function buildRay({ span = 3.5, kind = 'manta' } = {}) {
  const m = new CMesh();
  const S = span;
  const Lb = kind === 'manta' ? S * 0.45 : S * 0.55;
  const chord = (l) => {
    // body length at lateral position l (0 centre .. 1 tip): wing leading edge swept back
    const a = Math.abs(l);
    return Lb * (1 - Math.pow(a, kind === 'manta' ? 1.4 : 1.15)) * (kind === 'manta' ? 1.0 : 0.95) + 0.02 * S;
  };
  const lead = (l) => Lb * 0.5 - Math.pow(Math.abs(l), 1.25) * Lb * (kind === 'manta' ? 0.55 : 0.7);
  const thick = (l, t) => (kind === 'manta' ? 0.075 : 0.09) * S * (1 - Math.pow(Math.abs(l), 1.3)) * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) + 0.004 * S;
  for (const side of [1, -1]) {
    surface(m, 26, 14, (u, v) => {
      const l = u * 2 - 1;
      const z0 = lead(l), c = chord(l);
      const z = z0 - v * c;
      const t = 0.5 - z / Lb;
      return [l * S / 2, side * thick(l, v), z, t, l, side, PART.BODY];
    }, { flip: side < 0 });
  }
  if (kind === 'manta') {
    // cephalic fins
    for (const s of [-1, 1]) {
      const b0 = [s * S * 0.06, 0, Lb * 0.48], b1 = [s * S * 0.1, 0, Lb * 0.44];
      const tip = [s * S * 0.085, -S * 0.02, Lb * 0.66];
      m.flat([b0, tip, b1], V(s, 0, 0), () => ({ t: 0.02, l: s * 0.1, h: 0, part: PART.EXTRA }));
    }
    m.tube([[0, 0, -Lb * 0.45], [0, 0, -Lb * 0.75], [0, 0, -Lb * 0.95]], [S * 0.012, S * 0.008, S * 0.002], 5, (k, u) => ({ t: 1 + u * 0.3, l: 0, h: 0, part: PART.CAUDAL }));
    // small dorsal fin
    m.flat([[0, S * 0.02, -Lb * 0.36], [0, S * 0.07, -Lb * 0.45], [0, S * 0.02, -Lb * 0.48]], V(1, 0, 0), () => ({ t: 0.9, l: 0, h: 1, part: PART.DORSAL }));
  } else {
    // protruding duck-bill head and long whip tail
    m.sphere(0, 0, Lb * 0.52, S * 0.05, { t: 0, l: 0, h: 0, part: PART.EXTRA }, { sx: 0.8, sy: 0.5, sz: 1.6 });
    m.tube([[0, 0, -Lb * 0.45], [0, 0.01 * S, -Lb * 1.2], [0, 0.0, -Lb * 2.2], [0, -0.01 * S, -Lb * 3.0]], [S * 0.018, S * 0.01, S * 0.004, S * 0.001], 5, (k, u) => ({ t: 1 + u, l: 0, h: 0, part: PART.CAUDAL }));
    m.flat([[0, S * 0.02, -Lb * 0.4], [0, S * 0.06, -Lb * 0.47], [0, S * 0.02, -Lb * 0.5]], V(1, 0, 0), () => ({ t: 0.9, l: 0, h: 1, part: PART.DORSAL }));
  }
  for (const s of [-1, 1]) m.sphere(s * S * (kind === 'manta' ? 0.08 : 0.045), S * 0.015, Lb * (kind === 'manta' ? 0.42 : 0.5), S * 0.012, { t: 0.05, l: s * 0.1, h: 0.5, part: PART.EYE }, { ws: 8, hs: 5 });
  return m.build();
}

// ------------------------------------------------------------------------------------------- cephalopods
function arm(m, base, dir, len, r0, k, curl = 0.6, seed = 1, part = PART.ARM) {
  const R = rnd(seed);
  const pts = [], rr = [];
  const d = dir.clone().normalize();
  const side = new THREE.Vector3().crossVectors(d, V(0, 1, 0)).normalize();
  let p = V(base[0], base[1], base[2]);
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([p.x, p.y, p.z]);
    rr.push(r0 * (1 - u * 0.92));
    const bend = d.clone().applyAxisAngle(side, curl * u * u * 1.6 + (R() - 0.5) * 0.2);
    p = p.clone().addScaledVector(bend, len / n);
  }
  m.tube(pts, rr, 6, (j, u) => ({ t: 0.5 + u * 0.5, l: k, h: -u, part }));
}

export function buildOctopus({ span = 0.8, kind = 'day' } = {}) {
  const m = new CMesh();
  const S = span;
  if (kind === 'day') {
    // mantle behind the head (raised), head with eyes, 8 arms spread over the ground
    m.sphere(0, S * 0.13, -S * 0.06, S * 0.11, { t: 0.2, l: 0, h: 1, part: PART.BODY }, { ws: 14, hs: 10, sx: 0.9, sy: 0.85, sz: 1.25 });
    m.sphere(0, S * 0.07, S * 0.06, S * 0.075, { t: 0.4, l: 0, h: 0.5, part: PART.BODY }, { ws: 12, hs: 8 });
    for (const s of [-1, 1]) m.sphere(s * S * 0.055, S * 0.11, S * 0.07, S * 0.018, { t: 0.4, l: s, h: 0.6, part: PART.EYE }, { ws: 8, hs: 5 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      arm(m, [Math.cos(a) * S * 0.04, S * 0.03, S * 0.08 + Math.sin(a) * S * 0.04], V(Math.cos(a), -0.15, Math.sin(a)), S * 0.42, S * 0.022, k / 8, 0.9, 11 + k);
    }
  } else if (kind === 'dumbo') {
    // bell-shaped body with ear fins and a webbed skirt of arms
    m.sphere(0, S * 0.05, 0, S * 0.22, { t: 0.2, l: 0, h: 1, part: PART.BODY }, { ws: 18, hs: 12, sx: 1.0, sy: 1.15, sz: 1.0 });
    for (const s of [-1, 1]) {
      const b = [s * S * 0.18, S * 0.14, 0];
      m.flat([b, [s * S * 0.36, S * 0.22, S * 0.04], [s * S * 0.4, S * 0.12, -S * 0.02], [s * S * 0.2, S * 0.08, -S * 0.02]], V(0, 0, 1), (q) => ({ t: 0.3, l: s * Math.abs(q[0]) / (S * 0.4), h: 0.6, part: PART.PECTORAL }));
      m.sphere(s * S * 0.12, S * 0.02, S * 0.17, S * 0.035, { t: 0.4, l: s, h: 0.2, part: PART.EYE }, { ws: 8, hs: 5 });
    }
    // web skirt
    surface(m, 32, 6, (u, v) => {
      const a = u * Math.PI * 2;
      const r = S * (0.18 + v * 0.26);
      const scallop = 1 + 0.12 * Math.cos(a * 8) * v;
      return [Math.cos(a) * r * scallop, -S * 0.12 - v * S * 0.16, Math.sin(a) * r * scallop, 0.6 + v * 0.4, Math.cos(a), -v, PART.BELL];
    }, { closeU: true });
  } else if (kind === 'vampire') {
    m.sphere(0, 0, -S * 0.1, S * 0.12, { t: 0.2, l: 0, h: 1, part: PART.BODY }, { ws: 14, hs: 10, sx: 0.85, sy: 0.85, sz: 1.5 });
    for (const s of [-1, 1]) {
      m.flat([[s * S * 0.08, S * 0.02, -S * 0.2], [s * S * 0.22, S * 0.05, -S * 0.24], [s * S * 0.2, S * 0.0, -S * 0.3], [s * S * 0.07, 0, -S * 0.27]], V(0, 1, 0), (q) => ({ t: 0.1, l: s * Math.abs(q[0]) / (S * 0.22), h: 0, part: PART.PECTORAL }));
      m.sphere(s * S * 0.07, S * 0.04, S * 0.04, S * 0.035, { t: 0.4, l: s, h: 0.3, part: PART.EYE }, { ws: 8, hs: 5 });
    }
    // umbrella-like web between eight arms (cloak), opening forward
    surface(m, 24, 8, (u, v) => {
      const a = u * Math.PI * 2;
      const r = S * (0.06 + v * 0.26) * (1 + 0.1 * Math.cos(a * 8) * v);
      return [Math.cos(a) * r, Math.sin(a) * r, S * 0.08 + v * S * 0.22 - v * v * S * 0.1, 0.5 + v * 0.5, Math.cos(a), Math.sin(a), PART.BELL];
    }, { closeU: true });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      m.sphere(Math.cos(a) * S * 0.32, Math.sin(a) * S * 0.32, S * 0.2, S * 0.012, { t: 1, l: k / 8, h: 0, part: PART.LURE }, { ws: 5, hs: 4 });
    }
  } else if (kind === 'giant') {
    // long mantle with terminal fins, huge eyes, eight arms and two long tentacles
    const Lm = S * 0.18;
    const mm = buildBody({
      length: Lm, seg: 18, rad: 14, exponent: 2,
      height: [[0, 0.16], [0.2, 0.2], [0.7, 0.14], [1, 0.02]],
      width: [[0, 0.16], [0.2, 0.2], [0.7, 0.14], [1, 0.02]],
      caudal: { type: 'none' },
    });
    m.merge(mm, new THREE.Matrix4().makeTranslation(0, 0, -Lm * 0.5));
    for (const s of [-1, 1]) {
      m.flat([[0, 0, -Lm * 0.75], [s * Lm * 0.14, 0, -Lm * 0.9], [0, 0, -Lm * 1.02]], V(0, 1, 0), () => ({ t: 1, l: s, h: 0, part: PART.PECTORAL }));
      m.sphere(s * Lm * 0.1, Lm * 0.02, Lm * 0.06, Lm * 0.06, { t: 0.05, l: s, h: 0.2, part: PART.EYE }, { ws: 10, hs: 6 });
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const long = k === 2 || k === 7;
      arm(m, [Math.cos(a) * Lm * 0.06, Math.sin(a) * Lm * 0.06, Lm * 0.1], V(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 1), long ? S * 0.62 : S * 0.2, Lm * (long ? 0.025 : 0.035), k / 10, 0.25, 31 + k);
    }
  }
  return m.build();
}

export function buildNautilus({ size = 0.2 } = {}) {
  const m = new CMesh();
  const S = size;
  // logarithmic spiral shell: sweep a growing circle along the spiral
  const turns = 1.6, n = 70;
  const ring = 14;
  const base = m.count;
  const b = 0.16;
  for (let i = 0; i <= n; i++) {
    const th = -turns * Math.PI * 2 * (1 - i / n);
    const r = S * 0.32 * Math.exp(b * th);
    const cr = r * 0.62;
    const cx = Math.cos(th) * r, cy = Math.sin(th) * r;
    const tx = -Math.sin(th), ty = Math.cos(th);
    for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const nx = Math.cos(a) * Math.cos(th), ny = Math.cos(a) * Math.sin(th), nz = Math.sin(a) * 0.7;
      const px = cx + Math.cos(a) * cr * Math.cos(th), py = cy + Math.cos(a) * cr * Math.sin(th), pz = Math.sin(a) * cr * 0.7;
      void tx; void ty;
      m.v(-pz, py, px, -nz, ny, nx, i / n, k / ring, i / n, Math.cos(a), cy / (S * 0.32), PART.SHELL);
    }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < ring; k++) {
    const a = base + i * (ring + 1) + k, c = a + ring + 1;
    m.tri(a, a + 1, c); m.tri(a + 1, c + 1, c);
  }
  // hood and tentacles at the aperture
  const ap = S * 0.32;
  m.sphere(0, ap * 0.25, ap * 0.55, ap * 0.38, { t: 0, l: 0, h: 0.5, part: PART.EXTRA }, { ws: 10, hs: 7, sx: 0.9, sy: 0.6, sz: 0.7 });
  for (const s of [-1, 1]) m.sphere(s * ap * 0.32, ap * 0.08, ap * 0.62, ap * 0.08, { t: 0, l: s, h: 0.2, part: PART.EYE }, { ws: 8, hs: 5 });
  const R = rnd(7);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    const bx = Math.cos(a) * ap * 0.22, by = -ap * 0.05 + Math.sin(a) * ap * 0.18;
    const len = ap * (0.5 + R() * 0.4);
    m.tube([[bx, by, ap * 0.7], [bx * 1.3, by * 1.2 - len * 0.2, ap * 0.7 + len * 0.6], [bx * 1.6, by * 1.3 - len * 0.5, ap * 0.7 + len]], [ap * 0.022, ap * 0.016, ap * 0.008], 4, (j, u) => ({ t: 0.6 + u * 0.4, l: k / 26, h: -u, part: PART.TENTACLE }));
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- gelatinous
export function buildJelly({ diameter = 0.15, kind = 'atolla' } = {}) {
  const m = new CMesh();
  const D = diameter;
  if (kind === 'atolla') {
    // flattened bell with a coronal groove and a scalloped margin of lappets
    surface(m, 36, 14, (u, v) => {
      const a = u * Math.PI * 2;
      const prof = (vv) => {
        const r = Math.sin(vv * Math.PI * 0.5) * D * 0.5;
        const groove = Math.exp(-Math.pow((vv - 0.55) / 0.06, 2)) * D * 0.03;
        return [r - groove, Math.cos(vv * Math.PI * 0.5) * D * 0.22];
      };
      const [r, y] = prof(v);
      const lap = v > 0.85 ? 1 + 0.08 * Math.cos(a * 20) * (v - 0.85) / 0.15 : 1;
      return [Math.cos(a) * r * lap, y, Math.sin(a) * r * lap, v, Math.cos(a), 1 - v, PART.BELL];
    }, { closeU: true });
    const R = rnd(3);
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const x = Math.cos(a) * D * 0.48, z = Math.sin(a) * D * 0.48;
      const len = D * (0.25 + R() * 0.15);
      m.tube([[x, -D * 0.01, z], [x * 1.08, -len * 0.5, z * 1.08], [x * 1.12, -len, z * 1.12]], [D * 0.006, D * 0.004, D * 0.002], 3, (j, u) => ({ t: 1, l: k / 22, h: -u, part: PART.TENTACLE }));
    }
    // the single long hypertrophied tentacle
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push([D * 0.45, -i * D * 0.35, Math.sin(i * 0.6) * D * 0.1]);
    m.tube(pts, pts.map((_, i) => D * 0.007 * (1 - i / 16)), 3, (j, u) => ({ t: 1, l: 0, h: -u * 4, part: PART.TENTACLE }));
  } else if (kind === 'comb') {
    // lobate/ovoid ctenophore with eight meridional comb rows
    surface(m, 32, 16, (u, v) => {
      const a = u * Math.PI * 2;
      const r = Math.sin(v * Math.PI) * D * 0.35 * (1 + 0.15 * Math.cos(a * 2));
      return [Math.cos(a) * r, (0.5 - v) * D, Math.sin(a) * r, v, Math.cos(a), Math.sin(a), PART.BELL];
    }, { closeU: true });
  }
  return m.build();
}

export function buildSiphonophore({ length = 15 } = {}) {
  const m = new CMesh();
  const L = length;
  // swimming bells (nectophores) at the front
  for (let k = 0; k < 6; k++) {
    const z = L * 0.5 - k * 0.09;
    m.sphere((k % 2 ? 1 : -1) * 0.04, 0, z, 0.07, { t: k * 0.004, l: 0, h: 0, part: PART.BELL }, { ws: 10, hs: 7, sx: 1, sy: 0.8, sz: 1.3 });
  }
  // long stem with repeating groups (cormidia)
  const n = 120;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([Math.sin(i * 0.15) * 0.08, Math.sin(i * 0.07) * 0.1, L * 0.45 - (i / n) * L]);
  m.tube(pts, pts.map(() => 0.008), 4, (j, u) => ({ t: u, l: 0, h: 0, part: PART.BODY }));
  const R = rnd(5);
  for (let i = 4; i < n; i += 3) {
    const p = pts[i];
    m.sphere(p[0], p[1], p[2], 0.025 + R() * 0.012, { t: i / n, l: 0, h: 0, part: PART.EXTRA }, { ws: 6, hs: 4 });
    const len = 0.25 + R() * 0.5;
    m.tube([[p[0], p[1], p[2]], [p[0] + 0.02, p[1] - len * 0.5, p[2] - 0.03], [p[0] + 0.03, p[1] - len, p[2] - 0.08]], [0.003, 0.002, 0.001], 3, (j, u) => ({ t: i / n, l: 0, h: -u, part: PART.TENTACLE }));
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- crustaceans
export function buildCrustacean({ length = 0.04, kind = 'shrimp' } = {}) {
  const m = new CMesh();
  const L = length;
  if (kind === 'shrimp' || kind === 'amphipod') {
    const amph = kind === 'amphipod';
    const segs = amph ? 10 : 8;
    const pts = [], rr = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const bend = amph ? u * 1.6 : Math.max(0, u - 0.45) * 1.8;
      pts.push([0, -Math.sin(bend) * L * 0.25, L * 0.5 - u * L]);
      rr.push(L * (amph ? 0.12 : 0.13) * (amph ? 1 - Math.abs(u - 0.4) * 0.8 : (u < 0.45 ? 1 : 1 - (u - 0.45) * 1.4)));
    }
    m.tube(pts, rr, 8, (k, u) => ({ t: u, l: 0, h: 0, part: PART.BODY }));
    // legs
    const nl = amph ? 7 : 5;
    for (let k = 0; k < nl; k++) for (const s of [-1, 1]) {
      const z = L * 0.3 - k * L * (amph ? 0.09 : 0.07);
      m.tube([[s * L * 0.06, -L * 0.06, z], [s * L * 0.14, -L * 0.14, z + L * 0.02], [s * L * 0.18, -L * 0.24, z + L * 0.04]], [L * 0.012, L * 0.01, L * 0.006], 3, (j, u) => ({ t: 0.3 + k * 0.05, l: s * (1 + u), h: -u, part: PART.ARM }));
    }
    // antennae
    for (const s of [-1, 1]) m.tube([[s * L * 0.03, L * 0.04, L * 0.48], [s * L * 0.12, L * 0.18, L * 0.75], [s * L * 0.2, L * 0.2, L * 1.0]], [L * 0.006, L * 0.004, L * 0.002], 3, (j, u) => ({ t: 0, l: s, h: u, part: PART.TENTACLE }));
    m.sphere(0, L * 0.02, L * 0.46, L * 0.03, { t: 0, l: 0, h: 0.5, part: PART.EYE }, { ws: 6, hs: 4 });
  } else if (kind === 'crab') {
    m.sphere(0, L * 0.12, 0, L * 0.5, { t: 0.5, l: 0, h: 1, part: PART.BODY }, { ws: 16, hs: 10, sx: 1, sy: 0.38, sz: 0.82 });
    for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
      const z = L * 0.22 - k * L * 0.16;
      m.tube([[s * L * 0.42, L * 0.08, z], [s * L * 0.78, L * 0.22, z - L * 0.05], [s * L * 1.0, -L * 0.12, z - L * 0.1]], [L * 0.05, L * 0.04, L * 0.02], 4, (j, u) => ({ t: 0.5, l: s * (1 + u), h: -u, part: PART.ARM }));
    }
    for (const s of [-1, 1]) {
      m.tube([[s * L * 0.3, L * 0.1, L * 0.35], [s * L * 0.48, L * 0.12, L * 0.62]], [L * 0.07, L * 0.07], 5, () => ({ t: 0.2, l: s, h: 0, part: PART.EXTRA }));
      m.sphere(s * L * 0.5, L * 0.12, L * 0.7, L * 0.11, { t: 0.1, l: s, h: 0, part: PART.EXTRA }, { ws: 8, hs: 6, sx: 0.8, sy: 0.6, sz: 1.4 });
    }
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- molluscs
export function buildBivalve({ length = 0.3, kind = 'clam' } = {}) {
  const m = new CMesh();
  const L = length;
  const clam = kind === 'clam';
  for (const s of [-1, 1]) {
    surface(m, 28, 10, (u, v) => {
      const a = (u - 0.5) * Math.PI * (clam ? 1.0 : 0.95);
      const ribs = clam ? 1 + 0.06 * Math.cos(u * Math.PI * 12) * v : 1;
      const r = L * 0.5 * Math.pow(v, 0.9) * ribs;
      const x = Math.sin(a) * r * (clam ? 1 : 0.55);
      const z = (clam ? 0 : 0.25 * L) + Math.cos(a) * r * (clam ? 0.5 : 1);
      const bulge = Math.sin(v * Math.PI * 0.5) * L * (clam ? 0.16 : 0.12) * Math.cos(a * 0.8);
      const flute = clam ? Math.max(0, Math.cos(u * Math.PI * 6)) * v * v * L * 0.03 : 0;
      return [x, s * (bulge + flute), z - (clam ? 0 : L * 0.25), v, u * 2 - 1, s, PART.SHELL];
    }, { flip: s < 0 });
  }
  if (clam) {
    // mantle lips visible between the gaping valves
    surface(m, 28, 3, (u, v) => {
      const a = (u - 0.5) * Math.PI;
      const r = L * 0.48;
      return [Math.sin(a) * r, (v - 0.5) * L * 0.14 * Math.cos(a), Math.cos(a) * r * 0.5 + L * 0.02, 1, u * 2 - 1, v * 2 - 1, PART.EXTRA];
    });
  }
  return m.build();
}

export function buildSnail({ size = 0.07 } = {}) {
  const m = new CMesh();
  const S = size;
  const n = 40, ring = 10;
  const base = m.count;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const th = u * Math.PI * 2 * 2.2;
    const r = S * 0.08 + u * S * 0.32;
    const cr = S * 0.06 + u * S * 0.22;
    const cy = (1 - u) * S * 0.3;
    for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      const nx = Math.cos(a) * Math.cos(th), nz = Math.cos(a) * Math.sin(th), ny = Math.sin(a);
      m.v(Math.cos(th) * r + nx * cr, cy + ny * cr, Math.sin(th) * r + nz * cr, nx, ny, nz, u, k / ring, u, Math.cos(a), Math.sin(a), PART.SHELL);
    }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < ring; k++) {
    const a = base + i * (ring + 1) + k, c = a + ring + 1;
    m.tri(a, c, a + 1); m.tri(a + 1, c, c + 1);
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- echinoderms & others
export function buildSeaPig({ length = 0.12 } = {}) {
  const L = length;
  const m = buildBody({
    length: L, seg: 16, rad: 14, exponent: 2, belly: 0.55,
    height: [[0, 0.22], [0.15, 0.4], [0.6, 0.42], [1, 0.22]],
    width: [[0, 0.24], [0.2, 0.42], [0.7, 0.42], [1, 0.24]],
    caudal: { type: 'none' },
  });
  // tube-feet legs
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) {
    const z = L * 0.32 - k * L * 0.13;
    m.tube([[s * L * 0.15, -L * 0.08, z], [s * L * 0.2, -L * 0.17, z], [s * L * 0.21, -L * 0.23, z]], [L * 0.035, L * 0.03, L * 0.02], 5, (j, u) => ({ t: 0.2 + k * 0.12, l: s, h: -1 - u, part: PART.ARM }));
  }
  // dorsal papillae ("antennae")
  for (const [s, dz] of [[-1, 0], [1, 0], [-1, 0.07], [1, 0.07]]) m.tube([[s * L * 0.05, L * 0.18, L * 0.3 - dz * L], [s * L * 0.08, L * 0.34, L * 0.36 - dz * L], [s * L * 0.1, L * 0.44, L * 0.4 - dz * L]], [L * 0.03, L * 0.02, L * 0.008], 5, (j, u) => ({ t: 0.1, l: s, h: 1 + u, part: PART.TENTACLE }));
  return m.build();
}

export function buildCucumber({ length = 0.25 } = {}) {
  const L = length;
  const m = buildBody({
    length: L, seg: 18, rad: 16, exponent: 2.4, belly: 0.45,
    height: [[0, 0.1], [0.15, 0.22], [0.7, 0.24], [1, 0.1]],
    width: [[0, 0.12], [0.2, 0.32], [0.7, 0.34], [1, 0.14]],
    caudal: { type: 'none' },
  });
  // marginal brim of the flattened body
  for (const s of [-1, 1]) {
    const a = [], b = [];
    for (let k = 0; k <= 12; k++) { const z = L * 0.42 - k * L * 0.07; a.push([s * L * 0.15, -L * 0.03, z]); b.push([s * L * 0.24, -L * 0.06, z]); }
    m.strip(a, b, (q, k) => ({ t: k / 12, l: s, h: -0.5, part: PART.PECTORAL }));
  }
  return m.build();
}

export function buildBrittleStar({ span = 0.15 } = {}) {
  const m = new CMesh();
  const S = span;
  m.sphere(0, S * 0.02, 0, S * 0.1, { t: 0, l: 0, h: 1, part: PART.BODY }, { ws: 14, hs: 6, sx: 1, sy: 0.35, sz: 1 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const pts = [], rr = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const w = Math.sin(u * 4 + k) * 0.35 * u;
      const r = S * 0.08 + u * S * 0.42;
      pts.push([Math.cos(a + w) * r, S * 0.01 - u * S * 0.01, Math.sin(a + w) * r]);
      rr.push(S * 0.018 * (1 - u * 0.85));
    }
    m.tube(pts, rr, 4, (i, u) => ({ t: u, l: k / 5, h: 0, part: PART.ARM }));
  }
  return m.build();
}

export function buildGlassSponge({ height = 0.4 } = {}) {
  const m = new CMesh();
  const H = height;
  // body (ovoid cup) on a long stalk of glassy fibres
  surface(m, 18, 10, (u, v) => {
    const a = u * Math.PI * 2;
    const r = H * (0.06 + 0.1 * Math.sin(v * Math.PI * 0.9));
    return [Math.cos(a) * r, H * 0.55 + v * H * 0.45, Math.sin(a) * r, v, Math.cos(a), Math.sin(a), PART.BODY];
  }, { closeU: true });
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, o = H * 0.012;
    m.tube([[Math.cos(a) * o, 0, Math.sin(a) * o], [Math.cos(a) * o * 0.6, H * 0.3, Math.sin(a) * o * 0.6], [0, H * 0.6, 0]], [H * 0.006, H * 0.005, H * 0.004], 3, (j, u) => ({ t: 1 - u, l: 0, h: u, part: PART.SPINE }));
  }
  return m.build();
}

export function buildXenophyophore({ size = 0.08, seed = 1 } = {}) {
  const m = new CMesh();
  const S = size;
  const R = rnd(seed);
  const lobes = 3 + Math.floor(R() * 4);
  for (let k = 0; k < lobes; k++) {
    const a = R() * Math.PI * 2, d = R() * S * 0.25;
    m.sphere(Math.cos(a) * d, S * (0.15 + R() * 0.2), Math.sin(a) * d, S * (0.18 + R() * 0.15), { t: 0.5, l: 0, h: 1, part: PART.BODY }, { ws: 10, hs: 7, sx: 1 + R() * 0.6, sy: 0.7 + R() * 0.6, sz: 0.5 + R() * 0.4 });
  }
  return m.build();
}

// ------------------------------------------------------------------------------------------- whale
export function buildSpermWhale({ length = 13 } = {}) {
  const L = length;
  const m = buildBody({
    length: L, seg: 40, rad: 20, exponent: 3.2, belly: 0.9, tPow: 1.0,
    height: [[0, 0.13], [0.05, 0.17], [0.3, 0.19], [0.5, 0.17], [0.75, 0.1], [0.92, 0.04], [1, 0.03]],
    width: [[0, 0.1], [0.05, 0.13], [0.3, 0.15], [0.5, 0.15], [0.75, 0.09], [0.92, 0.03], [1, 0.03]],
    center: [[0, 0.01], [0.3, 0], [0.7, 0], [1, 0]],
    caudal: { type: 'flukes', len: 0.12, span: 0.3, inset: 0.0 },
    pectoral: { t: 0.36, h: -0.6, len: 0.08, w: 0.035, angle: 1.0, up: -0.4 },
    eye: { t: 0.34, up: -0.3, out: 0.98, r: 0.006 },
  });
  // dorsal hump and knuckles
  m.flat([[0, L * 0.085, -L * 0.14], [0, L * 0.12, -L * 0.17], [0, L * 0.075, -L * 0.22]], V(1, 0, 0), () => ({ t: 0.68, l: 0, h: 1, part: PART.DORSAL }));
  for (let k = 0; k < 4; k++) { const z = -L * (0.25 + k * 0.035); m.flat([[0, L * 0.06 - k * L * 0.006, z], [0, L * 0.075 - k * L * 0.006, z - L * 0.012], [0, L * 0.055 - k * L * 0.006, z - L * 0.024]], V(1, 0, 0), () => ({ t: 0.76 + k * 0.03, l: 0, h: 1, part: PART.DORSAL })); }
  // narrow lower jaw
  m.tube([[0, -L * 0.07, L * 0.12], [0, -L * 0.075, L * 0.3], [0, -L * 0.072, L * 0.42]], [L * 0.025, L * 0.018, L * 0.012], 8, (j, u) => ({ t: 0.3 - u * 0.25, l: 0, h: -1, part: PART.EXTRA }));
  return m.build();
}

export { buildBody, curve };
