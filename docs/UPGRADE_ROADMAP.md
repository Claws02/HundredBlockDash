# Hundred Block Dash — Upgrade Roadmap

Companion to `QA_REPORT.md`. That document says what is broken. This one says
what would make it read as a finished product rather than a very complete
prototype.

**Honest position first.** The engineering here is better than the game is. The
architecture is genuinely good — clean engine/UI separation, a registry-driven
minigame system with a written standard, data-driven rules, self-hosted physics
libraries with a boot guard. What's thin is everything a player experiences
*between* the mechanics: there is no progression, no reason to play a second
match, no audio identity, and until this branch, no way to ask for a short game.
The gap to "real game" is a content and retention gap, not a code-quality gap.

Tiers are ordered by **player-felt value per unit of work**, not by difficulty.

---

## Tier 0 — Done in this branch

Listed so the baseline is unambiguous. Detail in `QA_REPORT.md`.

- 9 unobtainable City Contracts fixed; contract progress now per player (QA-001)
- Renderer mesh/material leak and frozen ambient animation fixed (QA-002)
- All 15 minigames register teardown; force-end no longer leaks WebGL (QA-003)
- Bot difficulty now actually applies in all 15 minigames (QA-004)
- Ally-steal orphan mesh, dice soft-lock watchdog, HBD Rift movement loss,
  HBD finish label, dead MAP button, silent `sfx` names, duplicated board data
  (QA-005 … QA-012)
- TankClash uncaught TypeError on frame-0 fire input (QA-016)
- **City Circuit match length: 6 / 12 / 20 rounds**, default Standard (DF-01)

**Arcade expansion (second pass):**
- Sumo Spheres and Tank Clash retuned for speed — see `MINIGAME_BACKLOG.md`
- Duration floor and ceiling now enforced in code, closing DF-04 and DF-05
- Five new games were added and then **archived after playtesting** — they were
  solo score-attack duplicated across a divider, not two-player games. Roster is
  back to 15. Post-mortem and the revised selection test are in
  `docs/MINIGAME_BACKLOG.md`

**Scene pacing & flow (third pass)** — full write-up in `docs/SCENE_PACING.md`:
- **`SceneTiming.js` + `Director.js`**: every beat of a turn is named and has a
  minimum dwell. A beat owns the screen until its floor elapses; the next one
  cannot start early. Replaces ~30 anonymous `setTimeout` literals that let two
  scenes render at once.
- **The payoff beat now holds for 3 s** — measured; it previously had *no*
  guaranteed screen time at all and the minigame hand-off overwrote it 300 ms
  after CONTINUE.
- **Dice settle fixed.** `angularDamping` 0.4 → 0.85: at 0.4 the spin decay
  needed ~13 s to reach the sleep threshold, so the dice never settled and every
  roll ran out the safety timeout. Measured median for the rolling beat was
  **7.4 s**. Also raised physics `maxSubSteps` 3 → 6 so a slow device doesn't
  run the simulation in slow motion.
- **Crash fixed:** `readResult()` dereferenced `activeDice[0].mesh` with no
  empty-array guard; caught live by the scene probe.
- **The MAP button works on both boards.** `setMapCameraTarget` did a City-only
  lookup for numeric indices, which is why it was disabled on Hundred Block
  Dash. The map now shows realm, block number and distance to the player.
- **Practice mode**: every minigame can be played with no stakes, from the
  arcade (🎯 PRACTICE) or from the pre-match intro card (TRY IT FIRST). Verified
  to leave coins, position, turn order and win counts untouched.

---

## Tier 1 — The "why would I play again?" tier

This is the single biggest gap. The game currently has exactly one persisted
number: a win/loss record against the bot. Everything else evaporates when the
tab closes. A player who finishes a match has no reason to start another.

### 1.1 · Progression spine — unlocks with a cost curve
**Effort: M · Impact: Very high**

There is already a persistence layer (`Storage.js`, `hbd_`-namespaced, guarded
against private-mode failure) and a stats module. Extend it into a profile:
lifetime coins banked, matches played, per-minigame win rates, realms reached.

Then spend it. Concretely, and reusing what exists:

- **Characters as unlocks.** Nine characters are currently nine identical picks
  (DF-03). Ship four unlocked and gate five behind milestones ("Reach the Crown
  on a 100-block run", "Win 5 duels"). Costs nothing mechanically — the value is
  that the character select screen becomes a record of what you've done.
- **Minigame mastery.** Per-game best score and a bronze/silver/gold tier. The
  arcade already lists all 15; add a medal to each card. This is the cheapest
  retention hook available because the arcade is already built.
- **Board unlocks.** `MAP_REGISTRY` already supports `available: false` with a
  "COMING SOON" badge. Reuse it for `locked: true` with an unlock condition.

**Watch out for:** don't gate the *bot difficulty* selector or anything
affecting fairness behind progression. Unlock cosmetics and content, never
capability.

### 1.2 · Daily challenge with a fixed seed
**Effort: S–M · Impact: High**

Board generation is already deterministic given a seed — `BoardSetup.js` uses
`Math.random()` in `_shuffle`, `_drawBag` and `_spacedBadPositions`, all of which
are trivially swappable for a seeded PRNG. Derive the seed from the date, run a
fixed length, and record the result. One match per day, same board for everyone,
a personal best to beat.

The seeded-RNG refactor is worth doing regardless: **it makes bugs
reproducible.** Today a bad board layout cannot be reported or re-tested.

### 1.3 · Match summary that tells a story
**Effort: S · Impact: Medium-high**

`WinScreen.js` already computes a solid stat block. What's missing is narrative:
biggest single swing, longest minigame streak, the round the lead changed hands.
The data is nearly all tracked already (`coinsEarnedThisRound`,
`consecutiveMgWins`, `duelsWon`). Cheap, and it's what people screenshot.

---

## Tier 2 — Feel and identity

The mechanics land; the presentation doesn't yet have a signature.

### 2.1 · Audio identity
**Effort: M · Impact: High**

`AudioManager.js` is entirely synthesised Web Audio beeps — impressively
compact, and it means zero asset weight and no load failure. But it is
functional, not characterful, and there is **no music at all**. Options in
increasing cost:

1. Keep the synth engine, compose actual motifs: a per-realm drone (the four HBD
   realms already have distinct palettes to score against), a rising cue as you
   near the Crown, a duel sting. Still zero assets.
2. Add a small set of compressed loops with a synth fallback if fetch fails —
   the same defensive pattern already used for fonts and physics libraries.

Fix **QA-013** here too: self-host the two fonts. Three.js and Cannon.js were
self-hosted precisely because a blocked CDN blanked the screen; typography still
has that dependency.

### 2.2 · Camera and impact
**Effort: S · Impact: Medium**

The 3D board is the game's best asset and the camera under-sells it. Add a punch
on landing a big coin, a slow push-in on the Rift roll, a held beat on the
winning move. `Renderer.js` already has a flyover system and an `activeAnims`
tween list to build on. Gate all of it behind the existing `reduceMotion`
setting, which is already wired and honours the OS preference.

### 2.3 · Onboarding that teaches by playing
**Effort: M · Impact: Medium**

The current How-to-Play is six text slides shown once. Replace with a scripted
three-turn first match: forced rolls onto a coin, a shop and a minigame, with
inline callouts. Costs nothing in new systems — it's a scripted sequence over
existing mechanics — and it's the difference between a player understanding
contracts and never noticing them.

---

## Tier 3 — Content depth

### 3.1 · Rebalance the Void
**Effort: XS · Impact: Medium** *(DF-02)*

`swap_space` sits in `GOOD_WEIGHTS.void`. In the realm that decides the race, a
forced position swap is the single worst outcome for whoever is ahead. The bot's
own table rates it `0`. Either move it to `BAD_WEIGHTS` or — better, because
it's a genuinely interesting space — make it a **choice**: land on it and elect
to swap or take 5 coins. Comeback mechanic instead of a coin flip.

### 3.2 · Give characters one differentiator each
**Effort: M · Impact: Medium** *(DF-03)*

Abilities were deliberately removed in `6463bab`, presumably for balance, and
that was a reasonable call. If they come back, make them **small and legible** —
a starting item, +1 inventory slot, a 10% shop discount — not percentage
modifiers on dice. Ship them as a toggleable "Character Powers" match option so
the balanced mode stays available. Do **not** re-add anything that changes roll
distributions.

### 3.3 · Minigame duration guards — ✅ partly done
**Effort: S · Impact: Medium** *(DF-04, DF-05)*

Done: Tank Clash has a 42 s cap that settles on HP plus a 900 ms post-hit mercy
window (it could previously end in 4 s); Sumo Spheres now starts closing its
arena at 22 s instead of 30 s; all five new games run on explicit clocks. The
rule is written into `MINIGAME_STANDARD.md` §3 as an enforced floor and ceiling.

**Still open:** Rhythm Forge, Orb Deflect, Quick Draw, Freeze and Clear Out have
no hard ceiling of their own and can still reach the manager's 90 s watchdog when
one side disengages. Same fix — a clock that settles on the current score.

### 3.4 · A third map
**Effort: L · Impact: Medium**

`MAP_REGISTRY` is built for this and has a commented-out Wild West stub. Worth
doing only *after* Tier 1 — a third board multiplies content but adds no reason
to return. Progression does that.

---

## Tier 4 — Infrastructure

Not player-facing, but this is what lets the tiers above ship without regressions.

### 4.1 · Keep the QA harness in CI
**Effort: S · Impact: High for velocity**

`qa/` is committed with this branch. Four scripts — `smoke.js`, `verify.js`,
`leak.js`, `earlytap.js` — are deterministic and exit non-zero on failure; they
run in ~12 minutes combined and are the natural pre-merge gate. It catches exactly the class of bug that
was found here: silent subsystem death, resource leaks, soft-locks. `earlytap.js` alone found the only
uncaught exception in the audit (QA-016) — a race no ordinary playthrough
reaches. Treat `run.js` and `arcade.js` as a nightly soak.

The contract test is the template worth generalising: **assert that every entry
in a data table has a working code path.** The same shape would have caught
QA-001 the day it was introduced, and would catch it again if a new contract type
is added without an emitter.

### 4.2 · Seeded RNG
**Effort: S · Impact: Medium**

Prerequisite for 1.2, and independently valuable: reproducible boards mean
reproducible bug reports.

### 4.3 · Retire or convert the archive
**Effort: S · Impact: Low** *(DF-06)*

The 40 archived prototypes are ~9,000 of ~24,000 lines and are documented as a
design backlog whose code is dead. Convert to a single markdown index of concepts
and delete the source, or move it out of `src/` so line counts and searches
reflect the live game.

---

## Suggested sequence

| Phase | Contents | Rationale |
|---|---|---|
| **Now** | Tier 0 (done) + 3.1 Void rebalance + 3.3 duration guards | Correctness and balance, all small |
| **Next** | 4.2 seeded RNG → 1.1 progression → 1.3 match summary | Progression is the retention unlock; seeded RNG unblocks it and pays for itself in debuggability |
| **Then** | 2.1 audio + fonts, 2.2 camera juice, 1.2 daily challenge | Identity and the daily hook, once there's a reason to return |
| **Later** | 2.3 playable onboarding, 3.2 character powers, 3.4 third map | Depth, after retention works |
| **Ongoing** | 4.1 harness in CI | From now on |

---

## The one thing to do first

Fix the Void's `swap_space` classification (**XS**, one line in
`BoardSetup.js`), then build the **progression spine (1.1)**. Everything in Tier
2 and 3 makes an individual match better. Only Tier 1 makes someone start a
second one — and that is the actual difference between this and a real game.
