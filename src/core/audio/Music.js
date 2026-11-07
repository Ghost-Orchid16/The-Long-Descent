import { audio } from './AudioEngine.js';
import { bus } from '../Bus.js';

// Procedural ambient score: slow pad chords per zone that crossfade, a shimmer swell when a species is logged,
// a tension layer during events, and distant whale song in the deep-wall and ascent zones.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const ZONES = {
  title: { chords: [[48, 55, 59, 62, 64], [45, 52, 55, 59, 62], [41, 48, 52, 57, 59]], cutoff: 1100, gain: 0.07, wave: 'sawtooth', dur: 16 },
  reef: { chords: [[48, 52, 55, 59, 62], [45, 48, 52, 55, 59], [41, 45, 48, 52, 59], [43, 47, 50, 55, 57]], cutoff: 1300, gain: 0.065, wave: 'sawtooth', dur: 14 },
  wall: { chords: [[50, 57, 64], [47, 54, 57, 62], [43, 50, 54, 59]], cutoff: 850, gain: 0.07, wave: 'sawtooth', dur: 16, whales: true },
  deco: { chords: [[50, 57, 64], [45, 52, 57, 60], [43, 50, 55, 59]], cutoff: 950, gain: 0.06, wave: 'sawtooth', dur: 15, whales: true },
  deck: null,
  pod: { chords: [[40, 47, 54, 55], [36, 43, 50, 54]], cutoff: 520, gain: 0.07, wave: 'triangle', dur: 20 },
  twilight: { chords: [[40, 47, 54, 55], [36, 43, 47, 54], [38, 45, 52, 53]], cutoff: 560, gain: 0.075, wave: 'triangle', dur: 20 },
  midnight: { chords: [[38, 45], [38, 45, 52]], cutoff: 380, gain: 0.08, wave: 'triangle', dur: 24, bells: [74, 77, 79, 81, 84, 86] },
  abyssal: { chords: [[36, 43], [36, 43, 50]], cutoff: 300, gain: 0.08, wave: 'triangle', dur: 26, bells: [72, 79, 84] },
  hadal: { chords: [[33, 40], [33, 39]], cutoff: 220, gain: 0.085, wave: 'triangle', dur: 28, bells: [81, 88] },
  ending: { chords: [[48, 55, 59, 64], [41, 48, 53, 57], [45, 52, 57, 60], [43, 50, 55, 62]], cutoff: 1500, gain: 0.07, wave: 'sawtooth', dur: 11 },
};

class Music {
  constructor() {
    this.zone = null; this.voices = []; this.timer = null; this.chordIdx = 0;
    this.tensionOn = false; this.tensionNodes = null;
    bus.on('species:new', () => this.swell());
    bus.on('tension', (on) => this.tension(!!on));
    bus.on('radio:start', () => audio.play('squelch', { gain: 0.16, bus: 'ui' }));
  }

  get ctx() { return audio.ready ? audio.ctx : null; }

  setZone(name) {
    if (name === this.zone) return;
    this.zone = name;
    const ctx = this.ctx;
    if (!ctx) { this.pending = name; return; }
    this._fadeOutVoices(4);
    clearTimeout(this.timer); clearTimeout(this.bellTimer); clearTimeout(this.whaleTimer);
    const z = ZONES[name];
    if (!z) return;
    this.chordIdx = 0;
    const next = () => {
      if (this.zone !== name) return;
      this._chord(z, z.chords[this.chordIdx % z.chords.length]);
      this.chordIdx++;
      this.timer = setTimeout(next, z.dur * 1000);
    };
    next();
    if (z.bells) this._bells(z, name);
    if (z.whales) this._whales(name);
  }

  /** Start any zone requested before the audio context existed. */
  resume() { if (this.pending && this.ctx) { const p = this.pending; this.pending = null; this.zone = null; this.setZone(p); } }

  _chord(z, notes) {
    const ctx = this.ctx, t = ctx.currentTime;
    this._fadeOutVoices(6);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = z.cutoff; filter.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.04;
    const lfoG = ctx.createGain(); lfoG.gain.value = z.cutoff * 0.35;
    lfo.connect(lfoG).connect(filter.frequency); lfo.start();
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(z.gain, t + 6);
    filter.connect(g).connect(audio.musicBus);
    const oscs = [lfo];
    for (const n of notes) for (const det of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = z.wave; o.frequency.value = midi(n); o.detune.value = det + (Math.random() - 0.5) * 4;
      const og = ctx.createGain(); og.gain.value = 1 / (notes.length * 2);
      o.connect(og).connect(filter); o.start(t + Math.random() * 0.5);
      oscs.push(o);
    }
    this.voices.push({ g, oscs });
  }

  _fadeOutVoices(sec) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const v of this.voices) {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + sec);
      for (const o of v.oscs) { try { o.stop(t + sec + 0.2); } catch (e) { /* already stopped */ } }
    }
    this.voices = [];
  }

  _bell(freq, gain = 0.04, at = 0) {
    const ctx = this.ctx, t = ctx.currentTime + at;
    for (const [h, a, d] of [[1, 1, 4.5], [2.76, 0.25, 1.6], [5.4, 0.08, 0.7]]) {
      const o = ctx.createOscillator(); o.frequency.value = freq * h;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(audio.musicBus); o.start(t); o.stop(t + d + 0.1);
    }
  }

  _bells(z, name) {
    const ring = () => {
      if (this.zone !== name || !this.ctx) return;
      const n = z.bells[Math.floor(Math.random() * z.bells.length)];
      this._bell(midi(n), 0.025 + Math.random() * 0.02);
      if (Math.random() < 0.4) this._bell(midi(z.bells[Math.floor(Math.random() * z.bells.length)]), 0.02, 0.8 + Math.random());
      this.bellTimer = setTimeout(ring, 7000 + Math.random() * 9000);
    };
    this.bellTimer = setTimeout(ring, 3000);
  }

  /** A distant humpback-like moan with a slow pitch contour and formant filtering. */
  _whale() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 140 + Math.random() * 90, dur = 2.5 + Math.random() * 2.5;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random() * 0.8), t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.8 + Math.random() * 0.3), t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 2.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.6); g.gain.setValueAtTime(0.05, t + dur - 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.4;
    o.connect(bp).connect(lp).connect(g).connect(pan).connect(audio.ambBus);
    const s = ctx.createGain(); s.gain.value = 0.6; g.connect(s).connect(audio.reverbSend);
    o.start(t); o.stop(t + dur + 0.1);
  }

  _whales(name) {
    const call = () => {
      if (this.zone !== name || !this.ctx) return;
      this._whale();
      if (Math.random() < 0.5) setTimeout(() => this.ctx && this.zone === name && this._whale(), 3500 + Math.random() * 2000);
      this.whaleTimer = setTimeout(call, 22000 + Math.random() * 20000);
    };
    this.whaleTimer = setTimeout(call, 9000);
  }

  /** Discovery shimmer: a rising arpeggio of bells over the pad. */
  swell() {
    if (!this.ctx) return;
    const base = [72, 76, 79, 83, 86];
    base.forEach((n, i) => this._bell(midi(n), 0.03, i * 0.11));
  }

  /** Tension layer: a low heartbeat pulse and a faint dissonant cluster. */
  tension(on) {
    const ctx = this.ctx;
    if (!ctx || on === this.tensionOn) return;
    this.tensionOn = on;
    const t = ctx.currentTime;
    if (on) {
      const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 1.5);
      out.connect(audio.musicBus);
      const low = ctx.createOscillator(); low.frequency.value = 55;
      const lowG = ctx.createGain(); lowG.gain.value = 0;
      const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 1.25;
      const pulseG = ctx.createGain(); pulseG.gain.value = 0.05;
      pulse.connect(pulseG).connect(lowG.gain);
      low.connect(lowG).connect(out);
      const clusterG = ctx.createGain(); clusterG.gain.value = 0.012;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const cl = [880, 932.3, 1318.5].map((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(clusterG); o.start(); return o; });
      clusterG.connect(lp).connect(out);
      low.start(); pulse.start();
      this.tensionNodes = { out, oscs: [low, pulse, ...cl] };
    } else if (this.tensionNodes) {
      const n = this.tensionNodes;
      n.out.gain.cancelScheduledValues(t); n.out.gain.setValueAtTime(n.out.gain.value, t); n.out.gain.linearRampToValueAtTime(0, t + 2.5);
      for (const o of n.oscs) { try { o.stop(t + 2.7); } catch (e) { /* stopped */ } }
      this.tensionNodes = null;
    }
  }
}

export const music = new Music();
