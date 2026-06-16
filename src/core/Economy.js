// ============================================================
// ECONOMY — coin gains and losses, including the defensive effects
// that cancel a loss (Bodyguard ally charges, Shield item).
//
// loseCoins reaches into the Ally and Contract systems (expireAlly,
// checkContract); those are runtime-only ES-module cycles, used inside
// the function, so they resolve via live bindings.
// ============================================================

import { state } from './GameState.js';
import * as UIManager from '../ui/UIManager.js';
import { sfx } from '../engine/AudioManager.js';
import { expireAlly } from './GameController.js';
import { checkContract } from './Contracts.js';

export function earnCoins(p, amount) {
    p.coins += amount; p.coinsEarned += amount; p.coinsEarnedThisRound += amount;
    UIManager.animateCoinDisplay(p.id, p.coins);
}

export function loseCoins(p, amount) {
    // Bodyguard ally absorbs negative effects
    const bgIdx = p.allies.findIndex(a => a.type === 'bodyguard' && a.shieldCharges > 0);
    if (bgIdx >= 0) {
        p.allies[bgIdx].shieldCharges--;
        sfx('shield'); UIManager.toast(`🦺 Bodyguard absorbs the hit! (${p.allies[bgIdx].shieldCharges} left)`, '#22c55e');
        UIManager.updateUI();
        if (p.allies[bgIdx].shieldCharges <= 0) expireAlly(p, bgIdx);
        checkContract(p, 'block_space');
        return 0;
    }
    if (p._shielded) { p._shielded = false; sfx('shield'); checkContract(p, 'block_space'); return 0; }
    const lost = Math.min(p.coins, amount);
    p.coins -= lost;
    UIManager.animateCoinDisplay(p.id, p.coins);
    return lost;
}
