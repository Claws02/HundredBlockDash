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
