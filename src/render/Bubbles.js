import * as THREE from 'three';
import { getSharedWaterUniforms } from './water/patch.js';
import { WATER_UNIFORMS_GLSL } from './water/waterGLSL.js';
import { LAMP_GLSL, lamps } from './Lamps.js';

/**
 * Bubble particles: rise at a size-dependent terminal velocity, wobble, grow as pressure drops
 * (Boyle's law), break up, and burst at the surface.
 */
export class Bubbles {
  constructor({ max = 900 } = {}) {
    this.max = max;
    this.n = 0;
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.r = new Float32Array(max); this.age = new Float32Array(max); this.ph = new Float32Array(max); this.seed = new Float32Array(max);
    this.streams = [];
    this.depthBase = 0;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aShape = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.aShape.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aShape', this.aShape);
    geo.instanceCount = 0;
    this.geo = geo;

    this.uniforms = { ...getSharedWaterUniforms(), ...lamps.uniforms, uAmbient: { value: new THREE.Vector3(1, 1, 1) } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        ${WATER_UNIFORMS_GLSL}
        ${LAMP_GLSL}
        attribute vec2 aCorner;
        attribute vec4 aPos;
        attribute vec2 aShape;
        uniform vec3 uAmbient;
        varying vec2 vC;
        varying vec3 vLight;
        varying float vFade;
        varying vec2 vShape;
        void main() {
          vShape = aShape;
          vec3 p = aPos.xyz;
          float r = aPos.w;
          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 rc = cross(vec3(0.0, 1.0, 0.0), toCam);
          float rl = length(rc);
          vec3 right = rl > 1e-5 ? rc / rl : vec3(1.0, 0.0, 0.0);
          vec3 up = normalize(cross(toCam, right) + vec3(0.0, 1e-6, 0.0));
          float flt = aShape.x;
          vec3 wp = p + right * aCorner.x * r * (1.0 + flt * 0.25) + up * aCorner.y * r * (1.0 - flt * 0.45);
          float d = max(uWDepthBase - p.y, 0.0);
          vec3 L = uAmbient * exp(-uWKd * d);
          vec3 vdir = -toCam / max(dist, 1e-4);
          for (int i = 0; i < MAX_LAMPS; i++) {
            if (i >= uLampCount) break;
            vec3 ld;
            L += lampAt(i, p, ld) * 0.05;
          }
          vLight = L * exp(-uWSigma * dist);
          vFade = smoothstep(0.06, 0.25, dist) * (1.0 - smoothstep(18.0, 26.0, dist));
          vC = aCorner;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uWTime;
        varying vec2 vC;
        varying vec3 vLight;
        varying float vFade;
        varying vec2 vShape;
        void main() {
          vec2 q = vC;
          float flt = vShape.x;
          // mushroom cap for large bubbles: flattened, slightly concave underside
          if (q.y < 0.0) q.y *= 1.0 + flt * 1.1;
          float ang = atan(q.y, q.x);
          float wob = 1.0 + (0.018 + flt * 0.04) * sin(ang * 2.0 + uWTime * 9.0 + vShape.y * 40.0)
                          + (0.01 + flt * 0.02) * sin(ang * 3.0 - uWTime * 12.0 + vShape.y * 17.0);
          float r = length(q) / wob;
          if (r > 1.0) discard;
          // mercury-silver: total internal reflection brightens toward the rim, clearer core
          float shell = smoothstep(0.35, 0.96, r);
          float aa = 1.0 - smoothstep(0.95, 1.0, r);
          float g1 = smoothstep(0.30, 0.0, length(q - vec2(-0.30, 0.38)));
          float g2 = smoothstep(0.16, 0.0, length(q - vec2(0.30, -0.32))) * 0.5;
          float lum = (0.2 + 1.3 * shell * shell * shell) * aa + (g1 * 1.4 + g2);
          float a = clamp((0.25 + 0.7 * shell * shell) * aa + g1 * 0.4, 0.0, 1.0) * vFade;
          gl_FragColor = vec4(vLight * lum * vFade, a);
        }
      `,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'bubbles';
  }

  spawn(x, y, z, r, vx = 0, vy = 0, vz = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.r[i] = r; this.age[i] = 0; this.ph[i] = Math.random() * 100; this.seed[i] = Math.random();
  }

  kill(i) {
    const j = --this.n;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.r[i] = this.r[j]; this.age[i] = this.age[j]; this.ph[i] = this.ph[j]; this.seed[i] = this.seed[j];
  }

  /** Burst of bubbles at a point (e.g. regulator exhaust). */
  burst(pos, { count = 20, rMin = 0.002, rMax = 0.014, spread = 0.04, vel = null } = {}) {
    for (let k = 0; k < count; k++) {
      const r = rMin + (rMax - rMin) * Math.pow(Math.random(), 2.2);
      this.spawn(
        pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread, pos.z + (Math.random() - 0.5) * spread, r,
        (vel ? vel.x : 0) + (Math.random() - 0.5) * 0.25, (vel ? vel.y : 0) + Math.random() * 0.15, (vel ? vel.z : 0) + (Math.random() - 0.5) * 0.25,
      );
    }
  }

  /** Continuous emission. getPos() returns a world position each tick. */
  stream({ getPos, rate = 40, duration = 0.8, rMin = 0.002, rMax = 0.012, spread = 0.03, getVel = null }) {
    const s = { getPos, rate, duration, rMin, rMax, spread, getVel, t: 0, acc: 0 };
    this.streams.push(s);
    return s;
  }

  clear() { this.n = 0; this.streams.length = 0; }

  update(dt, env, camera) {
    this.depthBase = env.depthBase;
    // streams
    for (let k = this.streams.length - 1; k >= 0; k--) {
      const s = this.streams[k];
      s.t += dt; s.acc += dt * s.rate;
      const pos = s.getPos();
      const vel = s.getVel ? s.getVel() : null;
      while (s.acc >= 1) { s.acc -= 1; this.burst(pos, { count: 1, rMin: s.rMin, rMax: s.rMax, spread: s.spread, vel }); }
      if (s.duration > 0 && s.t >= s.duration) this.streams.splice(k, 1);
    }
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const base = this.depthBase;
    for (let i = this.n - 1; i >= 0; i--) {
      const r = this.r[i];
      this.age[i] += dt;
      const depthOld = Math.max(base - this.py[i], 0);
      // terminal rise speed (m/s) by radius; larger bubbles become spherical caps
      const vt = Math.min(0.62, 0.17 + 9.0 * r) * (r > 0.02 ? 1.1 : 1.0);
      const k = 1 - Math.exp(-dt * 3.0);
      this.vy[i] += (vt - this.vy[i]) * k;
      this.vx[i] += (env.current.x - this.vx[i]) * k * 0.5;
      this.vz[i] += (env.current.z - this.vz[i]) * k * 0.5;
      const ph = (this.ph[i] += dt * (14 - Math.min(r * 400, 9)));
      const wob = Math.min(r * 2.2, 0.03);
      this.px[i] += (this.vx[i] + Math.cos(ph) * wob * 6) * dt;
      this.pz[i] += (this.vz[i] + Math.sin(ph * 1.3) * wob * 6) * dt;
      this.py[i] += this.vy[i] * dt;
      // Boyle's law growth
      const depthNew = Math.max(base - this.py[i], 0);
      const ratio = (1 + depthOld / 10) / (1 + depthNew / 10);
      this.r[i] = r * Math.cbrt(ratio);
      // breakup of large bubbles
      if (this.r[i] > 0.011 && Math.random() < dt * 1.2) {
        const rr = this.r[i];
        const nChild = 2 + (Math.random() < 0.35 ? 1 : 0);
        const rc = rr * Math.cbrt(1 / nChild);
        this.r[i] = rc;
        for (let c = 1; c < nChild; c++) this.spawn(this.px[i] + (Math.random() - 0.5) * rr * 2, this.py[i], this.pz[i] + (Math.random() - 0.5) * rr * 2, rc * (0.8 + Math.random() * 0.3), (Math.random() - 0.5) * 0.2, this.vy[i], (Math.random() - 0.5) * 0.2);
      }
      const dx = this.px[i] - cx, dy = this.py[i] - cy, dz = this.pz[i] - cz;
      if (this.py[i] > base - 0.03 || dx * dx + dy * dy + dz * dz > 900 || this.age[i] > 90) this.kill(i);
    }
    // upload
    const P = this.aPos.array, S = this.aShape.array;
    for (let i = 0; i < this.n; i++) {
      P[i * 4] = this.px[i]; P[i * 4 + 1] = this.py[i]; P[i * 4 + 2] = this.pz[i]; P[i * 4 + 3] = this.r[i];
      S[i * 2] = THREE.MathUtils.clamp((this.r[i] - 0.007) / 0.018, 0, 1); S[i * 2 + 1] = this.seed[i];
    }
    this.aPos.needsUpdate = true; this.aShape.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.n * 4);
    this.aShape.clearUpdateRanges(); this.aShape.addUpdateRange(0, this.n * 2);
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0 && !env.above;
    const s = (env.sunIntensity * 0.5 + env.skyIntensity) * env.naturalLight;
    this.uniforms.uAmbient.value.set(0.55 * s, 0.75 * s, 0.9 * s);
  }
}
