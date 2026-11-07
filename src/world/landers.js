import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/water/patch.js';

const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

function pbr(color, rough, metal, key, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  patchMaterial(m, { key: 'lander' + key, wrap: 0.15 });
  return m;
}

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
      group.add(new THREE.Mesh(g, mat));
    }
  }
}

/** Frame of a free-fall benthic lander: four legs, a deck, orange syntactic flotation spheres. */
function landerFrame(P, mats, { h = 1.6, w = 1.4 } = {}) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(mats.frame, new THREE.CylinderGeometry(0.035, 0.035, h, 8), M(sx * w / 2, h / 2, sz * w / 2, sz * 0.08, 0, -sx * 0.08));
  for (const y of [0.25, h - 0.05]) {
    for (const s of [-1, 1]) {
      P.add(mats.frame, new THREE.BoxGeometry(w, 0.04, 0.04), M(0, y, s * w / 2));
      P.add(mats.frame, new THREE.BoxGeometry(0.04, 0.04, w), M(s * w / 2, y, 0));
    }
  }
  P.add(mats.frame, new THREE.BoxGeometry(w * 0.9, 0.03, w * 0.9), M(0, h - 0.05, 0));
  for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) P.add(mats.float, new THREE.SphereGeometry(0.22, 20, 14), M(x, h + 0.2, z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(mats.dark, new THREE.CylinderGeometry(0.09, 0.11, 0.06, 12), M(sx * w / 2, 0.03, sz * w / 2));
}

/** The expedition's baited camera lander (hadal bait station). Returns {group, bait (world-local Vector3)}. */
export function buildBaitStation() {
  const group = new THREE.Group();
  group.name = 'baitStation';
  const mats = { frame: pbr(0xb8bcc0, 0.4, 0.8, 'frame'), float: pbr(0xe86a1c, 0.45, 0.05, 'float'), dark: pbr(0x202326, 0.6, 0.3, 'dark'), mesh: pbr(0x8a8e86, 0.7, 0.2, 'baitmesh'), glass: pbr(0x1a2a30, 0.1, 0.4, 'camglass') };
  const P = new Parts();
  landerFrame(P, mats);
  // camera + light pod looking down at the bait arm
  P.add(mats.dark, new THREE.CylinderGeometry(0.07, 0.07, 0.32, 16), M(0.15, 1.35, 0.3, 0.7, 0, 0));
  P.add(mats.glass, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), M(0.15, 1.24, 0.42, 0.7, 0, 0));
  // bait arm with a mesh bag of mackerel on the sediment in front
  P.add(mats.frame, new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), M(0, 0.55, 1.35, Math.PI / 2 - 0.35, 0, 0));
  P.add(mats.mesh, new THREE.SphereGeometry(0.17, 14, 10), M(0, 0.17, 1.95));
  P.add(mats.dark, new THREE.BoxGeometry(0.5, 0.25, 0.3), M(0, 0.4, 0)); // ballast / release
  P.build(group);
  return { group, bait: new THREE.Vector3(0, 0.17, 1.95) };
}

/**
 * ECHO-7: the expedition's full-ocean-depth lander, tipped over on the trench floor. Its acoustic modem
 * transducer on the mast is smothered by a plastic bag. Returns {group, transducer, bag, beacon}.
 */
export function buildEcho7() {
  const group = new THREE.Group();
  group.name = 'echo7';
  const mats = { frame: pbr(0xc8ccd0, 0.35, 0.85, 'e7frame'), float: pbr(0xf0c21c, 0.45, 0.05, 'e7float'), dark: pbr(0x1a1c1e, 0.6, 0.3, 'e7dark'), white: pbr(0xe8e6de, 0.5, 0.05, 'e7white') };
  const P = new Parts();
  landerFrame(P, mats, { h: 1.9, w: 1.6 });
  // instrument housings, mast and transducer
  for (const [x, z] of [[-0.4, 0], [0.4, 0.1]]) P.add(mats.white, new THREE.CylinderGeometry(0.11, 0.11, 0.7, 18), M(x, 1.05, z, Math.PI / 2, 0, 0));
  P.add(mats.frame, new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), M(0, 2.6, 0));
  P.add(mats.dark, new THREE.CylinderGeometry(0.09, 0.12, 0.22, 16), M(0, 3.35, 0));
  P.add(mats.white, new THREE.BoxGeometry(0.42, 0.06, 0.3), M(0.5, 1.92, -0.55)); // nameplate
  P.build(group);
  // nameplate text
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d'); x.fillStyle = '#e8e6de'; x.fillRect(0, 0, 256, 96); x.fillStyle = '#1a1c1e'; x.font = '700 54px Inter, sans-serif'; x.textAlign = 'center'; x.fillText('ECHO-7', 128, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const plateM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  patchMaterial(plateM, { key: 'e7plate' });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), plateM);
  plate.rotation.x = -Math.PI / 2; plate.position.set(0.5, 1.955, -0.55);
  group.add(plate);
  // the beacon light (dark until it talks again)
  const beaconM = new THREE.MeshStandardMaterial({ color: 0x103018, emissive: 0x30ff70, emissiveIntensity: 0, roughness: 0.3 });
  patchMaterial(beaconM, { key: 'e7beacon' });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), beaconM);
  beacon.position.set(0, 3.5, 0);
  group.add(beacon);
  // plastic bag snagged over the transducer: a crumpled, translucent sheet
  const bagGeo = new THREE.SphereGeometry(0.2, 20, 14);
  const bp = bagGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const vx = bp.getX(i), vy = bp.getY(i), vz = bp.getZ(i);
    const k = 1 + 0.35 * Math.sin(vx * 31 + vy * 17) * Math.cos(vz * 23) + (vy < 0 ? 0.6 * -vy * 5 : 0);
    bp.setXYZ(i, vx * k, vy * (1.3 + (vy < 0 ? 1.4 : 0)), vz * k * 0.8);
  }
  bagGeo.computeVertexNormals();
  const bagM = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.35, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
  patchMaterial(bagM, { key: 'plasticbag', sway: false, wrap: 0.6, translucent: 0.6 });
  const bag = new THREE.Mesh(bagGeo, bagM);
  bag.position.set(0, 3.28, 0);
  bag.renderOrder = 3;
  group.add(bag);
  return { group, transducer: new THREE.Vector3(0, 3.35, 0), bag, beacon };
}

/** An abandoned cable lying across the sediment (tube along a polyline). */
export function cableMesh(points, radius = 0.025) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, Math.max(40, points.length * 12), radius, 8, false);
  const mat = pbr(0x2a2c2a, 0.55, 0.2, 'cable');
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, curve };
}
