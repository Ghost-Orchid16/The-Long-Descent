import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildReef, REEF_POI } from '../../world/stages/reefBuild.js';
import { populateReef } from '../../world/stages/reefLife.js';
import { buildHullOnly } from '../../world/ship.js';
import { Diver } from '../../player/Diver.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { GhostNet } from '../events/GhostNet.js';
import { SPECIES } from '../../creatures/factory.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';
import { patchMaterial } from '../../render/water/patch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STATION = { x: 58, z: 30 };
const NET_BAND = { z0: 54, z1: 62, minDepth: 14 };

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
    const hf = this.reef.hf;
    this.station = V(STATION.x, hf.height(STATION.x, STATION.z) + 0.4, STATION.z);
    this.edge = V(REEF_POI.edge.x, hf.height(REEF_POI.edge.x, REEF_POI.edge.z) + 2.5, REEF_POI.edge.z);
    this.netWaypoint = V(38, hf.height(38, 58) + 2.0, 58);
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
    // ---- life
    this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    this.life = populateReef(this.creatures, this.reef.hf, this.reef, { station: this.station });
    game.scanner.enabled = true;
    game.scanner.range = 14;
    this.onDispose(game.scanner.addSource((cb) => this.creatures.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    const fans = this.reef.scatter.instances.filter((it) => it.tag === 'seafan').map((it) => ({ p: V(it.x, it.y + 0.75 * it.scale, it.z), r: 0.75 * it.scale }));
    this.onDispose(game.scanner.addSource((cb) => { for (const f of fans) cb('sea_fan', f.p, f.r, f); }));
    // ---- diver
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
    game.ui.setObjectives('Sunlight Reef · 0–30 m', [{ id: 'descend', text: 'Follow the down-line to the reef' }]);
    game.ui.setMarker(this.lineBot, 'Down-line');
    // ---- events
    this.net = new GhostNet(game, this.root, {
      onPanic: () => game.say('reef.ghostnet.panic'),
      onDone: () => this._netDone(),
    });
    this.onDispose(() => this.net.dispose());
    this.reefScans = new Set();
    this.offs = [
      bus.on('diver:fastAscent', () => { if (!game.ui.radioBusy) game.say('diver.fastAscent'); }),
      bus.on('diver:lowAir', () => game.say('diver.lowAir')),
      bus.on('species:logged', (id) => this._onLogged(id)),
    ];
    this.onDispose(() => this.offs.forEach((f) => f()));
    this.phase = 'descend';
    this.flags = {};
    this.stationT = 0; this.mantaT = 0; this.exploreT = 0;
  }

  _objectives() {
    const list = [{ id: 'descend', text: 'Follow the down-line to the reef', done: true },
      { id: 'scan', text: 'Scan reef life', sub: `(${Math.min(3, this.reefScans.size)}/3)`, done: this.reefScans.size >= 3 }];
    if (this.flags.stationShown) list.push({ id: 'station', text: 'Find the manta cleaning station', done: !!this.flags.atStation });
    if (this.flags.mantaCalled) list.push({ id: 'manta', text: 'Watch the manta on the station', done: !!this.flags.mantaDone });
    if (this.flags.southShown) list.push({ id: 'south', text: 'Follow the slope south to the drop-off', done: false });
    if (this.net.active || this.net.done) list.push({ id: 'net', text: 'Cut yourself free of the line', sub: `(${4 - this.net.remaining}/4)`, done: this.net.done });
    this.game.ui.setObjectives('Sunlight Reef · 0–30 m', list);
  }

  _onLogged(id) {
    const sp = SPECIES[id];
    if (!sp) return;
    if (!this.flags.journalHint) { this.flags.journalHint = true; this.game.after(1.0, () => this.game.say('reef.journal')); }
    if (sp.zone === 'reef' || sp.zone === 'wall') this.reefScans.add(id);
    if (this.phase === 'explore') this._objectives();
    if (id === 'reef_manta' && this.flags.mantaCalled && !this.flags.mantaDone) this._mantaDone();
  }

  _showStation() {
    if (this.flags.stationShown) return;
    this.flags.stationShown = true;
    this.game.ui.setMarker(this.station, 'Cleaning station');
    this._objectives();
  }

  _mantaDone() {
    this.flags.mantaDone = true;
    this.flags.southShown = true;
    this.game.ui.setMarker(this.netWaypoint, 'Drop-off');
    this._objectives();
    this.game.after(4, () => this.game.say('reef.toWall'));
  }

  _netDone() {
    this.game.save.stats.events.ghostNet = true;
    this.game.persist();
    this._objectives();
    this.game.say('reef.ghostnet.done', { interrupt: true });
    this.game.ui.setMarker(this.edge, 'Drop-off');
  }

  update(dt) {
    super.update(dt);
    const game = this.game, d = this.diver, ui = game.ui;
    // hull bobs gently
    this.hull.position.y = Math.sin(this.engine.env.time * 0.7) * 0.12;
    this.hull.rotation.z = Math.sin(this.engine.env.time * 0.55) * 0.012;
    this.creatures.setPlayer(d.pos, d.vel);
    this.creatures.update(dt);
    this.net.update(dt);
    if (d.torchOn !== undefined && game.input.pressed('torch')) d.setTorch(!d.torchOn);
    game.fx.narcosis = d.narcosis;
    audio.setNarcosis(d.narcosis);

    if (this.phase === 'descend' && d.depth > 7.5) {
      this.phase = 'explore';
      ui.setMarker(null);
      this._objectives();
      game.after(1.5, () => game.say('reef.shrimp'));
      game.after(9, () => { if (!this.flags.scanTip) { this.flags.scanTip = true; game.say('reef.scanTutorial'); } });
    }
    if (this.phase !== 'explore') return;
    this.exploreT += dt;
    if (!this.flags.scanTip && game.scanner.locked) { this.flags.scanTip = true; game.say('reef.scanTutorial'); }
    if (!this.flags.stationShown && (this.reefScans.size >= 3 || this.exploreT > 100)) this._showStation();
    if (!this.flags.colour && d.depth > 17) { this.flags.colour = true; game.say('reef.colour'); }
    if (!this.flags.ndl && d.computer && d.computer.ndl(d.depth) < 8 && d.depth > 12) { this.flags.ndl = true; game.say('reef.lowNdl'); }

    // ---- cleaning station and the manta
    const dS = d.pos.distanceTo(this.station);
    if (this.flags.stationShown && !this.flags.atStation && dS < 14) {
      this.flags.atStation = true;
      ui.setMarker(null);
      this._objectives();
      game.say('reef.cleaning');
    }
    if (this.flags.atStation && !this.flags.mantaCalled) {
      // the manta comes in once the diver settles near the station
      if (dS < 18 && d.vel.length() < 0.6) this.stationT += dt;
      if (this.stationT > 5) {
        this.flags.mantaCalled = true;
        this.life.manta.visible = true;
        // the manta glides in out of the blue from beyond the station, away from the diver
        const away = this.station.clone().sub(d.pos).setY(0).normalize();
        const m = this.life.manta.agents[0];
        m.p.copy(this.station).addScaledVector(away, 24).add(V(0, 1.5, 0));
        m.v.copy(away).multiplyScalar(-0.5);
        m.yaw = Math.atan2(-away.x, -away.z);
        this._objectives();
      }
    }
    if (this.flags.mantaCalled && !this.flags.mantaDone) {
      const m = this.life.manta.agents[0];
      const dm = m.p.distanceTo(d.pos);
      // mantas slow down over the station while the wrasse work
      this.life.manta.o.speed = m.p.distanceTo(this.station) < 7 ? 0.32 : 0.55;
      if (!this.flags.mantaSaid && dm < 16) { this.flags.mantaSaid = true; game.say('reef.manta'); }
      if (dm < 12) this.mantaT += dt;
      if (this.mantaT > 28) this._mantaDone();
    }
    // ---- route south: the ghost net, then the drop-off
    if (this.flags.southShown && !this.net.active && !this.net.done && d.pos.z > NET_BAND.z0 && d.pos.z < NET_BAND.z1 + 30 && d.depth > NET_BAND.minDepth) {
      ui.setMarker(null);
      this.net.trigger(d);
      this._objectives();
      game.say('reef.ghostnet.start', { interrupt: true });
    }
    if (this.flags.southShown && !this.net.active && this.net.done && !this.flags.edgeMarker) { this.flags.edgeMarker = true; ui.setMarker(this.edge, 'Drop-off'); }
    if (!this.net.active && (this.net.done || this.flags.southShown) && d.pos.z > 116 && d.depth > 24 && !this.leaving) {
      this.leaving = true;
      game.goToStage(2, { fadeTime: 1.4 });
    }
  }
}
