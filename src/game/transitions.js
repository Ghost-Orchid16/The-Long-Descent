import * as THREE from 'three';

/**
 * Guided depth transition for the pod: the depth counter runs fast while the world's depth reference moves,
 * so light, colour and particles change by themselves. The pod stays at its local position; marine snow
 * streams upward to sell the descent. Returns a controller with update(dt) → true when finished.
 */
export function guidedDescent(stage, { from, to, duration = 40, zone = '', hide = [], lines = [], onDone } = {}) {
  const game = stage.game, env = stage.engine.env, pod = stage.pod;
  let t = 0;
  const saved = env.current.clone();
  hide.forEach((o) => (o.visible = false));
  pod.locked = true;
  game.ui.transit(true, zone, from);
  const cues = lines.map((l) => ({ ...l, done: false }));
  return {
    active: true,
    update(dt) {
      if (!this.active) return true;
      t += dt;
      const k = THREE.MathUtils.clamp(t / duration, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const depth = from + (to - from) * e;
      env.depthBase = depth + pod.pos.y;
      // the descent speed shows in the snow rushing past
      const v = (to - from) / duration * 2 * Math.min(1, 4 * k * (1 - k) + 0.2);
      env.current.set(saved.x, Math.min(4, v * 0.6), saved.z);
      game.ui.transit(true, zone, depth);
      for (const c of cues) if (!c.done && depth >= c.at) { c.done = true; c.fn ? c.fn() : game.say(c.key); }
      if (k >= 1) {
        this.active = false;
        env.current.copy(saved);
        hide.forEach((o) => (o.visible = true));
        pod.locked = false;
        game.ui.transit(false);
        onDone?.();
        return true;
      }
      return false;
    },
  };
}
