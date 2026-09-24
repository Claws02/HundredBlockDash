# Minigame Audit — 2026-09-23

**Build:** `ffd77e2` (main, after PR #89) · **Branch:** `claude/minigames-qa-audit-dty9wd`
**Method:** a code read of all 23 registered games against `MINIGAME_STANDARD.md`
and `MINIGAME_RULEBOOK.md`, `qa/parsecheck.sh`, `qa/botcheck.js` at easy and hard,
and a screenshot of every game six seconds into a bot match (412×892, SwiftShader
GL).

The owner asked for three things: hold every game to the same standard, make
them fun and interactive, and go further — put the players' **own 3D characters**
into the games, build **full scenes**, and give **each game a story**. This
document does all three. It lists the defects and gaps first, then what it would
take to get to that kind of game, and then a slate of new games built around
the characters.

---

## 0. The short version

1. **One P0 bug.** Grand Prix crashes whenever a bot drives it (§2.1). A
   one-player match that draws it shows an empty green screen until the watchdog
   ends it. The arcade does not catch this because it never runs bots.
2. **The standard is held unevenly.** Every game meets the *code* contract
   (R1–R7 all pass, and so does `parsecheck`). The *feel* contract does not:
   - only 2 of 23 games have particles
   - only 2 have screenshake
   - 7 show "P1/P2" where the others show player names, and Bomb Pass shows no names at all
   - 2 leave the prompt strip reading "MINIGAME TIME" for the whole round
   - no game has a written rubric score, although the standard gates shipping
     on ≥ 12/16
3. **The immersion gap is the big one.** The board is a lit 3D toy world with
   nine hand-built vinyl characters in it. The minigames are a different app:
   - 20 of 23 are flat Canvas2D on dark neon panels
   - the two games that use Three.js (Sumo Spheres, Tank Clash) draw only
     spheres and boxes
   - only Tree Climb shows the character you picked, and only as a flat sprite
   - no game knows which map or district it is being played on
   - no game has a setting or a story
4. **This is buildable, and the pieces already exist.** `createCharacterMesh()`,
   the district biome tables, a vendored cannon.js, and a precedent for a
   minigame holding its own WebGL context (Sumo, Tank) are all in the repo.
   What is missing is a **shared 3D stage** and a **character animation layer**.
   Without them, each 3D game would rebuild the same lighting, camera and
   character code.
5. **The risk to watch first is the face-off hold, not performance.** P1 and P2
   sit at opposite ends of one phone. A perspective camera has one "up", so a
   3D scene reads correctly for one player and upside-down for the other (§4.1).
   Every 3D conversion has to choose one of three answers to that, and the
   choice decides which games convert well.

---

## 1. What exists today

| | |
|---|---|
| Registered games | 23 (`MG_TYPES`). Structure: 15 arena · 6 split · 2 table · 1 relay (`MG_SHAPE`) |
| Rendering | 20 Canvas2D · 2 live Three.js (Sumo Spheres, Tank Clash) · 1 hybrid (Tree Climb renders the real character once to a sprite) |
| Characters | 9 procedural toy figures in `Renderer.js › createCharacterMesh` (slime, ghost, boxy, bunny, cabbie, vendor, banker, bodyguard, investor). 12–22 meshes each, clearcoat physical material |
| Character use | Board tokens, lobby portraits (`renderCharacterPortraits`), Tree Climb. **Nowhere else in any minigame, intro card, ready gate or verdict** |
| Character animation | None. The figure is a flat `Group` of anonymous meshes: no named parts, no pivots. The board moves it by hopping the whole group |
| Libraries | three **r128** (2021; no `RoundedBoxGeometry`, no built-in GLTF animation in the bundle) · cannon.js (vendored, only the board's `Physics.js` uses it) · no build step |
| Story framing | Beat 2 (THE BRIEF) is `MG_INFO.desc`, one paragraph of rules text. There is no setting and no premise |
| Board themes available | City Circuit's districts (fin, ba, shop, ind, woods, ember, fae, void) and Star Territory's Western biomes (Perdition, Ironwood Railyard, Cinder Mine, Longhorn Ranch, Boot Hill Badlands) |

---

## 2. Defects

### 2.1 P0 — Grand Prix crashes whenever a bot drives

`src/minigames/GrandPrix.js:184-189`:

```js
_held = new Array(_n).fill(false);
_botPlan = new Array(_n).fill(null);
_cars = Array.from({ length: _n }, …);
_held = [false, false];   // ← left over from the 2-seat version
_botPlan = null;          // ← _botStep() then writes _botPlan[pid] and throws
```

Commit `eebe935` ("Seat three and four in Grand Prix") added the N-seat arrays
above two older lines from `72c4fd4`, and did not remove those lines. Every
frame in which a bot slot is stepped throws `Cannot set properties of null
(setting '1')` at line 361, so the loop never draws a frame. **Reproduced:**
over 8 s of a bot match there were 1,300+ page errors and a blank green canvas.

- **Who hits it:** every one-player match that draws Grand Prix, and any
  3–4-seat match that has a bot seat in it.
- **Why nobody saw it:** the arcade runs `isBot = false`, so `_botStep` never
  runs there.
- **Fix:** delete lines 188–189. With `_n > 2`, `_held = [false, false]` also
  loses seats 3 and 4, so that line is wrong for humans too.
- **Guard:** add `grandprix` to a `qa/newgames.js`-style probe that asserts zero
  page errors in a bot match.

### 2.2 Bot sweep (`qa/botcheck.js`, P1 idle, 70 s budget)

P1 never touches the screen in this probe, so the times are "bot against an
idle opponent". That makes it a floor and ceiling check, not a fun check.

| Game | Easy | Hard | Notes |
|---|---|---|---|
| Sumo Spheres | 12 s | 8 s | Under the 15 s floor against an idle opponent. That is expected: nobody is pushing back |
| Tank Clash | 47 s, draw | 6 s | **Easy landed no hit in 42 s.** See B6 |
| Rhythm Forge | 60 s | 60 s | Over the 40 s target at both tiers (a relay). See B7 |
| Orb Deflect | 33 s, draw | 16 s | |
| Snap Strike | 28 s | 28 s | Fixed clock. The score gap widens with skill (10 vs 15) |
| Quick Draw | 12 s | 9 s | |
| Grid Recall | 27 s | 23 s | |
| Odd One Out | 32 s | 32 s | Fixed clock. Score 23 vs 39 |
| Steady Hand | 24 s | 24 s | Fixed clock. Held 13.8 s vs 22.0 s |
| Sort Rush | 12 s | 11 s | |
| Frame Match | 41 s | 28 s | Easy is just over 40 s |
| Speed Boat | 29 s | 36 s | |
| Loot Catch | 36 s | 36 s | Fixed clock |
| Freeze | 24 s | 12 s | |
| Clear Out | 22 s | 21 s | |
| Puck | 43 s, 0–0 | 44 s, 0–0 | P1's idle mallet sits in its own goal mouth. `newgames.js` covers the real case |
| Penalty · Four in a Row · Memory Match | waits | waits | Wait for a human by design. Covered by `newgames.js` and `memorymatch.js` |
| Light Cycles | 15 s | 13 s | |
| Bomb Pass | 19 s | 17 s | |
| Grand Prix | 21 s | 20 s | This run reached Grand Prix after the §2.1 fix had landed. Before the fix, the same match threw on every frame |
| Tree Climb | 32 s | 32 s | Fixed clock |
| **High Noon** (new) | 31 s | 31 s | Idle P1 forfeits each round, which is the designed ceiling |

No page errors in any game, and every game that has a clock resolved without
a human.

### 2.3 P1 — Uneven standard

| Gap | Games | Standard clause |
|---|---|---|
| Prompt strip reads "MINIGAME TIME" for the whole round | Sumo Spheres, Rhythm Forge | §3 3-second rule: "lean on `#mg-neutral` for a 2–4 word prompt" |
| Shows P1/P2 in the prompt strip where other games show the player's name | Puck, Penalty, Clear Out, Freeze, Orb Deflect, Rhythm Forge, Tank Clash (Bomb Pass shows no names at all) | Consistency with the rest of the roster |
| No particles of any kind | 21 of 23. Only Bomb Pass and Orb Deflect have them | §6 rubric #5 Juice |
| No screenshake | 21 of 23. Only Bomb Pass and Tree Climb have it | §6 Juice |
| No haptics at all | Steady Hand | §6 Juice |
| No written rubric score | all 23 | §6 "Ship at ≥ 12/16" is a gate nobody has recorded passing |
| Fails the repo's own shared-object test | Snap Strike, Odd One Out, Steady Hand, Loot Catch, Tree Climb, Grid Recall (6 split-shaped games) | `MINIGAME_BACKLOG.md`: "a leaderboard, not a two-player game" |

The split games are there on purpose: they are the only ones that work on four
separate phones today. That trade-off is fine. It should still be written down
in one place, because the backlog calls them a defect and the library plan
calls them a feature.

### 2.3a P1 — The countdown drew in the corner, in every game *(fixed)*

`setReady()` moves `#mg-countdown` into `#minigame-layer`, which is a flex
column with no centring. So for every game, "3 · 2 · 1 · GO" rendered at
(0, 0): top-left, half inside P2's zone. Measured at `x:0 y:0` in Quick Draw.
A CSS rule now pins it to the centre using the individual `translate`
property, which leaves `countPop`'s `transform` animation alone. Found while
building High Noon's turned countdown.

### 2.4 P2 — Documentation drift

- `MINIGAME_STANDARD.md §7` says "the roster of **15**" and lists **Tug Tap**
  and **Meteor Dodge**, which are no longer registered. It is missing Frame
  Match and Speed Boat.
- `MINIGAME_RULEBOOK.md §3.1` lists **Shape Snap** as an ARENA game. It is not
  in `MG_TYPES`.
- `MINIGAME_CATEGORIES.md §5` audits "the 22 shipped games". There are 23.
- `MINIGAME_STANDARD.md §6` sets the rubric, but there is nowhere to record a
  score.

---

## 3. What needs more development

Ordered by what each item unblocks. The foundation items come first because
every 3D game depends on them. Build them once.

### A. Foundation (engine, build once)

| # | Item | What it is | Why first |
|---|---|---|---|
| **A1** | **`MinigameStage`** (`src/engine/Stage.js`) | A shared Three.js stage for minigames. It provides the renderer, lighting presets matching the board's key and rim, camera rigs (tilted top-down face-off, chase, side-on, orbit), shadow setup, and a `dispose()` that registers with `registerMinigameCleanup`. It falls back to Canvas2D if WebGL fails, the same rule Tree Climb already follows | Without it, every 3D game repeats about 150 lines of renderer, lights and cleanup, and repeats the leaks QA-016 already found once |
| **A2** | **Character rig** | Refactor `createCharacterMesh()` to return `{ root, body, head, eyes[], feet[], hands[], accessory }` with pivots at hips, neck and feet. It stays one function, and the board keeps calling it the same way | You cannot animate anonymous meshes, and no minigame character can run, jump or react until this exists |
| **A3** | **Procedural animator** | No skeletons or GLTF. Code-driven motion over the rig: idle bob, squash-stretch hop, run cycle (foot and hand swing with body lean), hit-react, stagger, fall, victory pose, defeat slump, and an eye look-at. About 300 lines | This is what makes you "the character" rather than a counter with a face on it |
| **A4** | **Scene kits** | Minigame sets built from the same `DISTRICT_BIOMES` data the board uses (surface, props, lamp, motes, time of day). A game asks for `stageFor(district)` and gets that district's look | This is how a game knows where it is. The Perdition standoff looks like Perdition |
| **A5** | **Cold open (beat 2)** | Before the rules card, 2–3 s of the actual set: the camera sweeps in, both characters stand at their marks, and one line of premise appears ("The 4:15 to Perdition is carrying the Star."). The **manager** owns it, so R2 holds. It needs a `RULEBOOK §1` amendment and a `SCENE_PACING` entry | This is the "each game tells a story" ask, delivered once for every game |
| **A6** | **Character verdict (beat 7)** | The winner plays the victory pose in the set and the loser plays the slump, for 1.4 s before the scoreboard card | Makes the verdict a moment (`RULEBOOK §1`) |
| **A7** | **Juice kit** (`src/engine/Juice.js`) | Shared particle bursts, screenshake, hit-stop, and number pops, for both 2D and 3D games | Closes the §2.3 juice gaps in an afternoon per game instead of a rewrite |
| **A8** | **Rubric ledger + probe** | Add `MG_RUBRIC` to the registry with 8 scores per game, and a `qa/rubric.js` that fails on a zero or a total under 12 | Makes the ship gate real |

### B. Fixes to the current roster (no 3D needed)

1. Grand Prix bot crash (§2.1). Delete two lines and add a probe.
2. Give Sumo Spheres and Rhythm Forge a live prompt in `#mg-neutral`.
3. Use player names in the 7 P1/P2 games, and add them to Bomb Pass.
4. Apply the A7 juice kit to the 21 games that lack particles or shake. Start
   with the collision games: Puck, Sumo, Clear Out, Tank Clash and Penalty.
5. Add haptics to Steady Hand.
6. Tank Clash: check the easy bot. It landed no hit on a stationary opponent in
   42 s (§2.2). The idle P1 may have been sheltering behind a crate, so confirm
   before tuning.
7. Rhythm Forge runs 60 s at both tiers, which is over the 40 s target. It is a
   relay, so the length is structural. Either shorten each turn or add it to
   `MG_WATCHDOG_MS` with a reason.
8. Update the four stale docs (§2.4).
9. Score all 23 games in the rubric ledger (A8). Any game under 12 goes onto
   the rework list below.
10. `qa/treeclimb.js` fails 8 of its checks with "0 branches read", on the
    pre-audit code (`ffd77e2`) as well as after it. The probe cannot read the
    stem any more, so it has drifted from the game. It passes nothing on the
    climb or fall behaviour, so Tree Climb currently has no working guard.

### C. Converting the roster to character-driven 3D

Not every game should convert. Three tiers:

**Tier 1: full 3D scene, you play as your character.** The verb already is
a body doing something.

| Game | Becomes | Scene / story | Hold answer (§4.1) |
|---|---|---|---|
| **Quick Draw** | Two characters back to back in the main street. Ten paces, the bell, turn and draw | Perdition, high noon. *"One town. One Star. Ten paces."* | Side-on camera, so both players read it |
| **Freeze** | Red-light-green-light with the characters creeping toward the Eye, then freezing mid-stride in a pose | Night-time vault in the Financial district. The Eye is a security camera | Tilted top-down |
| **Penalty** | Your character is the striker and then the keeper. The dive is a real dive | Rooftop pitch in the Business district | Split viewports: each player sees from behind their own character |
| **Sumo Spheres** | Characters inside hamster-ball bumpers on a floating platform | The fae district, on a lily pad over the void | Tilted top-down |
| **Grand Prix** | The character drives a toy kart. The cabbie gets a taxi | City Circuit's own streets | Split viewports, chase cam |
| **Speed Boat** | The character in a boat. Spray, a wake, and rocks | Cinder Mine flooded tunnel | Split viewports (it already splits the camera) |
| **Tank Clash** | The character's head pops out of the turret | Ironwood Railyard | Tilted top-down |
| **Bomb Pass** | Characters throw a lit bomb back and forth, with a catch animation | Cinder Mine, dynamite | Tilted top-down |
| **Tree Climb** | Already uses the character as a sprite. Make it a live 3D climb | Woods district | Split viewports |

**Tier 2: the character as host and reactor.** The playfield stays 2D and
readable, because precision matters more than depth there. The player's 3D
figure stands at their edge of the board and reacts: it winces at a miss,
cheers at a hit, and plays the victory pose at the end. This is cheap once A1
to A3 exist: one small viewport per seat, rendered at 15 fps.

Puck · Clear Out · Light Cycles · Loot Catch (the figure holds the basket) ·
Four in a Row · Memory Match · Rhythm Forge (the figure hammers the anvil) ·
Orb Deflect

**Tier 3: leave as they are, juice only.** These are pure perception or
precision games, and 3D would get in the way of reading them.

Snap Strike · Odd One Out · Steady Hand · Sort Rush · Grid Recall · Frame Match
(which could draw its faces from the character roster instead of random ones:
a cheap tie-in)

---

## 4. Constraints to design around

### 4.1 The face-off problem (the first risk to watch)

The default hold puts P1 at the bottom and P2 at the top of one phone. In 2D the
top half is rotated 180° and both players read their side correctly. A single 3D
camera cannot do that: the camera has one "up". There are three answers:

| Answer | How | Cost | Good for |
|---|---|---|---|
| **Tilted top-down** | A camera looking straight down or nearly down, with no horizon. Both players read it like a board game on a table | Loses drama. Characters are seen from above | Arenas: Sumo, Tank, Freeze, Bomb Pass |
| **Side-on** | A camera looking across the arena from one long side. Both players see it the same way round, sideways | Needs the phone held landscape (a new `MG_ORIENTATIONS` entry) | Duels and races: Quick Draw, a rooftop race |
| **Split viewports** | Two cameras, each viewport rotated for its player, each behind its own character | Doubles the draw cost. Each half is 412×400 | Chase cams: Grand Prix, Speed Boat, Penalty, Tree Climb |

### 4.2 Performance

- A minigame holding its own WebGL context alongside the board's has
  precedent: Sumo and Tank already do it. Pause the board's render loop while a
  minigame is up, as part of A1. Otherwise two scenes render per frame.
- Clearcoat `MeshPhysicalMaterial` is the most expensive material three.js has.
  At four characters × 22 meshes × two viewports it will cost frames on a
  mid-range phone. A1 should swap to a `MeshStandardMaterial` LOD inside
  minigames.
- None of this can be measured here. SwiftShader is a CPU renderer, so frame
  rate in this container means nothing. Every 3D conversion needs one pass on a
  real mid-range phone before it ships.

### 4.3 Four seats and separate phones

A 3D arena is still an ARENA: on separate phones it needs W4 snapshots
(`MINIGAME_CATEGORIES.md §3`). The cheap online path is TABLE or RELAY. The new
slate below marks each game's structure so this cost is visible up front.

---

## 5. New games: character-first, scene-first

Each game starts with a place and a premise, and the player *is* their
character. Every one passes the shared-object test: there is one thing
everybody is fighting over. Where a game fits a board map, it says which, so
A4 and A5 can place it there.

| # | Game | Setting and premise | What you do | Shape / seats | Why it is new |
|---|---|---|---|---|---|
| 1 | **High Noon** | Perdition main street. *"Ten paces. Don't turn early."* | Hold to walk your paces. Release on the bell, then flick at your rival. Turning early is a foul | ARENA · 2–4 (four-way standoff) · W1 timestamp, so cheap online | Replaces Quick Draw with the same reflex core, but now it is a scene with bodies in it |
| 2 | **The 4:15 to Perdition** | The roof of a moving train, Ironwood Railyard | Shove rivals off the roof. Duck the tunnels, which come on a shared timer everyone can see | ARENA · 2–4 · W4 | Sumo with a clock that punishes everyone, so it has comeback built in |
| 3 | **Mine Cart Mayhem** | Cinder Mine | Every player rides a cart on one branching track. Tap to throw a junction, and **the junction flips for everyone** | ARENA · 2–4 · W3 events | Spatial denial through switching the shared track, where Light Cycles did it with trails |
| 4 | **Lasso** | Longhorn Ranch | One steer, and everyone swings a rope. Land a loop, then it is a tug of war until one player holds it | ARENA · 2–4 · W2 scalar | Aim and then mash. The tug game `MINIGAME_CATEGORIES §5` says the roster is missing |
| 5 | **Vault Heist** | Financial district at night | **Asymmetric.** One player is the guard with a torch cone, the others sneak for the vault. Swap roles each round | ARENA + ASYM · 2–4 · W4 | The roster's second asymmetric game, and the first hide-and-seek |
| 6 | **Tower Topple** | Business district plaza, a tower of city blocks | Take turns pulling a block. It uses **cannon.js** physics, which is already vendored. Whoever topples it loses, and their character is buried under it | TABLE · 2–4 · one move on the wire | The only physics TABLE game. Cheapest to put online, and it scales to four at no cost |
| 7 | **Rooftop Run** | Business district skyline at dusk | Side-on race across one row of rooftops. Tap to jump, and bump rivals mid-air | ARENA · 2–4 · landscape | A platformer race. There is no platformer in the roster |
| 8 | **Taxi Rush** | City Circuit streets | One passenger at a time appears somewhere on the map. Grab them and deliver them. Ram the carrier to steal the fare | ARENA · 2–4 · W4 | Keep-away inside a racing game. It fits the cabbie character |
| 9 | **Turf War** | A town square, split into tiles | Run over tiles to paint them your colour. Most tiles at the whistle wins. Pattern plus colour, per §4 accessibility | ARENA · 2–4 · W4 | Territory control, the same idea as Star Territory in miniature. It ties the minigame to the new map's mechanic |
| 10 | **Rift Dive** | The void district | Free-fall through the Rift, steering to grab shared rings. Whoever takes a ring takes it from everyone | ARENA · 2–4 · W2 scalar | A vertical, falling set piece. It re-uses the board's Rift gate |
| 11 | **Block Party** | Shopping district street party | Relay. The music plays and you match your character's dance pose to the cue. The others watch and heckle | RELAY · 2–4 · score on the wire | The better version of Rhythm Forge's relay, now with characters dancing |
| 12 | **Buddy Rescue** | Wherever the round ended | A lost Buddy is stuck somewhere. Race to reach it, and whoever carries it back keeps it for a round | ARENA · 2–4 | Ties a minigame to the Buddy system (`BUDDIES.md`) instead of to coins |

**Build order:**

1. **High Noon** first, as the pilot for A1 to A6. It has the fewest moving
   parts (two characters, one street, a side-on camera) and it exercises every
   foundation piece: stage, rig, animator, scene kit, cold open and verdict.
   It also replaces a game instead of adding one.
2. **Tower Topple** next. It is TABLE-shaped, so it is cheap online, and it
   proves the physics path.
3. **Vault Heist** third. It is the asymmetric game the backlog has asked for
   since the first audit.

### A note on "new capabilities"

The fair claim is about how these games can be *built and verified*, not about
features of the game itself. In this session the agent drove every game in a
headless browser, screenshotted each one mid-play, and found the Grand Prix
crash from the page errors. It could not have done that from reading code alone.
That loop — build, drive, screenshot, fix — is what makes a full 3D scene with
animated characters practical to build and check in one pass. It is also why
real-device performance stays unverified until someone plays it on a phone.

Runtime AI (a Claude-voiced narrator, or premises generated per match) is
possible through the API. It is **not recommended for the core loop**: it
needs a network connection, costs money per call, and adds latency to a
beat that has a 1.1 s floor. If it is wanted, pre-generate a bank of premise
lines per setting at build time and ship them as data.

---

## 5a. Progress

| Item | Status |
|---|---|
| §2.1 Grand Prix bot crash | **Fixed.** Guarded in `qa/newgames.js` |
| §2.3a countdown in the corner | **Fixed** (CSS) |
| A1 `MinigameStage` | **Built.** `src/engine/Stage.js`: side and face-off holds, the turned frame, `toLocal`, a HUD, the board paused, adaptive resolution, full dispose |
| A2 character rig | **Built.** `src/engine/CharacterRig.js` re-parents the board's figure into hips, neck and head, adds floating mitts, and can hold a prop. The board's own use of `createCharacterMesh` is unchanged apart from two tags |
| A3 procedural animator | **Built.** idle · walk · ready · aim · hit · fall · victory · defeat, plus fire and flinch accents, blinking and turning |
| A4 scene kits | **Three sets.** `src/engine/StageSets.js` has Perdition (`hub`), Boot Hill Badlands (`bad`) and a Financial District bank floor (`fin`), each built from `DISTRICT_BIOMES` and the board's `PROP_KIT` |
| A5 cold open · A6 character verdict | **Built, shared.** `src/engine/StageDirector.js`: every 3D game opens with a letterboxed camera move and a title card, and ends on the winner turning to camera with confetti in their colour. It handles both the side-on and the face-off hold. All three 3D games use it |
| New game 1: **High Noon** | **Built**, in the new SIDE-ON (landscape) hold. `qa/highnoon.js` passes 17/17 |
| New game 2: **Boot Hill Barrage** (the user's cannon version of Tower Topple) | **Built.** A side-on physics siege. Each player's figure mans a cannon atop a timber fort: drag back to aim, let go to fire, both at once on a reload. `qa/barrage.js` passes. Against an idle fort, a bot takes 12–15 hits (15–20 s) to fell it |
| New game 3: **Vault Heist** | **Built.** Face-off, near top-down, asymmetric: guard with a torch vs thief, then swap. `qa/vaultheist.js` passes 14/14. **Balance is unproven:** bot against bot, the guard wins most rounds. It needs human playtesting in both roles |
| Vault Heist, from play | **Fixed:** the thief could not bank. The exits were two corner doors, and the way everybody actually runs home ran into the other vault. Now only the guard-end vault exists in a round, and the whole strip across your own end banks, glowing green once you carry anything. Loot is 1.6x, floats over a pulsing ring and shows its value |
| New game 4: **The 4:15 to Perdition** | **Built.** Side-on roof sumo on a moving train. Drag to walk, tap to shove, hold to duck; low bridges sweep off anyone standing. `qa/express.js` 10/10 |
| New game 5: **Mine Cart Mayhem** | **Built.** Face-off, from above. Carts that never stop; tap to throw the shared switch ahead; gems, TNT, head-on bounces. `qa/minecart.js` passes |

---

## 6. Verified vs. not verified

**Verified in this environment**

- `qa/parsecheck.sh`: clean.
- Grand Prix bot crash: reproduced in a real browser, and the root cause was
  traced to a commit.
- Screenshots of all 23 games at 6 s into a bot match. All 23 rendered except
  Grand Prix, which was blank because of the crash.
- `qa/botcheck.js` results (§2.2).
- The per-game feature counts in §2.3 (particles, shake, haptics, prompt),
  taken from grep of the source. The P1/P2 strings were confirmed by reading
  the literals, and Tank Clash's on screen.

**Not verified**

- Frame rate or feel on a real phone. SwiftShader measures nothing useful here.
- Rubric scores. None exist yet. That is item A8.
- The cost estimates for the new games. They are design sketches, not builds.
