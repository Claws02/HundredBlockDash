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

> **The control law: if it cannot be played with one thumb in one zone, it is
> not a 4-player game.**

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

## 3. The categories

Seven, and the split that matters is not the verb — it is **what has to cross
the wire** when the players are on separate screens.

### The cheap three — these work everywhere, including online

**C1 · SIGNAL RACE** — one shared signal, everyone races to answer it.
*Quick Draw, Color Switch, Shape Snap, Whack-a-Mole, reaction taps.*
- **Control:** one tap.
- **Cross-screen cost: a timestamp.** The host says "GO at T"; each device
  stamps its own tap and reports the delta; the host ranks. Nothing is
  simulated, so there is nothing to keep in step, and a slow network costs
  fairness nothing because each player is timed against their own GO.
- **Scales to 4 trivially**, on any surface, and it is the single most
  network-friendly category there is.

**C2 · TUG / MASH** — one shared object, moved by how hard everybody pushes.
*Tug of War, a rope, a contested crown, a shared bar.*
- **Control:** one tap, repeated.
- **Cross-screen cost: one number per player, a few times a second.** The host
  sums the pushes and broadcasts one position. This is the same channel the
  standings rail already uses (`mgTick`).
- **Scales to 4** by giving the object more than two directions — a disc pulled
  toward four corners, a crown four people are dragging.

**C3 · PARALLEL SOLITAIRE** — the same challenge, everyone at once, scores compared.
*Meteor Dodge, Loot Catch, Tree Climb, Odd One Out, Steady Hand, Snap Strike.*
- **Control:** anything, because nobody shares a playfield.
- **Cross-screen cost: nothing.** Same seed, every draw taken by index. Already
  built and shipped.
- **On one device it needs a private playfield each**, so it is the category
  that forces the tablet at 3–4 players.

### The expensive three — one device only, until there is netcode

**C4 · SHARED ARENA, ELIMINATION** — one arena, last one standing.
*Snakes, Spinner War, Sumo, Light Cycles, Bomb Pass.*
- **Control:** one thumb (steer or push).
- **Cross-screen cost: a physics simulation.** Every body affects every other,
  every frame.
- **Scales to 4 beautifully on one device** — this is the category the genre
  leans on hardest — and the arena costs nothing extra per player (`ARENA` in
  the rulebook: 412 × 648 at two players and at four).

**C5 · SHARED ARENA, SCORE** — one arena, grab the most.
*Crown grab, coin scramble, a shared Whack-a-Mole board.*
- Same cost and same shape as C4; it ends on a clock instead of on elimination,
  which makes it kinder to a player having a bad round.

**C6 · ONE TRACK** — everybody on the same course at once.
*Racing, Soccer, Grand Prix.*
- **Control:** one pedal, or one thumb.
- **Cross-screen cost:** position sync — expensive. **But a time-trial variant
  is C3 and free**: same track, same seed, everyone racing the clock on their
  own screen with the others' positions shown as ghosts.

### The excluded one

**C7 · TURN-BASED BOARD** — *Pool, Tic Tac Toe, Four in a Row, Memory Match.*
Excluded at 3–4 players by the rule at the top: three people watch one person
think. **Keep them as 2-player games** — the genre does exactly this — and let
them be the roster's slow beat where a slow beat is affordable.

---

## 4. The compatibility matrix

| | one phone 2P | one tablet 3–4P | separate screens 2–4P | what crosses the wire |
|---|:--:|:--:|:--:|---|
| **C1 Signal race** | ✅ | ✅ | ✅ | a timestamp |
| **C2 Tug / mash** | ✅ | ✅ | ✅ | one number per player |
| **C3 Parallel solitaire** | ✅ | ✅ (tablet only) | ✅ | a seed, then a score |
| **C4 Arena, elimination** | ✅ | ✅ | ❌ Phase C | full physics |
| **C5 Arena, score** | ✅ | ✅ | ❌ Phase C | full physics |
| **C6 One track** | ✅ | ✅ | ⚠️ as C3 time-trial | positions, or nothing |
| **C7 Turn-based board** | ✅ | ❌ excluded | ⚠️ 2P only | one move |

**The line to read:** if 4-player is mostly going to happen on separate screens,
the roster that matters is **C1 + C2 + C3**, and all three are one-touch.

---

## 5. The 22 shipped games, audited

| Game | Category | 4P on a tablet | 4P on separate screens | Why |
|---|---|:--:|:--:|---|
| Meteor Dodge | C3 | ✅ | ✅ | already runs seeded and solo |
| Loot Catch | C3 | ✅ | ✅ | ditto — and the payday game |
| Tree Climb | C3 | ✅ | ✅ | ditto |
| Odd One Out | C3 | ✅ | ✅ | ditto |
| Steady Hand | C3 | ✅ | ✅ | ditto |
| Snap Strike | C3 | ✅ | ✅ | ditto |
| Quick Draw | **C1** | ✅ | ✅ **free** | one shared signal, one tap. **The best online candidate in the roster** |
| Shape Snap (Sort Rush) | **C1** | ✅ | ✅ **free** | one shape in the middle, four buttons |
| Grid Recall | C1/C3 | ✅ | ✅ | private grids, shared start — becomes C3 with a per-player finish |
| Sumo Spheres | C4 | ✅ | ❌ | one arena; four spheres is *better* than two |
| Light Cycles | C4 | ✅ | ❌ | the genre's Snakes. Four trails, one grid |
| Clear Out | C4 | ✅ | ❌ | four sides instead of two |
| Bomb Pass | C4 | ⚠️ | ❌ | needs a four-way pass, not a rally |
| Freeze | C5 | ✅ | ❌ | one crown, one eye, four creepers — scales as-is |
| Tank Clash | C4 | ❌ | ❌ | **joystick + fire breaks the control law** |
| Orb Deflect | C4 | ⚠️ | ❌ | drawing barriers is not one-touch |
| Puck | C4 | ⚠️ | ❌ | two goals and four mallets is a maul; needs 4 goals or 2v2 |
| Grand Prix | C6 | ✅ | ⚠️ | one pedal — already one-touch. Time-trial makes it online |
| Penalty | C7-ish | ❌ | ❌ | asymmetric and alternating — a 2P game |
| Four in a Row | C7 | ❌ | ⚠️ 2P | turn-based |
| Memory Match | C7 | ❌ | ⚠️ 2P | turn-based |
| Rhythm Forge | C7 | ❌ | ⚠️ 2P | alternating turns |

**Totals.** Nine games are ready for 4 players on a tablet with no rework
(6 × C3, 2 × C1, Freeze). **Eight are ready on separate screens today** — the
six parallel ones plus Quick Draw and Shape Snap, and those last two need only
a timestamp channel. Five are 2-player games and should stay that way.

---

## 6. What is missing, and what I would build

The roster has **no C2 at all** — nothing where a shared object moves because of
how hard four people are pushing. That is the cheapest online category after C3
and the genre's Tug of War is its most-copied 4-player game. It is the biggest
gap.

Three to consider, in order:

1. **ROPE (C2)** — one disc in the middle, four corners, mash to drag it to
   yours. One tap. Free online. Reads from across the room.
2. **FLASH (C1)** — the roster's Quick Draw generalised to four: one signal,
   four zones, first thumb takes it, false starts cost you. Best-of-5.
3. **SCRAMBLE (C5)** — one board of coins, four grabbers, most in 30 s. Tablet
   only, but it is the format everybody understands instantly.

---

## 7. Keeping it competitive on separate screens

The problem with C1/C2/C3 online is that they are individually played, so
without help they are four people alone comparing notes afterwards. Three
mechanisms, in order of how much they buy:

1. **The standings rail** — built. One chip per rival, their live number, the
   leader in gold, across the top of your own screen. Costs the playfield
   nothing (it takes a band the split-screen chrome vacates).
2. **The surge** — not built. Call out the rank *change*, not the score. "Ana
   just passed you" is the only genuinely new information in a parallel round,
   and a rail that only counts up quietly gets looked at once.
3. **Shared jeopardy** — not built, and the strongest of the three: let one
   player's play touch another's. In C3 that means the thing you catch is taken
   out of the shared pool, or a good run drops debris on the others. It turns a
   leaderboard into a contest, which is the test `MINIGAME_BACKLOG.md` already
   applies to every 2-player game and the one parallel play currently fails.

---

## 8. The recommendation

- **2 players, one phone** — the roster as it stands. Nothing changes.
- **3–4 players, one tablet** — C1, C2, C3, C4, C5, C6. Nine games ready now.
  State the iPad recommendation in the lobby rather than hiding it: at 4 players
  a phone gives each person 206 × 400 and that is not a playfield.
- **3–4 players, separate screens** — C1, C2, C3 only. Eight ready today; add
  the timestamp channel for C1 and a C2 game and it becomes ten.
- **Retire the bracket and the relay above two seats.** Both were the right
  answer to "everybody plays" and the wrong one to "nobody waits".
