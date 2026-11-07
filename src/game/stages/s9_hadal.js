import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { Pod } from '../../player/Pod.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { guidedDescent } from '../transitions.js';
import { Heightfield, makeTerrainMaterial } from '../../world/Terrain.js';
import { Scatter, jitterGrid } from '../../world/Scatter.js';
import { makeReefKit } from '../../world/stages/reefBuild.js';
import { buildBaitStation, buildEcho7 } from '../../world/landers.js';
import { interiorMaterial } from '../../player/Cockpit.js';
import { Noise, RNG, smoothstep, clamp } from '../../world/noise.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE_A = 6960, BASE_B = 10880;
const _a = new THREE.Vector3();

export default class HadalStage extends Stage {
  static get id() { return 'hadal'; }

  async build(yieldFrame) {
    const e = this.engine, lib = e.lib;
    // ---- area A: the trench's inner wall with a terrace for the bait station (~7,000 m)
    const nA = new Noise(101);
    this.hA = (x, z) => {
      let y = -20 - Math.max(0, z + 30) * 0.75 + nA.fbm2(x * 0.03, z * 0.03, 4) * 6 + Math.abs(nA.n2(x * 0.12, z * 0.12)) * 1.8;
      const t = Math.exp(-((z - 6) ** 2) / 60) * Math.exp(-(x * x) / 400);
      return THREE.MathUtils.lerp(y, -27.5 + nA.n2(x * 0.2, z * 0.2) * 0.3, t * 0.85);
    };
    this.hfA = new Heightfield({ x0: -110, z0: -110, sizeX: 220, sizeZ: 220, cell: e.preset.terrainCell * 1.1, heightFn: this.hA,
      maskFn: (x, z, h, slope) => [clamp(slope * 1.5 + nA.n2(x * 0.05, z * 0.05) * 0.3, 0, 1), 0.4, 0] });
    this.A = new THREE.Group();
    const mat = makeTerrainMaterial(lib, { soft: 'ooze', hard: 'basalt', scaleA: 1 / 3.5, tintA: [0.86, 0.83, 0.78], tintB: [0.5, 0.49, 0.48], key: 'hadal' });
    this.A.add(this.hfA.buildMesh(mat, { chunks: 8 }));
    this.bait = buildBaitStation();
    const bp = V(0, 0, 4); bp.y = this.hA(bp.x, bp.z) - 0.05;
    this.bait.group.position.copy(bp);
    this.bait.group.rotation.y = Math.PI;
    this.A.add(this.bait.group);
    this.bait.group.updateMatrixWorld(true);
    this.baitW = this.bait.bait.clone().applyMatrix4(this.bait.group.matrixWorld);
    this.A.visible = false;
    this.root.add(this.A);
    await yieldFrame();
    // ---- area B: the floor of the Challenger Deep between steep walls (~10,900 m)
    const nB = new Noise(131);
    this.hB = (x, z) => {
      const wall = Math.max(0, Math.abs(x + nB.n2(z * 0.01, 2.0) * 8) - 28);
      let y = -24 + nB.fbm2(x * 0.02, z * 0.02, 3) * 0.6 + Math.pow(wall, 1.35) * 0.75;
      y += wall > 0 ? nB.fbm2(x * 0.08, z * 0.08, 3) * 3 * smoothstep(0, 10, wall) : 0;
      return y;
    };
    this.hfB = new Heightfield({ x0: -110, z0: -110, sizeX: 220, sizeZ: 220, cell: e.preset.terrainCell, heightFn: this.hB,
      maskFn: (x) => [clamp((Math.abs(x) - 26) / 10, 0, 1), 0.35, 0] });
    this.B = new THREE.Group();
    this.B.add(this.hfB.buildMesh(mat, { chunks: 8 }));
    const kit = makeReefKit(e, 131), rng = new RNG(1311);
    const sc = new Scatter({ cell: 30 });
    const nrm = new THREE.Vector3();
    for (const [x, z] of jitterGrid(rng, -105, -105, 105, 105, 3.2, (x) => (Math.abs(x) > 30 ? 0.6 : 0.12) * e.preset.dressDensity)) {
      this.hfB.normal(x, z, nrm);
      const vi = rng.int(0, kit.G.rock.length - 1);
      sc.add('rock' + vi, kit.G.rock[vi], kit.M.rock, { pos: V(x, this.hB(x, z) - 0.25, z), normal: nrm.clone(), align: 0.6, scale: rng.range(0.4, 1.6), color: new THREE.Color(0.5, 0.49, 0.48) }, { collide: 0.8, maxDist: 50 });
    }
    this.B.add(sc.build());
    this.scatterB = sc;
    this.echo = buildEcho7();
    const ep = V(2, 0, 30); ep.y = this.hB(ep.x, ep.z) - 0.15;
    this.echo.group.position.copy(ep);
    this.echo.group.rotation.set(0.0, 0.6, 0.42, 'YXZ'); // tipped onto two legs, half sunk in the ooze
    this.B.add(this.echo.group);
    this.echo.group.updateMatrixWorld(true);
    this.B.visible = false;
    this.root.add(this.B);
    this.scatters.push(sc);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.setWaterType('hadal');
    env.naturalLight = 1;
    env.exposureOverride = null;
    env.bottomAlbedo = 0.12;
    env.current.set(0.015, 0, 0.0);
    e.snow.setDensity(1.3); e.dust.setDensity(1.1);
    this.pod = new Pod(game, { position: V(0, -14, -26), yaw: Math.PI, parent: this.root });
    this.pod.importState(game.carry);
    this.pod.vertAccel = 0.3;
    this.pod.cockpit.switches.forEach((s) => this.pod.cockpit.setSwitch(s, true));
    game.setPlayer(this.pod);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('pod');
    this.creatures = new CreatureManager(e, { collision: game.collision, root: this.root });
    game.scanner.enabled = true;
    game.scanner.range = 15;
    this.onDispose(game.scanner.addSource((cb) => this.creatures.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    this.pod.onArmUse = (wrist, aim) => this._arm(wrist, aim);
    this.flags = {};
    this.phase = 'descentA';
    this.transition = guidedDescent(this, {
      from: Math.max(4600, game.carry?.depth ?? 4600), to: BASE_A + 14, duration: 34, zone: 'Into the hadal zone',
      lines: [{ at: 6000, key: 'hadal.d6000' }],
      onDone: () => this._enterA(),
    });
    this._objectives();
  }

  _objectives() {
    const f = this.flags, p = this.phase, list = [];
    if (p === 'descentA') list.push({ id: 'd', text: 'Descend into the trench', done: false });
    if (p === 'areaA') {
      list.push({ id: 'bait', text: 'Check the bait station', done: !!f.atBait });
      if (f.baitDone) list.push({ id: 'b', text: 'Down to the floor: hold E on the ballast switch', done: false });
    }
    if (p === 'descentB') list.push({ id: 'd2', text: 'Descend to the floor of the Challenger Deep', done: false });
    if (p === 'areaB') {
      list.push({ id: 'echo', text: f.foundEcho ? 'ECHO-7' : 'Search the trench floor', sub: f.foundEcho ? '' : '(sonar R)', done: !!f.foundEcho });
      if (f.foundEcho) list.push({ id: 'bag', text: 'Free the transducer (arm: hold right mouse, click)', done: !!f.bagOff });
      if (f.bagOff && this.release) {
        const steps = { guard: 'lift the guard', arm: 'arm the manual release', pump: 'pump the hydraulics', pull: 'pull the release handle' };
        list.push({ id: 'weights', text: f.jam ? 'Drop weights jammed: manual release' : 'Release the drop weights (hold E on the ballast switch)', sub: f.jam && this.release.step ? `— ${steps[this.release.step]}` : '', done: !!f.released });
      }
    }
    this.game.ui.setObjectives('Hadal trench · 6,000–10,935 m', list);
  }

  _enterA() {
    const game = this.game, c = game.collision, mgr = this.creatures;
    this.phase = 'areaA';
    this.A.visible = true;
    c.clear(); c.addHeightfield(this.hfA);
    c.addBox(this.bait.group.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.0, 0)), V(0.8, 1.0, 0.8));
    c.bounds = { min: V(-105, -150, -105), max: V(105, 20, 105) };
    const b = this.baitW;
    this.groupsA = [
      mgr.spawn('amphipod', { beh: 'swarm', count: 160, home: b.clone(), center: () => b, radius: 0.55, speed: 0.07, active: 80 }),
      mgr.spawn('snailfish', { beh: 'school', count: 10, home: b.clone().add(V(0, 0.8, 0)), radius: 2.2, yMin: b.y + 0.2, yMax: b.y + 2.5, clearance: 0.4, speed: 0.08, spacing: 2.5, active: 90 }),
    ];
    this.pod.pos.set(0, -14, -26); this.pod.vel.set(0, 0, 0); this.pod.yaw = Math.PI;
    this.pod.sonarTargets = () => [{ pos: b, kind: 'target' }];
    game.checkpoint(9);
    game.say('hadal.arriveA');
    this._objectives();
  }

  _leaveA() {
    const game = this.game;
    this.phase = 'descentB';
    for (const g of this.groupsA) this.creatures.remove(g);
    this.A.visible = false;
    game.collision.clear();
    this.pod.pos.set(0, -16, -30); this.pod.vel.set(0, 0, 0);
    this.pod.sonarTargets = null;
    this.transition = guidedDescent(this, {
      from: this.pod.depth, to: BASE_B + 16, duration: 42, zone: 'Challenger Deep',
      lines: [{ at: 8000, key: 'hadal.d8000' }, { at: 9000, key: 'hadal.d9000' }, { at: 10000, key: 'hadal.d10000' }],
      onDone: () => this._enterB(),
    });
    this._objectives();
  }

  _enterB() {
    const game = this.game, c = game.collision, mgr = this.creatures;
    this.phase = 'areaB';
    this.B.visible = true;
    c.clear(); c.addHeightfield(this.hfB);
    for (const it of this.scatterB.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    c.addBox(this.echo.group.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.0, 0)), V(0.85, 1.0, 0.85));
    c.bounds = { min: V(-60, -40, -105), max: V(60, 30, 105) };
    // xenophyophores scattered over the floor, a few amphipods
    const rng = new RNG(77), pts = [];
    for (let i = 0; i < 60; i++) { const x = rng.range(-24, 24), z = rng.range(-60, 80); pts.push({ p: V(x, 0, z), yaw: rng.range(0, 6.28), scale: rng.range(0.7, 1.6) }); }
    this.xeno = mgr.spawn('xenophyophore', { beh: 'sessile', points: pts, active: 90 });
    mgr.spawn('amphipod', { beh: 'swarm', count: 40, home: this.echo.group.position.clone().add(V(0, 0.6, 0)), radius: 2.5, speed: 0.05, active: 80 });
    this.pod.pos.set(0, -16, -30); this.pod.vel.set(0, 0, 0); this.pod.yaw = Math.PI;
    this.pod.sonarTargets = () => [{ pos: this.echo.group.position, kind: 'target' }];
    game.say('hadal.arriveB');
    this._objectives();
  }

  _arm(wrist, aim) {
    const f = this.flags, game = this.game;
    if (this.phase !== 'areaB' || !f.foundEcho || f.bagOff) return;
    const bag = this.echo.bag;
    bag.getWorldPosition(_a);
    const p = aim || wrist;
    if (p.distanceTo(_a) < 0.85 || wrist.distanceTo(_a) < 0.7) {
      f.bagOff = true;
      this.pod.model.arm.wrist.attach(bag);
      audio.play('click', { gain: 0.4 });
      game.after(1.4, () => {
        this.pod.model.group.attach(bag);
        bag.position.set(0.2, -1.3, -1.9); bag.scale.setScalar(0.55);
        this._echoWakes();
      });
      this._objectives();
    }
  }

  _echoWakes() {
    const game = this.game;
    const bm = this.echo.beacon.material;
    let t = 0;
    const off = game.addUpdater((dt) => {
      t += dt;
      bm.emissiveIntensity = (Math.sin(t * 5) > 0.6 ? 6 : 0.3);
      if (Math.floor(t * 0.5) !== Math.floor((t - dt) * 0.5)) audio.play('ping', { gain: 0.35, rate: 1.6, pos: this.echo.group.position.clone() });
    });
    this.onDispose(off);
    game.save.flags.echo7 = true;
    game.persist();
    game.say('hadal.echoTalks').then(() => game.wait(6)).then(() => { game.say('hadal.home'); this._setupRelease(); this._objectives(); });
  }

  _setupRelease() {
    const game = this.game, pod = this.pod, ck = pod.cockpit;
    // manual drop-weight release on the console's left: guarded arm switch, hydraulic pump handle, release T-handle
    const g = new THREE.Group();
    g.position.set(-0.5, -0.66, -0.2); g.rotation.set(-0.35, 0.55, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), interiorMaterial({ color: 0x23272a, roughness: 0.55 }));
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.07), interiorMaterial({ color: 0xc8301e, roughness: 0.45 }));
    guard.position.set(-0.11, 0.035, 0);
    const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 8), interiorMaterial({ color: 0xd0d4d6, roughness: 0.3, metalness: 0.7 }));
    sw.position.set(-0.11, 0.035, 0); sw.rotation.x = 0.5;
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), interiorMaterial({ color: 0x8a9094, roughness: 0.35, metalness: 0.7 }));
    pump.position.set(0.02, 0.08, 0); pump.rotation.z = 0.6;
    const tee = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), interiorMaterial({ color: 0xe8b818, roughness: 0.4 }));
    tee.position.set(0.12, 0.05, 0);
    g.add(base, guard, sw, pump, tee);
    ck.group.add(g);
    this.release = { group: g, guard, sw, pump, tee, step: null, pumps: 0 };
    const ballast = ck.switches.find((s) => s.id === 'ballast');
    this.dropItem = game.interactions.add({ object: ballast.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.0, prompt: 'Release the drop weights', enabled: () => !this.flags.jam,
      onUse: () => {
        game.interactions.remove(this.dropItem);
        this.flags.jam = true;
        audio.play('thunk', { gain: 0.7, rate: 0.5 });
        audio.playAlarm('warn', 0.8);
        game.say('hadal.jam', { interrupt: true });
        this._releaseStep('guard');
      } });
  }

  _releaseStep(step) {
    const game = this.game, R = this.release;
    R.step = step;
    this._objectives();
    if (R.item) game.interactions.remove(R.item);
    const add = (o) => (R.item = game.interactions.add(o));
    if (step === 'guard') add({ object: R.guard, radius: 0.05, range: 1.2, prompt: 'Lift the guard', onUse: () => { R.guard.rotation.x = -1.6; R.guard.position.y += 0.03; audio.play('click', { gain: 0.5 }); this._releaseStep('arm'); } });
    if (step === 'arm') add({ object: R.sw, radius: 0.05, range: 1.2, prompt: 'Arm the manual release', onUse: () => { R.sw.rotation.x = -0.5; audio.play('switch', { gain: 0.6 }); this._releaseStep('pump'); } });
    if (step === 'pump') add({ object: R.pump, radius: 0.06, range: 1.2, prompt: () => `Pump the hydraulic handle (${R.pumps}/5)`, onUse: () => {
      R.pumps++;
      R.pump.rotation.z = R.pumps % 2 ? -0.2 : 0.6;
      audio.play('thunk', { gain: 0.35, rate: 1.4 }); audio.play('creak', { gain: 0.25 + R.pumps * 0.08, rate: 0.6 });
      this.pod.wobble = Math.min(1, this.pod.wobble + 0.25);
      if (R.pumps >= 5) this._releaseStep('pull');
    } });
    if (step === 'pull') add({ object: R.tee, radius: 0.05, range: 1.2, mode: 'hold', hold: 1.5, prompt: 'Pull the release handle', onUse: () => {
      R.tee.position.y += 0.03;
      game.interactions.remove(R.item);
      this._released();
    } });
  }

  _released() {
    const game = this.game;
    this.flags.released = true;
    this.release.step = null;
    audio.play('thunk', { gain: 0.9, rate: 0.35 });
    audio.play('creak', { gain: 0.6, rate: 1.1 });
    game.save.stats.events.dropWeights = true;
    game.persist();
    this._objectives();
    game.say('hadal.released', { interrupt: true });
    // the steel plates fall away and the pod begins to rise
    this.rising = true;
    this.pod.locked = true;
    game.after(9, () => { game.carry = { ...(game.carry || {}), ...this.pod.exportState(), depth: this.pod.depth }; game.goToStage(10, { fadeTime: 2.0 }); });
  }

  update(dt) {
    super.update(dt);
    const game = this.game, pod = this.pod, f = this.flags;
    if (this.transition && this.transition.active) this.transition.update(dt);
    if (this.rising) { pod.vel.y += dt * 0.25; pod.vel.y = Math.min(pod.vel.y, 0.8); }
    pod.update(dt);
    this.creatures.setPlayer(pod.pos, pod.vel);
    this.creatures.update(dt);
    if (this.phase === 'areaA') {
      if (!f.atBait && pod.pos.distanceTo(this.baitW) < 9) { f.atBait = true; game.say('hadal.bait'); this._objectives(); game.after(18, () => { f.baitDone = true; this._objectives(); this._offerLeaveA(); }); }
    }
    if (this.phase === 'areaB') {
      if (!f.foundEcho && pod.pos.distanceTo(this.echo.group.position) < 13) { f.foundEcho = true; game.say('hadal.found'); game.after(5, () => game.say('hadal.bag')); this._objectives(); }
    }
  }

  _offerLeaveA() {
    const game = this.game, sw = this.pod.cockpit.switches.find((s) => s.id === 'ballast');
    this.leaveA = game.interactions.add({ object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood ballast · to the bottom',
      onUse: () => { game.interactions.remove(this.leaveA); audio.play('hiss', { gain: 0.6, rate: 0.6 }); this._leaveA(); } });
  }
}
