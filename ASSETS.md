# Assets

The game ships with no external assets: every mesh, texture, particle effect and sound is generated in code at
load time. No AI-generated images or textures are used, and none should be added.

## Replacing a creature with a model

Any species can be replaced with your own glTF binary model:

1. Put the file in `public/models/`, for example `public/models/green_turtle.glb`.
2. List it in `public/models/manifest.json` by species id (the ids are in `src/data/species.json`):

   ```json
   { "overrides": { "green_turtle": "green_turtle.glb" } }
   ```

Model conventions: a single mesh, Y up, the animal's nose pointing along +Z. Scale does not matter — the model is
fitted to the species' real length. Overrides are drawn as rigid instanced meshes (the procedural swim animation
only applies to the generated bodies) and get the underwater optics automatically. Credit any model you use in
`CREDITS.md`, following its license.

## Good free sources

| Source | What | License notes |
|---|---|---|
| [Smithsonian 3D Digitization](https://3d.si.edu/) | Scanned specimens, some marine | Many models CC0; check each object's usage terms |
| [Poly Haven](https://polyhaven.com/) | Models, textures, HDRIs | CC0, no attribution required |
| [ambientCG](https://ambientcg.com/) | PBR textures | CC0, no attribution required |
| [Kenney](https://kenney.nl/assets) | Game models and sounds | CC0 |
| [Quaternius](https://quaternius.com/) | Low-poly animals and props | CC0 |
| [Sketchfab](https://sketchfab.com/search?features=downloadable&type=models) | Large library incl. marine life | Use the license filter (CC0 or CC BY); CC BY requires credit (author, title, link, license) |
| [Freesound](https://freesound.org/) | Field recordings, hydrophone sounds | Per sound: CC0 needs nothing, CC BY needs credit, avoid NC licenses for redistribution |
| [NOAA Ocean Exploration](https://oceanexplorer.noaa.gov/) | Reference imagery and video of deep habitats | Mostly public domain (US government work); use as reference |

When in doubt, prefer CC0. Do not use assets marked NonCommercial or NoDerivatives if the game is distributed.
