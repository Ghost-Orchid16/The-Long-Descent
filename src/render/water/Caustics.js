import * as THREE from 'three';

// Tileable wave set shared by caustics, the surface-from-below shader and god rays.
// Integer wave vectors (cycles per tile) keep everything periodic over one caustic tile.
export const CAUSTIC_WAVES = [
  [2, 1], [-1, 3], [3, -2], [4, 2], [-3, -4], [5, 1], [1, -6], [-6, 2], [7, 3], [2, 8], [-8, -3], [9, -4],
];

export const WAVES_GLSL = /* glsl */ `
#define NWAVES ${CAUSTIC_WAVES.length}
const vec2 W_K[NWAVES] = vec2[NWAVES](${CAUSTIC_WAVES.map(([a, b]) => `vec2(${a.toFixed(1)}, ${b.toFixed(1)})`).join(', ')});
// Height gradient (m/m) of the tileable wave field. p in tile units, L = tile size in metres.
vec2 wavesGrad(vec2 p, float t, float L, float amp) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < NWAVES; i++) {
    vec2 k = W_K[i];
    float kl = length(k);
    float kappa = 6.2831853 * kl / L;
    float A = amp / pow(kl, 1.6);
    float w = sqrt(9.81 * kappa) * 0.55;
    float ph = 6.2831853 * dot(k, p) - w * t + float(i) * 1.7;
    g += A * kappa * cos(ph) * (k / kl);
  }
  return g;
}
`;

export class Caustics {
  constructor(renderer, { size = 512, grid = 160 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    this.rt.texture.name = 'caustics';

    const base = new THREE.PlaneGeometry(1, 1, grid, grid);
    base.translate(0.5, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const offs = [];
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) offs.push(x, y);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(offs), 2));
    geo.instanceCount = 9;
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uL: { value: 5.5 },
        uAmp: { value: 0.105 },
        uFocal: { value: 4.0 },
        uSunAir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uGain: { value: 0.11 },
      },
      vertexShader: /* glsl */ `
        ${WAVES_GLSL}
        uniform float uTime, uL, uAmp, uFocal;
        uniform vec3 uSunAir;
        attribute vec2 aOffset;
        varying vec2 vOld;
        varying vec2 vNew;
        void main() {
          vec2 p = position.xy;
          vec2 g = wavesGrad(p, uTime, uL, uAmp);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 I = -uSunAir;
          vec3 T = refract(I, n, 1.0 / 1.333);
          vec3 T0 = refract(I, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
          vec2 disp = T.xz * (uFocal / max(-T.y, 0.2)) - T0.xz * (uFocal / max(-T0.y, 0.2));
          vec2 hit = p + disp / uL;
          vOld = p;
          vNew = hit;
          gl_Position = vec4((hit + aOffset) * 2.0 - 1.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uGain;
        varying vec2 vOld;
        varying vec2 vNew;
        void main() {
          float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
          float newA = length(dFdx(vNew)) * length(dFdy(vNew));
          float I = oldA / max(newA, 1e-9);
          gl_FragColor = vec4(vec3(min(I, 40.0) * uGain), 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      extensions: {},
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.accum = 0;
    this.interval = 0; // seconds between updates (0 = every frame)
    this.normalise();
  }

  get texture() { return this.rt.texture; }

  /** Calibrate gain so the pattern's mean is ~1 (energy-preserving redistribution of light). */
  normalise() {
    // Area ratio of a flat sheet over the tile is 1 per covered texel, so the gain is the inverse of the
    // expected overlap (1). We keep a gentle boost for contrast.
    this.material.uniforms.uGain.value = 1.0;
  }

  setSun(sunDirAir) { this.material.uniforms.uSunAir.value.copy(sunDirAir); }

  update(dt, time, enabled = true) {
    if (!enabled) return;
    this.accum += dt;
    if (this.accum < this.interval) return;
    this.accum = 0;
    this.material.uniforms.uTime.value = time;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
  }

  dispose() {
    this.rt.dispose();
    this.geo.dispose();
    this.material.dispose();
  }
}
