# The probes

Each file here drives the real game in a real browser and asserts something a
person would otherwise have to check by hand. They are not unit tests: there are
no mocks, and a probe that passes means the game did the thing.

Run one with `node qa/<name>.js`. They expect a static server on
`http://127.0.0.1:8129` serving the repo root (`QA_BASE` overrides it).

`bash qa/parsecheck.sh` is the fast one — no browser, four static gates: every
module parses, no dead local references, the command bus agrees with itself, and
every mirrored scene is classified.

---

## Two traps that have cost real time

### `pgrep -f` and `pkill -f` match the process doing the matching

A shell running `while pgrep -f "solopics.js"; do sleep 10; done` has
`solopics.js` in its own command line, so `pgrep` finds *itself*, the condition
is never false, and the loop runs until something kills it. The same applies to
`pkill -f "http-server"` inside a wrapper whose command line contains
`http-server` — that one kills its own shell.

This has happened four separate times in this repo. The loop looks like it is
waiting for a long-running probe; it is waiting for itself, and the probe it was
supposed to wait for never started. **Load average near zero while something is
"still running" is the giveaway.**

Either bracket a character so the pattern cannot match itself —
`pgrep -f "[s]olopics.js"` — or, better, do not poll at all: start the probe in
the background and let the harness tell you when it exits.

### Probe output looks empty until the probe exits

Node block-buffers stdout when it is redirected to a file, so a probe's output
file reads as empty for its entire run and then appears all at once. An empty
output file means "still running", not "produced nothing" — check whether the
process is alive before concluding anything from it.

### Two of these probes are not reliable pass/fail gates

Measured on 2026-09-20, four runs of `city.js` across two checkouts:

| probe + its agent.js | app served | result |
|---|---|---|
| main | main | 36/36 · camera max **1.99** |
| main | main | 35/36 · camera max **15.45** |
| main | a branch | 35/36 · camera max **16.82** |
| branch | that branch | 35/36 · camera max **10.05** |

**`camera: settled follow frames never lurch` is sampling-dependent.** It fails
whenever the run happens to catch a rare hitch, and the number of settled FOLLOW
frames a run samples varies from 150 to 423 depending on which junction comes up
and how long the drive loop takes. The clean 36/36 above is the run that sampled
fewest. **A single clean run does not mean the camera is smooth, and a single
failure does not mean somebody broke it** — the lurch is real, pre-existing and
intermittent, and it wants a fix rather than a re-run.

**The browser also dies outright on some runs**, as
`Target page, context or browser has been closed` at a different line each time.
Not memory (15 GB free), not disk, not CPU contention, and not the app: a
byte-identical `city.js` crashed twice and then passed against the same server.
Treat a crash as no result and run it again.

The general rule both of these point at: **before blaming a diff for a probe
failure, run the same probe against the pre-change code.** `git worktree add`
plus a second `http-server` port makes that a two-minute experiment, and three
wrong causes were asserted in one session before anybody actually ran it.

---

## What each probe is for

| Probe | Drives |
|---|---|
| `parsecheck.sh` | Static gates. Run this first; it takes a second. |
| `surfaces.js` | The three surfaces derived from four authored properties, held to a hand-written audit. No browser, one second. |
| `rounds.js` | Everybody plays: a whole relay and a whole bracket at four seats, the standings rail, and that a three-leg round still pays one reward. |
| `seats.js` | The front door: that 3 and 4 players can be *asked for*. Every mode's seat picker, bots filling the empty seats, and a lone bot landing in the slot `isBot` describes. |
| `fourlocal.js` | Full 3- and 4-seat hot-seat matches to the win screen. |
| `net.js` | N pages in one browser over the loopback transport — every page agreeing with the host at every turn boundary. |
| `netfx.js` | That a spectator sees the animations, not just the pop-ups. |
| `netmg.js` | A real minigame round across two devices, end to end. |
| `netduel.js` | A duel, landed by either the host or a client (`QA_DUEL_SEAT`). |
| `lobby.js` | The front door and the room: hosting, joining, naming, characters. |
| `soloframe.js` | That every parallel game actually fills the screen and is running. |
| `arcade.js` | Every registered minigame, offline, resolving without errors or mesh leaks. |
| `newgames.js` | Puck, Four in a Row, Light Cycles, Penalty and Grand Prix against a scripted opponent — including that a Grand Prix bot can drive at all. |
| `highnoon.js` | The 3D stage: the players' own figures in a turned landscape scene, the board paused underneath, the holster on the right half, a flinch, a win on the bell, the hold card, and nothing leaked on finish or force-end. Writes `shot-highnoon-*.png`. |
| `mapmodules.js` | Map registry parity and the board's geometry as *properties*. |
| `mapshot.js` | Photographs a board from three angles. Not an assertion — a way to look. |
| `layout.js` | The layout laws as arithmetic — no browser, one second. That a phone holds at most two private playfields, and that `MG_SHAPE` and `MG_NET` agree. |

## Looking is a test

Three layout faults in one pass were found by screenshotting at 412×892 and
none by any assertion: a mirrored status strip upside-down over the game, a HUD
sitting in the meteors' path, and Tree Climb drawing its entire tree below the
bottom of the screen. All three rendered without a single error.

When a probe passes but something feels wrong, take the picture.
