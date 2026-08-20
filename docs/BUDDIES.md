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
| `ALLY_TURNS` | 3 | Turns a held buddy lasts — **your** turns, not rounds. |
| `BUDDY_MAP_ROUNDS` | 3 | Rounds an unclaimed board buddy waits before leaving. |
| `ALLY_SPAWN_DELAY_TURNS` | 2 | Gap before the next one appears. |

**`BUDDY_MAP_ROUNDS` is new.** `spawnAlly()` only ran when the board was empty
and nothing ever cleared an unclaimed buddy, so a board buddy was *permanent*.
"How long until it goes away" had no answer, and ignoring one cost nothing.

---

## 3. The round report

Fires from `_afterAllyReveal()` once per round, before the minigame takes the
screen, and holds the hand-off until somebody presses through. It is a **SHARED**
DualRead card — both players are about to race for the same buddy.

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

`body.buddy-report` moves the toast rail to the opposite edge while it is up —
the report hugs the same edge the rail lives on, and round-end toasts (Banker
interest, a departure) fire in the same beat.

---

## 4. Stealing

Two ways in, both ending in a minigame against the holder:

| Trigger | Where | Notes |
|---|---|---|
| **Landing** on the holder's square | `_onLand()` | The original route. |
| **Passing** the holder's square | `_checkPassThroughShop()` | New. Fires while steps remain; declining resumes the move. |

The landing-only version needed an exact stop on one node in sixty, on a turn the
rival happened to be holding something. It existed on paper and almost never in a
match. Passing them is the same encounter and happens often enough to make
holding a buddy a position worth defending.

The pass-by check runs on the same per-step hook as the District HQ payout and
the shop offer, and chains ahead of the shop: HQ pays, then the steal is offered,
then the shop. A steal minigame suspends the move and `onDone` resumes it with
the steps still owed.

---

## 5. What the probe covers

`qa/buddy.js` — 25 assertions:

- every power does what its card says, including the Bodyguard against both a
  fine and an Anchor
- the report names the buddy, the place, the countdown and the held list, and
  changes wording on the last round
- an unclaimed buddy's countdown ticks and it actually leaves
- passing a rival offers the steal, and declining resumes the move
- no player-facing string in `ALLIES`, `CONTRACT_POOL`, `MAP_REGISTRY` or the
  buddy screens still says "ally"
- a round-end toast does not land on the report card

```bash
npx http-server -p 8129 -c-1 &
node qa/buddy.js
```
