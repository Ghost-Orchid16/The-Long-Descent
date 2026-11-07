// Safe localStorage wrapper: the game must keep running when storage is blocked or full.
const PREFIX = 'into-the-hadal/';

export function storageGet(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function storageRemove(key) {
  try { window.localStorage.removeItem(PREFIX + key); } catch (e) { /* storage unavailable */ }
}
