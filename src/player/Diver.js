import * as THREE from 'three';
import { DiveComputer } from './DiveComputer.js';
import { settings } from '../core/Settings.js';
import { audio } from '../core/audio/AudioEngine.js';
import { lamps } from '../render/Lamps.js';
import { bus } from '../core/Bus.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3();
const _m = new THREE.Vector3();

/** Water temperature (°C) near Guam by depth (shallow profile used during the scuba stages). */
export function reefTemperature(depth) {
  if (depth < 40) return 29 - depth * 0.025;
  return 28 - (depth - 40) * 0.03;
}

/**
 * First-person scuba diver: inertia, quadratic drag, drift, collision, look smoothing, fin-kick bob,
 * breathing synced with exhaust bubbles, air consumption, and a Bühlmann dive computer.
 */
export class Diver {
  constructor(game, { position, yaw = 0, pitch = 0 } = {}) {
    this.game = game;
    this.engine = game.engine;
    this.camera = game.engine.camera;
    this.pos = position ? position.clone() : new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = yaw; this.pitch = pitch;
    this.yawV = 0; this.pitchV = 0;
    this.radius = 0.42;
    this.kickPhase = 0;
    this.bob = 0;
    this.locked = false;           // cutscene / event lock (no movement input)
    this.lookLocked = false;
    this.speedScale = 1;           // e.g. ghost-net entanglement
    this.extraForce = new THREE.Vector3(); // currents applied by stages
    this.computer = new DiveComputer();
    this.diveTimeScale = 2.5;      // game seconds per real second while diving
    // H-valve twin-outlet 12 L cylinder
    this.tankLitres = 12;
    this.airMax = 200;
    this.air = 200;
    this.sac = 13;                 // surface air consumption, L/min (relaxed diver)
    this.exertion = 1;
    this.panic = 0;                // 0..1 raises breathing rate and air use
    this.freeflow = 0;             // bar per real second lost to a free-flowing regulator
    this.onAir = true;
    this.breathT = 0;
    this.breathPhase = 'pause';
    this.breathRate = 1;
    this.prevDepth = this.depth;
    this.ascentRate = 0;           // m/min (game time)
    this.rateSmooth = 0;
    this.narcosis = 0;
    this.maskOn = true;
    this.hudT = 0;
    this.lowAirWarned = false;
    this.fastAscentT = 0;
    this.decoOverride = null;      // scripted stop shown on the wrist computer {depth, time}

    // Torch held in the right hand
    this.torch = new THREE.SpotLight(0xfff1df, 0, 0, THREE.MathUtils.degToRad(19), 0.6, 2);
    this.torch.position.set(0.24, -0.2, -0.1);
    this.torch.target.position.set(0.04, -0.12, -6);
    this.torch.name = 'torch';
    this.torchOn = false;
    this.torchIntensity = 42;
    this.camera.add(this.torch, this.torch.target);
    this.lampEntry = lamps.add(this.torch, { volumetric: 1 });

    this.exL = new THREE.Vector3(); this.exR = new THREE.Vector3();
    this.applyCamera(0);
  }

  get depth() { return this.engine.env.depthBase - this.pos.y; }

  dispose() {
    lamps.remove(this.torch);
    this.camera.remove(this.torch, this.torch.target);
    this.torch.dispose();
    this.engine.env.lampExposureCap = null;
  }

  /** Gas and tissue state carried between scuba stages. */
  exportState() {
    return { air: this.air, p: this.computer.p.slice(), diveTime: this.computer.diveTime, maxDepth: this.computer.maxDepth, lowAirWarned: this.lowAirWarned, torchOn: this.torchOn };
  }

  importState(s) {
    if (!s) return;
    this.air = s.air ?? this.air;
    if (s.p) this.computer.p = s.p.slice();
    this.computer.diveTime = s.diveTime ?? 0;
    this.computer.maxDepth = s.maxDepth ?? 0;
    this.lowAirWarned = !!s.lowAirWarned;
    this.prevDepth = this.depth;
    if (s.torchOn) this.setTorch(true);
  }

  setTorch(on) {
    this.torchOn = on;
    this.torch.intensity = on ? this.torchIntensity : 0;
    this.torch.visible = on;
    this.engine.env.lampExposureCap = on ? 1.4 : null;
    audio.play('click', { gain: 0.5, bus: 'ui' });
  }

  teleport(pos, yaw = this.yaw, pitch = this.pitch) {
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = pitch;
    this.prevDepth = this.depth;
    this.applyCamera(0);
  }

  update(dt) {
    const { input, collision } = this.game;
    const env = this.engine.env;
    // ----- look (smoothed for a slow, heavy feel underwater) -----
    if (!this.lookLocked && !this.game.interactions.capturesLook) {
      const k = 1 - Math.exp(-dt * 22);
      this.yawV += (-input.look.x - this.yawV) * k;
      this.pitchV += (-input.look.y - this.pitchV) * k;
      this.yaw += this.yawV;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchV, -1.45, 1.45);
    }
    // ----- thrust -----
    const sprint = input.isDown('sprint') && !this.locked;
    const mx = this.locked ? 0 : input.move.x, my = this.locked ? 0 : input.move.y, mz = this.locked ? 0 : input.move.z;
    _f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const thrust = (sprint ? 1.85 : 1.1) * this.speedScale;
    _a.set(0, 0, 0).addScaledVector(_f, mz * thrust).addScaledVector(_r, mx * thrust * 0.7).addScaledVector(_u, my * 0.85 * this.speedScale);
    const moving = Math.abs(mx) + Math.abs(mz) + Math.abs(my) > 0.05;
    // near-neutral buoyancy: tiny drift towards neutral depth hold
    _a.y += Math.sin(env.time * 0.23) * 0.004;
    // current and stage forces
    _a.add(this.extraForce);
    // drag: linear + quadratic, relative to the water (current)
    _m.copy(this.vel).sub(env.current);
    const sp = _m.length();
    _a.addScaledVector(_m, -(0.35 + 0.9 * sp));
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);
    // ----- collision -----
    collision.ceiling = env.depthBase - 0.28;
    collision.resolve(this.pos, this.radius, this.vel);
    // ----- fin kicks / bob -----
    const kickRate = moving ? (sprint ? 1.35 : 0.9) : 0.18;
    this.kickPhase += dt * kickRate * Math.PI * 2;
    const reduced = settings.get('reducedMotion');
    const bobAmp = reduced ? 0 : (moving ? (sprint ? 0.016 : 0.011) : 0.004);
    this.bob += (bobAmp - this.bob) * Math.min(1, dt * 3);
    this.exertion += ((sprint ? 1.7 : moving ? 1.15 : 0.9) - this.exertion) * Math.min(1, dt * 0.8);
    // ----- dive computer -----
    const depth = Math.max(0, this.depth);
    const dtGame = dt * this.diveTimeScale;
    this.computer.step(dtGame, depth);
    const instRate = ((this.prevDepth - depth) / Math.max(dtGame, 1e-4)) * 60; // m/min game time, + = ascending
    this.prevDepth = depth;
    this.rateSmooth += (instRate - this.rateSmooth) * Math.min(1, dt * 2.5);
    this.ascentRate = this.rateSmooth;
    if (this.ascentRate > 10) {
      this.fastAscentT += dt;
      if (this.fastAscentT > 0.6 && !this._rateBeep) { this._rateBeep = true; audio.playAlarm('warn', 0.6); bus.emit('diver:fastAscent'); setTimeout(() => (this._rateBeep = false), 1200); }
    } else this.fastAscentT = 0;
    // ----- narcosis (equivalent narcotic effect of air below ~30 m) -----
    this.narcosis = THREE.MathUtils.smoothstep(depth, 30, 58);
    // ----- breathing & air -----
    this._breathe(dt, depth);
    this.applyCamera(dt);
    // HUD at 10 Hz
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      const st = this.decoOverride || this.computer.stop();
      this.game.ui.updateScuba({
        depth, diveTime: this.computer.diveTime, ndl: this.computer.ndl(depth), decoStop: st.depth, decoTime: st.time,
        temp: this.temperature ? this.temperature(depth) : reefTemperature(depth), ascentRate: this.ascentRate, air: this.air, airMax: this.airMax,
      });
      this.game.ui.updateCompass(((THREE.MathUtils.radToDeg(-this.yaw) % 360) + 360) % 360);
    }
  }

  _breathe(dt, depth) {
    const pAmb = 1 + depth / 10;
    // breathing rate rises with exertion & panic
    this.breathRate = this.exertion * (1 + this.panic * 1.4);
    const cycle = 4.6 / this.breathRate;
    const inhale = cycle * 0.3, exhale = cycle * 0.45;
    this.breathT += dt;
    if (this.breathPhase === 'pause' && this.breathT >= cycle - inhale - exhale) { this.breathPhase = 'in'; this.breathT = 0; if (this.onAir && this.air > 0) audio.play('inhale', { gain: 0.32 * (0.8 + this.panic * 0.5), rate: 1 + this.panic * 0.15, reverb: 0.05 }); }
    else if (this.breathPhase === 'in' && this.breathT >= inhale) { this.breathPhase = 'out'; this.breathT = 0; this._exhale(exhale); }
    else if (this.breathPhase === 'out' && this.breathT >= exhale) { this.breathPhase = 'pause'; this.breathT = 0; }
    // consumption: litres per game minute -> bar per real second
    const lPerMin = this.sac * pAmb * this.exertion * (1 + this.panic * 1.2);
    const barPerSec = (lPerMin / this.tankLitres) * (this.diveTimeScale / 60);
    this.air = Math.max(0, this.air - barPerSec * dt - this.freeflow * dt);
    if (this.air < 80 && !this.lowAirWarned) { this.lowAirWarned = true; bus.emit('diver:lowAir', this.air); }
    if (this.air <= 0 && !this.outOfAir) { this.outOfAir = true; bus.emit('diver:outOfAir'); }
  }

  _exhale(dur) {
    if (this.air <= 0) return;
    const cam = this.camera;
    const rate = 1 + this.panic * 0.2;
    audio.play('exhale', { gain: 0.5 * (0.85 + this.panic * 0.4), rate, reverb: 0.18 });
    const getL = () => this.exL.set(-0.09, -0.14, 0.03).applyMatrix4(cam.matrixWorld);
    const getR = () => this.exR.set(0.09, -0.14, 0.03).applyMatrix4(cam.matrixWorld);
    const side = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
    const vL = side.clone().multiplyScalar(-0.22).add(this.vel), vR = side.clone().multiplyScalar(0.22).add(this.vel);
    const b = this.engine.bubbles;
    b.stream({ getPos: getL, getVel: () => vL, rate: 26 * (1 + this.panic), duration: dur * 0.8, rMin: 0.0018, rMax: 0.012, spread: 0.035 });
    b.stream({ getPos: getR, getVel: () => vR, rate: 26 * (1 + this.panic), duration: dur * 0.8, rMin: 0.0018, rMax: 0.012, spread: 0.035 });
  }

  applyCamera(dt) {
    void dt;
    const c = this.camera;
    const reduced = settings.get('reducedMotion');
    const by = Math.sin(this.kickPhase) * this.bob;
    const roll = reduced ? 0 : Math.sin(this.kickPhase * 0.5) * this.bob * 0.35;
    c.position.set(this.pos.x, this.pos.y + by, this.pos.z);
    c.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    c.updateMatrixWorld();
  }
}
