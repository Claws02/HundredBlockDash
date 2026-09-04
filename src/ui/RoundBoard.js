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
// THE RAIL is what is left of that, and it is the piece that was always right:
// a strip across the top while somebody is playing — one chip per player, their
// number, the leader marked. It is what you chase while you play and what the
// room reads while it watches.
//
// It rides in the 46 px band the mirrored status strip leaves empty when one
// person has the screen to themselves, so it costs the game no room at all
// (docs/MINIGAME_RULEBOOK.md §6.2).
//
// The between-leg CARDS that used to live here went with the bracket and the
// relay. A round is one game everybody plays at once now; there are no legs to
// hand a phone between.
//
// Nothing here decides anything. It draws what it is told.

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

/** Take everything down. */
export function hide() { hideRail(); }
