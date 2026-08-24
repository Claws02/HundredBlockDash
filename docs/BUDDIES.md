# Buddies

City Circuit only. A buddy is a temporary passive that turns up on the board,
gets fought over, and expires. This is the reference for what each one does,
what the lifecycle is, and which promises the code actually keeps.

> **Naming.** Players read "Buddy". The code says `ally` — `state.allyOnMap`,
> `player.allies`, `ALLIES`, `#ally-arrival`, `_grantAlly`. That split is
> deliberate: renaming ~40 identifiers and half a dozen DOM ids buys the player
> nothing and breaks every probe that reads them. `qa/buddy.js` asserts that no
> string a player can see still says "ally".

---

## 1. The roster

Each `desc` in `ALLIES` (`src/config/GameConfig.js`) is a **promise to the
player**, and `qa/buddy.js` checks the code keeps it.

| | Buddy | Power | Where it lives in code |
|---|---|---|---|
| 🚕 | **The Cabbie** | Once per round, ride to any junction — change districts for free. | `activateCabbie()` — an active button in the HUD |
| 🌮 | **Street Vendor** | +2 extra coins every time you land on a coin space. | `_allyPassive(p,'coin_bonus')`, read by `coin` and `coin_big` |
| 💼 | **The Banker** | At each round end, collect 1 coin for every 10 you are holding. | `_onRoundEnd()` |
| 🦺 | **The Bodyguard** | Blocks your next 3 hits — coin losses and Anchor traps alike. | `loseCoins()` and `_spendBodyguard()` |
| 📈 | **The Investor** | The first Bounty you claim each round pays double. | `_claimContract()` in `Contracts.js` |

### What the audit found

Four of the five did what they said. One did not:

**The Bodyguard.** The card read *"absorbs your next 3 negative space effects"*,
and the implementation lived entirely inside `loseCoins()`. So it stopped fines,
traps and being magnet-robbed — and did nothing whatsoever about an **Anchor**
dragging you back five spaces, which is the board effect people most expect a
bodyguard to handle. Fixed at the source rather than by shrinking the promise:
`_spendBodyguard()` is now a hook any board effect can call, `anchor_trap` calls
it, and the card names both cases.

Everything else checked out, including two that only *look* unimplemented:

- **The Investor** is keyed on `a.type === 'investor'` inside `Contracts.js`, not
  on its `powerType`. Grepping for `contract_x2` finds only the config and
  suggests a no-op. It works, and `state.investorUsedThisRound` is reset at the
  top of `_resolveMinigameResult`.
- **The Cabbie** used to set `p.pos = junctionId` and only correct it in the
  hop's callback. A junction is a fork with **no board tile**, so anything
  reading the position mid-hop found a space that cannot resolve. It now lands
  on the first real node past the fork and never occupies the fork at all.

---

## 2. The lifecycle

```
        ┌──────────── round end ────────────┐
        │                                   │
   spawnAlly()                        _onRoundEnd()
   ├─ pick a type at random           ├─ Banker interest
   ├─ pick an unoccupied, non-gate    ├─ tick allyOnMap.roundsLeft
   │  node from ALL_NODES_ORDERED     ├─ at 0 → remove marker, note the
   ├─ roundsLeft = BUDDY_MAP_ROUNDS   │        departure, reschedule
   └─ pendingAllyReveal set           └─ spawn a new one if the board is empty
        │
        ▼
   _afterAllyReveal()  ── the BUDDY REPORT, once per round, waits for a press
        │
        ▼
   claim (land on it, win the minigame)  ── turnsRemaining = ALLY_TURNS
   or steal (pass or land on the holder, win the minigame) ── inherits their clock
        │
        ▼
   _tickAllyTurns(activePlayer) once per that player's turn → expireAlly() at 0
```

| Constant | Value | Meaning |
|---|---:|---|
| `MAX_ALLIES` | 2 | Slots per player. A third replaces the oldest. |
| `BUDDY_NEAR_STEPS` | 20 | Preferred spawn distance from a player, in real board steps. |
| `BUDDY_MAX_STEPS` | 36 | Hard limit — six maximum rolls. |
| `ALLY_TURNS` | 3 | Turns a held buddy lasts — **your** turns, not rounds. |
| `BUDDY_MAP_ROUNDS` | 3 | Rounds an unclaimed board buddy waits before leaving. |
| `ALLY_SPAWN_DELAY_TURNS` | 2 | Gap before the next one appears. |

### Where a buddy is allowed to land

`spawnAlly()` used to pick uniformly from all 60 nodes, so most spawns landed
most of a circuit away. The report said where they were, the countdown said three
rounds, and those two facts did not fit together — the buddy was information
rather than an opportunity.

Placement is now measured with `stepsFrom(nodeId)`: a real forward walk through
the graph taking **both** roads at every junction. A lap-order index difference
is not the same thing — the districts branch, so "twelve along the flat list" can
be a road the player would have to choose and then walk, or one they cannot reach
this lap at all. (`stepsFrom('r1').fin_0` is **24**, not 5.)

Two tiers, falling back rather than off a cliff: prefer nodes within
`BUDDY_NEAR_STEPS` of either player, else within `BUDDY_MAX_STEPS`, else anywhere.
Measured over 60 spawns from a spread of starting pairs: **60/60 within 20 steps,
median 10, maximum 20**.

**`BUDDY_MAP_ROUNDS` is new.** `spawnAlly()` only ran when the board was empty
and nothing ever cleared an unclaimed buddy, so a board buddy was *permanent*.
"How long until it goes away" had no answer, and ignoring one cost nothing.

---

## 3. The round report

Fires from the top of `startPreRoll()` on the **first turn of each round**,
before `PRE_ROLL` is entered so no roll control can appear behind it, and hands
control back through its own callback. It is a **SHARED** DualRead card — both
players are about to race for the same buddy.

> **It used to open at the wrong end of the round.** The card was raised in
> `maybeTriggerMinigame()` at the CLOSE of a round, holding the minigame back.
> That put news about the next round in front of the payoff for the one just
> finished, four board turns before anybody could act on it — and by the time
> the next player actually rolled, it was long forgotten. A buddy spawning at
> the end of round one is now announced at the start of round two.

It says, in this order:

1. **Who is on the board** — icon, name and the full power text.
2. **Where** — "Waiting near the Back Alley." The camera swoops to the tile on
   the round it first appears, so the sentence is backed by seeing it.
3. **How long** — "Leaves in 3 rounds if nobody claims them", switching to
   "Leaves at the end of this round — last chance." at one.
4. **Who holds what** — a chip per held buddy with turns left, and blocks left
   for the Bodyguard. This half was previously visible only as a two-character
   badge in the HUD.

If no buddy is on the board it still runs when somebody is holding one, or to
report that an unclaimed buddy gave up waiting.

It began as an arrival-only card, which fired on exactly one round per buddy.
After that a buddy could sit on the board for the rest of a match with nothing on
screen saying so, and a buddy at your side could expire with no warning.

`_buddyRemindedRound` latches the round number, so the report fires exactly once
per round however many times `startPreRoll()` is called.

`body.buddy-report` moves the toast rail to the opposite edge while it is up —
the report hugs the same edge the rail lives on, and round-end toasts (Banker
interest, a departure) fire in the same beat.

---

## 3b. The buddy space

A buddy does not stand **on** a tile — they stand **beside** one, `BUDDY_STAND_OFF`
(2.6 units) out from it, facing the road. The tile they are next to becomes the
**BUDDY SPACE** for as long as they are there:

- a pulsing gold pad and rim on the tile itself
- a short walkway from the tile to the figure, so it is unambiguous *which*
  square the buddy belongs to
- `🤝 BUDDY SPACE · <name>` above the tile's own name in the map tooltip

The tile keeps whatever type it already had. The buddy is an encounter attached
to the square, not a replacement for it — land on a buddy space that is also a
coin space and you get both.

Standing the model *on* the tile put it exactly where a player token lands, so
the two occupied one square and the buddy read as scenery.

---

## 4. Claiming and stealing

Three ways in, all ending in a minigame:

| Trigger | Where | Notes |
|---|---|---|
| **Landing** on the buddy space | `_onLand()` | The original route. |
| **Passing** the buddy space | `_checkPassThroughShop()` | Fires while steps remain; declining resumes the move. |
| **Passing or landing on** a rival who holds one | `_checkPassThroughShop()` / `_onLand()` | The steal. |

Both landing-only versions needed an exact stop on one node in sixty, in the
handful of rounds a buddy is out there. The report told you where the buddy was
and then the dice decided whether you were allowed to go. Passing is the same
encounter and happens often enough to be a real decision — and it is what makes
holding a buddy a position worth defending.

The pass-by checks run on the same per-step hook as the District HQ payout and
the shop offer, and chain ahead of the shop: HQ pays, then the steal, then the
buddy claim, then the shop. A minigame suspends the move and `onDone` resumes it
with the steps still owed.

---

## 5. What the probe covers

`qa/buddy.js` — 25 assertions:

- every power does what its card says, including the Bodyguard against both a
  fine and an Anchor
- the report names the buddy, the place, the countdown and the held list, and
  changes wording on the last round
- an unclaimed buddy's countdown ticks and it actually leaves
- passing a rival offers the steal, and declining resumes the move
- passing the buddy space itself offers the claim
- the report opens the round rather than closing the last one, nothing can be
  rolled behind it, pressing through hands the turn back, and it fires once
- 60 sampled spawns all land inside the reachable band, never on a player
- no player-facing string in `ALLIES`, `CONTRACT_POOL`, `MAP_REGISTRY` or the
  buddy screens still says "ally"
- a round-end toast does not land on the report card

```bash
npx http-server -p 8129 -c-1 &
node qa/buddy.js
```
