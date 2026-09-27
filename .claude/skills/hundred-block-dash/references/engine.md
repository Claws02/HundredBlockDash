# Engine reference — the traps and the formulas

Contents: Frames & input · Holds & cameras · Physics (cannon.js 0.6) · Audio & the beat clock ·
Rendering · The registry · The probe harness

---

## Frames & input

**Always go through `touch(stage, {...})` or `stage.toLocal`.** Never read
`clientX/Y` raw: a side-hold stage is rotated 90° on a portrait phone.

```js
touch(stage, { split: 'y' | 'x', stick = 55, tapPx = 12, tapMs = 220, floating = true, onDown, onTap, onRelease })
// seat(slot) → { down, dx, dy, moved, held, pid, ax, ay }   dx/dy are CLAMPED to ±1 by `stick` px
// onRelease(slot, { dx, dy, held, moved })                  fires after the seat is reset
```

- **dx/dy are a joystick, not a path.** With `floating: true` the anchor is dragged
  along once the finger passes `stick` px, so for a long swipe dx/dy become the
  *latest heading*, and the path's shape is gone. Anything that needs the shape of
  a gesture (a curve, a flick speed) must record the **raw** pointer positions:
  add `stage.listen('pointermove', …)` *after* `touch()`. Your listener runs
  second, so `_in.seat(k).pid === e.pointerId` identifies the slot. See Bowling
  `rawPush`, Block Party's `pointerdown` timestamp.
- **Event timing**: `e.timeStamp` is on the `performance.now()` clock. Use it for
  anything judged against time (Block Party maps it onto the audio clock).
- **Face-off player frame.** P2 sits at the far end facing P1, so P2's right is the
  stage's left:
  ```js
  const _playerXY = (slot, x, y) => (slot === 0 ? [x, -y] : [-x, y]);  // stage (dx,dy) → (right, forward)
  const _rightX   = slot => (slot === 0 ? 1 : -1);                     // world x of a player's right
  ```
  Read the gesture in the player frame, decide, *then* turn it into world units.
  Mixing frames is what sent P2's bowling balls the wrong way.
- **Shared overhead camera** (`camera.up = (0,0,-1)`): stage dx → world +x, stage
  dy → world +z, the same for both players (Tag, Turf War).
- **Side hold, one camera across the players' side** (Mini Golf): screen right =
  world +x, screen down = world +z, the same for both. P1 is the right half.
- **Curve semantics Caleb chose (Bowling):** a swipe that *turns off to the right*
  at its end puts spin on the ball that hooks it **left** (like real spin). Measure
  it from the heading change between the first and last thirds of the raw path.
- **Swipe vs tap**: decide once per touch (`s.zone`/`s.swiped`), catch it both in the
  frame loop and in `onRelease`, because a fast flick can start and end between frames.

## Holds & cameras

- `createStage(overlay, { hold: 'faceoff' | 'side', fov, background, shadows })`.
- Split screen: `stage.views = [{ camera, rect: [x, y, w, h] }, …]`. P1 is `[0,0,1,0.5]`
  (bottom), and P2's camera has `up = (0,-1,0)`. Set `stage.views = null` before
  `director.close` (full-frame verdict) and in `_destroy`.
- Chase cameras: clamp to a box short of the outer props, and fade occluders
  (`_fadeTrees` pattern: per-prop cloned materials, opacity by segment distance).
- The HUD (`stage.hud`) is in the stage's frame: in side hold it's landscape, and
  `sideHud`'s pads sit at 75% (P1) / 25% (P2).
- `sideHud.say` sits at 32% of the height; anything at the top (cards, bars) can
  collide with it. Put per-player feedback over each half (Block Party `_pops`).

## Physics (cannon.js 0.6, `vendor/cannon.min.js`)

- **`collisionFilterMask` defaults to 1, not −1**, in this build (the group
  defaults to 1). The moment you give anything a group other than 1, set
  `collisionFilterMask: -1` explicitly on the static bodies and everything else
  that must still hit it, or it falls straight through. (Barrage's fort fell
  through its pedestal.)
- Use collision groups for "my own shots pass through my own stuff" (Barrage:
  forts 2/4, shells 8 with mask `1 | enemyGroup`).
- `CANNON.Cylinder` runs along its local **z**. Use flat boxes for stacks (Pancake
  Stack's pancakes are boxes under a round mesh).
- Fast projectiles tunnel: sub-step (Snowball Fight steps in 1/120 s slices) or
  sweep by hand.
- Stacks wander: create bodies **asleep** (`allowSleep`, `body.sleep()`), and wake
  them only when touched. The probe "an untouched fort stands still, even woken"
  guards this.
- Explosions / impulses: measure distance to the **nearest surface** (clamp the
  local point into the box's half extents), never the centre. The directly hit
  body takes the full impulse, the direction is sideways and up, never down, and
  apply it **at the contact point** so high hits tip things (`Barrage._blast`).
- Contact materials drive "sticky" feel more than impulses do (Barrage's pedestal
  stone has friction 0.4 vs wood-on-wood 0.6).
- `world.step(1/60, dt, maxSub)`. Physics runs only after the intro, so nothing
  moves during the cold open.

## Audio & the beat clock

- `sfx(name)`: registered names only (see the `switch` in `AudioManager.js`); an
  unknown name is **silent**. Every `sfx` ducks the music bus.
- Menu/board music: a procedural scheduler with themes `menu` / `board` / `chairs`,
  gated off during minigames. `mgMusic('play'|'dip'|'stop'|'off')` is for a game
  whose rule is the music (Musical Chairs).
- **`beatTrack`** (Block Party): `start(tempoMap, anchorBeat, accent)` schedules
  kick/snare/hats/bass/chords 0.3 s ahead on the audio clock from a tempo map
  `[{ b, bpm }]`; `beatAt(perfTime)` returns the beat **audible** at that moment,
  from `getOutputTimestamp()` (the speaker latency is already inside it). The
  game reads its beat from here every frame and times touches from
  `e.timeStamp`. `stop()` in `_end` and `_destroy`. Headless Chromium runs it
  with `--autoplay-policy=no-user-gesture-required`; the audio is muted but the
  clock runs.
- Anything the player must hit "on the beat" should be scheduled audio, not an
  `sfx` fired from the frame loop (that's up to a frame late and jittery).
- Not verifiable here: real speaker/Bluetooth latency. If Caleb reports a
  consistent early/late bias, add a user timing offset. Don't retune the windows.

## Rendering

- Ribbon meshes (roads, kerbs) built from a centreline: **check the winding**. A
  circuit that runs the other way round winds its triangles face-down and they're
  culled: an invisible road (Go-Kart `_ribbon` flips if the normal's y < 0).
- `Array.from({ length }, (v, i) => …)`: the map function gets **no third argument**.
- Groups positioned at a height: children must use *relative* heights. Rooftop
  Run's signs added the roof height twice.
- Per-object fades need cloned materials; dispose clones when removed.
- `stage.add` everything you `new`; `stage.dispose()` frees it. Effects via
  `effects(stage)` clean themselves up.
- Budget ≈150 draw calls per set: `InstancedMesh` for anything repeated
  (tyre walls, kerbs, tiles).
- Canvas text (`textPlane`) renders ▲ ▼ ✓ ✗ ★ fine; colour emoji aren't
  guaranteed in headless shots.

## The registry (`src/config/MinigameRegistry.js`)

One game touches: `MG_TYPES` (roster), `MG_INFO` (`icon`, `title`, `desc`: the intro
card text), `MG_ORIENTATION_MAP` (`faceoff` / `sideon` / …), `MG_NET`
(`local` / `parallel` / …), `MG_SHAPE`, `MG_PROFILE` (`genre`, `control`, `wire`,
`seats`, `live`), `MG_WATCHDOG_MS` (the default is 90 s; override for anything with
turns, no clock or long races, and keep the comment saying why).
`qa/surfaces.js` holds these to a hand-written audit and has a row per game (the
generator adds it). **`desc` strings are single-quoted**: an apostrophe breaks the
whole module, and `parsecheck` reports it as `PARSE FAIL: MinigameRegistry.js`.

## The probe harness (`qa/stageprobe.js`)

```js
require('./stageprobe').run('<key>', async ({ page, ok, launch, state, shot, waitPhase, forceEnd, waitResult, cleanup }) => { … });
// launch({ bot, p1bot, skill }) · state() = window.__G._debugState() · shot(name) → qa/shot-<key>-<name>.png
// forceEnd() · waitResult(ms, eachTick) · cleanup() = leak check + console-error check (both become ok() lines)
```
`window.__G` is the loaded module, so call `window.__G._debugX(...)` inside
`page.evaluate`. Force a variant for the next `start()` with a module-level
`_debugForce…(key)` and reset it to `null` at the end. Viewport is 412×892
portrait. Barrage predates the harness and has its own launcher (`window.__BG`).
