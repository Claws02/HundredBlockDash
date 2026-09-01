# The categories — what a 3- and 4-player minigame can be

**Status: analysis for a decision, not built.** The roster and the code still do
what `MINIGAME_RULEBOOK.md` §11 describes. This document is the baseline to
decide against.

**The rule that changes everything:**

> **Everybody plays at the same time. Nobody waits.**

That is a stronger rule than "everybody plays", and it retires two things this
repo has already built:

- **The bracket is out.** Three legs means two people playing and two watching
  for two thirds of the round.
- **The relay is out.** One player at a time on the whole screen means three
  people watching, which is the same problem wearing better clothes.

Both survive only as a **2-player** shape, where "everyone at once" and "take
turns" are the same thing.

---

## 1. What the genre actually does, and the one thing it has in common

The reference is [1 2 3 4 Player Games](https://apps.apple.com/us/app/1-2-3-4-player-games/id1635978552)
(Moreno Maio) and the collections around it — [2 Player Games: Offline](https://apps.apple.com/us/app/2-player-games-offline-games/id1465731199),
[JindoBlu's 1 2 3 4 Player Games](https://play.google.com/store/apps/details?id=com.JindoBlu.FourPlayers),
[2 3 4 Player Mini Games](https://play.google.com/store/apps/details?id=com.ction.playergames).
Their line-ups converge hard: **Snakes · Spinner War · Pool · Tic Tac Toe ·
Archery · Tug of War · Whack-a-Mole · Memory · Sword Duel · Racing · Soccer ·
Color Switch · Stickman Fighting**.

Two things are true of every one of them that seats four:

1. **Simultaneous.** Four people on one tablet, all acting at once. The
   turn-based entries in those apps — Pool, Tic Tac Toe, Memory — are the
   **2-player** ones.
2. **One touch per player.** Not a joystick and a fire button. One thumb, one
   zone, one verb: tap, hold, or steer left/right.

The second is the load-bearing one and it is easy to miss. **Four players fit on
one screen because each player's control surface is a single button.** The
moment a game needs a joystick plus an action, its per-player footprint roughly
triples and four of them stop fitting — which is why no collection in this genre
ships a 4-player twin-stick anything.

> **The control law: on ONE SHARED SCREEN, if it cannot be played with one thumb
> in one zone, it is not a 4-player game.**

**Read the first four words.** The control law is a consequence of four people
dividing one screen, and it has no force at all when everybody has their own
device. On four phones each player has a full screen and the full two-handed
control scheme the 2-player game already ships — joystick, fire button and all
— and they are all looking into one shared arena rendered on each device.

An earlier draft of this document had that wrong, and marked Tank Clash ❌ for
separate screens on control grounds. That was applying a shared-screen
constraint to the one surface where it does not apply. Games like Tank Clash are
not merely *possible* across devices — they are the **best** shape for it:
everybody acts at once, nobody waits, and each player gets a whole screen to do
it on. What stands between them and shipping is netcode, which is a different
question with a different answer, and §3 is now cut on that question instead.

---

## 2. The three surfaces a game has to survive

| Surface | Who is where | Real estate per player | Notes |
|---|---|---|---|
| **ONE PHONE, 2P** | face-off, opposite edges | 412 × 400 | what all 22 games are built for |
| **ONE TABLET, 3–4P** | around the device | 410 × 544 at 4 (820×1180 tablet) | **phones cannot do this** — a quarter of a 412 px phone is 206 × 400, under the 300 × 300 floor. `MinigameLayout.shapesFor()` computes it. Recommending iPad for 4-player local is the correct call, and it is arithmetic, not taste |
| **SEPARATE SCREENS, 2–4P** | one device each | the whole screen each | where 4-player will mostly happen |

The third column is the whole argument for the iPad recommendation. It was
already measured in `docs/MINIGAME_RULEBOOK.md` §4 and the answer has not
changed: **a phone holds two private playfields, a tablet holds four.**

---

## 3. The categories — cut by what the wire carries

Everything in §1 assumed the useful split was *shared playfield vs private
playfield*. It is not. A shared playfield is exactly what makes a good
multiplayer game, and the genre knows it. The split that decides whether a game
can be played on four devices is **what has to cross the wire, and whether a
60 ms error changes the outcome.**

And that second half has a sharper form than a latency budget:

> **COMMAND vs CONTACT.** If a player's input is a *command* — a direction, a
> trigger, a launch vector, a lane — the host can adjudicate it and latency is
> cosmetic: your tank is 0.5 units behind where the host thinks it is, and
> nothing about that decides a hit. If the input is a *contact* — my paddle was
> **here** at **this instant** — then latency is the outcome, because the player
> is adjudicating their own collision and no two devices agree on when it
> happened.

Six tiers, in order of cost. **W0–W4 all work on four devices.** Only W5 does not.

### W0 · NOTHING ON THE WIRE — seeded solitaire
*Meteor Dodge, Loot Catch, Tree Climb, Odd One Out, Steady Hand, Snap Strike.*
Same seed, every draw taken by index, scores compared. Already shipped and
already running online. Needs a private playfield each, which on **one** device
means a tablet at 3–4 players.

### W1 · A TIMESTAMP — signal race
*Quick Draw, Shape Snap, Color Switch, Whack-a-Mole.*
Host says "GO at T"; each device stamps its own tap; the host ranks the deltas.
Nothing is simulated, so there is nothing to keep in step, and **a slow
connection costs fairness nothing** because each player is timed against their
own GO. One tap, so it also passes the control law on a shared screen.

### W2 · A SCALAR PER PLAYER — tug, mash, throttle, creep
*Tug of War, Grand Prix, Freeze.*
Each player's whole state is one number: how hard they are pulling, how far
along the track they are, how far up the board they have crept. Host sums or
sorts, broadcasts one line. A few updates a second is plenty — the same channel
the standings rail already uses.
**Grand Prix and Freeze belong here, not with the arena games.** A car on a
circuit is a distance and a speed; a creeper in Freeze moves 0.008 of the track
in 60 ms. Both were mis-filed as expensive.

### W3 · AN EVENT STREAM — deterministic replay from discrete inputs
*Light Cycles, Clear Out.*
Send the *decisions*, not the positions, and every device rebuilds the same
picture. Light Cycles is "player 2 turned left at cell (14, 9) on tick 812" —
the trail is history and history is identical everywhere. Clear Out is a launch
vector per shot, with the discs settling before the next one.
**Cheaper than snapshots and exactly correct**, because there is no
interpolation to be wrong about.

### W4 · ENTITY SNAPSHOTS — host-authoritative, ~20 Hz, interpolated
*Tank Clash, Sumo Spheres.*
The host runs the simulation, clients send intents and draw what they are told.
This is **the model the board already runs on** — `NetSync` polls host state at
20 Hz and broadcasts it — and the per-game payload is tiny: four tanks
(position, angle, hp) and a handful of shells is well under a hundred bytes.

Both are command-input games and both are latency-tolerant on the numbers:

| | moves in 60 ms | target size | ratio |
|---|---:|---:|---:|
| Tank Clash tank | 0.48 u | 1.2 u radius | 0.40 |
| Sumo sphere | 0.12 u | 1.5 u radius | 0.08 |
| Light Cycles head | 0.32 cells | 1 cell trail | 0.32 |

A tank half a radius behind where the host has it is invisible, and the 900 ms
invulnerability window after each hit hides the rest. **Tank Clash is one of the
better networked candidates in the roster, not one of the worst.**

### W5 · FRAME-EXACT CONTACT — do not put these online
*Puck, Bomb Pass.*
The player's own timing IS the collision. Puck's disc crosses 1.4 mallet-radii
in 60 ms and the mallet's position at the instant of contact decides the
deflection; Bomb Pass is "smack it while it is on your side" with a 340 ms
whiff lockout. These need rollback netcode, which is a different project.
**Keep them as 2-player games on one phone, where they are excellent.**

### Excluded on the rule at the top
**TURN-BASED BOARD** — *Four in a Row, Memory Match, Rhythm Forge, Penalty.*
Three people watching one person think. Keep them as 2-player.

---

## 4. The compatibility matrix

| | one phone 2P | one tablet 3–4P | four devices | wire |
|---|:--:|:--:|:--:|---|
| **W0 Seeded solitaire** | ✅ | ✅ | ✅ **shipped** | nothing |
| **W1 Signal race** | ✅ | ✅ | ✅ | a timestamp |
| **W2 Scalar** | ✅ | ✅ | ✅ | one number each |
| **W3 Event stream** | ✅ | ✅ | ✅ | discrete inputs |
| **W4 Entity snapshots** | ✅ | ⚠️ control law | ✅ | ~20 Hz state |
| **W5 Frame-exact** | ✅ | ⚠️ control law | ❌ | rollback |
| **Turn-based** | ✅ | ❌ | ⚠️ 2P only | one move |

Two different columns, two different constraints, and they are not the same one:

- **One tablet** is gated by the **control law** — a quarter screen holds one
  thumb. This is what rules out Tank Clash *there*.
- **Four devices** is gated by **netcode** — and W0 through W4 all clear it.

---

## 5. The 22 shipped games, re-audited

**Online today, no work (6)** — W0, already running:
Meteor Dodge · Loot Catch · Tree Climb · Odd One Out · Steady Hand · Snap Strike

**Online for a timestamp channel (2–3)** — W1:
Quick Draw · Shape Snap · (Grid Recall, once its finish is per-player)

**Online for a scalar channel (3)** — W2:
Grand Prix · Freeze · *plus the tug game we do not have yet*

**Online for an event stream (2)** — W3:
Light Cycles · Clear Out

**Online for host-authoritative snapshots (2)** — W4, the model the board
already uses:
Tank Clash · Sumo Spheres

**2-player only (7)**:
Puck, Bomb Pass (W5 — frame-exact) · Orb Deflect (barrier state must exist
before the orb arrives) · Penalty, Four in a Row, Memory Match, Rhythm Forge
(turn-based or alternating)

### Totals, corrected

**15 of 22 can be played by four people on four devices** — not 8. Six of them
work today; the other nine need one of four channels, three of which are
cheaper than the snapshot loop the board is already running.

On **one tablet**, the control law is the binding constraint instead, and the
answer is about nine: the six W0 games, the two W1 games, and Freeze. Tank Clash
and Sumo Spheres want a full screen each.

**These are different rosters, and that is the finding.** The best 4-player
games on four devices are mostly *not* the best 4-player games on one tablet.

---

## 6. What is missing, and what I would build

The roster has **no W2 tug game at all** — nothing where a shared object moves
because of how hard four people are pushing. It is the cheapest online tier
after W0/W1 and Tug of War is the genre's most-copied 4-player game. Still the
biggest content gap.

But the bigger gap is not a game, it is a **channel**. Fifteen of twenty-two
games can be played by four people on four devices and only six of them can be
today, because four tiers of wire exist on paper and one of them is built. In
order of value for effort:

1. **The timestamp channel (W1)** — smallest thing on this list and it unlocks
   Quick Draw and Shape Snap, two of the best games in the roster, with no
   simulation at all. Do this first.
2. **The scalar channel (W2)** — the standings rail already sends a number per
   player twice a second (`mgTick`); this is that channel pointed at gameplay
   instead of at a readout. Unlocks Grand Prix and Freeze, and any tug game.
3. **The event stream (W3)** — turn events and launch vectors. Unlocks Light
   Cycles and Clear Out, and is *exactly* correct rather than interpolated.
4. **The snapshot loop (W4)** — the real Phase C. `netSnapshot` / `netApply` /
   `netInput` per game, over the 20 Hz broadcast the board already runs.
   Unlocks Tank Clash and Sumo Spheres.

Games worth adding, in order:

1. **ROPE (W2)** — one disc in the middle, four corners, mash to drag it to
   yours. One tap. Free online. Reads from across the room.
2. **FLASH (W1)** — Quick Draw generalised to four: one signal, four zones,
   first thumb takes it, false starts cost you. Best-of-5.
3. **SCRAMBLE (W4)** — one board of coins, four grabbers, most in 30 s.

---

## 7. Keeping it competitive on separate screens

This section was written when the online roster looked like it would be W0
solitaires, and for those it still applies: they are individually played, so
without help they are four people alone comparing notes afterwards. **W3 and W4
games do not have this problem at all** — a shared arena is shared jeopardy by
construction, which is the argument for building those channels.

For the W0/W1 games, three mechanisms, in order of how much they buy:

1. **The standings rail** — built. One chip per rival, their live number, the
   leader in gold, across the top of your own screen. Costs the playfield
   nothing (it takes a band the split-screen chrome vacates).
2. **The surge** — not built. Call out the rank *change*, not the score. "Ana
   just passed you" is the only genuinely new information in a parallel round,
   and a rail that only counts up quietly gets looked at once.
3. **Shared jeopardy** — not built, and the strongest of the three: let one
   player's play touch another's. In a W0 solitaire that means the thing you catch is taken
   out of the shared pool, or a good run drops debris on the others. It turns a
   leaderboard into a contest, which is the test `MINIGAME_BACKLOG.md` already
   applies to every 2-player game and the one parallel play currently fails.

---

## 8. The recommendation

- **2 players, one phone** — the roster as it stands. Nothing changes, and it is
  where Puck, Bomb Pass, Penalty and the turn-based games stay.
- **3–4 players, one tablet** — gated by the **control law**. About nine games:
  the six seeded solitaires, the two signal races, and Freeze. State the iPad
  recommendation in the lobby rather than hiding it: at 4 players a phone gives
  each person 206 × 400 and that is not a playfield.
- **3–4 players, four devices** — gated by **netcode**, and this is the bigger
  roster: **15 of 22**. Six today; build the four channels in §6 order and the
  rest follow. This is where the arena games belong — Tank Clash, Sumo Spheres
  and Light Cycles are *better* at four than at two, and a full screen each is
  what they want.
- **Retire the bracket and the relay above two seats.** Both were the right
  answer to "everybody plays" and the wrong one to "nobody waits".

**The correction that matters most in this document:** a shared arena is not a
barrier to multiplayer, it is the point of it. The barrier is frame-exact
contact, and only two games in the roster have it.
