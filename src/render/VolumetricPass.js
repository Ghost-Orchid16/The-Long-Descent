import * as THREE from 'three';
import { Pass } from 'postprocessing';
import { getSharedWaterUniforms } from './water/patch.js';
import { WATER_UNIFORMS_GLSL, WATER_FUNCS_GLSL } from './water/waterGLSL.js';
import { LAMP_GLSL, lamps } from './Lamps.js';
import { NOISE_GLSL } from './glsl/noise.js';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

/**
 * Single-scattering raymarch through the water: sun shafts (caustic focusing projected along the
 * refracted sun ray) and spot-lamp backscatter. Rendered at reduced resolution, then blurred.
 */
export class VolumetricPass extends Pass {
  constructor(camera, { scale = 0.5, steps = 20 } = {}) {
    super('VolumetricPass');
    this.needsDepthTexture = true;
    this.needsSwap = false;
    this.mainCam = camera;
    this.scale = scale;
    this.steps = steps;
    this.frame = 0;
    this.enabledShafts = 1;
    this.enabledLamps = 1;
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtA.texture.name = 'volumetric.A';

    this.marchMat = new THREE.ShaderMaterial({
      defines: { STEPS: steps },
      uniforms: {
        ...getSharedWaterUniforms(),
        ...lamps.uniforms,
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uNear: { value: 0.1 }, uFar: { value: 500 },
        uFrame: { value: 0 },
        uShafts: { value: 1 },
        uLampK: { value: 1 },
        uMaxDist: { value: 70 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        #include <packing>
        ${WATER_UNIFORMS_GLSL}
        ${NOISE_GLSL}
        ${WATER_FUNCS_GLSL}
        ${LAMP_GLSL}
        uniform sampler2D tDepth;
        uniform mat4 uProjInv, uCamWorld;
        uniform vec3 uCamPos;
        uniform float uNear, uFar, uFrame, uShafts, uLampK, uMaxDist;
        varying vec2 vUv;
        float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
        void main() {
          float depth = texture2D(tDepth, vUv).r;
          vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 vp = uProjInv * clip; vp.xyz /= vp.w;
          vec3 rd = normalize((uCamWorld * vec4(normalize(vp.xyz), 0.0)).xyz);
          vec3 ro = uCamPos;
          float tMax = depth >= 0.99999 ? uMaxDist : min(length(vp.xyz), uMaxDist);
          float dc = uWDepthBase - ro.y;
          if (dc <= 0.0) { gl_FragColor = vec4(0.0); return; }
          if (rd.y > 0.0) tMax = min(tMax, dc / rd.y);
          float jit = ign(gl_FragCoord.xy, uFrame);
          float dt = tMax / float(STEPS);
          vec3 sunAcc = vec3(0.0), lampAcc = vec3(0.0);
          bool doSun = uShafts > 0.001 && uWCaustics > 0.001;
          for (int i = 0; i < STEPS; i++) {
            float t = (float(i) + jit) * dt;
            vec3 p = ro + rd * t;
            vec3 Tv = exp(-uWSigma * t);
            if (doSun) {
              float d = uWDepthBase - p.y;
              if (d > 0.0) {
                vec2 surf = p.xz + uWSunDir.xz * (d / max(uWSunDir.y, 0.25));
                float lod = 3.2 + log2(1.0 + d * 0.25);
                float c = textureLod(uWCausticMap, surf / (uWCausticScale * 2.7), lod).r;
                float c2 = textureLod(uWCausticMap, surf / (uWCausticScale * 6.1) + 0.5, lod + 0.5).r;
                float shaft = max(c * c2 - 0.82, 0.0) * 1.6;
                float fade = smoothstep(42.0, 1.0, d) * (0.35 + 0.65 * smoothstep(30.0, 4.0, d));
                sunAcc += exp(-uWKd * d) * shaft * fade * Tv;
              }
            }
            for (int k = 0; k < MAX_LAMPS; k++) {
              if (k >= uLampCount) break;
              vec3 ld;
              vec3 I = lampAt(k, p, ld);
              float cs = dot(ld, -rd);
              float ph = 0.65 * hg(cs, 0.72) + 0.35 * hg(cs, -0.25);
              lampAcc += I * ph * Tv;
            }
          }
          vec3 sunCol = uWSunColor * wPhaseSun(rd) * uWScatter * uWInScatterGain * 2.2;
          vec3 res = (sunAcc * sunCol * uShafts + lampAcc * uWScatter * uLampK * 1.5) * dt;
          gl_FragColor = vec4(res, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null }, tDepth: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) }, uNear: { value: 0.1 }, uFar: { value: 500 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tSrc, tDepth;
        uniform vec2 uDir;
        uniform float uNear, uFar;
        varying vec2 vUv;
        float lin(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
        void main() {
          float w0 = 0.2270270270, w1 = 0.3162162162, w2 = 0.0702702703;
          float zc = lin(vUv);
          vec3 acc = texture2D(tSrc, vUv).rgb * w0;
          float wsum = w0;
          for (int s = -1; s <= 1; s += 2) {
            vec2 o1 = uDir * 1.3846153846 * float(s), o2 = uDir * 3.2307692308 * float(s);
            float z1 = lin(vUv + o1), z2 = lin(vUv + o2);
            float b1 = w1 * exp(-abs(z1 - zc) / max(zc * 0.08, 0.05));
            float b2 = w2 * exp(-abs(z2 - zc) / max(zc * 0.08, 0.05));
            acc += texture2D(tSrc, vUv + o1).rgb * b1 + texture2D(tSrc, vUv + o2).rgb * b2;
            wsum += b1 + b2;
          }
          gl_FragColor = vec4(acc / wsum, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.fullscreenMaterial = this.marchMat;
  }

  get texture() { return this.rtA.texture; }

  setDepthTexture(depthTexture) {
    this.marchMat.uniforms.tDepth.value = depthTexture;
    this.blurMat.uniforms.tDepth.value = depthTexture;
  }

  setSteps(n) {
    if (n === this.steps) return;
    this.steps = n;
    this.marchMat.defines.STEPS = n;
    this.marchMat.needsUpdate = true;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width * this.scale)), h = Math.max(1, Math.round(height * this.scale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.texel = new THREE.Vector2(1 / w, 1 / h);
  }

  render(renderer) {
    const cam = this.mainCam;
    const u = this.marchMat.uniforms;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uFrame.value = this.frame++ % 64;
    u.uShafts.value = this.enabledShafts;
    u.uLampK.value = this.enabledLamps;
    const bu = this.blurMat.uniforms;
    bu.uNear.value = cam.near; bu.uFar.value = cam.far;

    this.fullscreenMaterial = this.marchMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);

    this.fullscreenMaterial = this.blurMat;
    bu.tSrc.value = this.rtA.texture; bu.uDir.value.set(this.texel.x * 2.0, 0);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.camera);
    bu.tSrc.value = this.rtB.texture; bu.uDir.value.set(0, this.texel.y * 2.0);
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.marchMat.dispose(); this.blurMat.dispose();
  }
}
