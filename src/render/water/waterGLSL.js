// Shared GLSL for the underwater optical model.
// Depth below the surface: d = uWDepthBase - worldPos.y  (metres)
//  - downwelling natural light  : E(d)  = E0 * exp(-Kd * d)           (per RGB channel)
//  - artificial light path      : T(l)  = exp(-sigma * l)
//  - view path                  : col * exp(-sigma * r) + inScatter(r)
// The in-scatter term is the closed-form integral of single scattering of the
// depth-attenuated ambient light field along the view ray.

export const WATER_UNIFORMS_GLSL = /* glsl */ `
uniform float uWTime;
uniform float uWDepthBase;
uniform float uWAbove;
uniform vec3  uWKd;
uniform vec3  uWSigma;
uniform vec3  uWScatter;
uniform vec3  uWSunColor;
uniform vec3  uWSkyColor;
uniform vec3  uWSunDir;
uniform float uWCaustics;
uniform float uWCausticScale;
uniform sampler2D uWCausticMap;
uniform vec3  uWHazeColor;
uniform float uWHazeDensity;
uniform vec2  uWSurge;
uniform float uWSurgeAmp;
uniform float uWInScatterGain;
uniform float uWLightPath;
`;

export const WATER_FUNCS_GLSL = /* glsl */ `
float wDepth(vec3 wp) { return uWDepthBase - wp.y; }

vec3 wTrans(float r) { return exp(-uWSigma * r); }

// Transmittance for artificial light travelling distance l (slightly reduced so lamps reach usefully far).
vec3 wLightPath(float l) { return exp(-uWSigma * uWLightPath * l); }

float wPhaseSun(vec3 dir) {
  float c = max(dot(dir, uWSunDir), 0.0);
  return 0.55 + 1.1 * c * c * c * c + 2.2 * pow(c, 24.0);
}

// In-scattered radiance along a ray from the camera (depth dc) in direction dir for distance r.
vec3 wInScatter(float dc, vec3 dir, float r) {
  vec3 E0 = (uWSunColor * wPhaseSun(dir) + uWSkyColor) * uWScatter * uWInScatterGain;
  vec3 k = max(uWSigma - uWKd * dir.y, vec3(1e-3));
  return E0 * exp(-uWKd * max(dc, 0.0)) * (1.0 - exp(-k * r)) / k;
}

// Caustic light multiplier (mean ~1) for a point at depth d. Deeper -> larger, softer pattern.
float wCaustic(vec3 wp, float d) {
  float strength = uWCaustics * smoothstep(28.0, 0.5, d);
  if (strength <= 0.001) return 1.0;
  vec2 surf = wp.xz + uWSunDir.xz * (d / max(uWSunDir.y, 0.25));
  float sc = uWCausticScale * (0.55 + d * 0.045);
  float lod = log2(1.0 + d * 0.12) + 0.9;
  vec2 uv1 = surf / sc;
  vec2 r2 = vec2(surf.x * 0.8 - surf.y * 0.6, surf.x * 0.6 + surf.y * 0.8);
  vec2 uv2 = r2 / (sc * 2.37) + vec2(0.37, 0.71);
  float c1 = textureLod(uWCausticMap, uv1, lod).r;
  float c2 = textureLod(uWCausticMap, uv2, lod + 1.5).r;
  float c = c1 * mix(1.0, c2, 0.45);
  // cells are never fully dark: overlapping wave scales and the sun's angular size soften them with depth
  c = mix(c, 1.0, mix(0.22, 0.6, smoothstep(2.0, 22.0, d)));
  return mix(1.0, c, strength);
}

// Applies the view-path medium to a shaded colour (opaque/alpha surfaces).
vec3 wApplyMedium(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float r = length(v);
  if (uWAbove > 0.5) {
    float f = 1.0 - exp(-r * uWHazeDensity);
    return mix(col, uWHazeColor, f);
  }
  vec3 dir = v / max(r, 1e-4);
  float dc = wDepth(cameraPosition);
  return col * wTrans(r) + wInScatter(dc, dir, r);
}

// Additive surfaces: only transmittance.
vec3 wApplyMediumAdditive(vec3 col, vec3 wp) {
  if (uWAbove > 0.5) return col;
  float r = length(wp - cameraPosition);
  return col * wTrans(r);
}
`;

// Replacement for three's <lights_fragment_begin>: natural light attenuated by depth (+caustics),
// artificial lights attenuated along their path through the water.
export function buildLightsChunk(original) {
  let s = original;
  const rep = (a, b) => {
    if (!s.includes(a)) throw new Error('[waterPatch] lights chunk changed: ' + a);
    s = s.split(a).join(b);
  };
  rep('getPointLightInfo( pointLight, geometryPosition, directLight );',
    'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color *= wLightAtten( length( pointLight.position - geometryPosition ) );');
  rep('getSpotLightInfo( spotLight, geometryPosition, directLight );',
    'getSpotLightInfo( spotLight, geometryPosition, directLight ); directLight.color *= wLightAtten( length( spotLight.position - geometryPosition ) );');
  rep('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= wSunAtten;');
  rep('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );',
    'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * wAmbAtten;');
  rep('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
    'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * wAmbAtten;');
  const pre = /* glsl */ `
  float wFragDepth = wDepth( vWaterWorldPos );
  vec3 wSunAtten = vec3( 1.0 );
  vec3 wAmbAtten = vec3( 1.0 );
  if ( uWAbove < 0.5 || wFragDepth > 0.0 ) {
    vec3 wDown = exp( -uWKd * max( wFragDepth, 0.0 ) );
    wSunAtten = wDown * wCaustic( vWaterWorldPos, max( wFragDepth, 0.0 ) );
    wAmbAtten = wDown * wAO;
  } else {
    wAmbAtten = vec3( wAO );
  }
  `;
  return pre + s;
}
