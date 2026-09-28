# Map layouts: hand-placed scenery

City Circuit's buildings and landmarks are placed by a **layout** instead of the automatic plot placement, which put buildings on top of each other and into the spaces. Layouts are made in the map editor, which lives in its own repository:

**https://github.com/Claws02/hundredblockdash-map-editor** (the editor page itself is published on claude.ai; its README has the link)

## What lives here, in the game

| Piece | Where |
|---|---|
| The models, the one source of truth. The editor builds from this file through a git submodule. | `src/engine/CityKit.js`: `MODELS`, `buildModel()` |
| The layouts the game loads, one generated module per map | `src/config/layouts/` |
| Placing a layout on the board | `Renderer._placeLayout` |
| The checker a saved layout must pass to become a layout module | `scripts/apply-layout.js` (`npm run layout:apply -- <layout.json>`) |

A layout item is `{ model, seed, hq, x, z, rotY, scale }`. `seed` (0–99) picks the variant independently of position. A map without an entry in `src/config/layouts/index.js` keeps automatic placement, and `?nolayout` in the URL forces it. `city_circuit.js` started as an exact export of the automatic placement (64 items), so the city looked the same until the first hand-made layout. Version 2 layouts also place the street pieces (props, overhead spans, lamps, the fountain, park trees and benches); the automatic dressing passes stand aside for them (`_fullLayout()`).

`apply-layout.js` treats a saved layout as untrusted. It refuses unknown maps and models, numbers that aren't finite, positions off the board, scales outside 0.5–2 and seeds outside 0–99, and it writes a JSON literal, never code from the input.

## Moved spaces

A layout may carry `spaces: { nodeId: [x, z] }`: spaces the editor moved. They are applied right after the map's geometry places every node (`buildNodePositions`), so tiles, tokens, hops, the camera path and the guide tubes all follow. A district with moved spaces lays its road and pavement through them (`lobeSamples` switches to `CityKit.roadCurve`, the curve the editor previews), and a ring stretch with moved spaces gets asphalt along them. Space *types* are untouched: the game still deals them each match. Only real spaces may move (not the junctions where roads meet), and `apply-layout.js` checks every id against the map module. `qa/mapmodules.js` loads with `?nolayout` because it checks the map module's own geometry.

## District looks

A layout may carry `looks: { district: { ... } }`, only what differs from the game's own values: `bgTop`, `bgBot`, `fog` (sky and haze), `pave` (pavement), `slab` and `seam` (paving slabs), `light: { color, intensity, bounce, bounceI }` and `motes: { color, count, rise, size }`. The board reads them through `_look()` / `_lookOf()` in `Renderer.js`, merged over `DISTRICT_BIOMES`; the minigame sets keep the built-in biomes. `apply-layout.js` allows only City's five districts and these fields, colours as `#rrggbb`, and numbers within fixed ranges (light 0–4, particles 0–120 and so on).

## Pulling a saved layout in

1. Read the saved layout from the editor page's store (`layouts/city_circuit`).
2. `node scripts/apply-layout.js <layout.json>`
3. `node qa/zfight.js city_circuit && node qa/ci-smoke.js`, then look at the districts with `TAG=pulled node qa/modelsheet.js`.
4. Commit here. Then, in the editor repo, move the `game` submodule to that commit and rebuild, so the editor's "start again from the game" matches.

## When the models change

Any change to `CityKit.js` (a new batch in `docs/MODEL_UPGRADE.md`) reaches the editor when its `game` submodule is moved to the new commit and the page is rebuilt and republished. Keep `MODELS` keys stable: a saved layout names models by key, and `apply-layout.js` refuses keys `CityKit.js` doesn't define.
