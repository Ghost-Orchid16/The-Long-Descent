import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _t = new THREE.Vector3(), _n = new THREE.Vector3(), _bn = new THREE.Vector3();

/**
 * Accumulates vertices with standard + custom attributes and emits a BufferGeometry.
 * Custom per-vertex scalars: tip (0..1 along growth), sway (0..1 flexibility), ao (0..1), swayPhase.
 */
export class GeoBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = [];
    this.tip = []; this.sway = []; this.ao = []; this.sph = [];
    this.extra = {}; // name -> {size, data[]}
    this.idx = [];
  }

  get count() { return this.pos.length / 3; }

  vertex(p, n, uv = [0, 0], { tip = 0, sway = 0, ao = 1, sph = 0, extra = null } = {}) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.tip.push(tip); this.sway.push(sway); this.ao.push(ao); this.sph.push(sph);
    if (extra) for (const k in extra) {
      const v = extra[k];
      if (!this.extra[k]) this.extra[k] = { size: Array.isArray(v) ? v.length : 1, data: [] };
      if (Array.isArray(v)) this.extra[k].data.push(...v); else this.extra[k].data.push(v);
    }
    return this.count - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * Tube along a polyline. pts: Vector3[], radii: number[] (per point), opts.attr(i, t) → vertex attrs.
   */
  tube(pts, radii, radial = 6, { capEnd = true, attr = null, uvScale = 1, phase = 0 } = {}) {
    const n = pts.length;
    if (n < 2) return;
    // parallel-transport frames
    const T = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n - 1, i + 1)];
      T.push(_t.subVectors(p1, p0).normalize().clone());
    }
    let nrm = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    nrm = nrm.sub(T[0].clone().multiplyScalar(nrm.dot(T[0]))).normalize();
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const axis = _a.crossVectors(T[i - 1], T[i]);
        const s = axis.length();
        if (s > 1e-6) {
          axis.normalize();
          const ang = Math.acos(THREE.MathUtils.clamp(T[i - 1].dot(T[i]), -1, 1));
          nrm = nrm.clone().applyAxisAngle(axis, ang);
        }
      }
      N.push(nrm.clone());
      B.push(_bn.crossVectors(T[i], nrm).normalize().clone());
    }
    const base = this.count;
    let len = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
      const t = i / (n - 1);
      const at = attr ? attr(i, t) : { tip: t };
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2 + phase;
        _n.copy(N[i]).multiplyScalar(Math.cos(a)).addScaledVector(B[i], Math.sin(a));
        _c.copy(pts[i]).addScaledVector(_n, radii[i]);
        this.vertex(_c, _n, [k / radial, len * uvScale], at);
      }
    }
    const row = radial + 1;
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
      const a = base + i * row + k, b = a + 1, c = a + row, d = c + 1;
      this.tri(a, b, c); this.tri(b, d, c);
    }
    if (capEnd && radii[n - 1] > 0.0005) {
      const at = attr ? attr(n - 1, 1) : { tip: 1 };
      const tipP = pts[n - 1].clone().addScaledVector(T[n - 1], radii[n - 1] * 0.8);
      const ci = this.vertex(tipP, T[n - 1], [0.5, len * uvScale], at);
      const last = base + (n - 1) * row;
      for (let k = 0; k < radial; k++) this.tri(last + k, last + k + 1, ci);
    }
  }

  /** Surface of revolution around +Y. prof: [[r, y], ...] */
  lathe(prof, segs = 16, { attr = null, phase = 0, noise = null } = {}) {
    const base = this.count;
    const m = prof.length;
    for (let i = 0; i < m; i++) {
      const [r, y] = prof[i];
      const p0 = prof[Math.max(0, i - 1)], p1 = prof[Math.min(m - 1, i + 1)];
      const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2 + phase;
        const ca = Math.cos(a), sa = Math.sin(a);
        let rr = r;
        if (noise) rr *= noise(a, y, i / (m - 1));
        _c.set(ca * rr, y, sa * rr);
        _n.set(ca * dy, -dr, sa * dy).normalize();
        this.vertex(_c, _n, [k / segs, i / (m - 1)], attr ? attr(i / (m - 1), a) : {});
      }
    }
    const row = segs + 1;
    for (let i = 0; i < m - 1; i++) for (let k = 0; k < segs; k++) {
      const a = base + i * row + k, b = a + 1, c = a + row, d = c + 1;
      this.tri(a, c, b); this.tri(b, c, d);
    }
  }

  /** Append another builder (with transform). */
  merge(other, matrix = null) {
    const base = this.count;
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    for (let i = 0; i < other.count; i++) {
      _a.fromArray(other.pos, i * 3); _b.fromArray(other.nor, i * 3);
      if (matrix) { _a.applyMatrix4(matrix); _b.applyMatrix3(nm).normalize(); }
      this.pos.push(_a.x, _a.y, _a.z); this.nor.push(_b.x, _b.y, _b.z);
      this.uv.push(other.uv[i * 2], other.uv[i * 2 + 1]);
      this.tip.push(other.tip[i]); this.sway.push(other.sway[i]); this.ao.push(other.ao[i]); this.sph.push(other.sph[i]);
    }
    for (const k in other.extra) {
      if (!this.extra[k]) this.extra[k] = { size: other.extra[k].size, data: new Array(base * other.extra[k].size).fill(0) };
      this.extra[k].data.push(...other.extra[k].data);
    }
    for (const i of other.idx) this.idx.push(i + base);
  }

  build({ computeNormals = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTip', new THREE.Float32BufferAttribute(this.tip, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aSwayPhase', new THREE.Float32BufferAttribute(this.sph, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    const n = this.count;
    for (const k in this.extra) {
      const e = this.extra[k];
      while (e.data.length < n * e.size) e.data.push(0);
      g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    }
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Ensure the standard custom attributes exist on a geometry (fills defaults). */
export function ensureAttributes(g, defaults = { aTip: 0, aSway: 0, aSwayPhase: 0, aAO: 1 }) {
  const n = g.getAttribute('position').count;
  for (const k in defaults) {
    if (!g.getAttribute(k)) g.setAttribute(k, new THREE.Float32BufferAttribute(new Float32Array(n).fill(defaults[k]), 1));
  }
  return g;
}
