import * as THREE from 'three';
import { WaterEnv } from '../render/water/WaterEnv.js';
import { Caustics } from '../render/water/Caustics.js';
import { UnderwaterSurface, WaterBackdrop } from '../render/water/UnderwaterSurface.js';
import { MarineSnow } from '../render/MarineSnow.js';
import { Bubbles } from '../render/Bubbles.js';
import { PostFX } from '../render/PostFX.js';
import { TextureBaker } from '../render/TextureBaker.js';
import { bakeLibrary } from '../render/proceduralTextures.js';
import { lamps } from '../render/Lamps.js';
import { getPreset } from './quality.js';

/**
 * Rendering core shared by every stage: renderer, camera, water optics, caustics, surface,
 * particles, bubbles, lamps and the post-processing stack.
 */
export class Engine {
  constructor(container, { quality = 'medium', resolutionScale = 1, fov = 72 } = {}) {
    this.container = container;
    this.preset = getPreset(quality);
    this.resolutionScale = resolutionScale;
    const renderer = new THREE.WebGLRenderer({
      antialias: false, stencil: false, depth: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: false, alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = this.preset.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = true;
    container.appendChild(renderer.domElement);
    renderer.domElement.id = 'game-canvas';
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.05, 300);
    this.camera.name = 'eye';
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.env = new WaterEnv();
    this.scene.add(this.env.sun, this.env.sunTarget, this.env.hemi);
    if (this.preset.shadows) this.configureSunShadow(true);

    this.baker = new TextureBaker(renderer);
    this.lib = bakeLibrary(this.baker, this.preset.texSize <= 512 ? 'low' : 'medium');

    this.caustics = new Caustics(renderer, { size: this.preset.caustics, grid: this.preset.causticGrid });
    this.caustics.interval = this.preset.causticInterval;
    this.env.uniforms.uWCausticMap.value = this.caustics.texture;

    this.surface = new UnderwaterSurface(this.lib);
    this.backdrop = new WaterBackdrop();
    this.scene.add(this.surface.mesh, this.backdrop.mesh);

    // Two particle layers: fine suspended matter close to the lens, and larger marine-snow flakes.
    this.dust = new MarineSnow({ count: Math.floor(5200 * this.preset.snow), box: 9, size: 0.0035, sink: 0.004, brightness: 0.75, seed: 3, name: 'dust' });
    this.snow = new MarineSnow({ count: Math.floor(2600 * this.preset.snow), box: 22, size: 0.011, sink: 0.03, brightness: 1.0, seed: 7, name: 'snow' });
    this.scene.add(this.dust.mesh, this.snow.mesh);

    this.bubbles = new Bubbles({ max: 900 });
    this.scene.add(this.bubbles.mesh);

    this.post = new PostFX(renderer, this.scene, this.camera, { quality: this.preset.name });
    this.post.setLensEnabled(this.preset.lens);
    this.post.final.uniforms.get('uGrain').value = this.preset.grain;

    this.viewport = new THREE.Vector2(1, 1);
    this.far = 300;
    this.autoFar = true;
    this.frame = 0;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  configureSunShadow(on) {
    const s = this.env.sun;
    s.castShadow = on;
    if (on) {
      s.shadow.mapSize.set(2048, 2048);
      const c = s.shadow.camera;
      c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 160;
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.03;
      s.shadow.radius = 3;
    }
  }

  setQuality(name) {
    this.preset = getPreset(name);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap) * this.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.viewport.copy(db);
    this.post.setSize(w, h);
  }

  setResolutionScale(s) { this.resolutionScale = s; this.resize(); }

  setFov(f) { this.camera.fov = f; this.camera.updateProjectionMatrix(); }

  /** Pick the far plane from water clarity (nothing is visible past ~1% transmittance). */
  updateFar() {
    if (!this.autoFar) return;
    let far;
    if (this.env.above) far = 22000;
    else {
      const s = this.env.uniforms.uWSigma.value;
      far = THREE.MathUtils.clamp(5.2 / Math.min(s.x, s.y, s.z), 60, 420);
    }
    if (Math.abs(far - this.far) > 1) {
      this.far = far;
      this.camera.far = far;
      this.camera.near = this.env.above ? 0.08 : 0.05;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt) {
    const env = this.env;
    env.update(dt, this.camera);
    this.updateFar();
    const underwaterShallow = !env.above && env.cameraDepth < 70 && env.naturalLight > 0.01 && env.type.caustics > 0;
    this.caustics.setSun(env.sunDirAir);
    this.caustics.update(dt, env.time * 0.85, underwaterShallow);
    this.surface.update(this.camera, env, this.far);
    this.backdrop.update(this.camera, env, this.far);
    this.dust.update(dt, this.camera, env, this.viewport);
    this.snow.update(dt, this.camera, env, this.viewport);
    this.bubbles.update(dt, env, this.camera);
    lamps.update();
  }

  render(dt) {
    this.post.render(dt, this.env);
    this.frame++;
  }

  async warmup(object = this.scene) {
    try {
      const par = this.renderer.extensions.has('KHR_parallel_shader_compile');
      if (par && this.renderer.compileAsync) await this.renderer.compileAsync(object, this.camera, this.scene);
      else this.renderer.compile(object, this.camera, this.scene);
    } catch (e) {
      // compileAsync can reject if a material is disposed during compile; a normal render will compile it.
    }
  }

  /** Dispose everything owned by a subtree (geometries, materials, textures). */
  static disposeTree(root) {
    const mats = new Set(), geos = new Set(), texs = new Set();
    root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      if (o.isInstancedMesh) o.dispose();
    });
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.userData?.shared) texs.add(v); }
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v && v.isTexture && v.userData?.owned) texs.add(v); }
      m.dispose();
    }
    for (const g of geos) g.dispose();
    for (const t of texs) t.dispose();
  }
}
