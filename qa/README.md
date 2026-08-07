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
| `node verify.js` | Assertion suite: all 25 contracts claimable, counter regression guards, dice settle watchdog, no errors. **Deterministic — use this as the CI gate.** | ~3 min |
| `node verify2.js city_circuit 6` | Starts a real match: scene-graph leak census across 12 tile redraws, measured turn pacing, plays through to the win screen. | ≤25 min |
| `node verify2.js hundred_block_dash` | Same, on the 50-block linear map. | ≤25 min |
| `node arcade.js 75` | Launches every registered minigame from the arcade, plays each with synthetic input, checks each resolves and cleans up. | ~25 min |
| `node earlytap.js` | Hammers both halves from frame 0 after GO on every game — catches state-not-ready races (found QA-016). | ~8 min |
| `node botcheck.js 65` | Drives each game's bot branch at easy and hard with **no human input at all**. Flags games that only end when a human plays, and bots that lose every hard run. | ~30 min |
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
- **New contract type:** add its emitter to the `emit` map in `verify.js`. If you
  add a contract to the pool without an emitter, `verify.js` fails with
  `NO EMITTER MAPPED` — which is exactly the bug (QA-001) that motivated this
  suite. Do not delete that check.

## Known limitations

Software GL in a headless container: this suite proves the game **runs
correctly**, not that it **looks right**. It cannot assess visual fidelity, frame
rate on real hardware, audio, touch ergonomics, bot difficulty balance, or
whether any minigame is fun. See `docs/QA_REPORT.md` §6.
