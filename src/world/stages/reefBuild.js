import * as THREE from 'three';
import { Heightfield, makeTerrainMaterial } from '../Terrain.js';
import { Scatter, jitterGrid } from '../Scatter.js';
import * as gen from '../reefGen.js';
import { makeOrganicMaterial, makeRockMaterial, makeFanNetMaterial } from '../../render/materials.js';
import { Noise, RNG, smoothstep, clamp } from '../noise.js';

const C = (hex) => new THREE.Color(hex);

/** Sunlight Reef layout: a reef flat in the north, spur-and-groove slope running south to ~30 m. */
export const REEF_BOUNDS = { x0: -130, z0: -150, sizeX: 260, sizeZ: 290 };

export const REEF_POI = {
  entry: new THREE.Vector3(0, -2, -30),
  sandPatch: new THREE.Vector3(6, -9.5, -12),
  cleaning: new THREE.Vector3(58, -17, 30),
  anemone: new THREE.Vector3(-22, -9.2, -42),
  ghostNet: new THREE.Vector3(-46, -15, 22),
  turtles: new THREE.Vector3(-12, -12, 5),
  edge: new THREE.Vector3(0, -29, 128),
};

export function makeReefHeight(seed = 7) {
  const n = new Noise(seed);
  const bommies = [
    { x: 58, z: 30, r: 11, h: 4.2 },   // manta cleaning station mound
    { x: 22, z: -40, r: 5, h: 2.4 }, { x: -30, z: -55, r: 6, h: 2.2 }, { x: -60, z: -10, r: 7, h: 2.8 },
    { x: 34, z: 66, r: 6, h: 3.0 }, { x: -18, z: 80, r: 5, h: 2.5 }, { x: 80, z: -30, r: 7, h: 2.0 },
    { x: -85, z: 50, r: 8, h: 3.2 }, { x: 10, z: 30, r: 4, h: 1.8 },
  ];
  const sandPatches = [{ x: 6, z: -12, r: 16 }, { x: -12, z: 8, r: 9 }, { x: 40, z: -8, r: 10 }];
  const spur = (x, z) => {
    const slopeMask = smoothstep(-75, -45, z) * (1 - smoothstep(118, 132, z));
    const meander = n.n2(z * 0.018, 3.1) * 7 + n.n2(z * 0.06, 9.7) * 1.5;
    const g = Math.sin(((x + meander) * Math.PI * 2) / 17);
    return smoothstep(-0.32, 0.18, g + n.n2(x * 0.11, z * 0.11) * 0.25) * slopeMask;
  };
  const sandAt = (x, z) => {
    let s = 0;
    for (const p of sandPatches) { const d = Math.hypot(x - p.x, z - p.z) / p.r; s = Math.max(s, 1 - smoothstep(0.55, 1.0, d)); }
    return s;
  };
  const bommieAt = (x, z) => {
    let b = 0;
    for (const p of bommies) {
      const d2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.r * p.r);
      if (d2 < 1) b = Math.max(b, p.h * Math.pow(1 - d2, 1.4) * (0.85 + 0.3 * n.n2(x * 0.3, z * 0.3)));
    }
    return b;
  };
  const height = (x, z) => {
    let y = -(5.6 + 22.8 * smoothstep(-72, 118, z) + 2.5 * smoothstep(112, 140, z));
    const sp = spur(x, z);
    const sand = sandAt(x, z);
    y += sp * (2.3 + 0.9 * n.n2(x * 0.07, z * 0.07)) * (1 - sand);
    y += sp * (n.fbm2(x * 0.45, z * 0.45, 3) * 0.55 + Math.abs(n.n2(x * 0.9, z * 0.9)) * 0.25) * (1 - sand);
    // fine framework roughness (knobs, ledges, holes) wherever the bottom is hard
    const rk = Math.max(sp, 1 - smoothstep(-80, -55, z) * 0.0) * (1 - sand);
    y += rk * sp * (Math.pow(Math.abs(n.n2(x * 1.7, z * 1.7)), 0.7) * 0.32 + n.n2(x * 3.1, z * 3.1) * 0.08);
    y += n.fbm2(x * 0.03, z * 0.03, 4) * 1.4;
    y += n.fbm2(x * 0.16, z * 0.16, 3) * 0.45 * (0.3 + sp) * (1 - sand * 0.8);
    y += bommieAt(x, z);
    // reef flat patch reefs
    const flat = 1 - smoothstep(-80, -55, z);
    y += flat * smoothstep(0.15, 0.55, n.fbm2(x * 0.05 + 5, z * 0.05, 3)) * 1.4;
    y -= sand * 0.35;
    return y;
  };
  const rockiness = (x, z) => {
    const sp = spur(x, z);
    const flat = 1 - smoothstep(-80, -55, z);
    const flatRock = flat * smoothstep(0.1, 0.4, n.fbm2(x * 0.05 + 5, z * 0.05, 3));
    let b = 0;
    for (const p of bommies) { const d = Math.hypot(x - p.x, z - p.z) / p.r; b = Math.max(b, 1 - smoothstep(0.7, 1.05, d)); }
    const r = Math.max(sp * (0.75 + 0.25 * n.n2(x * 0.2, z * 0.2)), flatRock, b);
    return clamp(r * (1 - sandAt(x, z)), 0, 1);
  };
  return { height, rockiness, spur, sandAt, bommies };
}

/**
 * Build the reef: terrain + coral dressing. Returns {group, hf, scatter, colliders}.
 */
export function buildReef(engine, { seed = 7, density = 1, area = null } = {}) {
  const lib = engine.lib;
  const rng = new RNG(seed * 31 + 5);
  const R = makeReefHeight(seed);
  const b = area || REEF_BOUNDS;
  const cell = engine.preset.terrainCell * 0.55;
  const hf = new Heightfield({
    x0: b.x0, z0: b.z0, sizeX: b.sizeX, sizeZ: b.sizeZ, cell,
    heightFn: R.height,
    maskFn: (x, z, h, slope) => {
      const r = R.rockiness(x, z);
      const rubble = clamp(smoothstep(0.1, 0.45, r) * (1 - r) * 2 + slope * 0.3, 0, 1) * 0.5;
      return [clamp(r + slope * 0.8, 0, 1), rubble, 0];
    },
  });
  const group = new THREE.Group();
  group.name = 'reef';
  const terrainMat = makeTerrainMaterial(lib, { soft: 'sand', hard: 'reef', scaleB: 1 / 3.4, tintB: [1.05, 1.0, 1.0], tintC: [0.82, 0.78, 0.7] });
  group.add(hf.buildMesh(terrainMat, { chunks: 16 }));

  // --- materials (shared per type) ---
  const M = {
    branch: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.12, tipColor: [1.6, 1.6, 1.7], tipAmount: 0.6, roughness: 0.7, wrap: 0.25, key: 'branch' }),
    massive: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.22, detailStrength: 0.45, roughness: 0.8, wrap: 0.2, macro: 'rock', macroScale: 1 / 0.7, macroStrength: 0.9, mottle: 0.35, key: 'massive' }),
    brain: makeOrganicMaterial(lib, { detail: 'brain', detailScale: 1 / 0.35, detailStrength: 0.5, normalStrength: 1, roughness: 0.75, wrap: 0.25, key: 'brain' }),
    table: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.05, detailStrength: 0.6, normalStrength: 1.0, tipColor: [1.3, 1.3, 1.25], tipAmount: 0.5, roughness: 0.75, wrap: 0.3, macro: 'rock', macroScale: 1 / 0.45, macroStrength: 1.0, mottle: 0.4, key: 'table' }),
    plate: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.14, tipColor: [1.25, 1.25, 1.1], tipAmount: 0.6, roughness: 0.75, wrap: 0.3, key: 'plate' }),
    leather: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.05, detailStrength: 0.25, normalStrength: 0.5, sway: true, swayAmp: 0.05, roughness: 0.85, wrap: 0.5, translucent: 0.15, key: 'leather' }),
    soft: makeOrganicMaterial(lib, { detail: null, tipColor: [1.25, 1.15, 1.15], tipAmount: 0.8, sway: true, swayAmp: 0.09, roughness: 0.6, wrap: 0.6, translucent: 0.45, key: 'soft' }),
    fan: makeOrganicMaterial(lib, { detail: null, sway: true, swayAmp: 0.12, roughness: 0.8, wrap: 0.6, translucent: 0.3, key: 'fan' }),
    sponge: makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.07, detailStrength: 0.35, roughness: 0.85, wrap: 0.3, tipColor: [0.6, 0.55, 0.55], tipAmount: 0.3, key: 'sponge' }),
    rock: makeRockMaterial(lib, { tex: 'rock' }),
    rubble: makeRockMaterial(lib, { tex: 'rock', scale: 1 / 0.5, key: 'rubble' }),
    urchin: makeOrganicMaterial(lib, { detail: null, roughness: 0.35, tipColor: [0.5, 0.5, 0.6], tipAmount: 0.4, key: 'urchin' }),
    fanNet: makeFanNetMaterial(lib),
  };

  // --- geometry variants ---
  const V = (fn, n, opts) => Array.from({ length: n }, (_, i) => fn(new RNG(seed * 100 + i * 7 + 1), opts(i)));
  const G = {
    branch: V(gen.branchingCoral, 3, (i) => ({ size: 0.75 + i * 0.2 })),
    bush: V(gen.branchingCoral, 2, () => ({ size: 0.45, stubby: 0.7 })),
    digitate: V(gen.digitateCoral, 3, (i) => ({ size: 0.4 + i * 0.15 })),
    massive: V(gen.massiveCoral, 4, () => ({ radius: 1 })),
    brain: V(gen.brainCoral, 2, () => ({ radius: 1 })),
    table: V(gen.tableCoral, 3, (i) => ({ radius: 0.7 + i * 0.25 })),
    plate: V(gen.plateCoral, 3, () => ({ size: 0.7 })),
    leather: V(gen.leatherCoral, 3, () => ({ size: 0.35 })),
    soft: V(gen.treeSoftCoral, 3, () => ({ size: 0.45 })),
    fan: V(gen.seaFan, 3, (i) => ({ width: 1.8 + i * 0.4, height: 1.4 + i * 0.3 })),
    barrel: V(gen.barrelSponge, 2, () => ({ height: 0.9 })),
    tubes: V(gen.tubeSponges, 2, () => ({ size: 0.4 })),
    rock: V(gen.rock, 4, () => ({ size: 1, flat: 0.6 })),
    rubble: V(gen.rubble, 4, () => ({})),
    urchin: V(gen.urchin, 1, () => ({})),
    clump: V(gen.coralClump, 6, (i) => ({ size: 0.3 + (i % 3) * 0.12, fingers: i >= 3 ? 6 : 0 })),
  };

  const palettes = {
    branch: ['#a88a62', '#b89a72', '#8c9a62', '#c2a47e', '#a27f70', '#9a8a60'],
    bush: ['#c08a80', '#c8a090', '#b08a68', '#a8946a'],
    digitate: ['#b09a70', '#a0aa78', '#c0a888', '#9a8c6a'],
    fanNet: ['#d0582c'],
    massive: ['#c0a670', '#ae9464', '#cdb27a', '#a08a60', '#9a8090', '#bca068'],
    brain: ['#b0ae6a', '#c09c62', '#a49058'],
    table: ['#9a9468', '#a88a62', '#b0a07a', '#8e9a74'],
    plate: ['#b8b46c', '#a88a5a', '#c0a462'],
    leather: ['#ddd0a8', '#c8b890', '#c4c48c', '#d0c0a0'],
    soft: ['#e07aa8', '#d04858', '#a868b8', '#ec8860', '#f0c8d8'],
    fan: ['#c83a1c', '#b8301c', '#d04a20', '#a8341e'],
    barrel: ['#c08a78', '#b07a68', '#c89a84'],
    tubes: ['#9a64c0', '#dcb440', '#6a8ac8', '#c06e98'],
    rock: ['#f2ece0', '#e6e0d2', '#fff8ec'],
    rubble: ['#f0e8d8', '#e0d8c8', '#f8f0e0'],
    urchin: ['#1a1a20'],
    clump: ['#c0a670', '#ae9464', '#9a8090', '#b06878', '#8c9a62', '#cdb27a', '#7a6a5a', '#a07c9a', '#b8b46c', '#8a7a60'],
  };
  const col = (type) => {
    const p = palettes[type];
    const c = C(rng.pick(p));
    const hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h + rng.range(-0.02, 0.02), hsl.s * rng.range(0.85, 1.1), hsl.l * rng.range(0.85, 1.12));
    return c;
  };

  const sc = new Scatter({ cell: 40 });
  const nrm = new THREE.Vector3();
  const D = density * engine.preset.dressDensity;
  const RANGE = { rubble: 22, urchin: 24, digitate: 45, bush: 45, tubes: 40, leather: 45, soft: 40, rock: 70, clump: 42 };
  const place = (type, x, z, { scale = 1, align = 0.4, sink = 0.05, collide = 0, yaw, tilt, mat, colorType, tag } = {}) => {
    const y = hf.height(x, z) - sink * scale;
    hf.normal(x, z, nrm);
    const variants = G[type];
    const vi = rng.int(0, variants.length - 1);
    const key = type + vi;
    const tr = { pos: new THREE.Vector3(x, y, z), normal: nrm.clone(), align, scale, yaw: yaw ?? rng.range(0, Math.PI * 2), tilt, color: col(colorType || type) };
    const cast = engine.preset.shadows && !['rubble', 'urchin', 'clump'].includes(type);
    sc.add(key, variants[vi], mat || M[type === 'bush' || type === 'digitate' ? 'branch' : type === 'barrel' || type === 'tubes' ? 'sponge' : type], tr, { collide, tag, maxDist: RANGE[type] ?? null, castShadow: cast });
    const memb = variants[vi].userData.membrane;
    if (memb) sc.add(key + 'net', memb, M.fanNet, { ...tr, color: tr.color.clone().multiplyScalar(0.92) });
  };

  // --- placement ---
  const pts = jitterGrid(rng, b.x0 + 2, b.z0 + 2, b.x0 + b.sizeX - 2, b.z0 + b.sizeZ - 2, 1.05, (x, z) => Math.pow(R.rockiness(x, z), 0.7) * 0.95 * D);
  for (const [x, z] of pts) {
    const depth = -hf.height(x, z);
    const r = rng.next();
    if (r < 0.26) place('massive', x, z, { scale: rng.range(0.22, 0.75) * (rng.chance(0.06) ? 2.2 : 1), align: 0.25, sink: 0.15, collide: 0.9 });
    else if (r < 0.46) place('branch', x, z, { scale: rng.range(0.6, 1.3), align: 0.3, collide: 0.4 });
    else if (r < 0.52) place('bush', x, z, { scale: rng.range(0.6, 1.1), align: 0.3, colorType: 'bush', collide: 0.25 });
    else if (r < 0.58) place('digitate', x, z, { scale: rng.range(0.7, 1.4), align: 0.5, colorType: 'digitate', collide: 0.3 });
    else if (r < 0.605 && depth < 22) place('table', x, z, { scale: rng.range(0.45, 1.1), align: 0.15, sink: 0.02, collide: 0.8 });
    else if (r < 0.69) place('plate', x, z, { scale: rng.range(0.6, 1.4), align: 0.5, collide: 0.4 });
    else if (r < 0.75) place('brain', x, z, { scale: rng.range(0.3, 0.7), align: 0.3, sink: 0.1, collide: 0.8 });
    else if (r < 0.82) place('leather', x, z, { scale: rng.range(0.7, 1.6), align: 0.4, collide: 0.3 });
    else if (r < 0.86) place('soft', x, z, { scale: rng.range(0.6, 1.2), align: 0.3 });
    else if (r < 0.89) place('barrel', x, z, { scale: rng.range(0.5, 1.2), align: 0.3, sink: 0.05, collide: 0.45 });
    else if (r < 0.92) place('tubes', x, z, { scale: rng.range(0.7, 1.3), align: 0.4 });
    else if (r < 0.95) place('rock', x, z, { scale: rng.range(0.3, 0.9), align: 0.6, sink: 0.25, collide: 0.8 });
    else if (r < 0.97 && depth > 16) place('fan', x, z, { scale: rng.range(0.6, 1.1), align: 0.0, sink: 0.02, yaw: Math.atan2(engine.env.surgeDir.x, engine.env.surgeDir.y) + rng.range(-0.3, 0.3), tag: 'seafan' });
    else place('urchin', x, z, { scale: rng.range(0.8, 1.2), align: 0.8, sink: 0.01 });
  }
  // dense ground cover on the framework
  const cover = jitterGrid(rng, b.x0 + 1, b.z0 + 1, b.x0 + b.sizeX - 1, b.z0 + b.sizeZ - 1, 0.62, (x, z) => Math.pow(R.rockiness(x, z), 1.4) * 0.9 * D);
  for (const [x, z] of cover) place('clump', x, z, { scale: rng.range(0.6, 1.5), align: 0.7, sink: 0.05, mat: M.massive, colorType: 'clump' });

  // rubble & small rocks on sand
  const rub = jitterGrid(rng, b.x0, b.z0, b.x0 + b.sizeX, b.z0 + b.sizeZ, 1.1, (x, z) => (0.15 + R.rockiness(x, z) * 0.5) * (1 - R.rockiness(x, z) * 0.7) * D * 0.8);
  for (const [x, z] of rub) place('rubble', x, z, { scale: rng.range(0.7, 1.5), align: 0.8, sink: 0.004 });
  const stones = jitterGrid(rng, b.x0, b.z0, b.x0 + b.sizeX, b.z0 + b.sizeZ, 7, () => 0.35 * D);
  for (const [x, z] of stones) place('rock', x, z, { scale: rng.range(0.15, 0.5), align: 0.7, sink: 0.12 });

  // Anemones at known spots (anemonefish homes)
  const anemones = [];
  const anemGeo = gen.anemone(new RNG(seed + 900), { radius: 0.28 });
  const tent = C('#b8b060');
  const anemMat = makeOrganicMaterial(lib, { detail: null, tipColor: [tent.r, tent.g, tent.b], tipAmount: 1, tipReplace: true, sway: true, swayAmp: 0.08, roughness: 0.5, wrap: 0.6, translucent: 0.4, key: 'anemone2' });
  const anemSpots = [REEF_POI.anemone, new THREE.Vector3(-14, 0, -48), new THREE.Vector3(30, 0, -50), new THREE.Vector3(-70, 0, -20)];
  for (const p of anemSpots) {
    const y = hf.height(p.x, p.z);
    const pos = new THREE.Vector3(p.x, y - 0.03, p.z);
    hf.normal(p.x, p.z, nrm);
    sc.add('anemone', anemGeo, anemMat, { pos, normal: nrm.clone(), align: 0.6, scale: rng.range(0.9, 1.3), color: C(rng.pick(['#b8183a', '#7a2a7a', '#c03050'])) }, { tag: 'anemone' });
    anemones.push(pos);
  }

  group.add(sc.build());
  console.log('[reef] dressing', JSON.stringify(sc.stats));
  return { group, hf, scatter: sc, reef: R, anemones, materials: M };
}
