import * as THREE from 'three';
import { getSharedWaterUniforms, patchMaterial } from './water/patch.js';
import { WATER_UNIFORMS_GLSL, WATER_FUNCS_GLSL } from './water/waterGLSL.js';
import { lamps, LAMP_GLSL } from './Lamps.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/**
 * Bioluminescent sparks in the water around the camera: mostly blue-green flashes from small plankton, some
 * brighter longer glows, and flashes triggered mechanically in the pod's wake. Additive points, HDR so bloom
 * picks them up; they read best once the floods are off and the eye has adapted.
 */
export class BioLum {
  constructor({ count = 2600, box = 26 } = {}) {
    this.count = count; this.box = box;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box; pos[i * 3 + 2] = Math.random() * box;
      seed[i * 4] = Math.random(); seed[i * 4 + 1] = 0.15 + Math.random() * 0.85; seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uTime: { value: 0 }, uBox: { value: box }, uOrigin: { value: new THREE.Vector3() },
      uPod: { value: new THREE.Vector3() }, uPodVel: { value: new THREE.Vector3() }, uGain: { value: 1 }, uPx: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uBox, uGain, uPx; uniform vec3 uOrigin, uPod, uPodVel;
        varying vec3 vCol; varying float vI;
        void main() {
          vec3 p = mod(position - uOrigin, uBox) + uOrigin - uBox * 0.5;
          // spontaneous flashes: brief, rare, at random times
          float rate = mix(0.04, 0.4, aSeed.y);
          float ph = fract(uTime * rate + aSeed.x);
          float flash = exp(-ph * mix(60.0, 9.0, aSeed.z)) * step(0.55, aSeed.w);
          // mechanical stimulation in the pod's wake
          vec3 rel = p - uPod;
          float dist = length(rel);
          float wake = smoothstep(5.5, 1.0, dist) * clamp(length(uPodVel) * 2.0 - 0.2, 0.0, 1.0);
          float wakeFlash = wake * (0.5 + 0.5 * sin(uTime * (6.0 + aSeed.y * 10.0) + aSeed.x * 40.0));
          float I = (flash + wakeFlash * 0.8) * uGain;
          vI = I;
          vCol = mix(vec3(0.15, 0.75, 1.0), vec3(0.3, 1.0, 0.55), step(0.82, aSeed.z));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPx * (1.6 + aSeed.y * 2.0) * (8.0 / max(1.0, -mv.z)), 1.0, 5.0) * step(0.002, I);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vI;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = exp(-dot(c, c) * 14.0);
          gl_FragColor = vec4(vCol * vI * a * 6.0, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  update(dt, camera, pod) {
    const u = this.uniforms;
    u.uTime.value += dt;
    camera.getWorldPosition(u.uOrigin.value);
    if (pod) { u.uPod.value.copy(pod.pos); u.uPodVel.value.copy(pod.vel); }
    u.uPx.value = Math.min(2, window.devicePixelRatio || 1);
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

/**
 * Black-smoker plume: soft billboards of dark, metal-sulphide-laden fluid rising and spreading from an orifice,
 * lit only by the pod's lamps (with a faint shimmer just above the vent).
 */
export class SmokePlume {
  constructor(origin, { count = 90, rise = 1.2, height = 26, spread = 0.12, color = new THREE.Color(0.17, 0.16, 0.155), shimmer = 1 } = {}) {
    this.origin = origin.clone(); this.count = count; this.rise = rise; this.height = height; this.spread = spread;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.ages = new Float32Array(count);
    this.seeds = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) { this.ages[i] = (i / count) * (height / rise); this.seeds[i * 2] = Math.random(); this.seeds[i * 2 + 1] = Math.random(); }
    this.offsets = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.offsets.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', this.offsets);
    geo.instanceCount = count;
    const shared = getSharedWaterUniforms();
    this.uniforms = { ...shared, ...lamps.uniforms, uColor: { value: color }, uShimmer: { value: shimmer }, uOrigin: { value: this.origin } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 aP; // xyz centre, w = size
        varying vec2 vUv; varying vec3 vW; varying float vAge;
        void main() {
          vUv = position.xy + 0.5;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 w = aP.xyz + (right * position.x + up * position.y) * aP.w;
          vW = w; vAge = aP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${WATER_UNIFORMS_GLSL}
        ${WATER_FUNCS_GLSL}
        ${LAMP_GLSL}
        uniform vec3 uColor; uniform float uShimmer; uniform vec3 uOrigin;
        varying vec2 vUv; varying vec3 vW; varying float vAge;
        float h(vec2 p) { return fract(sin(dot(p, vec2(17.1, 83.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c);
          float n = n2(vUv * 4.0 + vW.xy * 0.7 + uWTime * 0.3) * 0.6 + n2(vUv * 9.0 - uWTime * 0.5) * 0.4;
          float a = smoothstep(0.5, 0.1, r + (n - 0.5) * 0.35);
          float hgt = vW.y - uOrigin.y;
          a *= smoothstep(0.0, 0.6, hgt) * (1.0 - smoothstep(18.0, 26.0, hgt)) * 0.75;
          vec3 light = vec3(0.0);
          for (int i = 0; i < MAX_LAMPS; i++) { if (i >= uLampCount) break; vec3 ld; light += lampAt(i, vW, ld) * 0.35; }
          vec3 col = uColor * (light * 2.2 + 0.002);
          col = wApplyMedium(col, vW);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  update(dt) {
    const o = this.origin, a = this.offsets.array;
    const life = this.height / this.rise;
    for (let i = 0; i < this.count; i++) {
      this.ages[i] += dt;
      if (this.ages[i] > life) this.ages[i] -= life;
      const t = this.ages[i], h = t * this.rise * (1 - 0.35 * t / life);
      const s1 = this.seeds[i * 2], s2 = this.seeds[i * 2 + 1];
      const wob = Math.sin(t * 1.3 + s1 * 20) * (0.2 + h * this.spread * 0.6);
      a[i * 4] = o.x + Math.cos(s1 * 6.28) * h * this.spread + wob;
      a[i * 4 + 1] = o.y + h;
      a[i * 4 + 2] = o.z + Math.sin(s1 * 6.28) * h * this.spread + Math.cos(t * 1.1 + s2 * 20) * (0.2 + h * this.spread * 0.6);
      a[i * 4 + 3] = 0.35 + h * (0.22 + this.spread) + s2 * 0.4;
    }
    this.offsets.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/**
 * Liquid CO2 droplets seeping from the sediment: milky beads wrapped in a thin hydrate skin, rising in wavering
 * columns (instanced spheres; CPU simulated).
 */
export class Droplets {
  constructor(sources, { count = 260, rise = 0.16 } = {}) {
    this.sources = sources; this.count = count; this.rise = rise;
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xe8eef0, roughness: 0.15, metalness: 0, transmission: 0, transparent: true, opacity: 0.82, clearcoat: 0.6 });
    patchMaterial(mat, { key: 'co2drop', envGain: 1.6, wrap: 0.4 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(count * 3); this.r = new Float32Array(count); this.ph = new Float32Array(count); this.src = new Uint16Array(count);
    for (let i = 0; i < count; i++) this._spawn(i, Math.random() * 30);
  }

  _spawn(i, preAge = 0) {
    const k = Math.floor(Math.random() * this.sources.length);
    const s = this.sources[k];
    this.src[i] = k;
    this.p[i * 3] = s.x + (Math.random() - 0.5) * 0.25;
    this.p[i * 3 + 1] = s.y + preAge * this.rise;
    this.p[i * 3 + 2] = s.z + (Math.random() - 0.5) * 0.25;
    this.r[i] = 0.006 + Math.random() * 0.014;
    this.ph[i] = Math.random() * 6.28;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const s = this.sources[this.src[i]];
      this.ph[i] += dt * 2.2;
      this.p[i * 3] += Math.sin(this.ph[i]) * dt * 0.03;
      this.p[i * 3 + 2] += Math.cos(this.ph[i] * 0.8) * dt * 0.03;
      this.p[i * 3 + 1] += dt * this.rise * (0.8 + this.r[i] * 20);
      if (this.p[i * 3 + 1] - s.y > 6 + (i % 5)) this._spawn(i);
      const r = this.r[i];
      _q.identity();
      _s.set(r, r * 0.86, r);
      _v.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      _m.compose(_v, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
