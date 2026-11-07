import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';

/**
 * Sediment plume: a collapse sends silt billowing over the pod and visibility drops to a metre or two.
 * Navigate to a waypoint using sonar pings (R): each ping shows the terrain and the waypoint box for a while.
 */
export class SedimentPlume {
  constructor(game, pod, { exit, radius = 9, onDone } = {}) {
    this.game = game; this.pod = pod; this.exit = exit.clone(); this.radius = radius; this.onDone = onDone;
    this.active = false; this.done = false; this.pingT = 0; this.pings = 0;
  }

  start() {
    if (this.active || this.done) return;
    this.active = true;
    bus.emit('tension', true);
    const env = this.game.engine.env;
    env.setWaterType('plume', 3.5);
    this.pod.setFloodScatter(4.5);
    this.prevRange = this.game.scanner.range;
    this.game.scanner.range = 3.5;
    audio.play('creak', { gain: 0.8, rate: 0.45 });
    audio.play('thunk', { gain: 0.7, rate: 0.4 });
    this._onPing = () => { this.pingT = 9; this.pings++; this.pod.setWaypoint(this.exit); };
    this.unsub = bus.on('pod:ping', this._onPing);
  }

  update(dt) {
    if (!this.active) return;
    const pod = this.pod;
    this.pingT -= dt;
    if (this.pingT > 0) pod.setWaypoint(this.exit); else pod.setWaypoint(null);
    const d = Math.hypot(pod.pos.x - this.exit.x, pod.pos.z - this.exit.z);
    if (d < this.radius && Math.abs(pod.pos.y - this.exit.y) < 14) this._finish();
  }

  _finish() {
    this.active = false; this.done = true;
    bus.emit('tension', false);
    this.unsub?.(); this.unsub = null;
    this.pod.setWaypoint(null);
    this.game.engine.env.setWaterType('deep', 4);
    this.pod.setFloodScatter(1);
    this.game.scanner.range = this.prevRange ?? 16;
    this.game.save.stats.events.plume = true;
    audio.play('chime', { gain: 0.35, bus: 'ui' });
    this.onDone?.();
  }

  dispose() { this.unsub?.(); }
}
