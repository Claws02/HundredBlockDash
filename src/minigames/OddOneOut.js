// ============================================================
// ODD ONE OUT — spot-the-difference race. Every tile on your grid is
// the same shade except one. Tap the odd one to score and get a fresh,
// harder grid (more tiles, subtler difference). A wrong tap briefly
// locks you. Most correct in 30 s wins. Fills the visual-scan category.
//
// Tiles differ by LIGHTNESS only (not hue) so it stays colourblind-safe.
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME = 30;     // s
const LOCK      = 0.8;    // s lockout after a wrong tap

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _score = [0, 0];
let _gridN = [3, 3];
let _base  = ['', ''];
let _odd   = [0, 0];
let _oddColor = ['', ''];
let _lockUntil = [0, 0];
let _flashWrong = [0, 0];
let _botNextAt = 0;

const _cleanups = [];
const _timers   = [];
const _rand = n => Math.floor(Math.random() * n);

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0; _score = [0, 0]; _lockUntil = [0, 0]; _flashWrong = [0, 0];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _newPuzzle(0); _newPuzzle(1);
        document.getElementById('mg-neutral').textContent = 'TAP THE ODD TILE!';
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
        if (_done) return;
        e.preventDefault();
        const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
        const top = e.clientY < hh;
        const pid = top ? 1 : 0;
        if (pid === 1 && _isBot) return;
        const lx = top ? w - e.clientX : e.clientX;
        const ly = top ? hh - e.clientY : e.clientY - hh;
        const idx = _cellAt(lx, ly, w, hh, _gridN[pid]);
        if (idx >= 0) _tap(pid, idx);
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

function _cellRects(w, hh, n) {
    const grid = Math.min(w, hh * 0.78) * 0.84;
    const cell = grid / n;
    const pad  = cell * 0.09;
    const x0 = w / 2 - grid / 2;
    const y0 = hh * 0.56 - grid / 2;
    const rects = [];
    for (let i = 0; i < n * n; i++) {
        const r = Math.floor(i / n), c = i % n;
        rects.push({ x: x0 + c * cell + pad, y: y0 + r * cell + pad, s: cell - pad * 2 });
    }
    return rects;
}

function _cellAt(lx, ly, w, hh, n) {
    const rects = _cellRects(w, hh, n);
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (lx >= r.x && lx <= r.x + r.s && ly >= r.y && ly <= r.y + r.s) return i;
    }
    return -1;
}

// ── Puzzles ────────────────────────────────────────────────────────────────────
function _newPuzzle(pid) {
    const n = Math.min(3 + Math.floor(_score[pid] / 3), 5);
    const hue = _rand(360);
    const baseL = 52;
    const delta = Math.max(7, 32 - _score[pid] * 2);   // shrinks as you score
    _gridN[pid] = n;
    _base[pid]  = `hsl(${hue},60%,${baseL}%)`;
    _oddColor[pid] = `hsl(${hue},60%,${baseL + (Math.random() < 0.5 ? delta : -delta)}%)`;
    _odd[pid] = _rand(n * n);
    if (pid === 1 && _isBot) _botNextAt = _elapsed + _botThink(n);
}

function _botThink(n) {
    // Scan time grows with grid size; shrinks with skill. Always noisy. (§5)
    return (0.6 - _botSkill * 0.38) + n * n * (0.030 - _botSkill * 0.018) + Math.random() * 0.25;
}

function _tap(pid, idx) {
    if (_done || _elapsed < _lockUntil[pid]) return;
    if (idx === _odd[pid]) {
        _score[pid]++;
        sfx('coin_gain'); haptic([15]);
        _newPuzzle(pid);
    } else {
        _lockUntil[pid] = _elapsed + LOCK;
        _flashWrong[pid] = LOCK;
        sfx('land_bad'); haptic([60]);
        if (pid === 1) _botNextAt = _elapsed + LOCK + 0.15;
    }
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;
    _flashWrong[0] = Math.max(0, _flashWrong[0] - dt);
    _flashWrong[1] = Math.max(0, _flashWrong[1] - dt);

    if (_isBot && _elapsed >= _botNextAt && _elapsed >= _lockUntil[1]) {
        const wrong = Math.random() < (1 - _botSkill) * 0.15;
        const idx = wrong ? (_odd[1] + 1 + _rand(_gridN[1] * _gridN[1] - 1)) % (_gridN[1] * _gridN[1]) : _odd[1];
        _tap(1, idx);
    }

    if (_elapsed >= GAME_TIME) {
        return _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
    }

    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();

    // Shared countdown at centre
    const left = Math.max(0, GAME_TIME - _elapsed);
    _ctx.fillStyle = left < 5 ? '#ef4444' : 'rgba(255,255,255,0.5)';
    _ctx.font = '900 20px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillText(`${left.toFixed(1)}s`, w / 2, h / 2 + 7);

    _ctx.save(); _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _drawHalf(1, w, h / 2); _ctx.restore();
    _ctx.save(); _ctx.translate(0, h / 2); _drawHalf(0, w, h / 2); _ctx.restore();
}

function _drawHalf(pid, w, hh) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const n = _gridN[pid];
    const rects = _cellRects(w, hh, n);
    const locked = _elapsed < _lockUntil[pid];

    for (let i = 0; i < n * n; i++) {
        const { x, y, s } = rects[i];
        _roundRect(x, y, s, s, s * 0.16);
        _ctx.fillStyle = i === _odd[pid] ? _oddColor[pid] : _base[pid];
        _ctx.globalAlpha = locked ? 0.45 : 1;
        _ctx.fill();
        _ctx.globalAlpha = 1;
    }

    if (_flashWrong[pid] > 0) {   // red wash on a wrong tap
        _ctx.globalAlpha = (_flashWrong[pid] / LOCK) * 0.25;
        _ctx.fillStyle = '#ef4444'; _ctx.fillRect(0, 0, w, hh);
        _ctx.globalAlpha = 1;
    }

    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(`P${pid + 1}`, w / 2, hh * 0.12);
    _ctx.fillStyle = 'rgba(255,255,255,0.9)';
    _ctx.font = '900 28px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid]}`, w / 2, hh * 0.21);
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
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winnerId < 0 ? `DRAW! ${_score[0]}-${_score[1]}` : `P${winnerId + 1} WINS! ${_score[0]}-${_score[1]}`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1500);
}

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0;
}
