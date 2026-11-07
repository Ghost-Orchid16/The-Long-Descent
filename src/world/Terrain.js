import * as THREE from 'three';
import { patchMaterial } from '../render/water/patch.js';
import { TRI_FUNCS_GLSL } from '../render/glsl/triplanar.js';

/** Summed-area-table box blur of a 2D Float32 grid (clamped edges). */
function boxBlur(src, nx, nz, r) {
  const sat = new Float64Array((nx + 1) * (nz + 1));
  for (let z = 0; z < nz; z++) {
    let row = 0;
    for (let x = 0; x < nx; x++) {
      row += src[z * nx + x];
      sat[(z + 1) * (nx + 1) + (x + 1)] = sat[z * (nx + 1) + (x + 1)] + row;
    }
  }
  const out = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++) {
    const z0 = Math.max(0, z - r), z1 = Math.min(nz - 1, z + r);
    for (let x = 0; x < nx; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(nx - 1, x + r);
      const s = sat[(z1 + 1) * (nx + 1) + (x1 + 1)] - sat[z0 * (nx + 1) + (x1 + 1)] - sat[(z1 + 1) * (nx + 1) + x0] + sat[z0 * (nx + 1) + x0];
      out[z * nx + x] = s / ((x1 - x0 + 1) * (z1 - z0 + 1));
    }
  }
  return out;
}

/**
 * Regular-grid heightfield: y = h(x, z).
 * heightFn(x,z) → metres (local y). maskFn(x,z,h,slope) → [a,b,c] material weights.
 */
export class Heightfield {
  constructor({ x0, z0, sizeX, sizeZ, cell = 1, heightFn, maskFn }) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.round(sizeX / cell) + 1;
    this.nz = Math.round(sizeZ / cell) + 1;
    this.sizeX = (this.nx - 1) * cell; this.sizeZ = (this.nz - 1) * cell;
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    for (let j = 0; j < this.nz; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < this.nx; i++) this.h[j * this.nx + i] = heightFn(x0 + i * cell, z);
    }
    this.maskFn = maskFn;
  }

  inside(x, z) {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + this.sizeX && z <= this.z0 + this.sizeZ;
  }

  /** Bilinear height (matches the rendered triangles closely). */
  height(x, z) {
    const fx = THREE.MathUtils.clamp((x - this.x0) / this.cell, 0, this.nx - 1.0001);
    const fz = THREE.MathUtils.clamp((z - this.z0) / this.cell, 0, this.nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.h, nx = this.nx;
    const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Build chunked meshes. Returns a Group. */
  buildMesh(material, { chunks = 8, aoStrength = 1 } = {}) {
    const { nx, nz, cell, h } = this;
    // Cavity AO from multi-scale blurred height differences.
    const b1 = boxBlur(h, nx, nz, Math.max(1, Math.round(1.5 / cell)));
    const b2 = boxBlur(h, nx, nz, Math.max(2, Math.round(5 / cell)));
    const ao = new Float32Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) {
      const c1 = Math.max(0, b1[k] - h[k]);
      const c2 = Math.max(0, b2[k] - h[k]);
      ao[k] = THREE.MathUtils.clamp(1 - (c1 * 0.55 + c2 * 0.16) * aoStrength, 0.28, 1);
    }
    const group = new THREE.Group();
    group.name = 'terrain';
    const cx = Math.ceil((nx - 1) / chunks), cz = Math.ceil((nz - 1) / chunks);
    const nrm = new THREE.Vector3();
    for (let cj = 0; cj < chunks; cj++) {
      for (let ci = 0; ci < chunks; ci++) {
        const i0 = ci * cx, j0 = cj * cz;
        const i1 = Math.min(nx - 1, i0 + cx), j1 = Math.min(nz - 1, j0 + cz);
        if (i1 <= i0 || j1 <= j0) continue;
        const w = i1 - i0 + 1, d = j1 - j0 + 1;
        const pos = new Float32Array(w * d * 3), nor = new Float32Array(w * d * 3);
        const msk = new Float32Array(w * d * 3), aoA = new Float32Array(w * d);
        let p = 0, q = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const x = this.x0 + i * cell, z = this.z0 + j * cell, y = h[j * nx + i];
            pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
            const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nz - 1, j + 1);
            nrm.set((h[j * nx + il] - h[j * nx + ir]) / ((ir - il) * cell), 1, (h[jd * nx + i] - h[ju * nx + i]) / ((ju - jd) * cell)).normalize();
            nor[p] = nrm.x; nor[p + 1] = nrm.y; nor[p + 2] = nrm.z;
            const m = this.maskFn ? this.maskFn(x, z, y, 1 - nrm.y) : [0, 0, 0];
            msk[p] = m[0]; msk[p + 1] = m[1]; msk[p + 2] = m[2];
            aoA[q] = ao[j * nx + i];
            p += 3; q++;
          }
        }
        const idx = [];
        for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
          const a = j * w + i, b = a + 1, c = a + w, e = c + 1;
          // alternate diagonal to reduce directional artefacts
          if ((i + j) & 1) idx.push(a, c, b, b, c, e); else idx.push(a, c, e, a, e, b);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('aMask', new THREE.BufferAttribute(msk, 3));
        g.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
        g.setIndex(idx);
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    return group;
  }
}

/**
 * A displaced parametric sheet (vertical walls, overhangs, trench walls).
 * posFn(u, v) → {x, y, z, off} where `off` is displacement along the sheet normal (used for AO).
 */
export function buildSheet({ u0, u1, v0, v1, resU, resV, posFn, maskFn, material, chunksU = 6, chunksV = 3, aoStrength = 1 }) {
  const nu = resU + 1, nv = resV + 1;
  const P = new Float32Array(nu * nv * 3), OFF = new Float32Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = u0 + (u1 - u0) * (i / resU), v = v0 + (v1 - v0) * (j / resV);
    const r = posFn(u, v);
    const k = j * nu + i;
    P[k * 3] = r.x; P[k * 3 + 1] = r.y; P[k * 3 + 2] = r.z; OFF[k] = r.off ?? 0;
  }
  const blur1 = boxBlur(OFF, nu, nv, 2), blur2 = boxBlur(OFF, nu, nv, 6);
  const N = new Float32Array(nu * nv * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const il = Math.max(0, i - 1), ir = Math.min(nu - 1, i + 1), jd = Math.max(0, j - 1), ju = Math.min(nv - 1, j + 1);
    a.set(P[(j * nu + ir) * 3] - P[(j * nu + il) * 3], P[(j * nu + ir) * 3 + 1] - P[(j * nu + il) * 3 + 1], P[(j * nu + ir) * 3 + 2] - P[(j * nu + il) * 3 + 2]);
    b.set(P[(ju * nu + i) * 3] - P[(jd * nu + i) * 3], P[(ju * nu + i) * 3 + 1] - P[(jd * nu + i) * 3 + 1], P[(ju * nu + i) * 3 + 2] - P[(jd * nu + i) * 3 + 2]);
    c.crossVectors(a, b).normalize();
    const k = (j * nu + i) * 3;
    N[k] = c.x; N[k + 1] = c.y; N[k + 2] = c.z;
  }
  const group = new THREE.Group();
  group.name = 'sheet';
  const cu = Math.ceil(resU / chunksU), cv = Math.ceil(resV / chunksV);
  for (let cj = 0; cj < chunksV; cj++) for (let ci = 0; ci < chunksU; ci++) {
    const i0 = ci * cu, j0 = cj * cv, i1 = Math.min(resU, i0 + cu), j1 = Math.min(resV, j0 + cv);
    if (i1 <= i0 || j1 <= j0) continue;
    const w = i1 - i0 + 1, d = j1 - j0 + 1;
    const pos = new Float32Array(w * d * 3), nor = new Float32Array(w * d * 3), msk = new Float32Array(w * d * 3), ao = new Float32Array(w * d);
    let p = 0, q = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nu + i;
      pos[p] = P[k * 3]; pos[p + 1] = P[k * 3 + 1]; pos[p + 2] = P[k * 3 + 2];
      nor[p] = N[k * 3]; nor[p + 1] = N[k * 3 + 1]; nor[p + 2] = N[k * 3 + 2];
      const m = maskFn ? maskFn(pos[p], pos[p + 1], pos[p + 2], nor[p + 1]) : [1, 0, 0];
      msk[p] = m[0]; msk[p + 1] = m[1]; msk[p + 2] = m[2];
      const cav = Math.max(0, blur1[k] - OFF[k]) * 0.5 + Math.max(0, blur2[k] - OFF[k]) * 0.2;
      ao[q] = THREE.MathUtils.clamp(1 - cav * aoStrength, 0.3, 1);
      p += 3; q++;
    }
    const idx = [];
    for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
      const A = j * w + i, B = A + 1, C = A + w, D = C + 1;
      idx.push(A, B, C, B, D, C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aMask', new THREE.BufferAttribute(msk, 3));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

const TRI_GLSL = /* glsl */ `
uniform sampler2D tTA; uniform sampler2D tTAN; uniform sampler2D tTB; uniform sampler2D tTBN;
uniform float uTScaleA; uniform float uTScaleB;
uniform vec3 uTTintA; uniform vec3 uTTintB; uniform vec3 uTTintC;
varying vec3 vTriN;
varying vec3 vTriMask;
` + TRI_FUNCS_GLSL;

/** Triplanar terrain material blending a soft ground (A) and hard ground (B) set by aMask.x. */
export function makeTerrainMaterial(lib, {
  soft = 'sand', hard = 'rock', scaleA = 1 / 2.6, scaleB = 1 / 3.4,
  tintA = [1, 1, 1], tintB = [1, 1, 1], tintC = [0.75, 0.72, 0.62], roughness = 0.92, topOnly = false, key = '',
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  const uniforms = {
    tTA: { value: lib[soft + 'A'] }, tTAN: { value: lib[soft + 'N'] },
    tTB: { value: lib[hard + 'A'] }, tTBN: { value: lib[hard + 'N'] },
    uTScaleA: { value: scaleA }, uTScaleB: { value: scaleB },
    uTTintA: { value: new THREE.Vector3(...tintA) }, uTTintB: { value: new THREE.Vector3(...tintB) },
    uTTintC: { value: new THREE.Vector3(...tintC) },
  };
  patchMaterial(mat, {
    ao: true,
    key: 'terrain' + (topOnly ? 'top' : '') + key,
    uniforms,
    varyings: '',
    vertexHead: 'attribute vec3 aMask; varying vec3 vTriN; varying vec3 vTriMask;' + (topOnly ? '\n#define TRI_TOP_ONLY' : ''),
    vertexEnd: 'vTriN = normalize( mat3( modelMatrix ) * objectNormal ); vTriMask = aMask;',
    fragmentHead: (topOnly ? '#define TRI_TOP_ONLY\n' : '') + TRI_GLSL,
    fragmentColor: /* glsl */ `
      vec3 triNw = normalize(vTriN);
      vec3 triWt = triW(triNw);
      vec4 tA = triS(tTA, vWaterWorldPos, triWt, uTScaleA);
      vec4 tB = triS(tTB, vWaterWorldPos, triWt, uTScaleB);
      // height-aware blend: rock pokes through sand at its high points
      float bm = clamp(vTriMask.x, 0.0, 1.0);
      float hb = smoothstep(0.0, 1.0, clamp((bm * 1.6 - 0.3) + (tB.a - tA.a) * 0.8, 0.0, 1.0));
      vec3 albedo = mix(tA.rgb * uTTintA, tB.rgb * uTTintB, hb);
      // secondary mask: rubble / darker sediment / tint C
      albedo = mix(albedo, albedo * uTTintC, clamp(vTriMask.y, 0.0, 1.0));
      diffuseColor.rgb *= albedo;
      float triBlend = hb;
    `,
    fragmentNormal: /* glsl */ `
      {
        vec3 nA = triNrm(tTAN, vWaterWorldPos, triNw, triWt, uTScaleA);
        vec3 nB = triNrm(tTBN, vWaterWorldPos, triNw, triWt, uTScaleB);
        vec3 nw = normalize(mix(nA, nB, triBlend));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      }
    `,
  });
  return mat;
}
