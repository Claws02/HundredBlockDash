// Mine Lane — Tap lanes to steer your collector. Grab crystals, avoid mines.
// P1 on bottom, P2 on top. 3 lives each. Most points after 30s wins, or last alive.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION = 30000;
const LANES         = 4;
const LIVES         = 3;
const ITEM_SIZE     = 28;
const SPAWN_BASE    = 1200;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastSpawn = 0, _lastTime = 0;
let _players = [], _items = [];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _onWin = onWin; _isBot = isBot;
    _items = []; _startTime = 0; _lastSpawn = 0; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'TAP LANES TO DODGE MINES!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0d0d1a;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2: 0  ♥♥♥', '#93c5fd');
    _timerEl     = _mkLabel('30s', '#fbbf24');
    _scoreEls[0] = _mkLabel('P1: 0  ♥♥♥', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_timerEl);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.85rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 8px ${color};`;
    el.textContent = text;
    return el;
}

function _laneX(lane) {
    const laneW = _W / LANES;
    return laneW * lane + laneW / 2;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _players = [
        { lane: Math.floor(LANES / 2), pid: 0, lives: LIVES, score: 0 },
        { lane: Math.floor(LANES / 2), pid: 1, lives: LIVES, score: 0 },
    ];

    const onTap = e => {
        e.preventDefault();
        if (_done) return;
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left;
        const pid = (e.clientY - cr.top) > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        _players[pid].lane = Math.max(0, Math.min(LANES - 1, Math.floor(cx / (_W / LANES))));
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _spawnItem(elapsed) {
    const speed = 2.5 + elapsed / 7000;
    // Items for P1 (fall from center down), P2 (rise from center up)
    for (let pid = 0; pid < 2; pid++) {
        const lane = Math.floor(Math.random() * LANES);
        const isMine = Math.random() < 0.35;
        _items.push({
            lane, pid,
            y: pid === 0 ? _H / 2 - ITEM_SIZE : _H / 2 + ITEM_SIZE,
            vy: pid === 0 ? speed : -speed,
            type: isMine ? 'mine' : 'crystal',
        });
    }
}

function _updateLabel(pid) {
    const p = _players[pid];
    const hearts = '♥'.repeat(p.lives) + '♡'.repeat(LIVES - p.lives);
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${p.score}  ${hearts}`;
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    const spawnMs = Math.max(500, SPAWN_BASE - elapsed * 0.015);
    if (now - _lastSpawn > spawnMs) { _lastSpawn = now; _spawnItem(elapsed); }

    // Bot AI: dodge mines, chase crystals
    if (_isBot) {
        const bot = _players[1];
        // Find nearest item for P2
        let bestLane = bot.lane, bestScore = -Infinity;
        for (let l = 0; l < LANES; l++) {
            let lScore = 0;
            for (const item of _items) {
                if (item.pid !== 1) continue;
                const dist = Math.abs(item.y - (_H * 0.25));
                if (item.lane === l) lScore += item.type === 'crystal' ? 50 / (dist + 1) : -80 / (dist + 1);
            }
            if (lScore > bestScore) { bestScore = lScore; bestLane = l; }
        }
        if (Math.random() < 0.08) bot.lane = bestLane;
    }

    for (let i = _items.length - 1; i >= 0; i--) {
        const item = _items[i];
        item.y += item.vy * dt;

        const p = _players[item.pid];
        const playerY = item.pid === 0 ? _H * 0.8 : _H * 0.2;
        if (Math.abs(item.y - playerY) < ITEM_SIZE && item.lane === p.lane) {
            _items.splice(i, 1);
            if (item.type === 'crystal') {
                p.score++;
                sfx('coin_gain');
            } else {
                p.lives = Math.max(0, p.lives - 1);
                sfx('land_bad');
                if (p.lives <= 0) { _resolve(1 - item.pid); return; }
            }
            _updateLabel(item.pid);
            continue;
        }

        // Off screen
        const past = item.pid === 0 ? item.y > _H + ITEM_SIZE : item.y < -ITEM_SIZE;
        if (past) _items.splice(i, 1);
    }

    _draw();
    if (remaining <= 0) { _resolve(-1); return; }
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Lane guides
    const laneW = _W / LANES;
    for (let l = 0; l < LANES; l++) {
        _ctx.fillStyle = l % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.01)';
        _ctx.fillRect(l * laneW, 0, laneW, _H);
        _ctx.strokeStyle = 'rgba(255,255,255,0.05)'; _ctx.lineWidth = 1;
        _ctx.beginPath(); _ctx.moveTo(l * laneW, 0); _ctx.lineTo(l * laneW, _H); _ctx.stroke();
    }

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.1)'; _ctx.lineWidth = 1.5;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Items
    for (const item of _items) {
        const cx = _laneX(item.lane);
        if (item.type === 'crystal') {
            _ctx.fillStyle = '#ffd700'; _ctx.shadowColor = '#ffd700'; _ctx.shadowBlur = 14;
            // Diamond shape
            _ctx.beginPath();
            _ctx.moveTo(cx, item.y - ITEM_SIZE / 2);
            _ctx.lineTo(cx + ITEM_SIZE / 2, item.y);
            _ctx.lineTo(cx, item.y + ITEM_SIZE / 2);
            _ctx.lineTo(cx - ITEM_SIZE / 2, item.y);
            _ctx.closePath(); _ctx.fill();
        } else {
            _ctx.fillStyle = '#222'; _ctx.strokeStyle = '#ff4400'; _ctx.lineWidth = 2;
            _ctx.shadowColor = '#ff4400'; _ctx.shadowBlur = 12;
            _ctx.beginPath(); _ctx.arc(cx, item.y, ITEM_SIZE / 2, 0, Math.PI * 2);
            _ctx.fill(); _ctx.stroke();
            _ctx.fillStyle = '#ff4400';
            _ctx.font = 'bold 14px sans-serif'; _ctx.textAlign = 'center';
            _ctx.fillText('✕', cx, item.y + 5);
        }
        _ctx.shadowBlur = 0;
    }

    // Players
    const pColors = ['#ff3b3b', '#3b8eff'];
    for (const p of _players) {
        const px = _laneX(p.lane);
        const py = p.pid === 0 ? _H * 0.8 : _H * 0.2;
        _ctx.fillStyle = pColors[p.pid]; _ctx.shadowColor = pColors[p.pid]; _ctx.shadowBlur = 18;
        _ctx.beginPath(); _ctx.arc(px, py, 18, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
    }
}

function _resolve(forcedWinner) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    let winner = forcedWinner;
    if (winner < 0) {
        winner = _players[0].score > _players[1].score ? 0
               : _players[1].score > _players[0].score ? 1 : -1;
    }
    if (_neutralEl) _neutralEl.textContent = winner >= 0
        ? `P${winner+1} WINS! ${_players[0].score}–${_players[1].score}`
        : `TIE! ${_players[0].score}–${_players[1].score}`;
    sfx(winner >= 0 ? 'mg_start' : 'land_good');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
