# Minigame Standard

This is the contract every minigame in Hundred Block Dash must follow. Build to
this and a new game drops in with zero changes to the engine: register it, add a
file, ship it. `src/minigames/_template.js` is the annotated scaffold;
`SnapStrike.js` is the canonical reference implementation.

> **Goal:** implement game after game with precision. If your game passes the
> [Shipping Checklist](#shipping-checklist) it is, by definition, done.

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
- **Length.** Target **15–40 seconds**. The manager force-ends at 90 s as a
  safety net (a tie) — never design near that limit.

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

The roster of **10** is complete — every category is filled, no two games
share a verb:

| Category             | Verb / feel                   | Shipped              |
|----------------------|-------------------------------|----------------------|
| Physics / sumo       | push, momentum                | ✅ Sumo Spheres      |
| Aim / shooter        | aim & fire                    | ✅ Tank Clash        |
| Rhythm / timing      | tap to the beat               | ✅ Rhythm Forge      |
| Drawing / deflect    | draw paths                    | ✅ Orb Deflect       |
| Precision / snap     | tap at the right instant      | ✅ Snap Strike (reference) |
| Reflex / first       | be fastest, don't false-start | ✅ Quick Draw        |
| Memory / puzzle      | recall & reproduce            | ✅ Grid Recall       |
| Mash / endurance     | out-tap your opponent         | ✅ Tug Tap           |
| Visual scan          | spot the difference           | ✅ Odd One Out       |
| Dexterity / tracking | keep on the target            | ✅ Steady Hand       |

**Curation rule:** the 40 files in `src/minigames/archived/` are a **design
backlog, not a code backlog** — their imports and shared-DOM dependencies are
dead. Mine them for *concepts*, then rebuild to this standard. Keep the archive
for reference (do not delete).

Future additions should target a *new* verb (e.g. trace-without-crashing,
stealth/hold-still, sorting) rather than a second take on a filled category —
and must still score ≥ 12/16 on §6 before shipping.

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
