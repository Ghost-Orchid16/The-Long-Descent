import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { Pod } from '../../player/Pod.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { guidedDescent } from '../transitions.js';
import { buildSeep, buildSmokers } from '../../world/stages/midnightBuild.js';
import { BioLum, SmokePlume, Droplets } from '../../render/DeepFX.js';
import { PowerFailure } from '../events/PowerFailure.js';
import { SedimentPlume } from '../events/SedimentPlume.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE_A = 1560, BASE_B = 3560;

export default class MidnightStage extends Stage {
  static get id() { return 'midnight'; }

  async build(yieldFrame) {
    this.A = buildSeep(this.engine, {});
    this.A.group.visible = false;
    this.root.add(this.A.group);
    await yieldFrame();
    this.B = buildSmokers(this.engine, {});
    this.B.group.visible = false;
    this.root.add(this.B.group);
    this.scatters.push(this.A.scatter, this.B.scatter);
    this.bio = new BioLum({});
    this.root.add(this.bio.points);
    this.drops = new Droplets(this.A.sources, {});
    this.A.group.add(this.drops.mesh);
    this.smoke = this.B.chimneys.slice(0, 3).map((c, i) => new SmokePlume(c.top.clone().add(V(0, -0.1, 0)), { rise: 1.4 - i * 0.2, spread: 0.1 + i * 0.02 }));
    this.smoke.forEach((s) => this.B.group.add(s.mesh));
    this.onDispose(() => { this.bio.dispose(); this.drops.dispose(); this.smoke.forEach((s) => s.dispose()); });
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.setWaterType('deep');
    env.naturalLight = 1;
    env.exposureOverride = null;
    env.bottomAlbedo = 0.05;
    env.current.set(0.02, 0, 0.01);
    e.snow.setDensity(1.6); e.dust.setDensity(1.1);
    this.pod = new Pod(game, { position: V(0, 0, -60), yaw: Math.PI, parent: this.root });
    this.pod.importState(game.carry);
    this.pod.vertAccel = 0.5;
    this.pod.cockpit.switches.forEach((s) => this.pod.cockpit.setSwitch(s, true));
    game.setPlayer(this.pod);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('pod');
    this.creatures = new CreatureManager(e, { collision: game.collision, root: this.root });
    game.scanner.enabled = true;
    game.scanner.range = 16;
    this.onDispose(game.scanner.addSource((cb) => this.creatures.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    this.power = new PowerFailure(game, this.pod, {
      onStep: (next) => { if (this.power.restored.length) game.say('midnight.power.' + this.power.restored[this.power.restored.length - 1]); this._objectives(); void next; },
      onWrong: (next) => { if (!this.flags.wrongSaid) { this.flags.wrongSaid = true; game.say('midnight.power.order', { interrupt: true }); game.after(8, () => { this.flags.wrongSaid = false; }); } void next; },
      onDone: () => { game.say('midnight.power.done', { interrupt: true }); if (this.transition) this.transition.paused = false; this._objectives(); },
    });
    this.onDispose(() => this.power.dispose());
    this.flags = {};
    this.lightsOffT = 0;
    this.phase = 'descentA';
    // the long fall from the twilight zone, with a brief giant squid at the edge of the light
    this.transition = guidedDescent(this, {
      from: Math.max(640, game.carry?.depth ?? 640), to: BASE_A, duration: 40, zone: 'Into the midnight zone',
      lines: [
        { at: 900, fn: () => this._squid() },
        { at: 1000, key: 'midnight.d1000' },
        { at: 1350, key: 'midnight.d1350' },
      ],
      onDone: () => this._enterA(),
    });
    this._objectives();
  }

  _squid() {
    const pod = this.pod;
    const fwd = V(-Math.sin(pod.yaw), 0, -Math.cos(pod.yaw)), side = V(Math.cos(pod.yaw), 0, -Math.sin(pod.yaw));
    const c = pod.pos.clone().addScaledVector(fwd, 9).add(V(0, -1.5, 0));
    const sq = this.creatures.spawn('giant_squid', { beh: 'giant', count: 1, speed: 1.1, loop: false, noSnap: true, active: 400,
      path: [c.clone().addScaledVector(side, -16), c.clone().addScaledVector(side, -4), c.clone().addScaledVector(side, 6).add(V(0, -1, 0)), c.clone().addScaledVector(side, 20).add(V(0, -4, 0))] });
    sq.agents[0].p.copy(c).addScaledVector(side, -16);
    this.squid = sq;
    this.game.say('midnight.squid');
    this.game.after(26, () => { if (this.squid) { this.creatures.remove(this.squid); this.squid = null; } });
  }

  _objectives() {
    const f = this.flags, list = [], p = this.phase;
    if (p === 'descentA') list.push({ id: 'd', text: 'Descend into the midnight zone', done: false });
    if (p === 'areaA') {
      list.push({ id: 'seep', text: 'Find the CO₂ seep on the volcano flank', sub: '(sonar R)', done: !!f.atSeep });
      if (f.atSeep) list.push({ id: 'dark', text: 'Lights off: floods off (F) and watch', sub: f.darkDone ? '' : `${Math.max(0, Math.ceil(20 - this.lightsOffT))} s`, done: !!f.darkDone });
      if (f.darkDone) list.push({ id: 'b', text: 'Continue down: hold E on the ballast switch', done: false });
    }
    if (p === 'descentB') {
      list.push({ id: 'd2', text: 'Descend to the vent field (~3,600 m)', done: false });
      if (this.power.active) {
        const names = { life: 'life support', lights: 'lights', thrust: 'thrusters' };
        list.push({ id: 'power', text: 'Power failure: reset the breakers (right wall)', sub: `— next: ${names[this.power.next]}`, done: false });
      }
    }
    if (p === 'areaB') {
      list.push({ id: 'smokers', text: 'Survey the black smokers', sub: `(${Math.min(2, this.ventScans)}/2 vent species)`, done: this.ventScans >= 2 });
      if (this.plume?.active || this.plume?.done) list.push({ id: 'plume', text: 'Sediment plume: navigate out by sonar (R)', done: this.plume.done });
      if (this.plume?.done) list.push({ id: 'b2', text: 'Continue down: hold E on the ballast switch', done: false });
    }
    this.game.ui.setObjectives('Midnight zone · 1,000–4,000 m', list);
  }

  _enterA() {
    const game = this.game, A = this.A, mgr = this.creatures, c = game.collision;
    this.phase = 'areaA';
    A.group.visible = true;
    c.clear();
    c.addHeightfield(A.hf);
    for (const it of A.scatter.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    c.bounds = { min: V(-115, -160, -115), max: V(115, 20, 115) };
    const s = A.seep;
    this.groupsA = [
      mgr.spawn('vent_mussel', { beh: 'sessile', points: A.mussels.map((m) => ({ ...m, p: m.p.clone() })), active: 120 }),
      mgr.spawn('anglerfish', { beh: 'ambush', count: 1, home: V(s.x - 10, s.y + 5, s.z - 8), radius: 1, clearance: 1.5, active: 120 }),
      mgr.spawn('fangtooth', { beh: 'cruise', count: 2, home: V(s.x, s.y + 12, s.z), radius: 22, yMin: s.y + 4, yMax: s.y + 25, clearance: 3, active: 140 }),
      mgr.spawn('loosejaw', { beh: 'cruise', count: 1, home: V(s.x + 8, s.y + 14, s.z - 10), radius: 18, yMin: s.y + 6, yMax: s.y + 24, clearance: 3, active: 140 }),
      mgr.spawn('gulper_eel', { beh: 'drift', count: 1, home: V(s.x - 14, s.y + 16, s.z + 6), radius: 6, speed: 0.03, clearance: 4, active: 140 }),
      (this.atolla = mgr.spawn('atolla', { beh: 'pulse', count: 2, home: V(s.x + 2, s.y + 9, s.z - 14), radius: 5, speed: 0.015, clearance: 4, active: 140 })),
    ];
    this.pod.pos.set(0, 0, -60); this.pod.vel.set(0, 0, 0); this.pod.yaw = Math.PI;
    this.pod.sonarTargets = () => [{ pos: s, kind: 'target' }];
    game.checkpoint(7);
    game.say('midnight.arriveA');
    this._objectives();
  }

  _leaveA() {
    const game = this.game;
    this.phase = 'descentB';
    for (const g of this.groupsA) this.creatures.remove(g);
    this.A.group.visible = false;
    game.collision.clear();
    this.pod.pos.set(0, 0, -55); this.pod.vel.set(0, 0, 0);
    this.pod.sonarTargets = null;
    this.transition = guidedDescent(this, {
      from: this.pod.depth, to: BASE_B, duration: 44, zone: 'Deeper',
      lines: [{ at: 2400, fn: () => { this.transition.paused = true; this.power.start(); game.say('midnight.power.start', { interrupt: true }); this._objectives(); } }, { at: 3000, key: 'midnight.d3000' }],
      onDone: () => this._enterB(),
    });
    this._objectives();
  }

  _enterB() {
    const game = this.game, B = this.B, mgr = this.creatures, c = game.collision;
    this.phase = 'areaB';
    B.group.visible = true;
    c.clear();
    c.addHeightfield(B.hf);
    for (const it of B.scatter.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    for (const ch of B.chimneys) c.addCapsule(ch.base, ch.top, ch.r * 0.7);
    c.bounds = { min: V(-125, -170, -125), max: V(125, 25, 125) };
    this.ventScans = 0;
    const [c0, c1] = B.chimneys;
    mgr.spawn('vent_shrimp', { beh: 'swarm', count: 70, home: c0.base.clone(), center: () => c0.base, cylinder: { r0: c0.r * 0.55, r1: c0.r * 0.95, h: c0.h * 0.75 }, speed: 0.06, active: 120 });
    mgr.spawn('vent_shrimp', { beh: 'swarm', count: 45, home: c1.base.clone(), center: () => c1.base, cylinder: { r0: c1.r * 0.55, r1: c1.r * 0.95, h: c1.h * 0.75 }, speed: 0.06, active: 120 });
    const crabs = [];
    for (let i = 0; i < 9; i++) { const ch = B.chimneys[i % 3]; const a = i * 2.4; crabs.push({ p: V(ch.base.x + Math.cos(a) * (ch.r + 1.2), 0, ch.base.z + Math.sin(a) * (ch.r + 1.2)) }); }
    mgr.spawn('vent_crab', { beh: 'crawl', points: crabs, radius: 4, active: 120 });
    const snails = [];
    // snails cluster on the chimney walls just below the hot orifices, facing out
    for (const ch of B.chimneys.slice(0, 3)) for (let k = 0; k < 10; k++) {
      const a = k * 0.63, y = ch.h * (0.55 + (k % 4) * 0.08), rr = ch.r * 0.62 * (1 - (y / ch.h) * 0.6);
      snails.push({ p: V(ch.base.x + Math.cos(a) * rr, ch.base.y + y, ch.base.z + Math.sin(a) * rr), dir: V(Math.cos(a), 0.15, Math.sin(a)) });
    }
    this.snails = mgr.spawn('hairy_snail', { beh: 'hide', points: snails, peek: 0.002, shy: 0, active: 120 });
    this.pod.pos.set(0, 0, -55); this.pod.vel.set(0, 0, 0); this.pod.yaw = Math.PI;
    this.pod.sonarTargets = () => [{ pos: B.mound, kind: 'target' }];
    this.plume = new SedimentPlume(game, this.pod, { exit: V(55, height(B, 55, 98) + 8, 98), onDone: () => { game.say('midnight.plume.done', { interrupt: true }); this._objectives(); } });
    this.onDispose(() => this.plume.dispose());
    game.say('midnight.arriveB');
    this._objectives();
    this.bOn = 0;
  }

  update(dt) {
    super.update(dt);
    const game = this.game, pod = this.pod, f = this.flags;
    if (this.transition && this.transition.active) this.transition.update(dt);
    pod.update(dt);
    this.power.update(dt);
    this.creatures.setPlayer(pod.pos, pod.vel);
    this.creatures.update(dt);
    this.bio.update(dt, this.engine.camera, pod);
    // bioluminescence reads once the floods are off; the atolla's "burglar alarm" when it is disturbed in the dark
    this.bio.uniforms.uGain.value = pod.floodsOn ? 0.35 : 1.0;
    if (this.phase === 'areaA') {
      this.drops.update(dt);
      const d = pod.pos.distanceTo(this.A.seep);
      if (!f.atSeep && d < 24) { f.atSeep = true; game.say('midnight.seep'); this._objectives(); game.after(14, () => game.say('midnight.lightsOff')); }
      if (f.atSeep && !f.darkDone) {
        if (!pod.floodsOn) this.lightsOffT += dt;
        this.atolla.alarm = pod.floodsOn ? 0 : Math.min(1, this.lightsOffT / 6);
        if (Math.floor(this.lightsOffT) !== Math.floor(this.lightsOffT - dt)) this._objectives();
        if (this.lightsOffT > 20) {
          f.darkDone = true; this.atolla.alarm = 0;
          game.say('midnight.lightsOffDone');
          this._objectives();
          const sw = pod.cockpit.switches.find((s) => s.id === 'ballast');
          this.leaveA = game.interactions.add({ object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood ballast · continue down',
            onUse: () => { game.interactions.remove(this.leaveA); audio.play('hiss', { gain: 0.6, rate: 0.6 }); this._leaveA(); } });
        }
      }
    }
    if (this.phase === 'areaB') {
      for (const s of this.smoke) s.update(dt);
      const j = game.save.journal;
      this.ventScans = ['vent_shrimp', 'vent_crab', 'hairy_snail'].filter((id) => j[id]).length;
      const near = pod.pos.distanceTo(this.B.mound) < 28;
      if (near) this.bOn += dt;
      if (Math.floor(this.t) !== Math.floor(this.t - dt)) this._objectives();
      if (!f.smokerSaid && near) { f.smokerSaid = true; game.say('midnight.smokers'); }
      if (!this.plume.active && !this.plume.done && (this.ventScans >= 2 || this.bOn > 50)) {
        this.plume.start();
        game.say('midnight.plume.start', { interrupt: true });
        this._objectives();
      }
      this.plume.update(dt);
      if (this.plume.done && !f.canLeaveB) {
        f.canLeaveB = true;
        const sw = pod.cockpit.switches.find((s) => s.id === 'ballast');
        this.leaveB = game.interactions.add({ object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood ballast · to the abyssal plain',
          onUse: () => {
            game.interactions.remove(this.leaveB);
            audio.play('hiss', { gain: 0.6, rate: 0.6 });
            game.carry = { ...(game.carry || {}), ...pod.exportState(), depth: pod.depth };
            game.goToStage(8, { fadeTime: 1.4 });
          } });
      }
    }
  }

  exit() { this.engine.env.setWaterType('deep'); }
}

function height(B, x, z) { return B.hf.height(x, z); }
