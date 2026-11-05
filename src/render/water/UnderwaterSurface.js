import * as THREE from 'three';
import { WATER_UNIFORMS_GLSL, WATER_FUNCS_GLSL } from './waterGLSL.js';
import { WAVES_GLSL } from './Caustics.js';
import { getSharedWaterUniforms } from './patch.js';

/**
 * The sea surface as seen from below: Snell's window (the whole sky squeezed into a ~97° cone),
 * total internal reflection outside it, moving waves, and the sun disc.
 */
export class UnderwaterSurface {
  constructor(lib) {
    const shared = getSharedWaterUniforms();
    this.uniforms = {
      ...shared,
      tRipple: { value: lib.rippleN },
      uSunAir: { value: new THREE.Vector3(0, 1, 0) },
      uWaveAmp: { value: 0.16 },
      uSkyGain: { value: 1.0 },
      uSunGain: { value: 1.0 },
    };
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.rotateX(Math.PI / 2); // normal facing down (towards the diver)
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        ${WATER_UNIFORMS_GLSL}
        ${WATER_FUNCS_GLSL}
        ${WAVES_GLSL}
        uniform sampler2D tRipple;
        uniform vec3 uSunAir;
        uniform float uWaveAmp, uSkyGain, uSunGain;
        varying vec3 vW;

        vec3 skyRadiance(vec3 d) {
          float h = clamp(d.y, 0.0, 1.0);
          vec3 zenith = vec3(0.26, 0.50, 1.00);
          vec3 horizon = vec3(1.00, 1.00, 1.00);
          vec3 sky = mix(horizon * 1.6, zenith, pow(h, 0.35)) * 2.4;
          float s = max(dot(d, uSunAir), 0.0);
          sky += vec3(1.0, 0.92, 0.80) * (pow(s, 6.0) * 1.2 + pow(s, 60.0) * 5.0);
          sky += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.99985, s) * 260.0 * uSunGain;
          return sky * uSkyGain * (uWSkyColor.b + uWSunColor.g * 0.12) * 0.55;
        }

        float fresnelWA(float cosi) {
          // exact unpolarised Fresnel, water (1.333) -> air (1.0)
          float n = 1.333;
          float sint2 = n * n * (1.0 - cosi * cosi);
          if (sint2 >= 1.0) return 1.0;
          float cost = sqrt(1.0 - sint2);
          float rs = (n * cosi - cost) / (n * cosi + cost);
          float rp = (cosi - n * cost) / (cosi + n * cost);
          return 0.5 * (rs * rs + rp * rp);
        }

        void main() {
          vec3 V = normalize(vW - cameraPosition);
          if (cameraPosition.y > vW.y) discard;
          float L = uWCausticScale;
          vec2 g = wavesGrad(vW.xz / L, uWTime, L, uWaveAmp) * 0.42;
          g += wavesGrad(vW.xz / (L * 3.7) + 0.31, uWTime * 0.8, L * 3.7, uWaveAmp * 2.2) * 0.30;
          vec2 r1 = texture2D(tRipple, vW.xz * 0.09 + uWTime * vec2(0.011, 0.019)).xy * 2.0 - 1.0;
          vec2 r2 = texture2D(tRipple, vW.xz * 0.23 - uWTime * vec2(0.021, 0.009)).xy * 2.0 - 1.0;
          vec2 rip = (r1 + r2 * 0.6) * 0.045;
          // distant surface looks calmer (normal filtering)
          float dist = length(vW - cameraPosition);
          float far = clamp(dist / 90.0, 0.0, 1.0);
          vec3 n = normalize(vec3(-(g.x + rip.x) * (1.0 - far * 0.7), 1.0, -(g.y + rip.y) * (1.0 - far * 0.7)));
          vec3 Nb = -n;
          float cosi = clamp(dot(V, n), 0.0, 1.0);
          float F = fresnelWA(cosi);
          vec3 T = refract(V, Nb, 1.333);
          vec3 sky = dot(T, T) > 1e-6 ? skyRadiance(normalize(T)) : vec3(0.0);
          vec3 R = reflect(V, Nb);
          vec3 refl = wInScatter(0.0, R, 300.0);
          vec3 col = sky * (1.0 - F) + refl * F;
          col = wApplyMedium(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'underwaterSurface';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(camera, env, far) {
    const m = this.mesh;
    m.visible = !env.above && env.cameraDepth < 140 && env.naturalLight > 0.01;
    m.position.set(camera.position.x, env.depthBase, camera.position.z);
    const s = far * 2.2;
    m.scale.set(s, 1, s);
    this.uniforms.uSunAir.value.copy(env.sunDirAir);
  }
}

/** Large sphere around the camera that shows the water medium at the far distance. */
export class WaterBackdrop {
  constructor() {
    const shared = getSharedWaterUniforms();
    this.uniforms = { ...shared, uFar: { value: 300 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 w = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * w;
          gl_Position.z = gl_Position.w * 0.99999;
        }
      `,
      fragmentShader: /* glsl */ `
        ${WATER_UNIFORMS_GLSL}
        ${WATER_FUNCS_GLSL}
        uniform float uFar;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float dc = wDepth(cameraPosition);
          float r = uFar;
          if (d.y > 0.0) r = min(r, max(dc, 0.0) / d.y);
          gl_FragColor = vec4(wInScatter(dc, d, r), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.name = 'waterBackdrop';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(camera, env, far) {
    this.mesh.visible = !env.above;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(far * 0.9);
    this.uniforms.uFar.value = far * 2;
  }
}
