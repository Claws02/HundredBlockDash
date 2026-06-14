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
import { ITEMS, DISTRICT_SHOPS, MAX_INV, MAX_ALLIES, DUEL_BET_OPTIONS } from '../config/GameConfig.js';
import { CITY_GRAPH, JUNCTION_IDS, BRANCH_OPTIONS } from '../config/BoardGraph.js';
import * as Renderer from '../engine/Renderer.js';

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
const _opp  = p => state.players[(p.id + 1) % 2];

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
        case 'double_die':  return behind ? 7 : 4;
        case 'overcharge':  return behind ? 7 : 4;
        case 'warp_drive':  return behind ? 5 : 3;
        case 'steal':       return opp.coins >= 8 ? 8 : opp.coins >= 4 ? 5 : 1;
        case 'swap':        return behind ? 8 : -10;   // never swap away a lead
        case 'cursed_die':  return behind ? 3 : 6;
        case 'anchor':      return behind ? 2 : 5;
        case 'tollbooth':   return 3;
        case 'shield':      return 4;
        case 'mirror':      return 3;
        default:            return 1;
    }
}

// Where the bot would land moving `steps` forward (for custom-dice planning).
function _landingType(p, steps) {
    if (state.selectedMap === 'hundred_block_dash') {
        const target = Math.max(0, Math.min(99, p.pos + steps));
        return { type: state.board[target]?.type, finish: target >= 99 };
    }
    let cur = p.pos, left = steps;
    while (left > 0) {
        const gn = CITY_GRAPH[cur];
        if (!gn) break;
        let nx = gn.next[0];
        if (JUNCTION_IDS.has(nx)) nx = CITY_GRAPH[nx].next[0];
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
    const valid = options.filter(o => !(o.nodeId === 'ind_0' && !state.gateOpen));
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
    const dist = opt.district || CITY_GRAPH[opt.nodeId]?.district;
    if (dist && dist !== 'ring' && !player.districtHQsThisLoop.has(dist)) s += 6; // chase circuit/HQ bonus
    if (state.allyOnMap) {
        const ad = CITY_GRAPH[state.allyOnMap.nodeId]?.district;
        if (ad && ad === dist) s += player.allies.length < MAX_ALLIES ? 5 : 2;
    }
    if (dist === 'fin' || dist === 'shop') s += 2;
    else if (dist === 'ind') s += 1;
    else if (dist === 'ba') s -= 1;
    else if (dist === 'ring') s += 1;   // safe & steady
    return s;
}

// ── Shops ───────────────────────────────────────────────────────────────────
export function shopPassThrough() { return Math.random() < profile().shopChance; }

// City shop. Returns an itemId to buy, or null.
export function shopBuy(p, distKey, disc) {
    const prof = profile();
    const available  = DISTRICT_SHOPS[distKey] || Object.keys(ITEMS);
    const affordable = available.filter(k => ITEMS[k] && p.coins >= Math.ceil(ITEMS[k].price * disc));
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

// HBD pass-through shop (full inventory, no discount). Returns an itemId or null.
export function passThroughBuy(p) {
    const prof = profile();
    const affordable = Object.keys(ITEMS).filter(k => p.coins >= ITEMS[k].price);
    if (affordable.length === 0 || p.inv.length >= MAX_INV) return null;
    if (!prof.smart) return affordable[_rand(affordable.length)];
    // HBD is a race — movement items first.
    const movement = affordable.filter(k => ['rocket', 'warp_drive', 'double_die', 'overcharge', 'custom_dice'].includes(k));
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
    for (const o of (BRANCH_OPTIONS[j] || [])) {
        const d = o.district;
        if (d && d !== 'ring') {
            if (!p.districtHQsThisLoop.has(d)) s += 6;
            if (state.allyOnMap && CITY_GRAPH[state.allyOnMap.nodeId]?.district === d) s += 5;
        }
    }
    return s;
}
