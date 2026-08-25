// ============================================================
// NET MINIGAME — a round of a game played on four phones at once
// ============================================================
// Until now a networked round did not play a minigame at all. It announced a
// draw and moved on, which kept the board honest but made the round's payoff a
// coin flip dressed up as a contest.
//
// The games tagged 'parallel' in the registry do not need to be synchronised to
// be played together. Nothing one player does reaches the other's half, so
// there is nothing to reconcile: every device runs the same challenge from the
// same seed at the same time, alone, and the scores are compared at the end.
// That is also the only version of this that scales — four solitaires run as
// happily as two, where four tanks in one arena would not.
//
// THE SHAPE OF A ROUND
//
//   host    picks a game and a seed, and announces both to everybody playing
//   all     play it alone on their own screen
//   all     report a score back to the host
//   host    ranks them, announces the result, and the board carries on
//
// WHAT GOES WRONG, AND WHAT IS DONE ABOUT IT
//
//   A phone that never reports. Somebody locks their screen, a tab is
//   backgrounded and its animation frames stop, a game throws. The host does
//   not wait forever: it waits for everybody, then for a grace period, then
//   scores whoever answered. A missing score is a zero, which is what not
//   playing is worth.
//
//   Two phones reporting different scores for the same seed. That is fine and
//   expected — the seed makes the CHALLENGE identical, not the play.
//
//   A device joining the beat late. It gets the announcement or it does not; if
//   it does not, it never plays, never reports, and is scored zero after the
//   grace period. The round still ends.

import { state } from '../core/GameState.js';
import * as Scenes from '../ui/Scenes.js';
import * as Session from './NetSession.js';
import * as SoloArena from '../minigames/SoloArena.js';
import { MG_INFO, MG_NET, MG_PARALLEL } from '../config/MinigameRegistry.js';

// How long the host will keep waiting after the last expected score fails to
// arrive. Long enough for a phone that is merely slow, short enough that the
// table does not sit staring at a scoreboard nobody can dismiss.
const GRACE_MS = 12000;
// A whole round of any parallel game fits inside this comfortably; it is the
// backstop for a device that answered nothing at all.
const ROUND_CAP_MS = 90000;

let _round = null;     // host: the round in progress
let _localSeats = [];  // every device: the seats this beat is being played by

/** Is this a game that can be played across phones? */
export function canPlayOnline(type) { return MG_NET[type] === 'parallel'; }

/** A parallel game, chosen the same way on every device that needs to know. */
export function pickGame(seedish) {
    if (!MG_PARALLEL.length) return null;
    const i = Math.abs(Math.floor(seedish)) % MG_PARALLEL.length;
    return MG_PARALLEL[i];
}

// ── Host ────────────────────────────────────────────────────────────────────

/**
 * Run a round of `type` between `seats` and call `done(winnerSeat, scores)`.
 *
 * Host only. Every other device reaches the same game through the announced
 * scene below.
 */
export function hostRun(type, seats, done) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    _round = {
        type, seats: seats.slice(), seed, done,
        scores: {}, timer: null, settled: false,
    };
    // Everybody hears about it, including the phones not playing: a spectator
    // watching a blank board for thirty seconds has no idea the game is even
    // happening. The scene carries who is playing so a spectator can be shown
    // that rather than a playfield.
    Scenes.emit('soloGame', { game: type, seed, seats: seats.slice() });
    _armGrace(ROUND_CAP_MS);
    // The host is a player too, and plays it the same way everybody else does.
    playLocally(type, seed, seats);
}

/** Host: a score arrived from `seat`. */
export function hostScore(seat, score) {
    if (!_round || _round.settled) return;
    if (!_round.seats.includes(seat)) return;
    if (_round.scores[seat] !== undefined) return;   // first answer counts
    _round.scores[seat] = Number(score) || 0;
    // Everybody in: no reason to wait out the clock.
    if (_round.seats.every(s => _round.scores[s] !== undefined)) { _settle(); return; }
    // Somebody is in, so the rest have a bounded time to follow.
    _armGrace(GRACE_MS);
}

function _armGrace(ms) {
    if (!_round) return;
    if (_round.timer) clearTimeout(_round.timer);
    _round.timer = setTimeout(() => _settle(), ms);
}

function _settle() {
    const r = _round;
    if (!r || r.settled) return;
    r.settled = true;
    if (r.timer) clearTimeout(r.timer);
    _round = null;

    // A seat that never answered scores zero — which is what not playing is
    // worth, and keeps the round finishable whatever any one phone is doing.
    const table = r.seats.map(seat => ({ seat, score: r.scores[seat] === undefined ? 0 : r.scores[seat] }));
    const best = Math.max(...table.map(t => t.score));
    const tied = table.filter(t => t.score === best);
    // A tie goes to the lowest seat rather than to a coin flip. Every device
    // has the same table in front of it, so the result has to be something they
    // can all agree on by looking at it.
    const winner = tied.sort((a, b) => a.seat - b.seat)[0].seat;

    Scenes.emit('soloResult', {
        game: r.type,
        table: table.map(t => ({ seat: t.seat, score: t.score, name: state.players[t.seat]?.name || `Player ${t.seat + 1}` })),
        winner,
        tied: tied.length > 1,
    });
    if (r.done) r.done(winner, table);
}

/** Drop a round in progress — a match ending mid-game, a host leaving. */
export function abort() {
    if (_round && _round.timer) clearTimeout(_round.timer);
    _round = null;
    _localSeats = [];
    SoloArena.reset();
}

// ── Every device ────────────────────────────────────────────────────────────

/**
 * Play the announced game, if this device is one of the ones playing.
 *
 * A device that is NOT playing does not run the game at all — it has nothing to
 * score and no business burning a phone's battery on somebody else's round. The
 * UI shows it who is playing instead.
 */
export function playLocally(type, seed, seats) {
    _localSeats = Array.isArray(seats) ? seats.slice() : [];
    const me = state.localSeat;
    if (!_localSeats.includes(me)) return false;
    SoloArena.play(type, seed, score => {
        SoloArena.reset();
        report(me, score);
    }, ROUND_CAP_MS);
    return true;
}

/** Send a score to whoever is counting — which on the host is itself. */
function report(seat, score) {
    if (Session.isHost()) { hostScore(seat, score); return; }
    Session.sendIntent('mgScore', [seat, Math.round(score)]);
}

/** Who is playing the beat this device last heard about. */
export function playingSeats() { return _localSeats.slice(); }

/** The title of a game, for the cards built around it. */
export function titleOf(type) { return (MG_INFO[type] && MG_INFO[type].title) || 'MINIGAME'; }
