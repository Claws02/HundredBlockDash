// ============================================================
// TARGETING — who "the opponent" is when there is more than one
// ============================================================
// With two players every hostile effect had exactly one possible target, and
// the code said so: `state.players[(p.id + 1) % 2]`, thirteen times over. At
// three and four seats that expression is meaningless — it picks the player
// sitting next to you in the array, which is not a game rule, it is an
// accident of ordering.
//
// So the rules are written down here instead, once, and every effect names the
// rule it wants rather than doing its own arithmetic.
//
// THE DESIGN CALL: hostile effects auto-target, they do not open a picker.
//
//   A target picker is the obvious answer and it is the wrong one for this
//   game. It puts a blocking modal in the middle of a turn that already has a
//   result card and a notification queue; it has to be mirrored for tabletop,
//   rotated for Player 2, and forwarded over the wire in online play; and it
//   hands the player in the lead the same weapon as the player in last place.
//
//   Auto-targeting by rule costs no UI, is deterministic (so a client can
//   predict it and a host can validate it), and points every hostile effect at
//   whoever is winning. In a party game that is not a compromise — it is the
//   catch-up mechanic the four-player format needs.
//
// EVERY RULE BELOW REDUCES TO THE OLD BEHAVIOUR AT TWO SEATS. With one rival
// "the richest rival" and "the rival in the lead" are both just the other
// player, so two-player matches play exactly as they did before.

import { state } from './GameState.js';
import { HBD_DEFAULT_CONFIG } from '../config/GameConfig.js';
import * as ActiveMap from '../config/ActiveMap.js';

// ── Progress along the board, comparable across both maps ────────────────────
// Duplicated deliberately from GameController._progressOf: that one is private
// to the turn recorder and importing it would make GameController and this
// module import each other. It is six lines and both are driven by the same
// map data, so they cannot drift apart without ActiveMap changing under both.
export function progressOf(p) {
    if (ActiveMap.isLinear()) {
        const fin = (state.hbd || HBD_DEFAULT_CONFIG).finish || 99;
        return typeof p.pos === 'number' ? Math.max(0, Math.min(1, p.pos / fin)) : 0;
    }
    const ordered = ActiveMap.ordered();
    const i = ordered.indexOf(p.pos);
    const lap = i < 0 ? 0 : i / Math.max(1, ordered.length - 1);
    return p.fullCircuitsCompleted + lap;
}

// ── The roster ───────────────────────────────────────────────────────────────

/** Everyone who is not `p`. The basis for every rule below. */
export function rivals(p) {
    return state.players.filter(q => q.id !== p.id);
}

/**
 * Ties are broken by seat order rather than left to `sort`'s stability, so the
 * host and every client resolve an identical target from identical state. A
 * hostile effect that picked a different victim on two phones is a desync.
 */
function _pick(list, score) {
    if (!list.length) return null;
    let best = list[0], bestScore = score(list[0]);
    for (let i = 1; i < list.length; i++) {
        const s = score(list[i]);
        if (s > bestScore) { best = list[i]; bestScore = s; }
    }
    return best;
}

/** Coin theft — Magnet space, Steal item. Hits the fullest pocket. */
export function richestRival(p) {
    return _pick(rivals(p), q => q.coins);
}

/** Position swaps and traps — Swap space, Swap item, Anchor. Hits the leader. */
export function leadingRival(p) {
    return _pick(rivals(p), q => progressOf(q));
}

/** Duels and face-offs. The rival closest to you on the board. */
export function nearestRival(p) {
    const here = progressOf(p);
    return _pick(rivals(p), q => -Math.abs(progressOf(q) - here));
}

/** Everyone standing on the same square as `p` — buddy steals, brush-pasts. */
export function rivalsOn(p, nodeId) {
    return rivals(p).filter(q => q.pos === nodeId);
}

/** The first co-located rival still holding a buddy, or null. */
export function stealableRivalOn(p, nodeId) {
    return rivalsOn(p, nodeId).find(q => q.allies.length > 0) || null;
}

/**
 * The default rival for anything that has not picked a rule. Kept so a call
 * site that genuinely does not care still resolves to somebody sensible rather
 * than to `players[(id + 1) % 2]`, which at four seats is arbitrary.
 */
export function anyRival(p) {
    return leadingRival(p);
}

/** Match standings, best first. Coins is the score on both maps. */
export function standings() {
    return state.players.slice().sort((a, b) =>
        (b.coins - a.coins) || (progressOf(b) - progressOf(a)) || (a.id - b.id));
}
