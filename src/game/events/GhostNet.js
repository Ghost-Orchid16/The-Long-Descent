import * as THREE from 'three';
import { patchMaterial } from '../../render/water/patch.js';
import { audio } from '../../core/audio/AudioEngine.js';
import { bus } from '../../core/Bus.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

function netMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xbfd2c6, roughness: 0.45, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  patchMaterial(mat, {
    key: 'ghostnet', wrap: 0.6, translucent: 0.4, sway: true, swayAmp: 0.06,
    uniforms: { uCells: { value: 44 } },
    vertexHead: 'varying vec2 vNetUv;',
    vertexEnd: 'vNetUv = uv;',
    fragmentHead: 'uniform float uCells; varying vec2 vNetUv;',
    fragmentColor: /* glsl */ `
      {
        // diamond mesh of monofilament with torn holes and a ragged edge
        vec2 g = vec2(vNetUv.x * 2.2 + vNetUv.y, vNetUv.x * 2.2 - vNetUv.y) * uCells * 0.5;
        vec2 f = fract(g);
        float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float fw = fwidth(e) + 1e-4;
        float line = 1.0 - smoothstep(0.035 - fw, 0.035 + fw, e);
        float far = clamp((fw - 0.18) * 4.0, 0.0, 1.0);
        float cover = mix(line, 0.14, far);
        float tear = smoothstep(-0.25, -0.12, gnoise(vec3(vNetUv * vec2(6.0, 3.0), 4.0)));
        float edge = smoothstep(0.0, 0.06, vNetUv.y) * smoothstep(1.0, 0.9 + 0.08 * gnoise(vec3(vNetUv.x * 12.0, 1.0, 2.0)), vNetUv.y);
        cover *= tear * edge;
        diffuseColor.a = cover * 0.9;
        diffuseColor.rgb *= 0.8 + 0.2 * gnoise(vec3(vNetUv * 9.0, 3.0));
      }
    `,
  });
  return mat;
}

/**
 * Ghost-net entanglement: the diver swims into lost monofilament. Four strands hold the fins;
 * each is cut by holding E with the knife. Thrashing tightens the lines and raises panic.
 */
export class GhostNet {
  constructor(game, parent, { onDone, onPanic } = {}) {
    this.game = game;
    this.parent = parent;
    this.onDone = onDone; this.onPanic = onPanic;
    this.active = false; this.done = false;
    this.group = new THREE.Group();
    this.group.name = 'ghostnet';
    parent.add(this.group);
    this.lineMat = new THREE.MeshStandardMaterial({ color: 0xd8e6dc, roughness: 0.35, metalness: 0.0 });
    patchMaterial(this.lineMat, { key: 'monofil', wrap: 0.5 });
    this.lineGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    // 1-px line drawn over each strand so the monofilament stays visible at any resolution
    this.hairGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
    this.hairMat = new THREE.LineBasicMaterial({ color: 0x9fc2c4, transparent: true, opacity: 0.55 });
    this.strands = [];
    this.thrash = 0;
    this.panicSaid = false;
  }

  get remaining() { return this.strands.filter((s) => !s.cut).length; }

  /** Snag the diver where they are now. */
  trigger(diver) {
    if (this.active || this.done) return;
    this.active = true;
    this.diver = diver;
    this.bodyYaw = diver.yaw; // the body stays put while the head looks around
    const g = this.game;
    const hgt = (x, z) => g.collision.groundHeight(x, z);
    // decorative net curtain draped behind and below the diver, standing on the reef
    _f.set(-Math.sin(diver.yaw), 0, -Math.cos(diver.yaw));
    _r.set(Math.cos(diver.yaw), 0, -Math.sin(diver.yaw));
    const c = diver.pos.clone().addScaledVector(_f, -1.3);
    const W = 5.5, Hh = 2.6;
    const geo = new THREE.PlaneGeometry(W, Hh, 22, 10);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / W, v = pos.getY(i) / Hh + 0.5;
      const wx = c.x + _r.x * u * W, wz = c.z + _r.z * u * W;
      const ground = hgt(wx + _f.x * 0.3, wz + _f.z * 0.3);
      const base = isFinite(ground) ? ground : c.y - 1.5;
      const sag = Math.sin(Math.PI * (u + 0.5)) * 0.35;
      const y = base + v * Hh * (0.85 + 0.15 * Math.sin(u * 7.0)) - sag * v;
      const bulge = Math.sin(v * Math.PI) * 0.35 + Math.sin(u * 9.0 + v * 3.0) * 0.08;
      pos.setXYZ(i, wx + _f.x * bulge, y, wz + _f.z * bulge);
    }
    geo.computeVertexNormals();
    this.curtain = new THREE.Mesh(geo, netMaterial());
    this.curtain.renderOrder = 2;
    this.group.add(this.curtain);
    // four strands from the fins to the curtain and the reef
    const anchors = [
      c.clone().addScaledVector(_r, -1.4).setY(c.y + 0.2),
      c.clone().addScaledVector(_r, 1.2).setY(c.y + 0.6),
      diver.pos.clone().addScaledVector(_r, -1.6).addScaledVector(_f, 0.5),
      diver.pos.clone().addScaledVector(_r, 1.7).addScaledVector(_f, 0.2),
    ];
    for (let k = 2; k < 4; k++) { const gh = hgt(anchors[k].x, anchors[k].z); anchors[k].y = isFinite(gh) ? gh + 0.15 : diver.pos.y - 1.6; }
    anchors.forEach((p, k) => {
      const m = new THREE.Mesh(this.lineGeo, this.lineMat);
      m.frustumCulled = false;
      m.add(new THREE.Line(this.hairGeo, this.hairMat));
      m.children[0].frustumCulled = false;
      this.group.add(m);
      const s = { anchor: p, mesh: m, cut: false, free: new THREE.Vector3(), t: 0, leg: k % 2 ? 1 : -1, low: k >= 2 };
      s.item = g.interactions.add({
        position: () => this._mid(s, _a).clone(),
        radius: 0.16, range: 2.4, mode: 'hold', hold: 1.0,
        prompt: 'Cut the line',
        enabled: () => !s.cut,
        onHold: (p) => { if (p > 0.05 && Math.random() < 0.15) audio.play('click', { gain: 0.12, rate: 1.6 }); },
        onUse: () => this._cut(s),
      });
      this.strands.push(s);
    });
    diver.speedScale = 0.06;
    bus.emit('tension', true);
    audio.play('creak', { gain: 0.4, rate: 1.8 });
    g.ui.setMarker(() => { const s = this.strands.find((x) => !x.cut); return s ? this._mid(s, _a) : diver.pos; }, 'Line', { minDist: 0 });
  }

  _leg(s, out) {
    const d = this.diver;
    const yaw = this.bodyYaw;
    _f.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    _r.set(Math.cos(yaw), 0, -Math.sin(yaw));
    return out.copy(d.pos).addScaledVector(_u, s.low ? -0.95 : -0.7).addScaledVector(_f, -0.55).addScaledVector(_r, s.leg * 0.14);
  }

  _mid(s, out) { this._leg(s, _b); return out.lerpVectors(_b, s.anchor, 0.3); }

  _cut(s) {
    if (s.cut) return;
    s.cut = true;
    this._leg(s, s.free);
    s.free.lerp(s.anchor, 0.3);
    s.t = 0;
    this.game.interactions.remove(s.item);
    audio.play('switch', { gain: 0.6, rate: 0.7 });
    this.game.engine.bubbles.burst(s.free.clone(), { count: 6, rMin: 0.002, rMax: 0.006, spread: 0.05 });
    this.game.ui.setObjectiveSub('net', `(${4 - this.remaining}/4)`);
    if (this.remaining === 0) {
      this.done = true; this.active = false;
      bus.emit('tension', false);
      this.game.ui.setMarker(null);
      this.diver.speedScale = 1;
      this.onDone?.();
    }
  }

  update(dt) {
    if (!this.diver) return;
    const d = this.diver, input = this.game.input;
    if (this.active) {
      const m = input.move;
      const thrashing = Math.hypot(m.x, m.y, m.z) > 0.3;
      if (thrashing) {
        this.thrash += dt;
        d.panic = Math.min(1, d.panic + dt * 0.45);
        // lines tighten and tug the diver back
        _a.set(0, 0, 0);
        for (const s of this.strands) if (!s.cut) _a.add(s.anchor);
        _a.multiplyScalar(1 / Math.max(1, this.remaining)).sub(d.pos);
        d.vel.addScaledVector(_a.normalize(), dt * 0.8);
        if (this.thrash > 1.6 && !this.panicSaid) { this.panicSaid = true; this.onPanic?.(); }
      } else d.panic = Math.max(0, d.panic - dt * 0.12);
      // keep the diver within the slack of the remaining lines
      for (const s of this.strands) {
        if (s.cut) continue;
        const len = this._leg(s, _a).distanceTo(s.anchor);
        if (len > 2.8) d.vel.addScaledVector(_b.subVectors(s.anchor, _a).normalize(), dt * (len - 2.8) * 3);
      }
    } else if (d.panic > 0) d.panic = Math.max(0, d.panic - dt * 0.1);
    // place the strand meshes
    for (const s of this.strands) {
      let p0;
      if (!s.cut) p0 = this._leg(s, _a);
      else {
        s.t += dt;
        // the cut end drifts down and drapes towards its anchor
        s.free.lerp(_b.copy(s.anchor).add(_f.set(0, -0.3, 0)), 1 - Math.exp(-dt * 0.5));
        p0 = s.free;
      }
      _b.subVectors(s.anchor, p0);
      const len = _b.length();
      s.mesh.position.copy(p0);
      _q.setFromUnitVectors(_u, _b.multiplyScalar(1 / Math.max(len, 1e-4)));
      s.mesh.quaternion.copy(_q);
      s.mesh.scale.set(0.0035, len, 0.0035);
    }
  }

  dispose() {
    for (const s of this.strands) this.game.interactions.remove(s.item);
    this.group.removeFromParent();
    this.lineGeo.dispose(); this.lineMat.dispose(); this.hairGeo.dispose(); this.hairMat.dispose();
    if (this.curtain) { this.curtain.geometry.dispose(); this.curtain.material.dispose(); }
  }
}
