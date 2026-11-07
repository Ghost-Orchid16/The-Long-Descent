import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';

/**
 * CO2 scrubber alarm in the pod: the absorbent canister is spent, CO2 climbs and vision dims.
 * Open the panel, pull the old canister, insert the fresh one, restart the fan.
 */
export class CO2Scrubber {
  constructor(game, pod, { onStep, onDone } = {}) {
    this.game = game; this.pod = pod; this.onStep = onStep; this.onDone = onDone;
    this.step = null; this.active = false; this.done = false;
    this.items = [];
  }

  start() {
    if (this.active || this.done) return;
    const game = this.game, pod = this.pod, sc = pod.cockpit.scrubber;
    this.active = true;
    this.step = 'open';
    bus.emit('tension', true);
    pod.sys.scrubberOn = false;
    pod.co2Rate = 60;
    pod.warn = 'CO₂ HIGH';
    sc.fanBtn.material.color.set(0xe5603f);
    this.alarmT = 0;
    audio.playAlarm('co2', 0.8);
    const add = (o) => { const it = game.interactions.add(o); this.items.push(it); return it; };
    add({ object: sc.cover, radius: 0.12, range: 1.3, prompt: 'Open the scrubber panel', enabled: () => this.step === 'open',
      onUse: () => { pod.cockpit.setScrubberOpen(true); audio.play('click', { gain: 0.5 }); this._next('pull'); } });
    add({ object: sc.can, radius: 0.09, range: 1.3, mode: 'hold', hold: 0.9, prompt: 'Pull the spent canister', enabled: () => this.step === 'pull',
      onUse: () => { sc.can.visible = false; audio.play('thunk', { gain: 0.35, rate: 1.4 }); this._next('insert'); } });
    add({ object: sc.spare, radius: 0.09, range: 1.3, mode: 'hold', hold: 0.9, prompt: 'Insert the fresh canister', enabled: () => this.step === 'insert',
      onUse: () => {
        sc.spare.position.copy(sc.can.position); sc.can.visible = false;
        audio.play('thunk', { gain: 0.4, rate: 1.2 });
        this._next('fan');
      } });
    add({ object: sc.fanBtn, radius: 0.06, range: 1.3, prompt: 'Restart the scrubber fan', enabled: () => this.step === 'fan',
      onUse: () => {
        sc.fanBtn.material.color.set(0x40ff70);
        pod.cockpit.setScrubberOpen(false);
        pod.sys.scrubberOn = true; pod.co2Rate = undefined; pod.warn = '';
        audio.play('switch', { gain: 0.6 });
        this._finish();
      } });
    this.onStep?.(this.step);
  }

  _next(step) { this.step = step; this.onStep?.(step); }

  _finish() {
    this.active = false; this.done = true; this.step = null;
    bus.emit('tension', false);
    for (const it of this.items) this.game.interactions.remove(it);
    this.items.length = 0;
    this.game.save.stats.events.co2 = true;
    this.onDone?.();
  }

  update(dt) {
    if (!this.active) return;
    const pod = this.pod;
    pod.sys.co2 = Math.min(pod.sys.co2, 6800); // forgiving ceiling: headache and dim vision, never worse
    this.alarmT -= dt;
    if (this.alarmT <= 0) { this.alarmT = 2.4; audio.playAlarm('co2', 0.45); }
    // the fan spins down; the cabin feels close
    pod.cockpit.scrubber.fan.rotation.z += dt * 0.5;
  }

  dispose() { for (const it of this.items) this.game.interactions.remove(it); }
}
