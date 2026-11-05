import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildReef, REEF_POI } from '../../world/stages/reefBuild.js';
import { buildHullOnly } from '../../world/ship.js';
import { Diver } from '../../player/Diver.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';
import { patchMaterial } from '../../render/water/patch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export default class ReefStage extends Stage {
  static get id() { return 'reef'; }

  async build(yieldFrame) {
    this.reef = buildReef(this.engine, {});
    this.root.add(this.reef.group);
    this.scatters.push(this.reef.scatter);
    await yieldFrame();
    // the research vessel moored above the entry point
    this.hull = buildHullOnly(this.engine);
    this.hull.position.set(-6, 0, -36);
    this.hull.rotation.y = 0.35;
    this.root.add(this.hull);
    // down-line from a surface buoy to a weight on the sand
    const lineTop = V(4, -0.3, -27), lineBot = V(4, this.reef.hf.height(4, -27) + 0.25, -27);
    this.lineTop = lineTop; this.lineBot = lineBot;
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.9 });
    patchMaterial(ropeMat, { key: 'rope' });
    const curve = new THREE.CatmullRomCurve3([lineTop, lineTop.clone().lerp(lineBot, 0.5).add(V(0.25, 0, 0.1)), lineBot]);
    this.rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 6), ropeMat);
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xd8501e, roughness: 0.5 });
    patchMaterial(buoyMat, { key: 'buoy' });
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), buoyMat); buoy.position.set(lineTop.x, -0.12, lineTop.z);
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5 }));
    patchMaterial(weight.material, { key: 'weight' });
    weight.position.copy(lineBot).add(V(0, -0.12, 0));
    this.root.add(this.rope, buoy, weight);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env;
    env.depthBase = 0;
    env.setWaterType('reef');
    env.naturalLight = 1;
    env.setSun({ elevation: 30, azimuth: 82, intensity: 3.2, skyIntensity: 1.0, tint: new THREE.Color(1.0, 0.94, 0.84) });
    env.exposureOverride = null;
    env.bottomAlbedo = 0.3;
    env.current.set(0.02, 0, 0.015);
    e.snow.setDensity(0.55); e.dust.setDensity(0.8);
    const c = game.collision;
    c.addHeightfield(this.reef.hf);
    for (const it of this.reef.scatter.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    const b = this.reef.hf;
    c.bounds = { min: V(b.x0 + 3, -40, b.z0 + 3), max: V(b.x0 + b.sizeX - 3, 0, b.z0 + b.sizeZ - 3) };
    const start = V(2.2, -1.4, -28.5);
    this.diver = new Diver(game, { position: start, yaw: 0.6, pitch: 0.9 });
    game.setPlayer(this.diver);
    game.fxTarget.mask = 1; game.fx.mask = 1;
    game.ui.setScubaHud(true);
    game.ui.setReticle(true);
    audio.setEnvironment('reef');
    // arrival from the back-roll: white bubble burst that clears
    if (game.save.flags.backRoll) {
      game.fx.fadeColor.setRGB(0.78, 0.88, 0.95);
      game.fx.fade = 1;
      const p = start.clone();
      for (let i = 0; i < 6; i++) e.bubbles.burst(p.clone().add(V((Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.6, (Math.random() - 0.5) * 0.8)), { count: 40, rMin: 0.003, rMax: 0.03, spread: 0.6 });
      game.tweenFx('fade', 0, 2.2);
      this.diver.locked = true;
      game.after(2.0, () => { this.diver.locked = false; });
    }
    game.after(2.6, () => game.say('prologue.entry'));
    game.ui.setObjectives('Sunlight Reef · 0–30 m', [
      { id: 'descend', text: 'Follow the down-line to the reef' },
    ]);
    game.ui.setMarker(this.lineBot, 'Down-line');
    this.offs = [
      bus.on('diver:fastAscent', () => { if (!game.ui.radioBusy) game.say('diver.fastAscent'); }),
      bus.on('diver:lowAir', () => game.say('diver.lowAir')),
    ];
    this.onDispose(() => this.offs.forEach((f) => f()));
    this.phase = 'descend';
  }

  update(dt) {
    super.update(dt);
    const game = this.game, d = this.diver;
    // hull bobs gently
    this.hull.position.y = Math.sin(this.engine.env.time * 0.7) * 0.12;
    this.hull.rotation.z = Math.sin(this.engine.env.time * 0.55) * 0.012;
    if (this.phase === 'descend' && d.depth > 7.5) {
      this.phase = 'explore';
      game.ui.completeObjective('descend');
      game.ui.setMarker(null);
      game.after(1.5, () => game.say('reef.shrimp'));
    }
    if (d.torchOn !== undefined && game.input.pressed('torch')) d.setTorch(!d.torchOn);
    game.fx.narcosis = d.narcosis;
    audio.setNarcosis(d.narcosis);
  }
}
