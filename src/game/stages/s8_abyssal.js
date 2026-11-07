import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { Pod } from '../../player/Pod.js';
import { POD } from '../../world/podModel.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { guidedDescent } from '../transitions.js';
import { Heightfield, makeTerrainMaterial } from '../../world/Terrain.js';
import { Scatter, jitterGrid } from '../../world/Scatter.js';
import { makeReefKit } from '../../world/stages/reefBuild.js';
import { makeRockMaterial } from '../../render/materials.js';
import { cableMesh } from '../../world/landers.js';
import { Noise, RNG, smoothstep, clamp } from '../../world/noise.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE = 4560;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export default class AbyssalStage extends Stage {
  static get id() { return 'abyssal'; }

  async build(yieldFrame) {
    const e = this.engine, lib = e.lib, n = new Noise(91), rng = new RNG(911);
    this.outcrop = V(32, 0, 42);
    const height = (x, z) => {
      let y = -40 + n.fbm2(x * 0.012, z * 0.012, 3) * 1.6 + n.fbm2(x * 0.08, z * 0.08, 2) * 0.18;
      const d = Math.hypot(x - this.outcrop.x, z - this.outcrop.z);
      y += 3.2 * Math.exp(-(d * d) / (2 * 5.5 * 5.5)) + Math.max(0, n.n2(x * 0.4, z * 0.4)) * 0.6 * (1 - smoothstep(4, 9, d));
      return y;
    };
    this.height = height;
    this.outcrop.y = height(this.outcrop.x, this.outcrop.z);
    this.hf = new Heightfield({
      x0: -130, z0: -130, sizeX: 260, sizeZ: 260, cell: e.preset.terrainCell * 1.1,
      heightFn: height,
      maskFn: (x, z) => { const d = Math.hypot(x - this.outcrop.x, z - this.outcrop.z); return [clamp(1 - smoothstep(3, 8, d), 0, 1), clamp(0.3 + n.n2(x * 0.05, z * 0.05) * 0.3, 0, 1), 0]; },
    });
    this.terrain = new THREE.Group();
    this.terrain.add(this.hf.buildMesh(makeTerrainMaterial(lib, { soft: 'ooze', hard: 'basalt', scaleA: 1 / 4.0, tintA: [0.92, 0.88, 0.8], tintB: [0.55, 0.53, 0.52], tintC: [0.86, 0.8, 0.72], key: 'abyss' }), { chunks: 8 }));
    await yieldFrame();
    // manganese nodules, burrow mounds, and a few boulders
    const kit = makeReefKit(e, 91);
    const sc = new Scatter({ cell: 30 });
    const nodMat = makeRockMaterial(lib, { tex: 'basalt', scale: 1 / 0.3, key: 'nodule' });
    nodMat.color.setRGB(0.32, 0.27, 0.24);
    const nodGeo = kit.G.rubble[0];
    const nrm = new THREE.Vector3();
    for (const [x, z] of jitterGrid(rng, -125, -125, 125, 125, 0.9, (x, z) => (0.25 + 0.45 * smoothstep(-0.2, 0.4, n.n2(x * 0.02 + 3, z * 0.02))) * e.preset.dressDensity)) {
      this.hf.normal(x, z, nrm);
      sc.add('nod', nodGeo, nodMat, { pos: V(x, height(x, z) - 0.01, z), normal: nrm.clone(), align: 0.8, scale: rng.range(0.25, 0.6), color: new THREE.Color(0.9, 0.85, 0.8) }, { maxDist: 26 });
    }
    // low burrow mounds (Lebensspuren): flattened domes of sediment
    const moundGeo = new THREE.SphereGeometry(0.3, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.28, 1);
    const moundMat = makeRockMaterial(lib, { tex: 'ooze', scale: 1 / 1.5, key: 'mound' });
    for (const [x, z] of jitterGrid(rng, -125, -125, 125, 125, 2.4, () => 0.5 * e.preset.dressDensity)) sc.add('mound', moundGeo, moundMat, { pos: V(x, height(x, z) - 0.035, z), scale: rng.range(0.5, 1.3), color: new THREE.Color(0.9, 0.87, 0.8) }, { maxDist: 30 });
    for (const [x, z] of jitterGrid(rng, -125, -125, 125, 125, 9, () => 0.3)) {
      this.hf.normal(x, z, nrm);
      const vi = rng.int(0, kit.G.rock.length - 1);
      sc.add('rock' + vi, kit.G.rock[vi], kit.M.rock, { pos: V(x, height(x, z) - 0.2, z), normal: nrm.clone(), align: 0.6, scale: rng.range(0.4, 1.4), color: new THREE.Color(0.5, 0.48, 0.46) }, { collide: 0.8, maxDist: 50 });
    }
    this.terrain.add(sc.build());
    this.scatter = sc;
    this.scatters.push(sc);
    // the sample nodule (a little larger, just ahead of the arrival point)
    this.nodule = new THREE.Mesh(nodGeo, nodMat);
    const np = V(1.2, 0, -45); np.y = height(np.x, np.z) + 0.05;
    this.nodule.position.copy(np); this.nodule.scale.setScalar(0.9);
    this.terrain.add(this.nodule);
    // an abandoned cable across the plain, looped up over a boulder where it can snag the pod
    const cz = 18, pts = [];
    for (let x = -120; x <= 120; x += 6) {
      const loop = Math.exp(-((x - 4) ** 2) / 18) * 1.5;
      pts.push(V(x, height(x, cz + Math.sin(x * 0.03) * 4) + 0.03 + loop, cz + Math.sin(x * 0.03) * 4));
    }
    this.cablePts = pts;
    this.snag = V(4, height(4, cz) + 1.5, cz + Math.sin(4 * 0.03) * 4);
    const cb = cableMesh(pts);
    this.cable = cb.mesh;
    this.terrain.add(this.cable);
    const boulder = new THREE.Mesh(kit.G.rock[0], kit.M.rock);
    boulder.position.set(4, height(4, cz) - 0.3, cz + Math.sin(0.12) * 4); boulder.scale.setScalar(1.1);
    this.terrain.add(boulder);
    this.root.add(this.terrain);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.setWaterType('deep');
    env.naturalLight = 1;
    env.exposureOverride = null;
    env.bottomAlbedo = 0.12;
    env.current.set(0.02, 0, 0.0);
    e.snow.setDensity(1.2); e.dust.setDensity(0.9);
    const c = game.collision;
    c.addHeightfield(this.hf);
    for (const it of this.scatter.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    c.bounds = { min: V(-120, -60, -120), max: V(120, 20, 120) };
    this.pod = new Pod(game, { position: V(0, -36, -52), yaw: Math.PI, parent: this.root });
    this.pod.importState(game.carry);
    this.pod.vertAccel = 0.3;
    this.pod.cockpit.switches.forEach((s) => this.pod.cockpit.setSwitch(s, true));
    game.setPlayer(this.pod);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('pod');
    const mgr = this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    const gy = (x, z) => this.height(x, z);
    mgr.spawn('sea_pig', { beh: 'herd', count: 14, home: V(-14, gy(-14, -20), -20), radius: 10, active: 120 });
    mgr.spawn('tripod', { beh: 'perch', points: [{ p: V(16, 0, -30) }, { p: V(-26, 0, -6) }, { p: V(8, 0, 34) }], radius: 30, active: 140 });
    mgr.spawn('dumbo', { beh: 'hover', points: [{ p: V(9, gy(9, -12) + 3.2, -12) }], hoverRadius: 1.5, active: 140 });
    const sp = [];
    for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 1.5 + (i % 3) * 1.4; sp.push({ p: V(this.outcrop.x + Math.cos(a) * r, 0, this.outcrop.z + Math.sin(a) * r), yaw: a, scale: 0.8 + (i % 3) * 0.25 }); }
    mgr.spawn('glass_sponge', { beh: 'sessile', points: sp, active: 120 });
    mgr.spawn('brittle_star', { beh: 'crawl', count: 22, home: V(0, gy(0, -24), -24), radius: 22, onGround: true, active: 100 });
    mgr.spawn('grenadier', { beh: 'cruise', count: 2, home: V(0, gy(0, 0) + 2.5, 0), radius: 40, yMin: -42, yMax: -33, clearance: 1.2, speed: 0.22, active: 160 });
    mgr.spawn('hadal_cucumber', { beh: 'crawl', count: 3, home: V(-8, gy(-8, 10), 10), radius: 14, onGround: true, active: 100 });
    game.scanner.enabled = true;
    game.scanner.range = 16;
    this.onDispose(game.scanner.addSource((cb) => mgr.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    this.pod.onArmUse = (wrist, aim) => this._arm(wrist, aim);
    this.flags = {};
    this.phase = 'descent';
    this.terrain.visible = false; this.creatures.root.visible = false;
    this.transition = guidedDescent(this, {
      from: Math.max(3600, game.carry?.depth ?? 3600), to: BASE + 36, duration: 30, zone: 'Into the abyss',
      lines: [{ at: 4000, key: 'abyssal.d4000' }],
      onDone: () => { this.phase = 'explore'; this.terrain.visible = true; this.creatures.root.visible = true; game.checkpoint(8); game.say('abyssal.arrive'); this._objectives(); },
    });
    this.cutT = 0; this.pullT = 0;
    this._objectives();
  }

  _objectives() {
    const f = this.flags, list = [];
    if (this.phase === 'descent') list.push({ id: 'd', text: 'Descend to the abyssal plain', done: false });
    else {
      list.push({ id: 'sample', text: 'Collect a manganese nodule with the arm', sub: f.sample ? '' : '(hold right mouse, aim, click)', done: !!f.sample });
      if (f.snagged || f.freed) list.push({ id: 'cable', text: f.freed ? 'Free of the cable' : 'Cable snag: grip it with the arm — click to cut, or hold click + S to pull free', done: !!f.freed });
      if (f.sample && (f.freed || f.cableSkipped)) list.push({ id: 'next', text: 'On to the trench: hold E on the ballast switch', done: false });
      else if (f.sample) list.push({ id: 'south', text: 'Head south across the plain towards the trench', done: false });
    }
    this.game.ui.setObjectives('Abyssal plain · 4,000–6,000 m', list);
  }

  _arm(wrist, aim) {
    const game = this.game, f = this.flags;
    const p = aim || wrist;
    if (!f.sample && this.nodule.parent && p.distanceTo(this.nodule.getWorldPosition(_a)) < 0.55) {
      // grip the nodule and stow it in the sample basket
      f.sample = true;
      const claw = this.pod.model.arm.wrist;
      claw.attach(this.nodule);
      audio.play('thunk', { gain: 0.35, rate: 1.6 });
      game.after(1.6, () => {
        this.pod.model.group.attach(this.nodule);
        this.nodule.position.set(-0.2, -1.38, -1.9);
        this.nodule.scale.setScalar(0.45);
        audio.play('click', { gain: 0.4 });
        game.say('abyssal.sample');
        game.save.flags.sample = true;
        this._objectives();
        if (!this.flags.southSaid) { this.flags.southSaid = true; game.after(5, () => game.say('abyssal.south')); }
      });
      return;
    }
    if (f.snagged && !f.freed && p.distanceTo(this.snag) < 0.9) {
      f.gripping = true;
      audio.play('thunk', { gain: 0.3, rate: 1.3 });
      game.say('abyssal.cable.grip');
    }
  }

  update(dt) {
    super.update(dt);
    const game = this.game, pod = this.pod, f = this.flags, input = game.input;
    if (this.transition && this.transition.active) this.transition.update(dt);
    pod.update(dt);
    this.creatures.setPlayer(pod.pos, pod.vel);
    this.creatures.update(dt);
    if (this.phase !== 'explore') return;
    if (!f.armHint && pod.pos.distanceTo(this.nodule.position) < 8) { f.armHint = true; game.say('abyssal.arm'); }
    // the cable snag: near the looped section, low over the bottom
    const dh = Math.hypot(pod.pos.x - this.snag.x, pod.pos.z - this.snag.z);
    if (!f.snagged && !f.freed && dh < 3.0 && pod.pos.y < this.snag.y + 2.4) {
      f.snagged = true;
      this.snagPoint = pod.pos.clone();
      bus.emit('tension', true);
      audio.play('creak', { gain: 0.6, rate: 0.7 }); audio.play('thunk', { gain: 0.5, rate: 0.5 });
      game.say('abyssal.cable.snag', { interrupt: true });
      this._objectives();
    }
    if (f.snagged && !f.freed) {
      // the cable holds the frame: the pod can strain but not get away
      _b.subVectors(pod.pos, this.snagPoint);
      const d = _b.length();
      if (d > 0.8) { pod.pos.addScaledVector(_b, -(d - 0.8) / d); pod.vel.multiplyScalar(0.5); }
      pod.wobble = Math.max(pod.wobble, Math.min(0.6, Math.abs(pod.tF) * 0.5));
      // pull the cable loop towards the pod's skid
      if (f.gripping && pod.armActive && input.clickDown()) {
        this.cutT += dt;
        if (input.isDown('back')) this.pullT += dt;
        if (this.cutT > 1.6 || this.pullT > 2.0) this._free(this.pullT > 2.0 ? 'pull' : 'cut');
      } else { this.cutT = Math.max(0, this.cutT - dt); this.pullT = Math.max(0, this.pullT - dt); }
      game.ui.prompt(f.gripping ? (pod.armActive ? 'Hold click to cut · hold click + S to pull free' : 'Hold right mouse to use the arm') : 'Right mouse: arm · aim at the cable on the skid · click to grip', f.gripping ? Math.max(this.cutT / 1.6, this.pullT / 2.0) : null);
    }
    if (f.sample && !f.leaveItem && (f.freed || pod.pos.z > 60)) {
      if (!f.freed) f.cableSkipped = true;
      f.leaveItem = true;
      this._objectives();
      game.say('abyssal.next');
      const sw = pod.cockpit.switches.find((s) => s.id === 'ballast');
      this.leave = game.interactions.add({ object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood ballast · to the trench',
        onUse: () => { game.interactions.remove(this.leave); audio.play('hiss', { gain: 0.6, rate: 0.6 }); game.carry = { ...(game.carry || {}), ...pod.exportState(), depth: pod.depth }; game.goToStage(9, { fadeTime: 1.4 }); } });
    }
  }

  _free(how) {
    const game = this.game, f = this.flags;
    f.freed = true; f.gripping = false;
    bus.emit('tension', false);
    game.ui.prompt(null);
    audio.play(how === 'cut' ? 'switch' : 'creak', { gain: 0.6, rate: how === 'cut' ? 0.5 : 1.2 });
    // the loop drops back to the sediment
    const pos = this.cable.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), g = this.height(x, z) + 0.03; if (pos.getY(i) > g + 0.05) pos.setY(i, g + (pos.getY(i) - g) * 0.15); }
    pos.needsUpdate = true; this.cable.geometry.computeVertexNormals();
    game.save.stats.events.cable = how;
    game.say(how === 'cut' ? 'abyssal.cable.cut' : 'abyssal.cable.pull', { interrupt: true });
    this._objectives();
  }
}

export { POD };
