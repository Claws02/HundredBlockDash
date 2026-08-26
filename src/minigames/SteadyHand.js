// ============================================================
// STEADY HAND — tracking duel. A target drifts around your half; keep
// your finger on it to bank time. It speeds up as the round goes on.
// Most time-on-target after 22 s wins. Fills the dexterity category.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';
import * as Solo from './SoloArena.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME = 22;     // s
const R_FRAC    = 0.11;   // target radius as fraction of min(w, halfH)
const SPEED0    = 0.22;   // target speed (fraction of halfH per s) at start
const SPEED_GROW= 0.05;   // +per second

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

// Per-player playfield, all in half-local coords (0..w, 0..halfH).
let _tx = [0, 0], _ty = [0, 0], _vx = [0, 0], _vy = [0, 0];
let _fx = [null, null], _fy = [null, null];   // finger position, or null
let _score = [0, 0];
let _bjx = 0, _bjy = 0;                        // bot finger jitter offset
const _ptr = {};                              // pointerId → pid

const _cleanups = [];
const _timers   = [];

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0; _score = [0, 0]; _fx = [null, null]; _fy = [null, null];
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _initTargets();
        document.getElementById('mg-neutral').textContent = 'KEEP YOUR FINGER ON THE TARGET!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _initTargets() {
    const w = _overlay.clientWidth, hh = Solo.soloHalf(_overlay);
    for (const pid of Solo.pids()) {
        _tx[pid] = w / 2; _ty[pid] = hh / 2;
        // The target has to set off in the same direction on every phone, or
        // the "same challenge" the scores are compared on is not the same
        // challenge. By index like everything else, even though there is only
        // one draw here — a rule with an exception in it is a rule somebody
        // will get wrong next time.
        const a = (Solo.isSolo() ? Solo.draw(pid) : Math.random()) * Math.PI * 2;
        const sp = SPEED0 * hh;
        _vx[pid] = Math.cos(a) * sp; _vy[pid] = Math.sin(a) * sp;
    }
    if (_isBot) { _fx[1] = _tx[1]; _fy[1] = _ty[1]; }
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

    // Convert a client point to a half + local coords (top half is rotated 180°).
    const localize = e => {
        const w = _overlay.clientWidth, hh = _overlay.clientHeight / 2;
        // Alone on your own phone there is no other half to be in: every touch
        // is yours and the coordinates are the screen's own.
        if (Solo.isSolo()) return { pid: 0, lx: e.clientX, ly: e.clientY };
        const top = e.clientY < hh;
        const pid = top ? 1 : 0;
        const lx = top ? w - e.clientX : e.clientX;
        const ly = top ? hh - e.clientY : e.clientY - hh;
        return { pid, lx, ly };
    };
    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const { pid, lx, ly } = localize(e);
        if (pid === 1 && _isBot) return;
        _ptr[e.pointerId] = pid;
        _fx[pid] = lx; _fy[pid] = ly;
    };
    const onMove = e => {
        const pid = _ptr[e.pointerId];
        if (pid === undefined) return;
        e.preventDefault();
        const { lx, ly } = localize(e);
        _fx[pid] = lx; _fy[pid] = ly;
    };
    const onUp = e => {
        const pid = _ptr[e.pointerId];
        if (pid === undefined) return;
        _fx[pid] = null; _fy[pid] = null;
        delete _ptr[e.pointerId];
    };
    _overlay.addEventListener('pointerdown', onDown);
    _overlay.addEventListener('pointermove', onMove);
    _overlay.addEventListener('pointerup', onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown', onDown);
        _overlay.removeEventListener('pointermove', onMove);
        _overlay.removeEventListener('pointerup', onUp);
        _overlay.removeEventListener('pointercancel', onUp);
    });

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

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;

    const w = _overlay.clientWidth, hh = Solo.soloHalf(_overlay);
    const R = Math.min(w, hh) * R_FRAC;
    const speed = (SPEED0 + SPEED_GROW * _elapsed) * hh;

    for (const pid of Solo.pids()) {
        // Move + bounce target within margins.
        const m = R + 6;
        const v = Math.hypot(_vx[pid], _vy[pid]) || 1;
        _vx[pid] = _vx[pid] / v * speed; _vy[pid] = _vy[pid] / v * speed;
        _tx[pid] += _vx[pid] * dt; _ty[pid] += _vy[pid] * dt;
        if (_tx[pid] < m) { _tx[pid] = m; _vx[pid] = Math.abs(_vx[pid]); }
        if (_tx[pid] > w - m) { _tx[pid] = w - m; _vx[pid] = -Math.abs(_vx[pid]); }
        if (_ty[pid] < m) { _ty[pid] = m; _vy[pid] = Math.abs(_vy[pid]); }
        if (_ty[pid] > hh - m) { _ty[pid] = hh - m; _vy[pid] = -Math.abs(_vy[pid]); }
    }

    // Bot finger chases the target with skill-scaled responsiveness + jitter (§5).
    if (_isBot) {
        const k = Math.min(1, (3 + _botSkill * 9) * dt);
        const amp = (1 - _botSkill) * R * 1.8;
        _bjx += (Math.random() - 0.5) * amp * 6 * dt; _bjy += (Math.random() - 0.5) * amp * 6 * dt;
        _bjx -= _bjx * 2 * dt; _bjy -= _bjy * 2 * dt;   // mean-revert
        _fx[1] += ((_tx[1] + _bjx) - _fx[1]) * k;
        _fy[1] += ((_ty[1] + _bjy) - _fy[1]) * k;
    }

    // Score time-on-target.
    for (const pid of Solo.pids()) {
        if (_fx[pid] === null) continue;
        if (Math.hypot(_fx[pid] - _tx[pid], _fy[pid] - _ty[pid]) <= R) _score[pid] += dt;
    }

    if (_elapsed >= GAME_TIME) {
        // Played across phones this is not a duel — it is one score, compared
        // afterwards with everybody else's. Tenths of a second, so the number
        // people are ranked on is a whole number.
        if (Solo.isSolo()) return _finishSolo();
        const d = _score[0] - _score[1];
        return _finish(d > 0.15 ? 0 : d < -0.15 ? 1 : -1);
    }

    _draw(R);
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw(R) {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    if (Solo.isSolo()) {
        // No divider, no second half, no rotation: the playfield is the screen.
        _drawHalf(0, w, h, R);
        const left = Math.max(0, GAME_TIME - _elapsed);
        // At the top, on its own band. The bottom belongs to the status strip,
        // which wraps to three lines on a narrow phone.
        _ctx.fillStyle = 'rgba(8,6,18,0.72)';
        _ctx.fillRect(0, 0, w, 46);
        _ctx.fillStyle = left < 4 ? '#ef4444' : 'rgba(255,255,255,0.75)';
        _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText(`${left.toFixed(1)}s`, w / 2, 31);
        return;
    }
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();

    const left = Math.max(0, GAME_TIME - _elapsed);
    _ctx.fillStyle = left < 4 ? '#ef4444' : 'rgba(255,255,255,0.5)';
    _ctx.font = '900 20px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillText(`${left.toFixed(1)}s`, w / 2, h / 2 + 7);

    _ctx.save(); _ctx.translate(w, h / 2); _ctx.rotate(Math.PI); _drawHalf(1, w, h / 2, R); _ctx.restore();
    _ctx.save(); _ctx.translate(0, h / 2); _drawHalf(0, w, h / 2, R); _ctx.restore();
}

function _drawHalf(pid, w, hh, R) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const onTarget = _fx[pid] !== null && Math.hypot(_fx[pid] - _tx[pid], _fy[pid] - _ty[pid]) <= R;

    // Target
    _ctx.beginPath(); _ctx.arc(_tx[pid], _ty[pid], R, 0, Math.PI * 2);
    _ctx.fillStyle = onTarget ? 'rgba(74,222,128,0.30)' : 'rgba(255,255,255,0.06)';
    _ctx.fill();
    _ctx.lineWidth = 4; _ctx.strokeStyle = onTarget ? '#4ade80' : accent;
    _ctx.shadowColor = _ctx.strokeStyle; _ctx.shadowBlur = onTarget ? 18 : 8; _ctx.stroke(); _ctx.shadowBlur = 0;
    _ctx.beginPath(); _ctx.arc(_tx[pid], _ty[pid], 4, 0, Math.PI * 2); _ctx.fillStyle = _ctx.strokeStyle; _ctx.fill();

    // Finger marker
    if (_fx[pid] !== null) {
        _ctx.beginPath(); _ctx.arc(_fx[pid], _fy[pid], R * 0.45, 0, Math.PI * 2);
        _ctx.strokeStyle = accent; _ctx.lineWidth = 2.5; _ctx.stroke();
    }

    // Tag + score
    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(Solo.isSolo() ? 'YOU' : `P${pid + 1}`, w / 2, hh * 0.10);
    _ctx.fillStyle = 'rgba(255,255,255,0.9)';
    _ctx.font = '900 26px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid].toFixed(1)}s`, w / 2, hh * 0.18);
}

// ── End / cleanup ─────────────────────────────────────────────────────────────

/** Time held on target, in tenths — see SoloArena: higher is always better. */
export function soloScore() { return Math.round(_score[0] * 10); }

function _finishSolo() {
    if (_done) return;
    _done = true;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = `${_score[0].toFixed(1)}s ON TARGET`;
    sfx('mg_win');
    const banked = soloScore();
    _after(() => { _destroy(); Solo.soloFinish(banked); }, 1200);
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const s = [_score[0].toFixed(1), _score[1].toFixed(1)];
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winnerId < 0 ? `DRAW! ${s[0]}s-${s[1]}s` : `P${winnerId + 1} WINS! ${s[0]}s-${s[1]}s`;
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
    for (const k in _ptr) delete _ptr[k];
    _last = 0;
}
