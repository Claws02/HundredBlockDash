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
import * as SoloRound from '../ui/SoloRound.js';
import * as RoundBoard from '../ui/RoundBoard.js';
import { MG_INFO, MG_NET, MG_PARALLEL, MG_PAYOUT } from '../config/MinigameRegistry.js';

// How long the host will keep waiting after the last expected score fails to
// arrive. Long enough for a phone that is merely slow, short enough that the
// table does not sit staring at a scoreboard nobody can dismiss.
const GRACE_MS = 12000;
// A whole round of any parallel game fits inside this comfortably; it is the
// backstop for a device that answered nothing at all.
const ROUND_CAP_MS = 90000;
// How long the scoreboard holds before the board carries on. It is the first
// time anybody sees how they did against the rest, which is the thing that
// makes four solitaires into a round — pulling it away immediately wastes it.
const BOARD_HOLD_MS = 3800;

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
    _startStandings();
    // The host is a player too, and plays it the same way everybody else does.
    playLocally(type, seed, seats);
}

// How often a phone says where it has got to, and how often the host tells
// everybody. Two ticks a second is enough to watch a number move and is two
// orders of magnitude less traffic than the board's own 20 Hz snapshot; a
// missed one costs a frame of a readout and nothing else.
const TICK_MS = 500;
const STAND_MS = 500;
let _tickIv = null;
let _standIv = null;

/**
 * Host: a running score arrived from `seat`.
 *
 * Decides nothing. The round is still settled by `hostScore`, so a tick that
 * never arrives — a phone that is slow, or that has stopped playing — leaves
 * the rail a little stale and the result exactly right.
 */
export function hostTick(seat, score) {
    if (!_round || _round.settled) return;
    if (!_round.seats.includes(seat)) return;
    _round.live = _round.live || {};
    _round.live[seat] = Number(score) || 0;
}

/** Host: start telling the table where everybody is. */
function _startStandings() {
    _stopStandings();
    _standIv = setInterval(() => {
        if (!_round || _round.settled) { _stopStandings(); return; }
        const live = _round.live || {};
        Scenes.emit('soloStand', {
            game: _round.type,
            table: _round.seats.map(seat => ({
                seat,
                // A seat that has finished is shown its FINAL score, not the
                // last tick before it stopped — otherwise somebody who has
                // already put their number up appears to be losing it.
                score: _round.scores[seat] !== undefined ? _round.scores[seat] : (live[seat] || 0),
                done: _round.scores[seat] !== undefined,
            })),
        });
    }, STAND_MS);
}

function _stopStandings() {
    if (_standIv) { clearInterval(_standIv); _standIv = null; }
}

/** Every device: paint the rail from what the host last said. */
export function showStandings(payload) {
    RoundBoard.netRail(payload.game, payload.table || [], state.localSeat);
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
    _stopStandings();
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

    // A payday game pays everybody their own haul, win or lose — that is what
    // makes it a payday game, and dropping it online would quietly turn two of
    // the roster's games into something else. Capped by the registry: the score
    // arrived from a device somebody else is holding.
    const cap = MG_PAYOUT[r.type];
    const paid = [];
    if (cap) {
        table.forEach(t => {
            const coins = Math.max(0, Math.min(Math.round(t.score), cap));
            if (!coins) return;
            const p = state.players[t.seat];
            if (!p) return;
            p.coins += coins; p.coinsEarned += coins;
            paid.push({ seat: t.seat, coins });
        });
    }

    const payload = {
        game: r.type,
        paid,
        table: table.map(t => ({ seat: t.seat, score: t.score, name: state.players[t.seat]?.name || `Player ${t.seat + 1}` })),
        winner,
        tied: tied.length > 1,
    };
    // The announcement reaches the other phones; the host is looking at its own
    // screen and has to be told the same thing directly.
    Scenes.emit('soloResult', payload);
    showResults(payload);
    // The host drives what happens next, and the scoreboard is the last thing
    // this round owns. Clients take theirs down off the host's overlay list
    // (NetProtocol's `ov`), which is how a screen raised on another device is
    // guaranteed to be dismissable there even if this path never runs.
    setTimeout(() => {
        Scenes.emit('soloClose', {});
        clearScreens();
        if (r.done) r.done(winner, table);
    }, BOARD_HOLD_MS);
}

/** Drop a round in progress — a match ending mid-game, a host leaving. */
export function abort() {
    _stopTicking();
    _stopStandings();
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
    const playing = _localSeats.includes(me);

    // The card goes up on every device, including the ones not playing: a phone
    // that goes quiet for thirty seconds with no explanation reads as a crash,
    // and a spectator who cannot see who is playing cannot follow the match.
    SoloRound.showIntro(type, _localSeats, playing, () => {
        SoloArena.play(type, seed, score => {
            _stopTicking();
            SoloArena.reset();
            RoundBoard.hideRail();
            report(me, score);
        }, ROUND_CAP_MS);
        // Say where you have got to while you are getting there. This is the
        // only thing the other three phones can see of you, and without it a
        // parallel round is four people playing alone and comparing notes
        // afterwards.
        _startTicking(me);
    });
    return playing;
}

/** Show the round's scores. Every device runs this off the same announcement. */
export function showResults(payload) {
    // The round is decided. If this device is somehow still playing — it
    // started late, or the host's grace period ran out first — the game has to
    // come off the screen now, or the scoreboard goes up over a running game
    // and the board underneath never comes back.
    // Whatever this device had banked, not a zero: somebody twenty seconds into
    // a good run, cut off because the round was decided elsewhere, did not
    // score nothing.
    SoloArena.forceEnd();
    SoloRound.showResults(payload.game, payload.table, payload.winner, payload.tied, payload.paid);
}

function _startTicking(seat) {
    _stopTicking();
    _tickIv = setInterval(() => {
        if (!SoloArena.isSolo()) { _stopTicking(); return; }
        const n = SoloArena.liveScore();
        if (Session.isHost()) hostTick(seat, n);
        else Session.sendIntent('mgTick', [seat, Math.round(n)]);
    }, TICK_MS);
}

function _stopTicking() {
    if (_tickIv) { clearInterval(_tickIv); _tickIv = null; }
}

/** Take the round's screens down. */
export function clearScreens() {
    _stopTicking();
    _stopStandings();
    RoundBoard.hideRail();
    SoloRound.hide();
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
