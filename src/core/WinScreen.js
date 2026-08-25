// ============================================================
// WIN SCREEN — final scoring, winner determination, and the
// game-over card / confetti presentation.
//
// Imports earnCoins from Economy to apply City Circuit dominance bonuses.
// ============================================================

import { state } from './GameState.js';
import { DISTRICT_DOMINANCE_BONUS, HQ_META, HBD_FINISH_BONUS, PLAYER_SLOTS } from '../config/GameConfig.js';
import { earnCoins } from './Economy.js';
import * as Stats from './Stats.js';
import * as ModalManager from '../ui/ModalManager.js';
import { sfx } from '../engine/AudioManager.js';
import * as ActiveMap from '../config/ActiveMap.js';

export function calculateWinner() {
    const players = state.players;
    const HBD_FIN = state.hbd ? state.hbd.finish : 99;
    let subtitle;

    if (ActiveMap.has('finishBonus')) {
        subtitle = 'WINS THE HUSTLE!';
    } else {
        // City Circuit: district dominance. Was a pairwise comparison; with
        // three or four players a district is controlled by whoever visited it
        // MOST, and a tie at the top pays nobody — splitting the bonus would
        // reward two players for failing to take it off each other.
        ActiveMap.regionKeys().forEach(dk => {
            const best = Math.max(...players.map(q => q.districtsVisited[dk] || 0));
            if (best <= 0) return;
            const holders = players.filter(q => (q.districtsVisited[dk] || 0) === best);
            if (holders.length === 1) earnCoins(holders[0], DISTRICT_DOMINANCE_BONUS);
        });
        subtitle = 'WINS THE CITY!';
    }

    // Final score per seat. The finish bonus is added on the linear map only,
    // and after dominance so City's bonuses are already in `coins`.
    const scoreOf = p => ActiveMap.has('finishBonus')
        ? p.coins + (p.pos >= HBD_FIN ? HBD_FINISH_BONUS : 0)
        : p.coins;
    const scores = new Map(players.map(p => [p.id, scoreOf(p)]));

    // Tiebreak: how far round / how far along, then seat order so the result is
    // identical on every device in an online match.
    const tieValue = p => ActiveMap.isLinear()
        ? (typeof p.pos === 'number' ? p.pos : 0)
        : p.fullCircuitsCompleted;
    const ranked = players.slice().sort((a, b) =>
        (scores.get(b.id) - scores.get(a.id)) || (tieValue(b) - tieValue(a)) || (a.id - b.id));

    const winner = ranked[0];
    const runnerUp = ranked[1];
    // A tie is only a tie if the tiebreak could not separate them either.
    const isTie = !!runnerUp
        && scores.get(runnerUp.id) === scores.get(winner.id)
        && tieValue(runnerUp) === tieValue(winner);

    ModalManager.closeAllModals();
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('win-name').textContent = isTie ? 'TIE GAME!' : winner.name.toUpperCase();
    document.getElementById('win-subtitle').textContent = isTie
        ? (players.length > 2 ? 'The top of the table finishes equal.' : 'Both players finish equal.')
        : subtitle;

    // Each stat is one tile in a two-across grid rather than a full-width row.
    // Ten stacked label/value rows per card did not fit the landscape screen —
    // they ran past the chart and pushed REMATCH off the edge entirely. Two
    // columns halves the height, and the list scrolls inside the card so the
    // buttons below it can never be displaced again.
    function stat(icon, label, val) {
        return `<div class="ws-tile"><span class="ws-ic">${icon}</span>` +
               `<span class="ws-v">${val}</span><span class="ws-l">${label}</span></div>`;
    }
    function districtStrip(pl) {
        const chips = ActiveMap.regionKeys().map(dk => {
            const icon = HQ_META[dk]?.icon || '🏛️';
            const mine = pl.districtsVisited[dk] || 0;
            // Held outright — matching the bonus rule above, so the crown on
            // the card and the coins actually paid never disagree.
            const held = mine > 0 && state.players.every(q =>
                q.id === pl.id || (q.districtsVisited[dk] || 0) < mine);
            return `<span class="ws-chip${held ? ' ws-held' : ''}" title="${ActiveMap.regionName(dk)}${held ? ' — controlled' : ''}">` +
                   `${icon}<b>${mine}</b>${held ? '<i>👑</i>' : ''}</span>`;
        }).join('');
        return `<div class="ws-districts"><span class="ws-dlabel">DISTRICTS</span><span class="ws-chips">${chips}</span></div>`;
    }
    function card(p, s) {
        const isW = !isTie && p === winner;
        let details;
        if (ActiveMap.has('finishBonus')) {
            const fin = p.pos >= HBD_FIN ? HBD_FINISH_BONUS : 0;
            details = `<div class="ws-grid">${
                stat('💰', 'earned', p.coinsEarned)}${
                stat('💵', 'left', p.coins)}${
                stat('🏆', 'minigames', p.mgWins)}${
                stat('📍', 'final space', p.pos >= HBD_FIN ? '🏁' : p.pos)}${
                fin ? stat('🏁', 'finish bonus', '+' + fin) : ''}</div>`;
        } else {
            details = `<div class="ws-grid">${
                stat('💰', 'earned', p.coinsEarned)}${
                stat('💵', 'final', p.coins)}${
                stat('🏆', 'minigames', p.mgWins)}${
                stat('🔄', 'circuits', p.fullCircuitsCompleted)}${
                stat('🎯', 'bounties', p.contractsClaimed)}${
                stat('⚔️', 'duels', p.duelsWon)}</div>${districtStrip(p)}`;
        }
        return `<div class="win-card${isW ? ' winner-card' : ''}">` +
               `<div class="win-card-head"><div class="win-card-name">${isW ? '👑 ' : ''}${p.name}</div>` +
               `<div class="win-card-score">${s}</div></div>` +
               `<div class="win-card-stats">${details}</div></div>`;
    }
    // Best first, so a four-way result reads as a table rather than as seat order.
    document.getElementById('win-cards').innerHTML =
        ranked.map(p => card(p, scores.get(p.id))).join('');
    document.getElementById('win-cards').classList.toggle('win-cards-many', players.length > 2);

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
// City Circuit is a lap map scored on coins. Where you happen to be standing
// when the last round ends says almost nothing about who won — a player can be
// half a lap behind and 40 coins up. So City plots the COIN totals at each
// round boundary, and HBD (an actual race to a finish line) keeps position.
//
// Round boundaries, not turns: the round is the unit City is played in, coins
// swing hard inside one (an HQ payout, a minigame, a duel), and a per-turn line
// is a sawtooth nobody can read. Taking the last sample of each round gives one
// point per round — the standing as each round closed.
function _coinsByRound(h) {
    const out = [];
    let cur = null;
    h.forEach(e => {
        // `history.round` is state.currentRound at record time, which counts
        // rounds COMPLETED — so the opening round's samples carry 0. The HUD
        // counter now prints the round being PLAYED, and an axis that starts at
        // 0 next to a counter that said ROUND 1 reads as a different match.
        const r = (e.round || 0) + 1;
        if (!cur || cur.round !== r) { cur = { round: r, coins: e.coins.slice() }; out.push(cur); }
        else cur.coins = e.coins.slice();
    });
    // A match that never completed a round still has a story to tell; fall back
    // to the raw turn samples rather than drawing a single dot.
    return out.length >= 2 ? out : null;
}

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

    const isHBD  = ActiveMap.isLinear();
    const rounds = isHBD ? null : _coinsByRound(h);
    // What the line actually is, per board.
    const series = rounds
        ? rounds.map(e => ({ x: e.round, v: e.coins }))
        : h.map(e => ({ x: e.turn, v: isHBD ? e.prog : e.coins }));
    const unit   = rounds ? 'ROUND' : 'TURN';

    const W = 320, H = 150, padL = 30, padR = 10, padT = 10, padB = 20;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxX = Math.max(...series.map(e => e.x), 1);
    const minX = Math.min(...series.map(e => e.x), 0);
    const spanX = Math.max(1, maxX - minX);
    const maxV = Math.max(1, ...series.map(e => Math.max(...e.v)));
    const x = t => padL + ((t - minX) / spanX) * iw;
    const y = v => padT + ih - (v / maxV) * ih;

    // One line per seat, in that seat's colour. Was two hard-coded strings.
    const colors = PLAYER_SLOTS.map(sl => sl.hex);
    const seats  = state.players.map(p => p.id);
    const paths = seats.map(pi => {
        const pts = series.map(e => `${x(e.x).toFixed(1)},${y(e.v[pi]).toFixed(1)}`);
        const line = `<polyline fill="none" stroke="${colors[pi]}" stroke-width="2.5" ` +
                     `stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>`;
        // One dot per round makes the sample points legible — a coin line is a
        // series of standings, not a continuous quantity.
        const dots = rounds
            ? series.map(e => `<circle cx="${x(e.x).toFixed(1)}" cy="${y(e.v[pi]).toFixed(1)}" r="2.6" fill="${colors[pi]}"/>`).join('')
            : '';
        return line + dots;
    }).join('');

    // Mark where the lead changed hands — the story beat people argue about.
    // At more than two seats "the lead" is whoever is top, so a flip is the
    // top seat changing rather than a sign change between two numbers.
    const leaderAt = e => {
        let best = -Infinity, who = -1, tied = false;
        seats.forEach(pi => {
            const v = e.v[pi];
            if (v > best) { best = v; who = pi; tied = false; }
            else if (v === best) { tied = true; }
        });
        return tied ? -1 : who;
    };
    const flips = [];
    for (let i = 1; i < series.length; i++) {
        const a = leaderAt(series[i - 1]), b = leaderAt(series[i]);
        if (a >= 0 && b >= 0 && a !== b) flips.push(series[i]);
    }
    const flipMarks = flips.map(e =>
        `<line x1="${x(e.x).toFixed(1)}" y1="${padT}" x2="${x(e.x).toFixed(1)}" y2="${padT + ih}" ` +
        `stroke="rgba(251,191,36,.45)" stroke-width="1" stroke-dasharray="3 3"/>`).join('');

    const ticks = [];
    const step = Math.max(1, Math.ceil(spanX / 5));
    for (let t = minX; t <= maxX; t += step) {
        ticks.push(`<text x="${x(t).toFixed(1)}" y="${H - 6}" fill="rgba(255,255,255,.45)" ` +
                   `font-size="9" font-family="Nunito,sans-serif" text-anchor="middle">${t}</text>`);
    }
    const finishLine = isHBD
        ? `<line x1="${padL}" y1="${y(1).toFixed(1)}" x2="${W - padR}" y2="${y(1).toFixed(1)}" ` +
          `stroke="rgba(251,191,36,.55)" stroke-width="1.5" stroke-dasharray="5 4"/>` +
          `<text x="${W - padR}" y="${(y(1) - 4).toFixed(1)}" fill="rgba(251,191,36,.8)" font-size="9" ` +
          `font-family="Nunito,sans-serif" text-anchor="end">👑 CROWN</text>`
        : '';
    // A coin axis needs numbers on it; a normalised progress axis does not.
    const yLabels = isHBD
        ? `<text x="4" y="${padT + 8}" fill="rgba(255,255,255,.45)" font-size="9" font-family="Nunito,sans-serif">END</text>` +
          `<text x="4" y="${padT + ih}" fill="rgba(255,255,255,.45)" font-size="9" font-family="Nunito,sans-serif">START</text>`
        : `<text x="4" y="${padT + 8}" fill="rgba(255,255,255,.45)" font-size="9" font-family="Nunito,sans-serif">${maxV}</text>` +
          `<text x="4" y="${padT + ih}" fill="rgba(255,255,255,.45)" font-size="9" font-family="Nunito,sans-serif">0</text>`;

    host.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" ` +
        `aria-label="${isHBD ? 'Board progress per turn' : 'Coin totals at the end of each round'} for all players">` +
        `<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="rgba(255,255,255,.03)"/>` +
        flipMarks + finishLine + paths + yLabels +
        ticks.join('') + `</svg>`;

    const title = document.querySelector('.win-chart-title');
    if (title) title.textContent = isHBD ? 'THE RACE, TURN BY TURN' : 'COINS, ROUND BY ROUND';

    if (legend) {
        const flipTxt = flips.length
            ? `<span><span class="wc-swatch" style="background:rgba(251,191,36,.8)"></span>lead changed <b>${flips.length}×</b></span>`
            : '<span>lead never changed</span>';
        legend.innerHTML =
            state.players.map(pl =>
                `<span><span class="wc-swatch" style="background:${colors[pl.id]}"></span><b>${pl.name}</b></span>`).join('') +
            `<span>${unit.toLowerCase()}s: <b>${maxX}</b></span>` + flipTxt;
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
