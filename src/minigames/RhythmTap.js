// Guitar Hero-style rhythm game. Beats fall down a lane; tap when beat reaches the hit ring.
// Pass-and-play: P1 plays 15s, then P2 plays 15s. 3 rounds, points accumulate. Most pts wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_ROUNDS  = 3;
const TURN_MS     = 15000;
const TRAVEL_MS   = 1300;    // time for a beat to travel from spawn to hit zone
const PERFECT_MS  = 65;
const GOOD_MS     = 160;
const OK_MS       = 320;
const BEATS_PER_ROUND = [8, 12, 16]; // round 1, 2, 3

let _done = false, _round = 0, _scores = [0, 0], _onWin = null, _isBot = false;
let _overlay = null, _laneEl = null, _hitEl = null, _timerBarEl = null;
let _neutralEl = null, _scoreEls = [null, null];
let _hitCenterY = 0, _animFrame = null;
let _beats = [], _nextBeatIdx = 0, _turnStart = 0, _currentPlayer = 0;
let _beatCount = 0; // beats scheduled this turn
const _cleanups = [];

// ── DOM build ─────────────────────────────────────────────────────────────────
function _buildOverlay() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    const mg = document.getElementById('minigame-layer');

    _overlay = document.createElement('div');
    _overlay.id = 'rt-overlay';
    _overlay.style.cssText = `
        position:absolute; inset:0; display:flex; flex-direction:column;
        align-items:center; justify-content:flex-start; padding:12px 0 0;
        box-sizing:border-box; overflow:hidden;
    `;

    // Timer bar
    _timerBarEl = document.createElement('div');
    _timerBarEl.style.cssText = `
        width:90%; height:10px; border-radius:6px;
        background:#333; margin-bottom:10px; overflow:hidden;
    `;
    const timerFill = document.createElement('div');
    timerFill.id = 'rt-timer-fill';
    timerFill.style.cssText = `
        width:100%; height:100%; border-radius:6px;
        background:#4ade80; transition:none;
    `;
    _timerBarEl.appendChild(timerFill);

    // Score display
    const scoreRow = document.createElement('div');
    scoreRow.style.cssText = `
        display:flex; width:90%; justify-content:space-between;
        margin-bottom:8px;
    `;
    _scoreEls[0] = document.createElement('div');
    _scoreEls[0].style.cssText = 'font-size:1.1rem; font-weight:700; color:#fff; font-family:inherit;';
    _scoreEls[0].textContent = 'P1: 0';
    _scoreEls[1] = document.createElement('div');
    _scoreEls[1].style.cssText = 'font-size:1.1rem; font-weight:700; color:#fff; font-family:inherit;';
    _scoreEls[1].textContent = 'P2: 0';
    scoreRow.appendChild(_scoreEls[0]);
    scoreRow.appendChild(_scoreEls[1]);

    // Lane
    _laneEl = document.createElement('div');
    _laneEl.id = 'rt-lane';
    _laneEl.style.cssText = `
        position:relative; width:120px; flex:1;
        background:rgba(255,255,255,0.06); border-radius:12px;
        overflow:hidden; margin-bottom:8px;
    `;

    // Hit ring (target zone at bottom of lane)
    _hitEl = document.createElement('div');
    _hitEl.id = 'rt-hit';
    _hitEl.style.cssText = `
        position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
        width:64px; height:64px; border-radius:50%;
        border:4px solid rgba(255,255,255,0.6);
        box-sizing:border-box; pointer-events:none; z-index:5;
    `;
    _laneEl.appendChild(_hitEl);

    // Tap target (covers full lane for easy tapping)
    const tapZone = document.createElement('div');
    tapZone.id = 'rt-tap-zone';
    tapZone.style.cssText = `
        position:absolute; inset:0; z-index:10; cursor:pointer;
    `;
    const onTap = e => {
        e.preventDefault();
        _handleTap();
    };
    tapZone.addEventListener('pointerdown', onTap);
    _cleanups.push(() => tapZone.removeEventListener('pointerdown', onTap));
    _laneEl.appendChild(tapZone);

    // Instruction label
    const tapLabel = document.createElement('div');
    tapLabel.style.cssText = `
        font-size:0.8rem; color:rgba(255,255,255,0.5);
        margin-bottom:6px; letter-spacing:0.05em;
    `;
    tapLabel.textContent = 'TAP THE LANE!';

    _overlay.appendChild(_timerBarEl);
    _overlay.appendChild(scoreRow);
    _overlay.appendChild(_laneEl);
    _overlay.appendChild(tapLabel);
    mg.appendChild(_overlay);
}

function _destroyOverlay() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _laneEl = null; _hitEl = null; _timerBarEl = null;
    _scoreEls = [null, null];
}

// ── Public entry point ────────────────────────────────────────────────────────
export function start(isBot, onWin) {
    if (!state.mgActive) return;
    cancelAnimationFrame(_animFrame); _animFrame = null;
    _done = false; _round = 0; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _currentPlayer = 0;

    // Hide stock rhythm elements
    [1, 2].forEach(pi => {
        const z = document.getElementById(`rhythm-zone-${pi}`);
        const s = document.getElementById(`rhythm-score-${pi}`);
        if (z) z.style.display = 'none';
        if (s) s.style.display = 'none';
    });

    _neutralEl = document.getElementById('mg-neutral');
    _neutralEl.textContent = 'GET READY!';

    _buildOverlay();

    // Measure hit ring center after DOM renders
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!_laneEl || !_hitEl) return;
        const laneRect = _laneEl.getBoundingClientRect();
        const hitRect  = _hitEl.getBoundingClientRect();
        _hitCenterY = hitRect.top - laneRect.top + hitRect.height / 2;
        _startTurn();
    }));
}

// ── Turn flow ─────────────────────────────────────────────────────────────────
function _startTurn() {
    if (!state.mgActive || _done) return;
    if (_currentPlayer === 0 && _round >= MAX_ROUNDS) { _endGame(); return; }

    const pid = _currentPlayer;
    const bg  = pid === 0 ? 'linear-gradient(160deg,#7f1d1d,#450a0a)' : 'linear-gradient(160deg,#1e3a5f,#0c1a2e)';
    document.getElementById('minigame-layer').style.background = bg;

    _scoreEls[0].style.color = pid === 0 ? '#fde68a' : '#fff';
    _scoreEls[1].style.color = pid === 1 ? '#fde68a' : '#fff';

    // Clear old beat elements
    if (_laneEl) {
        [..._laneEl.querySelectorAll('.rt-beat')].forEach(el => el.remove());
    }

    _beats = [];
    _nextBeatIdx = 0;
    const count = BEATS_PER_ROUND[_round];
    _beatCount = count;

    // Space beats evenly over the turn, leaving travel time buffer at start/end
    const spacing = (TURN_MS - TRAVEL_MS * 2) / (count - 1 || 1);
    for (let i = 0; i < count; i++) {
        _beats.push({
            timeMs: TRAVEL_MS + i * spacing,
            scored: false,
            el: null,
            id: i,
        });
    }

    const roundLabel = `ROUND ${_round + 1}/${MAX_ROUNDS}`;
    const playerLabel = `P${pid + 1} — ${roundLabel}`;
    if (_neutralEl) _neutralEl.textContent = playerLabel;

    _turnStart = performance.now();
    _runTurn();
}

function _runTurn() {
    const fill = document.getElementById('rt-timer-fill');

    const tick = now => {
        if (_done || !state.mgActive) return;
        const elapsed = now - _turnStart;
        const progress = Math.max(0, 1 - elapsed / TURN_MS);

        if (fill) {
            fill.style.width = `${progress * 100}%`;
            fill.style.background = progress > 0.4 ? '#4ade80' : progress > 0.2 ? '#fbbf24' : '#ef4444';
        }

        // Spawn new beats
        while (_nextBeatIdx < _beats.length) {
            const beat = _beats[_nextBeatIdx];
            const spawnAt = beat.timeMs - TRAVEL_MS;
            if (elapsed >= spawnAt) {
                _spawnBeat(beat);
                _nextBeatIdx++;
            } else { break; }
        }

        // Update existing beat positions
        if (_laneEl) {
            const laneH = _laneEl.clientHeight;
            _beats.forEach(beat => {
                if (!beat.el || beat.scored) return;
                const beatElapsed = elapsed - (beat.timeMs - TRAVEL_MS);
                const prog = Math.max(0, Math.min(1, beatElapsed / TRAVEL_MS));
                // Travel from top (-32px) to hit center
                const y = -32 + prog * (_hitCenterY + 32);
                beat.el.style.top = `${y - 32}px`; // center the 64px element
            });
        }

        // Flash hit ring if beat is very close
        if (_hitEl) {
            let nearest = Infinity;
            _beats.forEach(b => {
                if (b.scored) return;
                const diff = Math.abs(elapsed - b.timeMs);
                if (diff < nearest) nearest = diff;
            });
            if (nearest <= PERFECT_MS) {
                _hitEl.style.borderColor = '#4ade80';
                _hitEl.style.boxShadow = '0 0 18px rgba(74,222,128,0.8)';
            } else if (nearest <= GOOD_MS) {
                _hitEl.style.borderColor = '#fbbf24';
                _hitEl.style.boxShadow = '0 0 10px rgba(251,191,36,0.5)';
            } else {
                _hitEl.style.borderColor = 'rgba(255,255,255,0.6)';
                _hitEl.style.boxShadow = 'none';
            }
        }

        if (elapsed >= TURN_MS) {
            _endTurn();
            return;
        }
        _animFrame = requestAnimationFrame(tick);
    };
    _animFrame = requestAnimationFrame(tick);
}

function _spawnBeat(beat) {
    if (!_laneEl) return;
    const el = document.createElement('div');
    el.className = 'rt-beat';
    el.style.cssText = `
        position:absolute; left:50%; transform:translateX(-50%);
        width:56px; height:56px; border-radius:50%;
        background:radial-gradient(circle, #ffffff 0%, #a78bfa 60%, #6d28d9 100%);
        box-shadow:0 0 14px rgba(167,139,250,0.8);
        pointer-events:none; top:-64px; z-index:3;
        transition:opacity 0.15s;
    `;
    beat.el = el;
    _laneEl.appendChild(el);
}

function _handleTap() {
    if (_done || !state.mgActive) return;
    const elapsed = performance.now() - _turnStart;

    // Pulse the hit ring
    if (_hitEl) {
        _hitEl.style.transform = 'translateX(-50%) scale(1.2)';
        setTimeout(() => { if (_hitEl) _hitEl.style.transform = 'translateX(-50%) scale(1)'; }, 80);
    }

    // Find the closest unscored beat within OK_MS
    let best = null, bestDiff = Infinity;
    _beats.forEach(beat => {
        if (beat.scored) return;
        const diff = Math.abs(elapsed - beat.timeMs);
        if (diff < OK_MS && diff < bestDiff) { bestDiff = diff; best = beat; }
    });

    if (!best) {
        sfx('land_bad');
        return;
    }

    best.scored = true;
    let pts = 0, label = '';
    if (bestDiff <= PERFECT_MS)     { pts = 100; label = 'PERFECT!'; sfx('land_good'); }
    else if (bestDiff <= GOOD_MS)   { pts =  60; label = 'GOOD';     sfx('land_good'); }
    else                            { pts =  30; label = 'OK';       sfx('coin_gain'); }

    _scores[_currentPlayer] += pts;
    _scoreEls[_currentPlayer].textContent = `P${_currentPlayer + 1}: ${_scores[_currentPlayer]}`;

    // Shrink beat on hit
    if (best.el) {
        best.el.style.opacity = '0';
        best.el.style.transform = 'translateX(-50%) scale(1.5)';
        setTimeout(() => { if (best.el) best.el.remove(); }, 150);
        best.el = null;
    }

    // Brief label flash on neutral
    if (_neutralEl) {
        const saved = _neutralEl.textContent;
        _neutralEl.textContent = label;
        setTimeout(() => { if (_neutralEl && !_done) _neutralEl.textContent = saved; }, 300);
    }
}

function _endTurn() {
    cancelAnimationFrame(_animFrame); _animFrame = null;
    if (_done) return;

    const pid = _currentPlayer;
    _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;

    if (pid === 0) {
        // Switch to P2
        _currentPlayer = 1;
        if (_isBot) {
            // Bot: synthetic score ~70% accuracy
            const count = BEATS_PER_ROUND[_round];
            const botPts = Math.round(count * 0.70 * 60 + (Math.random() - 0.5) * count * 20);
            _scores[1] += Math.max(0, botPts);
            _scoreEls[1].textContent = `P2: ${_scores[1]}`;
            _round++;
            if (_round >= MAX_ROUNDS) { setTimeout(_endGame, 600); return; }
            _currentPlayer = 0;
            setTimeout(_startTurn, 600);
        } else {
            _showPassScreen(() => {
                _startTurn();
            });
        }
    } else {
        // Both players done this round
        _round++;
        _currentPlayer = 0;
        if (_round >= MAX_ROUNDS) {
            setTimeout(_endGame, 600);
        } else {
            if (_isBot) {
                setTimeout(_startTurn, 600);
            } else {
                _showPassScreen(() => _startTurn());
            }
        }
    }
}

function _showPassScreen(cb) {
    const mg = document.getElementById('minigame-layer');
    const pass = document.createElement('div');
    pass.style.cssText = `
        position:absolute; inset:0; background:rgba(0,0,0,0.82);
        display:flex; flex-direction:column; align-items:center;
        justify-content:center; z-index:50; cursor:pointer;
    `;
    const msg = document.createElement('div');
    msg.style.cssText = `
        font-size:1.6rem; font-weight:900; color:#fff;
        letter-spacing:0.08em; text-align:center; line-height:1.4;
        font-family:inherit;
    `;
    msg.innerHTML = `📱 PASS THE PHONE<br><span style="font-size:1rem;opacity:0.7;">TAP TO CONTINUE</span>`;
    pass.appendChild(msg);

    if (_neutralEl) _neutralEl.textContent = 'PASS THE PHONE!';

    const autoTimeout = setTimeout(() => {
        if (pass.parentNode) { pass.remove(); cb(); }
    }, 15000);
    const onClick = e => {
        e.preventDefault();
        clearTimeout(autoTimeout);
        pass.removeEventListener('pointerdown', onClick);
        pass.remove();
        cb();
    };
    pass.addEventListener('pointerdown', onClick);
    mg.appendChild(pass);
}

function _endGame() {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_animFrame); _animFrame = null;

    document.getElementById('minigame-layer').style.background = '';
    if (_neutralEl) {
        _neutralEl.textContent = `FINAL — P1: ${_scores[0]}  P2: ${_scores[1]}`;
    }

    const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
    setTimeout(() => {
        _destroyOverlay();
        // Restore stock rhythm elements
        [1, 2].forEach(pi => {
            const z = document.getElementById(`rhythm-zone-${pi}`);
            if (z) z.style.display = '';
        });
        if (_onWin) _onWin(winner);
    }, 1200);
}
