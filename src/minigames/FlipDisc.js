// Flip Disc — Tap discs on your half to flip them to your color.
// Discs revert to neutral after 3.5 seconds. 20 second timer.
// Most discs of your color when time ends wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 20000;
const COLS          = 5;
const ROWS          = 4;
const DISC_REVERT   = 3500;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0;
let _discs = [];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
let _botFlipInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    clearInterval(_botFlipInterval); _botFlipInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _onWin = onWin; _isBot = isBot;
    _discs = []; _startTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'FLIP DISCS TO YOUR COLOR!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#111;';
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

    const padX = 16, padY = 36;
    const halfH = _H / 2;
    const discW = (_W - padX * 2) / COLS;
    const discH = (halfH - padY * 1.5) / ROWS;
    const discR  = Math.min(discW, discH) * 0.38;

    // Create discs for each half
    for (let pid = 0; pid < 2; pid++) {
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const cy = pid === 0
                    ? halfH + padY + (row + 0.5) * ((halfH - padY * 1.2) / ROWS)
                    : padY    + (row + 0.5) * ((halfH - padY * 1.2) / ROWS);
                _discs.push({
                    x: padX + (col + 0.5) * discW,
                    y: cy,
                    r: discR,
                    pid,          // which half this disc belongs to
                    owner: -1,    // -1 = neutral, 0 = P1, 1 = P2
                    flippedAt: 0,
                });
            }
        }
    }

    const onTap = e => {
        e.preventDefault();
        if (_done) return;
        const cr  = _canvas.getBoundingClientRect();
        const tx  = e.clientX - cr.left;
        const ty  = e.clientY - cr.top;
        const pid = ty > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _flipNearest(tx, ty, pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));

    if (_isBot) {
        _botFlipInterval = setInterval(() => {
            if (_done || !state.mgActive) return;
            // Bot flips a random neutral or opponent disc in its half
            const candidates = _discs.filter(d => d.pid === 1 && d.owner !== 1);
            if (candidates.length) {
                const d = candidates[Math.floor(Math.random() * candidates.length)];
                d.owner = 1; d.flippedAt = performance.now();
                sfx('coin_gain');
            }
        }, 350 + Math.random() * 200);
        _cleanups.push(() => { clearInterval(_botFlipInterval); _botFlipInterval = null; });
    }
}

function _flipNearest(tx, ty, pid) {
    let nearest = null, nd = Infinity;
    for (const d of _discs) {
        if (d.pid !== pid) continue;
        const dist = Math.hypot(tx - d.x, ty - d.y);
        if (dist < nd) { nd = dist; nearest = d; }
    }
    if (nearest && nd < nearest.r + 20) {
        nearest.owner = pid;
        nearest.flippedAt = performance.now();
        sfx('coin_gain');
    }
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    // Revert expired discs
    for (const d of _discs) {
        if (d.owner >= 0 && now - d.flippedAt > DISC_REVERT) {
            d.owner = -1;
        }
    }

    // Update score display
    let c0 = 0, c1 = 0;
    for (const d of _discs) {
        if (d.owner === 0) c0++;
        if (d.owner === 1) c1++;
    }
    if (_scoreEls[0]) _scoreEls[0].textContent = `P1: ${c0}`;
    if (_scoreEls[1]) _scoreEls[1].textContent = `P2: ${c1}`;

    _draw(now);
    if (remaining <= 0) { _resolve(c0, c1); return; }
    _af = requestAnimationFrame(_tick);
}

function _resolve(c0, c1) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    const winner = c0 > c1 ? 0 : c1 > c0 ? 1 : -1;
    if (_neutralEl) _neutralEl.textContent = winner >= 0
        ? `P${winner+1} WINS! ${c0}–${c1}`
        : `TIE! ${c0}–${c1}`;
    sfx(winner >= 0 ? 'mg_start' : 'land_good');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.1)'; _ctx.lineWidth = 1.5;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    const ownerColors = ['#ff3b3b', '#3b8eff'];
    const ownerGlow   = ['#ff3b3b', '#3b8eff'];
    for (const d of _discs) {
        const age  = d.owner >= 0 ? now - d.flippedAt : 0;
        const life = d.owner >= 0 ? Math.max(0, 1 - age / DISC_REVERT) : 0;
        if (d.owner >= 0) {
            _ctx.fillStyle = ownerColors[d.owner];
            _ctx.shadowColor = ownerGlow[d.owner];
            _ctx.shadowBlur  = 10 + life * 12;
        } else {
            _ctx.fillStyle = 'rgba(255,255,255,0.12)';
            _ctx.shadowBlur = 0;
        }
        _ctx.beginPath(); _ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;

        // Revert timer arc
        if (d.owner >= 0 && life > 0) {
            _ctx.strokeStyle = `rgba(255,255,255,${life * 0.5})`;
            _ctx.lineWidth = 2;
            _ctx.beginPath();
            _ctx.arc(d.x, d.y, d.r + 3, -Math.PI/2, -Math.PI/2 + life * Math.PI * 2);
            _ctx.stroke();
        }
    }
}

function _destroy() {
    clearInterval(_botFlipInterval); _botFlipInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
