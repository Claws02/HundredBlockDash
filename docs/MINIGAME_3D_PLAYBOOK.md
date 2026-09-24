# Making a 3D stage minigame — the playbook

This is the recipe behind the eleven 3D games: High Noon, Boot Hill Barrage,
Vault Heist, The 4:15 to Perdition, Mine Cart Mayhem, Turf War, Lily Pad Leap,
Rooftop Run, Block Party, Rift Dive and the template. Follow it and a new game
arrives looking, feeling and behaving like the rest.

- The **rules** every minigame obeys (time in seconds, clean-up, one result,
  bots) live in `MINIGAME_STANDARD.md` §1–§9.
- The **API** of the stage pieces lives in `MINIGAME_STANDARD.md` §10.

This file is the **order of work** and the **lessons learned**.

---

## 0. What makes it "the 3D style"

Every one of these games has the same bones:

| | |
|---|---|
| **Your own character** | The figure each player picked for the board plays the game, rigged and animated (`stage.character(slot)`). |
| **A place in the world** | The set is a district of the city or the Territory (`STAGE_SETS`), built from the board's own palette and props, so the game happens *somewhere*. |
| **A cold open** | Letterbox bars, a camera move and a title card: `place · TITLE · one-line goal` (`director.open`). |
| **READY → GO → play** | A short "GO!" beat, then 15–40 s of play. |
| **A verdict** | The winner turns to camera and celebrates, the loser slumps, confetti falls in the winner's colour, and their name goes up in it (`director.close`). |
| **One phone, two ends** | Face-off (phone flat, a half each, the far half upside down), side-on (landscape, P1 on the right) or split screen. |

If a design doesn't fit those bones, it's probably a 2D game. Use `_template.js`.

---

## 1. Design it on one card before any code

Fill this in. If a line is hard to write, the game isn't ready.

```
NAME / KEY      Crate Clash / crateclash
PLACE           Industrial Zone · The Loading Dock     (which STAGE_SETS key?)
ONE LINE        Shove crates onto your conveyor; most crates shipped wins.
HOLD            faceoff | side | split                  (§2)
INPUT           drag | tap | hold-release | swipe        (one verb, taught in 3 s)
THE TWIST       the one rule that makes it more than a race
                (Turf War: rival paint is slippery. Lily Pad: pads sink if you stand still.)
WIN             who wins at the whistle / first to N / last standing — and what a draw is
LENGTH          15–40 s
BOT             what a good player does, and how botSkill 0.3 / 0.55 / 0.85 differ
```

---

## 2. Pick the hold and the camera

| Hold | Use it when | Camera | Reference |
|---|---|---|---|
| **faceoff** (phone flat, P1 bottom) | a shared arena seen from above, where both players move | `overheadCam(stage, w, d, margin)` with `camera.up = (0,0,-1)` for **every** shot | Turf War, Lily Pad, Vault Heist |
| **side** (landscape, P1 right) | a duel side by side, a timing or aiming game, anything read left↔right | a fixed or slowly tracking side shot | High Noon, Barrage, The 4:15 |
| **split** (`stage.views`) | each player needs their own camera: a descent, a race on separate tracks | one camera per half, `up` flipped per seat | Rift Dive |
| travelling camera | a runner or a scroller | camera follows the leader; the set parallaxes | Rooftop Run (`ba` set) |

**Face-off camera rule.** Look almost straight down and tilt only around the
long axis, so neither end has the better view. With `up = (0,0,-1)`, a drag on
the screen maps straight onto the floor for both players. Don't "improve" this
with a perspective from one end.

---

## 3. Scaffold it (one command)

```bash
node scripts/new-3d-minigame.js crateclash "Crate Clash" \
    --set=ind --icon=📦 --place="Industrial Zone · The Loading Dock" \
    --genre=push --control=thumb --desc="Lay the phone flat between you. …"
```

This writes `src/minigames/CrateClash.js` (from `_template3d.js`) and
`qa/crateclash.js`, and registers the game in all seven places:
- `MG_TYPES`, `MG_INFO`, `MG_NET`, `MG_SHAPE`, `MG_ORIENTATION_MAP` and `MG_PROFILE` in `MinigameRegistry.js`;
- `MG_MODULES` in `MinigameManager.js`.

It refuses to overwrite anything. `--dry-run` shows the plan without writing.

The scaffold is a **working game** (a coin scramble), so check it runs before
you change a line:

```bash
bash qa/parsecheck.sh src
npx http-server -p 8129 -s -c-1 . &      # then Arcade → CRATE CLASH in a browser
node qa/crateclash.js                     # 6 checks, ~2 min on a software GPU
```

---

## 4. Replace the rules, keep the skeleton

The template's shape is the contract. Change what's inside the boxes, not the boxes.

```
start()      stage → hud → touch → effects → director → set → figures → director.open() → stage.start(_frame)
_frame(dt)   phase clock → input/bot → rules → mirror logic onto rigs → set.update → fx.update → director.update → camera → HUD
_end()       pick the winner (−1 = draw) → director.close({ onDone: () => _finish(w) })
_finish(w)   the ONLY call to onWin, behind the _done guard
_destroy()   stage.dispose() + overlay.remove(); registered with registerMinigameCleanup
```

**Order of work that keeps it runnable at every step:**
1. **Floor and bounds.** Set `W`, `D`, the set, and the camera. Run it.
2. **Movement.** Each seat's input moves a plain `{x, z}` object; the rig mirrors it. Run it.
3. **The core rule.** Scoring, collisions, the twist. Put a `_debugX` hook next to each rule (see §8).
4. **Win and draw.** `_end()` and the verdict line (`sub`).
5. **The bot.** Last, once the rules are stable (§6).
6. **Juice.** Effects, sounds, animation choices, the set's handles (`ringBell`, the beat).

---

## 5. Hard-won rules (each one is a bug we shipped once)

**Logic on numbers, never on meshes.** Positions, scores and timers live in
plain objects; meshes only mirror them each frame. That keeps the round playable
when WebGL is missing (`stage.gl === false`), lets probes read and set state,
and lets online play send a snapshot.

**Time is seconds, and `dt` is capped.** `stage.start` hands you a capped `dt`.
On a slow device the game clock runs slow rather than skipping, which is right.
But it means a 25 s match can take 90 s of wall time under a software GPU, so
write probes against game state, not wall-clock sleeps.

**Face-off input goes through `touch(stage, { split: 'y' })`.** Side-on uses
`split: 'x'`. Never read `clientX/Y` directly: a side-on stage turns itself 90°
on a portrait phone, and `stage.toLocal` / `touch` undo that for you. Bot seats
are ignored by `touch`, so drive bots through `isBotSlot(slot)`.

**`camera.up = (0,0,-1)` once, for every face-off shot**, the director's
included. Forget it and the far player's drags run backwards.

**Scale the director's close-up with the figure.** `FIG_SCALE` 1.25 at 6 units
fills the whole frame with one figure. The template uses `8.5 × FIG_SCALE`.

**"Per tile" rules need per-frame state.** In Turf War's first version, paint
on the rival's tile was applied the instant you touched it, so you were never on
their colour for a whole frame and the slowdown never happened. If a rule
depends on *standing on* something, keep the "since when" (`scrub`, `standT`) on
the figure.

**Everything you `new` goes through `stage.add`**, or is disposed by hand when
you remove it (see `_take` in the template). `stage.dispose()` then frees the
rest. The scaffolded probe fails if a canvas or a paused board is left behind.

**Buttons in the manager's intro listen for `pointerdown`.** A probe that calls
`.click()` on `btn-mg-intro-next` will stall forever. Dispatch a `pointerdown`
or use a real `page.mouse`.

**Registered sound names only** (`sfx('go')`, `coin_gain`, `boom`, `slam`,
`whistle`, `kick`, `hat`, …; the full list is in `AudioManager.js`). An unknown
name is silent, not an error, so nothing tells you.

**The status line down the middle is `#mg-neutral`.** Write the score there
during play and the result at the end, like every other game.

---

## 6. The bot

Write it after the rules settle. The three things every bot here does:
1. **Plans on a delay:** `think = 0.7 − botSkill × 0.45 + noise`. An easy bot re-plans slowly.
2. **Chooses with noise:** add `random × (1 − botSkill) × k` to its scoring, so an easy bot picks worse targets rather than moving slower.
3. **Moves at `0.7 + 0.3 × botSkill` of full speed.** It's always beatable, and never frozen.

The scaffolded probe checks that a hard bot (0.85) beats an idle player. Add a
check that an easy bot (0.3) loses to a simple scripted player if the design
allows one.

---

## 7. Sets

`STAGE_SETS[key](stage, layout)` builds the scenery, and many sets take the
game's own layout (walls, a track, a course), so the scenery and the collision
use the same numbers. The existing keys are listed in `MINIGAME_STANDARD.md` §10:
- `hub`, `bad`, `fin`, `rail`, `mine`, `ind`, `fae`, `ba`, `shop`, `void`.

**Reuse one before building one.**

If the game needs a new place:
- add a builder to `src/engine/StageSets.js` using `DISTRICT_BIOMES` colours and `PROP_KIT` props;
- return `{ update(dt, t), ...handles }`;
- keep it under about 150 draw calls: instance anything repeated, as Turf War does with its 180 tiles.

---

## 8. Test it like the others

The scaffold's probe uses `qa/stageprobe.js`, which boots the game, launches
the minigame directly, and exposes:
- `state()` (your `_debugState()`), `waitPhase`, `shot(name)`, `forceEnd`, `waitResult` and `cleanup`;
- a final leak check (canvases, orphans, whether the board resumed) and a page-error check.

Give each rule a probe line that drives **real input** where a player would
touch, and a `_debug…` hook where setting up the situation by play would be
slow. Photograph the intro, a mid-play moment, each rule firing, and the verdict:

- `qa/shot-<key>-*.png`: *read the pictures*. Framing mistakes (a close-up
  inside the figure, a HUD strip over the action) don't show up in numbers.

Before calling it done, go through `MINIGAME_STANDARD.md` §8 (shipping
checklist) and §6 (the fun rubric, 12/16 or better).

---

## 9. Online and four players (later, deliberately)

The scaffold registers the game as **offline, two seats**:
- `MG_NET: 'local'`
- `MG_PROFILE.wire: 'snapshot'`
- `seats: [2, 2]`
- `live: false`

To take it online, read `MULTIPLAYER_PLAN.md` and the `MG_PROFILE` comments in
`MinigameRegistry.js`. Keeping logic on plain numbers (§5) is what makes a
snapshot possible later.

---

## Quick reference

```bash
node scripts/new-3d-minigame.js <key> "<TITLE>" --set=<set> --icon=<emoji> [--dry-run]
bash qa/parsecheck.sh src
node qa/<key>.js
```

| File | Role |
|---|---|
| `src/minigames/_template3d.js` | the skeleton the generator copies |
| `scripts/new-3d-minigame.js` | the generator |
| `src/engine/Stage.js` | renderer, scene, camera, rigs, holds, loop, dispose |
| `src/engine/StageKit.js` | `seat`, `faceoffHud` / `sideHud`, `touch`, `effects`, `overheadCam` |
| `src/engine/StageDirector.js` | `open` (cold open) and `close` (verdict) |
| `src/engine/StageSets.js` | the places |
| `src/engine/CharacterRig.js` | the figures and their animations |
| `qa/stageprobe.js` | the probe harness |
