// M1 water-look test harness. URL: ?dev=m1&cam=x,y,z&look=yawDeg,pitchDeg&torch=1&off=depthOffset&q=medium
import * as THREE from 'three';
import { Engine } from '../core/Engine.js';
import { buildReef } from '../world/stages/reefBuild.js';
import { lamps } from '../render/Lamps.js';

export async function start(params) {
  const q = params.get('q') || 'medium';
  const engine = new Engine(document.getElementById('app'), { quality: q });
  window.__engine = engine;
  const t0 = performance.now();
  if (params.get('gallery')) {
    const { buildGallery } = await import('./gallery.js');
    engine.scene.add(buildGallery(engine));
  } else {
    const reef = buildReef(engine, { density: Number(params.get('density') || 1) });
    engine.scene.add(reef.group);
    window.__reef = reef;
  }
  console.log('[m1] built in', Math.round(performance.now() - t0), 'ms');

  const off = Number(params.get('off') || 0);
  engine.env.depthBase = off;
  const cam = (params.get('cam') || '6,-7,-24').split(',').map(Number);
  const look = (params.get('look') || '0,-12').split(',').map(Number);
  engine.camera.position.set(cam[0], cam[1], cam[2]);
  if (params.get('rel') && window.__reef) engine.camera.position.y = window.__reef.hf.height(cam[0], cam[2]) + cam[1];
  let yaw = THREE.MathUtils.degToRad(look[0]), pitch = THREE.MathUtils.degToRad(look[1]);
  engine.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (params.get('sun')) engine.env.setSun({ elevation: Number(params.get('sun')) });
  if (params.get('snowk')) { engine.snow.uniforms.uBright.value *= Number(params.get('snowk')); engine.dust.uniforms.uBright.value *= Number(params.get('snowk')); }
  const focus = params.get('focus');
  if (focus && window.__reef) {
    const list = window.__reef.scatter.instances.filter((i) => i.tag === focus);
    const it = list[Number(params.get('fi') || 0) % Math.max(1, list.length)];
    if (it) {
      const dist = Number(params.get('fd') || 3);
      const nx = Math.cos(it.yaw), nz = -Math.sin(it.yaw);
      engine.camera.position.set(it.x + nz * dist, it.y + 1.0 * it.scale, it.z - nx * dist);
      engine.camera.lookAt(it.x, it.y + 0.8 * it.scale, it.z);
      const e = new THREE.Euler().setFromQuaternion(engine.camera.quaternion, 'YXZ');
      yaw = e.y; pitch = e.x;
      console.log('[m1] focus', focus, list.length, 'at', it.x.toFixed(1), it.y.toFixed(1), it.z.toFixed(1));
    }
  }

  // Diver torch
  const torch = new THREE.SpotLight(0xfff4e6, Number(params.get('torchI') || 40), 0, THREE.MathUtils.degToRad(17), 0.55, 2);
  torch.position.set(0.22, -0.18, 0.05);
  torch.target.position.set(0.05, -0.1, -8);
  engine.camera.add(torch, torch.target);
  torch.visible = params.get('torch') === '1';
  engine.env.lampExposureCap = torch.visible ? 1.35 : null;
  lamps.add(torch, { volumetric: 1 });

  // Exhale bubbles on a breathing cycle
  let breath = 0;
  const exhaleL = new THREE.Vector3(), exhaleR = new THREE.Vector3();
  const emitExhale = () => {
    const c = engine.camera;
    exhaleL.set(-0.1, -0.13, 0.03).applyMatrix4(c.matrixWorld);
    exhaleR.set(0.1, -0.13, 0.03).applyMatrix4(c.matrixWorld);
    const side = new THREE.Vector3(1, 0, 0).transformDirection(c.matrixWorld).multiplyScalar(0.25);
    engine.bubbles.burst(exhaleL, { count: 16, rMin: 0.002, rMax: 0.013, spread: 0.04, vel: side.clone().negate() });
    engine.bubbles.burst(exhaleR, { count: 16, rMin: 0.002, rMax: 0.013, spread: 0.04, vel: side });
  };

  // Simple fly camera for manual browsing
  const keys = new Set();
  addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'KeyF') torch.visible = !torch.visible; });
  addEventListener('keyup', (e) => keys.delete(e.code));
  let drag = false;
  addEventListener('mousedown', () => (drag = true));
  addEventListener('mouseup', () => (drag = false));
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    yaw -= e.movementX * 0.003; pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5);
  });

  const settle = params.get('settle') !== '0';
  let frames = 0;
  let last = performance.now();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const loop = () => {
    const now = performance.now();
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (params.get('fixed')) dt = 1 / 60;
    engine.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    engine.camera.getWorldDirection(fwd);
    right.crossVectors(fwd, engine.camera.up).normalize();
    const sp = keys.has('ShiftLeft') ? 6 : 2;
    if (keys.has('KeyW')) engine.camera.position.addScaledVector(fwd, sp * dt);
    if (keys.has('KeyS')) engine.camera.position.addScaledVector(fwd, -sp * dt);
    if (keys.has('KeyA')) engine.camera.position.addScaledVector(right, -sp * dt);
    if (keys.has('KeyD')) engine.camera.position.addScaledVector(right, sp * dt);
    if (keys.has('Space')) engine.camera.position.y += sp * dt;
    if (keys.has('KeyC')) engine.camera.position.y -= sp * dt;
    engine.camera.updateMatrixWorld();
    breath += dt;
    if (breath > 4.2) { breath = 0; emitExhale(); }
    if (window.__reef) window.__reef.scatter.update(engine.camera);
    engine.update(dt);
    if (settle && frames < 3) engine.env.exposure = engine.env.exposureTarget;
    engine.post.u.mask.get('uMask').value = params.get('mask') === '0' ? 0 : 1;
    if (params.get('dbg') === 'caustics') {
      if (!window.__dbgScene) {
        const sc = new THREE.Scene();
        const m = new THREE.MeshBasicMaterial({ map: engine.caustics.texture });
        engine.caustics.texture.repeat.set(2, 1);
        const qd = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
          uniforms: { t: { value: engine.caustics.texture }, k: { value: Number(params.get('k') || 0.25) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D t; uniform float k; varying vec2 vUv; void main(){ vec2 uv = vUv * vec2(2.0 * 16.0/9.0, 2.0); float c = texture2D(t, uv).r; gl_FragColor = vec4(vec3(c * k), 1.0); }',
        }));
        qd.frustumCulled = false; sc.add(qd); window.__dbgScene = sc; void m;
      }
      engine.renderer.setRenderTarget(null);
      engine.renderer.render(window.__dbgScene, engine.camera);
    } else engine.render(dt);
    frames++;
    const ft = performance.now() - now;
    if (frames <= 6) console.log('[m1] frame', frames, Math.round(ft), 'ms');
    if (frames === Number(params.get('frames') || 4)) {
      window.__ready = true;
      const info = engine.renderer.info;
      console.log('[m1] calls', info.render.calls, 'tris', info.render.triangles, 'exposure', engine.env.exposure.toFixed(3), 'depth', engine.env.cameraDepth.toFixed(1), 'visibleInst', window.__reef?.scatter.visibleCount);
      if (params.get('stop') !== '0') return;
    }
    requestAnimationFrame(loop);
  };
  // pre-roll bubbles so they're visible in the first frame
  if (params.get('bubbles') !== '0') {
    engine.camera.updateMatrixWorld();
    emitExhale();
    for (let i = 0; i < 40; i++) engine.bubbles.update(1 / 60, engine.env, engine.camera);
  }
  requestAnimationFrame(loop);
}
