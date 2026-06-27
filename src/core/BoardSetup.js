// ============================================================
// BOARD SETUP — generates the tile layout for each map.
// City Circuit fills graph nodes from shuffled per-district pools;
// Hundred Block Dash builds the linear 100-space board.
// Pure with respect to game flow — only reads/writes state.board.
// ============================================================

import { state } from './GameState.js';
import { HBD_DEFAULT_CONFIG, getBiomeForSpace } from '../config/GameConfig.js';
import { CITY_GRAPH } from '../config/BoardGraph.js';

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

function _buildPools() {
    const { DISTRICT_POOLS } = { DISTRICT_POOLS: _getDistrictPools() };
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

function _getDistrictPools() {
    return {
        ring: [
            ...Array(5).fill('coin'), ...Array(3).fill('coin_big'),
            ...Array(2).fill('trap'), ...Array(2).fill('lose'),
            ...Array(2).fill('mystery'), ...Array(1).fill('boost'),
            ...Array(1).fill('truce'), ...Array(1).fill('shortcut'),
        ],
        fin: [
            ...Array(3).fill('coin_big'), ...Array(2).fill('lose_big'),
            ...Array(1).fill('magnet'), ...Array(1).fill('duel'), ...Array(1).fill('coin'),
        ],
        ba: [
            ...Array(3).fill('trap'), ...Array(2).fill('lose'),
            ...Array(2).fill('magnet'), ...Array(2).fill('shortcut'), ...Array(1).fill('duel'),
        ],
        shop: [
            ...Array(3).fill('mystery'), ...Array(2).fill('coin'),
            ...Array(2).fill('coin_big'), ...Array(1).fill('duel'),
        ],
        ind: [
            ...Array(1).fill('lose_big'), ...Array(1).fill('trap'),
            ...Array(1).fill('cfwd'),     ...Array(1).fill('coin_big'), ...Array(1).fill('duel'),
        ],
    };
}

// ---- HBD board generation ----
//
// Goal: GOOD spaces always outnumber bad ones, and bad spaces are spread out
// (never clustered) so no stretch of the board feels like a gauntlet. Danger
// escalates gently toward the Void, but bad spaces never exceed ~40% of a realm.
//
// Per realm we (1) decide a bad-space count strictly below half the slots,
// (2) place those bad spaces at evenly-spaced positions with a minimum gap of
// two so they can't sit adjacent, then (3) fill everything else with good
// spaces drawn from a realm-themed weighted bag.

// Weighted "bags" — higher weight = more common. Good clearly dominates.
const GOOD_WEIGHTS = {
    woods: { coin: 5, coin_big: 2, boost: 2, shortcut: 2, mystery: 2, truce: 1, magnet: 1 },
    ember: { coin: 5, coin_big: 3, boost: 1, cfwd: 1, mystery: 2, magnet: 1 },
    fae:   { coin: 4, coin_big: 3, mystery: 3, shortcut: 2, boost: 1, magnet: 2 },
    void:  { coin: 3, coin_big: 4, mystery: 2, cfwd: 1, magnet: 1, swap_space: 2 },
};
const BAD_WEIGHTS = {
    woods: { lose: 3, trap: 3 },
    ember: { lose: 3, lose_big: 1, trap: 3 },
    fae:   { lose: 3, trap: 2, cbwd: 1 },
    void:  { lose: 2, lose_big: 3, trap: 2, cbwd: 1 },
};

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
    const t = realmCount > 1 ? realmIdx / (realmCount - 1) : 0;
    const badRatio = 0.30 + 0.10 * t;                       // 0.30 (start) → 0.40 (final realm)
    let badCount = Math.round(n * badRatio);
    badCount = Math.min(badCount, Math.floor((n - 1) / 2)); // guarantee good > bad, leaves room for gaps
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
    state.board[finish] = { type: 'start', n: 'FINISH', ic: '👑' };

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
