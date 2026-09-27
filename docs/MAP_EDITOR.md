# Map editor: placing City Circuit's buildings by hand

**The editor:** https://claude.ai/artifact/NuwJ1mBP2ZaybkCrjZsU7Z (private to its owner; built for iPad, works in any browser)

The automatic plot placement put buildings on top of each other and into the spaces. On the layout it produced, the editor counts 31 buildings in conflict, most of them civic halls on the ring overlapping each other. The editor hands placement to a person: every building and landmark can be placed, moved, turned, resized and given a variant over the real board, and the game builds the city from the result.

## How the pieces fit

```
src/engine/CityKit.js ──(verbatim)──► editor page ──Save for Claude──► the page's store
        ▲                                                                  │
        │                                                     Claude reads it (ArtifactData)
   the game builds                                                         ▼
   every model here ◄── src/config/layouts/city_circuit.js ◄── scripts/apply-layout.js (validates)
```

- **One model source.** The editor runs the game's own `CityKit.js`, inlined at build time. What you place is what ships, and nothing in the editor needs to be kept in sync by hand.
- **Layouts are data.** An item is `{ model, seed, hq, x, z, rotY, scale }`. `seed` (0–99) picks the variant (height, width, colour, options) independently of position, so moving a building never changes its look.
- **The game reads the layout.** `Renderer._placeLayout` builds each item with `CityKit.buildModel`. A map without an entry in `src/config/layouts/index.js` keeps automatic placement, and `?nolayout` in the URL forces it.
- **The first layout is today's city.** `qa/exportlayout.js` exported the automatic placement exactly (64 items: 60 plot buildings and trees, plus 4 landmarks). The game looked identical before and after the switch (`qa/modelsheet.js` district views and draw calls).

## Using it

On the iPad: tap a model in the library to add it, drag to move, drag the gold handle to turn (it marks the front, which should face the road), pinch to zoom, and drag empty ground to pan (orbit in 3D). Variant, HQ, size and exact position are in the panel. Red means the building overlaps another one or stands on a space or the road. Work is kept on the device between saves. **Save for Claude** stores the layout and adds it to the saved versions; add a note saying what changed.

Keep-outs: a space's centre plus `spaceR + 1` (about 3.1 units), and 3 units either side of each road's centre line (`SPACE_R` and `ROAD_HALF` in `tools/map-editor/editor.html`).

## Pulling a saved layout into the game (Claude's steps)

```bash
# 1. read it (ArtifactData get: url above, collection "layouts", doc_id "city_circuit", out_dir scratch)
# 2. validate and write the game's layout module
node scripts/apply-layout.js <scratch>/layouts/city_circuit.json
# 3. check it in the game
node qa/zfight.js city_circuit && node qa/ci-smoke.js
TAG=pulled node qa/modelsheet.js          # district views to look at
# 4. commit, then rebuild and republish the editor so "Start again from the game" matches
npm run editor:build                       # then republish tools/map-editor/dist/city-map-editor.html to the URL above
```

`apply-layout.js` treats the saved layout as untrusted. It refuses unknown maps and models, numbers that aren't finite, positions off the board, scales outside 0.5–2 and seeds outside 0–99, and it writes a JSON literal, never code from the input.

## Rebuilding the editor

`npm run editor:build` fills `tools/map-editor/editor.html` with CityKit, the board reference, the ground image and the current layout, writing `tools/map-editor/dist/city-map-editor.html` (git-ignored). Republish it to the same URL after any model change (a new batch in `docs/MODEL_UPGRADE.md`) or layout pull. If the board itself changes (spaces or roads), refresh the reference first with `node qa/exportlayout.js --ref-only`. `node qa/mapeditor.js` exercises the built page end to end.

## Not in version 1

- Street props (lamps, benches, crates), the overhead gantries and the traffic are fixed. The editor's floor shows them from above, but they aren't movable.
- Spaces and roads are fixed. Moving them changes gameplay geometry.
- Hundred Block Dash has no layout yet. The same pieces extend to it (a reference export and a layout module) when its realm landmarks move into the kit.
