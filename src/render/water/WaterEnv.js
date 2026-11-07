import * as THREE from 'three';
import { setSharedWaterUniforms } from './patch.js';

const N_WATER = 1.333;
const _v = new THREE.Vector3();
const _wbN = new THREE.Vector3();

/**
 * Water types: optical properties of the medium (per-RGB, 1/m).
 *  kd      – diffuse downwelling attenuation (controls how colour dies with depth)
 *  sigma   – beam attenuation for view and lamp paths (controls visibility)
 *  scatter – in-scatter coefficient (controls brightness/colour of the water itself)
 */
export const WATER_TYPES = {
  // Clear Guam reef water: ~35 m horizontal visibility, cyan-blue.
  reef: {
    kd: [0.40, 0.066, 0.031], sigma: [0.36, 0.078, 0.050], scatter: [0.0040, 0.0074, 0.0092],
    inScatterGain: 1.0, caustics: 1.0, causticScale: 5.5, godrays: 1.0, surge: 1.0,
    lightPath: 0.5,
  },
  // Off the wall: deep oceanic blue, very clear.
  blue: {
    kd: [0.42, 0.064, 0.026], sigma: [0.42, 0.070, 0.042], scatter: [0.0030, 0.0060, 0.0088],
    inScatterGain: 1.0, caustics: 0.9, causticScale: 6.0, godrays: 1.0, surge: 0.6,
    lightPath: 0.6,
  },
  // Deep ocean seen with lamps only: low scatter, the lamps reach ~15–20 m.
  deep: {
    kd: [0.42, 0.064, 0.026], sigma: [0.30, 0.07, 0.055], scatter: [0.0045, 0.008, 0.012],
    inScatterGain: 1.0, caustics: 0.0, causticScale: 6.0, godrays: 0.0, surge: 0.0,
    lightPath: 0.55,
  },
  // Sediment plume: resuspended silt, visibility of a metre or two in the floods.
  plume: {
    kd: [0.42, 0.064, 0.026], sigma: [1.1, 1.0, 0.95], scatter: [0.085, 0.078, 0.07],
    inScatterGain: 1.0, caustics: 0.0, causticScale: 6.0, godrays: 0.0, surge: 0.0,
    lightPath: 0.55,
  },
  // Hadal: fine resuspended sediment, slightly murkier.
  hadal: {
    kd: [0.42, 0.064, 0.026], sigma: [0.36, 0.11, 0.095], scatter: [0.012, 0.020, 0.026],
    inScatterGain: 1.0, caustics: 0.0, causticScale: 6.0, godrays: 0.0, surge: 0.0,
    lightPath: 0.55,
  },
};

export class WaterEnv {
  constructor() {
    this.uniforms = {
      uWTime: { value: 0 },
      uWDepthBase: { value: 0 },
      uWAbove: { value: 0 },
      uWKd: { value: new THREE.Vector3() },
      uWSigma: { value: new THREE.Vector3() },
      uWScatter: { value: new THREE.Vector3() },
      uWSunColor: { value: new THREE.Vector3() },
      uWSkyColor: { value: new THREE.Vector3() },
      uWSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uWCaustics: { value: 1 },
      uWCausticScale: { value: 5.5 },
      uWCausticMap: { value: null },
      uWHazeColor: { value: new THREE.Vector3(0.6, 0.7, 0.8) },
      uWHazeDensity: { value: 0.00008 },
      uWSurge: { value: new THREE.Vector2(1, 0.3) },
      uWSurgeAmp: { value: 1 },
      uWInScatterGain: { value: 1 },
      uWLightPath: { value: 0.6 },
    };
    setSharedWaterUniforms(this.uniforms);

    // Natural lights. Colours are set every frame from the sun model.
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1);
    this.hemi.name = 'sky';

    // Current state & blend targets
    this.type = { ...WATER_TYPES.reef };
    this.from = null; this.to = null; this.blendT = 1; this.blendDur = 1;
    this.depthBase = 0;
    this.sunElevation = 38;      // degrees, in air
    this.sunAzimuth = 130;       // degrees
    this.sunIntensity = 3.2;
    this.skyIntensity = 1.0;
    this.sunTint = new THREE.Color(1.0, 0.96, 0.9);
    this.skyTint = new THREE.Color(0.62, 0.78, 1.0);
    this.naturalLight = 1;       // 0 = night/deep (forced off)
    this.exposure = 1;
    this.exposureTarget = 1;
    this.exposureOverride = null;
    this.lampExposureCap = null; // set by lamp owners (torch / floodlights) while lit
    this.exposureBias = 1;
    this.bottomAlbedo = 0.3;
    // Partial chromatic adaptation (diver's eye / documentary white balance)
    this.whiteBalance = new THREE.Vector3(1, 1, 1);
    this.wbStrength = 0.6;
    this.wbMaxGain = 2.2;
    this.cameraDepth = 0;
    this.above = false;
    this.time = 0;
    this.sunDirAir = new THREE.Vector3();
    this.sunDirWater = new THREE.Vector3();
    this.surgeDir = new THREE.Vector2(1, 0.35).normalize();
    this.current = new THREE.Vector3(0, 0, 0);
    this.applyType(this.type);
    this.updateSun();
  }

  applyType(t) {
    const u = this.uniforms;
    u.uWKd.value.fromArray(t.kd);
    u.uWSigma.value.fromArray(t.sigma);
    u.uWScatter.value.fromArray(t.scatter);
    u.uWInScatterGain.value = t.inScatterGain;
    u.uWCausticScale.value = t.causticScale;
    u.uWLightPath.value = t.lightPath;
  }

  /** Set the water type instantly or blend to it over `dur` seconds. */
  setWaterType(nameOrObj, dur = 0, overrides = {}) {
    const base = typeof nameOrObj === 'string' ? WATER_TYPES[nameOrObj] : nameOrObj;
    const target = { ...base, ...overrides };
    if (dur <= 0) {
      this.type = { ...target };
      this.from = null; this.to = null; this.blendT = 1;
      this.applyType(this.type);
    } else {
      this.from = JSON.parse(JSON.stringify(this.type));
      this.to = target; this.blendT = 0; this.blendDur = dur;
    }
  }

  setSun({ elevation, azimuth, intensity, skyIntensity, tint, skyTint } = {}) {
    if (elevation !== undefined) this.sunElevation = elevation;
    if (azimuth !== undefined) this.sunAzimuth = azimuth;
    if (intensity !== undefined) this.sunIntensity = intensity;
    if (skyIntensity !== undefined) this.skyIntensity = skyIntensity;
    if (tint) this.sunTint.copy(tint);
    if (skyTint) this.skyTint.copy(skyTint);
    this.updateSun();
  }

  updateSun() {
    const el = THREE.MathUtils.degToRad(this.sunElevation);
    const az = THREE.MathUtils.degToRad(this.sunAzimuth);
    this.sunDirAir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    // Snell refraction of the zenith angle into the water.
    const zenA = Math.PI / 2 - el;
    const zenW = Math.asin(Math.sin(zenA) / N_WATER);
    const elW = Math.PI / 2 - zenW;
    this.sunDirWater.set(Math.cos(elW) * Math.sin(az), Math.sin(elW), Math.cos(elW) * Math.cos(az)).normalize();
  }

  /** Luminance of natural light at depth d (used for eye adaptation). */
  ambientAt(d) {
    const kd = this.uniforms.uWKd.value;
    const s = this.sunIntensity * this.naturalLight, k = this.skyIntensity * this.naturalLight;
    const r = Math.exp(-kd.x * d), g = Math.exp(-kd.y * d), b = Math.exp(-kd.z * d);
    const lum = 0.2126 * r * (s * this.sunTint.r * 0.5 + k * this.skyTint.r)
      + 0.7152 * g * (s * this.sunTint.g * 0.5 + k * this.skyTint.g)
      + 0.0722 * b * (s * this.sunTint.b * 0.5 + k * this.skyTint.b);
    return lum;
  }

  update(dt, camera) {
    this.time += dt;
    const u = this.uniforms;
    u.uWTime.value = this.time;
    u.uWDepthBase.value = this.depthBase;

    // Blend water types
    if (this.to && this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const t = this.blendT * this.blendT * (3 - 2 * this.blendT);
      const f = this.from, g = this.to, out = {};
      for (const k of Object.keys(g)) {
        const a = f[k], b = g[k];
        if (Array.isArray(b)) out[k] = b.map((v, i) => (a?.[i] ?? v) + (v - (a?.[i] ?? v)) * t);
        else if (typeof b === 'number') out[k] = (a ?? b) + (b - (a ?? b)) * t;
        else out[k] = b;
      }
      this.type = out;
      this.applyType(out);
      if (this.blendT >= 1) { this.from = null; this.to = null; }
    }

    camera.getWorldPosition(_v);
    this.cameraDepth = this.depthBase - _v.y;
    this.above = this.cameraDepth < 0;
    u.uWAbove.value = this.above ? 1 : 0;

    const nat = this.naturalLight;
    const sun = this.sunIntensity * nat, sky = this.skyIntensity * nat;
    u.uWSunColor.value.set(this.sunTint.r * sun, this.sunTint.g * sun, this.sunTint.b * sun);
    u.uWSkyColor.value.set(this.skyTint.r * sky, this.skyTint.g * sky, this.skyTint.b * sky);
    const sd = this.above ? this.sunDirAir : this.sunDirWater;
    u.uWSunDir.value.copy(this.sunDirWater);
    u.uWCaustics.value = this.type.caustics * nat;
    u.uWSurgeAmp.value = this.type.surge * THREE.MathUtils.clamp(1 - Math.max(this.cameraDepth, 0) / 45, 0.15, 1);
    u.uWSurge.value.set(this.surgeDir.x, this.surgeDir.y);

    // Sun & sky lights (attenuation by depth happens per fragment in the shader)
    this.sun.color.setRGB(this.sunTint.r, this.sunTint.g, this.sunTint.b);
    this.sun.intensity = sun;
    this.sun.position.copy(_v).addScaledVector(sd, 60);
    this.sunTarget.position.copy(_v);
    this.sunTarget.updateMatrixWorld();
    this.hemi.color.setRGB(this.skyTint.r, this.skyTint.g, this.skyTint.b);
    if (this.above) this.hemi.groundColor.setRGB(0.22, 0.25, 0.27);
    else {
      // upwelling light: reflection from the bottom (bright sand) plus water backscatter
      const gb = this.bottomAlbedo;
      this.hemi.groundColor.setRGB(this.skyTint.r * gb * 0.8, this.skyTint.g * gb, this.skyTint.b * gb);
    }
    // the underwater light field becomes more diffuse with depth
    this.hemi.intensity = sky * (this.above ? 1 : 1 + Math.min(Math.max(this.cameraDepth, 0), 60) * 0.04);
    this.sun.visible = sun > 0.0001;
    this.hemi.visible = sky > 0.0001;

    // Eye adaptation
    if (this.exposureOverride !== null) {
      this.exposureTarget = this.exposureOverride;
    } else {
      const d = Math.max(this.cameraDepth, 0);
      const lum = this.above ? (this.sunIntensity * 0.5 + this.skyIntensity) * nat : this.ambientAt(d);
      // near-complete adaptation (the eye keeps deep scenes readable), slightly less at the surface
      this.exposureTarget = THREE.MathUtils.clamp(0.70 / Math.pow(lum + 0.02, 0.9), 0.45, 8.0);
      // a lit torch caps adaptation fully in the dark, but only trims it where daylight still dominates
      if (this.lampExposureCap !== null) {
        const day = THREE.MathUtils.smoothstep(lum, 0.02, 0.15);
        const cap = THREE.MathUtils.lerp(this.lampExposureCap, Math.max(this.lampExposureCap, this.exposureTarget * 0.72), day);
        this.exposureTarget = Math.min(this.exposureTarget, cap);
      }
    }
    const k = 1 - Math.exp(-dt * 1.6);
    this.exposure += (this.exposureTarget * this.exposureBias - this.exposure) * k;

    // White balance towards the colour of the ambient natural light at the eye (capped, partial).
    const wb = this.whiteBalance;
    if (this.above) wb.lerp(_wbN.set(1, 1, 1), Math.min(1, dt * 3));
    else {
      const d = Math.max(this.cameraDepth, 0);
      const kd = this.uniforms.uWKd.value;
      // light at the eye also travels ~4 m horizontally to the scene: include a short view path
      const sg = this.uniforms.uWSigma.value;
      const r = Math.exp(-kd.x * d - sg.x * 4) * (this.sunTint.r * 0.6 + this.skyTint.r);
      const g = Math.exp(-kd.y * d - sg.y * 4) * (this.sunTint.g * 0.6 + this.skyTint.g);
      const b = Math.exp(-kd.z * d - sg.z * 4) * (this.sunTint.b * 0.6 + this.skyTint.b);
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nat = THREE.MathUtils.smoothstep(this.ambientAt(d), 0.0004, 0.02);
      const a = this.wbStrength * nat;
      const cap = this.wbMaxGain;
      _wbN.set(
        Math.min(cap, Math.pow(L / Math.max(r, 1e-6), a)),
        Math.min(cap, Math.pow(L / Math.max(g, 1e-6), a)),
        Math.min(cap, Math.pow(L / Math.max(b, 1e-6), a)),
      );
      const lw = 0.2126 * _wbN.x + 0.7152 * _wbN.y + 0.0722 * _wbN.z;
      _wbN.divideScalar(lw);
      wb.lerp(_wbN, Math.min(1, dt * 2));
    }
  }
}
