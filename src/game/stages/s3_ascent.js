import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { Diver } from '../../player/Diver.js';
import { buildHullOnly } from '../../world/ship.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';
import { patchMaterial } from '../../render/water/patch.js';
import { buildSheet, makeTerrainMaterial } from '../../world/Terrain.js';
import { Noise } from '../../world/noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();

// In-water stops (compressed to tens of seconds); the rest of the obligation is finished in the deck chamber
// (surface decompression), so the diver leaves the 6 m stop for the surface.
const STOPS = [{ depth: 12, time: 30 }, { depth: 9, time: 38 }, { depth: 6, time: 45 }];
const GAME_MIN_PER_STOP_SEC = 0.25; // shown on the wrist computer: 30 s of play ≈ 7–8 min of stop
export const SURFACE_INTERVAL = 100; // real seconds the player has to reach the chamber (5 min game time)

export default class AscentStage extends Stage {
  static get id() { return 'ascent'; }

  async build(yieldFrame) {
    await yieldFrame();
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xd4c8a6, roughness: 0.9 });
    patchMaterial(lineMat, { key: 'rope' });
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(V(Math.sin(t * 5) * 0.25 * (1 - t), -46 + t * 45.6, Math.cos(t * 3) * 0.2 * (1 - t))); }
    this.lineCurve = new THREE.CatmullRomCurve3(pts);
    this.root.add(new THREE.Mesh(new THREE.TubeGeometry(this.lineCurve, 160, 0.014, 6), lineMat));
    // stop tags: coloured tape at each stop depth
    const tagMat = new THREE.MeshStandardMaterial({ color: 0xf0d020, roughness: 0.5 });
    patchMaterial(tagMat, { key: 'tag' });
    for (const s of STOPS) {
      const p = this._linePoint(s.depth);
      const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), tagMat);
      tag.position.copy(p);
      this.root.add(tag);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.06), tagMat);
      flag.position.copy(p).add(V(0.1, 0, 0)); flag.material.side = THREE.DoubleSide;
      this.root.add(flag);
    }
    // the hang tank clipped at 6 m with its regulator
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.4, metalness: 0.3 });
    patchMaterial(tankMat, { key: 'hangtank' });
    const regMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    patchMaterial(regMat, { key: 'hangreg' });
    const hp = this._linePoint(6.4);
    this.hangTank = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.66, 20), tankMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankMat); cap.position.y = 0.33;
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 14), regMat); reg.rotation.x = Math.PI / 2; reg.position.set(0.12, 0.25, 0.08);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0.42, 0), V(0.08, 0.4, 0.06), V(0.12, 0.27, 0.08)]), 8, 0.008, 6), regMat);
    this.hangTank.add(cyl, cap, reg, hose);
    this.hangTank.position.copy(hp).add(V(0.16, -0.2, 0));
    this.hangTank.rotation.z = 0.08;
    this.root.add(this.hangTank);
    // the research vessel above, the reef wall far off in the blue
    this.hull = buildHullOnly(this.engine);
    this.hull.position.set(-9, 0, -16);
    this.hull.rotation.y = 1.1;
    this.root.add(this.hull);
    const n = new Noise(5);
    const wall = buildSheet({
      u0: 120, u1: -120, v0: 0, v1: 1, resU: 80, resV: 40,
      posFn: (u, v) => { const y = -12 - v * 120; return { x: u, y, z: -70 + n.fbm2(u * 0.05, y * 0.05, 3) * 6, off: 0 }; },
      maskFn: () => [1, 0.5, 0], material: makeTerrainMaterial(this.engine.lib, { soft: 'sand', hard: 'reef', key: 'farwall' }), chunksU: 4, chunksV: 2,
    });
    this.root.add(wall);
  }

  _linePoint(depth, out = new THREE.Vector3()) {
    const t = THREE.MathUtils.clamp((46 - depth) / 45.6, 0, 1);
    return this.lineCurve.getPointAt(t, out);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.depthBase = 0;
    env.setWaterType('blue');
    env.naturalLight = 1;
    env.setSun({ elevation: 36, azimuth: 82, intensity: 3.2, skyIntensity: 1.0, tint: new THREE.Color(1.0, 0.95, 0.86) });
    env.exposureOverride = null;
    env.bottomAlbedo = 0.08;
    env.current.set(0.16, 0, 0.05);
    e.snow.setDensity(0.9); e.dust.setDensity(0.8);
    const c = game.collision;
    c.bounds = { min: V(-50, -60, -50), max: V(50, 0, 50) };
    this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    this.creatures.spawn('giant_trevally', { beh: 'cruise', count: 2, home: V(6, -14, 4), radius: 14, yMin: -20, yMax: -6, active: 120 });
    game.scanner.enabled = true;
    game.scanner.range = 12;
    this.onDispose(game.scanner.addSource((cb) => this.creatures.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    const start = this._linePoint(44).add(V(0.9, 0, 0.9));
    this.diver = new Diver(game, { position: start, yaw: Math.PI * 0.75, pitch: 0.35 });
    if (game.carry) this.diver.importState(game.carry);
    else { this.diver.air = 72; this.diver.lowAirWarned = true; this.diver.computer.step(30 * 60, 30); this.diver.computer.diveTime = 34 * 60; }
    game.setPlayer(this.diver);
    game.fxTarget.mask = 1; game.fx.mask = 1;
    game.ui.setScubaHud(true);
    game.ui.setReticle(true);
    audio.setEnvironment('underwater');
    this.stopIdx = 0;
    this.stopT = 0;
    this.flags = {};
    this.surgeT = 0;
    this.offs = [
      bus.on('diver:fastAscent', () => { if (!game.ui.radioBusy) game.say('ascent.slow'); this.penalty = (this.penalty || 0) + 8; }),
      bus.on('diver:lowAir', () => game.say('ascent.lowAir')),
    ];
    this.onDispose(() => this.offs.forEach((f) => f()));
    this.onDispose(() => { game.ui.stopGauge(null); });
    // hang tank swap
    this.tankItem = game.interactions.add({
      object: this.hangTank, radius: 0.35, range: 2.4, mode: 'hold', hold: 1.0, prompt: 'Switch to the hang tank',
      enabled: () => !this.flags.hangTank && this.diver.depth < 9,
      onUse: () => {
        this.flags.hangTank = true;
        this.hangTank.children[2].visible = false; this.hangTank.children[3].visible = false;
        this.diver.air = 196; this.diver.lowAirWarned = false;
        audio.play('hiss', { gain: 0.4, rate: 1.3 });
        game.say('ascent.hangTank', { interrupt: true });
        game.ui.toast('Gas', 'Hang tank · 196 bar', 3);
        this._objectives();
      },
    });
    game.after(1.0, () => game.say('ascent.start'));
    game.ui.setMarker(() => this._linePoint(STOPS[this.stopIdx] ? STOPS[this.stopIdx].depth : 0), 'Stop');
    this._objectives();
  }

  _objectives() {
    const list = STOPS.map((s, i) => ({ id: 'stop' + i, text: `Decompression stop at ${s.depth} m`, sub: i === this.stopIdx ? `(${Math.ceil(Math.max(0, s.time + (i === this.stopIdx ? this.penalty || 0 : 0) - this.stopT))} s)` : '', done: i < this.stopIdx }));
    if (this.diver.air < 90 || this.flags.hangTank) list.splice(3, 0, { id: 'tank', text: 'Switch to the hang tank at 6 m', done: !!this.flags.hangTank });
    if (this.stopIdx >= STOPS.length) list.push({ id: 'surface', text: 'Surface and get into the deck chamber', done: false });
    this.game.ui.setObjectives('Ascent & decompression · 60 → 0 m', list);
  }

  update(dt) {
    super.update(dt);
    const game = this.game, d = this.diver, ui = game.ui;
    this.creatures.setPlayer(d.pos, d.vel);
    this.creatures.update(dt);
    this.hull.position.y = Math.sin(this.engine.env.time * 0.7) * 0.12;
    if (d.torchOn !== undefined && game.input.pressed('torch')) d.setTorch(!d.torchOn);
    game.fx.narcosis = d.narcosis;
    audio.setNarcosis(d.narcosis);
    // current that pulls the diver off the line, with slow vertical surges
    this.surgeT += dt;
    const lp = this._linePoint(THREE.MathUtils.clamp(d.depth, 0, 46), _a);
    const off = Math.hypot(d.pos.x - lp.x, d.pos.z - lp.z);
    const k = 1 + Math.min(1.5, off / 6);
    d.extraForce.set(0.05 * k, Math.sin(this.surgeT * 0.45) * 0.07 + Math.sin(this.surgeT * 1.13) * 0.035, 0.02 * k);
    if (off > 7 && !this.flags.offLine) { this.flags.offLine = true; game.say('ascent.line'); game.after(20, () => { this.flags.offLine = false; }); }
    // stops
    const s = STOPS[this.stopIdx];
    if (s) {
      const need = s.time + (this.penalty || 0);
      const inBand = Math.abs(d.depth - s.depth) <= 1.0;
      const near = d.depth < s.depth + 3.5;
      if (near) {
        if (!this.flags['said' + this.stopIdx]) { this.flags['said' + this.stopIdx] = true; game.say(`ascent.stop${s.depth}`); }
        if (inBand) this.stopT += dt;
        const hint = d.depth < s.depth - 1.0 ? 'Too shallow — go down' : d.depth > s.depth + 1.0 ? 'Rise to the stop' : '';
        ui.stopGauge({ stop: s.depth, depth: d.depth, inBand, frac: this.stopT / need, label: `${Math.ceil(Math.max(0, need - this.stopT))} s`, hint });
        if (d.depth < s.depth - 2.5 && !this.flags.shallow) { this.flags.shallow = true; game.say('ascent.shallow'); game.after(12, () => { this.flags.shallow = false; }); }
      } else ui.stopGauge(null);
      d.decoOverride = { depth: s.depth, time: Math.max(60, (need - this.stopT) * 60 * GAME_MIN_PER_STOP_SEC + (STOPS.length - 1 - this.stopIdx) * 300) };
      if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) this._objectives();
      if (this.stopT >= need) {
        this.stopIdx++; this.stopT = 0; this.penalty = 0;
        audio.play('chime', { gain: 0.35, bus: 'ui' });
        ui.stopGauge(null);
        this._objectives();
        if (this.stopIdx >= STOPS.length) {
          d.decoOverride = { depth: 0, time: 0 };
          game.say('ascent.surfaceDeco');
          ui.setMarker(null);
          this.siStart = this.t;
        } else game.say('ascent.next');
      }
    } else {
      // surface decompression: the surface interval runs from leaving the last stop
      const rem = SURFACE_INTERVAL - (this.t - this.siStart);
      ui.surfaceInterval({ remaining: rem * 3, sub: 'Surface and get into the chamber' });
      if (d.depth < 0.8 && !this.leaving) {
        this.leaving = true;
        game.carry = { ...d.exportState(), siUsed: this.t - this.siStart };
        game.goToStage(4, { fadeTime: 1.0 });
      }
    }
  }

  exit() {
    this.game.ui.stopGauge(null);
    if (this.diver) this.diver.decoOverride = null;
  }
}
