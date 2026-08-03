# Scene Pacing

How long each beat of a turn holds the screen, why, and what it measured before.

A turn in this game is a short scene with a fixed shape. It should read like one:

```
  your turn  →  the throw  →  the number  →  the journey  →  where you landed
             →  WHAT YOU GOT  →  a breath  →  what happens next
```

The payoff beat — *what you got* — is the point of the whole sequence. Everything
before it is setup. It was the only beat with no guaranteed screen time at all.

---

## 1. Baseline — what it actually did

Measured with `qa/scenes.js`, which samples the live game at 40 Hz and records
how long each `(gameState × visible overlay)` pair owns the screen. 260 s of
Hundred Block Dash, 1P vs the bot, 65 distinct beats.

| Beat | n | min | median | mean | max |
|---|---:|---:|---:|---:|---:|
| `ROLLING \| board` | 12 | 1554 | **7428** | 7033 | 8429 |
| `MOVING \| board` | 13 | 365 | 2793 | 4921 | **16791** |
| `GATE \| board` | 1 | 5292 | 5292 | 5292 | 5292 |
| `GATE \| gate-overlay` | 1 | 3899 | 3899 | 3899 | 3899 |
| `GATE \| realm-banner` | 1 | 1760 | 1760 | 1760 | 1760 |
| `PRE_ROLL \| board` | 7 | 677 | 963 | 1193 | 1905 |
| `ACKNOWLEDGE \| board` | 4 | 509 | 573 | 637 | 921 |
| `MINIGAME_INTRO \| mg-intro-overlay` | 1 | 1021 | 1021 | 1021 | 1021 |
| **`ACKNOWLEDGE \| msg-modal`** | **0** | — | — | — | — |

### Three things fall out of that table

**1. The dice took 7.4 seconds.** Not the animation — the *simulation*. Dice
bodies had `angularDamping: 0.4`, so spin decays as `e^(-0.4t)`. Thrown at up to
22 rad/s, reaching the old sleep threshold of 0.1 rad/s takes
`ln(220) / 0.4 ≈ 13 s`. **The dice could never settle on their own.** Every
single roll ran until the 6 s safety timeout and then had its result forced.
The most-repeated beat in the game was a stall.

**2. Movement ran to 16.8 seconds.** Hops are 0.35 s each, so even a 12-space
Overcharge is ~4 s of animation. The rest is pass-through shop prompts and
chained forced moves stacking inside one `MOVING` beat with no punctuation.

**3. The payoff beat never appeared in the data at all.** Not because it is
fast — because nothing ever held it. The probe's agent taps CONTINUE the moment
it can, and the modal was gone inside one 25 ms sample. On the bot's turns the
result showed for 1500 ms. Meanwhile `resolveMsgModal()` scheduled
`finishTurn` 300 ms later, and `maybeTriggerMinigame()` handed the screen to the
minigame selector immediately after that.

So: **~7 s watching dice jitter, up to 17 s watching a token walk, and the
sentence that tells you what any of it was worth got 0–1.5 s and could be
overwritten mid-read.** The proportions were exactly inverted.

There was also no single place that governed any of this — about 30 anonymous
`setTimeout(fn, 300)` literals in `GameController.js`, and no rule preventing
two scenes from starting at once.

---

## 2. The model

Two new modules:

**`src/config/SceneTiming.js`** — every beat named, with a floor in milliseconds
and a comment saying why that number.

**`src/core/Director.js`** — the sequencer. One rule:

> A beat owns the screen until its floor has elapsed.
> The next beat cannot start early. It can only start late.

```js
Director.hold('LAND_RESULT', () => finishTurn());
```

`hold` marks the beat and fires the continuation after the floor.
`after(name, fn)` measures from an earlier `begin(name)`, so time already spent
inside the beat — animation, a modal waiting for a tap — counts toward the
floor. A beat that already ran long continues immediately; a beat that finished
early still waits. Floors are minimums, never fixed waits, and nothing here ever
delays a player's own input.

`Director.ack()` marks that the player tapped through; the remainder of the
floor compresses to `ACK_SKIP` (34%) so an eager tapper keeps moving without two
scenes rendering at once. And because every continuation is tracked,
`Director.reset()` cancels the lot on rematch — which the loose `setTimeout`s
could never do.

---

## 3. The beat table

| Beat | Floor | Why |
|---|---:|---|
| `ROLL_LAUNCH` | 220 ms | The player just acted; react fast. |
| `DICE_READ` | 850 ms | The number is on the table and legible **before** the token moves. |
| `LAND_SETTLE` | 420 ms | Register *where* you landed before being told what it means. |
| **`LAND_RESULT`** | **3000 ms** | **The ask. The result owns the screen this long minimum — nothing else may start, including the minigame hand-off.** |
| `BOT_RESULT` | 3000 ms | No tap is coming, so this is the whole readable window. Deliberately equal: you should read your opponent's turn as easily as your own. |
| `BOOST_RESULT` | 3400 ms | Boost chains into another roll, so it gets more air. |
| `POST_RESULT` | 650 ms | The board on its own. Without it the match is one continuous smear. |
| `PRE_MINIGAME` | 1100 ms | The gap that did not exist. Now filled with a "⚔️ MINIGAME NEXT" card. |
| `POST_MINIGAME` | 700 ms | Before play resumes. |
| `TURN_HANDOFF` | 600 ms | Long enough to notice the HUD change hands. |
| `REALM_BANNER` | 2400 ms | Realm-entry cinematic. |
| `GATE_RESULT` / `GATE_RESUME` | 2200 / 1600 ms | The Rift is a set piece; let it land. |
| `SHOP_OPEN` / `DUEL_OPEN` | 400 / 450 ms | Result resolves, then the panel slides in. |
| `WIN_SCREEN` | 2800 ms | Final result before the confetti. |
| `SPACE_CARD` | 3600 ms | On-board "what this space does" card — outlives `LAND_RESULT` on purpose. |

Bot "thinking" pauses live in a separate `BOT_THINK` table: they exist to make
the opponent feel like it is deciding, not to make anything readable.

---

## 4. Fixing the dice

The 7.4 s roll was the biggest single win available and it wasn't a timing
problem — it was a physics problem wearing a timing problem's clothes.

| | before | after |
|---|---|---|
| `angularDamping` | 0.4 | **0.85** |
| `linearDamping` | 0.3 | **0.42** |
| sleep threshold (squared) | 0.01 (~0.1 u/s) | **0.25** (~0.5 u/s) |
| body sleeping | off | `allowSleep`, 0.35 limit, 0.15 s |
| safety timeout | 6000 ms | **3200 ms** |

At 0.85 the spin decay that took ~13 s takes ~1.4 s, which is what a thrown die
actually looks like. The threshold moved because a die's top face stops changing
long before it is perfectly still — holding out for stillness was buying dead
air and nothing else. The timeout is now a genuine safety net rather than the
mechanism every roll relied on; if it fires, something is stuck, and it logs.

**Also fixed while in there:** `readResult()` dereferenced `activeDice[0].mesh`
without checking the array was non-empty. `clearDice()` can empty it between
settle-detection and the deferred face read, and the scene probe caught the
resulting `Cannot read properties of undefined (reading 'mesh')` in a live run.

---

## 5. Two measurement traps

Both cost real time; both are worth knowing before trusting a number from
`scenes.js`.

**The probe's agent taps everything.** It dismisses the *bot's* result card too,
so the 3 s floor never appears in the sampled data even when it is working
perfectly — the card is gone in ~350 ms because something tapped it. The dwell
guarantee has to be measured with `window.__QA.setAutoAckResults(false)`, which
stops the agent touching a card that isn't its turn. `qa/features.js` does this
and asserts the floor directly off DOM mutations rather than off sampling.

**Software GL runs the physics in slow motion.** `world.step(1/60, dt, 3)` can
only advance 3 × 1/60 = 50 ms of simulation per call, so on a 10 fps headless
renderer a 100 ms frame loses half its physics time and the dice appear to take
twice as long to settle as they will on a phone. `maxSubSteps` is now 6, which
covers a 100 ms frame — a real fix for slow devices, not just for the probe.
Absolute dice timings measured here still read high; the *relative* improvement
and the floors are the trustworthy parts.

---

## 6. Verified

`qa/features.js` — 18/18 pass:

- **Payoff dwell:** the result card holds **3281 ms / 3443 ms** on turns nothing
  taps through. The 3 s floor is real, not just configured.
- **Turn beats:** `ACKNOWLEDGE|board` went from a 573 ms median to **2494 ms**
  (min 1575, max 3083) — the settle + result + breathe sequence now exists.
- **Dice:** rolling beat median 7428 ms → **5205 ms** as measured under software
  GL, with a 1799 ms floor where the old code had none. On real hardware this
  should land materially lower; see the slow-motion trap above.
- **Map:** opens on both boards, slider spans the board (HBD 0–49, City 0–59),
  camera follows, counter reads `🌌 The Void · Block 49/49 · 49 ahead`, closes
  and returns control to `PRE_ROLL`.
- **Practice:** coins, positions, win counts and turn order byte-identical
  before and after a practice round.

**Not verified:** whether it *feels* right. 3 s is a defensible floor, not a
proven one — a person with the phone may find it a beat too long once they know
the game, or still too short the first time. The floors are all one table; tune
them there.

---

## 7. Re-measuring

```bash
npx http-server -p 8129 -c-1 &
cd qa && node scenes.js hundred_block_dash 260
node scenes.js city_circuit 260
```

The probe prints per-beat dwell times and calls out two things directly: the
`ACKNOWLEDGE|msg-modal` window, and any "dead air" beat where the bare board is
on screen without being the player's cue.

**Read the numbers, not the diff.** Every change in this document came from that
table, and two of them (the dice, the crash) were invisible in code review.

**What it cannot tell you:** whether the result *feels* like it lingers, whether
3 s is right or merely long, and whether the whole turn now has rhythm or just
consistent gaps. The probe drives the game at machine pace with an agent that
taps the instant it can — it measures what the game *permits*, not what a person
experiences. That part needs a human with the phone.
