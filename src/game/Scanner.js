import * as THREE from 'three';
import { SPECIES, SPECIES_LIST } from '../creatures/factory.js';
import { audio } from '../core/audio/AudioEngine.js';
import { bus } from '../core/Bus.js';

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _o = new THREE.Vector3();
const LOCK_TIME = 0.3;
const SCAN_TIME = 0.85;

/**
 * Field scanner: hold the reticle on an organism for ~0.3 s to identify it (lower third),
 * press E to scan it into the journal (sweep, chime, species card on first scan).
 * Sources: fn(cb) calling cb(id, position, radius, ref) for each candidate.
 */
export class Scanner {
  constructor(game) {
    this.game = game;
    this.sources = new Set();
    this.enabled = false;
    this.range = 14;
    this.candRef = null; this.candId = null; this.lockT = 0;
    this.locked = null;
    this.scan = null; // { id, ref, t }
    this.total = SPECIES_LIST.length;
  }

  addSource(fn) { this.sources.add(fn); return () => this.sources.delete(fn); }
  clear() { this.sources.clear(); this._drop(); }

  /** Count of species scanned so far. */
  get count() { return Object.values(this.game.save.journal).filter((j) => j.scanned || j.photographed).length; }

  isLogged(id) { const j = this.game.save.journal[id]; return !!(j && (j.scanned || j.photographed)); }

  _drop() {
    this.candRef = null; this.candId = null; this.lockT = 0; this.locked = null; this.scan = null;
    this.game.ui.species.lowerThird(null);
  }

  /** Best candidate under the reticle: {id, ref, pos, dist} or null. */
  pick(range = this.range, looseRef = null) {
    const cam = this.game.engine.camera;
    cam.getWorldPosition(_c);
    cam.getWorldDirection(_d);
    let best = null, bestScore = Infinity;
    const consider = (id, pos, r, ref) => {
      _o.subVectors(pos, _c);
      const dist = _o.length();
      if (dist > range + r || dist < 0.05) return;
      const along = _o.dot(_d);
      if (along <= 0) return;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      const tol = (r + dist * 0.03) * (ref === looseRef ? 2.2 : 1);
      if (perp > tol) return;
      const score = perp / tol + dist * 0.03;
      if (score < bestScore) { bestScore = score; best = { id, ref, pos: pos.clone(), dist }; }
    };
    for (const src of this.sources) src(consider);
    if (best && this.game.collision.segmentHitsGround(_c, best.pos, 12)) return null;
    return best;
  }

  update(dt) {
    const game = this.game, ui = game.ui.species;
    if (!this.enabled || game.modal || game.interactions.focus || (game.player && game.player.locked)) { if (this.candRef || this.scan) this._drop(); return; }
    const input = game.input;
    // card open: E closes it
    if (ui.cardOpen && input.pressed('interact') && !this.scan) { ui.closeCard(); return; }
    const best = this.pick(this.range, this.scan ? this.scan.ref : this.candRef);
    if (this.scan) {
      if (!best || best.ref !== this.scan.ref) {
        this.scan.lost = (this.scan.lost || 0) + dt;
        if (this.scan.lost > 0.35) { this.scan = null; game.ui.prompt(null); audio.play('scanFail', { gain: 0.4, bus: 'ui' }); return; }
      } else this.scan.lost = 0;
      this.scan.t += dt;
      game.ui.prompt('Scanning…', this.scan.t / SCAN_TIME);
      if (this.scan.t >= SCAN_TIME) { const id = this.scan.id; this.scan = null; game.ui.prompt(null); this.log(id, 'scan'); }
      return;
    }
    if (!best) { if (this.candRef) this._drop(); return; }
    if (best.ref !== this.candRef) { this.candRef = best.ref; this.candId = best.id; this.lockT = 0; this.locked = null; ui.lowerThird(null); }
    this.lockT += dt;
    if (this.lockT >= LOCK_TIME && !this.locked) {
      this.locked = best;
      ui.lowerThird(SPECIES[best.id], this.isLogged(best.id));
      audio.play('lock', { gain: 0.25, bus: 'ui' });
    }
    if (this.locked && input.pressed('interact')) {
      if (this.isLogged(best.id)) ui.openCard(SPECIES[best.id], { fresh: false, count: this.count, total: this.total, photo: game.save.photos[best.id] });
      else { this.scan = { id: best.id, ref: best.ref, t: 0 }; audio.play('scan', { gain: 0.5, bus: 'ui' }); }
    }
  }

  /** Record a species (via 'scan' or 'photo'). Returns true when it is new. */
  log(id, via = 'scan') {
    const game = this.game;
    const sp = SPECIES[id];
    if (!sp) return false;
    const j = game.save.journal[id] || (game.save.journal[id] = { scanned: false, photographed: false, stage: game.stageIndex, depth: 0, t: Date.now() });
    const fresh = !j.scanned && !j.photographed;
    if (via === 'scan') j.scanned = true; else j.photographed = true;
    if (fresh) {
      j.depth = Math.round(game.player?.depth ?? 0);
      game.save.stats.scans = (game.save.stats.scans || 0) + 1;
      audio.play('chime', { gain: 0.6, bus: 'ui' });
      game.ui.toast('New species logged', `${sp.commonName} · ${this.count} / ${this.total}`, 4);
      bus.emit('species:new', id, via);
    }
    if (via === 'scan') game.ui.species.openCard(sp, { fresh, count: this.count, total: this.total, photo: game.save.photos[id] });
    game.persist();
    bus.emit('species:logged', id, via);
    return fresh;
  }
}
