# INTO THE HADAL — Build Plan

A first-person descent from a Guam coral reef to the floor of the Mariana Trench.
Vite + Three.js r187 + pmndrs `postprocessing`, vanilla ES modules, no backend,
no external downloads at runtime. Everything visual and audible is procedural
(the only bundled third-party asset is the Inter font, SIL OFL).

---

## 1. Architecture

### 1.1 Runtime layers

```
main.js ── Game (state machine: boot → title → loading → playing ⇄ paused/journal/photo → ending)
            │
            ├─ core/      Renderer, Loop, Input (kb/mouse/gamepad → actions), Settings, Save,
            │             Quality (presets + first-launch benchmark), Bus (events), Audio engine
            ├─ render/    WaterEnv (all optics uniforms), waterPatch (shader injection into PBR
            │             materials), Caustics (real-time photon-splat RT), UnderwaterSurface
            │             (Snell's window/TIR), Ocean + Sky (above water), MarineSnow, Bubbles,
            │             VolumetricPass (sun shafts + spot-light backscatter, half-res raymarch),
            │             PostFX (bloom, ACES grade, mask, narcosis, lens distortion + CA, grain, DoF),
            │             TextureBaker (GPU procedural textures)
            ├─ world/     Terrain (heightfields + wall sheets, chunked), Scatter (cell-instanced
            │             dressing), coral/rock/vent/wreck/ship generators, Collision world,
            │             StageManager (load/dispose/transition), stages/ (0 … 10)
            ├─ player/    Walker (deck), Diver (scuba physics + air + Bühlmann NDL), Pod (thrusters,
            │             systems, floodlights, sonar, manipulator arm), Cockpit (diegetic instruments)
            ├─ creatures/ species registry, appearance (per-species mesh + pattern params),
            │             geometry generators (fish, shark, ray, turtle, cephalopod, jelly, whale,
            │             crustacean, invertebrates), creature material (swim/pulse vertex
            │             animation + GLSL pattern + water), behaviours, boids, CreatureManager
            ├─ events/    one module per hands-on event (gear check … drop-weight jam)
            └─ ui/        HUD (wrist computer, air, compass), radio subtitles, scan reticle +
                          lower-third + card, journal, photo mode, objectives, prompts, menus
```

### 1.2 The water model (the heart of the look)

All lit materials are standard three.js PBR materials patched with `onBeforeCompile`:

* **Natural light** – the sun (DirectionalLight, refracted direction) and sky
  (HemisphereLight) are multiplied per fragment by `exp(-Kd · depth)` (per-RGB
  Beer–Lambert downwelling attenuation). The sun term is also multiplied by caustics.
* **Artificial light** – every point/spot light contribution is multiplied by
  `exp(-c · distance(light, fragment))`. Torch light only travels a few metres, so it
  restores reds that sunlight lost over 40 m of water — the "red sea fan" moment.
* **View path** – the fog chunk is replaced by transmittance `exp(-c·r)` plus a
  closed-form in-scatter integral along the ray through a depth-attenuated light field:
  `S = b·E0·e^(−Kd·dc) · (1 − e^(−(c − Kd·dir.y)·r)) / (c − Kd·dir.y)`.
  Looking up is brighter, looking down darker, and it all goes to black with depth.
* **Volumetrics** – a half-res raymarch through the same medium adds sun shafts
  (sampling the caustic map projected to the surface along the sun ray) and
  spot-light backscatter with Henyey–Greenstein phase, then blur + composite.
* **Above water** (deck stages) the same chunk switches to aerial haze.

Optics are driven by a depth profile (`WaterEnv.profileAt(depth)`), so transitions
just animate depth and the light changes by itself.

### 1.3 Coordinates and depth

1 unit = 1 m, +Y up. `depth = depthBase − y`. Scuba stages use `depthBase = 0`
(surface at y = 0). Pod stages use local coordinates near the origin with
`depthBase` set to the zone depth, so precision is fine at 10,900 m.

### 1.4 Stages

Each stage is a module with `async build(ctx)`, `start()`, `update(dt)`, `dispose()`.
`build` yields between heavy steps so the transition animation never freezes, then
calls `renderer.compileAsync` to warm shaders. The previous stage's geometry, materials
and textures are disposed (tracked through a per-stage `Disposer`).

| # | Stage | Player | Key systems |
|---|---|---|---|
| 0 | Deck prologue | Walker | Sky, ocean, ship, gear-check event, back-roll entry |
| 1 | Sunlight Reef | Diver | Reef terrain, caustics, god rays, Snell's window, ghost net |
| 2 | Deep Wall & Wreck | Diver | Wall sheet, wreck, data logger, narcosis, shark display, free-flow |
| 3 | Ascent & deco | Diver | Ascent line, current, ±1 m stop bands, hang tank |
| 4 | Deck chamber | Walker → seat | Surface interval timer, chamber interior, O2 periods, pressure fault |
| 5 | Pod launch | Pod | A-frame, checklist switches, splash-down |
| 6 | Twilight | Pod | Slope, whale clicks + pass, CO2 scrubber |
| 7 | Midnight | Pod | Lights-off, CO2 droplet vent, black smokers, power failure, plume + sonar |
| 8 | Abyssal | Pod | Nodule plain, arm sampling, cable entanglement |
| 9 | Hadal | Pod | Lander/bait station, trench floor, ECHO-7, plastic bag, drop-weight jam |
| 10 | Ending | Pod → screen | Ascent montage, dusk surfacing, summary, credits |

### 1.5 Data

* `src/data/species.json` – documentary data (fields from the spec + `sourceNote`).
* `src/creatures/appearance.js` – per-species geometry & GLSL colour pattern.
* `src/data/dialogue.json` – every radio line, keyed by beat.
* `src/data/facts.json` – loading-screen facts.

### 1.6 Save

`localStorage` key `into-the-hadal/v1`: checkpoint stage, stats, journal, photo
thumbnails (small JPEGs), settings. Every access is wrapped in try/catch; a blocked
storage simply means no persistence.

---

## 2. Milestones

| M | Content | Verify |
|---|---|---|
| M1 | Water look test scene: reef patch, absorption, fog, caustics, god rays, surface from below, marine snow, bubbles, torch cone, post | Screenshots at 5/20/40 m; torch on sea fan at 40 m |
| M2 | Input, diver physics + collision, scuba HUD, deck prologue, gear check, back-roll | Play prologue → water entry |
| M3 | Species system, all creature generators, behaviours, scan, journal, photo mode; Zone 1 | Scan every reef species |
| M4 | Zone 2 wall + wreck, narcosis, shark display, free-flow | Events pass/fail paths |
| M5 | Ascent + deco stops, surface interval, chamber + pressure fault | |
| M6 | Pod cockpit, controls, systems, launch + checklist, Twilight zone + CO2 event | |
| M7 | Midnight zone: bioluminescence, vents, power failure, sediment plume + sonar | |
| M8 | Abyssal + Hadal, ECHO-7, drop-weight jam, ending + summary + credits | |
| M9 | Audio pass, menus, settings, save/continue, loading screens | |
| M10 | Full playthrough, perf tuning per preset, bug fixing, deploy configs, README | |

Each milestone: run dev server, screenshot with Playwright (`scripts/shot.cjs`),
check the console, fix, update `PROGRESS.md`, commit, push.

---

## 3. Performance budget (medium, Iris Xe, 1080p)

* Pixel ratio ≤ 1.5 (× resolution scale); volumetrics half-res with 20 steps.
* ≤ 250 draw calls: corals/rocks/fish are cell-instanced `InstancedMesh`es; schools are one mesh.
* Terrain chunked 8×8 for frustum culling; camera far plane tied to visibility.
* Caustics 256–512² updated every frame from a 128–192² grid.
* Shader warm-up with `compileAsync` during transitions; no runtime material creation.

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Procedural creatures look generic | Species-specific profiles + GLSL patterns, real scale, careful countershading/specular; iterate with screenshots |
| Software-GPU screenshots are slow | Dev URL params jump straight to scenes/depths; capture single frames |
| Shader patching tied to three internals | three pinned to 0.187.0; patcher asserts every replacement applied |
| Scope (11 stages, 40+ species, 12 events) | Shared generators/systems; events built on one interaction framework |
| Ctrl+W closes the tab while descending | C is the primary descend key, Ctrl secondary; `beforeunload` guard during play |
| Pointer lock unavailable | Input falls back to drag-to-look |
| Fact accuracy | Conservative facts only, verified; `sourceNote` per species |
