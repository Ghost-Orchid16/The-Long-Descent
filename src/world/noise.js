// Deterministic PRNG + 2D/3D gradient noise for world generation (CPU side).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  chance(p) { return this.r() < p; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
  gauss() { // Box–Muller
    const u = 1 - this.r(), v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function buildPerm(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const G2 = [];
for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; G2.push([Math.cos(a), Math.sin(a)]); }
const G3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1],
];

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export class Noise {
  constructor(seed = 1337) { this.perm = buildPerm(seed); }

  /** 2D gradient noise in ~[-1, 1]. */
  n2(x, y) {
    const p = this.perm;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g00 = G2[p[X + p[Y]] & 15], g10 = G2[p[X + 1 + p[Y]] & 15];
    const g01 = G2[p[X + p[Y + 1]] & 15], g11 = G2[p[X + 1 + p[Y + 1]] & 15];
    const n00 = g00[0] * xf + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return 1.414 * ((n00 + u * (n10 - n00)) + v * ((n01 + u * (n11 - n01)) - (n00 + u * (n10 - n00))));
  }

  /** 3D gradient noise in ~[-1, 1]. */
  n3(x, y, z) {
    const p = this.perm;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const g = (h, x1, y1, z1) => { const q = G3[h & 15]; return q[0] * x1 + q[1] * y1 + q[2] * z1; };
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(g(p[AA], xf, yf, zf), g(p[BA], xf - 1, yf, zf), u), l(g(p[AB], xf, yf - 1, zf), g(p[BB], xf - 1, yf - 1, zf), u), v),
      l(l(g(p[AA + 1], xf, yf, zf - 1), g(p[BA + 1], xf - 1, yf, zf - 1), u), l(g(p[AB + 1], xf, yf - 1, zf - 1), g(p[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
      w);
  }

  fbm2(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n2(x * f + i * 17.3, y * f - i * 9.1); n += a; f *= lac; a *= gain; }
    return s / n;
  }

  ridge2(x, y, oct = 5) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(this.n2(x * f + i * 31.7, y * f + i * 7.7)); s += a * v * v; n += a; f *= 2.03; a *= 0.5; }
    return s / n;
  }

  fbm3(x, y, z, oct = 4) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n3(x * f, y * f, z * f); n += a; f *= 2.0; a *= 0.5; }
    return s / n;
  }
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
