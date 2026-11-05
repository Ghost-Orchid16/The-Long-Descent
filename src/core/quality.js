// Graphics quality presets.
export const PRESETS = {
  low: {
    name: 'low', pixelRatioCap: 1.0, caustics: 256, causticGrid: 128, causticInterval: 1 / 30,
    volScale: 0.33, volSteps: 10, msaa: 0, snow: 0.45, shadows: false, lens: false, texSize: 512,
    dressDensity: 0.55, grain: 0.7, creatureDensity: 0.6, terrainCell: 1.25,
  },
  medium: {
    name: 'medium', pixelRatioCap: 1.5, caustics: 512, causticGrid: 256, causticInterval: 0,
    volScale: 0.5, volSteps: 18, msaa: 2, snow: 0.75, shadows: false, lens: true, texSize: 1024,
    dressDensity: 0.8, grain: 1, creatureDensity: 0.85, terrainCell: 1.0,
  },
  high: {
    name: 'high', pixelRatioCap: 2.0, caustics: 512, causticGrid: 256, causticInterval: 0,
    volScale: 0.5, volSteps: 26, msaa: 4, snow: 1.0, shadows: true, lens: true, texSize: 1024,
    dressDensity: 1.0, grain: 1, creatureDensity: 1.0, terrainCell: 0.8,
  },
};

export function getPreset(name) {
  return PRESETS[name] || PRESETS.medium;
}
