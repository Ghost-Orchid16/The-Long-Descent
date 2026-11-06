// Dev-only creature gallery: ?dev=creatures&zone=reef&studio=1&torch=1
import * as THREE from 'three';
import { Engine } from '../core/Engine.js';
import { Heightfield, makeTerrainMaterial } from '../world/Terrain.js';
import { makeInstanced, SPECIES_LIST } from '../creatures/factory.js';
import { lamps } from '../render/Lamps.js';

export async function start(params) {
  const engine = new Engine(document.getElementById('app'), { quality: params.get('q') || 'medium' });
  window.__engine = engine;
  const zone = params.get('zone') || 'reef';
  const only = params.get('only');
  const list = SPECIES_LIST.filter((s) => (only ? only.split(',').includes(s.id) : s.zone === zone) && s.id !== 'sea_fan');
  const depth = Number(params.get('depth') || 4);
  const floorY = -depth - 1.2;
  const hf = new Heightfield({ x0: -40, z0: -40, sizeX: 80, sizeZ: 80, cell: 1, heightFn: () => floorY, maskFn: () => [0, 0, 0] });
  engine.scene.add(hf.buildMesh(makeTerrainMaterial(engine.lib, {}), { chunks: 2 }));
  const m4 = new THREE.Matrix4();
  let x = 0;
  const gap = Number(params.get('gap') || 0.4);
  const items = [];
  for (const s of list) {
    const c = makeInstanced(s.id, 1);
    const L = c.geometry.boundingSphere.radius * 2;
    const scale = Math.min(1, Number(params.get('fit') || 99) / L);
    const pos = new THREE.Vector3(x + L * scale / 2, -depth, -4);
    if (s.behavior.includes('sessile') || s.behavior.includes('crawl') || s.behavior.includes('herd') || s.behavior.includes('perch') || s.behavior.includes('rest')) pos.y = floorY + (s.id === 'giant_clam' ? 0.12 : 0.02);
    m4.compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Number(params.get('yaw') || -1.2), 0)), new THREE.Vector3(scale, scale, scale));
    c.mesh.setMatrixAt(0, m4);
    c.mesh.instanceMatrix.needsUpdate = true;
    engine.scene.add(c.mesh);
    items.push({ id: s.id, x: pos.x, L: L * scale });
    x += L * scale + gap;
  }
  console.log('[creatures]', items.map((i) => `${i.id}@${i.x.toFixed(1)}`).join(' '));
  const center = Number(params.get('cx') ?? x / 2);
  const dist = Number(params.get('dist') || Math.max(2.5, x * 0.55));
  engine.camera.position.set(center, -depth + Number(params.get('cy') || 0.3), -4 + dist);
  engine.camera.lookAt(center, -depth, -4);
  if (params.get('studio')) {
    engine.env.depthBase = -200; // camera "above water": no absorption, neutral daylight
    engine.env.exposureOverride = 0.9;
  } else engine.env.depthBase = 0;
  const torch = new THREE.SpotLight(0xfff4e6, 40, 0, 0.5, 0.5, 2);
  torch.position.set(0.2, -0.2, 0); torch.target.position.set(0, -0.1, -5);
  engine.camera.add(torch, torch.target);
  torch.visible = !!params.get('torch');
  lamps.add(torch);
  let frames = 0;
  const loop = () => {
    engine.update(1 / 60);
    if (frames < 3) engine.env.exposure = engine.env.exposureTarget;
    engine.render(1 / 60);
    if (++frames === 3) { window.__ready = true; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
