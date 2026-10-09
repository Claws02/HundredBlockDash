// ============================================================
// TUG TAP — tug-of-war. Tap your side as fast as you can to drag the
// knot toward your end of the rope. A slow drift pulls it back to
// centre, so keep hammering. First to haul the knot to their end wins;
// if time runs out, whoever's ahead takes it. Fills the mash/endurance
// category.
//
// Vertical rope: P1 hauls the knot DOWN to their end, P2 UP to theirs —
// naturally symmetric for face-off, so no rotated hit-testing needed.
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const IMPULSE    = 0.075;   // knot travel per tap (rope spans -1..+1)
const DECAY      = 0.12;    // /s pull back toward centre
const WIN        = 1.0;     // |pos| to win
const TIME_LIMIT = 22;      // s before the leader is declared

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _pos = 0;               // -1 = P2 end (top), +1 = P1 end (bottom)
let _flash = [0, 0];        // per-player tap-flash timer
let _botAccum = 0, _botInterval = 0.25;

const _cleanups = [];
const _timers   = [];

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0; _pos = 0; _flash = [0, 0]; _botAccum = 0;
    // Capped so a focused human (~6 taps/s) can out-tap even Hard.
    _botInterval = 0.43 - _botSkill * 0.27;   // easy ~0.36s, medium ~0.28s, hard ~0.20s
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        document.getElementById('mg-neutral').textContent = 'TAP YOUR SIDE — HAUL THE KNOT!';
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
        const pid = e.clientY > _overlay.clientHeight / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;
        _tap(pid);
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

// ── Input ───────────────────────────────────────────────────────────────────
function _tap(pid) {
    if (_done) return;
    _pos += pid === 0 ? IMPULSE : -IMPULSE;
    _flash[pid] = 0.15;
    sfx('seq_lit'); haptic([12]);
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;

    // Drift back toward centre; flashes decay.
    _pos -= _pos * DECAY * dt;
    _flash[0] = Math.max(0, _flash[0] - dt);
    _flash[1] = Math.max(0, _flash[1] - dt);

    // Bot mashes at a skill-scaled rate with jitter (§5).
    if (_isBot) {
        _botAccum += dt;
        if (_botAccum >= _botInterval) {
            _botAccum = 0;
            _botInterval = (0.43 - _botSkill * 0.27) * (0.8 + Math.random() * 0.4);
            _tap(1);
        }
    }

    if (_pos >= WIN)        return _finish(0);
    if (_pos <= -WIN)       return _finish(1);
    if (_elapsed >= TIME_LIMIT) return _finish(_pos > 0.02 ? 0 : _pos < -0.02 ? 1 : -1);

    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    const endH = h * 0.12;
    _ctx.clearRect(0, 0, w, h);

    // End zones (P2 goal top / P1 goal bottom)
    _ctx.fillStyle = 'rgba(90,155,255,0.16)'; _ctx.fillRect(0, 0, w, endH);
    _ctx.fillStyle = 'rgba(255,90,90,0.16)';  _ctx.fillRect(0, h - endH, w, endH);
    _ctx.fillStyle = 'rgba(90,155,255,0.8)';
    _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
    _ctx.save(); _ctx.translate(w / 2, endH / 2); _ctx.rotate(Math.PI); _ctx.fillText('▲ P2 GOAL', 0, 7); _ctx.restore();
    _ctx.fillStyle = 'rgba(255,90,90,0.85)';
    _ctx.fillText('▼ P1 GOAL', w / 2, h - endH / 2 + 7);

    // Rope + centre line
    _ctx.strokeStyle = 'rgba(255,255,255,0.2)'; _ctx.lineWidth = 4;
    _ctx.beginPath(); _ctx.moveTo(w / 2, endH); _ctx.lineTo(w / 2, h - endH); _ctx.stroke();
    _ctx.strokeStyle = 'rgba(255,255,255,0.25)'; _ctx.lineWidth = 2; _ctx.setLineDash([6, 8]);
    _ctx.beginPath(); _ctx.moveTo(w * 0.32, h / 2); _ctx.lineTo(w * 0.68, h / 2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Knot — colour leans toward the leader
    const knotY = h / 2 + _pos * (h / 2 - endH);
    const lead = (_pos + 1) / 2;   // 0 = P2, 1 = P1
    const r = Math.floor(90 + lead * 165), b = Math.floor(255 - lead * 165);
    _ctx.beginPath(); _ctx.arc(w / 2, knotY, w * 0.07, 0, Math.PI * 2);
    _ctx.fillStyle = `rgb(${r},90,${b})`;
    _ctx.shadowColor = `rgb(${r},90,${b})`; _ctx.shadowBlur = 18; _ctx.fill(); _ctx.shadowBlur = 0;
    _ctx.strokeStyle = '#fff'; _ctx.lineWidth = 3; _ctx.stroke();

    // Tap flash rings at each half's outer edge
    [0, 1].forEach(pid => {
        if (_flash[pid] <= 0) return;
        const y = pid === 0 ? h - endH - 30 : endH + 30;
        _ctx.globalAlpha = _flash[pid] / 0.15;
        _ctx.fillStyle = pid === 0 ? '#ff5a5a' : '#5a9bff';
        _ctx.font = '900 30px "Bebas Neue", sans-serif';
        _ctx.fillText('TAP!', w / 2, y);
        _ctx.globalAlpha = 1;
    });
}

// ── End / cleanup ─────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winnerId < 0 ? 'DRAW!' : `P${winnerId + 1} WINS!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
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
