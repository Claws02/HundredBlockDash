# Space Reference

Every space type in Hundred Block Dash, what it actually does in code, and how
often it really appears on a board.

The distribution numbers are **measured, not read off the weight tables**.
`qa/spaceaudit.js` generates 200 real boards per length through the real
generator and counts what comes out. That matters because the weights are drawn
from a bag *with replacement* and the coin-loss budget is capped independently of
them, so the weight constants do not tell you the answer.

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
| 🏛️ | **DISTRICT HQ** | City only. First visit this lap +15 coins, revisits +5. |

### Coins out — the "red" spaces

These are the only three the 1-per-10 budget counts.

| | Space | Effect |
|---|---|---|
| 💸 | **FINE** | −4 coins. Blocked entirely by a Shield. |
| 🔥 | **BIG FINE** | −10 coins. Blocked entirely by a Shield. |
| ⚠️ | **TRAP** | −5 coins. Blocked entirely by a Shield. |
| 🚧 | **TOLLBOOTH** | Player-placed via an item. Pay the owner 5 coins; landing on your own is free. Never generated. |

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
| 🔒 | **THE GATE** | Blocks the road until someone rolls 5 dice for ≥15. Opens for *both* players. |
| 🔓 | **GATE (OPEN)** | Pass through freely. |
| 🏪 | **ITEM SHOP** | Opens the shop. Themed per realm/district. |
| 🎁 | **MYSTERY** | A random item straight into your bag, with a card naming it. |
| ⚔️ | **DUEL** | City only. Set a coin bet, then play a minigame for the pot. |

---

## 2. Hundred Block Dash — measured distribution

200 generated boards per length. Figures are **spaces per board**.

| Space | 50 blocks | 75 blocks | 100 blocks |
|---|---:|---:|---:|
| 🪙 COIN | 10.29 (20.6%) | 17.77 (23.7%) | 22.93 (22.9%) |
| 💰 BIG COIN | 7.16 (14.3%) | 11.55 (15.4%) | 15.71 (15.7%) |
| 🔄 SWAP ZONE | 5.49 (11.0%) | 5.63 (7.5%) | ~6.8 (6.8%) |
| 🎁 MYSTERY | 5.35 (10.7%) | 7.89 (10.5%) | ~12.1 (12.1%) |
| ⚡ BOOST | 2.94 (5.9%) | 4.06 (5.4%) | ~5.5 (5.5%) |
| 🌀 SHORTCUT | 2.78 (5.6%) | 2.81 (3.7%) | ~5.2 (5.2%) |
| 🧲 MAGNET | 2.50 (5.0%) | 4.15 (5.5%) | ~6.6 (6.6%) |
| 🌑 PULLED BACK | 2.16 (4.3%) | 3.58 (4.8%) | ~5.0 (5.0%) |
| 🏪 ITEM SHOP | 2 | 3 | 4 |
| 💸 FINE | 1.82 (3.6%) | 2.83 (3.8%) | ~4.1 (4.1%) |
| ⚠️ TRAP | 1.50 (3.0%) | 2.14 (2.9%) | ~2.8 (2.8%) |
| 🕊️ TRUCE | 1.37 (2.7%) | 1.37 (1.8%) | ~1.3 (1.3%) |
| 🚀 LAUNCH | 0.98 (2.0%) | 4.18 (5.6%) | ~3.9 (3.9%) |
| 🔥 BIG FINE | 0.69 (1.4%) | 1.03 (1.4%) | ~1.1 (1.1%) |
| 🏁 START · 🔒 GATE · 👑 CROWN | 1 each | 1 each | 1 each |

### The red budget holds

| Length | Red spaces | Cap (1 per 10) | Gap between reds — min / median / mean |
|---|---:|---:|---|
| 50 | 4.0 | 5 | 7 / 12 / 12.2 |
| 75 | 6.0 | 7 | 7 / 12 / 12.3 |
| 100 | 8.0 | 10 | 6 / 12 / 12.4 |

The generator places reds at evenly-spaced positions with a minimum gap of two
cells, so the shortest run between two coin losses is 6 blocks and the typical
one is 12 — you never walk into a gauntlet.

### Balance read

- **Coins in vs coins out.** Roughly 39% of the board pays you and 8% taxes you.
  Deliberate: the road is generous, and the tension comes from *position* rather
  than poverty.
- **Late realms lean on disruption.** The Void's bag is thick with SWAP ZONE (its
  share of the 50-block board is 11% because the Void is half of a short run),
  which flips the race without emptying anyone's purse.
- **Shops scale with length** — one per realm — so a longer board means more
  chances to spend rather than a longer walk between them.

---

## 3. City Circuit — fixed pools, 60 nodes

Unlike HBD this is not randomised per match: the per-district pools are shuffled
into the same slots every time, so the count is exact.

| Space | Per board | Share |
|---|---:|---:|
| 💰 BIG COIN | 9 | 15.0% |
| 🪙 COIN | 8 | 13.3% |
| 🏪 ITEM SHOP | 6 | 10.0% |
| 🎁 MYSTERY | 5 | 8.3% |
| 🔄 SWAP ZONE | 4 | 6.7% |
| ⚔️ DUEL | 4 | 6.7% |
| 🏛️ DISTRICT HQ | 4 | 6.7% |
| 🌀 SHORTCUT | 3 | 5.0% |
| 🌑 PULLED BACK | 3 | 5.0% |
| ⚠️ TRAP | 3 | 5.0% |
| 🧲 MAGNET | 3 | 5.0% |
| 🔥 BIG FINE | 2 | 3.3% |
| 🏁 START · 🕊️ TRUCE · ⚡ BOOST · 💸 FINE · 🔒 GATE · 🚀 LAUNCH | 1 each | 1.7% each |

**Red total: 6 of 60 — exactly 1 per 10.**

> **Changed by this audit.** The old pools carried **13 red of 60 — one every 4.6
> nodes**, nearly three times the HBD rate. That bites harder here than on HBD,
> because City is a *lap* map: you pass the same tiles again on every circuit, so
> a punishing tile is a recurring tax rather than a one-off. The 1-per-10 rule
> now applies to both boards. The seven removed reds were replaced with
> disruption that costs no coins (SWAP ZONE ×4, PULLED BACK ×3), so the Back
> Alley is still the nastiest stretch — it just takes your *position* instead of
> your purse.

### Per district

| District | Character |
|---|---|
| **City Ring Road** (17) | The generous baseline: 8 coin tiles, one of most other things. 2 red. |
| **Financial District** (8) | Big money, big risk: 3 BIG COIN and the one BIG FINE. 1 red. |
| **Back Alley** (10) | Chaos: magnets, shortcuts, swaps and a duel. 2 red. |
| **Shopping Promenade** (8) | Safe and generous — mysteries and coins, **0 red**. |
| **Industrial Zone** (5) | Small, behind the Gate, and high-variance. 1 red. |

---

## 4. Reading it in-game

The map view (🗺️ MAP on your turn) now answers the two questions the audit says
matter, on both boards:

- **What does that space do?** Tapping a tile shows the effect line from this
  document — realm-flavoured on HBD.
- **How far away is it?** "➜ 7 spaces ahead · reachable with a 7", or "↩︎ 3 spaces
  behind you", or "📍 You are standing here". On City the count follows the lap
  order, so a tile 12 behind on the ring reads as 48 ahead — which is the number
  that actually matters, because that is how far you have to travel to reach it.
