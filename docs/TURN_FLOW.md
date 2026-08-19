# The anatomy of a turn

**Date:** 2026-08-19
**Scope:** both boards. Where they differ it is called out.
**Why this exists:** the game had no written statement of what a turn *is*, so
every new feature was bolted onto whichever function looked closest and the
ordering drifted. Two of the three defects fixed in this pass were ordering
bugs, not logic bugs — the right things happened in the wrong sequence.

---

## 1. The rule the whole thing runs on

> **A beat owns the screen until its floor has elapsed. The next beat cannot
> start early. It can only start late.**

That is `src/core/Director.js`, and it is the only pacing mechanism in the game.
Every floor lives in `src/config/SceneTiming.js` as a named constant. Nothing
should ever pace itself with a bare `setTimeout` again — a beat scheduled that
way cannot be cancelled on rematch and cannot be measured by `qa/scenes.js`.

Three calls, and the difference matters:

| Call | Meaning |
|---|---|
| `Director.hold(name, fn)` | Start this beat **now** and run `fn` after its full floor. Use when the beat begins at this instant. |
| `Director.after(name, fn)` | Run `fn` once the beat that already began has had its floor. Time already spent counts. |
| `Director.begin(name)` | Mark a beat as started without scheduling anything — for beats ended by a player's tap. |

`Director.ack()` compresses whatever is left of the current floor to 34 %
(`ACK_SKIP`) when a human explicitly taps through, so an eager player keeps
moving without two scenes rendering on top of each other.

---

## 2. One turn, start to finish

Read this as a pipeline. Every arrow is a beat with a floor; every branch is a
place a turn can go somewhere else.

```
                      proceedTurn()
                            │
        ┌───────────────────┴───────────────────┐
        │ pass-and-play, and not a re-roll?     │
        │   → PASS_PROMPT: "hand the device to  │
        │     <name>" and wait for I'M READY    │
        └───────────────────┬───────────────────┘
                            ▼
                      startPreRoll()                     ── state: PRE_ROLL
                            │
   asserts: camera is FOLLOW · the HUD is visible · orientation faces
   the active player · the turn banner names them (TURN_BANNER 1700 ms,
   only when the turn actually changed hands)
                            │
        ┌───────────────────┴──────────────────────────────┐
        │ human: swipe zone + action row (ROLL / MAP /     │
        │        ITEMS / BOUNTIES / CAB)                   │
        │ bot:   BOT_THINK.PRE_ROLL 1200 ms, then maybe    │
        │        an item, then rolls                       │
        └───────────────────┬──────────────────────────────┘
                            ▼
                       executeRoll()                      ── state: ROLLING
                            │
   dice are thrown into the physics world, away from the camera
                            │
                     Physics.onSettle
                            ▼
                    ⏱ DICE_READ  850 ms                   the number is legible
                            │                              before anything moves
                            ▼
              moveThroughGraph() / _movePlayerHBD()        ── state: MOVING
                            │
        ┌───────────────────┴───────────────────┐
        │  per step, hop the token one node     │◀────────────┐
        └───────────────────┬───────────────────┘             │
                            │                                 │
        ┌───────────────────┴────────────────────┐            │
        │ is the NEXT node a junction? (City)    │            │
        │   → §3 The fork                        │            │
        │ is it a shop, with steps left?         │            │
        │   → ⏱ PASSTHROUGH 320 ms, offer to     │            │
        │     stop in; resume the hop after      │            │
        │ is it an HQ, with steps left?          │            │
        │   → pays the pass-through bonus, toast │            │
        │ is it the Gate, and closed?            │            │
        │   → bank the remaining steps, §5       │            │
        └───────────────────┬────────────────────┘            │
                            │  steps remaining ───────────────┘
                            ▼  steps == 0
                        _onLand()
                            │
        ┌───────────────────┴───────────────────┐
        │ opponent on this node with an ally?   │  → ally STEAL minigame
        │ an ally is waiting on this node?      │  → ally CLAIM minigame
        └───────────────────┬───────────────────┘
                            ▼
                      resolveSpace()                       ── state: ACKNOWLEDGE
                            │
                            ▼  §4 The landing
```

### The floors, in the order you meet them

| Beat | Floor | What it protects |
|---|---:|---|
| `ROLL_LAUNCH` | 220 ms | The gap between committing and the dice leaving the hand. |
| `DICE_READ` | 850 ms | The number is on the table and readable before the token moves. |
| `PASSTHROUGH` | 320 ms | The shop prompt does not collide with the hop that triggered it. |
| `JUNCTION_COMMIT` | 620 ms | **§3** — the camera turns down the chosen road before the walk starts. |
| `LAND_ARRIVE` | 500 ms | **§4** — you see *where* you are before anything is done to you. |
| `LAND_SETTLE` | 420 ms | The effect has fired; a beat before the card explains it. |
| `LAND_RESULT` | 3000 ms | The result card owns the screen. Nothing may start under it. |
| `BOT_RESULT` | 3000 ms | Same window for the opponent's turn — you should be able to read what they got. |
| `BOOST_RESULT` | 3400 ms | A boost chains into another roll, so it gets more air. |
| `POST_RESULT` | 650 ms | The board on its own before the turn moves on. |
| `TURN_HANDOFF` | 600 ms | Long enough to notice the turn changing hands. |
| `PRE_MINIGAME` | 1100 ms | The gap before a minigame takes the screen. |
| `POST_MINIGAME` | 700 ms | The gap after its result closes. |

---

## 3. The fork

City Circuit only. The one moment in a match where the player makes a routing
decision, and the one that used to read worst.

```
 token is one step from an invisible junction node (bp_a … bp_d)
                            │
                            ▼
                  _offerBranchChoice()
                            │
        ┌───────────────────┴───────────────────┐
        │ bot:   BOT_THINK.BRANCH 600 ms, picks │
        │ human: arrows over the board          │
        │        · camera lifts to 58 units and │
        │          pulls back along the approach│
        │        · one arrow per road, anchored │
        │          three nodes in               │
        │        · SCOUT THE MAP → map view →   │
        │          returns HERE, choice open    │
        └───────────────────┬───────────────────┘
                            ▼
                    onBranchChosen()
                            │
              camera → FOLLOW, aimed down the chosen road
                            │
                  ⏱ JUNCTION_COMMIT 620 ms          the shot arrives first
                            │
                            ▼
              hop 1: token → the fork node itself
              hop 2: fork → first node of the chosen road
                            │
                            ▼
                 continue the remaining steps
```

**What was wrong.** It was one `animatePlayerHop` straight from the node before
the fork to the first node of the chosen road — the fork itself was skipped, and
that leg is up to 26 world units against about 10 for an ordinary step, covered
in the same fixed 0.35 s. Meanwhile the camera was still travelling down from
the junction's overhead shot. The player was somewhere else before the view
caught up, and the space they landed on resolved before they saw it.

**Three changes fixed it:**

1. `JUNCTION_COMMIT` — the camera is turned down the chosen road
   (`Renderer.aimAlongRoad`) and handed back to `FOLLOW` *before* the token
   moves, so the shot is already right when the walk starts.
2. The walk goes **through** the fork: two hops for the one board step. The fork
   is a real position on the ring even though nobody can stand on it, and
   travelling through it is what makes a route choice look like a turn.
3. Hop duration is derived from distance rather than fixed, so the long leg out
   to a district takes proportionally longer and the token's ground speed stays
   constant.

`player.pos` is deliberately never parked on the fork — no board tile exists
there, and anything reading the position mid-animation would find a space that
cannot resolve.

---

## 4. The landing

Three beats, and **the order is the whole point**.

```
                      resolveSpace()
                            │
   ┌────────────────────────┴────────────────────────┐
   │ ARRIVE                                          │
   │   the token is down, the camera is on it        │
   │   the tile names itself (space info card)       │
   │   NOTHING has happened to the player yet        │
   │                              ⏱ LAND_ARRIVE 500ms│
   └────────────────────────┬────────────────────────┘
                            ▼
   ┌─────────────────────────────────────────────────┐
   │ RESOLVE                                         │
   │   resolveSpaceEffect() — coins move, items are  │
   │   granted, positions change, contracts fire     │
   │   sfx: land_good / land_bad                     │
   │                              ⏱ LAND_SETTLE 420ms│
   └────────────────────────┬────────────────────────┘
                            ▼
   ┌─────────────────────────────────────────────────┐
   │ RESULT                                          │
   │   the card, OWNER tier: full card for the       │
   │   player, headline strip on the opponent's edge │
   │   human: waits for CONTINUE (floor still holds) │
   │   bot:   BOT_RESULT is the whole window         │
   │                             ⏱ LAND_RESULT 3000ms│
   └────────────────────────┬────────────────────────┘
                            ▼
                    resolveMsgModal()
                            │
        ┌───────────────────┴───────────────────┐
        │ a forced move is pending?             │
        │   → ⏱ POST_RESULT, then move, then    │
        │     resolve the new space (recurses)  │
        └───────────────────┬───────────────────┘
                            ▼
                  ⏱ POST_RESULT 650 ms
                            ▼
                        finishTurn()
```

**What was wrong.** `resolveSpaceEffect()` was called at the *top* of
`resolveSpace()`, before any beat: the coin counter moved, the HUD updated and
the item landed in the bag while the token was still mid-hop and — after a fork
— while the camera was still travelling. You were told what had happened before
you could see where you were. Measured: the tile card and the coin change landed
in the **same 25 ms sample**. It is now a 585 ms gap.

### Effects that take the screen for themselves

`resolveSpaceEffect` returns `null` to mean *"I am driving the rest of this
turn; do not raise a card."* Four do:

| Space | What it does instead |
|---|---|
| `shop` | `⏱ SHOP_OPEN` 400 ms, then the shop modal. Closing it ends the turn. |
| `duel` | `⏱ DUEL_OPEN` 450 ms, then the bet picker → a minigame. |
| `swap_space` | §6, the abduction. Raises its own SHARED-tier card when the saucer has gone. |
| `mystery` with a full bag | Hands the beat to the discard picker, which names the item itself. |

---

## 5. The branches a turn can take

Everything below interrupts the pipeline and returns to it. They are listed with
where they cut in, because that is what makes them composable rather than
special cases.

| Event | Cuts in at | Returns to |
|---|---|---|
| **Pass-and-play hand-off** | before `startPreRoll` | `startPreRoll` on I'M READY |
| **Item used pre-roll** | during `PRE_ROLL` | `PRE_ROLL`, roll still owed — except Rocket and Custom Dice, which *are* the move |
| **Cabbie teleport** | during `PRE_ROLL` | `PRE_ROLL`, roll still owed |
| **Fork** | mid-move | the move, §3 |
| **Pass-through shop** | mid-move | the move, after the shop closes |
| **Pass-through HQ** | mid-move | the move, immediately (toast only) |
| **The Gate, closed** | mid-move | banks the remaining steps; a successful roll spends them, a failed one forfeits them |
| **Ally on your node** | after the last step, before `resolveSpace` | `resolveSpace` |
| **Opponent's ally on your node** | same | `resolveSpace` |
| **BOOST** | at `finishTurn` | `proceedTurn` for the *same* player; `totalTurns` is not incremented, so the minigame cadence is not skewed |
| **Forced move** (Rocket, Anchor, a −5) | at `resolveMsgModal` | moves, then resolves the new space — recursion, and it is the only place a turn can chain |
| **Round-end minigame** | at `finishTurn`, every N turns | `proceedTurn` for the winner |
| **Final round** | same | the win screen |

### Where a turn ends

```
                        finishTurn()
                            │
        totalTurns++ · ally clocks tick · history sampled
                            │
        ┌───────────────────┴───────────────────┐
        │ BOOST pending? → same player rolls    │
        │   again (totalTurns NOT counted twice)│
        └───────────────────┬───────────────────┘
                            ▼
                activePlayer flips
                            ▼
                  maybeTriggerMinigame()
                            │
        ┌───────────────────┴───────────────────┐
        │ every MINIGAME_EVERY_N_TURNS:         │
        │   City: round++, round-end scoring,   │
        │         last round → win screen       │
        │   ⏱ PRE_MINIGAME 1100 ms → minigame   │
        │ otherwise:                            │
        │   ⏱ TURN_HANDOFF 600 ms → proceedTurn │
        └───────────────────────────────────────┘
```

---

## 6. Set pieces

A set piece is an event important enough that the camera stops following the
player and watches it instead. The contract is the same for all of them:

1. take `state.cameraState` (a mode the render loop does **not** drive, so the
   set piece owns the camera outright);
2. block input by parking `state.gameState` somewhere that is not `PRE_ROLL`;
3. on completion, put the board back into a consistent state **whatever
   happened**, hand the camera back, and only then raise a card;
4. expose a teardown that can be called by anything that interrupts — a
   half-finished cinematic must never leave a token invisible or scaled to zero.

`Renderer.endSwapCinematic()` is the reference implementation of (3) and (4).

### SWAP ZONE — the abduction *(implemented)*

```
 1. a saucer drops out of the sky over whoever landed on the tile   0.70 s
 2. tractor beam: they rise into the light and vanish               0.65 s
 3. it flies to the opponent, the camera travelling with it         1.15 s
 4. it sets the first player down there                             0.55 s
 5. it beams the opponent up                                        0.65 s
 6. it flies back, again with the camera                            1.15 s
 7. it sets them down on the tile the first player came from        0.55 s
 8. the saucer leaves                                               0.45 s
                                                            ────────────────
                                                                    5.85 s
```

The camera rides *beside* the saucer, not above it — looking down hides the beam
inside the hull's own silhouette and hides whoever is in it. The side is chosen
perpendicular to the flight path, on whichever side faces the middle of the
board, because a fixed world-space offset puts the camera inside a building on
whichever part of the board happens to have one there.

The state swap happens **immediately** (so the rules are consistent from that
instant) and only the *meshes* are handed to the cinematic. The SWAP ZONE space
and the Swap item share it: they are the same event and should not look like two
different ones. The difference is only what happens afterwards — the space
raises a result card, the item hands back to `PRE_ROLL` with the roll still owed.

---

## 7. Set pieces worth building next — suggestions only

Ranked by *how often you see it × how much the current version undersells it*.
None of these are implemented.

### Tier 1 — the ones that pay back most

**⚡ BOOST — the launch pad.** You currently get a toast and another roll. It is
one of the best things on the board and it looks like nothing. Suggestion: the
tile flips up into a ramp under the token, the camera drops to ground level
behind them, and the token is fired forward with a speed-line blur — landing
back on the same tile as the dice respawn. ~1.6 s. Cheap, because it is one
animation and no travel.

**⚔️ DUEL — the face-off.** The bet picker appears with no staging at all.
Suggestion: the camera swings to a low two-shot with both tokens facing each
other across the tile, coins piling up between them as the bet is chosen, and
whips into the minigame on confirm. This one is nearly free: the minigame
already follows, so the cinematic is pure lead-in and can be skipped by a tap.

**🏛️ DISTRICT HQ — the payout.** The single biggest coin event in the game
(+15 first visit) is a toast. Suggestion: the camera cranes up to take in the HQ
building as coins spiral out of it and stream into the HUD counter. Reuse the
existing coin-particle system, aimed at the counter it already targets. ~1.8 s.

### Tier 2 — good, more work

**🧲 MAGNET — the pull.** Coins should visibly *leave* the opponent's counter and
fly across the board into yours, with a magnet field warping between the two
tokens. The satisfying part is watching the other player's number go down.

**🔒 THE GATE — the breach.** The gate has a whole overlay already, but the moment
it opens is a modal. Suggestion: cut to the gate itself, have it shatter or grind
open, and let the camera pass *through* it as the banked steps resume. This is
the only permanent change to the board in a match; it deserves to be seen once.

**⚓ ANCHOR — the trap springing.** An anchor should thud down from off-screen and
drag the token back along the road it came from, rather than the token simply
appearing five spaces earlier. This one also fixes a comprehension problem: it
is currently hard to tell *why* you moved backwards.

**🎁 MYSTERY — the unboxing.** A crate lands on the tile and cracks open with the
item rising out of it, then the card. The item card already exists, so this is
a 1.2 s lead-in.

### Tier 3 — flavour, cheap to add

- **🪙 / 💰 COIN** — coins pop out of the tile and arc into the counter rather
  than the number simply changing. This one fires constantly, so it must stay
  under ~0.6 s and must never gate the turn.
- **💸 FINE** — the tile stamps a red seal, the token flinches, coins fall out
  and sink through the ground.
- **🕊️ TRUCE** — a dove crosses between the two tokens and both counters tick up
  together. The only shared-good event on the board and it should feel like one.
- **🏪 SHOP** — the shopfront lights up and the camera pushes in to the door
  before the modal, so the modal reads as being *inside* it.

### The rule I would apply to all of them

**Frequency sets the budget.** A tile you land on once a match can afford six
seconds; one you land on every third turn cannot afford one. Concretely:

| How often | Budget | Must be skippable? |
|---|---|---|
| Once or twice a match (Gate, Swap, HQ first visit) | up to 6 s | no |
| A few times a match (Duel, Mystery, Magnet, Boost) | 1.2–2 s | yes, on tap |
| Constantly (Coin, Fine) | under 0.6 s | must never gate the turn at all |

And every one of them goes through the Director with a named floor in
`SceneTiming.js`. A set piece paced with a bare `setTimeout` cannot be cancelled
on rematch, cannot be measured by `qa/scenes.js`, and will eventually overlap
something.

---

## 8. Verified

`qa/pacing.js` — **19/19**. It asserts order, not appearance:

- the tile names itself **before** the coins move (585 ms gap; it was 0 ms);
- the token's closest approach to the fork node is 0.51 units, i.e. it goes
  through it (it was 8.35 — it cut the corner);
- the camera is 34.6 units from the token when the walk begins (it was 48.2);
- the saucer appears, the beam lights, the camera moves 238 units with it, a
  token is carried out of sight, both end on each other's nodes, the card is
  raised, the camera is handed back, and both tokens are left visible at full
  scale;
- `endSwapCinematic()` recovers a deliberately corrupted state.

**Regression-proofed.** Reverting both fixes in place makes four of those
assertions fail and restoring them makes all nineteen pass.

One assertion is weaker than it looks and is labelled as such in the file: the
ground-speed bound does **not** catch the teleport. Under software GL the frame
delta is capped, so a short-duration animation is stretched in wall clock and
measures *slower*; reverting the fix makes that number go **down**. The
fork-proximity check is the one that does the work.

## 9. Not verified

- **The feel of the new floors.** `JUNCTION_COMMIT` at 620 ms and `LAND_ARRIVE`
  at 500 ms add roughly a second to every turn that goes through a fork. That is
  the right trade on paper; whether a match now feels stately or slow is a
  play question.
- **The swap cinematic's length.** 5.85 s nominal. In this container it measures
  about twice that, because the animation clock is capped per frame and the
  renderer is slow — the real figure needs a real device.
- **Whether the side-on camera clears scenery everywhere.** It is aimed at the
  middle of the board, which is open on both maps, but it has only been checked
  on the ring.
