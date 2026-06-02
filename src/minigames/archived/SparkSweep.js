// Spark Sweep — Swipe to redirect sparks into the opponent's goal zone.
// Sparks drift freely. Score when a spark exits the opponent's edge.
// Most sparks scored in 20 seconds wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 20000;
const SPARK_COUNT   = 18;
const SPARK_R       = 8;
const SWIPE_RADIUS  = 55;
const SWIPE_FORCE   = 7;
const FRICTION      = 0.993;
const GOAL_H        = 22;

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastTime = 0;
let _sparks = [];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _sparks = []; _startTime = 0; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        _spawnSparks();
        if (_neutralEl) _neutralEl.textContent = 'SWIPE TO SWEEP SPARKS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a0a00;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _timerEl     = _mkLabel('20s',   '#fbbf24');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_timerEl);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.1rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _spawnSparks() {
    for (let i = 0; i < SPARK_COUNT; i++) {
        _sparks.push({
            x:     SPARK_R + Math.random() * (_W - SPARK_R * 2),
            y:     SPARK_R + Math.random() * (_H - SPARK_R * 2),
            vx:    (Math.random() - 0.5) * 2,
            vy:    (Math.random() - 0.5) * 2,
            hue:   30 + Math.random() * 50,
        });
    }
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    const pointerPos = new Map();
    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        pointerPos.set(e.pointerId, { x: e.clientX - cr.left, y: e.clientY - cr.top });
    };
    const onMove = e => {
        e.preventDefault();
        const prev = pointerPos.get(e.pointerId);
        if (!prev) return;
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left;
        const cy = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) { pointerPos.set(e.pointerId, { x: cx, y: cy }); return; }
        const swipeDx = cx - prev.x;
        const swipeDy = cy - prev.y;
        const swipeLen = Math.hypot(swipeDx, swipeDy);
        if (swipeLen < 3) { pointerPos.set(e.pointerId, { x: cx, y: cy }); return; }
        for (const s of _sparks) {
            if (Math.hypot(cx - s.x, cy - s.y) < SWIPE_RADIUS) {
                s.vx += (swipeDx / swipeLen) * SWIPE_FORCE;
                s.vy += (swipeDy / swipeLen) * SWIPE_FORCE;
            }
        }
        pointerPos.set(e.pointerId, { x: cx, y: cy });
    };
    const onUp = e => pointerPos.delete(e.pointerId);
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

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    // Bot AI: swipe sparks in P2 half upward (into P1 zone)
    if (_isBot && Math.random() < 0.04) {
        for (const s of _sparks) {
            if (s.y < _H / 2 && Math.random() < 0.3) {
                s.vy -= SWIPE_FORCE * 0.6;
                s.vx += (Math.random() - 0.5) * 2;
            }
        }
    }

    for (let i = _sparks.length - 1; i >= 0; i--) {
        const s = _sparks[i];
        s.vx *= FRICTION;
        s.vy *= FRICTION;
        s.x  += s.vx * dt;
        s.y  += s.vy * dt;

        // Wall bounce (sides)
        if (s.x - SPARK_R < 0)  { s.x = SPARK_R;      s.vx = Math.abs(s.vx); }
        if (s.x + SPARK_R > _W) { s.x = _W - SPARK_R; s.vx = -Math.abs(s.vx); }

        // Score and respawn
        if (s.y - SPARK_R < 0) {
            // Exited top = P1 scored
            _scores[0]++;
            if (_scoreEls[0]) _scoreEls[0].textContent = `P1: ${_scores[0]}`;
            sfx('coin_gain');
            _respawnSpark(s);
        } else if (s.y + SPARK_R > _H) {
            // Exited bottom = P2 scored
            _scores[1]++;
            if (_scoreEls[1]) _scoreEls[1].textContent = `P2: ${_scores[1]}`;
            sfx('coin_gain');
            _respawnSpark(s);
        }
    }

    _draw();
    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _respawnSpark(s) {
    s.x  = SPARK_R + Math.random() * (_W - SPARK_R * 2);
    s.y  = _H * 0.3 + Math.random() * _H * 0.4;
    s.vx = (Math.random() - 0.5) * 2;
    s.vy = (Math.random() - 0.5) * 2;
    s.hue = 30 + Math.random() * 50;
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Goal zones
    _ctx.fillStyle = 'rgba(255,59,59,0.15)';
    _ctx.fillRect(0, _H - GOAL_H, _W, GOAL_H);
    _ctx.fillStyle = 'rgba(59,130,255,0.15)';
    _ctx.fillRect(0, 0, _W, GOAL_H);

    _ctx.font = 'bold 9px sans-serif'; _ctx.textAlign = 'center';
    _ctx.fillStyle = 'rgba(255,59,59,0.5)';  _ctx.fillText('P2 SCORES ↓', _W/2, _H - 6);
    _ctx.fillStyle = 'rgba(59,130,255,0.5)'; _ctx.fillText('P1 SCORES ↑', _W/2, 13);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.07)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Sparks
    for (const s of _sparks) {
        const speed = Math.hypot(s.vx, s.vy);
        _ctx.fillStyle = `hsl(${s.hue}, 90%, 65%)`;
        _ctx.shadowColor = `hsl(${s.hue}, 90%, 65%)`; _ctx.shadowBlur = 10 + speed * 2;
        _ctx.beginPath(); _ctx.arc(s.x, s.y, SPARK_R + speed * 0.4, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.shadowBlur = 0;
}

function _resolve() {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
    if (_neutralEl) _neutralEl.textContent = winner >= 0
        ? `P${winner+1} WINS! ${_scores[0]}–${_scores[1]}`
        : `TIE! ${_scores[0]}–${_scores[1]}`;
    sfx(winner >= 0 ? 'mg_start' : 'land_good');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
