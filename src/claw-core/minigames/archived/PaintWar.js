// Territory Control — Paint as much of the canvas as possible.
// P1 (red) drags bottom half, P2 (blue) drags top half.
// Most painted area after 15 seconds wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 15000;
const BRUSH_RADIUS  = 25;
const SAMPLE_STEP   = 6;   // subsample every 6th pixel for score — cheap on mobile

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0;
let _af = null, _startTime = 0;
let _paintGrid = null, _paintCtx = null;
let _activePointers = new Map();
let _timerEl = null, _scoreEls = [null, null], _neutralEl = null;
let _frameCount = 0;
let _cachedPcts = [0, 0];    // updated every 20 frames
let _botPath = null, _botStep = 0;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _startTime = 0; _activePointers = new Map();
    _botPath = null; _botStep = 0; _frameCount = 0; _cachedPcts = [0, 0];
    _neutralEl = document.getElementById('mg-neutral');

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'PAINT THE CANVAS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a1a2e;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);

    const hud = document.createElement('div');
    hud.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:flex-start;
        padding:6px 14px;box-sizing:border-box;
    `;
    _scoreEls[1] = _mkLabel('P2: 0%', '#93c5fd');
    _timerEl     = _mkLabel('15.0s',  '#fbbf24');
    _scoreEls[0] = _mkLabel('P1: 0%', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_timerEl);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
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

    // Offscreen paint grid (CSS-pixel resolution — no DPR needed, just colour tracking)
    _paintGrid = document.createElement('canvas');
    _paintGrid.width  = _W;
    _paintGrid.height = _H;
    _paintCtx = _paintGrid.getContext('2d');
    _paintCtx.fillStyle = '#1a1a2e';
    _paintCtx.fillRect(0, 0, _W, _H);

    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left, cy = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        _activePointers.set(e.pointerId, { pid, x: cx, y: cy });
        _paint(cx, cy, pid);
    };
    const onMove = e => {
        e.preventDefault();
        if (!_activePointers.has(e.pointerId)) return;
        const cr  = _canvas.getBoundingClientRect();
        const ptr = _activePointers.get(e.pointerId);
        if (_isBot && ptr.pid === 1) return;
        ptr.x = e.clientX - cr.left;
        ptr.y = e.clientY - cr.top;
        _paint(ptr.x, ptr.y, ptr.pid);
    };
    const onUp = e => _activePointers.delete(e.pointerId);

    _canvas.addEventListener('pointerdown',  onDown);
    _canvas.addEventListener('pointermove',  onMove);
    _canvas.addEventListener('pointerup',    onUp);
    _canvas.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',  onDown);
        _canvas.removeEventListener('pointermove',  onMove);
        _canvas.removeEventListener('pointerup',    onUp);
        _canvas.removeEventListener('pointercancel', onUp);
    });

    if (_isBot) _botPath = _generateBotPath();
}

function _paint(x, y, pid) {
    _paintCtx.fillStyle = pid === 0 ? '#ff3b3b' : '#3b8eff';
    _paintCtx.beginPath();
    _paintCtx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
    _paintCtx.fill();
}

function _generateBotPath() {
    const path = [];
    const steps = 200;
    for (let i = 0; i < steps; i++) {
        const t     = i / steps;
        const angle  = t * Math.PI * 8;
        const radius = (1 - t * 0.5) * _W * 0.38;
        path.push({
            x: _W / 2 + Math.cos(angle) * radius,
            y: _H * 0.25 + Math.sin(angle * 0.5) * _H * 0.15,
        });
    }
    return path;
}

function _countPixels() {
    const imageData = _paintCtx.getImageData(0, 0, _W, _H).data;
    let p1 = 0, p2 = 0, total = 0;
    for (let y = 0; y < _H; y += SAMPLE_STEP) {
        for (let x = 0; x < _W; x += SAMPLE_STEP) {
            const i = (y * _W + x) * 4;
            const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2];
            total++;
            if (r > 150 && g < 100 && b < 100) p1++;
            else if (b > 150 && r < 100 && g < 180) p2++;
        }
    }
    return [Math.round(p1 / total * 100), Math.round(p2 / total * 100)];
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);

    // Advance bot
    if (_isBot && _botPath && _botStep < _botPath.length) {
        const targetStep = Math.floor((elapsed / GAME_DURATION) * _botPath.length);
        while (_botStep < targetStep && _botStep < _botPath.length) {
            const pt = _botPath[_botStep++];
            _paint(pt.x, pt.y, 1);
        }
    }

    // Update timer label
    if (_timerEl) _timerEl.textContent = `${(remaining / 1000).toFixed(1)}s`;

    // Subsample score every 20 frames (cheap)
    _frameCount++;
    if (_frameCount % 20 === 0) {
        _cachedPcts = _countPixels();
        if (_scoreEls[0]) _scoreEls[0].textContent = `P1: ${_cachedPcts[0]}%`;
        if (_scoreEls[1]) _scoreEls[1].textContent = `P2: ${_cachedPcts[1]}%`;
    }

    // Render paint grid + cursor indicators
    _ctx.drawImage(_paintGrid, 0, 0);
    _activePointers.forEach(ptr => {
        _ctx.fillStyle = ptr.pid === 0 ? 'rgba(255,59,59,0.55)' : 'rgba(59,142,255,0.55)';
        _ctx.beginPath();
        _ctx.arc(ptr.x, ptr.y, BRUSH_RADIUS * 0.7, 0, Math.PI * 2);
        _ctx.fill();
    });

    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _resolve() {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;

    // Final accurate count
    const [p1, p2] = _countPixels();
    const winner = p1 > p2 ? 0 : p2 > p1 ? 1 : -1;
    if (_neutralEl) {
        _neutralEl.textContent = winner >= 0
            ? `P${winner + 1} WINS! ${winner === 0 ? p1 : p2}%`
            : `TIE! ${p1}% each`;
    }
    sfx(winner >= 0 ? 'mg_start' : 'land_good');

    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _paintGrid = null; _paintCtx = null;
    _scoreEls = [null, null]; _activePointers.clear();
}
