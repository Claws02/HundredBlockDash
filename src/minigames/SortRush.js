// ============================================================
// SORT RUSH — sorting / categorise duel. A shape appears in the middle
// of your half; fling it into the matching bin by tapping your LEFT
// (▲ triangle) or RIGHT (● circle) side. Each correct sort scores and
// speeds the next one up; a wrong tap locks you out briefly. Most
// correct in 30 s wins — a pure rate game, so a slow start is never fatal.
//
// New verb for the roster: sorting. Built to docs/MINIGAME_STANDARD.md
// on the SnapStrike scaffold. Face-off symmetric; meaning carried by
// SHAPE, never colour alone (§4).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ROUND_TIME    = 30;     // s
const TOK_TIME_START= 2.3;    // s allowed per shape at score 0
const TOK_TIME_MIN  = 1.05;   // s floor as you speed up
const TOK_TIME_DROP = 0.05;   // s shaved off per correct sort
const WRONG_LOCK    = 0.5;    // s lock-out after a wrong tap
const SHAPES        = ['triangle', 'circle'];           // left bin / right bin
const COLORS        = ['#fbbf24', '#34d399', '#f472b6', '#38bdf8', '#f97316'];

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _score   = [0, 0];
let _token   = [null, null];   // { shape, color }
let _tokTime = [0, 0];         // time left on the current shape
let _tokMax  = [0, 0];
let _lock    = [0, 0];         // wrong-tap lock-out remaining
let _flash   = [null, null];   // { good, t }
let _bot     = null;           // { t, actAt, wrong }

const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}
function _gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0;
    _score = [0, 0]; _lock = [0, 0]; _flash = [null, null];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _newToken(0); _newToken(1);
        document.getElementById('mg-neutral').textContent = 'SORT FAST! ▲ LEFT · ● RIGHT';
        sfx('go');
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#15131f;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const rect = _overlay.getBoundingClientRect();
        const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
        const pid = ly > rect.height / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;
        // Map to the player's own left/right (top half is rotated 180°).
        const localX = pid === 0 ? lx : rect.width - lx;
        _sort(pid, localX < rect.width / 2 ? 'left' : 'right');
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

// ── Gameplay ────────────────────────────────────────────────────────────────
function _newToken(pid) {
    const shape = SHAPES[Math.random() < 0.5 ? 0 : 1];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    _token[pid]   = { shape, color };
    _tokMax[pid]  = Math.max(TOK_TIME_MIN, TOK_TIME_START - _score[pid] * TOK_TIME_DROP);
    _tokTime[pid] = _tokMax[pid];
    if (pid === 1 && _isBot) _planBot();
}

function _planBot(retry) {
    const s = _botSkill;
    _bot = {
        t: 0,
        actAt: (retry ? 0.22 : 0.34 + (1 - s) * 0.85) + Math.random() * 0.2 + Math.abs(_gauss()) * 0.1,
        wrong: Math.random() < (retry ? 0.18 : 0.42) * (1 - s),
    };
}

function _sort(pid, bin) {
    if (_done || _lock[pid] > 0 || !_token[pid]) return;
    const correctBin = _token[pid].shape === 'triangle' ? 'left' : 'right';
    if (bin === correctBin) {
        _score[pid]++;
        _flash[pid] = { good: true, t: 0.3 };
        sfx('coin_gain'); haptic([18]);
        _newToken(pid);
        if (pid === 0) document.getElementById('mg-neutral').textContent = `P1 ${_score[0]}  —  P2 ${_score[1]}`;
    } else {
        _lock[pid] = WRONG_LOCK;
        _flash[pid] = { good: false, t: WRONG_LOCK };
        sfx('land_bad'); haptic([55]);
    }
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    for (let pid = 0; pid < 2; pid++) {
        if (_flash[pid]) { _flash[pid].t -= dt; if (_flash[pid].t <= 0) _flash[pid] = null; }
        if (_lock[pid] > 0) { _lock[pid] -= dt; continue; }
        _tokTime[pid] -= dt;
        if (_tokTime[pid] <= 0) {            // ran out → miss, fresh shape
            _flash[pid] = { good: false, t: 0.25 };
            sfx('land_bad');
            _newToken(pid);
        }
    }

    // Bot plays its half
    if (_isBot && _bot && _token[1] && _lock[1] <= 0) {
        _bot.t += dt;
        if (_bot.t >= _bot.actAt) {
            const correctBin = _token[1].shape === 'triangle' ? 'left' : 'right';
            const bin = _bot.wrong ? (correctBin === 'left' ? 'right' : 'left') : correctBin;
            _sort(1, bin);
            if (_lock[1] > 0) _planBot(true);   // mis-sorted → quick retry plan
        }
    }

    if (_elapsed >= ROUND_TIME) { _finish(); return; }
    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    // Time bar across the divider
    const frac = 1 - _elapsed / ROUND_TIME;
    _ctx.fillStyle = 'rgba(255,255,255,0.10)';
    _ctx.fillRect(0, h / 2 - 3, w, 6);
    _ctx.fillStyle = '#fbbf24';
    _ctx.fillRect(w / 2 - (w / 2) * frac, h / 2 - 3, w * frac, 6);

    _ctx.save(); _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _drawHalf(1, w, h / 2); _ctx.restore();
    _ctx.save(); _ctx.translate(0, h / 2); _drawHalf(0, w, h / 2); _ctx.restore();
}

function _shapePath(shape, cx, cy, r) {
    _ctx.beginPath();
    if (shape === 'circle') {
        _ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else {
        _ctx.moveTo(cx, cy - r);
        _ctx.lineTo(cx + r * 0.92, cy + r * 0.72);
        _ctx.lineTo(cx - r * 0.92, cy + r * 0.72);
        _ctx.closePath();
    }
}

// Draws a player's identical sorter into a (w × h) box, origin top-left,
// localY 0 = centre divider, localY h = the edge the player holds.
function _drawHalf(pid, w, h) {
    const color = pid === 0 ? '#ff5a5a' : '#5a9bff';

    // Score
    _ctx.fillStyle = color;
    _ctx.font = '700 20px Nunito, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.fillText(`P${pid + 1}`, w / 2, h * 0.16);
    _ctx.fillStyle = 'rgba(255,255,255,0.9)';
    _ctx.font = '900 34px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid]}`, w / 2, h * 0.30);

    // Bins (drawn near the outer edge). Left = triangle, Right = circle.
    const binY = h * 0.80, binR = Math.min(w, h) * 0.085;
    const locked = _lock[pid] > 0;
    _ctx.globalAlpha = locked ? 0.4 : 1;
    [['triangle', w * 0.26], ['circle', w * 0.74]].forEach(([shape, bx]) => {
        _ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        _ctx.lineWidth = 3;
        _ctx.fillStyle = 'rgba(255,255,255,0.08)';
        _ctx.beginPath(); _ctx.roundRect(bx - w * 0.18, binY - binR * 1.5, w * 0.36, binR * 3, 14);
        _ctx.fill(); _ctx.stroke();
        _ctx.fillStyle = 'rgba(255,255,255,0.75)';
        _shapePath(shape, bx, binY, binR); _ctx.fill();
    });
    _ctx.globalAlpha = 1;

    // The shape to sort
    const tk = _token[pid];
    if (tk) {
        const tx = w / 2, ty = h * 0.50, tr = Math.min(w, h) * 0.12;
        // urgency ring
        const u = _tokMax[pid] > 0 ? Math.max(0, _tokTime[pid] / _tokMax[pid]) : 0;
        _ctx.strokeStyle = u < 0.33 ? '#ef4444' : 'rgba(255,255,255,0.35)';
        _ctx.lineWidth = 5;
        _ctx.beginPath(); _ctx.arc(tx, ty, tr * 1.5, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); _ctx.stroke();
        // shape
        _ctx.fillStyle = tk.color;
        _ctx.shadowColor = tk.color; _ctx.shadowBlur = 16;
        _shapePath(tk.shape, tx, ty, tr); _ctx.fill();
        _ctx.shadowBlur = 0;
    }

    // Flash feedback
    if (_flash[pid]) {
        _ctx.fillStyle = _flash[pid].good ? 'rgba(74,222,128,0.18)' : 'rgba(239,68,68,0.20)';
        _ctx.fillRect(0, 0, w, h);
    }
    if (locked) {
        _ctx.fillStyle = '#ef4444';
        _ctx.font = '900 22px "Bebas Neue", sans-serif';
        _ctx.fillText('WRONG BIN!', w / 2, h * 0.62);
    }
}

// ── End ───────────────────────────────────────────────────────────────────────
function _finish() {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const winner = _score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent =
        winner < 0 ? `DRAW! ${_score[0]}-${_score[1]}` : `P${winner + 1} WINS! ${_score[0]}-${_score[1]}`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1500);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _bot = null; _token = [null, null];
}
