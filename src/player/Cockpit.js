import * as THREE from 'three';
import { POD } from '../world/podModel.js';

// Pod interior: padded titanium sphere with the acrylic viewport, the console with three screens (life support,
// navigation, sonar), overhead checklist switches, the CO2 scrubber on the left wall and the breaker panel on the
// right. Pod-local coordinates (-Z forward). Interior materials ignore the sun and sky (only cabin lights count).

const _interiorChunk = THREE.ShaderChunk.lights_fragment_begin
  .replace('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0')
  .replace('#if ( NUM_HEMI_LIGHTS > 0 )', '#if 0');

export function interiorMaterial(params = {}, { glow = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1, ...params });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', _interiorChunk); };
  m.customProgramCacheKey = () => 'cockpitInterior';
  m.envMapIntensity = 0.05;
  void glow;
  return m;
}

function canvasScreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, ctx: c.getContext('2d'), tex };
}

function labelTexture(text, { w = 256, h = 64, color = '#cfe1e8', bg = 'rgba(0,0,0,0)', size = 28 } = {}) {
  const s = canvasScreen(w, h);
  s.ctx.fillStyle = bg; s.ctx.fillRect(0, 0, w, h);
  s.ctx.fillStyle = color; s.ctx.font = `600 ${size}px Inter, sans-serif`; s.ctx.textAlign = 'center'; s.ctx.textBaseline = 'middle';
  s.ctx.fillText(text, w / 2, h / 2 + 2);
  s.tex.needsUpdate = true;
  return s.tex;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Acrylic viewport: faint reflections, scratches and condensation creeping in from the rim. */
function viewportGlass(r, halfAngle) {
  const geo = new THREE.SphereGeometry(r, 48, 12, 0, Math.PI * 2, 0, halfAngle + 0.02);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), POD.viewDir));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uFog: { value: 0.35 }, uTime: { value: 0 }, uAxis: { value: POD.viewDir.clone() }, uHalf: { value: halfAngle }, uTint: { value: new THREE.Color(0.75, 0.85, 0.9) }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main() {
        vP = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFog; uniform float uTime; uniform vec3 uAxis; uniform float uHalf; uniform vec3 uTint; uniform float uLight;
      varying vec3 vP; varying vec3 vN; varying vec3 vV;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vP);
        float ang = acos(clamp(dot(d, uAxis), -1.0, 1.0)) / uHalf;   // 0 centre .. 1 rim
        vec3 t1 = normalize(cross(uAxis, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(uAxis, t1);
        vec2 q = vec2(dot(d, t1), dot(d, t2)) * 18.0;
        float cond = smoothstep(0.55, 1.0, ang + (n2(q * 0.6) - 0.5) * 0.35 + (n2(q * 2.3) - 0.5) * 0.12) * uFog;
        float drops = step(0.93, n2(q * 4.0)) * smoothstep(0.6, 0.95, ang) * uFog;
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.0);
        float scratch = smoothstep(0.985, 1.0, n2(vec2(q.x * 0.4, q.y * 9.0))) * 0.08;
        // condensation only shows where light reaches it (cabin lamp behind, floods outside)
        vec3 col = (uTint * (cond * 0.55 + drops * 0.3) + vec3(0.9, 0.95, 1.0) * (fres * 0.06 + scratch)) * uLight;
        float a = clamp((cond * 0.5 + drops * 0.25) * clamp(uLight * 1.5, 0.15, 1.0) + fres * 0.08 + scratch + 0.015, 0.0, 0.85);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 10;
  return m;
}

export class Cockpit {
  constructor() {
    const g = new THREE.Group();
    g.name = 'cockpit';
    this.group = g;
    const R = POD.sphereR - 0.09;
    const wallM = interiorMaterial({ color: 0x4a5054, roughness: 0.85, metalness: 0.05, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 24, 0, Math.PI * 2, POD.viewHalfAngle + 0.04, Math.PI - POD.viewHalfAngle - 0.04), wallM);
    shell.geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), POD.viewDir));
    g.add(shell);
    // padding panels (quilted look): a few raised pads on the walls
    const padM = interiorMaterial({ color: 0x2f3437, roughness: 0.95 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const dir = V(Math.cos(a), Math.sin(a) * 0.6 + 0.1, 0.55).normalize();
      if (dir.z < 0.2) continue;
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.05), padM);
      pad.position.copy(dir).multiplyScalar(R - 0.04);
      pad.lookAt(0, 0, 0);
      g.add(pad);
    }
    this.glass = viewportGlass(POD.sphereR - 0.03, POD.viewHalfAngle);
    g.add(this.glass);
    const metal = interiorMaterial({ color: 0x6c7478, roughness: 0.45, metalness: 0.6 });
    const dark = interiorMaterial({ color: 0x1a1d1f, roughness: 0.6, metalness: 0.3 });
    this.mats = { metal, dark, padM, wallM };
    // viewport ring inside
    const vr = new THREE.Mesh(new THREE.TorusGeometry(R * Math.sin(POD.viewHalfAngle) + 0.02, 0.035, 8, 48), metal);
    vr.position.copy(POD.viewDir).multiplyScalar(R * Math.cos(POD.viewHalfAngle));
    vr.quaternion.setFromUnitVectors(V(0, 0, 1), POD.viewDir);
    g.add(vr);
    // console below the viewport
    const consoleM = interiorMaterial({ color: 0x23272a, roughness: 0.55, metalness: 0.2 });
    const bank = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.42, 0.08), consoleM);
    bank.position.set(0, -0.48, -0.62); bank.rotation.x = -0.75;
    g.add(bank);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.08), consoleM);
      wing.position.set(s * 0.72, -0.4, -0.44); wing.rotation.set(-0.7, -s * 0.75, 0);
      g.add(wing);
    }
    this.screens = {};
    const screen = (name, w, h, pw, ph, pos, rot) => {
      const s = canvasScreen(w, h);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false }));
      m.position.copy(pos); m.rotation.copy(rot);
      g.add(m);
      this.screens[name] = { ...s, mesh: m, w, h };
    };
    // screens sit 1 cm proud of the console faces
    const onBank = (x, y) => V(x, -0.48 + y * Math.cos(0.75), -0.62 + y * Math.sin(0.75)).add(V(0, Math.sin(0.75), Math.cos(0.75)).multiplyScalar(-0.05));
    void onBank;
    screen('nav', 512, 320, 0.42, 0.26, V(0, -0.43, -0.6), new THREE.Euler(-0.75, 0, 0));
    screen('life', 400, 320, 0.3, 0.24, V(-0.69, -0.36, -0.43), new THREE.Euler(-0.7, 0.75, 0, 'YXZ'));
    screen('sonar', 400, 400, 0.27, 0.27, V(0.69, -0.36, -0.43), new THREE.Euler(-0.7, -0.75, 0, 'YXZ'));
    // overhead checklist panel with five toggle switches
    const over = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.32), consoleM);
    over.position.set(0, 0.78, -0.32); over.rotation.x = 0.55;
    g.add(over);
    this.switches = [];
    const swDefs = [['hatch', 'HATCH SEAL'], ['life', 'LIFE SUPPORT'], ['scrubber', 'CO₂ SCRUBBER'], ['ballast', 'BALLAST'], ['comms', 'COMMS']];
    swDefs.forEach(([id, label], i) => {
      const sw = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.07), metal);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.07, 8), metal);
      lever.position.y = 0.035; lever.geometry.translate(0, 0, 0);
      const pivot = new THREE.Group(); pivot.add(lever); pivot.rotation.x = 0.5;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x401010, toneMapped: false }));
      led.position.set(0, 0.012, 0.045);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshBasicMaterial({ map: labelTexture(label, { w: 320, h: 80, size: 40 }), transparent: true, toneMapped: false }));
      tag.rotation.x = -Math.PI / 2; tag.position.set(0, 0.012, -0.062);
      sw.add(base, pivot, led, tag);
      sw.position.set(-0.34 + i * 0.17, 0.0, 0.0);
      const holder = new THREE.Group(); holder.position.copy(over.position); holder.rotation.copy(over.rotation);
      holder.add(sw); holder.position.y -= 0.035;
      holder.rotateX(Math.PI); // switches face down towards the pilot
      g.add(holder);
      this.switches.push({ id, label, group: sw, pivot, led, on: false });
    });
    // CO2 scrubber unit on the left wall: housing, hinged cover, canister, fan switch, spare canister
    const scr = new THREE.Group();
    scr.position.set(-0.86, -0.12, 0.05); scr.rotation.y = Math.PI / 2;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.16), consoleM);
    housing.position.z = -0.02;
    scr.add(housing);
    const cover = new THREE.Group();
    const coverM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.02), interiorMaterial({ color: 0x5b6468, roughness: 0.5, metalness: 0.5 }));
    coverM.position.x = 0.16; cover.add(coverM);
    cover.position.set(-0.16, 0, 0.07);
    scr.add(cover);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 20), interiorMaterial({ color: 0xc9c2ae, roughness: 0.6 }));
    can.position.set(0, 0, 0.0);
    scr.add(can);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), dark); fan.rotation.x = Math.PI / 2; fan.position.set(0.12, 0.24, 0.07);
    const fanBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), new THREE.MeshBasicMaterial({ color: 0x3a1010, toneMapped: false }));
    fanBtn.rotation.x = Math.PI / 2; fanBtn.position.set(-0.12, 0.24, 0.08);
    scr.add(fan, fanBtn);
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 20), interiorMaterial({ color: 0xece6d2, roughness: 0.6 }));
    spare.position.set(0.0, -0.36, 0.03);
    scr.add(spare);
    const scrTag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.04), new THREE.MeshBasicMaterial({ map: labelTexture('CO₂ SCRUBBER', { size: 26 }), transparent: true, toneMapped: false }));
    scrTag.position.set(0, 0.23, 0.071);
    scr.add(scrTag);
    g.add(scr);
    this.scrubber = { root: scr, cover, can, fan, fanBtn, spare, open: false };
    // breaker panel on the right wall
    const brk = new THREE.Group();
    brk.position.set(0.86, -0.08, 0.02); brk.rotation.y = -Math.PI / 2;
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), consoleM); brk.add(bp);
    this.breakers = [];
    [['life', 'LIFE SUPPORT'], ['lights', 'LIGHTS'], ['thrust', 'THRUSTERS']].forEach(([id, label], i) => {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.04), dark); b.add(body);
      const tog = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), interiorMaterial({ color: 0xd8d2c0, roughness: 0.4 })); tog.position.set(0, 0.015, 0.03); b.add(tog);
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.03), new THREE.MeshBasicMaterial({ map: labelTexture(label, { size: 22 }), transparent: true, toneMapped: false })); t.position.set(0, -0.075, 0.03); b.add(t);
      b.position.set(-0.12 + i * 0.12, 0.02, 0.03);
      brk.add(b);
      this.breakers.push({ id, label, group: b, toggle: tog, on: true });
    });
    const brkTag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.035), new THREE.MeshBasicMaterial({ map: labelTexture('BREAKERS', { size: 24 }), transparent: true, toneMapped: false }));
    brkTag.position.set(0, 0.125, 0.03); brk.add(brkTag);
    g.add(brk);
    this.breakerPanel = brk;
    // hatch ring overhead and the seat back
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 28), metal); hatch.position.set(0, R - 0.05, 0.12); hatch.rotation.x = Math.PI / 2; g.add(hatch);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.015, 8, 24), metal); wheel.position.set(0, R - 0.12, 0.12); wheel.rotation.x = Math.PI / 2; g.add(wheel);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.5), padM); seat.position.set(0, -0.55, 0.3); g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.1), padM); back.position.set(0, -0.15, 0.62); back.rotation.x = -0.15; g.add(back);
    // cabin lights: dim white dome light and the red emergency light (off)
    this.cabinLight = new THREE.PointLight(0xdfe8ff, 0.5, 3.2, 2);
    this.cabinLight.position.set(0, 0.6, 0.25);
    this.redLight = new THREE.PointLight(0xff2a1a, 0.0, 3.2, 2);
    this.redLight.position.set(0, 0.55, 0.4);
    g.add(this.cabinLight, this.redLight);
    // light spill from the screens onto the console
    this.screenLight = new THREE.PointLight(0x9fd6e8, 0.35, 1.4, 2);
    this.screenLight.position.set(0, -0.32, -0.42);
    g.add(this.screenLight);
    this.t = 0;
  }

  setSwitch(sw, on) {
    sw.on = on;
    sw.pivot.rotation.x = on ? -0.5 : 0.5;
    sw.led.material.color.set(on ? 0x40ff70 : 0x401010);
  }

  setBreaker(b, on) { b.on = on; b.toggle.position.y = on ? 0.015 : -0.015; }

  setScrubberOpen(open) { this.scrubber.open = open; this.scrubber.cover.rotation.y = open ? -1.9 : 0; }

  /** Draw all screens. s: pod state snapshot. */
  draw(s) {
    this._nav(s); this._life(s); this._sonar(s);
  }

  _frame(ctx, w, h, title) {
    ctx.fillStyle = '#040a0d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(143,196,216,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = 'rgba(143,196,216,0.7)'; ctx.font = '600 15px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, 16, 14);
  }

  _nav(s) {
    const S = this.screens.nav, ctx = S.ctx, w = S.w, h = S.h;
    if (s.power < 0.5) { ctx.fillStyle = '#020405'; ctx.fillRect(0, 0, w, h); S.tex.needsUpdate = true; return; }
    this._frame(ctx, w, h, 'NAVIGATION');
    ctx.fillStyle = '#e8f1f5'; ctx.textBaseline = 'alphabetic';
    ctx.font = '300 74px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(Math.round(s.depth).toLocaleString('en-US'), 18, 112);
    ctx.font = '400 22px Inter, sans-serif'; ctx.fillStyle = 'rgba(232,241,245,0.6)';
    ctx.fillText('m depth', 22, 140);
    const vs = s.vSpeed;
    ctx.textAlign = 'right'; ctx.font = '500 22px Inter, sans-serif'; ctx.fillStyle = Math.abs(vs) > 0.05 ? '#8fc4d8' : 'rgba(232,241,245,0.5)';
    ctx.fillText(`${vs > 0.05 ? '▲' : vs < -0.05 ? '▼' : '■'} ${Math.abs(vs * 60).toFixed(0)} m/min`, w - 18, 60);
    ctx.fillStyle = '#e8f1f5'; ctx.font = '400 26px Inter, sans-serif';
    ctx.fillText(`${s.pressureAtm.toFixed(s.pressureAtm < 100 ? 1 : 0)} atm`, w - 18, 100);
    ctx.fillStyle = 'rgba(232,241,245,0.6)'; ctx.font = '400 18px Inter, sans-serif';
    ctx.fillText('outside pressure', w - 18, 124);
    ctx.fillStyle = '#e8f1f5'; ctx.font = '400 26px Inter, sans-serif';
    ctx.fillText(`${s.waterTemp.toFixed(1)} °C`, w - 18, 164);
    ctx.fillStyle = 'rgba(232,241,245,0.6)'; ctx.font = '400 18px Inter, sans-serif';
    ctx.fillText('water', w - 18, 186);
    // heading tape
    const hy = 226, hd = s.heading;
    ctx.save(); ctx.beginPath(); ctx.rect(16, hy - 10, w - 32, 66); ctx.clip();
    ctx.strokeStyle = 'rgba(232,241,245,0.5)'; ctx.fillStyle = '#e8f1f5'; ctx.textAlign = 'center'; ctx.font = '500 18px Inter, sans-serif';
    for (let a = -90; a <= 90; a += 5) {
      const deg = Math.round(hd + a), x = w / 2 + (a - (hd - Math.round(hd))) * 2.6;
      const n = ((deg % 360) + 360) % 360;
      ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, hy + (n % 15 === 0 ? 16 : 8)); ctx.lineWidth = 1.5; ctx.stroke();
      if (n % 45 === 0) ctx.fillText({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[n], x, hy + 38);
    }
    ctx.restore();
    ctx.fillStyle = '#e8b24a'; ctx.beginPath(); ctx.moveTo(w / 2 - 7, hy - 10); ctx.lineTo(w / 2 + 7, hy - 10); ctx.lineTo(w / 2, hy + 2); ctx.fill();
    ctx.fillStyle = 'rgba(232,241,245,0.75)'; ctx.font = '500 18px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${String(Math.round(((hd % 360) + 360) % 360)).padStart(3, '0')}°`, w / 2, h - 20);
    if (s.warn) { ctx.fillStyle = '#e5603f'; ctx.font = '600 20px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(s.warn, 18, h - 20); }
    S.tex.needsUpdate = true;
  }

  _bar(ctx, x, y, w, label, val, unit, frac, color) {
    ctx.fillStyle = 'rgba(232,241,245,0.6)'; ctx.font = '500 16px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x, y);
    ctx.textAlign = 'right'; ctx.fillStyle = color; ctx.font = '400 28px Inter, sans-serif';
    ctx.fillText(`${val}`, x + w - 46, y + 2);
    ctx.font = '400 16px Inter, sans-serif'; ctx.fillStyle = 'rgba(232,241,245,0.6)'; ctx.fillText(unit, x + w, y);
    ctx.fillStyle = 'rgba(232,241,245,0.12)'; ctx.fillRect(x, y + 10, w, 6);
    ctx.fillStyle = color; ctx.fillRect(x, y + 10, w * THREE.MathUtils.clamp(frac, 0, 1), 6);
  }

  _life(s) {
    const S = this.screens.life, ctx = S.ctx, w = S.w, h = S.h;
    if (s.power < 0.5 && !s.lifeOnBattery) { ctx.fillStyle = '#020405'; ctx.fillRect(0, 0, w, h); S.tex.needsUpdate = true; return; }
    this._frame(ctx, w, h, 'LIFE SUPPORT');
    const co2c = s.co2 > 5000 ? '#e5603f' : s.co2 > 2500 ? '#e8b24a' : '#7fc8a0';
    this._bar(ctx, 18, 78, w - 36, 'O₂', s.o2.toFixed(1), '%', (s.o2 - 17) / 6, s.o2 < 19 ? '#e8b24a' : '#7fc8a0');
    this._bar(ctx, 18, 140, w - 36, 'CO₂', Math.round(s.co2).toLocaleString('en-US'), 'ppm', s.co2 / 8000, co2c);
    this._bar(ctx, 18, 202, w - 36, 'BATTERY', Math.round(s.battery), '%', s.battery / 100, s.battery < 25 ? '#e8b24a' : '#8fc4d8');
    ctx.fillStyle = 'rgba(232,241,245,0.6)'; ctx.font = '400 16px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Cabin ${s.cabinTemp.toFixed(1)} °C · 1.0 atm`, 18, 262);
    ctx.fillStyle = s.scrubberOn ? '#7fc8a0' : '#e5603f';
    ctx.fillText(s.scrubberOn ? 'SCRUBBER FAN ON' : 'SCRUBBER FAN OFF', 18, 292);
    S.tex.needsUpdate = true;
  }

  _sonar(s) {
    const S = this.screens.sonar, ctx = S.ctx, w = S.w, h = S.h;
    if (s.power < 0.5) { ctx.fillStyle = '#020405'; ctx.fillRect(0, 0, w, h); S.tex.needsUpdate = true; return; }
    const cx = w / 2, cy = h / 2 + 10, R = w * 0.42;
    ctx.fillStyle = '#030a08'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(127,200,160,0.25)'; ctx.lineWidth = 1.5;
    for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(cx, cy, (R * k) / 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // returns (fading with age)
    for (const r of s.sonar.returns) {
      const a = Math.max(0, 1 - r.age / 9);
      if (a <= 0) continue;
      const rr = (r.range / s.sonar.maxRange) * R;
      const x = cx + Math.sin(r.bearing) * rr, y = cy - Math.cos(r.bearing) * rr;
      ctx.fillStyle = r.kind === 'target' ? `rgba(232,178,74,${a})` : `rgba(127,232,170,${a * 0.85})`;
      ctx.fillRect(x - 2, y - 2, r.kind === 'target' ? 6 : 4, r.kind === 'target' ? 6 : 4);
    }
    // sweep line
    if (s.sonar.sweep >= 0) {
      const b = s.sonar.sweep * Math.PI * 2;
      ctx.strokeStyle = 'rgba(127,232,170,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(b) * R, cy - Math.cos(b) * R); ctx.stroke();
    }
    // waypoint marker
    if (s.sonar.waypoint) {
      const wp = s.sonar.waypoint;
      const rr = Math.min(1, wp.range / s.sonar.maxRange) * R;
      const x = cx + Math.sin(wp.bearing) * rr, y = cy - Math.cos(wp.bearing) * rr;
      ctx.strokeStyle = '#e8b24a'; ctx.lineWidth = 2; ctx.strokeRect(x - 7, y - 7, 14, 14);
    }
    ctx.fillStyle = '#7fc8a0'; ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx - 6, cy + 6); ctx.lineTo(cx + 6, cy + 6); ctx.fill();
    ctx.fillStyle = 'rgba(127,200,160,0.8)'; ctx.font = '600 15px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('SONAR', 14, 12);
    ctx.textAlign = 'right'; ctx.fillText(`${s.sonar.maxRange} m · R ping`, w - 14, 12);
    S.tex.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    this.glass.material.uniforms.uTime.value = this.t;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
