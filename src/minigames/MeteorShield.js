// Meteor Shield — Slide your shield to block incoming meteors.
// P1 defends the bottom edge, P2 defends the top. Take 3 hits = destroyed.
// Last shield standing wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

const SHIELD_W    = 110;
const SHIELD_H    = 12;
const LIVES       = 3;
const METEOR_R_MIN = 10;
const METEOR_R_MAX = 22;
const SPAWN_BASE  = 1400;

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0, _af = null, _startTime = 0, _lastSpawn = 0, _lastTime = 0;
let _shields = [], _meteors = [];
let _lives = [LIVES, LIVES];
let _lifeEls = [null, null], _neutralEl = null;
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _lives = [LIVES, LIVES]; _meteors = []; _startTime = 0; _lastSpawn = 0; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'SLIDE YOUR SHIELD TO BLOCK METEORS!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a1e;';
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;';
    _lifeEls[1] = _mkLife('P2', '#93c5fd');
    _lifeEls[0] = _mkLife('P1', '#fca5a5');
    hud.appendChild(_lifeEls[1]);
    hud.appendChild(_lifeEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkLife(name, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:0.9rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = `${name}: ♥♥♥`;
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

    _shields = [
        { x: _W / 2, y: _H - 30, pid: 0 },
        { x: _W / 2, y: 30,      pid: 1 },
    ];

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
        _shields[pid].x = Math.max(SHIELD_W / 2, Math.min(_W - SHIELD_W / 2, e.clientX - cr.left));
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

function _spawnMeteor(elapsed) {
    const speed = 2.5 + elapsed / 8000;
    // Spawn one targeting P1 (falls from top) and one targeting P2 (rises from bottom)
    for (let pid = 0; pid < 2; pid++) {
        const r  = METEOR_R_MIN + Math.random() * (METEOR_R_MAX - METEOR_R_MIN);
        const px = r + Math.random() * (_W - r * 2);
        const vy = (pid === 0 ? 1 : -1) * (speed + Math.random() * 1.5);
        _meteors.push({ x: px, y: pid === 0 ? -r : _H + r, r, vy, pid });
    }
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const elapsed = now - _startTime;
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;

    const spawnMs = Math.max(600, SPAWN_BASE - elapsed * 0.03);
    if (now - _lastSpawn > spawnMs) { _lastSpawn = now; _spawnMeteor(elapsed); }

    // Bot slides toward nearest meteor in its half
    if (_isBot) {
        let nearest = null, nd = Infinity;
        for (const m of _meteors) {
            if (m.pid !== 1) continue;
            const d = Math.abs(m.x - _shields[1].x);
            if (d < nd) { nd = d; nearest = m; }
        }
        if (nearest) _shields[1].x += (nearest.x - _shields[1].x) * 0.18;
    }

    for (let i = _meteors.length - 1; i >= 0; i--) {
        const m = _meteors[i];
        m.y += m.vy * dt;

        // Shield collision
        const sh = _shields[m.pid];
        const shieldY = m.pid === 0 ? _H - 30 : 30;
        if (Math.abs(m.y - shieldY) < m.r + SHIELD_H / 2 &&
            m.x > sh.x - SHIELD_W / 2 - m.r &&
            m.x < sh.x + SHIELD_W / 2 + m.r) {
            _meteors.splice(i, 1);
            sfx('land_good');
            continue;
        }

        // Past edge = hit
        const pastEdge = m.pid === 0 ? m.y > _H + m.r + 10 : m.y < -m.r - 10;
        if (pastEdge) {
            _meteors.splice(i, 1);
            _lives[m.pid] = Math.max(0, _lives[m.pid] - 1);
            sfx('land_bad');
            const hearts = '♥'.repeat(_lives[m.pid]) + '♡'.repeat(LIVES - _lives[m.pid]);
            if (_lifeEls[m.pid]) _lifeEls[m.pid].textContent = `P${m.pid + 1}: ${hearts}`;
            if (_lives[m.pid] <= 0) { _resolve(1 - m.pid); return; }
        }
    }

    _draw(now);
    _af = requestAnimationFrame(_tick);
}

function _draw(now) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    _ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 50; i++) _ctx.fillRect((i * 97 + 13) % _W, (i * 73 + 29) % _H, 1.5, 1.5);

    _ctx.setLineDash([6,6]); _ctx.strokeStyle = 'rgba(255,255,255,0.07)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H/2); _ctx.lineTo(_W, _H/2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Shields
    const sColors = ['#ff3b3b', '#3b8eff'];
    for (const sh of _shields) {
        _ctx.fillStyle = sColors[sh.pid]; _ctx.shadowColor = sColors[sh.pid]; _ctx.shadowBlur = 16;
        _rrect(_ctx, sh.x - SHIELD_W / 2, sh.y - SHIELD_H / 2, SHIELD_W, SHIELD_H, 6);
        _ctx.fill();
        _ctx.shadowBlur = 0;
    }

    // Meteors
    for (const m of _meteors) {
        const heat = Math.min(1, Math.abs(m.y - _H / 2) / (_H / 2));
        _ctx.fillStyle = `hsl(${30 - heat * 20}, 80%, ${50 + heat * 15}%)`;
        _ctx.shadowColor = '#ff4400'; _ctx.shadowBlur = 10;
        _ctx.beginPath(); _ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); _ctx.fill();
        _ctx.shadowBlur = 0;
        _ctx.strokeStyle = 'rgba(255,255,255,0.2)'; _ctx.lineWidth = 1;
        _ctx.stroke();
    }
}

function _resolve(winner) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    if (_neutralEl) _neutralEl.textContent = winner >= 0 ? `P${winner + 1} SURVIVES!` : 'DRAW!';
    sfx('mg_start');
    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _lifeEls = [null, null];
}
