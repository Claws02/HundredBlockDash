---
name: hundred-block-dash
description: Expert working knowledge and the fastest reliable workflow for Hundred Block Dash, Caleb's three.js + cannon.js mobile party board game (1–4 players, tabletop / pass-and-play / vs-bot / online, 40+ minigames on a shared 3D stage, Capacitor iOS/Android). Use this skill at the start of ANY task in the HundredBlockDash repo, whether it's tweaking or fixing a minigame (Block Party, Barrage, Bowling, Go-Kart, Mini Golf, Rooftop Run, Pancake Stack…), building a new minigame, changing the board, turn flow, maps, UI, audio, bots, multiplayer, or store release, or answering "how does X work in the game". Also use it for a batch of playtest feedback ("the bowling ball curves wrong, block party misses my moves…"), even when the request doesn't say "skill" or name a file.
---

# Hundred Block Dash — the working playbook

Caleb plays the game on his phone and sends feedback in batches, several games at a
time, in plain words ("the ball rolls the opposite way", "it's hard to see who's
right"). Your job is to turn each line into a verified fix, fast, without breaking
the other 40 games. This file is the order of work; `references/` holds the maps
and the lessons.

Pair protocol (from Caleb's own rules): scope first when a request has real design
forks, then execute decisively end to end. Label verified vs. not verified, and end
with one concrete next step. For feedback batches, ask only about the genuinely
ambiguous items (2–4 tappable questions max, with a recommended option), make the
obvious calls yourself, and say which calls you made.

---

## 1. Start of session (2 minutes, every time)

```bash
bash .claude/skills/hundred-block-dash/scripts/dev.sh      # static server on :8129 (restarts it if it's down)
git status --short && git log --oneline -5 && git branch --show-current
node --no-warnings .claude/skills/hundred-block-dash/scripts/roster.mjs  # the live roster: every game, its hold, probe, debug hooks
```

Then read `references/lessons.md` (the dated log of what was learned and decided).
It is short, and it has saved hours. Only open other references when the task
touches them (see §3).

The test server dies between long probe runs more often than you'd expect. When a
probe prints nothing, or fails with `ERR_CONNECTION_REFUSED`, run `dev.sh` again.
Don't debug the game.

---

## 2. The game in one screen

- **Board game**: 1–4 seats race round a city board (maps in `src/config/maps/`:
  `hundred_block_dash`, `city_circuit`, `star_territory`). Turn flow is in
  `docs/TURN_FLOW.md`; state is in `src/core/GameState.js`; the flow is in
  `src/core/GameController.js`.
- **Play styles**: `1p` (vs bots), `tabletop` (phone flat between 2 people facing each
  other, so P2's UI is rotated 180°), `pass` (hand the phone over, 2–4 seats),
  `online` (`src/net/`).
- **Minigames**: `src/minigames/<Name>.js`, each `start(isBot, onWin, botSkill)` →
  `onWin(winnerSlot | -1)` exactly once. They're registered in
  `src/config/MinigameRegistry.js` in several parallel tables (`MG_TYPES`, `MG_INFO`
  desc, `MG_ORIENTATION_MAP`, `MG_NET`, `MG_SHAPE`, `MG_PROFILE`, `MG_WATCHDOG_MS`).
  The manager (`MinigameManager.js`) runs the intro card, the watchdog (90 s
  default) and the result.
- **The 3D stage**: `Stage.js` (renderer, holds, rigs, loop, dispose), `StageKit.js`
  (`seat`, `faceoffHud`/`sideHud`, `touch`, `effects`, `overheadCam`),
  `StageDirector.js` (cold open / verdict), `StageSets.js` (places),
  `CharacterRig.js` (figures). Physics is `vendor/cannon.min.js` (cannon.js 0.6).
- **Holds**: `faceoff` (phone flat, P1 bottom half, P2 top half upside down),
  `side` (landscape, P1 right half, P2 left half; the stage turns 90° on a
  portrait phone), and split screen (`stage.views`, one camera per half).

---

## 3. Classify the task, then open only what it needs

| Task | Read | Then |
|---|---|---|
| Tweak or fix an existing minigame | `references/minigames.md` (that game's entry) + the game file + its `qa/<key>.js` | §4 |
| New minigame | `docs/MINIGAME_3D_PLAYBOOK.md` (order of work) + `docs/MINIGAME_STANDARD.md` §1–§10 | `node scripts/new-3d-minigame.js …`, then §4 |
| Input, camera or player-frame bug ("goes the wrong way") | `references/engine.md` → *Frames & input* | §4 |
| Physics feels wrong (nothing moves, tunnelling, falls through) | `references/engine.md` → *Physics* | §4 |
| Audio or rhythm | `references/engine.md` → *Audio* | §4 |
| Board, turn flow, maps, economy | `docs/TURN_FLOW.md`, `docs/SPACE_REFERENCE.md`, `docs/DISTRICTS.md` | probes in `qa/README.md` |
| Setup screens, tabletop rotation, UI | `src/core/GameController.js`, `src/ui/UIManager.js`, `css/styles.css` (`.tabletop-p2-turn`) | `qa/seats.js`, `qa/tabletopselect.js` |
| Online | `docs/MULTIPLAYER_PLAN.md`, `MG_PROFILE` comments | `qa/net*.js` |
| Store / release | `docs/STORE_RELEASE.md`, `docs/RELEASE_AUDIT_2026-09.md` | `npm run cap:sync` |
| "What should we build next?" | `docs/UPGRADE_ROADMAP.md`, `docs/MINIGAME_BACKLOG.md`, `references/lessons.md` → open threads | recommend, don't survey |

---

## 4. The fix loop (one feedback item at a time)

1. **Reproduce in numbers first.** Read the game's `_debugState()`. If the thing
   Caleb described isn't visible in state, add a field. A bug you can't see in
   state, you can't prove fixed.
2. **Find the real cause before tuning.** Most "feels wrong" reports have been a
   concrete defect, not a number: signs drawn with the roof height added twice
   (Rooftop Run), a blast measured from the piece's *centre* (Barrage), a stick
   helper that clamps the finger path (Bowling curve), a mis-wound road ribbon
   (Go-Kart), a cannon.js collision mask defaulting to 1 (Barrage). Tune only
   after the cause is fixed.
3. **Make the smallest change that fixes it**, in the file's own voice. The
   codebase explains *why* in prose comments; match that density.
4. **Add a probe line that would have failed before the fix.** Drive real input
   (`page.mouse`, or a pointer-event burst for fast flicks) where a player would
   touch, and use `_debug…` hooks only to set up situations. The probe is part of
   the deliverable.
5. **Run the gates.** Stop and fix on the first red:
   ```bash
   bash qa/parsecheck.sh src            # 1 s: every module parses, no dead refs
   node qa/<key>.js                     # the game's probe
   node qa/surfaces.js                  # after any registry edit
   ```
   Or all three with `bash .claude/skills/hundred-block-dash/scripts/check.sh <key> [key…]`.
6. **Look at the screenshots** (`qa/shot-<key>-*.png`) with the Read tool. Framing,
   HUD overlap and invisible geometry don't show up in numbers (the invisible
   beach road only showed in a picture).
7. **Update the player-facing text**: the `MG_INFO` desc, the header comment of the
   game file, and the HUD hint. Watch for apostrophes in single-quoted `desc`
   strings: `you're` breaks the parse. Write "you are".
8. **Commit that one item and push**, with a message that says what was wrong and
   why, plus the session trailer. One item per commit keeps a batch reviewable.
9. **Add to `references/lessons.md`** if you learned something a future session
   would otherwise re-learn the hard way.

A batch of feedback becomes a task list (one task per item), worked in order and
reported together.

### After a batch: regression

```bash
QA_ONLY=key1,key2 node qa/botcheck.js     # every touched game resolves with a bot vs idle, no errors
node qa/ci-smoke.js && node qa/seats.js
```
A `HUNG` row is only a problem if the game should end without the human. A game
with no clock that waits for a human (Bowling, Mini Golf's turns) is expected to
hang against an idle player; the watchdog ends it.

---

## 5. Probe discipline on this machine (software GPU, slow frames)

- `dt` is capped at 0.1 s, so game time runs slower than the wall clock. Wait on
  **state**, never on sleeps: `waitFor(st => …)`.
- Anything that has to happen inside a time window (a drift charging, a mushroom's
  speed, sliding on ice, hitting a beat) will flake in real time. **Hold the real
  input, then drive the game off the clock** with a `_debugSim…(slot, secs)` hook
  that loops the game's own step at 1/60. See Go-Kart's `_debugSimDrive`.
- Fast gestures: dispatch the pointer sequence in one `page.evaluate` burst
  (Snowball, Rooftop Run).
- Side-hold screen mapping: stage `(lx, ly)` sits at portrait screen `(412 − ly, lx)`,
  so landscape "up" is a drag toward screen **+x**, and P1 (right half) is the
  screen's **bottom** half (`y ≈ 700`), P2 the top (`y ≈ 190`).
- A probe's output file is empty until it exits (Node buffers stdout). Long
  probes: run them in the background and let the harness notify you, not a
  `pgrep` loop (it matches itself, see `qa/README.md`).
- Physics is chaotic. Before trusting a pass/fail after tuning, **run the probe 2–3
  times** and report the spread (Barrage: bot clear time 25–32 s over 3 runs).

---

## 6. Reporting to Caleb

Keep it short and structured:
- **What changed**, one bullet per feedback item: the cause in plain words, then the fix.
- **Verified**: which probes passed, with the key numbers.
- **Not verified**: what only a real phone can tell (feel, sound, haptics, real
  thumbs, Bluetooth latency, fps on device).
- **One next step**, concrete ("play one tabletop round of Block Party on the
  phone speaker and tell me if PERFECTs land on the kick").

Don't open PRs unless asked. Push to the branch the session names.

---

## 7. Where the knowledge lives

| File | What's in it |
|---|---|
| `references/lessons.md` | Dated log of hard-won lessons, decisions Caleb made, open threads. **Append to it.** |
| `references/minigames.md` | Per-game cheat sheet: hold, controls, the mechanic that matters, debug hooks, tuning knobs, known feel issues. |
| `references/engine.md` | Stage/touch/holds and player frames, cannon.js traps, audio and beat clock, rendering traps, the registry fields. |
| `scripts/roster.mjs` | Live roster from the registry and files: hold, net, watchdog, probe present, `_debug` hooks. |
| `scripts/check.sh` | parsecheck → probe(s) → surfaces, with a PASS/FAIL summary. |
| `scripts/dev.sh` | Start or restart the static server on :8129. |
| `docs/*.md` | The project's own design docs. Authoritative for rules; this skill points into them. |
