import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Gerstner wave set (direction deg, wavelength m, amplitude m, steepness 0..1). Calm morning trade-wind sea.
export const OCEAN_WAVES = [
  [70, 118, 0.42, 0.35], [95, 64, 0.22, 0.45], [40, 31, 0.10, 0.55], [120, 17, 0.055, 0.6], [15, 9.5, 0.03, 0.6], [150, 6.1, 0.018, 0.5],
];
const G = 9.81;

/** CPU evaluation of the ocean surface height (same wave set as the shader, ignoring horizontal drift). */
export function oceanHeight(x, z, t, k = 1) {
  let y = 0;
  for (const [dir, L, A] of OCEAN_WAVES) {
    const d = THREE.MathUtils.degToRad(dir);
    const kk = (2 * Math.PI) / L, c = Math.sqrt(G / kk);
    y += A * k * Math.sin(kk * (Math.cos(d) * x + Math.sin(d) * z - c * t));
  }
  return y;
}

const OCEAN_WAVES_GLSL = `
#define NOW ${OCEAN_WAVES.length}
const vec4 OW[NOW] = vec4[NOW](${OCEAN_WAVES.map(([d, L, A, Q]) => `vec4(${THREE.MathUtils.degToRad(d).toFixed(5)}, ${L.toFixed(3)}, ${A.toFixed(4)}, ${Q.toFixed(3)})`).join(', ')});
`;

export class AboveWater {
  constructor(engine) {
    this.engine = engine;
    const lib = engine.lib;
    // ---------------- sky ----------------
    this.sky = new Sky();
    this.sky.scale.setScalar(18000);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    const su = this.sky.material.uniforms;
    su.turbidity.value = 2.0; su.rayleigh.value = 1.3; su.mieCoefficient.value = 0.0028; su.mieDirectionalG.value = 0.78;
    su.cloudCoverage.value = 0.32; su.cloudDensity.value = 0.45; su.cloudScale.value = 0.00022; su.cloudElevation.value = 0.55;
    this.skyScene = new THREE.Scene();
    this.skyForCube = new Sky();
    this.skyForCube.material.uniforms = su; // share uniforms
    this.skyForCube.scale.setScalar(1000);
    this.skyScene.add(this.skyForCube);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(engine.renderer);
    this.envRT = null;

    // ---------------- ocean ----------------
    this.uniforms = {
      uTime: { value: 0 },
      tSky: { value: this.cubeRT.texture },
      tRipple: { value: lib.rippleN },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Vector3(1, 1, 1) },
      uDeep: { value: new THREE.Vector3(0.002, 0.016, 0.04) },
      uSSS: { value: new THREE.Vector3(0.0, 0.09, 0.08) },
      uHaze: { value: new THREE.Vector3(0.6, 0.7, 0.8) },
      uHazeDensity: { value: 0.00012 },
      uSkyScale: { value: 1 },
      uWaveScale: { value: 1 },
    };
    this.mesh = new THREE.Mesh(this._oceanGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        ${OCEAN_WAVES_GLSL}
        uniform float uTime, uWaveScale;
        varying vec3 vW;
        varying vec3 vN;
        varying float vCrest;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec3 p = w.xyz;
          float fade = 1.0 - smoothstep(600.0, 3500.0, length(p.xz - cameraPosition.xz));
          vec3 disp = vec3(0.0);
          vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
          float crest = 0.0;
          for (int i = 0; i < NOW; i++) {
            vec4 o = OW[i];
            vec2 D = vec2(cos(o.x), sin(o.x));
            float k = 6.2831853 / o.y;
            float c = sqrt(9.81 / k);
            float A = o.z * uWaveScale * fade;
            float Q = o.w / (k * max(o.z, 1e-4) * float(NOW));
            float f = k * (dot(D, p.xz) - c * uTime);
            float cf = cos(f), sf = sin(f);
            disp.x += Q * A * D.x * cf; disp.z += Q * A * D.y * cf; disp.y += A * sf;
            float wa = k * A;
            T += vec3(-Q * D.x * D.x * wa * sf, D.x * wa * cf, -Q * D.x * D.y * wa * sf);
            B += vec3(-Q * D.x * D.y * wa * sf, D.y * wa * cf, -Q * D.y * D.y * wa * sf);
            crest += max(sf, 0.0) * wa;
          }
          p += disp;
          vN = normalize(cross(B, T));
          vCrest = crest;
          vW = p;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSkyScale, uHazeDensity;
        uniform samplerCube tSky;
        uniform sampler2D tRipple;
        uniform vec3 uSunDir, uSunCol, uDeep, uSSS, uHaze;
        varying vec3 vW;
        varying vec3 vN;
        varying float vCrest;
        void main() {
          vec3 V = cameraPosition - vW;
          float dist = length(V);
          V /= dist;
          // ripple detail fades with distance (normal filtering)
          float df = 1.0 - smoothstep(30.0, 900.0, dist);
          vec2 r1 = texture2D(tRipple, vW.xz * 0.045 + uTime * vec2(0.012, 0.008)).xy * 2.0 - 1.0;
          vec2 r2 = texture2D(tRipple, vW.xz * 0.13 - uTime * vec2(0.02, 0.031)).xy * 2.0 - 1.0;
          vec2 r3 = texture2D(tRipple, vW.xz * 0.6 + uTime * vec2(0.05, -0.04)).xy * 2.0 - 1.0;
          vec3 N = normalize(vN + vec3(r1.x * 0.12 + r2.x * 0.07 + r3.x * 0.03, 0.0, r1.y * 0.12 + r2.y * 0.07 + r3.y * 0.03) * df);
          float NdV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, N);
          R.y = max(R.y, 0.015);
          vec3 refl = textureCube(tSky, R).rgb * uSkyScale;
          // body colour + light scattered back out of the water, strongest through backlit wave crests
          float sss = pow(max(dot(V, -uSunDir + N * 0.6), 0.0), 3.0) * (0.4 + vCrest * 1.8);
          vec3 body = uDeep * (0.6 + 0.4 * max(uSunDir.y, 0.0)) + uSSS * sss * max(uSunDir.y + 0.15, 0.0);
          vec3 col = mix(body, refl, F);
          // sun glitter
          vec3 H = normalize(uSunDir + V);
          float nh = max(dot(N, H), 0.0);
          col += uSunCol * (pow(nh, 900.0) * 18.0 + pow(nh, 120.0) * 0.6) * F * 4.0;
          // faint foam on the steepest crests
          float foam = smoothstep(0.55, 0.95, vCrest + r3.x * 0.15) * df * 0.35;
          col = mix(col, vec3(0.7) * (0.4 + uSunDir.y), foam);
          // aerial perspective
          float h = 1.0 - exp(-dist * uHazeDensity);
          col = mix(col, uHaze, h);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }));
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.group = new THREE.Group();
    this.group.name = 'aboveWater';
    this.group.add(this.sky, this.mesh);
    this.envDirty = true;
  }

  /** Radial grid: dense near the centre, sparse to the horizon. */
  _oceanGeometry() {
    const rings = 150, segs = 192;
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let r = 1; r <= rings; r++) {
      const rad = 0.6 * Math.pow(1.065, r) - 0.55;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  setSun(env) {
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(env.sunDirAir).multiplyScalar(450000);
    this.uniforms.uSunDir.value.copy(env.sunDirAir);
    const s = env.sunIntensity;
    this.uniforms.uSunCol.value.set(env.sunTint.r * s, env.sunTint.g * s, env.sunTint.b * s);
    this.envDirty = true;
  }

  /** Re-render the sky cube (reflections) and PMREM environment (PBR lighting). */
  refreshEnvironment() {
    const r = this.engine.renderer;
    this.cubeCam.update(r, this.skyScene);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 1, 2000);
    this.envDirty = false;
    return this.envRT.texture;
  }

  update(dt, camera, env) {
    this.uniforms.uTime.value = env.time;
    this.sky.material.uniforms.time.value = env.time;
    // the grid follows the camera, snapped to avoid swimming
    const snap = 4;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, env.depthBase, Math.round(camera.position.z / snap) * snap);
    this.sky.position.copy(camera.position);
    this.uniforms.uHaze.value.copy(env.uniforms.uWHazeColor.value);
    this.uniforms.uHazeDensity.value = env.uniforms.uWHazeDensity.value;
    this.group.visible = env.above;
  }

  dispose() {
    this.cubeRT.dispose();
    if (this.envRT) this.envRT.dispose();
    this.pmrem.dispose();
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.skyForCube.geometry.dispose();
  }
}
