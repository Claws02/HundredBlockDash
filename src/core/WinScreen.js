// ============================================================
// WIN SCREEN — final scoring, winner determination, and the
// game-over card / confetti presentation.
//
// Imports earnCoins from Economy to apply City Circuit dominance bonuses.
// ============================================================

import { state } from './GameState.js';
import { DISTRICT_DOMINANCE_BONUS, HQ_META, CHARACTER_ABILITIES, CHAR_ICONS } from '../config/GameConfig.js';
import { DISTRICT_KEYS, DISTRICT_NAMES } from '../config/BoardGraph.js';
import { earnCoins } from './Economy.js';
import * as Stats from './Stats.js';
import * as ModalManager from '../ui/ModalManager.js';
import { sfx } from '../engine/AudioManager.js';

export function calculateWinner() {
    const p1 = state.players[0], p2 = state.players[1];

    let p1s, p2s, subtitle;
    if (state.selectedMap === 'hundred_block_dash') {
        const p1f = p1.pos >= 99 ? 50 : 0, p2f = p2.pos >= 99 ? 50 : 0;
        p1s = p1.coins + p1f; p2s = p2.coins + p2f;
        subtitle = 'WINS THE HUSTLE!';
    } else {
        // City Circuit: district dominance bonuses
        DISTRICT_KEYS.forEach(dk => {
            if (p1.districtsVisited[dk] > p2.districtsVisited[dk]) earnCoins(p1, DISTRICT_DOMINANCE_BONUS);
            else if (p2.districtsVisited[dk] > p1.districtsVisited[dk]) earnCoins(p2, DISTRICT_DOMINANCE_BONUS);
        });
        p1s = p1.coins; p2s = p2.coins;
        subtitle = 'WINS THE CITY!';
    }

    const tiebreaker = state.selectedMap === 'hundred_block_dash'
        ? (p1.pos >= p2.pos ? p1 : p2)
        : (p1.fullCircuitsCompleted >= p2.fullCircuitsCompleted ? p1 : p2);
    const winner = p1s > p2s ? p1 : p2s > p1s ? p2 : tiebreaker;
    const isTie  = p1s === p2s && (state.selectedMap === 'hundred_block_dash' ? p1.pos === p2.pos : p1.fullCircuitsCompleted === p2.fullCircuitsCompleted);

    ModalManager.closeAllModals();
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('win-name').textContent = isTie ? 'TIE GAME!' : winner.name.toUpperCase();
    document.getElementById('win-subtitle').textContent = isTie ? 'Both players finish equal.' : subtitle;

    function row(label, val) { return `<div class="win-card-stat"><span>${label}</span><span>${val}</span></div>`; }
    function card(p, s) {
        const isW = !isTie && p === winner;
        const ab = CHARACTER_ABILITIES[p.charType];
        const charRow = row(`${CHAR_ICONS[p.charType] || '🙂'} Character`, ab ? ab.name : '—');
        let details;
        if (state.selectedMap === 'hundred_block_dash') {
            const fin = p.pos >= 99 ? 50 : 0;
            details = `${charRow}${row('💰 Coins earned', p.coinsEarned)}${row('💵 Coins left', p.coins)}${fin ? row('🏁 Finish bonus', '+' + fin) : ''}${row('🏆 Minigames won', p.mgWins)}${row('📍 Final space', p.pos >= 99 ? 'FINISHED' : p.pos)}`;
        } else {
            function domRow(pl) {
                return DISTRICT_KEYS.map(dk => {
                    const o = state.players[(pl.id+1)%2];
                    const icon = HQ_META[dk]?.icon || '🏛️';
                    const controlled = pl.districtsVisited[dk] > o.districtsVisited[dk];
                    return `<div class="win-card-stat"><span>${icon} ${DISTRICT_NAMES[dk]}</span><span>${pl.districtsVisited[dk]}x${controlled ? ' 👑' : ''}</span></div>`;
                }).join('');
            }
            details = `${charRow}${row('💰 Coins earned', p.coinsEarned)}${row('💵 Final coins', p.coins)}${row('🏆 Minigames won', p.mgWins)}${row('🔄 Full circuits', p.fullCircuitsCompleted)}${row('📋 Contracts', p.contractsClaimed)}${row('⚔️ Duels won', p.duelsWon)}${domRow(p)}`;
        }
        return `<div class="win-card${isW ? ' winner-card' : ''}"><div class="win-card-name">${isW?'👑 ':''}${p.name}</div><div class="win-card-score">${s}</div>${details}</div>`;
    }
    document.getElementById('win-cards').innerHTML = card(p1, p1s) + card(p2, p2s);

    // Persist 1-player record and surface a streak/record line.
    const statsEl = document.getElementById('win-stats');
    if (statsEl) {
        if (state.playStyle === '1p') {
            const playerWon = !isTie && winner.id === 0;
            const rec = Stats.recordVsBot(playerWon, isTie);
            const streakStr = (playerWon && rec.streak > 1) ? ` · 🔥 ${rec.streak} in a row` : '';
            statsEl.innerHTML = `Record vs Bot: <b>${rec.wins}W</b>–<b>${rec.losses}L</b>${rec.ties ? `–${rec.ties}T` : ''}${streakStr}`;
        } else {
            statsEl.innerHTML = '';
        }
    }

    const confettiEl = document.getElementById('win-confetti'); confettiEl.innerHTML = '';
    const colors = ['#f59e0b','#a855f7','#3b82f6','#ef4444','#4ade80','#fbbf24','#ec4899'];
    for (let i = 0; i < 80; i++) {
        const el = document.createElement('div'); el.className = 'confetti-piece';
        el.style.cssText = `left:${Math.random()*100}%;top:-10px;background:${colors[Math.floor(Math.random()*colors.length)]};width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;animation-duration:${2+Math.random()*2}s;animation-delay:${Math.random()*1.5}s;`;
        confettiEl.appendChild(el);
    }
    document.getElementById('win-screen').style.display = 'flex';
    sfx('win');
}
