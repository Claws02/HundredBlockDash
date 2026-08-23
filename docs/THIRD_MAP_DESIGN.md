# The third map — analysis, and a board built around a Star

**Date:** 2026-08-23
**Branch:** `claude/game-map-design-scov1x`
**Status:** design brief. Nothing in `src/` has been touched.
**Scope:** a full read of the existing game, then a proposed third board whose
score is **Stars** rather than coins.

---

# PART I — THE GAME AS IT STANDS

## 1. What it is

A two-player 3D party board game, vanilla ES modules, **no build step**.
`index.html` boots `src/main.js`; three.js and cannon-es are vendored locally
(`vendor/`) precisely because a blocked CDN used to blank the screen.

| | Count |
|---|---:|
| Live source (excl. archived minigames) | ~22,200 lines |
| Archived minigame prototypes | 54 files / ~12,200 lines |
| Live minigames | 22 |
| QA probes (`qa/*.js`, real Chromium) | 34 |
| Maps | 2 |
| Playable board nodes, City Circuit | 60 (+4 invisible junctions) |
| Bounties in the pool | 31 |
| Shop items | 7 |
| Buddies | 5 |

**Honest headline:** the engineering is ahead of the game, and the *writing about*
the engineering is ahead of both. `docs/TURN_FLOW.md`, `docs/DISTRICTS.md` and
`docs/CITY_CIRCUIT_AUDIT.md` are better design documentation than most shipped
indie titles have. That is the asset. It also means a third map that ignores the
rules those documents lay down will read as a foreign object.

## 2. Architecture

```
main.js                    boot, DOM wiring, global error guard
core/
  GameState.js             the single mutable `state` object
  GameController.js  2171  the whole turn pipeline (the load-bearing file)
  BoardSetup.js            fills board slots from pools / quotas
  Economy.js               earnCoins / loseCoins + shield & bodyguard absorption
  Contracts.js             bounties
  Director.js              THE PACING SPINE — named beats with minimum floors
  Bot.js                   difficulty profiles + all AI heuristics
  WinScreen.js             final scoring, stat cards, the race chart
  Stats.js / Storage.js / Settings.js
config/
  GameConfig.js       449  every tunable constant, biomes, items, buddies, spaces
  BoardGraph.js       206  City Circuit topology — ONE hardcoded graph
  MapRegistry.js           the map-select cards (data only)
  ContractPool.js          31 bounties
  MinigameRegistry.js      22 minigames
  SceneTiming.js           every beat floor, named
engine/
  Renderer.js        3686  three.js scene, cameras, city dressing, layouts
  SetPieces.js        514  cinematics (swap, gate, HQ, magnet, mystery…)
  Physics.js               cannon dice
  AudioManager.js          synthesised Web Audio, zero assets
ui/
  UIManager.js       1351  HUD, toasts, map view, briefings, junction arrows
  ModalManager.js          card tiers: owner / shared
  DualRead.js              tabletop double-render
  Onboarding.js
```

**The pacing spine is the best idea in the codebase.** `Director.hold(name, fn)`
starts a named beat and runs `fn` only after its floor in `SceneTiming.js` has
elapsed. A beat owns the screen; the next one cannot start early. That single
rule replaced ~30 anonymous `setTimeout` literals and is why the game reads
rather than flickers. **Any new map must be built through the Director. Nothing
new should ever call `setTimeout` for pacing.**

## 3. The two boards, compared

| | Hundred Block Dash | City Circuit |
|---|---|---|
| Topology | linear array, 50/75/100 | directed graph, 60 nodes, 4 junctions |
| `player.pos` | a **number** | a **string node id** |
| Movement fn | `_movePlayerHBD` | `moveThroughGraph` |
| Board generation | exact quotas, board-wide | shuffled per-district pools |
| Ends when | someone reaches the Crown | round limit (6/12/20) |
| Score | coins + 50 finish bonus | coins + district dominance |
| Route choice | none | the entire point |
| Gate | The Rift, 5d6 ≥ 20 | The Gate, 5d6 ≥ 15 |
| Exclusive systems | realms, finish bonus | bounties, buddies, duels, HQs, circuits |

## 4. Systems inventory (what a third map can inherit for free)

- **Spaces** — 22 types in `SPACE_META`, each with icon, name, colours, geometry.
- **Items** — 7, deliberately **one per verb**: defend, trap, sabotage a roll,
  control your roll, jump, take coins, trade places. Five were cut for being
  four ways to say "move further."
- **Buddies** (`allies` in code) — 5, spawn on a board node, claimed by winning a
  minigame, stealable off a rival you land on or pass, expire on a round clock,
  and get a mandatory **round report card that waits for a press**.
- **Bounties** (`contracts` in code) — 31, three live at a time. Every `type`
  must have a live emitter or it clogs a slot forever; `qa/verify.js` enforces it.
- **Duels** — land on the tile, take a 3-coin ante, set a bet, play a minigame
  for the pot.
- **The Gate** — 5-dice threshold roll with its own camera, its own card, and a
  shattering set piece. Items are unavailable there, by design and by guard.
- **Set pieces** — 12 cinematics with an explicit budget rule: *frequency sets
  the budget.* Under 0.6 s for constant events (coin, fine); up to 6 s for
  once-a-match ones (Gate, Swap abduction).
- **Minigames** — 22, drawn from a bag so nothing repeats until the bag empties.
- **Tabletop mode** — the board and half the UI render **upside down** for
  Player 2. Every new screen-space element has to undo that rotation explicitly.

## 5. The rules this codebase has already committed to

These came out of a real audit and real play sessions. A new map that breaks one
of them is a regression, not a variation.

1. **One red space per ten nodes, maximum.** City used to run 13 of 60 (one per
   4.6) and it was a recurring tax, because on a lap map you pass the same tile
   every circuit.
2. **On a lap map, no space may move you along the track.** Shortcut, Launch and
   Pulled Back were deleted from every City pool. You commit to a twelve-space
   road for what is in it; a tile that fires you past the rest cancels the choice
   you already made. Movement comes from the die, from BOOST (a real extra roll),
   and from items you chose to buy.
3. **Arrive, then resolve, then explain.** The tile names itself, ~585 ms later
   the coins move, then the card. Never the reverse.
4. **Frequency sets the set-piece budget.**
5. **A route choice is arrows over the board, never a card covering it.** The one
   moment the board's shape is the decision is the one moment it must be visible.
6. **Every data-table row needs a live code path.** Two bounties once asked for an
   item that no longer existed.
7. **Reports wait; only things worthless-after-the-fact are urgent.** The toast
   queue holds everything during `MOVING`/`ROLLING` except the roll callout.
8. **Say what the board is before the first decision.** City's briefing exists
   because the first junction used to spring routing on a player mid-move.

## 6. Where a third map will fight you — the seams

This is the part that decides the schedule, so it is stated bluntly.

### 6.1 · Map dispatch is a **binary**, not a registry

There are **47** occurrences of `state.selectedMap === 'hundred_block_dash'` (or
`!==`) across seven modules. There is no third branch anywhere. `MAP_REGISTRY`
looks like a plugin system but only feeds the map-select cards — it has no code
path behind it.

> **Consequence:** a third map dropped in today inherits the entire `else`
> branch — bounties, buddies, district HQ bonuses, the full-circuit bonus, the
> 15-threshold Gate, the round counter, the City win screen and the City
> briefing — whether it wants them or not.

### 6.2 · The board graph is a hardcoded singleton

`BoardGraph.js` exports `CITY_GRAPH`, `DISTRICT_POOLS`, `BRANCH_OPTIONS`,
`JUNCTION_IDS`, `DISTRICT_NAMES`, `DISTRICT_KEYS`, `ALL_NODES_ORDERED` — all
literal City data, imported directly by six modules (~91 references).
`ALL_NODES_ORDERED` in particular is load-bearing: it drives the camera curve,
the map slider, lap progress, and the map view's "N spaces ahead" count.

### 6.3 · The renderer hardcodes City geometry

`buildNodePositions()` writes City's ring (R=32) and district arcs (R=58)
directly into a module-level `Map`. `_buildCityScene`, `_buildCityGround`,
`_buildCityCenter`, `_buildDistrictSurfaces`, `_buildDistrictDressing`,
`_buildDistrictLandmarks`, `_buildDistrictLights` and `_buildOverheads` are all
City-specific. There are two layout functions in a 3686-line file and no third
slot.

### 6.4 · The bot's routing heuristic names City's districts

`Bot._branchScore()` contains `if (dist === 'fin' || dist === 'shop') s += 2`
and friends. Route AI is not data-driven.

### 6.5 · Win, chart and HUD are two-way too

`WinScreen.calculateWinner` has an HBD branch and a City branch. The end-of-match
chart plots position-per-turn on HBD and coins-per-round on City. A Star map
needs a third series and a third scoring rule.

### The fork this creates

| | **(A) Wedge it in** | **(B) Map modules** |
|---|---|---|
| What | New map rides the City `else` branch; feature differences become flags on a per-map config object | `config/maps/<id>.js` exports graph, pools, layout, features; an `ActiveMap` accessor replaces direct `CITY_GRAPH` imports |
| Cost | ~1 week | ~2–3 weeks (the extra 1–2 is almost entirely the mechanical 91-reference conversion + probe updates) |
| Risk | The third map is welded to City's identity forever. A fourth map is not possible without doing (B) anyway, on a bigger codebase | The conversion touches `GameController.js`, which is the file every other feature also lives in |
| Honest read | Ships sooner, costs more later | **Recommended.** The registry-and-standard pattern already used for minigames is exactly this, and it is the reason 22 minigames were cheap to add |

---

# PART II — THE NEW MAP

## 7. What a Star actually changes

Mario Party's core trick is that **coins are ammunition and Stars are score**.
Both existing boards score on coins, so every coin system in this game currently
does double duty as economy *and* scoreboard — which is why fines had to be made
small and rare.

Put a Star on top and the whole existing economy gets re-pointed, for free:

- A fine stops being a score penalty and becomes **a star you can no longer
  afford**. Suddenly −8 matters again.
- The Magnet and the Steal item stop being score transfers and become **denial** —
  you are taking someone's purchasing power at the exact moment they need it.
- Bounties become a **funding round**, not a side score.
- The shop competes directly with the Star for the same coins. That is a real
  decision, and neither existing board has one.

**This is the strongest argument for building it.** It is not a third board with
new scenery; it is the board that makes the existing 22 space types, 7 items and
31 bounties tense for the first time.

**And the sharpest risk, stated first:** this is a **two-player** game. Mario
Party dilutes star luck across four players and dozens of turns. With two, if a
Star simply sits somewhere and costs 20 coins, whoever's dice land nearer buys
it — that is a coin flip wearing a decision's clothes. Everything in §9 exists to
answer that one problem. If it is not answered, the map is worse than City
Circuit, not better.

## 8. Board shape — three concepts

The ask was "more like City Circuit — a map you go **around**." All three are
graph boards with junctions, and all three would run on `moveThroughGraph`.

### A · **The Clover** — a hub ring with four petal loops ★ recommended

```
                      ╭── PETAL N ──╮
                      │             │
                 ╭────J1────╮       │
        ╭─PETAL W┤  HUB RING ├PETAL E╮
        │        ╰────J3────╯        │
        │             │              │
        ╰──────── PETAL S ───────────╯
```

- **Hub ring: 12 nodes**, four junctions evenly spaced.
- **Four petals: 12 nodes each.** A petal *leaves* at its junction and *rejoins*
  the ring one node later — a teardrop, so you never retrace a tile.
- **A Star Plinth sits at each petal's midpoint** (node 6 of 12). One is live at
  a time.
- **60 playable nodes** — deliberately the same budget as City Circuit, which is
  a proven size.

Why this one:

| | |
|---|---|
| **The choice is richer** | City's junction is always a binary: ring or district. Here, committing to a petal costs you a full out-and-back detour — real time, not a parallel route. |
| **The Star has somewhere to go** | Four plinths, and the live one relocating between them is the chase engine (§9). |
| **Distances are right** | Hub lap alone: 12 spaces (~3.4 turns). Lap taking one petal: 23. Plinth to the *far* plinth: ~18 spaces ≈ 5 turns — long enough to be a chase, short enough to be catchable. |
| **It reuses the district system wholesale** | Petals map 1:1 onto `DISTRICT_BIOMES`: surface, props, lamp, motes, landmark, overhead span, arrival banner. That machinery is built, probed and documented. |
| **The bot already has the shape** | `_branchScore` is a two-option scorer; four options is the same function with a data table instead of hardcoded names. The Cabbie's four-way picker UI already exists. |

Risk to watch: the hub ring is 12 nodes that everybody crosses constantly, and it
must not become filler. It wants to be the *tense* road — where you meet, where
the Duels are — not the safe one.

### B · **Two Rings** — inner sprint, outer riches

Outer ring ~36 nodes (rich, slow), inner ring ~16 (cheap, fast), four spokes
between them. The Star always sits on the outer ring; the inner ring is purely
how you cut across to reach it.

Cleaner single idea than the Clover, and the tempo decision (cut across poor, or
go round rich) is genuinely good. But the inner ring becomes a corridor you never
*want* to be on, only pass through — 16 nodes of board earning very little — and
two concentric rings at the game's camera distance risk reading as visual mush.

### C · **The Archipelago** — islands joined by one-way ferries

Three or four island loops with directional links. Most novel, most Mario Party.
**Rejected**: one-way links can strand you, which is the exact "the game took my
route choice away" failure C-05 was written to kill.

## 9. The Star mechanic

Framing name below is a placeholder pending the theme decision (§13).

### The rules

1. **One Star is live at a time**, on one of the four plinths. Its location is on
   the HUD, on the map view, and in the round report — never hidden.
2. **Passing the plinth is enough** — you do not have to land on it. This copies
   `DISTRICT_HQ`, which already pays on pass-through and is the single most
   satisfying moment on City Circuit.
3. **Price: 20 coins, +5 per Star you already hold** → 20 / 25 / 30 / 35.
   A visible, honest handicap on the leader, expressed as a number the player can
   read and plan around rather than as hidden rubber-banding.
4. **On purchase the Star relocates to the plinth farthest from the buyer**, never
   the same one. The buyer has guaranteed the longest possible trip to the next
   one. That is the chase engine, and it means buying a Star is *also* a
   positional cost.
5. **Can't afford it?** Nothing happens and nothing is refunded. The trip was the
   gamble. (A consolation payout was considered and cut — it softens the only
   moment on the board with real teeth.)
6. **Second lane — Star Shards.** Win a round-end minigame or a Duel and take a
   Shard. **Four Shards auto-redeem into a Star.** This is the answer to "the
   player behind on coins has no path": they have a second, entirely
   skill-expressed one, and it costs almost nothing to build because
   `_resolveMinigameResult` and `_startDuel` are already the emitters.
7. **Stars can never be stolen.** Shards can — a Duel may be staked with a Shard
   instead of coins. Stars are the record of what you did; taking one back is
   misery. The Shard is where the risk lives.

### Why these four levers together

Each answers the 2-player coin-flip problem from a different side, and each is
legible on its own:

| Lever | Answers |
|---|---|
| Relocation away from the buyer | "whoever is closer just wins forever" |
| Escalating price | "whoever gets the first Star snowballs" |
| Shards from minigames + duels | "I'm behind on coins and have no path" |
| Pass-through purchase | "I rolled a 5 instead of a 4 and lost the game" |

### Set piece

Buying a Star is the biggest event on this board and gets the biggest budget —
call it **4–5 s**, in the tier with the Gate and the Swap abduction:

> the plinth lights, the Star lifts out of it and settles over the buyer's token,
> the counter ticks, then the Star **streaks across the board** and the camera
> travels with it to its new plinth, which lights as it lands.

That last beat is doing real work: it is how both players learn where the next
one is without reading a HUD.

### Scoring

**Most Stars wins.** Tiebreak: coins. Then hub laps completed.

Match length stays the City model — **6 / 12 / 20 rounds**, reusing
`CITY_LENGTHS` and the existing picker.

## 10. Does the math work?

At Standard (12 rounds × 4 turns = 48 turns, 24 per player, average roll 3.5):

- **Travel per player per match:** ~84 spaces.
- **A Star cycle** (reach the live plinth from wherever you are, on average
  ~13–18 spaces): call it 15. → **~5 Stars of travel available**, before any
  detour for coins. Realistically **3–4 Stars each.** That is the right number:
  enough that no single Star decides it, few enough that each one is an event.
- **Coin income per player:** ~100 from tiles, plus minigame rewards, bounties
  and HQ-equivalents → **~150–200 per match**.
- **Cost of four Stars:** 20+25+30+35 = **110**, leaving 40–90 for the shop.
  Tight, which is exactly what makes the shop a real competitor for the same
  coins.
- **Shard lane:** 12 rounds → 12 minigame Shards distributed, plus duels. A
  player winning most minigames gets **2–3 free Stars**. Comparable to the coin
  lane, not dominant over it.

The numbers land where they should. They will still need play to confirm.

## 11. What is reused, and what is genuinely new

**Reused unchanged:** Director + SceneTiming · the whole space-type table ·
items · shops · buddies · duels · minigames · the Gate · toast queue · modal
tiers · tabletop double-render · junction arrows · map view · briefing pattern ·
district biome/dressing/lighting/landmark/overhead systems.

**New:**

| | Work |
|---|---|
| `config/maps/<id>.js` | graph (60 nodes), pools, branch options, biomes |
| Star state | live plinth, per-player stars & shards, price ladder |
| Star resolution | pass-through offer, purchase, relocation, shard redemption |
| Star set piece | `SetPieces.starClaim()` + the comet relocation |
| HUD readout | a star counter per player + "Star is at ▸ X" |
| Renderer layout | `buildCloverPositions()` + a scene builder |
| Bot | star-aware `_branchScore`, an "is the star worth chasing" term, a save-for-star rule in `shopBuy` |
| Win screen | star-based scoring, star-count chart series |
| Bounties | a small star-flavoured set (`buy_star`, `hold_shards`, …) with live emitters |
| `qa/<newmap>.js` | a probe in the house style |

## 12. Build sequence

Each phase ends somewhere playable, which is what keeps a long build honest.

| # | Phase | Ends with |
|---|---|---|
| 0 | **Map-module refactor** (§6, option B) — `ActiveMap` accessor, per-map layout hook, data-driven bot routing. No new content. | Both existing maps still pass the full probe suite |
| 1 | **The board exists** — graph, layout, pools, junctions. No Star. | You can walk a Clover lap; it plays as a City variant |
| 2 | **Dressing** — biomes, surfaces, props, lights, landmarks, overheads, arrival banners, briefing | It looks like a place |
| 3 | **The Star** — state, purchase, relocation, HUD, bot | The map is the map |
| 4 | **The set piece** — claim + comet relocation | It feels like the biggest moment on the board |
| 5 | **Scoring & polish** — win screen, chart, star bounties, `qa/` probe | Shippable |

Phase 0 is the one that will feel like it is not making progress. It is the one
that decides whether map four costs a week or a month.

## 13. Theme — two candidates

### ★ **Wild West** — the Sheriff's Star (recommended)

The `MAP_REGISTRY` stub already reserves it. The fit with existing systems is
unusually tight and is not a coincidence worth ignoring:

- The score object is literally a **star** — a sheriff's star. The pun is the
  mechanic.
- **Bounties** are already called Bounties. Wanted posters need no re-skin.
- **Duels** are already Duels, and **Quick Draw** is already a shipped minigame.
- **The Gate** becomes a canyon rockslide or a toll bridge.
- Petals: 🏜️ the Badlands · ⛏️ the Mine · 🚂 the Railyard · 🐎 the Ranch, around
  🤠 the Township hub. Four times of day, the way the City districts are four
  times of day.
- It is a third distinct era after fantasy (HBD) and modern city — good variety
  across the map-select screen.

### ✦ **Starfall Carnival**

A fairground built where a star fell. Hub is the Midway; petals are the
Menagerie, the Hall of Mirrors, the Fireworks Yard, the Big Top. Visually the
loudest option and the most obviously "Mario Party", with confetti and lights the
renderer already knows how to do (the Promenade's mote system is 90% of it).
Weaker thematic hooks for the existing bounty/duel/gate systems.

## 14. Risks, ranked

1. **Two-player star luck.** The whole of §9 is the answer, and it is unproven
   until played. **Watch this one first.** If after three matches the Star still
   feels like it goes to whoever rolled better, the next lever is making the
   plinth *contested* — arriving while the rival holds more Stars triggers a
   minigame for it rather than a purchase.
2. **Phase 0 lands in `GameController.js`**, which is 2171 lines and where every
   other feature also lives. Sequence it alone, with the probe suite green before
   and after, and do not stack content on top of a half-finished refactor.
3. **Match length inflation.** The Star set piece is 4–5 s and fires 6–8 times a
   match. Budgeted, but it is on top of City's existing eleven set pieces, and
   §11 of `TURN_FLOW.md` already flags "too many things stopping to be looked at"
   as an open play question.
4. **Sixty new nodes of dressing is the real art cost.** Phase 2 is bigger than
   it looks; the City district pass is the honest reference for how long.
5. **The hub ring becoming filler.** 12 nodes everybody crosses constantly. It
   needs to be the road where you meet, not the safe lap.

---

## 15. Verified vs. unverified

**Verified — read directly from source in this pass:**
- Every count in §1 (grep/node against the working tree at `8891dbd`).
- 47 `selectedMap` map-kind branches across 7 modules; 6 modules importing
  `BoardGraph.js` directly.
- `BoardGraph.js` holds 64 node definitions = 60 playable + 4 junctions, and 48
  randomised pool slots against 12 fixed squares.
- `Renderer.buildNodePositions()` hardcodes City geometry; there are exactly two
  layout paths in the file.
- `Bot._branchScore()` hardcodes City district keys.
- The design rules in §5 are quoted from `CITY_CIRCUIT_AUDIT.md`,
  `SPACE_REFERENCE.md`, `TURN_FLOW.md` and `DISTRICTS.md`, not inferred.

**NOT verified — nothing here has been built or played:**
- The balance math in §10 is arithmetic over documented averages, not measured
  play. Coin income in particular is an estimate from pool composition; it has
  not been sampled from real matches.
- The effort estimates in §6 are judgement, not a broken-down schedule.
- Whether the Clover reads as a board at the game's camera distance is a
  look-at-it question, unanswerable from source.
- Whether four levers is the right number to fix two-player star luck, or whether
  it over-corrects into a game where the Star never matters.

## 16. Open decisions

These fork the work, so they are worth settling before phase 0:

1. **Theme** — Wild West, Starfall Carnival, or something else.
2. **Star acquisition** — the model in §9, or a more contested one where reaching
   the plinth starts a minigame for the Star.
3. **Architecture** — (A) wedge into the City branch, or (B) map modules.
4. **Scoring** — Stars only with coins as tiebreak, or a blended score.
