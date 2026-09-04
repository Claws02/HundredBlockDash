# The Rulebook

**How to make a new minigame — the story it has to tell, and the structures that
can tell it to two, three or four people.**

The documents that already exist cover pieces of this. None of them covers the
shape:

| Document | Answers |
|---|---|
| `MINIGAME_STANDARD.md` | *How* to build one. The code contract — R1–R7, the loop, cleanup, the bot dial, the shipping checklist. |
| `MINIGAME_BACKLOG.md` | *Which* one to build next, and the five that were built and cut. |
| `TURN_FLOW.md` · `SCENE_PACING.md` | The turn a minigame interrupts, and how long every beat of it owns the screen. |
| **This** | **What shape it is.** The story a round tells, the four structures a minigame can have, and what each one costs when a third and fourth player sit down. |

Read this one first, because it decides things the others assume. A game built
to the standard, scoring 14/16 on the rubric, can still be unbuildable at four
players — and you find that out after it is written, not before.

---

## 1. A round is a story, and it has eight beats

`SCENE_PACING.md` puts the turn like this:

> your turn → the throw → the number → the journey → where you landed → **what
> you got** → a breath → what happens next

The minigame is what happens next, and it has the same shape at a smaller scale.
Eight beats, and **you own exactly one of them.**

| # | Beat | Question it answers | Who draws it | Floor |
|---|---|---|---|---|
| 1 | **THE CALL** | Something is coming, and it involves me. | `announceMinigameIncoming` | `PRE_MINIGAME` 1100 ms |
| 2 | **THE BRIEF** | What is it, and how do I win? | intro card, `MG_INFO` | a press (both, in tabletop) |
| 3 | **THE HOLD** | How do I physically hold this thing? | `MG_ORIENTATIONS` | a press |
| 4 | **THE GATE** | Are we both actually ready? | `#mg-ready-1/2` | both presses |
| 5 | **THE COUNT** | Now. | 3 · 2 · 1 · GO | 3.6 s (4 ticks × 900 ms) |
| 6 | **THE PLAY** | *(your game)* | **you** | 15–40 s |
| 7 | **THE VERDICT** | Who won, and what did it pay? | scoreboard, zone flash, payouts | ~1.4 s + card |
| 8 | **THE RETURN** | What did that change about the match? | winner rolls first | `POST_MINIGAME` 700 ms |

**You own beat 6.** Do not draw beats 1–5 or 7–8 — no countdowns, no ready
buttons, no result screens of your own. That is R2 and R6 in the standard, and
it is the reason a new game drops in without touching the engine.

The beats are not decoration. Each answers one question, and a beat that answers
none is dead air. Two of the three worst pacing faults ever found in this repo
were beats that existed with nothing in them: `ACKNOWLEDGE | msg-modal` never
appeared in 260 seconds of sampling, and the gap before a minigame did not exist
at all until `PRE_MINIGAME` was added.

### Across phones, the same story loses three beats

A parallel round played on four devices runs CALL → CARD → PLAY → SCOREBOARD →
CLOSE. Beats 3, 4 and 5 are gone, and the reasons are worth knowing because they
generalise:

- **No HOLD.** Nobody is sharing a device, so there is no grip to explain.
- **No GATE.** A ready gate across four phones means the slowest person to look
  up decides when everybody starts. The whole reason parallel play works is that
  nothing has to be simultaneous to the frame — the challenge is identical
  because the *seed* is, not because the clocks are.
- **No COUNT**, for the same reason.

What replaces them is **THE CARD**, which every device shows including the ones
not playing. A phone that goes quiet for thirty seconds with no explanation
reads as a crash.

### The one rule that governs the whole arc

> **Setup, contest, verdict — and the verdict has to be a moment.**

If a player cannot point at the instant they won or lost it, the game is not
finished. Score-comparison endings are the weak case: Loot Catch works because
the coins land in your basket as you earn them, so the verdict is confirming
something you already felt. A game whose only verdict is a number appearing on
a card afterwards has spent thirty seconds building to nothing.

---

## 2. Where a round sits in the match's story

There are exactly three routes into a minigame and they all go through one
function, `_contest()` in `GameController.js`:

| Route | Stakes | Who plays |
|---|---|---|
| **Round-end contest** | `MINIGAME_REWARD` (10 coins) + rolling first next turn | **everybody** — §11 |
| **A Duel space** | a coin wager both players set | whoever landed on it, and their nearest rival |
| **A fight over a Buddy** | the Buddy itself | the claimant and the holder |

> Only the round-end route was intercepted when online play was built, so a
> networked match froze the first time anybody landed on a Duel tile. All three
> now go through the one helper. **A new game must not know which route it came
> in on** — it is handed a bot flag and a callback, and it hands back a winner.

The minigame is the round's *payoff*. It used to be queued behind the buddy
report, which was moved to the start of the next round specifically so nothing
stands between the last turn of a round and the contest that ends it. Whatever
you build, it is the loudest thing that happens in four turns of board play.
Build it to be worth that.

---

## 3. The four structures

Everything about how a minigame scales past two people falls out of two
questions, and neither is about the verb:

|                     | **one shared playfield** | **one playfield each** |
|---------------------|--------------------------|------------------------|
| **everyone at once**| **ARENA**                | **SPLIT**              |
| **one at a time**   | **TABLE**                | **RELAY**              |

Two modifiers cut across the grid rather than adding cells to it: **ASYM** (the
seats do not have the same job) and **TEAMS** (four seats, two sides).

`src/config/MinigameLayout.js` is this table as arithmetic; `MG_SHAPE` in the
registry classifies every game that has shipped. The spread today:

**arena 12 · split 7 · table 2 · relay 1**

That single line is the roster's structural problem in one number, and §4 says
why.

### The summary that matters

Everything below is one table. What a third player costs, on one phone:

| Structure | Shared? | Acting | 3rd player costs | Playfield at 2 / 3 / 4 (412×892 phone) | Across phones |
|---|---|---|---|---|---|
| **ARENA** | one playfield | at once | a 76 px control band | 412×648 · 412×648 · 412×648 | needs real netcode (Phase C) |
| **SPLIT** | a playfield each | at once | **half of somebody's game** | 412×400 · ✗ · ✗ | **free** — same seed, no sync |
| **TABLE** | one board | in turns | a 34 px banner | 412×412 · 412×412 · 412×412 | cheap — one move on the wire |
| **RELAY** | a playfield each | in turns | **nothing** | 412×766 · 412×766 · 412×766 | cheap — a score on the wire |

Read the middle column twice. **Three of the four structures cost nothing to add
a player to.** The one that does is the one the roster is built on.

### 3.1 ARENA — one playfield, everyone at once

Puck, Sumo Spheres, Tank Clash, Light Cycles, Clear Out, Bomb Pass, Grand Prix,
Freeze, Quick Draw, Shape Snap, Orb Deflect, Penalty.

One puck, one arena, one signal. Nothing is divided except the **controls**, so
a third and fourth player cost a control band and not a square inch of the
playfield. On a phone that is 76 px at each long edge — one 44 px target with
16 px of padding — and the arena is 412×648 whether two people are playing or
four.

**Seating.** Four people do not sit one to an edge. A phone's short edges are
412 px of screen and about a hand-width of table, and four edge bands would
leave an arena 260 px wide — narrower than the two-player game's playfield.
People crowd a phone the way they crowd anything small: two along each long
side. So the ring fills bottom, then top, then the corners:

```
   2 seats          3 seats           4 seats
  ┌─────────┐     ┌────┬────┐      ┌────┬────┐
  │    P2   │     │ P2 │ P3 │      │ P3 │ P4 │
  ├─────────┤     ├────┴────┤      ├────┴────┤
  │         │     │         │      │         │
  │  ARENA  │     │  ARENA  │      │  ARENA  │
  │         │     │         │      │         │
  ├─────────┤     ├─────────┤      ├────┬────┤
  │    P1   │     │   P1    │      │ P1 │ P2 │
  └─────────┘     └─────────┘      └────┴────┘
```

The bottom/top axis is the one every shipped game is built on, so it is filled
first and never disturbed: a 4-player arena is the shipped face-off with two
more people leaning in, not a different arrangement. At three, the odd seat
takes the near edge alone — which online is always the seat this device plays,
the same rule the HUD follows.

**What makes it good.** It is the format the whole genre is built on, and the
pressure is free: everybody is looking at the same object, so everybody can see
who is winning without being told.

**The failure mode.** Four things moving in one 412×648 space is a scrum. Above
two players an ARENA needs either bigger objects and fewer of them, or a rule
that keeps players apart (lanes, zones, a turn order on *contact* rather than on
play). Sumo Spheres is the one in the roster that plainly wants four. Puck does
not — two goals and four mallets is not air hockey, it is a rugby maul.

**Across phones.** This is the expensive one. An ARENA is one simulation several
people reach into, so playing it across devices means agreeing on a physics step
and reconciling input latency. That is Phase C in `MULTIPLAYER_PLAN.md` and it
is a bigger job than the whole board was. Until then an ARENA online is a
**duel with spectators** — see §6.4.

### 3.2 SPLIT — a playfield each, everyone at once

Snap Strike, Odd One Out, Steady Hand, Meteor Dodge, Loot Catch, Tree Climb,
Grid Recall.

Two solitaires racing a clock. The one structure that divides the screen, and
therefore **the only one with a ceiling on how many people can be in it**.

A race is only fair if the playfields are identical (R5), so a SPLIT ignores the
seat ring and divides the screen evenly, taking only the *rotation* from where
people sit. On a 412×892 phone:

| Seats | Each playfield | Verdict |
|---|---|---|
| 2 | 412×400 | ✅ the shipped face-off |
| 3 | — | ✗ a rectangle has no three-way even division that gives every seat its own edge |
| 4 | 206×400 | ✗ under the 300×300 floor |
| 4, on a 820×1180 tablet | 410×544 | ✅ |

Three is not a size failure, it is a geometry one: split a rectangle three ways
and somebody lands in the middle band with nothing to brace a thumb against and
no way to read their own half right-side up.

**What makes it good.** It is the *only* structure that plays across phones with
no netcode at all — every device runs the same challenge from the same seed,
alone, and the scores are compared. That is why six of the seven are what online
rounds are made of today.

**The failure mode, and it is the roster's biggest one.** `MINIGAME_BACKLOG.md`
already named it: with a private playfield each, one player's action cannot
touch the other, so if P2 went to make tea P1's experience would be unchanged.
That is a leaderboard, not a two-player game. Five games were built and archived
for exactly this. **A new SPLIT needs a very good reason** — Loot Catch has one
(it is the payday game, and identical loot on both sides is what makes the
payout fair), and most candidates do not.

**The trap that has already been paid for.** A shared seed is *not* a shared
challenge. Two devices playing "the same" Meteor Dodge from the same seed
drifted apart within seconds, because a stream is only identical if both devices
consume it at the same points, and the games draw on a timer inside an animation
frame. One player got a kinder storm. Every draw a score depends on must be
taken **by index** — `SoloArena.draw(i)`, a hash of the seed and an integer — so
the 6th meteor is the 6th meteor on every phone whether it left at 4.9 s or 5.1.

### 3.3 TABLE — one board, taken in turns

Four in a Row, Memory Match.

The phone lies flat, nobody holds an end, and turns alternate. Nobody needs a
control zone because you touch the board itself, so a seat costs a 34 px banner
saying whether it is your go — four seats cost 68 px in total, and the board is
412×412 at two players and 412×412 at four.

A shared board is read from every side, so **it wants to be square** and its
faces want to be **unchanged by rotation**. Memory Match's twelve shapes were
chosen for exactly this — circle, ring, square, diamond, two stars, hexagon,
octagon, plus, cross, bars, dots — so one drawing reads correctly from both
sides of the table with no duplicated glyph and no meaning carried by colour.
At four players that constraint gets stricter, not looser.

**What makes it good.** It scales to four natively, it is the roster's slow beat
(and the pacing contrast is what makes the frantic games feel frantic), and it
is the second-cheapest thing to put across phones: a turn-based board only needs
the *move* on the wire, not a physics step. **If you want a four-player game
online in the next pass, build a TABLE.**

**The failure mode.** Idle time. Three people watching one person think is worse
than one person watching one person think. Both shipped TABLE games have a shot
clock for this reason (Four in a Row 5 s, Memory Match 4 s), and at four players
the clock has to come down again or the round runs past a minute. Memory Match
already runs to 58 s at two — a stated exception to the 15–40 s target, and not
one that has room to triple.

### 3.4 RELAY — a playfield each, taken in turns

Rhythm Forge.

One player plays at a time, on the whole screen, with everybody watching. The
cheapest structure there is: it costs one 34 px banner, the playfield is 412×766
at any player count, and **the pressure is free and total, because everyone is
watching the screen you are playing on.**

It is also cheap across phones — the only thing that has to travel is whose turn
it is and what they scored.

**What makes it good.** It is the one structure where "everyone can see
everyone's screen" is not a design problem to solve; it is what the structure
already does. And it is the only way a game with genuinely intricate controls
can be played by four people on one phone.

**The failure mode.** Dead time for three people. The fix is short beats and a
mark to beat: nobody's turn should run more than **8 seconds**, and the standing
best must be on screen the whole time, so a spectator is watching a number being
chased rather than a stranger tapping.

Rhythm Forge is the cautionary figure here: three rounds × two players already
takes **~57 s**, which is why it is the game the 90 s watchdog was sized around.
Doubling the players would double that. So a four-player RELAY halves the
per-turn length; it does not add rounds.

### 3.5 The modifiers

**ASYM — the seats do not have the same job.** Penalty is the only one shipped:
one shoots, one keeps, then they swap. It is laid over an ARENA and changes the
control budget, not the seating — the keeper's band and the shooter's band are
different sizes because their jobs are.

Asymmetry is the structural gap the backlog flagged and it is still barely
filled, and it scales to four *better* than symmetry does: one attacker and
three defenders is a game, four attackers is a scrum. **1-vs-3 is the most
promising unexplored shape in this roster.**

**TEAMS — four seats, two sides.** Only meaningful at exactly four. It turns any
2-player ARENA into a 4-player one without redesigning it: two mallets a side,
two tanks a side. Cheap, and the only structure change that makes an existing
ARENA scale without new mechanics. It also halves the number of things that have
to be legible at once, which is the real reason a 4-player ARENA is hard.

---

## 4. The law

> **A phone holds at most two private playfields. Past two, the playfield has to
> be shared or taken in turns.**

This is not a taste call. It is `MIN_PLAY` divided into 412 CSS pixels, and
`MinigameLayout.js` works it out from whatever viewport it is handed:

- A minimum touch target is **44 px** (§4 of the standard) and two of them need
  an **8 px** gap or they are one fat thumb. Five targets and their gaps is
  252 px, and anything with motion in it needs headroom over the bare minimum.
- The two halves the game ships with are **412×400** on the QA phone.
- A quarter of that same screen is **206×400**.

So the floor is **300×300**: comfortably under what already works, comfortably
over what a quarter-screen gives. On a 820×1180 tablet the same arithmetic
returns quarters of 410×544 and allows the four-way split — the rule is
*measured*, not assumed, which is what stops it becoming folklore about phones.

Ask the module rather than remembering the answer:

```js
import { shapesFor, CONTEXTS } from './config/MinigameLayout.js';

shapesFor(4, 412, 892);                      // ['arena', 'table', 'relay']
shapesFor(4, 412, 892, CONTEXTS.PHONES);     // ['arena', 'split', 'table', 'relay']
shapesFor(4, 820, 1180);                     // ['arena', 'split', 'table', 'relay']
```

`qa/layout.js` is the probe that keeps it true — 63 assertions, no browser, one
second. It exists because it is easy to agree with the law and then ship a
four-way split anyway, since on a desktop browser window it looks fine.

---

## 5. Real estate — the budget

Everything on screen during a minigame is either **the game** or **chrome**, and
the chrome is fixed. All of it comes off the two short edges; none of it comes
out of the middle.

| Reserve | Size | What it is |
|---|---:|---|
| `EDGE_RESERVE` | 46 px × 2 | R1b. `#mg-neutral` floats at each outer edge at ~42 px including margin. Puck and Penalty already reserve 46 (`PAD_Y`), so 46 is what the shipped games are drawn against. |
| `CTRL_BAND` | 76 px | One seat's controls at their own edge in an ARENA: a 44 px target with 16 px either side. |
| `BANNER` | 34 px | Whose turn it is, at their own edge. TABLE and RELAY. |
| `RAIL` | 34 px | The pressure rail (§6) — inside the 46 px band, not on top of it. |

On a 412×892 phone that leaves an inner box of **412×800**, and from it:

| Structure | 2 seats | 3 seats | 4 seats |
|---|---|---|---|
| ARENA (shared) | 412×648 | 412×648 | 412×648 |
| TABLE (board) | 412×412 | 412×412 | 412×412 |
| RELAY (playfield) | 412×766 | 412×766 | 412×766 |
| SPLIT (each) | 412×400 | ✗ | ✗ (206×400) |

On a 360×780 phone — the small end of what people actually hold — the same
figures are 360×536, 360×360, 360×654 and 360×344. **Every structure still
clears the floor at four players except SPLIT.**

### The three rules that follow

1. **Never draw in the outer 46 px.** Anything you put there — a goal mouth, a
   score, a control — is behind the status pill. Three of the four games in the
   last round shipped with a HUD row drawn behind it, and all three were found
   by a screenshot rather than by any assertion: the arcade sweep and botcheck
   both passed while a prompt was invisible.
2. **Chrome comes off the ends, never out of the middle.** The centre line is
   contested space in every ARENA (Clear Out's gap, Sumo's arena, Puck's
   face-off). A bar across it hides the thing you are playing with — which is
   exactly why the status strip stopped being a 76 px band in the flex column
   and became two floating pills.
3. **Measure, do not assume.** Take your rects from `frameFor()`. A hard-coded
   `h / 2` is a game that can only ever have two players in it, and there are
   twenty-two of those already.

---

## 6. Pressure — everyone can see everyone

The tension in this whole document: **a player needs to feel watched, and needs
room to play.** Those pull opposite ways — and the honest finding is that they
genuinely conflict in exactly one case, which is the one nobody has built yet.

### 6.1 One device — pressure is free, and you can only lose it

Two, three or four people around one phone are already looking at each other's
game. There is nothing to build. There are three ways to *break* it:

- **Covering a rival's state with your own.** An overlay that spans the screen
  during play, a full-width result banner, a modal. If it is not the shared
  object, it does not get the middle.
- **Making the state unreadable from the other end.** Every number that decides
  the round has to be legible from every seat — which means rotated for the far
  edge, and shaped rather than coloured (§4 of the standard). The mirrored
  status strip exists for exactly this.
- **Hiding the verdict.** The zone flash on win and loss is not decoration; it
  is the moment everyone at the table learns the result at the same instant.

### 6.2 Across phones — the pressure rail

This is the case that needs building. Four people each holding a phone can see
nothing of each other, so a round that used to be two people elbowing each other
becomes four people alone in a room, and the scoreboard at the end is the first
time anybody learns they were losing.

> **Pressure is a number that changes, not a picture.**

You do not need to see a rival's screen. You need the one part of it that is
aimed at you: their score, moving. So:

**THE PRESSURE RAIL** — one chip per rival along the top edge of your own
screen, carrying colour, icon, their live number, and a bar.

```
 ┌──────────────┬──────────────┬──────────────┐  ← 46 px band, 34 px chips
 │ 🎩 MO   14 ▓▓│ 🌿 ANA  22 ▓▓│ ⭐ SAM   9 ▓ │     137 px each at 4 players
 ├──────────────┴──────────────┴──────────────┤
 │                                            │
 │             YOUR GAME — 412×800            │
 │            (exactly as big as today)       │
```

Four properties, and the first is why this is the right answer rather than a
compromise:

1. **It is free.** Played alone the mirrored status strip is hidden — `SoloArena`
   calls `MinigameManager.setSoloMode` — so the rail takes a band that is
   *already reserved and currently empty*. The playfield across phones stays
   412×800, exactly the size it is today. Nothing is given up for it.
2. **It is cheap on the wire.** Scores at 2–4 Hz, not positions at 20 Hz. A
   parallel round has no shared simulation to keep in step, and adding one to get
   a pressure readout would be trading the entire reason parallel play works for
   a nicety.
3. **It reads the number the game already reports.** Every parallel game exports
   `soloScore()`. Some are composites — Meteor Dodge's is `lives * 1000 + dodges`
   — so a formatter table says how to display one:

   ```js
   export const MG_PRESSURE = {
       meteordodge: { label: 'LIVES', format: s => `${Math.floor(s / 1000)}❤ ${s % 1000}` },
       lootcatch:   { label: 'COINS', format: s => `${s}🪙` },
       treeclimb:   { label: 'HEIGHT', format: s => `${s}m` },
   };
   ```

4. **It has one loud moment: THE SURGE.** When a rival passes you, their chip
   flashes and your rank ticks. Rank changes are the only thing in a parallel
   round that is genuinely *news*, and a rail that only counts up quietly will
   be looked at once and then ignored.

Below **96 px a chip is a colour and nothing legible** — three rivals on a 412 px
phone is 137 px each, which is fine, and a narrower screen should drop to the
leader alone rather than show four unreadable chips. `railFor()` returns
`readable` so this is a branch and not a judgement call.

**What not to build:** a video or canvas mirror of a rival's screen. It costs
real bandwidth, it is unreadable at thumbnail size, and it takes back the real
estate the rail was careful not to spend.

### 6.3 RELAY on one device — the maximum-pressure structure

Worth stating on its own, because it is the answer nobody looks for: when one
person plays at a time on the whole screen, everyone else is *literally watching
their screen*. Full real estate and full pressure, at the same time, with no
mechanism at all. It is the only structure where the two goals do not trade
against each other, and the roster has one game in it.

### 6.4 The bystander problem

Offline at three or four players, the round's minigame is a duel picked by
rotation, and the players not in it "neither gain nor lose". That is a correct
implementation of a rule that should not exist: at four players, **half the
table is idle for forty seconds of every round**, and idle is the opposite of
pressure.

Three fixes, in order of preference:

1. **Build the round in a structure everybody can play** — ARENA, TABLE or RELAY.
   This is the real fix, and §3 says all three cost nothing at four players.
2. **Give the bystanders a call to make.** Before the duel starts, each
   spectator picks a winner; a right call pays a small amount (2–3 coins, well
   under `MINIGAME_REWARD` so it never rivals playing). It costs one card, it
   makes watching a decision, and it turns the duel into a table event.
3. **Make the duel's stakes public.** If the loser pays into a pot the whole
   table draws from, a spectator has a reason to care who wins even without a
   call to make.

**This is now built, and fix 1 is the one that shipped — twice.** The first
attempt was `RoundFormat`: every seat got a turn, in legs. That put everybody in
the round but left three of four people watching at any moment, which is the
same problem in better clothes. What shipped in the end is stronger — one game,
every seat in it, at the same time (§11) — and it deleted `RoundFormat`
entirely. There are no bystanders left offline, so the side-bet and the shared
pot in 2 and 3 are ideas for a round that no longer exists in that shape.

Two smaller pieces of the same problem went with it. Since a solo player can
seat three bots, the old rotation could draw two of them against each other:
forty seconds of nobody playing, on a screen whose single `isBot` flag describes
one slot, so a human drawn into the other half would have had nothing opposite
them. `chooseParticipants()` skips the pairings that are two bots, and
`_setRoster()` moves a lone bot into slot 1 whichever order the pair arrived in.
That second one was never about seat count: a Duel passes `[whoever landed on
the tile, their target]`, so in an ordinary two-player 1P match every duel the
**bot** started put the bot in slot 0 with nothing driving it.

Do not do nothing. Two players staring at a phone they cannot touch is the
worst screen in a four-player match.

---

## 7. Choosing a structure

```
                    how many people can touch the screen at once?
                                      │
              ┌───────────────────────┴───────────────────────┐
              │ one at a time                                 │ all at once
              ▼                                               ▼
     is there ONE board                              is there ONE thing they
     they all reach into?                            are fighting over?
              │                                               │
      ┌───────┴────────┐                             ┌────────┴────────┐
      │ yes            │ no                          │ yes             │ no
      ▼                ▼                             ▼                 ▼
   ══TABLE══        ══RELAY══                    ══ARENA══         ══SPLIT══
   4 players ✅     any count ✅                  4 players ✅      2 players only ✅
   cheap online     cheap online                  needs netcode     free online
```

And the shortcut, which is what you will actually use:

| I have… | Build |
|---|---|
| 2 people, one phone | anything. This is the case every shipped game covers. |
| 3–4 people, one phone | **ARENA, TABLE or RELAY.** Never SPLIT. |
| 3–4 people, one phone each, this pass | **SPLIT** (free) or **TABLE** (one move on the wire). |
| 3–4 people, one phone each, later | ARENA, once Phase C exists. |
| an existing 2-player ARENA to scale | **TEAMS** at four, or **ASYM** as 1-vs-3. |
| a game with fiddly controls and four people | **RELAY**, with ≤ 8 s turns. |

Then, and only then, run the tests that were already there:

1. **The shared-object test** (`MINIGAME_BACKLOG.md`): is there one thing they
   are fighting over, and can one player's action hurt or help another *in the
   moment*? SPLIT fails this by construction and needs a specific excuse.
2. **The verb test** (`MINIGAME_STANDARD.md` §7): is the feel in the hand
   different from everything already shipped?
3. **The rubric** (§6 of the standard): ≥ 12/16, no zeros.

---

## 8. Writing one

Start from `src/minigames/_template.js` and the standard's checklist. This
section is only what the structures add.

**Declare the shape.** In `MinigameRegistry.js`:

```js
MG_SHAPE.mygame    = 'arena';       // arena | split | table | relay
MG_MODIFIER.mygame = 'asym';        // optional
MG_NET.mygame      = 'local';       // 'parallel' ONLY if MG_SHAPE is 'split'
```

`qa/layout.js` checks that last line both ways: every `parallel` game is a
SPLIT, and every game with a shared playfield or a turn order stays `local`.
The two tables are two statements of the same fact, and if they disagree one of
them is wrong.

**Take your rectangles from the layout, not from `clientHeight / 2`.**

```js
import { frameFor, SHAPES, CONTEXTS } from '../config/MinigameLayout.js';

const f = frameFor(SHAPES.ARENA, seats, _overlay.clientWidth, _overlay.clientHeight,
                   { ctx: Solo.isSolo() ? CONTEXTS.PHONES : CONTEXTS.DEVICE, active: _turn });

// f.shared   the arena, if the structure has one
// f.seats[]  { seat, rect, rot, role: 'play' | 'control' | 'banner' }
// f.ok/why   whether this many people fit on this screen, and what stops them
```

Draw each seat's content by translating to its `rect` and rotating by its `rot`
— the same `translate/rotate(PI)` every shipped game already does for the top
half, generalised. Re-derive on `resize` (R4).

**Per structure, the extra obligations:**

| Structure | You must also |
|---|---|
| ARENA | Partition input by which seat's band the pointer is in, never by a hard-coded half. Keep every player's input in **their own frame** and resolve in one canonical frame (R1a) — but check the game actually *has* halves first: Light Cycles inverted P2's stick on a shared, un-mirrored grid and simply drove them backwards. |
| SPLIT | Take every draw a score depends on from `Solo.draw(i)`, never `Math.random()` and never the raw stream. Export `soloScore()`. Support `Solo.soloHalf()` and `Solo.pids()` so the same code runs full-screen alone. |
| TABLE | Make every face rotation-invariant, keep the board square, and put a shot clock on the turn. State whose go it is at **every** seat's edge, not just the active one. |
| RELAY | Keep a turn under 8 s, and keep the standing best on screen for the whole of everybody's turn. |
| ASYM | Both roles must be *doing something* at the same instant — Penalty's keeper commits as the ball is struck. A role that waits its turn is a RELAY wearing a costume. |

**Everything else is unchanged**: `dt` in seconds capped at 0.1 (R1), your own
id-less overlay into `#minigame-layer` (R2), `registerMinigameCleanup` and a
`_destroy` that releases everything (R3), DPR and resize (R4), `_done`-guarded
single `onWin` (R6), registered `sfx` names only (R7), and a bot that reads
`botSkill` with noise on every action (§5).

---

## 9. What has to be measured before it ships

The standard's checklist, plus five checks. Four of them have already caught
something real in this repo; the first is new and has caught nothing yet, which
is the point of writing it before there is anything to catch.

| Check | How |
|---|---|
| Does it fit at the player counts you claim? | `node qa/layout.js` |
| Can three or four people actually play it? | `node qa/livegames.js` — plays it at three seats and at four: a ready button per seat, the countdown waiting for the last of them, something actually drawn, a resolution on its own clock, and a score screen naming everybody. It found a `_bot is not defined` in Snap Strike's teardown (which hung the round forever) and an uninitialised array in Shape Snap's build (which the manager caught and resolved as a tie, so the game "passed" while being invisible). |
| Does the bag agree with the code? | `node qa/surfaces.js` — no browser. Every game's profile against a hand-written audit, and the three surface counts the plan is argued from. |
| Is it actually on the screen and running? | `node qa/soloframe.js` — reads the canvas back and asserts something was drawn in each half and that the frame changes. This is what would have caught Tree Climb drawing its entire tree below the bottom of the screen. |
| Is the skill dial connected to anything? | `node qa/botcheck.js` — read the wall clock at easy and hard. If the two tiers finish in the same time, it is not. Every game in this repo tuned by intuition has been wrong. |
| Does it resolve and tear down? | `node qa/arcade.js` |
| **Does it look right?** | Screenshot it at 412×892. Three layout faults in one pass were found this way and none by any assertion — all three rendered without a single error. |

And the structural questions the rubric does not ask:

- **At the player count you are claiming, does everybody have something to do
  every second?** If a third player is watching for thirty seconds, the answer
  is no and §6.4 applies.
- **Can every player see the state that decides the round, from where they are
  sitting?** Rotated, and shaped rather than coloured.
- **If a player put the phone down for five seconds, would anyone else notice?**
  If not, it is a leaderboard.

---

## 10. One game per structure, specified

Not built. Here to show the structures carry real games, and because a structure
you cannot name a game in is a category error.

| Structure | Game | Shape | Scales because |
|---|---|---|---|
| **ARENA ×4** | **CROWN RUSH** — one crown on a shrinking floor, four spheres, hold it longest. Momentum from Sumo, scoring from Steady Hand. | drag your band to roll; contact transfers momentum | one object, four players, and the arena shrinking is what stops four bodies being a scrum |
| **TABLE ×4** | **CLAIM** — a 6×6 grid of face-down tiles, take one on your go, adjacency scores. Rotation-invariant glyphs, 4 s shot clock. | tap a tile | turns; a fourth player costs a 34 px banner |
| **RELAY ×4** | **THE MARK** — 8 s at the tree each, the standing best pinned to the top of the screen the whole time. | Tree Climb's verb, one player at a time | full screen each, everybody watching, zero layout cost |
| **ASYM 1v3** | **THE HUNT** — one player sweeps a light across the arena, three creep toward the exit and must freeze in it. Freeze's verb, inverted, with the watcher played by a person. | one band for the hunter, three for the prey | asymmetry gets *better* with more prey, not worse |
| **TEAMS 2v2** | **DOUBLES** — Puck with two mallets a side. | unchanged from Puck | halves what has to be legible at once |
| **SPLIT ×4 (phones only)** | already shipped — Meteor Dodge, Loot Catch, Tree Climb, and three more. | | same seed, no netcode |

The gap that jumps out of that table: **ARENA is 12 of 22 games and none of them
has been played by more than two people.** The cheapest real four-player round
available today is a TABLE, and the roster has two.

---

## 11. Everybody plays: one game, every seat, at once

*(Built. `MinigameManager` roster + `MinigameLayout.zonesFor()`. `qa/livegames.js`
drives it. `MG_PROFILE.live` is the flag.)*

§3 says the four structures are properties of a GAME. This section is about the
ROUND, and it has one rule:

> **A round is one game, and everybody in the match is in it.**

There is no bracket and no relay. Both existed, both were shipped, and both are
gone, because each of them answered "how do four people share one game" with
"they take turns", and taking turns is the thing the round is supposed to
prevent. A bracket at four seats is three games with two people watching two of
them; a relay is four solitaires with three people watching each. Neither is a
party game — they are a queue with a scoreboard.

What replaces them is not a round format at all. It is a property of the game:

### LIVE — the flag that means "this game can seat everybody"

`MG_PROFILE[type].live` is true when the game's own code has been written
against the number of players rather than against the number 2. Three things
make a game live, and all three are visible in `src/minigames/QuickDraw.js`,
which is the reference:

1. **It asks `slotCount()`** instead of assuming two, and every per-player array
   is that long — score, lockout, bot timer, the lot. A game with `[0, 0]` in it
   is not live, whatever else it does.
2. **It takes its zones from `MinigameLayout.zonesFor(n, w, h)`**, which returns
   one rect and one rotation per seat, tiling the inner box: the shipped
   face-off at two, corners at four. The game never computes a half-screen.
3. **It asks `isBotSlot(slot)` per slot.** The single `isBot` argument only ever
   described slot 1; above two seats there can be three bots and each needs its
   own timer.

At two players a converted game is byte-for-byte the game that shipped: two
full-width halves, the far one rotated. `zonesFor(2, w, h)` *is* the face-off.
That is the property that made the conversion safe to do game by game.

### The three surfaces, and which games reach them

`surfacesOf(type)` derives all of it from the profile; nothing is hand-listed.

| Surface | Rule | Today |
|---|---|---|
| **Shared screen, 2P** | everything | 22 of 22 |
| **Shared screen, 3–4P** | `live` **and** seats reach 3+ **and** control is not `dual` | 12 — `roomy` puts six of them on a tablet |
| **Online, 2–4P** | wire tier is anything but `exact` | 15, of which 6 (`wire: 'none'`) run today |

**`roomy`** is the one thing the derivation cannot work out for itself: whether
a quarter of a *phone* is enough room for this game's zone. Six games declare
it, and each for a measured reason — Odd One Out's grid reaches 5×5, which is a
34 px tile on a phone quarter against the control law's 44 px floor; Grid
Recall's 4×4 is 38 px; Steady Hand's target *drifts*, and Meteor Dodge's and
Loot Catch's playfields have things falling the length of them; Tree Climb's
stem scrolls at 74 px a branch, so a 400 px quarter shows five branches of tree.
`eligibleTypes()` enforces it: on a phone at 3–4 seats, a `roomy` game is simply
never dealt.

### Two shapes of conversion, and the second is the interesting one

**A private playfield each** widens the obvious way: size the arrays to
`slotCount()`, take the zones from `zonesFor()`, give each bot its own timer.
Six games went this way and all six are `roomy`.

**A shared playfield does not divide at all.** Light Cycles, Grand Prix and Sumo
Spheres keep one arena, one circuit, one ring — and partition only the INPUT, a
floating stick or a throttle pad per quadrant. Quartering those would produce
four people playing alone in adjacent boxes, when being in each other's way is
the entire game. It is also why they are the games that work at four **on a
phone**: a whole arena needs no more room at four than at two, only more
control zones, and a control zone is a thumb.

**A short bag is said out loud, not hidden.** `bagDepth()` returns how many
games this table can play and how many more a tablet would add, and the lobby
prints it. Four people on a phone get a shallower bag than four people on an
iPad, and they are told so before the match rather than by the third repeat.

### The ready gate belongs to everybody

The gate used to be two buttons written into `index.html`, at the top and the
bottom. That is a fine gate for a face-off and it is the reason a three- or
four-player round could not be *started* by the people in it.
`_buildReadyButtons(n)` now builds one per slot, labelled with that player's
name, placed where they are sitting — the two originals keep the middle of their
own edge, slots 3 and 4 take the right-hand corners, and the far ones are
rotated. The countdown fires when `state.mgReady.slice(0, slotCount())` is all
true, and not before. Bots ready themselves, all of them, on staggered timers.

**The round pays once**, as it always did — one `MINIGAME_REWARD` to one seat,
one 30-coin cap on the haul. That was the hard constraint the bracket needed a
whole leg mode to respect; with one game per round it is simply true.

### The progress system

Everybody is playing, so the question "how are the others doing?" is answered
inside the game rather than around it:

| Piece | When | What it carries |
|---|---|---|
| **The zone** | throughout | each player's own name, score and state, in their own colour, facing them |
| **The neutral strip** | throughout | the score line for every seat at once — `_scoreLine()` in each live game |
| **The score screen** | at the end | a row per slot, ranked, with the payout |

The pressure comes from the zones being adjacent. You can see the tile your
neighbour is hunting, and their score climbing next to yours, without looking
away from your own grid. That is the whole point of tiling one screen instead of
handing out four.

**Across phones it is the same information, fed differently.** There is no
shared object to read — each phone runs its own copy — so the host is the only
truth. Every playing phone sends its running score twice a second (`mgTick`),
the host merges them and broadcasts a `soloStand` beat, and every device paints
`RoundBoard.netRail`: one chip per player, their score, the leader in gold. A
tick decides nothing; the round is still settled by `mgScore`, so a lost one
costs a frame of a readout. A seat that has finished shows its **final** score
rather than its last tick, or somebody who has already put their number up
appears to be losing it.

### The duel stays a face-off

One thing on the board is deliberately NOT the whole table: the **duel tile**,
and the **ally steal/claim** fight that works the same way. Those are a wager
between two named players — coins staked, one against one — and `qa/fourlocal.js`
asserts the distinction rather than leaving it to drift: every round whose
`mgContext` is a board round seats everybody, and only `duel`, `ally_steal` and
`ally_claim` are allowed to seat two.

It was put to the owner as a choice, because "nobody waits" argues for widening
it: everybody plays the live game and the wager settles on which of the two
duellists placed higher. The call was to **keep the face-off**. A duel is a
confrontation between two people who chose each other, and at roughly one round
in six the cost — two people watching for one game — is worth the thing it buys.

### What this does not reach

Twelve games are live and ten are not, and on a shared screen at three or four
seats those ten are **not dealt** — the bag holds only what the table can
actually play. Every one of the ten is now a decision rather than a backlog
item, and `blockedReason()` says which: frame-exact contact (five), a turn order
(two), two-sided by construction (Clear Out and Freeze), and twin-stick controls
that need a screen each (Tank Clash). `MINIGAME_CATEGORIES.md` §9 has the table.

A 3–4 player match draws from twelve games on a tablet and six on a phone, so a
six-round match on a tablet no longer repeats.

Online is a different eighteen: six parallel games run across phones today, nine
more need the wire tiers in `MULTIPLAYER_PLAN.md`, and seven are `exact` — one
simulation two people reach into — and stay two-player.

The two claims this section used to make and no longer does: that all
twenty-two games are playable by three or four people locally (they were,
through the bracket, with people watching), and that a relay is an answer to the
bystander problem (it is the bystander problem, dealt out one at a time).

---

## 12. What is built, and what is not

**Built:**

- `src/config/MinigameLayout.js` — the four structures as geometry: the seat
  ring, the chrome budget, `frameFor()`, `shapesFor()`, `railFor()`, and the
  300×300 law measured against whatever viewport it is handed.
- `MG_SHAPE` / `MG_MODIFIER` in `MinigameRegistry.js` — all 22 shipped games
  classified, and `MG_NET` shown to agree with it.
- `qa/layout.js` — 63 assertions, no browser. Overlap, containment, rotation,
  the law at three viewports, the "a third player is free" claim at 2/3/4, the
  rail's geometry, and the two registries agreeing.

- **`MG_PROFILE.live` + `MinigameLayout.zonesFor()` + the N-seat roster in
  `MinigameManager`** — §11. One game, every seat in it, at once. Four games
  converted; the other ten are deliberately two-player and are not dealt at
  three or four seats. `qa/livegames.js` plays every live game at 3 and at 4.
- **The ready gate at N** — `_buildReadyButtons(n)`, one per seat, labelled and
  placed where that player is sitting; the countdown waits for all of them.
- **Live standings across phones** — `mgTick` up, `soloStand` down, the same rail.

**Specified here and not built:**

- **The surge.** The rail counts up; a rival *passing* you is not called out.
  Rank changes are the only genuinely new information in a parallel round.
- **A bystander stake.** §6.4's side bet and shared pot. Offline there are no
  bystanders left to give one to, so this only applies if a duel format ever
  comes back.
- **Any game using `frameFor()`.** All 22 compute their own halves. Nothing is
  broken by this — the module is additive — but the law is only enforced on
  games that ask.
- **A ready gate for more than two seats.** Beats 3–5 are hard-wired to two:
  `index.html` has exactly two `#mg-ready-*` buttons, `setReady` waits on
  `state.mgReady[0] && state.mgReady[1]`, and the intro card's dual confirm is
  `_introReady = [false, false]`. An ARENA, TABLE or RELAY round with three or
  four people on one device fits on the screen and currently cannot be started
  by all of them. **This is the first thing to build** — it gates every
  structure in §3 except the one that already runs across phones without a
  gate at all.
- **ARENA, TABLE or RELAY at three or four players.** The geometry says they fit.
  Whether four people around one phone can play any of them is a question a
  probe cannot answer, and the answer is a person with the phone.

**The one number to argue with:** `MIN_PLAY = 300`. It is derived, not measured
— five targets and their gaps, plus headroom, checked against the 412×400 that
already ships. If a real four-way split on a real tablet turns out to be fine at
280, move the constant; everything in this document follows from it.
