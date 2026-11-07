import * as THREE from 'three';
import { patchMaterial } from '../render/water/patch.js';

// Optional model overrides: list species in public/models/manifest.json, e.g.
//   { "overrides": { "green_turtle": "green_turtle.glb" } }
// Each GLB should hold one mesh, Y up, nose along +Z, any scale (it is fitted to the species' real length).
// Overrides are drawn as rigid instanced meshes with the underwater optics applied.

const loaded = new Map();
let ready = null;

export function loadOverrides(lengthOf) {
  if (ready) return ready;
  ready = (async () => {
    let manifest;
    try {
      const r = await fetch('./models/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      manifest = await r.json();
    } catch (e) { return; }
    const entries = Object.entries(manifest?.overrides || {});
    if (!entries.length) return;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    for (const [id, file] of entries) {
      try {
        const gltf = await loader.loadAsync('./models/' + file);
        let mesh = null;
        gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
        if (!mesh) continue;
        mesh.updateWorldMatrix(true, false);
        const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        geo.computeBoundingBox();
        const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
        geo.translate(-c.x, -c.y, -c.z);
        const L = lengthOf(id);
        geo.scale(L / Math.max(size.z, 1e-3), L / Math.max(size.z, 1e-3), L / Math.max(size.z, 1e-3));
        geo.computeBoundingSphere();
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone();
        patchMaterial(mat, { key: 'override:' + id });
        loaded.set(id, { geometry: geo, material: mat });
      } catch (e) {
        if (import.meta.env?.DEV) console.warn('[models] override failed for', id, e);
      }
    }
  })();
  return ready;
}

/** {geometry, material} for a loaded override, or null. */
export function overrideFor(id) { return loaded.get(id) || null; }
