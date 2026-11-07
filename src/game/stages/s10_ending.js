import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildSurfaceSet, setDaylight, shipMotion } from './s0_deck.js';
import { oceanHeight } from '../../render/AboveWater.js';
import { Pod } from '../../player/Pod.js';
import { Ending } from '../../ui/Ending.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ASCENT = 52; // s for the montage from the trench floor to the surface

export default class EndingStage extends Stage {
  static get id() { return 'ending'; }

  async build(yieldFrame) {
    this.set = buildSurfaceSet(this, { podVisible: false });
    await yieldFrame();
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    // dusk: low sun behind the ship, warm sky
    setDaylight(this, this.set, { elevation: 4, azimuth: 262, tint: new THREE.Color(1.0, 0.62, 0.36), exposure: 0.7, haze: [0.62, 0.5, 0.48] });
    env.exposureOverride = null;
    this.set.shipRoot.userData.baseX = 0; this.set.shipRoot.userData.baseZ = 0;
    this.set.shipRoot.position.set(0, 0, 0);
    this.podStart = V(-14, -4, 70);
    this.pod = new Pod(game, { position: this.podStart.clone(), yaw: -0.5, parent: this.root });
    this.pod.importState(game.carry);
    this.pod.locked = true;
    this.pod.cockpit.switches.forEach((s) => this.pod.cockpit.setSwitch(s, true));
    this.pod.setFloods(true);
    game.setPlayer(this.pod);
    game.ui.setScubaHud(false);
    game.ui.setReticle(false);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('pod');
    game.scanner.enabled = false;
    this.from = Math.max(10000, game.carry?.depth ?? 10880);
    this.t = 0;
    this.phase = 'ascent';
    this.cues = [
      [9000, 'ending.d9000'], [6000, 'ending.d6000'], [4000, 'ending.d4000'], [1000, 'ending.d1000'], [200, 'ending.d200'], [40, 'ending.d40'],
    ].map(([at, key]) => ({ at, key, done: false }));
    this.set.above.group.visible = false; this.set.shipRoot.visible = false; this.set.island.visible = false;
    game.ui.setObjectives('Return', [{ id: 'up', text: 'Ascend to the surface', done: false }]);
    game.ui.transit(true, 'Ascending', this.from);
    env.setWaterType('deep');
    this.ending = new Ending(game);
    this.onDispose(() => this.ending.root.remove());
  }

  update(dt) {
    super.update(dt);
    const game = this.game, env = this.engine.env, pod = this.pod;
    shipMotion(this.set.shipRoot, env.time);
    this.set.above.update(dt, this.engine.camera, env);
    if (this.phase === 'ascent') {
      const k = Math.min(1, this.t / ASCENT);
      // fast through the dark, slowing towards the light
      const e = 1 - Math.pow(1 - k, 2.2);
      const depth = this.from * (1 - e) + 4 * e;
      env.depthBase = depth + pod.pos.y;
      env.current.set(0.02, -Math.min(3.5, (this.from / ASCENT) * 1.6 * (1 - k) + 0.2), 0);
      if (depth < 2600 && env.type !== 'blue') { /* the water warms and clears towards the surface */ }
      if (depth < 300 && !this.blue) { this.blue = true; env.setWaterType('blue', 6); this.pod.setFloods(false); }
      if (depth < 60 && !this.reef) { this.reef = true; env.setWaterType('reef', 4); }
      if (depth < 40) { this.set.shipRoot.visible = true; this.set.island.visible = true; }
      game.ui.transit(true, depth > 6000 ? 'Hadal zone' : depth > 4000 ? 'Abyssal zone' : depth > 1000 ? 'Midnight zone' : depth > 200 ? 'Twilight zone' : 'Sunlight zone', depth);
      for (const c of this.cues) if (!c.done && depth <= c.at) { c.done = true; game.say(c.key); }
      if (k >= 1) {
        this.phase = 'surface'; this.st = 0;
        env.depthBase = 0;
        env.current.set(0.02, 0, 0);
        game.ui.transit(false);
        this.rise0 = pod.pos.clone();
      }
    } else if (this.phase === 'surface') {
      // break the surface and settle on the swell
      this.st += dt;
      const p = this.rise0;
      const wave = oceanHeight(p.x, p.z, env.time);
      const y = THREE.MathUtils.lerp(p.y, wave * 0.6 + 0.25, Math.min(1, this.st / 5));
      pod.pos.set(p.x, y, p.z);
      pod.vel.set(0, 0, 0);
      if (!this.splashed && this.engine.env.cameraDepth < 0.1) { this.splashed = true; audio.play('splash', { gain: 0.7, rate: 0.8 }); audio.setEnvironment('deck'); this.engine.env.exposureOverride = 0.7; game.say('ending.surface'); }
      if (this.st > 7 && !this.summary) {
        this.summary = true;
        game.ui.setObjectives('', []);
        game.save.flags.completed = true;
        game.save.stage = 0;
        game.persist();
        game.after(5, () => { game.state = 'ending'; game.input.exitLock(); this.ending.showSummary(); });
      }
    }
    // the ocean mesh only from above the waterline (the underwater surface shader handles the view from below)
    this.set.above.group.visible = this.engine.env.cameraDepth < 0.2;
    pod.update(dt);
  }
}
