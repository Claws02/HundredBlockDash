// ============================================================
// ECONOMY — coin gains and losses, including the defensive effects
// that cancel a loss (Bodyguard ally charges, Shield item).
//
// loseCoins reaches into the Ally and Contract systems (expireAlly,
// checkContract); those are runtime-only ES-module cycles, used inside
// the function, so they resolve via live bindings.
// ============================================================

import { state } from './GameState.js';
import { getCharacterAbility } from '../config/GameConfig.js';
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

    // Character passive: flat fine reduction (Slime — Cushioned)
    const ab = getCharacterAbility(p.charType);
    let amt = ab.fineReduction ? Math.max(0, amount - ab.fineReduction) : amount;
    const wouldLose = Math.min(p.coins, amt);

    // Character passive: starting shield charges (Bodyguard character — Escort)
    if (wouldLose > 0 && p._charShield > 0) {
        p._charShield--;
        sfx('shield'); UIManager.toast(`🦺 ${p.name}'s guard absorbs the hit! (${p._charShield} left)`, '#22c55e');
        UIManager.updateUI(); checkContract(p, 'block_space');
        return 0;
    }
    // Character passive: once-per-game phase (Ghost — Phantom)
    if (wouldLose > 0 && p._negateCharges > 0) {
        p._negateCharges--;
        sfx('shield'); UIManager.toast(`👻 ${p.name} phases through the hit!`, '#a855f7');
        UIManager.updateUI(); checkContract(p, 'block_space');
        return 0;
    }

    const lost = Math.min(p.coins, amt);
    p.coins -= lost;
    UIManager.animateCoinDisplay(p.id, p.coins);
    return lost;
}
