# Into the Hadal

A first-person deep-sea exploration game for desktop browsers. You start on a research vessel off Guam, scuba-dive a
coral reef and a deep wall with a wreck, decompress on the way up and in a deck chamber, then take a one-person
submersible pod down through the twilight, midnight, abyssal and hadal zones to the floor of the Mariana Trench at
about 10,900 m, where the silent lander ECHO-7 lies beside a plastic bag. Calm wonder, moments of real tension, no
combat, forgiving failure. About 35–50 minutes.

Everything you see and hear is generated procedurally in the browser: no downloads at runtime, no AI-generated
images or textures.

## Run it

Requirements: Node.js 20 or newer and a browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari).

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5173>. Audio starts after the first click (browser autoplay policy).

## Controls

| | Scuba | Pod |
|---|---|---|
| Look | Mouse (pointer lock; click the page if it is released) | Mouse: free look around the cockpit |
| Move | W A S D | W / S thrust, A / D turn |
| Up / down | Space / C (Ctrl also descends) | Space / C |
| Faster | Shift (uses more air) | Shift |
| Interact / scan | E (hold on some objects) | E |
| Light | F torch | F floodlights |
| Other | J journal, P photo mode, Esc pause | R sonar ping, hold right mouse for the manipulator arm (click to grip or cut) |

Hold the reticle on an animal for a moment to identify it, then press E to scan it into the field journal (J). In
photo mode (P) the world freezes: move with W A S D / Space / C, look with the mouse, scroll to focus, `[` `]` for
exposure, click to take a picture (saved as a PNG; species in frame are logged). A gamepad also works (left stick
move, right stick look, A interact, triggers for up/down and the arm).

Settings (title screen or pause menu): graphics quality (auto, low, medium, high), resolution scale, field of view,
mouse sensitivity, invert Y, master / music / effects volume, subtitles, reduced motion and objective markers.
Progress, the journal, photos and settings are stored in `localStorage`; the game still runs if storage is blocked.

## Build and deploy

```bash
npm run build
```

The static site is written to `dist/` (relative asset paths, so it can be served from any folder).

```bash
npm run preview
```

- **Vercel**: import the repository; `vercel.json` sets the build command and the `dist` output directory.
- **Netlify**: connect the repository; `netlify.toml` sets `npm run build` and publishes `dist`.
- **Any static host**: upload the contents of `dist/`.

## Development helpers

- `?stage=N` jumps straight to a stage (0 deck … 10 ending). `?fixed=1` uses a fixed 1/60 s time step and `?sim=N`
  runs N logic steps per rendered frame (for headless tests). `?q=low|medium|high` forces a quality preset.
- `?dev=creatures&zone=reef&studio=1` is a creature gallery; `?dev=m1` is the original water-look test scene.
- `scripts/shot.cjs` and `scripts/play.cjs` take scripted screenshots with Playwright; `scripts/consolecheck.cjs`
  loads every stage and reports console warnings and errors.

## Project layout

```
src/core      engine, loop, input, audio + procedural music, settings, saves, quality presets
src/render    water optics (Beer–Lambert, caustics, Snell's window, volumetrics), particles, post-processing
src/world     terrain, reef / wall / vents / trench builders, ship, wreck, pod and lander models
src/creatures species data, procedural meshes, swim shaders, behaviours (CreatureManager)
src/player    diver, deck walker, pod, cockpit
src/game      stages 0–10, events, scanner, photo mode, transitions
src/ui        HUD, journal, menus, ending
src/data      species.json, dialogue.json, facts.json
```

Optional model overrides and good free asset sources are described in [ASSETS.md](ASSETS.md); credits and sources
are in [CREDITS.md](CREDITS.md). Build notes are in [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md).
