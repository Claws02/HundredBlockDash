// Asteroid Dodger — Survive falling asteroids on your half of the screen.
// P1 (bottom, red) and P2 (top, blue) each dodge their own stream.
// Last player alive wins. If both survive 30 seconds, most health wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const GAME_DURATION   = 30000;
const SHIP_SIZE       = 22;
const ASTEROID_MIN_R  = 10;
const ASTEROID_MAX_R  = 28;
const SPAWN_INTERVAL  = 700;   // ms between spawns (decreases over time)
const HEALTH_MAX      = 100;
const DAMAGE_PER_HIT  = 34;    // 3 hits to die
const ASTEROID_POINTS = 8;     // vertices per asteroid (precomputed)

let _done = false, _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0;
let _af = null, _startTime = 0, _lastTime = 0, _lastSpawn = 0;
let _ships = [], _asteroids = [];
let _health = [HEALTH_MAX, HEALTH_MAX];
let _healthEls = [null, null], _neutralEl = null;
let _activePointers = new Map();
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _done = false; _onWin = onWin; _isBot = isBot;
    _startTime = 0; _lastTime = 0; _lastSpawn = 0;
    _asteroids = []; _health = [HEALTH_MAX, HEALTH_MAX];
    _activePointers = new Map();
    _neutralEl = document.getElementById('mg-neutral');

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'DODGE THE ASTEROIDS!';
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
    hud.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:flex-start;
        padding:6px 14px;box-sizing:border-box;
    `;
    _healthEls[1] = _mkBar('#3b8eff', 'P2');
    _healthEls[0] = _mkBar('#ff3b3b', 'P1');
    hud.appendChild(_healthEls[1]);
    hud.appendChild(_healthEls[0]);
    _overlay.appendChild(hud);
    mg.appendChild(_overlay);
}

function _mkBar(color, label) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:110px;';
    const bar = document.createElement('div');
    bar.style.cssText = `height:10px;background:${color};border-radius:6px;width:100%;box-shadow:0 0 10px ${color};`;
    const lbl = document.createElement('div');
    lbl.style.cssText = `font-size:0.65rem;color:#fff;text-align:center;margin-top:2px;font-family:inherit;opacity:0.8;`;
    lbl.textContent = `${label} ♥ 100%`;
    wrap.appendChild(bar); wrap.appendChild(lbl);
    wrap._bar = bar; wrap._lbl = lbl;
    return wrap;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    _ships = [
        { x: _W / 2, y: _H * 0.75, targetX: _W / 2, pid: 0 },
        { x: _W / 2, y: _H * 0.25, targetX: _W / 2, pid: 1 },
    ];

    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const cy = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        _activePointers.set(e.pointerId, pid);
        if (!(_isBot && pid === 1)) _ships[pid].targetX = e.clientX - cr.left;
    };
    const onMove = e => {
        e.preventDefault();
        if (!_activePointers.has(e.pointerId)) return;
        const pid = _activePointers.get(e.pointerId);
        if (_isBot && pid === 1) return;
        const cr = _canvas.getBoundingClientRect();
        _ships[pid].targetX = Math.max(SHIP_SIZE, Math.min(_W - SHIP_SIZE, e.clientX - cr.left));
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
}

function _spawnAsteroid(elapsed) {
    const speedMult = 1 + elapsed / 18000;
    const r = ASTEROID_MIN_R + Math.random() * (ASTEROID_MAX_R - ASTEROID_MIN_R);
    // Precompute irregular shape vertices so they don't flicker each frame
    const pts = [];
    for (let i = 0; i < ASTEROID_POINTS; i++) {
        const angle  = (i / ASTEROID_POINTS) * Math.PI * 2;
        const radius = r * (0.65 + Math.random() * 0.35);
        pts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    _asteroids.push({
        x: ASTEROID_MAX_R + Math.random() * (_W - ASTEROID_MAX_R * 2),
        y: Math.random() < 0.5 ? -r - 5 : _H + r + 5,
        r,
        vx:       (Math.random() - 0.5) * 2.5 * speedMult,
        vy:       (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 2.5) * speedMult,
        rotation: 0,
        rotSpeed: (Math.random() - 0.5) * 0.06,
        color:    `hsl(${20 + Math.random() * 50}, 65%, ${38 + Math.random() * 20}%)`,
        pts,
    });
}

function _tick(now) {
    if (_done || !state.mgActive) return;
    const dt = Math.min((now - (_lastTime || now)) / (1000 / 60), 3);
    _lastTime = now;

    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    const spawnMs   = Math.max(300, SPAWN_INTERVAL - elapsed * 0.008);

    // Spawn
    if (now - _lastSpawn > spawnMs) { _lastSpawn = now; _spawnAsteroid(elapsed); }

    // Move ships toward finger
    for (const ship of _ships) {
        ship.x += (ship.targetX - ship.x) * 0.22 * dt;
        ship.x  = Math.max(SHIP_SIZE, Math.min(_W - SHIP_SIZE, ship.x));
    }

    // Bot: dodge nearest asteroid in top half
    if (_isBot) {
        const bot = _ships[1];
        let nearest = null, nearDist = Infinity;
        for (const a of _asteroids) {
            if (a.y > _H / 2) continue; // ignore bottom-half asteroids for bot
            const d = Math.hypot(bot.x - a.x, bot.y - a.y);
            if (d < nearDist) { nearDist = d; nearest = a; }
        }
        if (nearest && nearDist < 180) {
            bot.targetX += (bot.x > nearest.x ? 1 : -1) * 12;
        } else {
            bot.targetX = _W / 2 + Math.sin(elapsed / 800) * _W * 0.25;
        }
    }

    // Update + collide asteroids
    for (let i = _asteroids.length - 1; i >= 0; i--) {
        const a = _asteroids[i];
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.rotation += a.rotSpeed * dt;

        if (a.y - a.r > _H + 10 || a.y + a.r < -10 || a.x - a.r > _W + 10 || a.x + a.r < -10) {
            _asteroids.splice(i, 1); continue;
        }

        let hit = false;
        for (const ship of _ships) {
            if (_health[ship.pid] <= 0) continue;
            if (Math.hypot(ship.x - a.x, ship.y - a.y) < a.r + SHIP_SIZE * 0.55) {
                _hitShip(ship.pid);
                _asteroids.splice(i, 1);
                hit = true; break;
            }
        }
        if (hit) continue;
    }

    _draw();

    if (remaining <= 0 || (_health[0] <= 0 && _health[1] <= 0)) {
        _resolve(-1); return;
    }
    _af = requestAnimationFrame(_tick);
}

function _hitShip(pid) {
    if (_health[pid] <= 0) return;
    _health[pid] = Math.max(0, _health[pid] - DAMAGE_PER_HIT);
    sfx('land_bad');

    const el = _healthEls[pid];
    if (el) {
        el._bar.style.width = `${_health[pid]}%`;
        el._lbl.textContent = `P${pid + 1} ♥ ${_health[pid]}%`;
    }

    if (_health[pid] <= 0) {
        if (_neutralEl) _neutralEl.textContent = `P${pid + 1} DESTROYED!`;
        const other = 1 - pid;
        if (_health[other] <= 0) { _resolve(-1); } else { _resolve(other); }
    }
}

function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Static star field
    _ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 35; i++) {
        _ctx.fillRect((i * 97 + 13) % _W, (i * 73 + 29) % _H, 1.5, 1.5);
    }

    // Divider
    _ctx.setLineDash([6, 6]);
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, _H / 2); _ctx.lineTo(_W, _H / 2); _ctx.stroke();
    _ctx.setLineDash([]);

    // Asteroids (precomputed vertices — no random each frame)
    for (const a of _asteroids) {
        _ctx.save();
        _ctx.translate(a.x, a.y);
        _ctx.rotate(a.rotation);
        _ctx.fillStyle = a.color;
        _ctx.shadowColor = 'rgba(255,100,0,0.4)';
        _ctx.shadowBlur  = 12;
        _ctx.beginPath();
        _ctx.moveTo(a.pts[0].x, a.pts[0].y);
        for (let k = 1; k < a.pts.length; k++) _ctx.lineTo(a.pts[k].x, a.pts[k].y);
        _ctx.closePath();
        _ctx.fill();
        _ctx.shadowBlur = 0;
        _ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        _ctx.lineWidth = 1;
        _ctx.stroke();
        _ctx.restore();
    }

    // Ships
    const colors = ['#ff3b3b', '#3b8eff'];
    for (const ship of _ships) {
        if (_health[ship.pid] <= 0) continue;
        const c = colors[ship.pid];
        const flip = ship.pid === 1 ? -1 : 1; // P2 ship points down
        _ctx.fillStyle = c;
        _ctx.shadowColor = c;
        _ctx.shadowBlur  = 18;
        _ctx.beginPath();
        _ctx.moveTo(ship.x,                        ship.y - SHIP_SIZE * flip);
        _ctx.lineTo(ship.x - SHIP_SIZE * 0.65,     ship.y + SHIP_SIZE * 0.5 * flip);
        _ctx.lineTo(ship.x + SHIP_SIZE * 0.65,     ship.y + SHIP_SIZE * 0.5 * flip);
        _ctx.closePath();
        _ctx.fill();
        _ctx.shadowBlur = 0;
    }
}

function _resolve(winner) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;

    if (winner < 0) {
        // Time up or both dead — most health wins
        winner = _health[0] > _health[1] ? 0 : _health[1] > _health[0] ? 1 : -1;
    }

    if (_neutralEl) {
        _neutralEl.textContent = winner >= 0 ? `P${winner + 1} SURVIVES!` : 'BOTH SURVIVE!';
    }
    sfx(winner >= 0 ? 'mg_start' : 'land_good');

    setTimeout(() => { _destroy(); _onWin(winner); }, 1500);
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _activePointers.clear();
}

export function destroy() { _done = true; cancelAnimationFrame(_af); _af = null; _cleanups.forEach(f => f()); _cleanups.length = 0; }
