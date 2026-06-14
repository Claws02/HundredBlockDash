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

export function generateBoard() {
    state.board = [{ type: 'start' }];
    const earlyPool = [
        ...Array(20).fill('coin'), ...Array(10).fill('coin_big'),
        ...Array(8).fill('mystery'), ...Array(6).fill('boost'),
        ...Array(5).fill('shortcut'), ...Array(4).fill('cfwd'),
        ...Array(3).fill('truce'), ...Array(2).fill('lose'), ...Array(2).fill('trap'),
    ];
    while (earlyPool.length < 49) earlyPool.push('coin');
    earlyPool.sort(() => Math.random() - 0.5);

    const latePool = [
        ...Array(12).fill('lose'), ...Array(10).fill('lose_big'),
        ...Array(10).fill('trap'), ...Array(6).fill('magnet'),
        ...Array(4).fill('cbwd'), ...Array(2).fill('mystery'),
        ...Array(2).fill('truce'), ...Array(3).fill('coin'),
        ...Array(3).fill('swap_space'),
    ];
    while (latePool.length < 49) latePool.push('lose');
    latePool.sort(() => Math.random() - 0.5);

    for (let i = 1; i <= 49; i++) state.board.push({ type: earlyPool[i - 1] });
    for (let i = 50; i <= 98; i++) state.board.push({ type: latePool[i - 50] });
    state.board.push({ type: 'start', n: 'FINISH', ic: '👑' });

    state.board[HBD_GATE_POS] = { type: 'gate' };
    HBD_SHOP_SPACES.forEach(i => { if (i !== HBD_GATE_POS) state.board[i] = { type: 'shop' }; });
}
