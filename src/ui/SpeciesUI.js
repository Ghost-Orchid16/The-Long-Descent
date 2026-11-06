import '../styles/journal.css';
import { SPECIES_LIST, ZONE_ORDER, ZONE_NAMES } from '../creatures/factory.js';
import { silhouette } from './silhouette.js';
import { audio } from '../core/audio/AudioEngine.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function fmtDepth(a, b) {
  const f = (v) => v.toLocaleString('en-US');
  return `${f(a)}–${f(b)} m`;
}
export function fmtSize(cm) {
  if (cm >= 100) return `to ${(cm / 100).toFixed(cm % 100 === 0 ? 0 : 1)} m`;
  return `to ${cm} cm`;
}
export function iucnClass(s) {
  const t = s.toLowerCase();
  if (t.startsWith('critically')) return 'cr';
  if (t.startsWith('endangered')) return 'en';
  if (t.startsWith('vulnerable')) return 'vu';
  if (t.startsWith('near')) return 'nt';
  if (t.startsWith('least')) return 'lc';
  return 'na';
}

function detailHTML(sp, { photo = null, kicker = '' } = {}) {
  const img = photo ? `<img class="ph" src="${photo}" alt="">` : `<img class="sil" src="${silhouette(sp.id)}" alt="">`;
  return `
    ${kicker ? `<div class="kick">${kicker}</div>` : ''}
    <div class="pic">${img}</div>
    <div class="nm">${esc(sp.commonName)}</div>
    <div class="sci">${esc(sp.scientificName)}</div>
    <dl>
      <dt>Zone</dt><dd>${ZONE_NAMES[sp.zone]}</dd>
      <dt>Depth</dt><dd class="tabnum">${fmtDepth(sp.depthMin, sp.depthMax)}</dd>
      <dt>Size</dt><dd class="tabnum">${fmtSize(sp.sizeCm)}</dd>
      <dt>Diet</dt><dd>${esc(sp.diet)}</dd>
      <dt>IUCN</dt><dd><span class="iucn ${iucnClass(sp.iucn)}">${esc(sp.iucn)}</span></dd>
      <dt>Range</dt><dd>${esc(sp.range)}</dd>
    </dl>
    <p class="fact">${esc(sp.fact)}</p>`;
}

/** Lower third (identification under the reticle) and the species card shown after a scan. */
export class SpeciesUI {
  constructor(ui) {
    this.ui = ui;
    this.lt = el('div', 'lower3', ui.layer);
    this.card = el('div', 'spcard', ui.layer);
    this.cardOpen = false;
    this.cardT = 0;
  }

  lowerThird(sp, logged = false) {
    if (!sp) { this.lt.classList.remove('show'); this.ltId = null; return; }
    if (this.ltId === sp.id + logged) return;
    this.ltId = sp.id + logged;
    this.lt.innerHTML = `<div class="nm">${esc(sp.commonName)}</div><div class="sci">${esc(sp.scientificName)}</div>
      <div class="act">${logged ? '<span class="ok">Logged</span> · <b>E</b> view card' : '<b>E</b> scan'}</div>`;
    this.lt.classList.add('show');
  }

  openCard(sp, { fresh = false, count = 0, total = 0, photo = null } = {}) {
    this.card.innerHTML = detailHTML(sp, { photo, kicker: fresh ? `New species logged · ${count} / ${total}` : 'Field journal' }) +
      '<div class="hint"><b>E</b> close · <b>J</b> journal</div>';
    this.card.classList.add('show');
    this.cardOpen = true;
    this.cardT = 0;
    this.lowerThird(null);
  }

  closeCard() {
    this.card.classList.remove('show');
    this.cardOpen = false;
  }

  update(dt) {
    if (this.cardOpen) { this.cardT += dt; if (this.cardT > 16) this.closeCard(); }
  }
}

/** Full-screen field journal (J): every species by zone, silhouettes until discovered. */
export class Journal {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'journal interactive', document.getElementById('ui'));
    this.open = false;
    this.root.addEventListener('click', (e) => {
      const c = e.target.closest('[data-id]');
      if (c) { this.detail(c.dataset.id); return; }
      if (e.target.closest('[data-back]')) { this.renderGrid(); return; }
      if (e.target.closest('[data-close]')) this.hide();
    });
  }

  toggle() { if (this.open) this.hide(); else this.show(); }

  show() {
    const g = this.game;
    if (g.state !== 'playing' || (g.modal && g.modal !== 'journal')) return;
    g.modal = 'journal';
    g.input.exitLock();
    this.open = true;
    this.renderGrid();
    this.root.classList.add('show');
    audio.play('click', { gain: 0.4, bus: 'ui' });
  }

  hide() {
    const g = this.game;
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('show');
    if (g.modal === 'journal') g.modal = null;
    g.input.requestLock();
  }

  renderGrid() {
    const save = this.game.save;
    const logged = (id) => { const j = save.journal[id]; return j && (j.scanned || j.photographed); };
    const n = SPECIES_LIST.filter((s) => logged(s.id)).length;
    const photos = Object.keys(save.photos || {}).length;
    let html = `<div class="jhead"><div><div class="kick">Expedition Tåsi · Field journal</div><h1>Species logged <span class="tabnum">${n} / ${SPECIES_LIST.length}</span></h1></div>
      <div class="jstats tabnum">${photos} photographed · deepest ${save.stats.maxDepth.toLocaleString('en-US')} m<button data-close class="x">Close · J</button></div></div><div class="jbody">`;
    for (const z of ZONE_ORDER) {
      const list = SPECIES_LIST.filter((s) => s.zone === z);
      const zn = list.filter((s) => logged(s.id)).length;
      html += `<section><h2>${ZONE_NAMES[z]} <span class="tabnum">${zn} / ${list.length}</span></h2><div class="grid">`;
      for (const s of list) {
        const ok = logged(s.id);
        const ph = save.photos?.[s.id];
        html += ok
          ? `<button class="cell ok" data-id="${s.id}">${ph ? `<img class="ph" src="${ph}" alt="">` : `<img class="sil" src="${silhouette(s.id)}" alt="">`}<span class="nm">${esc(s.commonName)}</span></button>`
          : `<div class="cell"><img class="sil dim" src="${silhouette(s.id, { fill: '#1d3440' })}" alt=""><span class="nm unk">Not yet observed</span></div>`;
      }
      html += '</div></section>';
    }
    html += '</div>';
    this.root.innerHTML = html;
  }

  detail(id) {
    const sp = SPECIES_LIST.find((s) => s.id === id);
    if (!sp) return;
    const j = this.game.save.journal[id] || {};
    const how = [j.scanned ? 'scanned' : '', j.photographed ? 'photographed' : ''].filter(Boolean).join(' & ');
    this.root.innerHTML = `<div class="jdetail"><div class="spcard show big">${detailHTML(sp, { photo: this.game.save.photos?.[id], kicker: `Observed${j.depth ? ` at ${j.depth} m` : ''}${how ? ' · ' + how : ''}` })}
      <div class="hint"><button data-back>← All species</button> <button data-close>Close · J</button></div></div></div>`;
  }
}
