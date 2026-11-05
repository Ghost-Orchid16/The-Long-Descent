import { storageGet, storageSet } from './Storage.js';
import { bus } from './Bus.js';

export const DEFAULT_SETTINGS = {
  quality: 'auto',          // low | medium | high | auto
  resolvedQuality: null,    // result of the first-launch benchmark
  resolutionScale: 1,
  sensitivity: 1,
  invertY: false,
  fov: 72,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  subtitles: true,
  reducedMotion: false,
  markers: true,
};

class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS, ...(storageGet('settings', {}) || {}) };
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v) return;
    this.data[k] = v;
    storageSet('settings', this.data);
    bus.emit('settings', k, v);
  }
  reset() {
    const keep = this.data.resolvedQuality;
    this.data = { ...DEFAULT_SETTINGS, resolvedQuality: keep };
    storageSet('settings', this.data);
    for (const k of Object.keys(this.data)) bus.emit('settings', k, this.data[k]);
  }
  /** The effective quality preset name. */
  quality() {
    const q = this.data.quality;
    if (q === 'auto') return this.data.resolvedQuality || 'medium';
    return q;
  }
}

export const settings = new Settings();
