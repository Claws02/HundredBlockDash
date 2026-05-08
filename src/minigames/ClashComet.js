// Clash Comet — Tap your half when the comet is near you to deflect it.
// The comet speeds up each time it's struck. Score when it exits the opponent's edge.
// First to 5 wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE  = 5;
const COMET_R    = 18;
const BASE_SPEED = 5;
const SPEED_INC  = 0.6;
const TAP_RADIUS = 60;
const FRICTION   = 0.999;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null;
let _comet = null, _hits = 0, _scoring = false;
let _trail = [];
let _scoreEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _hits = 0; _scoring = false; _trail = [];
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _resetComet();
        if (_neutralEl) _neutralEl.textContent = 'TAP TO DEFLECT THE COMET!';
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#04040e;';
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

function _resetComet() {
    _scoring = false; _hits = 0; _trail = [];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const spd = BASE_SPEED;
    _comet = {
        x:  _W / 2 + (Math.random() - 0.5) * _W * 0.3,
        y:  _H / 2,
        vx: (Math.random() - 0.5) * spd * 0.6,
        vy: dir * spd,
    };
}

function _deflect(pid) {
    if (_scoring) return;
    const inMyHalf = pid === 0 ? _comet.y > _H / 2 : _comet.y < _H / 2;
    if (!inMyHalf) return;
    const dist = Math.hypot(_comet.x - _W / 2, _comet.y - (pid === 0 ? _H * 0.8 : _H * 0.2));
    if (dist > TAP_RADIUS + COMET_R + 30) return;

    _hits++;
    const spd = BASE_SPEED + _hits * SPEED_INC;
    const dir = pid === 0 ? -1 : 1;  // send it toward opponent
    _comet.vy = dir * spd;
    _comet.vx += (Math.random() - 0.5) * spd * 0.5;
    sfx('land_good');
    if (_neutralEl) _neutralEl.textContent = _hits >= 3 ? '⚡ SUPERCHARGED COMET!' : 'TAP TO DEFLECT!';
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
        if (_done || _scoring) return;
        const cr = _canvas.getBoundingClientRect();
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _deflect(pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _tick() {
    if (_done || !state.mgActive) return;

    if (!_scoring) {
        _comet.vx *= FRICTION;
        _comet.x  += _comet.vx;
        _comet.y  += _comet.vy;

        // Trail
        _trail.push({ x: _comet.x, y: _comet.y });
        if (_trail.length > 16) _trail.shift();

        // Side bounces
        if (_comet.x - COMET_R < 0)  { _comet.x = COMET_R;      _comet.vx = Math.abs(_comet.vx); }
        if (_comet.x + COMET_R > _W) { _comet.x = _W - COMET_R; _comet.vx = -Math.abs(_comet.vx); }

        // Bot deflects
        if (_isBot && _comet.y < _H / 2 && _comet.vy < 0 && Math.random() < 0.05) {
            _deflect(1);
        }

        // Score check
        if (_comet.y - COMET_R < 0) {
            _doScore(0); // P1 scored (comet exits P2's side)
        } else if (_comet.y + COMET_R > _H) {
            _doScore(1); // P2 scored (comet exits P1's side)
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
        _resetComet();
        if (_neutralEl) _neutralEl.textContent = 'TAP TO DEFLECT THE COMET!';
    }, 1500);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 50; i++) _ctx.fillRect((i * 137 + 13) % _W, (i * 73 + 29) % _H, 1.5, 1.5);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Tap zones (guide circles)
    const tapGuideColors = ['rgba(255,59,59,0.07)', 'rgba(59,130,255,0.07)'];
    for (let pid = 0; pid < 2; pid++) {
        const cy = pid === 0 ? _H * 0.8 : _H * 0.2;
        _ctx.fillStyle = tapGuideColors[pid];
        _ctx.beginPath(); _ctx.arc(_W/2, cy, TAP_RADIUS + COMET_R + 30, 0, Math.PI * 2); _ctx.fill();
    }

    // Comet trail
    for (let i = 0; i < _trail.length; i++) {
        const t     = _trail[i];
        const alpha = (i / _trail.length) * 0.7;
        const heat  = _hits >= 3 ? 'orange' : 'cyan';
        _ctx.fillStyle = heat === 'orange' ? `rgba(255,140,0,${alpha})` : `rgba(100,200,255,${alpha})`;
        _ctx.beginPath(); _ctx.arc(t.x, t.y, COMET_R * (i / _trail.length) * 0.9, 0, Math.PI * 2); _ctx.fill();
    }

    // Comet
    const cometColor = _hits >= 3 ? '#ff8c00' : '#aaeeff';
    _ctx.fillStyle = cometColor; _ctx.shadowColor = cometColor; _ctx.shadowBlur = 28;
    _ctx.beginPath(); _ctx.arc(_comet.x, _comet.y, COMET_R, 0, Math.PI * 2); _ctx.fill();
    _ctx.shadowBlur = 0;
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
