import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildSurfaceSet, setDaylight, shipMotion } from './s0_deck.js';
import { oceanHeight } from '../../render/AboveWater.js';
import { SHIP } from '../../world/ship.js';
import { Walker } from '../../player/Walker.js';
import { Pod } from '../../player/Pod.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ORDER = ['hatch', 'life', 'scrubber', 'ballast', 'comms'];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

export default class LaunchStage extends Stage {
  static get id() { return 'launch'; }

  async build(yieldFrame) {
    this.set = buildSurfaceSet(this, { podVisible: true });
    await yieldFrame();
  }

  enter() {
    const game = this.game;
    setDaylight(this, this.set, { elevation: 34, azimuth: 96, tint: new THREE.Color(1.0, 0.93, 0.82), exposure: 0.48 });
    const D = SHIP.deckY;
    this.cradle = V(SHIP.podCradle.x, D + 1.65, SHIP.podCradle.z);
    this.podLocal = this.cradle.clone();
    this.sway = 0;
    // the pod sits in its cradle; the player boards it from the deck
    this.pod = new Pod(game, { position: V(), yaw: 0, parent: this.root });
    this.pod.locked = true;
    this.pod.external = new THREE.Matrix4();
    this._podMatrix();
    this.pod._apply(0);
    this.walker = new Walker(game, { ship: this.set.shipRoot, walk: this.set.ship.walk, colliders: this.set.ship.colliders, position: V(-1.2, D, 16.5), yaw: Math.PI - 0.3 });
    game.setPlayer(this.walker);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('deck');
    this.phase = 'deck';
    game.after(1.0, () => game.say('launch.intro'));
    const hatchW = () => V(0, 1.2, 0.1).applyMatrix4(this.pod.root.matrixWorld);
    game.ui.setMarker(hatchW, 'Pod hatch');
    this.board = game.interactions.add({ position: hatchW, radius: 0.6, range: 3.2, prompt: 'Climb into the pod', onUse: () => this._board() });
    this._objectives();
  }

  _objectives() {
    const p = this.phase, list = [];
    list.push({ id: 'board', text: 'Climb into the pod', done: p !== 'deck' });
    if (p !== 'deck') {
      const n = this.checked ? this.checked.length : 0;
      list.push({ id: 'check', text: 'Pre-dive checklist (overhead panel)', sub: n < 5 ? `${n}/5 · next: ${this.pod.cockpit.switches.find((s) => s.id === ORDER[n]).label.toLowerCase()}` : '', done: n >= 5 });
      if (n >= 5) list.push({ id: 'launch', text: 'Launch from the A-frame', done: ['water', 'flood', 'dive'].includes(p) });
      if (['water', 'flood', 'dive'].includes(p)) list.push({ id: 'flood', text: 'Flood the ballast (hold E on the ballast switch)', done: p === 'dive' });
    }
    this.game.ui.setObjectives('Pod launch · 11°22′N 142°35′E', list);
  }

  _podMatrix() {
    // ship-local placement plus a pendulum sway while hanging from the A-frame
    _q.setFromEuler(new THREE.Euler(this.sway * 0.4, 0, this.sway, 'YXZ'));
    _m.compose(this.podLocal, _q, _s);
    this.set.shipRoot.updateMatrixWorld();
    this.pod.external.multiplyMatrices(this.set.shipRoot.matrixWorld, _m);
  }

  async _board() {
    const game = this.game, pod = this.pod;
    game.interactions.remove(this.board);
    game.ui.setMarker(null);
    await game.ui.fade(true, 0.5);
    this.phase = 'check';
    this.checked = [];
    game.setPlayer(pod);
    pod.locked = true;           // no thrusters on deck
    pod.headYaw = 0; pod.headPitch = 0.45;
    audio.setEnvironment('pod');
    audio.play('thunk', { gain: 0.5 });
    game.ui.fade(false, 0.8);
    game.say('launch.inside');
    // checklist switches
    const ck = pod.cockpit;
    for (const sw of ck.switches) {
      sw.item = game.interactions.add({
        object: sw.group, radius: 0.05, range: 1.3, prompt: () => (sw.on ? sw.label : `Switch on · ${sw.label}`),
        enabled: () => this.phase === 'check' && !sw.on,
        onUse: () => this._flip(sw),
      });
    }
    this._objectives();
  }

  _flip(sw) {
    const game = this.game, ck = this.pod.cockpit;
    const next = ORDER[this.checked.length];
    if (sw.id !== next) {
      audio.play('scanFail', { gain: 0.6, bus: 'ui' });
      if (!this.orderSaid) { this.orderSaid = true; game.say('launch.order', { interrupt: true }); game.after(8, () => { this.orderSaid = false; }); }
      return;
    }
    ck.setSwitch(sw, true);
    audio.play('switch', { gain: 0.6, bus: 'ui' });
    this.checked.push(sw.id);
    if (sw.id === 'life') { this.pod.sys.lifeOnBattery = true; ck.cabinLight.intensity = 0.7; }
    if (sw.id === 'scrubber') this.pod.sys.scrubberOn = true;
    game.say('launch.' + sw.id, { interrupt: true });
    this._objectives();
    if (this.checked.length === 5) game.after(4.5, () => this._lift());
  }

  _lift() {
    const game = this.game;
    this.phase = 'lift';
    this.liftT = 0;
    game.say('launch.lift', { interrupt: true });
    audio.play('creak', { gain: 0.5, rate: 0.6 });
    this.winch = audio.loop('brown', { gain: 0.25, bus: 'sfx', filter: { type: 'bandpass', freq: 140, Q: 1.5 } });
    this._objectives();
  }

  update(dt) {
    super.update(dt);
    const game = this.game, env = this.engine.env, pod = this.pod;
    shipMotion(this.set.shipRoot, env.time);
    this.set.above.update(dt, this.engine.camera, env);
    const D = SHIP.deckY;
    if (this.phase === 'lift') {
      // keyframes in ship space: hoist, run aft under the A-frame, swing out over the stern, lower to the water
      this.liftT += dt;
      const t = this.liftT;
      const K = [[0, this.cradle], [4, V(0, D + 3.4, 22.2)], [11, V(0, D + 3.9, 29.8)], [17, V(0, D + 2.6, 35.2)], [25, V(0, 0.15, 35.4)]];
      let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
      const [t0, a] = K[i], [t1, b] = K[i + 1];
      const u = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1);
      this.podLocal.lerpVectors(a, b, u * u * (3 - 2 * u));
      this.sway = Math.sin(t * 1.7) * 0.05 * THREE.MathUtils.smoothstep(t, 3, 8) * (1 - THREE.MathUtils.smoothstep(t, 20, 25));
      if (t > 25) {
        this.phase = 'water'; this.waterT = 0;
        this.winch?.stop(0.5);
        audio.play('splash', { gain: 0.8 });
        game.say('launch.water', { interrupt: true }).then(() => { this.phase = 'flood'; game.say('launch.flood'); this._objectives(); });
        this._objectives();
        // the pod is now free of the ship: world-space bobbing on the swell
        this.pod.root.updateMatrixWorld();
        this.freePos = new THREE.Vector3().setFromMatrixPosition(this.pod.external);
        this.freeYaw = new THREE.Euler().setFromRotationMatrix(this.pod.external, 'YXZ').y;
      }
      this._podMatrix();
    } else if (this.phase === 'water' || this.phase === 'flood' || this.phase === 'dive') {
      const p = this.freePos;
      this.sinkY = this.sinkY ?? 0;
      if (this.phase === 'dive') {
        this.diveT += dt;
        this.sinkY -= dt * Math.min(1.2, this.diveT * 0.35);
        if (this.diveT > 7.5 && !this.leaving) {
          this.leaving = true;
          game.save.flags.podLaunched = true;
          game.goToStage(6, { fadeTime: 1.4 });
        }
      }
      const wave = this.phase === 'dive' ? oceanHeight(p.x, p.z, env.time) * Math.max(0, 1 + this.sinkY / 3) : oceanHeight(p.x, p.z, env.time);
      const y = wave * 0.6 + this.sinkY - 0.05;
      const pitch = (oceanHeight(p.x, p.z - 2, env.time) - oceanHeight(p.x, p.z + 2, env.time)) * 0.08;
      const roll = (oceanHeight(p.x - 2, p.z, env.time) - oceanHeight(p.x + 2, p.z, env.time)) * 0.08;
      _q.setFromEuler(new THREE.Euler(pitch, this.freeYaw, roll, 'YXZ'));
      this.pod.external.compose(V(p.x, y, p.z), _q, _s);
      // underwater: let the eye adapt naturally
      if (this.engine.env.cameraDepth > 0.4) this.engine.env.exposureOverride = null;
      if (this.phase === 'flood' && !this.floodItem) {
        const sw = this.pod.cockpit.switches.find((s) => s.id === 'ballast');
        this.floodItem = game.interactions.add({
          object: sw.group, radius: 0.06, range: 1.3, mode: 'hold', hold: 1.2, prompt: 'Flood the ballast',
          onUse: () => {
            game.interactions.remove(this.floodItem);
            this.phase = 'dive'; this.diveT = 0;
            audio.play('hiss', { gain: 0.7, rate: 0.6 });
            audio.play('splash', { gain: 0.4, rate: 0.6 });
            game.say('launch.dive', { interrupt: true });
            this._objectives();
          },
        });
      }
    } else this._podMatrix();
    if (this.game.player === pod) pod.update(dt);
    else pod._apply(0);
    // on deck the walker owns the camera; re-apply it after the pod placed its own
    if (this.game.player === this.walker) this.walker.applyCamera();
  }
}
