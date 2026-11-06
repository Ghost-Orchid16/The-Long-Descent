import * as THREE from 'three';
import { Heightfield, buildSheet, makeTerrainMaterial } from '../Terrain.js';
import { Scatter, jitterGrid } from '../Scatter.js';
import { GeoBuilder } from '../GeoBuilder.js';
import { buildReef, makeReefKit } from './reefBuild.js';
import { buildWreck } from '../wreck.js';
import { Noise, RNG, smoothstep, clamp } from '../noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Deep wall layout: reef top to z ≈ 127, wall face facing +z from -31.6 m down past 170 m, a ledge at ~50 m. */
export const WALL = { x0: -100, x1: 100, topY: -30.6, lipY: -31.6, bottomY: -178 };

export function makeWallShape(seed = 11) {
  const n = new Noise(seed);
  const faceZ = (x, y) => {
    const d = Math.max(0, WALL.lipY - y);
    const k = smoothstep(0, 3, d);
    const butt = Math.pow(Math.abs(Math.sin(((x + 7 + n.n2(y * 0.02, x * 0.01) * 6) * Math.PI) / 23)), 0.7) * 1.9;
    let z = 130.5 + n.n2(x * 0.015, 2.1) * 3.0 + butt;
    // slight undercut with depth, terraces where fans and sponges gather
    z += -0.025 * d + k * (1.4 * Math.exp(-((y + 37.5) ** 2) / 3) * (0.5 + 0.5 * n.n2(x * 0.05, 4.4)) + 1.1 * Math.exp(-((y + 66) ** 2) / 5));
    // caves and crevices
    z -= k * Math.pow(Math.max(0, n.n2(x * 0.09, y * 0.12 + 3.0) - 0.45), 1.5) * 4.5;
    z += k * (n.fbm2(x * 0.22, y * 0.22, 4) * 1.15 + n.fbm2(x * 0.8, y * 0.8, 2) * 0.22);
    return z;
  };
  const faceTop = (x) => faceZ(x, WALL.lipY);
  // ledge with the wreck (~49–56 m), falling away on three sides
  const ledgeY = (x, z) => {
    const zE = 178 + n.n2(x * 0.03, 8.1) * 5;
    const xL = -46 + n.n2(z * 0.05, 3.3) * 4, xR = 66 + n.n2(z * 0.05, 5.5) * 4;
    let y = -49.0 - (z - 132) * 0.11 + n.fbm2(x * 0.06, z * 0.06, 3) * 0.9 + Math.abs(n.n2(x * 0.35, z * 0.35)) * 0.25;
    // boulders and rubble mounds fallen from the wall
    y += Math.pow(Math.max(0, n.n2(x * 0.12 + 9, z * 0.12)), 2) * 2.4 * (1 - smoothstep(140, 160, z));
    const out = Math.max(z - zE, xL - x, x - xR);
    if (out > 0) y -= out * out * 0.35 + out * 1.2;
    return Math.max(y, WALL.bottomY + 2);
  };
  const ledgeHard = (x, z) => clamp(smoothstep(0.1, 0.6, n.n2(x * 0.08 + 2, z * 0.08)) + (1 - smoothstep(134, 146, z)) * 0.7, 0, 1);
  return { faceZ, faceTop, ledgeY, ledgeHard, noise: n };
}

/** Thin spiral wire coral (Cirrhipathes-like) as a swaying tube. */
function whipCoral(rng, { length = 1.8 } = {}) {
  const g = new GeoBuilder();
  const pts = [], radii = [];
  const n = 22, turns = rng.range(1.2, 2.6), r0 = rng.range(0.02, 0.06);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(V(Math.cos(a) * r0 * t, t * length, Math.sin(a) * r0 * t + t * t * length * 0.18));
    radii.push(0.008 * (1 - t * 0.7));
  }
  g.tube(pts, radii, 5, { attr: (i, t) => ({ tip: t, sway: t }) });
  return g.build();
}

export function buildWall(engine, { seed = 11 } = {}) {
  const lib = engine.lib;
  const rng = new RNG(seed * 17 + 3);
  const S = makeWallShape(seed);
  const group = new THREE.Group();
  group.name = 'wall';
  const kit = makeReefKit(engine, seed);

  // ---- reef top along the edge (shares the Sunlight Reef's height field and dressing)
  const top = buildReef(engine, {
    seed: 7, kit, anemones: false,
    area: { x0: -95, z0: 70, sizeX: 190, sizeZ: 57 },
    heightMod: (x, z, h) => {
      const k = smoothstep(110, 121, z);
      const g = WALL.topY + 0.5 - (z - 114) * 0.05;
      return h * (1 - k) + (g + (h - g) * 0.2) * k;
    },
    placeMask: (x, z) => 1 - smoothstep(120, 124, z),
  });
  group.add(top.group);

  // ---- wall face sheet: tongue under the reef edge → rounded lip → face (u runs -x so normals face +z)
  const vTongue = 0.03, vLip = 0.06, vUpper = 0.82;
  const posFn = (u, v) => {
    const x = u;
    const f0 = S.faceTop(x);
    const nz = S.noise;
    if (v < vTongue) {
      const s = v / vTongue;
      const z = THREE.MathUtils.lerp(Math.min(f0 - 7, 121), f0 - 1, s);
      const rough = nz.fbm2(x * 0.35, z * 0.35, 3) * 0.28 + Math.abs(nz.n2(x * 1.1, z * 1.1)) * 0.12;
      return { x, y: WALL.topY + rough * smoothstep(122, 125, z), z, off: rough };
    }
    if (v < vLip) {
      const th = ((v - vTongue) / (vLip - vTongue)) * (Math.PI / 2);
      const r = 1 + nz.fbm2(x * 0.3, th * 2.0 + 7.0, 3) * 0.35;
      const rough = nz.fbm2(x * 0.5, th * 3.0, 2) * 0.15;
      return { x, y: WALL.topY - (1 - Math.cos(th)) * r + rough, z: f0 - 1 + Math.sin(th) * r + rough, off: rough };
    }
    let y;
    if (v < vUpper) y = WALL.lipY - ((v - vLip) / (vUpper - vLip)) * (75 + WALL.lipY);
    else y = -75 - ((v - vUpper) / (1 - vUpper)) * (WALL.bottomY + 75) * -1;
    const z = S.faceZ(x, y);
    return { x, y, z, off: z - (130.5 + S.noise.n2(x * 0.015, 2.1) * 3.0) };
  };
  const wallMat = makeTerrainMaterial(lib, { soft: 'sand', hard: 'reef', scaleB: 1 / 3.0, tintB: [0.92, 0.9, 0.92], tintC: [0.72, 0.68, 0.64], key: 'wall' });
  const sheet = buildSheet({
    u0: WALL.x1, u1: WALL.x0, v0: 0, v1: 1, resU: Math.round(400 * engine.preset.terrainCell ** -0.5), resV: 230,
    posFn,
    maskFn: (x, y, z, ny) => [y > WALL.lipY - 0.5 ? 1 : clamp(1 - smoothstep(0.55, 0.85, ny) * 0.8, 0, 1), smoothstep(-40, -70, y) * 0.6, 0],
    material: wallMat, chunksU: 10, chunksV: 4,
  });
  group.add(sheet);

  // ---- ledge
  const ledge = new Heightfield({
    x0: -62, z0: 112, sizeX: 142, sizeZ: 100, cell: engine.preset.terrainCell * 0.6,
    heightFn: S.ledgeY,
    maskFn: (x, z, h, slope) => [clamp(S.ledgeHard(x, z) * 0.8 + slope * 0.9, 0, 1), clamp(0.35 + slope * 0.5, 0, 1), 0],
  });
  const ledgeMat = makeTerrainMaterial(lib, { soft: 'sand', hard: 'rock', scaleA: 1 / 2.2, tintA: [0.88, 0.86, 0.82], tintB: [0.8, 0.78, 0.76], tintC: [0.7, 0.66, 0.6], key: 'ledge' });
  group.add(ledge.buildMesh(ledgeMat, { chunks: 10 }));

  // ---- the wreck, listing towards the drop-off
  const wreck = buildWreck(engine, {});
  const wx = 10, wz = 157;
  const keelY = Math.min(S.ledgeY(wx - 20, wz), S.ledgeY(wx, wz), S.ledgeY(wx + 20, wz));
  wreck.group.position.set(wx, keelY - 0.55, wz);
  wreck.group.rotation.set(0.32, 0.07, 0.025, 'YXZ');
  wreck.group.updateMatrixWorld(true);
  group.add(wreck.group);
  const wM = wreck.group.matrixWorld;

  // ---- dressing: wall face, lip, ledge, wreck growth
  const { M, G, col } = kit;
  kit.palettes.whip = ['#d8c040', '#c8a030', '#7a8a3a', '#e0d8c0', '#4a4a3a'];
  G.whip = Array.from({ length: 3 }, (_, i) => whipCoral(new RNG(seed + 70 + i), { length: 1.4 + i * 0.5 }));
  const sc = new Scatter({ cell: 30 });
  const D = engine.preset.dressDensity;
  const fanSpots = [];
  const put = (type, pos, normal, { align = 0.5, scale = 1, yaw, mat, colorType, tag, collide = 0, maxDist = 60 } = {}) => {
    const variants = G[type];
    const vi = rng.int(0, variants.length - 1);
    const key = type + vi;
    const tr = { pos, normal, align, scale, yaw: yaw ?? rng.range(0, Math.PI * 2), color: col(colorType || type) };
    sc.add(key, variants[vi], mat || M[type === 'bush' || type === 'digitate' ? 'branch' : type === 'barrel' || type === 'tubes' ? 'sponge' : type === 'whip' ? 'soft' : type], tr, { collide, tag, maxDist });
    const memb = variants[vi].userData.membrane;
    if (memb) sc.add(key + 'net', memb, M.fanNet, { ...tr, color: tr.color.clone().multiplyScalar(0.92) });
  };
  const faceNormal = (x, y, out) => {
    const e = 0.3;
    const dzdx = (S.faceZ(x + e, y) - S.faceZ(x - e, y)) / (2 * e);
    const dzdy = (S.faceZ(x, y + e) - S.faceZ(x, y - e)) / (2 * e);
    return out.set(-dzdx, -dzdy, 1).normalize();
  };
  const nrm = new THREE.Vector3();
  // face: density falls with depth (less light), fans and whips take over below ~35 m
  for (let x = WALL.x0 + 2; x < WALL.x1 - 2; x += 0.9) {
    for (let y = WALL.lipY - 0.6; y > -72; y -= 0.9) {
      const xx = x + rng.range(-0.4, 0.4), yy = y + rng.range(-0.4, 0.4);
      const depth = -yy;
      const dens = (0.55 * (1 - smoothstep(32, 70, depth)) + 0.18) * D;
      if (rng.next() > dens) continue;
      faceNormal(xx, yy, nrm);
      if (nrm.y < -0.55) continue; // skip ceilings of overhangs
      const p = V(xx, yy, S.faceZ(xx, yy) - 0.05);
      const r = rng.next();
      const shelf = nrm.y > 0.45;
      if (depth < 40 && r < 0.22) put('plate', p, nrm.clone(), { align: 0.75, scale: rng.range(0.6, 1.3) });
      else if (r < 0.3 && depth > 33) { put('fan', p.addScaledVector(nrm, 0.15), nrm.clone(), { align: 0.12, scale: rng.range(0.7, 1.5), yaw: Math.atan2(nrm.x, nrm.z), tag: 'seafan' }); fanSpots.push(p.clone()); }
      else if (r < 0.42) put('whip', p, nrm.clone(), { align: 0.55, scale: rng.range(0.7, 1.3) });
      else if (r < 0.52) put(shelf ? 'barrel' : 'tubes', p, nrm.clone(), { align: shelf ? 0.3 : 0.7, scale: rng.range(0.5, 1.0) });
      else if (r < 0.62) put('soft', p, nrm.clone(), { align: 0.6, scale: rng.range(0.5, 1.0) });
      else if (r < 0.7 && depth < 45) put('bush', p, nrm.clone(), { align: 0.7, scale: rng.range(0.5, 0.9), colorType: 'bush' });
      else put('clump', p, nrm.clone(), { align: 0.85, scale: rng.range(0.6, 1.5), mat: M.massive, colorType: 'clump', maxDist: 40 });
    }
  }
  // the rim of the drop-off: coral heads, plates, sponges and fans crowd the lip where the current runs
  for (let x = WALL.x0 + 3; x < WALL.x1 - 3; x += 1.25) {
    const f0 = S.faceTop(x);
    for (let z = 121.5; z < f0 - 0.7; z += 1.3) {
      if (rng.next() > 0.7 * D) continue;
      const xx = x + rng.range(-0.5, 0.5), zz = Math.min(f0 - 0.6, z + rng.range(-0.5, 0.5));
      const p = V(xx, WALL.topY - 0.04, zz);
      const up = V(0, 1, 0);
      const edge = zz > f0 - 2.2;
      const r = rng.next();
      if (r < 0.2) put('massive', p.setY(p.y - 0.12), up, { align: 0.25, scale: rng.range(0.3, 0.8), collide: 0.9 });
      else if (r < 0.34) put('plate', p, up, { align: 0.4, scale: rng.range(0.6, 1.3), collide: 0.4 });
      else if (r < 0.44 && edge) put('fan', p, up, { align: 0.0, scale: rng.range(0.6, 1.2), yaw: rng.range(-0.25, 0.25), tag: 'seafan' });
      else if (r < 0.54) put('barrel', p, up, { align: 0.3, scale: rng.range(0.5, 1.1), collide: 0.45 });
      else if (r < 0.64) put('soft', p, up, { align: 0.3, scale: rng.range(0.5, 1.0) });
      else if (r < 0.74) put('branch', p, up, { align: 0.3, scale: rng.range(0.6, 1.1), collide: 0.4 });
      else if (r < 0.82) put('rock', p.setY(p.y - 0.2), up, { align: 0.5, scale: rng.range(0.3, 0.8), collide: 0.8 });
      else put('clump', p, up, { align: 0.7, scale: rng.range(0.6, 1.5), mat: M.massive, colorType: 'clump', maxDist: 40 });
    }
  }
  // the giant red fan near the descent route at ~40 m (torch moment)
  const bigFan = { x: 16, y: -40.2 };
  faceNormal(bigFan.x, bigFan.y, nrm);
  const bigPos = V(bigFan.x, bigFan.y, S.faceZ(bigFan.x, bigFan.y) + 0.35);
  put('fan', bigPos.clone(), nrm.clone(), { align: 0.08, scale: 2.3, yaw: Math.atan2(nrm.x, nrm.z), tag: 'seafan' });
  // ledge: rubble, rocks, sponges, fans, black coral, whips
  const lp = jitterGrid(rng, -58, 128, 76, 205, 1.3, (x, z) => (S.ledgeY(x, z) > -62 ? 0.75 : 0) * D);
  for (const [x, z] of lp) {
    const y = S.ledgeY(x, z);
    if (z < S.faceZ(x, y) + 0.4) continue;
    ledge.normal(x, z, nrm);
    const p = V(x, ledge.height(x, z) - 0.04, z);
    const hard = S.ledgeHard(x, z);
    const r = rng.next();
    if (r < 0.32) put('rubble', p, nrm.clone(), { align: 0.8, scale: rng.range(0.7, 1.6), maxDist: 26 });
    else if (r < 0.44) put('rock', p.setY(p.y - 0.12), nrm.clone(), { align: 0.6, scale: rng.range(0.25, 0.8), collide: 0.8 });
    else if (r < 0.52 && hard > 0.3) put('barrel', p, nrm.clone(), { align: 0.3, scale: rng.range(0.6, 1.3), collide: 0.45 });
    else if (r < 0.6 && hard > 0.2) { put('fan', p, nrm.clone(), { align: 0.0, scale: rng.range(0.7, 1.5), yaw: rng.range(-0.3, 0.3), tag: 'seafan' }); }
    else if (r < 0.68) put('whip', p, nrm.clone(), { align: 0.2, scale: rng.range(0.6, 1.2) });
    else if (r < 0.74 && hard > 0.3) put('bush', p, nrm.clone(), { align: 0.3, scale: rng.range(0.6, 1.2), colorType: 'bush' });
    else if (r < 0.8) put('tubes', p, nrm.clone(), { align: 0.5, scale: rng.range(0.6, 1.1) });
    else if (hard > 0.25) put('clump', p, nrm.clone(), { align: 0.7, scale: rng.range(0.6, 1.4), mat: M.massive, colorType: 'clump', maxDist: 36 });
  }
  // growth on the wreck: sponges, soft corals, small fans and crusts along its decks
  for (const lp0 of wreck.anchors.deckPoints) {
    const p = lp0.clone().applyMatrix4(wM);
    const n0 = V(0, 1, 0).transformDirection(wM);
    const r = rng.next();
    if (r < 0.28) put('soft', p, n0, { align: 0.7, scale: rng.range(0.4, 0.8) });
    else if (r < 0.48) put('tubes', p, n0, { align: 0.7, scale: rng.range(0.5, 0.9) });
    else if (r < 0.62) put('fan', p, n0, { align: 0.5, scale: rng.range(0.4, 0.8), tag: 'seafan' });
    else if (r < 0.75) put('whip', p, n0, { align: 0.6, scale: rng.range(0.5, 0.9) });
    else put('clump', p, n0, { align: 0.9, scale: rng.range(0.6, 1.2), mat: M.massive, colorType: 'clump', maxDist: 34 });
  }
  group.add(sc.build());
  console.log('[wall] dressing', JSON.stringify(sc.stats));

  // ---- collision-only height field for the tongue/lip (the reef height field ends at z = 127)
  const lipHF = new Heightfield({
    x0: -100, z0: 118, sizeX: 200, sizeZ: 22, cell: 0.5,
    heightFn: (x, z) => {
      const f0 = S.faceTop(x);
      if (z < f0 - 1) return WALL.topY;
      if (z < f0) { const s = (z - (f0 - 1)); return WALL.topY - (1 - Math.sqrt(Math.max(0, 1 - s * s))); }
      return -1000;
    },
    maskFn: () => [0, 0, 0],
  });

  const p = (x, z, up = 0) => V(x, S.ledgeY(x, z) + up, z);
  const recorderW = wreck.anchors.recorder.clone().applyMatrix4(wreck.recorder.parent.matrixWorld);
  const bowLineW = wreck.anchors.bowLine.clone().applyMatrix4(wM);
  return {
    group, shape: S, reefTop: top, ledge, lipHF, wreck, scatter: sc, bigFan: bigPos, fanSpots,
    poi: {
      start: V(12, -27.5, 112),
      fan: bigPos,
      sharkZone: V(28, -42, 142),
      vortex: V(-24, -37, 150),
      wreck: V(wx, keelY + 4, wz),
      recorder: recorderW,
      bowLine: bowLineW,
      ledge: p(10, 168, 1.5),
    },
    sheetCollider: { fn: (x, y) => S.faceZ(x, Math.min(y, WALL.lipY)), axis: 'z', side: 1, uMin: WALL.x0, uMax: WALL.x1, yMax: WALL.lipY },
  };
}
