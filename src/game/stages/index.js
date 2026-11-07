// Stage registry: lazily loaded so each stage's code is its own chunk.
export const STAGES = [
  () => import('./s0_deck.js'),
  () => import('./s1_reef.js'),
  () => import('./s2_wall.js'),
  () => import('./s3_ascent.js'),
  () => import('./s4_chamber.js'),
  () => import('./s5_launch.js'),
  () => import('./s6_twilight.js'),
  () => import('./s7_midnight.js'),
  () => import('./s8_abyssal.js'),
  () => import('./s9_hadal.js'),
  () => import('./s10_ending.js'),
];

export const STAGE_META = [
  { id: 'deck', title: 'Prologue: the dive deck', zone: 'Surface', checkpoint: true, music: 'deck' },
  { id: 'reef', title: 'Sunlight Reef', zone: 'Sunlight zone · 0–30 m', checkpoint: true, music: 'reef' },
  { id: 'wall', title: 'Deep Wall & Wreck', zone: 'Sunlight zone · 30–60 m', checkpoint: true, music: 'wall' },
  { id: 'ascent', title: 'Ascent & decompression', zone: '60 → 3 m', checkpoint: true, music: 'deco' },
  { id: 'chamber', title: 'Deck decompression chamber', zone: 'Surface', checkpoint: true, music: 'deck' },
  { id: 'launch', title: 'Pod launch', zone: 'Surface', checkpoint: true, music: 'pod' },
  { id: 'twilight', title: 'Twilight Zone', zone: 'Mesopelagic · 200–1,000 m', checkpoint: true, music: 'twilight' },
  { id: 'midnight', title: 'Midnight Zone', zone: 'Bathypelagic · 1,000–4,000 m', checkpoint: true, music: 'midnight' },
  { id: 'abyssal', title: 'Abyssal Plain', zone: 'Abyssopelagic · 4,000–6,000 m', checkpoint: true, music: 'abyssal' },
  { id: 'hadal', title: 'Hadal Trench', zone: 'Hadalpelagic · 6,000–10,935 m', checkpoint: true, music: 'hadal' },
  { id: 'ending', title: 'Return', zone: 'Surface', checkpoint: false, music: 'ending' },
];
