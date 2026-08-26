# Multiplayer — 4 players, 4 phones, one shared game

**Goal.** Four people, each on their own phone, in the same room. Every phone
renders the same game — same board, same token positions, same minigame arena —
and each phone drives exactly one character. Zero hosting cost.

**Player count is variable: 2, 3, or 4 phones.** Whoever is in the lobby when
the host presses START is who plays. Empty slots are simply not filled — there
is no "you need four" gate.

**Decisions taken** (2026-08-25): scope of the first pass is Phase A + Phase B;
transport is Trystero WebRTC P2P; minigames use the registry-tagged hybrid.

> **Status: Phase A and Phase B are built.** Section 6 below is the record of
> what landed, what it was verified against, and the one thing that is
> deliberately a placeholder (minigames across phones — Phase C).

---

## 1. What the game is today

Read of the whole tree (46k lines, no build step, ES modules served static,
`three.min.js` + `cannon.min.js` vendored locally).

| Layer | File(s) | State |
|---|---|---|
| Truth | `src/core/GameState.js` | `state.players` is a **literal two-element array**. Two hand-written player objects, not generated. |
| Flow | `src/core/GameController.js` (2324 ln) | Turn order is `(activePlayer + 1) % 2`. Start player is `Math.floor(Math.random() * 2)`. 17 direct `players[0]` / `players[1]` reads. |
| Scoring | `src/core/WinScreen.js` | `const p1 = players[0], p2 = players[1]` — pairwise comparisons throughout (district dominance, tiebreaks). |
| HUD | `index.html`, `css/styles.css` | Exactly two `.hud-bar`s, pinned top and bottom. Two `.action-row`s. Everything keyed `p1`/`p2`. |
| Tabletop | `src/ui/DualRead.js`, ~40 CSS rules | Whole subsystem for making one screen readable from two ends: 180° mirrors, flip buttons, `.tabletop-p2-turn` canvas rotation. |
| Minigames | 22 active in `src/minigames/` | All 1v1. Screen split into `#mg-p1` / `#mg-p2` halves, top one rotated 180°. Per-game locals are `_p1`/`_p2`, `_input1`/`_input2`, `_vel1`/`_vel2`. Bot drives slot 1. |
| QA | `qa/*.js` | 20 Playwright probes driving the real game in Chromium. Single page, single browser. This is the project's safety net and it currently cannot see a second device. |

**Two things this survey changes about the plan.**

1. The board game is close to N-player. Turn order is already modular, movement
   is graph-based and player-agnostic, `resetPlayers()` already loops. The
   2-player assumptions are concentrated in ~5 files and are mostly mechanical.

2. **Online mode deletes work rather than adding it.** Tabletop exists only
   because two people share one screen. When each player has their own phone,
   every 180° rotation, every mirrored card, every split-screen half, and all of
   `DualRead` becomes dead weight. Online mode should be its **own presentation
   path** (`body.online-mode`), not a fourth variant of tabletop. A minigame in
   online mode gets the *whole* screen for one player — which is a simpler
   rendering job than what it does today.

---

## 2. The networking model

### Host-authoritative, input-forwarding

- The phone that **creates the room is the host.** It runs `GameController` and
  every minigame simulation exactly as the game does today.
- The other phones are **clients**. They render, but never mutate `state`.
  Every tap, flick, and joystick vector is sent to the host as an *intent*.
- The host applies intents and broadcasts state back:
  - **Board (turn-based):** event + full-snapshot sync. A snapshot of the whole
    `state` is a few KB and only needs to move a handful of times per turn.
    Latency is irrelevant here.
  - **Minigames (real-time):** a compact per-frame snapshot of only the dynamic
    entities, at ~20 Hz, with client-side interpolation between frames.

Why host-authoritative and not lockstep/deterministic: the game uses `cannon.js`
rigid-body physics for the dice and floating-point integration in the minigames.
Neither is bit-deterministic across devices. Lockstep would desync within
seconds. Host authority sidesteps the entire problem.

Cost of that choice, stated plainly: if the host's phone leaves, the match ends.
Host migration is real work and is explicitly **out of scope** — the recovery
path is "start a new room", which for a party game in one room is acceptable.

### Transport: WebRTC peer-to-peer, via Trystero

[Trystero](https://trystero.dev/) does WebRTC matchmaking with **no signaling
server of your own** — it bootstraps peer discovery over public infrastructure
(BitTorrent trackers, Nostr relays, MQTT brokers) and then all game traffic runs
directly phone-to-phone, encrypted. MIT licensed, vendored locally like
`three.min.js` so the game keeps its "works behind a restrictive network"
property.

**Why this over a relay server:**

| | WebRTC P2P (Trystero) | Cloudflare Worker + Durable Object |
|---|---|---|
| Cost | £0, permanently | £0 on today's free tier (~3M req/mo) |
| Accounts / deploy | none | Cloudflare account, `wrangler`, a deploy step |
| Repo impact | one vendored file | adds a build/deploy pipeline to a zero-build static site |
| Latency, same room | direct, ~5–20 ms | out to the edge and back, ~40–120 ms |
| Failure mode | ~5–15% of networks (symmetric NAT, strict corporate WiFi) can't connect without a TURN relay, which is not free | connects essentially always |
| "Free" durability | not a pricing tier — can't be revoked | a free tier, which can change |

For four people on one home WiFi — the actual use case — P2P wins on every axis
that matters. The NAT risk is the one real hazard, and it is smallest exactly in
the case we're building for (same LAN).

**Mitigation, and the escape hatch:** the transport goes behind a `NetTransport`
interface with `send`/`onMessage`/`onPeerJoin`/`onPeerLeave`. Trystero is one
implementation. If public-tracker signaling proves flaky in real testing, a
WebSocket relay implementation drops in behind the same interface without
touching a line of game code.

### Room join UX

Host taps HOST GAME → gets a **4-character room code** (`BX7Q`) plus a QR code.
Others tap JOIN, type the code or scan. Lobby shows who's in, each picks a
character, host presses START. Any player slot left empty at start can be filled
by a bot or the match runs at 2/3 players.

---

## 3. New modules

```
src/net/
  NetTransport.js   interface + Trystero implementation; room create/join, send, events
  NetSession.js     roles, peer roster, player-slot assignment, join/leave/timeout
  NetProtocol.js    message schema + versioning (INTENT, SNAPSHOT, MG_FRAME, MG_INPUT, LOBBY)
  NetSync.js        host: state serialise + broadcast. client: apply + guard against local mutation
  NetInput.js       client-side intent capture; host-side intent validation ("is it your turn?")
vendor/
  trystero-*.min.js
qa/
  net.js            NEW harness: 4 Playwright contexts, one room, one match
```

Nothing in `src/core`, `src/engine`, or `src/minigames` gets a networking
import. The net layer calls *into* the game; the game does not know it exists.
That keeps 1P/tabletop/pass-and-play working untouched and keeps the existing 20
QA probes valid.

---

## 4. Phases

Each phase ends green on the existing QA suite plus its own new probe.

### Phase A — N-player core (offline, hot-seat) · IN SCOPE

**No networking at all.** Make the game support 2/3/4 players locally first.
This de-risks everything: it's testable with the harness that already exists,
and every bug found here is a bug that would otherwise have been blamed on the
netcode.

- `GameState`: generate `state.players` from a count via a factory; kill both
  literals. Every `[false, false]` pair → length-N array.
- `GameController`: `% 2` → `% state.players.length`. Replace all 17
  `players[0]`/`players[1]` reads. Opponent-singular logic (`_playSwap`, duels,
  magnet/steal) becomes "choose a target" — with a picker for humans.
- `WinScreen`: pairwise → sort by score; district dominance becomes "most visits
  takes it, ties split nothing"; tiebreak chain generalised.
- `Renderer`: 4 tokens on one tile need a deterministic offset ring so pieces
  don't z-fight; camera framing when 4 players are spread across the board.
- Board rules that assume two: buddy steal targets, contract races, gate.
- HUD: a compact 4-slot layout (four thin bars, or one bar for you + three
  chips for rivals). This is the real layout problem, not a code problem.
- **Verify:** existing suite green in 2P; new `qa/fourlocal.js` plays a full
  4-player City match to the win screen with no soft-lock and no leak.

### Phase B — Transport, lobby, and the networked board · IN SCOPE

- Vendor Trystero; build `NetTransport` + `NetSession`.
- Host/Join screens, room code, QR, lobby with character picking.
- Board play fully networked: intents up, snapshots down.
- `body.online-mode`: one player per screen, all tabletop rotation and DualRead
  mirroring **off**. Non-active players see a live spectator view with "waiting
  on Ana" rather than dead buttons.
- Reconnect-on-drop within a grace window; bot takes over a player who leaves.
- **Verify:** `qa/net.js` — 4 browser contexts join one room and play a full
  board match; assert all four `state` snapshots agree at every turn boundary.

### Phase C — Minigames, tranche 1 · next pass

Add `players` and `netMode` fields to `MinigameRegistry`. Give minigames a small
optional contract:

```js
export function netSnapshot()        // host → wire, dynamic entities only
export function netApply(snapshot)   // client ← wire, interpolate toward it
export function netInput(pid, input) // host ← client intent
```

Convert a tranche of 4–6 that covers different verbs and convert cleanly to
4-player free-for-all — candidates: **Sumo Spheres** (better with 4), **Light
Cycles**, **Meteor Dodge**, **Grid Recall**, **Loot Catch**, **Grand Prix**.
Only converted games enter the online draw bag.

**Verify:** extend `qa/arcade.js` shape to a networked variant — synthetic input
from four contexts, assert every client's render state tracks the host's within
tolerance, and that each game still resolves and tears down.

### Phase D — Minigames, the rest · later

The remaining ~16, in tranches. Structurally-1v1 games (Penalty, Puck, Quick
Draw, Four in a Row, Orb Deflect, Bomb Pass) get a decision each: convert to a
real 4-player variant, or run as a **1v1 duel with the other two spectating**.
Both are legitimate; a party game is allowed to have duels.

### Phase E — Polish · later

Latency masking on client input (local echo for your own token), disconnect UX,
spectator camera, per-player haptics, and a real look at what 4 players does to
match length and to the 6/12/20 round tuning.

---

## 5. Honest cost and risk

**Effort.** Phase A is the largest single lump of *code* (5 files, deep). Phase
C+D is the largest lump of *total work* — 22 games × (N-player rework +
full-screen viewport + net contract + verification). This is not a one-session
feature. A: one substantial pass. B: one. C: one. D: several.

**Risks, most likely first.**

1. **HUD layout for four on a phone.** Two bars fill the top and bottom already.
   Four does not fit at the same density. This is a design decision that has to
   be made, not engineered around.
2. **Minigame netcode feel.** 20 Hz + interpolation is fine for Sumo Spheres and
   Light Cycles. It is *not* obviously fine for Quick Draw, where the whole game
   is reaction time and a 30 ms client-side lie decides the round. Reaction games
   need timestamped input judged on the host, not position sync.
3. **NAT traversal.** ~5–15% of networks need TURN, which is not free. Small on
   home WiFi. The `NetTransport` interface is the insurance.
4. **QA blind spot.** Every probe today drives one page. Until `qa/net.js`
   exists, nothing in the suite can catch a desync. Build it in Phase B, not
   after.
5. **Balance.** Every number in `GameConfig` was tuned for two. Buddies, bounties
   and shops all get scarcer per-head at four. Phase E, but flagging now.

**What stays free.** Trystero is a library, not a service — no tier to lose. The
public trackers/relays it uses for signaling are a dependency on someone else's
goodwill, but they are only touched at join time, and swapping strategy is a
one-line change. Hosting stays a static site.


---

## 6. What was built (2026-08-25)

### Phase A — the board plays with 2, 3 or 4

| Change | Where |
|---|---|
| Seats are data. `PLAYER_SLOTS` (name, colour as both int and hex, icon, default character) replaces two hand-written player literals. `makePlayer(id)` builds one; `setPlayerCount(n)` resizes the table and every per-seat array with it. | `config/GameConfig.js`, `core/GameState.js` |
| Turn order is `% playerCount()`. Character select walks every human seat. The rematch prefs blob carries a seat count and a character list (and still reads the old two-key shape). | `core/GameController.js` |
| **`core/Targeting.js` — new.** Hostile effects auto-target by a written rule instead of `players[(id+1)%2]`: coin theft hits the richest rival, swaps and traps hit the leader, duels hit the nearest. Every rule reduces to the only other player at two seats, so 1v1 matches are unchanged. | `core/Targeting.js` |
| Win screen ranks instead of comparing pairs. District dominance goes to the outright most visits (a tie at the top pays nobody), and the race chart draws a line per seat. | `core/WinScreen.js` |
| Tokens on the same tile spread around a small ring above two seats, and keep the exact shipped left/right offsets at two. | `engine/Renderer.js` |
| **HUD has two layouts.** Two seats keep the bar-per-edge the game shipped with — that is what tabletop needs and what every existing probe reads. Three or four (and online at any count) switch to one full bar for the seat this device is playing plus a compact rival strip. | `ui/UIManager.js`, `index.html`, `css/styles.css` |
| A minigame keeps its two SLOTS; a roster says which real SEATS are in them. Above two players the round's minigame is a duel picked by a fixed rotation, and the players who did not take part neither gain nor lose. | `minigames/MinigameManager.js` |

### Phase B — the same game on 2–4 phones

```
src/core/Commands.js       every player decision, named. Offline: a direct call.
                           Online: the client's dispatcher forwards it instead.
src/ui/Scenes.js           every full-screen beat, named and classified
                           SHARED (everybody) or OWNER (one player).
src/net/NetTransport.js    Trystero behind a five-method interface.
src/net/LoopbackStrategy.js  a room between tabs of one browser (?net=local).
src/net/NetProtocol.js     the wire format and the snapshot.
src/net/NetSession.js      roles, roster, seats, join/leave, authority.
src/net/NetSync.js         host: poll + push. client: apply. + intent authority.
src/net/NetGame.js         the wiring; the client's replica guard.
src/ui/Lobby.js            host / join / roster / character pick / START.
vendor/trystero-*.min.js   two bundled strategies + a rebuild note.
```

**Four decisions worth knowing about.**

1. **The host polls its own state at 20 Hz rather than emitting from the turn
   flow.** There are ~40 places that mutate state during a turn; the first one
   anybody forgets to instrument is a silent desync. A poll cannot be forgotten,
   and at 20 Hz a client sees every intermediate square of a walk and animates
   the same hops the host does.

2. **A client is a replica, and there is exactly one line that makes it one.**
   `startGame()` builds the whole match — board, meshes, camera — and then does
   not enter the turn engine. Nothing else in `GameController` can start without
   that entry, so a client's copy is inert for the whole match and has nothing
   to fight the snapshots with.

3. **The host is checked like everybody else.** A client's intent goes through
   `NetSync.authorised()`; the host's own presses originally went straight
   through, because locally a control is only rendered for the seat whose turn
   it is. Over the wire that guarantees nothing — the probe caught the host
   rolling on another player's go — so the same function now gates both.

4. **Owner beats do not travel.** A snapshot says what the game *is*; it cannot
   say that the shop is open, headed *Back Alley*, at 20% off. So beats are
   mirrored separately — and classified. The shop, the item bag, the discard
   picker, the wager and the junction fork go to *one* phone. Putting them on
   all four would not be "the same screen", it would be three people watching
   somebody else shop.

### The three stalls, and what they had in common

Getting a networked turn to complete took three fixes, and they are the same
bug wearing different hats. Each one froze the match for exactly one player —
the one whose decision it was — and each was **silent**: no error, no warning,
just a phone with nothing on it to press.

| # | What broke | Why it was invisible |
|---|---|---|
| 1 | The **result card** was emitted with no `seat`, so the mirror had no phone to send it to and dropped it. That card closes almost every turn. | The host raised its own copy locally, so the host's turns completed normally. Only a client's turn hung — which made the symptom look like slowness rather than a freeze. |
| 2 | **Duels and Buddy fights** still launched a real minigame online. There are three routes into a minigame and only the round-end one was intercepted. | It froze on the first Duel or Buddy tile anybody landed on, so how far a match got was luck. That variance read as contention. |
| 3 | The **shop offer** is raised by `showModal()` directly from `_checkPassThroughShop`, bypassing `showShopOffer()` and its announcement. | Same again: visible on the host, absent on the client. |

The fixes were structural rather than three patches. All three minigame routes go
through one `_contest()` helper. Every modal announces itself from `showModal()`
— the one place a modal actually goes up — rather than from whichever helper
somebody remembered.

And because the class is silent by nature, `qa/parsecheck.sh` now guards it
statically: **every emitted scene must be classified in `SCENE_TIER`, and every
OWNER scene must carry a `seat`** (phase 4), alongside **every command
resolving to exactly one implementation** (phase 3). Both are the difference
between "delivered to one phone" and "dropped", and neither is visible at
runtime until somebody is holding the other phone.

> **A note for whoever debugs this next.** A low turn count in `qa/net.js` is a
> stall until proven otherwise. It was misread as this container being slow
> once, and the bar was relaxed on that reading — the relaxed bar then caught it
> anyway, at zero. Measured pace with the stalls fixed is **87 s/turn at two
> pages, 114 s at three**; anything far off that is a freeze, not hardware. The
> probe prints the pace and dumps per-page state when it falls short.

**Not built, deliberately:**

- **Minigames across phones.** All 22 are 1v1 split-screen games reading local
  touches. Launching one online would give the host a playable game and everyone
  else a frozen board — worse than not launching it. So online, the round's
  contest is **a draw between the two players in the rotation, announced as
  exactly that**, and the board match is whole end to end. This is Phase C and
  it is the single biggest remaining piece of work.
- **Host migration.** If the host leaves, the match ends. A client leaving is
  handled: the bot takes their seat and play continues.
- **A QR code in the lobby.** The OS share sheet (`navigator.share`, falling
  back to the clipboard) is better on a phone, and a QR needs a Reed–Solomon
  encoder that is either right or silently produces an unreadable square.

### Verification

| Probe | What it drives |
|---|---|
| `qa/fourlocal.js` | Real 3- and 4-seat hot-seat matches to the win screen: seat/array sizing, turn rotation, the solo HUD (including the stale-`data-roll` soft lock), token spread, minigames as duels with untouched bystanders, ranked result cards. |
| `qa/net.js` | N pages in one browser over the loopback transport: one room, ordered seats, the match starting everywhere, **every page agreeing with the host at every turn boundary**, a client rolling its own dice, a press from the wrong page being refused, and shared-vs-owner beat routing. Green at 2 seats (16/16, 6 turns at 87 s/turn) and 3 seats (17/17, 8 turns at 46 s/turn on the reshaped map, with real minigames in the round). |
| `qa/lobby.js` | The front door and the room: two ways in, no name asked before there is a room to be named in, the host naming seats nobody named, a rename in the room reaching the other device, 3D character portraits, and a taken character saying whose it is. Caught a host that could not pick a character at all — the grid was rebuilt on every roster change and blurring the name box IS a roster change, so the button was replaced between press and release. 16/16. |
| `qa/netmg.js` | A real minigame round across two devices: the announcement reaching both, the game running and visible on both, scores coming back, one scoreboard, and the round letting go of the screen afterwards. 11/11. |
| `qa/soloframe.js` | Runs each parallel game alone and reads the canvas back: something drawn in the top half, something in the bottom half, and the frame changing between samples. The cheapest statement of "it is on the screen and running" that does not care what the game looks like — and the thing that would have caught Tree Climb rendering below the screen. |
| `qa/mapshot.js` | Boots a map and photographs it from three angles, so the board's shape can be judged by looking at it rather than by reading the layout table. This is what showed City Circuit was a bullseye. |
| `qa/parsecheck.sh` | Now also checks the **command bus agrees with itself**: no command invoked without an implementation, none implemented that nothing invokes, and no name registered twice (whichever module body runs last would silently win). Nothing in JavaScript connects `Commands.run('roll')` to its registration, and on a client a broken name fails on the HOST, where nobody is looking. |

`qa/net.js` substitutes the WebRTC hop, and nothing run in one browser can
prove two phones will find each other. **Two real devices on real WiFi is the
one test that has not been run** — see §7.

---

## 8. Minigames across phones (2026-08-25)

Networked rounds used to announce a draw. They play a real game now.

### Parallel play, and why it needs no netcode

Every game in the roster was built as one screen two people share: bottom half
P1, top half P2, both simulated in the same browser. Making one of those play
across devices means agreeing on a physics step and reconciling input latency —
a bigger job than the whole board was.

But not all of them need it. Six games never let one half touch the other:
**Meteor Dodge, Loot Catch, Steady Hand, Odd One Out, Snap Strike, Tree Climb**.
They are two solitaires racing a clock, and every one of them says so in its own
description — "most caught", "highest when it runs out", "most correct in thirty
seconds". A game of that shape does not need to be synchronised to be played
together: every phone runs the same challenge at the same time, alone, and the
scores are compared.

That is also the only version that scales past two. Four solitaires run as
happily as two, where four tanks in one arena would not — so **online rounds are
played by the whole table**, not by a rotating pair. The pairing was a
consequence of two people sharing one screen, and across phones that reason is
gone.

`MG_NET` in the registry is where the distinction is written down; `_contest()`
asks it what to do with a round, and falls back to the old draw if the registry
ever has no parallel game in it.

### The same seed is not the same challenge

The first version seeded a shared random and had the games draw from it. A
timeline probe showed two devices playing "the same" Meteor Dodge drifting apart
within seconds: a stream is only identical if both devices consume it at the
same points, and the games draw on a timer inside an animation frame. One player
got a kinder storm than the other and the scores being compared had been earned
against different games.

Every draw a score depends on is now taken **by index** — `SoloArena.draw(i)`,
a hash of the seed and an integer. The 6th meteor is the 6th meteor on every
phone whether it left at 4.9 seconds or 5.1, and the timing drops out entirely.

### What a round looks like

| | |
|---|---|
| host | picks a game and a seed, announces both (`soloGame`) |
| all | see a card saying what it is and who is in it — including the phones not playing, because a screen that goes quiet for thirty seconds reads as a crash |
| playing | run it alone, full screen |
| all | report a score; a phone that never answers is a zero after a grace period, so one locked screen cannot stall the table |
| host | ranks, pays out any coin-game hauls, announces (`soloResult`) |
| all | read the same scoreboard, then it is taken down (`soloClose`) |

### Two things this got wrong first, and what they taught

**A shared guard between two owners.** `soloFinish()` and the harness's own
`settle()` both tested and set `_scored`. `soloFinish` set it, `settle` saw the
round as already finished, and every score was dropped — so every round ran to
the 90-second watchdog and scored zero. A flag with two owners is not a guard.

**Reconciling a screen that is meant to differ.** `#solo-layer` was added to
`BEAT_OVERLAYS`, which forces every device to match the host's screen. But each
player dismisses their own card when they start playing, so the devices are
*supposed* to be out of step — and the host pressing START closed everybody
else's card before they could. It has an explicit `soloClose` instead. The
overlay list is for beats the host raises for the table; this is not one, and
the exception marks the boundary of the rule rather than breaking it.

---

## 7. What has NOT been verified

- ~~**Two physical devices.**~~ Done, by the author: a phone hosting and a
  computer joining reached the same room and played the same match. WebRTC
  signalling and NAT traversal work. What that run has NOT covered is four
  devices, or two devices on different networks.
- **How any of this looks on a real phone.** Everything has now been looked at
  in a 412×892 viewport rather than only measured — which is how three separate
  layout faults were found in one pass (a mirrored status strip upside-down over
  the game, a HUD sitting in the meteors' path, and Tree Climb drawing its
  entire tree below the bottom of the screen). A real handset is still a
  different thing: safe-area insets, notches, and a browser chrome that moves.
- **A minigame round on more than two devices.** The scoring, ranking and
  payout all take N seats and the scoreboard was drawn at four, but every
  round driven end to end so far has been at two.
- **Bandwidth and battery** of a 20 Hz snapshot over a real WebRTC data channel.
- **Balance at three and four players.** Every number in `GameConfig` was tuned
  for two; buddies, bounties and shops all get scarcer per head. Phase E.
