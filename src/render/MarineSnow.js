import * as THREE from 'three';
import { getSharedWaterUniforms } from './water/patch.js';
import { WATER_UNIFORMS_GLSL } from './water/waterGLSL.js';
import { LAMP_GLSL, lamps } from './Lamps.js';

/**
 * Suspended particles / marine snow in a box that wraps around the camera.
 * Lit by ambient natural light (depth-attenuated) and by lamps (backscatter), streaked by motion.
 */
export class MarineSnow {
  constructor({ count = 4000, box = 18, size = 0.012, sink = 0.02, brightness = 1, seed = 1, name = 'snow' } = {}) {
    this.maxCount = count;
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(quad, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < count * 4; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    this.geo = geo;

    this.uniforms = {
      ...getSharedWaterUniforms(),
      ...lamps.uniforms,
      uBox: { value: box },
      uSize: { value: size },
      uSink: { value: sink },
      uBright: { value: brightness },
      uAmbient: { value: new THREE.Vector3(0.1, 0.2, 0.3) },
      uCamVel: { value: new THREE.Vector3() },
      uShutter: { value: 0.03 },
      uViewport: { value: new THREE.Vector2(1920, 1080) },
      uDrift: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Vector3(1.0, 0.97, 0.9) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        ${WATER_UNIFORMS_GLSL}
        ${LAMP_GLSL}
        attribute vec2 aCorner;
        attribute vec4 aSeed;
        uniform float uBox, uSize, uSink, uBright, uShutter;
        uniform vec3 uAmbient, uCamVel, uDrift, uTint;
        uniform vec2 uViewport;
        varying vec2 vC;
        varying float vLen;
        varying vec3 vCol;
        void main() {
          vec3 p = aSeed.xyz * uBox;
          float t = uWTime;
          // slow sinking + tumbling drift
          p.y -= t * uSink * (0.5 + aSeed.w);
          p += uDrift;
          p += vec3(sin(t * 0.31 + aSeed.w * 40.0), sin(t * 0.23 + aSeed.x * 31.0) * 0.5, cos(t * 0.27 + aSeed.y * 23.0)) * 0.12;
          vec3 cam = cameraPosition;
          p = cam + mod(p - cam + uBox * 0.5, uBox) - uBox * 0.5;

          vec3 V = p - cam;
          float dist = length(V);
          // lighting: ambient (natural, depth attenuated) + lamps (backscatter)
          float d = max(uWDepthBase - p.y, 0.0);
          vec3 col = uAmbient * exp(-uWKd * d) * (uWAbove > 0.5 ? 0.0 : 1.0);
          vec3 vdir = V / max(dist, 1e-4);
          for (int i = 0; i < MAX_LAMPS; i++) {
            if (i >= uLampCount) break;
            vec3 ld;
            vec3 I = lampAt(i, p, ld);
            float ph = 0.35 + 0.65 * pow(max(dot(ld, -vdir) * 0.5 + 0.5, 0.0), 2.0);
            col += I * ph * 0.22;
          }
          col *= exp(-uWSigma * dist) * uBright * uTint * (0.5 + aSeed.w);
          // fade near the box edge and very close to the lens
          float edge = 1.0 - smoothstep(uBox * 0.38, uBox * 0.5, dist);
          float nearF = smoothstep(0.12, 0.45, dist);
          col *= edge * nearF;

          vec4 vp = viewMatrix * vec4(p, 1.0);
          vec3 vel = (viewMatrix * vec4(-uCamVel, 0.0)).xyz;
          vec4 c0 = projectionMatrix * vp;
          vec4 c1 = projectionMatrix * vec4(vp.xyz - vel * uShutter, 1.0);
          vec2 s0 = c0.xy / c0.w, s1 = c1.xy / max(c1.w, 1e-3);
          float sizeW = uSize * (0.6 + aSeed.w * 0.9);
          float halfPx = max(sizeW * projectionMatrix[1][1] * uViewport.y * 0.5 / c0.w, 0.9);
          // out-of-focus near particles grow and dim (bokeh)
          float bok = 1.0 + smoothstep(1.2, 0.2, dist) * 2.5;
          halfPx *= bok; col /= bok * bok;
          vec2 dirPx = (s0 - s1) * uViewport * 0.5;
          float lenPx = length(dirPx);
          vec2 dir = lenPx > 0.01 ? dirPx / lenPx : vec2(0.0, 1.0);
          vec2 perp = vec2(dir.y, -dir.x);
          float segHalf = lenPx * 0.5;
          vLen = 1.0 + segHalf / halfPx;
          col /= vLen;   // streaks spread the same energy
          vec2 midPx = (s0 + s1) * 0.5 * uViewport * 0.5;
          vec2 offPx = perp * aCorner.x * halfPx + dir * aCorner.y * (halfPx + segHalf);
          vec2 ndc = (midPx + offPx) / (uViewport * 0.5);
          gl_Position = vec4(ndc * c0.w, c0.z, c0.w);
          if (c0.w < 0.05) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          vC = aCorner;
          vCol = col;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vC;
        varying float vLen;
        varying vec3 vCol;
        void main() {
          vec2 q = vec2(vC.x, max(abs(vC.y) * vLen - (vLen - 1.0), 0.0));
          float r = length(q);
          float a = smoothstep(1.0, 0.15, r);
          gl_FragColor = vec4(vCol * a, 1.0);
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = name;
    this.mesh.renderOrder = 5;
    this.prevCam = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.density = 1;
  }

  setDensity(d) {
    this.density = THREE.MathUtils.clamp(d, 0, 1);
    this.geo.instanceCount = Math.floor(this.maxCount * this.density);
    this.mesh.visible = this.geo.instanceCount > 0;
  }

  update(dt, camera, env, viewport) {
    const u = this.uniforms;
    if (dt > 0) {
      this.vel.copy(camera.position).sub(this.prevCam).divideScalar(Math.max(dt, 1e-3));
      if (this.vel.length() > 50) this.vel.set(0, 0, 0); // teleport
    }
    this.prevCam.copy(camera.position);
    u.uCamVel.value.lerp(this.vel, Math.min(1, dt * 12));
    u.uViewport.value.copy(viewport);
    u.uDrift.value.addScaledVector(env.current, dt);
    const s = env.sunIntensity * env.naturalLight * 0.35 + env.skyIntensity * env.naturalLight * 0.5;
    u.uAmbient.value.set(s * 0.22, s * 0.27, s * 0.3);
    this.mesh.visible = !env.above && this.geo.instanceCount > 0;
  }
}
