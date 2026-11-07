# PROGRESS

## Status: M7 complete. Next: M8 (abyssal plain + arm sample + cable entanglement, hadal trench + bait station + ECHO-7 + drop-weight jam, ending).

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

- **M4 — Deep Wall & Wreck (30–60 m)**
  - Wall face as a displaced sheet (buttresses, terraces, caves, slight undercut) with a rounded rocky lip joining the
    reef-top height field; 50 m ledge falling away on three sides; collision for sheet, lip and ledge.
  - Reef dressing refactored into a shared kit (`makeReefKit`); wall dressing by depth (plates and soft corals up top,
    gorgonians, wire corals, sponges deeper), drop-off rim, ledge and wreck growth; giant red fan at ~40 m (torch moment).
  - Fictional broken-backed coastal freighter (`world/wreck.js`): lofted hull with bilge radius, open holds, forecastle,
    deckhouse + bridge, leaning funnel, masts and derricks, winches, spilled drums; rust/fouling triplanar material;
    box/capsule colliders; moray holes; expedition acoustic recorder on the forward mast (first ECHO-7 clue: its
    emergency pinger is still running).
  - Grey reef shark threat display event (approach, hunched display with exaggerated swimming and rolling, progress by
    stopping/facing/backing to the wall, escalation to a close pass + panic breathing, forgiving exit).
  - Regulator free-flow event (roar, bubble wall, gas drain with a safety floor; grab, purge and breathe the yellow
    backup, then turn the H-valve's left post closed by dragging). Gas and tissue state carry into the next stage.
  - Narcosis radio + effect, chevron barracuda vortex, trevally, eagle rays, morays, sharks; ascent line from the bow.
  - Optics: stronger deep adaptation, more diffuse light field with depth, mesopic desaturation of dim natural-light
    scenes (lamp-lit areas keep colour), torch no longer darkens daylight scenes, god rays fade out by ~48 m.

- **M5 — Ascent, decompression, deck chamber**
  - Ascent line from the wreck depth to a surface buoy with stop tags, research vessel overhead, distant wall.
  - In-water stops at 12, 9 and 6 m (compressed to 30–45 s): ±1 m band, timer fills only inside the band, current that
    strengthens away from the line plus vertical surges; stop gauge HUD; wrist computer shows the scripted stop;
    fast ascents add time to the next stop; hang tank at 6 m (hold E to switch, 196 bar).
  - Surface decompression: the surface interval (5 min, compressed) runs from leaving the 6 m stop, carries onto the
    deck; climb into the chamber; late arrival switches to the longer table (no fail).
  - Chamber interior inside the ship's chamber (cream steel shell, ring seams, benches, door, lamps, BIBS masks,
    depth gauge with green band, supply/exhaust handwheels, O2 analyser LCD). Procedure: blow down to 15 m with ear
    clearing, O2 period, air break, pressure fault (drifting needle with surges, hold 36 s in the green using the two
    valves; out of the green for 9 s → tender stabilises it and some progress is lost), second O2 period, surfacing,
    "two days later" card into the pod launch.

- **M6 — Pod, launch, Twilight zone**
  - Pod exterior (`world/podModel.js`): titanium sphere with the viewport opening, frame and skids, syntactic foam,
    thrusters, three floodlight booms, sample basket, drop weights, articulated manipulator arm.
  - Cockpit (`player/Cockpit.js`): padded sphere interior, acrylic viewport (rim condensation, droplets, scratches,
    Fresnel glint), console with three live canvas screens (navigation: depth, vertical speed, outside pressure in atm,
    water temperature, heading tape; life support: O2, CO2 ppm, battery, cabin; sonar PPI), overhead checklist
    switches with LEDs, CO2 scrubber unit with hinged cover/canisters/fan, breaker panel, hatch, seat, cabin lights
    (compensated for outside eye adaptation). Interior materials ignore sun and sky.
  - Pod controller (`player/Pod.js`): spool-up thrusters, momentum and drag, yaw, vertical thrust, collision with bump
    feedback, free head look, floods (F), sonar ping (R) with terrain/target returns, 2-link IK arm (hold right mouse,
    click to grip), battery/O2/CO2/cabin model, CO2 dims vision, hull creaks growing with depth, thruster audio,
    ocean temperature profile.
  - Launch stage: pod in the cradle, board from the deck, five-switch checklist in order (radio facts incl. the
    one-atmosphere sphere), A-frame hoist / run aft / swing out / lower with pendulum sway, splash, bobbing on the
    swell with the waterline across the viewport, flood the ballast to dive.
  - Twilight stage: guided descent 25 → 330 m with the depth counter running, light fading, snow rushing past and
    radio lines; seamount flank 355–640 m (basalt and ooze, black corals, gorgonians, sponges, boulders);
    nautilus, hatchetfish, lanternfish school, siphonophore, comb jellies, vampire squid, sixgill; faint overhead glow;
    sperm whale heard clicking (positional clicks, then creaks) before it crosses in front of the pod;
    CO2 scrubber alarm (open panel, pull canister, insert spare, restart fan); ballast flood to continue.

- **M7 — Midnight zone**
  - Guided descent 640 → 1,560 m with a brief giant squid crossing the floods at ~900 m and radio facts.
  - Area A (~1,600 m): volcano flank with a sediment basin, small white chimneys and a liquid-CO2 seep (milky droplets
    rising in wavering columns, after the NW Eifuku "Champagne" vent), vent mussel beds, anglerfish, fangtooth,
    loosejaw, gulper eel, Atolla jellyfish. Lights-off moment: floods off for 20 s while bioluminescent sparks
    (spontaneous and wake-triggered flashes) and the Atolla's "burglar alarm" display play out.
  - Second descent to 3,560 m with the power failure at ~2,400 m: floods, screens, cabin lights and thrusters die,
    red emergency light, breaker panel restored in order (life support → lights → thrusters; wrong order trips back);
    the pod now models separate power buses.
  - Area B (~3,600 m): sulphide mound with flanged black-smoker chimneys and smoke plumes lit by the floods, vent shrimp
    swarming the chimney walls, vent crabs at the bases, hairy snails near the orifices. Sediment plume: visibility
    near zero (plume water type, milky flood backscatter, short scanner range), sonar pings reveal terrain and the exit
    waypoint box; reach it to clear the water. Ballast flood continues to the abyssal plain.
  - Viewport glass condensation now depends on the light reaching it (no glow in total darkness).

### Verified screenshots (headless SwiftShader)
- 3–5 m sand with caustics, 8 m Snell's window, 16 m reef slope, 40 m sea fan with/without torch
  (torch reveals red), 316 m torch-lit reef.
- M3: creature galleries per zone (studio), resting green turtle on sand, anemone with anemonefish + lower third,
  manta arriving at the station under god rays, ghost-net curtain + strands, cutting flow, photo mode with DoF,
  journal grid and detail page.
- M4: drop-off lip, wall face at 40 m (natural light and torch on the red fan), barracuda vortex, wreck from above,
  free-flow bubble wall and H-valve overlay; shark display and free-flow flows driven headless with `?sim=`.
- M5: 12 m stop with stop gauge and Snell's window, hang tank swap, deck with surface-interval timer, chamber
  interior (mask, panel, gauge, valves); pressure-fault dynamics verified with a scripted controller.
- M6: pod on deck in its cradle, cockpit with screens and viewport, overhead switches, A-frame lift, guided descent at
  26 m, seamount summit and flank with floods, cockpit with floods off; whale pass and CO2 flows driven headless.
- M7: CO2 seep with white chimneys and droplets, lights-off bioluminescence, red emergency cockpit with breakers,
  black-smoker chimney in the floods, sediment plume; power failure and plume flows driven headless.

### Known issues / to revisit
- Ship model needs a detailing pass (rounded members, rails, fittings, superstructure detail) — planned with M5/M6.
- Stages 2–10 are temporary dev stubs until their milestones.
- Reef colonies still read somewhat CG up close.
- Some deep-zone creature models are simple silhouettes; refine when their zones are built (M6–M8).
- Table-coral outlines are polygonal from below.
- Marine snow density must be raised per deep zone.

### Next
- M8: Abyssal plain (~4,600 m: sea pigs, tripod fish, dumbo octopus, glass sponges, brittle stars, grenadiers; arm
  sample; cable entanglement), hadal trench (~7,000 m bait station with snailfish and amphipods; ~10,900 m floor
  with xenophyophores, ECHO-7 and the plastic bag; drop-weight jam), ending ascent, summary and credits.
