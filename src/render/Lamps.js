import * as THREE from 'three';

export const MAX_LAMPS = 3;

/**
 * Registry of artificial spot lamps (diver torch, pod floodlights). Lamps are real THREE.SpotLights
 * for surface shading; this registry mirrors them into uniform arrays for particles and volumetrics.
 */
class LampRegistry {
  constructor() {
    this.lamps = [];
    this.uniforms = {
      uLampCount: { value: 0 },
      uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
      uLampDir: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3(0, 0, -1)) },
      uLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
      uLampCone: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector2(0.9, 0.95)) },
    };
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  add(light, { volumetric = 1, particles = 1 } = {}) {
    const entry = { light, volumetric, particles };
    this.lamps.push(entry);
    return entry;
  }

  remove(light) {
    this.lamps = this.lamps.filter((l) => l.light !== light);
  }

  clear() { this.lamps.length = 0; }

  update() {
    const u = this.uniforms;
    let n = 0;
    for (const e of this.lamps) {
      const L = e.light;
      if (!L.visible || L.intensity <= 0 || n >= MAX_LAMPS) continue;
      L.getWorldPosition(this._p);
      L.target.getWorldPosition(this._t);
      u.uLampPos.value[n].copy(this._p);
      u.uLampDir.value[n].copy(this._t).sub(this._p).normalize();
      const k = L.intensity * e.volumetric;
      u.uLampCol.value[n].set(L.color.r * k, L.color.g * k, L.color.b * k);
      const outer = Math.cos(L.angle);
      const inner = Math.cos(L.angle * (1 - L.penumbra));
      u.uLampCone.value[n].set(outer, inner);
      n++;
    }
    u.uLampCount.value = n;
  }
}

export const lamps = new LampRegistry();

export const LAMP_GLSL = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
uniform int uLampCount;
uniform vec3 uLampPos[MAX_LAMPS];
uniform vec3 uLampDir[MAX_LAMPS];
uniform vec3 uLampCol[MAX_LAMPS];
uniform vec2 uLampCone[MAX_LAMPS];
// Radiant intensity from lamp i arriving at p (inverse square, cone, water path), excluding phase.
vec3 lampAt(int i, vec3 p, out vec3 ldir) {
  vec3 L = p - uLampPos[i];
  float d = length(L);
  ldir = L / max(d, 1e-4);
  float cone = smoothstep(uLampCone[i].x, uLampCone[i].y, dot(ldir, uLampDir[i]));
  return uLampCol[i] * cone / (d * d + 0.25) * exp(-uWSigma * uWLightPath * d);
}
`;
