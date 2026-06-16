// ============================================================
// BOARD SETUP — generates the tile layout for each map.
// City Circuit fills graph nodes from shuffled per-district pools;
// Hundred Block Dash builds the linear 100-space board.
// Pure with respect to game flow — only reads/writes state.board.
// ============================================================

import { state } from './GameState.js';
import { HBD_GATE_POS, HBD_SHOP_SPACES } from '../config/GameConfig.js';
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
// One pool per realm, each sized to exactly fill its random slots. Good
// and bad spaces are kept roughly even (no more "free coins early, brutal
// late") while difficulty escalates gently toward the Void.
//   counts → good / bad  (mystery is a wildcard, counted as neither)
//   Woods 14/9 · Ember 12/12 · Fae 13/11 · Void 10/12
const REALM_POOLS = {
    woods: [   // 1–24 minus shop@20 → 23 slots
        ...Array(5).fill('coin'), ...Array(2).fill('coin_big'), ...Array(2).fill('boost'),
        ...Array(2).fill('shortcut'), ...Array(1).fill('truce'), ...Array(2).fill('mystery'),
        ...Array(4).fill('lose'), ...Array(4).fill('trap'), ...Array(1).fill('magnet'),
    ],
    ember: [   // 25–49 minus shop@40 → 24 slots
        ...Array(5).fill('coin'), ...Array(3).fill('coin_big'), ...Array(1).fill('boost'),
        ...Array(1).fill('cfwd'), ...Array(2).fill('mystery'),
        ...Array(4).fill('lose'), ...Array(2).fill('lose_big'), ...Array(5).fill('trap'), ...Array(1).fill('magnet'),
    ],
    fae: [     // 50–74 minus shop@60 → 24 slots
        ...Array(4).fill('coin'), ...Array(3).fill('coin_big'), ...Array(3).fill('mystery'),
        ...Array(2).fill('shortcut'), ...Array(1).fill('boost'),
        ...Array(4).fill('lose'), ...Array(3).fill('trap'), ...Array(3).fill('magnet'), ...Array(1).fill('cbwd'),
    ],
    void: [    // 76–98 minus shop@80 → 22 slots
        ...Array(3).fill('coin'), ...Array(4).fill('coin_big'), ...Array(2).fill('mystery'), ...Array(1).fill('cfwd'),
        ...Array(3).fill('lose'), ...Array(3).fill('lose_big'), ...Array(2).fill('trap'),
        ...Array(1).fill('magnet'), ...Array(1).fill('cbwd'), ...Array(2).fill('swap_space'),
    ],
};

function _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function generateBoard() {
    state.board = new Array(100);
    state.board[0]  = { type: 'start' };
    state.board[99] = { type: 'start', n: 'FINISH', ic: '👑' };

    const zones = [[1, 24, 'woods'], [25, 49, 'ember'], [50, 74, 'fae'], [76, 98, 'void']];
    for (const [from, to, key] of zones) {
        const pool = _shuffle([...REALM_POOLS[key]]);
        for (let i = from; i <= to; i++) {
            if (i === HBD_GATE_POS || HBD_SHOP_SPACES.has(i)) continue;
            state.board[i] = { type: pool.pop() || 'coin' };
        }
    }

    state.board[HBD_GATE_POS] = { type: 'gate' };
    HBD_SHOP_SPACES.forEach(i => { if (i !== HBD_GATE_POS) state.board[i] = { type: 'shop' }; });
}
