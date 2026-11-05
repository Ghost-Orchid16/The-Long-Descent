import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _e = new THREE.Euler();
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sphere = new THREE.Sphere();

/**
 * Instanced dressing with CPU culling: each (geometry, material) set is one InstancedMesh whose visible
 * instances (in frustum and within range) are compacted into the instance buffer when the view changes.
 */
export class Scatter {
  constructor({ maxDist = 75 } = {}) {
    this.defaultMaxDist = maxDist;
    this.sets = new Map(); // key -> {geo, mat, items: [], ...}
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    this.instances = []; // for collision / scanning queries: {x,y,z,r,tag,...}
    this.meshes = [];
    this.frame = 0;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.lastQuat = new THREE.Quaternion();
    this.visibleCount = 0;
  }

  add(key, geo, mat, t, { castShadow = false, collide = 0, tag = null, maxDist = null } = {}) {
    let set = this.sets.get(key);
    if (!set) {
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      set = { geo, mat, items: [], castShadow, maxDist: maxDist ?? this.defaultMaxDist };
      this.sets.set(key, set);
    }
    const yaw = t.yaw ?? Math.random() * Math.PI * 2;
    _q.setFromAxisAngle(_up, yaw);
    if (t.normal && t.align) {
      _n.copy(_up).lerp(t.normal, t.align).normalize();
      _q.premultiply(new THREE.Quaternion().setFromUnitVectors(_up, _n));
    }
    if (t.tilt) {
      _e.set(t.tilt[0] || 0, 0, t.tilt[1] || 0);
      _q.multiply(new THREE.Quaternion().setFromEuler(_e));
    }
    if (typeof t.scale === 'number') _s.setScalar(t.scale); else _s.copy(t.scale || _s.set(1, 1, 1));
    _m.compose(t.pos, _q, _s);
    const bs = set.geo.boundingSphere;
    const c = bs.center.clone().applyMatrix4(_m);
    const r = bs.radius * Math.max(_s.x, _s.y, _s.z);
    set.items.push({ e: new Float32Array(_m.elements), c, r, col: t.color ? t.color.clone() : null });
    set.maxR = Math.max(set.maxR || 0, r);
    if (collide > 0 || tag) {
      const sc = typeof t.scale === 'number' ? t.scale : Math.max(t.scale.x, t.scale.z);
      this.instances.push({ x: t.pos.x, y: t.pos.y, z: t.pos.z, r: collide * sc, tag, yaw, scale: sc, key });
    }
  }

  build() {
    let total = 0, tris = 0;
    for (const [key, set] of this.sets) {
      const n = set.items.length;
      total += n;
      tris += n * ((set.geo.index ? set.geo.index.count : set.geo.attributes.position.count) / 3);
      const mesh = new THREE.InstancedMesh(set.geo, set.mat, n);
      mesh.name = key;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (set.items.some((i) => i.col)) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.frustumCulled = false;
      mesh.castShadow = set.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.count = 0;
      set.mesh = mesh;
      // bucket items into a coarse grid for fast culling
      const CELL = 12;
      const cells = new Map();
      for (const it of set.items) {
        const k = Math.floor(it.c.x / CELL) + ',' + Math.floor(it.c.z / CELL);
        let cell = cells.get(k);
        if (!cell) { cell = { items: [], box: new THREE.Box3() }; cells.set(k, cell); }
        cell.items.push(it);
        cell.box.expandByPoint(_p.copy(it.c).addScalar(it.r)); cell.box.expandByPoint(_p.copy(it.c).addScalar(-it.r));
      }
      set.cells = [...cells.values()];
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.stats = { instances: total, triangles: Math.round(tris), meshes: this.meshes.length };
    return this.group;
  }

  /** Recompute visible instances (frustum + range) when the camera has moved or turned. */
  update(camera, force = false) {
    this.frame++;
    const moved = camera.position.distanceToSquared(this.lastCam) > 0.09 || camera.quaternion.angleTo(this.lastQuat) > 0.015;
    if (!force && !moved && this.frame % 30 !== 0) return;
    this.lastCam.copy(camera.position); this.lastQuat.copy(camera.quaternion);
    camera.updateMatrixWorld();
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const far = camera.far;
    let visible = 0;
    for (const set of this.sets.values()) {
      const mesh = set.mesh;
      if (!mesh) continue;
      const arr = mesh.instanceMatrix.array;
      const carr = mesh.instanceColor ? mesh.instanceColor.array : null;
      const md = Math.min(set.maxDist, far);
      let n = 0;
      for (const cell of set.cells) {
        // cell-level range + frustum test
        const b = cell.box;
        const ex = Math.max(b.min.x - cx, 0, cx - b.max.x), ey = Math.max(b.min.y - cy, 0, cy - b.max.y), ez = Math.max(b.min.z - cz, 0, cz - b.max.z);
        if (ex * ex + ey * ey + ez * ez > md * md) continue;
        if (!_frustum.intersectsBox(b)) continue;
        for (const it of cell.items) {
          const dx = it.c.x - cx, dy = it.c.y - cy, dz = it.c.z - cz;
          const lim = md + it.r;
          if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
          _sphere.center.copy(it.c); _sphere.radius = it.r * 1.2 + 0.3;
          if (!_frustum.intersectsSphere(_sphere)) continue;
          arr.set(it.e, n * 16);
          if (carr) { const c = it.col; carr[n * 3] = c ? c.r : 1; carr[n * 3 + 1] = c ? c.g : 1; carr[n * 3 + 2] = c ? c.b : 1; }
          n++;
        }
      }
      mesh.count = n;
      visible += n;
      mesh.visible = n > 0;
      if (n > 0) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, n * 3); mesh.instanceColor.needsUpdate = true; }
      }
    }
    this.visibleCount = visible;
  }
}

/** Jittered-grid sampling over a rectangle, filtered by a density function in [0,1]. */
export function jitterGrid(rng, x0, z0, x1, z1, spacing, densityFn) {
  const out = [];
  for (let z = z0; z < z1; z += spacing) {
    for (let x = x0; x < x1; x += spacing) {
      const px = x + rng.range(0, spacing), pz = z + rng.range(0, spacing);
      const d = densityFn(px, pz);
      if (d > 0 && rng.next() < d) out.push([px, pz]);
    }
  }
  return out;
}

export { _p as scatterTmp };
