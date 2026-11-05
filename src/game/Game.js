import * as THREE from 'three';
import { Input } from '../core/Input.js';
import { settings } from '../core/Settings.js';
import { loadSave, writeSave, emptySave } from '../core/Save.js';
import { audio } from '../core/audio/AudioEngine.js';
import { bus } from '../core/Bus.js';
import { UI } from '../ui/UI.js';
import { Interactions } from './Interactions.js';
import { CollisionWorld } from '../world/Collision.js';
import { STAGES, STAGE_META } from './stages/index.js';
import { nextFrame } from './Stage.js';
import dialogue from '../data/dialogue.json';

/** Top-level game: owns systems, runs the loop, and moves between stages. */
export class Game {
  constructor(engine, params) {
    this.engine = engine;
    this.params = params;
    this.input = new Input(engine.renderer.domElement);
    this.ui = new UI(this);
    this.interactions = new Interactions(this);
    this.collision = new CollisionWorld();
    this.audio = audio;
    this.save = loadSave() || emptySave();
    this.stage = null;
    this.stageIndex = -1;
    this.player = null;
    this.state = 'boot';     // boot | title | loading | playing | paused | menu | ending
    this.modal = null;       // 'journal' | 'photo' | 'pause' | ...
    this.time = 0;
    this.last = performance.now();
    this.fx = { mask: 0, narcosis: 0, dim: 0, pulse: 0, redFlash: 0, fade: 0, fadeColor: new THREE.Color(0, 0, 0) };
    this.fxTarget = { mask: 0 };
    this.timers = [];
    this.updaters = new Set();
    this.dev = params.get('dev') === '1' || params.has('stage');
    window.__game = this;
    bus.on('pointerunlock', () => { if (this.state === 'playing' && !this.modal && !this.ignoreUnlock) this.pause(); });
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing') { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio.suspend(); else audio.resume();
    });
  }

  // ------------------------------------------------------------------ dialogue
  line(key) { return dialogue[key] || []; }
  say(key, opts = {}) {
    const lines = Array.isArray(key) ? key : this.line(key);
    if (!lines.length) { console.warn('[dialogue] missing key', key); return Promise.resolve(); }
    if (opts.interrupt) this.ui.clearRadio();
    return this.ui.say(lines);
  }

  // ------------------------------------------------------------------ timing helpers
  wait(seconds) { return new Promise((r) => this.timers.push({ t: seconds, fn: r, paused: true })); }
  after(seconds, fn) { this.timers.push({ t: seconds, fn, paused: true }); }
  addUpdater(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  // ------------------------------------------------------------------ stages
  /**
   * Load and enter a stage. transition: 'fade' (default) | 'cut' | 'custom' (stage handles visuals).
   */
  async goToStage(index, { transition = 'fade', fadeTime = 1.0, card = null, keepPlayer = false } = {}) {
    if (this.loadingStage) return;
    this.loadingStage = true;
    const prev = this.stage;
    if (transition === 'fade') { await this.ui.fade(true, fadeTime); }
    this.state = 'loading';
    this.ui.clearRadio();
    this.ui.prompt(null);
    this.ui.setMarker(null);
    this.ui.inspect(null);
    this.ui.setObjectives('', []);
    this.timers.length = 0;
    this.interactions.clear();
    if (card) this.ui.card(...card);
    if (prev) { prev.exit(); }
    if (this.player && !keepPlayer) { this.player.dispose?.(); this.player = null; }
    const mod = await STAGES[index]();
    const StageClass = mod.default;
    const st = new StageClass(this);
    await nextFrame();
    await st.build(nextFrame);
    if (prev) { prev.dispose(); }
    this.collision.clear();
    this.engine.scene.add(st.root);
    this.stage = st;
    this.stageIndex = index;
    st.enter();
    this.engine.update(0.016);
    await this.engine.warmup(this.engine.scene);
    if (STAGE_META[index].checkpoint) this.checkpoint(index);
    this.state = 'playing';
    this.loadingStage = false;
    if (transition === 'fade') this.ui.fade(false, fadeTime * 1.3);
    bus.emit('stage:enter', index);
    return st;
  }

  checkpoint(index) {
    this.save.stage = index;
    writeSave(this.save);
    if (index > 0) this.ui.toast('Checkpoint', STAGE_META[index].title, 3);
  }

  persist() { writeSave(this.save); }

  // ------------------------------------------------------------------ pause
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    bus.emit('pause', true);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.requestLock();
    bus.emit('pause', false);
  }

  setPlayer(p) { if (this.player && this.player !== p) this.player.dispose?.(); this.player = p; }

  // ------------------------------------------------------------------ loop
  frame(now) {
    requestAnimationFrame(this.frame);
    if (window.__freeze) { this.last = now; return; }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    if (this.params.get('fixed')) dt = 1 / 60;
    const input = this.input;
    input.update(dt);
    input.wantLock = this.state === 'playing' && !this.modal;
    const playing = this.state === 'playing' && !this.modal;
    if (playing) {
      if (input.pressed('pause')) this.pause();
      this.time += dt;
      this.save.stats.playTime += dt;
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.t -= dt;
        if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
      }
      this.player?.update(dt);
      this.interactions.update(dt);
      this.stage?.update(dt);
      for (const fn of this.updaters) fn(dt);
      if (this.player && this.player.depth !== undefined) this.save.stats.maxDepth = Math.max(this.save.stats.maxDepth, Math.round(this.player.depth));
    } else if (this.state === 'title' || this.state === 'loading') {
      this.stage?.update(dt);
    }
    if (this.modal === 'photo') this.photo?.update(dt);
    bus.emit('frame', dt);
    this.ui.update(dt);
    this._applyFx(dt);
    this.engine.update(this.state === 'paused' ? 0 : dt);
    audio.updateListener(this.engine.camera);
    this.engine.render(this.state === 'paused' ? 0 : dt);
    input.endFrame();
  }

  _applyFx(dt) {
    const fx = this.fx;
    const k = 1 - Math.exp(-dt * 4);
    fx.mask += (this.fxTarget.mask - fx.mask) * k;
    const post = this.engine.post;
    const w = post.water.uniforms, m = post.mask.uniforms, f = post.final.uniforms;
    w.get('uNarcosis').value = fx.narcosis * (settings.get('reducedMotion') ? 0.6 : 1);
    w.get('uDim').value = fx.dim;
    w.get('uPulse').value = fx.pulse;
    w.get('uRedFlash').value = fx.redFlash;
    m.get('uMask').value = fx.mask;
    f.get('uFade').value = fx.fade;
    f.get('uFadeColor').value.set(fx.fadeColor.r, fx.fadeColor.g, fx.fadeColor.b);
    post.reducedMotion = settings.get('reducedMotion');
    post.glassAmount = Math.max(fx.mask, this.fx.viewport || 0, this.engine.env.above ? 0 : 0.5);
  }

  /** Animate a post FX value (fade, dim...) over time. */
  tweenFx(key, to, dur = 1) {
    const from = this.fx[key];
    let t = 0;
    return new Promise((resolve) => {
      const off = this.addUpdaterAlways((dt) => {
        t += dt;
        const a = Math.min(1, t / dur);
        this.fx[key] = from + (to - from) * (a * a * (3 - 2 * a));
        if (a >= 1) { off(); resolve(); }
      });
    });
  }

  addUpdaterAlways(fn) {
    const off = bus.on('frame', fn);
    return off;
  }
}
