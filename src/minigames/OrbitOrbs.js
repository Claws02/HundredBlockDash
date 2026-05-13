// Orbit Orbs — Move your collector to grab glowing orbs orbiting the center star.
// P1 controls the bottom half, P2 the top. Orbs respawn after collection.
// Most orbs collected in 20 seconds wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 20000;
const COLLECTOR_R   = 22;
const ORB_R         = 9;
const ORB_COUNT     = 14;
const RESPAWN_MS    = 400;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0;
let _collectors = [], _orbs = [];
let _scores = [0, 0];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _scores = [0, 0]; _orbs = []; _startTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'COLLECT THE ORBS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a2e;';
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

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _collectors = [
        { x: _W / 2, y: _H * 0.78, pid: 0 },
        { x: _W / 2, y: _H * 0.22, pid: 1 },
    ];

    for (let i = 0; i < ORB_COUNT; i++) {
        _orbs.push({
            angle:     (i / ORB_COUNT) * Math.PI * 2,
            r:         55 + Math.random() * 90,
            speed:     0.009 + Math.random() * 0.015,
            color:     `hsl(${i * 26}, 80%, 60%)`,
            cx: 0, cy: 0,
            collected: false, collectedAt: 0,
        });
    }

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
        const cx = e.clientX - cr.left;
        const cy = e.clientY - cr.top;
        _collectors[pid].x = Math.max(COLLECTOR_R, Math.min(_W - COLLECTOR_R, cx));
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

    // Respawn collected orbs
    for (const orb of _orbs) {
        if (orb.collected && now - orb.collectedAt > RESPAWN_MS) {
            orb.collected = false;
            orb.angle = Math.random() * Math.PI * 2;
            orb.r     = 55 + Math.random() * 90;
            orb.color = `hsl(${Math.random() * 360}, 80%, 60%)`;
        }
    }

    // Update orb positions and check collection
    for (const orb of _orbs) {
        if (orb.collected) continue;
        orb.angle += orb.speed;
        orb.cx = _W / 2 + Math.cos(orb.angle) * orb.r;
        orb.cy = _H / 2 + Math.sin(orb.angle) * orb.r;
        for (const c of _collectors) {
            if (Math.hypot(c.x - orb.cx, c.y - orb.cy) < COLLECTOR_R + ORB_R) {
                orb.collected = true; orb.collectedAt = now;
                _scores[c.pid]++;
                if (_scoreEls[c.pid]) _scoreEls[c.pid].textContent = `P${c.pid + 1}: ${_scores[c.pid]}`;
                sfx('coin_gain');
                break;
            }
        }
    }

    // Bot chases nearest orb in top half
    if (_isBot) {
        let nearest = null, nd = Infinity;
        for (const orb of _orbs) {
            if (orb.collected || orb.cy > _H / 2) continue;
            const d = Math.hypot(_collectors[1].x - orb.cx, _collectors[1].y - orb.cy);
            if (d < nd) { nd = d; nearest = orb; }
        }
        if (nearest) {
            _collectors[1].x += (nearest.cx - _collectors[1].x) * 0.13;
            _collectors[1].y += (nearest.cy - _collectors[1].y) * 0.13;
        }
    }

    _draw();
    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 40; i++) _ctx.fillRect((i * 137) % _W, (i * 91) % _H, 1, 1);

    const g = _ctx.createRadialGradient(_W/2, _H/2, 0, _W/2, _H/2, 42);
    g.addColorStop(0, 'rgba(255,240,140,1)'); g.addColorStop(1, 'transparent');
    _ctx.fillStyle = g;
    _ctx.beginPath(); _ctx.arc(_W/2, _H/2, 42, 0, Math.PI * 2); _ctx.fill();

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    for (const orb of _orbs) {
        if (orb.collected || !orb.cx) continue;
        _ctx.fillStyle = orb.color; _ctx.shadowColor = orb.color; _ctx.shadowBlur = 14;
        _ctx.beginPath(); _ctx.arc(orb.cx, orb.cy, ORB_R, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.shadowBlur = 0;

    const colors = ['#ff3b3b', '#3b8eff'];
    for (const c of _collectors) {
        _ctx.fillStyle = colors[c.pid]; _ctx.shadowColor = colors[c.pid]; _ctx.shadowBlur = 18;
        _ctx.beginPath(); _ctx.arc(c.x, c.y, COLLECTOR_R, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
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
