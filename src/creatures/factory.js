import * as THREE from 'three';
import { APPEARANCE } from './appearance.js';
import { makeCreatureMaterial } from './CreatureMaterial.js';
import { buildBody, PART } from './geometry/body.js';
import * as S from './geometry/special.js';
import speciesData from '../data/species.json';
import { overrideFor } from './overrides.js';

export const SPECIES = Object.fromEntries(speciesData.map((s) => [s.id, s]));
export const SPECIES_LIST = speciesData;
export const ZONE_ORDER = ['reef', 'wall', 'twilight', 'midnight', 'abyssal', 'hadal'];
export const ZONE_NAMES = { reef: 'Sunlight Reef', wall: 'Deep Wall', twilight: 'Twilight Zone', midnight: 'Midnight Zone', abyssal: 'Abyssal Plain', hadal: 'Hadal Trench' };

/** Real body length (m) of the generated model, used by behaviours and the swim shader. */
export function modelLength(id) {
  const a = APPEARANCE[id];
  if (!a) return 1;
  if (a.body) return a.body.length;
  return a.length ?? 1;
}

/** Geometry only (journal silhouettes, previews). */
export function buildSpeciesGeometry(id) {
  const a = APPEARANCE[id];
  return a ? buildGeometry(a) : null;
}

function buildGeometry(a) {
  switch (a.gen) {
    case 'body': {
      const m = buildBody(a.body);
      if (a.lure && m.spineTips.length) {
        const tip = m.spineTips[0];
        m.sphere(tip[0], tip[1], tip[2], a.lure.r * a.body.length, { t: 0.1, l: 0, h: 2, part: PART.LURE }, { ws: 8, hs: 6 });
      }
      return m.build();
    }
    case 'turtle': return S.buildTurtle(a.params);
    case 'ray': return S.buildRay(a.params);
    case 'octopus': return S.buildOctopus(a.params);
    case 'nautilus': return S.buildNautilus(a.params);
    case 'jelly': return S.buildJelly(a.params);
    case 'siphonophore': return S.buildSiphonophore(a.params);
    case 'crustacean': return S.buildCrustacean(a.params);
    case 'bivalve': return S.buildBivalve(a.params);
    case 'snail': return S.buildSnail(a.params);
    case 'seapig': return S.buildSeaPig(a.params);
    case 'cucumber': return S.buildCucumber(a.params);
    case 'brittlestar': return S.buildBrittleStar(a.params);
    case 'glasssponge': return S.buildGlassSponge(a.params);
    case 'xeno': return S.buildXenophyophore(a.params);
    case 'whale': return S.buildSpermWhale(a.params);
    default: throw new Error('unknown creature generator ' + a.gen);
  }
}

/** Build {geometry, material, length} for a species. Caller owns and disposes them. */
export function buildCreature(id) {
  const a = APPEARANCE[id];
  if (!a) throw new Error('no appearance for ' + id);
  const geometry = buildGeometry(a);
  const length = modelLength(id);
  const material = makeCreatureMaterial({ ...a, id, length });
  return { geometry, material, length, appearance: a, data: SPECIES[id] };
}

/** InstancedMesh for a species with the per-instance animation attribute (phase, speed, turn, state). */
export function makeInstanced(id, count) {
  const ov = overrideFor(id);
  const c = ov ? { geometry: ov.geometry.clone(), material: ov.material.clone(), length: modelLength(id), appearance: APPEARANCE[id], data: SPECIES[id] } : buildCreature(id);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) { anim.array[i * 4] = Math.random() * 100; anim.array[i * 4 + 1] = 1; }
  c.geometry.setAttribute('aAnim', anim);
  const mesh = new THREE.InstancedMesh(c.geometry, c.material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = 'species:' + id;
  return { ...c, mesh, anim };
}
