# Minigame Backlog

Design doc for the arcade. Companion to `MINIGAME_STANDARD.md` — that document
says *how* to build one; this says *which one to build next and why*.

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

- **Quick Draw, Rhythm Forge, Orb Deflect, Freeze, Clear Out** have no hard
  duration ceiling and can still reach the manager's 90 s tie watchdog when one
  player disengages. Same fix as Tank Clash: a clock that settles on the current
  score.
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
