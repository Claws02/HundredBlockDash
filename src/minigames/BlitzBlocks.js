// Blitz Blocks — Tap the correct column to destroy the falling block.
// Blocks fall in 4 columns on your half. Let one hit bottom = -1 life.
// 3 lives. First player to lose all lives loses.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const COLS        = 4;
const LIVES       = 3;
const BLOCK_W     = 0;  // computed
const BLOCK_H     = 28;
const SPAWN_BASE  = 1100;
const HIT_ZONE    = 36;  // proximity to bottom to count as hit

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastSpawn = 0, _lastTime = 0;
let _blocks = [], _lives = [LIVES, LIVES], _scores = [0, 0];
let _scoreEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _lives = [LIVES, LIVES]; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _blocks = []; _startTime = 0; _lastSpawn = 0; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'TAP THE COLUMN TO DESTROY BLOCKS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0010;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _scoreEls[1] = _mkLabel('P2 ♥♥♥', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1 ♥♥♥', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
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

function _updateLabel(pid) {
    const hearts = '♥'.repeat(_lives[pid]) + '♡'.repeat(LIVES - _lives[pid]);
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid+1} ${hearts}`;
}

function _laneX(lane) { return (lane + 0.5) * (_W / COLS); }

function _spawnBlock(elapsed) {
    const speed = 2.2 + elapsed / 6000;
    for (let pid = 0; pid < 2; pid++) {
        const lane = Math.floor(Math.random() * COLS);
        const vy   = pid === 0 ? speed : -speed;
        const startY = pid === 0 ? _H / 2 - BLOCK_H : _H / 2 + BLOCK_H;
        _blocks.push({
            lane, pid, y: startY, vy,
            color: `hsl(${200 + Math.random() * 140}, 70%, 55%)`,
            hit: false,
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

    const onTap = e => {
        e.preventDefault();
        if (_done) return;
        const cr   = _canvas.getBoundingClientRect();
        const tx   = e.clientX - cr.left;
        const ty   = e.clientY - cr.top;
        const pid  = ty > _H / 2 ? 0 : 1;
        if (_isBot && pid === 1) return;
        const lane = Math.max(0, Math.min(COLS - 1, Math.floor(tx / (_W / COLS))));
        _destroyBlock(pid, lane);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));
}

function _destroyBlock(pid, lane) {
    for (let i = _blocks.length - 1; i >= 0; i--) {
        const b = _blocks[i];
        if (b.pid !== pid || b.lane !== lane || b.hit) continue;
        b.hit = true;
        _scores[pid]++;
        sfx('land_good');
        break;
    }
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;

    const spawnMs = Math.max(400, SPAWN_BASE - elapsed * 0.014);
    if (now - _lastSpawn > spawnMs) { _lastSpawn = now; _spawnBlock(elapsed); }

    // Bot destroys blocks in P2 half
    if (_isBot) {
        for (const b of _blocks) {
            if (b.pid !== 1 || b.hit) continue;
            const bottomY = _H * 0.2 + HIT_ZONE;
            if (b.y <= bottomY && Math.random() < 0.15) {
                _destroyBlock(1, b.lane);
            }
        }
    }

    for (let i = _blocks.length - 1; i >= 0; i--) {
        const b = _blocks[i];
        if (b.hit) { _blocks.splice(i, 1); continue; }
        b.y += b.vy * dt;

        const boundary = b.pid === 0 ? _H - HIT_ZONE : HIT_ZONE;
        const missed   = b.pid === 0 ? b.y > boundary : b.y < boundary;
        if (missed) {
            _blocks.splice(i, 1);
            _lives[b.pid] = Math.max(0, _lives[b.pid] - 1);
            sfx('land_bad');
            _updateLabel(b.pid);
            if (_lives[b.pid] <= 0) { _resolve(1 - b.pid); return; }
        }
    }

    _draw();
    _af = requestAnimationFrame(_tick);
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    const colW = _W / COLS;
    for (let c = 0; c < COLS; c++) {
        _ctx.fillStyle = c % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.01)';
        _ctx.fillRect(c * colW, 0, colW, _H);
        _ctx.strokeStyle = 'rgba(255,255,255,0.04)'; _ctx.lineWidth = 1;
        _ctx.beginPath(); _ctx.moveTo(c * colW, 0); _ctx.lineTo(c * colW, _H); _ctx.stroke();
    }

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.1)'; _ctx.lineWidth = 1.5;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Danger zones
    _ctx.fillStyle = 'rgba(255,59,59,0.08)';
    _ctx.fillRect(0, _H - HIT_ZONE, _W, HIT_ZONE);
    _ctx.fillRect(0, 0, _W, HIT_ZONE);

    for (const b of _blocks) {
        const bx = b.lane * colW + 4;
        const bw = colW - 8;
        _ctx.fillStyle = b.color; _ctx.shadowColor = b.color; _ctx.shadowBlur = 12;
        _ctx.beginPath();
        _ctx.roundRect(bx, b.y - BLOCK_H / 2, bw, BLOCK_H, 5);
        _ctx.fill(); _ctx.shadowBlur = 0;
    }
}

function _resolve(winner) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    if (_neutralEl) _neutralEl.textContent = `P${winner + 1} WINS!`;
    sfx('mg_start');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}
