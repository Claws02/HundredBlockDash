// ============================================================
// WIN SCREEN — final scoring, winner determination, and the
// game-over card / confetti presentation.
//
// Imports earnCoins from Economy to apply City Circuit dominance bonuses.
// ============================================================

import { state } from './GameState.js';
import { DISTRICT_DOMINANCE_BONUS, HQ_META, HBD_FINISH_BONUS } from '../config/GameConfig.js';
import { DISTRICT_KEYS, DISTRICT_NAMES } from '../config/BoardGraph.js';
import { earnCoins } from './Economy.js';
import * as Stats from './Stats.js';
import * as ModalManager from '../ui/ModalManager.js';
import { sfx } from '../engine/AudioManager.js';

export function calculateWinner() {
    const p1 = state.players[0], p2 = state.players[1];

    const HBD_FIN = state.hbd ? state.hbd.finish : 99;
    let p1s, p2s, subtitle;
    if (state.selectedMap === 'hundred_block_dash') {
        const p1f = p1.pos >= HBD_FIN ? HBD_FINISH_BONUS : 0, p2f = p2.pos >= HBD_FIN ? HBD_FINISH_BONUS : 0;
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
        let details;
        if (state.selectedMap === 'hundred_block_dash') {
            const fin = p.pos >= HBD_FIN ? HBD_FINISH_BONUS : 0;
            details = `${row('💰 Coins earned', p.coinsEarned)}${row('💵 Coins left', p.coins)}${fin ? row('🏁 Finish bonus', '+' + fin) : ''}${row('🏆 Minigames won', p.mgWins)}${row('📍 Final space', p.pos >= HBD_FIN ? 'FINISHED' : p.pos)}`;
        } else {
            function domRow(pl) {
                return DISTRICT_KEYS.map(dk => {
                    const o = state.players[(pl.id+1)%2];
                    const icon = HQ_META[dk]?.icon || '🏛️';
                    const controlled = pl.districtsVisited[dk] > o.districtsVisited[dk];
                    return `<div class="win-card-stat"><span>${icon} ${DISTRICT_NAMES[dk]}</span><span>${pl.districtsVisited[dk]}x${controlled ? ' 👑' : ''}</span></div>`;
                }).join('');
            }
            details = `${row('💰 Coins earned', p.coinsEarned)}${row('💵 Final coins', p.coins)}${row('🏆 Minigames won', p.mgWins)}${row('🔄 Full circuits', p.fullCircuitsCompleted)}${row('📋 Contracts', p.contractsClaimed)}${row('⚔️ Duels won', p.duelsWon)}${domRow(p)}`;
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

    _renderRaceChart();
    _wireRotate();

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

// ---- The race, turn by turn ----------------------------------------------
//
// Board progress for both players against turn number. `state.history` stores
// progress normalised 0..1 (HBD) or laps + lap-fraction (City Circuit), so one
// chart shape serves both maps. Drawn as inline SVG — no dependency, scales to
// whatever box the landscape layout gives it.
function _renderRaceChart() {
    const host = document.getElementById('win-chart');
    const legend = document.getElementById('win-chart-legend');
    if (!host) return;
    const h = state.history || [];
    if (h.length < 2) {
        host.innerHTML = '<div style="display:flex;height:100%;align-items:center;' +
            'justify-content:center;color:rgba(255,255,255,.4);' +
            'font-family:Nunito,system-ui,sans-serif;font-size:12px;">' +
            'Match too short to chart</div>';
        if (legend) legend.innerHTML = '';
        return;
    }

    const W = 320, H = 150, padL = 26, padR = 10, padT = 10, padB = 20;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxTurn = Math.max(...h.map(e => e.turn), 1);
    const maxProg = Math.max(1, ...h.map(e => Math.max(e.prog[0], e.prog[1])));
    const x = t => padL + (t / maxTurn) * iw;
    const y = v => padT + ih - (v / maxProg) * ih;

    const colors = ['#ff5a5a', '#5a9bff'];
    const paths = [0, 1].map(pi => {
        const pts = h.map(e => `${x(e.turn).toFixed(1)},${y(e.prog[pi]).toFixed(1)}`);
        return `<polyline fill="none" stroke="${colors[pi]}" stroke-width="2.5" ` +
               `stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>`;
    }).join('');

    // Mark where the lead changed hands — the story beat people argue about.
    const flips = [];
    for (let i = 1; i < h.length; i++) {
        const a = Math.sign(h[i - 1].prog[0] - h[i - 1].prog[1]);
        const b = Math.sign(h[i].prog[0] - h[i].prog[1]);
        if (a !== 0 && b !== 0 && a !== b) flips.push(h[i]);
    }
    const flipMarks = flips.map(e =>
        `<line x1="${x(e.turn).toFixed(1)}" y1="${padT}" x2="${x(e.turn).toFixed(1)}" y2="${padT + ih}" ` +
        `stroke="rgba(251,191,36,.45)" stroke-width="1" stroke-dasharray="3 3"/>`).join('');

    // Axes: turn numbers along the bottom, finish line along the top.
    const ticks = [];
    const step = Math.max(1, Math.ceil(maxTurn / 5));
    for (let t = 0; t <= maxTurn; t += step) {
        ticks.push(`<text x="${x(t).toFixed(1)}" y="${H - 6}" fill="rgba(255,255,255,.45)" ` +
                   `font-size="9" font-family="Nunito,sans-serif" text-anchor="middle">${t}</text>`);
    }
    const finishLine = state.selectedMap === 'hundred_block_dash'
        ? `<line x1="${padL}" y1="${y(1).toFixed(1)}" x2="${W - padR}" y2="${y(1).toFixed(1)}" ` +
          `stroke="rgba(251,191,36,.55)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
          `<text x="${W - padR}" y="${(y(1) - 4).toFixed(1)}" fill="rgba(251,191,36,.8)" font-size="9" ` +
          `font-family="Nunito,sans-serif" text-anchor="end">👑 CROWN</text>`
        : '';

    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" ` +
        `aria-label="Board progress per turn for both players">` +
        `<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="rgba(255,255,255,.03)"/>` +
        flipMarks + finishLine + paths +
        `<text x="4" y="${padT + 8}" fill="rgba(255,255,255,.45)" font-size="9" ` +
        `font-family="Nunito,sans-serif">${state.selectedMap === 'hundred_block_dash' ? 'END' : 'LAPS'}</text>` +
        `<text x="4" y="${padT + ih}" fill="rgba(255,255,255,.45)" font-size="9" ` +
        `font-family="Nunito,sans-serif">START</text>` +
        ticks.join('') + `</svg>`;

    if (legend) {
        const flipTxt = flips.length
            ? `<span><span class="wc-swatch" style="background:rgba(251,191,36,.8)"></span>lead changed <b>${flips.length}×</b></span>`
            : '<span>lead never changed</span>';
        legend.innerHTML =
            `<span><span class="wc-swatch" style="background:${colors[0]}"></span><b>${state.players[0].name}</b></span>` +
            `<span><span class="wc-swatch" style="background:${colors[1]}"></span><b>${state.players[1].name}</b></span>` +
            `<span>turns: <b>${maxTurn}</b></span>` + flipTxt;
    }
}

// Landscape by default; the toggle is there for anyone holding the phone upright.
function _wireRotate() {
    const btn = document.getElementById('btn-win-rotate');
    const scr = document.getElementById('win-screen');
    if (!btn || !scr || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', () => scr.classList.toggle('portrait'));
}
