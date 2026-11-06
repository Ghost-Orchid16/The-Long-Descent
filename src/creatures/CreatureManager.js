import * as THREE from 'three';
import { makeInstanced, SPECIES, modelLength } from './factory.js';
import { APPEARANCE } from './appearance.js';

// Creature life: one InstancedMesh per species group, CPU agents with steering behaviours.
// Model convention: nose along +Z (jellies: bell axis +Y). aAnim = (phase, effort, bend, state).

const TAU = Math.PI * 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _w = new THREE.Vector3();
const _sep = new THREE.Vector3(), _ali = new THREE.Vector3(), _coh = new THREE.Vector3(), _t = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

/** Per-species motion tuning. speed: cruise m/s; turn: max yaw rate rad/s; pitch: max pitch rad; bank: roll per yaw rate. */
const MOTION = {
  green_turtle: { speed: 0.4, turn: 0.45, pitch: 0.45, bank: 0.7, shy: 3.5, groundOffset: 0.14 },
  hawksbill: { speed: 0.35, turn: 0.5, pitch: 0.5, bank: 0.7, shy: 3, groundOffset: 0.12 },
  reef_manta: { speed: 0.55, turn: 0.22, pitch: 0.3, bank: 1.2, shy: 0 },
  blacktip_reef: { speed: 0.8, turn: 0.7, pitch: 0.25, bank: 0.5, shy: 5 },
  whitetip_reef: { speed: 0.55, turn: 0.6, pitch: 0.25, bank: 0.5, shy: 4, groundOffset: 0.1 },
  moorish_idol: { speed: 0.22, turn: 1.6, pitch: 0.3, shy: 2 },
  bumphead: { speed: 0.45, turn: 0.6, pitch: 0.35, shy: 4.5 },
  napoleon: { speed: 0.4, turn: 0.6, pitch: 0.3, shy: 2.2 },
  palette_tang: { speed: 0.25, turn: 1.8, pitch: 0.35, shy: 1.8 },
  anemonefish: { speed: 0.18, turn: 4, pitch: 0.5, shy: 0 },
  lionfish: { speed: 0.05, turn: 0.5, pitch: 0.2, shy: 0.8 },
  day_octopus: { speed: 0.05, turn: 0.6, shy: 1.6 },
  chromis: { speed: 0.16, turn: 4, pitch: 0.5, shy: 1.4 },
  cleaner_wrasse: { speed: 0.2, turn: 3.5, pitch: 0.5, shy: 0 },
  grey_reef: { speed: 0.8, turn: 0.65, pitch: 0.25, bank: 0.5, shy: 4 },
  chevron_barracuda: { speed: 0.5, turn: 1.0, pitch: 0.2, shy: 2.2 },
  giant_trevally: { speed: 1.0, turn: 0.9, pitch: 0.3, bank: 0.3, shy: 4 },
  eagle_ray: { speed: 0.7, turn: 0.3, pitch: 0.3, bank: 1.0, shy: 5 },
  giant_moray: { speed: 0.03, turn: 0.5, shy: 1.2 },
  lanternfish: { speed: 0.12, turn: 2.5, pitch: 0.5, shy: 1.0 },
  hatchetfish: { speed: 0.06, turn: 1.5, pitch: 0.4, shy: 0.8 },
  nautilus: { speed: 0.04, turn: 0.4, pitch: 0.15, shy: 0 },
  sixgill: { speed: 0.35, turn: 0.25, pitch: 0.15, bank: 0.4, shy: 0 },
  sperm_whale: { speed: 1.2, turn: 0.08, pitch: 0.3, bank: 0.3, shy: 0 },
  siphonophore: { speed: 0.01, turn: 0.02, pitch: 0.05, shy: 0 },
  comb_jelly: { speed: 0.02, turn: 0.2, shy: 0 },
  vampire_squid: { speed: 0.03, turn: 0.3, pitch: 0.3, shy: 0 },
  anglerfish: { speed: 0.01, turn: 0.15, pitch: 0.1, shy: 0 },
  fangtooth: { speed: 0.08, turn: 0.8, pitch: 0.3, shy: 0.6 },
  gulper_eel: { speed: 0.03, turn: 0.2, pitch: 0.4, shy: 0 },
  loosejaw: { speed: 0.12, turn: 0.8, pitch: 0.3, shy: 0.8 },
  atolla: { speed: 0.015, turn: 0.1, shy: 0 },
  giant_squid: { speed: 0.4, turn: 0.15, pitch: 0.2, shy: 0 },
  vent_shrimp: { speed: 0.05, turn: 4, pitch: 1.0, shy: 0 },
  vent_crab: { speed: 0.04, turn: 1.2, shy: 0.6, groundOffset: 0.02 },
  dumbo: { speed: 0.05, turn: 0.4, pitch: 0.2, shy: 0 },
  tripod: { speed: 0.3, turn: 0.6, pitch: 0.3, shy: 2.2, groundOffset: 0.72 },
  sea_pig: { speed: 0.012, turn: 0.4, shy: 0, groundOffset: 0.025 },
  brittle_star: { speed: 0.008, turn: 0.4, shy: 0, groundOffset: 0.01 },
  grenadier: { speed: 0.15, turn: 0.5, pitch: 0.25, shy: 1.2 },
  snailfish: { speed: 0.09, turn: 1.2, pitch: 0.4, shy: 0.6 },
  amphipod: { speed: 0.06, turn: 5, pitch: 1.0, shy: 0 },
  hadal_cucumber: { speed: 0.005, turn: 0.2, shy: 0, groundOffset: 0.03 },
  giant_clam: { groundOffset: 0.07 },
  vent_mussel: { groundOffset: 0.02 },
  hairy_snail: { groundOffset: 0.02 },
  glass_sponge: { groundOffset: -0.02 },
  xenophyophore: { groundOffset: -0.005 },
};

const GROUND_BEHAVIOURS = new Set(['rest', 'crawl', 'herd', 'perch', 'sessile', 'hide']);

class Agent {
  constructor(i) {
    this.i = i;
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.home = new THREE.Vector3(); this.homeDir = new THREE.Vector3(0, 0, 1);
    this.target = new THREE.Vector3(); this.hasTarget = false;
    this.yaw = Math.random() * TAU; this.pitch = 0; this.roll = 0; this.yawRate = 0;
    this.homeYaw = this.yaw;
    this.phase = Math.random() * 100; this.effort = 1; this.bend = 0; this.state = 0; this.stateTarget = 0;
    this.scale = 1; this.timer = 0; this.cool = 0; this.fear = 0;
    this.mode = 'idle'; this.s = Math.random(); this.layer = 0; this.offset = new THREE.Vector3();
    this.visible = true;
  }
}

export class CreatureManager {
  /**
   * @param engine Engine
   * @param opts { collision: CollisionWorld, root: Object3D to parent meshes under }
   */
  constructor(engine, { collision = null, root = null } = {}) {
    this.engine = engine;
    this.collision = collision;
    this.root = new THREE.Group();
    this.root.name = 'creatures';
    (root || engine.scene).add(this.root);
    this.groups = [];
    this.time = 0;
    this.player = new THREE.Vector3(0, -1e5, 0);
    this.playerVel = new THREE.Vector3();
    this.playerSpeed = 0;
  }

  ground(x, z) {
    const g = this.collision ? this.collision.groundHeight(x, z) : -Infinity;
    return g;
  }

  groundNormal(x, z, out) {
    const e = 0.4;
    const h0 = this.ground(x - e, z), h1 = this.ground(x + e, z), h2 = this.ground(x, z - e), h3 = this.ground(x, z + e);
    if (!isFinite(h0 + h1 + h2 + h3)) return out.set(0, 1, 0);
    return out.set(h0 - h1, 2 * e, h2 - h3).normalize();
  }

  /**
   * Spawn a group of one species.
   * opts: count, beh, home (Vector3), radius, yMin, yMax, clearance, speed, turn, shy, path (Vector3[]), points ([{p, yaw, dir, scale}]),
   *       vortex {radius, height}, client () => {p, r} | null, scale [min, max], groundOffset, active (m), onUpdate(group, dt)
   */
  spawn(id, opts = {}) {
    const data = SPECIES[id];
    const app = APPEARANCE[id];
    if (!data || !app) throw new Error('unknown species ' + id);
    const mo = MOTION[id] || {};
    const count = opts.count ?? (opts.points ? opts.points.length : data.schoolSize ?? 1);
    const inst = makeInstanced(id, count);
    const L = modelLength(id);
    const beh = opts.beh || data.behavior[0];
    const o = {
      radius: 6, clearance: Math.max(0.35, L * 0.7), speed: mo.speed ?? clamp(0.2 + L * 0.45, 0.1, 1.0),
      turn: mo.turn ?? clamp(2.4 / (0.35 + L), 0.3, 4), pitch: mo.pitch ?? 0.4, bank: mo.bank ?? 0.15,
      shy: mo.shy ?? 2, groundOffset: mo.groundOffset ?? 0.02, scale: [0.88, 1.12], active: 110,
      freq: app.freq ?? 1.5, upright: app.gen === 'jelly', ...opts,
    };
    const g = {
      id, data, app, L, beh, o, count,
      mesh: inst.mesh, anim: inst.anim, geometry: inst.geometry, material: inst.material,
      agents: [], anchor: (opts.home || new THREE.Vector3()).clone(), anchorTarget: (opts.home || new THREE.Vector3()).clone(),
      heading: Math.random() * TAU, display: 0, alarm: 0, active: true, visible: true,
      radius: (L * (app.gen === 'body' ? 0.5 : 0.6)),
    };
    const home = o.home || new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = new Agent(i);
      a.scale = rand(o.scale[0], o.scale[1]);
      const pt = opts.points?.[i];
      if (pt) {
        a.home.copy(pt.p);
        if (pt.dir) a.homeDir.copy(pt.dir).normalize();
        a.homeYaw = pt.yaw ?? (pt.dir ? Math.atan2(pt.dir.x, pt.dir.z) : Math.random() * TAU);
        if (pt.scale) a.scale = pt.scale;
      } else {
        const r = Math.sqrt(Math.random()) * (beh === 'school' ? Math.min(o.radius, 1 + Math.cbrt(count) * L * 2) : o.radius);
        const th = Math.random() * TAU;
        a.home.set(home.x + Math.cos(th) * r, home.y + rand(-0.5, 0.5) * Math.min(o.radius, 2), home.z + Math.sin(th) * r);
      }
      a.p.copy(a.home);
      a.yaw = a.homeYaw;
      if (GROUND_BEHAVIOURS.has(beh) || opts.onGround) this._snapGround(g, a);
      else this._clampY(g, a);
      a.v.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(o.speed * 0.5);
      a.layer = rand(-0.5, 0.5);
      a.offset.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      g.agents.push(a);
    }
    if (o.path) {
      g.curve = new THREE.CatmullRomCurve3(o.path, o.loop ?? true, 'centripetal');
      g.curveLen = g.curve.getLength();
      g.agents.forEach((a, i) => { a.s = (o.pathStart ?? 0) + i * 0.13; g.curve.getPointAt(((a.s % 1) + 1) % 1, a.p); });
    }
    g.mesh.count = count;
    this.root.add(g.mesh);
    this.groups.push(g);
    this._write(g);
    return g;
  }

  remove(g) {
    const i = this.groups.indexOf(g);
    if (i >= 0) this.groups.splice(i, 1);
    g.mesh.removeFromParent();
    g.geometry.dispose(); g.material.dispose();
  }

  dispose() {
    for (const g of [...this.groups]) this.remove(g);
    this.root.removeFromParent();
  }

  /** Iterate visible agents: fn(group, agent). */
  forEachAgent(fn) {
    for (const g of this.groups) if (g.visible) for (const a of g.agents) if (a.visible) fn(g, a);
  }

  setPlayer(pos, vel) {
    this.player.copy(pos);
    if (vel) this.playerVel.copy(vel);
    this.playerSpeed = this.playerVel.length();
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.time += dt;
    for (const g of this.groups) {
      const dHome = g.anchor.distanceTo(this.player);
      g.active = dHome < g.o.active + g.o.radius;
      g.mesh.visible = g.visible && g.active;
      if (!g.active) continue;
      if (g.o.onUpdate) g.o.onUpdate(g, dt);
      this._groupStep(g, dt);
      for (const a of g.agents) this._agentStep(g, a, dt);
      this._write(g);
    }
  }

  // ---------------------------------------------------------------------------------------------- internals
  _snapGround(g, a) {
    const gh = this.ground(a.p.x, a.p.z);
    if (isFinite(gh)) a.p.y = gh + g.o.groundOffset * a.scale;
  }

  _clampY(g, a) {
    const o = g.o;
    const gh = this.ground(a.p.x, a.p.z);
    if (o.yMin !== undefined) a.p.y = Math.max(a.p.y, o.yMin);
    if (o.yMax !== undefined) a.p.y = Math.min(a.p.y, o.yMax);
    if (isFinite(gh)) a.p.y = Math.max(a.p.y, gh + o.clearance);
    const surf = (this.engine.env.depthBase ?? 0) - 0.6;
    a.p.y = Math.min(a.p.y, surf);
  }

  _pickTarget(g, a, center, radius, nearGround = false) {
    const o = g.o;
    const r = Math.sqrt(Math.random()) * radius, th = Math.random() * TAU;
    a.target.set(center.x + Math.cos(th) * r, 0, center.z + Math.sin(th) * r);
    const gh = this.ground(a.target.x, a.target.z);
    if (nearGround && isFinite(gh)) a.target.y = gh + rand(0.3, 0.9) * Math.max(0.4, g.L * 0.8);
    else {
      const y0 = o.yMin ?? center.y - 2, y1 = o.yMax ?? center.y + 2;
      a.target.y = rand(y0, y1);
      if (isFinite(gh)) a.target.y = Math.max(a.target.y, gh + o.clearance + 0.3);
    }
    a.target.y = Math.min(a.target.y, (this.engine.env.depthBase ?? 0) - 1.2);
    a.hasTarget = true;
    a.timer = rand(8, 20);
  }

  _groupStep(g, dt) {
    const o = g.o;
    g.display += ((o.display ?? 0) - g.display) * (1 - Math.exp(-dt * 1.5));
    if (g.beh === 'school' && !o.vortex) {
      // the school's anchor wanders around the home area
      if (g.anchor.distanceTo(g.anchorTarget) < 1.5 || Math.random() < dt * 0.02) {
        const c = o.home || g.anchor;
        const r = Math.sqrt(Math.random()) * o.radius, th = Math.random() * TAU;
        g.anchorTarget.set(c.x + Math.cos(th) * r, rand(o.yMin ?? c.y - 1.5, o.yMax ?? c.y + 1.5), c.z + Math.sin(th) * r);
        const gh = this.ground(g.anchorTarget.x, g.anchorTarget.z);
        if (isFinite(gh)) g.anchorTarget.y = Math.max(g.anchorTarget.y, gh + o.clearance + 0.5);
      }
      _d.subVectors(g.anchorTarget, g.anchor);
      const len = _d.length();
      if (len > 1e-4) g.anchor.addScaledVector(_d, Math.min(1, (o.speed * 0.55 * dt) / len));
    } else if (o.home && g.beh !== 'giant') g.anchor.copy(o.home);
    else if (g.agents.length) g.anchor.copy(g.agents[0].p);
    if (g.beh === 'herd') {
      if (Math.random() < dt * 0.01) g.heading += rand(-0.6, 0.6);
      const c = o.home || g.anchor;
      _d.set(Math.sin(g.heading), 0, Math.cos(g.heading));
      _a.subVectors(g.agents[0]?.p || c, c).setY(0);
      if (_a.length() > o.radius && _a.dot(_d) > 0) g.heading = wrapPi(g.heading + Math.PI * 0.8);
    }
  }

  _agentStep(g, a, dt) {
    const o = g.o, L = g.L;
    const want = _w.set(0, 0, 0);
    let speedCap = o.speed;
    let orient = 'swim';
    let effortMin = 0.2;
    let lookAt = null;
    // ---- perception of the player
    _d.subVectors(this.player, a.p);
    const dP = _d.length();
    const shy = o.shy * (0.6 + 0.4 * a.scale);
    if (shy > 0 && dP < shy && (this.playerSpeed > 0.75 || dP < shy * 0.5)) a.fear = Math.min(1, a.fear + dt * 3);
    else a.fear = Math.max(0, a.fear - dt * 0.35);
    a.cool = Math.max(0, a.cool - dt);

    switch (g.beh) {
      case 'sessile': {
        a.p.copy(a.home); this._snapGround(g, a);
        orient = 'ground'; a.v.set(0, 0, 0); effortMin = 0.3;
        break;
      }
      case 'school': {
        if (o.vortex) this._vortex(g, a, want);
        else this._boids(g, a, want);
        break;
      }
      case 'cruise': case 'graze': case 'curious': case 'display': {
        this._cruise(g, a, want, dt, dP);
        if (a.mode === 'watch') { speedCap = 0.12; lookAt = this.player; effortMin = 0.35; }
        if (a.mode === 'bite') { speedCap = 0.02; effortMin = 0.25; }
        break;
      }
      case 'rest': {
        if (a.mode === 'idle' || a.mode === 'rest') {
          a.mode = 'rest';
          if (a.fear > 0.5) { a.mode = 'flee'; a.timer = rand(15, 25); a.hasTarget = false; }
          else {
            // settle on the bottom at home
            _t.copy(a.home); const gh = this.ground(_t.x, _t.z); if (isFinite(gh)) _t.y = gh + o.groundOffset * a.scale;
            want.subVectors(_t, a.p).multiplyScalar(0.8);
            speedCap = 0.15;
            if (a.p.distanceTo(_t) < 0.25) { orient = 'ground'; a.yaw += wrapPi(a.homeYaw - a.yaw) * Math.min(1, dt * 0.5); }
            effortMin = 0.12;
          }
        }
        if (a.mode === 'flee' || a.mode === 'return') {
          a.timer -= dt;
          if (!a.hasTarget || a.p.distanceTo(a.target) < 1.2) this._pickTarget(g, a, o.home || a.home, o.radius);
          want.subVectors(a.target, a.p).normalize().multiplyScalar(o.speed);
          if (a.timer < 0) { a.mode = 'return'; a.target.copy(a.home); a.target.y += 0.6; if (a.p.distanceTo(a.target) < 1.0) a.mode = 'rest'; }
        }
        break;
      }
      case 'hover': case 'ambush': {
        if (!a.hasTarget || a.p.distanceTo(a.target) < 0.12 || (a.timer -= dt) < 0) {
          const r = g.beh === 'ambush' ? 0.15 : Math.min(o.hoverRadius ?? 0.6, o.radius);
          a.target.copy(a.home).add(_t.set(rand(-r, r), rand(-r, r) * 0.5, rand(-r, r)));
          a.hasTarget = true; a.timer = rand(4, 10);
        }
        want.subVectors(a.target, a.p).multiplyScalar(0.5);
        speedCap = o.speed;
        effortMin = g.beh === 'ambush' ? 0.06 : 0.3;
        if (a.fear > 0.3) { want.addScaledVector(_d.normalize(), -o.speed * 3 * a.fear); speedCap = o.speed * 4; }
        break;
      }
      case 'territorial': {
        if (a.mode === 'chase') {
          a.timer -= dt;
          _t.copy(this.player).addScaledVector(_d.normalize(), -0.3);
          want.subVectors(_t, a.p).normalize().multiplyScalar(0.7);
          speedCap = 0.7;
          if (a.timer < 0) { a.mode = 'idle'; a.cool = rand(3, 6); }
        } else {
          if (dP < 1.5 && a.cool <= 0 && a.i === 0) { a.mode = 'chase'; a.timer = 1.1; }
          if (!a.hasTarget || a.p.distanceTo(a.target) < 0.06 || (a.timer -= dt) < 0) {
            a.target.copy(a.home).add(_t.set(rand(-0.3, 0.3), rand(0.02, 0.28), rand(-0.3, 0.3)));
            a.hasTarget = true; a.timer = rand(0.8, 2.2);
          }
          want.subVectors(a.target, a.p).multiplyScalar(1.2);
          speedCap = 0.2;
          effortMin = 0.5;
        }
        break;
      }
      case 'cleaning': {
        const client = o.client ? o.client() : null;
        if (client && a.mode !== 'clean' && a.cool <= 0 && client.p.distanceTo(a.home) < 6) { a.mode = 'clean'; a.timer = rand(3, 7); }
        if (a.mode === 'clean' && client) {
          a.timer -= dt;
          _t.copy(client.p).addScaledVector(a.offset, client.r * 0.75);
          want.subVectors(_t, a.p).multiplyScalar(2.0);
          speedCap = 0.6;
          if (a.timer < 0) { a.mode = 'idle'; a.cool = rand(2, 5); }
        } else {
          a.mode = 'idle';
          if (!a.hasTarget || a.p.distanceTo(a.target) < 0.08 || (a.timer -= dt) < 0) {
            a.target.copy(a.home).add(_t.set(rand(-0.4, 0.4), rand(-0.1, 0.3), rand(-0.4, 0.4)));
            a.hasTarget = true; a.timer = rand(1, 3);
          }
          want.subVectors(a.target, a.p).multiplyScalar(1.0);
          speedCap = 0.2;
          effortMin = 0.45;
        }
        break;
      }
      case 'giant': {
        const len = g.curveLen || 1;
        a.s += (o.speed * dt) / len;
        const s = ((a.s % 1) + 1) % 1;
        g.curve.getPointAt(s, _t);
        const ahead = ((s + Math.max(2.5, L * 1.5) / len) % 1 + 1) % 1;
        g.curve.getPointAt(ahead, _a);
        const lag = a.p.distanceTo(_t);
        want.subVectors(_a, a.p).normalize().multiplyScalar(o.speed * (1 + clamp(lag / 6, 0, 0.8)));
        speedCap = o.speed * 1.8;
        if (o.path && lag > 25 && !o.noSnap) a.p.copy(_t);
        break;
      }
      case 'hide': {
        if (a.fear > 0.4) { a.mode = 'retreat'; a.timer = rand(6, 10); }
        let out;
        if (a.mode === 'retreat') { out = -0.05; a.timer -= dt; if (a.timer < 0 && a.fear < 0.2) a.mode = 'idle'; }
        else out = (o.peek ?? 0.12) * (0.5 + 0.5 * Math.sin(this.time * 0.3 + a.i * 2.1));
        _t.copy(a.home).addScaledVector(a.homeDir, out);
        a.p.lerp(_t, 1 - Math.exp(-dt * (a.mode === 'retreat' ? 4 : 0.8)));
        a.v.set(0, 0, 0);
        orient = 'dir';
        a.stateTarget = a.mode === 'retreat' ? 1 : 0;
        effortMin = 0.25;
        break;
      }
      case 'drift': case 'pulse': {
        const cur = this.engine.env.current;
        if (!a.hasTarget || (a.timer -= dt) < 0) { a.target.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize(); a.hasTarget = true; a.timer = rand(6, 14); }
        want.copy(a.target).multiplyScalar(o.speed).addScaledVector(cur, 0.6);
        // stay near home
        _t.subVectors(a.home, a.p);
        const dh = _t.length();
        if (dh > o.radius) want.addScaledVector(_t.normalize(), o.speed * 2 * (dh / o.radius - 1));
        speedCap = o.speed * 2;
        effortMin = g.beh === 'pulse' || g.o.upright ? 1 : 0.25;
        orient = o.upright ? 'upright' : 'swim';
        break;
      }
      case 'swarm': {
        const c = o.center ? o.center() : a.home;
        if (!a.hasTarget || a.p.distanceTo(a.target) < 0.05 || (a.timer -= dt) < 0) {
          if (o.cylinder) {
            const th = Math.random() * TAU, r = rand(o.cylinder.r0, o.cylinder.r1);
            a.target.set(c.x + Math.cos(th) * r, c.y + rand(0, o.cylinder.h), c.z + Math.sin(th) * r);
          } else {
            const r = o.radius;
            a.target.set(c.x + rand(-r, r), c.y + rand(-r, r) * 0.5, c.z + rand(-r, r));
          }
          a.hasTarget = true; a.timer = rand(0.4, 1.8);
        }
        want.subVectors(a.target, a.p).normalize().multiplyScalar(o.speed);
        effortMin = 0.6;
        if (o.cylinder) lookAt = _b.set(c.x, a.p.y, c.z);
        break;
      }
      case 'crawl': {
        if (!a.hasTarget || a.p.distanceTo(a.target) < 0.08 || (a.timer -= dt) < 0) {
          this._pickTarget(g, a, a.home, o.radius, true);
          a.timer = rand(10, 40);
          if (Math.random() < 0.35) { a.mode = 'pause'; a.timer = rand(4, 12); } else a.mode = 'walk';
        }
        if (a.mode === 'walk') want.subVectors(a.target, a.p).setY(0).normalize().multiplyScalar(o.speed);
        if (a.fear > 0.3) want.addScaledVector(_d.setY(0).normalize(), -o.speed * 2 * a.fear);
        orient = 'ground';
        effortMin = a.mode === 'walk' ? 0.8 : 0.05;
        break;
      }
      case 'herd': {
        want.set(Math.sin(g.heading), 0, Math.cos(g.heading)).multiplyScalar(o.speed * (0.7 + 0.3 * Math.sin(this.time * 0.2 + a.i)));
        // spacing
        for (const b of g.agents) {
          if (b === a) continue;
          _t.subVectors(a.p, b.p).setY(0);
          const d = _t.length();
          if (d < 0.35 && d > 1e-4) want.addScaledVector(_t, (0.35 - d) / d * 0.1);
        }
        orient = 'ground';
        effortMin = 0.7;
        break;
      }
      case 'perch': {
        if (a.mode === 'idle' || a.mode === 'perch') {
          a.mode = 'perch';
          if (a.fear > 0.55) { a.mode = 'flee'; a.timer = rand(8, 14); a.hasTarget = false; }
          const cur = this.engine.env.current;
          a.homeYaw = Math.atan2(-cur.x, -cur.z);
          _t.copy(a.home); const gh = this.ground(_t.x, _t.z); if (isFinite(gh)) _t.y = gh + o.groundOffset;
          want.subVectors(_t, a.p).multiplyScalar(0.6);
          speedCap = 0.12;
          if (a.p.distanceTo(_t) < 0.2) { orient = 'ground'; a.yaw += wrapPi(a.homeYaw - a.yaw) * Math.min(1, dt * 0.3); }
          effortMin = 0.04;
        } else {
          a.timer -= dt;
          if (!a.hasTarget || a.p.distanceTo(a.target) < 1) this._pickTarget(g, a, o.home || a.home, o.radius, true);
          want.subVectors(a.target, a.p).normalize().multiplyScalar(o.speed);
          if (a.timer < 0) { a.home.copy(a.p); a.mode = 'perch'; }
        }
        break;
      }
      default: break;
    }

    // ---- reactions and limits for free swimmers
    const free = orient === 'swim' || orient === 'upright';
    if (free && g.beh !== 'giant') {
      if (a.fear > 0 && g.beh !== 'territorial' && g.beh !== 'cleaning' && dP > 1e-3) {
        _t.copy(_d).normalize().multiplyScalar(-1);
        want.addScaledVector(_t, o.speed * 2.2 * a.fear);
        speedCap = Math.max(speedCap, o.speed * (1 + 1.6 * a.fear));
      }
      // ground avoidance with look-ahead
      const vl = a.v.length();
      _a.copy(a.v).multiplyScalar(vl > 1e-3 ? Math.max(1.2, L * 2) / vl : 0).add(a.p);
      const gh = Math.max(this.ground(_a.x, _a.z), this.ground(a.p.x, a.p.z));
      if (isFinite(gh)) {
        const clr = a.p.y - gh;
        if (clr < o.clearance) want.y += (o.clearance - clr) * 2.5 * Math.max(o.speed, 0.1);
      }
      // stay below the surface and inside the region
      const surf = (this.engine.env.depthBase ?? 0) - 0.8;
      if (a.p.y > surf) want.y -= (a.p.y - surf) * 2;
      if (o.yMin !== undefined && a.p.y < o.yMin) want.y += (o.yMin - a.p.y) * 0.5;
      if (o.yMax !== undefined && a.p.y > o.yMax) want.y -= (a.p.y - o.yMax) * 0.5;
      const b = this.collision?.bounds;
      if (b) {
        if (a.p.x < b.min.x + 2) want.x += 0.3; if (a.p.x > b.max.x - 2) want.x -= 0.3;
        if (a.p.z < b.min.z + 2) want.z += 0.3; if (a.p.z > b.max.z - 2) want.z -= 0.3;
      }
    }

    // ---- integrate velocity & position
    if (orient !== 'dir' && g.beh !== 'sessile') {
      const wl = want.length();
      if (wl > speedCap) want.multiplyScalar(speedCap / wl);
      const agility = o.agility ?? clamp(1.6 / (0.3 + L), 0.25, 6);
      a.v.lerp(want, 1 - Math.exp(-dt * agility));
      a.p.addScaledVector(a.v, dt);
      if (orient === 'ground') this._snapGround(g, a);
      else if (free && this.collision && L > 0.05 && g.beh !== 'giant') {
        this.collision.resolve(a.p, Math.max(0.04, L * 0.28 * a.scale), a.v, 1);
        const gh = this.ground(a.p.x, a.p.z);
        if (isFinite(gh) && a.p.y < gh + Math.max(0.05, L * 0.2)) a.p.y = gh + Math.max(0.05, L * 0.2);
      }
    }

    // ---- orientation
    const spd = a.v.length();
    let yawRate = 0;
    if (orient === 'dir') {
      const ty = Math.atan2(a.homeDir.x, a.homeDir.z);
      a.yaw += wrapPi(ty - a.yaw) * Math.min(1, dt * 2);
      a.pitch += (-Math.asin(clamp(a.homeDir.y, -1, 1)) - a.pitch) * Math.min(1, dt * 2);
      a.roll *= 0.9;
    } else if (orient === 'upright') {
      a.yaw += dt * 0.05 * (a.i % 2 ? 1 : -1);
      a.pitch = Math.sin(this.time * 0.21 + a.i) * 0.12 + clamp(a.v.z * 2, -0.2, 0.2);
      a.roll = Math.cos(this.time * 0.17 + a.i * 1.3) * 0.12 - clamp(a.v.x * 2, -0.2, 0.2);
    } else {
      let ty = a.yaw, tp = 0;
      if (lookAt) { _t.subVectors(lookAt, a.p); ty = Math.atan2(_t.x, _t.z); tp = -Math.atan2(_t.y, Math.hypot(_t.x, _t.z)) * 0.5; }
      else if (spd > Math.max(0.01, o.speed * 0.08)) {
        ty = Math.atan2(a.v.x, a.v.z);
        tp = -Math.atan2(a.v.y, Math.hypot(a.v.x, a.v.z));
      }
      if (a.mode === 'bite') tp = 0.45;
      if (orient === 'ground') tp = 0;
      tp = clamp(tp, -o.pitch, o.pitch);
      const dy = wrapPi(ty - a.yaw);
      const maxT = o.turn * (1 + a.fear * 1.5) * dt;
      const step = clamp(dy * Math.min(1, dt * 3), -maxT, maxT);
      a.yaw = wrapPi(a.yaw + step);
      yawRate = step / dt;
      a.pitch += (tp - a.pitch) * Math.min(1, dt * 2);
      a.yawRate += (yawRate - a.yawRate) * Math.min(1, dt * 4);
      a.roll += (clamp(-a.yawRate * o.bank, -0.6, 0.6) - a.roll) * Math.min(1, dt * 2);
    }
    // ---- animation channels
    const cruise = Math.max(o.speed, 0.005);
    let effort = spd / cruise + Math.abs(a.yawRate) * 0.25;
    if (g.beh === 'display' || o.display) effort += g.display * 0.6;
    effort = clamp(Math.max(effort, effortMin), 0, 2.2);
    a.effort += (effort - a.effort) * Math.min(1, dt * 3);
    a.phase += dt * TAU * o.freq * (0.35 + 0.65 * a.effort);
    const bend = clamp((a.yawRate * L) / Math.max(spd, 0.08), -1.2, 1.2);
    a.bend += (bend - a.bend) * Math.min(1, dt * 4);
    a.state += ((Math.max(a.stateTarget, g.display, g.alarm)) - a.state) * Math.min(1, dt * 2.5);
  }

  _cruise(g, a, want, dt, dP) {
    const o = g.o;
    const center = o.home || a.home;
    if (g.beh === 'curious' || o.curious) {
      if (a.mode === 'approach' || a.mode === 'watch') {
        a.timer -= dt;
        if (a.fear > 0.4 || a.timer < 0 || dP > 16) { a.mode = 'leave'; a.cool = rand(25, 45); a.hasTarget = false; }
        else if (a.mode === 'approach') {
          _t.subVectors(a.p, this.player).setY(0).normalize().multiplyScalar(3.0).add(this.player);
          want.subVectors(_t, a.p).normalize().multiplyScalar(o.speed);
          if (dP < 3.6) { a.mode = 'watch'; a.timer = rand(6, 10); }
          return;
        } else { // watch: hold station facing the diver
          _t.subVectors(a.p, this.player).normalize().multiplyScalar(3.0).add(this.player);
          want.subVectors(_t, a.p).multiplyScalar(0.3);
          return;
        }
      } else if (a.cool <= 0 && dP < 12 && this.playerSpeed < 0.5) { a.mode = 'approach'; a.timer = 25; return; }
    }
    if (g.beh === 'graze' && a.mode === 'bite') {
      a.timer -= dt;
      if (a.timer < 0) { a.mode = 'swim'; a.hasTarget = false; }
      want.set(0, 0, 0);
      return;
    }
    if (!a.hasTarget || a.p.distanceTo(a.target) < 0.8 + g.L || (a.timer -= dt) < 0) {
      if (g.beh === 'graze' && a.hasTarget && a.p.distanceTo(a.target) < 1 + g.L) { a.mode = 'bite'; a.timer = rand(2, 5); a.hasTarget = false; return; }
      this._pickTarget(g, a, center, o.radius, g.beh === 'graze');
      if (a.mode !== 'leave') a.mode = 'swim';
    }
    want.subVectors(a.target, a.p).normalize().multiplyScalar(o.speed * (g.beh === 'graze' ? 0.6 : 1));
  }

  _boids(g, a, want) {
    const o = g.o, L = g.L;
    const sepD = Math.max(0.06, L * (o.spacing ?? 1.15)) * a.scale;
    const nR = Math.max(0.35, L * 6);
    _sep.set(0, 0, 0); _ali.set(0, 0, 0); _coh.set(0, 0, 0);
    let n = 0;
    const ag = g.agents;
    for (let k = 0; k < ag.length; k++) {
      const b = ag[k];
      if (b === a) continue;
      const dx = a.p.x - b.p.x, dy = a.p.y - b.p.y, dz = a.p.z - b.p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > nR * nR) continue;
      const d = Math.sqrt(d2) + 1e-5;
      n++;
      _ali.add(b.v); _coh.add(b.p);
      if (d < sepD * 2) _sep.x += (dx / d) * (1 - d / (sepD * 2)), _sep.y += (dy / d) * (1 - d / (sepD * 2)), _sep.z += (dz / d) * (1 - d / (sepD * 2));
    }
    const vl = a.v.length();
    want.copy(a.v).multiplyScalar(vl > 1e-4 ? 1 / vl : 0);
    if (n) {
      _ali.multiplyScalar(1 / n); const al = _ali.length(); if (al > 1e-4) want.addScaledVector(_ali, 0.55 / al);
      _coh.multiplyScalar(1 / n).sub(a.p); const cl = _coh.length(); if (cl > 1e-4) want.addScaledVector(_coh, (0.25 * Math.min(1, cl / nR)) / cl);
      want.addScaledVector(_sep, 2.2);
    }
    _t.subVectors(g.anchor, a.p);
    const da = _t.length();
    const R = Math.max(0.4, Math.cbrt(ag.length) * sepD * 1.6);
    if (da > 1e-4) want.addScaledVector(_t, (clamp((da - R) / R, 0, 3) * 0.8 + 0.08) / da);
    // individual hover fish (chromis) dart down to their coral head when frightened
    if (o.refuge && a.fear > 0.2) { _t.subVectors(o.refuge, a.p); want.addScaledVector(_t.normalize(), 3 * a.fear); }
    want.normalize().multiplyScalar(o.speed * (0.85 + 0.3 * Math.sin(this.time * 0.5 + a.i * 1.7)));
  }

  _vortex(g, a, want) {
    const o = g.o, c = o.home;
    const vx = o.vortex;
    _t.set(a.p.x - c.x, 0, a.p.z - c.z);
    const r = _t.length() + 1e-4;
    _t.multiplyScalar(1 / r);
    const ringR = vx.radius * (0.75 + 0.5 * ((a.i * 0.618) % 1));
    const layerY = c.y + a.layer * vx.height + Math.sin(this.time * 0.1 + a.i) * 0.3;
    // tangential swimming around the column + springs back to the ring and layer
    want.set(-_t.z, 0, _t.x).multiplyScalar(vx.dir ?? 1);
    want.addScaledVector(_t, clamp((ringR - r) / ringR, -1, 1) * 1.4);
    want.y += clamp((layerY - a.p.y) / Math.max(0.5, vx.height * 0.3), -1, 1) * 0.6;
    // separation
    const sepD = Math.max(0.1, g.L * 1.1);
    for (const b of g.agents) {
      if (b === a) continue;
      const dx = a.p.x - b.p.x, dy = a.p.y - b.p.y, dz = a.p.z - b.p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < sepD * sepD && d2 > 1e-8) { const d = Math.sqrt(d2); want.x += (dx / d) * (1 - d / sepD) * 1.5; want.y += (dy / d) * (1 - d / sepD) * 1.5; want.z += (dz / d) * (1 - d / sepD) * 1.5; }
    }
    // the column parts around a diver who swims into it
    _d.subVectors(a.p, this.player);
    const dP = _d.length();
    if (dP < 2.4) want.addScaledVector(_d.normalize(), (2.4 - dP) * 1.2);
    want.normalize().multiplyScalar(o.speed);
  }

  _write(g) {
    const anim = g.anim.array;
    for (const a of g.agents) {
      const i = a.i;
      if (g.o.upright) _e.set(a.pitch, a.yaw, a.roll, 'YXZ');
      else _e.set(a.pitch, a.yaw, a.roll, 'YXZ');
      _q.setFromEuler(_e);
      if ((g.beh === 'crawl' || g.beh === 'herd' || g.beh === 'sessile' || (g.beh === 'rest' && a.mode === 'rest')) && this.collision) {
        this.groundNormal(a.p.x, a.p.z, _n);
        _q2.setFromUnitVectors(_up, _n);
        _q.premultiply(_q2);
      }
      const sc = a.visible ? a.scale : 0;
      _s.set(sc, sc, sc);
      _m4.compose(a.p, _q, _s);
      g.mesh.setMatrixAt(i, _m4);
      anim[i * 4] = a.phase % 6283.1853;
      anim[i * 4 + 1] = a.effort;
      anim[i * 4 + 2] = a.bend;
      anim[i * 4 + 3] = a.state;
    }
    g.mesh.instanceMatrix.needsUpdate = true;
    g.anim.needsUpdate = true;
    g.mesh.boundingSphere = null;
  }
}
