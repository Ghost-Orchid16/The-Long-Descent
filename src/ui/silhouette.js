import { buildSpeciesGeometry } from '../creatures/factory.js';
import { APPEARANCE } from '../creatures/appearance.js';

// Journal silhouettes rendered with the 2D canvas from each species' own generated geometry.
const cache = new Map();
const TOP_VIEW = new Set(['ray', 'turtle', 'brittlestar']);

function seaFan(ctx, w, h, fill) {
  // branching gorgonian fan drawn as a recursive tree
  ctx.strokeStyle = fill; ctx.lineCap = 'round';
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const branch = (x, y, a, len, wdt, d) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (d > 0) for (let k = 0; k < 2; k++) branch(x2, y2, a + (k ? 1 : -1) * (0.25 + r() * 0.35), len * (0.72 + r() * 0.12), wdt * 0.72, d - 1);
  };
  branch(w / 2, h * 0.95, -Math.PI / 2, h * 0.22, 4, 7);
}

/** Returns a data URL of the species silhouette (side view, nose left; rays and turtles from above). */
export function silhouette(id, { w = 240, h = 140, fill = '#cfe6ee' } = {}) {
  const key = id + w + 'x' + h + fill;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = fill;
  if (id === 'sea_fan') { seaFan(ctx, w, h, fill); const u = c.toDataURL(); cache.set(key, u); return u; }
  const geo = buildSpeciesGeometry(id);
  if (!geo) return '';
  const app = APPEARANCE[id];
  const top = TOP_VIEW.has(app.gen) || (app.gen === 'octopus' && app.params?.kind === 'day');
  const pos = geo.attributes.position.array, idx = geo.index.array;
  const n = pos.length / 3;
  const X = new Float32Array(n), Y = new Float32Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    // side view: nose to the left; top view (rays, turtles): nose up
    if (top) { X[i] = x; Y[i] = -z; } else { X[i] = -z; Y[i] = -y; }
    x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]);
  }
  if (app.gen === 'jelly' || (app.gen === 'octopus' && app.params?.kind === 'dumbo') || app.gen === 'glasssponge' || app.gen === 'xeno') {
    for (let i = 0; i < n; i++) { X[i] = pos[i * 3]; Y[i] = -pos[i * 3 + 1]; }
    x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]); }
  }
  const pad = 10;
  const s = Math.min((w - pad * 2) / (x1 - x0 || 1), (h - pad * 2) / (y1 - y0 || 1));
  const ox = (w - (x1 - x0) * s) / 2 - x0 * s, oy = (h - (y1 - y0) * s) / 2 - y0 * s;
  ctx.beginPath();
  for (let k = 0; k < idx.length; k += 3) {
    let a = idx[k], b = idx[k + 1], d = idx[k + 2];
    const ax = X[a] * s + ox, ay = Y[a] * s + oy, bx = X[b] * s + ox, by = Y[b] * s + oy, dx = X[d] * s + ox, dy = Y[d] * s + oy;
    const area = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    if (Math.abs(area) < 1e-3) continue;
    ctx.moveTo(ax, ay);
    if (area > 0) { ctx.lineTo(bx, by); ctx.lineTo(dx, dy); } else { ctx.lineTo(dx, dy); ctx.lineTo(bx, by); }
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = fill; ctx.lineWidth = 0.6; ctx.stroke();
  geo.dispose();
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
