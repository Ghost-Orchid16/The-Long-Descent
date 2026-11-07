// Dev-only: a row of every reef generator on flat sand, for judging shapes and colours.
import * as THREE from 'three';
import { Heightfield, makeTerrainMaterial } from '../world/Terrain.js';
import * as gen from '../world/reefGen.js';
import { makeOrganicMaterial, makeRockMaterial } from '../render/materials.js';
import { RNG } from '../world/noise.js';

export function buildGallery(engine) {
  const lib = engine.lib;
  const g = new THREE.Group();
  const hf = new Heightfield({ x0: -30, z0: -30, sizeX: 60, sizeZ: 60, cell: 0.5, heightFn: () => -4, maskFn: () => [0, 0, 0] });
  g.add(hf.buildMesh(makeTerrainMaterial(lib, {}), { chunks: 2 }));
  const r = (i) => new RNG(100 + i);
  const items = [
    ['massive', gen.massiveCoral(r(1), { radius: 0.6 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.22, detailStrength: 0.45, key: 'gm' }), '#c0a670'],
    ['brain', gen.brainCoral(r(2), { radius: 0.45 }), makeOrganicMaterial(lib, { detail: 'brain', detailScale: 1 / 0.35, key: 'gb' }), '#b0ae6a'],
    ['branch', gen.branchingCoral(r(3), { size: 1 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.12, tipColor: [1.6, 1.6, 1.7], tipAmount: 0.6, key: 'gbr' }), '#a88a62'],
    ['bush', gen.branchingCoral(r(4), { size: 0.45, maxDepth: 3, stubby: 0.7 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.12, key: 'gbu' }), '#c08a80'],
    ['digitate', gen.digitateCoral(r(15), { size: 0.5 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.1, tipColor: [1.5, 1.5, 1.7], tipAmount: 0.6, key: 'gdg' }), '#b09a70'],
    ['table', gen.tableCoral(r(5), { radius: 0.8 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.1, key: 'gt' }), '#9a9468'],
    ['plate', gen.plateCoral(r(6), { size: 0.7 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.14, key: 'gp' }), '#b8b46c'],
    ['leather', gen.leatherCoral(r(7), { size: 0.35 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.05, detailStrength: 0.25, sway: true, swayAmp: 0.05, key: 'gl' }), '#c8b890'],
    ['soft', gen.treeSoftCoral(r(8), { size: 0.45 }), makeOrganicMaterial(lib, { detail: null, sway: true, swayAmp: 0.09, translucent: 0.45, wrap: 0.6, key: 'gs' }), '#d86a9a'],
    ['fan', gen.seaFan(r(9), { width: 1.8, height: 1.4 }), makeOrganicMaterial(lib, { detail: null, sway: true, swayAmp: 0.12, wrap: 0.6, translucent: 0.3, key: 'gf' }), '#c04a24'],
    ['anemone', gen.anemone(r(10), { radius: 0.28 }), (() => { const t = new THREE.Color('#b8b060'); return makeOrganicMaterial(lib, { detail: null, tipColor: [t.r, t.g, t.b], tipAmount: 1, tipReplace: true, sway: true, swayAmp: 0.08, translucent: 0.4, wrap: 0.6, key: 'ga' }); })(), '#b8183a'],
    ['barrel', gen.barrelSponge(r(11), { height: 0.9 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.07, detailStrength: 0.35, key: 'gbs' }), '#a87266'],
    ['tubes', gen.tubeSponges(r(12), { size: 0.4 }), makeOrganicMaterial(lib, { detail: 'coral', detailScale: 1 / 0.07, key: 'gts' }), '#7a4a9a'],
    ['rock', gen.rock(r(13), { size: 0.5 }), makeRockMaterial(lib, {}), '#f2ece0'],
    ['urchin', gen.urchin(r(14)), makeOrganicMaterial(lib, { detail: null, roughness: 0.35, key: 'gu' }), '#141418'],
  ];
  const mode = new URLSearchParams(location.search).get('mode');
  items.forEach(([name, geo, mat, hex], i) => {
    if (mode === 'plain') mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
    if (mode === 'nodetail') mat = makeOrganicMaterial(lib, { detail: null, wrap: 0, key: 'nd' + i });
    if (mode === 'normals') mat = new THREE.MeshNormalMaterial();
    mat.color?.set(hex);
    const m = new THREE.Mesh(geo, mat);
    const col = i % 5, row = Math.floor(i / 5);
    m.position.set(-4 + col * 2.0, -4, -3 - row * 2.2);
    m.name = name;
    g.add(m);
  });
  return g;
}
