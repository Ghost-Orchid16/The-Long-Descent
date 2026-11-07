import '../styles/menus.css';
import { SPECIES_LIST } from '../creatures/factory.js';
import { audio } from '../core/audio/AudioEngine.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

const EVENTS = [
  ['ghostNet', 'Cut free of a ghost net'], ['shark', 'Grey reef shark display'], ['freeflow', 'Regulator free-flow'],
  ['surfaceInterval', 'Surface interval'], ['chamber', 'Chamber pressure fault'], ['co2', 'CO₂ scrubber swap'],
  ['power', 'Power failure'], ['plume', 'Sediment plume'], ['cable', 'Cable entanglement'], ['dropWeights', 'Drop-weight release'],
];

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Summary screen and scrolling credits at the end of the expedition. */
export class Ending {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'ending interactive', document.body);
  }

  showSummary() {
    const save = this.game.save;
    const found = SPECIES_LIST.filter((s) => { const j = save.journal[s.id]; return j && (j.scanned || j.photographed); }).length;
    const ev = save.stats.events || {};
    const handled = EVENTS.filter(([k]) => ev[k]);
    this.root.innerHTML = `<div class="panel">
      <div class="k">Expedition Tåsi · complete</div>
      <h1>Into the Hadal</h1>
      <div class="stats tabnum">
        <div><b>${(save.stats.maxDepth || 0).toLocaleString('en-US')} m</b><span>maximum depth</span></div>
        <div><b>${found} / ${SPECIES_LIST.length}</b><span>species found</span></div>
        <div><b>${save.stats.photos || 0}</b><span>photos taken</span></div>
        <div><b>${handled.length} / ${EVENTS.length}</b><span>events handled</span></div>
        <div><b>${fmtTime(save.stats.playTime || 0)}</b><span>time played</span></div>
      </div>
      <ul class="ev">${EVENTS.map(([k, label]) => `<li class="${ev[k] ? 'ok' : ''}">${label}</li>`).join('')}</ul>
      <div class="btns"><button data-a="credits">Credits</button><button data-a="title">Return to title</button></div>
    </div>`;
    this.root.classList.add('show');
    this._wire();
  }

  showCredits() {
    this.root.innerHTML = `<div class="credits"><div class="roll">
      <h1>Into the Hadal</h1>
      <p class="k">A descent from a Guam coral reef to the floor of the Challenger Deep</p>
      <h2>Made with</h2><p>three.js · postprocessing · Vite · the Inter typeface (SIL Open Font License)</p>
      <h2>Art and sound</h2><p>Every model, texture, particle and sound in this game is generated procedurally in your browser.<br>No AI-generated images or textures were used.</p>
      <h2>The science</h2><p>Species facts were checked against published sources and IUCN Red List assessments, and kept deliberately conservative.<br>The liquid-CO₂ seep is modelled on the "Champagne" vent of the NW Eifuku volcano in the Mariana arc.<br>The plastic bag on the trench floor reflects real reports of plastic debris at about 10,900 m in the Mariana Trench.</p>
      <h2>Characters and places</h2><p>R/V Tåsi, ECHO-7, the freighter and the expedition are fictional.</p>
      <p class="k" style="margin-top:60px">Thank you for diving.</p>
    </div><div class="btns fixed"><button data-a="title">Return to title</button></div></div>`;
    this.root.classList.add('show');
    this._wire();
  }

  _wire() {
    this.root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      audio.play('click', { bus: 'ui', gain: 0.4 });
      if (b.dataset.a === 'credits') this.showCredits();
      else { this.game.persist(); location.href = location.pathname; }
    }));
  }
}
