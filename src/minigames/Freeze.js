// ============================================================
// FREEZE — restraint / stealth ("red light, green light"). Hold to
// creep your token up toward the Crown while the Eye says GO; the
// instant it flips to STOP you must release, or you're spotted and
// sent back. First to reach the Crown wins. The Eye's schedule is
// shared by both halves so it's a pure, fair test of nerve + reaction.
// Fills the "restraint / hold-still" verb — no other game rewards NOT
// acting.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ADVANCE      = 0.295;  // progress per SECOND while creeping safely
const SETBACK      = 0.17;   // progress lost when caught
const LOCKOUT      = 0.65;   // s frozen after being caught
const SAFETY_TIME  = 45;     // s cap (both racing; finishes well under this)
// Phase durations lerp from "easy" (game start) to "hard" (full speed) as the
// leader nears the Crown — shorter green + shorter warning telegraph.
const GREEN = [2.4, 1.1], WARN = [0.55, 0.32], RED = [0.8, 1.25];

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _phase = 'green';            // 'green' | 'warn' | 'red'
let _phaseLeft = GREEN[0];
let _progress = [0, 0];
let _holding  = [false, false];
let _locked   = [0, 0];         // remaining lockout seconds
let _caught   = [0, 0];         // caught-flash seconds
let _botReleaseAt = Infinity;

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
    _last = 0; _t = 0;
    _phase = 'green'; _phaseLeft = GREEN[0];
    _progress = [0, 0]; _holding = [false, false]; _locked = [0, 0]; _caught = [0, 0];
    _botReleaseAt = Infinity;
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0e1118;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const pidFor = e => (e.clientY < _overlay.clientHeight / 2 ? 1 : 0);
    const down = e => { if (_done) return; e.preventDefault(); const p = pidFor(e); if (p === 1 && _isBot) return; _holding[p] = true; };
    const up   = e => { if (_done) return; e.preventDefault(); const p = pidFor(e); if (p === 1 && _isBot) return; _holding[p] = false; };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _overlay.addEventListener('pointerleave', up);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', down));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', up));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', up));
    _cleanups.push(() => _overlay.removeEventListener('pointerleave', up));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'HOLD TO CREEP — RELEASE ON STOP!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Loop ───────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;

    if (_t >= SAFETY_TIME) { _finishByLead(); return; }
    _update(dt);
    if (_isBot) _botUpdate(dt);
    _draw();
}

// Difficulty 0→1 follows the leader's progress (escalates as the Crown nears).
function _diff() { return Math.max(_progress[0], _progress[1]); }
function _lerp(a, d) { return a[0] + (a[1] - a[0]) * d; }

function _advancePhase() {
    const d = _diff();
    if (_phase === 'green') { _phase = 'warn';  _phaseLeft = _lerp(WARN, d); sfx('countdown'); }
    else if (_phase === 'warn') {
        _phase = 'red'; _phaseLeft = _lerp(RED, d) * (0.85 + Math.random() * 0.3);
        sfx('react_go');
        // Anyone still creeping the instant the Eye opens is spotted.
        for (let p = 0; p < 2; p++) if (_holding[p] && _locked[p] <= 0) _spot(p);
    } else { // red → green
        _phase = 'green'; _phaseLeft = _lerp(GREEN, d) * (0.8 + Math.random() * 0.4);
        _botReleaseAt = Infinity;
    }
}

function _spot(pid) {
    _progress[pid] = Math.max(0, _progress[pid] - SETBACK);
    _locked[pid] = LOCKOUT;
    _caught[pid] = 0.6;
    _holding[pid] = false;
    sfx('land_bad'); if (pid === 0) haptic([60, 40, 60]);
}

function _update(dt) {
    _phaseLeft -= dt;
    if (_phaseLeft <= 0) _advancePhase();

    for (let p = 0; p < 2; p++) {
        if (_locked[p] > 0) { _locked[p] -= dt; _caught[p] = Math.max(0, _caught[p] - dt); continue; }
        _caught[p] = Math.max(0, _caught[p] - dt);
        if (!_holding[p]) continue;
        if (_phase === 'red') { _spot(p); continue; }   // moving while watched
        _progress[p] = Math.min(1, _progress[p] + ADVANCE * dt);
        if (_progress[p] >= 1) { _finish(p); return; }
    }

    const neu = document.getElementById('mg-neutral');
    if (neu) {
        const label = _phase === 'red' ? '🛑 STOP!' : _phase === 'warn' ? '⚠️ ...' : '✅ GO!';
        neu.textContent = label;
    }
}

// ── Bot ───────────────────────────────────────────────────────────────────────
function _botUpdate(dt) {
    if (_locked[1] > 0) { _holding[1] = false; return; }
    if (_phase === 'green') {
        // Creep during green; occasionally hesitate at low skill (loses time).
        _holding[1] = true;
    } else if (_phase === 'warn') {
        if (_botReleaseAt === Infinity) {
            // Decide a reaction delay into the warning; high skill releases early.
            const react = 90 + (1 - _botSkill) * 520 + Math.random() * 160;   // ms
            _botReleaseAt = performance.now() + react;
        }
        _holding[1] = performance.now() < _botReleaseAt;
    } else { // red
        _holding[1] = false;
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight, hh = h / 2;
    _ctx.clearRect(0, 0, w, h);
    _ctx.strokeStyle = 'rgba(255,255,255,0.12)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, hh); _ctx.lineTo(w, hh); _ctx.stroke();

    _ctx.save(); _ctx.translate(w, hh); _ctx.rotate(Math.PI); _drawHalf(1, w, hh); _ctx.restore();
    _ctx.save(); _ctx.translate(0, hh); _drawHalf(0, w, hh); _ctx.restore();
}

function _drawHalf(pid, w, hh) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    // Eye state colour + shape (shape & label carry meaning too — R4).
    const isStop = _phase === 'red', isWarn = _phase === 'warn';
    const eyeCol = isStop ? '#ef4444' : isWarn ? '#f59e0b' : '#22c55e';

    // Track lane
    const cx = w / 2, top = hh * 0.16, bot = hh * 0.88;
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)'; _ctx.lineWidth = Math.max(8, w * 0.05);
    _ctx.lineCap = 'round';
    _ctx.beginPath(); _ctx.moveTo(cx, bot); _ctx.lineTo(cx, top); _ctx.stroke();

    // Goal (Crown) at the top
    _ctx.font = `${Math.round(w * 0.075)}px serif`; _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText('👑', cx, top - hh * 0.06);

    // The Eye / signal disc near the goal
    const sigY = hh * 0.06;
    _ctx.beginPath(); _ctx.arc(cx, sigY, w * 0.06, 0, Math.PI * 2);
    _ctx.fillStyle = eyeCol; _ctx.fill();
    if (isStop) {
        // open watching eye
        _ctx.fillStyle = '#1a1a1a';
        _ctx.beginPath(); _ctx.arc(cx, sigY, w * 0.026, 0, Math.PI * 2); _ctx.fill();
    } else {
        // closed/squint = safe
        _ctx.strokeStyle = '#0a3d1a'; _ctx.lineWidth = 4;
        _ctx.beginPath(); _ctx.arc(cx, sigY, w * 0.034, 0.15 * Math.PI, 0.85 * Math.PI); _ctx.stroke();
    }
    _ctx.fillStyle = '#fff'; _ctx.font = '900 18px "Bebas Neue", sans-serif';
    _ctx.fillText(isStop ? 'STOP' : isWarn ? 'READY' : 'GO', cx, sigY + w * 0.10);

    // Token
    const ty = bot + (top - bot) * _progress[pid];
    const moving = _holding[pid] && _locked[pid] <= 0 && _phase !== 'red';
    _ctx.beginPath(); _ctx.arc(cx, ty, w * 0.045, 0, Math.PI * 2);
    _ctx.fillStyle = _locked[pid] > 0 ? '#888' : accent; _ctx.fill();
    _ctx.lineWidth = 3; _ctx.strokeStyle = 'rgba(255,255,255,0.5)'; _ctx.stroke();
    if (moving) { // motion puff
        _ctx.fillStyle = 'rgba(255,255,255,0.25)';
        _ctx.beginPath(); _ctx.arc(cx, ty + w * 0.06, w * 0.02, 0, Math.PI * 2); _ctx.fill();
    }

    // Caught flash
    if (_caught[pid] > 0) {
        _ctx.globalAlpha = Math.min(1, _caught[pid] * 2);
        _ctx.fillStyle = '#ef4444'; _ctx.font = '900 30px "Bebas Neue", sans-serif';
        _ctx.fillText('SPOTTED!', cx, ty - w * 0.1);
        _ctx.globalAlpha = 1;
    }

    // Player tag + progress %
    _ctx.fillStyle = accent; _ctx.font = '900 22px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.fillText(`P${pid + 1}  ${Math.round(_progress[pid] * 100)}%`, 12, 10);
}

// ── End ─────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0 ? 'DRAW!' : `P${winnerId + 1} REACHES THE CROWN!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1500);
}

function _finishByLead() {
    const winner = _progress[0] > _progress[1] ? 0 : _progress[1] > _progress[0] ? 1 : -1;
    _finish(winner);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t = 0;
}
