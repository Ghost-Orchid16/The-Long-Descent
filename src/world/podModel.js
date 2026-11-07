import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/water/patch.js';

// The deep-diving pod: a titanium personnel sphere in a frame with syntactic-foam floats, thrusters,
// floodlight booms, a manipulator arm and a sample basket. Local frame: -Z forward, +Y up, sphere centre at origin.

export const POD = {
  sphereR: 1.15,                // outer radius of the personnel sphere
  viewDir: new THREE.Vector3(0, -0.2, -1).normalize(),
  viewHalfAngle: 0.56,          // rad, viewport cut-out half angle on the sphere
  eye: new THREE.Vector3(0, 0.1, 0.12),
  floods: [new THREE.Vector3(-1.05, -0.95, -1.55), new THREE.Vector3(1.05, -0.95, -1.55), new THREE.Vector3(0, 1.25, -1.2)],
  armBase: new THREE.Vector3(0.75, -1.05, -1.25),
};

const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);

class Parts {
  constructor() { this.map = new Map(); }
  add(mat, geo, m) {
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
  }
  build(group) {
    for (const [mat, list] of this.map) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

function pbr(color, rough, metal, key) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  patchMaterial(m, { key: 'pod' + key, wrap: 0.1 });
  return m;
}

/** Exterior pod model. Returns { group, mats, arm: {root, upper, fore, claw}, floods: [Object3D], viewportGlass }. */
export function buildPodModel({ withSphere = true } = {}) {
  const group = new THREE.Group();
  group.name = 'pod';
  const mats = {
    foam: pbr(0xe8e2cf, 0.7, 0.0, 'foam'),
    yellow: pbr(0xe3b324, 0.5, 0.1, 'yellow'),
    ti: pbr(0x9aa0a4, 0.35, 0.85, 'ti'),
    frame: pbr(0x3c4246, 0.5, 0.6, 'frame'),
    dark: pbr(0x15181a, 0.6, 0.3, 'dark'),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff2dd, emissiveIntensity: 0.0, roughness: 0.2 }),
  };
  patchMaterial(mats.lamp, { key: 'podlamp' });
  const P = new Parts();
  const R = POD.sphereR;
  if (withSphere) {
    // personnel sphere with the viewport opening (pole of the sphere aligned with the view direction)
    const sph = new THREE.SphereGeometry(R, 48, 28, 0, Math.PI * 2, POD.viewHalfAngle, Math.PI - POD.viewHalfAngle);
    sph.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), POD.viewDir));
    P.add(mats.ti, sph);
    const ring = new THREE.TorusGeometry(R * Math.sin(POD.viewHalfAngle) + 0.03, 0.06, 10, 48);
    ring.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -R * Math.cos(POD.viewHalfAngle) + 0.02));
    ring.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), POD.viewDir));
    P.add(mats.frame, ring);
    // hatch on top
    P.add(mats.ti, new THREE.CylinderGeometry(0.42, 0.45, 0.16, 32), M(0, R - 0.02, 0.1));
    P.add(mats.frame, new THREE.TorusGeometry(0.3, 0.035, 8, 24), M(0, R + 0.08, 0.1, Math.PI / 2, 0, 0));
  }
  // frame rails and skids
  for (const s of [-1, 1]) {
    P.add(mats.frame, new THREE.BoxGeometry(0.12, 0.12, 3.6), M(s * 1.2, -1.35, 0.1));
    P.add(mats.frame, new THREE.BoxGeometry(0.12, 0.12, 3.4), M(s * 1.2, 1.05, 0.25));
    for (const z of [-1.4, 0, 1.5]) P.add(mats.frame, new THREE.BoxGeometry(0.1, 2.4, 0.1), M(s * 1.2, -0.15, z));
    P.add(mats.dark, new THREE.BoxGeometry(0.16, 0.16, 3.9), M(s * 1.05, -1.62, 0.1)); // skid
    for (const z of [-1.4, 1.5]) P.add(mats.frame, new THREE.BoxGeometry(0.08, 0.3, 0.08), M(s * 1.1, -1.48, z));
  }
  for (const z of [-1.4, 1.5]) P.add(mats.frame, new THREE.BoxGeometry(2.4, 0.1, 0.1), M(0, -1.35, z));
  // syntactic foam floats on top and the stern (with the yellow fairing)
  P.add(mats.foam, new THREE.BoxGeometry(2.5, 0.75, 2.6), M(0, 1.55, 0.55));
  P.add(mats.yellow, new THREE.BoxGeometry(2.56, 0.12, 2.66), M(0, 1.98, 0.55));
  P.add(mats.foam, new THREE.BoxGeometry(2.3, 1.6, 0.9), M(0, 0.1, 1.85));
  for (const s of [-1, 1]) P.add(mats.foam, new THREE.BoxGeometry(0.55, 1.2, 2.0), M(s * 1.55, 0.25, 0.75));
  // thrusters: two aft (horizontal), two vertical, one lateral
  const thruster = (x, y, z, rx, ry, rz) => {
    P.add(mats.dark, new THREE.CylinderGeometry(0.2, 0.2, 0.42, 20, 1, true), M(x, y, z, rx, ry, rz));
    P.add(mats.yellow, new THREE.TorusGeometry(0.2, 0.025, 8, 24), M(x, y, z, rx + Math.PI / 2, ry, rz));
    P.add(mats.frame, new THREE.CylinderGeometry(0.08, 0.08, 0.3, 12), M(x, y, z, rx, ry, rz));
  };
  for (const s of [-1, 1]) thruster(s * 1.0, -0.6, 2.45, Math.PI / 2, 0, 0);
  for (const s of [-1, 1]) thruster(s * 1.55, 1.15, 0.6, 0, 0, 0);
  thruster(0, -0.9, 1.5, 0, 0, Math.PI / 2);
  // floodlight booms
  const floods = [];
  for (const p of POD.floods) {
    const boom = new THREE.Group();
    boom.position.copy(p);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 18), mats.frame);
    housing.rotation.x = Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), mats.lamp);
    lens.position.z = -0.115; lens.rotation.y = Math.PI;
    boom.add(housing, lens);
    group.add(boom);
    floods.push(boom);
    P.add(mats.frame, new THREE.BoxGeometry(0.06, 0.06, Math.max(0.2, Math.abs(p.z) - 0.9)), M(p.x, p.y, (p.z - 0.9) / 2 - 0.2));
  }
  // sample basket at the front skids
  P.add(mats.frame, new THREE.BoxGeometry(1.3, 0.05, 0.6), M(-0.2, -1.5, -1.9));
  for (let i = 0; i < 6; i++) P.add(mats.frame, new THREE.BoxGeometry(0.02, 0.28, 0.6), M(-0.82 + i * 0.25, -1.37, -1.9));
  P.add(mats.frame, new THREE.BoxGeometry(1.3, 0.28, 0.02), M(-0.2, -1.37, -2.2));
  // drop weights (steel plates released to ascend)
  for (const s of [-1, 1]) P.add(mats.dark, new THREE.BoxGeometry(0.5, 0.35, 0.7), M(s * 0.55, -1.25, 0.8));
  P.build(group);

  // manipulator arm (articulated: shoulder yaw/pitch, elbow, wrist, two-finger claw)
  const arm = { root: new THREE.Group() };
  arm.root.position.copy(POD.armBase);
  const seg = (len, r) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 12), mats.ti); m.rotation.x = -Math.PI / 2; m.position.z = -len / 2; g.add(m); const j = new THREE.Mesh(new THREE.SphereGeometry(r * 1.5, 12, 8), mats.frame); g.add(j); return g; };
  arm.upper = seg(0.62, 0.05); arm.root.add(arm.upper);
  arm.fore = seg(0.55, 0.042); arm.fore.position.z = -0.62; arm.upper.add(arm.fore);
  arm.wrist = new THREE.Group(); arm.wrist.position.z = -0.55; arm.fore.add(arm.wrist);
  arm.claw = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, 0.16), mats.frame); m.position.set(0, 0, -0.08); f.add(m);
    f.position.x = s * 0.035; arm.wrist.add(f); arm.claw.push(f);
  }
  arm.upper.rotation.set(0.55, 0.15, 0);
  arm.fore.rotation.set(-1.25, 0, 0);
  group.add(arm.root);
  return { group, mats, arm, floods };
}
