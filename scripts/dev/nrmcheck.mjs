import * as THREE from 'three';
import { buildCreature, SPECIES_LIST } from '../../src/creatures/factory.js';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : SPECIES_LIST.map(s => s.id);
for (const id of ids) {
  let c;
  try { c = buildCreature(id); } catch (e) { console.log(id, 'ERR', e.message); continue; }
  const g = c.geometry;
  const pos = g.attributes.position, nrm = g.attributes.normal, body = g.attributes.aBody, idx = g.index;
  // per-part: compare vertex normal against geometric face normal from the winding
  const stats = {};
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); cc.fromBufferAttribute(pos, i2);
    fn.subVectors(b, a).cross(cc.clone().sub(a));
    if (fn.lengthSq() < 1e-16) continue;
    fn.normalize();
    vn.fromBufferAttribute(nrm, i0).add(new THREE.Vector3().fromBufferAttribute(nrm, i1)).add(new THREE.Vector3().fromBufferAttribute(nrm, i2)).normalize();
    const part = Math.round(body.getW(i0));
    const s = stats[part] || (stats[part] = { agree: 0, oppose: 0 });
    if (fn.dot(vn) > 0) s.agree++; else s.oppose++;
  }
  const out = Object.entries(stats).map(([p, s]) => `${p}:${s.agree}/${s.oppose}`).join(' ');
  console.log(id.padEnd(22), out);
}
