import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeWreckMaterial } from '../render/materials.js';
import { patchMaterial } from '../render/water/patch.js';

// A fictional coastal freighter (about 54 m) lying broken-backed on a ledge.
// Local frame: x = along the ship (bow at +x), y = up (keel at 0), z = port (+) / starboard (-).

export const WRECK = { length: 54, beam: 9.6, depth: 5.2, break: -3.5 };

const halfBeam = (x) => {
  const L = WRECK.length / 2;
  const bow = THREE.MathUtils.smoothstep(L - x, 0, 13);
  const stern = 0.82 + 0.18 * THREE.MathUtils.smoothstep(x + L, 0, 6);
  return (WRECK.beam / 2) * Math.pow(bow, 0.6) * stern;
};
const sheer = (x) => WRECK.depth + 0.9 * Math.pow(THREE.MathUtils.smoothstep(x, 8, 27), 2);

function section(x, s) {
  // point on the cross-section at arc fraction s (0 = keel centreline, 1 = bulwark top), starboard side (z < 0)
  const hb = Math.max(0.04, halfBeam(x));
  const rise = 1.6 * Math.pow(THREE.MathUtils.smoothstep(x, 14, 27), 1.6); // the forefoot lifts towards the bow
  const top = sheer(x) + 0.9;
  const r = Math.min(1.3, hb * 0.55);
  const flat = Math.max(0, hb - r), arc = (Math.PI / 2) * r, side = Math.max(0.01, top - rise - r);
  let d = s * (flat + arc + side);
  if (d < flat) return [d, rise];
  d -= flat;
  if (d < arc) { const th = -Math.PI / 2 + d / r; return [hb - r + r * Math.cos(th), rise + r + r * Math.sin(th)]; }
  d -= arc;
  return [hb, rise + r + d];
}

function hullShell(x0, x1, segs = 40, ss = 14) {
  // side shell + bottom as one open loft (port bulwark → keel → starboard bulwark)
  const pos = [], idx = [];
  const cols = ss * 2 + 1;
  for (let i = 0; i <= segs; i++) {
    const x = x0 + (x1 - x0) * (i / segs);
    for (let k = 0; k < cols; k++) {
      const t = (k / (cols - 1)) * 2 - 1; // -1 port top .. 0 keel .. 1 starboard top
      const [zz, y] = section(x, Math.abs(t));
      pos.push(x, y, t < 0 ? zz : -zz);
    }
  }
  for (let i = 0; i < segs; i++) for (let k = 0; k < cols - 1; k++) {
    const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Transom plate closing the stern. */
function transom(x) {
  const hb = halfBeam(x), top = sheer(x) + 0.9;
  const shape = new THREE.Shape();
  shape.moveTo(-hb * 0.75, 0.2); shape.lineTo(hb * 0.75, 0.2); shape.lineTo(hb, 1.2); shape.lineTo(hb, top); shape.lineTo(-hb, top); shape.lineTo(-hb, 1.2); shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateY(Math.PI / 2);
  g.translate(x, 0, 0);
  return g;
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
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true; mesh.castShadow = true;
      group.add(mesh);
    }
  }
}

const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n, 1, false);

/**
 * Build the wreck. Returns { group, colliders: [{type:'box', m, half} | {type:'capsule', a, b, r}] (local),
 * anchors: { recorder, bowLine, morayHoles[], deckPoints[] } } in local coordinates.
 */
export function buildWreck(engine, { seed = 3 } = {}) {
  const lib = engine.lib;
  const steel = makeWreckMaterial(lib, { key: 'hull' });
  const steelLight = makeWreckMaterial(lib, { key: 'deck', foul: 1.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1, metalness: 0 });
  patchMaterial(dark, { key: 'wreckdark' });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.2, metalness: 0.4 });
  patchMaterial(glass, { key: 'wreckglass' });
  const group = new THREE.Group();
  group.name = 'wreck';
  const fore = new Parts(), aft = new Parts();
  const L = WRECK.length / 2, D = WRECK.depth, br = WRECK.break;
  const rnd = (() => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();

  // ---- hull, broken in two just aft of midships
  fore.add(steel, hullShell(br + 0.6, L, 34));
  aft.add(steel, hullShell(-L, br - 0.4, 30));
  aft.add(steel, transom(-L));
  // jagged plates at the break
  for (let k = 0; k < 9; k++) {
    const z = (k / 8 - 0.5) * WRECK.beam * 0.95, y = 0.6 + rnd() * (D - 0.6);
    fore.add(steel, box(0.04, 0.8 + rnd() * 1.6, 0.9 + rnd() * 0.8), M(br + 0.5 + rnd() * 0.5, y, z, rnd() * 0.4, rnd() * 0.6 - 0.3, rnd() * 0.7));
  }
  // ---- main deck with two open hatches forward, one aft of the break
  const deckY = D, t = 0.12;
  const hatches = [[5.5, 11.5], [14.5, 20]];
  const fwdDeck = (x0, x1, hw) => fore.add(steelLight, box(x1 - x0, t, hw * 2), M((x0 + x1) / 2, deckY, 0));
  fwdDeck(br + 0.7, hatches[0][0], WRECK.beam / 2 - 0.1);
  fwdDeck(hatches[0][1], hatches[1][0], WRECK.beam / 2 - 0.1);
  for (const [h0, h1] of hatches) {
    const hw = 2.6;
    // side strips beside each hatch
    for (const s of [-1, 1]) fore.add(steelLight, box(h1 - h0, t, WRECK.beam / 2 - hw - 0.1), M((h0 + h1) / 2, deckY, s * (hw + (WRECK.beam / 2 - hw) / 2)));
    // coamings
    for (const s of [-1, 1]) fore.add(steel, box(h1 - h0 + 0.3, 0.9, 0.14), M((h0 + h1) / 2, deckY + 0.45, s * hw));
    for (const x of [h0, h1]) fore.add(steel, box(0.14, 0.9, hw * 2), M(x, deckY + 0.45, 0));
    // the dark hold below and a few fallen hatch beams
    fore.add(dark, box(h1 - h0 - 0.1, 0.05, hw * 2 - 0.1), M((h0 + h1) / 2, 1.3, 0));
    for (let k = 0; k < 2; k++) fore.add(steel, box(0.25, 0.3, hw * 2 + 0.4), M(h0 + 1.5 + k * 2.5, deckY + 0.95 - k * 1.6, 0, 0, 0, k ? 0.5 : 0));
  }
  // forecastle
  const fcX0 = 21;
  fore.add(steelLight, box(L - 1.5 - fcX0, t, 6.4), M((fcX0 + L - 1.5) / 2, sheer(24) + 0.7, 0));
  fore.add(steel, box(0.12, 1.6, 7.6), M(fcX0, deckY + 0.8, 0));
  fore.add(steel, cyl(0.5, 0.5, 0.9), M(24.5, sheer(24.5) + 1.1, 1.2, 0, 0, 0));
  fore.add(steel, cyl(0.5, 0.5, 0.9), M(24.5, sheer(24.5) + 1.1, -1.2, 0, 0, 0));
  fore.add(dark, cyl(0.28, 0.28, 0.4), M(26.2, sheer(26.2) - 0.4, 2.8, Math.PI / 2, 0, 0)); // hawse pipe
  // aft deck + superstructure
  aft.add(steelLight, box(br - 0.5 + L - 1, t, WRECK.beam - 0.4), M((br - 0.5 - L + 1) / 2, deckY, 0));
  const hx0 = -24.5, hx1 = -15.5;
  aft.add(steel, box(hx1 - hx0, 2.6, 8.0), M((hx0 + hx1) / 2, deckY + 1.3, 0));
  aft.add(steelLight, box(hx1 - hx0 + 0.4, 0.12, 8.4), M((hx0 + hx1) / 2, deckY + 2.65, 0));
  aft.add(steel, box(5.6, 2.3, 6.4), M(-19.8, deckY + 3.85, 0));
  aft.add(steelLight, box(6.2, 0.12, 9.2), M(-19.8, deckY + 5.05, 0)); // bridge roof with wings
  // portholes / windows (dark insets) on the deckhouse and the bridge
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) aft.add(dark, cyl(0.16, 0.16, 0.06, 10), M(hx0 + 1.0 + k * 1.45, deckY + 1.5, s * 4.02, Math.PI / 2, 0, 0));
  for (let k = 0; k < 5; k++) aft.add(dark, box(0.06, 0.8, 0.85), M(-16.98, deckY + 4.1, -2.4 + k * 1.2));
  aft.add(glass, box(0.04, 0.5, 0.5), M(-16.95, deckY + 4.15, 1.2, 0, 0, 0.12));
  // funnel, leaning
  aft.add(steel, cyl(0.95, 1.1, 3.4, 18), M(-21.4, deckY + 6.6, 0, 0, 0, -0.16));
  aft.add(dark, cyl(0.85, 0.85, 0.05, 18), M(-21.67, deckY + 8.3, 0, 0, 0, -0.16));
  // rudder + propeller hub below the counter stern
  aft.add(steel, box(1.8, 3.0, 0.2), M(-L - 0.2, 1.8, 0));
  for (let k = 0; k < 4; k++) aft.add(steel, box(0.9, 0.12, 0.5), M(-L + 1.1, 1.5, 0, (k * Math.PI) / 2 + 0.3, 0, 0).multiply(M(0, 0.45, 0)));
  // ---- masts and derricks
  const mastF = new THREE.Vector3(13, deckY, 0), mastA = new THREE.Vector3(-13, deckY, 0);
  fore.add(steel, cyl(0.2, 0.24, 9.5, 14), M(mastF.x, deckY + 4.75, 0));
  fore.add(steel, box(0.22, 0.22, 3.4), M(mastF.x, deckY + 6.8, 0));
  fore.add(steel, cyl(0.12, 0.12, 8.5, 10), M(mastF.x + 3.6, deckY + 1.6, 0.6, 0, 0.2, -1.32)); // derrick boom resting on the hatch
  fore.add(steel, cyl(0.11, 0.11, 7.0, 10), M(mastF.x - 2.4, deckY + 3.2, -0.4, 0, 0, 0.62)); // boom still topped up
  aft.add(steel, cyl(0.17, 0.2, 6.0, 12), M(mastA.x, deckY + 3.0, 0));
  aft.add(steel, box(0.2, 0.2, 2.6), M(mastA.x, deckY + 4.6, 0));
  // winches, bollards, stanchion stubs and bent rails
  for (const x of [4.6, 13.9, 21.5]) {
    fore.add(steel, box(1.2, 0.8, 1.6), M(x, deckY + 0.45, 1.6));
    fore.add(steel, cyl(0.3, 0.3, 1.7, 12), M(x, deckY + 0.65, 1.6, Math.PI / 2, 0, 0));
  }
  for (let x = br + 1.5; x < 20; x += 2.2) for (const s of [-1, 1]) {
    if (rnd() < 0.25) continue;
    fore.add(steel, cyl(0.035, 0.035, 0.9, 6), M(x, deckY + 0.95, s * (halfBeam(x) - 0.1), rnd() * 0.3 - 0.15, 0, rnd() * 0.3 - 0.15));
  }
  for (let x = -L + 2; x < br - 1; x += 2.2) for (const s of [-1, 1]) {
    if (rnd() < 0.3) continue;
    aft.add(steel, cyl(0.035, 0.035, 0.9, 6), M(x, deckY + 0.95, s * (halfBeam(x) - 0.1), rnd() * 0.3 - 0.15, 0, rnd() * 0.3 - 0.15));
  }
  // cargo spilled in the aft hold area: drums and a crate
  for (let k = 0; k < 7; k++) fore.add(steel, cyl(0.3, 0.3, 0.9, 12), M(16 + rnd() * 3.5, 1.7 + rnd() * 0.4, -1.5 + rnd() * 3, Math.PI / 2 * rnd(), rnd() * 3, rnd()));
  fore.add(steel, box(1.4, 1.0, 1.2), M(7.5, 1.8, 0.8, 0, 0.4, 0.1));

  const gF = new THREE.Group(); gF.name = 'wreck-fore';
  const gA = new THREE.Group(); gA.name = 'wreck-aft';
  fore.build(gF); aft.build(gA);
  // the aft section settled further over and twisted at the break
  gA.position.set(br, 0, 0);
  gA.rotation.set(0.09, 0.06, -0.02);
  gA.children.forEach((c) => c.position.set(-br, 0, 0));
  group.add(gF, gA);
  gA.updateMatrix();

  // ---- the expedition's acoustic recorder clamped to the forward mast
  const rec = new THREE.Group(); rec.name = 'recorder';
  const yel = new THREE.MeshStandardMaterial({ color: 0xe8b818, roughness: 0.4, metalness: 0.05 });
  patchMaterial(yel, { key: 'recorderY' });
  const blk = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.2 });
  patchMaterial(blk, { key: 'recorderB' });
  const tube = new THREE.Mesh(cyl(0.075, 0.075, 0.5, 18), yel);
  const cap = new THREE.Mesh(cyl(0.08, 0.08, 0.06, 18), blk); cap.position.y = 0.27;
  const hyd = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), blk); hyd.position.y = 0.34;
  const band1 = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 24), blk); band1.rotation.x = Math.PI / 2; band1.position.set(-0.13, 0.12, 0);
  const band2 = band1.clone(); band2.position.y = -0.12;
  rec.add(tube, cap, hyd, band1, band2);
  rec.position.set(mastF.x + 0.28, deckY + 4.4, 0.0);
  gF.add(rec);

  // ---- colliders (local to the wreck group)
  const colliders = [];
  const addBox = (cx, cy, cz, hx, hy, hz, parentM = null) => {
    const m = new THREE.Matrix4().makeTranslation(cx, cy, cz);
    if (parentM) m.premultiply(parentM);
    colliders.push({ type: 'box', m, half: new THREE.Vector3(hx, hy, hz) });
  };
  const aftM = gA.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(-br, 0, 0));
  addBox((br + 0.6 + L) / 2, D / 2 + 0.3, 0, (L - br - 0.6) / 2, D / 2 + 0.25, WRECK.beam / 2 - 0.2);
  addBox((L + fcX0) / 2, D + 0.9, 0, (L - fcX0) / 2 - 0.5, 0.9, 3.2);
  addBox((-L + br - 0.4) / 2, D / 2 + 0.3, 0, (L + br - 0.4) / 2, D / 2 + 0.25, WRECK.beam / 2 - 0.2, aftM);
  addBox((hx0 + hx1) / 2, D + 1.3, 0, (hx1 - hx0) / 2, 1.3, 4.0, aftM);
  addBox(-19.8, D + 3.85, 0, 2.8, 1.15, 3.2, aftM);
  colliders.push({ type: 'capsule', a: new THREE.Vector3(mastF.x, D, 0), b: new THREE.Vector3(mastF.x, D + 9.5, 0), r: 0.3 });
  colliders.push({ type: 'capsule', a: new THREE.Vector3(-21.4, D + 5, 0).applyMatrix4(aftM), b: new THREE.Vector3(-21.9, D + 8.2, 0).applyMatrix4(aftM), r: 1.1 });
  colliders.push({ type: 'capsule', a: new THREE.Vector3(mastA.x, D, 0).applyMatrix4(aftM), b: new THREE.Vector3(mastA.x, D + 6, 0).applyMatrix4(aftM), r: 0.28 });

  // ---- anchors for dressing and gameplay
  const deckPoints = [];
  for (let k = 0; k < 140; k++) {
    const x = br + 1 + rnd() * (L - br - 3);
    const inHatch = hatches.some(([a, b]) => x > a - 0.2 && x < b + 0.2) && rnd() < 0.8;
    const z = (rnd() - 0.5) * 2 * (halfBeam(x) - 0.3);
    if (inHatch && Math.abs(z) < 2.7) continue;
    deckPoints.push(new THREE.Vector3(x, x > fcX0 ? sheer(24) + 0.76 : D + 0.06, z));
  }
  const aftPts = [];
  for (let k = 0; k < 70; k++) {
    const x = -L + 1.5 + rnd() * (L + br - 3);
    const z = (rnd() - 0.5) * 2 * (halfBeam(x) - 0.3);
    const onHouse = x > hx0 && x < hx1;
    aftPts.push(new THREE.Vector3(x, onHouse ? D + 2.72 : D + 0.06, z).applyMatrix4(aftM));
  }
  return {
    group, colliders, recorder: rec, hatches,
    anchors: {
      recorder: rec.position.clone(),
      bowLine: new THREE.Vector3(L - 1.2, sheer(L - 1.2) + 1.0, 0),
      morayHoles: [{ p: new THREE.Vector3(8.5, 0.35, -WRECK.beam / 2 - 0.15), dir: new THREE.Vector3(0.1, 0.05, -1) }, { p: new THREE.Vector3(-8, 0.4, WRECK.beam / 2 + 0.1).applyMatrix4(aftM), dir: new THREE.Vector3(0, 0.1, 1) }],
      deckPoints: deckPoints.concat(aftPts),
    },
  };
}
