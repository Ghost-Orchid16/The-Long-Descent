import * as THREE from 'three';
import { audio } from '../core/audio/AudioEngine.js';
import { SPECIES } from '../creatures/factory.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _c = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Photo mode (P): freezes the world, free camera within a few metres of the diver, depth of field,
 * exposure compensation, PNG download, and discovery by photo (species in frame get logged).
 */
export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.ui = document.createElement('div');
    this.ui.className = 'photo-ui';
    this.ui.innerHTML = `<div class="frame"><i></i><i></i><i></i><i></i></div><div class="focus"></div><div class="found"></div>
      <div class="info tabnum" data-k="info"></div>
      <div class="bar"><span>WASD · Space/C move &nbsp; Mouse look &nbsp; Wheel focus &nbsp; [ ] exposure</span><span><b>Click</b> shutter &nbsp; <b>P</b> exit</span></div><div class="flash"></div>`;
    document.getElementById('ui').appendChild(this.ui);
    this.info = this.ui.querySelector('[data-k=info]');
    this.foundEl = this.ui.querySelector('.found');
    this.flash = this.ui.querySelector('.flash');
    this.pos = new THREE.Vector3(); this.origin = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.focus = 3; this.manualFocus = false; this.ev = 0;
    this.saved = null;
    this.onWheel = (e) => {
      if (!this.active) return;
      this.manualFocus = true;
      this.focus = THREE.MathUtils.clamp(this.focus * Math.exp(-e.deltaY * 0.0012), 0.3, 40);
    };
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const g = this.game;
    if (g.state !== 'playing' || g.modal || !g.player) return;
    const cam = g.engine.camera;
    this.active = true;
    g.modal = 'photo';
    cam.getWorldPosition(this.pos);
    this.origin.copy(this.pos);
    _e.setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = _e.y; this.pitch = _e.x;
    this.saved = { mask: g.fxTarget.mask, maskNow: g.fx.mask };
    g.fxTarget.mask = 0; g.fx.mask = 0;
    g.ui.setVisible(false);
    g.ui.species.closeCard();
    this.ui.classList.add('show');
    this.manualFocus = false; this.ev = 0;
    g.engine.post.setDof(true, this.focus, 1.5, 3);
    this.foundEl.textContent = '';
    audio.play('switch', { gain: 0.4, bus: 'ui' });
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    if (g.modal === 'photo') g.modal = null;
    g.fxTarget.mask = this.saved?.mask ?? 1; g.fx.mask = this.saved?.maskNow ?? 1;
    g.ui.setVisible(true);
    this.ui.classList.remove('show');
    g.engine.post.setDof(false);
    g.engine.post.photoEV = 0;
    g.player?.applyCamera?.(0);
    g.input.requestLock();
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game, input = g.input, cam = g.engine.camera;
    if (input.pressed('photo') || input.pressed('pause')) { this.exit(); return; }
    // look
    this.yaw -= input.look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.look.y, -1.45, 1.45);
    _e.set(this.pitch, this.yaw, 0, 'YXZ');
    // move (camera-relative), limited to a sphere around the diver
    _f.set(0, 0, -1).applyEuler(_e);
    _r.set(1, 0, 0).applyEuler(_e);
    const sp = (input.isDown('sprint') ? 2.2 : 0.9) * dt;
    this.pos.addScaledVector(_f, input.move.z * sp).addScaledVector(_r, input.move.x * sp).addScaledVector(_u, input.move.y * sp);
    _v.subVectors(this.pos, this.origin);
    if (_v.length() > 6) this.pos.copy(this.origin).addScaledVector(_v.normalize(), 6);
    g.collision.resolve(this.pos, 0.2);
    if (g.engine.env.depthBase !== undefined) this.pos.y = Math.min(this.pos.y, g.engine.env.depthBase - 0.25);
    // the camera may be parented (pod cockpit); photo mode drives it in world space
    if (cam.parent && cam.parent !== g.engine.scene) {
      cam.parent.updateMatrixWorld();
      const inv = cam.parent.matrixWorld.clone().invert();
      cam.position.copy(this.pos).applyMatrix4(inv);
      const pq = new THREE.Quaternion(); cam.parent.getWorldQuaternion(pq);
      cam.quaternion.setFromEuler(_e).premultiply(pq.invert());
    } else {
      cam.position.copy(this.pos);
      cam.quaternion.setFromEuler(_e);
    }
    cam.updateMatrixWorld();
    // exposure
    if (input.isDown('evUp')) this.ev = Math.min(2, this.ev + dt * 1.5);
    if (input.isDown('evDown')) this.ev = Math.max(-2, this.ev - dt * 1.5);
    g.engine.post.photoEV = this.ev;
    // autofocus on the creature under the frame centre, else 3 m
    if (!this.manualFocus) {
      const pick = g.scanner?.pick(30);
      const target = pick ? pick.dist : 3;
      this.focus += (target - this.focus) * Math.min(1, dt * 4);
    }
    g.engine.post.setDof(true, this.focus, Math.max(0.6, this.focus * 0.45), 3);
    this.info.textContent = `Focus ${this.focus.toFixed(1)} m${this.manualFocus ? '' : ' (auto)'}  ·  EV ${this.ev >= 0 ? '+' : ''}${this.ev.toFixed(1)}`;
    if (input.clickPressed() || input.pressed('shutter')) this.capture();
  }

  /** Species visible in the frame: [{id, score}] (score = on-screen size). */
  _inFrame() {
    const g = this.game, cam = g.engine.camera;
    cam.getWorldPosition(_c);
    const out = new Map();
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visit = (id, pos, r) => {
      const dist = pos.distanceTo(_c);
      if (dist > 16 || dist < 0.1) return;
      _v.copy(pos).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 0.92 || Math.abs(_v.y) > 0.92) return;
      const size = r / (dist * tanH);
      if (size < 0.03) return;
      if (g.collision.segmentHitsGround(_c, pos, 10)) return;
      const centre = 1 - Math.min(1, Math.hypot(_v.x, _v.y));
      const score = size * (0.6 + 0.4 * centre);
      if (!out.has(id) || out.get(id) < score) out.set(id, score);
    };
    for (const src of g.scanner?.sources || []) src(visit);
    return [...out.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  }

  capture() {
    const g = this.game;
    const found = this._inFrame();
    // render now and read the canvas in the same task (drawing buffer is still valid)
    g.engine.render(0);
    const canvas = g.engine.renderer.domElement;
    const thumb = document.createElement('canvas');
    thumb.width = 320; thumb.height = 180;
    const ctx = thumb.getContext('2d');
    const ar = canvas.width / canvas.height, tar = 320 / 180;
    let sw = canvas.width, sh = canvas.height, sx = 0, sy = 0;
    if (ar > tar) { sw = sh * tar; sx = (canvas.width - sw) / 2; } else { sh = sw / tar; sy = (canvas.height - sh) / 2; }
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, 320, 180);
    const thumbUrl = thumb.toDataURL('image/jpeg', 0.78);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `into-the-hadal-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    audio.play('shutter', { gain: 0.7, bus: 'ui' });
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
    g.save.stats.photos = (g.save.stats.photos || 0) + 1;
    const meta = (g.save.photoMeta ||= {});
    const names = [];
    for (const f of found.slice(0, 4)) {
      const fresh = g.scanner ? g.scanner.log(f.id, 'photo') : false;
      if (!g.save.photos[f.id] || (meta[f.id] ?? 0) < f.score) { g.save.photos[f.id] = thumbUrl; meta[f.id] = f.score; }
      names.push(SPECIES[f.id].commonName + (fresh ? ' (new)' : ''));
    }
    g.persist();
    this.foundEl.textContent = names.length ? 'In frame: ' + names.join(', ') : '';
  }
}
