// Dash Dots — Collect only your colored dots. Wrong color = 2 second stun.
// P1 collects red dots, P2 collects blue dots. Dots appear on both halves.
// Most correct dots in 20 seconds wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 20000;
const COLLECTOR_R   = 22;
const DOT_R         = 11;
const DOT_COUNT     = 10;
const STUN_MS       = 2000;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0;
let _collectors = [], _dots = [];
let _scores = [0, 0];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _scores = [0, 0]; _dots = []; _startTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'COLLECT YOUR COLOR DOTS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0e0e0e;';
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

function _spawnDots() {
    _dots = [];
    for (let i = 0; i < DOT_COUNT; i++) {
        const pid = i % 2; // alternating red/blue
        _dots.push({
            x: DOT_R + Math.random() * (_W - DOT_R * 2),
            y: DOT_R + Math.random() * (_H - DOT_R * 2),
            pid,
            active: true,
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

    _collectors = [
        { x: _W / 2, y: _H * 0.78, pid: 0, stunUntil: 0 },
        { x: _W / 2, y: _H * 0.22, pid: 1, stunUntil: 0 },
    ];
    _spawnDots();

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
        _collectors[pid].x = Math.max(COLLECTOR_R, Math.min(_W - COLLECTOR_R, e.clientX - cr.left));
        const cy = e.clientY - cr.top;
        const minY = pid === 0 ? _H / 2 + COLLECTOR_R : COLLECTOR_R;
        const maxY = pid === 0 ? _H - COLLECTOR_R     : _H / 2 - COLLECTOR_R;
        _collectors[pid].y = Math.max(minY, Math.min(maxY, cy));
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

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    // Bot chases its own dots (pid=1 = blue)
    if (_isBot) {
        let nearest = null, nd = Infinity;
        for (const d of _dots) {
            if (!d.active || d.pid !== 1) continue;
            const dist = Math.hypot(_collectors[1].x - d.x, _collectors[1].y - d.y);
            if (dist < nd) { nd = dist; nearest = d; }
        }
        if (nearest) {
            _collectors[1].x += (nearest.x - _collectors[1].x) * 0.14;
            _collectors[1].y += (nearest.y - _collectors[1].y) * 0.14;
        }
    }

    for (const c of _collectors) {
        if (now < c.stunUntil) continue;
        for (const d of _dots) {
            if (!d.active) continue;
            if (Math.hypot(c.x - d.x, c.y - d.y) < COLLECTOR_R + DOT_R) {
                d.active = false;
                if (d.pid === c.pid) {
                    _scores[c.pid]++;
                    if (_scoreEls[c.pid]) _scoreEls[c.pid].textContent = `P${c.pid + 1}: ${_scores[c.pid]}`;
                    sfx('coin_gain');
                } else {
                    c.stunUntil = now + STUN_MS;
                    sfx('land_bad');
                }
                // Respawn dot elsewhere
                setTimeout(() => {
                    d.x = DOT_R + Math.random() * (_W - DOT_R * 2);
                    d.y = DOT_R + Math.random() * (_H - DOT_R * 2);
                    d.pid = Math.random() < 0.5 ? 0 : 1;
                    d.active = true;
                }, 600);
            }
        }
    }

    _draw(now);
    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.06)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Dots
    const dotColors = ['#ff5555', '#5599ff'];
    for (const d of _dots) {
        if (!d.active) continue;
        _ctx.fillStyle = dotColors[d.pid]; _ctx.shadowColor = dotColors[d.pid]; _ctx.shadowBlur = 12;
        _ctx.beginPath(); _ctx.arc(d.x, d.y, DOT_R, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.shadowBlur = 0;

    // Collectors
    const cColors = ['#ff3b3b', '#3b8eff'];
    for (const c of _collectors) {
        const stunned = now < c.stunUntil;
        _ctx.fillStyle = stunned ? '#888888' : cColors[c.pid];
        _ctx.shadowColor = stunned ? '#888888' : cColors[c.pid]; _ctx.shadowBlur = stunned ? 6 : 18;
        _ctx.beginPath(); _ctx.arc(c.x, c.y, COLLECTOR_R, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
        if (stunned) {
            _ctx.fillStyle = '#fff'; _ctx.font = '14px sans-serif'; _ctx.textAlign = 'center';
            _ctx.fillText('✕', c.x, c.y + 5);
        }
    }
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
