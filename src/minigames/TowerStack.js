// ============================================================
// TOWER STACK — stack & balance. A slab slides across your half; tap to drop
// it. Only the part that overlaps the slab below survives, so sloppy stacking
// narrows every future slab. Miss completely and the top floor collapses.
// Tallest tower when the clock runs out wins.
//
// Verb: stack & balance — nothing else in the roster asks for spatial
// alignment under time pressure, and the self-narrowing slab means precision
// compounds instead of resetting each round (skill depth, §6.2).
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME    = 28;    // s — inside the 15–40 s window (§3)
const FLOOR_H      = 15;    // px per floor
const START_W      = 0.62;  // first slab width, as a fraction of the half's width
const MIN_W        = 0.11;  // slabs never shrink below this — always winnable
const BASE_SPEED   = 0.62;  // slab travel, half-widths PER SECOND (R1)
const SPEED_PER_FL = 0.030; // added per floor — escalation, not snowball (§3)
const MAX_SPEED    = 1.9;
const PERFECT_TOL  = 0.012; // |offset| under this = PERFECT: no width lost, +1 bonus
const MISS_PENALTY = 1;     // floors lost on a clean miss
const RECOVER_W    = 0.42;  // width restored after a miss so a bad drop isn't fatal
const VISIBLE_FL   = 9;     // floors drawn before the tower scrolls

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

// Per-player tower: floors are { x, w } in 0..1 fractions of the half width.
let _floors = [[], []];
let _cur    = [null, null];   // moving slab { x, w, dir }
let _perfect = [0, 0];        // consecutive perfect drops (combo)
let _flash  = [0, 0];         // seconds of result flash remaining
let _flashKind = ['', ''];
let _botNextDrop = 0;

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _last = 0; _elapsed = 0;
    _floors = [[], []];
    _perfect = [0, 0]; _flash = [0, 0]; _flashKind = ['', ''];
    _botNextDrop = 0;
    registerMinigameCleanup(_destroy);

    for (let p = 0; p < 2; p++) {
        _floors[p].push({ x: 0.5 - START_W / 2, w: START_W });   // foundation
        _spawn(p);
    }

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

function _spawn(pid) {
    const top = _floors[pid][_floors[pid].length - 1];
    // Alternate entry side so the rhythm never becomes rote.
    const fromLeft = _floors[pid].length % 2 === 0;
    _cur[pid] = { x: fromLeft ? 0 : 1 - top.w, w: top.w, dir: fromLeft ? 1 : -1 };
}

function _speed(pid) {
    return Math.min(BASE_SPEED + _floors[pid].length * SPEED_PER_FL, MAX_SPEED);
}

// ── DOM ──────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#0d1220;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const pid = e.clientY > _overlay.clientHeight / 2 ? 0 : 1;
        if (pid === 1 && _isBot) return;
        _drop(pid);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'TAP TO STACK!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

// ── Drop resolution ──────────────────────────────────────────────────────────
function _drop(pid) {
    const slab = _cur[pid];
    if (!slab) return;
    const below = _floors[pid][_floors[pid].length - 1];

    const left  = Math.max(slab.x, below.x);
    const right = Math.min(slab.x + slab.w, below.x + below.w);
    const overlap = right - left;

    if (overlap <= 0) {
        // Clean miss — the top floor collapses, but the run continues with a
        // forgiving slab so one bad tap can't end the game (comeback, §3).
        _perfect[pid] = 0;
        if (_floors[pid].length > 1) _floors[pid].pop();
        const t = _floors[pid][_floors[pid].length - 1];
        const w = Math.max(t.w, RECOVER_W);
        _floors[pid][_floors[pid].length - 1] = { x: Math.min(Math.max(t.x, 0), 1 - w), w };
        _flash[pid] = 0.55; _flashKind[pid] = 'MISS';
        sfx('land_bad'); if (pid === 0) haptic([90]);
        _spawn(pid);
        return;
    }

    const offset = Math.abs(slab.x - below.x);
    if (offset <= PERFECT_TOL) {
        // Perfect: keep the full width and bank a bonus floor for the combo.
        _perfect[pid]++;
        _floors[pid].push({ x: below.x, w: below.w });
        _flash[pid] = 0.5; _flashKind[pid] = _perfect[pid] > 1 ? `PERFECT ×${_perfect[pid]}` : 'PERFECT';
        sfx('coin_gain'); if (pid === 0) haptic([15, 25, 15]);
    } else {
        _perfect[pid] = 0;
        _floors[pid].push({ x: left, w: Math.max(overlap, MIN_W) });
        _flash[pid] = 0.32; _flashKind[pid] = '';
        sfx('land_good'); if (pid === 0) haptic([12]);
    }
    _spawn(pid);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    for (let p = 0; p < 2; p++) {
        const slab = _cur[p];
        if (!slab) continue;
        slab.x += slab.dir * _speed(p) * dt;
        // Bounce off the edges of the half.
        if (slab.x <= 0)             { slab.x = 0;             slab.dir = 1; }
        if (slab.x + slab.w >= 1)    { slab.x = 1 - slab.w;    slab.dir = -1; }
        if (_flash[p] > 0) _flash[p] = Math.max(0, _flash[p] - dt);
    }

    if (_isBot) _botUpdate(dt);

    const left = Math.max(0, GAME_TIME - _elapsed);
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `${Math.ceil(left)}s   P1 ${_height(0)} · ${_height(1)} P2`;

    if (_elapsed >= GAME_TIME) {
        const a = _height(0), b = _height(1);
        _finish(a > b ? 0 : b > a ? 1 : -1);
        return;
    }
    _draw();
}

function _height(pid) { return _floors[pid].length - 1; }   // foundation isn't a floor

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Aims for alignment with the slab below, with a skill-scaled placement error
// and an occasional outright whiff. Never frame-perfect.
function _botUpdate(dt) {
    const pid = 1;
    const slab = _cur[pid];
    if (!slab) return;
    _botNextDrop -= dt;
    if (_botNextDrop > 0) return;

    const below = _floors[pid][_floors[pid].length - 1];
    // Error shrinks with skill: ~±14% of the half at easy, ~±2% at hard.
    const err = (1 - _botSkill) * 0.16 * (Math.random() + Math.random() - 1);
    const target = below.x + err;
    // Drop when the slab is sweeping through the intended spot.
    const willArrive = (slab.dir > 0 && slab.x >= target) || (slab.dir < 0 && slab.x <= target);
    if (willArrive) {
        // Sometimes it just fumbles the timing entirely.
        if (Math.random() < (1 - _botSkill) * 0.10) { _botNextDrop = 0.35 + Math.random() * 0.5; return; }
        _drop(pid);
        // Cadence floor: without it the hard bot dropped ~2.2 slabs/second and
        // ran away with 60+ floors — faster than a human can reasonably tap.
        _botNextDrop = 0.30 + (1 - _botSkill) * 0.50 + Math.random() * 0.16;
    }
}

// ── Draw ─────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    _ctx.save();
    _ctx.translate(w, h / 2); _ctx.rotate(Math.PI);
    _drawHalf(1, w, h / 2);
    _ctx.restore();

    _ctx.save();
    _ctx.translate(0, h / 2);
    _drawHalf(0, w, h / 2);
    _ctx.restore();

    // Divider
    _ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const pad    = w * 0.06;
    const bw     = w - pad * 2;              // playfield width in px
    const baseY  = h - 26;                   // ground line
    const floors = _floors[pid];

    // Scroll so the working floor stays in view once the tower is tall.
    const scroll = Math.max(0, floors.length - VISIBLE_FL) * FLOOR_H;

    // Ground
    _ctx.fillStyle = 'rgba(255,255,255,0.07)';
    _ctx.fillRect(pad, baseY + 2, bw, 3);

    // Stack
    for (let i = 0; i < floors.length; i++) {
        const f = floors[i];
        const y = baseY - (i + 1) * FLOOR_H + scroll;
        if (y > h || y < -FLOOR_H) continue;
        const x = pad + f.x * bw;
        const fw = Math.max(2, f.w * bw);
        // Alternate shade so individual floors are countable at a glance.
        const t = i / Math.max(1, floors.length);
        _ctx.fillStyle = i === 0
            ? 'rgba(255,255,255,0.22)'
            : `hsl(${(pid === 0 ? 8 : 210) + t * 40}, 78%, ${44 + (i % 2) * 9}%)`;
        _roundRect(x, y, fw, FLOOR_H - 2, 3);
        _ctx.fill();
        _ctx.strokeStyle = 'rgba(0,0,0,0.28)'; _ctx.lineWidth = 1; _ctx.stroke();
    }

    // Moving slab
    const slab = _cur[pid];
    if (slab) {
        const y = baseY - (floors.length + 1) * FLOOR_H + scroll;
        const x = pad + slab.x * bw;
        const fw = Math.max(2, slab.w * bw);
        _ctx.fillStyle = accent;
        _roundRect(x, y, fw, FLOOR_H - 2, 3);
        _ctx.fill();
        // Alignment guide: shows where the slab below sits, so the goal is
        // legible without relying on colour (§4).
        const below = floors[floors.length - 1];
        _ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        _ctx.setLineDash([4, 4]); _ctx.lineWidth = 1.5;
        _ctx.beginPath();
        _ctx.moveTo(pad + below.x * bw, y - 3);
        _ctx.lineTo(pad + below.x * bw, y + FLOOR_H + 3);
        _ctx.stroke();
        _ctx.setLineDash([]);
    }

    // Header: player tag + floor count
    _ctx.fillStyle = accent;
    _ctx.font = '700 15px Nunito, sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.fillText(`P${pid + 1}`, pad, 8);
    _ctx.textAlign = 'right';
    _ctx.font = '900 22px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_height(pid)}`, w - pad, 4);
    _ctx.font = '600 10px Nunito, sans-serif';
    _ctx.fillStyle = 'rgba(255,255,255,0.45)';
    _ctx.fillText('FLOORS', w - pad, 28);

    // Result flash
    if (_flash[pid] > 0 && _flashKind[pid]) {
        _ctx.globalAlpha = Math.min(1, _flash[pid] * 2.2);
        _ctx.fillStyle = _flashKind[pid] === 'MISS' ? '#f87171' : '#fbbf24';
        _ctx.font = '900 26px "Bebas Neue", sans-serif';
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.fillText(_flashKind[pid], w / 2, h * 0.30);
        _ctx.globalAlpha = 1;
    }
}

function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.arcTo(x + w, y, x + w, y + h, r);
    _ctx.arcTo(x + w, y + h, x, y + h, r);
    _ctx.arcTo(x, y + h, x, y, r);
    _ctx.arcTo(x, y, x + w, y, r);
    _ctx.closePath();
}

// ── End ──────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = winnerId < 0
        ? `DRAW! ${_height(0)} FLOORS EACH`
        : `P${winnerId + 1} WINS — ${_height(winnerId)} FLOORS!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _elapsed = 0;
    _cur = [null, null];
}
