// ============================================================
// ROUND FORMAT — how three or four people play ONE minigame
// ============================================================
// Every game in the roster is built for two: two halves of one screen, two
// slots, `_scores = [0, 0]`. Above two seats the round used to pick two of them
// by rotation and the rest watched — which is a correct implementation of a
// rule that should not exist. Half the table sitting out for forty seconds of
// every round is the opposite of a party game.
//
// This module is the answer, and it needs no per-game work at all, because the
// two things a round can be were both already built and tested for other
// reasons:
//
//   RELAY    Everyone plays the SAME challenge, alone, in turn, on the whole
//            screen — then the scores are compared. This is exactly what
//            `SoloArena` already does for online play, from the same seed, with
//            every draw taken by index so the 6th meteor is the 6th meteor on
//            everybody's go. Only the games with no shared playfield can do it
//            (`MG_NET === 'parallel'`), which is the same six the online rounds
//            are made of.
//
//   BRACKET  Everyone is in the draw, and the legs are ordinary 1v1 games. Four
//            seats: two semi-finals and a final. Three: a challenger ladder.
//            Two: one game, exactly as the match has always played.
//
// Between them they cover the whole roster, so "everybody plays every minigame"
// is true at three and four seats without a single game being rewritten.
//
// Which one a round gets is not a preference, it is a fact about the table:
//
//   · a RELAY needs a game with no shared playfield, and needs every seat to be
//     a person — a bot cannot play a solitaire, and inventing a score for it
//     would be inventing the result of the round.
//   · everything else is a BRACKET, where a bot plays a real 1v1 game against a
//     person exactly as it always has.
//
// The one leg nobody can play is bot against bot. It is not played: it is
// decided, on skill, and the bracket card says so. Two bots playing each other
// while the one person in the room watches is the worst screen in the game, and
// the manager could not run it anyway — a minigame is handed one `isBot` flag
// and it describes slot 1.
//
// docs/MINIGAME_RULEBOOK.md §3 is the long version of the two shapes.

import { state } from '../core/GameState.js';
import { MG_NET, MG_INFO, MG_PAYOUT } from '../config/MinigameRegistry.js';
import { MINIGAME_REWARD } from '../config/GameConfig.js';
import * as MinigameManager from './MinigameManager.js';
import * as SoloArena from './SoloArena.js';
import * as RoundBoard from '../ui/RoundBoard.js';
import * as ModalManager from '../ui/ModalManager.js';
import * as Bot from '../core/Bot.js';
import { sfx } from '../engine/AudioManager.js';

// The most a single ROUND may pay in coin-game hauls, per player. Matches the
// MAX_PAYOUT every coin game enforces on itself — the cap is per round, not per
// leg, or a three-leg Memory Match could pay ninety.
const MAX_ROUND_PAYOUT = 30;

// A solo leg's safety net. Longer than the 90 s a shared game gets, because a
// relay leg is one person against a clock with nobody to end it early.
const RELAY_CAP_MS = 90000;

let _round = null;   // the round in progress, or null
// What the last finished round did. The round object itself is cleared the
// moment the board comes back, and "who actually played, and what did they
// score" is worth keeping: the result card reads it, and it is the only way to
// state from outside that every seat took part.
let _last = null;

// ── Which shape a round takes ───────────────────────────────────────────────

/** Can this table play `type` as a relay — everyone at the same challenge? */
export function canRelay(type, seats) {
    if (MG_NET[type] !== 'parallel') return false;
    return seats.every(i => state.players[i] && !state.players[i].isBot);
}

/**
 * The legs a round will be played in, before any of them are played.
 *
 * Exported because the bracket card draws it and the probe asserts on it — a
 * format nobody can see in advance is a format nobody can follow.
 */
export function planFor(type, seats) {
    if (seats.length <= 2) return [{ pair: seats.slice() }];
    if (canRelay(type, seats)) return seats.map(s => ({ solo: s }));
    if (seats.length === 3) {
        // A challenger ladder. Everybody plays; the seat that sits out the
        // first leg meets whoever survives it, which is the only three-way
        // knockout that does not need a bye nobody understands.
        return [{ pair: [seats[0], seats[1]], name: 'OPENER' },
                { pair: [null, seats[2]],     name: 'DECIDER', from: [0] }];
    }
    return [{ pair: [seats[0], seats[1]], name: 'SEMI-FINAL 1' },
            { pair: [seats[2], seats[3]], name: 'SEMI-FINAL 2' },
            { pair: [null, null],         name: 'FINAL', from: [0, 1] }];
}

/** Is `type` played by everybody at once rather than in legs? (Online only.) */
export function isSimultaneous(type) { return MG_NET[type] === 'parallel'; }

// ── Running one ─────────────────────────────────────────────────────────────

/**
 * Play `type` with `seats`, and call `done(winnerSeat)` when the round is over.
 *
 * `opts.award` pays the flat MINIGAME_REWARD to the round's winner, which the
 * round-end contest does and a duel does not (a duel settles its own wager).
 */
export function run(type, seats, done, opts = {}) {
    const relay = canRelay(type, seats) && seats.length > 2;
    // The same frame `trigger()` puts the screen in, because a relay never goes
    // through it. `MinigameManager.endMinigame()` at the end of the round is
    // what puts all three back.
    state.mgType      = type;
    state.gameState   = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    const ui = document.getElementById('ui-layer');
    if (ui) ui.style.display = 'none';
    // `#modal-overlay` is z-200 and `#minigame-layer` is z-100, so a card still
    // up when a round starts sits ON TOP of the game — the round runs, takes
    // input it cannot show, and the player sees a space-info card. The turn
    // flow does not leave one up, but this is a new way into a minigame and the
    // guarantee should not be borrowed from somewhere else.
    ModalManager.closeAllModals();
    _round = {
        type, seats: seats.slice(), done, opts,
        relay,
        legs: planFor(type, seats),
        at: 0,
        scores: {},         // relay: seat → score
        wins: {},           // bracket: seat → legs won
        coins: {},          // seat → coin-game haul this round
        results: [],        // one entry per finished leg, for the card
    };
    seats.forEach(s => { _round.wins[s] = 0; });
    RoundBoard.begin(_round);
    // A bracket's first leg goes through the manager's intro, which is where the
    // rules card lives. A relay does not, so it needs one of its own — nobody
    // should be handed a phone and told to go without being told what the game
    // is. The wording is MG_NET_INFO's: written for somebody playing alone,
    // which is exactly what a relay leg is.
    if (relay) RoundBoard.rules(_round, () => _next());
    else _next();
}

/** Abandon a round in progress — a rematch, or a match ending under it. */
export function abort() {
    if (!_round) return;
    _round = null;
    MinigameManager.endLegMode();
    SoloArena.reset();
    RoundBoard.hide();
}

export function inProgress() { return !!_round; }

/** What the last finished round did — seats, scores, legs, hauls, winner. */
export function lastRound() { return _last; }

function _next() {
    const r = _round;
    if (!r) return;
    if (r.at >= r.legs.length) { _settle(); return; }
    const leg = r.legs[r.at];
    if (leg.solo !== undefined) _runRelayLeg(leg);
    else _runBracketLeg(leg);
}

// ── RELAY ───────────────────────────────────────────────────────────────────

function _runRelayLeg(leg) {
    const r = _round;
    const seat = leg.solo;
    // The seed is the round's, not the leg's: the whole point is that everybody
    // gets the same challenge, so the person who goes fourth is beating the
    // same storm as the person who went first.
    if (!r.seed) r.seed = (Math.random() * 0xffffffff) >>> 0;

    // Hand the phone over, and say what there is to beat. This is the pressure:
    // you do not start your go wondering how you are doing.
    RoundBoard.handoff(r, seat, () => {
        RoundBoard.showRail(r, seat);
        SoloArena.play(r.type, r.seed, score => {
            SoloArena.reset();
            RoundBoard.hideRail();
            r.scores[seat] = Number(score) || 0;
            if (MG_PAYOUT[r.type]) {
                r.coins[seat] = Math.min(MAX_ROUND_PAYOUT, Math.max(0, Math.round(score) || 0));
            }
            r.results.push({ seat, score: r.scores[seat] });
            r.at++;
            _next();
        }, RELAY_CAP_MS);
    });
}

// ── BRACKET ─────────────────────────────────────────────────────────────────

function _runBracketLeg(leg) {
    const r = _round;
    const pair = _resolvePair(leg);
    // A leg both of whose players are bots cannot be played — `isBot` describes
    // one slot — and nobody would want to watch it if it could. Decide it and
    // put the result on the card.
    if (pair.every(i => state.players[i] && state.players[i].isBot)) {
        const winner = _decideBotLeg(pair);
        _bankLeg(leg, pair, winner, {}, true);
        return;
    }
    RoundBoard.nextLeg(r, leg, pair, () => {
        MinigameManager.trigger(res => {
            _bankLeg(leg, pair, res.winner, res.coins || {}, false);
        }, pair, { leg: true, type: r.type, skipIntro: r.at > 0 });
    });
}

// A leg the room is not going to watch. Skill decides it, with enough noise that
// the better bot does not simply always win — the same shape as every other bot
// decision in the game (docs/MINIGAME_STANDARD.md §5).
function _decideBotLeg(pair) {
    const skill = Bot.skill();
    const roll  = () => skill * 0.5 + Math.random();
    return roll() >= roll() ? pair[0] : pair[1];
}

function _bankLeg(leg, pair, winner, coins, simulated) {
    const r = _round;
    if (!r) return;
    leg.pair = pair.slice();
    leg.winner = winner;
    if (winner >= 0) r.wins[winner] = (r.wins[winner] || 0) + 1;
    Object.keys(coins).forEach(k => {
        const seat = Number(k);
        r.coins[seat] = Math.min(MAX_ROUND_PAYOUT, (r.coins[seat] || 0) + coins[k]);
    });
    r.results.push({ pair: pair.slice(), winner, simulated, name: leg.name });
    r.at++;
    if (simulated) { RoundBoard.simulated(r, leg, () => _next()); return; }
    _next();
}

// A leg whose players are "whoever won legs 0 and 1" only knows who they are
// once those legs are done.
function _resolvePair(leg) {
    const r = _round;
    if (!leg.from) return leg.pair.slice();
    const out = leg.pair.slice();
    leg.from.forEach((legIdx, i) => {
        const w = r.legs[legIdx] && r.legs[legIdx].winner;
        out[i] = (typeof w === 'number' && w >= 0) ? w : r.seats[i];
    });
    // A drawn semi-final would otherwise put the same seat on both sides of the
    // final. Fall back to a seat that is not already in it.
    if (out[0] === out[1]) out[1] = r.seats.find(s => s !== out[0]);
    return out;
}

// ── The end of a round ──────────────────────────────────────────────────────

function _settle() {
    const r = _round;
    if (!r) return;
    MinigameManager.endLegMode();

    let winner, table;
    if (r.relay) {
        table = r.seats.map(s => ({ seat: s, score: r.scores[s] || 0,
                                    name: (state.players[s] || {}).name || `P${s + 1}` }));
        const best = Math.max(...table.map(t => t.score));
        // A tie at the top goes to the earlier seat, and the board says so
        // rather than picking silently.
        const top = table.filter(t => t.score === best);
        winner = top[0].seat;
        r.tied = top.length > 1;
    } else {
        // The last leg IS the final; its winner takes the round. Wins are the
        // tiebreak only if the final somehow drew.
        const last = r.legs[r.legs.length - 1];
        winner = (typeof last.winner === 'number' && last.winner >= 0)
            ? last.winner
            : r.seats.slice().sort((a, b) => (r.wins[b] || 0) - (r.wins[a] || 0))[0];
        table = r.seats.map(s => ({ seat: s, score: r.wins[s] || 0,
                                    name: (state.players[s] || {}).name || `P${s + 1}` }));
    }

    // Coin hauls first — everybody keeps what they earned, whoever won.
    Object.keys(r.coins).forEach(k => {
        const p = state.players[Number(k)];
        const n = r.coins[k];
        if (p && n > 0) { p.coins += n; p.coinsEarned += n; }
    });
    if (Object.keys(r.coins).length) sfx('coin_gain');

    // Then the round's own reward, once, to the one winner.
    const champ = state.players[winner];
    if (champ) {
        champ.mgWins++;
        if (r.opts.award !== false) {
            champ.coins += MINIGAME_REWARD;
            champ.coinsEarned += MINIGAME_REWARD;
        }
    }
    import('../ui/UIManager.js').then(({ animateCoinDisplay, updateUI }) => {
        state.players.forEach((p, i) => animateCoinDisplay(i, p.coins));
        updateUI();
    });

    _last = {
        type: r.type, relay: r.relay, seats: r.seats.slice(), winner,
        scores: { ...r.scores }, wins: { ...r.wins }, coins: { ...r.coins },
        results: r.results.slice(), tied: !!r.tied,
    };

    RoundBoard.finish(r, winner, table, () => {
        const done = r.done;
        _round = null;
        RoundBoard.hide();
        MinigameManager.endMinigame(winner);
        if (done) done(winner);
    });
}

/** The title of the game a round is playing, for the cards around it. */
export function titleOf(type) { return (MG_INFO[type] && MG_INFO[type].title) || 'MINIGAME'; }
