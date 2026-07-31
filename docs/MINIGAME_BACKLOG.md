# Minigame Backlog

Design brainstorm for the arcade. Companion to `MINIGAME_STANDARD.md` — that
document says *how* to build one; this says *which one to build next and why*.

**The curation rule that drives everything here:** one game per verb. A roster of
20 games that are all "tap the thing fast" is a roster of one game. What makes
the arcade feel large is that each entry asks for a different *kind* of thinking.
Before adding anything, name its verb and check nothing else owns it.

---

## Shipped — 20 games, 20 verbs

| # | Game | Verb | Notes |
|---|---|---|---|
| 1 | Sumo Spheres | push / momentum | 3D. Arena closes from 22 s |
| 2 | Tank Clash | aim & fire | 3D. 42 s cap, 900 ms mercy window |
| 3 | Rhythm Forge | tap to the beat | Turn-based, 3 rounds |
| 4 | Orb Deflect | draw deflecting paths | |
| 5 | Snap Strike | tap at the right instant | Reference implementation |
| 6 | Quick Draw | be fastest, don't jump | |
| 7 | Grid Recall | recall & reproduce | Race format |
| 8 | Tug Tap | out-tap your opponent | |
| 9 | Odd One Out | spot the difference | |
| 10 | Steady Hand | keep on a moving target | |
| 11 | Sort Rush | bin it left vs right | |
| 12 | Meteor Dodge | dodge the falling storm | |
| 13 | Loot Catch | catch good, reject bad | |
| 14 | Freeze | move only when unwatched | |
| 15 | Clear Out | slingshot discs off your side | |
| 16 | **Tower Stack** | **stack & align** | New |
| 17 | **Parry Duel** | **read & counter** | New — the only pure mind game |
| 18 | **Circuit Trace** | **trace a route without crashing** | New |
| 19 | **Hot Streak** | **risk appetite / greed** | New |
| 20 | **Keep Up** | **sustain & juggle** | New |

### Why these five

The roster was fifteen games of *motor skill* — reaction, accuracy, tracking,
dexterity. Good ones, but a player's ranking across all fifteen was roughly the
same ranking. These five deliberately widen the axis:

- **Parry Duel** is the big one. It is the only game where you are playing the
  *person* rather than the screen, so it is the only one whose replay value comes
  from history with a specific opponent. Two players who've played it ten times
  are playing a different, better game than two who haven't. Nothing else in the
  roster does that.
- **Hot Streak** removes execution entirely — there is no way to be "good at
  pressing", only at judging. It is the game a non-gamer can win.
- **Tower Stack** is the compounding-error game: your sloppiness is preserved in
  the slab width, so mistakes have a tail rather than resetting each round.
- **Circuit Trace** is speed-vs-precision, a trade-off no other entry makes you
  price.
- **Keep Up** is the only game where your own success raises the difficulty.

Between them they cover: mind game, judgement, spatial precision, route control,
and load management. A player who tops the leaderboard on all twenty is genuinely
broad.

---

## Backlog — ranked

Scored against the §6 rubric (0–2 each; ship at ≥12/16). Estimates are for a
game built properly to the standard, roughly 300–400 lines.

### Tier A — build next

**A1 · CODE CRACK** — *verb: deduction*
Both players get the same hidden 3-symbol code. Guess; each guess returns
🟢 right symbol right slot / 🟡 right symbol wrong slot. First to crack it wins.
The only game in the roster that rewards *reasoning* rather than execution, and
the only one where watching your opponent's guess count creates pressure.
Risk: pace. Cap at 6 guesses and 35 s, and keep the alphabet to 4 symbols so a
first guess is never hopeless. **Est. 14/16. Effort M.**

**A2 · LAND GRAB** — *verb: territory*
Your half is a grid. Drag to sweep tiles into your colour; tiles decay back to
neutral over a few seconds, so holding ground costs attention. Most tiles held
when the clock stops. The pull between expanding and defending is a genuinely
new decision shape.
Risk: needs to stay readable at a glance — use fill *pattern* as well as colour.
**Est. 13/16. Effort M.**

**A3 · SHORT FUSE** — *verb: forced tempo / hot potato*
A lit fuse burns on a shared timer. Tapping your side passes it to your rival and
adds a little time — but each pass burns faster. Whoever holds it when it blows
loses the round. Best of 3. Pure escalating tension with a two-button rule set.
Risk: very close to Tug Tap's mash feel if the tap rate is what matters — make
*timing of the pass* the skill, not tap speed. **Est. 13/16. Effort S.**

### Tier B — good, with a caveat

**B1 · WIRE UP** — *verb: routing under constraint*
Connect matching terminals on a small grid without crossing your own wires.
Distinct and satisfying, but puzzle pacing is hard to fit in 30 s and generating
solvable-but-not-trivial boards is the real work. **Est. 12/16. Effort L.**

**B2 · BLIND BUILD** — *verb: instruction-following from memory*
A target shape flashes, then vanishes; rebuild it from blocks. Overlaps Grid
Recall's memory verb more than it first appears — the distinguishing element is
*construction*, so it lives or dies on the assembly being satisfying.
**Est. 11/16. Effort M.** Concept exists in `archived/BlindBuild.js`.

**B3 · SPLIT THE POT** — *verb: secret bidding*
Each round both secretly commit 1–5 of a shared pool; higher bid takes the pot
but spends the coins. Real depth, but the state is hard to make legible in three
seconds and it risks feeling like homework next to the physical games.
**Est. 11/16. Effort M.**

### Tier C — attractive but redundant

Listed so they don't get re-proposed. Each duplicates a verb already owned:

- *Whack-a-target* → Snap Strike / Odd One Out
- *Pong / volley* → Orb Deflect
- *Maze runner* → Circuit Trace
- *Simon sequence* → Grid Recall
- *Balance the beam* → Steady Hand
- *Fruit-slice* → Loot Catch (intercept), Clear Out (flick)
- *Trivia / word scramble* → language-dependent; breaks the "no reading required"
  accessibility the rest of the roster keeps

The 40 files in `src/minigames/archived/` are a concept mine for the above, not
code to revive — their imports and shared-DOM assumptions are dead (§7).

---

## Bot tuning — measured, not guessed

`qa/botcheck.js` drives each game's AI at easy and hard with **no human input at
all**. Three of the numbers it produced changed the code:

| Game | Before (easy → hard) | What it exposed | After |
|---|---|---|---|
| Tower Stack | 18 → 61 floors | Hard dropped ~2.2 slabs/s — faster than a person can reasonably tap. Added a cadence floor. | curve retained, ceiling lowered |
| Tank Clash | 0 → 0 hits | **Neither tier could hit a *stationary* target in a whole 42 s match.** The aim error is added to a unit direction, so a 0.9 scale is ~7.7° off even at hard — wider than a tank at across-arena range. Raising tank speed from 3 to 8 u/s made it worse, because on this hull aim *is* movement. Cut the scale to 0.30 and tightened the fire gate. | hard now wins in **7 s** |
| Keep Up | 136 → 95 pts | **Difficulty was inverted** — easy out-scored hard. Skill raised the strike line, but punting *late* is the stronger play: the orb re-enters the strike zone sooner, so you land more hits. Flipped the mapping. | **142 → 234 pts** (combo 32 → 45) |

None of these throw. None show up in a code review. None are visible in a single
playthrough. They are only findable by running the bot against itself and reading
the scores — which is the argument for keeping `botcheck.js` in the loop whenever
a bot is touched.

**Still open:** Tank Clash's *easy* bot lands zero hits on a stationary target.
That is arguably correct for a tier whose brief is "losable-to by a distracted
adult", but a bot that cannot score is not much of a contest either. Whether the
three tiers actually feel like easy / medium / hard against a **human** is a
playtest question that no automated run can answer.

## Rules of thumb learned building these

1. **Both halves must be able to lose at once.** Anything where one player's
   input can starve the other's (shared object, shared timer) breaks face-off
   symmetry. Hot Streak gives each player their *own* hidden burn-out point for
   exactly this reason.
2. **Put the rules on the screen.** Parry Duel prints "beats ⚡" under each
   stance; Keep Up prints "tap orbs · let 💣 fall". If it needs the intro card to
   be playable, it fails the 3-second rule.
3. **Escalate on the clock, not on the score.** Ramping difficulty when a player
   is *winning* punishes success and produces runaway comebacks. Both Keep Up and
   Tower Stack escalate purely on elapsed time, identically for both players.
4. **Decide how it ends before you build it.** Every new game here has an
   explicit clock and settles on the current score. The manager's 90 s watchdog
   is a bug signal, not an ending.
5. **The bot's skill should map to the game's actual skill.** In Parry Duel
   `botSkill` is pattern-reading, in Hot Streak it is judgement, in Circuit Trace
   it is crash rate. Copying the reaction-delay formula into a game that isn't
   about reaction produces a bot that feels broken at every tier.
6. **Then check the mapping points the right way.** Keep Up's first cut had
   `botSkill` make the bot react *sooner*, which sounds like skill and measured
   as the opposite. Assume the sign is wrong until a run says otherwise.
7. **Watch for aim that is also movement.** Tank Clash's hull faces its travel
   direction, so raising the tank speed silently widened every shot. Coupled
   systems need re-tuning together, not one at a time.
