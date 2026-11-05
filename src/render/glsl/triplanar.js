// Triplanar sampling helpers (world space). Normal blending: "whiteout" (B. Golus, 2017).
export const TRI_FUNCS_GLSL = /* glsl */ `
#ifndef HADAL_TRI
#define HADAL_TRI
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(6.0)); return w / (w.x + w.y + w.z + 1e-5); }
vec4 triS(sampler2D t, vec3 p, vec3 w, float s) {
  #ifdef TRI_TOP_ONLY
    return texture2D(t, p.xz * s);
  #else
    vec4 c = texture2D(t, p.xz * s) * w.y;
    if (w.x > 0.02) c += texture2D(t, p.zy * s) * w.x;
    if (w.z > 0.02) c += texture2D(t, p.xy * s) * w.z;
    return c;
  #endif
}
vec3 triNrm(sampler2D t, vec3 p, vec3 n, vec3 w, float s) {
  vec3 tY = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 sg = sign(n + 1e-6);
  tY.x *= sg.y;
  vec3 nY = vec3(tY.xy + n.xz, abs(tY.z) * n.y);
  vec3 acc = nY.xzy * w.y;
  #ifndef TRI_TOP_ONLY
  if (w.x > 0.02) {
    vec3 tX = texture2D(t, p.zy * s).xyz * 2.0 - 1.0; tX.x *= sg.x;
    vec3 nX = vec3(tX.xy + n.zy, abs(tX.z) * n.x);
    acc += nX.zyx * w.x;
  }
  if (w.z > 0.02) {
    vec3 tZ = texture2D(t, p.xy * s).xyz * 2.0 - 1.0; tZ.x *= -sg.z;
    vec3 nZ = vec3(tZ.xy + n.xy, abs(tZ.z) * n.z);
    acc += nZ.xyz * w.z;
  }
  #endif
  return normalize(acc + n * 0.001);
}
#endif
`;
