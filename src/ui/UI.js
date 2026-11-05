import * as THREE from 'three';
import '../styles/ui.css';
import { settings } from '../core/Settings.js';
import { bus } from '../core/Bus.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const _v = new THREE.Vector3();

/** In-game overlay: reticle, prompts, radio, objectives, toasts, HUDs, markers, fades. */
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.layer = el('div', 'hud-layer', this.root);
    this.reticle = el('div', 'reticle', this.layer);
    this.promptEl = el('div', 'prompt', this.layer);
    this.promptText = el('span', '', this.promptEl);
    this.promptRing = el('span', '', this.promptEl, '<svg class="ring" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke-dasharray="37.7" stroke-dashoffset="37.7"/></svg>');
    this.promptRing.style.display = 'none';
    this.objEl = el('div', 'objectives', this.layer);
    this.toastsEl = el('div', 'toasts', this.layer);
    this.radioEl = el('div', 'radio', this.layer);
    this.markerEl = el('div', 'wmarker hidden', this.layer);
    this.transitEl = el('div', 'transit', this.layer, '<div class="z"></div><div class="d tabnum"></div>');
    this.inspectEl = el('div', 'inspect', this.layer);

    // scuba HUD
    this.scuba = el('div', 'hud-layer hidden', this.layer);
    this.wrist = el('div', 'wrist', this.scuba, `
      <div class="row"><div><div class="lbl">Depth</div><div class="big tabnum" data-k="depth">0.0<small>m</small></div></div>
        <div class="asc" data-k="asc">${'<i></i>'.repeat(6)}</div></div>
      <div class="sep"></div>
      <div class="row"><div><div class="lbl">Dive time</div><div class="med tabnum" data-k="time">0'</div></div>
        <div style="text-align:right"><div class="lbl" data-k="ndlLbl">NDL</div><div class="med tabnum" data-k="ndl">--</div></div></div>
      <div class="sep"></div>
      <div class="row"><div><div class="lbl">Temp</div><div class="med tabnum" data-k="temp">--</div></div>
        <div style="text-align:right"><div class="lbl">Ascent</div><div class="med tabnum" data-k="rate">0</div></div></div>`);
    this.air = el('div', 'air', this.scuba, '<div class="t"><span class="smallcaps">Air</span><span class="tabnum" data-k="bar">200 bar</span></div><div class="bar"><div class="fill" style="width:100%"></div></div>');
    this.compass = el('div', 'compass', this.scuba, '<div class="strip"></div><div class="center"></div>');
    this._buildCompass();
    this.wk = {};
    this.wrist.querySelectorAll('[data-k]').forEach((n) => (this.wk[n.dataset.k] = n));
    this.airFill = this.air.querySelector('.fill');
    this.airText = this.air.querySelector('[data-k=bar]');
    this.ascBars = [...this.wrist.querySelectorAll('.asc i')];

    this.fadeEl = el('div', 'fade', this.root);
    this.cardEl = el('div', 'card-title', this.root);

    this.radioQueue = [];
    this.radioCur = null;
    this.radioT = 0;
    this.hudT = 0;
    this.marker = null;
    this.visible = true;
  }

  // ----- visibility -----
  setVisible(v) { this.visible = v; this.layer.classList.toggle('hidden', !v); }
  setScubaHud(v) { this.scuba.classList.toggle('hidden', !v); }
  setReticle(v) { this.reticle.classList.toggle('hidden', !v); }

  // ----- prompt -----
  prompt(text, progress = null) {
    if (!text) { this.promptEl.classList.remove('show'); this.reticle.classList.remove('target'); return; }
    if (this.promptText.textContent !== text) this.promptText.textContent = text;
    this.promptEl.classList.add('show');
    this.reticle.classList.add('target');
    if (progress !== null) {
      this.promptRing.style.display = '';
      this.promptRing.querySelector('circle').setAttribute('stroke-dashoffset', String(37.7 * (1 - Math.min(1, progress))));
    } else this.promptRing.style.display = 'none';
  }

  // ----- objectives -----
  setObjectives(title, list) {
    this.objectives = list;
    this.objTitle = title;
    this.renderObjectives();
  }
  renderObjectives() {
    const list = this.objectives || [];
    this.objEl.innerHTML = (this.objTitle ? `<div class="stage">${this.objTitle}</div>` : '') +
      list.map((o) => `<div class="obj ${o.done ? 'done' : ''}">${o.text}${o.sub ? `<span class="sub">${o.sub}</span>` : ''}</div>`).join('');
  }
  completeObjective(id) {
    const o = (this.objectives || []).find((x) => x.id === id);
    if (o && !o.done) { o.done = true; this.renderObjectives(); bus.emit('objective', id); }
  }
  setObjectiveSub(id, sub) {
    const o = (this.objectives || []).find((x) => x.id === id);
    if (o && o.sub !== sub) { o.sub = sub; this.renderObjectives(); }
  }

  // ----- toasts -----
  toast(kicker, text, dur = 4) {
    const t = el('div', 'toast', this.toastsEl, `<span class="k">${kicker}</span>${text}`);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 600); }, dur * 1000);
  }

  // ----- radio -----
  /** Queue radio lines. Returns a promise resolved when these lines have finished. */
  say(lines) {
    if (!lines || !lines.length) return Promise.resolve();
    return new Promise((resolve) => {
      lines.forEach((l, i) => this.radioQueue.push({ ...l, resolve: i === lines.length - 1 ? resolve : null }));
    });
  }
  clearRadio() {
    for (const l of this.radioQueue) l.resolve?.();
    this.radioQueue.length = 0;
    if (this.radioCur) { this.radioCur.resolve?.(); this.radioCur = null; }
    this.radioEl.classList.remove('show');
  }
  get radioBusy() { return !!this.radioCur || this.radioQueue.length > 0; }

  _updateRadio(dt) {
    if (!this.radioCur && this.radioQueue.length) {
      this.radioCur = this.radioQueue.shift();
      const l = this.radioCur;
      const words = l.text.split(/\s+/).length;
      l.dur = l.dur || Math.min(8, Math.max(2.6, 1.0 + words * 0.32));
      l.shown = 0;
      this.radioT = 0;
      this.radioEl.innerHTML = `<span class="who">${l.speaker}</span><span class="txt"></span><span class="skip">Enter to skip</span>`;
      this.radioTxt = this.radioEl.querySelector('.txt');
      this.radioEl.classList.add('show');
      bus.emit('radio:start', l);
    }
    const l = this.radioCur;
    if (!l) return;
    this.radioT += dt;
    const chars = Math.min(l.text.length, Math.floor(this.radioT * 55));
    if (chars !== l.shown) { l.shown = chars; this.radioTxt.textContent = l.text.slice(0, chars); }
    const skip = this.game.input.pressed('skip');
    if (skip && chars < l.text.length) { this.radioT = l.text.length / 55; return; }
    if (this.radioT > l.dur + l.text.length / 55 || (skip && chars >= l.text.length)) {
      bus.emit('radio:end', l);
      l.resolve?.();
      this.radioCur = null;
      if (!this.radioQueue.length) this.radioEl.classList.remove('show');
    }
  }

  // ----- scuba HUD -----
  updateScuba(d) {
    this.wk.depth.innerHTML = `${d.depth.toFixed(1)}<small>m</small>`;
    const mins = Math.floor(d.diveTime / 60);
    this.wk.time.textContent = `${mins}'`;
    if (d.decoStop > 0) {
      this.wk.ndlLbl.textContent = 'Deco stop';
      this.wk.ndl.innerHTML = `<span class="deco">${d.decoStop} m ${Math.ceil(d.decoTime / 60)}'</span>`;
    } else {
      this.wk.ndlLbl.textContent = 'NDL';
      this.wk.ndl.textContent = d.ndl >= 99 ? '99+' : `${Math.max(0, Math.floor(d.ndl))}'`;
    }
    this.wk.temp.textContent = `${d.temp.toFixed(0)}°C`;
    const rate = Math.max(0, d.ascentRate);
    this.wk.rate.innerHTML = rate > 9.5 ? `<span class="alarm">SLOW ${rate.toFixed(0)}</span>` : `${rate.toFixed(0)} m/min`;
    const lit = Math.min(6, Math.ceil(rate / 3));
    this.ascBars.forEach((b, i) => {
      b.className = i < lit ? 'on' + (i >= 4 ? ' a' : i >= 3 ? ' w' : '') : '';
    });
    const frac = Math.max(0, d.air / d.airMax);
    this.airFill.style.width = (frac * 100).toFixed(1) + '%';
    this.airFill.className = 'fill' + (d.air < 50 ? ' crit' : d.air < 80 ? ' low' : '');
    this.airText.textContent = `${Math.max(0, Math.round(d.air))} bar`;
  }

  _buildCompass() {
    const strip = this.compass.querySelector('.strip');
    const pxPerDeg = 2.4;
    this.compassPx = pxPerDeg;
    let html = '';
    for (let a = -360; a <= 720; a += 15) {
      const x = (a + 360) * pxPerDeg;
      const n = ((a % 360) + 360) % 360;
      const major = n % 45 === 0;
      html += `<div class="tick ${major ? 'major' : ''}" style="left:${x}px"></div>`;
      if (n % 90 === 0) html += `<div class="card" style="left:${x}px">${['N', 'E', 'S', 'W'][n / 90]}</div>`;
      else if (n % 45 === 0) html += `<div class="card" style="left:${x}px;opacity:.55;font-size:9px">${n}</div>`;
    }
    strip.innerHTML = html;
    this.compassStrip = strip;
  }

  /** heading in degrees (0 = north = -Z). */
  updateCompass(heading) {
    const x = -(heading + 360) * this.compassPx + 190;
    this.compassStrip.style.transform = `translateX(${x.toFixed(1)}px)`;
  }

  // ----- world marker for the active objective -----
  setMarker(pos, label = '') { this.marker = pos ? { pos, label } : null; if (!pos) this.markerEl.classList.add('hidden'); }
  _updateMarker() {
    if (!this.marker || !settings.get('markers')) { this.markerEl.classList.add('hidden'); return; }
    const cam = this.game.engine.camera;
    const p = typeof this.marker.pos === 'function' ? this.marker.pos() : this.marker.pos;
    _v.copy(p).project(cam);
    const behind = _v.z > 1;
    if (behind) { this.markerEl.classList.add('hidden'); return; }
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth, y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    const cx = Math.min(window.innerWidth - 40, Math.max(40, x)), cy = Math.min(window.innerHeight - 60, Math.max(60, y));
    this.markerEl.style.left = cx + 'px'; this.markerEl.style.top = cy + 'px';
    const dist = cam.position.distanceTo(p);
    this.markerEl.textContent = '';
    this.markerEl.append(`${this.marker.label ? this.marker.label + ' · ' : ''}${dist.toFixed(0)} m`);
    this.markerEl.classList.toggle('hidden', dist < 3);
  }

  // ----- fades & title cards -----
  fade(on, dur = 1) {
    this.fadeEl.style.transitionDuration = dur + 's';
    this.fadeEl.classList.toggle('on', on);
    return new Promise((r) => setTimeout(r, dur * 1000));
  }
  card(l1, l2, l3 = '', dur = 4) {
    this.cardEl.innerHTML = `<div class="l1">${l1}</div><div class="l2">${l2}</div>${l3 ? `<div class="l3">${l3}</div>` : ''}`;
    this.cardEl.classList.add('show');
    return new Promise((r) => setTimeout(() => { this.cardEl.classList.remove('show'); setTimeout(r, 1400); }, dur * 1000));
  }

  transit(show, zone = '', depth = 0) {
    this.transitEl.classList.toggle('show', show);
    if (show) {
      this.transitEl.querySelector('.z').textContent = zone;
      this.transitEl.querySelector('.d').innerHTML = `${Math.round(depth).toLocaleString('en-US')}<small>m</small>`;
    }
  }

  inspect(svg, caption) {
    if (!svg) { this.inspectEl.classList.remove('show'); return; }
    this.inspectEl.innerHTML = svg + (caption ? `<div class="cap">${caption}</div>` : '');
    this.inspectEl.classList.add('show');
  }

  update(dt) {
    this._updateRadio(dt);
    this._updateMarker();
  }
}
