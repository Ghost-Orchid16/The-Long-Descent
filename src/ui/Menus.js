import '../styles/menus.css';
import { bus } from '../core/Bus.js';
import { audio } from '../core/audio/AudioEngine.js';
import { settings } from '../core/Settings.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

/** Title, pause and loading screens. */
export class Menus {
  constructor(game) {
    this.game = game;
    this.loading = el('div', 'loading', document.body, '<div class="t">Into the Hadal</div><div class="z"></div><div class="bar"><i></i></div><div class="fact"></div>');
    this.title = el('div', 'menu', document.body);
    this.pauseEl = el('div', 'menu', document.body);
    bus.on('pause', (p) => this.showPause(p));
  }

  setLoading(p, fact) {
    this.loading.querySelector('i').style.width = Math.round(p * 100) + '%';
    if (fact !== undefined) this.loading.querySelector('.fact').textContent = fact;
  }
  hideLoading() { clearInterval(this.loadTick); this.loading.classList.add('hide'); setTimeout(() => { if (this.loading.classList.contains('hide')) this.loading.style.display = 'none'; }, 1000); }
  showLoadingScreen(fact, meta = null) {
    this.loading.style.display = ''; this.loading.classList.remove('hide');
    this.loading.querySelector('.t').textContent = meta ? meta.title : 'Into the Hadal';
    this.loading.querySelector('.z').textContent = meta ? meta.zone : '';
    this.setLoading(0.15, fact);
    let p = 0.15;
    clearInterval(this.loadTick);
    this.loadTick = setInterval(() => { p = Math.min(0.92, p + (0.95 - p) * 0.08); this.setLoading(p); }, 120);
  }

  showTitle({ canContinue, mobile }) {
    this.title.innerHTML = `<div class="inner">
      <div class="k">A descent into the Mariana Trench</div>
      <h1>Into the Hadal</h1>
      <div class="tag">From a Guam coral reef to the deepest place on Earth.</div>
      <div class="btns">
        <button data-a="new">New dive</button>
        <button data-a="continue" ${canContinue ? '' : 'disabled'}>Continue</button>
        <button data-a="settings">Settings</button>
      </div>
      ${mobile ? '<div class="note">Best on desktop with a keyboard and mouse. Touch controls are not supported.</div>' : ''}
    </div>
    <div class="foot">WASD swim · Mouse look · Space / C ascend / descend · E interact · F torch · J journal · P photo · Esc pause</div>`;
    this.title.classList.add('show');
    return new Promise((resolve) => {
      this.title.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        audio.init();
        audio.play('click', { bus: 'ui', gain: 0.4 });
        if (b.dataset.a === 'settings') { this.title.classList.remove('show'); this.showSettings(() => this.title.classList.add('show')); return; }
        this.title.classList.remove('show');
        resolve(b.dataset.a);
      }));
    });
  }

  /** Settings: graphics, controls, audio, accessibility. Changes apply immediately where possible. */
  showSettings(onBack) {
    const S = settings;
    if (!this.settingsEl) this.settingsEl = el('div', 'menu settings', document.body);
    const row = (label, ctrl) => `<label class="row"><span>${label}</span>${ctrl}</label>`;
    const range = (k, min, max, step, fmt) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${S.get(k)}"><b data-v="${k}">${fmt(S.get(k))}</b>`;
    const toggle = (k) => `<input type="checkbox" data-k="${k}" ${S.get(k) ? 'checked' : ''}>`;
    const fmts = { resolutionScale: (v) => Math.round(v * 100) + '%', sensitivity: (v) => Number(v).toFixed(2) + '×', fov: (v) => v + '°', masterVolume: (v) => Math.round(v * 100) + '%', musicVolume: (v) => Math.round(v * 100) + '%', sfxVolume: (v) => Math.round(v * 100) + '%' };
    const q = S.get('quality');
    this.settingsEl.innerHTML = `<div class="inner wide"><div class="k">Settings</div>
      <div class="grid">
        <div><h3>Graphics</h3>
          ${row('Quality', `<select data-k="quality">${['auto', 'low', 'medium', 'high'].map((o) => `<option value="${o}" ${o === q ? 'selected' : ''}>${o === 'auto' ? `Auto (${S.get('resolvedQuality') || 'medium'})` : o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select>`)}
          ${row('Resolution scale', range('resolutionScale', 0.5, 1, 0.05, fmts.resolutionScale))}
          ${row('Field of view', range('fov', 60, 90, 1, fmts.fov))}
          <p class="hint">Quality changes to detail and effects take effect at the next area.</p>
          <h3>Controls</h3>
          ${row('Mouse sensitivity', range('sensitivity', 0.3, 2.5, 0.05, fmts.sensitivity))}
          ${row('Invert Y', toggle('invertY'))}
        </div>
        <div><h3>Audio</h3>
          ${row('Master volume', range('masterVolume', 0, 1, 0.05, fmts.masterVolume))}
          ${row('Music', range('musicVolume', 0, 1, 0.05, fmts.musicVolume))}
          ${row('Sound effects', range('sfxVolume', 0, 1, 0.05, fmts.sfxVolume))}
          <h3>Accessibility</h3>
          ${row('Subtitles', toggle('subtitles'))}
          ${row('Reduced motion', toggle('reducedMotion'))}
          ${row('Objective markers', toggle('markers'))}
        </div>
      </div>
      <div class="btns row2"><button data-a="back">Back</button><button data-a="reset">Reset to defaults</button></div></div>`;
    this.settingsEl.classList.add('show');
    const apply = (k, v) => {
      S.set(k, v);
      const eng = this.game?.engine;
      if (eng) {
        if (k === 'resolutionScale') eng.setResolutionScale(v);
        if (k === 'fov') eng.setFov(v);
        if (k === 'quality') eng.setQuality(S.quality());
      }
      const vEl = this.settingsEl.querySelector(`[data-v="${k}"]`);
      if (vEl && fmts[k]) vEl.textContent = fmts[k](v);
    };
    this.settingsEl.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value;
        apply(k, v);
      });
    });
    this.settingsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      audio.play('click', { bus: 'ui', gain: 0.4 });
      if (b.dataset.a === 'reset') { S.reset(); const eng = this.game?.engine; if (eng) { eng.setResolutionScale(S.get('resolutionScale')); eng.setFov(S.get('fov')); eng.setQuality(S.quality()); } this.showSettings(onBack); return; }
      this.settingsEl.classList.remove('show');
      onBack?.();
    }));
  }

  showPause(on) {
    if (!on) { this.pauseEl.classList.remove('show'); return; }
    this.pauseEl.innerHTML = `<div class="inner"><div class="k">Paused</div><h1 style="font-size:40px">${this.game.stage ? '' : ''}Holding position</h1>
      <div class="btns" style="margin-top:30px"><button data-a="resume">Resume</button><button data-a="settings">Settings</button><button data-a="quit">Save and quit to title</button></div></div>`;
    this.pauseEl.classList.add('show');
    this.pauseEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      audio.play('click', { bus: 'ui', gain: 0.4 });
      if (b.dataset.a === 'resume') this.game.resume();
      else if (b.dataset.a === 'settings') { this.pauseEl.classList.remove('show'); this.showSettings(() => this.pauseEl.classList.add('show')); }
      else { this.game.persist(); location.href = location.pathname; }
    }));
  }
}
