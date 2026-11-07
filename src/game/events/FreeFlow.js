import * as THREE from 'three';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';
import { patchMaterial } from '../../render/water/patch.js';

const _p = new THREE.Vector3(), _v = new THREE.Vector3();

function valveSVG(rot, closed) {
  const knob = (cx, r, label, active) => `
    <g transform="translate(${cx} 92)">
      <circle r="34" fill="#20262a" stroke="#59636a" stroke-width="2"/>
      <g transform="rotate(${active ? rot : 0})">
        ${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="-6" y="-40" width="12" height="14" rx="3" fill="#2e353a" stroke="#6a757c" transform="rotate(${a})"/>`).join('')}
        <circle r="24" fill="#2a3236" stroke="#7c878e" stroke-width="2"/>
        <rect x="-3" y="-22" width="6" height="14" rx="2" fill="${active ? '#e8b24a' : '#8fc4d8'}"/>
      </g>
      <text y="62" text-anchor="middle" font-size="11" fill="#cfe1e8" letter-spacing="1.5">${label}</text>
    </g>`;
  return `<svg width="380" height="190" viewBox="0 0 380 190" style="font-family:Inter,sans-serif">
    <rect x="10" y="6" width="360" height="176" rx="14" fill="rgba(4,11,16,0.86)" stroke="rgba(232,241,245,0.18)"/>
    <rect x="110" y="84" width="160" height="16" rx="6" fill="#3a4247"/>
    <rect x="176" y="100" width="28" height="60" rx="8" fill="#4a5257"/>
    ${knob(96, 34, closed ? 'LEFT · CLOSED' : 'LEFT · FREE-FLOWING', true)}
    ${knob(284, 34, 'RIGHT · BACKUP', false)}
    <text x="190" y="30" text-anchor="middle" font-size="10" fill="#8fc4d8" letter-spacing="2">H-VALVE (BEHIND YOUR HEAD)</text>
  </svg>`;
}

/**
 * Regulator free-flow at depth: the primary second stage roars and dumps gas. Sequence: grab the yellow backup,
 * purge it, breathe from it, then reach back and turn the left post of the H-valve closed (drag / hold D).
 */
export class FreeFlow {
  constructor(game, { onStep, onDone } = {}) {
    this.game = game;
    this.onStep = onStep; this.onDone = onDone;
    this.step = null;
    this.rot = 0;
    this.active = false;
    this.done = false;
    // the yellow backup second stage, held in the lower right of the view
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c21c, roughness: 0.45 });
    const blk = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.6 });
    patchMaterial(yel, { key: 'octoY' }); patchMaterial(blk, { key: 'octoB' });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 20), yel); body.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.004, 20), blk); face.rotation.x = Math.PI / 2; face.position.z = 0.017;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, 0.03), blk); mouth.position.set(0, 0, -0.026);
    const exh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.022), yel); exh.position.set(0, -0.03, 0.004);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.03, 0, 0), new THREE.Vector3(0.09, -0.03, 0.02), new THREE.Vector3(0.14, -0.14, 0.06)]), 12, 0.008, 6), yel);
    g.add(body, face, mouth, exh, hose);
    g.visible = false;
    g.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 5; } });
    this.octo = g;
    this.octoFrom = new THREE.Vector3(0.13, -0.2, -0.38);
    this.octoTo = new THREE.Vector3(0.0, -0.11, -0.2);
    this.octoT = 0;
    game.engine.camera.add(g);
  }

  start(diver) {
    if (this.active || this.done) return;
    this.diver = diver;
    this.active = true;
    this.step = 'grab';
    bus.emit('tension', true);
    diver.freeflow = 3.0;
    diver.panic = Math.min(1, diver.panic + 0.4);
    this.roar = audio.loop('pink', { gain: 0.5, bus: 'sfx', filter: { type: 'bandpass', freq: 900, Q: 0.5 } });
    this.roar2 = audio.loop('brown', { gain: 0.35, bus: 'sfx', filter: { type: 'lowpass', freq: 380 } });
    this.octo.visible = true;
    this.octo.position.copy(this.octoFrom);
    this.octo.rotation.set(0.5, -0.6, 0.2);
    this.onStep?.(this.step);
  }

  _bubbleSource() {
    const cam = this.game.engine.camera;
    return this.step === 'grab' || this.step === 'purge' ? _p.set(0, -0.12, -0.12).applyMatrix4(cam.matrixWorld) : _p.set(0.05, -0.45, -0.05).applyMatrix4(cam.matrixWorld);
  }

  _next(step) {
    this.step = step;
    audio.play('click', { gain: 0.5, bus: 'ui' });
    this.onStep?.(step);
  }

  update(dt) {
    if (!this.active) return;
    const game = this.game, input = game.input, d = this.diver, cam = game.engine.camera;
    // continuous roar of bubbles from the free-flowing primary
    if (d.freeflow > 0) {
      const src = this._bubbleSource().clone();
      _v.set((Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4).add(d.vel);
      game.engine.bubbles.burst(src, { count: 4, rMin: 0.002, rMax: 0.02, spread: 0.06, vel: _v.clone() });
      // forgiving floor: the leak never empties the cylinder during the event
      if (d.air < 42) d.freeflow = 0.0, d.air = Math.max(d.air, 40);
      else d.freeflow = 3.0;
    }
    this.octoT = Math.min(1, this.octoT + dt * (this.step === 'grab' ? 0 : 2.2));
    const k = this.octoT * this.octoT * (3 - 2 * this.octoT);
    this.octo.position.lerpVectors(this.octoFrom, this.octoTo, k);
    this.octo.rotation.set(0.5 * (1 - k), -0.6 * (1 - k), 0.2 * (1 - k));
    const press = input.pressed('interact');
    if (this.step === 'grab') {
      game.ui.prompt('E  ·  Grab the yellow backup regulator');
      if (press) this._next('purge');
    } else if (this.step === 'purge') {
      game.ui.prompt('E  ·  Purge the backup');
      if (press && this.octoT > 0.95) {
        const p = _p.set(0, -0.08, -0.22).applyMatrix4(cam.matrixWorld).clone();
        game.engine.bubbles.burst(p, { count: 50, rMin: 0.002, rMax: 0.012, spread: 0.05 });
        audio.play('hiss', { gain: 0.5, rate: 1.4 });
        this._next('breathe');
      }
    } else if (this.step === 'breathe') {
      game.ui.prompt('E  ·  Breathe from the backup');
      if (press) {
        this.octo.visible = false;
        d.panic = Math.max(0, d.panic - 0.25);
        this._next('valve');
        d.lookLocked = true;
      }
    } else if (this.step === 'valve') {
      // reach back: drag the mouse right (or hold D / right stick) to turn the left post closed
      let turn = 0;
      if (input.clickDown() || input.isDown('interact')) turn += Math.max(0, input.look.x) * 3.2;
      if (input.isDown('right')) turn += dt * 3.4;
      if (input.isDown('left')) turn -= dt * 1.5;
      this.rot = Math.max(0, this.rot + turn);
      const deg = THREE.MathUtils.radToDeg(this.rot);
      const frac = Math.min(1, deg / 720);
      game.ui.inspect(valveSVG(deg, frac >= 1), null, { high: true });
      game.ui.prompt(`Hold click and drag right (or hold D) to close the left valve  ·  ${Math.round(frac * 100)}%`, frac);
      if (turn > 0 && Math.random() < 0.2) audio.play('click', { gain: 0.15, rate: 0.6 + frac * 0.5 });
      d.freeflow = d.freeflow > 0 ? 3.0 * (1 - frac) : 0;
      this.roar?.setGain(0.5 * (1 - frac)); this.roar2?.setGain(0.35 * (1 - frac));
      if (frac >= 1) this._finish();
    }
  }

  _finish() {
    const game = this.game, d = this.diver;
    this.active = false; this.done = true; this.step = null;
    bus.emit('tension', false);
    d.freeflow = 0;
    d.lookLocked = false;
    this.roar?.stop(0.6); this.roar2?.stop(0.6);
    game.ui.prompt(null);
    game.ui.inspect(valveSVG(720, true), 'Left post closed · breathing from the backup', { high: true });
    game.after(2.2, () => game.ui.inspect(null));
    audio.play('thunk', { gain: 0.5 });
    this.onDone?.();
  }

  dispose() {
    this.roar?.stop(0.2); this.roar2?.stop(0.2);
    this.octo.removeFromParent();
    this.octo.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    if (this.diver) { this.diver.freeflow = 0; this.diver.lookLocked = false; }
  }
}
