import * as THREE from 'three';
import { Noise } from './noise.js';
import { patchMaterial } from '../render/water/patch.js';

/**
 * Guam seen from offshore to the west: a long island to the east with a limestone plateau and
 * cliffs in the north, a low waist, and volcanic hills in the south (highest ~400 m).
 */
export function buildIsland() {
  const n = new Noise(77);
  const nx = 90, nz = 260;
  const x0 = 4200, x1 = 13000, z0 = -26000, z1 = 22000;
  const pos = [], col = [], idx = [];
  const height = (x, z) => {
    // coastline runs roughly north-south with bays and points
    const coast = x0 + 600 + n.fbm2(z * 0.00025, 3.3, 4) * 900 + (z > 2000 && z < 6000 ? 900 : 0);
    const d = x - coast;
    if (d < 0) return -20;
    const north = THREE.MathUtils.smoothstep(z, 0, -8000);
    const south = THREE.MathUtils.smoothstep(z, 4000, 12000);
    const plateau = 165 * north * THREE.MathUtils.smoothstep(d, 0, 140);
    const hills = (south * (260 + 140 * n.fbm2(z * 0.0004, x * 0.0004, 4)) + (1 - north) * (1 - south) * 70) * Math.pow(THREE.MathUtils.smoothstep(d, 0, 2200), 0.8);
    const rough = n.ridge2(x * 0.0012, z * 0.0012, 4) * 60 * (south + 0.3);
    return Math.max(plateau, hills) + rough * THREE.MathUtils.smoothstep(d, 0, 400);
  };
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * (i / nx), z = z0 + (z1 - z0) * (j / nz);
    const h = height(x, z);
    pos.push(x, h, z);
    const veg = THREE.MathUtils.clamp(h / 30, 0, 1);
    const c = new THREE.Color().setRGB(0.09 + 0.05 * (1 - veg), 0.13 + 0.04 * veg, 0.07);
    if (h < 4) c.setRGB(0.5, 0.48, 0.4);
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  patchMaterial(m, { key: 'island' });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'guam';
  mesh.frustumCulled = false;
  return mesh;
}
