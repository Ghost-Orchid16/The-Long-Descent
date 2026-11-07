import { storageGet, storageSet, storageRemove } from './Storage.js';

const SAVE_KEY = 'save-v1';

export function emptySave() {
  return {
    v: 1,
    stage: 0,
    journal: {},          // speciesId -> { scanned: bool, photographed: bool, stage }
    photos: {},           // speciesId -> small JPEG data URL (best photo)
    stats: { maxDepth: 0, photos: 0, events: {}, playTime: 0, scans: 0 },
    flags: {},
    savedAt: 0,
  };
}

export function loadSave() {
  const s = storageGet(SAVE_KEY, null);
  if (!s || s.v !== 1) return null;
  return { ...emptySave(), ...s, stats: { ...emptySave().stats, ...(s.stats || {}) } };
}

export function writeSave(data) {
  data.savedAt = Date.now();
  // Photos can push past the quota; fall back to saving without them.
  if (!storageSet(SAVE_KEY, data)) {
    const slim = { ...data, photos: {} };
    storageSet(SAVE_KEY, slim);
  }
}

export function clearSave() { storageRemove(SAVE_KEY); }
