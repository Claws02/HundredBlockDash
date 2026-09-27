# Minigame cheat sheet

For the full live roster (every key, hold, watchdog, probe, `_debug` hooks) run
`node --no-warnings .claude/skills/hundred-block-dash/scripts/roster.mjs`, which reads the code
so it's never stale. This file adds what the code doesn't say at a glance: the
mechanic that matters, the knobs, and the feel history. Update an entry whenever
you change a game.

Entry format: **key · File · hold** — what it is · controls · knobs · probe notes · history.

---

**balloonpump · BalloonPump.js · side** — HOLD your half to pump; a shared hidden
limit; a pop ends the round at once and the other balloon banks its size and wins
the round. 5 rounds, the last double. Knobs: `PUMP_TIME` 8 s, `RATE`, `LIMIT_MIN/MAX`,
`STRAIN` (the wobble tell), `TALLY` 2.4 s. Debug: `_debugLimit`, `_debugSize`;
state has `roundWin`.

**barrage · Barrage.js · side** — Cannon duel. Each gunner and cannon sit on an
unbreakable cliff (`CLIFF_DX` 6.7 behind the fort, `CLIFF_H` 10.6), and the fort
stands on a tall stone pedestal (`PED_H` 3.0, `PED_HW` 2.1). You win by clearing
every block off the rival's pedestal; at `MATCH_TIME` 60 s, more left on your
pedestal wins. Timber on the ground breaks up (`BREAK_WAIT` 0.2 s). Drag back to
aim, release to fire; your own shells pass through your own fort (collision
groups). The blast is `_blast` (surface distance, direct hit = full, sideways +
up, applied at the contact point, squared falloff for neighbours; `ENDGAME` ≤ 20%
left → ×`ENDGAME_J` 1.7; the last piece gets 1.6× reach). Knobs: `BLAST_R`,
`BLAST_J`, `PUSH`, the stone friction 0.4. Balance target: hard bot vs idle clears
in ~25–35 s. Debug: `_debugFireAt`, `_debugFireAtTop`, `_debugBlastOnTop`,
`_debugLeave`, `_debugBlock`, `_debugBlasts`, `_debugWake`. Probe `qa/barrage.js`
(own launcher, `window.__BG`). Physics variance: run it 2–3×.

**blockparty · BlockParty.js · side** — Call and response dance. The DJ dances a
phrase, then both players copy it on the next beats. Swipe ⬆⬇⬅➡, tap = clap. **The
beat is `beatTrack`** (a real backing track; the tempo map is laid out for the
whole routine in `_startMusic`; the game beat = the audible beat). Judging
(`_input`): a move claims the nearest undanced beat it's *right for* within
`REACH` 0.75 beat; PERFECT ≤ 0.1 s, GOOD ≤ 0.3 s, else OK (1 pt); a wrong move or
no move is a MISS. Feedback: a big verdict over each half (`_pops`), ★/✓/✗ badges
on the cards, a floor ring flash. The cards are revealed every frame (never only
on the beat tick). The last two phrases are from memory. Debug: `_debugHold`
(freezes and restarts the track), `_debugMove(slot, move, atBeat)`, `_debugMoves`,
`_debugTrack`. Open thread: a device latency offset if Caleb reports a bias.

**bowling · Bowling.js · faceoff split** — Each lane its own view. Drag sideways
to line up (`SLIDE`), flick up to bowl. Pace comes from the last 120 ms of the raw
path; spin comes from the path's turn (`_curveSpin`, `CURVE_FULL` 0.6 rad); a right
bend hooks left. No shot clock. Frames run in lockstep: a lane that finishes
waits (`_frameDone` → `_advance`), so both always bowl both `FRAMES` (2); tied →
up to `TIEBREAKS` (3) extra frames, scored as straight pins. Watchdog 300 s (an
idle human holds the match; that's expected). Debug: `_debugBowl`, `_debugScore`.

**kartgp · KartGrandPrix.js · faceoff split** — 3 laps on one of 5 circuits,
picked at random (`TRACKS`: park, canyon, beach, snow, city). A circuit is a
**polygon with filleted corners** `[x, z, radius]` → `_outline` → `_table` (sampled
every 0.5 u, s = 0 at `start`); everything reads the table (`_at`, `_nearest`,
checkpoints auto-placed off any shortcut's skipped stretch). Features per track:
`cut {a, b, w}`, `pier`, `pads` (boost), `ice` (the travel heading `vh` lags the
nose), `tunnel`, `theme` → `THEMES` (sky, ground, road, walls tyres/neon, decor).
Items: 🍄 mushroom (`SHROOM` 2.6 s × `SHROOM_MUL` 1.85, flames, FOV +18, speed
lines on that half) and 🍌 banana. Drift → turbo (`BOOST_MUL` 1.45). Hit a wall
head-on → reverse (`REVERSE`). The bot follows the line, takes shortcuts via
waypoints into the mouth, and gives up a cut after a wall hit. Adding a track:
append to `TRACKS` and run the probe; it checks clearance ≥ 13, corner radius ≥ 6.5,
3 checkpoints, and a sim bot lap < 30 s with ≤ 2 wall hits. Debug:
`_debugForceTrack`, `_debugPlace/PlaceS`, `_debugItem`, `_debugLap`,
`_debugGeometry`, `_debugSimDrive` (off-clock driving that reads the held real input).

**minigolf · MiniGolf.js · side** — One sideways view of the whole hole (tee
left, flag right); both play at once; P1 drags back on the right half, P2 on the
left (`_dragXZ`: drag → hole frame directly). The balls collide, and a knocked
waiting ball costs no stroke. 3 holes from a pool of 7 (windmill, loop, bridge,
pinball, dogleg, sand, slider). Fewest strokes, then the fastest total time. Shot
clock 10 s (6 s once the rival is in); timing out twice picks you up. Debug:
`_debugForceHoles`, `_debugBall`, `_debugShoot`, `_debugScore`, `_debugPool`.

**pancakes · PancakeStack.js · side** — Tap to drop onto your own table;
height (cm) wins at 40 s. Only landed, flat, settled pancakes count
(`_onPlate`). Floor pancakes crumble (`_floorCheck`, `FLOOR_Y` 0.4). Debug:
`_debugDropAt`, `_debugFreeze`, `_debugClock`.

**riftdive · RiftDive.js · faceoff split** — Dive down the shaft; rings boost,
shards stun. Density: `SHARD_CHANCE` [0.4, 0.6] per ring gap (top/bottom half),
about 11–20 shards. Debug: `_debugCourse`, `_debugPlace`.

**rooftop · RooftopRun.js · side** — An auto-runner. **Swipe up = jump** (keep the
finger down = a higher jump), **swipe down = slide**; a tap does nothing.
Vents carry a yellow ▲ JUMP board and signs a cyan ▼ SLIDE board (in
`StageSets.ba.layCourse`, heights relative to the roof). First to 2 races. Debug:
`_debugPlace`, `_debugSignBars` (drawn vs judged heights).

**tag · TagYoureIt.js · faceoff** — The least time as IT wins; 4 maps with
decks/ladders/slides; BFS grid bot. Debug: `_debugForceMap`, `_debugIt`,
`_debugPlace`, `_debugOnDeck`, `_debugItTime`, `_debugClock`.

**Other 3D games** (see the roster for hooks): highnoon, vaultheist, express
(The 4:15), minecart, turfwar, lilypad, musicalchairs (music is the rule:
`mgMusic`), bumpercars, redlight, balloontoss, sackrace, snowball (sub-stepped
snowballs, `FLICK_MS`), shellgame (near top-down camera), speedboat, treeclimb,
penalty, bombpass, sumospheres. 2D: puck, lightcycles, fourinarow, memorymatch
and the older arcade set.

---

## Feel history (why things are the way they are)

- Caleb plays on a phone, often **tabletop** (flat, two people facing each other).
  Anything P2 reads must face P2 (a flipped half, or rotated setup screens).
- Readability beats cleverness: every past "confusing" report was fixed with
  big per-player feedback over the player's own half, not HUD text.
- Controls: he prefers swipes and drags over tap zones (Rooftop Run moved from
  tap zones to swipes).
- Time limits: he removed Bowling's shot clock. Don't add clocks to turn-based
  games without asking; offer an optional idle timeout instead.
- Difficulty: "impossible to finish" endings get an endgame assist (Barrage)
  rather than a global buff.
