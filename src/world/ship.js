import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../render/water/patch.js';
import { TRI_FUNCS_GLSL } from '../render/glsl/triplanar.js';

// Ship coordinates: x = starboard, y = up (0 = waterline), z = aft (bow at -31, transom at +31).
export const SHIP = {
  length: 62, deckY: 2.6, beam: 13,
  deckZ0: -2, deckZ1: 30.6,
  platform: new THREE.Vector3(6.25, 1.05, 23.6), // starboard dive platform (back-roll point)
  bench: new THREE.Vector3(4.6, 2.6, 15.2),
  chamberDoor: new THREE.Vector3(-4.1, 2.6, 11.4),
  chamber: new THREE.Vector3(-4.1, 3.75, 8.4),
  podCradle: new THREE.Vector3(0, 2.6, 22.2),
  spawn: new THREE.Vector3(1.5, 2.6, 6.0),
};

export function halfBeam(z) {
  if (z < -31) return 0;
  const bow = THREE.MathUtils.smoothstep(z, -31, -12);
  const aft = 1 - 0.05 * THREE.MathUtils.smoothstep(z, 24, 31);
  return 6.5 * Math.pow(bow, 0.55) * aft;
}

function sheer(z) {
  return SHIP.deckY + 1.1 + 2.2 * Math.pow(1 - THREE.MathUtils.smoothstep(z, -31, -8), 2);
}

/** Paint material: PBR with fine triplanar grit/scuffs, optional weathering. */
function paint(lib, color, { rough = 0.62, metal = 0.15, grit = 0.35, scale = 1 / 0.6, weather = 0.15, key = '' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  patchMaterial(m, {
    key: 'paint' + key,
    uniforms: { tGN: { value: lib.rockN }, tGA: { value: lib.noise }, uGS: { value: scale }, uGK: { value: grit }, uWeather: { value: weather } },
    vertexHead: 'varying vec3 vPN;',
    vertexEnd: 'vPN = normalize(mat3(modelMatrix) * objectNormal);',
    fragmentHead: 'uniform sampler2D tGN; uniform sampler2D tGA; uniform float uGS; uniform float uGK; uniform float uWeather; varying vec3 vPN;\n' + TRI_FUNCS_GLSL,
    fragmentColor: /* glsl */ `
      vec3 pnw = normalize(vPN); vec3 pww = triW(pnw);
      vec4 gn = triS(tGA, vWaterWorldPos, pww, uGS * 0.18);
      diffuseColor.rgb *= 1.0 - uWeather * (gn.r - 0.5) * 1.2 - uWeather * smoothstep(0.62, 0.8, gn.g) * 0.6;
    `,
    fragmentRoughness: 'roughnessFactor = clamp(roughnessFactor + (gn.b - 0.5) * 0.25, 0.05, 1.0);',
    fragmentNormal: /* glsl */ `
      {
        vec3 nd = triNrm(tGN, vWaterWorldPos, pnw, pww, uGS);
        vec3 geoNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 nw = normalize(geoNw + (nd - pnw) * uGK);
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }
    `,
  });
  return m;
}

class PartList {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (geo.index === null) geo = geo; // merge handles non-indexed only if all are; convert all to non-indexed
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
  }
  build(group, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.map) {
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      group.add(mesh);
    }
  }
}

const M4 = () => new THREE.Matrix4();
const at = (x, y, z, rx = 0, ry = 0, rz = 0) => M4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

function hullGeometry() {
  // lofted side shell from keel to sheer line (both sides), closed at the transom
  const zs = 64, ss = 18;
  const pos = [], idx = [];
  for (let i = 0; i <= zs; i++) {
    const z = -31 + (62 * i) / zs;
    const hb = Math.max(0.05, halfBeam(z));
    const top = sheer(z);
    const keel = -3.4 + 0.6 * (1 - THREE.MathUtils.smoothstep(z, -31, -20)) * 2.2;
    const n = THREE.MathUtils.lerp(1.6, 3.0, THREE.MathUtils.smoothstep(z, -28, -12));
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j <= ss; j++) {
        const t = j / ss; // 0 = keel centre, 1 = sheer
        let x, y;
        if (t < 0.7) {
          const a = (t / 0.7) * Math.PI / 2;
          const c = Math.cos(a), s = Math.sin(a);
          x = hb * Math.pow(s, 2 / n);
          y = keel + (0 - keel) * (1 - Math.pow(c, 2 / n));
        } else {
          x = hb * (1 + (t - 0.7) * 0.05);
          y = (top) * ((t - 0.7) / 0.3);
        }
        pos.push(side * x, y, z);
      }
    }
  }
  const row = (ss + 1) * 2;
  for (let i = 0; i < zs; i++) for (let s = 0; s < 2; s++) for (let j = 0; j < ss; j++) {
    const a = i * row + s * (ss + 1) + j, b = a + 1, c = a + row, d = c + 1;
    if (s === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the research vessel. Returns {group, colliders: [{matrix, half}], walk: {...}, anchors}.
 */
export function buildShip(engine, { podVisible = true, chamberDetail = true } = {}) {
  const lib = engine.lib;
  const group = new THREE.Group();
  group.name = 'ship';
  const P = new PartList();
  const mats = {
    hull: paint(lib, 0x1f2f44, { rough: 0.5, weather: 0.25, key: 'hull' }),
    boot: paint(lib, 0x6e2620, { rough: 0.6, weather: 0.3, key: 'boot' }),
    white: paint(lib, 0xe9e6de, { rough: 0.45, weather: 0.12, key: 'white' }),
    deck: paint(lib, 0x58645a, { rough: 0.85, grit: 0.9, scale: 1 / 0.25, weather: 0.35, key: 'deck' }),
    yellow: paint(lib, 0xc9a227, { rough: 0.6, weather: 0.25, key: 'yellow' }),
    orange: paint(lib, 0xd2601e, { rough: 0.5, weather: 0.2, key: 'orange' }),
    steel: paint(lib, 0x8a9096, { rough: 0.35, metal: 0.85, grit: 0.15, weather: 0.1, key: 'steel' }),
    dark: paint(lib, 0x2a2d30, { rough: 0.55, metal: 0.3, key: 'dark' }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.05, metalness: 0.9 }),
    rubber: paint(lib, 0x1a1c1e, { rough: 0.9, metal: 0, key: 'rubber' }),
    blue: paint(lib, 0x2f5f8a, { rough: 0.5, key: 'blue' }),
    tank: paint(lib, 0xd8c23a, { rough: 0.35, metal: 0.2, grit: 0.1, weather: 0.08, key: 'tank' }),
    rope: paint(lib, 0xb8a888, { rough: 0.95, grit: 0.6, scale: 1 / 0.05, key: 'rope' }),
    pod: paint(lib, 0xf0eee8, { rough: 0.5, weather: 0.08, key: 'pod' }),
  };
  patchMaterial(mats.glass, { key: 'glass' });
  const colliders = [];
  const boxCol = (x, y, z, hx, hy, hz, ry = 0) => colliders.push({ matrix: at(x, y, z, 0, ry, 0), half: new THREE.Vector3(hx, hy, hz) });
  const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, col = false) => {
    P.add(mat, new THREE.BoxGeometry(w, h, d), at(x, y, z, rx, ry, rz));
    if (col) boxCol(x, y, z, w / 2, h / 2, d / 2, ry);
  };
  const cyl = (mat, r, len, x, y, z, axis = 'y', seg = 20, r2 = r) => {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    const m = axis === 'x' ? at(x, y, z, 0, 0, Math.PI / 2) : axis === 'z' ? at(x, y, z, Math.PI / 2, 0, 0) : at(x, y, z);
    P.add(mat, g, m);
  };
  const tube = (mat, pts, r, seg = 8) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.01);
    P.add(mat, new THREE.TubeGeometry(curve, Math.max(2, pts.length * 4), r, seg, false));
  };

  // ---------------- hull ----------------
  const hull = hullGeometry();
  // split colours by height: boot-topping below the waterline, dark blue above
  P.add(mats.hull, hull);
  const boot = hullGeometry();
  boot.scale(1.002, 1, 1.0);
  const bp = boot.getAttribute('position');
  for (let i = 0; i < bp.count; i++) if (bp.getY(i) > 0.15) bp.setY(i, 0.15);
  boot.computeVertexNormals();
  P.add(mats.boot, boot);
  // transom
  const tr = new THREE.Shape();
  const hbT = halfBeam(31) * 0.995;
  tr.moveTo(-hbT, -1.2); tr.lineTo(hbT, -1.2); tr.lineTo(hbT, sheer(31)); tr.lineTo(-hbT, sheer(31)); tr.closePath();
  P.add(mats.hull, new THREE.ShapeGeometry(tr), at(0, 0, 31.0));

  // ---------------- decks ----------------
  const D = SHIP.deckY;
  // aft working deck
  const deckShape = new THREE.Shape();
  const pts = [];
  for (let z = -12; z <= 31; z += 1) pts.push(new THREE.Vector2(halfBeam(z) - 0.12, -z));
  for (let i = pts.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(-pts[i].x, pts[i].y));
  deckShape.setFromPoints(pts.reverse());
  const deckGeo = new THREE.ShapeGeometry(deckShape);
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, D, 0);
  P.add(mats.deck, deckGeo);
  // yellow walkway lines
  for (const x of [-2.6, 2.6]) box(mats.yellow, 0.08, 0.004, 26, x, D + 0.003, 17);
  box(mats.yellow, 5.2, 0.004, 0.08, 0, D + 0.003, 4);
  // fore deck (higher)
  const fore = new THREE.Shape();
  const fp = [];
  for (let z = -30.5; z <= -12; z += 0.5) fp.push(new THREE.Vector2(halfBeam(z) - 0.12, -z));
  for (let i = fp.length - 1; i >= 0; i--) fp.push(new THREE.Vector2(-fp[i].x, fp[i].y));
  fore.setFromPoints(fp.reverse());
  const fg = new THREE.ShapeGeometry(fore); fg.rotateX(-Math.PI / 2); fg.translate(0, D + 1.6, 0);
  P.add(mats.deck, fg);

  // ---------------- superstructure ----------------
  box(mats.white, 10.8, 3.0, 20, 0, D + 1.5, -12, 0, 0, 0, true);
  box(mats.white, 10.0, 2.8, 14, 0, D + 4.4, -13);
  box(mats.white, 12.0, 2.6, 9, 0, D + 7.1, -14);
  box(mats.white, 0.9, 1.2, 9.1, 0, D + 8.95, -14);
  // windows
  for (let i = 0; i < 9; i++) box(mats.glass, 1.0, 0.9, 0.06, -4.4 + i * 1.1, D + 7.4, -9.47);
  for (let i = 0; i < 6; i++) { box(mats.glass, 0.06, 0.8, 1.0, 6.02, D + 7.4, -17 + i * 1.3); box(mats.glass, 0.06, 0.8, 1.0, -6.02, D + 7.4, -17 + i * 1.3); }
  for (let i = 0; i < 7; i++) { box(mats.glass, 0.06, 0.55, 0.8, 5.42, D + 1.8, -20 + i * 2.6); box(mats.glass, 0.06, 0.55, 0.8, -5.42, D + 1.8, -20 + i * 2.6); }
  for (let i = 0; i < 6; i++) box(mats.glass, 0.7, 0.55, 0.06, -3.6 + i * 1.45, D + 4.6, -5.97);
  // aft door
  box(mats.dark, 1.0, 2.0, 0.06, 2.2, D + 1.0, -1.97);
  box(mats.dark, 1.0, 2.0, 0.06, -2.2, D + 1.0, -1.97);
  // mast & radar
  cyl(mats.white, 0.18, 6, 0, D + 12.0, -14.5, 'y', 12);
  box(mats.white, 3.2, 0.12, 0.2, 0, D + 13.2, -14.5);
  box(mats.dark, 2.4, 0.12, 0.3, 0, D + 14.6, -14.5);
  cyl(mats.white, 0.35, 0.3, 1.2, D + 13.4, -14.5);
  cyl(mats.white, 0.35, 0.3, -1.2, D + 13.4, -14.5);
  // funnel
  box(mats.white, 2.2, 3.0, 3.0, 0, D + 7.0, -4.5);
  box(mats.dark, 2.0, 0.4, 2.8, 0, D + 8.6, -4.5);
  // life raft canisters
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) cyl(mats.white, 0.38, 1.3, s * 5.7, D + 3.4, -18 + i * 1.6, 'z', 14);

  // ---------------- bulwarks & rails ----------------
  for (const s of [-1, 1]) {
    for (let z = -1.5; z < 30.6; z += 1.0) {
      const isGate = s === 1 && z > 22.4 && z < 24.9;
      if (isGate) continue;
      const hb = halfBeam(z + 0.5) - 0.06;
      box(mats.hull, 0.05, 1.0, 1.0, s * hb, D + 0.5, z + 0.5);
      if (Math.round(z) % 2 === 0) box(mats.white, 0.05, 1.0, 0.12, s * (hb - 0.05), D + 0.5, z + 0.5);
    }
    const rail = [];
    for (let z = -1.5; z <= 30.5; z += 1.0) rail.push(new THREE.Vector3(s * (halfBeam(z) - 0.06), D + 1.06, z));
    if (s === -1) tube(mats.white, rail, 0.045, 6);
    else {
      tube(mats.white, rail.filter((p) => p.z <= 22.5), 0.045, 6);
      tube(mats.white, rail.filter((p) => p.z >= 24.8), 0.045, 6);
    }
    colliders.push({ matrix: at(s * (halfBeam(15) + 0.05), D + 0.8, 14.5), half: new THREE.Vector3(0.25, 1.0, 16.5) });
  }
  // transom bulwark (with A-frame opening handled by legs)
  box(mats.hull, 12.2, 0.6, 0.06, 0, D + 0.3, 30.55);
  boxCol(0, D + 0.8, 30.8, 6.5, 1.0, 0.3);
  // ---------------- A-frame ----------------
  for (const s of [-1, 1]) {
    const base = new THREE.Vector3(s * 4.4, D, 29.7);
    const top = new THREE.Vector3(s * 3.9, D + 8.4, 31.6);
    const len = base.distanceTo(top);
    const mid = base.clone().add(top).multiplyScalar(0.5);
    const tilt = Math.atan2(top.z - base.z, top.y - base.y);
    box(mats.orange, 0.5, len, 0.6, mid.x, mid.y, mid.z, tilt, 0, 0);
    box(mats.steel, 0.9, 0.6, 1.2, base.x, D + 0.3, base.z);
    // hydraulic ram
    const rb = new THREE.Vector3(s * 4.4, D + 0.3, 27.0);
    const rt = base.clone().lerp(top, 0.42);
    const rl = rb.distanceTo(rt), rm = rb.clone().add(rt).multiplyScalar(0.5);
    box(mats.steel, 0.2, rl, 0.2, rm.x, rm.y, rm.z, Math.atan2(rt.z - rb.z, rt.y - rb.y), 0, 0);
    boxCol(base.x, D + 1.2, base.z, 0.5, 1.2, 0.6);
  }
  box(mats.orange, 8.4, 0.7, 0.7, 0, D + 8.5, 31.65);
  box(mats.steel, 0.5, 0.9, 0.9, 0, D + 7.7, 31.7);
  tube(mats.dark, [new THREE.Vector3(0, D + 7.3, 31.7), new THREE.Vector3(0, D + 5.0, 31.6), new THREE.Vector3(0, D + 4.0, 31.5)], 0.02, 5);

  // ---------------- winch ----------------
  cyl(mats.dark, 0.75, 2.2, 0, D + 1.2, 13.0, 'x', 28);
  cyl(mats.orange, 0.95, 0.12, -1.15, D + 1.2, 13.0, 'x', 28);
  cyl(mats.orange, 0.95, 0.12, 1.15, D + 1.2, 13.0, 'x', 28);
  box(mats.orange, 3.0, 0.5, 2.2, 0, D + 0.25, 13.0);
  boxCol(0, D + 1.1, 13, 1.6, 1.1, 1.1);
  // lab van (container)
  box(mats.blue, 2.4, 2.6, 6.0, 4.3, D + 1.3, 3.2, 0, 0, 0, true);
  box(mats.dark, 0.04, 2.0, 0.9, 3.08, D + 1.0, 4.6);
  for (let i = 0; i < 12; i++) box(mats.blue, 2.42, 2.4, 0.05, 4.3, D + 1.3, 0.4 + i * 0.5);
  // crane
  cyl(mats.yellow, 0.45, 2.4, -4.4, D + 1.2, 0.2, 'y', 18);
  box(mats.yellow, 0.5, 0.5, 7.5, -4.4, D + 3.2, 3.2, -0.35, 0, 0);
  boxCol(-4.4, D + 1.2, 0.2, 0.5, 1.2, 0.5);

  // ---------------- deck decompression chamber ----------------
  const C = SHIP.chamber;
  cyl(mats.white, 0.95, 4.0, C.x, C.y, C.z, 'z', 36);
  for (const e of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.95, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.45, 1);
    P.add(mats.white, cap, at(C.x, C.y, C.z + e * 2.0, e * Math.PI / 2, 0, 0));
  }
  for (const zz of [-1.4, 1.4]) { box(mats.yellow, 1.7, 0.18, 0.25, C.x, D + 0.09, C.z + zz); box(mats.yellow, 0.25, 0.95, 0.25, C.x - 0.7, D + 0.55, C.z + zz); box(mats.yellow, 0.25, 0.95, 0.25, C.x + 0.7, D + 0.55, C.z + zz); }
  // door ring + door on the aft end
  P.add(mats.steel, new THREE.TorusGeometry(0.46, 0.06, 10, 28), at(C.x, C.y - 0.05, C.z + 2.43));
  P.add(mats.white, new THREE.CylinderGeometry(0.44, 0.44, 0.08, 28), at(C.x, C.y - 0.05, C.z + 2.46, Math.PI / 2, 0, 0));
  cyl(mats.steel, 0.04, 0.45, C.x + 0.35, C.y - 0.05, C.z + 2.52, 'y', 8);
  // viewports
  for (const zz of [-0.8, 0.8]) P.add(mats.glass, new THREE.CylinderGeometry(0.09, 0.09, 0.06, 18), at(C.x + 0.94, C.y + 0.25, C.z + zz, 0, 0, Math.PI / 2));
  // control panel & O2 bank
  box(mats.white, 0.12, 1.3, 1.4, C.x + 1.55, D + 1.1, C.z + 0.2, 0, 0, 0, true);
  box(mats.dark, 0.02, 0.9, 1.1, C.x + 1.48, D + 1.25, C.z + 0.2);
  for (let i = 0; i < 3; i++) P.add(mats.steel, new THREE.CylinderGeometry(0.08, 0.08, 0.04, 20), at(C.x + 1.46, D + 1.45, C.z - 0.2 + i * 0.38, 0, 0, Math.PI / 2));
  for (let i = 0; i < 4; i++) cyl(mats.blue, 0.11, 1.5, C.x - 1.4, D + 0.75, C.z - 1.2 + i * 0.3, 'y', 14);
  boxCol(C.x, C.y, C.z, 1.1, 1.2, 2.5);
  // ---------------- dive station ----------------
  const Bn = SHIP.bench;
  box(mats.dark, 0.7, 0.06, 2.6, Bn.x, D + 0.72, Bn.z);
  for (const zz of [-1.15, 1.15]) for (const xx of [-0.28, 0.28]) box(mats.steel, 0.05, 0.72, 0.05, Bn.x + xx, D + 0.36, Bn.z + zz);
  box(mats.steel, 0.06, 0.9, 2.6, Bn.x + 0.42, D + 1.15, Bn.z);
  boxCol(Bn.x, D + 0.5, Bn.z, 0.5, 0.6, 1.4);
  // spare cylinders in the rack
  for (let i = 0; i < 4; i++) cyl(mats.tank, 0.09, 0.62, Bn.x + 0.3, D + 1.05, Bn.z - 1.0 + i * 0.28, 'y', 16);
  // dive platform (lower step on the starboard quarter)
  const Pf = SHIP.platform;
  box(mats.steel, 1.4, 0.06, 2.4, Pf.x, Pf.y, Pf.z);
  for (let i = 0; i < 9; i++) box(mats.steel, 1.4, 0.04, 0.03, Pf.x, Pf.y + 0.03, Pf.z - 1.1 + i * 0.275);
  box(mats.steel, 0.06, 0.06, 2.4, Pf.x + 0.7, Pf.y + 0.75, Pf.z);
  for (const zz of [-1.15, 1.15]) box(mats.steel, 0.05, 0.75, 0.05, Pf.x + 0.7, Pf.y + 0.4, Pf.z + zz);
  // steps down to the platform
  for (let i = 0; i < 4; i++) box(mats.steel, 0.8, 0.05, 0.4, 5.4 + i * 0.08, D - 0.38 - i * 0.38, 23.6);
  // ---------------- pod cradle ----------------
  if (podVisible) {
    box(mats.yellow, 3.8, 0.3, 0.3, 0, D + 0.15, SHIP.podCradle.z - 1.6);
    box(mats.yellow, 3.8, 0.3, 0.3, 0, D + 0.15, SHIP.podCradle.z + 1.6);
    for (const s of [-1, 1]) box(mats.yellow, 0.3, 0.3, 3.5, s * 1.75, D + 0.15, SHIP.podCradle.z);
    boxCol(0, D + 1.5, SHIP.podCradle.z, 1.9, 1.6, 2.2);
  }
  // bollards & clutter
  for (const [x, z] of [[-5.5, 2], [5.5, 9], [-5.6, 20], [5.6, 28.4], [-5.6, 28.4]]) { cyl(mats.dark, 0.16, 0.5, x, D + 0.25, z, 'y', 14); cyl(mats.dark, 0.2, 0.05, x, D + 0.5, z, 'y', 14); }
  for (const [x, z, r] of [[-3.2, 25.5, 0.45], [2.6, 27.6, 0.38]]) P.add(mats.rope, new THREE.TorusGeometry(r, 0.06, 8, 22), at(x, D + 0.06, z, Math.PI / 2, 0, 0));
  P.add(mats.orange, new THREE.TorusGeometry(0.32, 0.07, 10, 24), at(-halfBeam(18) + 0.05, D + 0.7, 18, 0, Math.PI / 2, 0));
  box(mats.white, 0.8, 0.8, 0.8, -3.0, D + 0.4, 17.0, 0, 0.3, 0, true);
  box(mats.dark, 0.6, 0.5, 0.9, -2.0, D + 0.25, 27.0, 0, -0.2, 0, true);
  // deck lights on poles
  for (const [x, z] of [[-5.9, 10], [5.9, 12], [-5.9, 26]]) { cyl(mats.white, 0.04, 2.6, x, D + 2.3, z, 'y', 8); box(mats.dark, 0.3, 0.2, 0.35, x * 0.95, D + 3.6, z); }

  P.build(group);
  const walk = { xMax: (z) => halfBeam(z) - 0.55, z0: -1.4, z1: 30.2, y: D };
  return { group, colliders, walk, mats };
}

/** Just the hull, rudder and propeller — what a diver sees from below. */
export function buildHullOnly(engine) {
  const lib = engine.lib;
  const group = new THREE.Group();
  group.name = 'hullFromBelow';
  const P = new PartList();
  const hullM = paint(lib, 0x1f2f44, { rough: 0.5, weather: 0.3, key: 'hull' });
  const bootM = paint(lib, 0x5a221e, { rough: 0.7, weather: 0.45, key: 'boot' });
  const steel = paint(lib, 0x6a6458, { rough: 0.5, metal: 0.6, weather: 0.5, key: 'steelw' });
  P.add(hullM, hullGeometry());
  const boot = hullGeometry();
  const bp = boot.getAttribute('position');
  for (let i = 0; i < bp.count; i++) if (bp.getY(i) > 0.15) bp.setY(i, 0.15);
  boot.computeVertexNormals();
  P.add(bootM, boot);
  P.add(steel, new THREE.BoxGeometry(0.25, 3.0, 2.2), at(0, -2.0, 29.2));
  for (let i = 0; i < 4; i++) P.add(steel, new THREE.BoxGeometry(0.06, 1.1, 0.35), at(0, -2.4, 27.8, 0, 0, (i * Math.PI) / 2 + 0.3));
  P.add(steel, new THREE.CylinderGeometry(0.22, 0.22, 2.2, 14), at(0, -2.4, 26.8, Math.PI / 2, 0, 0));
  P.build(group, { cast: false, receive: false });
  return group;
}
