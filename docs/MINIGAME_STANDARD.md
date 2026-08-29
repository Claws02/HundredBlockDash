# Minigame Standard

This is the contract every minigame in Hundred Block Dash must follow. Build to
this and a new game drops in with zero changes to the engine: register it, add a
file, ship it. `src/minigames/_template.js` is the annotated scaffold;
`SnapStrike.js` is the canonical reference implementation.

> **Goal:** implement game after game with precision. If your game passes the
> [Shipping Checklist](#shipping-checklist) it is, by definition, done.

> **Read `docs/MINIGAME_RULEBOOK.md` first.** This document is the code
> contract, and it assumes two players on one screen — which is what every game
> in the roster is. The rulebook is the *shape*: the story a round tells, the
> four structures a minigame can have, and what each one costs when a third and
> fourth player sit down. A game can pass every rule below and still be
> unbuildable at four players, and you want to know that before it is written.

---

## 1. The shape of a minigame

One file per game in `src/minigames/`. It exports exactly one function:

```js
export function start(isBot, onWin, botSkill = 0.55) { ... }
```

| Param      | Type                 | Meaning                                                            |
|------------|----------------------|--------------------------------------------------------------------|
| `isBot`    | `boolean`            | `true` when P2 is the AI (1-player mode). P1 is always human.      |
| `onWin`    | `(winnerId) => void` | Call **exactly once** to end the game. `0` = P1, `1` = P2, `-1` = tie. |
| `botSkill` | `number` 0–1         | How good the AI plays. See [§5](#5-the-botskill-contract).         |

The module is a **singleton** — it is imported lazily and reused across rounds,
so all state lives in module-level `let`s that `start()` resets and `_destroy()`
tears down. Never rely on a fresh module per game.

### Lifecycle

```
MinigameManager.start(isBot, onWin, botSkill)
  └─ resets module state, builds DOM, kicks off the loop
       └─ ... player input + game loop ...
            └─ on win/tie: tear everything down, then call onWin(winnerId)
```

`MinigameManager` handles the intro, orientation screen, the READY buttons, and
the 3-2-1 countdown. Your `start()` is called **after GO** — `state.mgActive` is
already `true`. Do not draw your own countdown or ready UI.

---

## 2. Non-negotiable rules

These are the rules that separate the four shipped games from the 40 archived
prototypes. A game that breaks any of them is not done.

### R1 — Time in seconds, never frames
All motion is **units per second**, scaled by `dt`. Phones run at 60 Hz, tablets
at 120 Hz, desktops vary; frame-based motion makes the game twice as fast on a
120 Hz device and unfair. Compute `dt` once at the top of the loop:

```js
const now = performance.now();
const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
_last = now;
```

Cap `dt` at `0.1 s` so a tab-switch never teleports objects. Every `+=` to a
position, angle, or timer multiplies by `dt`.

### R1a — Both players hold their own coordinates
On a face-off board each player's "left" is the other's right, and "forward" is
the opposite direction. Keep each player's input in **their own frame**, resolve
the game in **one canonical frame**, and convert at the boundary. Penalty is the
cautionary tale: the keeper's drag and the shooter's aim were compared directly
while meaning mirrored things, so the keeper dived the wrong way every time.

**But check first whether the game actually HAS halves.** Light Cycles inverted
P2's joystick on both axes on exactly this reasoning, and was wrong: its arena is
one shared grid drawn once and unrotated, with both cycles on it and both players
looking at the same picture. There is no per-player frame to convert into, so the
inversion simply drove P2 backwards. The rule is about *frames*, not about player
indices — if both players are reading one un-mirrored playfield, a screen-space
push means the same thing for both of them. `qa/steering.js` checks this by
driving a real drag and watching where the cycle goes.

Related: never map an absolute finger position onto a small target at the far
end of the screen. Penalty's aim did, and vertical aim was unusable — the goal
mouth is ~90 px tall and sits in the opponent's half, so every real thumb
position clamped to the top or the bottom. Use a **relative drag** with a gain
that maps a comfortable thumb sweep onto the full range.

### R1b — Leave the outer edges clear
`#mg-neutral` is a floating status pill at each player's outer edge (about 42 px
tall including its margin), drawn above every game overlay. Anything your game
puts at the very top or bottom of the screen — a goal mouth, a score, a control
— will be behind it. Inset your playfield (Puck and Penalty use `PAD_Y`) or put
your own HUD further in.

### R2 — Build your own DOM, into `#minigame-layer`
Create your overlay in `start()` and append it to `#minigame-layer`. **Never**
reference shared static element IDs — that graveyard was deleted. The only
permanent children of `#minigame-layer` are `#mg-neutral` (the centre status
strip, yours to set text on) and the two `#mg-ready-*` buttons (not yours).
Your overlay must have **no `id`** so the manager's safety sweep can remove a
ghost if the game is force-ended.

### R3 — Clean up everything
Track every timer, listener, animation frame, and Three.js resource, and release
it in `_destroy()`. Register `_destroy` (or a `_cleanup`) with
`registerMinigameCleanup` so a force-end can't leak. Specifically:
- `cancelAnimationFrame` the loop handle.
- `clearTimeout` / `clearInterval` every timer (keep them in an array).
- `removeEventListener` for every listener you added (keep removers in `_cleanups`).
- `geometry.dispose()` / `material.dispose()` / `renderer.dispose()` for 3D.
- `_overlay.remove()`.
Set a `_done` flag and bail out of the loop and any pending callbacks when set.

### R4 — Fit any screen (DPR + resize)
- Canvas: size the backing store to `clientW * DPR` (cap DPR at 2) and the CSS
  box to `clientW`; scale the 2D context by DPR. WebGL: `setPixelRatio(min(DPR,2))`
  and set positional styles only — never `style.cssText` (it wipes `setSize`).
- Add a `resize` listener that recomputes layout; remove it in cleanup.

### R5 — Face-off symmetry
Default orientation is **FACE-OFF**: P1 holds the bottom, P2 holds the top with
the phone upside-down from their view. The top half must be **rotated 180°** so
P2 reads it right-side up. Both halves must be mechanically identical — same
target sizes, speeds, and timing. Input is partitioned by which half the pointer
is in. If your game needs a different hold, add an entry to `MG_ORIENTATIONS`
and map it in `MG_ORIENTATION_MAP`.

### R6 — Signal the result once
End by tearing down, then calling `onWin(winnerId)` a single time. Guard with
`_done` so a double-tap or a late timer can't fire it twice. The manager awards
coins, flashes the zones, and continues the turn.

### R6b — Coin games declare their payouts
Most games hand the manager only a winner and the manager pays the flat
`MINIGAME_REWARD`. A **coin game** instead lets both players keep what they
earned inside it, and says so by passing a second argument:

```js
onWin(winnerId, [p1Coins, p2Coins]);   // both players bank their own haul
```

`MinigameManager` credits each player, shows the split on the result screen, and
still pays the winner the flat reward on top. Loot Catch is the reference.

**Only in a match.** In the arcade nothing is paid at all — not the flat reward,
not the coin-game haul, not `mgWins`. The arcade keeps its own round tally and
touches nothing the board reads. It used to run the full payout onto the real
players and those totals *stacked* across rounds, so browsing the arcade before
a game handed somebody a fortune. `qa/arcadecoins.js` guards it.

**Cap the payout at 30.** Loot Catch, Tree Climb and Memory Match all use
`MAX_PAYOUT = 30`; a new coin game uses the same number unless there is a reason
to argue otherwise. Loot Catch originally paid up to 80, which was enough for one
minigame to settle a board match on its own.

### R7 — Use the real audio vocabulary
`sfx(name)` silently no-ops on an unknown name. Use a registered one or add it to
`AudioManager.js`. Available today:
`coin_gain`, `coin_loss`, `shield`, `swap`, `buy`, `mg_start`, `mg_win`,
`mg_lose`, `react_go`, `seq_lit`, `countdown`, `go`, `boost`, `land_good`,
`land_bad`, `dice_throw`, `dice_land`. Haptics via `haptic([ms,...])` or
`haptic('heavy')`.

---

## 3. Reading time & comeback

- **3-second rule.** A player who has never seen the game must understand the
  goal within 3 seconds of GO. Use one verb. Lean on `#mg-neutral` for a 2-4
  word prompt ("TAP THE TARGET", "KNOCK THEM OFF").
- **Comeback potential.** Avoid runaway leads. Prefer best-of-N rounds or
  most-points-in-T-seconds over first-to-X, so a slow start isn't fatal. Escalate
  difficulty across rounds rather than snowballing score.
- **Measure the length, don't guess it.** Run `node qa/botcheck.js` and read the
  wall clock for easy and hard. Every game tuned by intuition in this repo has
  been wrong: Shape Snap swept 3–0 in 9 s, Freeze crossed its track in 10 s with
  no gap at all between easy and hard, and Four in a Row took 63 s on a 7×6
  board. If the two tiers finish in the same time, the skill dial isn't
  connected to anything.
- **Length.** Target **15–40 seconds**, and enforce both ends in code:
  - **Ceiling.** Every game must resolve on its own — but "on its own" does not
    have to mean "on a clock". A game may instead terminate **structurally**:
    Memory Match empties a 25-card board, Four in a Row fills 30 cells, Light
    Cycles fills a shrinking arena. Each of those has a shot clock or a constant
    speed guaranteeing the board advances, so the end state is reachable without
    anybody being hurried toward it. Prefer this where the game has a natural
    conclusion — cutting a memory game off on a stopwatch throws away the pairs
    a player had just worked out, which is the whole reason they were playing.
    Games that terminate structurally declare a longer safety net in
    `MG_WATCHDOG_MS`. Otherwise, run on a fixed clock that settles on the current
    score, or close the space down (Sumo Spheres shrinks its arena; Tank Clash
    caps the match at 42 s and awards it on HP).
    The manager force-ends at 90 s as a *safety net* — reaching it is a bug
    signal, not a game rule, and it is the path where a force-ended game leaks
    if it forgot `registerMinigameCleanup`.
  - **Floor.** A game that can end in a few seconds robs a player who glanced
    away. Where a single mistake is fatal, add a mercy window: Tank Clash grants
    900 ms of invulnerability after each hit.

---

## 4. Accessibility

- **Never encode meaning in red/blue alone.** P1/P2 already own those colors;
  use position, shape, icons, or labels for game state. A colorblind player must
  be able to tell what to tap.
- **Don't gate play on audio.** Sound is a bonus, not the signal.
- Respect large touch targets (min ~44 px) and keep text legible at arm's length.

---

## 5. The `botSkill` contract

`botSkill` is a single `0–1` float describing how well the AI plays *this*
minigame. The difficulty selector maps tiers to values (with headroom so Hard is
beatable):

| Tier   | botSkill |
|--------|----------|
| Easy   | 0.25     |
| Medium | 0.55     |
| Hard   | 0.85     |

Translate it into concrete behavior. Higher skill ⇒ faster, more accurate, fewer
mistakes. Useful mappings:

```js
// Reaction delay: ~520 ms at easy → ~140 ms at hard
const reactMs = 600 - botSkill * 460 + Math.random() * 120;

// Aim/timing error: large at easy → tight at hard (Gaussian-ish)
const errorPx = (1 - botSkill) * MAX_ERROR * (Math.random() + Math.random() - 1);

// Chance of an outright mistake (whiff, wrong lane): 35% easy → 5% hard
const whiff = Math.random() < (0.4 - botSkill * 0.4);
```

Rules of thumb:
- **Easy must be losable-to** by a distracted adult and winnable by a child.
- **Hard must be beatable** by a focused human — never frame-perfect or omniscient.
- Always add noise. A deterministic bot feels robotic and is either trivial or
  impossible. Randomize delays and errors every action.
- `start()` defaults `botSkill` to `0.55` so a game still runs if called without it.

---

## 6. Fun / Quality rubric

Score every candidate **0–2 per criterion** (0 = fails, 1 = adequate, 2 = great).
**Ship at ≥ 12 / 16, with no zeros.** Below 12, or any zero, means rework or cut.

| # | Criterion        | What "2" looks like                                                        |
|---|------------------|----------------------------------------------------------------------------|
| 1 | **Clarity**      | Goal understood in 3 s with no instructions; one verb.                     |
| 2 | **Skill depth**  | Better players reliably win; there's a technique to improve at.            |
| 3 | **Fairness**     | Perfectly symmetric halves; bot parity tuned across all three tiers.       |
| 4 | **Comeback**     | A behind player can still win until near the end.                          |
| 5 | **Juice**        | Satisfying feedback — motion, sound, haptics, screenshake-lite.            |
| 6 | **Distinctness** | Different *verb/feel* from the current roster (no near-duplicates).        |
| 7 | **Performance**  | Locked 60 fps on a mid phone; dt-correct; no GC stutter.                   |
| 8 | **Robustness**   | No leaks, no double-win, survives force-end and tab-switch.                |

Criteria 7 and 8 are gated by §2 — if you followed the rules they're free.
1–6 are the *design* of the game and where the work is.

---

## 7. Categories & the road to 10

The roster should spread across verbs so the rotation feels fresh. Current
shipped games and the target spread:

The roster of **15**. One game per verb is necessary but **not sufficient** —
see `docs/MINIGAME_BACKLOG.md` for the shared-object test that comes first. Five
games that passed the verb test and failed the fun test are in `archived/`.

| Category             | Verb / feel                   | Shipped              |
|----------------------|-------------------------------|----------------------|
| Physics / sumo       | push, momentum                | ✅ Sumo Spheres      |
| Aim / shooter        | aim & fire                    | ✅ Tank Clash        |
| Rhythm / timing      | tap to the beat               | ✅ Rhythm Forge      |
| Drawing / deflect    | draw paths                    | ✅ Orb Deflect       |
| Precision / snap     | tap at the right instant      | ✅ Snap Strike (reference) |
| Reflex / first       | be fastest, don't false-start | ✅ Quick Draw        |
| Memory / puzzle      | recall & reproduce (race)     | ✅ Grid Recall       |
| Mash / endurance     | out-tap your opponent         | ✅ Tug Tap           |
| Visual scan          | spot the difference           | ✅ Odd One Out       |
| Dexterity / tracking | keep on the target            | ✅ Steady Hand       |
| Sorting / categorise | bin it left vs right          | ✅ Sort Rush         |
| Evade / survive      | dodge the falling storm       | ✅ Meteor Dodge      |
| Collect / select     | catch the good, reject the bad| ✅ Loot Catch        |
| Restraint / stealth  | move only when unwatched      | ✅ Freeze            |
| Flick / clear        | slingshot discs off your side | ✅ Clear Out         |
| Rally / paddle       | one puck, one table           | ✅ Puck              |
| Asymmetric roles     | one shoots, one saves         | ✅ Penalty           |
| Spatial denial       | take space away from them     | ✅ Light Cycles      |
| Shared board, turns  | place, then they place        | ✅ Four in a Row · Memory Match |
| Return / rally-back  | keep it off your own wall     | ✅ Bomb Pass         |
| Throttle / racing    | one pedal, one track          | ✅ Grand Prix        |
| Read & react climb   | tap the side it grew          | ✅ Tree Climb        |

**Curation rule:** the 40 files in `src/minigames/archived/` are a **design
backlog, not a code backlog** — their imports and shared-DOM dependencies are
dead. Mine them for *concepts*, then rebuild to this standard. Keep the archive
for reference (do not delete).

**Before the verb test, apply the shared-object test** (`MINIGAME_BACKLOG.md`):
is there one thing both players are fighting over, and can one player's action
hurt or help the other in the moment? If each player has a private copy of the
playfield and the scores are only compared at the end, it is a leaderboard, not a
two-player game — cut it regardless of how novel the verb is. Roughly half the
current roster fails this test, which is a bigger problem than any missing verb.

---

## 8. Shipping checklist

A game is done when every box is checked:

- [ ] `export function start(isBot, onWin, botSkill = 0.55)`; ends via `onWin` once.
- [ ] All motion scaled by a capped `dt` (R1).
- [ ] Builds its own id-less overlay into `#minigame-layer`; no shared DOM (R2).
- [ ] `registerMinigameCleanup`; `_destroy()` releases timers, listeners, rAF, 3D, overlay (R3).
- [ ] Correct on Retina/120 Hz; handles resize (R4).
- [ ] Face-off symmetric; top half rotated 180°; input partitioned by half (R5).
- [ ] `_done` guard prevents double-win and late callbacks (R6).
- [ ] Only registered `sfx` names (R7).
- [ ] Bot reads `botSkill`; tuned and noisy at easy / medium / hard (§5).
- [ ] 3-second clarity; comeback-friendly; 15–40 s long (§3).
- [ ] No meaning in color alone; not audio-gated (§4).
- [ ] Scores ≥ 12/16 on the rubric with no zeros (§6).
- [ ] Registered in `MinigameRegistry.js` (`MG_TYPES`, `MG_INFO`, `MG_ORIENTATION_MAP`)
      and `MinigameManager.js` (`MG_MODULES`).

---

## 9. Registering a game

1. **`src/config/MinigameRegistry.js`** — add the key to `MG_TYPES`, an entry to
   `MG_INFO` (`icon`, `title`, `desc`), and an orientation in `MG_ORIENTATION_MAP`.
2. **`src/minigames/MinigameManager.js`** — add a lazy import to `MG_MODULES`.

That's it. The arcade selector and the in-game rotation both read `MG_TYPES`, so
the game is immediately playable in both.
