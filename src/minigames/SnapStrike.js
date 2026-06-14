// ============================================================
// SNAP STRIKE — precision timing duel. A needle sweeps each
// player's bar; tap to lock it on the bullseye. Closest to centre
// scores PERFECT (3) / GREAT (2) / GOOD (1) / MISS (0). Five rounds,
// the bar speeds up and the target shrinks each round. Highest total
// wins — most-points-over-rounds keeps it comeback-friendly.
//
// Reference implementation for docs/MINIGAME_STANDARD.md.
// Built on src/minigames/_template.js.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const ROUNDS        = 5;
const ROUND_TIME    = 4.0;   // s — auto-miss if a player never taps
const BASE_RATE     = 0.55;  // sweeps/s at round 0 (1 unit = bar end-to-end)
const RATE_PER_ROUND= 0.16;  // speed-up per round
const HW_START      = 0.16;  // target half-width (fraction of bar) at round 0
const HW_PER_ROUND  = 0.018; // shrink per round
const PERFECT_FRAC  = 0.20;  // |d| ≤ hw*0.20 → PERFECT
const GREAT_FRAC    = 0.55;  // |d| ≤ hw*0.55 → GREAT
const BOT_MAX_ERR   = 0.24;  // worst-case bot aim error (fraction of bar)

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;

let _round = 0;
let _scores = [0, 0];
let _roundActive = false;
let _phase = 0, _pos = 0.5, _prevPos = 0.5;
let _rate = BASE_RATE, _hw = HW_START, _center = 0.5;
let _roundElapsed = 0;
let _locked = [null, null];   // locked position per player, or null
let _result = [null, null];   // { score, label } per player, or null
let _bot = null;              // { desired, reactDelay, done }

const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// Rough gaussian in roughly [-1, 1].
function _gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

// Triangle wave: phase → position in [0, 1], ping-ponging.
function _triangle(x) { const m = x % 2; return 1 - Math.abs((m < 0 ? m + 2 : m) - 1); }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _round = 0; _scores = [0, 0];
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
        if (_done || !_roundActive) return;
        e.preventDefault();
        const pid = e.clientY > _overlay.clientHeight / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;
        _lock(pid, _pos);
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
    _roundActive = true;
    _roundElapsed = 0;
    _locked = [null, null];
    _result = [null, null];
    _rate   = BASE_RATE + RATE_PER_ROUND * _round;
    _hw     = Math.max(0.06, HW_START - HW_PER_ROUND * _round);
    _center = 0.22 + Math.random() * 0.56;   // keep target off the very edges
    _phase  = Math.random() * 2;             // random start so it isn't memorisable
    _pos = _prevPos = _triangle(_phase);

    // Bot plans this round: aim for centre with skill-scaled error, plus a
    // reaction delay and an occasional whiff. Always noisy (§5).
    if (_isBot) {
        const whiff = Math.random() < 0.30 * (1 - _botSkill);
        const err   = (1 - _botSkill) * BOT_MAX_ERR * _gauss();
        _bot = {
            desired: whiff ? Math.random() : Math.min(0.98, Math.max(0.02, _center + err)),
            reactDelay: 0.35 + (1 - _botSkill) * 0.7 + Math.random() * 0.25,
            done: false,
        };
    } else {
        _bot = null;
    }

    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round + 1}/${ROUNDS} — SNAP THE BULLSEYE!`;
    sfx('countdown');
}

function _lock(pid, pos) {
    if (_locked[pid] !== null) return;
    _locked[pid] = pos;
    const d = Math.abs(pos - _center);
    let score, label;
    if      (d <= _hw * PERFECT_FRAC) { score = 3; label = 'PERFECT'; }
    else if (d <= _hw * GREAT_FRAC)   { score = 2; label = 'GREAT'; }
    else if (d <= _hw)                { score = 1; label = 'GOOD'; }
    else                              { score = 0; label = 'MISS'; }
    _result[pid] = { score, label };
    _scores[pid] += score;
    sfx(score >= 2 ? 'coin_gain' : score === 1 ? 'land_good' : 'land_bad');
    haptic(score >= 2 ? [40] : score === 1 ? [20] : [60]);

    if (_locked[0] !== null && _locked[1] !== null) _endRound();
}

function _endRound() {
    if (!_roundActive) return;
    _roundActive = false;
    // Anyone who never tapped misses.
    [0, 1].forEach(pid => { if (_result[pid] === null) _result[pid] = { score: 0, label: 'MISS' }; });

    document.getElementById('mg-neutral').textContent =
        `P1 ${_scores[0]}  —  P2 ${_scores[1]}`;

    _after(() => {
        if (_done) return;
        _round++;
        if (_round >= ROUNDS) _finish();
        else _startRound();
    }, 1300);
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;

    if (_roundActive) {
        _prevPos = _pos;
        _phase  += _rate * dt;
        _pos     = _triangle(_phase);
        _roundElapsed += dt;

        if (_isBot && _bot && !_bot.done && _locked[1] === null && _roundElapsed >= _bot.reactDelay) {
            // Lock when the needle crosses the bot's intended position this frame.
            const lo = Math.min(_prevPos, _pos), hi = Math.max(_prevPos, _pos);
            if (_bot.desired >= lo && _bot.desired <= hi) {
                _bot.done = true;
                _lock(1, _bot.desired);
            }
        }

        if (_roundActive && _roundElapsed >= ROUND_TIME) _endRound();
    }

    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    // Centre divider
    _ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();

    // P2 (top) — rotated 180° so it reads upright for them.
    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    // P1 (bottom)
    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();
}

// Draws a player's identical bar into a (w × h) box with origin at top-left.
function _drawHalf(pid, w, h) {
    const color  = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const margin = w * 0.10;
    const barW   = w - margin * 2;
    const barY   = h * 0.55;
    const x = t => margin + t * barW;

    // Track
    _ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    _ctx.lineWidth = 6; _ctx.lineCap = 'round';
    _ctx.beginPath(); _ctx.moveTo(x(0), barY); _ctx.lineTo(x(1), barY); _ctx.stroke();

    // Target band + bullseye
    _ctx.strokeStyle = 'rgba(255,210,80,0.45)';
    _ctx.lineWidth = 16;
    _ctx.beginPath();
    _ctx.moveTo(x(Math.max(0, _center - _hw)), barY);
    _ctx.lineTo(x(Math.min(1, _center + _hw)), barY);
    _ctx.stroke();
    _ctx.fillStyle = '#ffd24a';
    _ctx.beginPath(); _ctx.arc(x(_center), barY, 7, 0, Math.PI * 2); _ctx.fill();

    // Locked marker
    if (_locked[pid] !== null) {
        _ctx.strokeStyle = '#ffffff';
        _ctx.lineWidth = 4;
        _ctx.beginPath(); _ctx.moveTo(x(_locked[pid]), barY - 26); _ctx.lineTo(x(_locked[pid]), barY + 26); _ctx.stroke();
    }

    // Live needle (only while this player hasn't locked and the round is live)
    if (_roundActive && _locked[pid] === null) {
        _ctx.strokeStyle = color;
        _ctx.lineWidth = 5; _ctx.shadowColor = color; _ctx.shadowBlur = 12;
        _ctx.beginPath(); _ctx.moveTo(x(_pos), barY - 30); _ctx.lineTo(x(_pos), barY + 30); _ctx.stroke();
        _ctx.shadowBlur = 0;
    }

    // Labels: title + running score + this round's result
    _ctx.fillStyle = color;
    _ctx.font = '700 22px Nunito, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.fillText(`P${pid + 1}`, w / 2, h * 0.22);
    _ctx.fillStyle = 'rgba(255,255,255,0.85)';
    _ctx.font = '900 30px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_scores[pid]}`, w / 2, h * 0.40);

    if (_result[pid]) {
        const r = _result[pid];
        _ctx.fillStyle = r.score >= 2 ? '#4ade80' : r.score === 1 ? '#fbbf24' : '#ef4444';
        _ctx.font = '900 26px "Bebas Neue", sans-serif';
        _ctx.fillText(r.label, w / 2, barY + 60);
    }
}

// ── End ───────────────────────────────────────────────────────────────────────
function _finish() {
    if (_done) return;
    _done = true;
    _roundActive = false;
    state.mgActive = false;
    const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent =
        winner < 0 ? `DRAW! ${_scores[0]}-${_scores[1]}` : `P${winner + 1} WINS! ${_scores[0]}-${_scores[1]}`;
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner); }, 1500);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _roundActive = false;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _bot = null;
}
