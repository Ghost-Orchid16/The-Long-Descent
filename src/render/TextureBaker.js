import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Renders procedural shaders into textures on the GPU (fast, no CPU loops). */
export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.targets = [];
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  /**
   * @param {object} p
   * @param {number} p.size
   * @param {string} p.fragment  GLSL body defining `vec4 bake(vec2 uv)`
   * @param {boolean} [p.srgb]   store colour as sRGB (alpha stays linear)
   */
  bake({ size = 512, fragment, uniforms = {}, srgb = false, mip = true, anisotropy = 8, float = false, wrap = true }) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      wrapS: wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      wrapT: wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: mip,
      depthBuffer: false,
      anisotropy: Math.min(anisotropy, this.maxAniso),
    });
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: NOISE_GLSL + '\nvarying vec2 vUv;\n' + fragment + '\nvoid main(){ gl_FragColor = bake(vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = mat;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    mat.dispose();
    this.targets.push(rt);
    rt.texture.userData.rt = rt;
    return rt.texture;
  }

  /** Tangent-space normal map from a height texture channel (tileable). */
  normalFromHeight(heightTex, { size = 512, strength = 1, channel = 'a', roughnessExpr = '0.0' } = {}) {
    return this.bake({
      size,
      uniforms: { tH: { value: heightTex }, uStrength: { value: strength }, uTexel: { value: 1 / size } },
      fragment: /* glsl */ `
        uniform sampler2D tH; uniform float uStrength; uniform float uTexel;
        float H(vec2 uv) { return texture2D(tH, uv).${channel}; }
        vec4 bake(vec2 uv) {
          float hl = H(uv - vec2(uTexel, 0.0)), hr = H(uv + vec2(uTexel, 0.0));
          float hd = H(uv - vec2(0.0, uTexel)), hu = H(uv + vec2(0.0, uTexel));
          vec3 n = normalize(vec3((hl - hr) * uStrength, (hd - hu) * uStrength, 1.0));
          float h = H(uv);
          return vec4(n * 0.5 + 0.5, ${roughnessExpr});
        }
      `,
    });
  }

  dispose() {
    for (const rt of this.targets) rt.dispose();
    this.targets.length = 0;
  }
}
