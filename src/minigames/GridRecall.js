// ============================================================
// GRID RECALL — memory duel. A pattern of tiles lights up on each
// player's 3×3 grid, then hides. Reproduce it from memory: every
// correct tile scores a point. The pattern grows and the flash gets
// shorter across 4 rounds. Highest total wins. Fills the memory/puzzle
// category.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ROUNDS     = 4;
const PATTERN    = [4, 5, 6, 7];          // tiles to remember per round (bigger 5×5 grid)
const SHOW_TIME  = [2.0, 1.8, 1.6, 1.4];  // s the pattern stays lit per round
const INPUT_TIME = 6.0;                   // s to finish tapping before auto-lock
const GRID_N     = 5;                     // 5×5
const CELLS      = GRID_N * GRID_N;

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _phase = 'show';       // 'show' | 'input' | 'reveal'
let _round = 0, _K = 3;
let _lit = new Set();
let _chosen = [new Set(), new Set()];
let _locked = [false, false];
let _failed = [false, false];   // tapped a wrong tile → out for this round
let _roundWins = [0, 0];        // rounds won (race: first to recall the whole pattern)
let _roundResolved = false;
let _inputTimer = null;

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _round = 0; _roundWins = [0, 0];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#14141f;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done || _phase !== 'input') return;
        e.preventDefault();
        const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
        const top = e.clientY < hh;
        const pid = top ? 1 : 0;
        if (pid === 1 && _isBot) return;
        // Map pointer into the half's local coords (top half is rotated 180°).
        const lx = top ? w - e.clientX : e.clientX;
        const ly = top ? hh - e.clientY : e.clientY - hh;
        const idx = _cellAt(lx, ly, w, hh);
        if (idx >= 0) _tapCell(pid, idx);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// Grid geometry — shared by draw and hit-test so they always agree.
function _cellRects(w, hh) {
    const grid = Math.min(w, hh * 0.78) * 0.82;
    const cell = grid / GRID_N;
    const pad  = cell * 0.10;
    const x0 = w / 2 - grid / 2;
    const y0 = hh * 0.56 - grid / 2;
    const rects = [];
    for (let i = 0; i < CELLS; i++) {
        const r = Math.floor(i / GRID_N), c = i % GRID_N;
        rects.push({ x: x0 + c * cell + pad, y: y0 + r * cell + pad, s: cell - pad * 2 });
    }
    return rects;
}

function _cellAt(lx, ly, w, hh) {
    const rects = _cellRects(w, hh);
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (lx >= r.x && lx <= r.x + r.s && ly >= r.y && ly <= r.y + r.s) return i;
    }
    return -1;
}

// ── Rounds ────────────────────────────────────────────────────────────────────
function _startRound() {
    _phase = 'show';
    _roundResolved = false;
    _K = PATTERN[_round];
    _lit = new Set();
    while (_lit.size < _K) _lit.add(Math.floor(Math.random() * CELLS));
    _chosen = [new Set(), new Set()];
    _locked = [false, false];
    _failed = [false, false];

    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round + 1}/${ROUNDS} — MEMORISE!  (P1 ${_roundWins[0]} · ${_roundWins[1]} P2)`;
    sfx('seq_lit');

    _after(_toInput, SHOW_TIME[_round] * 1000);
}

function _toInput() {
    if (_done) return;
    _phase = 'input';
    document.getElementById('mg-neutral').textContent = `GO! TAP ALL ${_K} — FIRST TO FINISH WINS!`;

    if (_isBot) _planBot();
    // If nobody completes in time, the most-correct taps takes the round.
    _inputTimer = _after(() => {
        if (_phase !== 'input') return;
        const c0 = _correctCount(0), c1 = _correctCount(1);
        _resolveRound(c0 > c1 ? 0 : c1 > c0 ? 1 : -1);
    }, INPUT_TIME * 1000);
}

// Bot races too: with skill it recalls the whole pattern and taps fast;
// otherwise it slips and taps a wrong tile, knocking itself out. (§5)
function _planBot() {
    const perfect = Math.random() < (0.35 + _botSkill * 0.6);   // 0.35 → 0.95
    const perTap  = 780 - _botSkill * 430;                       // ~350–780 ms between taps
    const lit     = [..._lit].sort(() => Math.random() - 0.5);
    if (perfect) {
        lit.forEach((idx, i) => _after(() => { if (_phase === 'input') _tapCell(1, idx); }, 420 + i * perTap));
    } else {
        const mistakeAt = Math.floor(Math.random() * _K);
        const wrongPool = [];
        for (let i = 0; i < CELLS; i++) if (!_lit.has(i)) wrongPool.push(i);
        const wrong = wrongPool[Math.floor(Math.random() * wrongPool.length)];
        for (let i = 0; i <= mistakeAt; i++) {
            const idx = i === mistakeAt ? wrong : lit[i];
            _after(() => { if (_phase === 'input') _tapCell(1, idx); }, 420 + i * perTap);
        }
    }
}

function _correctCount(pid) {
    let n = 0;
    _chosen[pid].forEach(i => { if (_lit.has(i)) n++; });
    return n;
}

function _tapCell(pid, idx) {
    if (_phase !== 'input' || _locked[pid] || _failed[pid] || _chosen[pid].has(idx)) return;
    _chosen[pid].add(idx);
    if (_lit.has(idx)) {
        sfx('seq_lit'); haptic([15]);
        if (_correctCount(pid) >= _K) { _locked[pid] = true; _resolveRound(pid); }   // first to finish wins!
    } else {
        // Wrong tile — knocked out of this round.
        _failed[pid] = true; _locked[pid] = true;
        sfx('land_bad'); haptic([40]);
        if (_failed[0] && _failed[1]) _resolveRound(-1);   // both out → no winner
    }
}

function _resolveRound(winnerPid) {
    if (_done || _roundResolved) return;
    _roundResolved = true;
    _phase = 'reveal';
    clearTimeout(_inputTimer);
    const neutral = document.getElementById('mg-neutral');
    if (winnerPid >= 0) {
        _roundWins[winnerPid]++;
        sfx('mg_win');
        if (neutral) neutral.textContent = `P${winnerPid + 1} RECALLS IT FIRST!  (P1 ${_roundWins[0]} · ${_roundWins[1]} P2)`;
    } else {
        sfx('land_bad');
        if (neutral) neutral.textContent = `NO WINNER THIS ROUND  (P1 ${_roundWins[0]} · ${_roundWins[1]} P2)`;
    }

    _after(() => {
        if (_done) return;
        _round++;
        if (_round >= ROUNDS) _finish();
        else _startRound();
    }, 1500);
}

// ── Loop / draw ────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;
    _draw();
}

function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();

    _ctx.save(); _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _drawHalf(1, w, h / 2); _ctx.restore();
    _ctx.save(); _ctx.translate(0, h / 2); _drawHalf(0, w, h / 2); _ctx.restore();
}

function _drawHalf(pid, w, hh) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const rects = _cellRects(w, hh);
    const glow = 0.6 + 0.4 * Math.sin(_t * 5);

    for (let i = 0; i < CELLS; i++) {
        const { x, y, s } = rects[i];
        let fill = 'rgba(255,255,255,0.06)', border = 'rgba(255,255,255,0.15)';

        if (_phase === 'show' && _lit.has(i)) {
            fill = `rgba(251,191,36,${glow})`; border = '#fbbf24';      // pattern flash (gold)
        } else if (_phase === 'input' && _chosen[pid].has(i)) {
            fill = 'rgba(90,155,255,0.30)'; border = accent;            // my pick
            if (pid === 0) fill = 'rgba(255,90,90,0.30)';
        } else if (_phase === 'reveal') {
            const lit = _lit.has(i), chose = _chosen[pid].has(i);
            if (lit && chose)       { fill = 'rgba(74,222,128,0.45)'; border = '#4ade80'; }   // correct
            else if (lit && !chose) { fill = 'rgba(251,191,36,0.18)'; border = '#fbbf24'; }   // missed
            else if (!lit && chose) { fill = 'rgba(239,68,68,0.35)';  border = '#ef4444'; }   // wrong
        }

        _roundRect(x, y, s, s, s * 0.16);
        _ctx.fillStyle = fill; _ctx.fill();
        _ctx.strokeStyle = border; _ctx.lineWidth = 3; _ctx.stroke();
    }

    // Player tag + score
    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(`P${pid + 1}`, w / 2, hh * 0.12);
    _ctx.fillStyle = 'rgba(255,255,255,0.85)';
    _ctx.font = '900 22px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_roundWins[pid]} WIN${_roundWins[pid] === 1 ? '' : 'S'}`, w / 2, hh * 0.20);
    if (_phase === 'input' && _failed[pid]) {
        _ctx.fillStyle = '#ef4444';
        _ctx.font = '700 15px Nunito, sans-serif';
        _ctx.fillText('OUT!', w / 2, hh * 0.27);
    }
}

function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.arcTo(x + w, y, x + w, y + h, r);
    _ctx.arcTo(x + w, y + h, x, y + h, r);
    _ctx.arcTo(x, y + h, x, y, r);
    _ctx.arcTo(x, y, x + w, y, r);
    _ctx.closePath();
}

// ── End / cleanup ─────────────────────────────────────────────────────────────
function _finish() {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const winner = _roundWins[0] > _roundWins[1] ? 0 : _roundWins[1] > _roundWins[0] ? 1 : -1;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winner < 0 ? `DRAW! ${_roundWins[0]}-${_roundWins[1]}` : `P${winner + 1} WINS! ${_roundWins[0]}-${_roundWins[1]}`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _done = true;
    _phase = 'reveal';
    clearTimeout(_inputTimer); _inputTimer = null;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t = 0;
}
