// ============================================================
// ROUND BOARD — how everybody sees where everybody is
// ============================================================
// A two-player minigame needs none of this. Two people are holding one screen
// and can see each other's half, so the pressure is free and the only job is
// not to cover it up.
//
// Three and four players break that in both directions. In a RELAY you play
// alone and the people watching cannot tell whether you are ahead until it is
// over. In a BRACKET you sit out two of the three legs. Either way the round
// stops being a contest you can feel and becomes a number announced at the end.
//
// So this module is the round's scoreboard, in three pieces, and they are
// deliberately the same three at every player count and in both formats:
//
//   THE RAIL      A strip across the top while somebody is playing: one chip
//                 per player, their number, the leader marked. It is what you
//                 chase while you play and what the room reads while it
//                 watches. It rides in the 46 px band the mirrored status strip
//                 leaves empty when one person has the screen to themselves, so
//                 it costs the game no room at all
//                 (docs/MINIGAME_RULEBOOK.md §6.2).
//
//   THE CARD      Between legs: whose go it is, what there is to beat, and the
//                 standings. This is where a relay hands the phone on and where
//                 a bracket shows its draw.
//
//   THE BOARD     At the end: everybody, ranked.
//
// Nothing here decides anything. `RoundFormat` owns the round; this draws it.

import { state } from '../core/GameState.js';
import { PLAYER_SLOTS } from '../config/GameConfig.js';
import { MG_INFO, MG_NET_INFO } from '../config/MinigameRegistry.js';
import { sfx } from '../engine/AudioManager.js';

const _el = id => document.getElementById(id);
const _esc = s => String(s == null ? '' : s)
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const _name = seat => (state.players[seat] && state.players[seat].name) || `Player ${seat + 1}`;
const _slot = seat => PLAYER_SLOTS[seat] || PLAYER_SLOTS[0];

// Scores are integers so they can be compared without asking how any one game
// counts. Turning one back into something readable is per-game.
const TENTHS = new Set(['steadyhand']);
const LIVES  = new Set(['meteordodge']);
function fmt(type, score) {
    if (score == null) return '—';
    if (TENTHS.has(type)) return `${(score / 10).toFixed(1)}s`;
    // Meteor Dodge's score is lives × 1000 + dodges, which is a sort key and
    // not a thing to show anybody.
    if (LIVES.has(type)) return `${'♥'.repeat(Math.max(0, Math.floor(score / 1000)))} ${score % 1000}`;
    return String(score);
}

// ── The rail ────────────────────────────────────────────────────────────────

let _railOn = false;

/**
 * Show the standings across the top of a solo leg.
 *
 * `active` is the seat playing right now — their chip is marked rather than
 * carrying a score, because their score is the thing on the screen underneath.
 */
export function showRail(round, active) {
    const rail = _el('round-rail');
    if (!rail) return;
    _railOn = true;
    rail.style.display = 'flex';
    paintRail(round, active);
}

export function paintRail(round, active) {
    const rail = _el('round-rail');
    if (!rail || !_railOn) return;
    const scores = round.relay ? round.scores : round.wins;
    const played = round.seats.filter(s => scores[s] != null);
    const best   = played.length ? Math.max(...played.map(s => scores[s])) : null;
    rail.innerHTML = round.seats.map(s => {
        const slot = _slot(s);
        const mine = s === active;
        const val  = scores[s];
        const lead = best != null && val === best && val > 0 && !mine;
        return `<div class="rr-chip${mine ? ' rr-now' : ''}${lead ? ' rr-lead' : ''}" style="--rr:${slot.hex}">` +
               `<span class="rr-who">${slot.icon}</span>` +
               `<span class="rr-val">${mine ? 'NOW' : fmt(round.type, val)}</span></div>`;
    }).join('');
}

/**
 * The rail, painted from what the host said rather than from a local round.
 *
 * Across phones there is no round object on this device to read — each phone is
 * playing its own copy and the only shared truth is the host's table. Same
 * strip, same chips, same meaning; a different source.
 */
export function netRail(type, table, me) {
    const rail = _el('round-rail');
    if (!rail || !table.length) return;
    _railOn = true;
    rail.style.display = 'flex';
    const best = Math.max(0, ...table.map(t => t.score || 0));
    rail.innerHTML = table.map(t => {
        const slot = _slot(t.seat);
        const mine = t.seat === me;
        const lead = (t.score || 0) === best && best > 0;
        // A seat that has finished stops moving and says so, so the number you
        // are chasing is not one that might still go up.
        return `<div class="rr-chip${mine ? ' rr-now' : ''}${lead ? ' rr-lead' : ''}" style="--rr:${slot.hex}">` +
               `<span class="rr-who">${slot.icon}${t.done ? '✓' : ''}</span>` +
               `<span class="rr-val">${fmt(type, t.score)}</span></div>`;
    }).join('');
}

export function hideRail() {
    _railOn = false;
    const rail = _el('round-rail');
    if (rail) { rail.style.display = 'none'; rail.innerHTML = ''; }
}

// ── The card ────────────────────────────────────────────────────────────────

function _card({ kicker, title, sub, rows, button, onGo, autoMs }) {
    const layer = _el('round-layer');
    if (!layer) { if (onGo) onGo(); return; }
    layer.style.display = 'flex';
    _set('round-kicker', kicker);
    _set('round-title', title);
    _set('round-sub', sub || '');
    const list = _el('round-rows');
    if (list) list.innerHTML = rows || '';
    const btn = _el('btn-round-go');
    if (btn) {
        btn.style.display = button ? '' : 'none';
        btn.textContent = button || '';
        btn.disabled = false;
        btn.onclick = () => {
            btn.disabled = true;
            btn.onclick = null;
            sfx('ui_confirm');
            layer.style.display = 'none';
            if (onGo) onGo();
        };
    }
    if (autoMs) {
        setTimeout(() => {
            if (layer.style.display === 'none') return;
            layer.style.display = 'none';
            if (btn) btn.onclick = null;
            if (onGo) onGo();
        }, autoMs);
    }
}

function _set(id, text) { const e = _el(id); if (e) e.textContent = text; }

/** One standings row per player, ordered as the round orders them. */
function _rows(round, opts = {}) {
    const scores = round.relay ? round.scores : round.wins;
    const list = round.seats.slice();
    if (opts.rank) list.sort((a, b) => (scores[b] || 0) - (scores[a] || 0) || a - b);
    const best = Math.max(0, ...round.seats.map(s => scores[s] || 0));
    return list.map((s, i) => {
        const slot = _slot(s);
        const val  = scores[s];
        const win  = opts.winner === s;
        const wait = val == null;
        const lead = !win && val != null && val === best && best > 0;
        return `<div class="rb-row${win ? ' is-win' : ''}${wait ? ' is-wait' : ''}" style="--rb:${slot.hex}">` +
               (opts.rank ? `<span class="rb-rank">${i + 1}</span>` : `<span class="rb-rank">${lead ? '👑' : ''}</span>`) +
               `<span class="rb-name">${slot.icon} ${_esc(_name(s))}` +
               `${state.players[s] && state.players[s].isBot ? '<span class="rb-bot">BOT</span>' : ''}</span>` +
               `<span class="rb-val">${wait ? '—' : fmt(round.type, val)}</span></div>`;
    }).join('');
}

/** The round is starting. Say what it is and how it will be played. */
export function begin(round) {
    const info = MG_INFO[round.type] || {};
    const n = round.seats.length;
    if (n <= 2) return;              // two players: the game explains itself
    const how = round.relay
        ? `EVERYONE PLAYS THE SAME ${info.title || 'GAME'} — ONE AT A TIME`
        : (n === 3 ? 'OPENER, THEN THE DECIDER' : 'TWO SEMI-FINALS, THEN THE FINAL');
    round._how = how;
}

/**
 * What the game is, once, before a relay starts.
 *
 * A bracket gets this from the manager's own rules card. A relay does not go
 * through it, and being handed a phone with a game on it you have never seen is
 * not a fair go.
 */
export function rules(round, onGo) {
    const info = MG_INFO[round.type] || {};
    _card({
        kicker: round._how || 'EVERYONE PLAYS',
        title: info.title || 'MINIGAME',
        // MG_NET_INFO is the wording written for one person alone with the
        // whole screen, which is what a relay leg is. MG_INFO's talks about
        // "your half" and sends somebody looking for a second player.
        sub: MG_NET_INFO[round.type] || info.desc || '',
        rows: _rows(round),
        button: 'START',
        onGo,
    });
}

/**
 * A relay hands the phone to the next player.
 *
 * The mark to beat is the whole card. Somebody about to take their go needs one
 * number, and it is the best score anybody has put up — not a table they have
 * to read while three people wait.
 */
export function handoff(round, seat, onGo) {
    const played = round.seats.filter(s => round.scores[s] != null);
    const best = played.length ? Math.max(...played.map(s => round.scores[s])) : null;
    const holder = played.length
        ? round.seats.find(s => round.scores[s] === best) : null;
    _card({
        kicker: round._how || 'YOUR GO',
        title: `${_name(seat).toUpperCase()} — YOUR GO`,
        sub: best == null
            ? 'You go first. Put up a number for the rest of them to chase.'
            : `TO BEAT: ${fmt(round.type, best)}  ·  ${_name(holder)}`,
        rows: _rows(round),
        button: "I'M READY",
        onGo,
    });
}

/** A bracket announces the next leg, and shows the draw so far. */
export function nextLeg(round, leg, pair, onGo) {
    if (round.seats.length <= 2) { onGo(); return; }
    _card({
        kicker: leg.name || 'NEXT UP',
        title: `${_name(pair[0]).toUpperCase()}  vs  ${_name(pair[1]).toUpperCase()}`,
        sub: round._how || '',
        rows: _bracketRows(round),
        button: 'PLAY IT',
        onGo,
    });
}

/** A leg with nobody in it to watch: say what happened and move on. */
export function simulated(round, leg, onGo) {
    const w = leg.winner;
    _card({
        kicker: leg.name || 'RESULT',
        title: `${_name(w).toUpperCase()} GOES THROUGH`,
        sub: 'Two bots — settled without taking the screen.',
        rows: _bracketRows(round),
        button: null,
        onGo,
        autoMs: 1800,
    });
}

function _bracketRows(round) {
    return round.legs.map((l, i) => {
        const done = typeof l.winner === 'number';
        const pair = (l.pair || []).map(s => (s == null ? '?' : _name(s)));
        const label = pair.filter(Boolean).join(' v ') || 'winners';
        const mark = done
            ? (l.winner >= 0 ? `${_esc(_name(l.winner))} ✓` : 'drawn')
            : (i === round.at ? 'now' : '—');
        // The leg's NAME is already the card's kicker and its number is the rank
        // column, so the row carries only the pairing. Repeating "SEMI-FINAL 1"
        // in all three places wrapped the row onto two lines for no information.
        return `<div class="rb-row${done ? '' : (i === round.at ? '' : ' is-wait')}">` +
               `<span class="rb-rank">${i + 1}</span>` +
               `<span class="rb-name">${_esc(label)}</span>` +
               `<span class="rb-val">${mark}</span></div>`;
    }).join('');
}

/** The round is over. Everybody, ranked. */
export function finish(round, winner, table, onGo) {
    if (round.seats.length <= 2) { onGo(); return; }
    const info = MG_INFO[round.type] || {};
    const paid = Object.keys(round.coins).length
        ? `  Coins kept: ${round.seats.filter(s => round.coins[s])
              .map(s => `${_name(s)} ${round.coins[s]}🪙`).join(' · ')}`
        : '';
    _card({
        kicker: info.title || 'MINIGAME',
        title: `${_name(winner).toUpperCase()} TAKES IT`,
        sub: (round.tied ? 'Tied at the top — earlier seat takes it.' : 'They roll first next turn.') + paid,
        rows: _rows(round, { rank: true, winner }),
        button: 'CONTINUE',
        onGo,
    });
    sfx('mg_win');
}

/** Take everything down. */
export function hide() {
    hideRail();
    const layer = _el('round-layer');
    if (layer) layer.style.display = 'none';
    const btn = _el('btn-round-go');
    if (btn) btn.onclick = null;
}
