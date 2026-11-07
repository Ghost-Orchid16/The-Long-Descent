import '../styles/menus.css';
import { bus } from '../core/Bus.js';
import { audio } from '../core/audio/AudioEngine.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

/** Title, pause and loading screens. */
export class Menus {
  constructor(game) {
    this.game = game;
    this.loading = el('div', 'loading', document.body, '<div class="t">Into the Hadal</div><div class="bar"><i></i></div><div class="fact"></div>');
    this.title = el('div', 'menu', document.body);
    this.pauseEl = el('div', 'menu', document.body);
    bus.on('pause', (p) => this.showPause(p));
  }

  setLoading(p, fact) {
    this.loading.querySelector('i').style.width = Math.round(p * 100) + '%';
    if (fact !== undefined) this.loading.querySelector('.fact').textContent = fact;
  }
  hideLoading() { this.loading.classList.add('hide'); setTimeout(() => (this.loading.style.display = 'none'), 1000); }
  showLoadingScreen(fact) { this.loading.style.display = ''; this.loading.classList.remove('hide'); this.setLoading(0.1, fact); }

  showTitle({ canContinue, mobile }) {
    this.title.innerHTML = `<div class="inner">
      <div class="k">A descent into the Mariana Trench</div>
      <h1>Into the Hadal</h1>
      <div class="tag">From a Guam coral reef to the deepest place on Earth.</div>
      <div class="btns">
        <button data-a="new">New dive</button>
        <button data-a="continue" ${canContinue ? '' : 'disabled'}>Continue</button>
      </div>
      ${mobile ? '<div class="note">Best on desktop with a keyboard and mouse. Touch controls are not supported.</div>' : ''}
    </div>
    <div class="foot">WASD swim · Mouse look · Space / C ascend / descend · E interact · F torch · J journal · P photo · Esc pause</div>`;
    this.title.classList.add('show');
    return new Promise((resolve) => {
      this.title.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        audio.init();
        audio.play('click', { bus: 'ui', gain: 0.4 });
        this.title.classList.remove('show');
        resolve(b.dataset.a);
      }));
    });
  }

  showPause(on) {
    if (!on) { this.pauseEl.classList.remove('show'); return; }
    this.pauseEl.innerHTML = `<div class="inner"><div class="k">Paused</div><h1 style="font-size:40px">${this.game.stage ? '' : ''}Holding position</h1>
      <div class="btns" style="margin-top:30px"><button data-a="resume">Resume</button><button data-a="quit">Save and quit to title</button></div></div>`;
    this.pauseEl.classList.add('show');
    this.pauseEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      audio.play('click', { bus: 'ui', gain: 0.4 });
      if (b.dataset.a === 'resume') this.game.resume();
      else { this.game.persist(); location.reload(); }
    }));
  }
}
