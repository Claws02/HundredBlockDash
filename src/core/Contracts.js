// ============================================================
// CONTRACTS — City Circuit "City Contract" objectives. Players claim
// rewards by completing tracked actions (land on types, visit HQs, win
// minigames, etc.). Contracts are a no-op on Hundred Block Dash.
//
// Two kinds of contract live in the same pool:
//   • MATCH   — one qualifying event completes it. `param` (when set) is the
//               value the event must carry, e.g. visit_hq/'fin'.
//   • COUNTED — `param` is a target *count*, e.g. land_coin/3. Progress is
//               tracked per player in `c._prog[pid]`, so one player's coin
//               spaces never advance their opponent's contract.
// Emitters pass an absolute running total as `count` when they already own
// one (minigame streaks, coins this round, shops this lap); otherwise each
// event counts as a single step.
//
// Imports earnCoins from Economy (runtime-only ES-module cycle with
// Economy, safe via live bindings — used inside functions, not at eval).
// ============================================================

import { state } from './GameState.js';
import { CONTRACT_COUNT } from '../config/GameConfig.js';
import { getShuffledPool, COUNTED_TYPES } from '../config/ContractPool.js';
import { earnCoins } from './Economy.js';
import * as UIManager from '../ui/UIManager.js';
import { sfx } from '../engine/AudioManager.js';
import * as ActiveMap from '../config/ActiveMap.js';

export function initContracts() {
    state.contractPool = getShuffledPool();
    state.activeContracts = [];
    for (let i = 0; i < CONTRACT_COUNT && state.contractPool.length > 0; i++) {
        state.activeContracts.push(_fresh(state.contractPool.shift()));
    }
    UIManager.updateContracts();
}

// Contracts come out of a shared pool object; give each active card its own
// per-player progress so a re-drawn card never inherits stale counters.
function _fresh(c) {
    return { ...c, _prog: [0, 0] };
}

export function checkContract(player, eventType, param, count) {
    if (!ActiveMap.has('bounties')) return;
    if (!state.activeContracts || state.activeContracts.length === 0) return;
    let claimed = false;
    // Walk backwards: _claimContract splices the completed card out.
    for (let i = state.activeContracts.length - 1; i >= 0; i--) {
        const c = state.activeContracts[i];
        if (!c || c.type !== eventType) continue;

        if (COUNTED_TYPES.has(c.type)) {
            const target = Math.max(1, c.param || 1);
            if (!c._prog) c._prog = [0, 0];
            // An absolute total from the caller wins; otherwise tick by one.
            c._prog[player.id] = typeof count === 'number'
                ? Math.max(c._prog[player.id], count)
                : c._prog[player.id] + 1;
            if (c._prog[player.id] >= target) { _claimContract(player, i); claimed = true; }
            continue;
        }

        // MATCH contract: honour the contract's own param when it has one.
        if (c.param === null || c.param === undefined || c.param === param) {
            _claimContract(player, i);
            claimed = true;
        }
    }
    if (!claimed) UIManager.updateContracts();
}

function _claimContract(player, contractIdx) {
    const c = state.activeContracts[contractIdx];
    if (!c) return;
    let reward = c.reward;
    // Investor ally: double first contract per round
    const invIdx = player.allies.findIndex(a => a.type === 'investor');
    if (invIdx >= 0 && !state.investorUsedThisRound[player.id]) {
        reward *= 2;
        state.investorUsedThisRound[player.id] = true;
        UIManager.toast(`📈 Investor doubles contract reward!`, '#22c55e');
    }
    earnCoins(player, reward);
    player.contractsClaimed++;
    UIManager.toast(`${player.name} claims contract: +${reward} coins!`, '#fbbf24');
    sfx('land_good');
    state.activeContracts.splice(contractIdx, 1);
    if (state.contractPool.length > 0) {
        state.activeContracts.push(_fresh(state.contractPool.shift()));
    }
    UIManager.updateContracts();
}
