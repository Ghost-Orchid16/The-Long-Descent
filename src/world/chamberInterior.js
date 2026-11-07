import * as THREE from 'three';
import { SHIP } from './ship.js';
import { patchMaterial } from '../render/water/patch.js';
import { gaugeSVG } from '../ui/svg.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mat(color, rough = 0.6, metal = 0, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...opts });
  patchMaterial(m, { key: 'chamber' + (opts.side === THREE.BackSide ? 'B' : '') });
  return m;
}

/** Canvas texture from an SVG string (drawn asynchronously once the image decodes). */
function svgTexture(svg, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => { c.getContext('2d').drawImage(img, 0, 0, size, size); tex.needsUpdate = true; };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return tex;
}

/**
 * Interior of the deck decompression chamber, in ship-local coordinates (the chamber axis runs along z).
 * Returns { group, seat, gauge {needle, set(depth)}, supply, exhaust (handwheels), masks [], lights [] }.
 */
export function buildChamberInterior() {
  const C = SHIP.chamber;
  const g = new THREE.Group();
  g.name = 'chamberInterior';
  const R = 0.9, L = 3.9;
  const paint = mat(0xd8dccb, 0.55, 0.05, { side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 40, 1, true), paint);
  shell.rotation.x = Math.PI / 2; shell.position.copy(C);
  g.add(shell);
  for (const e of [-1, 1]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint);
    dome.scale.set(1, 0.42, 1);
    dome.rotation.x = e * Math.PI / 2; dome.position.set(C.x, C.y, C.z + e * L / 2);
    g.add(dome);
  }
  const steel = mat(0x8a9094, 0.4, 0.6), dark = mat(0x2a2e31, 0.6, 0.3), wood = mat(0x8a6a48, 0.7), orange = mat(0xd86a24, 0.5), green = mat(0x3e8a54, 0.5, 0.2), red = mat(0xb8382a, 0.5, 0.2), black = mat(0x141618, 0.6);
  // welded ring seams and the deck boards
  for (const z of [-1.3, 0, 1.3]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.01, 0.012, 6, 48), mat(0xc8ccbc, 0.5, 0.1));
    ring.position.set(C.x, C.y, C.z + z);
    g.add(ring);
  }
  const floorY = C.y - 0.52;
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, L - 0.2), wood);
    b.position.set(C.x - 0.52 + i * 0.26, floorY, C.z);
    g.add(b);
  }
  // benches along both sides
  for (const s of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 2.8), wood);
    seat.position.set(C.x + s * 0.5, floorY + 0.36, C.z - 0.25);
    g.add(seat);
    for (const z of [-1.3, 0.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.04), steel); leg.position.set(C.x + s * 0.42, floorY + 0.18, C.z - 0.25 + z); g.add(leg); }
  }
  // the door (aft end) with its dogging wheel
  const doorZ = C.z + L / 2 + 0.25;
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 32), mat(0xc8ccbc, 0.5, 0.1));
  door.rotation.x = Math.PI / 2; door.position.set(C.x, C.y - 0.05, doorZ - 0.18);
  g.add(door);
  const dw = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.015, 8, 24), steel); dw.position.set(C.x, C.y - 0.05, doorZ - 0.23); g.add(dw);
  // ceiling lights
  const lights = [];
  for (const z of [-0.9, 0.9]) {
    const fix = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.05, 16), mat(0xfff6e0, 0.3, 0, { emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 2.2 }));
    fix.position.set(C.x, C.y + R - 0.05, C.z + z);
    g.add(fix);
    const pl = new THREE.PointLight(0xffe8c8, 2.4, 5, 2);
    pl.position.set(C.x, C.y + R - 0.15, C.z + z);
    g.add(pl); lights.push(pl);
  }
  // BIBS oxygen masks on their hoses
  const masks = [];
  for (const z of [-0.35, 0.45]) {
    const m = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), orange);
    cup.rotation.x = Math.PI / 2; cup.scale.set(1, 1, 0.8);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, -0.04), V(0.02, 0.15, -0.05), V(0.06, 0.32, 0.0)]), 12, 0.014, 8), black);
    m.add(cup, hose);
    m.position.set(C.x - 0.38, C.y + 0.3, C.z + z);
    m.rotation.y = Math.PI / 2;
    g.add(m);
    masks.push(m);
  }
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), steel); bracket.position.set(C.x - 0.34, C.y + 0.64, C.z + 0.05); g.add(bracket);
  // panel on the starboard wall: depth gauge, supply + exhaust handwheels, O2 analyser
  const panelX = C.x + 0.62;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.95), mat(0x3a4044, 0.5, 0.4));
  panel.position.set(panelX, C.y + 0.12, C.z + 0.05);
  g.add(panel);
  const faceTex = svgTexture(gaugeSVG(0, { min: 0, max: 30, step: 5, minor: 1, unit: 'msw', label: 'CHAMBER DEPTH', red: [24, 30], green: [14, 16], needle: false, size: 512 }));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false }));
  face.position.set(panelX - 0.025, C.y + 0.24, C.z + 0.05); face.rotation.y = -Math.PI / 2;
  g.add(face);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 8, 40), steel); bezel.position.copy(face.position); bezel.rotation.y = -Math.PI / 2; g.add(bezel);
  const needle = new THREE.Group();
  const nd = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.1, 0.004), mat(0xa22a18, 0.4)); nd.position.y = 0.045; needle.add(nd);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 12), black); hub.rotation.x = Math.PI / 2; needle.add(hub);
  needle.position.copy(face.position).add(V(-0.008, 0, 0)); needle.rotation.y = -Math.PI / 2;
  g.add(needle);
  // gauge mapping: 0 msw at -225°, 30 msw at +45° (same sweep as the SVG), rotation about the face normal
  const setDepth = (dm) => {
    const a = (-225 + (THREE.MathUtils.clamp(dm, 0, 30) / 30) * 270) * (Math.PI / 180);
    needle.rotation.set(0, -Math.PI / 2, 0);
    needle.rotateZ(-(a + Math.PI / 2));
  };
  setDepth(0);
  const wheel = (z, m, label) => {
    const w = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 28), m);
    w.add(rim);
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.012), m); sp.rotation.z = (k * Math.PI) / 3; w.add(sp); }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), steel); stem.rotation.x = Math.PI / 2; stem.position.z = -0.025; w.add(stem);
    w.position.set(panelX - 0.06, C.y - 0.06, C.z + z);
    w.rotation.y = -Math.PI / 2;
    w.userData.label = label;
    g.add(w);
    return w;
  };
  const supply = wheel(-0.22, green, 'Supply'), exhaust = wheel(0.3, red, 'Exhaust');
  // O2 analyser LCD
  const lcdC = document.createElement('canvas'); lcdC.width = 256; lcdC.height = 96;
  const lcdTex = new THREE.CanvasTexture(lcdC); lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }));
  lcd.position.set(panelX - 0.025, C.y + 0.33, C.z + 0.36); lcd.rotation.y = -Math.PI / 2;
  g.add(lcd);
  const drawLCD = (o2, temp, label) => {
    const x = lcdC.getContext('2d');
    x.fillStyle = '#0c1612'; x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#8fe8a8'; x.font = '600 30px Inter, sans-serif';
    x.fillText(`O₂ ${o2.toFixed(1)}%`, 14, 40);
    x.font = '500 20px Inter, sans-serif'; x.fillStyle = '#5fae7c';
    x.fillText(`${temp.toFixed(1)}°C  ${label}`, 14, 76);
    lcdTex.needsUpdate = true;
  };
  drawLCD(20.9, 27.5, 'AIR');
  // viewport glass (outside daylight)
  for (const z of [-0.8, 0.8]) {
    const vp = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), mat(0xbcd8e8, 0.1, 0, { emissive: new THREE.Color(0x9ec8e8), emissiveIntensity: 1.4 }));
    vp.position.set(C.x + R - 0.02, C.y + 0.25, C.z + z); vp.rotation.y = -Math.PI / 2;
    g.add(vp);
  }
  return {
    group: g, lights, masks, supply, exhaust, setDepth, drawLCD,
    seat: V(C.x - 0.42, floorY + 0.36 + 0.72, C.z + 0.05),
    doorPos: V(C.x, C.y - 0.05, doorZ - 0.2),
    panelPos: V(panelX, C.y + 0.1, C.z + 0.05),
  };
}
