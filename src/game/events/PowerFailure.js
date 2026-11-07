import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';

const ORDER = ['life', 'lights', 'thrust'];

/**
 * Main power failure: floods, cabin lights, screens and thrusters die; red emergency lighting comes on.
 * Restore the buses at the breaker panel in order — life support, lights, thrusters. A breaker closed out of
 * order trips straight back out.
 */
export class PowerFailure {
  constructor(game, pod, { onStep, onWrong, onDone } = {}) {
    this.game = game; this.pod = pod; this.onStep = onStep; this.onWrong = onWrong; this.onDone = onDone;
    this.active = false; this.done = false; this.items = []; this.restored = [];
  }

  get next() { return ORDER[this.restored.length]; }

  start() {
    if (this.active || this.done) return;
    const game = this.game, pod = this.pod, ck = pod.cockpit;
    this.active = true;
    bus.emit('tension', true);
    this.floodsWere = pod.floodsOn;
    pod.setFloods(false);
    pod.sys.power = 0;
    pod.sys.bus = { life: false, lights: false, thrust: false };
    pod.redAlert = true;
    pod.warn = 'MAIN BUS FAULT';
    for (const b of ck.breakers) ck.setBreaker(b, false);
    audio.play('thunk', { gain: 0.8, rate: 0.5 });
    audio.playAlarm('power', 0.8);
    this.alarmT = 2.5;
    for (const b of ck.breakers) {
      this.items.push(game.interactions.add({
        object: b.group, radius: 0.05, range: 1.3, prompt: () => `Reset breaker · ${b.label}`,
        enabled: () => this.active && !b.on,
        onUse: () => this._press(b),
      }));
    }
    this.onStep?.(this.next);
  }

  _press(b) {
    const ck = this.pod.cockpit;
    if (b.id !== this.next) {
      // trips straight back out
      ck.setBreaker(b, true);
      audio.play('crackle', { gain: 0.5, rate: 2.2 });
      setTimeout(() => ck.setBreaker(b, false), 180);
      this.onWrong?.(this.next);
      return;
    }
    ck.setBreaker(b, true);
    audio.play('switch', { gain: 0.7 });
    this.pod.sys.bus[b.id] = true;
    this.restored.push(b.id);
    if (b.id === 'lights' && this.floodsWere) this.pod.setFloods(true);
    if (this.restored.length === ORDER.length) this._finish();
    else this.onStep?.(this.next);
  }

  _finish() {
    const pod = this.pod;
    this.active = false; this.done = true;
    bus.emit('tension', false);
    pod.sys.power = 1; pod.sys.bus = null; pod.redAlert = false; pod.warn = '';
    for (const it of this.items) this.game.interactions.remove(it);
    this.items.length = 0;
    this.game.save.stats.events.power = true;
    audio.play('chime', { gain: 0.35, bus: 'ui' });
    this.onDone?.();
  }

  update(dt) {
    if (!this.active) return;
    this.alarmT -= dt;
    if (this.alarmT <= 0) { this.alarmT = 3.2; audio.playAlarm('power', 0.35); }
  }

  dispose() { for (const it of this.items) this.game.interactions.remove(it); }
}
