# QA Harness

Automated playthrough and regression suite for Hundred Block Dash. Drives the
**real game** in a real browser — no mocks, no stubs — via Playwright, and
asserts game-state invariants on every step.

Built for the audit in `docs/QA_REPORT.md`. Keep it: it catches the class of bug
that audit found — silently dead subsystems, resource leaks, and soft-locks —
none of which throw an error.

## Requirements

Playwright and Chromium. In this repo's dev container both are preinstalled
(`/opt/pw-browsers/chromium-1194`). The scripts point at that path directly;
change `executablePath` if yours differs.

## Running

Serve the repo root first — the game loads ES modules, so `file://` will not work.

```bash
npx http-server -p 8129 -c-1 &
cd qa
```

| Command | What it does | Runtime |
|---|---|---|
| `node verify.js` | Assertion suite: every bounty in the pool claimable by its real emitter, counter regression guards, dice settle watchdog, no errors. **Deterministic — use this as the CI gate.** | ~4 min |
| `node verify2.js city_circuit 6` | Starts a real match: scene-graph leak census across 12 tile redraws, measured turn pacing, plays through to the win screen. | ≤25 min |
| `node verify2.js hundred_block_dash` | Same, on the 50-block linear map. | ≤25 min |
| `node arcade.js` | Launches every registered minigame from the arcade, plays each with synthetic input in **both** halves, checks each resolves and cleans up. Budget is 90s/game, or the game's own `MG_WATCHDOG_MS` where it declares a longer one. | ~20 min |
| `node earlytap.js` | Hammers both halves from frame 0 after GO on every game — catches state-not-ready races (found QA-016). | ~8 min |
| `node botcheck.js 65` | Drives each game's bot branch at easy and hard with **no human input at all**. Flags games that only end when a human plays, and bots that lose every hard run. | ~30 min |
| `node arcadecoins.js` | Plays four arcade rounds and asserts **nothing the board reads moved** — no coins, no lifetime earnings, no match win count — while the arcade's own round tally did. Also checks a real match minigame still pays. | ~2 min |
| `node pacing.js` | Turn ORDER, not appearance: the tile names itself before the coins move, the token walks *through* a fork with the camera already on it, and the Swap cinematic runs and leaves the board consistent (right nodes, visible, full scale) — including after a deliberate interruption. | ~3 min |
| `node polish.js` | The presentation pass: the whose-turn banner (fires on hand-over, silent on a re-roll, never over the roll button), City's coins-per-round end chart, the win-screen stat tiles and both buttons on screen, the ally's real 3D model on the board with no leak across 12 spawn cycles, and a rendered 3D portrait on every character card. | ~4 min |
| `node city.js` | The City Circuit audit: the opening briefing and its map tour, junction **arrows over the board** (labelled, separated, correct through the tabletop half turn, and returning from a map scout with the choice still open), zero track-moving spaces in the pools *and* on a live board, the bounty panel, and a sampled camera trace — position **and aim**. | ~4 min |
| `node mapp2.js` | The map from **Player 2's** end in tabletop: touching a block selects that block, the tooltip faces them and keeps its offset, and dragging pushes the board the way the finger moves. `mapinfo.js` only ever plays P1, which is how the inverted raycast survived. | ~2 min |
| `node treeclimb.js` | Reads the lit leaf off the canvas over a 16-branch climb: the sides must not strictly alternate, must never run three deep, and a wrong grab must drop you to the last branch on that side. | ~1 min |
| `node memorymatch.js` | Left alone for 14 s nothing turns itself over; then plays it out (memoryless P1 vs the real bot) to prove a clockless board still empties. | ~2 min |
| `node steering.js` | Light Cycles: drives a real joystick drag in each half and checks the cycle travels the way it was pushed — all four directions, both players. | ~2 min |
| `node inventory.js` | The bag-full discard picker on all three entry paths (mystery, shop purchase, pass-through shop) + minigame rotation over three full cycles. | ~2 min |
| `node cityprogress.js [secs]` | Samples board turns and completed rounds on a City match every 30 s. Answers "is it slow or is it stuck?" — a stall shows as a flat run, a long game as a steady climb. | as asked |
| `node features.js` | Map view on both boards (button shown, opens, slider range, camera follows, counter, closes) + practice mode (awards nothing, hands control back) + the payoff-beat dwell guarantee. | ~6 min |
| `node scenes.js <map> <seconds>` | Scene-timing probe: samples at 40 Hz and reports how long each beat owns the screen. The table behind `docs/SCENE_PACING.md`. | as given |
| `node gate.js` | The three gate bugs: screen orientation follows the roller, opening the gate does not eat the turn, camera snaps back onto the player. Tabletop 2P on HBD. | ~3 min |
| `node balance.js` | Red-space density over 40 generated boards at each length (cap: 1 coin-losing space per 10 blocks), plus the ±10 forced-move notifications and the item-pickup confirmation. | ~3 min |
| `./parsecheck.sh ../src` | Two static gates, each of which exists because a real bug got past the thing before it. **(1) Module parse** — `node --check` parses a file as CommonJS and tolerated a dangling `else` in GameController. **(2) Dead local references** — deleting a private helper and missing one call site is invisible to any parser; `_reflectIfMirrored is not defined` only surfaced 25 minutes into a full-match run. **Run before anything else.** | ~2 s |
| `node spaceaudit.js [n]` | Generates n real boards per length and reports the true space distribution per map, length and realm. The source for `docs/SPACE_REFERENCE.md` — the weight tables don't answer this, because they're drawn with replacement and the red budget is capped separately. | ~1 min |
| `node rules.js` | Economy rules: HQ pays for passing not just landing, FINE is −3 / BIG FINE −8 everywhere including realm flavour text, the Gate needs 20 on HBD and 15 on City, and the shop carries the narrowed roster with no dangling references. | ~3 min |
| `node mapinfo.js` | The map view tells you what a space does and how far away it is, on both boards, with the City count following the lap order. | ~4 min |
| `node newgames.js` | The four classic games driven by a *scripted* opponent instead of random taps: Puck's bot must score against an open goal, the Connect-4 bot must beat random play, and every game must resolve inside the time budget. Catches what the generic sweep can't. | ~5 min |
| `node dualread.js` | Both-players readability: SHARED cards mirror in tabletop, OWNER cards get the opponent strip, the ⟳ flip button works, the minigame rules need two confirmations, and pass-and-play gets the button but no mirroring. Screenshots each case. | ~5 min |
| `node winscreen.js <map>` | End-of-match screen: landscape presentation, the turn-by-turn race chart, the rotate toggle. Screenshots both orientations. | ~4 min |
| `node run.js <config> <seconds>` | Full autoplay of one configuration. Configs in `run.js`: `hbd50_1p`, `hbd75_1p`, `hbd100_1p`, `hbd50_pass`, `hbd50_table`, `city_1p`, `city_pass`, `city_hard`. | as given |

> **The arcade sweep delivered no input at all until 2026-08.** `launchArcade`
> called `triggerStandalone` directly instead of going through the splash's own
> button, so `#splash` stayed stacked above `#minigame-layer` and swallowed every
> synthetic pointer event. Every game still "passed", because every game had a
> clock of its own that carried it to a result regardless. Removing the shot
> clock from Penalty is what finally exposed it — it was the first game that
> genuinely could not finish without a player. Two lessons worth keeping: a
> passing input probe proves nothing unless something in it *fails* when the
> input stops, and the sweep now taps both halves, because a turn-based game
> needs both players to act.

> **A camera probe that only watches the camera's POSITION proves nothing.**
> The touchiness players reported lived in the *aim*: the follow camera read its
> heading off the token's live mesh position every frame, so the heading swung
> through the arc of every hop and snapped at every change of node. The position
> barely moved while it did that — a distance-per-frame probe sailed straight
> past it and passed on the buggy build. `city.js` samples the camera's world
> direction as well, and that is the number that moves: 1.43° → 0.51° at the
> 95th percentile, 6.05° → 2.61° worst case. Sample dt too and normalise to a
> 60 Hz frame, or a frame-rate-independent damp looks like a lurch on a slow
> renderer and the probe flags the fix as the bug.

> **The scene-graph census was measuring nothing at all.** Both `agent.js` and
> `verify.js` found the scene by taking the camera and walking up `.parent`
> until it ran out. The camera in this renderer is never added to the scene, so
> that walk returns the camera itself: every census since it was written
> reported `meshes 0→0` and passed. It now calls `Renderer.getScene()` and
> counts 744 meshes / 242 materials, stable across 12 tile redraws. A leak check
> that cannot see the thing it is checking passes forever — if a census returns
> zero, that is the bug, not the result.

> **`verify.js`'s pacing check is load-sensitive.** It counts board turns in a
> fixed 180 s window, and a dice settle can take 20 s under software GL when the
> container is busy. Two runs launched alongside other Playwright jobs reported
> `0 turns`; the same file run on its own reports 12. Run it alone.

> **Three probes guessed a delay where they should have waited for a thing.**
> `dualread.js`, and then `balance.js`, waited a fixed 900–1000 ms for a result
> card that is raised on a Director beat. Adding the `LAND_ARRIVE` beat pushed
> the card past that guess and both started failing — with the card *correct and
> simply not up yet*. Both now poll. Any probe asserting on something that
> appears must wait for it to appear; the floors in `SceneTiming.js` are floors,
> and a slow renderer stretches them further.

> **Two probes had latent isolation bugs that only surfaced when the City pools
> changed.** `rules.js` asserted an exact coin delta for walking past an HQ while
> *landing on whatever the pool put at the far end* — the new pools put a TRAP
> there and it read 50→60 instead of 50→65. `balance.js` let its forced-move
> tests land on a block that turned out to be a shop, which opened a modal and
> took the Director, so the next test's card never appeared. Neither was a
> product regression. Both now blank the squares they are not testing. If a probe
> asserts on a number, it has to own every input to that number.

Override the target with `QA_BASE=http://host:port/index.html`. `arcade.js`,
`earlytap.js` and `botcheck.js` also accept `QA_ONLY=game1,game2` to sweep a
subset — useful when you've only touched one game.

Every run writes `result-<name>.json` (full action log, state census, invariant
violations) and a `shot-<name>.png` screenshot.

## How it works

`agent.js` is injected into the page and exposes `window.__QA`.

- **Live state access.** It `import()`s the game's own modules. ES modules are
  cached per URL, so `import('/src/core/GameState.js')` returns the *same*
  `state` singleton the game is using — the harness observes real state, it does
  not reconstruct it.
- **`step()`** inspects the DOM for whatever is currently on screen and taps the
  correct control: modals, branch cards, gate rolls, shop buys, duel bets, ally
  prompts, pass-and-play handoffs, roll buttons. One call = one player action.
  It occasionally opens the map or item bag to exercise those paths too.
- **`checkInvariants()`** runs every step and records any violation of: coins
  non-negative and finite, inventory ≤ `MAX_INV`, allies ≤ `MAX_ALLIES`, item ids
  resolve in `ITEMS`, board position in range and on a defined space, position
  type correct for the map.
- **Soft-lock detection.** The driver hashes the state snapshot each step; ~45 s
  with no change at all is reported as `SOFT_LOCK` with a full overlay-visibility
  dump.
- **`setMinigameFastResolve(ms)`** force-resolves minigames after a real play
  window so board-loop tests finish in a test budget. Minigames get their own
  full-length coverage from `arcade.js`.

## Adding coverage

- **New configuration:** add an entry to `CONFIGS` in `run.js`.
- **New minigame:** `arcade.js` and `earlytap.js` read `MG_TYPES` from the
  registry, so they pick it up automatically. `botcheck.js` needs its `MODS` map
  updated with the key → filename pair (it imports modules directly to reach the
  bot branch).
- **New bounty type:** add its emitter to the `emit` map in `verify.js`. If you
  add a bounty to the pool without an emitter, `verify.js` fails with
  `NO EMITTER MAPPED` — which is exactly the bug (QA-001) that motivated this
  suite. Do not delete that check. It will not, however, catch a bounty that asks
  for something that no longer exists in the game (a `use_item` bounty naming an
  item the shops stopped selling); `city.js` cross-checks those against `ITEMS`.
- **New full-screen scene on City:** the harness dismisses the opening briefing
  automatically from `startRun`, because that screen holds `gameState` at `INIT`
  until somebody presses START and most probes wait on state without driving
  `step()`. Pass `keepBriefing: true` if your probe is testing that screen.

## Known limitations

Software GL in a headless container: this suite proves the game **runs
correctly**, not that it **looks right**. It cannot assess visual fidelity, frame
rate on real hardware, audio, touch ergonomics, bot difficulty balance, or
whether any minigame is fun. See `docs/QA_REPORT.md` §6.
