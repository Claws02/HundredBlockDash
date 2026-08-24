// ============================================================
// BOARD SETUP — generates the tile layout for each map.
// City Circuit fills graph nodes from shuffled per-district pools;
// Hundred Block Dash builds the linear 100-space board.
// Pure with respect to game flow — only reads/writes state.board.
// ============================================================

import { state } from './GameState.js';
import { HBD_DEFAULT_CONFIG, getBiomeForSpace } from '../config/GameConfig.js';
import * as ActiveMap from '../config/ActiveMap.js';

export function initCityBoard() {
    const pools = _buildPools();
    state.board = {};

    Object.values(ActiveMap.graph()).forEach(node => {
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

// Shuffles the canonical per-region pools from the active map module. (These used to be
// re-declared here as a private copy, so editing the board layout in one place
// silently diverged from the other.)
function _buildPools() {
    const out = {};
    for (const [key, arr] of Object.entries(ActiveMap.pools())) {
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
// EXACT QUOTAS, not weighted bags.
//
// The board used to be filled by drawing from per-realm weight tables with
// replacement, which meant the actual mix was whatever the dice gave you: the
// measured counts drifted by several spaces between boards and no target could
// be stated, only hoped for. The headline types now have exact quotas derived
// from the board length, so a 100-block board really does contain 20 mysteries
// and 5 big fines every single time.
//
// Per 100 blocks of fillable road:
//     MYSTERY   20        COIN       20        BIG COIN  10
//     FINE       5        BIG FINE    5        (= 10 red, exactly 1 per 10)
//     everything else — swaps, magnets, boosts, shortcuts, launches,
//     pull-backs, truces — shares the remaining ~40, weighted per realm so each
//     stretch of road still has its own character.
//
// Reds are then placed at evenly-spaced positions with a minimum gap of two, so
// no stretch is a gauntlet, and everything else is shuffled into what's left.

// Headline quotas, as a share of the fillable slots.
const QUOTA_SHARE = {
    mystery:  0.20,
    coin:     0.20,
    coin_big: 0.10,
};
// Coin-losing spaces, as a share of the WHOLE board (this is the 1-per-10 rule),
// split evenly between the two fines. TRAP is deliberately not in the HBD mix:
// the budget is small enough that a third red type just muddies what a red space
// means. It still exists on City Circuit.
const RED_PER_BLOCKS = 10;
const RED_SPLIT = { lose: 0.5, lose_big: 0.5 };

// Everything that isn't a headline type or a red, weighted per realm. These
// weights only decide how the LEFTOVER slots are shared, so changing them can
// never break the quotas above.
const FILLER_WEIGHTS = {
    woods: { boost: 3, shortcut: 3, truce: 2, magnet: 2, cbwd: 1 },
    ember: { cfwd: 3, boost: 2, magnet: 2, shortcut: 1, cbwd: 2, truce: 1 },
    fae:   { shortcut: 3, magnet: 3, swap_space: 2, boost: 2, cbwd: 2, truce: 1 },
    // The Void is the decider, so it is thick with swaps: the race can flip
    // right up to the Crown without anyone being bled dry.
    void:  { swap_space: 6, cbwd: 3, cfwd: 2, magnet: 2, boost: 1 },
};

function _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Draw `count` items from a weight table (with replacement). Only used for the
// leftover slots now — the headline types are exact.
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

// The exact number of each type the whole board should carry.
//
// `slotCount` is the fillable road (length minus start, gate, crown and shops);
// `boardLength` drives the red budget, because "one red per ten blocks" is a
// statement about the road you walk, not about the slots left over after the
// furniture.
function _boardQuotas(slotCount, boardLength) {
    const q = {};
    let used = 0;
    // Shares are of the BOARD LENGTH, not of the slots left after the furniture,
    // so "20 mysteries on a 100-block board" comes out as exactly 20 rather than
    // 19 — the seven fixed squares would otherwise quietly eat one of each.
    for (const [type, share] of Object.entries(QUOTA_SHARE)) {
        const n = Math.round(boardLength * share);
        q[type] = n; used += n;
    }
    const red = Math.floor(boardLength / RED_PER_BLOCKS);
    // Odd budgets give the extra to the smaller fine — cheaper is kinder.
    q.lose     = Math.ceil(red * RED_SPLIT.lose);
    q.lose_big = red - q.lose;
    used += red;
    // Safety: a very short board could in principle ask for more than it has.
    // Scale the headline quotas back proportionally rather than overflowing.
    if (used > slotCount) {
        const keep = (slotCount - red) / Math.max(1, used - red);
        for (const type of Object.keys(QUOTA_SHARE)) q[type] = Math.floor(q[type] * keep);
        used = red + Object.keys(QUOTA_SHARE).reduce((n, t) => n + q[t], 0);
    }
    return { quotas: q, redTotal: red, leftover: Math.max(0, slotCount - used) };
}

// Build the type assignment for every realm at once. Doing it board-wide rather
// than per realm is what makes the quotas exact: a per-realm rounding error used
// to compound across four realms.
function _assignBoard(realmSlots, boardLength) {
    const allSlots = realmSlots.flatMap(r => r.slots);
    const { quotas, redTotal, leftover } = _boardQuotas(allSlots.length, boardLength);

    // 1. Reds first, evenly spaced across the WHOLE road so the gaps hold across
    //    realm boundaries too.
    const redPos = _spacedBadPositions(allSlots.length, redTotal);
    const redBag = _shuffle([
        ...Array(quotas.lose).fill('lose'),
        ...Array(quotas.lose_big).fill('lose_big'),
    ]);

    // 2. Everything else: the exact headline quotas, plus realm-weighted filler
    //    for whatever is left.
    const rest = _shuffle([
        ...Array(quotas.mystery).fill('mystery'),
        ...Array(quotas.coin).fill('coin'),
        ...Array(quotas.coin_big).fill('coin_big'),
    ]);
    // Filler is drawn per realm so each stretch keeps its character, then the
    // headline types are shuffled through the whole lot.
    const fillerByRealm = realmSlots.map(r => {
        const share = Math.round(leftover * (r.slots.length / allSlots.length));
        return _drawBag(FILLER_WEIGHTS[r.key] || FILLER_WEIGHTS.woods, share);
    });
    let filler = fillerByRealm.flat();
    // Rounding can leave the filler a slot short or long; settle it with coins.
    while (rest.length + filler.length < allSlots.length - redPos.size) filler.push('coin');
    while (rest.length + filler.length > allSlots.length - redPos.size) filler.pop();

    const nonRed = _shuffle([...rest, ...filler]);

    const out = {};
    let ri = 0, ni = 0;
    for (let i = 0; i < allSlots.length; i++) {
        out[allSlots[i]] = redPos.has(i) ? (redBag[ri++] || 'lose') : (nonRed[ni++] || 'coin');
    }
    return out;
}

export function generateBoard() {
    const cfg = state.hbd || HBD_DEFAULT_CONFIG;
    const { length, finish, gatePos, shopSpaces, realmCount } = cfg;

    state.board = new Array(length);
    state.board[0]      = { type: 'start' };
    state.board[finish] = { type: 'finish' };

    // Collect every fillable slot, realm by realm, then assign the whole board in
    // one pass — the quotas only come out exact if they are counted board-wide.
    const realmSlots = [];
    for (let r = 0; r < realmCount; r++) {
        const from = r === 0 ? 1 : r * 25;
        const to   = Math.min((r + 1) * 25 - 1, finish - 1);
        const slots = [];
        for (let i = from; i <= to; i++) {
            if (i === gatePos || shopSpaces.has(i)) continue;
            slots.push(i);
        }
        if (slots.length === 0) continue;
        realmSlots.push({ key: getBiomeForSpace(from).key, slots });
    }
    const assign = _assignBoard(realmSlots, length);
    for (const r of realmSlots) {
        for (const idx of r.slots) state.board[idx] = { type: assign[idx] };
    }

    state.board[gatePos] = { type: 'gate' };
    shopSpaces.forEach(i => { state.board[i] = { type: 'shop' }; });
}
