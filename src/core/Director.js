// ============================================================
// DIRECTOR — the turn's scene sequencer.
//
// The game used to advance with bare `setTimeout(fn, 300)` calls sprinkled
// through GameController. Nothing stopped two scenes from starting at once, so
// the payoff for landing on a space was routinely cut off by whatever came
// next. The Director fixes that with one rule:
//
//     A beat owns the screen until its floor has elapsed.
//     The next beat cannot start early. It can only start late.
//
// Usage:
//     Director.begin('LAND_RESULT');            // mark when the beat started
//     ...
//     Director.after('LAND_RESULT', continueFn) // fires when the floor is up
//
// `after` measures from the matching `begin`, so any time already spent inside
// the beat (animation, the player reading, a modal waiting for a tap) counts
// toward the floor. A beat that already ran long continues immediately.
//
// `Director.ack()` marks that the player explicitly acknowledged the current
// beat; the remaining floor is then compressed to ACK_SKIP so an eager tapper
// keeps moving without two scenes overlapping.
//
// Every pending continuation is tracked so `Director.reset()` can cancel the
// lot on rematch / main-menu, which the loose setTimeouts could never do.
// ============================================================

import { SCENE, ACK_SKIP } from '../config/SceneTiming.js';

const _beats   = new Map();   // beat name → performance.now() when it began
const _pending = new Set();   // live timer ids
let   _acked   = false;       // player tapped through the current beat

function _floor(name) {
    const v = SCENE[name];
    if (typeof v !== 'number') {
        console.warn(`[Director] unknown beat "${name}" — treating as 0 ms`);
        return 0;
    }
    return v;
}

// Mark the start of a beat. Safe to call repeatedly; the latest call wins.
export function begin(name) {
    _beats.set(name, performance.now());
    _acked = false;
    return name;
}

// True once the named beat has held the screen for its full floor.
export function elapsed(name) {
    const t0 = _beats.get(name);
    return t0 === undefined ? true : (performance.now() - t0) >= _floor(name);
}

// Milliseconds still owed to the named beat (0 if it never began or is done).
export function remaining(name) {
    const t0 = _beats.get(name);
    if (t0 === undefined) return 0;
    const target = _floor(name) * (_acked ? ACK_SKIP : 1);
    return Math.max(0, target - (performance.now() - t0));
}

// Run `fn` once the named beat has had its floor. If the beat already ran long,
// this still defers by a frame so callers never re-enter synchronously.
export function after(name, fn) {
    const wait = remaining(name);
    return _schedule(fn, wait);
}

// Run `fn` after a beat's full floor, ignoring time already spent — for the
// cases where the beat starts *now* and the continuation is known up front.
export function hold(name, fn) {
    begin(name);
    return _schedule(fn, _floor(name));
}

// Plain delay that still participates in reset(). Use when the pause isn't a
// named scene beat (bot think time, staggered reveals).
export function wait(ms, fn) {
    return _schedule(fn, Math.max(0, ms || 0));
}

function _schedule(fn, ms) {
    const id = setTimeout(() => {
        _pending.delete(id);
        try { fn(); } catch (e) { console.error('[Director] beat continuation failed:', e); }
    }, Math.max(0, Math.round(ms)));
    _pending.add(id);
    return id;
}

// The player tapped through — compress what's left of the current floor.
export function ack() { _acked = true; }

export function cancel(id) {
    if (id === undefined || id === null) return;
    clearTimeout(id);
    _pending.delete(id);
}

// Drop every pending continuation. Called on rematch / main menu / game start
// so a stale beat from the previous match can never fire into the new one.
export function reset() {
    _pending.forEach(clearTimeout);
    _pending.clear();
    _beats.clear();
    _acked = false;
}

// Introspection for the QA scene probe.
export function debugState() {
    return { pending: _pending.size, beats: [..._beats.keys()], acked: _acked };
}
