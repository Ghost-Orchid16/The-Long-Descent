import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _l = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/**
 * Collision world for spherical bodies (diver, pod). Shapes:
 *  - heightfields  : solid below y = h(x, z)
 *  - sheets        : vertical walls, solid on one side of z = f(x, y) (or x = f(z, y))
 *  - spheres       : {c, r}
 *  - capsules      : {a, b, r}
 *  - boxes         : oriented boxes {matrix, half}
 *  - bounds        : soft play-area limits (axis-aligned)
 */
export class CollisionWorld {
  constructor() {
    this.heightfields = [];
    this.sheets = [];
    this.spheres = [];
    this.capsules = [];
    this.boxes = [];
    this.bounds = null;
    this.ceiling = null; // y limit (sea surface for divers)
    this.grid = new Map();
    this.cell = 8;
  }

  clear() {
    this.heightfields.length = 0; this.sheets.length = 0; this.spheres.length = 0;
    this.capsules.length = 0; this.boxes.length = 0; this.bounds = null; this.ceiling = null; this.grid.clear();
  }

  addHeightfield(hf) { this.heightfields.push(hf); }

  /** fn(u, y) returns the wall coordinate along `axis` ('z' or 'x'); side = +1 means solid where coord < f. */
  addSheet({ fn, axis = 'z', side = 1, uMin = -Infinity, uMax = Infinity, yMin = -Infinity, yMax = Infinity }) {
    this.sheets.push({ fn, axis, side, uMin, uMax, yMin, yMax });
  }

  _gridAdd(item, x, z, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i + ',' + j;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(item);
    }
  }

  addSphere(c, r) { const s = { type: 's', c: c.clone(), r }; this.spheres.push(s); this._gridAdd(s, c.x, c.z, r); return s; }

  addCapsule(a, b, r) {
    const s = { type: 'c', a: a.clone(), b: b.clone(), r };
    this.capsules.push(s);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    this._gridAdd(s, mx, mz, a.distanceTo(b) / 2 + r);
    return s;
  }

  /** Oriented box from a matrix (position/rotation) and half extents. */
  addBox(matrix, half) {
    const s = { type: 'b', m: matrix.clone(), inv: matrix.clone().invert(), half: half.clone() };
    this.boxes.push(s);
    _v.setFromMatrixPosition(matrix);
    this._gridAdd(s, _v.x, _v.z, half.length());
    return s;
  }

  groundHeight(x, z) {
    let h = -Infinity;
    for (const hf of this.heightfields) if (hf.inside(x, z)) h = Math.max(h, hf.height(x, z));
    return h;
  }

  /**
   * Push a sphere out of all shapes. Modifies pos; returns the accumulated contact normal (or null).
   * vel (optional) gets its into-surface component removed.
   */
  resolve(pos, radius, vel = null, iterations = 3) {
    let contact = null;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      // heightfields
      for (const hf of this.heightfields) {
        if (!hf.inside(pos.x, pos.z)) continue;
        const h = hf.height(pos.x, pos.z);
        if (pos.y - radius < h) {
          hf.normal(pos.x, pos.z, _n);
          const pen = h + radius - pos.y;
          // push along the normal mostly upward for stability
          pos.y += pen * _n.y;
          pos.x += pen * _n.x * 0.5; pos.z += pen * _n.z * 0.5;
          this._kill(vel, _n);
          contact = (contact || new THREE.Vector3()).add(_n);
          moved = true;
        }
      }
      // sheets
      for (const s of this.sheets) {
        if (pos.y < s.yMin || pos.y > s.yMax) continue;
        const u = s.axis === 'z' ? pos.x : pos.z;
        if (u < s.uMin || u > s.uMax) continue;
        const coord = s.axis === 'z' ? pos.z : pos.x;
        const w = s.fn(u, pos.y);
        const d = (coord - w) * s.side; // positive = free side
        if (d < radius) {
          const e = 0.25;
          // numerical normal of the wall surface
          const du = (s.fn(u + e, pos.y) - s.fn(u - e, pos.y)) / (2 * e);
          const dy = (s.fn(u, pos.y + e) - s.fn(u, pos.y - e)) / (2 * e);
          if (s.axis === 'z') _n.set(-du * s.side, -dy * s.side, s.side).normalize();
          else _n.set(s.side, -dy * s.side, -du * s.side).normalize();
          const pen = radius - d;
          pos.addScaledVector(_n, pen);
          this._kill(vel, _n);
          contact = (contact || new THREE.Vector3()).add(_n);
          moved = true;
        }
      }
      // spatially hashed primitives
      const c = this.cell;
      const key = Math.floor(pos.x / c) + ',' + Math.floor(pos.z / c);
      const items = this.grid.get(key);
      if (items) for (const s of items) {
        if (s.type === 's') {
          _v.subVectors(pos, s.c);
          const d = _v.length(), min = s.r + radius;
          if (d < min && d > 1e-6) { _n.copy(_v).divideScalar(d); pos.addScaledVector(_n, min - d); this._kill(vel, _n); contact = (contact || new THREE.Vector3()).add(_n); moved = true; }
        } else if (s.type === 'c') {
          _l.subVectors(s.b, s.a);
          const t = THREE.MathUtils.clamp(_v.subVectors(pos, s.a).dot(_l) / Math.max(_l.lengthSq(), 1e-6), 0, 1);
          _w.copy(s.a).addScaledVector(_l, t);
          _v.subVectors(pos, _w);
          const d = _v.length(), min = s.r + radius;
          if (d < min && d > 1e-6) { _n.copy(_v).divideScalar(d); pos.addScaledVector(_n, min - d); this._kill(vel, _n); contact = (contact || new THREE.Vector3()).add(_n); moved = true; }
        } else if (s.type === 'b') {
          _l.copy(pos).applyMatrix4(s.inv);
          _w.set(THREE.MathUtils.clamp(_l.x, -s.half.x, s.half.x), THREE.MathUtils.clamp(_l.y, -s.half.y, s.half.y), THREE.MathUtils.clamp(_l.z, -s.half.z, s.half.z));
          _v.subVectors(_l, _w);
          let d = _v.length();
          if (d < radius) {
            if (d < 1e-6) {
              // centre inside the box: push out along the smallest axis
              const dx = s.half.x - Math.abs(_l.x), dy = s.half.y - Math.abs(_l.y), dz = s.half.z - Math.abs(_l.z);
              if (dx < dy && dx < dz) _v.set(Math.sign(_l.x), 0, 0); else if (dy < dz) _v.set(0, Math.sign(_l.y), 0); else _v.set(0, 0, Math.sign(_l.z));
              d = 0;
              _w.copy(_l).addScaledVector(_v, Math.min(dx, dy, dz));
            } else _v.divideScalar(d);
            // to world
            _n.copy(_v).transformDirection(s.m);
            const pen = radius - d;
            pos.addScaledVector(_n, pen + (d === 0 ? radius : 0));
            this._kill(vel, _n);
            contact = (contact || new THREE.Vector3()).add(_n);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    // soft bounds & ceiling
    if (this.bounds) {
      const b = this.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, b.min.x, b.max.x);
      pos.z = THREE.MathUtils.clamp(pos.z, b.min.z, b.max.z);
      pos.y = THREE.MathUtils.clamp(pos.y, b.min.y, b.max.y);
    }
    if (this.ceiling !== null && pos.y > this.ceiling) {
      pos.y = this.ceiling;
      if (vel && vel.y > 0) vel.y = 0;
    }
    if (contact) contact.normalize();
    return contact;
  }

  _kill(vel, n) {
    if (!vel) return;
    const vn = vel.dot(n);
    if (vn < 0) vel.addScaledVector(n, -vn * 1.05);
  }

  /** Sphere-cast style line-of-sight test against heightfields only (cheap). */
  segmentHitsGround(a, b, steps = 16) {
    for (let i = 1; i <= steps; i++) {
      _v.lerpVectors(a, b, i / steps);
      if (_v.y < this.groundHeight(_v.x, _v.z)) return true;
    }
    return false;
  }
}
