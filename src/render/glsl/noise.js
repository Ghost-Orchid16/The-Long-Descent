// GLSL noise library (GLSL ES 3.00). Written for this project.
// Integer hashing uses the PCG family (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020).

export const NOISE_GLSL = /* glsl */ `
#ifndef HADAL_NOISE
#define HADAL_NOISE

uvec3 hPcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
uint hPcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
vec3 hHash33(ivec3 p) { return vec3(hPcg3(uvec3(p))) * (1.0 / 4294967295.0); }
float hHash13(ivec3 p) { return hHash33(p).x; }
float hHash12(vec2 p) { return float(hPcg(uint(int(floor(p.x))) * 1973u + uint(int(floor(p.y))) * 9277u + 26699u)) * (1.0 / 4294967295.0); }
float hHash11(float p) { return float(hPcg(uint(int(floor(p))) + 9127u)) * (1.0 / 4294967295.0); }

vec3 hGrad(ivec3 p) { return normalize(hHash33(p) * 2.0 - 1.0 + 1e-5); }

// 3D gradient noise in [-1, 1] (approx).
float gnoise(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(hGrad(i + ivec3(0,0,0)), f - vec3(0,0,0));
  float n100 = dot(hGrad(i + ivec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(hGrad(i + ivec3(0,1,0)), f - vec3(0,1,0));
  float n110 = dot(hGrad(i + ivec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(hGrad(i + ivec3(0,0,1)), f - vec3(0,0,1));
  float n101 = dot(hGrad(i + ivec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(hGrad(i + ivec3(0,1,1)), f - vec3(0,1,1));
  float n111 = dot(hGrad(i + ivec3(1,1,1)), f - vec3(1,1,1));
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

// Tileable 3D gradient noise: x/y wrap with integer period p (z free).
float gnoiseP(vec3 x, ivec2 p) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define HW(o) ivec3((i.x + o.x) - p.x * int(floor(float(i.x + o.x) / float(p.x))), (i.y + o.y) - p.y * int(floor(float(i.y + o.y) / float(p.y))), i.z + o.z)
  float n000 = dot(hGrad(HW(ivec3(0,0,0))), f - vec3(0,0,0));
  float n100 = dot(hGrad(HW(ivec3(1,0,0))), f - vec3(1,0,0));
  float n010 = dot(hGrad(HW(ivec3(0,1,0))), f - vec3(0,1,0));
  float n110 = dot(hGrad(HW(ivec3(1,1,0))), f - vec3(1,1,0));
  float n001 = dot(hGrad(HW(ivec3(0,0,1))), f - vec3(0,0,1));
  float n101 = dot(hGrad(HW(ivec3(1,0,1))), f - vec3(1,0,1));
  float n011 = dot(hGrad(HW(ivec3(0,1,1))), f - vec3(0,1,1));
  float n111 = dot(hGrad(HW(ivec3(1,1,1))), f - vec3(1,1,1));
  #undef HW
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbm3(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    s += a * gnoise(p);
    n += a;
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    a *= 0.5;
  }
  return s / n;
}

// Tileable fbm over [0,1)^2 with base period per (integer cells across the tile).
float fbmP(vec2 uv, int per, int oct, float z) {
  float a = 0.5, s = 0.0, n = 0.0;
  int pp = per;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    s += a * gnoiseP(vec3(uv * float(pp), z + float(k) * 7.31), ivec2(pp));
    n += a;
    pp *= 2;
    a *= 0.5;
  }
  return s / n;
}

// Tileable cellular (Worley) noise. Returns (F1, F2, cellId).
vec3 worleyP(vec2 uv, int per, float jitter) {
  vec2 x = uv * float(per);
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int xx = -1; xx <= 1; xx++) {
    ivec2 c = i + ivec2(xx, y);
    ivec2 cw = ivec2(c.x - per * int(floor(float(c.x) / float(per))), c.y - per * int(floor(float(c.y) / float(per))));
    vec3 h = hHash33(ivec3(cw, 71));
    vec2 o = vec2(xx, y) + 0.5 + (h.xy - 0.5) * jitter - f;
    float d = dot(o, o);
    if (d < f1) { f2 = f1; f1 = d; id = h.z; } else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// Non-tiling 3D Worley (F1).
float worley3(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  float f1 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int xx = -1; xx <= 1; xx++) {
    ivec3 c = i + ivec3(xx, y, z);
    vec3 o = vec3(xx, y, z) + hHash33(c) - f;
    f1 = min(f1, dot(o, o));
  }
  return sqrt(f1);
}

// Interleaved gradient noise (Jimenez 2014) for dithering / ray jitter.
float ign(vec2 px, float frame) {
  px += 5.588238 * mod(frame, 64.0);
  return fract(52.9829189 * fract(0.06711056 * px.x + 0.00583715 * px.y));
}

#endif
`;
