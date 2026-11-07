import * as THREE from 'three';
import { buildPodModel, POD } from '../world/podModel.js';
import { Cockpit } from './Cockpit.js';
import { lamps } from '../render/Lamps.js';
import { audio } from '../core/audio/AudioEngine.js';
import { settings } from '../core/Settings.js';
import { bus } from '../core/Bus.js';

const _f = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _d = new THREE.Vector3();

/** Water temperature (°C) over the Mariana region by depth (warm mixed layer, thermocline, near-freezing deep, slight adiabatic warming in the trench). */
export function oceanTemperature(depth) {
  if (depth < 60) return 29 - depth * 0.02;
  if (depth < 1000) return 4.2 + (27.8 - 4.2) * Math.exp(-(depth - 60) / 210);
  if (depth < 4500) return 1.5 + 2.7 * Math.exp(-(depth - 1000) / 900);
  return 1.5 + (depth - 4500) * 0.00012;
}

/**
 * Deep-diving pod: heavy, slow, thrusters spool up, momentum. Mouse is free look inside the cockpit;
 * W/S thrust, A/D yaw, Space/C vertical, F floods, R sonar, hold right mouse for the manipulator arm.
 */
export class Pod {
  constructor(game, { position = new THREE.Vector3(), yaw = 0, parent = null } = {}) {
    this.game = game;
    this.engine = game.engine;
    this.camera = game.engine.camera;
    this.root = new THREE.Group();
    this.root.name = 'podRoot';
    (parent || game.engine.scene).add(this.root);
    this.model = buildPodModel({});
    this.root.add(this.model.group);
    this.cockpit = new Cockpit();
    this.root.add(this.cockpit.group);
    this.pos = position.clone();
    this.vel = new THREE.Vector3();
    this.yaw = yaw; this.yawRate = 0;
    this.headYaw = 0; this.headPitch = -0.12;
    this.tF = 0; this.tY = 0; this.tV = 0; this.tS = 0;
    this.radius = 1.75;
    this.locked = false;        // no pilot control (launch, transitions, events)
    this.lookLocked = false;
    this.external = null;       // stage-driven world transform (A-frame lift): Matrix4 or null
    this.wobble = 0;
    // systems
    this.sys = { battery: 100, o2: 20.9, co2: 700, cabinTemp: 19, scrubberOn: true, power: 1, lifeOnBattery: true, thrustersOn: true, lightsOn: true, comms: true };
    this.floodsOn = false;
    this.floods = this.model.floods.map((boom, i) => {
      const sl = new THREE.SpotLight(0xfff2e2, 0, 0, i === 2 ? 0.62 : 0.5, 0.55, 2);
      sl.position.set(0, 0, -0.12);
      const tgt = new THREE.Object3D(); tgt.position.set(0, i === 2 ? -3 : -1.2, -8);
      boom.add(sl, tgt); sl.target = tgt;
      return sl;
    });
    this.floodIntensity = 520;
    this.floods.forEach((l) => lamps.add(l, { volumetric: 1 }));
    // sonar
    this.sonar = { returns: [], sweep: -1, maxRange: 150, waypoint: null, t: 0 };
    this.sonarTargets = null;   // stage: () => [{pos, kind}]
    this.sonarHit = null;       // stage: (p) => bool (solid besides height fields)
    // arm
    this.armActive = false;
    this.armTarget = new THREE.Vector3();
    this.armGrip = 0;
    this.onArmUse = null;       // stage: (point) => void
    this.drawT = 0;
    this.creakT = 6;
    this.prevDepth = this.depth;
    this.vSpeed = 0;
    this.thrustLoop = audio.loop('pink', { gain: 0, bus: 'sfx', filter: { type: 'bandpass', freq: 520, Q: 1.2 } });
    this.whine = audio.loop('pink', { gain: 0, bus: 'sfx', filter: { type: 'bandpass', freq: 2300, Q: 6 } });
    this._apply(0);
  }

  get depth() { return this.engine.env.depthBase - this.pos.y; }

  exportState() { return { battery: this.sys.battery, co2: this.sys.co2, o2: this.sys.o2, floodsOn: this.floodsOn }; }
  importState(s) { if (!s) return; if (s.battery !== undefined) this.sys.battery = s.battery; if (s.co2 !== undefined) this.sys.co2 = Math.min(s.co2, 1200); if (s.floodsOn) this.setFloods(true); }

  dispose() {
    this.floods.forEach((l) => lamps.remove(l));
    this.thrustLoop?.stop(0.3); this.whine?.stop(0.3);
    this.root.removeFromParent();
    this.cockpit.dispose();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.engine.env.lampExposureCap = null;
  }

  setFloods(on) {
    this.floodsOn = on && this.sys.power > 0.5 && this.sys.lightsOn;
    this.floods.forEach((l) => { l.intensity = this.floodsOn ? this.floodIntensity * (l === this.floods[2] ? 0.6 : 1) : 0; l.visible = this.floodsOn; });
    this.model.mats.lamp.emissiveIntensity = this.floodsOn ? 6 : 0;
    this.engine.env.lampExposureCap = this.floodsOn ? 1.6 : null;
    audio.play('switch', { gain: 0.5, bus: 'ui' });
  }

  ping() {
    if (this.sys.power < 0.5) return;
    audio.play('ping', { gain: 0.55 });
    const s = this.sonar;
    s.sweep = 0; s.t = 0;
    s.returns = s.returns.filter((r) => r.age < 6);
    const c = this.game.collision;
    const N = 72;
    for (let i = 0; i < N; i++) {
      const b = (i / N) * Math.PI * 2;
      const wb = this.yaw + b;
      _d.set(-Math.sin(wb), 0, -Math.cos(wb));
      for (const tilt of [-0.05, -0.28]) {
        for (let r = 4; r <= s.maxRange; r += 3) {
          _p.copy(this.pos).addScaledVector(_d, r * Math.cos(tilt)); _p.y += Math.sin(tilt) * r;
          const g = c.groundHeight(_p.x, _p.z);
          if (_p.y < g || (this.sonarHit && this.sonarHit(_p))) { s.returns.push({ bearing: b, range: r, age: -(b / (Math.PI * 2)) * 1.2, kind: 'ground' }); break; }
        }
      }
    }
    if (this.sonarTargets) for (const t of this.sonarTargets()) {
      _v.subVectors(t.pos, this.pos);
      const range = Math.hypot(_v.x, _v.z);
      if (range > s.maxRange) continue;
      let b = Math.atan2(-_v.x, -_v.z) - this.yaw;
      b = ((b % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      s.returns.push({ bearing: b, range, age: -(b / (Math.PI * 2)) * 1.2, kind: 'target' });
    }
    bus.emit('pod:ping');
  }

  /** Bearing/range of a world point relative to the pod heading (for the sonar waypoint box). */
  setWaypoint(p) {
    if (!p) { this.sonar.waypoint = null; return; }
    _v.subVectors(p, this.pos);
    let b = Math.atan2(-_v.x, -_v.z) - this.yaw;
    b = ((b % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.sonar.waypoint = { bearing: b, range: Math.hypot(_v.x, _v.z) };
  }

  update(dt) {
    const input = this.game.input;
    const sys = this.sys;
    // ---- head look (free look inside the sphere); the arm takes the mouse while right button is held
    this.armActive = !this.locked && input.altDown?.() && this.sys.power > 0.5;
    if (!this.lookLocked && !this.game.interactions.capturesLook) {
      const k = this.armActive ? 0.6 : 1;
      this.headYaw = THREE.MathUtils.clamp(this.headYaw - input.look.x * k, -1.9, 1.9);
      this.headPitch = THREE.MathUtils.clamp(this.headPitch - input.look.y * k, -1.1, 0.95);
    }
    // ---- thrusters with spool-up
    const live = !this.locked && sys.power > 0.5 && sys.thrustersOn && !this.external;
    const cmdF = live ? input.move.z : 0, cmdY = live ? -input.move.x : 0, cmdV = live ? input.move.y : 0;
    const boost = live && input.isDown('sprint') ? 1.5 : 1;
    const sp = Math.min(1, dt * 1.3);
    this.tF += (cmdF * boost - this.tF) * sp; this.tY += (cmdY - this.tY) * sp; this.tV += (cmdV - this.tV) * sp;
    if (!this.external) {
      _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const acc = _v.copy(_f).multiplyScalar(this.tF * 0.3);
      acc.y += this.tV * 0.16;
      acc.add(this.engine.env.current.clone().multiplyScalar(0.3));
      if (this.extraForce) acc.add(this.extraForce);
      const spd = this.vel.length();
      this.vel.addScaledVector(acc, dt).multiplyScalar(Math.exp(-dt * (0.28 + 0.55 * spd)));
      this.yawRate += (this.tY * 0.32 - this.yawRate) * Math.min(1, dt * 1.1);
      this.yaw += this.yawRate * dt;
      this.pos.addScaledVector(this.vel, dt);
      const c = this.game.collision;
      const vBefore = this.vel.length();
      const hit = c.resolve(this.pos, this.radius, this.vel);
      if (hit && vBefore > 0.25 && !this.bumpCool) {
        this.bumpCool = true; setTimeout(() => (this.bumpCool = false), 900);
        audio.play('thunk', { gain: Math.min(0.8, vBefore), rate: 0.6 }); audio.play('creak', { gain: 0.3, rate: 0.9 });
        this.wobble = Math.min(1, this.wobble + vBefore);
        bus.emit('pod:bump', vBefore);
      }
    }
    this.wobble *= Math.exp(-dt * 2.5);
    // ---- systems
    const thrustUse = Math.abs(this.tF) + Math.abs(this.tV) * 0.7 + Math.abs(this.tY) * 0.4;
    sys.battery = Math.max(3, sys.battery - dt * (0.006 + thrustUse * 0.03 + (this.floodsOn ? 0.012 : 0)));
    if (sys.scrubberOn && sys.power > 0.5) sys.co2 += (720 - sys.co2) * Math.min(1, dt * 0.08);
    else sys.co2 += dt * (this.co2Rate ?? 55);
    sys.o2 += (20.9 - sys.o2) * Math.min(1, dt * 0.05) + (Math.random() - 0.5) * 0.002;
    sys.cabinTemp += ((19 - Math.min(9, this.depth / 600)) - sys.cabinTemp) * Math.min(1, dt * 0.01);
    this.game.fx.dim = THREE.MathUtils.smoothstep(sys.co2, 2600, 7500) * 0.55;
    // vertical speed
    const d = this.depth;
    this.vSpeed += (((this.prevDepth - d) / Math.max(dt, 1e-4)) - this.vSpeed) * Math.min(1, dt * 2);
    this.prevDepth = d;
    // ---- controls
    if (!this.locked && input.pressed('torch')) this.setFloods(!this.floodsOn);
    if (!this.locked && input.pressed('sonar')) this.ping();
    // sonar sweep animation and return ageing
    const s = this.sonar;
    if (s.sweep >= 0) { s.t += dt; s.sweep = s.t / 1.2; if (s.sweep > 1) s.sweep = -1; }
    for (const r of s.returns) r.age += dt;
    // ---- arm
    this._arm(dt);
    // ---- hull creaks grow with depth
    this.creakT -= dt;
    if (this.creakT <= 0) {
      const k = THREE.MathUtils.clamp(d / 11000, 0, 1);
      this.creakT = THREE.MathUtils.lerp(26, 5, k) * (0.6 + Math.random() * 0.8);
      if (d > 150) audio.play('creak', { gain: 0.12 + k * 0.5, rate: 0.7 + Math.random() * 0.4 });
    }
    // ---- audio
    this.thrustLoop?.setGain(Math.min(0.5, thrustUse * 0.28) * (sys.power > 0.5 ? 1 : 0), 0.2);
    this.whine?.setGain(Math.min(0.06, thrustUse * 0.035) * (sys.power > 0.5 ? 1 : 0), 0.2);
    this._apply(dt);
    // ---- instruments at ~8 Hz
    this.drawT -= dt;
    if (this.drawT <= 0) {
      this.drawT = 0.125;
      this.cockpit.draw({
        depth: d, vSpeed: this.vSpeed, pressureAtm: 1 + Math.max(0, d) / 10.06, waterTemp: oceanTemperature(Math.max(0, d)),
        heading: ((THREE.MathUtils.radToDeg(-this.yaw) % 360) + 360) % 360,
        o2: sys.o2, co2: sys.co2, battery: sys.battery, cabinTemp: sys.cabinTemp, scrubberOn: sys.scrubberOn, power: sys.power, lifeOnBattery: sys.lifeOnBattery,
        sonar: this.sonar, warn: this.warn || '',
      });
    }
    this.cockpit.update(dt);
  }

  _arm(dt) {
    const arm = this.model.arm, input = this.game.input;
    // aim point: along the camera ray, 1.0–2.4 m out in front of the pod
    this.camera.getWorldDirection(_d);
    this.camera.getWorldPosition(_p);
    let reach = 2.3;
    const c = this.game.collision;
    for (let r = 1.2; r < 2.4; r += 0.1) { _v.copy(_p).addScaledVector(_d, r); if (_v.y < c.groundHeight(_v.x, _v.z) + 0.05) { reach = r; break; } }
    const target = this.armActive ? _v.copy(_p).addScaledVector(_d, reach) : null;
    // 2-link IK in the arm root's frame
    const base = arm.root;
    let tl;
    if (target) {
      base.updateMatrixWorld();
      tl = base.worldToLocal(target.clone());
    } else tl = new THREE.Vector3(0.0, -0.35, -0.6);
    const L1 = 0.62, L2 = 0.55;
    const dist = THREE.MathUtils.clamp(tl.length(), 0.2, L1 + L2 - 0.01);
    const yawA = Math.atan2(-tl.x, -tl.z);
    const pitchA = Math.atan2(tl.y, Math.hypot(tl.x, tl.z));
    const cosE = (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2);
    const elbow = Math.PI - Math.acos(THREE.MathUtils.clamp(cosE, -1, 1));
    const cosS = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const sh = Math.acos(THREE.MathUtils.clamp(cosS, -1, 1));
    const k = Math.min(1, dt * 3.5);
    arm.upper.rotation.y += (yawA - arm.upper.rotation.y) * k;
    arm.upper.rotation.x += (pitchA + sh - arm.upper.rotation.x) * k;
    arm.fore.rotation.x += (-elbow - arm.fore.rotation.x) * k;
    const grip = this.armActive && input.clickDown() ? 1 : 0;
    this.armGrip += (grip - this.armGrip) * Math.min(1, dt * 6);
    arm.claw.forEach((f, i) => { f.rotation.y = (i ? -1 : 1) * (0.45 - this.armGrip * 0.45); });
    if (this.armActive && input.clickPressed()) {
      audio.play('switch', { gain: 0.4, rate: 0.7 });
      arm.wrist.getWorldPosition(this.armTarget);
      this.onArmUse?.(this.armTarget.clone(), target ? target.clone() : null);
    }
  }

  _apply(dt) {
    const r = this.root;
    if (this.external) {
      r.matrixAutoUpdate = false;
      r.matrix.copy(this.external);
      r.matrixWorldNeedsUpdate = true;
    } else {
      r.matrixAutoUpdate = true;
      // cosmetic pitch/roll from thrust and bumps
      const t = this.engine.env.time;
      const pitch = -this.tF * 0.035 + Math.sin(t * 0.6) * 0.006 + Math.sin(t * 7.3) * 0.01 * this.wobble;
      const roll = -this.tY * 0.05 + Math.sin(t * 0.43) * 0.008 + Math.sin(t * 6.1) * 0.012 * this.wobble;
      r.position.copy(this.pos);
      r.rotation.set(pitch, this.yaw, roll, 'YXZ');
    }
    r.updateMatrixWorld(true);
    // camera at the pilot's eye with free look
    const cam = this.camera;
    _p.copy(POD.eye);
    r.localToWorld(_p);
    cam.position.copy(_p);
    r.getWorldQuaternion(_q);
    const reduced = settings.get('reducedMotion');
    _e.set(this.headPitch, this.headYaw, 0, 'YXZ');
    const hq = new THREE.Quaternion().setFromEuler(_e);
    if (reduced) { _e.set(0, this.yaw, 0, 'YXZ'); cam.quaternion.setFromEuler(_e).multiply(hq); }
    else cam.quaternion.copy(_q).multiply(hq);
    cam.updateMatrixWorld();
    void dt;
  }
}
