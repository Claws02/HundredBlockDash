// ============================================================
// READY GATE — nobody moves on until everybody has
// ============================================================
// Some beats are not one player's decision, they are the whole table reading
// the same thing: the opening briefing that explains the four roads, and any
// announcement everybody has to have seen before play begins.
//
// Those used to be dismissed independently. Each device raised its own copy and
// each press moved only that device on, so the host could be three turns into a
// match while somebody was still reading the map — and the first thing that
// player saw of the game was a board that had already changed without them.
// "Everyone is looking at the same screen" is not something a snapshot can
// enforce; it needs somebody to WAIT.
//
// So: a gate. Every seat presses; the host counts; when the count is complete
// the host runs the continuation and tells everybody the gate is open.
//
// Offline this is one seat pressing once, which is what it always was — the
// gate reduces to a direct call and costs a comparison.

import { state } from '../core/GameState.js';
import * as Session from './NetSession.js';
import * as Scenes from '../ui/Scenes.js';
import * as UIManager from '../ui/UIManager.js';

/** The opening briefing: the one gate there is so far. */
export const BRIEFING = 'briefing';

// Gates the host is holding: id → { seats: Set, done, total }
const _open = new Map();

/** Who still has to press. Drives the waiting copy on the card. */
export function pending(id) {
    const g = _open.get(id);
    if (!g) return 0;
    return Math.max(0, g.total - g.seats.size);
}



/**
 * Host: hold `id` until every seat has pressed, then run `done` once.
 *
 * Bots are counted as present immediately — nobody is going to press for them,
 * and a gate that waits on an empty chair is a hang.
 */
export function open(id, done) {
    if (!Session.isHost()) return;
    const seats = new Set();
    state.players.forEach((p, i) => { if (p.isBot) seats.add(i); });
    _open.set(id, { seats, done, total: state.players.length });
    _maybeFinish(id);
}

/**
 * Open the gate if it is not already open.
 *
 * Whoever presses first opens it — which may be a client, whose press arrives
 * as an intent before the host has thought about the gate at all. Requiring the
 * host to open it first would drop that press on the floor and hang the gate on
 * a seat that had already answered.
 */
export function ensure(id, done) {
    if (!Session.isHost() || _open.has(id)) return;
    open(id, done);
}

/**
 * A seat has voted on the briefing.
 *
 * ONE entry point for both routes into this, which is what the first version
 * got wrong. A client's press is forwarded by the command bus and applied by
 * the host — but `Commands.runLocal` drops the envelope's seat, so the host ran
 * its OWN press path instead, found it already spent, and dropped the client's
 * vote on the floor. The gate then waited forever on a player who had pressed.
 *
 * So the seat is always passed explicitly, and whoever is calling — the host
 * for itself, or the host on behalf of an intent — goes through here.
 */
export function voteBriefing(seat) {
    ensure(BRIEFING, () => UIManager.closeBriefingNow());
    ack(BRIEFING, seat);
}

/** Host: a seat has pressed. */
export function ack(id, seat) {
    if (!Session.isHost()) return;
    const g = _open.get(id);
    if (!g || typeof seat !== 'number') return;
    g.seats.add(seat);
    // Everybody's card updates as the count moves, so waiting is visible
    // rather than a button that stopped doing anything.
    Scenes.emit('gateCount', { id, waiting: Math.max(0, g.total - g.seats.size) });
    _maybeFinish(id);
}

function _maybeFinish(id) {
    const g = _open.get(id);
    if (!g || g.seats.size < g.total) return;
    _open.delete(id);
    Scenes.emit('gateOpen', { id });
    if (g.done) g.done();
}

/** A match is over or abandoned; nothing may still be holding. */
export function reset() { _open.clear(); }
