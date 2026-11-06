# PROGRESS

## Status: M3 complete. Next: M4 (deep wall & wreck: narcosis, shark threat display, free-flow).

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

- **M3 — Species system, Sunlight Reef**
  - 49 verified western-Pacific species in `src/data/species.json` (conservative facts, IUCN wording, source notes).
  - Procedural species meshes at real size: lofted bodies (profiles, caudal types, median/paired fins incl. shark
    "wings" and lionfish fans, spines, eyes, lures) plus special builders (turtles, rays, octopuses, jellies,
    siphonophore, crustaceans, bivalves, snail, sea pig, cucumber, brittle star, glass sponge, xenophyophore,
    sperm whale). Winding auto-fixed against normals; normals validated in Node (`scripts/dev/*.mjs`).
  - Creature material: swim deformation in the vertex shader (fish / eel / shark incl. threat display / ray /
    turtle / whale / jelly / octopus / crustacean / siphonophore / limbs) with CPU-integrated phase, path-curvature
    body bend, per-species GLSL colour patterns (scutes, bands, mazes, spots) on the water-optics patch.
  - CreatureManager: instanced groups with behaviours — school (boids + wandering anchor, refuge diving), vortex,
    cruise, graze, rest, hover, ambush, territorial (anemonefish chase), cleaning (wrasse service a client),
    giant (path), hide (peek/retreat + alarm colour), curious (approaches a still diver), drift/pulse, swarm, crawl,
    herd, perch; flee on fast approach, ground/surface avoidance, collision, banking.
  - Scanner: 0.3 s reticle lock → lower third, E scan sweep with occlusion check, chime + toast on first scan,
    species card (depth, size, diet, IUCN badge, range, fact). Journal (J): zones, silhouettes generated from the
    species' own geometry, detail pages with photos. Photo mode (P): world freeze, free camera within 6 m,
    auto/manual focus DoF, exposure, PNG download, thumbnails, discovery by photo.
  - Sunlight Reef populated with all 15 reef species; objectives (scan, cleaning station, manta, slope south);
    manta visit with cleaner wrasse servicing it; ghost-net entanglement (four monofilament strands cut with the
    knife by holding E, thrashing tightens lines and raises panic/air use); transition to the wall at the drop-off.
  - Dev: `?sim=N` runs N logic steps per rendered frame for headless flow tests (`scripts/play.cjs`).

### Verified screenshots (headless SwiftShader)
- 3–5 m sand with caustics, 8 m Snell's window, 16 m reef slope, 40 m sea fan with/without torch
  (torch reveals red), 316 m torch-lit reef.
- M3: creature galleries per zone (studio), resting green turtle on sand, anemone with anemonefish + lower third,
  manta arriving at the station under god rays, ghost-net curtain + strands, cutting flow, photo mode with DoF,
  journal grid and detail page.

### Known issues / to revisit
- Ship model needs a detailing pass (rounded members, rails, fittings, superstructure detail) — planned with M5/M6.
- Stages 2–10 are temporary dev stubs until their milestones.
- Reef colonies still read somewhat CG up close.
- Some deep-zone creature models are simple silhouettes; refine when their zones are built (M6–M8).
- Table-coral outlines are polygonal from below.
- Marine snow density must be raised per deep zone.

### Next
- M4: Deep wall & wreck (30–60 m): vertical wall with overhangs and fans, wreck on a ledge, grey reef shark threat
  display, barracuda vortex, narcosis, regulator free-flow (switch to the backup second stage), deco planning.
