import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, Effect, EffectAttribute, BlendFunction, DepthOfFieldEffect,
} from 'postprocessing';
import { VolumetricPass } from './VolumetricPass.js';

const U = (v) => new THREE.Uniform(v);

/** Adds volumetric scattering; narcosis tunnel vision; CO2/hypoxia dimming; panic pulse. (HDR, pre-tonemap) */
class WaterFXEffect extends Effect {
  constructor(volTex) {
    super('WaterFX', /* glsl */ `
      uniform sampler2D tVol;
      uniform float uVolGain, uNarcosis, uDim, uPulse, uClock, uRedFlash;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb + texture2D(tVol, uv).rgb * uVolGain;
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float r = length(q);
        float tunnel = smoothstep(0.18, 0.78, r) * uNarcosis;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, vec3(lum), tunnel * 0.55);
        c *= 1.0 - tunnel * 0.7;
        c *= 1.0 - uDim * (0.3 + 0.55 * smoothstep(0.15, 0.75, r));
        c *= 1.0 - uPulse * smoothstep(0.25, 0.85, r) * (0.55 + 0.45 * sin(uClock * 7.5));
        c += vec3(0.9, 0.05, 0.02) * uRedFlash * smoothstep(0.2, 0.9, r) * 0.15;
        outputColor = vec4(c, inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['tVol', U(volTex)], ['uVolGain', U(1)], ['uNarcosis', U(0)], ['uDim', U(0)], ['uPulse', U(0)], ['uClock', U(0)], ['uRedFlash', U(0)],
      ]),
    });
  }
}

/** Exposure, white balance, ACES (RRT+ODT fit), saturation, lift. */
class GradeEffect extends Effect {
  constructor() {
    super('Grade', /* glsl */ `
      uniform float uExposure, uSaturation, uContrast, uLift, uMesopic;
      uniform vec3 uWhite;
      vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        return clamp(OUT * rrtOdt(IN * c), 0.0, 1.0);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, vec3(0.0)) * uExposure * uWhite / 0.6;
        c = aces(c);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        // mesopic vision: dim natural-light scenes lose saturation (rods), lamp-lit bright areas keep colour (cones)
        float meso = uMesopic * (1.0 - smoothstep(0.2, 0.75, l));
        c = mix(c, vec3(l) * vec3(0.78, 1.0, 1.12), meso);
        c = mix(vec3(0.18), c, uContrast) + (0.18 - 0.18 * uContrast) * 0.0;
        c = max(c, 0.0) + uLift * (1.0 - c);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uExposure', U(1)], ['uSaturation', U(1)], ['uContrast', U(1)], ['uLift', U(0)], ['uMesopic', U(0)], ['uWhite', U(new THREE.Vector3(1, 1, 1))],
      ]),
    });
  }
}

/** Dive-mask frame: dark silicone skirt with nose pocket, faint inner lens edge, edge condensation. */
class MaskEffect extends Effect {
  constructor() {
    super('Mask', /* glsl */ `
      uniform float uMask;
      uniform float uFog;
      float mhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        if (uMask > 0.001) {
          vec2 p = (uv - 0.5) * 2.0;
          p.x *= aspect;
          vec2 a = abs(p) / vec2(aspect * 1.04, 1.06);
          float se = pow(pow(a.x, 4.0) + pow(a.y, 4.0), 0.25);
          // nose pocket: a soft rise of the frame at the bottom centre
          float nose = exp(-pow(p.x / 0.28, 2.0)) * smoothstep(-0.55, -1.05, p.y) * 0.16;
          float m = se + nose;
          float skirt = smoothstep(0.93, 1.07, m);
          vec3 skirtCol = c * 0.10 + vec3(0.002, 0.004, 0.005);
          c = mix(c, skirtCol, skirt * uMask);
          float edge = smoothstep(0.72, 0.97, m) * (1.0 - skirt);
          c *= 1.0 - edge * 0.18 * uMask;
          // light condensation beads at the lower lens edge
          float band = smoothstep(0.78, 0.93, m) * smoothstep(0.0, -0.6, p.y) * uFog;
          vec2 g = uv * vec2(aspect, 1.0) * 120.0;
          float bead = smoothstep(0.42, 0.25, length(fract(g) - 0.5)) * step(0.82, mhash(floor(g)));
          c = mix(c, c * 1.15 + 0.01, bead * band * 0.6 * uMask);
        }
        outputColor = vec4(c, inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uMask', U(0)], ['uFog', U(0.6)]]),
    });
  }
}

/** Film grain + fade to colour (used for transitions, blackouts, whiteouts). */
class FinalEffect extends Effect {
  constructor() {
    super('Final', /* glsl */ `
      uniform float uGrain, uSeed, uFade;
      uniform vec3 uFadeColor;
      float ghash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float n = ghash(uv * resolution + uSeed * 91.7) + ghash(uv * resolution * 1.37 + uSeed * 13.1) - 1.0;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c += n * uGrain * 0.018 * (0.3 + 0.7 * (1.0 - l));
        c = mix(c, uFadeColor, uFade);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uGrain', U(1)], ['uSeed', U(0)], ['uFade', U(0)], ['uFadeColor', U(new THREE.Vector3(0, 0, 0))]]),
    });
  }
}

/** Slight pincushion (flat mask port / viewport) and radial chromatic aberration at the edges. */
class LensEffect extends Effect {
  constructor() {
    super('Lens', /* glsl */ `
      uniform float uDistort, uCA;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 p = uv - 0.5;
        vec2 pa = p * vec2(aspect, 1.0);
        float r2 = dot(pa, pa);
        vec2 d = p * (1.0 + uDistort * r2);
        vec2 ca = d * uCA * r2;
        float rr = texture2D(inputBuffer, 0.5 + d + ca).r;
        float gg = texture2D(inputBuffer, 0.5 + d).g;
        float bb = texture2D(inputBuffer, 0.5 + d - ca).b;
        outputColor = vec4(rr, gg, bb, 1.0);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['uDistort', U(-0.05)], ['uCA', U(0.0055)]]),
    });
  }
}

export class PostFX {
  constructor(renderer, scene, camera, { quality = 'medium' } = {}) {
    this.renderer = renderer;
    this.camera = camera;
    const msaa = quality === 'high' ? 4 : quality === 'medium' ? 2 : 0;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: Math.min(msaa, renderer.capabilities.maxSamples) });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.vol = new VolumetricPass(camera, { scale: quality === 'low' ? 0.33 : 0.5, steps: quality === 'low' ? 12 : quality === 'medium' ? 18 : 26 });
    this.composer.addPass(this.vol);

    this.dof = new DepthOfFieldEffect(camera, { worldFocusDistance: 3, worldFocusRange: 2.5, bokehScale: 3.0 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.water = new WaterFXEffect(this.vol.texture);
    this.bloom = new BloomEffect({
      mipmapBlur: true, luminanceThreshold: 1.2, luminanceSmoothing: 0.6, intensity: 0.55, radius: 0.72,
      levels: quality === 'low' ? 5 : 7,
    });
    this.grade = new GradeEffect();
    this.mask = new MaskEffect();
    this.final = new FinalEffect();
    this.mainPass = new EffectPass(camera, this.water, this.bloom, this.grade, this.mask, this.final);
    this.composer.addPass(this.mainPass);

    this.lens = new LensEffect();
    this.lensPass = new EffectPass(camera, this.lens);
    this.composer.addPass(this.lensPass);
    this.setLensEnabled(quality !== 'low');

    this.bloomBaseThreshold = 1.2;
    this.quality = quality;
    this.reducedMotion = false;
    this.clock = 0;
  }

  setLensEnabled(on) {
    this.lensPass.enabled = on;
    this.lensPass.renderToScreen = on;
    this.mainPass.renderToScreen = !on;
  }

  setSize(w, h) { this.composer.setSize(w, h, false); }

  get u() {
    return {
      water: this.water.uniforms, grade: this.grade.uniforms, mask: this.mask.uniforms,
      final: this.final.uniforms, lens: this.lens.uniforms,
    };
  }

  setDof(on, focus = 3, range = 2.5, bokeh = 3) {
    this.dofPass.enabled = on;
    if (on) {
      this.dof.cocMaterial.focusDistance = focus;
      this.dof.cocMaterial.focusRange = range;
      this.dof.bokehScale = bokeh;
    }
  }

  render(dt, env) {
    this.clock += dt;
    const ex = env.exposure * Math.pow(2, this.photoEV || 0);
    this.grade.uniforms.get('uExposure').value = ex;
    this.grade.uniforms.get('uWhite').value.copy(env.whiteBalance);
    this.grade.uniforms.get('uMesopic').value = env.above ? 0 : THREE.MathUtils.smoothstep(env.cameraDepth, 16, 48) * 0.72 * Math.min(1, env.naturalLight);
    this.bloom.luminanceMaterial.threshold = this.bloomBaseThreshold / Math.max(ex, 0.05);
    this.water.uniforms.get('uClock').value = this.clock;
    this.final.uniforms.get('uSeed').value = (this.clock * 60) % 1000;
    const lu = this.lens.uniforms;
    const glass = this.glassAmount ?? 1;
    lu.get('uDistort').value = this.reducedMotion ? 0 : -0.05 * glass;
    lu.get('uCA').value = 0.0055 * glass;
    // god rays fade out between ~28 and ~48 m (spec: 0–40 m)
    this.vol.enabledShafts = env.above ? 0 : env.type.godrays * (1 - THREE.MathUtils.smoothstep(env.cameraDepth, 28, 48));
    this.composer.render(dt);
  }
}
