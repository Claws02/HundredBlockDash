// ============================================================
// QUICK DRAW — reflex duel. Both halves show WAIT; after a random
// delay they flip to DRAW. First to tap wins the round — but tap
// before DRAW and you false-start and hand the round to your rival.
// Best of 3. Fills the "reflex / first" category.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const WINS_NEEDED = 2;     // best of 3
const ARM_MIN     = 1.4;   // s — shortest wait before DRAW
const ARM_MAX     = 3.0;   // s — longest wait
const TIE_WINDOW  = 0.05;  // s — taps this close count as a tie (replay)

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _phase = 'arm';        // 'arm' | 'fire' | 'over'
let _fireAt = 0;           // performance.now() when DRAW fired
let _wins = [0, 0];
let _round = 0;
let _tapped = [false, false];
let _taps = [];            // { pid, t } collected during the tie window
let _banner = '';          // centre result text for the round
let _flushPending = false;
let _botReactMs = 0;       // bot's planned reaction time for the current round

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
    _last = 0; _round = 0; _wins = [0, 0];
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

// ── Rounds ────────────────────────────────────────────────────────────────────
function _startRound() {
    _phase = 'arm';
    _tapped = [false, false];
    _taps = [];
    _flushPending = false;
    _banner = '';
    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round + 1} — WAIT FOR IT…  (P1 ${_wins[0]} · ${_wins[1]} P2)`;

    const armMs = (ARM_MIN + Math.random() * (ARM_MAX - ARM_MIN)) * 1000;

    // Bot plan: either an honest reaction after DRAW, or (rarely, more at low
    // skill) a jumpy false start before it. §5 — always noisy.
    if (_isBot) {
        const falseStart = Math.random() < (1 - _botSkill) * 0.16;
        if (falseStart) {
            _after(() => { if (_phase === 'arm') _tap(1); }, 300 + Math.random() * Math.max(100, armMs - 500));
        } else {
            _botReactMs = 600 - _botSkill * 460 + Math.random() * 120;
        }
    }

    _after(_fire, armMs);
}

function _fire() {
    if (_done || _phase !== 'arm') return;
    _phase = 'fire';
    _fireAt = performance.now();
    document.getElementById('mg-neutral').textContent = 'DRAW!';
    sfx('react_go'); haptic([40]);
    if (_isBot && _botReactMs > 0) _after(() => { if (_phase === 'fire') _tap(1); }, _botReactMs);
    _botReactMs = 0;
}

function _tap(pid) {
    if (_done || _tapped[pid]) return;

    if (_phase === 'arm') {
        // False start — the other player takes the round.
        _tapped[pid] = true;
        sfx('land_bad'); haptic([80]);
        _banner = `P${pid + 1} JUMPED!`;
        _endRound((pid + 1) % 2);
        return;
    }
    if (_phase !== 'fire') return;

    _tapped[pid] = true;
    _taps.push({ pid, t: performance.now() });
    if (_flushPending) return;
    _flushPending = true;
    _after(_resolveFire, TIE_WINDOW * 1000 + 5);
}

function _resolveFire() {
    if (_done || _phase !== 'fire') return;
    const first = Math.min(..._taps.map(t => t.t));
    const winners = [...new Set(_taps.filter(t => t.t - first <= TIE_WINDOW * 1000).map(t => t.pid))];
    if (winners.length !== 1) {
        // Dead heat — replay the round, no score.
        _banner = 'DEAD HEAT!';
        _phase = 'over';
        document.getElementById('mg-neutral').textContent = 'DEAD HEAT — REDRAW!';
        _after(() => { if (!_done) _startRound(); }, 1200);
        return;
    }
    sfx('coin_gain'); haptic([30]);
    _banner = `P${winners[0] + 1} FASTEST!`;
    _endRound(winners[0]);
}

function _endRound(winnerId) {
    _phase = 'over';
    if (winnerId >= 0) _wins[winnerId]++;
    document.getElementById('mg-neutral').textContent =
        `${_banner}   P1 ${_wins[0]} · ${_wins[1]} P2`;

    _after(() => {
        if (_done) return;
        if (_wins[0] >= WINS_NEEDED || _wins[1] >= WINS_NEEDED) _finish();
        else { _round++; _startRound(); }
    }, 1300);
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

    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const pad = Math.min(w, h) * 0.08;
    const zx = pad, zy = pad, zw = w - pad * 2, zh = h - pad * 2;

    // Zone fill reflects phase.
    let fill, label;
    if (_phase === 'fire')      { fill = 'rgba(74,222,128,0.22)'; label = 'TAP!'; }
    else if (_phase === 'arm')  { const p = 0.10 + 0.05 * Math.sin(_t * 4); fill = `rgba(239,68,68,${p})`; label = 'WAIT…'; }
    else                        { fill = 'rgba(255,255,255,0.05)'; label = _tapped[pid] ? '✓' : ''; }

    _roundRect(zx, zy, zw, zh, 18);
    _ctx.fillStyle = fill; _ctx.fill();
    _ctx.strokeStyle = _phase === 'fire' ? '#4ade80' : accent;
    _ctx.lineWidth = 3; _ctx.stroke();

    // Centre label
    _ctx.fillStyle = _phase === 'fire' ? '#4ade80' : 'rgba(255,255,255,0.8)';
    _ctx.font = '900 44px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(label, w / 2, h / 2);

    // Win pips (best of 3) + player tag
    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif';
    _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(`P${pid + 1}`, w / 2, zy + 26);
    for (let i = 0; i < WINS_NEEDED; i++) {
        _ctx.beginPath();
        _ctx.arc(w / 2 - 12 + i * 24, zy + 44, 7, 0, Math.PI * 2);
        _ctx.fillStyle = i < _wins[pid] ? accent : 'rgba(255,255,255,0.18)';
        _ctx.fill();
    }

    if (_phase === 'over' && _banner) {
        _ctx.fillStyle = '#fbbf24';
        _ctx.font = '900 24px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center';
        _ctx.fillText(_banner, w / 2, zy + zh - 22);
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
    const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winner < 0 ? 'DRAW!' : `P${winner + 1} WINS!`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1400);
}

function _destroy() {
    _done = true;
    _phase = 'over';
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t = 0;
}
