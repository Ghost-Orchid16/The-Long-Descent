// Bühlmann ZHL-16C (nitrogen) tissue model for the wrist computer: NDL, ceiling and stop.
// Coefficients: Bühlmann & Völlm, "Tauchmedizin" (ZHL-16C a/b values for N2).
const HT = [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109, 146, 187, 239, 305, 390, 498, 635];
const A = [1.1696, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248, 0.2327];
const B = [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653];
const FN2 = 0.79, PH2O = 0.0627, SURFACE = 1.013;

export const pressureAt = (depthM) => SURFACE + Math.max(0, depthM) / 10.0;

export class DiveComputer {
  constructor({ gf = 0.85 } = {}) {
    this.gf = gf;
    this.p = HT.map(() => (SURFACE - PH2O) * FN2);
    this.diveTime = 0; // game seconds
    this.maxDepth = 0;
  }

  reset() { this.p = HT.map(() => (SURFACE - PH2O) * FN2); this.diveTime = 0; this.maxDepth = 0; }

  /** Advance tissues by dtGame seconds at depth. */
  step(dtGame, depth) {
    const pAlv = (pressureAt(depth) - PH2O) * FN2;
    const dtMin = dtGame / 60;
    for (let i = 0; i < 16; i++) this.p[i] += (pAlv - this.p[i]) * (1 - Math.pow(2, -dtMin / HT[i]));
    this.diveTime += dtGame;
    this.maxDepth = Math.max(this.maxDepth, depth);
  }

  /** Tolerated ambient pressure for each tissue with a single gradient factor. */
  _tol(i, p = this.p[i]) {
    const gf = this.gf, a = A[i], b = B[i];
    return (p - a * gf) / (gf / b - gf + 1);
  }

  /** Decompression ceiling in metres (0 = may surface). */
  ceiling() {
    let pt = 0;
    for (let i = 0; i < 16; i++) pt = Math.max(pt, this._tol(i));
    return Math.max(0, (pt - SURFACE) * 10);
  }

  /** No-decompression limit at the given depth, in game minutes (99 = unlimited). */
  ndl(depth) {
    const pAlv = (pressureAt(depth) - PH2O) * FN2;
    let best = 99;
    for (let i = 0; i < 16; i++) {
      // surface M-value with gradient factor: p such that tolerated pressure == surface
      const gf = this.gf, a = A[i], b = B[i];
      const m0 = SURFACE * (gf / b - gf + 1) + a * gf;
      const p0 = this.p[i];
      if (p0 >= m0) return 0;
      if (pAlv <= m0) continue;
      const t = -HT[i] * Math.log2((m0 - pAlv) / (p0 - pAlv));
      if (t < best) best = t;
    }
    return best;
  }

  /** Next stop depth (3 m increments) and an estimate of its duration (game seconds). */
  stop() {
    const c = this.ceiling();
    if (c <= 0.01) return { depth: 0, time: 0 };
    const depth = Math.ceil(c / 3) * 3;
    // estimate: simulate at the stop until the ceiling rises above the next shallower stop
    const saved = this.p.slice();
    const target = depth - 3;
    let t = 0;
    while (t < 60 * 60) {
      const pAlv = (pressureAt(depth) - PH2O) * FN2;
      for (let i = 0; i < 16; i++) this.p[i] += (pAlv - this.p[i]) * (1 - Math.pow(2, -0.5 / HT[i]));
      t += 30;
      if (this.ceiling() <= target + 0.01) break;
    }
    this.p = saved;
    return { depth, time: t };
  }
}
