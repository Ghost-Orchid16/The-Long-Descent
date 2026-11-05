# PROGRESS

## Status: M2 complete. Next: M3 (species system, creatures, scanning, journal, photo mode, Zone 1).

### Done
- **M1 — Water look test scene**
  - Per-fragment Beer–Lambert model injected into three.js PBR materials (`src/render/water/`):
    downwelling attenuation of sun + sky by depth, lamp-path attenuation for artificial lights,
    closed-form view-path in-scatter, aerial haze above water.
  - Real-time caustics (refracted photon grid, area-ratio intensity, tileable, mipmapped for depth blur).
  - Surface from below: Snell's window, exact water→air Fresnel, total internal reflection, sun disc.
  - Volumetric pass (half-res raymarch): sun shafts from projected caustics + spot-lamp backscatter.
  - Marine snow (2 layers, camera-wrapped, lamp-lit, motion streaks), bubbles (terminal velocity by size,
    wobble, Boyle's-law growth, breakup, mushroom caps).
  - Post: bloom, partial depth-aware white balance (documentary-style chromatic adaptation), ACES fit,
    dive-mask frame, lens pincushion + edge chromatic aberration, grain, fade; photo-mode DoF ready.
  - Procedural GPU textures (sand ripples, reef framework mosaic, rock, coral cups, brain meanders,
    rust, ooze, basalt, ripple normals).
  - Reef builder: spur-and-groove slope, sand channels, bommies, 15 coral/sponge/rock generators,
    gorgonian fan with anti-aliased net membrane, CPU-culled instancing (~50 draw calls for ~60k instances).
  - Dev harness `?dev=m1` (camera, depth offset, torch, gallery, focus) + `scripts/shot.cjs`.

- **M2 — Diver, HUD, prologue**
  - Game framework: state machine, lazily loaded stages, checkpoints/saves, interaction system
    (press / hold / drag / click), radio subtitles with skip, objectives, toasts, markers, fades.
  - Input: keyboard (C primary descend, Ctrl secondary), pointer lock with drag-look fallback, gamepad.
  - Diver: inertia + quadratic drag, current, collision (heightfields, sheets, spheres, capsules, boxes),
    smoothed look, fin-kick bob (off in reduced motion), breathing cycle synced to exhaust bubbles and
    audio, air model (12 L @ 200 bar, SAC 13 L/min, dive clock ×2.5), Bühlmann ZHL-16C NDL/ceiling/stop,
    ascent-rate warning, narcosis factor, torch.
  - Wrist computer HUD, air bar, compass.
  - Procedural audio engine (pre-rendered breaths, bubbles, splash, squelch, chime, scan, heart, ping,
    creaks, alarms; beds for reef/deck/pod/chamber; reverb; narcosis delay; spatial panners).
  - Deck prologue: Preetham sky with clouds, Gerstner ocean with reflections and sun glitter, Guam on the
    horizon, R/V Tåsi on the swell, walker, gear check (SPG close-up, purge, BCD, mask), back-roll into the reef.

### Verified screenshots (headless SwiftShader)
- 3–5 m sand with caustics, 8 m Snell's window, 16 m reef slope, 40 m sea fan with/without torch
  (torch reveals red), 316 m torch-lit reef.

### Known issues / to revisit
- Ship model needs a detailing pass (rounded members, rails, fittings, superstructure detail) — planned with M5/M6.
- Stages 2–10 are temporary dev stubs until their milestones.
- Reef colonies still read somewhat CG up close; revisit in M3 together with fish life.
- Table-coral outlines are polygonal from below.
- Marine snow density must be raised per deep zone.

### Next
- M2: Input → Diver physics/collision, wrist computer HUD, compass, air; deck prologue with gear check;
  back-roll entry.
