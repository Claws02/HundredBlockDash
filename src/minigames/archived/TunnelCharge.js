// Tunnel Charge — Tap as fast as you can to charge your beam.
// First player to full charge wins the round. Best of 5 (first to 3).
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_ROUNDS    = 3;
const TARGET_TAPS   = 40;
const DECAY_RATE    = 0.006;

let _done = false, _wins = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _charge = [0, 0], _roundActive = false;
let _winsEls = [null, null], _neutralEl = null;
let _botTapInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _charge = [0, 0]; _roundActive = false;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a12;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _winsEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _winsEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_winsEls[1]);
    hud.appendChild(_winsEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.1rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _startRound() {
    _charge = [0, 0];
    _roundActive = true;
    if (_neutralEl) _neutralEl.textContent = 'TAP FAST TO CHARGE YOUR BEAM!';
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    const onTap = e => {
        e.preventDefault();
        if (!_roundActive || _done) return;
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _charge[pid] = Math.min(1, _charge[pid] + 1 / TARGET_TAPS);
        sfx('coin_gain');
        if (_charge[pid] >= 1) _roundWin(pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));

    if (_isBot) {
        _botTapInterval = setInterval(() => {
            if (!_roundActive || _done || !state.mgActive) return;
            _charge[1] = Math.min(1, _charge[1] + 1 / TARGET_TAPS);
            if (_charge[1] >= 1) _roundWin(1);
        }, 55 + Math.random() * 25);
        _cleanups.push(() => { clearInterval(_botTapInterval); _botTapInterval = null; });
    }
}

function _tick() {
    if (_done || !state.mgActive) return;

    // Slow decay so you have to keep tapping
    if (_roundActive) {
        _charge[0] = Math.max(0, _charge[0] - DECAY_RATE);
        _charge[1] = Math.max(0, _charge[1] - DECAY_RATE);
    }

    _draw();
    _af = requestAnimationFrame(_tick);
}

function _roundWin(pid) {
    if (!_roundActive) return;
    _roundActive = false;
    _wins[pid]++;
    if (_winsEls[pid]) _winsEls[pid].textContent = `P${pid + 1}: ${_wins[pid]}`;
    sfx('mg_start');

    if (_wins[pid] >= WIN_ROUNDS) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} WINS THE CHARGE!`;
        setTimeout(() => { _destroy(); _onWin(pid); }, 1500);
        return;
    }
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} CHARGES THROUGH! ${_wins[0]}–${_wins[1]}`;
    setTimeout(() => { if (!_done && state.mgActive) _startRound(); }, 1500);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.1)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    const tunnelW = 60;
    _ctx.strokeStyle = 'rgba(255,255,255,0.06)'; _ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
        const y = _H/2 - tunnelW/2 - i * 12;
        _ctx.beginPath(); _ctx.moveTo(_W*0.1, y); _ctx.lineTo(_W*0.9, y); _ctx.stroke();
        const y2 = _H/2 + tunnelW/2 + i * 12;
        _ctx.beginPath(); _ctx.moveTo(_W*0.1, y2); _ctx.lineTo(_W*0.9, y2); _ctx.stroke();
    }

    // Charge bars — P1 fills upward from center, P2 fills downward from center
    const barH = _H * 0.38;
    const barW = 40;
    const barX = _W / 2 - barW / 2;

    // P1 charge (bottom half)
    const p1H = barH * _charge[0];
    _ctx.fillStyle = 'rgba(255,255,255,0.06)';
    _ctx.fillRect(barX, _H/2, barW, barH);
    const g1 = _ctx.createLinearGradient(0, _H/2 + barH, 0, _H/2);
    g1.addColorStop(0, '#ff3b3b'); g1.addColorStop(1, '#ff9999');
    _ctx.fillStyle = g1;
    _ctx.shadowColor = '#ff3b3b'; _ctx.shadowBlur = 20 * _charge[0];
    _ctx.fillRect(barX, _H/2 + barH - p1H, barW, p1H);
    _ctx.shadowBlur = 0;

    // P2 charge (top half)
    const p2H = barH * _charge[1];
    _ctx.fillStyle = 'rgba(255,255,255,0.06)';
    _ctx.fillRect(barX, _H/2 - barH, barW, barH);
    const g2 = _ctx.createLinearGradient(0, _H/2, 0, _H/2 - barH);
    g2.addColorStop(0, '#3b8eff'); g2.addColorStop(1, '#99ccff');
    _ctx.fillStyle = g2;
    _ctx.shadowColor = '#3b8eff'; _ctx.shadowBlur = 20 * _charge[1];
    _ctx.fillRect(barX, _H/2 - p2H, barW, p2H);
    _ctx.shadowBlur = 0;

    // Pulse at center when both active
    const pulse = (_charge[0] + _charge[1]) / 2;
    if (pulse > 0) {
        _ctx.fillStyle = `rgba(255,255,255,${pulse * 0.3})`;
        _ctx.beginPath(); _ctx.arc(_W/2, _H/2, 16 + pulse * 20, 0, Math.PI * 2); _ctx.fill();
    }

    // Percentage labels
    _ctx.font = 'bold 12px sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillStyle = '#fca5a5';
    _ctx.fillText(`${Math.round(_charge[0]*100)}%`, _W/2, _H * 0.88);
    _ctx.fillStyle = '#93c5fd';
    _ctx.fillText(`${Math.round(_charge[1]*100)}%`, _W/2, _H * 0.12);
}

function _destroy() {
    clearInterval(_botTapInterval); _botTapInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _winsEls = [null, null];
}
