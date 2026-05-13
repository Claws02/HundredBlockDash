// Pulse Pusher — Tap rapidly to push the energy core toward the opponent.
// The core shifts based on tap rate. Push it fully into their zone to score.
// Best of 5 rounds (first to 3 wins).
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_ROUNDS  = 3;
const PUSH_FORCE  = 18;
const DECAY       = 0.94;
const GOAL_THRESH = 0.15;

let _done = false, _wins = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _coreY = 0, _velocity = 0;
let _tapTimes = [[], []];
let _roundActive = false;
let _winsEls = [null, null], _neutralEl = null;
let _botInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _tapTimes = [[], []]; _roundActive = false;
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
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a1a0a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _winsEls[1] = _mkLabel('P2: 0 wins', '#93c5fd');
    _winsEls[0] = _mkLabel('P1: 0 wins', '#fca5a5');
    hud.appendChild(_winsEls[1]);
    hud.appendChild(_winsEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.9rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _startRound() {
    _coreY = _H / 2;
    _velocity = 0;
    _tapTimes = [[], []];
    _roundActive = true;
    if (_neutralEl) _neutralEl.textContent = 'TAP FAST TO PUSH THE CORE!';
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
        _tapTimes[pid].push(performance.now());
        _velocity += pid === 0 ? -PUSH_FORCE : PUSH_FORCE;
        sfx('coin_gain');
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));

    if (_isBot) {
        _botInterval = setInterval(() => {
            if (!_roundActive || _done || !state.mgActive) return;
            _tapTimes[1].push(performance.now());
            _velocity += PUSH_FORCE;
        }, 80 + Math.random() * 40);
        _cleanups.push(() => { clearInterval(_botInterval); _botInterval = null; });
    }
}

function _getTapRate(pid, now) {
    const windowMs = 500;
    _tapTimes[pid] = _tapTimes[pid].filter(t => now - t < windowMs);
    return _tapTimes[pid].length;
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    if (_roundActive) {
        _velocity *= DECAY;
        _coreY += _velocity * 0.06;
        _coreY = Math.max(_H * GOAL_THRESH, Math.min(_H * (1 - GOAL_THRESH), _coreY));

        // Score check
        if (_coreY <= _H * GOAL_THRESH) {
            _roundWin(0);
        } else if (_coreY >= _H * (1 - GOAL_THRESH)) {
            _roundWin(1);
        }
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _roundWin(pid) {
    _roundActive = false;
    _wins[pid]++;
    if (_winsEls[pid]) _winsEls[pid].textContent = `P${pid + 1}: ${_wins[pid]} wins`;
    sfx('mg_start');

    if (_wins[pid] >= WIN_ROUNDS) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} WINS THE PUSH!`;
        setTimeout(() => { _destroy(); _onWin(pid); }, 1500);
        return;
    }
    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES! ${_wins[0]}–${_wins[1]}`;
    setTimeout(() => { if (!_done && state.mgActive) _startRound(); }, 1600);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goal zones
    const goalH = _H * GOAL_THRESH;
    _ctx.fillStyle = 'rgba(255,59,59,0.15)';
    _ctx.fillRect(0, _H - goalH, _W, goalH);
    _ctx.fillStyle = 'rgba(59,130,255,0.15)';
    _ctx.fillRect(0, 0, _W, goalH);

    _ctx.font = 'bold 9px sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillStyle = 'rgba(255,59,59,0.5)';  _ctx.fillText('P1 ZONE', _W/2, _H - 5);
    _ctx.fillStyle = 'rgba(59,130,255,0.5)'; _ctx.fillText('P2 ZONE', _W/2, 12);

    // Track line
    _ctx.strokeStyle = 'rgba(255,255,255,0.12)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(_W/2, goalH); _ctx.lineTo(_W/2, _H - goalH); _ctx.stroke();

    // Core
    const coreR = 26;
    const coreGlow = _ctx.createRadialGradient(_W/2, _coreY, 0, _W/2, _coreY, coreR * 2.5);
    coreGlow.addColorStop(0, 'rgba(100,255,100,0.4)');
    coreGlow.addColorStop(1, 'transparent');
    _ctx.fillStyle = coreGlow;
    _ctx.beginPath(); _ctx.arc(_W/2, _coreY, coreR * 2.5, 0, Math.PI * 2); _ctx.fill();

    _ctx.fillStyle = '#66ff66'; _ctx.shadowColor = '#66ff66'; _ctx.shadowBlur = 28;
    _ctx.beginPath(); _ctx.arc(_W/2, _coreY, coreR, 0, Math.PI * 2); _ctx.fill();
    _ctx.shadowBlur = 0;

    // Tap rate indicators
    const rate0 = _getTapRate(0, now);
    const rate1 = _getTapRate(1, now);
    for (let pid = 0; pid < 2; pid++) {
        const rate = pid === 0 ? rate0 : rate1;
        const y    = pid === 0 ? _H * 0.85 : _H * 0.15;
        const color = pid === 0 ? '#fca5a5' : '#93c5fd';
        _ctx.fillStyle = color; _ctx.font = `bold ${10 + rate * 2}px sans-serif`; _ctx.textAlign = 'center';
        _ctx.fillText('TAP!'.repeat(Math.min(rate, 3) || 0).slice(0, 12) || 'tap...', _W/2, y);
    }
}

function _destroy() {
    clearInterval(_botInterval); _botInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _winsEls = [null, null];
}
