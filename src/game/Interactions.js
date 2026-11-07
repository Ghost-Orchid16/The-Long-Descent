import * as THREE from 'three';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();

/**
 * Reticle-targeted interactables. Each item:
 *  { position | object, radius, range, prompt, mode: 'press'|'hold'|'drag'|'click', hold (s),
 *    key ('interact'|'click'), onUse(), onDrag(dx, dy, dt), onHold(progress), enabled() }
 */
export class Interactions {
  constructor(game) {
    this.game = game;
    this.items = new Set();
    this.focus = null;
    this.holdT = 0;
    this.dragging = null;
    this.enabled = true;
  }

  add(item) {
    const it = { radius: 0.25, range: 2.6, mode: 'press', hold: 0.8, key: 'interact', enabled: () => true, ...item };
    this.items.add(it);
    return it;
  }

  remove(it) { if (it) { this.items.delete(it); if (this.focus === it) this.focus = null; } }

  clear() { this.items.clear(); this.focus = null; this.dragging = null; }

  _pos(it, out) {
    if (it.object) return it.object.getWorldPosition(out);
    if (typeof it.position === 'function') return out.copy(it.position());
    return out.copy(it.position);
  }

  update(dt) {
    const { input, engine, ui } = this.game;
    const cam = engine.camera;
    cam.getWorldPosition(_v);
    cam.getWorldDirection(_d);
    let best = null, bestScore = Infinity;
    if (this.enabled && !this.dragging) {
      for (const it of this.items) {
        if (!it.enabled()) continue;
        this._pos(it, _p);
        const to = _p.sub(_v);
        const dist = to.length();
        if (dist > it.range || dist < 0.05) continue;
        const along = to.dot(_d);
        if (along <= 0) continue;
        const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
        const tol = it.radius + dist * 0.035;
        if (perp > tol) continue;
        const score = perp / tol + dist * 0.05;
        if (score < bestScore) { bestScore = score; best = it; }
      }
    }
    if (this.dragging) best = this.dragging;
    if (best !== this.focus) { this.focus = best; this.holdT = 0; }
    const f = this.focus;
    if (!f) { ui.prompt(null); return; }
    const keyLabel = f.key === 'click' ? 'Click' : (input.lastDevice === 'pad' ? 'A' : 'E');
    const verb = f.mode === 'hold' ? `Hold ${keyLabel}` : f.mode === 'drag' ? `Hold ${keyLabel} + move` : keyLabel;
    ui.prompt(f.prompt ? `${verb}  ·  ${typeof f.prompt === 'function' ? f.prompt() : f.prompt}` : null, f.mode === 'hold' ? this.holdT / f.hold : null);
    const pressed = f.key === 'click' ? input.clickPressed() : input.pressed('interact');
    const down = f.key === 'click' ? input.clickDown() : input.isDown('interact');
    if (f.mode === 'press' || f.mode === 'click') {
      if (pressed) { f.onUse?.(); this.holdT = 0; }
    } else if (f.mode === 'hold') {
      if (down) {
        this.holdT += dt;
        f.onHold?.(Math.min(1, this.holdT / f.hold));
        if (this.holdT >= f.hold) { this.holdT = 0; f.onUse?.(); }
      } else if (this.holdT > 0) { this.holdT = Math.max(0, this.holdT - dt * 2); f.onHold?.(this.holdT / f.hold); }
    } else if (f.mode === 'drag') {
      if (down) {
        this.dragging = f;
        f.onDrag?.(input.look.x, input.look.y, dt);
      } else if (this.dragging) { this.dragging = null; f.onRelease?.(); }
    }
  }

  /** While dragging, the camera should not turn with the mouse. */
  get capturesLook() { return !!this.dragging; }
}
