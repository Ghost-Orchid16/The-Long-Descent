import * as THREE from 'three';
import { Engine } from '../core/Engine.js';

/**
 * Base class for a game stage (one checkpointed section of the descent).
 * Subclasses override build/enter/update/exit. All content goes under `this.root`, which is
 * disposed (geometries, materials, owned textures) when the stage is left.
 */
export class Stage {
  constructor(game) {
    this.game = game;
    this.engine = game.engine;
    this.root = new THREE.Group();
    this.root.name = 'stage:' + this.constructor.name;
    this.t = 0;
    this.done = false;
    this.cleanups = [];
    this.scatters = [];
  }

  /** Stage id used for saves and the journal. */
  static get id() { return 'stage'; }

  /** Build heavy content. `yieldFrame` lets long builds keep transitions smooth. */
  async build(yieldFrame) { void yieldFrame; }

  /** Called when the stage becomes active (player spawned, env configured). */
  enter() {}

  update(dt) { this.t += dt; for (const s of this.scatters) s.update(this.engine.camera); }

  exit() {}

  /** Register a function to run on dispose (event listeners, timers, lamps...). */
  onDispose(fn) { this.cleanups.push(fn); }

  dispose() {
    for (const fn of this.cleanups) { try { fn(); } catch (e) { console.error(e); } }
    this.cleanups.length = 0;
    this.root.removeFromParent();
    Engine.disposeTree(this.root);
  }
}

/** Await one animation frame (lets the browser paint during long synchronous builds). */
export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
