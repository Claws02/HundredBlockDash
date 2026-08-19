# City Circuit — audit and rework

**Date:** 2026-08-19
**Branch:** `claude/indie-game-qa-upgrade-uy7at5`
**Scope:** City Circuit only. Hundred Block Dash was not changed except where a
fix lives in shared code (the camera, the ally hand-off).
**Method:** source audit of the City path end to end, plus a new automated probe
(`qa/city.js`, 36 assertions) driving the real game in Chromium, and re-runs of
the existing suite.

---

## 1. What was wrong

City Circuit is the board where the player makes a decision — which of four
districts to run, or whether to stay on the ring. Almost everything below is a
version of the same failure: **the game kept taking that decision away, or
hiding the information needed to make it.**

| # | Defect | Severity | Status |
|---|---|---|---|
| C-01 | An ally minigame permanently kills the follow camera | **P0** | Fixed |
| C-02 | The follow camera is frame-rate dependent and aims off a jittering heading | **P1** | Fixed |
| C-03 | The junction choice covers the board it is asking you to look at | **P1** | Fixed |
| C-04 | Nothing explains the board's shape before the first junction | **P1** | Fixed |
| C-05 | Seven spaces per board undo the route you just chose | **P1** | Fixed |
| C-06 | Two bounties in the pool were impossible; the rest were unreadable | **P2** | Fixed |
| C-07 | The map view pans four times faster than a thumb expects, with no bounds | **P2** | Fixed |
| C-08 | A teleport makes the camera drift across the whole city | **P2** | Fixed |
| C-09 | One autoplay run reached PRE_ROLL with the HUD still hidden | **P2** | Guarded |

---

### C-01 — An ally minigame permanently kills the follow camera · **P0**

**The reported symptom:** "the ally currently broke the camera and no longer
follows the players."

`MinigameManager.endMinigame()` hands the camera over in `cameraState =
'FLYOVER'` and expects whoever asked for the minigame to give it back. Three of
the four callers do. The ally handler did not:

```
GameController.js  _resolveMinigameResult  → startPostMinigameFlyover(→ 'FOLLOW')  ✓
GameController.js  _startDuel              → startPostMinigameFlyover(→ 'FOLLOW')  ✓
MinigameManager    standalone / practice   → 'INIT'                                ✓
GameController.js  _startAllyMinigame      → (nothing)                             ✗
```

`Renderer._loop` only drives the camera under `FOLLOW`, `MAP` or `JUNCTION`. Left
on `FLYOVER`, no branch runs: the camera is frozen exactly where the minigame
left it and **never moves again for the rest of the match**, through every
remaining turn of both players. One ally encounter — a routine event the game
schedules on its own from turn 1 — is enough.

It renders, it does not throw, and no probe caught it because no probe asserted
that the camera *tracks* anything.

**Fixed two ways.** The ally handler now restores `FOLLOW` and snaps to the
active player — it has to be immediate, because the turn carries on mid-move
from there. And `startPreRoll()` now asserts the invariant rather than trusting
every scene to remember it:

```js
// Play cannot begin in a camera mode that isn't following anybody.
if (state.cameraState !== 'FOLLOW') {
    state.cameraState = 'FOLLOW';
    Renderer.snapCameraToActive();
}
```

That second half is the part that matters long-term: it closes the whole class,
not the one instance.

---

### C-02 — The camera is frame-rate dependent and aims off a jittering heading · **P1**

**The reported symptom:** "camera movements need to be a lot less touchy and feel
a lot more stable."

Two independent causes.

**Every smoothing constant was a per-frame fraction.** `position.lerp(target,
0.055)`, `quaternion.slerp(helper, 0.07)`, map at `0.1`. A per-frame fraction
makes the camera's speed a function of the display's refresh rate: on a 120 Hz
phone it converges twice as fast as it did in testing, and a dropped frame makes
it lurch. Replaced with `_damp(k, dt)`, which restates the same numbers as a
half-life the frame rate cannot change — identical feel at 30, 60 and 144 Hz.

**The heading was read off the token's live mesh position every frame.**

```js
const prevPt = getPos(p.prevPos || p.pos);
fwd = new THREE.Vector3().subVectors(currPt, prevPt).normalize();
```

`currPt` is the mesh, which is *moving* during a hop — so this vector swung
through the arc of every jump and the view swung with it. Adjacent nodes on the
32-unit ring are ~18° apart and a district entry much more, so every landing also
snapped the camera to a new bearing. And when `prevPos === pos` the vector
collapsed to zero and fell back to a hardcoded `(0, 0, −1)` — a hard cut to
north, from wherever you were facing.

The heading now comes off the board graph — where the node you are on *points* —
so it is constant for a whole hop and only changes when you actually change node.
It is then eased in its own right, so a corner is turned through rather than cut
to. The camera also reads a flattened ground position, because the hop animation
bobs the token 2.5 units into the air and the camera was bobbing with it.

City framing moved from 14 back / 22 up to **19 back / 26 up with a 7-unit
lead**, so the player sits in the lower third and you can see what is coming. The
closer the camera, the more a small change of heading swings the view.

**Measured** (`qa/city.js`, sampling the camera's world direction every frame
across several turns, normalised to a 60 Hz frame):

| | before | after |
|---|---:|---:|
| yaw, 95th percentile | 1.43°/frame | **0.51°/frame** |
| yaw, worst frame | 6.05° | **2.61°** |
| position, mean | 0.18 u/frame | **0.11 u/frame** |

> A probe that watches only the camera's **position** does not catch this. The
> position barely moves while the aim whips around — a distance-only assertion
> passed cleanly on the buggy build. The direction vector is the number that
> moves.

---

### C-03 — The junction covers the board it is asking you to read · **P1**

**The reported symptom:** "when at a junction to go to a different area, it
should be arrows that pop up on top of the map and the player just chooses the
direction they want to go. They can look at the map if they'd like to."

A junction was a full-screen card with two list rows. The one moment in the match
where the board's *shape* is the thing you are deciding about was the one moment
the board was completely hidden.

Junctions are now **arrows hung over the board**:

- one per road, anchored three nodes down that road (adjacent to the fork the two
  roads are almost on top of each other; three nodes in they have visibly
  diverged), with an overlap pass that pushes the pair apart if they still touch;
- each arrowhead rotated to the road's real screen-space direction, each button
  carrying the district name, its length in spaces, and its character;
- the camera lifts to 58 units and pulls back along the road you arrived on, so
  both roads and several nodes of each are in shot;
- **🗺️ SCOUT THE MAP FIRST** opens the full map view and returns to the same
  junction with the choice still open — the map is a look, not an answer;
- nothing dims. The board stays fully visible behind them.

The Cabbie's four-way teleport picker still uses the card overlay: that one is
choosing between places you cannot see from here, so a list is the right shape.

**Tabletop:** the board canvas is turned a half turn on Player 2's turn, so a
world point projected at *(x, y)* is drawn at *(W−x, H−y)*. These buttons are
ordinary DOM outside that rotation and undo it explicitly — the same class of bug
that broke P2's map raycast. `qa/city.js` asserts both the left/right and the
top/bottom ordering invert when the class is applied.

---

### C-04 — Nothing explains the board before the first junction · **P1**

City Circuit is the only board with a routing decision, and until now the first
time a player learned that was when a junction sprang it on them mid-move.

A **briefing** now runs once, after the opening flyover, before the first roll:
the ring road and all four districts, each with its length, its character, and
what sits at the far end of it. Two buttons — **🗺️ SHOW ME THE MAP**, which opens
the real map view and comes back here, and **START THE MATCH**.

It is a SHARED-tier card, so in tabletop it is drawn twice with the top copy
turned; both sheets fit one screen (measured 41–442 and 450–851 of 892). A
rematch skips it, the same way the HBD story intro does.

---

### C-05 — Seven spaces per board undo the route you just chose · **P1**

**The reported symptom:** "there should also be no spaces that make you skip
spaces."

The City pools carried **3 × SHORTCUT (+3–8), 3 × PULLED BACK (−10) and
1 × LAUNCH (+10)** — seven of sixty nodes whose whole function was to move you
somewhere you did not choose to go. On a lap map with a routing decision that is
worse than it sounds: you commit to a twelve-space Back Alley for what is in it,
and a tile four squares in fires you past the rest of it.

All three types are **gone from every City pool**. Their slots went to MYSTERY,
MAGNET, BOOST, DUEL and SWAP ZONE, which keeps each district's character without
touching anyone's position. Red density is unchanged at 6 of 60 — exactly 1 per
10, the same rule HBD follows.

Two things deliberately stayed, and both are worth stating:

- **SWAP ZONE** relocates *both* players symmetrically, and is the one effect on
  the board that the player who is behind actively wants. It reads as an event,
  not as lost progress.
- **Anchor and Rocket** still move people. Those are purchases — chosen on
  purpose, with the price known up front. The ask was about spaces.

Hundred Block Dash keeps all three types. It is a linear race with no routing
decision, so nothing is being undone there. Say the word and they come out of
that board too.

The bounty "Land on a Shortcut space" was retired with the tile.

---

### C-06 — The bounty system · **P2**

Two defects and a presentation problem.

**Two bounties were impossible.** `c22` asked the player to use a **Double Die** —
an item removed from `ITEMS` when the shop was narrowed to seven. It could be
drawn but never completed, and because a bounty only rotates out of the
three-slot strip when it is *claimed*, a dead one occupies a slot permanently.
This is the same failure mode as QA-001 in the original audit; `verify.js` does
not catch it, because the *emitter* exists — it is the item that does not.
`qa/city.js` now cross-checks every `use_item` bounty against the live `ITEMS`
roster. `c20` ("Land on a Shortcut space") died with the tile in C-05.

**The strip could not carry the information.** Bounties lived in a single
scrolling row of ellipsised pills at the top of the screen — and in tabletop mode
that row is upside down for one of the two players on half the turns.

There is now a fourth square in the action stack, **🎯 BOUNTIES**, opening a full
panel: what each one wants, **how to actually go about it**, what it pays, and
where *both* players stand on the counted ones. A bounty is a race — knowing your
rival is one coin space from claiming it is half the information, and the strip
only ever showed your own progress. The strip stays as the glanceable version,
and now outlines a counted bounty in green when it is one step from paying out.

**The pool grew from 25 to 31**, regrouped into travel / spaces / fights /
economy, with every card carrying a hint. Six new bounties came with four new
emitters — `buy_item`, `visit_hq_any`, `steal_ally`, and `land_type` for mystery,
duel and swap tiles. `visit_hq_any` counts *distinct* districts, so two trips
through the same one do not claim it. `verify.js` proves all 31 claimable by the
emitter the real game actually fires.

---

### C-07 / C-08 — Map pan and teleports · **P2**

The map view panned at **0.10 world units per pixel** with no bounds. On a 412px
phone one thumb swipe threw the view most of the way across a 116-unit board, and
nothing stopped you flinging the board off screen entirely with no way back but
the slider. Gain is now 0.055, and the pan is clamped to the board's own
footprint — measured from the real layout, since HBD is a long ribbon and City is
a disc.

Separately, a **teleport** — Swap space, Rocket, Anchor, the Cabbie, or a change
of turn to a player on the far side of the city — put the follow target a hundred
units away in one frame. Easing across that is a long disorienting drift whose
first frames lurch. Past 40 units of ground to make up (four times what any
single hop can produce) the camera now cuts instead, heading included, so it
arrives already facing the right way.

---

### C-09 — One autoplay run reached PRE_ROLL with the HUD hidden · **P2**

A 420-second City autoplay soft-locked at turn 2 with `gameState === 'PRE_ROLL'`
and `#ui-layer` still `display: none` — no roll button, no way to continue. The
same run logged an `ERR_CONNECTION_RESET` from the dev server, and it did not
reproduce across three further runs, so the trigger was most likely a dropped
request rather than a logic path. **The root cause is unconfirmed.**

Every full-screen scene hides `#ui-layer` and is responsible for putting it back,
which is the identical shape to C-01 — an invariant maintained by convention
across a dozen call sites. `startPreRoll()` now asserts it, alongside the camera:
play cannot begin without the controls, whatever swallowed the restore.

This is a guard, not a diagnosis. If it fires in the field the underlying path is
still there.

---

## 2. What was verified, and how

`qa/city.js` — **36/36**, zero page errors. Runs a real pass-and-play City match
in Chromium at 412×892.

- **Briefing** — appears before the first roll, names all five routes with their
  lengths, hides the HUD behind it; the map tour opens the real map view and
  returns *to the briefing*; START hands over with the camera on `FOLLOW`; it
  does not reappear for the rest of the match (MutationObserver, 0 reopenings).
- **Junction** — arrows appear over the board, one per road, each labelled and
  each stating its length; the two are >60px apart and both inside the viewport;
  the old card overlay is not used; the layer is not dimmed
  (`rgba(0, 0, 0, 0)`); SCOUT opens the map and parks the arrows; closing it
  returns to the same junction with `cameraState === 'JUNCTION'`; and the arrow
  positions invert on both axes under the tabletop half turn.
- **No skip spaces** — 0 of 48 pool entries are shortcut/cfwd/cbwd, 0 of 60 nodes
  on the live generated board, and the junction copy no longer advertises them.
- **Camera** — sampled every frame, tagged with the mode it was taken in and
  normalised to a 60 Hz frame. Settled FOLLOW frames peak at 1.04 units and
  0.51°/frame at the 95th percentile.
- **Ally hand-off** — `cameraState` forced to `FLYOVER`, then the real
  `startPreRoll()`; it must come back `FOLLOW`.
- **Bounties** — every card has a hint; no card names an item the shops do not
  sell; the panel lists exactly the live cards with both players' progress bars.
- **Action stack** — four squares, all on screen, `BOUNTIES` present.

**Regression-proofed.** The camera fix was reverted in place and the suite re-run:
the yaw assertion fails on the old code (p95 1.43° vs the 1.2° bar, worst frame
6.05°) and passes on the new (0.51°, 2.61°). The ally assertion was written
against the exact `FLYOVER` state the bug leaves behind.

**Existing suite re-run:** `verify.js` (31/31 bounties claimable, no errors),
`rules.js`, `mapinfo.js`, `balance.js`, `spaceaudit.js`, `parsecheck.sh` — all
green.

Three probes needed fixing, and **none was a product regression**:

- `rules.js` asserted an exact coin delta for walking past an HQ while landing on
  whatever the district pool put at the far end. The new pools put a TRAP there,
  so it read 50→60 instead of 50→65.
- `balance.js` let its forced-move tests land on a block that turned out to be a
  shop, which opened a modal and took the Director, so the *next* test's card
  never got a beat to appear in.
- `dualread.js` waited a fixed 1000 ms for a result card that is raised on a
  Director beat — close enough to the floor that a few milliseconds of extra
  per-frame work anywhere in the engine tipped it over. It failed with the card
  *correct and simply not up yet*: inserting one extra `page.evaluate` before the
  read made it pass. It now polls for the card instead of guessing a delay.

The first two blank the squares they are not testing; the third waits for the
thing it is testing. If a probe asserts on a number, it has to own every input to
that number — and if it asserts on a thing appearing, it has to wait for it.

---

## 3. What could NOT be verified here

Software GL in a headless container proves the game **runs** correctly, not that
it **feels** right. Specifically unverified:

- **The camera on real hardware.** The whole point of `_damp` is frame-rate
  independence, and this container renders at a wildly variable rate. The
  measurements above are dt-normalised, which is the best available proxy, but
  whether the new City framing (19 back / 26 up / 7 lead) feels right on a phone
  in your hands is a judgement only play can make.
- **Whether the junction arrows read as "arrows" at a glance** on a real screen.
  They are correct, separated and labelled; whether the arrowhead is large enough
  and the labels legible at arm's length on a table is a look-at-it question.
- **Bounty balance.** The six new bounties are claimable and priced in line with
  the existing ones; whether "Reach 2 different District HQs" for 26 is the right
  price for two laps of work needs matches, not assertions.
- **Whether the briefing is the right length.** Five rows plus two buttons is a
  lot to read before a first turn. It may want to be shorter, or to be offered
  rather than shown.


---

## 4. Presentation pass (2026-08-19, second round)

Five follow-ups after a real play session. The camera was reported as good.

### P-01 — Nothing said whose turn it was

Whose turn it is was only ever *implied*: which HUD bar lit up, and which edge
the action buttons appeared on. Both are easy to miss coming back from a
minigame or a shop. A banner now names the player at every hand-over.

Two copies, one on each edge, because it matters to both — whoever is up needs
to know they are up, and whoever just finished needs to know they are done. The
top copy is turned in tabletop; pass-and-play and 1P get one upright card in the
middle, since nobody is reading from the far edge. It is `pointer-events: none`
the whole way down: a banner that swallows the tap it is announcing is worse
than no banner.

It fires only when the turn actually **changed hands**, so a BOOST re-roll does
not announce the same player twice.

### P-02 — The end-of-match chart measured the wrong thing on City

City Circuit is a lap map scored on coins. Where you were standing when the last
round closed says almost nothing about who won — a player can be half a lap
behind and forty coins up. The City chart now plots **coin totals at each round
boundary**, one marked point per round, with the axis in rounds. Hundred Block
Dash is an actual race to a finish line, so it keeps position-per-turn and the
CROWN line.

Rounds, not turns: coins swing hard *inside* a round (an HQ payout, a minigame,
a duel), so a per-turn coin line is a sawtooth nobody can read. The last sample
of each round is the standing as that round closed.

### P-03 — The player stat lists ran off the screen

Ten stacked label/value rows per player did not fit the rotated landscape
screen. They ran past the chart and pushed **REMATCH clean off the edge** —
`#win-screen` has `overflow: hidden`, so the button was simply gone.

The stats are now a two-across tile grid (half the height for the same
information) and the four district rows collapsed into one strip of chips, with
a crown on the ones you control. The block scrolls inside its card, so nothing
below it can be displaced however many stats get added later.

Three separate things were pushing the button off, and all three needed fixing:

- the card content was genuinely too tall — hence the tiles;
- `.win-body` could not shrink to the height its own `min-height` allowed,
  because a flex item defaults to `min-height: auto` and refuses to go below its
  content. Every level now gets `min-height: 0`;
- `.win-body` did not clip, so a card ten pixels taller than its row still
  contributed those ten pixels to the scroll height of the panel above it.

The button row is also `position: sticky` at the end of the scroll container, so
it stays reachable whatever happens above it.

> One false lead worth recording: the probe kept reporting REMATCH at `x = -10`
> even after the layout fitted. `.win-btn` enters on a `fadeSlideUp` with a 1.2 s
> delay and `animation-fill-mode: backwards`, so for the first ~1.7 s it really
> is sitting at the animation's starting transform. The probe was measuring
> before the screen had finished arriving.

### P-04 — The ally on the board was an anonymous blob

An ally waiting on a tile was a gold octahedron. Whether it is worth detouring
for — and worth spending a minigame on — depends entirely on *which* ally it is:
the Bodyguard soaks two hits, the Cabbie teleports you, the Banker pays
interest. The marker is now the ally's own character model, under a floating
gold halo, on a glowing ground disc so the tile still reads from a distance.

`removeAllyMarker()` also leaked. It deleted its map entry **first** and then
looked the mesh up again to find its row in the render loop's floating-icon
list — by which point the lookup returned `undefined`, so the row was never
removed. Every ally spawn left one animated entry pointing at a mesh no longer
in the scene, forever. `qa/polish.js` spawns and despawns twelve times and
asserts both the scene graph and the icon list come back to where they started.

### P-05 — The character picker was nine emoji

An emoji says nothing about the piece you will spend a whole match looking at.
Every card now carries the real mesh, rendered offscreen at selection time in
the colour that player will actually be, with the emoji left in the DOM as the
fallback for a browser that gives us no WebGL context. Player 2's pass marks
whatever Player 1 took.

The renderer creates, uses and releases one throwaway WebGL context per batch —
browsers cap live contexts hard, and the board renderer does not even exist yet
at char select. `qa/polish.js` runs twenty more batches and checks the last one
still returns images.

### A harness defect found on the way

`agent.js` and `verify.js` both located the scene by taking the camera and
walking up `.parent` until it ran out. **The camera in this renderer is never
added to the scene**, so that walk returns the camera itself. Every scene-graph
leak census since it was written reported `meshes 0→0` and passed — it had been
measuring nothing at all. Both now call `Renderer.getScene()`, and the census
reads 744 meshes / 242 materials, stable across 12 tile redraws.

A leak check that cannot see the thing it is checking passes forever. If a
census returns zero, that is the bug, not the result.

### Verified

`qa/polish.js` — **31/31**, zero page errors. Plus re-runs of `city.js` (36/36),
`verify.js` (31 bounties claimable, real census, 12 turns in the pacing window),
`winscreen.js` on both boards, `features.js`, and the parse gate.

`winscreen.js` needed one assertion widened: it hard-coded `turns:` in the chart
legend, which is now `rounds:` on City by design.

### Not verified

- How the turn banner reads in the hand — 1.7 s was chosen to be long enough to
  read across a table and short enough to be gone before anyone reaches for the
  roll button. That is a guess until it is played.
- Whether the character portraits are legible at card size on a real screen.
  They render correctly and distinctly; whether the Banker's briefcase is
  visible at 84 px on a phone is a look-at-it question.
- Whether coins-per-round is the *right* chart for City, or whether it wants a
  second series (position, or bounties claimed) alongside it.
