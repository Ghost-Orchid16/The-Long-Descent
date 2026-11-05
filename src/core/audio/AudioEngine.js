import * as THREE from 'three';
import { settings } from '../Settings.js';
import { bus } from '../Bus.js';

const SR = 44100;
const rand = (a, b) => a + Math.random() * (b - a);

function noiseBuffer(ctx, seconds, type = 'white', channels = 1) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(channels, len, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') { // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } // brown
    }
    // crossfade the loop seam
    const fade = Math.min(2048, len >> 3);
    for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = d[i] * t + d[len - fade + i] * (1 - t); }
  }
  return buf;
}

/** Exponentially decaying stereo noise impulse response. */
function impulse(ctx, seconds, decay, { lowpass = 1, pre = 0.01 } = {}) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = t < pre ? t / pre : Math.exp(-(t - pre) * decay);
      lp += (Math.random() * 2 - 1 - lp) * lowpass;
      d[i] = lp * env;
    }
  }
  return buf;
}

async function offline(seconds, fn, channels = 2) {
  const oc = new OfflineAudioContext(channels, Math.ceil(seconds * SR), SR);
  fn(oc);
  return oc.startRendering();
}

/** Procedural audio engine (Web Audio). Starts on the first user gesture. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.beds = {};
    this.env = 'silent';
    this.listenerPos = new THREE.Vector3();
    this.narcosis = 0;
    this.underwater = false;
    this._unlock = () => this.init();
    window.addEventListener('pointerdown', this._unlock, { once: false });
    window.addEventListener('keydown', this._unlock, { once: false });
    bus.on('settings', (k) => { if (k.endsWith('Volume')) this.applyVolumes(); });
  }

  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return; }
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 3; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.sfxBus = ctx.createGain(); this.ambBus = ctx.createGain(); this.uiBus = ctx.createGain();
    // underwater muffling filter on the world buses
    this.worldFilter = ctx.createBiquadFilter(); this.worldFilter.type = 'lowpass'; this.worldFilter.frequency.value = 20000; this.worldFilter.Q.value = 0.5;
    this.sfxBus.connect(this.worldFilter); this.ambBus.connect(this.worldFilter);
    this.worldFilter.connect(this.master);
    this.musicBus.connect(this.master); this.uiBus.connect(this.master);
    // narcosis: delayed, slightly smeared copy of the world
    this.narcDelay = ctx.createDelay(1.0); this.narcDelay.delayTime.value = 0.14;
    this.narcFb = ctx.createGain(); this.narcFb.gain.value = 0.32;
    this.narcWet = ctx.createGain(); this.narcWet.gain.value = 0;
    this.worldFilter.connect(this.narcDelay); this.narcDelay.connect(this.narcFb).connect(this.narcDelay);
    this.narcDelay.connect(this.narcWet).connect(this.master);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverb.buffer = impulse(ctx, 3.5, 1.4, { lowpass: 0.18 });
    this.reverbSend.connect(this.reverb).connect(this.worldFilter);
    this.applyVolumes();
    this.noise = { white: noiseBuffer(ctx, 4, 'white'), pink: noiseBuffer(ctx, 6, 'pink', 2), brown: noiseBuffer(ctx, 8, 'brown', 2) };
    await this._renderBuffers();
    this.ready = true;
    this.setEnvironment(this.pendingEnv || 'silent', 0.1);
    bus.emit('audio:ready');
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.get('masterVolume'), t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.get('musicVolume') * 0.8, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.get('sfxVolume'), t, 0.05);
    this.ambBus.gain.setTargetAtTime(settings.get('sfxVolume') * 0.9, t, 0.05);
    this.uiBus.gain.setTargetAtTime(Math.min(1, settings.get('sfxVolume') + 0.1) * 0.8, t, 0.05);
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ------------------------------------------------------------------ pre-rendered one-shots
  async _renderBuffers() {
    const B = this.buffers;
    const exhale = async (seed) => offline(1.5, (oc) => {
      // bubble blips: damped sinusoids with rising pitch (Minnaert resonance of each bubble)
      const n = 34 + seed * 6;
      for (let i = 0; i < n; i++) {
        const t0 = Math.pow(Math.random(), 1.4) * 1.05;
        const f = rand(260, 1500) * (Math.random() < 0.15 ? 0.5 : 1);
        const o = oc.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * rand(1.4, 2.4), t0 + 0.05);
        const g = oc.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(rand(0.05, 0.16), t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + rand(0.03, 0.09));
        const p = oc.createStereoPanner(); p.pan.value = rand(-0.7, 0.7);
        o.connect(g).connect(p).connect(oc.destination); o.start(t0); o.stop(t0 + 0.12);
      }
      // gurgle body
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 1.5, 'brown', 2);
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.5, 0.08); g.gain.exponentialRampToValueAtTime(0.01, 1.2);
      src.connect(lp).connect(g).connect(oc.destination); src.start(0);
    });
    const inhale = async (len) => offline(len + 0.2, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, len + 0.2, 'white', 2);
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(1800, 0); bp.frequency.linearRampToValueAtTime(2600, len * 0.4); bp.frequency.linearRampToValueAtTime(2100, len);
      const hs = oc.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 5000; hs.gain.value = -8;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.32, 0.12); g.gain.setValueAtTime(0.3, len * 0.7); g.gain.linearRampToValueAtTime(0, len);
      src.connect(bp).connect(hs).connect(g).connect(oc.destination); src.start(0);
      // valve click
      const c = oc.createBufferSource(); c.buffer = noiseBuffer(oc, 0.02, 'white', 1);
      const cg = oc.createGain(); cg.gain.setValueAtTime(0.25, 0.01); cg.gain.exponentialRampToValueAtTime(0.001, 0.03);
      const chp = oc.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 3000;
      c.connect(chp).connect(cg).connect(oc.destination); c.start(0.01);
    });
    B.exhale = await Promise.all([0, 1, 2].map(exhale));
    B.inhale = await Promise.all([1.1, 1.3].map(inhale));
    B.splash = await offline(3, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 3, 'white', 2);
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, 0); lp.frequency.exponentialRampToValueAtTime(300, 1.2);
      const g = oc.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.exponentialRampToValueAtTime(0.02, 2.4);
      src.connect(lp).connect(g).connect(oc.destination); src.start(0);
      for (let i = 0; i < 90; i++) {
        const t0 = 0.08 + Math.pow(Math.random(), 1.8) * 2.2, f = rand(300, 2200);
        const o = oc.createOscillator(); o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 2, t0 + 0.04);
        const og = oc.createGain(); og.gain.setValueAtTime(0.08, t0); og.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.05);
        const p = oc.createStereoPanner(); p.pan.value = rand(-1, 1);
        o.connect(og).connect(p).connect(oc.destination); o.start(t0); o.stop(t0 + 0.06);
      }
    });
    B.squelch = await offline(0.35, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 0.35, 'white', 1);
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.4;
      const g = oc.createGain(); g.gain.setValueAtTime(0.0, 0); g.gain.linearRampToValueAtTime(0.35, 0.01); g.gain.exponentialRampToValueAtTime(0.01, 0.28);
      src.connect(bp).connect(g).connect(oc.destination); src.start(0);
      const o = oc.createOscillator(); o.type = 'square'; o.frequency.value = 1200;
      const og = oc.createGain(); og.gain.setValueAtTime(0.05, 0); og.gain.exponentialRampToValueAtTime(0.001, 0.06);
      o.connect(og).connect(oc.destination); o.start(0); o.stop(0.07);
    }, 1);
    B.click = await offline(0.08, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 0.08, 'white', 1);
      const hp = oc.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3500; hp.Q.value = 2;
      const g = oc.createGain(); g.gain.setValueAtTime(0.6, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.04);
      src.connect(hp).connect(g).connect(oc.destination); src.start(0);
      const o = oc.createOscillator(); o.frequency.value = 180; const og = oc.createGain(); og.gain.setValueAtTime(0.3, 0); og.gain.exponentialRampToValueAtTime(0.001, 0.05);
      o.connect(og).connect(oc.destination); o.start(0); o.stop(0.06);
    }, 1);
    B.switch = await offline(0.12, (oc) => {
      for (const [t0, f, a] of [[0, 2600, 0.5], [0.035, 900, 0.35]]) {
        const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 0.05, 'white', 1);
        const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3;
        const g = oc.createGain(); g.gain.setValueAtTime(a, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
        src.connect(bp).connect(g).connect(oc.destination); src.start(t0);
      }
    }, 1);
    B.chime = await offline(3.2, (oc) => {
      [[659.25, 0], [987.77, 0.12], [1318.5, 0.24]].forEach(([f, t0]) => {
        for (const h of [1, 2.76]) {
          const o = oc.createOscillator(); o.frequency.value = f * h;
          const g = oc.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(h === 1 ? 0.12 : 0.025, t0 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0005, t0 + (h === 1 ? 2.8 : 1.2));
          o.connect(g).connect(oc.destination); o.start(t0); o.stop(t0 + 3);
        }
      });
    });
    B.scan = await offline(1.3, (oc) => {
      const o = oc.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(380, 0); o.frequency.exponentialRampToValueAtTime(1400, 1.0);
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.06, 0.1); g.gain.setValueAtTime(0.06, 0.9); g.gain.linearRampToValueAtTime(0, 1.2);
      const o2 = oc.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(760, 0); o2.frequency.exponentialRampToValueAtTime(2800, 1.0);
      const g2 = oc.createGain(); g2.gain.value = 0.015;
      o.connect(g).connect(oc.destination); o2.connect(g2).connect(g); o.start(0); o2.start(0); o.stop(1.3); o2.stop(1.3);
    }, 1);
    B.heart = await offline(0.9, (oc) => {
      for (const [t0, a] of [[0, 0.9], [0.22, 0.6]]) {
        const o = oc.createOscillator(); o.frequency.setValueAtTime(62, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
        const g = oc.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        o.connect(g).connect(oc.destination); o.start(t0); o.stop(t0 + 0.25);
      }
    }, 1);
    B.ping = await offline(4, (oc) => {
      const o = oc.createOscillator(); o.frequency.value = 1750;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.3, 0.004); g.gain.exponentialRampToValueAtTime(0.0008, 2.5);
      const o2 = oc.createOscillator(); o2.frequency.value = 3500; const g2 = oc.createGain(); g2.gain.setValueAtTime(0.06, 0); g2.gain.exponentialRampToValueAtTime(0.0005, 0.6);
      o.connect(g).connect(oc.destination); o2.connect(g2).connect(oc.destination); o.start(0); o2.start(0); o.stop(4); o2.stop(1);
    }, 1);
    B.creak = await Promise.all([0, 1, 2].map(() => offline(2.2, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 2.2, 'white', 1);
      const f0 = rand(70, 160);
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 18;
      bp.frequency.setValueAtTime(f0, 0); bp.frequency.linearRampToValueAtTime(f0 * rand(1.3, 2.2), rand(0.6, 1.6));
      const bp2 = oc.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = 25; bp2.frequency.value = f0 * 3.1;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1.4, 0.25); g.gain.setValueAtTime(1.2, 1.3); g.gain.exponentialRampToValueAtTime(0.01, 2.1);
      src.connect(bp).connect(g).connect(oc.destination); src.connect(bp2).connect(g);
      src.start(0);
    }, 1)));
    B.thunk = await offline(0.8, (oc) => {
      const o = oc.createOscillator(); o.frequency.setValueAtTime(120, 0); o.frequency.exponentialRampToValueAtTime(45, 0.3);
      const g = oc.createGain(); g.gain.setValueAtTime(0.9, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.6);
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 0.8, 'brown', 1);
      const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const g2 = oc.createGain(); g2.gain.setValueAtTime(0.7, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.4);
      o.connect(g).connect(oc.destination); src.connect(lp).connect(g2).connect(oc.destination); o.start(0); o.stop(0.7); src.start(0);
    }, 1);
    B.hiss = await offline(1.6, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 1.6, 'white', 2);
      const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.35, 0.05); g.gain.setValueAtTime(0.33, 1.1); g.gain.linearRampToValueAtTime(0, 1.5);
      src.connect(hp).connect(g).connect(oc.destination); src.start(0);
    });
    B.click2 = await offline(0.05, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 0.05, 'white', 1);
      const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6000; bp.Q.value = 1.5;
      const g = oc.createGain(); g.gain.setValueAtTime(0.8, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.008);
      src.connect(bp).connect(g).connect(oc.destination); src.start(0);
    }, 1);
    // snapping-shrimp crackle bed (8 s loop): thousands of sharp, high-passed clicks
    B.crackle = await offline(8, (oc) => {
      const len = 8 * SR;
      const buf = oc.createBuffer(2, len, SR);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        const n = 5200;
        for (let k = 0; k < n; k++) {
          const at = Math.floor(Math.random() * (len - 200));
          const a = Math.pow(Math.random(), 3) * 0.9 + 0.05;
          for (let i = 0; i < 60; i++) d[at + i] += (Math.random() * 2 - 1) * a * Math.exp(-i / 5);
        }
      }
      const src = oc.createBufferSource(); src.buffer = buf;
      const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
      const g = oc.createGain(); g.gain.value = 0.5;
      src.connect(hp).connect(g).connect(oc.destination); src.start(0);
    });
    // waves lapping on the hull (6 s loop)
    B.lap = await offline(6, (oc) => {
      const src = oc.createBufferSource(); src.buffer = noiseBuffer(oc, 6, 'pink', 2);
      const bp = oc.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 900;
      const g = oc.createGain(); g.gain.value = 0;
      for (let t = 0; t < 6; t += rand(0.8, 1.6)) { g.gain.setTargetAtTime(rand(0.25, 0.6), t, 0.15); g.gain.setTargetAtTime(0.05, t + 0.35, 0.3); }
      src.connect(bp).connect(g).connect(oc.destination); src.start(0);
    });
    B.alarm = {
      co2: await offline(1.0, (oc) => {
        for (const [t0, f] of [[0, 880], [0.25, 660]]) {
          const o = oc.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = oc.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.01); g.gain.setValueAtTime(0.18, t0 + 0.18); g.gain.linearRampToValueAtTime(0, t0 + 0.2);
          o.connect(g).connect(oc.destination); o.start(t0); o.stop(t0 + 0.22);
        }
      }, 1),
      power: await offline(0.9, (oc) => {
        const o = oc.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 190;
        const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
        const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.12, 0.02); g.gain.setValueAtTime(0.12, 0.5); g.gain.linearRampToValueAtTime(0, 0.55);
        o.connect(lp).connect(g).connect(oc.destination); o.start(0); o.stop(0.6);
      }, 1),
      warn: await offline(0.7, (oc) => {
        const o = oc.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1000, 0); o.frequency.linearRampToValueAtTime(1400, 0.3);
        const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.12, 0.02); g.gain.setValueAtTime(0.12, 0.28); g.gain.linearRampToValueAtTime(0, 0.32);
        o.connect(g).connect(oc.destination); o.start(0); o.stop(0.35);
      }, 1),
      hull: await offline(1.6, (oc) => {
        const o = oc.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(420, 0); o.frequency.linearRampToValueAtTime(300, 0.7);
        const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
        const g = oc.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.09, 0.03); g.gain.setValueAtTime(0.09, 0.65); g.gain.linearRampToValueAtTime(0, 0.72);
        o.connect(lp).connect(g).connect(oc.destination); o.start(0); o.stop(0.75);
      }, 1),
    };
  }

  // ------------------------------------------------------------------ playback helpers
  play(name, { gain = 1, rate = 1, pan = 0, bus: b = 'sfx', pos = null, reverb = 0.25, delay = 0 } = {}) {
    if (!this.ready) return null;
    let buf = this.buffers[name];
    if (Array.isArray(buf)) buf = buf[Math.floor(Math.random() * buf.length)];
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g);
    let out = g;
    if (pos) {
      const p = this._panner(pos);
      g.connect(p); out = p;
    } else if (pan) {
      const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p;
    }
    const busNode = b === 'ui' ? this.uiBus : b === 'amb' ? this.ambBus : b === 'music' ? this.musicBus : this.sfxBus;
    out.connect(busNode);
    if (reverb > 0 && b !== 'ui') { const s = ctx.createGain(); s.gain.value = reverb; out.connect(s).connect(this.reverbSend); }
    src.start(ctx.currentTime + delay);
    return { src, gain: g };
  }

  playAlarm(type, gain = 1) {
    if (!this.ready) return;
    const buf = this.buffers.alarm[type];
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.uiBus); src.start();
  }

  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = this.underwater ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse'; p.refDistance = 2; p.maxDistance = 200; p.rolloffFactor = this.underwater ? 0.7 : 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  /** Long-lived positional source (creatures, machinery). Returns {setPos, setGain, stop}. */
  loop(name, { gain = 1, pos = null, bus: b = 'amb', rate = 1, filter = null } = {}) {
    if (!this.ready) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = Array.isArray(this.buffers[name]) ? this.buffers[name][0] : (this.buffers[name] || this.noise[name]); src.loop = true; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = 0;
    let node = src;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = filter.type || 'lowpass'; f.frequency.value = filter.freq || 800; f.Q.value = filter.Q || 0.7; node.connect(f); node = f; }
    node.connect(g);
    let out = g, panner = null;
    if (pos) { panner = this._panner(pos); g.connect(panner); out = panner; }
    out.connect(b === 'sfx' ? this.sfxBus : b === 'music' ? this.musicBus : this.ambBus);
    src.start();
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.4);
    return {
      src, gain: g, panner,
      setGain: (v, tc = 0.3) => g.gain.setTargetAtTime(v, ctx.currentTime, tc),
      setRate: (v) => src.playbackRate.setTargetAtTime(v, ctx.currentTime, 0.2),
      setPos: (v) => { if (panner) { panner.positionX.value = v.x; panner.positionY.value = v.y; panner.positionZ.value = v.z; } },
      stop: (fade = 0.5) => { g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, fade * 1000 + 200); },
    };
  }

  // ------------------------------------------------------------------ environment beds
  setEnvironment(name, fade = 1.5) {
    if (!this.ready) { this.pendingEnv = name; return; }
    if (name === this.env) return;
    this.env = name;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const k of Object.keys(this.beds)) { this.beds[k].stop(fade); delete this.beds[k]; }
    this.underwater = ['underwater', 'reef', 'deep', 'pod'].includes(name);
    // world muffling
    const lp = name === 'reef' || name === 'underwater' || name === 'deep' ? 2600 : name === 'pod' ? 9000 : 20000;
    this.worldFilter.frequency.setTargetAtTime(lp, t, 0.3);
    const ir = name === 'chamber' ? impulse(ctx, 0.9, 6, { lowpass: 0.5 }) : name === 'pod' ? impulse(ctx, 0.6, 9, { lowpass: 0.6 })
      : this.underwater ? impulse(ctx, 4.5, 1.1, { lowpass: 0.12 }) : impulse(ctx, 1.4, 4, { lowpass: 0.4 });
    this.reverb.buffer = ir;
    if (name === 'reef' || name === 'underwater' || name === 'deep') {
      this.beds.water = this.loop('brown', { gain: name === 'deep' ? 0.35 : 0.5, filter: { type: 'lowpass', freq: 260 } });
      this.beds.surge = this.loop('pink', { gain: 0.08, filter: { type: 'bandpass', freq: 520, Q: 0.6 } });
      if (name === 'reef') this.beds.crackle = this.loop('crackle', { gain: 0.32 });
    } else if (name === 'deck') {
      this.beds.lap = this.loop('lap', { gain: 0.55 });
      this.beds.wind = this.loop('pink', { gain: 0.16, filter: { type: 'bandpass', freq: 700, Q: 0.4 } });
      this.beds.engine = this._hum(46, 0.05);
    } else if (name === 'pod') {
      this.beds.hum = this._hum(60, 0.035);
      this.beds.fan = this.loop('pink', { gain: 0.07, filter: { type: 'bandpass', freq: 1400, Q: 0.7 } });
      this.beds.outside = this.loop('brown', { gain: 0.25, filter: { type: 'lowpass', freq: 160 } });
    } else if (name === 'chamber') {
      this.beds.hiss = this.loop('pink', { gain: 0.06, filter: { type: 'highpass', freq: 2400 } });
      this.beds.hum = this._hum(50, 0.02);
    }
  }

  _hum(f, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const oscs = [1, 2, 3.02].map((h, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f * h;
      const og = ctx.createGain(); og.gain.value = [1, 0.35, 0.15][i];
      o.connect(og).connect(g); o.start(); return o;
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.21; const lg = ctx.createGain(); lg.gain.value = f * 0.004;
    lfo.connect(lg); oscs.forEach((o) => lg.connect(o.frequency)); lfo.start();
    g.connect(this.ambBus);
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.6);
    return {
      setGain: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.3),
      setRate: (r) => oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * [1, 2, 3.02][i] * r, ctx.currentTime, 0.3)),
      stop: (fade = 0.5) => { g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); }, fade * 1000 + 200); },
    };
  }

  setNarcosis(k) {
    if (!this.ready) return;
    this.narcosis = k;
    const t = this.ctx.currentTime;
    this.narcWet.gain.setTargetAtTime(k * 0.55, t, 0.5);
    this.narcDelay.delayTime.setTargetAtTime(0.09 + k * 0.12, t, 0.5);
  }

  /** Muffle factor for the world (0 clear .. 1 heavily muffled), e.g. inside the mask at depth. */
  setMuffle(freq) { if (this.ready) this.worldFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.3); }

  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this.listenerPos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(this.listenerPos.x, t); l.positionY.setValueAtTime(this.listenerPos.y, t); l.positionZ.setValueAtTime(this.listenerPos.z, t);
      l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t);
      l.upX.setValueAtTime(u.x, t); l.upY.setValueAtTime(u.y, t); l.upZ.setValueAtTime(u.z, t);
    } else if (l.setPosition) {
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
}

export const audio = new AudioEngine();
