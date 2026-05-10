// Snake Battle — Two snakes share one arena.
// Swipe your half of the screen to steer your snake.
// Eat dots to grow. Die by hitting walls or either snake.
// Most dots eaten after 30 seconds (or last snake alive) wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION   = 30000;
const GRID_SIZE       = 20;
const MOVE_INTERVAL   = 115; // ms between steps
const INITIAL_LENGTH  = 4;
const FOOD_COUNT      = 7;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _gridW = 0, _gridH = 0;
let _af = null, _startTime = 0, _lastTime = 0, _lastMove = 0;
let _snakes = [[], []], _dirs = [{x:0,y:1},{x:0,y:-1}], _foods = [];
let _alive = [true, true], _scores = [INITIAL_LENGTH, INITIAL_LENGTH];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _alive = [true, true]; _scores = [INITIAL_LENGTH, INITIAL_LENGTH];
    _startTime = 0; _lastTime = 0; _lastMove = 0;
    _dirs = [{x:0,y:1},{x:0,y:-1}];
    _neutralEl = document.getElementById('mg-neutral');

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'SWIPE TO STEER YOUR SNAKE!';
        _startTime = performance.now();
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
    hud.style.cssText = `
        position:absolute;top:0;left:0;right:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:center;
        padding:5px 12px;box-sizing:border-box;
    `;
    _scoreEls[1] = _mkLabel('P2: 4', '#93c5fd');
    _timerEl     = _mkLabel('30s',   '#fbbf24');
    _scoreEls[0] = _mkLabel('P1: 4', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_timerEl);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.9rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 8px ${color};`;
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

    _gridW = Math.floor(_W / GRID_SIZE);
    _gridH = Math.floor(_H / GRID_SIZE);

    // Init snakes — P1 starts in lower third, P2 in upper third
    _snakes[0] = [];
    _snakes[1] = [];
    const cx = Math.floor(_gridW / 2);
    for (let i = 0; i < INITIAL_LENGTH; i++) {
        _snakes[0].push({ x: cx, y: Math.floor(_gridH * 0.68) - i });
        _snakes[1].push({ x: cx, y: Math.floor(_gridH * 0.32) + i });
    }

    // Spawn food
    _foods = [];
    for (let i = 0; i < FOOD_COUNT; i++) _placeFood();

    // Swipe gesture: track per-pointer start position
    const starts = new Map();

    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        starts.set(e.pointerId, {
            x: e.clientX - cr.left,
            y: e.clientY - cr.top,
            pid: (e.clientY - cr.top) > _H / 2 ? 0 : 1,
        });
    };
    const onUp = e => {
        e.preventDefault();
        if (!starts.has(e.pointerId)) return;
        const { x: sx, y: sy, pid } = starts.get(e.pointerId);
        starts.delete(e.pointerId);
        if (_isBot && pid === 1) return;
        const cr = _canvas.getBoundingClientRect();
        const dx = e.clientX - cr.left - sx;
        const dy = e.clientY - cr.top  - sy;
        const cur = _dirs[pid];
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
            if (cur.y !== 0) _dirs[pid] = { x: dx > 0 ? 1 : -1, y: 0 };
        } else if (Math.abs(dy) > 8) {
            if (cur.x !== 0) _dirs[pid] = { x: 0, y: dy > 0 ? 1 : -1 };
        }
    };

    _canvas.addEventListener('pointerdown', onDown);
    _canvas.addEventListener('pointerup',   onUp);
    _canvas.addEventListener('pointercancel', e => starts.delete(e.pointerId));
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown', onDown);
        _canvas.removeEventListener('pointerup',   onUp);
    });
}

function _placeFood() {
    let pos, tries = 0;
    do {
        pos = { x: Math.floor(Math.random() * _gridW), y: Math.floor(Math.random() * _gridH) };
        tries++;
    } while (tries < 50 && _isOccupied(pos));
    _foods.push({ ...pos, hue: Math.floor(Math.random() * 360) });
}

function _isOccupied(pos) {
    for (const s of _snakes) for (const seg of s) if (seg.x === pos.x && seg.y === pos.y) return true;
    for (const f of _foods)  if (f.x === pos.x && f.y === pos.y) return true;
    return false;
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    if (now - _lastMove > MOVE_INTERVAL) {
        _lastMove = now;
        _step();
    }

    _draw();

    if (remaining <= 0 || (!_alive[0] && !_alive[1])) { _resolve(); return; }
    if (!_alive[0] || !_alive[1]) {
        const dead = _alive[0] ? 1 : 0;
        if (_neutralEl) _neutralEl.textContent = `P${dead + 1}'S SNAKE DIED!`;
        setTimeout(_resolve, 1000);
        return; // stop RAF loop — _resolve() sets _done = true
    }

    _af = requestAnimationFrame(_tick);
}

function _step() {
    for (let pid = 0; pid < 2; pid++) {
        if (!_alive[pid]) continue;

        // Bot: simple food-chase with wall avoidance
        if (_isBot && pid === 1) {
            const head = _snakes[pid][0];
            let nearest = null, nearDist = Infinity;
            for (const f of _foods) {
                const d = Math.abs(f.x - head.x) + Math.abs(f.y - head.y);
                if (d < nearDist) { nearDist = d; nearest = f; }
            }
            if (nearest) {
                const dx = Math.sign(nearest.x - head.x);
                const dy = Math.sign(nearest.y - head.y);
                const cur = _dirs[pid];
                if (dx !== 0 && cur.y !== 0) _dirs[pid] = { x: dx, y: 0 };
                else if (dy !== 0 && cur.x !== 0) _dirs[pid] = { x: 0, y: dy };
            }
            // Emergency wall turn
            const nx = head.x + _dirs[pid].x, ny = head.y + _dirs[pid].y;
            if (nx < 0 || nx >= _gridW || ny < 0 || ny >= _gridH) {
                _dirs[pid] = _dirs[pid].x !== 0
                    ? { x: 0, y: head.y < _gridH / 2 ? 1 : -1 }
                    : { x: head.x < _gridW / 2 ? 1 : -1, y: 0 };
            }
        }

        const head   = _snakes[pid][0];
        const newHead = { x: head.x + _dirs[pid].x, y: head.y + _dirs[pid].y };

        // Wall death
        if (newHead.x < 0 || newHead.x >= _gridW || newHead.y < 0 || newHead.y >= _gridH) {
            _alive[pid] = false; sfx('land_bad'); continue;
        }
        // Self collision
        if (_snakes[pid].some(s => s.x === newHead.x && s.y === newHead.y)) {
            _alive[pid] = false; sfx('land_bad'); continue;
        }
        // Other snake collision
        if (_snakes[1 - pid].some(s => s.x === newHead.x && s.y === newHead.y)) {
            _alive[pid] = false; sfx('land_bad'); continue;
        }

        _snakes[pid].unshift(newHead);

        // Food
        const fi = _foods.findIndex(f => f.x === newHead.x && f.y === newHead.y);
        if (fi >= 0) {
            _foods.splice(fi, 1);
            _scores[pid]++;
            if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
            _placeFood();
            sfx('coin_gain');
        } else {
            _snakes[pid].pop();
        }
    }
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Subtle grid
    _ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    _ctx.lineWidth = 0.5;
    for (let x = 0; x <= _gridW; x++) {
        _ctx.beginPath(); _ctx.moveTo(x * GRID_SIZE, 0); _ctx.lineTo(x * GRID_SIZE, _H); _ctx.stroke();
    }
    for (let y = 0; y <= _gridH; y++) {
        _ctx.beginPath(); _ctx.moveTo(0, y * GRID_SIZE); _ctx.lineTo(_W, y * GRID_SIZE); _ctx.stroke();
    }

    // Food
    for (const f of _foods) {
        _ctx.fillStyle = `hsl(${f.hue}, 75%, 60%)`;
        const fx = f.x * GRID_SIZE + GRID_SIZE / 2;
        const fy = f.y * GRID_SIZE + GRID_SIZE / 2;
        _ctx.beginPath();
        _ctx.arc(fx, fy, GRID_SIZE / 2 - 2, 0, Math.PI * 2);
        _ctx.fill();
    }

    // Snakes
    const colors = ['#ff3b3b', '#3b8eff'];
    for (let pid = 0; pid < 2; pid++) {
        if (!_alive[pid] && _snakes[pid].length === 0) continue;
        _snakes[pid].forEach((seg, i) => {
            const alpha = Math.max(0.25, 1 - i / (_snakes[pid].length + 4));
            _ctx.fillStyle = colors[pid];
            _ctx.globalAlpha = _alive[pid] ? alpha : 0.2;
            const r = i === 0 ? 4 : 2; // rounder head
            const sx = seg.x * GRID_SIZE + 1, sy = seg.y * GRID_SIZE + 1;
            const sw = GRID_SIZE - 2,          sh = GRID_SIZE - 2;
            _ctx.beginPath();
            _ctx.roundRect(sx, sy, sw, sh, r);
            _ctx.fill();
        });
        _ctx.globalAlpha = 1;
    }
}

function _resolve() {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;

    // Both dead at same time → check scores; otherwise alive player wins
    let winner;
    if (!_alive[0] && !_alive[1]) {
        winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
    } else {
        winner = _alive[0] ? 0 : 1;
    }

    if (_neutralEl) {
        _neutralEl.textContent = winner >= 0
            ? `P${winner + 1} WINS! ${_scores[0]}–${_scores[1]}`
            : `TIE! ${_scores[0]}–${_scores[1]}`;
    }
    sfx(winner >= 0 ? 'mg_start' : 'land_good');

    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
