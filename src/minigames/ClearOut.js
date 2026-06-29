// ============================================================
// CLEAR OUT — flick / clear. A shared arena split by a wall with one
// small gap. Each player starts with 4 discs on their side; slingshot
// them through the gap onto the rival's side. Discs collide and bounce.
// Empty YOUR side to win (fewest-on-your-side wins if time runs out).
// Fills the "flick to clear" verb — a shared-arena physics duel, like
// Sumo Spheres but about offloading rather than knockout.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables (fractions of screen width unless noted) ────────────────────────
const GAME_TIME   = 40;     // seconds (safety / tiebreak)
const N_PER_SIDE  = 4;
const DISC_RF     = 0.050;  // disc radius
const WALL_TF     = 0.016;  // wall thickness
const GAP_WF      = 0.20;   // gap width — "decently small"
const REST_WALL   = 0.55;   // wall restitution
const REST_DISC   = 0.92;   // disc-disc restitution
const DAMP        = 1.15;   // velocity decay per second (e^-DAMP*dt)
const POWER       = 5.0;    // slingshot pull → launch speed
const STOP_EPSF   = 0.018;  // below this speed (w/s) a disc is "stopped"

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _W = 0, _H = 0, _R = 0, _wallT = 0, _gapX0 = 0, _gapX1 = 0, _maxSpeed = 0, _stopEps = 0;
let _discs = [];
let _posts = [];
let _aim   = [null, null];   // per player: { disc, px, py }
let _botCd = 1.0;

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _t = 0; _aim = [null, null]; _botCd = 1.0;
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _layout(true);
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0c0f17;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const sideOf = y => (y > _H / 2 ? 0 : 1);   // 0 = bottom (P1), 1 = top (P2)
    const down = e => {
        if (_done) return; e.preventDefault();
        const pid = sideOf(e.clientY);
        if (pid === 1 && _isBot) return;
        if (_aim[pid]) return;
        // Grab the nearest own-side disc within reach.
        let best = null, bestD = _R * 3.2;
        for (const d of _discs) {
            if ((d.y > _H / 2 ? 0 : 1) !== pid) continue;
            const dd = Math.hypot(d.x - e.clientX, d.y - e.clientY);
            if (dd < bestD) { bestD = dd; best = d; }
        }
        if (best) _aim[pid] = { disc: best, px: e.clientX, py: e.clientY };
    };
    const move = e => {
        if (_done) return; e.preventDefault();
        const pid = sideOf(e.clientY);
        if (_aim[pid]) { _aim[pid].px = e.clientX; _aim[pid].py = e.clientY; }
    };
    const up = e => {
        if (_done) return; e.preventDefault();
        for (let pid = 0; pid < 2; pid++) {
            const a = _aim[pid]; if (!a) continue;
            // Launch opposite the pull (slingshot).
            let vx = (a.disc.x - a.px) * POWER, vy = (a.disc.y - a.py) * POWER;
            const sp = Math.hypot(vx, vy);
            if (sp > _maxSpeed) { vx = vx / sp * _maxSpeed; vy = vy / sp * _maxSpeed; }
            if (sp > _R * 1.2) { a.disc.vx = vx; a.disc.vy = vy; sfx('boost'); if (pid === 0) haptic([20]); }
            _aim[pid] = null;
        }
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointermove', move);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', down));
    _cleanups.push(() => _overlay.removeEventListener('pointermove', move));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', up));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', up));

    const onResize = () => _layout(false);
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'FLICK YOUR DISCS THROUGH THE GAP!';
}

// Compute board metrics; on first call place discs, on resize scale them.
function _layout(first) {
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);

    const oldW = _W || w, oldH = _H || h;
    _W = w; _H = h;
    _R = w * DISC_RF; _wallT = w * WALL_TF;
    const gapW = w * GAP_WF;
    _gapX0 = w / 2 - gapW / 2; _gapX1 = w / 2 + gapW / 2;
    _maxSpeed = w * 2.3; _stopEps = w * STOP_EPSF;
    _posts = [{ x: _gapX0, y: h / 2 }, { x: _gapX1, y: h / 2 }];

    if (first) {
        _discs = [];
        for (let side = 0; side < 2; side++) {
            const y = side === 0 ? h * 0.80 : h * 0.20;
            for (let i = 0; i < N_PER_SIDE; i++) {
                const x = w * (0.5 + (i - (N_PER_SIDE - 1) / 2) * 0.16);
                _discs.push({ x, y, vx: 0, vy: 0 });
            }
        }
    } else {
        const sx = w / oldW, sy = h / oldH;
        _discs.forEach(d => { d.x *= sx; d.y *= sy; });
    }
}

// ── Loop ───────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;

    if (_isBot) _botUpdate(dt);
    _physics(dt);
    _checkWin();
    _draw();

    if (_t >= GAME_TIME && !_done) _finishByCount();
}

// ── Physics (2D circles, substepped, dt-correct) ─────────────────────────────
function _physics(dt) {
    let maxV = 0;
    for (const d of _discs) { const s = Math.hypot(d.vx, d.vy); if (s > maxV) maxV = s; }
    if (maxV < 1e-3) return;
    const sub = Math.min(8, Math.max(1, Math.ceil(maxV * dt / (_R * 0.4))));
    const hdt = dt / sub;
    const damp = Math.exp(-DAMP * hdt);
    for (let s = 0; s < sub; s++) {
        for (const d of _discs) {
            d.x += d.vx * hdt; d.y += d.vy * hdt;
            d.vx *= damp; d.vy *= damp;
            _walls(d);
            for (const p of _posts) _hitPost(d, p);
        }
        for (let i = 0; i < _discs.length; i++)
            for (let j = i + 1; j < _discs.length; j++) _hitPair(_discs[i], _discs[j]);
    }
    for (const d of _discs) if (Math.hypot(d.vx, d.vy) < _stopEps) { d.vx = 0; d.vy = 0; }
}

function _walls(d) {
    const R = _R, W = _W, H = _H, midY = H / 2, half = R + _wallT / 2;
    if (d.x < R) { d.x = R; d.vx = Math.abs(d.vx) * REST_WALL; }
    else if (d.x > W - R) { d.x = W - R; d.vx = -Math.abs(d.vx) * REST_WALL; }
    if (d.y < R) { d.y = R; d.vy = Math.abs(d.vy) * REST_WALL; }
    else if (d.y > H - R) { d.y = H - R; d.vy = -Math.abs(d.vy) * REST_WALL; }
    // Centre wall (solid except the gap).
    const inGap = d.x > _gapX0 && d.x < _gapX1;
    if (!inGap && Math.abs(d.y - midY) < half) {
        if (d.y < midY) { d.y = midY - half; d.vy = -Math.abs(d.vy) * REST_WALL; }
        else            { d.y = midY + half; d.vy =  Math.abs(d.vy) * REST_WALL; }
    }
}

function _hitPost(d, p) {
    const dx = d.x - p.x, dy = d.y - p.y;
    const dist = Math.hypot(dx, dy), min = _R + _wallT * 0.6;
    if (dist >= min || dist === 0) return;
    const nx = dx / dist, ny = dy / dist, overlap = min - dist;
    d.x += nx * overlap; d.y += ny * overlap;
    const vn = d.vx * nx + d.vy * ny;
    if (vn < 0) { d.vx -= (1 + REST_WALL) * vn * nx; d.vy -= (1 + REST_WALL) * vn * ny; }
}

function _hitPair(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy), min = _R * 2;
    if (dist >= min || dist === 0) return;
    const nx = dx / dist, ny = dy / dist, overlap = (min - dist) / 2;
    a.x -= nx * overlap; a.y -= ny * overlap;
    b.x += nx * overlap; b.y += ny * overlap;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn < 0) {
        const imp = -(1 + REST_DISC) * vn / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
    }
}

function _bottomCount() { let n = 0; for (const d of _discs) if (d.y > _H / 2) n++; return n; }
function _settled()     { return _discs.every(d => d.vx === 0 && d.vy === 0) && !_aim[0] && !_aim[1]; }

function _checkWin() {
    if (_done) return;
    if (!_settled()) return;
    const bottom = _bottomCount(), top = _discs.length - bottom;
    if (bottom === 0) _finish(0);          // P1's side cleared
    else if (top === 0) _finish(1);        // P2's side cleared
}

// ── Bot ───────────────────────────────────────────────────────────────────────
function _botUpdate(dt) {
    _botCd -= dt;
    if (_botCd > 0 || _aim[1]) return;
    _botCd = 1.0 - _botSkill * 0.5 + Math.random() * 0.45;
    // Pick a stationary disc on the bot's (top) side.
    const cand = _discs.filter(d => d.y < _H / 2 && d.vx === 0 && d.vy === 0);
    if (!cand.length) return;
    const d = cand[Math.floor(Math.random() * cand.length)];
    // Aim at a point just past the gap on the bottom side, with skill-scaled error.
    const tx = (_gapX0 + _gapX1) / 2 + (Math.random() - 0.5) * (_gapX1 - _gapX0) * (1 - _botSkill);
    const ty = _H / 2 + _R * 5;
    let dx = tx - d.x, dy = ty - d.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const err = (1 - _botSkill) * 0.45 * (Math.random() * 2 - 1);
    const ca = Math.cos(err), sa = Math.sin(err);
    const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
    const power = (0.62 + _botSkill * 0.45 + Math.random() * 0.18) * _maxSpeed;
    d.vx = rx * power; d.vy = ry * power;
    sfx('boost');
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _W, h = _H, midY = h / 2;
    _ctx.clearRect(0, 0, w, h);

    // Side tints (territory) — P1 bottom (red), P2 top (blue).
    _ctx.fillStyle = 'rgba(90,155,255,0.06)'; _ctx.fillRect(0, 0, w, midY);
    _ctx.fillStyle = 'rgba(255,90,90,0.06)';  _ctx.fillRect(0, midY, w, midY);

    // Centre wall (two slabs leaving the gap).
    _ctx.fillStyle = '#3a4252';
    _ctx.fillRect(0, midY - _wallT / 2, _gapX0, _wallT);
    _ctx.fillRect(_gapX1, midY - _wallT / 2, w - _gapX1, _wallT);
    // Gap posts
    _ctx.fillStyle = '#6b7689';
    for (const p of _posts) { _ctx.beginPath(); _ctx.arc(p.x, p.y, _wallT * 0.75, 0, Math.PI * 2); _ctx.fill(); }
    // Gap glow markers
    _ctx.strokeStyle = 'rgba(255,255,255,0.18)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(_gapX0, midY); _ctx.lineTo(_gapX1, midY); _ctx.stroke();

    // Discs
    for (const d of _discs) _drawDisc(d);

    // Aim guides
    for (let pid = 0; pid < 2; pid++) _drawAim(pid);

    // Counts (fewer on your side = winning). Bottom upright, top rotated.
    const bottom = _bottomCount(), top = _discs.length - bottom;
    _ctx.save(); _ctx.fillStyle = '#ff6a6a'; _ctx.font = '900 22px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'bottom';
    _ctx.fillText(`P1 SIDE: ${bottom}`, 14, h - 12); _ctx.restore();
    _ctx.save(); _ctx.translate(w, 0); _ctx.rotate(Math.PI); _ctx.fillStyle = '#6aa8ff';
    _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'left'; _ctx.textBaseline = 'bottom';
    _ctx.fillText(`P2 SIDE: ${top}`, 14, h - 12); _ctx.restore();

    const neu = document.getElementById('mg-neutral');
    if (neu && !_done) neu.textContent = `EMPTY YOUR SIDE!   P1 ${bottom} · ${top} P2   ${Math.ceil(GAME_TIME - _t)}s`;
}

function _drawDisc(d) {
    _ctx.beginPath(); _ctx.arc(d.x, d.y, _R, 0, Math.PI * 2);
    _ctx.fillStyle = '#e9c84a'; _ctx.fill();
    _ctx.lineWidth = 3; _ctx.strokeStyle = '#9c7a14'; _ctx.stroke();
    _ctx.beginPath(); _ctx.arc(d.x, d.y, _R * 0.62, 0, Math.PI * 2);
    _ctx.strokeStyle = 'rgba(255,255,255,0.35)'; _ctx.lineWidth = 2; _ctx.stroke();
    _ctx.fillStyle = 'rgba(255,255,255,0.5)';
    _ctx.beginPath(); _ctx.arc(d.x - _R * 0.3, d.y - _R * 0.3, _R * 0.22, 0, Math.PI * 2); _ctx.fill();
}

function _drawAim(pid) {
    const a = _aim[pid]; if (!a) return;
    const d = a.disc;
    const lvx = d.x - a.px, lvy = d.y - a.py;   // launch direction
    const len = Math.hypot(lvx, lvy);
    if (len < 1) return;
    const ux = lvx / len, uy = lvy / len;
    const reach = Math.min(len, _R * 7);
    // pull-back line
    _ctx.strokeStyle = 'rgba(255,255,255,0.35)'; _ctx.lineWidth = 3;
    _ctx.setLineDash([6, 6]);
    _ctx.beginPath(); _ctx.moveTo(d.x, d.y); _ctx.lineTo(a.px, a.py); _ctx.stroke();
    _ctx.setLineDash([]);
    // launch arrow
    const tipX = d.x + ux * reach, tipY = d.y + uy * reach;
    _ctx.strokeStyle = pid === 0 ? '#ff5a5a' : '#5a9bff'; _ctx.lineWidth = 4;
    _ctx.beginPath(); _ctx.moveTo(d.x, d.y); _ctx.lineTo(tipX, tipY); _ctx.stroke();
    const ang = Math.atan2(uy, ux);
    _ctx.beginPath();
    _ctx.moveTo(tipX, tipY);
    _ctx.lineTo(tipX - Math.cos(ang - 0.4) * _R * 0.6, tipY - Math.sin(ang - 0.4) * _R * 0.6);
    _ctx.lineTo(tipX - Math.cos(ang + 0.4) * _R * 0.6, tipY - Math.sin(ang + 0.4) * _R * 0.6);
    _ctx.closePath(); _ctx.fillStyle = pid === 0 ? '#ff5a5a' : '#5a9bff'; _ctx.fill();
}

// ── End ─────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0 ? 'DRAW!' : `P${winnerId + 1} CLEARS THEIR SIDE!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1600);
}

function _finishByCount() {
    const bottom = _bottomCount(), top = _discs.length - bottom;
    // Fewer discs on your side wins.
    _finish(bottom < top ? 0 : top < bottom ? 1 : -1);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _discs = []; _posts = []; _aim = [null, null]; _last = 0; _t = 0;
}
