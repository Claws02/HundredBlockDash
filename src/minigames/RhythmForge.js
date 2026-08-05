// Rhythm Forge — Tap the correct lane as notes reach the hit zone. 3 rounds, alternating turns.
// P1 plays first (bottom-up), P2 plays second (board rotates 180°). Most points wins.
//
// ⚠️  SPEED / FRAME-RATE RULE (apply to every minigame):
//   All movement values must be expressed as units-per-SECOND, not units-per-frame.
//   Multiply every position delta by `dt` (elapsed seconds since last frame).
//   Compute dt at the top of the game loop:
//     const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
//     _lastTick = now;
//   Cap dt at 0.1 s so a tab-switch never causes a huge jump.
//   This keeps speed identical on 60 Hz phones, 120 Hz tablets, and desktop browsers.
//
// NOTE: Note positions are driven by (performance.now() - turnStart) elapsed time,
// so they are inherently frame-rate independent. No Three.js used — static CSS bg.
import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const TRAVEL_MS = 1200; // ms a note takes to fall from spawn to hit zone

// Each entry: { t: ms-from-turn-start, l: lane 0/1/2 }
const SEQUENCES = [
    // Round 1 — 10 notes (easy)
    [
        { t:1500,l:1 },{ t:1900,l:0 },{ t:2300,l:2 },{ t:2700,l:1 },{ t:3100,l:0 },
        { t:3500,l:2 },{ t:3900,l:1 },{ t:4300,l:0 },{ t:4700,l:2 },{ t:5100,l:1 },
    ],
    // Round 2 — 20 notes (medium, some doubles)
    [
        { t:1500,l:0 },{ t:1750,l:2 },{ t:2000,l:1 },{ t:2250,l:0 },{ t:2500,l:2 },{ t:2500,l:1 },
        { t:2750,l:0 },{ t:3000,l:2 },{ t:3250,l:1 },{ t:3500,l:0 },{ t:3500,l:2 },{ t:3750,l:1 },
        { t:4000,l:0 },{ t:4250,l:2 },{ t:4500,l:1 },{ t:4500,l:0 },{ t:4750,l:2 },{ t:5000,l:1 },
        { t:5250,l:0 },{ t:5500,l:2 },
    ],
    // Round 3 — 30 notes (hard, frequent doubles)
    [
        { t:1500,l:1 },{ t:1500,l:2 },{ t:1700,l:0 },{ t:1900,l:1 },{ t:2100,l:0 },{ t:2100,l:2 },
        { t:2300,l:1 },{ t:2500,l:0 },{ t:2700,l:1 },{ t:2700,l:2 },{ t:2900,l:0 },{ t:3100,l:1 },
        { t:3300,l:0 },{ t:3300,l:2 },{ t:3500,l:1 },{ t:3700,l:2 },{ t:3900,l:0 },{ t:3900,l:1 },
        { t:4100,l:2 },{ t:4300,l:0 },{ t:4500,l:1 },{ t:4500,l:2 },{ t:4700,l:0 },{ t:4900,l:1 },
        { t:5100,l:0 },{ t:5100,l:2 },{ t:5300,l:1 },{ t:5500,l:2 },{ t:5700,l:0 },{ t:5900,l:1 },
    ],
];

// ── Module state ──────────────────────────────────────────────────────────────

let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null;
let _gameBoard = null, _lanes = [], _laneTargets = [], _indicator = null;
let _p1ScoreEl = null, _p2ScoreEl = null;
let _scores = [0, 0], _activePlayer = 0, _currentRound = 0;
let _beats = [], _turnStart = 0, _transitioning = false;
let _turnTag = null;
let _animId = null, _lastTick = 0;
const _cleanups = [];
const _timers   = [];

// Safe timer: tracked so cleanup can cancel, but does NOT guard on _done
// (use _safeAfter for between-turn logic that must fire even after _done is set)
function _after(fn, ms) {
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        if (state.mgActive) fn();
    }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    registerMinigameCleanup(_destroy);
    _scores = [0, 0]; _activePlayer = 0; _currentRound = 0;
    _beats = []; _turnStart = 0; _lastTick = 0; _transitioning = false;
    _turnTag = null;
    _lanes = []; _laneTargets = [];

    _buildDOM();
    sfx('mg_start');
    _showIndicator('ROUND 1 — P1 GET READY!', false);
    _after(() => _startTurn(0), 3000);
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _buildDOM() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = [
        'position:absolute;inset:0;overflow:hidden;touch-action:none;',
        // Static neon-grid background — no animation, no Three.js
        'background:',
        'repeating-linear-gradient(0deg,transparent,transparent 49px,rgba(102,252,241,0.05) 50px),',
        'repeating-linear-gradient(90deg,transparent,transparent 49px,rgba(102,252,241,0.05) 50px),',
        'linear-gradient(160deg,#060a14 0%,#0a0d1f 50%,#060a14 100%);',
        'font-family:sans-serif;color:#fff;',
    ].join('');

    const style = document.createElement('style');
    style.textContent = `
        .rf-board { position:absolute;inset:0;display:flex;transition:transform .5s cubic-bezier(.4,0,.2,1); }
        .rf-lane  { flex:1;position:relative;border-right:1px solid rgba(102,252,241,.1); }
        .rf-lane:last-child { border-right:none; }
        .rf-hit-zone {
            position:absolute;top:85%;width:100%;height:70px;margin-top:-35px;
            border-top:2px solid rgba(197,198,199,.3);border-bottom:2px solid rgba(197,198,199,.3);
            display:flex;pointer-events:none;z-index:10;
        }
        .rf-target { flex:1;height:100%;transition:background .1s,box-shadow .1s; }
        .rf-note {
            position:absolute;width:68%;left:16%;height:28px;margin-top:-14px;
            background:#66fcf1;border-radius:14px;box-shadow:0 0 16px #66fcf1,0 0 4px #fff;
            pointer-events:none;z-index:5;
        }
        /* Scoreboards live OUTSIDE .rf-board on purpose. They used to be children
           of it, so the 180° board flip on Player 2's turn carried them along —
           P1's score physically travelled to P2's edge and vice versa, which
           read as the scores swapping owners every turn. Pinned to the overlay,
           each one stays on its own player's edge for the whole game. */
        .rf-score {
            position:absolute;font-size:44px;font-weight:900;
            text-shadow:0 0 12px #45a29e;pointer-events:none;z-index:20;
            transition:opacity .35s,color .35s,text-shadow .35s;
            display:flex;flex-direction:column;align-items:center;gap:2px;line-height:1;
        }
        .rf-score .rf-who {
            font-size:12px;font-weight:800;letter-spacing:2px;opacity:.85;
            font-family:'Nunito',system-ui,sans-serif;text-shadow:none;
        }
        .rf-score.rf-idle { opacity:.34; color:#9fb0c0; text-shadow:none; }
        .rf-score.rf-live { opacity:1; }
        .rf-turn-tag {
            position:absolute;font-family:'Nunito',system-ui,sans-serif;
            font-size:12px;font-weight:900;letter-spacing:2px;z-index:21;
            padding:4px 10px;border-radius:8px;pointer-events:none;
            transition:opacity .3s;
        }
        .rf-indicator {
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(.85);
            z-index:50;font-size:26px;font-weight:bold;text-align:center;white-space:pre-line;
            background:rgba(6,10,20,.97);padding:20px 38px;border-radius:14px;
            opacity:0;transition:opacity .3s,transform .3s;pointer-events:none;
            color:#66fcf1;border:2px solid #66fcf1;text-transform:uppercase;letter-spacing:2px;
        }
        @keyframes rf-float {
            0%   { opacity:1;transform:translateY(0) scale(1); }
            100% { opacity:0;transform:translateY(-55px) scale(1.3); }
        }
        .rf-float {
            position:absolute;top:68%;width:100%;text-align:center;font-size:32px;
            font-weight:bold;pointer-events:none;z-index:30;
            animation:rf-float .6s ease-out forwards;text-shadow:0 0 8px currentColor;
        }
        /* Subtle lane pulse columns */
        .rf-lane:nth-child(1) { background:rgba(102,252,241,0.02); }
        .rf-lane:nth-child(3) { background:rgba(102,252,241,0.02); }
    `;
    _overlay.appendChild(style);

    _gameBoard = document.createElement('div');
    _gameBoard.className = 'rf-board';

    const hitZone = document.createElement('div');
    hitZone.className = 'rf-hit-zone';

    for (let i = 0; i < 3; i++) {
        const lane = document.createElement('div');
        lane.className = 'rf-lane';
        _lanes.push(lane);
        _gameBoard.appendChild(lane);

        const tgt = document.createElement('div');
        tgt.className = 'rf-target';
        _laneTargets.push(tgt);
        hitZone.appendChild(tgt);
    }
    _gameBoard.appendChild(hitZone);

    _overlay.appendChild(_gameBoard);

    // Each player's score is pinned to their own edge of the phone and never
    // moves. The one whose turn it is lights up; the other dims.
    _p1ScoreEl = document.createElement('div');
    _p1ScoreEl.className = 'rf-score';
    _p1ScoreEl.style.cssText += 'bottom:22px;left:22px;color:#ff6b6b;';
    _p1ScoreEl.innerHTML = '<span class="rf-val">0</span><span class="rf-who">P1</span>';

    _p2ScoreEl = document.createElement('div');
    _p2ScoreEl.className = 'rf-score';
    _p2ScoreEl.style.cssText += 'top:22px;right:22px;transform:rotate(180deg);color:#6ba7ff;';
    _p2ScoreEl.innerHTML = '<span class="rf-val">0</span><span class="rf-who">P2</span>';

    _overlay.appendChild(_p1ScoreEl);
    _overlay.appendChild(_p2ScoreEl);

    // "YOUR TURN" sits on the active player's edge — the board flip alone was
    // not enough of a signal about who is meant to be tapping.
    _turnTag = document.createElement('div');
    _turnTag.className = 'rf-turn-tag';
    _overlay.appendChild(_turnTag);

    _indicator = document.createElement('div');
    _indicator.className = 'rf-indicator';
    _overlay.appendChild(_indicator);

    const onDown = e => {
        if (!state.mgActive || _transitioning) return;
        e.preventDefault();
        if (_isBot && _activePlayer === 1) return;
        const physLane = Math.min(2, Math.floor((e.clientX / window.innerWidth) * 3));
        const logLane  = _activePlayer === 1 ? 2 - physLane : physLane;
        _handleTap(logLane);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => {}; // layout is CSS-driven, nothing to recalc
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

// ── Turn logic ────────────────────────────────────────────────────────────────

function _showIndicator(text, rotated) {
    _indicator.textContent = text;
    _indicator.style.opacity = '1';
    _indicator.style.transform = `translate(-50%,-50%) scale(1)${rotated ? ' rotate(180deg)' : ''}`;
}

function _hideIndicator(rotated) {
    _indicator.style.opacity = '0';
    _indicator.style.transform = `translate(-50%,-50%) scale(.85)${rotated ? ' rotate(180deg)' : ''}`;
}

// Redraw both scoreboards and the turn tag. Called on every score change and
// on every turn change, so the two can never drift apart.
function _paintScores() {
    if (!_p1ScoreEl || !_p2ScoreEl) return;
    _p1ScoreEl.querySelector('.rf-val').textContent = _scores[0];
    _p2ScoreEl.querySelector('.rf-val').textContent = _scores[1];
    _p1ScoreEl.classList.toggle('rf-live', _activePlayer === 0);
    _p1ScoreEl.classList.toggle('rf-idle', _activePlayer !== 0);
    _p2ScoreEl.classList.toggle('rf-live', _activePlayer === 1);
    _p2ScoreEl.classList.toggle('rf-idle', _activePlayer !== 1);
    if (_turnTag) {
        const p1 = _activePlayer === 0;
        _turnTag.textContent = p1 ? 'P1 — YOUR TURN' : 'P2 — YOUR TURN';
        _turnTag.style.color      = p1 ? '#ff6b6b' : '#6ba7ff';
        _turnTag.style.background = p1 ? 'rgba(255,59,59,.14)' : 'rgba(59,142,255,.14)';
        // Explicit properties, not `cssText +=` — that would grow the rule string
        // by one full block every turn.
        _turnTag.style.top       = p1 ? 'auto'  : '34px';
        _turnTag.style.bottom    = p1 ? '34px'  : 'auto';
        _turnTag.style.left      = p1 ? 'auto'  : '22px';
        _turnTag.style.right     = p1 ? '22px'  : 'auto';
        _turnTag.style.transform = p1 ? 'none'  : 'rotate(180deg)';
    }
}

function _startTurn(pid) {
    if (!state.mgActive || _done) return;
    _transitioning = false;
    _activePlayer  = pid;
    _paintScores();
    _hideIndicator(pid === 1);
    _gameBoard.style.transform = pid === 1 ? 'rotate(180deg)' : 'rotate(0deg)';
    _lanes.forEach(l => l.innerHTML = '');

    _beats = SEQUENCES[_currentRound].map(b => ({
        time: b.t, l: b.l,
        spawned: false, dom: null,
        hit: false, missed: false, botScheduled: false,
    }));

    sfx('go');
    _lastTick  = 0;
    _turnStart = performance.now();
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    _animId = requestAnimationFrame(_tick);
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _tick(now) {
    if (!state.mgActive || _done || _transitioning) return;
    _animId = requestAnimationFrame(_tick);

    // dt exists here for any future per-frame cosmetics; note positions use absolute time
    const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1); // eslint-disable-line no-unused-vars
    _lastTick = now;

    const t = now - _turnStart;

    for (const b of _beats) {
        if (b.hit || b.missed) continue;

        if (!b.spawned && t >= b.time - TRAVEL_MS) {
            b.spawned = true;
            b.dom = document.createElement('div');
            b.dom.className = 'rf-note';
            _lanes[b.l].appendChild(b.dom);
        }

        if (b.spawned && b.dom) {
            const progress = (t - (b.time - TRAVEL_MS)) / TRAVEL_MS;
            b.dom.style.top = (-5 + progress * 90) + '%';
            if (t > b.time + 150) {
                b.missed = true;
                b.dom.remove();
                _flashTarget(b.l, 'miss');
            }
        }

        // Bot scheduling
        if (_isBot && _activePlayer === 1 && !b.botScheduled && t >= b.time - 120) {
            b.botScheduled = true;
            // §5 botSkill: hit rate and timing tightness both scale. Easy misses
            // ~30% of notes and lands mostly on GOOD; hard rarely misses and
            // lands PERFECT often. Also sometimes taps the wrong lane at low skill.
            const hitChance = 0.62 + _botSkill * 0.35;         // 0.71 easy → 0.92 hard
            if (Math.random() < hitChance) {
                const spread = 40 + (1 - _botSkill) * 150;      // tighter window at high skill
                const jitter = Math.random() * spread;
                const wrongLane = Math.random() < (1 - _botSkill) * 0.14;
                const lane = wrongLane ? (b.l + 1 + Math.floor(Math.random() * 2)) % 3 : b.l;
                _after(() => {
                    if (_done || b.hit || b.missed) return;
                    _handleTap(lane);
                }, jitter);
            }
        }
    }

    // Check turn end (1 s after last note in sequence)
    const seq = SEQUENCES[_currentRound];
    if (t > seq[seq.length - 1].t + 1000) {
        // Stop this loop immediately — _transitioning prevents re-entry
        _transitioning = true;
        cancelAnimationFrame(_animId); _animId = null;

        if (_activePlayer === 0) {
            _gameBoard.style.transform = 'rotate(180deg)';
            _showIndicator('P2 GET READY!', true);
            _after(() => _startTurn(1), 3000);
        } else {
            _currentRound++;
            if (_currentRound < 3) {
                _gameBoard.style.transform = 'rotate(0deg)';
                _showIndicator(`ROUND ${_currentRound + 1} — P1 GET READY!`, false);
                _after(() => _startTurn(0), 3000);
            } else {
                _resolveGame();
            }
        }
    }
}

// ── Tap handling ──────────────────────────────────────────────────────────────

function _handleTap(lane) {
    const t = performance.now() - _turnStart;
    let best = null, bestDiff = Infinity;
    for (const b of _beats) {
        if (b.hit || b.missed || b.l !== lane) continue;
        const diff = Math.abs(t - b.time);
        if (diff < bestDiff) { bestDiff = diff; best = b; }
    }

    if (!best || bestDiff > 350) {
        _flashTarget(lane, 'miss'); sfx('land_bad'); return;
    }

    best.hit = true;
    best.dom?.remove();

    if (bestDiff <= 60) {
        _scores[_activePlayer] += 3;
        _flashTarget(lane, 'perfect');
        _floatScore(lane, '+3', '#66fcf1');
        sfx('boost'); haptic('heavy');
    } else if (bestDiff <= 120) {
        _scores[_activePlayer] += 2;
        _flashTarget(lane, 'good');
        _floatScore(lane, '+2', '#4CAF50');
        sfx('coin_gain'); haptic('light');
    } else if (bestDiff <= 180) {
        _scores[_activePlayer] += 1;
        _flashTarget(lane, 'good');
        _floatScore(lane, '+1', '#FFEB3B');
        sfx('coin_gain');
    } else {
        best.missed = true;
        _flashTarget(lane, 'miss'); sfx('land_bad');
    }

    _paintScores();
}

function _flashTarget(lane, type) {
    const el = _laneTargets[lane];
    if (!el) return;
    if      (type === 'perfect') { el.style.background = 'rgba(102,252,241,.45)'; el.style.boxShadow = 'inset 0 0 24px #66fcf1'; }
    else if (type === 'good')    { el.style.background = 'rgba(197,198,199,.35)'; el.style.boxShadow = 'inset 0 0 12px #c5c6c7'; }
    else                         { el.style.background = 'rgba(240,58,71,.4)';    el.style.boxShadow = 'inset 0 0 18px #f03a47'; }
    _after(() => { if (el) { el.style.background = ''; el.style.boxShadow = ''; } }, 140);
}

function _floatScore(lane, text, color) {
    const el = document.createElement('div');
    el.className = 'rf-float';
    el.style.color = color;
    el.textContent = text;
    _lanes[lane]?.appendChild(el);
    _after(() => el.remove(), 620);
}

// ── End game ──────────────────────────────────────────────────────────────────

function _resolveGame() {
    if (_done) return;
    _done = true;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }

    const neutralEl = document.getElementById('mg-neutral');
    let winner = -1;
    if      (_scores[0] > _scores[1]) winner = 0;
    else if (_scores[1] > _scores[0]) winner = 1;

    const msg = winner === -1 ? 'DRAW!' : `P${winner + 1} WINS!`;
    _showIndicator(`${msg}\n${_scores[0]} — ${_scores[1]}`, false);
    if (neutralEl) neutralEl.textContent = msg;
    sfx('mg_win');

    // ⚠️  Do NOT use _after() here — _after guards on state.mgActive but _done
    // is true now. Use a raw tracked setTimeout so cleanup always fires.
    // Always destroy to avoid leaving a stale overlay in the DOM; only call
    // _onWin if mgActive is still true (prevents double-processing when the
    // 45-second fallback fires first).
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        _destroy();
        if (state.mgActive) _onWin(winner);
    }, 2500);
    _timers.push(id);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    _lanes = []; _laneTargets = []; _beats = [];
    _gameBoard = null; _indicator = null;
    _p1ScoreEl = null; _p2ScoreEl = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
