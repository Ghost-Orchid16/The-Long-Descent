import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { Pod } from '../../player/Pod.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { CO2Scrubber } from '../events/CO2Scrubber.js';
import { guidedDescent } from '../transitions.js';
import { Heightfield, makeTerrainMaterial } from '../../world/Terrain.js';
import { Scatter, jitterGrid } from '../../world/Scatter.js';
import { makeReefKit } from '../../world/stages/reefBuild.js';
import { Noise, RNG, smoothstep, clamp } from '../../world/noise.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BASE = 330;               // depth (m) at local y = 0 once the guided descent ends
const _a = new THREE.Vector3();

/** Seamount flank in the twilight zone: a summit plateau at ~355 m falling away to ~640 m. */
function flankHeight(n) {
  return (x, z) => {
    const s = Math.max(0, z + 60);
    let y = -25 - s * 1.3 * (0.85 + 0.15 * n.n2(x * 0.01, 3.0));
    // gullies and spurs running downslope, boulder fields, a rounded summit edge
    y += Math.sin((x + n.n2(z * 0.01, 1.0) * 30) * 0.07) * 6 * smoothstep(0, 40, s);
    y += n.fbm2(x * 0.03, z * 0.03, 4) * 7 + Math.abs(n.n2(x * 0.12, z * 0.12)) * 2.2;
    y += Math.pow(Math.max(0, n.n2(x * 0.06 + 4, z * 0.06)), 2) * 6;
    return Math.max(y, -330);
  };
}

export default class TwilightStage extends Stage {
  static get id() { return 'twilight'; }

  async build(yieldFrame) {
    const e = this.engine, lib = e.lib;
    const n = new Noise(61);
    this.height = flankHeight(n);
    this.hf = new Heightfield({
      x0: -170, z0: -170, sizeX: 340, sizeZ: 340, cell: e.preset.terrainCell * 1.1,
      heightFn: this.height,
      maskFn: (x, z, h, slope) => [clamp(slope * 1.6 - 0.2 + n.n2(x * 0.05, z * 0.05) * 0.3, 0, 1), clamp(0.4 + n.n2(x * 0.1, z * 0.1) * 0.4, 0, 1), 0],
    });
    this.terrain = new THREE.Group();
    this.terrain.add(this.hf.buildMesh(makeTerrainMaterial(lib, { soft: 'ooze', hard: 'basalt', scaleA: 1 / 3.0, scaleB: 1 / 4.0, tintA: [0.85, 0.82, 0.76], tintB: [0.62, 0.6, 0.58], key: 'flank' }), { chunks: 10 }));
    await yieldFrame();
    // sparse deep-water growth: black corals, gorgonians, wire corals, sponges, boulders
    const kit = makeReefKit(e, 61);
    kit.palettes.bush = ['#2a2420', '#3a2c22', '#1e1a18'];
    kit.palettes.fan = ['#d8b060', '#e8d8b0', '#c89a50', '#b85a3a'];
    kit.palettes.whip = ['#d8c040', '#e0d8c0', '#8a3a2a'];
    kit.palettes.barrel = ['#c8b8a0', '#d8cbb0', '#a89880'];
    const { M, G, col } = kit;
    const rng = new RNG(611);
    const sc = new Scatter({ cell: 40 });
    const nrm = new THREE.Vector3();
    const put = (type, x, z, { scale = 1, align = 0.4, sink = 0.05, mat, colorType, tag, collide = 0 } = {}) => {
      const variants = G[type];
      if (!variants) return;
      const vi = rng.int(0, variants.length - 1);
      this.hf.normal(x, z, nrm);
      const tr = { pos: V(x, this.hf.height(x, z) - sink * scale, z), normal: nrm.clone(), align, scale, yaw: rng.range(0, Math.PI * 2), color: col(colorType || type) };
      sc.add(type + vi, variants[vi], mat || M[type === 'bush' ? 'branch' : type === 'barrel' ? 'sponge' : type], tr, { collide, tag, maxDist: 55 });
      const memb = variants[vi].userData.membrane;
      if (memb) sc.add(type + vi + 'net', memb, M.fanNet, { ...tr, color: tr.color.clone().multiplyScalar(0.9) });
    };
    const pts = jitterGrid(rng, -165, -165, 165, 165, 2.2, (x, z) => 0.55 * e.preset.dressDensity);
    for (const [x, z] of pts) {
      const r = rng.next();
      if (r < 0.3) put('rock', x, z, { scale: rng.range(0.4, 1.6), align: 0.6, sink: 0.25, collide: 0.8 });
      else if (r < 0.42) put('bush', x, z, { scale: rng.range(0.8, 1.8), align: 0.3, colorType: 'bush', collide: 0.3 });
      else if (r < 0.5) put('fan', x, z, { scale: rng.range(0.7, 1.4), align: 0.1 });
      else if (r < 0.56) put('barrel', x, z, { scale: rng.range(0.5, 1.2), align: 0.3, collide: 0.4 });
      else if (r < 0.75) put('rubble', x, z, { scale: rng.range(0.8, 2.0), align: 0.8, sink: 0.01 });
    }
    this.terrain.add(sc.build());
    this.scatter = sc;
    this.root.add(this.terrain);
    this.scatters.push(sc);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.setWaterType('deep');
    env.naturalLight = 1;
    env.setSun({ elevation: 40, azimuth: 96, intensity: 3.2, skyIntensity: 1.0, tint: new THREE.Color(1.0, 0.95, 0.86) });
    env.exposureOverride = null;
    env.bottomAlbedo = 0.05;
    env.current.set(0.03, 0, 0.02);
    e.snow.setDensity(1.4); e.dust.setDensity(1.0);
    const c = game.collision;
    c.addHeightfield(this.hf);
    for (const it of this.scatter.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    c.bounds = { min: V(-160, -330, -160), max: V(160, 0, 160) };
    // ---- pod
    this.pod = new Pod(game, { position: V(0, 0, -80), yaw: Math.PI, parent: this.root });
    this.pod.importState(game.carry);
    this.pod.vertAccel = 0.6;
    this.pod.cockpit.switches.forEach((s) => this.pod.cockpit.setSwitch(s, true));
    game.setPlayer(this.pod);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('pod');
    // ---- life
    const mgr = this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    mgr.spawn('nautilus', { beh: 'drift', count: 2, home: V(8, -32, -58), radius: 6, speed: 0.04, clearance: 1.2, active: 160 });
    mgr.spawn('hatchetfish', { beh: 'school', count: 40, home: V(-20, -62, -10), radius: 10, yMin: -80, yMax: -45, clearance: 4, active: 160 });
    mgr.spawn('lanternfish', { beh: 'school', count: 120, home: V(18, -110, 25), radius: 16, yMin: -135, yMax: -90, clearance: 5, active: 170 });
    mgr.spawn('siphonophore', { beh: 'drift', count: 1, home: V(-28, -150, 55), radius: 5, speed: 0.01, clearance: 6, active: 200 });
    mgr.spawn('comb_jelly', { beh: 'drift', count: 7, home: V(6, -168, 70), radius: 9, speed: 0.025, clearance: 4, active: 160 });
    mgr.spawn('vampire_squid', { beh: 'drift', count: 1, home: V(22, -298, 140), radius: 6, speed: 0.03, clearance: 3, active: 160 });
    mgr.spawn('sixgill', { beh: 'cruise', count: 1, home: V(0, -290, 128), radius: 35, yMin: -320, yMax: -260, clearance: 3, speed: 0.35, active: 220 });
    // the sperm whale passes on a long curve through the gloom once it has been heard
    this.whale = mgr.spawn('sperm_whale', { beh: 'giant', count: 1, speed: 1.8, path: [V(-260, -150, 160), V(-90, -165, 90), V(40, -175, 50), V(180, -185, -20), V(330, -190, -90)], loop: false, noSnap: true, active: 600 });
    this.whale.visible = false;
    game.scanner.enabled = true;
    game.scanner.range = 18;
    this.onDispose(game.scanner.addSource((cb) => mgr.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    this.pod.sonarTargets = () => (this.whale.visible ? [{ pos: this.whale.agents[0].p, kind: 'target' }] : []);
    // ---- events
    this.co2 = new CO2Scrubber(game, this.pod, {
      onStep: (s) => { game.say('twilight.co2.' + s); this._objectives(); },
      onDone: () => { game.say('twilight.co2.done', { interrupt: true }); this._objectives(); },
    });
    this.onDispose(() => this.co2.dispose());
    this.flags = {};
    this.phase = 'descent';
    this.terrain.visible = false;
    this.creatures.root.visible = false;
    this.transition = guidedDescent(this, {
      from: 25, to: BASE, duration: 44, zone: 'Into the twilight zone',
      lines: [
        { at: 60, key: 'twilight.d60' }, { at: 140, key: 'twilight.d140' },
        { at: 205, key: 'twilight.d200' }, { at: 300, key: 'twilight.d300' },
      ],
      onDone: () => {
        this.phase = 'explore';
        this.terrain.visible = true;
        this.creatures.root.visible = true;
        game.checkpoint(6);
        game.say('twilight.arrive');
        this._objectives();
      },
    });
    this.whaleT = 0;
    this._objectives();
  }

  _objectives() {
    const f = this.flags, list = [];
    if (this.phase === 'descent') list.push({ id: 'desc', text: 'Descend to the twilight zone', done: false });
    else {
      list.push({ id: 'flank', text: 'Follow the seamount flank down to ~600 m', sub: `(${Math.round(this.pod.depth)} m)`, done: this.pod.depth > 595 });
      if (f.whaleHeard) list.push({ id: 'whale', text: 'Something big is clicking out in the dark', done: !!f.whaleSeen });
      if (this.co2.active || this.co2.done) {
        const steps = { open: 'open the panel', pull: 'pull the spent canister', insert: 'insert the fresh one', fan: 'restart the fan' };
        list.push({ id: 'co2', text: 'CO₂ scrubber: swap the canister', sub: this.co2.step ? `— ${steps[this.co2.step]}` : '', done: this.co2.done });
      }
      if (f.canLeave) list.push({ id: 'next', text: 'Continue the descent: hold E on the ballast switch', done: false });
    }
    this.game.ui.setObjectives('Twilight zone · 200–1,000 m', list);
  }

  update(dt) {
    super.update(dt);
    const game = this.game, pod = this.pod, env = this.engine.env, f = this.flags;
    if (this.transition && this.transition.active) this.transition.update(dt);
    pod.update(dt);
    this.creatures.setPlayer(pod.pos, pod.vel);
    this.creatures.update(dt);
    this.co2.update(dt);
    // last of the daylight overhead (only noticeable with the floods off and the eye adapted)
    const d = pod.depth;
    const glow = 1 - THREE.MathUtils.smoothstep(d, 220, 900);
    this.engine.backdrop.uniforms.uGlow.value.set(0.0010, 0.0055, 0.019).multiplyScalar(glow);
    if (this.phase !== 'explore') return;
    if (Math.floor(this.t) !== Math.floor(this.t - dt)) this._objectives();
    if (!f.floodHint && !pod.floodsOn && this.t > 8) { f.floodHint = true; game.say('twilight.floods'); }
    // the sperm whale: heard first (clicks from far off), then it glides past at the edge of the light
    if (!f.whaleHeard && d > 450) {
      f.whaleHeard = true;
      this.whale.visible = true;
      // lay its course so it crosses in front of the pod at the edge of the floodlights
      const fwd = V(-Math.sin(pod.yaw), 0, -Math.cos(pod.yaw)), side = V(Math.cos(pod.yaw), 0, -Math.sin(pod.yaw));
      const pass = pod.pos.clone().addScaledVector(fwd, 21).add(V(0, -2, 0));
      const pts = [pass.clone().addScaledVector(side, -125).addScaledVector(fwd, 30).add(V(0, -12, 0)), pass.clone().addScaledVector(side, -45).addScaledVector(fwd, 8), pass, pass.clone().addScaledVector(side, 60).addScaledVector(fwd, 10).add(V(0, -6, 0)), pass.clone().addScaledVector(side, 170).addScaledVector(fwd, 40).add(V(0, -20, 0))];
      this.whale.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      this.whale.curveLen = this.whale.curve.getLength();
      const a = this.whale.agents[0];
      this.whale.curve.getPointAt(0, a.p);
      a.s = 0;
      a.v.copy(side).multiplyScalar(1.6);
      a.yaw = Math.atan2(side.x, side.z);
      game.say('twilight.whale.clicks');
      this._objectives();
    }
    if (f.whaleHeard && !f.whaleGone) {
      const a = this.whale.agents[0];
      this.whaleT -= dt;
      if (this.whaleT <= 0) {
        const dist = a.p.distanceTo(pod.pos);
        this.whaleT = dist > 60 ? 0.62 + Math.random() * 0.1 : 0.08 + Math.random() * 0.05; // regular clicks, then a creak
        audio.play('click', { gain: THREE.MathUtils.clamp(2.2 - dist / 120, 0.15, 1.2), rate: 0.42, pos: a.p.clone(), reverb: 0.6 });
      }
      const dw = a.p.distanceTo(pod.pos);
      if (!f.whaleSeen && dw < 40) { f.whaleSeen = true; game.say('twilight.whale.pass'); game.save.flags.whale = true; this._objectives(); }
      if (a.s > 0.98) { f.whaleGone = true; this.whale.visible = false; }
    }
    // CO2 scrubber failure partway down the flank
    if (!f.co2 && d > 520 && (f.whaleSeen || d > 560)) { f.co2 = true; game.after(2, () => { this.co2.start(); game.say('twilight.co2.start', { interrupt: true }); this._objectives(); }); }
    if (!f.canLeave && this.co2.done && d > 590) {
      f.canLeave = true;
      game.say('twilight.next');
      this._objectives();
      const sw = pod.cockpit.switches.find((s) => s.id === 'ballast');
      this.leaveItem = game.interactions.add({
        object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood ballast for the long descent',
        onUse: () => {
          game.interactions.remove(this.leaveItem);
          audio.play('hiss', { gain: 0.6, rate: 0.6 });
          game.carry = { ...(game.carry || {}), ...pod.exportState() };
          game.goToStage(7, { fadeTime: 1.4 });
        },
      });
    }
  }

  exit() { this.engine.backdrop.uniforms.uGlow.value.set(0, 0, 0); }
}
