# The library — three surfaces, one derived truth

**Status: a plan for review. Nothing here is built.**

Caleb's proposal: three top-level categories — shared-screen 2P, shared-screen
4P, and online 2–4P on separate screens — with sub-categories under each, and a
sort in the minigame testing area.

**The three categories are right, and for a better reason than they look.** Each
one is gated by a *different engineering constraint*, so they are not three
labels over one list — they are three genuinely different questions:

| Surface | What gates it |
|---|---|
| **Shared screen, 2P** | nothing. A phone half is 412 × 400 and every game in the roster is built for it |
| **Shared screen, 3–4P** | the **control law** (a quarter screen holds one thumb) and the **split law** (a private playfield needs a tablet) |
| **Separate screens, 2–4P** | **netcode** — command vs contact |

Three changes I would make to the shape of it, in order of importance.

---

## 1. They are flags, not folders

A taxonomy puts each item in exactly one bucket. **Fifteen of the twenty-two
games belong in more than one of these**, and Quick Draw belongs in all three.
Forcing a single home would misfile most of the roster.

So: **three capability flags per game, and the UI filters on them.** In the
arcade that means a filter, not a tab tree — or tabs where a game may appear
under more than one, which is correct and which players never find confusing
("what can we play right now" is the only question they are asking).

## 2. Two taxonomies — one visible, one not

- **Visible (the player's):** surface × **genre**. People browse by *what do I
  do* — reflex, aim, push, race.
- **Invisible (the code's):** the control profile and the wire tier from
  `MINIGAME_CATEGORIES.md`. These are what *compute* the surface flags.

Never show a player a W-tier. Never hand-maintain the three surface lists.

## 3. Derive the flags, do not author them

This is the "seamless integration" part, and this repo already has the
cautionary tale: `MG_NET` and `MG_SHAPE` are two statements of the same fact,
and `qa/layout.js` had to be written to stop them drifting. Three hand-kept
lists across twenty-two games would drift by the third new game.

**Author four properties. Derive three flags.**

```js
// src/config/MinigameRegistry.js
export const MG_PROFILE = {
    tankclash: {
        genre:   'aim',        // what the player DOES — the visible sub-category
        control: 'dual',       // 'tap' | 'thumb' | 'dual'  — the control law
        wire:    'snapshot',   // none|stamp|scalar|events|snapshot|exact
        seats:   { min: 2, max: 4 },   // what the MECHANIC supports
    },
    // ...
};
```

`MG_SHAPE` already carries the fifth thing needed (`split` = private playfield).
The flags fall out:

```js
sharedTwo  = seats.min <= 2                                   // all 22
sharedMany = seats.max >= 3 && control !== 'dual'
             && device = (shape === 'split' ? 'tablet' : 'any')
online     = wire !== 'exact'
```

One QA probe asserts the derivation against a hand-written expectation, the same
way `qa/layout.js` guards the two registries today. A new game gets four
properties and its badges compute themselves.

---

## 4. The genre sub-categories

Seven, covering all 22, named for the verb:

| Genre | Games |
|---|---|
| **REFLEX** — fastest finger | Quick Draw · Shape Snap · Snap Strike |
| **NERVE** — hold it, time it | Steady Hand · Rhythm Forge · Freeze |
| **SCRAMBLE** — dodge and collect | Meteor Dodge · Loot Catch · Tree Climb |
| **AIM** — hit the target | Tank Clash · Penalty · Clear Out · Orb Deflect |
| **PUSH** — take the space | Sumo Spheres · Light Cycles · Puck · Bomb Pass |
| **RACE** — first past the post | Grand Prix |
| **BRAIN** — remember and outthink | Memory Match · Four in a Row · Grid Recall · Odd One Out |

**RACE has one game in it.** That is a real content gap and the genre leans on
racing hard — worth knowing before picking what to build next.

---

## 5. What each surface actually contains

### Shared screen, 2P — **22 of 22**
Everything. This is what the roster was built for and nothing changes.

### Shared screen, 3–4P — **7 on a phone, 14 on a tablet**

This is the sharpest form of the iPad argument, and it is better than the one in
the earlier document. It is not "206 × 400 is too small" — it is:

> **A phone gets you 7 games at four players. A tablet gets you 14.**

- **On a phone (7)** — the shared-arena games, because an arena is 412 × 648 at
  two players *and* at four; only the control bands change.
  Quick Draw · Shape Snap · Sumo Spheres · Light Cycles · Clear Out · Freeze ·
  Grand Prix
- **A tablet adds 7 more** — every game that needs a private playfield each,
  which is where quarters at 410 × 544 clear the floor and quarters at 206 × 400
  do not.
  Meteor Dodge · Loot Catch · Tree Climb · Odd One Out · Steady Hand ·
  Snap Strike · Grid Recall
- **Excluded (8)** — Tank Clash (dual control), Puck · Bomb Pass · Orb Deflect
  (2-player mechanics), Penalty · Four in a Row · Memory Match · Rhythm Forge
  (turn-based).

### Separate screens, 2–4P — **15 of 22, 6 today**
Per `MINIGAME_CATEGORIES.md`: six shipped (W0), nine behind one of four channels
(W1 timestamp, W2 scalar, W3 events, W4 snapshots), seven that stay 2-player.

---

## 6. The UI

### In a real match, the filter is invisible

The surface is already known before a minigame is ever chosen — the mode select
and the seat count decided it. **So the draw bag is built from the eligible set
and the player never sees the taxonomy at all.** This is the part that makes the
categories *do* something rather than be labels, and it is a three-line change
in `nextMgType()`.

A consequence worth stating: on a phone at four players the bag is 7 games deep,
and a match with six rounds will repeat. That is an argument for the tablet, and
for the arcade telling you so.

### In the arcade, the filter is the point

The arcade is a testing area, so it should show **more** than a player screen
would, not less.

**Layout, top to bottom:**

1. **Surface — a segmented control.** `ALL · 2P SHARED · 3–4P SHARED · ONLINE`.
   Four options, one axis, always visible: a segmented control, not a dropdown.
2. **Genre — a scrolling chip row.** The seven above, plus ALL. Single-select.
3. **The grid**, with a badge strip on every card.
4. **Footer** — PLAY / PRACTICE as today, plus a **surface picker for the test
   run** (see below).

**Every card carries three pips** — one per surface — lit or dim, with a tablet
mark on the ones that need one:

```
┌──────────────────────────┐
│  🎯  TANK CLASH          │
│  AIM                     │
│  Joystick to move and    │
│  aim, tap to fire.       │
│                          │
│  [2P●] [3-4P○] [NET●]    │
└──────────────────────────┘
```

So even inside a filter you can see a game's whole capability at a glance.

**Ineligible games are greyed, not hidden, with the reason on the card.** This
is the [documented consensus](https://www.uxtigers.com/post/inactive-buttons)
— 76% of practitioners recommend a muted disabled state with an explanation over
hiding — and it matters twice as much in a testing area, where "why is this not
here" is exactly the question being asked. The reason is one short line:
*"needs a tablet"*, *"dual controls"*, *"frame-exact — 2P only"*.

**Sort, within the filter:** `A–Z · GENRE · READINESS`. Readiness is the one
that earns its place in a testing area — it orders by *shipped → needs a channel
→ 2-player only*, which is the build queue.

### The one addition I would argue for

**A surface picker on the test run.** Selecting ONLINE and pressing PLAY should
open the loopback 4-seat harness rather than a 1v1. The arcade currently only
ever tests one of the three surfaces, which means two thirds of what this plan
categorises cannot actually be exercised from it. Optional, and the largest
piece of work in here — flag it as a phase of its own.

---

## 7. What other games do, and where this lands

- **[The reference app puts player count at the very top](https://apps.apple.com/us/app/1-2-3-4-player-games/id1635978552)** — it is
  literally the product's name, and the home screen is a count picker. Count is
  the first question, not a facet buried in a filter. This plan agrees, with one
  difference: our first question is *surface*, not count, because we have a
  third case those apps do not — separate devices.
- **[Jackbox and AirConsole](https://alternativeto.net/software/airconsole/)**
  run the opposite pattern: one shared screen everybody watches, phones as
  private controllers. Worth knowing because it is the shape we do *not* have —
  and it is the natural fourth surface if a TV/cast mode is ever wanted. Nothing
  in this plan blocks it; it would be a fourth flag.
- **Greying out beats hiding** for context-dependent unavailability, per the
  research above.

---

## 8. Phases, if this is approved

1. **The data.** `MG_PROFILE` for 22 games, the derivation, and a probe that
   holds it to a hand-written expectation. No UI. *Half a session.*
2. **The arcade filter.** Segmented control, genre chips, badges, greyed
   ineligibles with reasons, three sorts. *Half a session.*
3. **The invisible filter.** `nextMgType()` draws from the eligible set for the
   match's actual surface; the lobby says how deep the bag is and recommends a
   tablet when it is shallow. *Small.*
4. **The surface test run.** ONLINE + PLAY opens the loopback harness.
   *A session, and separable.*

## 9. What I would push back on

- **"4 player" should be "3–4 player."** Three people share a screen too and the
  constraints are identical. Naming it 4 hides a third of the case.
- **Do not let the three categories become three lists in the source.** Every
  time this repo has stored the same fact twice it has drifted, and both times a
  probe had to be written to catch it.
