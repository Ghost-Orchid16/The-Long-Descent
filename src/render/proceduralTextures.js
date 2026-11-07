// Procedural, tileable surface textures baked once on the GPU.
// Albedo values are authored in linear space and stored sRGB-encoded.

export function bakeLibrary(baker, quality = 'medium') {
  const S = quality === 'low' ? 512 : 1024;
  const lib = {};

  // ---------------- Sand: wave ripples, grains, shell fragments ----------------
  lib.sandA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float warp = fbmP(uv, 3, 4, 1.0) * 1.4 + fbmP(uv, 7, 2, 4.0) * 0.25;
        float ph = 6.2831853 * (22.0 * uv.x + 3.0 * uv.y + warp);
        float rip = sin(ph);
        float crest = pow(0.5 + 0.5 * rip, 1.6);
        // ripple strength varies across the tile, with flatter patches
        float strength = smoothstep(-0.35, 0.45, fbmP(uv, 2, 3, 9.0));
        float grains = fbmP(uv, 96, 3, 2.0);
        float coarse = fbmP(uv, 24, 3, 5.0);
        vec3 w = worleyP(uv, 48, 0.9);
        float shell = smoothstep(0.16, 0.06, w.x) * step(0.72, w.z);
        float h = crest * 0.55 * strength + grains * 0.06 + coarse * 0.08 + shell * 0.12;
        vec3 base = vec3(0.60, 0.555, 0.46);
        vec3 col = base * (0.9 + 0.12 * grains + 0.06 * coarse);
        // organic detritus settles in ripple troughs
        col *= mix(0.86, 1.0, mix(1.0, crest, strength));
        // dark grains & pale shell bits
        float speck = smoothstep(0.62, 0.9, fbmP(uv, 160, 2, 3.0));
        col = mix(col, vec3(0.36, 0.33, 0.29), speck * 0.18);
        col = mix(col, vec3(0.80, 0.76, 0.70), shell * 0.7);
        // faint greenish microalgal film in patches
        float film = smoothstep(0.15, 0.6, fbmP(uv, 3, 3, 12.0));
        col = mix(col, col * vec3(0.86, 0.92, 0.80), film * 0.35);
        return vec4(col, h);
      }
    `,
  });
  lib.sandN = baker.normalFromHeight(lib.sandA, { size: S, strength: 3.2, roughnessExpr: '0.92' });

  // ---------------- Reef rock: limestone, pits, turf algae, coralline algae ----------------
  lib.rockA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float n1 = fbmP(uv, 4, 6, 0.0);
        float n2 = fbmP(uv, 16, 4, 3.0);
        vec3 w = worleyP(uv, 10, 1.0);
        vec3 w2 = worleyP(uv, 37, 1.0);
        float pits = smoothstep(0.0, 0.35, w2.x);
        float cells = w.y - w.x;
        float h = 0.5 + n1 * 0.35 + n2 * 0.15 + smoothstep(0.0, 0.25, cells) * 0.15 - (1.0 - pits) * 0.18;
        // turf algae (olive/brown), crustose coralline algae (pink-lilac), bare limestone (grey)
        vec3 limestone = vec3(0.42, 0.40, 0.36);
        vec3 turf = vec3(0.24, 0.22, 0.12);
        vec3 cca = vec3(0.55, 0.32, 0.40);
        vec3 sponge = vec3(0.50, 0.28, 0.10);
        float tm = smoothstep(-0.15, 0.35, fbmP(uv, 6, 4, 7.0));
        float cm = smoothstep(0.25, 0.55, fbmP(uv, 5, 4, 11.0)) * (1.0 - tm * 0.6);
        float sm = smoothstep(0.42, 0.6, fbmP(uv, 8, 3, 17.0));
        vec3 col = mix(limestone, turf, tm * 0.85);
        col = mix(col, cca, cm * 0.75);
        col = mix(col, sponge, sm * 0.5);
        col *= 0.78 + 0.35 * (h - 0.3);
        col *= mix(0.55, 1.0, pits);
        return vec4(col, clamp(h, 0.0, 1.0));
      }
    `,
  });
  lib.rockN = baker.normalFromHeight(lib.rockA, { size: S, strength: 5.0, roughnessExpr: '0.85' });

  // ---------------- Reef framework: mosaic of encrusting colonies, turf, coralline algae, crevices ----------------
  lib.reefA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec3 colonyCol(float id) {
        if (id < 0.16) return vec3(0.42, 0.32, 0.17);   // tan massive / encrusting
        if (id < 0.28) return vec3(0.27, 0.18, 0.10);   // brown
        if (id < 0.38) return vec3(0.30, 0.17, 0.27);   // purple Porites-type
        if (id < 0.50) return vec3(0.46, 0.24, 0.29);   // pink crustose coralline algae
        if (id < 0.66) return vec3(0.16, 0.15, 0.075);  // olive turf algae
        if (id < 0.74) return vec3(0.19, 0.25, 0.11);   // green encrusting
        if (id < 0.84) return vec3(0.50, 0.45, 0.32);   // cream
        if (id < 0.92) return vec3(0.21, 0.25, 0.31);   // blue-grey
        return vec3(0.36, 0.33, 0.26);                  // bare limestone
      }
      vec4 bake(vec2 uv) {
        vec2 wuv = uv + vec2(fbmP(uv, 5, 3, 1.0), fbmP(uv, 5, 3, 2.0)) * 0.04;
        vec3 w = worleyP(wuv, 13, 1.0);
        vec3 wb = worleyP(wuv + 0.37, 23, 1.0);
        float id = w.z;
        vec3 col = colonyCol(id);
        // secondary smaller colonies overlaid
        float small = step(0.62, wb.z) * smoothstep(0.30, 0.18, wb.x);
        col = mix(col, colonyCol(fract(wb.z * 7.31)), small);
        // texture inside colonies
        vec3 cups = worleyP(uv, 150, 0.9);
        float cupH = smoothstep(0.05, 0.4, cups.x);
        float mea = abs(sin(fbmP(uv, 24, 2, 5.0) * 30.0));
        float turfFuzz = fbmP(uv, 180, 2, 3.0);
        float isTurf = step(0.50, id) * step(id, 0.66);
        float isBrain = step(0.16, id) * step(id, 0.28);
        float tex = mix(cupH, mea, isBrain);
        tex = mix(tex, 0.5 + 0.5 * turfFuzz, isTurf);
        // colony domes and crevices between them
        float dome = 1.0 - w.x * w.x * 1.2;
        float crev = smoothstep(0.0, 0.16, w.y - w.x);
        float h = clamp(dome * 0.4 + tex * 0.2 + fbmP(uv, 4, 3, 9.0) * 0.25, 0.0, 1.0) * mix(0.55, 1.0, crev);
        col *= 0.78 + 0.32 * tex;
        col *= mix(0.55, 1.0, crev);
        // large-scale blending so the mosaic never reads as tiles
        vec3 broad = colonyCol(fract(fbmP(uv, 3, 2, 21.0) * 2.7 + 0.5));
        col = mix(col, broad * (0.8 + 0.3 * tex), 0.35);
        col *= 0.85 + 0.3 * fbmP(uv, 3, 3, 13.0);
        // desaturate slightly: living reef colours are muted
        col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 0.8);
        return vec4(col, h);
      }
    `,
  });
  lib.reefN = baker.normalFromHeight(lib.reefA, { size: S, strength: 7.0, roughnessExpr: '0.8' });

  // ---------------- Coral detail: corallite cups / polyps (normal + cavity) ----------------
  lib.coralA = baker.bake({
    size: 512, srgb: false,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        vec3 w = worleyP(uv, 24, 0.85);
        float cup = smoothstep(0.05, 0.38, w.x);
        float wall = smoothstep(0.02, 0.10, w.y - w.x);
        float h = cup * 0.6 + wall * 0.25 + fbmP(uv, 40, 2, 1.0) * 0.08;
        float cavity = mix(0.55, 1.0, cup);
        return vec4(cavity, w.z, fbmP(uv, 6, 3, 2.0) * 0.5 + 0.5, h);
      }
    `,
  });
  lib.coralN = baker.normalFromHeight(lib.coralA, { size: 512, strength: 4.0, roughnessExpr: '0.7' });

  // ---------------- Brain coral meanders ----------------
  lib.brainA = baker.bake({
    size: 512, srgb: false,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float n = fbmP(uv, 6, 4, 3.0);
        float m = fbmP(uv + vec2(n * 0.15), 10, 3, 8.0);
        float v = abs(sin(m * 28.0));
        float h = smoothstep(0.0, 0.9, v);
        return vec4(h, 0.0, 0.0, h);
      }
    `,
  });
  lib.brainN = baker.normalFromHeight(lib.brainA, { size: 512, strength: 6.0, roughnessExpr: '0.7' });

  // ---------------- Fine ripple normals for the water surface ----------------
  lib.rippleH = baker.bake({
    size: 512, srgb: false,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float h = fbmP(uv, 6, 5, 0.0) * 0.6 + fbmP(uv, 13, 3, 5.0) * 0.4;
        return vec4(h * 0.5 + 0.5);
      }
    `,
  });
  lib.rippleN = baker.normalFromHeight(lib.rippleH, { size: 512, strength: 2.2, channel: 'r', roughnessExpr: '1.0' });

  // ---------------- Generic organic noise (RGBA = 4 independent tileable fbm fields) ----------------
  lib.noise = baker.bake({
    size: 256, srgb: false,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        return vec4(fbmP(uv, 4, 5, 0.0), fbmP(uv, 8, 4, 3.0), fbmP(uv, 16, 3, 6.0), fbmP(uv, 2, 5, 9.0)) * 0.5 + 0.5;
      }
    `,
  });

  // ---------------- Metal plating with rust/encrustation (wreck, ship) ----------------
  lib.rustA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float n = fbmP(uv, 5, 6, 0.0);
        float n2 = fbmP(uv, 20, 4, 2.0);
        vec3 w = worleyP(uv, 14, 1.0);
        float crust = smoothstep(-0.1, 0.4, n + n2 * 0.4);
        vec3 rust = mix(vec3(0.30, 0.12, 0.05), vec3(0.46, 0.24, 0.10), n2 * 0.5 + 0.5);
        vec3 growth = mix(vec3(0.30, 0.28, 0.20), vec3(0.52, 0.32, 0.38), smoothstep(0.2, 0.7, w.z));
        vec3 col = mix(rust, growth, crust);
        float h = 0.5 + n * 0.3 + n2 * 0.15 + crust * 0.2 - smoothstep(0.12, 0.0, w.x) * 0.15;
        return vec4(col, clamp(h, 0.0, 1.0));
      }
    `,
  });
  lib.rustN = baker.normalFromHeight(lib.rustA, { size: S, strength: 4.0, roughnessExpr: '0.8' });

  // ---------------- Abyssal ooze / hadal sediment (fine, soft, with tracks and burrows) ----------------
  lib.oozeA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float n = fbmP(uv, 3, 5, 0.0);
        float fine = fbmP(uv, 64, 3, 4.0);
        vec3 w = worleyP(uv, 9, 1.0);
        float burrow = smoothstep(0.07, 0.0, w.x) * step(0.6, w.z);
        float mound = smoothstep(0.32, 0.0, w.x) * step(0.82, w.z);
        // faint meandering trails left by holothurians
        float trail = 1.0 - smoothstep(0.0, 0.012, abs(fbmP(uv, 2, 3, 21.0) - 0.05));
        float h = 0.5 + n * 0.12 + fine * 0.02 - burrow * 0.25 + mound * 0.18 - trail * 0.05;
        vec3 col = vec3(0.50, 0.44, 0.36) * (0.92 + n * 0.12 + fine * 0.05);
        col = mix(col, vec3(0.30, 0.26, 0.21), burrow * 0.8);
        col = mix(col, col * 0.85, trail);
        return vec4(col, clamp(h, 0.0, 1.0));
      }
    `,
  });
  lib.oozeN = baker.normalFromHeight(lib.oozeA, { size: S, strength: 2.5, roughnessExpr: '0.95' });

  // ---------------- Basalt / volcanic rock (vents, trench walls) ----------------
  lib.basaltA = baker.bake({
    size: S, srgb: true,
    fragment: /* glsl */ `
      vec4 bake(vec2 uv) {
        float n = fbmP(uv, 4, 6, 0.0);
        vec3 w = worleyP(uv, 6, 1.0);
        float frac = smoothstep(0.0, 0.05, w.y - w.x);
        float h = 0.45 + n * 0.35 + frac * 0.12;
        vec3 col = vec3(0.16, 0.155, 0.15) * (0.8 + n * 0.5);
        float sed = smoothstep(0.1, 0.5, fbmP(uv, 5, 3, 7.0));
        col = mix(col, vec3(0.40, 0.36, 0.30), sed * 0.45);
        float ox = smoothstep(0.35, 0.7, fbmP(uv, 7, 3, 13.0));
        col = mix(col, vec3(0.42, 0.22, 0.09), ox * 0.35);
        col *= mix(0.6, 1.0, frac);
        return vec4(col, clamp(h, 0.0, 1.0));
      }
    `,
  });
  lib.basaltN = baker.normalFromHeight(lib.basaltA, { size: S, strength: 5.0, roughnessExpr: '0.8' });

  for (const k in lib) lib[k].userData.shared = true;
  return lib;
}
