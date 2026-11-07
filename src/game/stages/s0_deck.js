import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { AboveWater, oceanHeight } from '../../render/AboveWater.js';
import { buildShip, SHIP, halfBeam } from '../../world/ship.js';
import { buildIsland } from '../../world/island.js';
import { Walker } from '../../player/Walker.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { gaugeSVG } from '../../ui/svg.js';
import { patchMaterial } from '../../render/water/patch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Ship heave/roll/pitch from the CPU ocean model. */
export function shipMotion(shipRoot, t, heading = 0) {
  const pts = [[0, -26], [0, 26], [-6, 0], [6, 0]];
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const h = pts.map(([x, z]) => oceanHeight(shipRoot.userData.baseX + x * cos + z * sin, shipRoot.userData.baseZ - x * sin + z * cos, t));
  const heave = (h[0] + h[1] + h[2] + h[3]) / 4;
  shipRoot.position.y = heave * 0.55;
  shipRoot.rotation.set(Math.atan2(h[0] - h[1], 52) * 0.5, heading, Math.atan2(h[2] - h[3], 12) * 0.45, 'YXZ');
}

/** Builds the sky/ocean/island/ship set shared by every above-water stage. */
export function buildSurfaceSet(stage, { podVisible = true } = {}) {
  const e = stage.engine;
  const above = new AboveWater(e);
  stage.root.add(above.group);
  const shipRoot = new THREE.Group();
  shipRoot.name = 'shipRoot';
  shipRoot.userData.baseX = 0; shipRoot.userData.baseZ = 0;
  const ship = buildShip(e, { podVisible });
  shipRoot.add(ship.group);
  stage.root.add(shipRoot);
  const island = buildIsland();
  stage.root.add(island);
  stage.onDispose(() => above.dispose());
  return { above, shipRoot, ship, island };
}

/** Configure optics and lights for being above the water in daylight. */
export function setDaylight(stage, set, { elevation = 26, azimuth = 78, tint = new THREE.Color(1.0, 0.9, 0.78), exposure = 0.5, haze = [0.56, 0.66, 0.78] } = {}) {
  const env = stage.engine.env;
  env.depthBase = 0;
  env.setWaterType('reef');
  env.naturalLight = 1;
  env.setSun({ elevation, azimuth, intensity: 3.2, skyIntensity: 0.35, tint });
  env.uniforms.uWHazeColor.value.set(...haze);
  env.uniforms.uWHazeDensity.value = 0.00005;
  env.exposureOverride = exposure;
  set.above.setSun(env);
  const r = stage.engine.renderer;
  r.shadowMap.enabled = true;
  stage.engine.configureSunShadow(true);
  const s = env.sun.shadow.camera;
  s.left = -16; s.right = 16; s.top = 16; s.bottom = -16; s.updateProjectionMatrix();
  env.sun.shadow.bias = -0.0003; env.sun.shadow.normalBias = 0.02;
  stage.engine.scene.environment = set.above.refreshEnvironment();
  stage.engine.scene.environmentIntensity = 0.7;
  stage.onDispose(() => {
    stage.engine.scene.environment = null;
    env.exposureOverride = null;
    env.sun.castShadow = false;
    r.shadowMap.enabled = stage.engine.preset.shadows;
    if (stage.engine.preset.shadows) stage.engine.configureSunShadow(true);
  });
}

export default class DeckStage extends Stage {
  static get id() { return 'deck'; }

  async build(yieldFrame) {
    this.set = buildSurfaceSet(this, {});
    await yieldFrame();
    this.gear = this._buildGear();
    this.set.ship.group.add(this.gear.group);
  }

  _buildGear() {
    const D = SHIP.deckY, B = SHIP.bench;
    const g = new THREE.Group();
    const pm = (color, rough = 0.5, metal = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); patchMaterial(m, { key: 'gear' }); return m; };
    const yellow = pm(0xd8c23a, 0.35, 0.2), black = pm(0x16181a, 0.6), chrome = pm(0xc8ccd0, 0.2, 1), yel2 = pm(0xe2c400, 0.45), blue = pm(0x1f3550, 0.6), glass = pm(0x8fa0a8, 0.05, 0.1);
    // cylinder in the bench rack + jacket
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.66, 24), yellow);
    tank.position.set(B.x + 0.05, D + 1.08, B.z - 0.2); tank.castShadow = true;
    const valve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), chrome); valve.position.set(0, 0.36, 0); tank.add(valve);
    const bcd = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.12), black); bcd.position.set(-0.07, 0, -0.04); bcd.scale.set(1, 1, 1); tank.add(bcd);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), black); wing.scale.set(1.0, 1.3, 0.4); wing.position.set(-0.12, 0.02, 0.02); tank.add(wing);
    // inflator hose
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.1, 0.25, 0.02), V(-0.2, 0.15, 0.1), V(-0.24, -0.05, 0.14)]), 10, 0.012, 6), black); tank.add(hose);
    // second stages: primary (black) and backup (yellow) on the bench top
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), black); reg.rotation.x = Math.PI / 2; reg.position.set(B.x - 0.12, D + 0.79, B.z + 0.25);
    const octo = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), yel2); octo.rotation.x = Math.PI / 2; octo.position.set(B.x - 0.12, D + 0.79, B.z + 0.45);
    // gauge console
    const spg = new THREE.Group();
    const spgBody = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 20), black); spg.add(spgBody);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.033, 20), pm(0xf2efe6, 0.4)); face.rotation.x = -Math.PI / 2; face.position.y = 0.0135; spg.add(face);
    spg.position.set(B.x - 0.05, D + 0.775, B.z - 0.55);
    // mask on the bench
    const mask = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.08), black); mask.add(frame);
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.065, 0.05), glass); l.rotation.x = -Math.PI / 2; l.position.set(s * 0.04, 0.022, 0); mask.add(l); }
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 6, 20, Math.PI), black); strap.rotation.x = -Math.PI / 2; strap.position.z = -0.04; mask.add(strap);
    mask.position.set(B.x - 0.1, D + 0.77, B.z + 0.85);
    // fins on the deck
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.55), blue);
      fin.position.set(B.x - 0.65 + s * 0.13, D + 0.012, B.z + 0.6); fin.rotation.y = 0.15 * s; fin.receiveShadow = true;
      g.add(fin);
    }
    [tank, reg, octo, spg, mask].forEach((o) => { o.castShadow = true; g.add(o); });
    return { group: g, tank, bcd, wing, reg, octo, spg, mask };
  }

  enter() {
    const game = this.game, e = this.engine;
    setDaylight(this, this.set);
    this.set.shipRoot.userData.baseX = 0; this.set.shipRoot.userData.baseZ = 0;
    this.walker = new Walker(game, { ship: this.set.shipRoot, walk: this.set.ship.walk, colliders: this.set.ship.colliders, position: SHIP.spawn.clone(), yaw: Math.PI + 0.55 });
    game.setPlayer(this.walker);
    game.ui.setScubaHud(false);
    game.ui.setReticle(true);
    game.fxTarget.mask = 0; game.fx.mask = 0;
    audio.setEnvironment('deck');
    this.step = 'intro';
    game.ui.setObjectives('Prologue · R/V Tåsi', [
      { id: 'gauge', text: 'Read the tank pressure gauge' },
      { id: 'purge', text: 'Purge the regulator' },
      { id: 'bcd', text: 'Inflate and dump the BCD' },
      { id: 'mask', text: 'Put your mask on' },
    ]);
    game.after(1.2, () => game.say('prologue.intro'));
    this._setupGearInteractions();
    game.ui.setMarker(() => this.gear.tank.getWorldPosition(new THREE.Vector3()), 'Dive gear');
  }

  _setupGearInteractions() {
    const game = this.game, ia = game.interactions, gear = this.gear;
    const done = new Set();
    const finish = (id, key) => { done.add(id); game.ui.completeObjective(id); if (key) game.say(key); };
    ia.add({
      object: gear.spg, radius: 0.12, range: 2.2, prompt: 'Read the tank pressure gauge', enabled: () => !done.has('gauge'),
      onUse: () => {
        audio.play('click', { gain: 0.4, bus: 'ui' });
        game.ui.inspect(gaugeSVG(200, { label: 'TANK', unit: 'bar', red: [0, 50] }), 'Submersible pressure gauge · 200 bar');
        game.after(3.2, () => game.ui.inspect(null));
        finish('gauge', 'prologue.gauge');
      },
    });
    ia.add({
      object: gear.reg, radius: 0.1, range: 2.2, prompt: 'Purge the regulator', enabled: () => done.has('gauge') && !done.has('purge'),
      onUse: () => { audio.play('hiss', { gain: 0.6 }); finish('purge', 'prologue.purge'); },
    });
    let bcdState = 0;
    ia.add({
      object: gear.wing, radius: 0.2, range: 2.4, mode: 'hold', hold: 1.4,
      prompt: () => (bcdState === 0 ? 'Inflate the BCD' : 'Dump air from the BCD'),
      enabled: () => done.has('purge') && !done.has('bcd'),
      onHold: (p) => { const s = bcdState === 0 ? 1 + p * 0.35 : 1.35 - p * 0.35; gear.wing.scale.set(1.0 * s, 1.3 * (1 + (s - 1) * 0.5), 0.4 * s * 1.3); },
      onUse: () => {
        audio.play('hiss', { gain: bcdState === 0 ? 0.45 : 0.7, rate: bcdState === 0 ? 0.8 : 1.2 });
        if (bcdState === 0) { bcdState = 1; game.say('prologue.bcdIn'); } else { finish('bcd', 'prologue.bcdOut'); }
      },
    });
    ia.add({
      object: gear.mask, radius: 0.12, range: 2.2, prompt: 'Put your mask on', enabled: () => done.has('bcd') && !done.has('mask'),
      onUse: () => {
        gear.mask.visible = false;
        game.fxTarget.mask = 1;
        audio.play('click', { gain: 0.3 });
        finish('mask', 'prologue.mask');
        this._toPlatform();
      },
    });
  }

  _toPlatform() {
    const game = this.game;
    game.ui.setObjectives('Prologue · R/V Tåsi', [{ id: 'platform', text: 'Go to the dive platform (starboard stern)' }]);
    const plat = SHIP.platform;
    const seatLocal = V(plat.x + 0.35, plat.y + 0.95, plat.z);
    const seatWorld = () => seatLocal.clone().applyMatrix4(this.set.shipRoot.matrixWorld);
    game.ui.setMarker(seatWorld, 'Dive platform');
    this.seatItem = game.interactions.add({
      position: seatWorld, radius: 0.6, range: 3.2, prompt: 'Sit on the platform edge',
      onUse: () => {
        game.interactions.remove(this.seatItem);
        game.ui.setMarker(null);
        game.ui.completeObjective('platform');
        this.walker.seat = { pos: seatLocal };
        this.walker.yaw = Math.PI / 2 + 0.2; this.walker.pitch = -0.15;
        this.walker.lookLimits = { yaw: Math.PI / 2, yawRange: 1.3, pitchMin: -0.9, pitchMax: 0.9 };
        game.say('prologue.platform');
        game.ui.setObjectives('Prologue · R/V Tåsi', [{ id: 'roll', text: 'Back-roll into the water' }]);
        this.rollItem = game.interactions.add({
          position: () => this.engine.camera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camera.quaternion)),
          radius: 3, range: 4, mode: 'hold', hold: 1.0, prompt: 'Roll back into the water',
          onUse: () => { game.interactions.remove(this.rollItem); this._backRoll(seatLocal); },
        });
      },
    });
  }

  async _backRoll(seatLocal) {
    const game = this.game, w = this.walker;
    w.lookLocked = true; w.lookLimits = null;
    game.ui.prompt(null);
    const startPitch = w.pitch, startYaw = w.yaw;
    let t = 0;
    const dur = 1.35;
    let splashed = false;
    const anim = game.addUpdaterAlways((dt) => {
      t += dt;
      const a = Math.min(1, t / dur);
      const e = a * a;
      // fall backwards (outboard = +x in ship space) while rotating up and over
      w.seat = { pos: V(seatLocal.x + Math.sin(e * 1.6) * 1.0, seatLocal.y - e * 2.6, seatLocal.z) };
      w.pitch = startPitch + e * 1.9;
      w.yaw = startYaw;
      if (!splashed && a > 0.82) {
        splashed = true;
        audio.play('splash', { gain: 0.9, reverb: 0.2 });
        game.fx.fadeColor.setRGB(0.78, 0.88, 0.95);
        game.tweenFx('fade', 1, 0.12);
      }
      if (a >= 1) {
        anim();
        game.save.flags.backRoll = true;
        game.goToStage(1, { transition: 'custom' });
      }
    });
  }

  update(dt) {
    super.update(dt);
    const env = this.engine.env;
    shipMotion(this.set.shipRoot, env.time);
    this.set.above.update(dt, this.engine.camera, env);
  }
}

export { halfBeam };
