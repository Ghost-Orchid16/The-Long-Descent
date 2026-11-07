import * as THREE from 'three';
import { Stage } from '../Stage.js';
import { buildWall } from '../../world/stages/wallBuild.js';
import { Diver } from '../../player/Diver.js';
import { CreatureManager } from '../../creatures/CreatureManager.js';
import { SharkDisplay } from '../events/SharkDisplay.js';
import { FreeFlow } from '../events/FreeFlow.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';
import { patchMaterial } from '../../render/water/patch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

function recorderSVG() {
  return `<svg width="360" height="200" viewBox="0 0 360 200" style="font-family:Inter,sans-serif">
    <rect x="8" y="8" width="344" height="184" rx="16" fill="#e8b818" stroke="#8a6c08" stroke-width="2"/>
    <rect x="26" y="26" width="308" height="122" rx="6" fill="#0c1410" stroke="#2a3a30"/>
    <g fill="#9fe8b4" font-size="13" letter-spacing="1">
      <text x="40" y="50">AURAL-3 · DEPLOYED 14 MAR</text>
      <text x="40" y="74">EVENTS LOGGED   1,284</text>
      <text x="40" y="96">TONAL  12.0 kHz · 2.00 s</text>
      <text x="40" y="118">LAST DETECTION  −02:06 h</text>
      <text x="40" y="138" fill="#5fae7c" font-size="11">BEARING 247° · SNR 4.1 dB</text>
    </g>
    <text x="180" y="176" text-anchor="middle" font-size="11" fill="#3a2c02" letter-spacing="2">PASSIVE ACOUSTIC RECORDER</text>
  </svg>`;
}

export default class WallStage extends Stage {
  static get id() { return 'wall'; }

  async build(yieldFrame) {
    await yieldFrame();
    this.wall = buildWall(this.engine, {});
    this.root.add(this.wall.group);
    this.scatters.push(this.wall.reefTop.scatter, this.wall.scatter);
    await yieldFrame();
    // the ascent line: from the wreck's bow up to a sub-surface buoy, with the hang tank at 6 m
    const P = this.wall.poi;
    const base = P.bowLine.clone();
    const top = V(base.x + 2, -4.0, base.z - 4);
    this.lineBase = base; this.lineTop = top;
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xcfc4a2, roughness: 0.9 });
    patchMaterial(ropeMat, { key: 'rope' });
    const curve = new THREE.CatmullRomCurve3([base, base.clone().lerp(top, 0.5).add(V(0.8, 0, 0.4)), top]);
    this.line = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.014, 6), ropeMat);
    this.lineCurve = curve;
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xe0601e, roughness: 0.45 });
    patchMaterial(buoyMat, { key: 'buoy' });
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), buoyMat);
    buoy.position.copy(top).add(V(0, 0.45, 0));
    this.root.add(this.line, buoy);
  }

  enter() {
    const game = this.game, e = this.engine, env = e.env, W = this.wall;
    env.depthBase = 0;
    env.setWaterType('blue');
    env.naturalLight = 1;
    env.setSun({ elevation: 34, azimuth: 82, intensity: 3.2, skyIntensity: 1.0, tint: new THREE.Color(1.0, 0.95, 0.86) });
    env.exposureOverride = null;
    env.bottomAlbedo = 0.22;
    env.current.set(0.05, 0, 0.0);
    e.snow.setDensity(0.8); e.dust.setDensity(0.9);
    // ---- collision
    const c = game.collision;
    c.addHeightfield(W.reefTop.hf);
    c.addHeightfield(W.ledge);
    c.addHeightfield(W.lipHF);
    c.addSheet(W.sheetCollider);
    for (const sc of [W.reefTop.scatter, W.scatter]) for (const it of sc.instances) if (it.r > 0.25) c.addSphere(V(it.x, it.y + it.r * 0.5, it.z), it.r * 0.8);
    const wM = W.wreck.group.matrixWorld;
    for (const col of W.wreck.colliders) {
      if (col.type === 'box') c.addBox(col.m.clone().premultiply(wM), col.half);
      else c.addCapsule(col.a.clone().applyMatrix4(wM), col.b.clone().applyMatrix4(wM), col.r);
    }
    c.bounds = { min: V(-92, -70, 74), max: V(92, 0, 205) };
    // ---- life
    this.creatures = new CreatureManager(e, { collision: c, root: this.root });
    const P = W.poi;
    const mgr = this.creatures;
    this.sharks = mgr.spawn('grey_reef', { beh: 'cruise', count: 2, home: V(10, -40, 150), radius: 28, yMin: -55, yMax: -32, clearance: 2.5, speed: 0.75 });
    this.displayShark = mgr.spawn('grey_reef', { beh: 'cruise', count: 1, home: P.sharkZone.clone(), radius: 4, yMin: -60, yMax: -30, clearance: 2, active: 200 });
    this.displayShark.visible = false;
    this.displayShark.agents[0].p.set(80, -45, 190);
    mgr.spawn('chevron_barracuda', { beh: 'school', count: 90, home: P.vortex.clone(), vortex: { radius: 3.6, height: 4.5 }, speed: 0.55, radius: 6, active: 140 });
    mgr.spawn('giant_trevally', { beh: 'cruise', count: 3, home: V(14, -46, 162), radius: 18, yMin: -54, yMax: -38, clearance: 1.5 });
    mgr.spawn('eagle_ray', { beh: 'cruise', count: 2, home: V(0, -36, 140), radius: 40, yMin: -42, yMax: -31, clearance: 3, speed: 0.6 });
    const holes = W.wreck.anchors.morayHoles.map((h) => ({ p: h.p.clone().applyMatrix4(wM), dir: h.dir.clone().transformDirection(wM) }));
    mgr.spawn('giant_moray', { beh: 'hide', points: holes, peek: 0.18 });
    // a few reef species along the top for continuity
    mgr.spawn('chromis', { beh: 'school', count: 24, home: V(-20, -27.5, 104), radius: 1.6, yMin: -29, yMax: -25.5, spacing: 1.6 });
    mgr.spawn('moorish_idol', { beh: 'school', count: 3, home: V(30, -26, 108), radius: 10, clearance: 1.0, spacing: 2.5 });
    game.scanner.enabled = true;
    game.scanner.range = 13;
    this.onDispose(game.scanner.addSource((cb) => mgr.forEachAgent((g, a) => cb(g.id, a.p, g.radius * a.scale, a))));
    const fans = W.scatter.instances.filter((it) => it.tag === 'seafan').map((it) => ({ p: V(it.x, it.y + 0.75 * it.scale, it.z), r: 0.75 * it.scale }));
    this.onDispose(game.scanner.addSource((cb) => { for (const f of fans) cb('sea_fan', f.p, f.r, f); }));
    // ---- diver (gas and tissues carried over from the reef)
    this.diver = new Diver(game, { position: P.start.clone(), yaw: Math.PI, pitch: -0.35 });
    if (game.carry) this.diver.importState(game.carry);
    else { this.diver.air = 150; this.diver.computer.step(22 * 60, 14); this.diver.computer.diveTime = 22 * 60; }
    game.setPlayer(this.diver);
    game.fxTarget.mask = 1; game.fx.mask = 1;
    game.ui.setScubaHud(true);
    game.ui.setReticle(true);
    audio.setEnvironment('underwater');
    // ---- events
    this.shark = new SharkDisplay(game, this.displayShark, {
      wallDir: V(0, 0, -1),
      wallDist: (p) => p.z - W.shape.faceZ(p.x, Math.min(p.y, -31.6)),
      onDisplay: () => { game.say('wall.shark.display', { interrupt: true }); this._objectives(); },
      onEscalate: (n) => game.say(n === 1 ? 'wall.shark.escalate' : 'wall.shark.escalate2', { interrupt: true }),
      onCalm: (clean) => { this.flags.sharkClean = clean; },
      onDone: (clean) => {
        game.say(clean ? 'wall.shark.done' : 'wall.shark.doneRough', { interrupt: true });
        game.save.stats.events.shark = clean ? 'calm' : 'close';
        this._objectives();
      },
    });
    this.freeflow = new FreeFlow(game, {
      onStep: (s) => { if (s === 'valve') game.say('wall.freeflow.valve', { interrupt: true }); this._objectives(); },
      onDone: () => {
        game.save.stats.events.freeflow = true;
        game.say('wall.freeflow.done', { interrupt: true });
        this.flags.ascend = true;
        game.ui.setMarker(this.lineBase, 'Ascent line');
        this._objectives();
      },
    });
    this.onDispose(() => this.freeflow.dispose());
    // the recorder on the mast
    const rec = W.wreck.recorder;
    this.recItem = game.interactions.add({
      object: rec, radius: 0.3, range: 2.4, mode: 'hold', hold: 1.2,
      prompt: 'Unclip the acoustic recorder',
      enabled: () => this.flags.atWreck && !this.flags.recorder,
      onUse: () => this._recorder(),
    });
    this.offs = [
      bus.on('diver:fastAscent', () => { if (!game.ui.radioBusy) game.say('diver.fastAscent'); }),
      bus.on('diver:lowAir', () => game.say('wall.lowGas')),
    ];
    this.onDispose(() => this.offs.forEach((f) => f()));
    this.flags = {};
    this.fanT = 0;
    game.after(1.5, () => game.say('wall.arrive'));
    game.ui.setMarker(P.wreck, 'Wreck');
    this._objectives();
  }

  _objectives() {
    const f = this.flags, list = [];
    list.push({ id: 'descend', text: 'Descend the wall to the wreck', sub: '(~50 m)', done: !!f.atWreck });
    if (this.shark.active || this.shark.done) list.push({ id: 'shark', text: this.shark.done ? 'The shark lost interest' : 'Stop, face the shark and back slowly to the wall', done: this.shark.done });
    if (f.atWreck) list.push({ id: 'recorder', text: 'Retrieve the acoustic recorder from the forward mast', done: !!f.recorder });
    if (this.freeflow.active || this.freeflow.done) {
      const steps = { grab: 'grab the yellow backup', purge: 'purge it', breathe: 'breathe from it', valve: 'close the left valve' };
      list.push({ id: 'freeflow', text: 'Free-flow: switch to your backup', sub: this.freeflow.step ? `— ${steps[this.freeflow.step]}` : '', done: this.freeflow.done });
    }
    if (f.ascend) list.push({ id: 'ascend', text: 'Begin your ascent: follow the line from the bow', done: false });
    this.game.ui.setObjectives('Deep Wall & Wreck · 30–60 m', list);
  }

  _recorder() {
    const game = this.game;
    this.flags.recorder = true;
    this.wall.wreck.recorder.visible = false;
    audio.play('thunk', { gain: 0.45 });
    game.ui.inspect(recorderSVG(), 'Passive acoustic recorder · retrieved from the wreck');
    game.ui.setMarker(null);
    this._objectives();
    game.say('wall.recorder', { interrupt: true }).then(() => game.say('wall.clue')).then(() => {
      game.ui.inspect(null);
      game.after(3, () => this._startFreeflow());
    });
    game.save.flags.recorder = true;
    game.persist();
  }

  _startFreeflow() {
    if (this.freeflow.active || this.freeflow.done) return;
    this.freeflow.start(this.diver);
    this.game.say('wall.freeflow.start', { interrupt: true });
    this._objectives();
  }

  update(dt) {
    super.update(dt);
    const game = this.game, d = this.diver, W = this.wall, ui = game.ui;
    this.creatures.setPlayer(d.pos, d.vel);
    this.creatures.update(dt);
    this.shark.update(dt);
    this.freeflow.update(dt);
    if (d.torchOn !== undefined && game.input.pressed('torch')) d.setTorch(!d.torchOn);
    game.fx.narcosis = d.narcosis;
    audio.setNarcosis(d.narcosis);
    const f = this.flags;
    if (!f.narc && d.depth > 33) { f.narc = true; game.say('wall.narcosis'); }
    // the big red fan: torch moment
    const dFan = d.pos.distanceTo(W.bigFan);
    if (!f.fan && dFan < 9) { f.fan = true; game.say('wall.fan'); }
    if (f.fan && !f.fanLit && d.torchOn && dFan < 7) {
      game.engine.camera.getWorldDirection(_c);
      _d.subVectors(W.bigFan, d.pos).normalize();
      if (_c.dot(_d) > 0.9) { this.fanT += dt; if (this.fanT > 1.2) { f.fanLit = true; game.say('wall.fanLit'); } }
    }
    // the grey reef shark comes in once the diver is out on the face below ~36 m
    if (!this.shark.active && !this.shark.done && !f.sharkSent && d.depth > 36 && (f.fan || d.depth > 40)) {
      f.sharkSent = true;
      game.after(3, () => { this.shark.start(d); game.say('wall.shark.start', { interrupt: true }); this._objectives(); });
    }
    // arriving at the wreck
    if (!f.atWreck && d.pos.distanceTo(W.poi.wreck) < 16) {
      f.atWreck = true;
      ui.setMarker(W.poi.recorder, 'Recorder');
      this._objectives();
      if (!this.shark.active) game.say('wall.wreck');
      else game.after(12, () => game.say('wall.wreck'));
    }
    // the shark must have come and gone before the free-flow; if the diver went straight to the wreck, it shows up there
    if (f.atWreck && !this.shark.active && !this.shark.done && !f.sharkSent) { f.sharkSent = true; this.shark.start(d); game.say('wall.shark.start', { interrupt: true }); this._objectives(); }
    // begin the ascent along the line
    if (f.ascend && !this.leaving) {
      _a.copy(d.pos);
      const near = this._distToLine(_a);
      if (near < 3.5 && d.depth < -this.lineBase.y - 2) {
        this.leaving = true;
        game.goToStage(3, { fadeTime: 1.2 });
      }
    }
  }

  _distToLine(p) {
    let best = Infinity;
    for (let i = 0; i <= 20; i++) best = Math.min(best, this.lineCurve.getPointAt(i / 20, _d).distanceTo(p));
    return best;
  }
}
