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
| `node arcade.js 45` | Launches all 15 minigames from the arcade, plays each with synthetic input, checks each resolves and cleans up. | ~11 min |
| `node run.js <config> <seconds>` | Full autoplay of one configuration. Configs in `run.js`: `hbd50_1p`, `hbd75_1p`, `hbd100_1p`, `hbd50_pass`, `hbd50_table`, `city_1p`, `city_pass`, `city_hard`. | as given |

Override the target with `QA_BASE=http://host:port/index.html`.

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
- **New minigame:** nothing to do — `arcade.js` reads `MG_TYPES` from the
  registry.
- **New contract type:** add its emitter to the `emit` map in `verify.js`. If you
  add a contract to the pool without an emitter, `verify.js` fails with
  `NO EMITTER MAPPED` — which is exactly the bug (QA-001) that motivated this
  suite. Do not delete that check.

## Known limitations

Software GL in a headless container: this suite proves the game **runs
correctly**, not that it **looks right**. It cannot assess visual fidelity, frame
rate on real hardware, audio, touch ergonomics, bot difficulty balance, or
whether any minigame is fun. See `docs/QA_REPORT.md` §6.
