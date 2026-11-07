import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { audio } from '../core/audio/AudioEngine.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4(), _w = new THREE.Vector3();

/**
 * First-person walking on a moving ship deck. Position is kept in ship-local coordinates; the
 * camera follows the ship's heave/roll/pitch so the horizon gently moves.
 */
export class Walker {
  constructor(game, { ship, walk, colliders, position, yaw = 0 }) {
    this.game = game;
    this.camera = game.engine.camera;
    this.ship = ship;               // THREE.Object3D whose matrixWorld moves with the sea
    this.walk = walk;
    this.colliders = colliders.map((c) => ({ inv: c.matrix.clone().invert(), m: c.matrix, half: c.half }));
    this.pos = position.clone();    // ship-local feet position
    this.vel = new THREE.Vector3();
    this.yaw = yaw; this.pitch = -0.05;
    this.eye = 1.68;
    this.locked = false;
    this.lookLocked = false;
    this.stepPhase = 0;
    this.bob = 0;
    this.seat = null;               // {pos, yaw, pitch} when seated
    this.lookLimits = null;
  }

  update(dt) {
    const input = this.game.input;
    if (!this.lookLocked && !this.game.interactions.capturesLook) {
      this.yaw -= input.look.x;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.look.y, -1.4, 1.35);
      if (this.lookLimits) {
        const L = this.lookLimits;
        this.yaw = THREE.MathUtils.clamp(this.yaw, L.yaw - L.yawRange, L.yaw + L.yawRange);
        this.pitch = THREE.MathUtils.clamp(this.pitch, L.pitchMin, L.pitchMax);
      }
    }
    let moving = false;
    if (!this.locked && !this.seat) {
      _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const speed = input.isDown('sprint') ? 2.6 : 1.45;
      const want = _f.multiplyScalar(input.move.z).addScaledVector(_r, input.move.x);
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(speed);
      this.vel.lerp(want, Math.min(1, dt * 9));
      moving = this.vel.lengthSq() > 0.05;
      this.pos.addScaledVector(this.vel, dt);
      this._collide();
    }
    // footsteps
    if (moving) {
      const prev = this.stepPhase;
      this.stepPhase += dt * this.vel.length() * 1.15;
      if (Math.floor(prev) !== Math.floor(this.stepPhase)) audio.play('click2', { gain: 0.25, rate: 0.55 + Math.random() * 0.15, reverb: 0.05 });
    }
    const reduced = settings.get('reducedMotion');
    this.bob += ((moving && !reduced ? 0.022 : 0) - this.bob) * Math.min(1, dt * 6);
    this.applyCamera();
  }

  _collide() {
    const w = this.walk;
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, w.z0, w.z1);
    const xm = w.xMax(this.pos.z);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -xm, xm);
    const r = 0.32;
    for (const c of this.colliders) {
      _w.set(this.pos.x, this.pos.y + 0.9, this.pos.z).applyMatrix4(c.inv);
      if (Math.abs(_w.y) > c.half.y + 0.9) continue;
      const cx = THREE.MathUtils.clamp(_w.x, -c.half.x, c.half.x), cz = THREE.MathUtils.clamp(_w.z, -c.half.z, c.half.z);
      const dx = _w.x - cx, dz = _w.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r) {
        let nx, nz;
        if (d > 1e-5) { nx = dx / d; nz = dz / d; } else {
          const px = c.half.x - Math.abs(_w.x), pz = c.half.z - Math.abs(_w.z);
          if (px < pz) { nx = Math.sign(_w.x); nz = 0; } else { nx = 0; nz = Math.sign(_w.z); }
        }
        _w.x += nx * (r - d); _w.z += nz * (r - d);
        _w.y -= 0.9;
        _w.applyMatrix4(c.m);
        this.pos.x = _w.x; this.pos.z = _w.z;
      }
    }
  }

  applyCamera() {
    const c = this.camera;
    const s = this.seat;
    const local = s ? s.pos.clone() : new THREE.Vector3(this.pos.x, this.pos.y + this.eye + Math.abs(Math.sin(this.stepPhase * Math.PI)) * this.bob, this.pos.z);
    this.ship.updateMatrixWorld();
    local.applyMatrix4(this.ship.matrixWorld);
    c.position.copy(local);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const shipQ = new THREE.Quaternion();
    this.ship.matrixWorld.decompose(_w, shipQ, new THREE.Vector3());
    // reduced motion keeps the horizon level (only heave applies)
    if (settings.get('reducedMotion')) c.quaternion.copy(q);
    else c.quaternion.copy(shipQ).multiply(q);
    c.updateMatrixWorld();
  }

  /** World position of the eye. */
  worldEye(out = new THREE.Vector3()) { return this.camera.getWorldPosition(out); }
}
