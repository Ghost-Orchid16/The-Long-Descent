import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildReef } from '../../world/stages/reefBuild.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { settings } from '../../core/Settings.js';
import { audio } from '../../core/audio/AudioEngine.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Live backdrop behind the title menu: a corner of the Sunlight Reef around the cleaning station, with the camera
 * drifting slowly while a manta circles. Also runs the first-launch quality benchmark.
 */
export default class TitleStage extends Stage {
  static get id() { return 'title'; }

  async build(yieldFrame) {
    await yieldFrame();
    this.reef = buildReef(this.engine, { area: { x0: 14, z0: -14, sizeX: 92, sizeZ: 92 }, anemones: false, density: 0.85 });
    this.root.add(this.reef.group);
    this.scatters.push(this.reef.scatter);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.depthBase = 0;
    env.setWaterType('reef');
    env.naturalLight = 1;
    env.setSun({ elevation: 34, azimuth: 82, intensity: 3.2, skyIntensity: 1.0, tint: new THREE.Color(1.0, 0.94, 0.84) });
    env.exposureOverride = null;
    env.current.set(0.02, 0, 0.015);
    e.snow.setDensity(0.55); e.dust.setDensity(0.8);
    const c = game.collision;
    c.addHeightfield(this.reef.hf);
    const hf = this.reef.hf;
    this.station = V(58, hf.height(58, 30) + 0.4, 30);
    const mgr = this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    const s = this.station;
    mgr.spawn('chromis', { beh: 'school', count: 30, home: V(s.x - 4, s.y + 1.2, s.z - 3), radius: 1.6, yMin: s.y + 0.3, yMax: s.y + 3, spacing: 1.6, clearance: 0.35 });
    mgr.spawn('moorish_idol', { beh: 'school', count: 3, home: V(48, hf.height(48, 18) + 2, 18), radius: 8, clearance: 1.0, spacing: 2.5 });
    const loop = [];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; loop.push(V(s.x + Math.cos(a) * 8, s.y + 3.4 + Math.sin(a * 2) * 0.8, s.z + Math.sin(a) * 6.5)); }
    mgr.spawn('reef_manta', { beh: 'giant', path: loop, loop: true, speed: 0.5, count: 1 });
    mgr.spawn('green_turtle', { beh: 'cruise', count: 1, home: V(40, hf.height(40, 40) + 3, 40), radius: 18, clearance: 1.5 });
    mgr.spawn('cleaner_wrasse', { beh: 'cleaning', points: [0, 1, 2].map((i) => ({ p: s.clone().add(V(Math.cos(i * 2.1) * 0.8, 0.35, Math.sin(i * 2.1) * 0.8)) })), clearance: 0.15 });
    game.ui.setScubaHud(false);
    game.ui.setReticle(false);
    game.ui.setObjectives('', []);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('reef');
    this.camT = 0;
    this.bench = { t: 0, frames: [], last: performance.now(), done: settings.get('quality') !== 'auto' || !!settings.get('resolvedQuality') };
  }

  update(dt) {
    super.update(dt);
    const cam = this.engine.camera, s = this.station;
    this.camT += dt;
    // slow orbit around the station, gently rising and falling
    const a = 2.4 + this.camT * 0.035;
    const r = 15 + Math.sin(this.camT * 0.05) * 2;
    cam.position.set(s.x + Math.cos(a) * r, s.y + 4.2 + Math.sin(this.camT * 0.11) * 0.8, s.z + Math.sin(a) * r);
    cam.lookAt(s.x + 4, s.y + 1.6, s.z - 2);
    cam.updateMatrixWorld();
    this.creatures.setPlayer(cam.position, new THREE.Vector3());
    this.creatures.update(dt);
    this._benchmark();
  }

  /** Median frame time over ~2.5 s once shaders are warm → choose low / medium / high for "auto". */
  _benchmark() {
    const b = this.bench;
    if (b.done) return;
    const now = performance.now();
    const ft = now - b.last;
    b.last = now;
    b.t += ft / 1000;
    if (b.t < 1.5) return;
    b.frames.push(ft);
    if (b.t < 4.0) return;
    b.done = true;
    const sorted = b.frames.slice().sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)] || 16;
    const q = med > 28 ? 'low' : med < 12.5 ? 'high' : 'medium';
    settings.set('resolvedQuality', q);
    this.engine.setQuality(settings.quality());
    if (import.meta.env?.DEV) console.info(`[quality] auto: ${q} (median frame ${med.toFixed(1)} ms)`);
  }
}
