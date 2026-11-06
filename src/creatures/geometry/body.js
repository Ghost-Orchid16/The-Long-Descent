import * as THREE from 'three';

// Part ids written to aBody.w (used by the swim shader and colour patterns).
export const PART = { BODY: 0, CAUDAL: 1, DORSAL: 2, PECTORAL: 3, PELVIC: 4, ANAL: 5, EYE: 6, SPINE: 7, EXTRA: 8, LURE: 9, ARM: 10, BELL: 11, TENTACLE: 12, SHELL: 13 };

/** Smooth interpolation through [t, v] control points (Catmull–Rom, clamped). */
export function curve(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (t >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > pts[i + 1][0]) i++;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[1] + (u3 - u2) * m2;
}

/** Mesh accumulator with the creature attribute layout. */
export class CMesh {
  constructor() { this.p = []; this.n = []; this.uv = []; this.b = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx, ny, nz, u, vv, bt, bl, bh, part) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, vv); this.b.push(bt, bl, bh, part);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  /** Two-sided flat polygon (fan from first point). pts: [[x,y,z], ...]; body attrs per point via fn. */
  flat(pts, normal, attrFn, { twoSided = true } = {}) {
    const n = normal.lengthSq() > 1e-14 ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const base = this.count;
    pts.forEach((q, k) => { const a = attrFn(q, k); this.v(q[0], q[1], q[2], n.x, n.y, n.z, a.u ?? 0, a.v ?? 0, a.t, a.l, a.h, a.part); });
    for (let k = 1; k < pts.length - 1; k++) this.tri(base, base + k, base + k + 1);
    if (twoSided) {
      const b2 = this.count;
      pts.forEach((q, k) => { const a = attrFn(q, k); this.v(q[0], q[1], q[2], -n.x, -n.y, -n.z, a.u ?? 0, a.v ?? 0, a.t, a.l, a.h, a.part); });
      for (let k = 1; k < pts.length - 1; k++) this.tri(b2, b2 + k + 1, b2 + k);
    }
  }
  /** Ribbon strip between two polylines (rows of equal length), two-sided. */
  strip(rowA, rowB, attrFn, { twoSided = true } = {}) {
    const m = rowA.length;
    const base = this.count;
    const nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const emit = (flip) => {
      const b0 = this.count;
      for (let k = 0; k < m; k++) {
        const a = rowA[k], b = rowB[k];
        const an = rowA[Math.min(m - 1, k + 1)], ap = rowA[Math.max(0, k - 1)];
        e1.set(an[0] - ap[0], an[1] - ap[1], an[2] - ap[2]);
        e2.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (e2.lengthSq() < 1e-12) { const bn = rowB[Math.min(m - 1, k + 1)], bp = rowB[Math.max(0, k - 1)]; e2.set((bn[0] + bp[0]) / 2 - a[0], (bn[1] + bp[1]) / 2 - a[1], (bn[2] + bp[2]) / 2 - a[2]); }
        nrm.crossVectors(e1, e2);
        if (nrm.lengthSq() < 1e-14) nrm.set(1, 0, 0);
        nrm.normalize().multiplyScalar(flip ? -1 : 1);
        const aa = attrFn(a, k, 0), ab = attrFn(b, k, 1);
        this.v(a[0], a[1], a[2], nrm.x, nrm.y, nrm.z, aa.u ?? k / (m - 1), 0, aa.t, aa.l, aa.h, aa.part);
        this.v(b[0], b[1], b[2], nrm.x, nrm.y, nrm.z, ab.u ?? k / (m - 1), 1, ab.t, ab.l, ab.h, ab.part);
      }
      for (let k = 0; k < m - 1; k++) {
        const a0 = b0 + k * 2, a1 = a0 + 1, c0 = a0 + 2, c1 = a0 + 3;
        if (flip) { this.tri(a0, c0, a1); this.tri(a1, c0, c1); } else { this.tri(a0, a1, c0); this.tri(a1, c1, c0); }
      }
    };
    emit(false);
    if (twoSided) emit(true);
    void base;
  }
  /** Tube along points with radii; attrs per ring. */
  tube(pts, radii, radial, attrFn) {
    const T = [], N = [], B = [];
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      T.push(new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize());
    }
    let nr = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    nr.sub(T[0].clone().multiplyScalar(nr.dot(T[0]))).normalize();
    for (let k = 0; k < n; k++) {
      if (k > 0) { const ax = new THREE.Vector3().crossVectors(T[k - 1], T[k]); const s = ax.length(); if (s > 1e-6) nr.applyAxisAngle(ax.normalize(), Math.asin(Math.min(1, s))); }
      N.push(nr.clone()); B.push(new THREE.Vector3().crossVectors(T[k], nr).normalize());
    }
    const base = this.count;
    for (let k = 0; k < n; k++) {
      const at = attrFn(k, k / (n - 1));
      for (let r = 0; r <= radial; r++) {
        const ang = (r / radial) * Math.PI * 2;
        const dn = N[k].clone().multiplyScalar(Math.cos(ang)).addScaledVector(B[k], Math.sin(ang));
        if (!(dn.lengthSq() > 1e-12)) dn.set(0, 1, 0);
        this.v(pts[k][0] + dn.x * radii[k], pts[k][1] + dn.y * radii[k], pts[k][2] + dn.z * radii[k], dn.x, dn.y, dn.z, r / radial, k / (n - 1), at.t, at.l, at.h, at.part);
      }
    }
    const row = radial + 1;
    for (let k = 0; k < n - 1; k++) for (let r = 0; r < radial; r++) {
      const a = base + k * row + r, b = a + 1, c = a + row, d = c + 1;
      this.tri(a, b, c); this.tri(b, d, c);
    }
  }
  sphere(cx, cy, cz, r, attr, { ws = 10, hs = 7, sx = 1, sy = 1, sz = 1 } = {}) {
    const base = this.count;
    for (let j = 0; j <= hs; j++) {
      const th = (j / hs) * Math.PI;
      for (let i = 0; i <= ws; i++) {
        const ph = (i / ws) * Math.PI * 2;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        this.v(cx + nx * r * sx, cy + ny * r * sy, cz + nz * r * sz, nx, ny, nz, i / ws, j / hs, attr.t, attr.l + nx * 0.3, attr.h + ny * 0.3, attr.part);
      }
    }
    for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
      const a = base + j * (ws + 1) + i, b = a + 1, c = a + ws + 1, d = c + 1;
      this.tri(a, c, b); this.tri(b, c, d);
    }
  }
  merge(o, m) {
    const base = this.count;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let k = 0; k < o.count; k++) {
      v.set(o.p[k * 3], o.p[k * 3 + 1], o.p[k * 3 + 2]); nn.set(o.n[k * 3], o.n[k * 3 + 1], o.n[k * 3 + 2]);
      if (m) { v.applyMatrix4(m); nn.applyMatrix3(nm).normalize(); }
      this.p.push(v.x, v.y, v.z); this.n.push(nn.x, nn.y, nn.z);
    }
    this.uv.push(...o.uv); this.b.push(...o.b);
    for (const i of o.i) this.i.push(i + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBody', new THREE.Float32BufferAttribute(this.b, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Lofted body along local Z (nose at +L/2, tail at -L/2). Profiles are fractions of L:
 *  height/width: [[t, full size]...], center: vertical offset, belly: flattening of the lower half.
 * Fins: caudal {type: forked|lunate|round|truncate|hetero|pointed|none, len, span, tilt}
 *       dorsal/anal [{t0, t1, h, sweep, rays}], pectoral {t, h, len, w, angle, up}, pelvic {...}
 */
export function buildBody(P) {
  const L = P.length;
  const m = new CMesh();
  const seg = P.seg ?? 30, rad = P.rad ?? 16;
  const H = (t) => Math.max(0.0005, curve(P.height, t)) * L;
  const W = (t) => Math.max(0.0005, curve(P.width, t)) * L;
  const C = (t) => (P.center ? curve(P.center, t) : 0) * L;
  const ex = P.exponent ?? 2.2;
  const belly = P.belly ?? 1.0;
  const zOf = (t) => L * (0.5 - t);
  // ---- body rings
  const rows = [];
  for (let s = 0; s <= seg; s++) {
    const t = Math.pow(s / seg, P.tPow ?? 1.0);
    const h = H(t), w = W(t), c = C(t);
    const row = [];
    for (let r = 0; r <= rad; r++) {
      const a = (r / rad) * Math.PI * 2 - Math.PI / 2; // start at the belly
      const ca = Math.cos(a), sa = Math.sin(a);
      const se = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), 2 / e);
      let x = se(ca, ex) * w / 2;
      let y = se(sa, ex) * h / 2 * (sa < 0 ? belly : 1);
      row.push([x, y + c, zOf(t), ca, sa, t]);
    }
    rows.push(row);
  }
  const base = m.count;
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let s = 0; s <= seg; s++) {
    for (let r = 0; r <= rad; r++) {
      const q = rows[s][r];
      const sn = rows[Math.min(seg, s + 1)][r], sp = rows[Math.max(0, s - 1)][r];
      const rn = rows[s][(r + 1) % (rad + 1)], rp = rows[s][(r - 1 + rad + 1) % (rad + 1)];
      tmpA.set(sn[0] - sp[0], sn[1] - sp[1], sn[2] - sp[2]);
      tmpB.set(rn[0] - rp[0], rn[1] - rp[1], rn[2] - rp[2]);
      nrm.crossVectors(tmpB, tmpA).normalize();
      if (!(nrm.lengthSq() > 0.5)) nrm.set(q[3], q[4], 0).normalize();
      m.v(q[0], q[1], q[2], nrm.x, nrm.y, nrm.z, q[5], r / rad, q[5], q[3], q[4], PART.BODY);
    }
  }
  const row = rad + 1;
  for (let s = 0; s < seg; s++) for (let r = 0; r < rad; r++) {
    const a = base + s * row + r, b = a + 1, c = a + row, d = c + 1;
    m.tri(a, c, b); m.tri(b, c, d);
  }
  const topAt = (t) => C(t) + H(t) / 2, botAt = (t) => C(t) - (H(t) / 2) * belly;
  const fa = (part) => (q) => ({ t: THREE.MathUtils.clamp(0.5 - q[2] / L, 0, 1), l: 0, h: q[1] / (L * 0.2), part });

  // ---- caudal fin
  const cf = P.caudal;
  if (cf && cf.type !== 'none') {
    const z0 = zOf(1) + (cf.inset ?? 0.01) * L, c0 = C(1);
    const len = cf.len * L, span = cf.span * L;
    let pts;
    switch (cf.type) {
      case 'forked': pts = [[0, c0 + H(1) * 0.6, z0], [0, c0 + span / 2, z0 - len], [0, c0 + span * 0.05, z0 - len * 0.48], [0, c0 - span / 2, z0 - len], [0, c0 - H(1) * 0.6, z0]]; break;
      case 'lunate': pts = [[0, c0 + H(1) * 0.5, z0], [0, c0 + span / 2, z0 - len], [0, c0 + span * 0.2, z0 - len * 0.62], [0, c0, z0 - len * 0.56], [0, c0 - span * 0.2, z0 - len * 0.62], [0, c0 - span / 2, z0 - len], [0, c0 - H(1) * 0.5, z0]]; break;
      case 'round': pts = [[0, c0 + H(1) * 0.6, z0], [0, c0 + span * 0.42, z0 - len * 0.55], [0, c0 + span * 0.25, z0 - len * 0.9], [0, c0, z0 - len], [0, c0 - span * 0.25, z0 - len * 0.9], [0, c0 - span * 0.42, z0 - len * 0.55], [0, c0 - H(1) * 0.6, z0]]; break;
      case 'truncate': pts = [[0, c0 + H(1) * 0.6, z0], [0, c0 + span / 2, z0 - len * 0.95], [0, c0 + span * 0.15, z0 - len], [0, c0 - span * 0.15, z0 - len], [0, c0 - span / 2, z0 - len * 0.95], [0, c0 - H(1) * 0.6, z0]]; break;
      case 'hetero': pts = [[0, c0 + H(1) * 0.5, z0], [0, c0 + span * 0.62, z0 - len], [0, c0 + span * 0.5, z0 - len * 1.06], [0, c0 + span * 0.1, z0 - len * 0.62], [0, c0 - span * 0.12, z0 - len * 0.5], [0, c0 - span * 0.36, z0 - len * 0.42], [0, c0 - H(1) * 0.5, z0]]; break;
      case 'pointed': pts = [[0, c0 + H(1) * 0.6, z0], [0, c0, z0 - len], [0, c0 - H(1) * 0.6, z0]]; break;
      case 'flukes': {
        // horizontal flukes (cetaceans): in the XZ plane
        const fp = [[0, c0, z0], [span / 2, c0, z0 - len * 0.85], [span * 0.44, c0, z0 - len], [span * 0.08, c0, z0 - len * 0.72], [0, c0, z0 - len * 0.78], [-span * 0.08, c0, z0 - len * 0.72], [-span * 0.44, c0, z0 - len], [-span / 2, c0, z0 - len * 0.85]];
        m.flat(fp, new THREE.Vector3(0, 1, 0), (q) => ({ t: 1, l: q[0] / (span / 2), h: 0, part: PART.CAUDAL, u: q[0] / span + 0.5, v: (z0 - q[2]) / len }));
        pts = null;
        break;
      }
      default: pts = null;
    }
    if (pts) m.flat(pts, new THREE.Vector3(1, 0, 0), (q) => ({ t: 1, l: 0, h: (q[1] - c0) / (span / 2 + 1e-6), part: PART.CAUDAL, u: (z0 - q[2]) / len, v: (q[1] - c0) / span + 0.5 }));
  }
  // ---- dorsal & anal fins (median, in the YZ plane)
  const median = (list, part, top) => {
    for (const f of list || []) {
      const n = 10;
      const ptsA = [], ptsB = [];
      for (let k = 0; k <= n; k++) {
        const t = f.t0 + (f.t1 - f.t0) * (k / n);
        const yb = top ? topAt(t) - 0.002 * L : botAt(t) + 0.002 * L;
        const prof = f.shape ? curve(f.shape, k / n) : Math.sin(Math.PI * Math.pow(k / n, f.skew ?? 0.7));
        const h = f.h * L * prof * (top ? 1 : -1);
        const sweep = (f.sweep ?? 0.3) * Math.abs(h);
        ptsA.push([0, yb, zOf(t)]);
        ptsB.push([0, yb + h, zOf(t) - sweep]);
      }
      m.strip(ptsA, ptsB, (q, k, side) => ({ t: THREE.MathUtils.clamp(0.5 - q[2] / L, 0, 1), l: 0, h: top ? 1 + side : -1 - side, part, u: k / n }));
    }
  };
  median(P.dorsal, PART.DORSAL, true);
  median(P.anal, PART.ANAL, false);
  // ---- paired fins
  const paired = (f, part) => {
    if (!f) return;
    for (const s of [-1, 1]) {
      const t = f.t, yb = C(t) + (f.h ?? 0) * H(t) / 2, xb = s * W(t) / 2 * 0.92;
      const len = f.len * L, w = f.w * L;
      const ang = f.angle ?? 0.5, up = f.up ?? -0.25;
      const dir = new THREE.Vector3(s * Math.sin(ang), up, -Math.cos(ang)).normalize();
      const p0 = [xb, yb + w / 2, zOf(t)], p1 = [xb, yb - w / 2, zOf(t) + w * 0.2];
      const tip = [xb + dir.x * len, yb + dir.y * len, zOf(t) + dir.z * len];
      const tip2 = [xb + dir.x * len * 0.8, yb + dir.y * len * 0.8 - w * 0.4, zOf(t) + dir.z * len * 0.85];
      const nrm2 = new THREE.Vector3().crossVectors(new THREE.Vector3(tip[0] - p0[0], tip[1] - p0[1], tip[2] - p0[2]), new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]));
      if (nrm2.lengthSq() < 1e-14) nrm2.set(s, 0, 0);
      nrm2.normalize();
      m.flat([p0, tip, tip2, p1], nrm2, (q, k) => ({ t, l: s * (1 + (k === 1 || k === 2 ? 1 : 0)), h: f.h ?? 0, part, u: k === 1 || k === 2 ? 1 : 0, v: k }));
    }
  };
  paired(P.pectoral, PART.PECTORAL);
  paired(P.pelvic, PART.PELVIC);
  // ---- spines / filaments
  m.spineTips = [];
  for (const sp of P.spines || []) {
    const t = sp.t, yb = sp.bottom ? botAt(t) : topAt(t);
    const len = sp.len * L, r = (sp.r ?? 0.006) * L;
    const pts = [], rr = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5;
      pts.push([(sp.x ?? 0) * L, yb + (sp.bottom ? -1 : 1) * len * u * Math.cos(sp.lean ?? 0.3), zOf(t) - len * u * Math.sin(sp.lean ?? 0.3) - (sp.curl ?? 0) * u * u * len]);
      rr.push(r * (1 - u * 0.85));
    }
    m.tube(pts, rr, 4, (k, u) => ({ t, l: 0, h: 1 + u, part: PART.SPINE }));
    m.spineTips.push(pts[pts.length - 1]);
  }
  // ---- eyes
  if (P.eye) {
    const e = P.eye, t = e.t;
    for (const s of [-1, 1]) {
      const x = s * W(t) / 2 * (e.out ?? 0.85), y = C(t) + (e.up ?? 0.2) * H(t) / 2;
      m.sphere(x, y, zOf(t), e.r * L, { t, l: s, h: e.up ?? 0.2, part: PART.EYE }, { ws: 10, hs: 6 });
    }
  }
  return m;
}
