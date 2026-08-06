// ============================================================
// BOARD SETUP — generates the tile layout for each map.
// City Circuit fills graph nodes from shuffled per-district pools;
// Hundred Block Dash builds the linear 100-space board.
// Pure with respect to game flow — only reads/writes state.board.
// ============================================================

import { state } from './GameState.js';
import { HBD_DEFAULT_CONFIG, getBiomeForSpace } from '../config/GameConfig.js';
import { CITY_GRAPH, DISTRICT_POOLS } from '../config/BoardGraph.js';

export function initCityBoard() {
    const pools = _buildPools();
    state.board = {};

    Object.values(CITY_GRAPH).forEach(node => {
        if (node.isJunction) return; // junctions not in board
        const base = node.type; // may be null (random), or fixed (shop/gate/hq/start)
        if (base !== null) {
            state.board[node.id] = { type: base === 'gate' && state.gateOpen ? 'gate_open' : base };
        } else {
            const pool = pools[node.district] || pools.ring;
            state.board[node.id] = { type: pool.pop() || 'coin' };
        }
    });
}

// Shuffles the canonical per-district pools from BoardGraph. (These used to be
// re-declared here as a private copy, so editing the board layout in one place
// silently diverged from the other.)
function _buildPools() {
    const out = {};
    for (const [key, arr] of Object.entries(DISTRICT_POOLS)) {
        const pool = [...arr];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        out[key] = pool;
    }
    return out;
}


// ---- HBD board generation ----
//
// Goal: the road is generous. At most ONE coin-losing space per ten blocks, and
// they are spread out so no stretch feels like a gauntlet. Danger still rises
// toward the Void, but as *variety* (swaps, pull-backs) rather than as a heavier
// tax — the Void leans on swap spaces, which shuffle the race without emptying
// anyone's purse.
//
// Per realm we (1) cap the red count at ceil(slots / 10), (2) place them at
// evenly-spaced positions with a minimum gap of two so they can't sit adjacent,
// then (3) fill everything else from a realm-themed weighted bag of good spaces.

// Weighted "bags" — higher weight = more common. Good clearly dominates.
// Non-coin-losing spaces. cbwd (pulled back 10) and swap_space live here: they
// disrupt the race without costing coins, which is how the later realms stay
// tense now that the red budget is capped.
const GOOD_WEIGHTS = {
    woods: { coin: 5, coin_big: 2, boost: 2, shortcut: 2, mystery: 2, truce: 1, magnet: 1 },
    ember: { coin: 5, coin_big: 3, boost: 1, cfwd: 2, mystery: 2, magnet: 1, cbwd: 1 },
    fae:   { coin: 4, coin_big: 3, mystery: 3, shortcut: 2, boost: 1, magnet: 2, cbwd: 1, swap_space: 1 },
    // The Void is the decider, so it is thick with swaps: the race can flip
    // right up to the Crown without anyone being bled dry.
    void:  { coin: 3, coin_big: 4, mystery: 2, cfwd: 1, magnet: 1, swap_space: 5, cbwd: 2 },
};
// "Red" here means specifically a space that TAKES COINS. cbwd (pulled back) is
// a setback but costs nothing, so it is not counted against the red budget and
// lives in the good bag as a disruption instead.
const BAD_WEIGHTS = {
    woods: { lose: 3, trap: 2 },
    ember: { lose: 3, lose_big: 1, trap: 2 },
    fae:   { lose: 3, trap: 2 },
    void:  { lose: 2, lose_big: 2, trap: 2 },
};

// At most one coin-losing space per this many blocks.
const RED_PER_BLOCKS = 10;

function _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Draw `count` items from a weight table (with replacement).
function _drawBag(weights, count) {
    const pool = [];
    for (const [k, w] of Object.entries(weights)) for (let i = 0; i < w; i++) pool.push(k);
    const out = [];
    for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)] || 'coin');
    return out;
}

// Choose evenly-spaced bad-space slot positions (0..n-1) with a min gap of 2.
function _spacedBadPositions(n, badCount) {
    if (badCount <= 0) return new Set();
    const stride = n / badCount;
    const raw = [];
    for (let k = 0; k < badCount; k++) {
        const jitter = (Math.random() - 0.5) * stride * 0.4;
        raw.push(Math.round(k * stride + stride / 2 + jitter));
    }
    raw.sort((a, b) => a - b);
    // Enforce ascending order with a minimum gap of 2.
    for (let k = 1; k < raw.length; k++) if (raw[k] <= raw[k - 1] + 1) raw[k] = raw[k - 1] + 2;
    // If we ran past the end, slide everything back to fit.
    const overflow = raw[raw.length - 1] - (n - 1);
    if (overflow > 0) for (let k = 0; k < raw.length; k++) raw[k] -= overflow;
    const out = new Set();
    let last = -2;
    for (let pos of raw) {
        if (pos <= last + 1) pos = last + 2;
        if (pos < 0) pos = 0;
        if (pos > n - 1) pos = n - 1;
        out.add(pos);
        last = pos;
    }
    return out;
}

// Build the type assignment for one realm's slot list.
function _fillRealm(slots, key, realmIdx, realmCount) {
    const n = slots.length;
    // Hard cap: at most one coin-losing space per RED_PER_BLOCKS blocks. This is
    // the whole balance rule — previously it was a 30–40% ratio, which put 7–10
    // red spaces in a 25-block realm.
    let badCount = Math.floor(n / RED_PER_BLOCKS);
    // A realm shorter than the cap still gets at most one, so a short run isn't
    // completely toothless.
    if (badCount === 0 && n >= 6) badCount = 1;
    const badPos  = _spacedBadPositions(n, badCount);
    const badBag  = _shuffle(_drawBag(BAD_WEIGHTS[key]  || BAD_WEIGHTS.woods, badPos.size));
    const goodBag = _shuffle(_drawBag(GOOD_WEIGHTS[key] || GOOD_WEIGHTS.woods, n - badPos.size));
    const out = {};
    let bi = 0, gi = 0;
    for (let s = 0; s < n; s++) out[slots[s]] = badPos.has(s) ? badBag[bi++] : goodBag[gi++];
    return out;
}

export function generateBoard() {
    const cfg = state.hbd || HBD_DEFAULT_CONFIG;
    const { length, finish, gatePos, shopSpaces, realmCount } = cfg;

    state.board = new Array(length);
    state.board[0]      = { type: 'start' };
    state.board[finish] = { type: 'finish' };

    for (let r = 0; r < realmCount; r++) {
        const from = r === 0 ? 1 : r * 25;
        const to   = Math.min((r + 1) * 25 - 1, finish - 1);
        const slots = [];
        for (let i = from; i <= to; i++) {
            if (i === gatePos || shopSpaces.has(i)) continue;
            slots.push(i);
        }
        if (slots.length === 0) continue;
        const key    = getBiomeForSpace(from).key;
        const assign = _fillRealm(slots, key, r, realmCount);
        for (const idx of slots) state.board[idx] = { type: assign[idx] };
    }

    state.board[gatePos] = { type: 'gate' };
    shopSpaces.forEach(i => { state.board[i] = { type: 'shop' }; });
}
