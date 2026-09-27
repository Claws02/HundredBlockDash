# Lessons & decisions log

Newest first. One line per lesson: what happened, and the rule that came out of
it. Append when a session learns something a future session would otherwise
re-learn the hard way. Keep entries short; move a lesson into `engine.md` once
it's a general rule.

## Open threads
- Block Party: an audio-latency offset setting, if on-device play shows a
  consistent EARLY/LATE bias (Bluetooth especially).
- Bowling: an optional idle-throw timeout (say 30 s) so a walked-away player
  can't stall a match; Caleb hasn't decided.
- Go-Kart: a random or erratic steerer can stay on lap 1 until the 150 s bell (the
  walls are unforgiving); the bots are fine.
- `docs/UPGRADE_ROADMAP.md` tiers 1–4 and release waves 2/3/6/7 are not started
  (autosave/resume, map/camera framing, store packaging, the coached first turn).

## 2026-09 (branch `claude/minigames-qa-audit-dty9wd`)
- **Barrage "shots do nothing":** the blast used the piece's centre, so hits on top
  pushed *down*. Rule: surface distance, direct hit = full, never push down,
  impulse at the contact point. Last pieces: endgame assist.
- **cannon.js mask defaults to 1.** Setting groups made the fort fall through its
  pedestal. Rule: explicit `collisionFilterMask: -1` on statics.
- **Block Party misses:** timing came from a frame clock with no music. Rule: a
  rhythm game's beat must come from scheduled audio (`beatTrack`), touches from
  `e.timeStamp`, and moves match the nearest undanced beat they're right for.
- **Go-Kart invisible roads** on circuits that run the other way round: ribbon
  winding. Rule: check the face normal. Also `Array.from` has no array arg.
- **Rooftop Run obstacles looked wrong:** sign meshes added the roof height twice.
  Rule: children of a positioned group use relative heights; add a probe that
  compares drawn vs judged heights.
- **Bowling curve "backwards":** the `touch()` stick clamps and floats, so the
  path's shape was lost. Rule: record raw pointer positions for gesture shape.
  Caleb chose spin semantics: bend right → hook left.
- **Bowling "only P1 gets frame 2":** lanes ran independently and a 9 s shot clock
  fouled P2's frames out. Rule: frames in lockstep; no shot clock.
- **Barrage cannons on the tower** meant a player lost their gun as the tower fell.
  Caleb chose a separate unbreakable cliff behind each fort.
- **Mini Golf split screen was too small to read.** Caleb chose one sideways view
  with half-screen controls.
- **Slow renderer makes time-window probes flaky** (drift, mushroom, ice). Rule:
  hold the real input, drive the game off the clock with a sim hook.
- **The test server dies** during long runs. An empty probe output or
  `ERR_CONNECTION_REFUSED` means restart `dev.sh`, not a code bug.
- **Registry desc apostrophes** (`you're`) break the module parse. Write "you are".
- **Botcheck `HUNG` for no-clock games** (Bowling) against an idle human is expected.
- Earlier in this branch (from the summary): Snowball tunnelling (sub-step), Shell
  Game camera tilt (near top-down), Go-Kart head-on walls (35% along-wall
  threshold + reverse), the Tag bot stuck behind walls (BFS grid), Mini Golf
  `_moverZ` reading the previous hole's definition (copy the def onto the copy).
