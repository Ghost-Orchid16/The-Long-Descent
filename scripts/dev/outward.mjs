// Dev check: per part, fraction of vertex normals pointing away from the part centroid (outward ≈ 1, two-sided ≈ 0.5).
import * as THREE from 'three';
import { buildCreature, SPECIES_LIST } from '../../src/creatures/factory.js';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : SPECIES_LIST.map((s) => s.id).filter((i) => i !== 'sea_fan');
for (const id of ids) {
  const g = buildCreature(id).geometry;
  const pos = g.attributes.position, nrm = g.attributes.normal, body = g.attributes.aBody;
  const parts = {};
  for (let i = 0; i < pos.count; i++) {
    const p = Math.round(body.getW(i));
    (parts[p] ||= { c: new THREE.Vector3(), n: 0, idx: [] }).c.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    parts[p].n++; parts[p].idx.push(i);
  }
  const out = [];
  for (const [p, s] of Object.entries(parts)) {
    s.c.divideScalar(s.n);
    let o = 0;
    for (const i of s.idx) { const v = new THREE.Vector3().fromBufferAttribute(pos, i).sub(s.c); if (v.dot(new THREE.Vector3().fromBufferAttribute(nrm, i)) > 0) o++; }
    out.push(`${p}:${(o / s.n).toFixed(2)}`);
  }
  console.log(id.padEnd(20), out.join(' '));
}
