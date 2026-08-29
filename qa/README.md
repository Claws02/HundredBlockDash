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

---

## What each probe is for

| Probe | Drives |
|---|---|
| `parsecheck.sh` | Static gates. Run this first; it takes a second. |
| `fourlocal.js` | Full 3- and 4-seat hot-seat matches to the win screen. |
| `net.js` | N pages in one browser over the loopback transport — every page agreeing with the host at every turn boundary. |
| `netfx.js` | That a spectator sees the animations, not just the pop-ups. |
| `netmg.js` | A real minigame round across two devices, end to end. |
| `netduel.js` | A duel, landed by either the host or a client (`QA_DUEL_SEAT`). |
| `lobby.js` | The front door and the room: hosting, joining, naming, characters. |
| `soloframe.js` | That every parallel game actually fills the screen and is running. |
| `arcade.js` | All 22 minigames, offline, resolving without errors or mesh leaks. |
| `mapmodules.js` | Map registry parity and the board's geometry as *properties*. |
| `mapshot.js` | Photographs a board from three angles. Not an assertion — a way to look. |
| `layout.js` | The layout laws as arithmetic — no browser, one second. That a phone holds at most two private playfields, and that `MG_SHAPE` and `MG_NET` agree. |

## Looking is a test

Three layout faults in one pass were found by screenshotting at 412×892 and
none by any assertion: a mirrored status strip upside-down over the game, a HUD
sitting in the meteors' path, and Tree Climb drawing its entire tree below the
bottom of the screen. All three rendered without a single error.

When a probe passes but something feels wrong, take the picture.
