// ============================================================
// CONTRACTS — City Circuit "City Contract" objectives. Players claim
// rewards by completing tracked actions (land on types, visit HQs, win
// minigames, etc.). Contracts are a no-op on Hundred Block Dash.
//
// Imports earnCoins from GameController (runtime-only ES-module cycle,
// safe via live bindings — used inside functions, not at eval).
// ============================================================

import { state } from './GameState.js';
import { CONTRACT_COUNT } from '../config/GameConfig.js';
import { getShuffledPool } from '../config/ContractPool.js';
import { earnCoins } from './GameController.js';
import * as UIManager from '../ui/UIManager.js';
import { sfx } from '../engine/AudioManager.js';

export function initContracts() {
    state.contractPool = getShuffledPool();
    state.activeContracts = [];
    for (let i = 0; i < CONTRACT_COUNT && state.contractPool.length > 0; i++) {
        state.activeContracts.push(state.contractPool.shift());
    }
    UIManager.updateContracts();
}

export function checkContract(player, eventType, param, count) {
    if (state.selectedMap === 'hundred_block_dash') return;
    for (let i = state.activeContracts.length - 1; i >= 0; i--) {
        const c = state.activeContracts[i];
        let fulfilled = false;
        if (c.type === eventType) {
            if (param === null || param === undefined || c.param === null || c.param === undefined || c.param === param) {
                if (c.type === 'win_minigames' || c.type === 'land_coin') {
                    // Tracked separately via counters — skip here
                } else {
                    fulfilled = true;
                }
            }
        }
        if (fulfilled) _claimContract(player, i);
    }
}

export function claimContractProgress(player, eventType, param) {
    // For multi-step contracts (land_coin, win_minigames)
    state.activeContracts.forEach((c, i) => {
        if (c.type !== eventType) return;
        if (c.param && param && c.param !== param) return;
        c._progress = (c._progress || 0) + 1;
        if (c._progress >= (c.param || 1)) _claimContract(player, i);
        UIManager.updateContracts();
    });
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
        state.activeContracts.push(state.contractPool.shift());
    }
    UIManager.updateContracts();
}
