import * as THREE from 'three';
import { Heightfield, makeTerrainMaterial } from '../Terrain.js';
import { Scatter, jitterGrid } from '../Scatter.js';
import { GeoBuilder } from '../GeoBuilder.js';
import { makeReefKit } from './reefBuild.js';
import { makeRockMaterial } from '../../render/materials.js';
import { Noise, RNG, smoothstep, clamp } from '../noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Irregular hydrothermal chimney (sulphide spire with flanges) as a lathe with noise. */
function chimneyGeo(rng, { height = 10, base = 1.6, white = false } = {}) {
  const g = new GeoBuilder();
  const prof = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let r = THREE.MathUtils.lerp(base, base * (white ? 0.25 : 0.18), Math.pow(t, 0.55));
    if (!white && (i === 9 || i === 16)) r *= 1.75; // flanges where hot fluid pools beneath
    prof.push([r, t * height]);
  }
  const nz = new Noise(rng.int(1, 9999));
  g.lathe(prof, 18, {
    noise: (a, y, t) => 1 + nz.n2(Math.cos(a) * 1.5 + y * 0.4, Math.sin(a) * 1.5 + y * 0.3) * 0.28 + (t > 0.95 ? -0.2 : 0),
    attr: (t) => ({ tip: t, ao: 0.55 + 0.45 * t }),
  });
  return g.build();
}

/** Area A (~1,560–1,650 m): a volcano flank with a liquid-CO2 seep, white chimneys and mussel beds. */
export function buildSeep(engine, { seed = 71 } = {}) {
  const lib = engine.lib, rng = new RNG(seed), n = new Noise(seed);
  const seepC = V(4, 0, 34);
  const height = (x, z) => {
    let y = -30 - Math.max(0, z + 40) * 0.38 + n.fbm2(x * 0.025, z * 0.025, 4) * 9 + Math.abs(n.n2(x * 0.11, z * 0.11)) * 2.6;
    y += Math.pow(Math.max(0, n.n2(x * 0.05 + 3, z * 0.05)), 2) * 9;
    const d = Math.hypot(x - seepC.x, z - seepC.z);
    y = THREE.MathUtils.lerp(y, -50 + n.n2(x * 0.3, z * 0.3) * 0.4, (1 - smoothstep(10, 26, d)) * 0.8); // sediment-filled basin of the seep
    return y;
  };
  seepC.y = height(seepC.x, seepC.z);
  const hf = new Heightfield({
    x0: -120, z0: -120, sizeX: 240, sizeZ: 240, cell: engine.preset.terrainCell,
    heightFn: height,
    maskFn: (x, z, h, slope) => {
      const d = Math.hypot(x - seepC.x, z - seepC.z);
      return [clamp(slope * 1.8 + n.n2(x * 0.06, z * 0.06) * 0.4 - (1 - smoothstep(8, 22, d)) * 0.9, 0, 1), clamp(1 - smoothstep(4, 16, d), 0, 1) * 0.9, 0];
    },
  });
  const group = new THREE.Group();
  group.add(hf.buildMesh(makeTerrainMaterial(lib, { soft: 'ooze', hard: 'basalt', tintA: [0.95, 0.93, 0.86], tintB: [0.55, 0.53, 0.52], tintC: [1.25, 1.2, 1.05], key: 'seep' }), { chunks: 8 }));
  // small white chimneys and the droplet sources around them
  const white = makeRockMaterial(lib, { tex: 'basalt', key: 'whitechim' });
  white.color.setRGB(1.7, 1.62, 1.48);
  const chimneys = [], sources = [];
  for (const [dx, dz, h] of [[0, 0, 1.8], [3.2, 1.6, 1.2], [-2.5, 2.4, 1.0]]) {
    const p = V(seepC.x + dx, 0, seepC.z + dz); p.y = height(p.x, p.z) - 0.1;
    const m = new THREE.Mesh(chimneyGeo(rng, { height: h, base: 0.32, white: true }), white);
    m.position.copy(p);
    group.add(m);
    chimneys.push({ base: p.clone(), top: p.clone().add(V(0, h, 0)) });
    sources.push(p.clone().add(V(0, h, 0)));
  }
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(1.5, 6);
    const p = V(seepC.x + Math.cos(a) * r, 0, seepC.z + Math.sin(a) * r); p.y = height(p.x, p.z) + 0.02;
    sources.push(p);
  }
  // mussel bed points around the seep (spawned by the stage as sessile creatures)
  const mussels = [];
  for (let i = 0; i < 160; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 7.5 + 1.2;
    const p = V(seepC.x + Math.cos(a) * r, 0, seepC.z + Math.sin(a) * r);
    mussels.push({ p, yaw: rng.range(0, 6.28), scale: rng.range(0.75, 1.3) });
  }
  // sparse rocks and sponges on the flank
  const kit = makeReefKit(engine, seed);
  kit.palettes.barrel = ['#d8cbb0', '#c8b8a0'];
  const sc = new Scatter({ cell: 40 });
  const nrm = new THREE.Vector3();
  for (const [x, z] of jitterGrid(rng, -115, -115, 115, 115, 2.6, () => 0.5 * engine.preset.dressDensity)) {
    if (Math.hypot(x - seepC.x, z - seepC.z) < 12) continue;
    hf.normal(x, z, nrm);
    const r = rng.next();
    const type = r < 0.55 ? 'rock' : r < 0.7 ? 'barrel' : r < 0.8 ? 'fan' : 'rubble';
    const variants = kit.G[type], vi = rng.int(0, variants.length - 1);
    const scale = type === 'rock' ? rng.range(0.4, 1.8) : rng.range(0.6, 1.2);
    sc.add(type + vi, variants[vi], kit.M[type === 'barrel' ? 'sponge' : type], { pos: V(x, hf.height(x, z) - (type === 'rock' ? 0.25 * scale : 0.03), z), normal: nrm.clone(), align: 0.5, scale, color: kit.col(type) }, { collide: type === 'rock' ? 0.8 : 0, maxDist: 50 });
  }
  group.add(sc.build());
  return { group, hf, seep: seepC, sources, mussels, chimneys, scatter: sc };
}

/** Area B (~3,600–3,670 m): a back-arc black-smoker field on a sulphide mound. */
export function buildSmokers(engine, { seed = 83 } = {}) {
  const lib = engine.lib, rng = new RNG(seed), n = new Noise(seed);
  const mound = V(0, 0, 30);
  const height = (x, z) => {
    let y = -60 + n.fbm2(x * 0.02, z * 0.02, 4) * 8 + Math.abs(n.n2(x * 0.09, z * 0.09)) * 3;
    y += Math.pow(Math.max(0, n.n2(x * 0.045 + 7, z * 0.045)), 1.5) * 7; // pillow-lava ridges
    const d = Math.hypot(x - mound.x, z - mound.z);
    y += 9 * Math.exp(-(d * d) / (2 * 14 * 14));
    return y;
  };
  mound.y = height(mound.x, mound.z);
  const hf = new Heightfield({
    x0: -130, z0: -130, sizeX: 260, sizeZ: 260, cell: engine.preset.terrainCell,
    heightFn: height,
    maskFn: (x, z, h, slope) => {
      const d = Math.hypot(x - mound.x, z - mound.z);
      return [clamp(0.6 + slope - smoothstep(40, 20, d) * 0.2, 0, 1), clamp(1 - smoothstep(8, 26, d), 0, 1), 0];
    },
  });
  const group = new THREE.Group();
  group.add(hf.buildMesh(makeTerrainMaterial(lib, { soft: 'ooze', hard: 'basalt', tintA: [0.72, 0.62, 0.5], tintB: [0.5, 0.46, 0.44], tintC: [1.35, 0.82, 0.46], key: 'smokerfield' }), { chunks: 8 }));
  const sulph = makeRockMaterial(lib, { tex: 'basalt', key: 'sulphide' });
  sulph.color.setRGB(0.62, 0.54, 0.46);
  const chimneys = [];
  for (const [dx, dz, h, b] of [[-3, 0, 13, 2.2], [5, 4, 9, 1.7], [1, -7, 7, 1.5], [-9, -4, 5, 1.2]]) {
    const p = V(mound.x + dx, 0, mound.z + dz); p.y = height(p.x, p.z) - 0.3;
    const m = new THREE.Mesh(chimneyGeo(rng, { height: h, base: b }), sulph);
    m.position.copy(p);
    group.add(m);
    chimneys.push({ base: p.clone(), top: p.clone().add(V(0, h, 0)), r: b, h });
  }
  const kit = makeReefKit(engine, seed);
  const sc = new Scatter({ cell: 40 });
  const nrm = new THREE.Vector3();
  for (const [x, z] of jitterGrid(rng, -125, -125, 125, 125, 2.3, () => 0.55 * engine.preset.dressDensity)) {
    if (Math.hypot(x - mound.x, z - mound.z) < 9) continue;
    hf.normal(x, z, nrm);
    const r = rng.next();
    const type = r < 0.7 ? 'rock' : 'rubble';
    const variants = kit.G[type], vi = rng.int(0, variants.length - 1);
    const scale = type === 'rock' ? rng.range(0.5, 2.2) : rng.range(0.8, 1.8);
    const col = new THREE.Color(0.55, 0.5, 0.47);
    sc.add(type + vi, variants[vi], kit.M[type], { pos: V(x, hf.height(x, z) - (type === 'rock' ? 0.3 * scale : 0.02), z), normal: nrm.clone(), align: 0.6, scale, color: col }, { collide: type === 'rock' ? 0.8 : 0, maxDist: 55 });
  }
  group.add(sc.build());
  return { group, hf, mound, chimneys, scatter: sc };
}
