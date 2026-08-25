// ============================================================
// SOLO ROUND — the screens around a game played on every phone at once
// ============================================================
// The split-screen chrome in #minigame-layer is built for two people sharing
// one device: two zones, two READY buttons, a status strip mirrored so both
// ends of the table can read it. None of that means anything when four people
// are each holding their own phone and playing the same challenge alone.
//
// So a parallel round gets its own three screens:
//
//   THE CARD      what the game is, how it is played, and who is in it. Every
//                 device shows it, including the ones not playing — a phone
//                 that goes quiet for thirty seconds with no explanation reads
//                 as a crash.
//   THE GAME      only on the phones actually playing.
//   THE BOARD     the scores, ranked, on every phone. This is the bit that
//                 makes it a contest rather than four people playing alone: it
//                 is the first time anybody sees how they did against the rest.
//
// There is no READY gate in front of the game. A gate would mean the slowest
// person to look up decides when everybody starts, and the whole reason this
// works across phones is that nothing has to be simultaneous to the frame — the
// challenge is identical because the seed is, not because the clocks are.

import { state } from '../core/GameState.js';
import { PLAYER_SLOTS } from '../config/GameConfig.js';
import { MG_INFO } from '../config/MinigameRegistry.js';
import { sfx } from '../engine/AudioManager.js';

const _el = id => document.getElementById(id);

function _layer(on) {
    const l = _el('solo-layer');
    if (l) l.style.display = on ? 'flex' : 'none';
}

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function _chip(seat, cls = '') {
    const slot = PLAYER_SLOTS[seat] || PLAYER_SLOTS[0];
    const name = (state.players[seat] && state.players[seat].name) || slot.name;
    return `<span class="sp ${cls}" style="--sp:${slot.hex}">${slot.icon} ${_esc(name)}</span>`;
}

/**
 * The card in front of a round.
 *
 * `onGo` is called when this device is ready to start. A player who is not in
 * the round has nothing to press: they are told who is playing and the card
 * stays up until the scoreboard replaces it.
 */
export function showIntro(type, seats, playing, onGo) {
    const info = MG_INFO[type] || {};
    _layer(true);
    const card = _el('solo-card'), board = _el('solo-board');
    if (card) card.style.display = 'flex';
    if (board) board.style.display = 'none';

    if (_el('solo-icon'))  _el('solo-icon').textContent = info.icon || '🎮';
    if (_el('solo-title')) _el('solo-title').textContent = info.title || 'MINIGAME';
    if (_el('solo-desc'))  _el('solo-desc').textContent = info.desc || '';
    if (_el('solo-kicker')) {
        _el('solo-kicker').textContent = playing
            ? (seats.length > 2 ? 'EVERYONE PLAYS AT ONCE' : 'BOTH OF YOU, AT ONCE')
            : 'WATCHING';
    }
    if (_el('solo-players')) {
        _el('solo-players').innerHTML = seats
            .map(s => _chip(s, s === state.localSeat ? 'is-me' : '')).join('');
    }
    if (_el('solo-note')) {
        _el('solo-note').textContent = playing
            ? 'Same challenge on every phone — highest score wins.'
            : 'Sit this one out. The scores come back here.';
    }

    const go = _el('btn-solo-go');
    if (go) {
        go.style.display = playing ? '' : 'none';
        go.textContent = 'START';
        go.disabled = false;
        go.onclick = () => {
            go.disabled = true;
            sfx('ui_confirm');
            // The card comes down and the game takes the layer beneath it.
            _layer(false);
            if (onGo) onGo();
        };
    }
}

/** The scoreboard. Every device shows the same table. */
export function showResults(type, table, winner, tied, paid) {
    const info = MG_INFO[type] || {};
    _layer(true);
    const card = _el('solo-card'), board = _el('solo-board');
    if (card) card.style.display = 'none';
    if (board) board.style.display = 'flex';

    if (_el('solo-board-title')) _el('solo-board-title').textContent = info.title || 'MINIGAME';

    const rows = (table || []).slice().sort((a, b) => b.score - a.score || a.seat - b.seat);
    if (_el('solo-rows')) {
        _el('solo-rows').innerHTML = rows.map((r, i) => {
            const slot = PLAYER_SLOTS[r.seat] || PLAYER_SLOTS[0];
            const win  = r.seat === winner;
            const me   = r.seat === state.localSeat;
            // A zero from somebody who never reported is not the same as a zero
            // from somebody who played badly, and pretending otherwise reads as
            // an insult. It is not distinguishable from here, so a zero is just
            // shown quietly.
            return `<div class="solo-row${win ? ' is-win' : ''}${r.score === 0 ? ' is-quiet' : ''}" style="--sp:${slot.hex}">` +
                   `<span class="sr-rank">${i + 1}</span>` +
                   `<span class="sr-name">${slot.icon} ${_esc(r.name)}${me ? '<span class="sr-you">YOU</span>' : ''}</span>` +
                   `<span class="sr-score">${_fmt(type, r.score)}</span></div>`;
        }).join('');
    }
    if (_el('solo-board-note')) {
        const w = (state.players[winner] && state.players[winner].name) || 'Nobody';
        const line = tied
            ? `Tied at the top — ${w} takes it on seat order.`
            : `${w} takes the round.`;
        // A payday game paid everybody, and saying so is the point of it: the
        // person who came last still walked away with something.
        const mine = (paid || []).find(p => p.seat === state.localSeat);
        _el('solo-board-note').textContent = mine
            ? `${line}  You keep your ${mine.coins} 🪙.`
            : line;
    }
    sfx('mg_win');
}

/** Take everything down. */
export function hide() {
    _layer(false);
    const go = _el('btn-solo-go');
    if (go) go.onclick = null;
}

// Scores are reported as integers so they can be compared without worrying
// about how any one game counts. Turning them back into something readable is
// per-game, and the games that count in tenths say so here.
const TENTHS = new Set(['steadyhand']);

function _fmt(type, score) {
    if (TENTHS.has(type)) return `${(score / 10).toFixed(1)}s`;
    return String(score);
}
