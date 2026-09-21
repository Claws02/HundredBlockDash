// ============================================================
// BOT — all AI decision-making for "Borat the Bot" (1-player mode).
//
// Design seam: this module decides *what* the bot would choose; the
// GameController owns *when and how* to apply it (timers, hops, turn
// flow). Every function is a pure-ish read of `state` returning a
// choice, so the fragile turn-flow callbacks stay untouched.
//
// Difficulty (state.botDifficulty) scales both how *often* the bot acts
// and how *well* it chooses. The same `skill` value also feeds minigame
// AI via MinigameManager (see docs/MINIGAME_STANDARD.md §5).
// ============================================================

import { state } from './GameState.js';
import * as Targeting from './Targeting.js';
import { ITEMS, DISTRICT_SHOPS, MAX_INV, MAX_ALLIES, DUEL_BET_OPTIONS } from '../config/GameConfig.js';
import * as Renderer from '../engine/Renderer.js';
import * as ActiveMap from '../config/ActiveMap.js';
import * as Stars from './Stars.js';

// ── Difficulty profiles ───────────────────────────────────────────────────────
const PROFILES = {
    easy:   { skill: 0.25, itemUseChance: 0.18, smart: false, branchNoise: 1.0,  shopChance: 0.50, betFactor: 0.30, allyFight: 0.50, stealChance: 0.40, cabbieChance: 0.30, cabbieSmart: false },
    medium: { skill: 0.55, itemUseChance: 0.40, smart: true,  branchNoise: 0.35, shopChance: 0.60, betFactor: 0.55, allyFight: 0.70, stealChance: 0.60, cabbieChance: 0.55, cabbieSmart: true  },
    hard:   { skill: 0.85, itemUseChance: 0.70, smart: true,  branchNoise: 0.10, shopChance: 0.75, betFactor: 0.85, allyFight: 0.90, stealChance: 0.80, cabbieChance: 0.80, cabbieSmart: true  },
};

export function profile() { return PROFILES[state.botDifficulty] || PROFILES.medium; }
export function skill()   { return profile().skill; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const _rand = n => Math.floor(Math.random() * n);
// The bot's mental model of "them". With two seats it is the other player; with
// three or four the bot plays against whoever is winning, which is both the
// right heuristic and the same target the hostile items pick (Targeting.js), so
// its item valuations stay honest about who they will actually hit.
const _opp = p => Targeting.leadingRival(p) || p;

// Forward progress along the track (works for both int HBD and string City positions).
function _progress(pos) {
    try { const t = Renderer.getNodeT(pos); return Number.isFinite(t) ? t : 0; }
    catch (e) { return typeof pos === 'number' ? pos : 0; }
}
function _behind(p, opp) { return _progress(p.pos) < _progress(opp.pos); }

// Heuristic "is this space good to land on" — shared by branch & custom-dice logic.
const SPACE_VALUE = {
    coin: 3, coin_big: 8, mystery: 5, boost: 4, shortcut: 6, cfwd: 9, truce: 3,
    hq: 12, shop: 4, gate_open: 1, magnet: 5, swap_space: 0, start: 0,
    lose: -4, lose_big: -10, trap: -5, cbwd: -9, duel: 0,
    anchor_trap: -5, player_trap: -5, gate: -2,
};

// Value of an owned item in the current situation (used pre-roll and when shopping).
function _itemValue(itemId, p, opp, behind) {
    switch (itemId) {
        case 'rocket':      return behind ? 9 : 4;
        case 'custom_dice': return behind ? 7 : 5;
        case 'steal':       return opp.coins >= 8 ? 8 : opp.coins >= 4 ? 5 : 1;
        case 'swap':        return behind ? 8 : -10;   // never swap away a lead
        case 'cursed_die':  return behind ? 3 : 6;
        case 'anchor':      return behind ? 2 : 5;
        case 'shield':      return 4;
        default:            return 1;
    }
}

// Where the bot would land moving `steps` forward (for custom-dice planning).
function _landingType(p, steps) {
    if (ActiveMap.isLinear()) {
        const fin    = state.hbd ? state.hbd.finish : 99;
        const target = Math.max(0, Math.min(fin, p.pos + steps));
        return { type: state.board[target]?.type, finish: target >= fin };
    }
    let cur = p.pos, left = steps;
    while (left > 0) {
        const nx = ActiveMap.nextNode(cur);
        if (!nx) break;
        cur = nx; left--;
    }
    return { type: state.board[cur]?.type, finish: false };
}

// ── Pre-roll item use ──────────────────────────────────────────────────────────
// Returns an itemId to use this turn, or null to just roll.
export function preRollItem(p) {
    const prof = profile();
    if (p.inv.length === 0 || Math.random() > prof.itemUseChance) return null;
    if (!prof.smart) return p.inv[_rand(p.inv.length)];

    const opp = _opp(p), behind = _behind(p, opp);
    let best = null, bestV = 0;   // require strictly positive value to bother
    for (const id of p.inv) {
        const v = _itemValue(id, p, opp, behind);
        if (v > bestV) { bestV = v; best = id; }
    }
    return best;
}

// ── Branch choice at junctions ───────────────────────────────────────────────
// options: [{ nodeId, district, ... }]. Returns the chosen nodeId.
export function branch(player, options) {
    const prof = profile();
    // The road behind a shut gate, on whichever board this is. Naming City's
    // `ind_0` here meant the bot walked cheerfully into Star Territory's
    // rockslide every time it came round.
    const valid = options.filter(o => !(o.nodeId === ActiveMap.gateNode() && !state.gateOpen));
    const pool  = valid.length ? valid : options;
    if (pool.length === 1) return pool[0].nodeId;
    if (!prof.smart || Math.random() < prof.branchNoise) return pool[_rand(pool.length)].nodeId;

    let best = pool[0], bestS = -Infinity;
    for (const o of pool) {
        const s = _branchScore(player, o);
        if (s > bestS) { bestS = s; best = o; }
    }
    return best.nodeId;
}

function _branchScore(player, opt) {
    let s = Math.random() * 1.5;   // tie-break noise
    const dist = opt.district || ActiveMap.graph()[opt.nodeId]?.district;
    // Chase the circuit/HQ bonus — only on a board that HAS one.
    if (dist && !ActiveMap.isHub(dist) && ActiveMap.has('hqBonus')
        && !player.districtHQsThisLoop.has(dist)) s += 6;
    // THE STAR IS THE BIGGEST TERM IN THIS FUNCTION, above the +6 that chases a
    // district bonus, because on Star Territory the district bonus does not
    // exist and the Star is the only thing that scores. It only counts when the
    // bot could actually pay for it — a bot riding twelve spaces to look at a
    // Star it cannot afford is worse than a bot that stayed on the ring.
    s += _starBranchTerm(player, dist);
    if (state.allyOnMap) {
        const ad = ActiveMap.graph()[state.allyOnMap.nodeId]?.district;
        if (ad && ad === dist) s += player.allies.length < MAX_ALLIES ? 5 : 2;
    }
    // The per-road preference used to be four hardcoded City district keys, so
    // the route AI had no opinion at all about any other board's roads. It is
    // now a table on the map module.
    s += ActiveMap.botBias()[dist] || 0;
    return s;
}

/**
 * How much the live Star is worth to a road, from this player's seat.
 *
 * +9 when the Office holding it is down this road and the bond is affordable,
 * scaled back on `easy` so the easy bot is not suddenly the sharpest router on
 * the board. A small positive stays when it cannot afford it yet, because the
 * coins on that road are still worth collecting on the way past.
 */
function _starBranchTerm(player, dist) {
    if (!Stars.enabled() || !dist) return 0;
    const at = Stars.liveNode();
    if (!at || ActiveMap.regionOf(at) !== dist) return 0;
    const afford = player.coins >= Stars.priceFor(player);
    if (!afford) return 2;
    return profile().smart ? 9 : 4;
}

// ── The Star ────────────────────────────────────────────────────────────────

/**
 * The bot is standing at a live Office with the money. Does it post the bond?
 *
 * Buy, unless it is one minigame away from a free Star and banking the coins
 * would leave it able to buy the NEXT one too — at which point holding is
 * genuinely better, because the two lanes stack. `hard` also weighs how far the
 * dispatch would throw the next Star; `easy` always buys, which is the right
 * kind of wrong for an easy bot: eager, not stupid.
 */
export function starBuy(p, price) {
    const prof = profile();
    if (!prof.smart) return true;
    const need = Stars.shardsPerStar();
    const oneAway = (p.shards || 0) >= need - 1;
    // A Star from Shards costs nothing, so if one is about to land, the coins
    // are better kept for the Star AFTER it — which will cost 5 more.
    if (oneAway && p.coins < price + (price + 5)) return Math.random() < 0.35;
    if (state.botDifficulty !== 'hard') return true;
    // Hard: if the dispatch would send the next Star somewhere the rival is far
    // better placed for, and this bot is already ahead on Stars, bank instead.
    const opp = _opp(p);
    const to = Stars.dispatchTarget(p, p.pos);
    if (!to) return true;
    const mine = Stars.boardSteps(p.pos, to);
    const theirs = Stars.boardSteps(opp.pos, to);
    if ((p.stars || 0) > (opp.stars || 0) && theirs + 6 < mine) return Math.random() < 0.5;
    return true;
}

// ── Shops ───────────────────────────────────────────────────────────────────
export function shopPassThrough() { return Math.random() < profile().shopChance; }

// City shop. Returns an itemId to buy, or null.
export function shopBuy(p, distKey, disc) {
    const prof = profile();
    const available  = DISTRICT_SHOPS[distKey] || Object.keys(ITEMS);
    // SAVE FOR THE STAR.
    //
    // The outfitter deliberately sits four spaces BEFORE the Office (spec
    // §2.3), so "spend it on an item or save it for the bond" is a live
    // question at the moment it has to be answered. A bot that always spends
    // has no answer to it. Within about two turns' travel of the live Star, it
    // will not spend below the price of the bond.
    const floor = _starSavingFloor(p);
    const affordable = available.filter(k =>
        ITEMS[k] && p.coins - Math.ceil(ITEMS[k].price * disc) >= floor);
    if (affordable.length === 0 || p.inv.length >= MAX_INV) return null;
    if (!prof.smart) return affordable[_rand(affordable.length)];

    const opp = _opp(p), behind = _behind(p, opp);
    let best = affordable[0], bestV = -Infinity;
    for (const k of affordable) {
        const v = _itemValue(k, p, opp, behind);
        if (v > bestV) { bestV = v; best = k; }
    }
    return best;
}

// How many coins the bot refuses to drop below, because the Star is close
// enough to be worth keeping the bond for. Zero on every other board and
// whenever the Star is too far away to be this turn's problem.
function _starSavingFloor(p) {
    if (!Stars.enabled() || !profile().smart) return 0;
    const steps = Stars.stepsToStar(p);
    if (!Number.isFinite(steps) || steps > 8) return 0;   // ~two turns at mean roll
    return Stars.priceFor(p);
}

// Bag full and something new has arrived. Returns the index of the item to
// throw away, or -1 to keep what it is carrying. Same call a player makes at
// the discard picker, scored with the same table the shop uses.
export function dropChoice(p, newItemId) {
    const opp = _opp(p), behind = _behind(p, opp);
    const incoming = _itemValue(newItemId, p, opp, behind);
    let worst = -1, worstV = Infinity;
    p.inv.forEach((id, i) => {
        const v = _itemValue(id, p, opp, behind);
        if (v < worstV) { worstV = v; worst = i; }
    });
    if (!profile().smart) return _rand(p.inv.length);   // easy just picks one
    return incoming > worstV ? worst : -1;
}

// HBD pass-through shop (full inventory, no discount). Returns an itemId or null.
export function passThroughBuy(p) {
    const prof = profile();
    const affordable = Object.keys(ITEMS).filter(k => p.coins >= ITEMS[k].price);
    if (affordable.length === 0 || p.inv.length >= MAX_INV) return null;
    if (!prof.smart) return affordable[_rand(affordable.length)];
    // HBD is a race — movement items first. (warp_drive/double_die/overcharge
    // were cut from ITEMS in the shop pass; they can never match here.)
    const movement = affordable.filter(k => ['rocket', 'custom_dice'].includes(k));
    const pool = movement.length ? movement : affordable;
    return pool[_rand(pool.length)];
}

// ── Custom Dice ────────────────────────────────────────────────────────────────
export function customDice(p) {
    if (!profile().smart) return 6;
    let best = 6, bestV = -Infinity;
    for (let n = 1; n <= 6; n++) {
        const { type, finish } = _landingType(p, n);
        const v = finish ? 100 : (SPACE_VALUE[type] ?? 0);
        if (v > bestV) { bestV = v; best = n; }
    }
    return best;
}

// ── Duels ───────────────────────────────────────────────────────────────────
export function duelBet(p, opp) {
    const safe = Math.min(p.coins, opp.coins, 10);
    if (safe <= 0) return 0;
    const target = safe * profile().betFactor;
    const opts = DUEL_BET_OPTIONS.filter(o => o <= safe);
    if (opts.length === 0) return safe;
    let best = opts[0];
    for (const o of opts) if (Math.abs(o - target) < Math.abs(best - target)) best = o;
    return best;
}

// ── Allies ───────────────────────────────────────────────────────────────────
export function allyFight(player) {
    const prof = profile();
    // More willing to fight when there's an open slot; still sometimes replaces.
    const chance = player.allies.length < MAX_ALLIES ? Math.max(prof.allyFight, 0.6) : prof.allyFight * 0.7;
    return Math.random() < chance;
}

export function shouldAttemptAllySteal() { return Math.random() < profile().stealChance; }

// Pick which of the target's allies to steal. Returns an index.
export function allyStealIndex(target) {
    if (target.allies.length === 0) return 0;
    if (!profile().smart) return _rand(target.allies.length);
    const order = ['bodyguard', 'investor', 'banker', 'vendor', 'cabbie'];   // most→least valuable
    let bestIdx = 0, bestRank = 999;
    target.allies.forEach((a, i) => {
        const r = order.indexOf(a.type);
        if (r >= 0 && r < bestRank) { bestRank = r; bestIdx = i; }
    });
    return bestIdx;
}

// ── Cabbie ────────────────────────────────────────────────────────────────────
export function shouldUseCabbie(p) {
    if (p.cabbieUsedThisRound || !p.allies.some(a => a.type === 'cabbie')) return false;
    return Math.random() < profile().cabbieChance;
}

export function cabbieJunction(p) {
    const js = ['bp_a', 'bp_b', 'bp_c', 'bp_d'];
    if (!profile().cabbieSmart) return js[_rand(js.length)];
    let best = js[0], bestS = -Infinity;
    for (const j of js) {
        const s = _junctionScore(p, j);
        if (s > bestS) { bestS = s; best = j; }
    }
    return best;
}

function _junctionScore(p, j) {
    let s = Math.random();
    for (const o of (ActiveMap.branches()[j] || [])) {
        const d = o.district;
        if (d && !ActiveMap.isHub(d)) {
            if (ActiveMap.has('hqBonus') && !p.districtHQsThisLoop.has(d)) s += 6;
            if (state.allyOnMap && ActiveMap.graph()[state.allyOnMap.nodeId]?.district === d) s += 5;
            s += _starBranchTerm(p, d);
        }
    }
    return s;
}
