import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildSurfaceSet, setDaylight, shipMotion } from './s0_deck.js';
import { buildChamberInterior } from '../../world/chamberInterior.js';
import { SHIP } from '../../world/ship.js';
import { Walker } from '../../player/Walker.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { SURFACE_INTERVAL } from './s3_ascent.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STOP_DEPTH = 15;          // msw (50 fsw) for the in-chamber oxygen
const O2_PERIOD = 26;           // s of play per oxygen period
const AIR_BREAK = 11;
const FAULT_HOLD = 36;          // s the needle must spend in the green

export default class ChamberStage extends Stage {
  static get id() { return 'chamber'; }

  async build(yieldFrame) {
    this.set = buildSurfaceSet(this, { podVisible: true });
    await yieldFrame();
    this.inside = buildChamberInterior();
    this.inside.group.visible = false;
    this.set.ship.group.add(this.inside.group);
  }

  enter() {
    const game = this.game;
    setDaylight(this, this.set, { elevation: 18, azimuth: 250, tint: new THREE.Color(1.0, 0.82, 0.62), exposure: 0.42 });
    this.walker = new Walker(game, { ship: this.set.shipRoot, walk: this.set.ship.walk, colliders: this.set.ship.colliders, position: V(4.4, SHIP.deckY, 22.6), yaw: Math.PI * 0.15 });
    game.setPlayer(this.walker);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('deck');
    this.siLeft = Math.max(25, SURFACE_INTERVAL - (game.carry?.siUsed ?? 18));
    this.phase = 'deck';
    this.depth = 0; this.t = 0; this.pt = 0;
    this.flags = {};
    game.after(0.8, () => game.say('chamber.deck'));
    const doorLocal = V(SHIP.chamber.x, SHIP.chamber.y - 0.05, SHIP.chamber.z + 2.6);
    this.doorWorld = () => doorLocal.clone().applyMatrix4(this.set.shipRoot.matrixWorld);
    game.ui.setMarker(this.doorWorld, 'Chamber');
    this.doorItem = game.interactions.add({ position: this.doorWorld, radius: 0.5, range: 2.6, prompt: 'Climb into the chamber', onUse: () => this._enterChamber() });
    this._objectives();
  }

  _objectives() {
    const p = this.phase, list = [];
    const done = (ph) => ['deck', 'press', 'o2a', 'air1', 'fault', 'o2b', 'surface', 'done'].indexOf(p) > ['deck', 'press', 'o2a', 'air1', 'fault', 'o2b', 'surface', 'done'].indexOf(ph);
    list.push({ id: 'deck', text: 'Get into the deck chamber', sub: p === 'deck' ? 'within the surface interval' : '', done: done('deck') });
    if (p !== 'deck') {
      list.push({ id: 'press', text: 'Pressurise to 15 m', done: done('press') });
      list.push({ id: 'o2a', text: 'Oxygen period 1 — put on the mask', sub: p === 'o2a' && this.maskOn ? `(${Math.ceil(O2_PERIOD - this.pt)} s)` : '', done: done('o2a') });
      list.push({ id: 'air1', text: 'Air break', sub: p === 'air1' && !this.maskOn ? `(${Math.ceil(AIR_BREAK - this.pt)} s)` : '', done: done('air1') });
      if (this.flags.fault) list.push({ id: 'fault', text: 'Hold the pressure in the green', sub: p === 'fault' ? `${this.depth.toFixed(1)} msw · ${Math.ceil(Math.max(0, FAULT_HOLD - this.hold))} s` : '', done: done('fault') });
      if (done('fault')) list.push({ id: 'o2b', text: 'Oxygen period 2', sub: p === 'o2b' && this.maskOn ? `(${Math.ceil(O2_PERIOD - this.pt)} s)` : '', done: done('o2b') });
      if (done('o2b')) list.push({ id: 'surface', text: 'Decompress to the surface', done: done('surface') });
    }
    this.game.ui.setObjectives('Deck decompression chamber', list);
  }

  async _enterChamber() {
    const game = this.game, w = this.walker, I = this.inside;
    if (this.phase !== 'deck') return;
    this.phase = 'entering';
    game.interactions.remove(this.doorItem);
    game.ui.setMarker(null);
    game.ui.surfaceInterval(null);
    this.late = this.siLeft <= 0;
    game.save.stats.events.surfaceInterval = this.late ? 'late' : 'ok';
    await game.ui.fade(true, 0.5);
    I.group.visible = true;
    game.ui.surfaceInterval(null);
    // inside the steel shell only the chamber lamps light the scene
    const env = this.engine.env;
    this.savedLight = { nat: env.naturalLight, envI: this.engine.scene.environmentIntensity, exp: env.exposureOverride };
    env.naturalLight = 0.0;
    this.engine.scene.environmentIntensity = 0.12;
    env.exposureOverride = 0.95;
    w.seat = { pos: I.seat.clone() };
    w.yaw = -Math.PI / 2; w.pitch = -0.05;
    w.lookLimits = { yaw: -Math.PI / 2, yawRange: 1.7, pitchMin: -0.9, pitchMax: 0.75 };
    this.set.above.group.visible = true;
    audio.play('thunk', { gain: 0.6 });
    audio.setEnvironment('chamber');
    game.ui.fade(false, 0.8);
    this.phase = 'press'; this.pt = 0;
    game.say(this.late ? 'chamber.late' : 'chamber.in', { interrupt: true });
    if (this.late) game.after(0.1, () => game.say('chamber.in'));
    this.hiss = audio.loop('pink', { gain: 0.28, bus: 'sfx', filter: { type: 'bandpass', freq: 1800, Q: 0.8 } });
    // masks and valves
    this.maskOn = false;
    this.maskItem = game.interactions.add({
      object: I.masks[0], radius: 0.16, range: 1.4,
      prompt: () => (this.maskOn ? 'Take the oxygen mask off' : 'Put the oxygen mask on'),
      enabled: () => (this.phase === 'o2a' || this.phase === 'o2b') ? !this.maskOn : this.phase === 'air1' && this.maskOn,
      onUse: () => this._mask(!this.maskOn),
    });
    const valve = (wheel, key) => game.interactions.add({
      object: wheel, radius: 0.1, range: 1.4, mode: 'drag', prompt: `${wheel.userData.label} valve`,
      enabled: () => this.phase === 'fault',
      onDrag: (dx) => { this[key] = THREE.MathUtils.clamp(this[key] + dx * 1.6, 0, 1); wheel.rotation.z = -this[key] * Math.PI * 3; if (Math.random() < 0.3) audio.play('click', { gain: 0.08, rate: 0.5 }); },
    });
    this.supply = 0; this.exhaust = 0;
    this.valveItems = [valve(I.supply, 'supply'), valve(I.exhaust, 'exhaust')];
    this._objectives();
  }

  _mask(on) {
    const game = this.game;
    this.maskOn = on;
    this.inside.masks[0].visible = !on;
    audio.play('click', { gain: 0.35 });
    this.pt = 0;
    this.breathT = 0;
    if (!on && this.phase === 'air1') { /* air break running */ }
    this._objectives();
    void game;
  }

  update(dt) {
    super.update(dt);
    const game = this.game, env = this.engine.env, I = this.inside;
    shipMotion(this.set.shipRoot, env.time);
    this.set.above.update(dt, this.engine.camera, env);
    this.pt += dt;
    if (this.phase === 'entering') return;
    if (this.phase === 'deck') {
      this.siLeft -= dt;
      game.ui.surfaceInterval({ remaining: this.siLeft * 3, sub: this.siLeft > 0 ? 'Get into the chamber' : 'Over five minutes — keep going' });
      if (this.siLeft < 40 && !this.flags.hurry) { this.flags.hurry = true; game.say('chamber.hurry'); }
      return;
    }
    // oxygen breathing through the mask
    if (this.maskOn) {
      this.breathT = (this.breathT || 0) + dt;
      if (this.breathT > 4.4) { this.breathT = 0; audio.play('inhale', { gain: 0.25, rate: 1.2, reverb: 0.02 }); game.after(1.6, () => this.maskOn && audio.play('hiss', { gain: 0.08, rate: 1.8 })); }
    }
    const lcdT = 27.5 + this.depth * 0.22;
    if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) { I.drawLCD(this.maskOn ? 98.0 : 20.9 + this.depth * 0.02, lcdT, this.maskOn ? 'BIBS O₂' : 'AIR'); this._objectives(); }
    switch (this.phase) {
      case 'press': {
        const k = Math.min(1, this.pt / 13);
        const prev = this.depth;
        this.depth = STOP_DEPTH * (k * k * (3 - 2 * k));
        if (Math.floor(prev / 3) !== Math.floor(this.depth / 3)) audio.play('click', { gain: 0.3, rate: 0.35 }); // ears clearing
        if (k >= 1) { this.phase = 'o2a'; this.pt = 0; this.hiss?.setGain(0.04); game.say('chamber.o2'); this._objectives(); }
        break;
      }
      case 'o2a': if (this.maskOn && this.pt >= O2_PERIOD) { this.phase = 'air1'; this.pt = 0; game.say('chamber.air'); this._objectives(); } else if (!this.maskOn) this.pt = 0; break;
      case 'air1':
        if (!this.maskOn && this.pt >= AIR_BREAK) { this._startFault(); }
        else if (this.maskOn) this.pt = 0;
        break;
      case 'fault': this._fault(dt); break;
      case 'o2b': if (this.maskOn && this.pt >= O2_PERIOD) { this.phase = 'surface'; this.pt = 0; this._mask(false); game.say('chamber.surface'); this.hiss?.setGain(0.3); this._objectives(); } else if (!this.maskOn) this.pt = 0; break;
      case 'surface': {
        const k = Math.min(1, this.pt / 14);
        const prev = this.depth;
        this.depth = STOP_DEPTH * (1 - k * k * (3 - 2 * k));
        if (Math.floor(prev / 3) !== Math.floor(this.depth / 3)) audio.play('click', { gain: 0.25, rate: 0.4 });
        if (k >= 1) { this.phase = 'done'; this.hiss?.stop(0.6); this._done(); }
        break;
      }
      default: break;
    }
    I.setDepth(this.depth);
  }

  _startFault() {
    const game = this.game;
    this.phase = 'fault'; this.pt = 0;
    this.flags.fault = true;
    this.hold = 0; this.out = 0; this.drift = -0.35; this.surge = 0;
    audio.playAlarm('warn', 0.7);
    game.say('chamber.fault', { interrupt: true });
    this._objectives();
  }

  _fault(dt) {
    const game = this.game;
    // the sticking exhaust bleeds pressure; surges come and go
    this.surge -= dt;
    if (this.surge <= 0 && Math.random() < dt * 0.25) this.surge = 2 + Math.random() * 2, this.surgeDir = Math.random() < 0.55 ? -1 : 1;
    const surge = this.surge > 0 ? this.surgeDir * 0.55 : 0;
    const drift = -0.32 + Math.sin(this.pt * 0.6) * 0.18 + surge;
    this.depth = THREE.MathUtils.clamp(this.depth + (drift + this.supply * 1.3 - this.exhaust * 1.1) * dt, 6, 26);
    const green = Math.abs(this.depth - STOP_DEPTH) <= 1;
    if (green) { this.hold += dt; this.out = 0; } else this.out += dt;
    if (!green && this.out > 3 && !this.flags.slip) { this.flags.slip = true; game.say('chamber.faultSlip'); game.after(10, () => { this.flags.slip = false; }); }
    if (this.out > 9) {
      // short setback: the tender stabilises it from outside, a little progress is lost
      this.out = 0; this.hold = Math.max(0, this.hold - 10);
      this.depth = STOP_DEPTH; this.supply = 0.25; this.exhaust = 0;
      game.say('chamber.faultReset', { interrupt: true });
      game.save.stats.events.chamberResets = (game.save.stats.events.chamberResets || 0) + 1;
    }
    if (this.hold >= FAULT_HOLD) {
      this.phase = 'o2b'; this.pt = 0; this.depth = STOP_DEPTH;
      game.save.stats.events.chamber = true;
      audio.play('chime', { gain: 0.4, bus: 'ui' });
      game.say('chamber.faultFix', { interrupt: true });
      this._objectives();
    }
  }

  async _done() {
    const game = this.game;
    this._objectives();
    audio.play('thunk', { gain: 0.5 });
    await game.say('chamber.done');
    game.save.flags.diveDone = true;
    game.persist();
    game.goToStage(5, { fadeTime: 1.6, card: ['Two days later', '11°22′N 142°35′E · above the Challenger Deep', 'Pod launch'] });
  }

  exit() { this.hiss?.stop(0.3); this.game.ui.surfaceInterval(null); }
}
