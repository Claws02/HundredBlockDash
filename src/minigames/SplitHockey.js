// Split Hockey — Slide your paddle to hit the puck into the opponent's goal.
// P1 defends the bottom, P2 the top. First to 5 points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE = 5;
const PUCK_R    = 14;
const PAD_W     = 90;
const PAD_H     = 12;
const FRICTION  = 0.993;
const SPEED_CAP = 18;
const GOAL_H    = 22;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _puck = null, _pads = [], _scoring = false;
let _scoreEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _scoring = false;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _resetPuck();
        if (_neutralEl) _neutralEl.textContent = 'SLIDE YOUR PADDLE!';
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
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.2rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _pads = [
        { x: _W / 2, y: _H - GOAL_H - PAD_H, pid: 0, prevX: _W / 2 },
        { x: _W / 2, y: GOAL_H + PAD_H,       pid: 1, prevX: _W / 2 },
    ];

    const pointerPid = new Map();
    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        pointerPid.set(e.pointerId, pid);
    };
    const onMove = e => {
        e.preventDefault();
        const pid = pointerPid.get(e.pointerId);
        if (pid === undefined || (_isBot && pid === 1)) return;
        const cr = _canvas.getBoundingClientRect();
        const nx = Math.max(PAD_W / 2, Math.min(_W - PAD_W / 2, e.clientX - cr.left));
        _pads[pid].prevX = _pads[pid].x;
        _pads[pid].x = nx;
    };
    const onUp = e => pointerPid.delete(e.pointerId);
    _canvas.addEventListener('pointerdown',   onDown);
    _canvas.addEventListener('pointermove',   onMove);
    _canvas.addEventListener('pointerup',     onUp);
    _canvas.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',   onDown);
        _canvas.removeEventListener('pointermove',   onMove);
        _canvas.removeEventListener('pointerup',     onUp);
        _canvas.removeEventListener('pointercancel', onUp);
    });
}

function _resetPuck() {
    _scoring = false;
    const dir = Math.random() < 0.5 ? 1 : -1;
    _puck = { x: _W / 2, y: _H / 2, vx: (Math.random() - 0.5) * 3, vy: dir * (4 + Math.random() * 2) };
}

function _tick() {
    if (_done || !state.mgActive) return;

    // Bot AI
    if (_isBot) {
        const bot = _pads[1];
        const target = _puck.y < _H / 2 ? _puck.x : _W / 2;
        bot.prevX = bot.x;
        bot.x += (target - bot.x) * 0.14;
    }

    _puck.vx *= FRICTION;
    _puck.vy *= FRICTION;
    _puck.x  += _puck.vx;
    _puck.y  += _puck.vy;

    // Side walls
    if (_puck.x - PUCK_R < 0)  { _puck.x = PUCK_R;      _puck.vx = Math.abs(_puck.vx); }
    if (_puck.x + PUCK_R > _W) { _puck.x = _W - PUCK_R; _puck.vx = -Math.abs(_puck.vx); }

    // Cap speed
    const spd = Math.hypot(_puck.vx, _puck.vy);
    if (spd > SPEED_CAP) { _puck.vx *= SPEED_CAP / spd; _puck.vy *= SPEED_CAP / spd; }

    // Paddle collisions
    for (const pad of _pads) {
        const padTop    = pad.y - PAD_H / 2;
        const padBottom = pad.y + PAD_H / 2;
        const padLeft   = pad.x - PAD_W / 2;
        const padRight  = pad.x + PAD_W / 2;
        if (_puck.x > padLeft - PUCK_R && _puck.x < padRight + PUCK_R &&
            _puck.y > padTop - PUCK_R  && _puck.y < padBottom + PUCK_R) {
            const offset = (_puck.x - pad.x) / (PAD_W / 2);
            const swing  = (pad.x - pad.prevX) * 0.5;
            _puck.vx = offset * 8 + swing;
            _puck.vy = pad.pid === 0 ? -Math.max(5, Math.abs(_puck.vy)) : Math.max(5, Math.abs(_puck.vy));
            _puck.y = pad.pid === 0 ? padTop - PUCK_R : padBottom + PUCK_R;
            sfx('land_good');
        }
    }

    if (!_scoring) {
        if (_puck.y - PUCK_R < GOAL_H) {
            _doScore(0); // P1 scored (puck entered P2 goal at top)
        } else if (_puck.y + PUCK_R > _H - GOAL_H) {
            _doScore(1); // P2 scored (puck entered P1 goal at bottom)
        }
    }

    _draw();
    _af = requestAnimationFrame(_tick);
}

function _doScore(scoringPid) {
    if (_scoring) return;
    _scoring = true;
    _scores[scoringPid]++;
    if (_scoreEls[scoringPid]) _scoreEls[scoringPid].textContent = `P${scoringPid + 1}: ${_scores[scoringPid]}`;
    sfx('mg_start');
    if (_neutralEl) _neutralEl.textContent = `P${scoringPid + 1} SCORES! ${_scores[0]}–${_scores[1]}`;
    if (_scores[scoringPid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        setTimeout(() => { _destroy(); _onWin(scoringPid); }, 1500);
        return;
    }
    setTimeout(() => {
        if (_done || !state.mgActive) return;
        _resetPuck();
        if (_neutralEl) _neutralEl.textContent = 'SLIDE YOUR PADDLE!';
    }, 1500);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goals
    _ctx.fillStyle = 'rgba(255,59,59,0.18)';
    _ctx.fillRect(0, _H - GOAL_H, _W, GOAL_H);
    _ctx.fillStyle = 'rgba(59,142,255,0.18)';
    _ctx.fillRect(0, 0, _W, GOAL_H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Paddles
    const pColors = ['#ff3b3b', '#3b8eff'];
    for (const pad of _pads) {
        _ctx.fillStyle = pColors[pad.pid]; _ctx.shadowColor = pColors[pad.pid]; _ctx.shadowBlur = 14;
        _ctx.beginPath();
        _ctx.roundRect(pad.x - PAD_W/2, pad.y - PAD_H/2, PAD_W, PAD_H, 6);
        _ctx.fill(); _ctx.shadowBlur = 0;
    }

    // Puck
    _ctx.fillStyle = '#ffffff'; _ctx.shadowColor = '#ffffff'; _ctx.shadowBlur = 20;
    _ctx.beginPath(); _ctx.arc(_puck.x, _puck.y, PUCK_R, 0, Math.PI * 2); _ctx.fill();
    _ctx.shadowBlur = 0;
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
