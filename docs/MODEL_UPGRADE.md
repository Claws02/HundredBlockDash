# Model upgrade — the board's buildings and props, a few at a time

**Goal:** bring every model on the board up to the standard of the characters and the 3D minigame sets, in small batches, so the full build comes together from parts that have each been reviewed.

**Direction (agreed 2026-09-27):** chunky toy-town. Bevelled edges that catch the light, bold readable silhouettes, saturated colour, and detail that stands proud of the wall (sills, cornices, awnings, pilasters) so it reads at board distance on a phone.

**Approach:** upgraded procedural. Models stay in code, with no model files, no loader and no licences to track. The shared toolkit is `src/engine/CityKit.js`.

## The rules every upgraded model follows

1. **Three meshes per model, whatever the detail.** Each model is built into three layers:
   - `body`: the solid shell and trim. Lit, vertex-coloured, casts shadows.
   - `sheen`: glassy surfaces. The same, but smooth and slightly metallic.
   - `glow`: lit windows, neon and signs. Unlit.

   Colour lives in the vertices, so one material per layer serves the whole city. Detail costs triangles, which phones have plenty of, and never draw calls, which they don't.
2. **Anything that animates its own material is a separate small mesh**, registered through `opts.live` (the tower's aircraft light, for example).
3. **Footprints don't move.** The plot layout sets each building back from the kerb by its footprint (`_FOOTPRINT` in `Renderer.js`). A new model keeps the old model's width, height and depth per seed.
4. **Every detail stands off the surface it sits on**, and flat tops never share a height with a different-looking neighbour. `qa/zfight.js` must stay at 0 pairs.
5. **Review before merge.** `qa/modelsheet.js` renders every model alone and every district in play, old build against new, with draw calls and triangles. The results go on a before/after review page.

## Workflow for a batch

```bash
# baseline: a worktree of the last commit, served on another port
git worktree add ../base HEAD && (cd ../base && python3 -m http.server 8130 &)
# (add the qaPlotBuilding export to the baseline's Renderer.js if it predates it)
TAG=base QA_BASE=http://127.0.0.1:8130/index.html node qa/modelsheet.js
TAG=new node qa/modelsheet.js           # the working tree, on :8129
node qa/zfight.js && node qa/optimise.js && node qa/ci-smoke.js
```

## Batch 1: City plot buildings (done)

Five builders replaced. The old `_mkSkyscraper`, `_mkBrickBuilding`, `_mkShopBuilding`, `_mkFactory` and `_mkCivicBuilding` and their `_CM` materials are gone.

| Model | What it has now |
|---|---|
| Financial tower | Stone podium with a lit canopy entrance; glass shaft between white piers; spandrel bands; lit offices on all four faces; setback crown, rooftop plant and spire. The HQ adds a gold crown ring. |
| Back Alley walk-up | Three brick tones on a dark base course; cream sills, lintels and cornice; stoop door; front fire escape; neon blade sign on the side wall; water tower. The HQ adds a rooftop billboard. |
| Promenade shopfront | White pilasters, plinth and cornice; lit display window with mullions; striped awning; glowing sign board; flower boxes. The mall HQ has a glass dome on a drum. |
| Industrial works | Corrugated ribs over a dark wainscot; sawtooth roof with lit north-lights; roller door in a hazard-striped frame; banded chimneys; vents; office block. |
| Ring Road civic hall | Stepped plinth; a portico on both faces (the camera usually sees the back); columns with bases and capitals; pediment; tall lit windows. A verdigris dome on one in three, a flag on the rest. |

**Cost** (`qa/optimise.js`, with the merge on as shipped): street view 141 → 130 draw calls, raised 511 → 468, overview 1,262 → 1,128. Draw calls went down at every viewpoint. Triangles roughly doubled per district view, which is still well within budget. Per building: 2–4 draw calls, down from 3–7.

**Fixed along the way:** the Financial District's aircraft lights never blinked. `_canOcclude` cloned their materials for the fade, and the blink kept animating the originals. It now remaps `_cityLive` references to the clones. Measured: 1 of 6 beacons pulsing before, 6 of 6 after.

**Test changed:** `qa/optimise.js` required the merge to cut overview calls by a third compared with no merge. The kit buildings arrive pre-merged, so the unmerged baseline itself fell from 2,213 to 1,581 calls and the merge has less left to do (it now cuts 29%). The check is restated as "the merge still cuts a quarter" plus "the shipped overview stays under the pre-kit 1,262 calls".

## Next batches (suggested order)

1. **City landmarks:** the Exchange, the neon arch, the glass arcade and the cooling towers. One per district, and the most visible single models.
2. **Board-space structures:** Gate, Shop, HQ and plinth. Players interact with these directly, on both maps.
3. **City centre and street props:** plaza and fountain, lamps, benches, trees (the ring's one-in-four tree plots use `_mkTree`), overheads.
4. **Hundred Block Dash realm landmarks:** the giant tree, volcano, crystal cluster and planet, plus the Crown beacon.
5. **Hundred Block Dash realm decor:** pines and the woods, ember, fae and void scatter.
6. **Background skyline** (City), once everything in front of it is settled.
