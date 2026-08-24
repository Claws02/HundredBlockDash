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
   asserts FIRST, before any branch can return: camera is FOLLOW · the HUD
   is visible · no roll callout is left up
                            │
        ┌───────────────────┴───────────────────┐
        │ parked at a shut gate?  → §5          │
        │ last round, unannounced? → FINAL       │
        │   ROUND banner holds 3000 ms          │
        │ round's buddy news unread? → the      │
        │   BUDDY REPORT owns the screen and    │
        │   re-enters here when pressed         │
        └───────────────────┬───────────────────┘
                            │
   then: orientation faces the active player · the turn banner names them
   (TURN_BANNER 1700 ms, only when the turn actually changed hands)
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
                    ⏱ DICE_READ 1500 ms                   the number is legible
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
        │ what does this square OWE?             │            │
        │   _checkPassThroughShop() builds the   │            │
        │   list once — HQ · steal · buddy ·     │            │
        │   shop — and walks it with an index.   │            │
        │   ONE continuation; each step owns the │            │
        │   screen until it hands back. §2b      │            │
        │ is it the Gate, and closed?            │            │
        │   → bank the remaining steps, §5       │            │
        └───────────────────┬────────────────────┘            │
                            │  steps remaining ───────────────┘
                            ▼  steps == 0
                        _onLand()
                            │
        ┌───────────────────┴───────────────────┐
        │ rival on this node holding a Buddy?   │  → Buddy STEAL minigame
        │ a Buddy is waiting on this node?      │  → Buddy CLAIM minigame
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
| `DICE_READ` | 1500 ms | The number is on the table and readable **before** the token moves. 850 ms was not long enough. The beat now belongs to a full-screen ROLL CALLOUT — a 132 px digit with pips — which comes down the instant the token sets off. It was a line of toast on the rail, the same weight as "+3 coins", for a beat in which nothing else was happening. |
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
| `FINAL_ROUND` | 3000 ms | The last round announces itself. It does not wait for a press, but it does hold the beat — a three-second banner nobody has time to read is not an announcement. |
| `POST_MINIGAME` | 700 ms | The gap after its result closes. |

### 2b. What one square owes you

A single STEP of a move can owe up to four things, and they must happen in a
fixed order with none dropped:

```
   HQ  ──▶  STEAL  ──▶  BUDDY  ──▶  SHOP  ──▶  keep walking
   pays     rival on    buddy       offer to
   on the   this node   waiting     stop in
   way past holding     here
            a Buddy
```

`_checkPassThroughShop()` decides which of the four apply **once**, up front,
from the board as it is at that instant — so a buddy claimed by the steal step
cannot also fire the buddy step — then walks the list with an index. There is
exactly **one** continuation, and nothing else in the function may resume the
move or end the turn.

> **This was three nested closures.** Steal wrapped buddy wrapped shop, with the
> shop leg parking its continuation in a module-level slot
> (`_passThroughResumeHop`) and `closeShopModal()` deciding between "carry on
> walking" and "end the turn" by comparing one string flag. Any path that
> cleared or never set that flag closed the shop straight into `finishTurn()` —
> steps still owed, every later interruption on the square skipped. Reported as
> *"hit the store, the game glitched and went to the end of their turn and
> skipped over an ally."*
>
> The pending continuation is now the authority: **if one exists, the move is
> not finished, whatever any flag says.** `startPreRoll()` clears the slot, so a
> continuation from an abandoned move can never resume a walk that ended turns
> ago.

The same pass fixed a quieter one: the City shop offer never set
`state.pendingShopDistrict`, so entering it opened whatever district the last
shop visit had left behind.

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
| `duel` | +3 coin ante, faceoff, `⏱ DUEL_OPEN` 450 ms, then the bet picker → a minigame. If the *opponent* has nothing to stake there is no wager to set, so the picker shows a CONTINUE instead of five disabled buttons. |
| passing a rival who holds a Buddy | Suspends the move, offers the steal, and resumes the remaining steps whichever way it goes. See `docs/BUDDIES.md` §4. |
| passing the BUDDY SPACE itself | Same: suspends, offers the challenge, resumes. A buddy stands beside a tile and marks it for as long as they are there. |
| entering a district | Raises the district banner — icon, name, tagline. See `docs/DISTRICTS.md` §4. |
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
| **Buddy on your node** | after the last step, before `resolveSpace` | `resolveSpace` |
| **Rival holding a Buddy, landed on** | same | `resolveSpace` |
| **Rival holding a Buddy, passed** | mid-move, steps still owed | the remaining steps |
| **BOOST** | at `finishTurn` | `proceedTurn` for the *same* player; `totalTurns` is not incremented, so the minigame cadence is not skewed |
| **Forced move** (Rocket, Anchor, a −5) | at `resolveMsgModal` | moves, then resolves the new space — recursion, and it is the only place a turn can chain |
| **Round-end minigame** | at `finishTurn`, every N turns | `proceedTurn` for the winner |
| **Final round** | same | the win screen |

### Where a turn ends

```
                        finishTurn()
                            │
        totalTurns++ · Buddy clocks tick · history sampled
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

## 7. The set pieces

All of these live in `src/engine/SetPieces.js`, outside the renderer, because
they are content rather than engine — adding another should not mean touching
the render loop. Each one takes the camera by parking `state.cameraState` on
`CINEMATIC` (a mode the loop deliberately does not drive), and
`SetPieces.clearSetPieces()` restores the board from any of them mid-flight.

**The effect is applied to game state BEFORE the animation starts.** The
animation is a retelling, never the source of truth — so an interrupted set
piece can never cost anybody a coin or a position.

| Space | What happens | Budget |
|---|---|---:|
| 🛸 **SWAP ZONE** | The abduction, §6. | 5.85 s |
| 🔒 **THE GATE** | The gate shatters into shards and the camera passes through the gap. | 2.2 s |
| 🏛️ **DISTRICT HQ** | First visit only: a shaft of light out of the HQ, coins spiralling down out of it, camera craning up. A revisit is worth a third as much and gets a plain coin spray. | 1.9 s |
| 🧲 **MAGNET** | A field snaps on between the two tokens and coins physically fly out of the victim's tile into the thief's. | 1.6 s |
| 🎁 **MYSTERY** | A ribboned crate drops out of the sky, thuds, and the lid blows off in a burst — then the item card. | 1.5 s |
| ⚓ **ANCHOR** | The anchor falls from off-screen, thuds into the tile and digs in — *before* the drag, so it is clear why you are about to travel backwards. | 1.4 s |
| ⚔️ **DUEL** | Crossed sparks over the midpoint between the two tokens, low two-shot, then the bet picker. Free: the minigame follows either way. | 1.4 s |
| 🤝 **BUDDY ARRIVAL** | The camera swoops to the tile the Buddy landed on, a beacon pulses under it, and the round report names them — **and waits for a press**. Raised at the START of the round it belongs to, from `startPreRoll()`. See §5. | 1.3 s + a tap |
| 🕊️ **TRUCE** | A dove crosses between the two tokens as both counters tick up. | 1.0 s |
| 💸 **FINE / TRAP** | A red seal slams onto the tile and coins fall *through* the ground. A shielded hit still gets the seal but drops no coins. | 0.6 s |
| 🪙 **COIN / BIG COIN** | Coins pop out of the tile and arc away. | 0.55 s |
| 🏪 **SHOP** | The shopfront lights up before the modal, so the modal reads as being inside it. | 0.5 s |

**⚡ BOOST deliberately has none.** It fires often and already chains straight
into another roll; a launch cinematic there would be the third thing in a row
demanding attention on a turn that is not over yet.

### The buddy report is the one that WAITS

Every other set piece runs on a clock. This one stops until somebody presses it,
and the reason is a scheduling collision rather than a taste call.

A buddy spawns in `_onRoundEnd()` — which is called from `maybeTriggerMinigame()`
**immediately before** `PRE_MINIGAME` hands the screen to the minigame. The
announcement was a toast, so it appeared and was covered 1.1 s later. The player
was told a buddy existed, never saw where, and could not go and look because the
board had gone.

So `spawnAlly()` no longer announces anything. It sets `state.pendingAllyReveal`,
and `maybeTriggerMinigame()` runs `_afterAllyReveal()` before the hand-off: the
camera swoops to the tile, a beacon pulses under it, and a SHARED-tier card
reports the buddy situation. Both players are about to race for the same buddy,
so both need it — and the minigame does not start until somebody presses GOT IT.

The card sits on the active player's edge over a barely-dimmed board, and the
reveal camera aims *below* the buddy so the tile lands in the upper half of the
frame, clear of the card. A centred card over a blurred board would show you the
card instead of the thing it is about. `body.buddy-report` moves the toast rail
to the opposite edge while it is up, because round-end toasts fire in the same
beat and the report hugs the edge the rail normally sits on.

**It runs every round, not just on arrival.** The first version fired on the one
round a buddy spawned, so after that a buddy could sit on the board for the rest
of the match with nothing on screen saying so, and a held buddy could expire with
no warning. The report now covers who is on the board, where, how many rounds
before they leave, and what each player is holding with the clock on it. Full
detail in `docs/BUDDIES.md`.

**One exception:** the final round. A buddy landing then can never be claimed, so
the reveal is skipped and the marker cleared rather than stopping the match to
announce something nobody can use.

### The rule

**Frequency sets the budget.**

| How often | Budget | Must be skippable? |
|---|---|---|
| Once or twice a match (Gate, Swap, HQ first visit) | up to 6 s | no |
| A few times a match (Duel, Mystery, Magnet, Anchor) | 1.2–2 s | yes, on tap |
| Constantly (Coin, Fine, Truce, Shop) | under 0.6 s | must never gate the turn at all |

The bottom row is the important one: those four are fire-and-forget. They play
*alongside* the turn rather than holding it up, take no camera, and are not
waited on. Everything above them goes through `_playSetPiece`, which owns the
screen, hands the camera back and raises the card.

---

## 8. Notifications

Toasts had two problems and between them they made the board unwatchable:

1. `#toast-box` sat at `top: 50%; left: 50%` — **dead centre of the screen**,
   which is exactly where the token, the dice and the tile being moved toward
   all are. Up to five could stack there at once.
2. Nothing stopped one appearing mid-move. Passing an HQ, claiming a bounty and
   gaining a buddy all fire *during* the walk, so the board vanished behind a
   black pill at the precise moment the player was trying to watch it.

Three changes:

- **The rail moved to the active player's own edge** (bottom, or the top in
  tabletop on Player 2's turn), out of the middle half of the screen entirely.
  It steps aside again for a modal, and moves to the opposite edge during the
  gate scene, where the gate card owns the bottom.
- **Anything not urgent WAITS while the board is animating.** Toasts raised
  during `MOVING` or `ROLLING` are queued and released the moment the token
  lands — which is when the player is looking for them anyway. Nothing is lost;
  the queue is also flushed at the top of every turn so a line cannot be
  stranded by a scene that took an unusual exit.
- **Two at a time, not five**, at a smaller size.

`toast(msg, colour, { urgent: true })` bypasses the queue. That is for things
that are worthless after the fact rather than merely late:

| Urgent | Why |
|---|---|
| **"Rolled a N!"** | `gameState` is `ROLLING` when the dice settle, so the queue held the number back until the token had already arrived — the player was told what they rolled *after* it had been spent. This is the one the whole queue must not touch. |
| **"Cursed Die forces a bad roll!"** | It explains the roll that is about to happen. |
| **Shield / Bodyguard absorbed it** | It explains why a fine cost nothing. |
| **The gate breaking** | It is the cue for the set piece already playing. |

Everything else — HQ pass-through bonuses, bounty claims, buddy arrivals, item
pickups — waits. Those are all *reports*, and a report is just as true a second
later.

> This is the trap the queue sets, and it caught the roll callout the day it was
> written. Ask of every new toast: **is this still worth reading once the thing
> it describes is over?** If not, it is urgent.

---

## 9. The gate

The gate overlay was `rgba(0, 0, 0, .95)` across the whole screen: **you rolled
to break through a gate you could not see.** It is now a transparent layer with
a compact card on the active player's edge, and the camera is put on the gate
itself (`Renderer.focusOnGate`) for the duration.

`#ui-layer` stays hidden for the whole gate scene, which is what makes items,
the map and the ordinary roll unavailable there — the only control on screen is
the gate's own button. `executeUseItem` also refuses outright while
`gameState === 'GATE'`, so that guarantee does not depend on a display property.
The card says so out loud: *"No items at the gate — the roll is all you have."*

---

## 10. Verified

`qa/pacing.js` — **38/38**, zero page errors.

- **Order**: the tile names itself 585 ms before the coins move; the effect
  fires before the result card; the effect still actually fires.
- **The roll**: driving a real `executeRoll`, the number is on screen 1.7 s
  before the token's first movement. Removing the `urgent` flag makes all three
  of those assertions fail — the callout never appears at all, because the queue
  holds it until after the move.
- **Junction**: closest approach to the fork node 0.51 units (it goes through
  it); the camera is 34.6 units from the token when the walk starts.
- **Swap**: saucer, beam, 235 units of camera travel, a token carried out of
  sight, both ending on each other's nodes, the card raised, the camera handed
  back, both tokens visible at full scale — and a deliberately corrupted state
  recovered by `endSwapCinematic()`.
- **Toasts**: nothing shown during `MOVING`, two queued, an urgent one still
  gets through, the queue released on landing, the rail measured clear of the
  middle half of the screen, at most two stacked.
- **Gate**: shown, background `rgba(0,0,0,0)` (not blacked out), the layer takes
  no pointer events, `cameraState === 'GATE'`, the card hugs an edge, the bag is
  unreachable, `executeUseItem` refuses, and the toast rail does not overlap the
  card.
- **Breach**: shards appear (753 → 768 meshes) and every one is cleaned up.
- **Cleanup**: nine set pieces run back to back leave the scene graph at exactly
  753 meshes.

**Regression-proofed.** Reverting the junction and ordering fixes in place makes
four assertions fail; restoring them makes all of them pass.

## 11. Not verified

- **The feel of eleven set pieces in one match.** Each is inside its budget on
  paper, but whether a City match now has too many things stopping to be looked
  at is a play question. The four cheap ones do not gate the turn, so the honest
  risk is the middle tier — Duel, Mystery, Magnet, Anchor — stacking up.
- **The gate camera on every approach.** It frames from the direction of travel,
  which is right on the Industrial Zone entrance and on HBD's Rift; it has only
  been checked on the City gate.
- **Set-piece timings on real hardware.** The animation clock is capped per
  frame, so everything here measures roughly twice its nominal length in this
  container.
