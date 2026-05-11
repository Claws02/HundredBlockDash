// Zone Zap — Zones light up on your half. Tap them fast to score.
// Each zone is active for 1.5 seconds. 20 second timer. Most zaps wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION  = 20000;
const COLS           = 3;
const ROWS           = 4;
const ZONE_LIFETIME  = 1500;
const SPAWN_INTERVAL = 550;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastSpawn = [0, 0];
let _zones = [[], []];
let _scores = [0, 0];
let _scoreEls = [null, null], _timerEl = null, _neutralEl = null;
let _botZapInterval = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _zones = [[], []]; _startTime = 0; _lastSpawn = [0, 0];
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'TAP LIT ZONES FAST!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a0a;';
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

function _zoneRect(col, row, pid) {
    const padX = 10, padY = 40, gap = 8;
    const halfH = _H / 2;
    const zoneW = (_W - padX * 2 - gap * (COLS - 1)) / COLS;
    const zoneH = (halfH - padY - gap * (ROWS - 1) - 20) / ROWS;
    const x = padX + col * (zoneW + gap);
    const baseY = pid === 0 ? halfH + padY : 20;
    const y = baseY + row * (zoneH + gap);
    return { x, y, w: zoneW, h: zoneH };
}

function _spawnZone(pid, now) {
    // Pick a random slot not already active
    const occupied = new Set(_zones[pid].map(z => `${z.col},${z.row}`));
    const slots = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!occupied.has(`${c},${r}`)) slots.push({ c, r });
    }
    if (!slots.length) return;
    const pick = slots[Math.floor(Math.random() * slots.length)];
    _zones[pid].push({ col: pick.c, row: pick.r, born: now, pid, zapped: false });
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
        _zapAt(tx, ty, pid);
    };
    _canvas.addEventListener('pointerdown', onTap);
    _cleanups.push(() => _canvas.removeEventListener('pointerdown', onTap));

    if (_isBot) {
        _botZapInterval = setInterval(() => {
            if (_done || !state.mgActive) return;
            const now = performance.now();
            for (const z of _zones[1]) {
                if (!z.zapped && Math.random() < 0.7) {
                    z.zapped = true;
                    _scores[1]++;
                    if (_scoreEls[1]) _scoreEls[1].textContent = `P2: ${_scores[1]}`;
                    sfx('coin_gain');
                    break;
                }
            }
        }, 400 + Math.random() * 200);
        _cleanups.push(() => { clearInterval(_botZapInterval); _botZapInterval = null; });
    }
}

function _zapAt(tx, ty, pid) {
    for (const z of _zones[pid]) {
        if (z.zapped) continue;
        const rect = _zoneRect(z.col, z.row, pid);
        if (tx >= rect.x && tx <= rect.x + rect.w && ty >= rect.y && ty <= rect.y + rect.h) {
            z.zapped = true;
            _scores[pid]++;
            if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
            sfx('coin_gain');
            break;
        }
    }
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    for (let pid = 0; pid < 2; pid++) {
        if (now - _lastSpawn[pid] > SPAWN_INTERVAL) {
            _lastSpawn[pid] = now;
            _spawnZone(pid, now);
        }
        _zones[pid] = _zones[pid].filter(z => !z.zapped && now - z.born < ZONE_LIFETIME);
    }

    _draw(now);
    if (remaining <= 0) { _resolve(); return; }
    _af = requestAnimationFrame(_tick);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.08)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    const idleColor = ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.05)'];
    const litColor  = ['rgba(255,59,59,', 'rgba(59,130,255,'];

    // Draw all zone slots (idle)
    for (let pid = 0; pid < 2; pid++) {
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const rect = _zoneRect(col, row, pid);
                _ctx.fillStyle = idleColor[pid];
                _ctx.strokeStyle = 'rgba(255,255,255,0.06)'; _ctx.lineWidth = 1;
                _ctx.beginPath(); _ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
                _ctx.fill(); _ctx.stroke();
            }
        }
    }

    // Draw active (lit) zones
    for (let pid = 0; pid < 2; pid++) {
        for (const z of _zones[pid]) {
            const life = 1 - (now - z.born) / ZONE_LIFETIME;
            const rect = _zoneRect(z.col, z.row, pid);
            _ctx.fillStyle = litColor[pid] + (0.65 * life) + ')';
            _ctx.shadowColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
            _ctx.shadowBlur  = 18 * life;
            _ctx.beginPath(); _ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
            _ctx.fill(); _ctx.shadowBlur = 0;

            // Life bar at bottom of zone
            _ctx.fillStyle = `rgba(255,255,255,${0.3 * life})`;
            _ctx.fillRect(rect.x, rect.y + rect.h - 4, rect.w * life, 4);
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
    clearInterval(_botZapInterval); _botZapInterval = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
