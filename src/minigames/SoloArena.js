// ============================================================
// SOLO ARENA — one minigame, one player, one score
// ============================================================
// The offline minigames are two people sharing a screen: bottom half P1, top
// half P2, both simulated in the same browser. Four people each holding their
// own phone need something else, and for the games tagged 'parallel' in the
// registry that something is much simpler than netcode.
//
// Those games never let one half touch the other. They are two solitaires
// racing a clock, and the winner is whoever scored more. So across phones each
// device plays the SAME challenge, from the SAME seed, at the same time, alone
// — and the scores are compared. Nothing has to be synchronised while it runs,
// which means no rollback, no interpolation, and no way for one slow phone to
// stall the table.
//
// This module is the harness for that: it puts one game on the screen in solo
// mode, runs it, and hands back a number.
//
// WHAT SOLO MODE MEANS TO A GAME. Exactly two things:
//   • its playfield is the whole screen instead of the bottom half, and
//   • when it is over it reports a SCORE rather than a winner.
// Everything else — the drawing, the input, the difficulty curve — is the game
// that already existed. See `soloHalf()` and `soloFinish()` below, which are the
// only two functions a game has to call to support this.

import { state } from '../core/GameState.js';
import { MG_INFO, MG_NET } from '../config/MinigameRegistry.js';
import { loadMinigame } from './MinigameManager.js';

// ── The seeded random every device shares ───────────────────────────────────
//
// The whole design rests on every phone getting the SAME challenge: the same
// meteors, the same loot, the same grids. Math.random cannot give that, so the
// host picks a seed, sends it with the game, and every device runs this.
//
// mulberry32 — small, fast, and good enough that the sequences do not visibly
// repeat over a 30-second game.
let _rng = Math.random;

export function seedRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The shared random for the game in progress.
 *
 * A parallel game calls this instead of Math.random for anything that has to
 * look the same on every phone — where the next meteor falls, which tile is the
 * odd one. It must NOT be used for anything local and cosmetic (a particle
 * jitter, a screen shake), because burning a different number of draws on one
 * device than another puts the two sequences out of step from then on.
 */
export function rand() { return _rng(); }

// ── Solo mode, as the games see it ──────────────────────────────────────────

let _solo = false;
let _onScore = null;
let _scored = false;

/** True while a game is being played alone for a score rather than 1v1. */
export function isSolo() { return _solo; }

/**
 * The height of ONE player's playfield.
 *
 * Every parallel game computes its geometry from "half the overlay". In solo
 * there is no other half, so the same call returns the whole thing and the game
 * fills the screen without knowing why. This is the single substitution that
 * turns a split-screen game into a full-screen one.
 */
export function soloHalf(overlay) {
    const h = overlay ? overlay.clientHeight : 0;
    return _solo ? h : h / 2;
}

/** Is this pointer event in the local player's half? In solo, all of them are. */
export function soloOwns(pid) { return _solo ? pid === 0 : true; }

/**
 * A parallel game finishes by reporting its own score here instead of naming a
 * winner. Higher is better, always — a game whose natural measure is "lowest
 * time" negates it before reporting, so the comparison never has to ask which
 * way round this particular game runs.
 */
export function soloFinish(score) {
    if (!_solo || _scored) return;
    _scored = true;
    const cb = _onScore; _onScore = null;
    state.mgActive = false;
    if (cb) cb(Number(score) || 0);
}

// ── Running one ─────────────────────────────────────────────────────────────

/**
 * Play `type` alone and call `onScore(number)` when it ends.
 *
 * `deadlineMs` is a floor under the whole thing: a game that throws in its own
 * animation frame would otherwise never report, and one phone that never
 * reports is a table that never moves on. On a timeout the score is whatever
 * the game had banked, which for every parallel game is a real partial score.
 */
export async function play(type, seed, onScore, deadlineMs = 90000) {
    _solo = true;
    _scored = false;
    _rng = seedRandom(seed);
    state.mgActive = true;

    let guard = null;
    let mod = null;
    // One place that ends this, whatever ended it — the game reporting, the win
    // callback firing, a throw, or the watchdog. Anything else and two of those
    // paths race to call back twice.
    const settle = score => {
        if (_scored) return;
        _scored = true;
        _onScore = null;
        if (guard) clearTimeout(guard);
        state.mgActive = false;
        const cb = onScore; onScore = null;
        if (cb) cb(Number(score) || 0);
    };
    // What the game reports through soloFinish() comes back here.
    _onScore = settle;

    try {
        mod = await loadMinigame(type);
    } catch (e) {
        console.error('[solo] could not load', type, e);
        settle(0);
        return;
    }
    if (!mod || typeof mod.start !== 'function' || MG_NET[type] !== 'parallel') {
        console.warn('[solo] not a parallel game:', type);
        settle(0);
        return;
    }
    const banked = () => (typeof mod.soloScore === 'function' ? mod.soloScore() : 0);

    // A floor under the whole thing. A game that throws inside its own
    // animation frame would otherwise never report, and one phone that never
    // reports is a table that never moves on. The banked score is a real
    // partial score for every parallel game, so a timeout is not a zero.
    guard = setTimeout(() => {
        if (_scored) return;
        console.warn('[solo] watchdog fired for', type);
        settle(banked());
    }, deadlineMs);

    try {
        // No bot: the other half does not exist. The win callback is still
        // passed because the shared game code expects one, and a parallel game
        // that reaches it has ended without going through soloFinish — take
        // whatever it banked rather than hanging.
        mod.start(false, () => settle(banked()), 0);
    } catch (e) {
        console.error('[solo] start failed for', type, e);
        settle(0);
    }
}

/** Tear solo mode down. Safe to call when nothing is running. */
export function reset() {
    _solo = false;
    _onScore = null;
    _scored = false;
    _rng = Math.random;
}

/** The label a parallel game shows above its score. */
export function scoreLabel(type) {
    return (MG_INFO[type] && MG_INFO[type].title) || 'SCORE';
}
