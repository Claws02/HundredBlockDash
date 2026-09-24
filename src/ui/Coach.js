// ============================================================
// COACH — the first match teaches itself (RELEASE_AUDIT UX-03).
// ============================================================
//
// First launch used to open a seven-slide How to Play wall before anyone had
// seen the board: teaching by reading. Now the first match coaches the three
// things a first turn asks of you, on the real controls, one line each:
//
//   1. ROLL        — your turn: tap ROLL (or swipe up)
//   2. the fork    — pick a road at a junction (whenever the first one comes)
//   3. the result  — every space does something; tap the board to look
//
// It never blocks: the bubble and the ring around the control ignore touches,
// so the game plays exactly as it would without it. It watches the game rather
// than being called from it, so no turn code knows it exists. Local matches
// only, human turns only, and once per install. How to Play stays in the menus
// as the reference.
// ============================================================

import { state } from '../core/GameState.js';
import * as Storage from '../core/Storage.js';

const KEY = 'coached';
const STEPS = {
    roll:     { text: 'Your turn! Tap <b>ROLL</b> — or swipe up — to throw the die.',
                target: () => [...document.querySelectorAll('#p1-actions button, #p2-actions button')].find(b => /roll/i.test(b.innerText) && _shown(b)) },
    junction: { text: 'A fork! Each road says what is on it. A <b>district</b> is the long way round, with its own HQ payout; the <b>ring</b> is the short lap.',
                // Anchored on the game's own junction line at the foot of the
                // screen, so the bubble never sits over one of the roads.
                target: () => {
                    const b = document.querySelector('#junction-arrows button');
                    if (!_shown(b)) return null;
                    const low = document.getElementById('junction-primer');
                    return _shown(low) ? low : b;
                } },
    result:   { text: 'Every space does something — this one just did. <b>Tap any space</b> on the board later to see what it does.',
                target: () => { const b = document.getElementById('btn-msg-continue'); return _shown(b) ? b : null; },
                below: true },   // under the card, never over what it says
};

let _done = new Set();
let _el = null, _ring = null, _timer = null, _current = null, _humanTurns = 0, _lastTurn = -1, _since = 0;

function _shown(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.offsetParent !== null;
}

export function isFinished() { return !!Storage.load(KEY, false); }

/** Start watching for the first match. Harmless when coaching is finished. */
export function init() {
    if (isFinished() || _timer) return;
    _done = new Set(Storage.load('coached_steps', []) || []);
    _el = document.createElement('div');
    _el.id = 'coach';
    _el.setAttribute('role', 'status');
    _el.setAttribute('aria-live', 'polite');
    _ring = document.createElement('div');
    _ring.id = 'coach-ring';
    document.body.append(_ring, _el);
    _timer = setInterval(_tick, 250);
}

function _eligible() {
    if (!state.gameStarted || state.mgActive) return false;
    if (state.playStyle === 'online' || typeof state.localSeat === 'number' || state.netReplica) return false;
    const p = state.players[state.activePlayer];
    return !!p && !p.isBot;
}

function _tick() {
    if (!_eligible()) { _hide(); return; }
    if (state.totalTurns !== _lastTurn) { _lastTurn = state.totalTurns; _humanTurns++; }

    // Whichever step's control is on screen now, in teaching order.
    let step = null;
    for (const k of ['roll', 'junction', 'result']) {
        if (_done.has(k)) continue;
        if (k === 'roll' && state.gameState !== 'PRE_ROLL') continue;
        const t = STEPS[k].target();
        if (t) { step = k; _show(k, t); break; }
    }
    // A step is learned once its line has been up long enough to read and its
    // control has gone away. One that flashed past (a prompt covered it within
    // a tick) comes back next time instead of counting.
    if (_current && _current !== step) {
        if (performance.now() - _since >= 1200) {
            _done.add(_current);
            Storage.save('coached_steps', [..._done]);
        }
    }
    if (step !== _current) _since = performance.now();
    _current = step;
    if (!step) _hide();

    // Finished: all three seen, or the fork never came within four turns of
    // the other two (some routes reach it late) — it will not be missed much.
    // A player who has had a dozen turns has learned the game whatever the
    // coach managed to show; it bows out rather than nag.
    if ((_done.has('roll') && _done.has('result') && (_done.has('junction') || _humanTurns > 8)) || _humanTurns > 12) _finish();
}

function _show(k, target) {
    const r = target.getBoundingClientRect();
    if (_el.dataset.step !== k) {
        _el.innerHTML = STEPS[k].text;
        _el.dataset.step = k;
    }
    _el.style.display = 'block';
    _ring.style.display = 'block';
    const pad = 6;
    Object.assign(_ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // Above the control when there is room, otherwise below; kept on screen.
    const w = Math.min(300, window.innerWidth - 24);
    _el.style.width = `${w}px`;
    const h = _el.offsetHeight || 70;
    let top = r.top - h - 14;
    const below = (STEPS[k].below && r.bottom + h + 26 < window.innerHeight) || top < 60;
    if (below) top = r.bottom + 14;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    _el.classList.toggle('below', below);
    Object.assign(_el.style, { left: `${left}px`, top: `${Math.max(12, Math.min(window.innerHeight - h - 12, top))}px` });
    _el.style.setProperty('--tip', `${Math.max(16, Math.min(w - 16, r.left + r.width / 2 - left))}px`);
}

function _hide() {
    if (_el) { _el.style.display = 'none'; _el.dataset.step = ''; }
    if (_ring) _ring.style.display = 'none';
}

function _finish() {
    Storage.save(KEY, true);
    clearInterval(_timer); _timer = null;
    _el && _el.remove(); _ring && _ring.remove();
    _el = _ring = null;
}

/** QA and "replay the tutorial": forget that coaching happened. */
export function reset() {
    Storage.save(KEY, false);
    Storage.save('coached_steps', []);
    _done = new Set(); _humanTurns = 0; _lastTurn = -1; _current = null;
    init();
}
