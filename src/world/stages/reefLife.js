import * as THREE from 'three';
import { RNG } from '../noise.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Coral heads (bommies) used as homes; mirrors makeReefHeight's list. */
export const BOMMIES = [
  { x: 58, z: 30, r: 11 }, { x: 22, z: -40, r: 5 }, { x: -30, z: -55, r: 6 }, { x: -60, z: -10, r: 7 },
  { x: 34, z: 66, r: 6 }, { x: -18, z: 80, r: 5 }, { x: 80, z: -30, r: 7 }, { x: -85, z: 50, r: 8 }, { x: 10, z: 30, r: 4 },
];

/**
 * Populate the Sunlight Reef. Returns handles the stage scripts against (manta, wrasse, ...).
 * mgr: CreatureManager, hf: reef Heightfield, reef: buildReef() result.
 */
export function populateReef(mgr, hf, reef, { station }) {
  const rng = new RNG(4242);
  const gy = (x, z) => hf.height(x, z);
  const top = (b) => gy(b.x, b.z);
  const out = {};

  // damselfish clouds over coral heads; they drop into the branches when a diver rushes in
  for (const [b, n] of [[BOMMIES[8], 34], [BOMMIES[3], 30], [BOMMIES[5], 28], [BOMMIES[4], 28]]) {
    const y = Math.min(top(b), -6);
    mgr.spawn('chromis', { beh: 'school', count: n, home: V(b.x, y + 1.4, b.z), radius: 1.6, yMin: y + 0.4, yMax: y + 3.2, refuge: V(b.x, y + 0.2, b.z), spacing: 1.6, clearance: 0.35 });
  }
  // moorish idols in pairs and small groups
  mgr.spawn('moorish_idol', { beh: 'school', count: 4, home: V(-8, gy(-8, -18) + 2, -18), radius: 10, clearance: 1.0, spacing: 2.5 });
  mgr.spawn('moorish_idol', { beh: 'school', count: 3, home: V(44, gy(44, 12) + 2, 12), radius: 10, clearance: 1.0, spacing: 2.5 });
  // palette surgeonfish hovering near branching coral
  for (const b of [BOMMIES[2], BOMMIES[6]]) mgr.spawn('palette_tang', { beh: 'school', count: 7, home: V(b.x + 2, top(b) + 1.2, b.z), radius: 2.5, clearance: 0.6, spacing: 2.2 });
  // anemonefish: two or three per host anemone
  const anem = reef.anemones || [];
  anem.forEach((p, k) => {
    const n = k === 0 ? 3 : 2;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ p: V(p.x + rng.range(-0.15, 0.15), p.y + 0.18 + rng.range(0, 0.1), p.z + rng.range(-0.15, 0.15)), scale: i === 0 ? 1.15 : rng.range(0.7, 0.95) });
    mgr.spawn('anemonefish', { beh: 'territorial', points: pts, radius: 0.4, scale: [1, 1], clearance: 0.1 });
  });
  // lionfish hanging under ledges
  mgr.spawn('lionfish', { beh: 'hover', points: [{ p: V(-55, gy(-55, -9) + 0.9, -9), yaw: 1.2 }, { p: V(-14, gy(-14, 79) + 0.8, 79), yaw: -2 }], hoverRadius: 0.35, clearance: 0.4 });
  // giant clams on the reef flat
  const clams = [[-5, -45], [15, -52], [-40, -38], [35, -35], [-25, -25], [5, -33]].map(([x, z]) => ({ p: V(x, 0, z), yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.3) }));
  mgr.spawn('giant_clam', { beh: 'sessile', points: clams });
  // day octopus in a hole at the foot of a coral head
  const oc = BOMMIES[8];
  const op = V(oc.x + 3.4, gy(oc.x + 3.4, oc.z + 0.6) + 0.05, oc.z + 0.6);
  mgr.spawn('day_octopus', { beh: 'hide', points: [{ p: op, dir: V(0.9, 0.12, 0.3) }], peek: 0.1 });
  // cleaning station: cleaner wrasse around the station top; the manta visits on cue
  const sTop = station.clone();
  out.wrasse = mgr.spawn('cleaner_wrasse', { beh: 'cleaning', points: [0, 1, 2].map((i) => ({ p: sTop.clone().add(V(Math.cos(i * 2.1) * 0.8, 0.35, Math.sin(i * 2.1) * 0.8)) })), client: () => out.mantaClient(), clearance: 0.15 });
  const loop = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    loop.push(V(station.x + Math.cos(a) * 7.5, station.y + 3.0 + Math.sin(a * 2) * 0.9, station.z + Math.sin(a) * 6.0));
  }
  out.manta = mgr.spawn('reef_manta', { beh: 'giant', path: loop, loop: true, speed: 0.55, count: 1, active: 160, noSnap: true });
  out.manta.visible = false;
  out.manta.agents[0].p.set(station.x + 30, station.y + 2, station.z + 45);
  out.mantaClient = () => {
    const g = out.manta;
    if (!g.visible) return null;
    const a = g.agents[0];
    return a.p.distanceTo(station) < 5.5 ? { p: a.p, r: 1.1 } : null;
  };
  // turtles: one resting on the sand, one cruising the slope
  const tp = V(-12, 0, 7);
  out.turtleRest = mgr.spawn('green_turtle', { beh: 'rest', points: [{ p: tp, yaw: 2.2 }], radius: 22 });
  out.turtle = mgr.spawn('green_turtle', { beh: 'cruise', count: 1, home: V(-20, gy(-20, 30) + 3, 30), radius: 26, clearance: 1.5 });
  mgr.spawn('hawksbill', { beh: 'graze', count: 1, home: V(-45, gy(-45, -35) + 1, -35), radius: 14, clearance: 0.6 });
  // sharks
  mgr.spawn('blacktip_reef', { beh: 'cruise', count: 2, home: V(-10, -5, -78), radius: 34, yMin: -9, yMax: -2.5, clearance: 1.2 });
  mgr.spawn('whitetip_reef', { beh: 'rest', points: [{ p: V(40, 0, -8), yaw: 0.4 }], radius: 30 });
  // bumphead parrotfish school grazing along the slope
  mgr.spawn('bumphead', { beh: 'school', count: 6, home: V(-55, gy(-55, 40) + 2, 40), radius: 18, clearance: 1.2, spacing: 1.4 });
  // humphead wrasse: curious about divers who keep still
  out.napoleon = mgr.spawn('napoleon', { beh: 'curious', count: 1, home: V(50, gy(50, 55) + 2.5, 55), radius: 18, clearance: 1.2 });
  return out;
}
