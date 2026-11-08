# Hundred Block Dash — context for Claude

A 2–4 player party board game (city board, dice, contracts, Stars) with
minigames, for phones. Plain ES modules, no bundler: the repo root is the web
build. three.js **r128** and cannon.js 0.6.2 as globals (`vendor/`). Ships via
Capacitor 8. Online play: Trystero WebRTC through claw-core's `NetTransport`.

## Run / verify

```
git submodule update --init          # src/claw-core is a submodule — nothing loads a minigame without it
npx --yes http-server -p 8129 -s -c-1 .   # probes expect :8129 (QA_BASE overrides)
bash qa/parsecheck.sh src            # parse + dead _refs + command bus + scene routing (fast, no browser)
node qa/ci-smoke.js                  # what CI runs: boot, fonts, first roll
node qa/<feature>.js                 # 100+ probes, one per feature — run the ones you touched
node scripts/build-web.js            # www/ for Capacitor
```

## Map (biggest files first — open by line range, never whole)

| Path | Lines | What |
|---|---|---|
| `src/engine/Renderer.js` | 5.4k | board renderer, props (`PROP_KIT`), camera, `setBoardPaused` |
| `src/core/GameController.js` | 3.1k | turn flow, dice, movement, contracts, payouts |
| `src/ui/UIManager.js` | 1.9k | HUD and panels |
| `src/engine/CityKit.js` | 1.6k | building/prop model toolkit (Elemental's `Kit.js` came from here) |
| `src/core/Commands.js` | — | **the only door for player decisions** (offline: direct call; online: net dispatcher) |
| `src/net/` | — | session, sync, protocol, ready gate; depends on the game, never the reverse |
| `src/config/` | — | GameConfig, maps (`maps/`, `layouts/`), Release |
| `src/AppHost.js` | — | HBD's side of the claw-core contract (re-exports real modules) |
| `src/claw-core/` | — | **submodule, shared with CLAWGames**: all live minigames, stage kit, net transport |
| `src/minigames/archived/` | — | 40+ retired games kept for reference. Not shipped, not checked. Don't read unless porting one |

## Hard rules

- A minigame change is a commit in **claw-core** first, then a pointer bump here. CLAWGames runs the same files: run both apps' probes before moving either pointer.
- Player decisions go through `Commands` by name. View-only actions (open map, flip a card, scroll) stay off the bus.
- `src/net/` may import the game; the game never imports `src/net/`. `Commands.js` imports nothing.
- File-private helpers are `_`-prefixed; parsecheck relies on it.
- `NET_APP_ID = 'hundred-block-dash'` never changes (it would split players across versions).
- Storage keys are `hbd_`-prefixed (`core/Storage.js`); changing that orphans saves.
- Never poll with `pgrep -f`/`pkill -f` on a pattern your own shell contains (cost time 4×; see `qa/README.md`).

## Docs — read only the one the task needs

| Task | Read |
|---|---|
| Any minigame work | `docs/MINIGAME_STANDARD.md` §2 (non-negotiables) + §8 checklist |
| New 3D stage minigame | `docs/MINIGAME_3D_PLAYBOOK.md` (`npm run new:3d` scaffolds) |
| Turn flow / pacing | `docs/TURN_FLOW.md`, `docs/SCENE_PACING.md` |
| Online / 4 phones | `docs/MULTIPLAYER_PLAN.md` |
| Maps, districts, layouts | `docs/DISTRICTS.md`, `docs/LAYOUTS.md`, `docs/STAR_TERRITORY_SPEC.md` |
| Store build | `docs/STORE_RELEASE.md` |
| Writing a probe | `qa/README.md` |

Dated audits (`*_AUDIT_*`, `QA_REPORT`, `RELEASE_AUDIT_2026-09`, `BOARD_SMOOTHNESS_2026-09`) are history: their findings are fixed or tracked. Don't load them for context.

## Token rules

- Don't read `vendor/`, `www/`, `resources/`, `qa/shot-*.png`, or `src/minigames/archived/`.
- Grep for the symbol, then open the range. Renderer/GameController in full is ~40k tokens.
- New code goes in a new module, not into the 3k–5k line files.

## Shared kit

`Claws02/claw-kit` holds the renderer-free plumbing (storage, settings, audio buses, haptics, crash log, parsecheck/build-web/serve tools). Adoption here is incremental. See its README "Adopting". Mind the storage prefix: `hbd_` vs `hbd.`.
