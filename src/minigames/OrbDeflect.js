// Orb Deflect — Draw barriers with your finger to deflect the orb into the opponent's core!
// P1 controls the bottom half (cyan), P2 controls the top half (magenta).
// Cores sit at each edge. 3 HP each — first to lose all HP loses. 30-second timer.
//
// ⚠️  SPEED / FRAME-RATE RULE (apply to every minigame):
//   All movement values must be expressed as units-per-SECOND, not units-per-frame.
//   Multiply every position delta by `dt` (elapsed seconds since last frame).
//   Compute dt at the top of the game loop:
//     const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
//     _lastTick = now;
//   Cap dt at 0.1 s so a tab-switch never causes a huge jump.
//   This keeps speed identical on 60 Hz phones, 120 Hz tablets, and desktop browsers.
import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const C_P1  = '#00ffff';
const C_P2  = '#ff00ff';
const C_ORB = '#ffffff';

let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null;
let _cw = 0, _ch = 0;
let _animId = null, _lastTick = 0;
const _cleanups = [];
const _timers   = [];

// Game state (reset each start)
let _gs = null;

function _after(fn, ms) {
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        if (state.mgActive) fn();
    }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    registerMinigameCleanup(_destroy);
    _lastTick = 0;

    _build();
    _resetState();

    sfx('countdown');
    _after(() => { if (!_done) sfx('go'); }, 1000);
    if (isBot) _after(_botTick, 1000);

    _animId = requestAnimationFrame(_tick);
}

// ── DOM & Canvas ──────────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#050510;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
    _overlay.appendChild(_canvas);

    _sizeCanvas();
    const onResize = () => { _sizeCanvas(); };
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    _ctx = _canvas.getContext('2d');
    // Apply DPR transform after context is created (first call to _sizeCanvas had no ctx yet)
    { const dpr = Math.min(window.devicePixelRatio || 1, 2); _ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

    // Pointer handlers.
    //
    // Every recorded point is clamped into the drawable box (see _clampDraw):
    // a swipe that ran off the screen edge used to record points at x = 0 or
    // y = _ch, right on the boundary, where the stroke is half-clipped and a
    // browser edge gesture can steal the drag. The box also confines a stroke to
    // the half it started in — you could previously draw a barrier straight
    // across your opponent's side.
    const onDown = e => {
        if (_done || !state.mgActive) return;
        e.preventDefault();
        const isP2Zone = e.clientY < _ch / 2;
        if (isP2Zone && _isBot) return; // block P2 zone if bot
        const color = isP2Zone ? C_P2 : C_P1;
        _gs.activeTouches[e.pointerId] = {
            points: [_clampDraw(e.clientX, e.clientY, isP2Zone)],
            length: 0,
            color,
            top: isP2Zone,
        };
    };
    const onMove = e => {
        if (_done || !state.mgActive) return;
        const t = _gs.activeTouches[e.pointerId];
        if (!t) return;
        e.preventDefault();
        const last = t.points[t.points.length - 1];
        const p = _clampDraw(e.clientX, e.clientY, t.top);
        const dx = p.x - last.x, dy = p.y - last.y;
        const dist = Math.hypot(dx, dy);
        if (dist > _cw * 0.015) {
            t.points.push(p);
            t.length += dist;
        }
    };
    const onUp = e => {
        if (!state.mgActive) return;
        const t = _gs.activeTouches[e.pointerId];
        if (!t) return;
        e.preventDefault();
        if (t.length > _cw * 0.05 && t.points.length > 1) {
            _gs.barriers.push({ points: t.points, life: 1.0, color: t.color });
            sfx('boost');
        }
        delete _gs.activeTouches[e.pointerId];
    };

    _canvas.addEventListener('pointerdown',   onDown);
    _canvas.addEventListener('pointermove',   onMove);
    _canvas.addEventListener('pointerup',     onUp);
    _canvas.addEventListener('pointercancel', onUp);
    _canvas.addEventListener('contextmenu',   e => e.preventDefault());
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',   onDown);
        _canvas.removeEventListener('pointermove',   onMove);
        _canvas.removeEventListener('pointerup',     onUp);
        _canvas.removeEventListener('pointercancel', onUp);
    });

    mg.appendChild(_overlay);
}

function _sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    _cw = window.innerWidth;
    _ch = window.innerHeight;
    if (_canvas) {
        _canvas.width  = Math.round(_cw * dpr);
        _canvas.height = Math.round(_ch * dpr);
        // Scale all draw calls to logical (CSS-pixel) coordinates
        if (_ctx) _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function _resetState() {
    _gs = {
        timeLeft: 30,
        hp: [3, 3],
        orbs: [],
        barriers: [],
        particles: [],
        activeTouches: {},
        spawnTimer: 1.0,
    };
    _spawnOrb();
}

// ── Bot AI ────────────────────────────────────────────────────────────────────

function _botTick() {
    if (_done || !state.mgActive) return;

    // Find the orb most threatening to P2 (top half, vy < 0 heading toward y=0)
    let threat = null, minTime = Infinity;
    for (const orb of _gs.orbs) {
        if (orb.vy < 0 && orb.y < _ch * 0.6) {
            const t = orb.y / Math.abs(orb.vy);
            if (t < minTime) { minTime = t; threat = orb; }
        }
    }

    // §5 botSkill: how often it bothers to block, and how accurately it predicts
    // the orb's path. Easy whiffs ~45% of blocks and mis-places them badly.
    const blockChance = 0.35 + _botSkill * 0.6;               // 0.50 easy → 0.86 hard
    const aimErrPx    = (1 - _botSkill) * _cw * 0.22 * (Math.random() + Math.random() - 1);
    if (threat && minTime < 1.5 && Math.random() < blockChance) {
        const lead = 0.18;   // s of prediction; trimmed with the faster orb
        const lx = threat.x + threat.vx * lead + aimErrPx;
        const ly = Math.max(_ch * 0.05, Math.min(_ch * 0.44, threat.y + threat.vy * lead));
        const w  = _cw * 0.14;
        // The bot draws inside the same box a human is held to — otherwise it
        // could defend the screen edge from a place no player can reach.
        _gs.barriers.push({
            points: [
                _clampDraw(lx - w, ly, true),
                _clampDraw(lx + w, ly + w * (Math.random() - 0.5), true),
            ],
            life: 1.0,
            color: C_P2,
        });
        sfx('boost');
    }

    // Poll faster than before: the orb now moves ~1.8× quicker, and at the old
    // 350–700 ms cadence the bot was drawing barriers where the orb used to be.
    _after(_botTick, 200 + Math.random() * 200);
}

// ── Physics helpers ───────────────────────────────────────────────────────────

// The drawable box, inset from the screen edges so a stroke can't run off and
// so an edge swipe never reaches the browser's own gesture zone. Small enough
// (4% of the width) that an orb hugging a wall is still inside a barrier's reach.
const DRAW_INSET = 0.04;

function _drawBox(top) {
    const m = _cw * DRAW_INSET;
    return {
        x0: m, x1: _cw - m,
        y0: top ? m : _ch / 2 + m * 0.5,
        y1: top ? _ch / 2 - m * 0.5 : _ch - m,
    };
}

// Clamp a touch into the drawable box for the half the stroke started in.
function _clampDraw(x, y, top) {
    const b = _drawBox(top);
    return {
        x: Math.max(b.x0, Math.min(b.x1, x)),
        y: Math.max(b.y0, Math.min(b.y1, y)),
    };
}

function _distToSegment(x1, y1, x2, y2, px, py) {
    const l2 = (x2-x1)**2 + (y2-y1)**2;
    if (l2 === 0) return { d: Math.hypot(px-x1, py-y1), nx: x1, ny: y1 };
    const t  = Math.max(0, Math.min(1, ((px-x1)*(x2-x1) + (py-y1)*(y2-y1)) / l2));
    const nx = x1 + t*(x2-x1), ny = y1 + t*(y2-y1);
    return { d: Math.hypot(px-nx, py-ny), nx, ny };
}

// Launch speed, in screen-heights per second. At 0.40 the orb drifted across
// the arena and a deflection felt like nudging a balloon; 0.72 makes it read as
// a shot you have to answer. The bounce cap below rises with it so a well-timed
// barrier still adds pace.
const ORB_LAUNCH_SPEED = 0.72;
const ORB_MAX_SPEED    = 1.45;

function _spawnOrb() {
    const speed = _ch * ORB_LAUNCH_SPEED;
    const angle = Math.random() * Math.PI * 2;
    _gs.orbs.push({
        x: _cw / 2, y: _ch / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: Math.max(10, _cw * 0.022),
    });
}

function _burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = Math.random() * _cw * 0.12;
        _gs.particles.push({
            x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
            life: 0.5 + Math.random() * 0.4, color,
        });
    }
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _tick(now) {
    if (!state.mgActive || _done) return;
    _animId = requestAnimationFrame(_tick);

    const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
    _lastTick = now;

    _update(dt);
    if (!_done) _draw();
}

function _update(dt) {
    // Countdown timer
    _gs.timeLeft -= dt;
    if (_gs.timeLeft <= 0) {
        const [h0, h1] = _gs.hp;
        _resolve(h0 > h1 ? 0 : h1 > h0 ? 1 : -1);
        return;
    }

    // Orb spawning
    _gs.spawnTimer -= dt;
    if (_gs.spawnTimer <= 0 && _gs.orbs.length === 0) {
        _spawnOrb();
        _gs.spawnTimer = 9999; // only spawn again after a goal (reset in core-hit logic)
    }

    // Particles
    for (let i = _gs.particles.length - 1; i >= 0; i--) {
        const p = _gs.particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) _gs.particles.splice(i, 1);
    }

    // Barriers decay
    for (let i = _gs.barriers.length - 1; i >= 0; i--) {
        _gs.barriers[i].life -= dt;
        if (_gs.barriers[i].life <= 0) _gs.barriers.splice(i, 1);
    }

    const coreR = _cw * 0.08;

    // Orbs
    for (let i = _gs.orbs.length - 1; i >= 0; i--) {
        const orb = _gs.orbs[i];
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;

        // Wall bounce
        if (orb.x - orb.r < 0)   { orb.x = orb.r;       orb.vx = Math.abs(orb.vx); }
        if (orb.x + orb.r > _cw) { orb.x = _cw - orb.r; orb.vx = -Math.abs(orb.vx); }
        if (orb.y - orb.r < 0)   { orb.y = orb.r;       orb.vy = Math.abs(orb.vy); }
        if (orb.y + orb.r > _ch) { orb.y = _ch - orb.r; orb.vy = -Math.abs(orb.vy); }

        // Core hit — P1 bottom core at (_cw/2, _ch)
        if (Math.hypot(orb.x - _cw/2, orb.y - _ch) < coreR + orb.r) {
            _gs.hp[0]--;
            _burst(orb.x, orb.y, C_P1, 20);
            _gs.orbs.splice(i, 1);
            _gs.spawnTimer = 1.5; // respawn after short delay
            sfx('land_bad'); haptic('heavy');
            if (_gs.hp[0] <= 0) { _resolve(1); return; }
            continue;
        }
        // P2 top core at (_cw/2, 0)
        if (Math.hypot(orb.x - _cw/2, orb.y) < coreR + orb.r) {
            _gs.hp[1]--;
            _burst(orb.x, orb.y, C_P2, 20);
            _gs.orbs.splice(i, 1);
            _gs.spawnTimer = 1.5; // respawn after short delay
            sfx('land_bad'); haptic('heavy');
            if (_gs.hp[1] <= 0) { _resolve(0); return; }
            continue;
        }

        // Barrier collision
        outer: for (let j = _gs.barriers.length - 1; j >= 0; j--) {
            const b = _gs.barriers[j];
            for (let k = 0; k < b.points.length - 1; k++) {
                const p1 = b.points[k], p2 = b.points[k+1];
                const hit = _distToSegment(p1.x, p1.y, p2.x, p2.y, orb.x, orb.y);
                if (hit.d < orb.r + 4) {
                    // Reflect off barrier normal
                    const dx = p2.x - p1.x, dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 0.001) continue;
                    let nx = -dy/len, ny = dx/len;
                    if ((orb.x - hit.nx)*nx + (orb.y - hit.ny)*ny < 0) { nx = -nx; ny = -ny; }
                    const dot = orb.vx*nx + orb.vy*ny;
                    orb.vx = (orb.vx - 2*dot*nx) * 1.05;
                    orb.vy = (orb.vy - 2*dot*ny) * 1.05;
                    // Speed cap to prevent runaway acceleration
                    const spd = Math.hypot(orb.vx, orb.vy);
                    const maxSpd = _ch * ORB_MAX_SPEED;
                    if (spd > maxSpd) { orb.vx = orb.vx/spd*maxSpd; orb.vy = orb.vy/spd*maxSpd; }
                    orb.x += nx * (orb.r - hit.d + 2);
                    orb.y += ny * (orb.r - hit.d + 2);
                    _burst(hit.nx, hit.ny, b.color, 8);
                    sfx('coin_gain'); haptic('medium');
                    _gs.barriers.splice(j, 1);
                    break outer;
                }
            }
        }
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _draw() {
    const ctx = _ctx;
    ctx.globalCompositeOperation = 'source-over';
    // Trailing ghost effect — semi-transparent fill instead of clearRect
    ctx.fillStyle = 'rgba(5,5,16,0.28)';
    ctx.fillRect(0, 0, _cw, _ch);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth  = 4;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';

    // Clock. It used to be one enormous ghost numeral dead centre — exactly
    // where the orb crosses, so the thing you most need to track was permanently
    // sitting on top of the most important patch of screen. It is now a compact
    // readout at each player's own edge, one copy each, upright from where they
    // sit.
    {
        const left = Math.max(0, _gs.timeLeft);
        const col  = left <= 5 ? '#ff6b6b' : left <= 10 ? '#fbbf24' : 'rgba(255,255,255,.5)';
        const size = Math.round(_cw * 0.075);
        for (let pid = 0; pid < 2; pid++) {
            ctx.save();
            if (pid === 1) { ctx.translate(_cw, _ch); ctx.rotate(Math.PI); }
            ctx.fillStyle = col;
            ctx.font = `900 ${size}px "Bebas Neue", sans-serif`;
            ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
            ctx.fillText(`${Math.ceil(left)}s`, _cw - 14, _ch - 54);
            ctx.restore();
        }
        // A faint tick ring on the divider, so the pressure is visible without
        // any text sitting in the play area.
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(_cw / 2, _ch / 2, _cw * 0.055, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * (left / 30));
        ctx.stroke();
        ctx.restore();
    }

    // The status strip was left reading whatever the manager last put there —
    // "MINIGAME TIME" for the whole round. Give it the live score.
    {
        const neu = document.getElementById('mg-neutral');
        if (neu && !_done) {
            neu.textContent = `DRAW BARRIERS!   P1 ${'♥'.repeat(Math.max(0, _gs.hp[0]))} · ` +
                              `${'♥'.repeat(Math.max(0, _gs.hp[1]))} P2`;
        }
    }

    // The drawable boundary, shown so players know where their strokes live.
    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 2;
    for (const top of [true, false]) {
        const b = _drawBox(top);
        ctx.strokeStyle = top ? C_P2 : C_P1;
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Divider line
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(0, _ch/2); ctx.lineTo(_cw, _ch/2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.globalCompositeOperation = 'lighter';

    const coreR = _cw * 0.08;

    // Cores
    _drawCore(ctx, _cw/2, _ch, coreR, C_P1, _gs.hp[0]);
    _drawCore(ctx, _cw/2, 0,   coreR, C_P2, _gs.hp[1]);

    // Active drag preview
    for (const key in _gs.activeTouches) {
        const t = _gs.activeTouches[key];
        if (t.points.length < 2) continue;
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = t.color;
        ctx.strokeStyle  = t.color;
        ctx.globalAlpha  = 0.45;
        ctx.beginPath();
        ctx.moveTo(t.points[0].x, t.points[0].y);
        for (let i = 1; i < t.points.length; i++) ctx.lineTo(t.points[i].x, t.points[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    // Barriers
    for (const b of _gs.barriers) {
        if (b.points.length < 2) continue;
        ctx.shadowBlur  = 14;
        ctx.shadowColor = b.color;
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.beginPath();
        ctx.moveTo(b.points[0].x, b.points[0].y);
        for (let i = 1; i < b.points.length; i++) ctx.lineTo(b.points[i].x, b.points[i].y);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    // Orbs
    ctx.shadowBlur  = 20;
    ctx.shadowColor = C_ORB;
    ctx.fillStyle   = C_ORB;
    for (const orb of _gs.orbs) {
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI*2);
        ctx.fill();
    }

    // Particles
    for (const p of _gs.particles) {
        ctx.shadowColor = p.color;
        ctx.fillStyle   = p.color;
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, _cw * 0.005), 0, Math.PI*2);
        ctx.fill();
    }
    ctx.globalAlpha  = 1.0;
    ctx.shadowBlur   = 0;
}

function _drawCore(ctx, cx, cy, r, color, hp) {
    ctx.shadowBlur  = 18;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // HP pips
    const pipR = Math.max(5, _cw * 0.014);
    const gap  = pipR * 2.6;
    const startX = cx - (hp - 1) * gap / 2;
    const pipY   = cy > _ch / 2 ? cy - r * 0.35 : cy + r * 0.35;
    ctx.fillStyle = color;
    for (let i = 0; i < hp; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * gap, pipY, pipR, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.lineWidth = 4;
}

// ── Win / Cleanup ─────────────────────────────────────────────────────────────

function _resolve(winnerId) {
    if (_done) return;
    _done = true;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }

    const neutralEl = document.getElementById('mg-neutral');
    if (neutralEl) neutralEl.textContent = winnerId === -1 ? 'DRAW!' : `P${winnerId + 1} WINS!`;
    sfx('mg_win'); haptic('heavy');

    // Raw setTimeout — avoids _after's state.mgActive guard race on teardown.
    // Always destroy to avoid leaving a stale overlay in the DOM; only call
    // _onWin if mgActive is still true (prevents double-processing when the
    // 45-second fallback fires first).
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        _destroy();
        if (state.mgActive) _onWin(winnerId);
    }, 1200);
    _timers.push(id);
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    _canvas = null; _ctx = null; _gs = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
