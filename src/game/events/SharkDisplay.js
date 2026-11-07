import * as THREE from 'three';
import { audio } from '../../core/audio/AudioEngine.js';

const _d = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Grey reef shark agonistic display. The shark comes in from the blue, then hunches (back arched, pectorals
 * down, exaggerated swimming) and patrols in front of the diver. Stopping, facing it and backing slowly to the
 * wall calms it; sprinting or swimming at it escalates to a close pass and panic breathing.
 */
export class SharkDisplay {
  /**
   * @param game Game
   * @param group CreatureManager group of the display shark (count 1)
   * @param opts { wallDist(pos) → metres to the wall face (+ = in open water), wallDir: Vector3 towards the wall,
   *               onDisplay, onEscalate(n), onCalm, onDone(clean) }
   */
  constructor(game, group, opts) {
    this.game = game; this.g = group; this.o = opts;
    this.phase = 'idle';
    this.t = 0; this.progress = 0; this.escalations = 0; this.cool = 0; this.heartT = 0; this.tension = 0;
    this.side = 1; this.passT = 0;
    this.done = false;
  }

  get active() { return this.phase !== 'idle' && this.phase !== 'gone'; }
  get shark() { return this.g.agents[0]; }

  start(diver) {
    if (this.phase !== 'idle') return;
    this.diver = diver;
    this.phase = 'approach';
    this.t = 0;
    const a = this.shark, g = this.g;
    g.visible = true;
    // enter from the blue, ahead and to one side
    _f.set(-Math.sin(diver.yaw), 0, -Math.cos(diver.yaw));
    const away = this.o.wallDir.clone().multiplyScalar(-1);
    _t.copy(away).multiplyScalar(0.7).addScaledVector(_f, 0.3).normalize();
    a.p.copy(diver.pos).addScaledVector(_t, 24).add(_s.set(0, -2, 0));
    a.v.copy(_t).multiplyScalar(-0.8);
    a.yaw = Math.atan2(-_t.x, -_t.z);
    g.o.beh = 'cruise';
    g.beh = 'cruise';
    g.o.speed = 0.9;
    g.o.shy = 0;
    audio.play('heart', { gain: 0.25 });
  }

  _steer(target, speed) {
    const a = this.shark;
    a.target.copy(target);
    a.hasTarget = true; a.timer = 99; a.mode = 'swim';
    this.g.o.home = target.clone();
    this.g.o.speed = speed;
    this.g.o.radius = 1;
  }

  update(dt) {
    if (!this.active) return;
    const d = this.diver, a = this.shark, game = this.game;
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    _d.subVectors(a.p, d.pos);
    const dist = _d.length();
    const toShark = _d.clone().normalize();
    game.engine.camera.getWorldDirection(_c);
    const facing = _c.dot(toShark) > Math.cos(THREE.MathUtils.degToRad(40));
    const speed = d.vel.length();
    const towardShark = d.vel.dot(toShark);
    const towardWall = d.vel.dot(this.o.wallDir);
    const wallDist = this.o.wallDist(d.pos);
    const calm = speed < 0.5;
    const backing = towardWall > 0.06 || wallDist < 2.6;
    const aggressive = speed > 0.95 || towardShark > 0.35;
    // a patrol point in front of the diver, swinging side to side
    _f.copy(toShark).setY(0).normalize();
    _s.set(-_f.z, 0, _f.x);
    const swing = Math.sin(this.t * 0.55) * 4.2;

    if (this.phase === 'approach') {
      _t.copy(d.pos).addScaledVector(_f, 7.5).addScaledVector(_s, swing * 0.6);
      _t.y = d.pos.y - 0.5;
      this._steer(_t, 1.0);
      if (dist < 9.5 || this.t > 16) {
        this.phase = 'display'; this.t = 0;
        this.g.o.display = 1;
        this.o.onDisplay?.();
      }
    } else if (this.phase === 'display') {
      if (this.passT > 0) {
        // escalation: fast close pass across the diver's front
        this.passT -= dt;
        _t.copy(d.pos).addScaledVector(_s, this.side * 1.6).addScaledVector(toShark, -2.5);
        this._steer(_t, 2.6);
        if (this.passT <= 0) { this.side *= -1; this.g.o.agility = undefined; }
      } else {
        _t.copy(d.pos).addScaledVector(_f, 5.2 + Math.cos(this.t * 0.37) * 0.8).addScaledVector(_s, swing);
        _t.y = d.pos.y - 0.3 + Math.sin(this.t * 0.8) * 0.6;
        this._steer(_t, 0.55);
      }
      // the diver's behaviour
      if (aggressive && this.cool <= 0) {
        this.escalations++;
        this.cool = 6;
        this.passT = 2.2;
        this.g.o.agility = 4;
        this.progress *= 0.4;
        d.panic = Math.min(1, d.panic + 0.5);
        audio.play('hiss', { gain: 0.45, rate: 0.6, pos: a.p.clone() });
        audio.play('heart', { gain: 0.7 });
        this.o.onEscalate?.(this.escalations);
        if (this.escalations >= 3) this.progress = 0.85; // forgiving: it gives up after a third pass
      } else if (facing && calm) this.progress += dt * (backing ? 1 / 13 : 1 / 38);
      else this.progress = Math.max(0, this.progress - dt * 0.02);
      if (this.progress >= 1) this._leave(this.escalations === 0);
    } else if (this.phase === 'leave') {
      _t.copy(a.p).addScaledVector(this.o.wallDir, -3).addScaledVector(_s, this.side * 2);
      _t.y = a.p.y - 0.6;
      this._steer(_t, 0.85);
      if (this.t > 9) { this.phase = 'gone'; this.g.visible = false; this.done = true; this.o.onDone?.(this.clean); }
    }
    // tension: heartbeat and breathing follow how close and agitated the shark is
    const target = this.phase === 'display' ? THREE.MathUtils.clamp(1.2 - dist / 9, 0.2, 1) * (this.passT > 0 ? 1.3 : 1) : 0;
    this.tension += (target - this.tension) * Math.min(1, dt * 1.5);
    d.panic = Math.max(d.panic, this.tension * 0.45);
    this.heartT -= dt;
    if (this.tension > 0.15 && this.heartT <= 0) { this.heartT = 1.15 - this.tension * 0.5; audio.play('heart', { gain: 0.25 + this.tension * 0.45 }); }
  }

  _leave(clean) {
    this.phase = 'leave'; this.t = 0; this.clean = clean;
    this.g.o.display = 0;
    this.o.onCalm?.(clean);
  }
}
