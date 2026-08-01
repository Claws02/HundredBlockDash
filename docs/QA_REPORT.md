# Hundred Block Dash — QA Report

**Build under test:** `77f30dd` (main, post-PR #51)
**Branch:** `claude/indie-game-qa-upgrade-uy7at5`
**Date:** 2026-07-27
**Platform tested:** Chromium 141 headless (SwiftShader GL), 412×892 @ DPR 2, touch enabled
**Method:** static code audit of all 27 non-archived source modules + automated
playthrough harness (`qa/`) driving the real game through Playwright

---

## 1. Executive summary

The game is **structurally sound and does not crash.** Across ~40 minutes of
continuous automated play over four configurations, and a sweep of all 15
minigames, there were **zero uncaught exceptions, zero console errors, zero
soft-locks, and zero game-state invariant violations.** Every state machine
transition observed was one of the ten legal `gameState` values. That is a
better baseline than most projects at this stage.

The defects that matter are not crashes. They fall into three groups:

1. **A silently broken subsystem.** 9 of 25 City Contracts were mathematically
   impossible to complete, and because contracts only rotate out of the 3-slot
   strip when *claimed*, a dead contract permanently occupies a slot. In a
   typical game, one to two of the three visible objectives were inert for the
   whole match. This is the highest-impact defect found and it was invisible
   from play — nothing errors, the pill just never fills.

2. **Resource leaks in the render and minigame layers.** Every tile redraw
   orphaned ~60–80 Three.js meshes in the scene and stopped all ambient scenery
   animating. Four of fifteen minigames never registered a teardown hook, so the
   90-second force-end path leaked their WebGL contexts and timers.

3. **Session length.** This is the one that decides whether it reads as a real
   game. Measured on the harness at **16.4 s per board turn**, City Circuit's
   fixed 20 rounds worked out to ~37 minutes at machine pace and closer to an
   hour for humans — with no way for the player to ask for something shorter.

One genuine uncaught exception was found (**QA-016**, TankClash) — but only by
hammering input on the first frames after "GO!", which no ordinary playthrough
does.

All P0 and P1 items below are **fixed and verified in this branch**. P2 and the
design findings are written up in `UPGRADE_ROADMAP.md`.

---

## 2. Test coverage

| Configuration | Mode | Map | Length | Duration | Result |
|---|---|---|---|---|---|
| `hbd50_1p` | 1P vs Bot (medium) | Hundred Block Dash | 50 | 331 s | Clean — reached The Rift |
| `hbd75_1p` | 1P vs Bot (hard) | Hundred Block Dash | 75 | — | Config available, not run to completion |
| `hbd100_1p` | 1P vs Bot (easy) | Hundred Block Dash | 100 | 601 s | Clean |
| `hbd50_pass` | 2P pass & play | Hundred Block Dash | 50 | 421 s | Clean — pass-prompt flow verified |
| `city_1p` | 1P vs Bot (medium) | City Circuit | 20 rounds | 601 s | Clean — reached round 1 only |
| `verify2` | 1P vs Bot (medium) | City Circuit | 6 rounds | 395 s | **Full match to the win screen** |
| `verify2` | 1P vs Bot (medium) | Hundred Block Dash | 50 | 643 s | **Full match to the win screen** |
| Arcade sweep | Standalone | — | 15 games | ~11 min | All 15 load & run, 0 errors |
| Early-input stress | Standalone | — | 15 games | ~6 min | Found QA-016; all 15 clean after fix |

**Systems exercised:** splash → mode → difficulty → character → map → length
selection; story intro; dice physics (single, double, forced, cursed); linear
and graph movement; branch/junction choice; all 21 space types; shops
(district, discounted, pass-through, inventory-full drop flow); item use and
Mirror reflection; The Gate / The Rift challenge; duels with betting; ally
encounter, claim, steal and expiry; contracts; minigame intro → orientation →
ready → countdown → play → result; pass-and-play device handoff; tabletop
mode; win screen and stats persistence.

**Not covered in this environment** — see §6.

---

## 3. Defect log

Severity is impact-on-player. Priority is fix order.

### P0 — Ship blockers

#### QA-001 · 9 of 25 City Contracts were unobtainable
**Severity:** High · **Status:** ✅ Fixed · **Files:** `src/core/Contracts.js`, `src/core/GameController.js`, `src/config/ContractPool.js`

`checkContract()` explicitly skipped `win_minigames` and `land_coin` with the
comment *"Tracked separately via counters"*, deferring them to
`claimContractProgress()` — **which was never called from anywhere in the
codebase.** Separately, four contract types had no emitter at all.

Cross-referencing every `type` in `CONTRACT_POOL` against every
`checkContract(...)` call site:

| Contract | Type | Why it could never complete |
|---|---|---|
| c05 Land on 3 coin spaces | `land_coin` | Emitted, then explicitly skipped; counter function was dead code |
| c08 Win 2 minigames in a row | `win_minigames` | Same, plus the `count` argument was ignored entirely |
| c09–c12 Enter the … District ×4 | `enter_district` | **No emitter anywhere in the codebase** |
| c20 Land on a Shortcut space | `land_type`/`shortcut` | `case 'shortcut'` returned before emitting |
| c23 Visit 2 shops in one lap | `visit_shops` | No emitter; `shopsVisitedThisLap` was reset but never incremented |
| c25 Earn 20 coins in one round | `earn_coins_round` | No emitter anywhere |

A tenth, **c06 "Land on 2 big-coin spaces"**, had the opposite bug: it was not
in the skip list, so it paid out after **one** landing instead of two.

**Player-visible effect:** contracts are a headline City Circuit system
(advertised on the map card). With 3 slots and 9 inert cards that never rotate,
most matches ran with a third to two-thirds of the objective strip permanently
frozen at `0/3`.

**Fix.** Contracts are now explicitly two kinds. `COUNTED_TYPES` (in
`ContractPool.js`, so the UI can read it without a `UIManager ⇄ Contracts`
import cycle) marks cards whose `param` is a *target count*; everything else is
a single-event match. Progress is tracked **per player** in `c._prog[playerId]`
— previously a shared counter would have let one player's coin spaces advance
their opponent's contract. The dead `claimContractProgress()` is deleted. Four
new emitters were added: `_noteDistrictEntry()` on junction choice,
`_noteShopVisit()` in `openShop()`, an `earn_coins_round` check in
`_onRoundEnd()` before the tally is cleared, and the missing `land_type`
emission on `shortcut`.

**Verified:** automated test instantiates each of the 25 pool cards as the sole
active contract, fires the real emitter, and asserts it claims. **25/25 pass.**
Plus two regression guards: an under-count does not claim early, and one
player's progress does not advance the other's.

---

#### QA-002 · Tile redraw orphaned scene meshes and froze all ambient animation
**Severity:** High · **Status:** ✅ Fixed · **File:** `src/engine/Renderer.js`

`drawTiles()` removed tracked `tileMeshes` from `boardGrp` but handled floating
icons by clearing only their *tracking array* — `floatingIcons.length = 0` on
Hundred Block Dash, `floatingIcons.splice(4)` on City Circuit — **without
removing the meshes from the scene.** Nothing was ever disposed.

`updateSingleTile()` is just an alias for a full `drawTiles()`, and it is called
whenever a Tollbooth or Anchor is placed and when the Gate opens. So each of
those actions:

- added a fresh set of ~60–80 icon meshes on top of the previous invisible set,
  growing the scene graph without bound;
- allocated ~100 new `MeshPhysicalMaterial` objects with nothing freed, growing
  GPU memory monotonically;
- **stopped the ambient scenery animating** — the HBD path wiped the void
  shards, orbital ring, planet and ground scatter out of the animation list, so
  after the first trap placement the world went visually static, with duplicate
  icons frozen mid-bob.

**Fix.** Introduced a `_tileIcons` list tracking exactly the icons `drawTiles()`
creates, so a redraw tears down its own meshes and leaves the permanent scenery
registered. Added `_disposeTree()` which releases geometries and materials while
skipping a `_SHARED_GEOS` set — the module reuses `_hexGeo` and the `GEOS`
primitives across every tile, so disposing those would blank the board.
Cached tile textures are shared the same way and remain owned by `cleanup()`.

**Measured.** `qa/leak.js` walks the live scene graph (reaching it via
`getTileMeshes()[0].parent`, since the camera is not parented into the scene).
On the **pre-fix** code, a 100-block Hundred Block Dash board leaked **93 meshes
and 93 materials on every single redraw**:

| Redraws | Meshes | Unique materials |
|---|---|---|
| baseline | 694 | 498 |
| after 1 | 787 | 591 |
| after 8 | 1438 | 1242 |
| after 15 | **2089** | **1893** |

A 3× scene-graph blow-up from 15 trap placements. **After the fix, all three
counts are flat across 15 redraws** on both maps (HBD 693/382/497, City
741/573/236, unchanged at 1, 8 and 15 redraws), and the ambient animation list
survives. The test is proven to detect the original bug, not merely to pass.

---

#### QA-003 · 4 of 15 minigames never registered a teardown hook
**Severity:** High · **Status:** ✅ Fixed · **Files:** `SumoSpheres.js`, `TankClash.js`, `OrbDeflect.js`, `RhythmForge.js`

The minigame standard (`docs/MINIGAME_STANDARD.md` R3) requires
`registerMinigameCleanup(_destroy)`. The four oldest games each *had* a correct
`_destroy()` — disposing renderers, geometries, materials, timers and listeners
— but **never registered it**, so `_destroy()` only ran on their own natural
win path.

The reachable failure is the manager's 90-second watchdog. On force-end,
`endMinigame()` calls `_runMinigameCleanups()`, which for these four is empty:
the render loop halts (it guards on `state.mgActive`) but the WebGL context,
pending timers and listeners are never released. SumoSpheres and TankClash each
build their **own `THREE.WebGLRenderer`**; Chromium hard-caps live WebGL
contexts, so repeated force-ends can evict the main board renderer and leave a
black board.

**The watchdog path is not theoretical.** The arcade sweep showed 6 of 15 games
do not resolve within 45 s when one side stops playing — including three of
these four. Any real match where a player puts the phone down reaches it.

**Fix.** All four now call `registerMinigameCleanup(_destroy)` in `start()`.
All 15 games verified compliant by static audit.

**Not verified:** that WebGL contexts are actually reclaimed. Confirming that
requires repeated force-ends against a context counter on real hardware; what is
verified is that `_destroy()` is now reachable from the force-end path.

---

### P1 — Fix before the next build goes out

#### QA-004 · Bot difficulty had no effect in 4 of 15 minigames
**Severity:** Medium-High · **Status:** ✅ Fixed · **Files:** as QA-003

`MinigameManager` calls `mod.start(isBot, winMinigame, Bot.skill())`, and the
standard specifies `start(isBot, onWin, botSkill = 0.55)`. SumoSpheres,
TankClash, OrbDeflect and RhythmForge all declared `start(isBot, onWin)` —
**silently dropping the third argument.** None contained any skill constant at
all; each had a single hardcoded behaviour.

**Player-visible effect:** choosing Easy or Hard on the splash screen did
nothing in 27% of the minigame rotation. A player who picked Easy to play with
a child still faced the same bot in those four.

**Fix.** All four now accept and use `botSkill` per §5 of the standard, with
noise on every action:

- **SumoSpheres** — re-aim cadence 185 ms → 100 ms, steering noise 0.60 → 0.12,
  and a rim-safety margin so Easy hugs the centre instead of committing to rams.
- **TankClash** — Gaussian-ish aim error scaled by skill, fire gate +900 ms →
  +100 ms, and a per-tick chance it simply doesn't shoot (35% → 95% will-fire).
- **OrbDeflect** — block chance 0.50 → 0.86, barrier placement error up to
  ±22% of screen width at Easy.
- **RhythmForge** — note hit rate 0.71 → 0.92, timing window 190 ms → 40 ms,
  plus a wrong-lane chance at low skill.

**Not verified:** the *balance* of these curves. The code paths run and consume
`botSkill`; whether Easy is beatable by a child and Hard is beatable by a
focused adult needs human playtesting. See §6.

---

#### QA-005 · Stealing a player's last ally left an orphan model on the board
**Severity:** Medium · **Status:** ✅ Fixed · **File:** `src/core/GameController.js`

```js
const stolen = stealCtx.target.allies.splice(stealCtx.allyIdx, 1)[0];
if (stealCtx.target.allies[stealCtx.allyIdx]?.mesh) {   // ← wrong object
    Renderer.detachAllyMesh(stolen.mesh);
```

The guard inspects whatever ally *shifted into* the spliced index rather than
the ally being stolen. Stealing index 0 of 2 worked by coincidence. Stealing the
victim's **only** ally — the common case, since most players hold one — left
`allies[idx]` undefined, so the condition was false and the victim's 3D marker
was never detached. It stays in the scene, no longer tracked by
`updateAllyPositions`, frozen at its last board position, while a duplicate is
attached to the thief.

**Fix.** Guard on `stolen.mesh` and bail safely if the splice returned nothing.

---

#### QA-006 · Dice could strand a turn with no recovery
**Severity:** Medium · **Status:** ✅ Fixed · **File:** `src/engine/Physics.js`

`onSettle()` fired its callback only once every die dropped below the sleep
threshold, with **no deadline**. A die resting against a wall or balanced on a
corner can stay above threshold indefinitely; the turn then sits in `ROLLING`
forever with no UI affordance to escape — an unrecoverable soft-lock requiring
a page reload and loss of the match.

Not observed in ~40 minutes of play, so this is a latent robustness gap rather
than a live bug — but the failure mode is total.

**Fix.** A 6-second watchdog deadline. On expiry the dice are frozen and the
faces read as-is, so a roll result always arrives. Logs a console warning so the
condition is visible in telemetry if it ever fires in the wild.

**Verified:** test pins a die in permanent motion; the callback still fires with
a legal 1–6 result (measured 6454 ms).

---

#### QA-007 · Breaking The Rift swallowed the rest of the roll (HBD only)
**Severity:** Medium · **Status:** ✅ Fixed · **File:** `src/core/GameController.js`

City Circuit banked leftover movement in `_pendingStepsAfterGate` and spent it
after a successful Gate roll. Hundred Block Dash clamped the target to the gate
and discarded the remainder — so rolling a 6 from two spaces short of The Rift
and breaking through moved you 2 spaces, not 6. `closeGate()` also gated the
resume on `state.selectedMap !== 'hundred_block_dash'`, making the asymmetry
explicit rather than accidental.

**Fix.** HBD now banks the eaten steps and `closeGate()` resumes via `_doMove()`
for both maps. Banked steps are cleared on a failed roll and reset at the start
of every move so a stale value can never leak into a later turn.

---

#### QA-008 · "FINISHED!" never displayed on 50- or 75-block runs
**Severity:** Low-Medium · **Status:** ✅ Fixed · **File:** `src/ui/UIManager.js`

The HUD position badge hardcoded `p.pos >= 99`. Selectable run lengths were
added later, so a 50-block run finishes at space 49 and the badge kept reading
`Space 49`. Now reads `state.hbd.finish`, and shows `Space N / finish` so the
player can see how far they have to go.

---

#### QA-016 · Uncaught TypeError when tapping fire in TankClash's first frames
**Severity:** Medium · **Status:** ✅ Fixed · **File:** `src/minigames/TankClash.js`

The only genuine uncaught exception found in the whole audit.

`start()` calls `_build()` — which attaches the fire-button listeners
**synchronously** — then creates the tanks inside `_initThree()`, which runs two
animation frames later:

```js
_tanks = []; …
_build();                                    // listeners live here
requestAnimationFrame(() => requestAnimationFrame(() => {
    _initThree();                            // _tanks populated ~33 ms later
```

`_fire()` then did `_tanks[pid].rotation` with no guard, and `onFireDown` only
checked `_done`. A tap in that ~33 ms window threw:

```
TypeError: Cannot read properties of undefined (reading 'rotation')
    at _fire (TankClash.js:397)
```

The same dereference is reachable on the way out: `winMinigame()` clears
`state.mgActive` immediately but `_destroy()` does not run until `endMinigame()`
800 ms later, so the listeners outlive the tanks while the result banner is up.

**Reproduced reliably** by `qa/earlytap.js`, which hammers both halves from frame
0. A human hits it by tapping the instant "GO!" appears — plausible in a reflex
game, and it fires the global `window.onerror` handler.

**Fix.** `_fire()` now returns early unless the tank exists and the game is
live. Sweeping all 15 games with the same stress test: **15/15 clean.**

---

### P2 — Polish and hygiene

| ID | Finding | Status |
|---|---|---|
| QA-009 | Landing on an open Gate showed the generic **"Nothing happens."** — `resolveSpaceEffect` returned `''` for `gate`/`gate_open`, which fell through to the fallback string. Now returns realm-appropriate copy. | ✅ Fixed |
| QA-010 | The **🗺️ MAP button was dead in Hundred Block Dash** — always visible, only ever emitting a "no map view" toast. A control that never works is worse than no control. Now hidden on HBD. | ✅ Fixed |
| QA-011 | **Three `sfx()` names were silent no-ops** — `coin`, `jump` and `warning` are not in `AudioManager`'s switch (standard R7). 8 call sites across RhythmForge, SumoSpheres and OrbDeflect played nothing. Remapped to registered sounds. | ✅ Fixed |
| QA-012 | **Canonical board data was duplicated.** `BoardSetup.js` carried a private `_getDistrictPools()` copy of the exported `DISTRICT_POOLS`, and `GameController.js` a private `_getAllNodesOrdered()` copy of `ALL_NODES_ORDERED`. Identical today; a latent drift bug where editing the board in one place silently diverges. Both now import the canonical export. | ✅ Fixed |
| QA-013 | **Fonts load from `fonts.googleapis.com`.** Three.js and Cannon.js were self-hosted precisely because a blocked CDN left a blank screen; typography still has the same dependency. CSS fallbacks mean it degrades rather than breaks, but the game looks wrong offline. | ⏳ Roadmap |
| QA-014 | `updateSingleTile()` is an alias for a **full `drawTiles()`** — a ~100-tile rebuild to change one tile. Correct after QA-002, but still a visible hitch on a mid-range phone. | ⏳ Roadmap |
| QA-015 | The arcade sets `state.players[1].isBot = false` and leaves it. Recovered on the next `goToCharSelect()`/`quickStart()`, so not currently reachable as a bug — but it is a global mutation with no owner. | ⏳ Roadmap |

---

## 4. Design findings

These are not defects. They are the gap between "works" and "feels like a real
game." Detail and sequencing in `UPGRADE_ROADMAP.md`.

**DF-01 · Session length is the biggest single problem.** *(addressed in this branch)*
City Circuit was a fixed 20 rounds, where a round is
`MINIGAME_EVERY_N_TURNS` = 4 board turns plus one head-to-head minigame.

Measured on the harness: **16.4 s per board turn** on City Circuit (24 turns in
395 s) and **16.1 s** on Hundred Block Dash (40 turns in 643 s) — consistent, and
it covers dice physics, hop animation, space resolution and modal
acknowledgement. Minigames ran 18–45 s in the arcade sweep, plus ~15 s of
intro / orientation / ready / countdown, so call it ~45 s each.

| Rounds | Board turns | Estimate at harness pace |
|---|---|---|
| 6 | 24 | 24×16.4 + 6×45 ≈ **11 min** |
| 12 | 48 | 48×16.4 + 12×45 ≈ **22 min** |
| 20 | 80 | 80×16.4 + 20×45 ≈ **37 min** |

A human is slower — reading modals, weighing purchases, physically passing the
phone — so 1.3–1.8× puts the shipped fixed length at **45–65 minutes with no
player control over it**, while Hundred Block Dash had offered 50/75/100 since an
earlier pass. A mobile party game needs a 15-minute option.

**Implemented:** a City Circuit match-length picker mirroring the HBD one —
**6 · SPRINT / 12 · STANDARD / 20 · MARATHON**, default Standard, persisted
into rematch prefs and reflected on the map card. The fixed `TOTAL_ROUNDS`
constant is replaced by `CITY_LENGTHS` / `CITY_DEFAULT_ROUNDS`; live games read
`state.cityRounds` through a single validated accessor.

**DF-02 · `swap_space` is classified as a reward in the Void.** `BoardSetup`'s
`GOOD_WEIGHTS.void` includes `swap_space` at weight 2, so the final realm — the
one that decides the race — hands out position swaps as *good* outcomes. For the
leader it is the worst space on the board. The bot's own heuristic rates it
`0`, i.e. neutral. Miscategorised.

**DF-03 · Characters are purely cosmetic.** Nine characters, zero mechanical
difference; `GameConfig.js` states this deliberately (abilities were removed in
`6463bab`). Defensible for balance, but nine identical picks is a menu, not a
choice.

**DF-04 · Six minigames cannot end without both players engaged.** SumoSpheres,
RhythmForge, OrbDeflect, QuickDraw, Freeze and ClearOut ran past 45 s with one
side idle, relying on the 90-second tie watchdog. The standard's own §3 targets
15–40 s and says "never design near that limit."

**DF-05 · TankClash resolved in 4 seconds** against a stationary opponent —
below the standard's 15 s floor. There is no minimum-duration or
respawn-grace guard, so a distracted player loses before they look up.

**DF-06 · 40 archived minigame prototypes** are documented as a design backlog,
not code. Correctly quarantined; worth noting they are ~9,000 lines of the
repository's ~24,000.

---

## 5. What was verified, and how

Automated, reproducible, in `qa/`:

| Claim | Evidence |
|---|---|
| No crashes across 6 configurations | 0 `pageerror`, 0 console errors in ~2,990 s of play (the sole exception, QA-016, needed frame-0 input hammering) |
| No illegal game states | Every observed `gameState` in the legal set of 10 |
| No coin/inventory/position corruption | Per-step invariant assertions: coins ≥ 0 and finite, inventory ≤ `MAX_INV`, allies ≤ `MAX_ALLIES`, item ids resolve, board position in range and on a defined space. **0 violations** |
| No soft-locks | 45-second no-state-change watchdog never tripped |
| All 15 minigames load and run | Arcade sweep: 15/15 started, 0 errors, 9/15 self-resolved under one-sided input |
| All 25 contracts claimable | Per-card isolation test firing the real emitter — 25/25 |
| Contract counters don't claim early | Under-count regression guard passes |
| Contract progress is per player | Cross-talk guard passes |
| Tile redraw doesn't leak | Live scene census flat across 15 redraws on both maps; same test shows 93 meshes + 93 materials leaked per redraw on the pre-fix code |
| Both maps complete to the win screen | 6-round City Sprint and 50-block HBD both reached the win screen with 0 invariant violations |
| No game throws on early input | All 15 games hammered from frame 0 after GO — 15/15 clean |
| New length picker works end to end | Smoke test: round counter reads `ROUND 0/6` after selecting Sprint; picker visibility follows the selected map; MAP button hidden on HBD |
| Dice always yield a result | Watchdog test with a permanently spinning die |
| All 15 minigames standard-compliant | Static audit: cleanup registration, `botSkill` signature and use, `dt` capping, resize/DPR, `_done` guard, single `onWin` |
| All `sfx()` names registered | Call sites diffed against `AudioManager`'s switch |

## 6. What could NOT be verified here

Stated plainly, because shipping unverified work as done is how the earlier bugs
got out:

- **Visual correctness.** SwiftShader software GL in a headless container. The
  QA-002 fix is verified as *not leaking* by counting real scene-graph objects,
  but nothing here confirms the board still **looks right** after a redraw — that
  the shared-geometry guard in `_disposeTree()` spared everything it needed to.
  **This is the single most important thing for a human to eyeball:** place a
  Tollbooth, open the Gate, and confirm no tile or icon has gone black or
  vanished.
- **Real-device performance.** No frame-rate measurement on real hardware. The
  60 fps target in the standard is unmeasured; the QA-014 redraw hitch is
  reasoned, not profiled.
- **Bot difficulty balance (QA-004).** New curves run and consume `botSkill`.
  Whether Easy is losable-to and Hard beatable is a playtest question.
- **Touch ergonomics and the two-player physical formats.** Pass-and-play and
  tabletop flows were driven synthetically. Whether two people can actually hold
  the phone as the orientation diagrams show is untested.
- **Minigame *fun*.** All 15 execute correctly. The §6 rubric in the standard
  (clarity, skill depth, comeback, juice) is a human judgement.
- **Audio.** Muted throughout. Sound *names* are verified as registered; nobody
  listened to them.
- **iOS Safari / real mobile browsers.** Chromium only. Haptics, audio unlock on
  first gesture, and viewport behaviour are the usual risks.
- **Full City Circuit match to the win screen at 20 rounds.** Verified at the
  new 6-round Sprint length; the 20-round path is the same code with a larger
  bound.
- **WebGL context reclamation (QA-003).** `_destroy()` is now reachable from the
  force-end path; that the contexts are actually freed needs a context counter on
  real hardware.
- **The ~45 s per minigame term** in the DF-01 pacing table is an estimate from
  observed arcade durations, not a measured average of in-match minigames.

---

## 7. Reproducing this

```bash
npx http-server -p 8129 -c-1 &            # serve the repo root
cd qa
node smoke.js                             # fast boot check, both maps  (~2 min)
node verify.js                            # contract + physics assertions (~3 min)
node leak.js hundred_block_dash 15        # renderer leak census        (~1 min)
node earlytap.js                          # frame-0 input stress, all 15 (~6 min)
node arcade.js 45                         # full minigame sweep        (~11 min)
node verify2.js city_circuit 6            # full match to the win screen
node run.js city_1p 600                   # long-form autoplay soak
```

`smoke.js`, `verify.js`, `leak.js` and `earlytap.js` are deterministic and exit
non-zero on failure — those four are the CI gate. Configurations are declared in
`qa/run.js`; the in-page autoplay agent is `qa/agent.js`. Every run writes
`qa/result-<name>.json` with the full action log, state census and any invariant
violations. See `qa/README.md`.
