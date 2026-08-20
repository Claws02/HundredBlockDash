# Space Reference

Every space type in Hundred Block Dash, what it actually does in code, and how
often it really appears on a board.

The distribution numbers are **measured**, not asserted. `qa/spaceaudit.js`
generates 200 real boards per length through the real generator and counts what
comes out — that is what makes the "exactly 20 mysteries" claim below a fact
rather than an intention.

Regenerate with:

```bash
npx http-server -p 8129 -c-1 &
cd qa && node spaceaudit.js 200
```

---

## 1. What every space does

Effects are the code in `resolveSpaceEffect()` (`src/core/GameController.js`),
not the marketing copy. On Hundred Block Dash the name and blurb are re-skinned
per realm (`HBD_BIOMES[].flavor`), but the effect is identical everywhere.

### Coins in

| | Space | Effect |
|---|---|---|
| 🪙 | **COIN** | +3 coins. +1 more with a Vendor ally. |
| 💰 | **BIG COIN** | +8 coins. +1 more with a Vendor ally. |
| 🧲 | **MAGNET** | Steal up to 5 coins from your opponent. Good for you, bad for them — *not* a red space. |
| 🕊️ | **TRUCE** | Both players gain 5 coins. |
| 🏛️ | **DISTRICT HQ** | City only. First visit this lap +15 coins, revisits +5. Paid for **passing over** it — you do not have to land on it. |

### Coins out — the "red" spaces

These are the only three the 1-per-10 budget counts.

| | Space | Effect |
|---|---|---|
| 💸 | **FINE** | −3 coins. Blocked entirely by a Shield. |
| 🔥 | **BIG FINE** | −8 coins. Blocked entirely by a Shield. |
| ⚠️ | **TRAP** | −5 coins. Blocked entirely by a Shield. |

### Movement

| | Space | Effect |
|---|---|---|
| ⚡ | **BOOST** | Roll again immediately. Your turn does not end. |
| 🌀 | **SHORTCUT** | Announces, then moves you 3–8 spaces forward after you acknowledge it. |
| 🚀 | **LAUNCH** | Announces, then moves you **10 forward**. |
| 🌑 | **PULLED BACK** | Announces, then moves you **10 backward**. Costs no coins. |
| 🔄 | **SWAP ZONE** | Trade board positions with your opponent. The late-game decider. |
| ⚓ | **ANCHOR TRAP** | Player-placed via an item. Dragged back 5 spaces; your own is free. Never generated. |

### Structure

| | Space | Effect |
|---|---|---|
| 🏁 | **START** | Block 0 / the City start. Nothing happens. |
| 👑 | **THE CROWN** | HBD finish. Reaching it ends the match with a finish bonus — but **most coins still wins**. |
| 🔒 | **THE GATE** | Blocks the road until someone rolls 5 dice for **20+** on HBD, **15+** on City. Opens for *both* players. |
| 🔓 | **GATE (OPEN)** | Pass through freely. |
| 🏪 | **ITEM SHOP** | Opens the shop. Themed per realm/district. |
| 🎁 | **MYSTERY** | A random item straight into your bag, with a card naming it. |
| ⚔️ | **DUEL** | City only. +3 coins to ante up, set a coin bet, then play a minigame for the pot. |

---

## 2. Hundred Block Dash — measured distribution

The headline types are **exact quotas**, not weighted draws: the generator now
computes how many of each the board should carry from its length and places
exactly that many, every time. The measured spread below is over 200 boards per
length — where a number is a whole integer it is that on **every single board**.

Per 100 blocks: **20 mystery · 20 coin · 10 big coin · 5 fine · 5 big fine**,
with everything else sharing what is left.

| Space | 50 blocks | 75 blocks | 100 blocks |
|---|---:|---:|---:|
| 🪙 COIN | **10** | **15** | **20** |
| 🎁 MYSTERY | **10** | **15** | **20** |
| 💰 BIG COIN | **5** | **8** | **10** |
| 💸 FINE | **3** | **4** | **5** |
| 🔥 BIG FINE | **2** | **3** | **5** |
| 🏪 ITEM SHOP | **2** | **3** | **4** |
| 🏁 START · 🔒 GATE · 👑 CROWN | **1** each | **1** each | **1** each |
| 🔄 SWAP ZONE | 3.05 | 3.44 | 4.42 |
| ⚡ BOOST | 2.66 | 4.08 | 5.59 |
| 🧲 MAGNET | 2.29 | 3.81 | 6.08 |
| 🌑 PULLED BACK | 2.29 | 3.96 | 5.42 |
| 🌀 SHORTCUT | 2.13 | 3.11 | 4.96 |
| 🕊️ TRUCE | 1.56 | 2.19 | 2.98 |
| 🚀 LAUNCH | 1.00 | 3.42 | 3.54 |

The bolded rows are guaranteed. The rest are realm-weighted filler for whatever
slots the quotas leave over, so they vary board to board — which is where the
character of each stretch of road comes from.

### The red budget

| Length | Red spaces | Cap (1 per 10) | Gap between reds — min / median / mean |
|---|---:|---:|---|
| 50 | 5 | 5 | 6 / 10 / 9.8 |
| 75 | 7 | 7 | 6 / 11 / 10.6 |
| 100 | 10 | 10 | 5 / 10 / 9.9 |

The budget is now spent in full rather than under-used, split evenly between the
two fines, and placed at evenly-spaced positions with a minimum gap of two — so
the shortest run between two coin losses is 5 blocks and the typical one is 10.

**TRAP is not in the HBD mix.** With a budget this small a third red type only
muddies what a red space means. It still exists on City Circuit.

### Balance read

- **Coins in vs coins out.** 30% of the board pays you directly (coin + big
  coin), 20% hands you an item, and 10% taxes you. Deliberate: the road is
  generous, and the tension comes from *position* rather than poverty.
- **The fines got smaller as they got more common.** Ten reds on a 100-block
  board at −3 and −8 costs less in total than the old eight at −4 and −10, but
  you meet one more than twice as often — so a red space is now a regular part of
  the rhythm rather than a rare spike.
- **Mystery is the biggest single category after coin.** One block in five hands
  you an item, which is what makes the narrowed seven-item shop matter: you will
  be holding something most turns.

---

## 3. City Circuit — fixed pools, 60 nodes

Unlike HBD this is not randomised per match: the per-district pools are shuffled
into the same slots every time, so the count is exact.

| Space | Per board | Share |
|---|---:|---:|
| 💰 BIG COIN | 9 | 15.0% |
| 🪙 COIN | 8 | 13.3% |
| 🏪 ITEM SHOP | 6 | 10.0% |
| 🎁 MYSTERY | 6 | 10.0% |
| 🔄 SWAP ZONE | 5 | 8.3% |
| ⚔️ DUEL | 5 | 8.3% |
| 🧲 MAGNET | 5 | 8.3% |
| 🏛️ DISTRICT HQ | 4 | 6.7% |
| ⚠️ TRAP | 3 | 5.0% |
| ⚡ BOOST | 3 | 5.0% |
| 🔥 BIG FINE | 2 | 3.3% |
| 🏁 START · 🕊️ TRUCE · 💸 FINE · 🔒 GATE | 1 each | 1.7% each |

**Red total: 6 of 60 — exactly 1 per 10.**

> **No space on City Circuit moves you along the track.** SHORTCUT (+3–8),
> LAUNCH (+10) and PULLED BACK (−10) were removed from every City pool in the
> 2026-08 pass. City is the board where you *choose your route* — a twelve-space
> Back Alley or a five-space Ring Road — and a tile that fires you ten nodes down
> the road cancels that choice after you have already committed to it. Movement
> now comes from the die, from BOOST (a real extra roll, not a teleport), and
> from items a player deliberately bought. Their slots went to MYSTERY, MAGNET,
> BOOST, DUEL and SWAP ZONE, which keeps each district's character without
> touching anybody's position on the track.
>
> SWAP ZONE stays: it relocates *both* players symmetrically and is the one
> effect the player behind actively wants, so it reads as an event rather than
> as lost progress. The Anchor and Rocket items still move people — those are
> purchases, made on purpose, with the cost known up front.

> **Changed by this audit.** The old pools carried **13 red of 60 — one every 4.6
> nodes**, nearly three times the HBD rate. That bites harder here than on HBD,
> because City is a *lap* map: you pass the same tiles again on every circuit, so
> a punishing tile is a recurring tax rather than a one-off. The 1-per-10 rule
> now applies to both boards. The seven removed reds were replaced with
> disruption that costs no coins (SWAP ZONE, MAGNET, DUEL), so the Back Alley is
> still the nastiest stretch — it just takes your *coins off you in a fight*
> instead of taxing you for standing still.

### Per district

| District | Character |
|---|---|
| **City Ring Road** (17) | The generous baseline: 8 coin tiles, 3 mysteries, 2 boosts. 2 red. |
| **Financial District** (8) | Big money, big risk: 3 BIG COIN, 2 magnets, a BIG FINE. 1 red. |
| **Back Alley** (10) | Chaos: 3 magnets, 3 swaps, 2 duels. 2 red. |
| **Shopping Promenade** (8) | Safe and generous — mysteries and coins, **0 red**. |
| **Industrial Zone** (5) | Small, behind the Gate, and high-variance. 1 red. |

---

## 4. The shop — seven items, one per verb

Narrowed from twelve. Five of the originals did the same job as another: Warp
Drive forced a 5 while Custom Dice picks any number for four more coins, and
Double Die and Overcharge were two more ways to say "bigger roll". Five ways to
move further is one choice with four decoys.

| | Item | Price | The verb it owns |
|---|---|---:|---|
| 🛡️ | **Shield** | 8 | Defend — blocks the next negative space |
| ⚓ | **Anchor** | 12 | Trap their path — sends them back 5 |
| 💀 | **Cursed Die** | 16 | Sabotage their roll — forces a 1 or 2 |
| 🎯 | **Custom Dice** | 16 | Control your roll — pick any 1–6 |
| 🛸 | **Rocket** | 20 | Jump forward 8, no roll needed |
| 🐷 | **Steal** | 20 | Take 10 of their coins |
| 🔄 | **Swap** | 20 | Trade board positions |

**Cut:** Warp Drive, Double Die, Overcharge (all "bigger roll"), Tollbooth (a
second, weaker trap, and a coin tax at a time when coin taxes are deliberately
scarce), Mirror (a reactive counter that does nothing on most turns and asks you
to predict an item you cannot see). They are gone from `ITEMS` entirely, so
Mystery spaces cannot grant them either.

District shops carry a subset: Wall Street sells Steal / Swap / Custom Dice, the
Underground Market sells Anchor / Cursed Die / Shield at 25% off, and the Power
Plant sells Rocket / Custom Dice / Swap. Every other shop carries all seven.

---

## 5. Reading it in-game

The map view (🗺️ MAP on your turn) now answers the two questions the audit says
matter, on both boards:

- **What does that space do?** Tapping a tile shows the effect line from this
  document — realm-flavoured on HBD.
- **How far away is it?** "➜ 7 spaces ahead · reachable with a 7", or "↩︎ 3 spaces
  behind you", or "📍 You are standing here". On City the count follows the lap
  order, so a tile 12 behind on the ring reads as 48 ahead — which is the number
  that actually matters, because that is how far you have to travel to reach it.
