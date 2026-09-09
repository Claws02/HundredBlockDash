# Minigame Backlog

Design doc for the arcade. Companion to `MINIGAME_STANDARD.md` — that document
says *how* to build one; this says *which one to build next and why*.
`MINIGAME_RULEBOOK.md` says what *shape* it can be, and carries the structural
audit of this roster at three and four players.

---

## Post-mortem: the five games that didn't land

Tower Stack, Parry Duel, Circuit Trace, Hot Streak and Keep Up were built, tested
green, and played badly. They are now in `src/minigames/archived/`. The reason
matters more than the games do, because it was a **design-process** failure, not
an execution one.

### What went wrong

I optimised against the wrong constraint. The old §7 curation rule — *one game
per verb* — is a rule about **variety**, and I treated it as a rule about
**quality**. So the selection process asked "is stacking a verb we already own?"
when it should have asked "is this fun to play with your mate on a couch?"

The result was four games that are **single-player score-attack, duplicated
across a divider**:

| Game | What P1 does | What P2 does | Interaction |
|---|---|---|---|
| Tower Stack | stacks their own tower | stacks their own tower | none |
| Circuit Trace | traces their own circuit | traces their own circuit | none |
| Hot Streak | charges their own bar | charges their own bar | none |
| Keep Up | juggles their own orbs | juggles their own orbs | none |

You are not playing *against* anyone. You are doing a solo task next to someone
doing the same solo task, and a number is compared at the end. That is a
leaderboard, not a duel. The fifth, Parry Duel, does have real interaction, but
it is abstract rock-paper-scissors on a 2.6-second timer — a coin flip with extra
steps, with nothing physical to enjoy.

### The wider problem this exposed

Applying the same lens to the existing roster, the split is stark:

**Genuine two-player (7):** Sumo Spheres (push each other off), Tank Clash (shoot
each other), Orb Deflect (one orb crossing the line), Tug Tap (one rope), Clear
Out (discs land on *their* side), Quick Draw (race for the same instant), Freeze
(same signal, race to the same crown).

**Solo, side by side (8):** Rhythm Forge, Snap Strike, Odd One Out, Steady Hand,
Sort Rush, Meteor Dodge, Loot Catch — and Grid Recall only half-counts, since the
race is real but the grids are separate. Loot Catch's own description gives the
game away: *"the exact same loot falls on both sides, so it's pure collecting
skill."*

So the arcade was already **~50% non-interactive**, and my five pushed it to
11-of-20. The roster didn't get more varied; it got more boring. **Fixing the
ratio matters more than adding more games.**

---

## What the genre actually does

The dominant apps in this space — JindoBlu's *2 Player Games: The Challenge*, the
various *2 Player Games: Offline* collections — converge on a very consistent
line-up:

> Air Hockey · Ping Pong · Spinner War · Sumo · Penalty Kicks · Snakes · Pool ·
> Mini Golf · Sword Duel · Car Racing · Soccer · Tic Tac Toe · Chess

Look at what nearly every one of those has in common: **one shared thing that
both players are fighting over.** One puck. One ball. One arena. One board. The
handful that aren't (racing) still put both players on the *same track*, so you
can see in real time whether you're winning.

There is essentially **no** "do a solo task on your half and compare scores" game
in the genre's canon. That's the tell.

The second thing the genre does that this roster doesn't do at all: **asymmetric
roles.** Penalty Kicks is one player shooting and one keeping, then you swap.
Both players are doing *different things at the same time*, which creates
tension a symmetric game can't.

### The four structural gaps

Measured against that canon, Hundred Block Dash is missing:

1. **A paddle-and-ball rally** — air hockey / pong / soccer. The single most
   iconic format for two people on one phone, and the roster has nothing like it.
   Orb Deflect is the nearest neighbour, but drawing barriers is a fundamentally
   different (and less immediate) action than steering a paddle.
2. **Asymmetric roles** — one attacks, one defends, then swap. Zero coverage.
3. **A shared board, taken in turns** — tic-tac-toe / connect-4 / pool. Zero
   coverage. Also the only format that gives the arcade a slower, thinking beat.
4. **Spatial denial** — snakes / light cycles, where you win by taking space away
   from them rather than by scoring.

**And the geometry is already perfect for this.** The FACE-OFF orientation puts
the phone flat between two players, P1 at the bottom edge, P2 at the top. That is
exactly an air-hockey table. The split-half score games were fighting that
layout; a shared table embraces it.

---

## Proposed shortlist — to discuss, not yet built

Ordered by how confident I am. All are shared-object or asymmetric by
construction; none can degrade into "two solo games side by side".

### 1 · PUCK — air hockey *(highest confidence)*

One puck, one table, a goal mouth at each end. Drag your paddle anywhere in your
half; the puck bounces off the side walls. First to 5 goals or most goals in 40 s.

- **Why it works:** instant comprehension, zero instruction needed, and the puck's
  physics do the entertaining. It's the format the whole genre is built on.
- **Depth:** angle shots off the walls, striking on the move for pace, hanging
  back to defend versus pushing up.
- **Comeback:** built in — you're always one counter-attack away.
- **Risk:** the roster already has Orb Deflect, also a "thing crosses the middle"
  game. Mitigation: Orb Deflect is *drawing static barriers*; this is *direct
  continuous control of a paddle*. They feel nothing alike in the hand, but it's
  the one overlap worth arguing about before I build it.

### 2 · PENALTY — asymmetric, alternating roles

One player drags to aim and flicks to shoot; the other drags along their goal
line to dive. Five rounds each way, then swap. Highest score wins.

- **Why it works:** the only asymmetric format proposed. The shooter's decision
  (where to aim) and the keeper's decision (which way to commit) resolve
  simultaneously, so it's a real read — but unlike Parry Duel it's *physical*,
  and you get to watch the ball.
- **Depth:** power/placement trade-off, keeper reading your run-up.
- **Risk:** turn-based means one player is idle-ish during the other's shot.
  Mitigation: keep each round under 4 s so the alternation is snappy.

### 3 · LIGHT CYCLES — spatial denial

Both trails grow continuously in one shared arena. Steer with a thumb; crash into
any trail or wall and you lose the round. Best of 3, arena shrinks each round.

- **Why it works:** pure shared-space conflict. Every metre you take is one they
  can't have. Reads instantly.
- **Depth:** cutting them off, baiting them into a pocket, managing your own
  space.
- **Risk:** rounds can end in 3 seconds from one twitch. Needs the mercy/floor
  treatment — a brief invulnerable start and a best-of-3 so a single mistake
  isn't the match.

### 4 · FOUR IN A ROW — shared board, turns

Classic connect-4 on a shared 7×6 grid, drawn so both players read it from their
own edge. 12 s shot clock per move.

- **Why it works:** the arcade has no thinking game at all, and the pacing
  contrast would make the frantic ones feel better. It's the format everyone
  already knows.
- **Risk:** it's the *slowest* thing that could go in a 15–40 s window, and a
  bot for it is either trivial or unbeatable. Needs a deliberately shallow
  search with skill-scaled blunder rate.

### 5 · RALLY — soccer / volley variant

One ball, one shared pitch, a goal each end, and each player controls a single
striker that kicks on contact. Essentially two-player air hockey with a bouncing
ball and gravity.

- **Honest note:** if PUCK ships, this is close enough that it may be redundant.
  Listed for completeness; I'd cut it unless it clearly feels different.

---

## Revised rule for what goes in the arcade

Replacing the old "one game per verb" test, which is necessary but nowhere near
sufficient:

1. **Is there one thing both players are fighting over?** A puck, an arena, a
   board, a rope. If each player has their own private copy, it's a leaderboard —
   cut it.
2. **Can one player's action directly hurt or help the other, in the moment?**
   If P2 could go make tea and P1's experience is unchanged, it isn't a
   two-player game.
3. **Would you understand it from across the room with the sound off?**
4. *Then* check the verb isn't a duplicate.

Rule 1 alone would have killed four of the five archived games before a line was
written.

---

## Still-open items from the QA pass

- ~~**Quick Draw, Rhythm Forge, Orb Deflect, Freeze, Clear Out** have no hard
  duration ceiling.~~ **Closed.** Orb Deflect and Clear Out already had one;
  Freeze was rebuilt with a 44 s cap; Quick Draw was the last real case — its
  round sat in the `fire` phase forever if neither player drew, so the match only
  ended on the manager's 90 s watchdog. It now scrubs an undrawn round after
  2.8 s and settles the match at 44 s. **Every game in the roster now resolves on
  its own; reaching the watchdog is once again a bug signal rather than a
  routine outcome.**
- **Tank Clash's easy bot** lands zero hits on a stationary target. Defensible for
  the tier, but it isn't much of a contest.
- **The 8 solo side-by-side games** in the current roster are the bigger question.
  Options: retrofit interaction into the best of them (Meteor Dodge could drop
  *your* debris onto their side; Sort Rush could send mis-sorted items across),
  or retire the weakest and keep the arcade smaller and sharper. Worth deciding
  before adding anything new.

---

## Rules of thumb that survived

1. **Put the rules on the screen.** If it needs the intro card to be playable, it
   fails the 3-second test.
2. **Escalate on the clock, not on the score.** Ramping difficulty for whoever is
   winning punishes success.
3. **Decide how it ends before you build it.** The 90 s watchdog is a bug signal,
   not an ending.
4. **The bot's skill must map to the game's actual skill** — and check the sign.
   Keep Up's first cut had difficulty inverted: skill made the bot strike sooner,
   but striking later scores more. `qa/botcheck.js` catches this; a code review
   does not.
5. **Watch for aim that is also movement.** Tank Clash's hull faces its travel
   direction, so raising tank speed silently widened every shot.

---

## Built: the four classic formats *(shipped)*

All four proposals from the shortlist above are now in the roster, and the
still-open items from the QA pass are resolved.

| Game | Gap it fills | Shape |
|---|---|---|
| **PUCK** | paddle-and-ball rally | One puck, one table, a goal each end. Drag your mallet anywhere in your half. First to 5, or the score at 42 s. |
| **PENALTY** | asymmetric roles | Shooter drags to aim and releases; keeper slides and commits at the moment of the strike. 3 kicks each, sudden death capped. |
| **LIGHT CYCLES** | spatial denial | Two trails, one arena. Tap left or right of your cycle to turn. Best of 3, arena closes in each round. |
| **FOUR IN A ROW** | shared board, turns | 6×5 connect-4 with a drop row on each player's edge and a 5 s shot clock. |

RALLY was cut, as flagged: with PUCK shipped it is the same game with a bounce.

### What the measurements changed

Every one of these was tuned against a bot playing unopposed, not against
intuition, and three of the four moved as a result:

- **PUCK's bot only defended.** It returned to its goal line whenever the puck
  was not coming at it, and finished 0–0 against an opponent who never moved. It
  now enters an attack state when the puck is loose in its own half, gets behind
  it, and drives at the far mouth.
- **FOUR IN A ROW on a full 7×6 board took 63 s** just to fill, against a 15–40 s
  budget. Dropped to 6×5 with a 5 s shot clock: a hard bot now beats random play
  3–0 with the longest game at 21 s.
- **LIGHT CYCLES started both cycles in the same column**, so doing nothing
  produced a mutual head-on every round. Offset lanes make the opening about
  space rather than about chicken.
- **PENALTY's sudden death was unbounded** and ran to 93 s. Capped at two extra
  pairs plus a 62 s ceiling.

Two of these only showed up because the probe drove a *scripted* opponent rather
than random taps — `qa/newgames.js`. The generic arcade sweep could not tell
"the bot never attacks" from "the harness parked a mallet in its own goal mouth".

### Roster interaction ratio

The point of the exercise was the ratio, not the count. Genuine two-player games
are now **13 of 18**, up from 7 of 15:

**Shared object or asymmetric (13):** Puck, Penalty, Light Cycles, Four in a Row,
Shape Snap *(reworked)*, Freeze *(rebuilt)*, Sumo Spheres, Tank Clash, Orb
Deflect, Clear Out, Quick Draw, Grid Recall *(half — the race is real)*, Snap
Strike *(half — shared clock, separate bars)*.

**Still solo side-by-side (5):** Rhythm Forge, Odd One Out, Steady Hand, Meteor
Dodge, Loot Catch. Loot Catch now has a reason to exist regardless — it is the
coin game, and the identical loot on both sides is the point of it being fair.
The remaining four are the next thing to fix or cut.

---

## Built: round two *(shipped)*

Four more, chosen from a shortlist by the person who has to play them. Pocket
(pool), King of the Hill and Tug War were proposed and **cut before any code was
written** — the right time to cut something.

| Game | Shape | Category |
|---|---|---|
| **MEMORY MATCH** | 5×5 shared board, 12 pairs + 1 jackpot, taken in turns | coin game |
| **BOMB PASS** | One lit bomb, bat it back while it's on your side, first to 3 | winner-takes |
| **GRAND PRIX** | One track, one pedal; corners have a speed and over it you spin | winner-takes |
| **TREE CLIMB** | A leaf grows left or right, tap that side to swing onto it | coin game |

### Memory Match activates the HUDDLE hold

`MG_ORIENTATIONS.huddle` had been defined since the orientation config was
written and **no game used it** — dead configuration describing a way to play
that did not exist. Memory Match is that game: the phone lies flat, nobody holds
an end, and turns alternate. That is a second *physical* mode, which does more
for variety than another face-off twitch game would.

Its faces are twelve shapes chosen to be **unchanged by a 180° rotation**
(circle, ring, square, diamond, two stars, hexagon, octagon, plus, cross, bars,
dots). One drawing therefore reads correctly from both sides of the table, with
no duplicated glyphs and no meaning carried by colour.

### Coin games are now a category, not an exception

Three of the roster pay both players what they earned: **Loot Catch**, **Tree
Climb**, **Memory Match**. All three share one ceiling — `MAX_PAYOUT = 30` —
lowered from Loot Catch's old 80 so that no single minigame can decide a match.
At 30 a strong run reaches the cap with time to spare, which is deliberate: the
closing stretch is then about the *win bonus* rather than about grinding coins.

### What the measurements changed

Every one of these was tuned against `qa/botcheck.js`, and every one moved:

- **Grand Prix's bot rolled its braking decision every frame.** Both tiers
  measured 27–28 s, i.e. the skill dial was connected to nothing: a per-frame
  `Math.random()` on a continuous control made the throttle stutter at the
  randomness rate rather than at the skill rate. The fix is a split — the
  *margin* is committed once per corner, the braking *distance* is recomputed
  live from actual speed. Getting that split wrong the other way (distance
  computed once from `V_MAX`) had it braking from the start of every straight
  and lapping in 64 s. Now 22 s hard, 25 s easy.
- **Bomb Pass could be over in eight seconds.** At first-to-2 with a 330 px/s
  serve, a player who missed both returns lost before they had looked up — the
  §3 floor. The bomb now hangs on the centre line for 0.85 s before it launches,
  starts slower, and the match is first to 3. Now 15–21 s.
- **Memory Match ran to its ceiling every time.** 25 cards is not the problem;
  turn overhead was. A 6 s shot clock and a 900 ms peek meant the *waiting* was
  the game's length. Tightened to 4 s and 680 ms, and the bot's memory now
  visibly separates the tiers — 7 pairs at hard against 4 at easy.
- **Tree Climb's winner hit the coin cap every single run** at 2 per branch,
  which made the payout a flat number instead of a record of the climb. 1 per
  branch, 22 to the top.
- **Three of the four had HUD rows drawn behind the status pill** (R1b). Caught
  by screenshot, not by any assertion — worth remembering that the arcade sweep
  and botcheck both passed while a prompt was invisible.

### Tree Climb wears your character — the real one

The climbers are the players' **actual 3D board pieces**. Each one is rendered
once at the start of the round through `Renderer.createCharacterMesh` into an
offscreen canvas, then drawn as a sprite; the WebGL context is created, used for
two frames and released immediately rather than held open alongside the board's
for a model that never changes shape.

Two things that needed care:

- **Framing.** Pulling the camera back a fixed multiple of the model's height
  cropped the tall ones — the bunny lost its ears, the cabbie half its cap. The
  distance is solved from the model's bounding *sphere* and the field of view.
- **Failure.** If WebGL is unavailable the game falls back to a flat disc in the
  player's colour with the character's emoji on it. A minigame that will not
  start is far worse than one drawn simply.

The model is already built in the player's colour, so it carries whose climber
it is without a disc behind it.

It is the only minigame that does this so far. Worth considering for the others
where a character would fit naturally (Sumo Spheres, Meteor Dodge, Grand Prix),
and worth NOT doing where the piece is the point (a tank, a puck, a bomb).

### Tree Climb's leaves were a metronome

The side of each new leaf was drawn at random and then passed through a guard
meant to stop three of the same side running. The guard compared the new side
against *the side just jumped to* — which, because the jump had already copied
it, was always the current side. So the guard fired every time and the tree came
out as a perfect left-right-left ladder. It read as random in the source and was
completely predictable on the screen.

It is now a real draw against the last two branches placed, so runs of two are
common and only runs of three are excluded. `qa/treeclimb.js` checks the
sequence for the properties randomness actually has, by reading the lit leaf off
the canvas rather than by trusting the code.

The same rewrite made the ladder **persist**: branches are remembered rather than
recomputed from a formula, which is what allows a missed grab to drop you to the
last branch on the side you jumped at and then have you climb the same ladder
back up. A miss costs height now instead of a moment — measured, that made the
climb long enough that the target came down from 22 branches to 18.

### Deliberate exception to the 15–40 s target

Memory Match's ceiling is 58 s and Four in a Row's is 52 s. Both are stated
exceptions rather than oversights: they are the roster's slow beats, and the
pacing contrast is what makes the frantic games feel frantic. A memory game with
few enough cards to finish in 30 s is not a memory game.


---

# Round three: the four-player audit

*Written after the 3–4 player conversion. Twelve of the twenty-two games now
seat three and four; this is what that revealed.*

## `roomy` is a synonym for "leaderboard"

The conversion split the twelve live games into two classes on a purely
technical test — does a quarter of a **phone** give this game enough room? The
answer sorted them perfectly along a line nobody was measuring:

| Needs a tablet (`roomy`) | Plays on a phone |
|---|---|
| Steady Hand · Meteor Dodge · Loot Catch | Quick Draw · Shape Snap · Snap Strike |
| Tree Climb · Grid Recall · Odd One Out | Sumo Spheres · Light Cycles · Grand Prix |
| **every one a private playfield** | **every one a shared object** |

That is not a coincidence, it is the same fact stated twice. **A game needs more
room per player exactly when each player has their own copy of the field** — and
"each player has their own copy" is precisely what §Rule 1 calls a leaderboard.

Two consequences, and they are the same consequence:

1. **At four players on a tablet, half the pool is four people playing
   solitaire.** The post-mortem above condemned this shape at two players. At
   four it is worse, not better: the thing you are not interacting with has gone
   from one person to three.
2. **The tablet recommendation exists BECAUSE of those six games.** The phone
   pool is six precisely because the six shared-object games need no extra room.

So fixing the interaction problem and fixing the shallow phone pool are **not
two jobs**. Give a `roomy` game one shared thing to fight over and it stops
needing a private field, which means it stops needing a tablet. Every one of
these repairs moves a game from the right column to the left.

## The repair list, best value first

Each of these is a change of GEOMETRY, not of verb — the game stays what it is.

| Game | Today | One shared thing | Notes |
|---|---|---|---|
| **Odd One Out** | four private grids | **one grid.** First to tap the odd tile scores it; the grid immediately re-rolls. | The cheapest and best fix on this list. Turns a scan-race into a genuine race — you can see the others' fingers coming. Loses nothing. |
| **Loot Catch** | same loot, four chutes | **one chute.** Loot falls down a shared field and catching a coin DENIES it to everyone else. | Its own description already admits the problem: *"the exact same loot falls on both sides."* Same loot is not shared loot. |
| **Steady Hand** | four private targets | **one target.** You bank time only while you are the only finger on it, or the closest. | Contact becomes contest: crowding the target is a legitimate tactic. |
| **Tree Climb** | four private stems | **one tree, four climbers.** Same branches, and a climber you pass can be knocked back a branch. | Already a race; this makes it a race you can interfere in. |
| **Meteor Dodge** | four private skies | **one sky.** Four pods, and a pod you shove is a pod in the path. | Biggest change of the six — collision between pods is new physics. |
| **Grid Recall** | private grids, shared pattern, shared finish | already half-shared — **lowest priority.** | The race is real; only the grids are separate. Leave until last. |

Doing the first three would take the phone pool from six games to nine and cut
the leaderboard count in half.

## What the roster is still missing

Measured against the canon in §What the genre actually does, with four players
now the target rather than two:

1. **RACE has exactly one game.** Grand Prix. It was the thinnest genre before
   the conversion and it still is. A second racer with CONTACT — a steeplechase
   on one shared track where you can shoulder somebody into a hurdle — fills the
   gap and passes Rule 1 by construction.
2. **No asymmetric game above two players.** Penalty is the roster's only
   asymmetric format and it is two-player-only. **One-versus-three** is an entire
   category with zero coverage: one player controls something big and slow, three
   control something small and fast. The tension is completely different from
   anything in the arcade.
3. **No team format.** `MINIGAME_RULEBOOK.md` sketches TEAMS 2v2 and nothing
   implements it. A four-way or 2v2 **tug of war** is the cheapest possible
   entry: one rope is the purest shared object there is, and its whole state is
   one number per player — `wire: 'scalar'`, so it is nearly free online.
4. **Only two coin games.** Loot Catch and Tree Climb. The payday round is a
   good beat and it fires about one round in eleven.

## The rule, restated for four players

§Rule 1 becomes sharper, not looser, with more people at the table:

> **If a player could leave the room and nobody else's screen would change, it
> is not a multiplayer game.**

At two players that test caught four games. At four it catches six more — and
`roomy` is how to spot them without playing a single round.

---

# Round four: the play audit, and two games built out of it

The previous round was written from the code. This one was written from playing
the games, which found different things — the code round found which games could
not seat four people, and this one found which ones were not worth seating four
people at.

## What was fixed

| Game | What was wrong | What it is now |
|---|---|---|
| **Four in a Row** | shipped on a 6×5 board to keep rounds short | 7×6. A narrower board is a different game: it removes the seventh column that the whole body of four-in-a-row theory rests on, and players who know the game feel it. Length is the watchdog's problem. |
| **Tree Climb** | stem drawn at 0.37 of the frame | centred. The offset dated from every climber sharing one undivided canvas; each has a zone of its own now. |
| **Quick Draw** | 50 ms tie window | 25 ms. `performance.now()` resolves far finer, so the window is only how much of a photo finish we decline to call. |
| **Light Cycles** | arena closed in by a fixed 2 then 4 CELLS | a fraction of each axis. Fixed cells took 13% of a tablet's width and more than half a phone's; the round-three phone arena was a corridor. The edges are red now, with hazard hatching on the closed-in band, because a blue hairline in the floor's own colour family never said "wall". |
| **Meteor Dodge** | — | archived. It needed a tablet and asked for the same beat Loot Catch already covers, with less reason to move. |
| **Loot Catch** | one item at a time at a random x, a third of them bombs, a basket that teleported to your finger | waves down four lanes, three at a time, seven in ten of them bombs, and a basket with a top speed. See below. |
| **Shape Snap** | centre shape changed after it appeared | a round can end inside the suspense window — a false start hands it over — and its reveal was still pending. Cancelled now. |
| **Puck** | puck died when struck quickly | the impulse reflected the puck's ABSOLUTE velocity every frame the two overlapped, so a jab reflected a puck that was already leaving straight back into the mallet. Relative velocity, gated on closing. Measured: 81% of samples at the speed floor before, 5–49% after. |
| **Odd One Out** | wrong tap left the same grid up | a wrong tap deals a fresh grid, and consecutive misses widen the colour difference. Nobody spends thirty seconds on one grid they cannot solve. |
| **Grand Prix** | instant spin at the limit; a gauge at the bottom you raced instead of the track | grip goes gradually — the car yaws and scrubs speed, lift and it comes back, only a full slide spins you. The gauge is gone; the limits are painted on the tarmac. |
| **Memory Match** | four ways of drawing the same blob, three pinks and two greys | faces that differ in silhouette, tints walked around the wheel, and the colour carried across the whole card. |

## The Loot Catch rebuild, because it is the pattern

Loot Catch is the clearest case in the roster of a game that was *arranged*
rather than *designed*. It had all the parts — a thing to catch, a thing to
avoid, a basket, a clock — and no question in it. One item fell at a time, at a
random x, with the whole width to move in and a basket that went wherever your
finger was. There was never a moment where you could not have both.

The repair was not more bombs. More bombs at random positions is more things to
step around, and stepping around things you have infinite time to step around is
not a decision either. What it needed was a **question with a wrong answer**:

- Loot falls in **waves down four fixed lanes**, three at a time, landing
  together.
- Seven in ten items are bombs, so a wave is typically two bombs and one coin.
- The basket has a **top speed**. A hop to the next lane is nearly free;
  crossing the whole run takes longer than a late wave spends falling.

Now every wave asks: *which lane, and can I get there from where the last wave
left me* — and the answer is sometimes no. Past the halfway mark some waves fill
all four lanes, so the only move left is the least bad one.

**The general form:** a game is not difficult because its numbers are hostile.
It is difficult when it asks you something at a moment when you cannot have
everything. Raising a hazard rate never creates that moment; taking away the
ability to be everywhere does.

## Two new games

**FRAME MATCH** — one portrait in the middle of the table, cut into three
horizontal bands. Top and bottom are the target's and never change; the middle
is somebody else's and swaps every second. When the middle is the target's own,
the face is whole for exactly one second, and the first person to tap their pad
in that second takes the round. Best of five. A wrong tap costs a second and a
half.

It is the roster's cleanest example of **shared playfield, partitioned input**:
there is one picture, in one place, and the only thing each seat owns is
somewhere to put a thumb. That is what lets four people play it on a phone —
nobody needs a playfield of their own, because the playfield is the thing in the
middle they are all already looking at. It also answers the `roomy` question
from the other side: a game can be *visually* large and still not want a tablet,
because `roomy` is a question about the ZONE.

Difficulty is in the decoys, not the clock. The frame rate never changes — a
second is a second in round five. What narrows is what separates a decoy from
the real thing: round one lets the eyes be a different colour, round five leaves
only where they are looking.

**SPEED BOAT** — one river, one set of rocks, and a camera per seat locked to
its own boat. Drag to steer, tap to change gear: SLOW, CRUISE, FLAT OUT.

This is the second RACE game the list above asked for, and it has the contact
that request specified: boats shove each other, and the boat that is behind pays
for the contact. It is also a **shared world with private viewports**, which is
a structure the roster did not have — `MG_SHAPE` calls it an arena, and it is,
but what is split is the camera rather than the water.

The design is one number against another. Flat out covers the course in fifteen
seconds and is the fastest anything can go; it is also the gear where the next
line of rocks arrives before you can reach the gap in it, and a hit at speed
costs more than a hit at a crawl. On the measured rates a cruising boat finishes
a couple of seconds ahead of a flat-out one, and a slow boat is a long way
behind both — so the throttle is a decision with a wrong answer at either end.
That is only true of an average player: somebody reading two lines of rocks
ahead can hold flat out through a stretch they are already lined up for, and
they should win. The gear is meant to be worth thinking about, not to have one
right answer.

## Still open

The repair list above is untouched except for Loot Catch and Odd One Out, and
both of those were fixed in a different direction than it proposed — the list
said "one shared chute", and what shipped kept the private chutes and made the
decision inside one hard. That is a smaller change and it fixed the thing that
was actually wrong; the shared-chute versions remain the better long-term
answer and remain unbuilt.

Of the four gaps named above, RACE is now two games and the other three are
untouched: **no asymmetric game above two players**, **no team format**, and
**only two coin games**.
