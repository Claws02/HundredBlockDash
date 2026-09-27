# Board smoothness pass — flicker and choppy motion

**Date:** 2026-09-27 · **Branch:** `claude/hundredblockdash-gameplay-polish-eexphr`
**Scope:** the City Circuit and Hundred Block Dash boards. Star Territory is archived for v1 (`archived: true` in `MapRegistry.js`; its module stays registered so saves and probes still load it).

The goal was a board that moves and renders like the 3D minigame stages do. Two symptoms were reported: surfaces flickering and motion that felt choppy.

## 1. Flickering surfaces: z-fighting

**Cause.** City Circuit's ground is a stack of flat layers (ground, sidewalks, district pavement, roads, slabs, seams, puddles). They were 5–10 mm apart, and several *different* materials sat at exactly the same height: the district pavement, the park sidewalk ring and the spur sidewalks were all at −0.60. The spur asphalt was 5 mm *under* its own sidewalk band. On Hundred Block Dash, each realm's ground strip overlaps its neighbour by one block at the same height. The board camera's near plane was 0.1, so a 24-bit depth buffer could only separate surfaces about 1 cm apart at 120 units. The minigame stages have small sets and never hit this.

**Fix** (`src/engine/Renderer.js`):

- **`CITY_GROUND`**: one named height ("rung") per layer, `GROUND_STEP` = 3 cm apart, in the order the art intends: base < sidewalks < district pavement < asphalt < slabs and lane dashes < seams < puddles.
- **Hundred Block Dash**: each realm's ribbon sits one `GROUND_STEP` above the previous realm's.
- **`_fitNear()`**: the near plane follows the camera's height, at 4% of it, clamped to 0.5–4. That is 0.9–1.0 in the follow shot and 4 over the map, about 10× the precision of 0.1 in play. The minigame stage keeps its own camera.
- The board's sun gets the shadow bias the minigame stage always had (`bias −0.0006`, `normalBias 0.04`), which removes striped self-shadowing ("shadow acne").

**Proof:** `qa/zfight.js` finds every overlapping, differently-coloured pair of upward-facing surfaces closer than 2 cm.

| | Before | After |
|---|---|---|
| City Circuit | 15 pairs over ~103k half-unit cells, gaps 0–25 mm | **0** |
| Hundred Block Dash | 1 pair, 2,292 cells, gap 0 | **0** |
| Camera near plane in play | 0.1 | 1.04 (City) / 0.88 (HBD) |

## 2. Choppy motion

**Causes, found by measuring:**

1. **Hops surged.** Every hop was an ease-out cubic. The token left at 3× its average speed and arrived at a dead stop, so a six-space move was six surges, and the follow camera surged with it.
2. **Facing snapped.** `lookAt` turned the token to its new heading in one frame at the start of each hop.
3. **Stale camera tweens fought the follow camera.** Set-piece camera moves (`SetPieces.js` `_takeCamera` / `_takeCameraPath`), both flyovers and the Swap saucer shot kept writing the camera for their full duration, even after play had handed it back to FOLLOW. The two then took turns setting the camera, producing jumps of 16–94 units in a single frame. This is the intermittent "lurch" `qa/README.md` recorded as real but unexplained.
4. **The camera's "fetch the token" re-aim started from rest.** When the token drifted off-centre, an eased transit stopped the moving camera dead and then swung it.
5. **Frame time jitter.** dt came from reading the clock whenever the callback ran, not from the frame's vsync timestamp.

**Fixes:**

1. `_hopEase`: half linear, half smoothstep. Each hop starts and ends at half its average speed, so consecutive hops meet at the same speed.
2. The facing slerps over the first 45% of the hop (`HOP_TURN`).
3. Camera ownership. A set-piece move owns the camera by number (`_camOwner`) and only while `cameraState` is `CINEMATIC`. A flyover only writes while the state is still the one it started in, and the post-minigame flyover no longer forces FOLLOW over a set piece that took over. The Swap shot stops steering once the camera leaves CINEMATIC.
4. Catch-up: while the token is off-centre, the follow camera's stiffness ramps up smoothly, then relaxes. Its speed never changes in one frame.
5. The board loop takes dt from `requestAnimationFrame`'s timestamp.

**Proof:** `qa/boardmotion.js` stubs the WebGL draw calls so the real game logic runs at 60 fps in headless Chromium, drives a match, and records the token and camera every frame. Figures are p99 while walking, and the largest one-frame camera change anywhere in FOLLOW. Two runs of the original build against three runs of the new one, 150–240 s each:

| | Original | New |
|---|---|---|
| Token speed surge at hop boundaries (× average speed), City / HBD | 3.5 / 3.0–3.1 | **0.6** / **0.6** |
| Camera velocity jerk, HBD (u/s per frame) | 30–65 | **2.7–3.6** |
| Camera velocity jerk, City | 48–69 | **19–26** |
| Largest one-frame camera jump, City | 2,386–4,119 | **99–313** * |
| Largest one-frame camera jump, HBD | 10,138–10,433 | **75–137** |

\* City's 313 follows a 150 ms stall in the headless browser itself (a dropped frame), not a camera write. One run before the Swap-shot guard landed still caught a 1,495.

## What this environment could not verify

- **The real frame rate on an iPhone.** The software GPU here draws at 1–3 fps. The motion numbers are from game logic at 60 fps with drawing stubbed. They prove the motion *curves* are smooth, not that the phone holds 60 fps. Draw-call cost is covered by the earlier RA-03 work.
- **Flicker by eye.** Screenshots confirm the ground still layers correctly and nothing is clipped by the new near plane. Flicker only shows in motion, on real hardware.

## iPhone check (10 minutes)

1. A City Circuit match. Watch the ring road, the spurs into each district and the district pavements while the camera turns: no shimmer or stripes.
2. A Hundred Block Dash match. Watch the realm boundaries (Woods → Ember, and so on): no flicker where the ground colour changes.
3. Roll a 5 or 6. The token should hop in an even rhythm and turn through corners, not snap.
4. Land a Swap, a Mystery unbox and an HQ payout, and finish a minigame. When each set piece ends, the camera should glide back with no single-frame jump.
