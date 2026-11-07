import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder.js';
import { Noise } from './noise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

function smoothBase(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return mergeVertices(geo, 1e-5);
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const noise = new Noise(4242);

function randUnit(rng) {
  const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
  return V(s * Math.cos(a), u, s * Math.sin(a));
}

/** Branching Acropora thicket (staghorn-like): many antler branches growing up and out; pale growing tips. */
export function branchingCoral(rng, { size = 1, upward = 0.8, maxDepth = 2, radius = 0.016, stubby = 0, trunks = null } = {}) {
  const g = new GeoBuilder();
  const grow = (start, dir, len, r, depth, tip0) => {
    const segs = 3;
    const pts = [], radii = [];
    const p = start.clone(), d = dir.clone();
    for (let i = 0; i <= segs; i++) {
      pts.push(p.clone());
      radii.push(r * (1 - 0.3 * (i / segs)));
      d.addScaledVector(randUnit(rng), 0.12).addScaledVector(UP, upward * 0.1).normalize();
      p.addScaledVector(d, len / segs);
    }
    const isLeaf = depth >= maxDepth;
    g.tube(pts, radii, depth < 1 ? 5 : 4, {
      capEnd: isLeaf,
      attr: (i, t) => ({ tip: isLeaf ? Math.pow(t, 2.0) : 0, ao: 0.5 + 0.5 * Math.min(1, (depth + t) / (maxDepth + 1)) }),
    });
    if (isLeaf) return;
    const kids = rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const at = rng.range(0.35, 1.0);
      const idx = Math.min(segs, Math.round(at * segs));
      const nd = d.clone().addScaledVector(randUnit(rng), 0.75).addScaledVector(UP, upward * 0.6).normalize();
      grow(pts[idx], nd, len * rng.range(0.7, 0.95) * (1 - stubby * 0.4), radii[idx] * 0.9, depth + 1, 0);
    }
  };
  const n = trunks || rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * 0.22 * size;
    const start = V(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const dir = V(Math.cos(a) * (0.35 + rr), 1, Math.sin(a) * (0.35 + rr)).normalize();
    grow(start, dir, 0.17 * size * (1 - stubby * 0.45), radius * (1 + stubby) * (size > 0.5 ? 1.3 : 1), 0, 0);
  }
  return g.build();
}

/** Digitate / corymbose Acropora: a low encrusting base with many short upright fingers. */
export function digitateCoral(rng, { size = 0.5 } = {}) {
  const g = new GeoBuilder();
  const base = new GeoBuilder();
  base.lathe([[size * 0.55, -0.02], [size * 0.6, size * 0.06], [size * 0.45, size * 0.12], [0.001, size * 0.13]], 18, { attr: () => ({ tip: 0, ao: 0.6 }) });
  g.merge(base);
  const n = Math.floor(28 + size * 40);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * size * 0.5;
    const h0 = size * 0.12 * (1 - (rr / (size * 0.55)) ** 2);
    const p0 = V(Math.cos(a) * rr, h0, Math.sin(a) * rr);
    const d = V(Math.cos(a) * rr * 0.6, 1, Math.sin(a) * rr * 0.6).addScaledVector(randUnit(rng), 0.12).normalize();
    const len = size * rng.range(0.14, 0.28) * (1 - rr / size * 0.6);
    const p1 = p0.clone().addScaledVector(d, len * 0.55);
    const p2 = p0.clone().addScaledVector(d, len);
    const r = size * rng.range(0.024, 0.034);
    g.tube([p0, p1, p2], [r, r * 0.95, r * 0.8], 6, { attr: (k, t) => ({ tip: t * t, ao: 0.55 + 0.45 * t }) });
  }
  return g.build();
}

/** Polar plate patch (used for tables and foliose plates). */
function platePatch(g, { a0 = 0, a1 = Math.PI * 2, r0 = 0, R = 1, rings = 8, segs = 28, thick = 0.03, cup = 0.1, edgeNoise = 0.12, seed = 0, y0 = 0, tilt = null }) {
  const top = [], bot = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-3;
  const sN = full ? segs : segs + 1;
  const M = tilt || new THREE.Matrix4();
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const rowT = [], rowB = [];
    for (let k = 0; k < sN; k++) {
      const a = a0 + (a1 - a0) * (k / segs);
      const Rr = R * (1 + edgeNoise * noise.n2(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2 + seed * 1.7));
      const r = r0 + (Rr - r0) * t;
      const y = y0 + cup * (r / R) * (r / R) + 0.015 * noise.n2(r * 6 + seed, a * 3);
      const p = V(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(M);
      const slope = 2 * cup * r / (R * R);
      const n = V(-Math.cos(a) * slope, 1, -Math.sin(a) * slope).normalize().applyMatrix3(nm).normalize();
      const ao = 0.75 + 0.25 * t;
      rowT.push(g.vertex(p, n, [k / segs, t], { tip: t, ao }));
      const pb = p.clone().addScaledVector(n, -thick * (1 - t * 0.5));
      rowB.push(g.vertex(pb, n.clone().negate(), [k / segs, t], { tip: t, ao: ao * 0.55 }));
    }
    top.push(rowT); bot.push(rowB);
  }
  const wrap = (k) => (full ? k % segs : k);
  const kMax = full ? segs : segs;
  for (let i = 0; i < rings; i++) for (let k = 0; k < kMax; k++) {
    const k1 = wrap(k + 1);
    if (!full && k + 1 >= sN) continue;
    g.quad(top[i][k], top[i][k1], top[i + 1][k1], top[i + 1][k]);
    g.quad(bot[i][k], bot[i + 1][k], bot[i + 1][k1], bot[i][k1]);
  }
  // rim
  for (let k = 0; k < kMax; k++) {
    const k1 = wrap(k + 1);
    if (!full && k + 1 >= sN) continue;
    g.quad(top[rings][k], top[rings][k1], bot[rings][k1], bot[rings][k]);
  }
}

/** Acropora table coral: a broad, near-horizontal plate on a short stalk. */
export function tableCoral(rng, { radius = 0.9 } = {}) {
  const g = new GeoBuilder();
  const h = radius * rng.range(0.3, 0.45);
  g.tube([V(0, -0.05, 0), V(0.02, h * 0.5, 0.01), V(0, h, 0)], [radius * 0.13, radius * 0.1, radius * 0.16], 8, { capEnd: false, attr: (i, t) => ({ tip: 0, ao: 0.45 + t * 0.3 }) });
  platePatch(g, { R: radius, rings: 5, segs: 40, thick: 0.035, cup: radius * 0.1, edgeNoise: 0.26, seed: rng.range(0, 100), y0: h });
  return g.build();
}

/** Foliose / plate coral: tiers of overlapping, slightly cupped plates (Montipora / Turbinaria-like). */
export function plateCoral(rng, { size = 0.7 } = {}) {
  const g = new GeoBuilder();
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const off = rng.range(0, size * 0.3);
    const y = (i / n) * size * 0.55 + rng.range(0, size * 0.08);
    const R = size * rng.range(0.32, 0.55) * (1 - i / n * 0.35);
    const tilt = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(rng.range(-0.25, 0.25)))
      .setPosition(Math.cos(a) * off, y, Math.sin(a) * off);
    platePatch(g, { a0: 0, a1: Math.PI * 2, r0: 0, R, rings: 3, segs: 16, thick: 0.018, cup: R * 0.25, edgeNoise: 0.22, seed: rng.range(0, 99), tilt });
  }
  // supporting column
  g.tube([V(0, -0.03, 0), V(0, size * 0.3, 0), V(0, size * 0.55, 0)], [size * 0.12, size * 0.09, size * 0.06], 8, { capEnd: false, attr: () => ({ tip: 0, ao: 0.45 }) });
  return g.build();
}

/** Massive coral boulder (Porites-like) with lumpy surface; flattened base. */
export function massiveCoral(rng, { radius = 1, lumpy = 1, seed = 0 } = {}) {
  const geo = smoothBase(new THREE.SphereGeometry(1, 30, 18));
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const ao = new Float32Array(n), tip = new Float32Array(n);
  const s = seed || rng.range(0, 100);
  const sq = rng.range(0.55, 0.85);
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lobes = Math.pow(1 - Math.abs(noise.n3(x * 3.1 + s, y * 3.1, z * 3.1 - s)), 3) * 0.11;
    const lump = (noise.fbm3(x * 1.4 + s, y * 1.4, z * 1.4 - s, 4) * 0.18 + lobes) * lumpy + noise.n3(x * 7 + s, y * 7, z * 7) * 0.018;
    const r = radius * (1 + lump);
    x *= r; y *= r * sq; z *= r;
    if (y < 0) y *= 0.25;
    pos.setXYZ(i, x, y, z);
    ao[i] = THREE.MathUtils.clamp(0.72 + lump * 1.6 + (y / (radius * sq)) * 0.18, 0.35, 1);
    tip[i] = THREE.MathUtils.clamp(y / (radius * sq), 0, 1);
  }
  geo.computeVertexNormals();
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  geo.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aSwayPhase', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Brain coral: smooth dome (meanders come from the brain normal texture). */
export function brainCoral(rng, { radius = 0.5 } = {}) {
  return massiveCoral(rng, { radius, lumpy: 0.25 });
}

/** Leather coral (Sarcophyton-like): stalk + wavy flared cap; gently sways. */
export function leatherCoral(rng, { size = 0.35 } = {}) {
  const g = new GeoBuilder();
  const prof = [[size * 0.22, 0], [size * 0.2, size * 0.25], [size * 0.25, size * 0.42], [size * 0.7, size * 0.55], [size * 1.0, size * 0.6], [size * 0.98, size * 0.68], [size * 0.6, size * 0.7], [0.001, size * 0.66]];
  const s = rng.range(0, 50);
  g.lathe(prof, 28, {
    noise: (a, y, t) => 1 + (t > 0.3 ? 0.16 * Math.sin(a * 7 + s) * t + 0.06 * noise.n2(a * 3 + s, t * 4) : 0),
    attr: (t) => ({ tip: t, sway: Math.max(0, t - 0.2) * 0.9, ao: 0.5 + 0.5 * t, sph: s }),
  });
  return g.build();
}

/** Soft tree coral (Dendronephthya-like): translucent stems ending in dense polyp clusters. */
export function treeSoftCoral(rng, { size = 0.5 } = {}) {
  const g = new GeoBuilder();
  const ph = rng.range(0, 30);
  const grow = (start, dir, len, r, depth) => {
    const pts = [], radii = [];
    const p = start.clone(), d = dir.clone();
    for (let i = 0; i <= 3; i++) {
      pts.push(p.clone()); radii.push(r * (1 - 0.35 * i / 3));
      d.addScaledVector(randUnit(rng), 0.25).addScaledVector(UP, 0.12).normalize();
      p.addScaledVector(d, len / 3);
    }
    const sw = (y) => Math.min(1, y / size);
    g.tube(pts, radii, 4, { capEnd: depth >= 2, attr: (i) => ({ tip: depth / 3, sway: sw(pts[i].y), ao: 0.6 + depth * 0.12, sph: ph }) });
    if (depth >= 2) {
      // polyp cluster
      for (let k = 0; k < 7; k++) {
        const c = pts[3].clone().addScaledVector(randUnit(rng), r * 2.6);
        const sp = new THREE.SphereGeometry(r * rng.range(1.8, 2.6), 5, 3);
        const pa = sp.getAttribute('position'), na = sp.getAttribute('normal');
        const base = g.count;
        for (let v = 0; v < pa.count; v++) {
          g.vertex(V(pa.getX(v) + c.x, pa.getY(v) + c.y, pa.getZ(v) + c.z), V(na.getX(v), na.getY(v), na.getZ(v)), [0, 0], { tip: 1, sway: sw(c.y), ao: 1, sph: ph });
        }
        const ix = sp.getIndex();
        for (let q = 0; q < ix.count; q += 3) g.tri(base + ix.getX(q), base + ix.getX(q + 1), base + ix.getX(q + 2));
        sp.dispose();
      }
      return;
    }
    const kids = rng.int(2, 4);
    for (let k = 0; k < kids; k++) {
      const nd = d.clone().addScaledVector(randUnit(rng), 0.8).addScaledVector(UP, 0.4).normalize();
      grow(pts[rng.int(2, 3)], nd, len * 0.72, radii[3] * 0.85, depth + 1);
    }
  };
  grow(V(), UP.clone(), size * 0.32, size * 0.07, 0);
  grow(V(0.03, 0, 0.02), V(0.3, 1, 0.1).normalize(), size * 0.25, size * 0.05, 1);
  return g.build();
}

/**
 * Gorgonian sea fan (Annella-like): a planar, net-like branching colony, flexible near the top.
 * Built in the XY plane facing ±Z.
 */
export function seaFan(rng, { width = 2.0, height = 1.6, curve = 0.12, density = 1 } = {}) {
  const g = new GeoBuilder();
  const segs = [];
  const nodes = [];
  const grow = (p, ang, len, r, depth) => {
    let cur = p.clone();
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      ang += rng.range(-0.15, 0.15);
      const nx = cur.x + Math.sin(ang) * len / steps, ny = cur.y + Math.cos(ang) * len / steps;
      if (ny < 0.02) break;
      const nxt = V(nx, ny, 0);
      segs.push([cur.clone(), nxt.clone(), r, r * 0.92]);
      nodes.push({ p: nxt.clone(), d: depth, r });
      cur = nxt;
      r *= 0.94;
    }
    if (depth >= 7 || r < 0.0028) return;
    const spread = rng.range(0.32, 0.6);
    grow(cur, ang - spread * rng.range(0.6, 1.1), len * rng.range(0.7, 0.88), r * 0.8, depth + 1);
    grow(cur, ang + spread * rng.range(0.6, 1.1), len * rng.range(0.7, 0.88), r * 0.8, depth + 1);
  };
  const main = rng.int(2, 3);
  for (let i = 0; i < main; i++) grow(V(rng.range(-0.04, 0.04), 0, 0), rng.range(-0.5, 0.5) + (i - (main - 1) / 2) * 0.5, height * 0.3, 0.011, 0);
  // anastomoses: link nearby twigs into a mesh
  const fine = nodes.filter((n) => n.d >= 3);
  const links = Math.floor(fine.length * 0.9 * density);
  for (let k = 0; k < links; k++) {
    const a = rng.pick(fine);
    let best = null, bd = 1e9;
    for (let t = 0; t < 14; t++) {
      const b = rng.pick(fine);
      if (b === a) continue;
      const d = a.p.distanceTo(b.p);
      if (d > 0.025 && d < bd && d < 0.11) { bd = d; best = b; }
    }
    if (best) segs.push([a.p.clone(), best.p.clone(), Math.min(a.r, best.r) * 0.6, Math.min(a.r, best.r) * 0.6]);
  }
  // scale to target width/height and bend the plane slightly
  const bb = new THREE.Box3();
  for (const s of segs) { bb.expandByPoint(s[0]); bb.expandByPoint(s[1]); }
  const sx = width / Math.max(0.1, bb.max.x - bb.min.x), sy = height / Math.max(0.1, bb.max.y - bb.min.y);
  const cxm = (bb.max.x + bb.min.x) / 2;
  const ph = rng.range(0, 40);
  const map = (p) => {
    const x = (p.x - cxm) * sx, y = p.y * sy;
    return V(x, y, curve * (x * x) / (width * 0.5) + 0.03 * noise.n2(x * 3, y * 3));
  };
  for (const [a, b, r0, r1] of segs) {
    const pa = map(a), pb = map(b);
    g.tube([pa, pb], [r0, r1], 3, {
      capEnd: false,
      attr: (i) => { const y = i === 0 ? pa.y : pb.y; return { tip: y / height, sway: Math.pow(y / height, 1.3), ao: 0.7 + 0.3 * (y / height), sph: ph }; },
    });
  }
  const geo = g.build();
  // Fine net membrane: a curved sheet following the fan's outline; the mesh pattern is alpha-tested in the shader.
  const m = new GeoBuilder();
  const nu = 24, nv = 18;
  const rows = [];
  for (let j = 0; j <= nv; j++) {
    const row = [];
    const y = (j / nv) * height * 0.97;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu - 0.5;
      // outline: fan widens upward like the branch envelope
      const wv = Math.sin(Math.min(1, (j / nv) * 1.15) * Math.PI * 0.62) * width * 0.98;
      const x = u * wv;
      const p = V(x, y, curve * (x * x) / (width * 0.5) + 0.03 * noise.n2(x * 3, y * 3));
      row.push(m.vertex(p, V(0, 0, 1), [u + 0.5, j / nv], { tip: y / height, sway: Math.pow(y / height, 1.3), ao: 0.8, sph: ph }));
    }
    rows.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) m.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  geo.userData.membrane = m.build();
  return geo;
}

/** Magnificent sea anemone (Heteractis magnifica-like): column, broad oral disc, blunt finger tentacles. */
export function anemone(rng, { radius = 0.25, tentacles = 100 } = {}) {
  const g = new GeoBuilder();
  const ph = rng.range(0, 30);
  // column (vivid colour carried by tip=0 region)
  g.lathe([[radius * 0.55, -0.02], [radius * 0.6, radius * 0.25], [radius * 0.85, radius * 0.38], [radius * 0.95, radius * 0.42]], 24, {
    attr: () => ({ tip: 0, ao: 0.7, sph: ph }),
    noise: (a, y) => 1 + 0.08 * Math.sin(a * 5 + ph),
  });
  // oral disc
  g.lathe([[radius * 0.95, radius * 0.42], [radius * 0.5, radius * 0.45], [0.001, radius * 0.4]], 24, { attr: () => ({ tip: 0.35, ao: 0.8, sph: ph }) });
  for (let i = 0; i < tentacles; i++) {
    const ring = Math.sqrt(rng.range(0.15, 1));
    const a = rng.range(0, Math.PI * 2);
    const base = V(Math.cos(a) * radius * 0.9 * ring, radius * 0.43, Math.sin(a) * radius * 0.9 * ring);
    const out = V(Math.cos(a), 0, Math.sin(a));
    const dir = UP.clone().multiplyScalar(rng.range(0.6, 1.2)).addScaledVector(out, 0.4 + ring * 0.6).normalize();
    const len = rng.range(0.06, 0.1) * (radius / 0.25);
    const pts = [base.clone()], radii = [0.0065];
    const p = base.clone(), d = dir.clone();
    for (let s = 1; s <= 4; s++) {
      d.addScaledVector(randUnit(rng), 0.22).normalize();
      p.addScaledVector(d, len / 4);
      pts.push(p.clone()); radii.push(0.0065 - s * 0.0006);
    }
    g.tube(pts, radii, 3, { attr: (k, t) => ({ tip: 0.5 + t * 0.5, sway: t * 0.9, ao: 0.6 + 0.4 * t, sph: ph + i * 0.37 }) });
  }
  return g.build();
}

/** Giant barrel sponge (Xestospongia-like): flared vase with deep vertical ridges and a wide osculum. */
export function barrelSponge(rng, { height = 0.9 } = {}) {
  const g = new GeoBuilder();
  const R = height * rng.range(0.42, 0.55);
  const s0 = rng.range(0, 99);
  const ridges = rng.int(11, 15);
  const outer = [[R * 0.42, -0.04], [R * 0.6, height * 0.1], [R * 0.82, height * 0.35], [R * 0.98, height * 0.65], [R * 1.08, height * 0.92], [R * 1.08, height], [R * 0.92, height * 1.02]];
  const ridge = (a, y, t) => 1 + 0.16 * Math.pow(Math.abs(Math.cos(a * ridges * 0.5 + Math.sin(y * 4 + s0) * 0.35)), 3.0) * Math.min(1, t * 2.5)
    + 0.04 * noise.n2(a * 4 + s0, y * 6);
  g.lathe(outer, 72, { noise: ridge, attr: (t) => ({ tip: t, ao: 0.45 + 0.55 * t }) });
  const inner = [[R * 0.92, height * 1.02], [R * 0.86, height * 0.94], [R * 0.72, height * 0.6], [R * 0.4, height * 0.35], [0.01, height * 0.28]];
  g.lathe(inner, 48, { attr: (t) => ({ tip: 1, ao: 0.55 - t * 0.4 }) });
  return g.build();
}

/** Cluster of tube sponges. */
export function tubeSponges(rng, { size = 0.4 } = {}) {
  const g = new GeoBuilder();
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, size * 0.25);
    const h = size * rng.range(0.5, 1.1), r = size * rng.range(0.08, 0.13);
    const m = new THREE.Matrix4().makeRotationZ(rng.range(-0.25, 0.25)).setPosition(Math.cos(a) * d, 0, Math.sin(a) * d);
    const t = new GeoBuilder();
    t.lathe([[r * 0.8, -0.02], [r, h * 0.5], [r * 1.05, h], [r * 0.75, h * 1.0], [r * 0.7, h * 0.6]], 14, { attr: (q) => ({ tip: q, ao: 0.5 + q * 0.5 }) });
    g.merge(t, m);
  }
  return g.build();
}

/** Rock: displaced icosahedron, flattened. */
export function rock(rng, { size = 1, flat = 0.6, seed = 0 } = {}) {
  const geo = smoothBase(new THREE.IcosahedronGeometry(1, 3));
  const pos = geo.getAttribute('position');
  const s = seed || rng.range(0, 100);
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = noise.fbm3(x * 1.3 + s, y * 1.3, z * 1.3 + s, 4);
    const r = size * (1 + n * 0.35 + noise.n3(x * 4 + s, y * 4, z * 4) * 0.06);
    let yy = y * r * flat;
    if (yy < 0) yy *= 0.3;
    pos.setXYZ(i, x * r, yy, z * r);
    ao[i] = THREE.MathUtils.clamp(0.7 + n * 0.8 + y * 0.2, 0.3, 1);
  }
  const g2 = geo;
  g2.computeVertexNormals();
  g2.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g2.setAttribute('aTip', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  g2.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  g2.setAttribute('aSwayPhase', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  g2.computeBoundingSphere();
  return g2;
}

/** Dead coral rubble piece. */
export function rubble(rng) {
  const g = new GeoBuilder();
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(0.06, 0.2), r = rng.range(0.008, 0.02);
    const d = V(Math.cos(a), rng.range(-0.1, 0.25), Math.sin(a)).normalize();
    const p0 = V(rng.range(-0.03, 0.03), r, rng.range(-0.03, 0.03));
    const p1 = p0.clone().addScaledVector(d, len * 0.5).add(V(0, rng.range(-0.01, 0.02), 0));
    const p2 = p1.clone().addScaledVector(d.clone().addScaledVector(randUnit(rng), 0.4).normalize(), len * 0.5);
    g.tube([p0, p1, p2], [r, r * 0.9, r * 0.7], 4, { attr: () => ({ tip: 0, ao: 0.8 }) });
  }
  return g.build();
}

/** Long-spined sea urchin (Diadema-like). */
export function urchin(rng, { r = 0.045 } = {}) {
  const g = new GeoBuilder();
  const body = new THREE.SphereGeometry(r, 12, 8);
  const pa = body.getAttribute('position'), na = body.getAttribute('normal');
  const base = g.count;
  for (let v = 0; v < pa.count; v++) g.vertex(V(pa.getX(v), pa.getY(v) * 0.8, pa.getZ(v)), V(na.getX(v), na.getY(v), na.getZ(v)), [0, 0], { tip: 0, ao: 0.8 });
  const ix = body.getIndex();
  for (let q = 0; q < ix.count; q += 3) g.tri(base + ix.getX(q), base + ix.getX(q + 1), base + ix.getX(q + 2));
  body.dispose();
  for (let i = 0; i < 70; i++) {
    const d = randUnit(rng);
    if (d.y < -0.3) continue;
    const len = rng.range(0.12, 0.24);
    const p0 = d.clone().multiplyScalar(r * 0.9);
    g.tube([p0, p0.clone().addScaledVector(d, len)], [0.0018, 0.0003], 3, { capEnd: false, attr: (k, t) => ({ tip: 0.3 + t * 0.7, ao: 1 }) });
  }
  return g.build();
}

/** Small clump of coral lumps / encrusting heads: dense, cheap ground cover for the reef framework. */
export function coralClump(rng, { size = 0.35, fingers = 0 } = {}) {
  const g = new GeoBuilder();
  const base = smoothBase(new THREE.IcosahedronGeometry(1, 1));
  const pa = base.getAttribute('position');
  const ix = base.getIndex();
  const n = rng.int(3, 7);
  for (let k = 0; k < n; k++) {
    const r = size * rng.range(0.14, 0.38);
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, size * 0.45);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const sq = rng.range(0.45, 0.9);
    const s0 = rng.range(0, 99);
    const start = g.count;
    for (let v = 0; v < pa.count; v++) {
      const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v);
      const lump = 1 + noise.n3(x * 2.2 + s0, y * 2.2, z * 2.2) * 0.28;
      let yy = y * r * sq * lump;
      if (yy < 0) yy *= 0.2;
      const p = V(cx + x * r * lump, yy, cz + z * r * lump);
      g.vertex(p, V(x, y * 1.4, z).normalize(), [0, 0], { tip: Math.max(0, y), ao: 0.55 + 0.45 * Math.max(0, y) });
    }
    for (let q = 0; q < ix.count; q += 3) g.tri(start + ix.getX(q), start + ix.getX(q + 1), start + ix.getX(q + 2));
  }
  for (let f = 0; f < fingers; f++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, size * 0.4);
    const p0 = V(Math.cos(a) * d, size * 0.1, Math.sin(a) * d);
    const dir = V(rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)).normalize();
    const len = size * rng.range(0.25, 0.5);
    g.tube([p0, p0.clone().addScaledVector(dir, len)], [size * 0.045, size * 0.035], 4, { attr: (k2, t) => ({ tip: t, ao: 0.6 + 0.4 * t }) });
  }
  base.dispose();
  const geo = g.build();
  geo.computeVertexNormals();
  return geo;
}
