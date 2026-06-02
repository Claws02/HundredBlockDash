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
// NOTE: Note positions are driven purely by (performance.now() - turnStart) elapsed time,
// so they are inherently frame-rate independent. Only the cosmetic starfield uses dt.
import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';

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

let _done = false, _onWin = null, _isBot = false;
let _overlay = null;
let _scene = null, _camera = null, _renderer = null;
let _bgGeo = null, _bgMat = null, _bgPoints = null;
let _gameBoard = null, _lanes = [], _laneTargets = [], _indicator = null;
let _p1ScoreEl = null, _p2ScoreEl = null;
let _scores = [0, 0], _activePlayer = 0, _currentRound = 0;
let _beats = [], _turnStart = 0;
let _animId = null, _lastTick = 0;
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        if (state.mgActive && !_done) fn();
    }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _scores = [0, 0]; _activePlayer = 0; _currentRound = 0;
    _beats = []; _turnStart = 0; _lastTick = 0;
    _lanes = []; _laneTargets = [];

    _buildDOM();
    _initThree();

    const onResize = () => {
        if (!_camera || !_renderer) return;
        _camera.aspect = window.innerWidth / window.innerHeight;
        _camera.updateProjectionMatrix();
        _renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    sfx('mg_start');
    _showIndicator(`ROUND 1 — P1 GET READY!`, false);
    _after(() => _startTurn(0), 3000);
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _buildDOM() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#0b0c10;font-family:sans-serif;color:#fff;';

    // Inject scoped styles
    const style = document.createElement('style');
    style.textContent = `
        .rf-board { position:absolute;inset:0;display:flex;transition:transform .5s cubic-bezier(.4,0,.2,1); }
        .rf-lane  { flex:1;position:relative;border-right:1px solid rgba(102,252,241,.12); }
        .rf-lane:last-child { border-right:none; }
        .rf-hit-zone { position:absolute;top:85%;width:100%;height:70px;margin-top:-35px;
            border-top:2px solid rgba(197,198,199,.35);border-bottom:2px solid rgba(197,198,199,.35);
            display:flex;pointer-events:none;z-index:10; }
        .rf-target { flex:1;height:100%;transition:background .1s,box-shadow .1s; }
        .rf-note { position:absolute;width:68%;left:16%;height:28px;margin-top:-14px;
            background:#66fcf1;border-radius:14px;box-shadow:0 0 14px #66fcf1;
            pointer-events:none;z-index:5; }
        .rf-score { position:absolute;font-size:46px;font-weight:900;text-shadow:0 0 10px #45a29e;
            pointer-events:none;z-index:20; }
        .rf-indicator { position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(.85);
            z-index:50;font-size:28px;font-weight:bold;text-align:center;
            background:rgba(11,12,16,.96);padding:18px 36px;border-radius:12px;
            opacity:0;transition:opacity .3s,transform .3s;pointer-events:none;
            color:#66fcf1;border:2px solid #66fcf1;text-transform:uppercase;letter-spacing:2px; }
        @keyframes rf-float {
            0%   { opacity:1;transform:translateY(0) scale(1); }
            100% { opacity:0;transform:translateY(-55px) scale(1.3); }
        }
        .rf-float { position:absolute;top:70%;width:100%;text-align:center;font-size:34px;
            font-weight:bold;pointer-events:none;z-index:30;
            animation:rf-float .6s ease-out forwards;text-shadow:0 0 8px currentColor; }
    `;
    _overlay.appendChild(style);

    // Game board (rotates between turns)
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

    // Scores
    _p1ScoreEl = document.createElement('div');
    _p1ScoreEl.className = 'rf-score';
    _p1ScoreEl.style.cssText += 'bottom:28px;left:28px;';
    _p1ScoreEl.textContent = '0';

    _p2ScoreEl = document.createElement('div');
    _p2ScoreEl.className = 'rf-score';
    _p2ScoreEl.style.cssText += 'top:28px;right:28px;transform:rotate(180deg);';
    _p2ScoreEl.textContent = '0';

    _gameBoard.appendChild(_p1ScoreEl);
    _gameBoard.appendChild(_p2ScoreEl);
    _overlay.appendChild(_gameBoard);

    // Centered indicator
    _indicator = document.createElement('div');
    _indicator.className = 'rf-indicator';
    _overlay.appendChild(_indicator);

    // Tap handler (full overlay)
    const onDown = e => {
        if (_done || !state.mgActive) return;
        e.preventDefault();
        // Ignore bot's turn
        if (_isBot && _activePlayer === 1) return;
        const physLane = Math.min(2, Math.floor((e.clientX / window.innerWidth) * 3));
        // When board is rotated 180° for P2, physical left maps to logical right
        const logLane = _activePlayer === 1 ? 2 - physLane : physLane;
        _handleTap(logLane);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    mg.appendChild(_overlay);
}

// ── Three.js starfield ────────────────────────────────────────────────────────

function _initThree() {
    const w = window.innerWidth, h = window.innerHeight;

    _renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
    _overlay.appendChild(_renderer.domElement);

    _scene  = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    _camera.position.z = 50;

    const count = 400;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - .5) * 200;
    _bgGeo = new THREE.BufferGeometry();
    _bgGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    _bgMat    = new THREE.PointsMaterial({ color: 0x45a29e, size: 2, transparent: true, opacity: .5 });
    _bgPoints = new THREE.Points(_bgGeo, _bgMat);
    _scene.add(_bgPoints);
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

function _startTurn(pid) {
    if (!state.mgActive || _done) return;
    _activePlayer = pid;
    _hideIndicator(pid === 1);
    _gameBoard.style.transform = pid === 1 ? 'rotate(180deg)' : 'rotate(0deg)';

    // Clear any leftover notes
    _lanes.forEach(l => l.innerHTML = '');

    _beats = SEQUENCES[_currentRound].map(b => ({
        time: b.t, l: b.l,
        spawned: false, dom: null,
        hit: false, missed: false, botScheduled: false,
    }));

    sfx('go');
    _lastTick  = 0;
    _turnStart = performance.now();
    if (_animId) cancelAnimationFrame(_animId);
    _animId = requestAnimationFrame(_tick);
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _tick(now) {
    if (!state.mgActive || _done) return;
    _animId = requestAnimationFrame(_tick);

    // dt for cosmetic starfield only — note positions use absolute elapsed time
    const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
    _lastTick = now;

    // Starfield: scroll at 12 world-units/second (frame-rate independent)
    if (_bgPoints) {
        const dir = _activePlayer === 0 ? 1 : -1;
        _bgPoints.position.y += dir * 12 * dt;
        if (Math.abs(_bgPoints.position.y) > 50) _bgPoints.position.y = 0;
    }
    _renderer.render(_scene, _camera);

    const t = now - _turnStart;

    // Spawn & move notes
    for (const b of _beats) {
        if (b.hit || b.missed) continue;

        if (!b.spawned && t >= b.time - TRAVEL_MS) {
            b.spawned = true;
            b.dom = document.createElement('div');
            b.dom.className = 'rf-note';
            _lanes[b.l].appendChild(b.dom);
        }

        if (b.spawned && b.dom) {
            const progress = (t - (b.time - TRAVEL_MS)) / TRAVEL_MS; // 0→1
            b.dom.style.top = (-5 + progress * 90) + '%';

            if (t > b.time + 150) {
                b.missed = true;
                b.dom.remove();
                _flashTarget(b.l, 'miss');
            }
        }

        // Bot scheduling
        if (_isBot && _activePlayer === 1 && !b.botScheduled && t >= b.time - 100) {
            b.botScheduled = true;
            if (Math.random() < 0.85) {
                const jitter = Math.random() * 80;
                _after(() => {
                    if (_done || b.hit || b.missed) return;
                    _handleTap(b.l);
                }, jitter);
            }
        }
    }

    // Check turn end
    const seq = SEQUENCES[_currentRound];
    if (t > seq[seq.length - 1].t + 1000) {
        cancelAnimationFrame(_animId); _animId = null;
        if (_activePlayer === 0) {
            // Hand off to P2
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
        _flashTarget(lane, 'miss');
        sfx('land_bad');
        return;
    }

    best.hit = true;
    best.dom?.remove();

    if (bestDiff <= 60) {
        _scores[_activePlayer] += 3;
        _flashTarget(lane, 'perfect');
        _floatScore(lane, '+3', '#66fcf1');
        sfx('jump'); haptic('heavy');
    } else if (bestDiff <= 120) {
        _scores[_activePlayer] += 2;
        _flashTarget(lane, 'good');
        _floatScore(lane, '+2', '#4CAF50');
        sfx('coin'); haptic('light');
    } else if (bestDiff <= 180) {
        _scores[_activePlayer] += 1;
        _flashTarget(lane, 'good');
        _floatScore(lane, '+1', '#FFEB3B');
        sfx('coin');
    } else {
        best.missed = true;
        _flashTarget(lane, 'miss');
        sfx('land_bad');
    }

    _p1ScoreEl.textContent = _scores[0];
    _p2ScoreEl.textContent = _scores[1];
}

function _flashTarget(lane, type) {
    const el = _laneTargets[lane];
    if (!el) return;
    if (type === 'perfect') {
        el.style.background = 'rgba(102,252,241,.45)';
        el.style.boxShadow  = 'inset 0 0 22px #66fcf1';
    } else if (type === 'good') {
        el.style.background = 'rgba(197,198,199,.35)';
        el.style.boxShadow  = 'inset 0 0 12px #c5c6c7';
    } else {
        el.style.background = 'rgba(240,58,71,.4)';
        el.style.boxShadow  = 'inset 0 0 18px #f03a47';
    }
    _after(() => { if (el) { el.style.background = ''; el.style.boxShadow = ''; } }, 140);
}

function _floatScore(lane, text, color) {
    const el = document.createElement('div');
    el.className = 'rf-float';
    el.style.color = color;
    el.textContent = text;
    _lanes[lane].appendChild(el);
    _after(() => el.remove(), 620);
}

// ── End game ──────────────────────────────────────────────────────────────────

function _resolveGame() {
    if (_done) return;
    _done = true;

    const neutralEl = document.getElementById('mg-neutral');
    let winner = -1;
    if      (_scores[0] > _scores[1]) winner = 0;
    else if (_scores[1] > _scores[0]) winner = 1;

    _gameBoard.style.transform = 'rotate(0deg)';
    const msg = winner === -1 ? 'DRAW!' : `P${winner + 1} WINS!`;
    _showIndicator(`${msg}\n${_scores[0]} — ${_scores[1]}`, false);
    if (neutralEl) neutralEl.textContent = msg;
    sfx('mg_win');

    _after(() => { _destroy(); _onWin(winner); }, 2500);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    if (_bgGeo)  { _bgGeo.dispose();  _bgGeo  = null; }
    if (_bgMat)  { _bgMat.dispose();  _bgMat  = null; }
    _scene = null; _camera = null; _bgPoints = null;
    _lanes = []; _laneTargets = []; _beats = [];
    _gameBoard = null; _indicator = null;
    _p1ScoreEl = null; _p2ScoreEl = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
