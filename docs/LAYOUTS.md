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

A layout item is `{ model, seed, hq, x, z, rotY, scale }`. `seed` (0–99) picks the variant independently of position. A map without an entry in `src/config/layouts/index.js` keeps automatic placement, and `?nolayout` in the URL forces it. `city_circuit.js` started as an exact export of the automatic placement (64 items), so the city looked the same until the first hand-made layout.

`apply-layout.js` treats a saved layout as untrusted. It refuses unknown maps and models, numbers that aren't finite, positions off the board, scales outside 0.5–2 and seeds outside 0–99, and it writes a JSON literal, never code from the input.

## Pulling a saved layout in

1. Read the saved layout from the editor page's store (`layouts/city_circuit`).
2. `node scripts/apply-layout.js <layout.json>`
3. `node qa/zfight.js city_circuit && node qa/ci-smoke.js`, then look at the districts with `TAG=pulled node qa/modelsheet.js`.
4. Commit here. Then, in the editor repo, move the `game` submodule to that commit and rebuild, so the editor's "start again from the game" matches.

## When the models change

Any change to `CityKit.js` (a new batch in `docs/MODEL_UPGRADE.md`) reaches the editor when its `game` submodule is moved to the new commit and the page is rebuilt and republished. Keep `MODELS` keys stable: a saved layout names models by key, and `apply-layout.js` refuses keys `CityKit.js` doesn't define.
