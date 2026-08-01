// ============================================================
// CIRCUIT TRACE — trace without crashing. Drag your finger from the pad at the
// bottom of your half to the pad at the top, staying inside a winding circuit.
// Touch a wall and you short out back to your last checkpoint. Finish a circuit
// and a tighter one replaces it. Most circuits completed in 30 s wins.
//
// Verb: guided path-following under pressure — named in
// docs/MINIGAME_STANDARD.md §7 as a target for the roster. Distinct from Steady
// Hand (hold still on a moving target): here the target is a route, and the
// tension is speed versus precision rather than reaction.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME    = 30;    // s
const NODES        = 7;     // waypoints per circuit before smoothing
const SMOOTH_STEPS = 10;    // interpolated points between waypoints
const BASE_WIDTH   = 0.155; // track half-width, as a fraction of the half's width
const WIDTH_STEP   = 0.020; // narrower each completed circuit
const MIN_WIDTH    = 0.062;
const CHECKPOINTS  = 4;     // evenly spaced along the path
const CRASH_LOCK   = 0.45;  // s of lockout after shorting out
const MAX_JUMP     = 0.075; // biggest allowed jump in path progress per sample

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

// Per player
let _path    = [[], []];     // array of {x,y} in 0..1 fractions of the half
let _width   = [0, 0];       // current half-width fraction
let _prog    = [0, 0];       // 0..1 along the path
let _cp      = [0, 0];       // last checkpoint index reached
let _laps    = [0, 0];
let _lock    = [0, 0];       // s of crash lockout remaining
let _tracing = [false, false];
let _cursor  = [null, null]; // last local pointer pos {x,y} for the trail
let _flash   = [0, 0];
const _pointerOwner = {};    // pointerId → pid

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
    _laps = [0, 0]; _lock = [0, 0]; _flash = [0, 0];
    _tracing = [false, false]; _cursor = [null, null];
    for (const k of Object.keys(_pointerOwner)) delete _pointerOwner[k];
    registerMinigameCleanup(_destroy);
    for (let p = 0; p < 2; p++) _newCircuit(p);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── Circuit generation ───────────────────────────────────────────────────────
// A rising zig-zag of waypoints, smoothed into a polyline. Both players get
// their own circuit of identical difficulty (same width, same node count) but
// different shapes, so neither can copy the other's line (R5 symmetry).
function _newCircuit(pid) {
    const raw = [];
    const margin = 0.20;
    for (let i = 0; i < NODES; i++) {
        const t = i / (NODES - 1);
        // y runs bottom (0.9) → top (0.12) of the half.
        const y = 0.90 - t * 0.78;
        // Alternate sides with jitter so the route always has real corners.
        const side = i % 2 === 0 ? -1 : 1;
        const amp  = i === 0 || i === NODES - 1 ? 0 : 0.26 + Math.random() * 0.10;
        const x = 0.5 + side * amp * (0.6 + Math.random() * 0.6);
        raw.push({ x: Math.min(1 - margin, Math.max(margin, x)), y });
    }
    // Catmull-Rom-ish smoothing into a dense polyline.
    const pts = [];
    for (let i = 0; i < raw.length - 1; i++) {
        const p0 = raw[Math.max(0, i - 1)], p1 = raw[i], p2 = raw[i + 1], p3 = raw[Math.min(raw.length - 1, i + 2)];
        for (let s = 0; s < SMOOTH_STEPS; s++) {
            const t = s / SMOOTH_STEPS, t2 = t * t, t3 = t2 * t;
            pts.push({
                x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x) * t3),
                y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y) * t3),
            });
        }
    }
    pts.push(raw[raw.length - 1]);
    _path[pid]  = pts;
    _width[pid] = Math.max(MIN_WIDTH, BASE_WIDTH - _laps[pid] * WIDTH_STEP);
    _prog[pid]  = 0;
    _cp[pid]    = 0;
    _tracing[pid] = false;
}

// Nearest point on the polyline; returns { t, dist } with t in 0..1.
function _project(pid, x, y, aspect) {
    const pts = _path[pid];
    let best = { t: 0, dist: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        // Compare in aspect-corrected space so "distance" is visually uniform.
        const ax = a.x, ay = a.y * aspect, bx = b.x, by = b.y * aspect;
        const px = x,   py = y * aspect;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        u = Math.max(0, Math.min(1, u));
        const cx = ax + dx * u, cy = ay + dy * u;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best.dist) best = { t: (i + u) / (pts.length - 1), dist: d };
    }
    return best;
}

// ── DOM ──────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#08131a;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Screen → half-local fractions. The top half is drawn rotated 180°.
    const toLocal = (e) => {
        const rect = _overlay.getBoundingClientRect();
        const w = _overlay.clientWidth, h = _overlay.clientHeight;
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const pid = sy > h / 2 ? 0 : 1;
        const hh = h / 2;
        const lx = pid === 0 ? sx : w - sx;
        const ly = pid === 0 ? sy - hh : hh - sy;
        return { pid, x: lx / w, y: ly / hh, aspect: hh / w };
    };

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const L = toLocal(e);
        if (L.pid === 1 && _isBot) return;
        _pointerOwner[e.pointerId] = L.pid;
        _cursor[L.pid] = { x: L.x, y: L.y };
        if (_lock[L.pid] > 0) return;
        // Must start on (or near) the pad at the bottom of the circuit.
        const startPt = _path[L.pid][0];
        const d = Math.hypot(L.x - startPt.x, (L.y - startPt.y) * L.aspect);
        if (d < _width[L.pid] * 1.6) { _tracing[L.pid] = true; _prog[L.pid] = 0; _cp[L.pid] = 0; }
    };

    const onMove = e => {
        if (_done) return;
        const pid = _pointerOwner[e.pointerId];
        if (pid === undefined) return;
        e.preventDefault();
        const L = toLocal(e);
        if (L.pid !== pid) return;             // dragged across the divider
        _cursor[pid] = { x: L.x, y: L.y };
        if (!_tracing[pid] || _lock[pid] > 0) return;

        const { t, dist } = _project(pid, L.x, L.y, L.aspect);
        if (dist > _width[pid]) { _crash(pid); return; }
        // Never let a finger teleport across a hairpin to skip track.
        if (t > _prog[pid] + MAX_JUMP) { _crash(pid); return; }
        if (t > _prog[pid]) {
            _prog[pid] = t;
            const cp = Math.floor(t * CHECKPOINTS);
            if (cp > _cp[pid]) { _cp[pid] = cp; sfx('seq_lit'); if (pid === 0) haptic([10]); }
            if (t >= 0.985) _complete(pid);
        }
    };

    const onUp = e => {
        const pid = _pointerOwner[e.pointerId];
        if (pid === undefined) return;
        delete _pointerOwner[e.pointerId];
        _tracing[pid] = false;
        _cursor[pid] = null;
        // Lifting off drops you back to the last checkpoint — no free rests.
        _prog[pid] = _cp[pid] / CHECKPOINTS;
    };

    _overlay.addEventListener('pointerdown',   onDown);
    _overlay.addEventListener('pointermove',   onMove);
    _overlay.addEventListener('pointerup',     onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown',   onDown);
        _overlay.removeEventListener('pointermove',   onMove);
        _overlay.removeEventListener('pointerup',     onUp);
        _overlay.removeEventListener('pointercancel', onUp);
    });

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'TRACE THE CIRCUIT!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
}

function _crash(pid) {
    _tracing[pid] = false;
    _lock[pid]    = CRASH_LOCK;
    _flash[pid]   = 0.5;
    _prog[pid]    = _cp[pid] / CHECKPOINTS;   // back to the last checkpoint
    sfx('land_bad');
    if (pid === 0) haptic([70]);
}

function _complete(pid) {
    _laps[pid]++;
    _flash[pid] = 0.6;
    sfx('coin_gain');
    if (pid === 0) haptic([20, 30, 20]);
    _newCircuit(pid);
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
        if (_lock[p]  > 0) _lock[p]  = Math.max(0, _lock[p]  - dt);
        if (_flash[p] > 0) _flash[p] = Math.max(0, _flash[p] - dt);
    }
    if (_isBot) _botUpdate(dt);

    const left = Math.max(0, GAME_TIME - _elapsed);
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = `${Math.ceil(left)}s   P1 ${_laps[0]} · ${_laps[1]} P2`;

    if (_elapsed >= GAME_TIME) {
        // Tie-break on how far into the current circuit each player got.
        const a = _laps[0] + _prog[0] * 0.5, b = _laps[1] + _prog[1] * 0.5;
        _finish(a > b ? 0 : b > a ? 1 : -1);
        return;
    }
    _draw();
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Advances along its own circuit at a skill-scaled pace, with a per-second
// crash chance that falls as skill rises. Never perfect, never hopeless.
function _botUpdate(dt) {
    const pid = 1;
    if (_lock[pid] > 0) return;
    const speed = 0.16 + _botSkill * 0.30;                 // path fraction per second
    const crashPerSec = (1 - _botSkill) * 0.55;
    if (Math.random() < crashPerSec * dt) { _crash(pid); return; }
    _prog[pid] = Math.min(1, _prog[pid] + speed * dt * (0.85 + Math.random() * 0.3));
    const cp = Math.floor(_prog[pid] * CHECKPOINTS);
    if (cp > _cp[pid]) _cp[pid] = cp;
    if (_prog[pid] >= 0.985) _complete(pid);
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

    _ctx.strokeStyle = 'rgba(255,255,255,0.14)'; _ctx.lineWidth = 2;
    _ctx.beginPath(); _ctx.moveTo(0, h / 2); _ctx.lineTo(w, h / 2); _ctx.stroke();
}

function _drawHalf(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const pts = _path[pid];
    if (!pts || pts.length < 2) return;
    const px = p => p.x * w, py = p => p.y * h;
    const strokeW = _width[pid] * w * 2;

    // Track bed
    _ctx.lineCap = 'round'; _ctx.lineJoin = 'round';
    _ctx.strokeStyle = _lock[pid] > 0 ? 'rgba(248,113,113,0.30)' : 'rgba(255,255,255,0.10)';
    _ctx.lineWidth = strokeW;
    _ctx.beginPath();
    _ctx.moveTo(px(pts[0]), py(pts[0]));
    for (let i = 1; i < pts.length; i++) _ctx.lineTo(px(pts[i]), py(pts[i]));
    _ctx.stroke();

    // Walls — dashed edges so the boundary is legible without relying on colour
    _ctx.strokeStyle = _lock[pid] > 0 ? '#f87171' : 'rgba(255,255,255,0.28)';
    _ctx.lineWidth = 2; _ctx.setLineDash([6, 6]);
    _ctx.stroke();
    _ctx.setLineDash([]);

    // Completed portion
    const upto = Math.max(1, Math.floor(_prog[pid] * (pts.length - 1)));
    _ctx.strokeStyle = accent;
    _ctx.globalAlpha = 0.55;
    _ctx.lineWidth = strokeW * 0.62;
    _ctx.beginPath();
    _ctx.moveTo(px(pts[0]), py(pts[0]));
    for (let i = 1; i <= upto; i++) _ctx.lineTo(px(pts[i]), py(pts[i]));
    _ctx.stroke();
    _ctx.globalAlpha = 1;

    // Checkpoints
    for (let c = 1; c < CHECKPOINTS; c++) {
        const idx = Math.floor((c / CHECKPOINTS) * (pts.length - 1));
        const p = pts[idx];
        _ctx.beginPath();
        _ctx.arc(px(p), py(p), 4, 0, Math.PI * 2);
        _ctx.fillStyle = _cp[pid] >= c ? '#4ade80' : 'rgba(255,255,255,0.30)';
        _ctx.fill();
    }

    // Start pad + finish pad
    _ctx.beginPath(); _ctx.arc(px(pts[0]), py(pts[0]), strokeW * 0.42, 0, Math.PI * 2);
    _ctx.fillStyle = _tracing[pid] ? 'rgba(74,222,128,0.35)' : 'rgba(74,222,128,0.18)';
    _ctx.fill();
    _ctx.strokeStyle = '#4ade80'; _ctx.lineWidth = 2; _ctx.stroke();
    const end = pts[pts.length - 1];
    _ctx.beginPath(); _ctx.arc(px(end), py(end), strokeW * 0.42, 0, Math.PI * 2);
    _ctx.fillStyle = 'rgba(251,191,36,0.20)'; _ctx.fill();
    _ctx.strokeStyle = '#fbbf24'; _ctx.stroke();
    _ctx.font = '900 12px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillStyle = '#4ade80'; _ctx.fillText('START', px(pts[0]), py(pts[0]) + strokeW * 0.42 + 10);
    _ctx.fillStyle = '#fbbf24'; _ctx.fillText('END',   px(end),    py(end)    - strokeW * 0.42 - 10);

    // Finger cursor
    const c = _cursor[pid];
    if (c) {
        _ctx.beginPath(); _ctx.arc(c.x * w, c.y * h, 7, 0, Math.PI * 2);
        _ctx.fillStyle = _lock[pid] > 0 ? '#f87171' : accent;
        _ctx.fill();
    }

    // HUD
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'top';
    _ctx.font = '700 14px Nunito, sans-serif'; _ctx.fillStyle = accent;
    _ctx.fillText(`P${pid + 1}`, 12, 8);
    _ctx.textAlign = 'right';
    _ctx.font = '900 22px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_laps[pid]}`, w - 12, 4);
    _ctx.font = '600 10px Nunito, sans-serif'; _ctx.fillStyle = 'rgba(255,255,255,0.45)';
    _ctx.fillText('CIRCUITS', w - 12, 26);

    if (_flash[pid] > 0) {
        _ctx.globalAlpha = Math.min(1, _flash[pid] * 2);
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
        _ctx.font = '900 24px "Bebas Neue", sans-serif';
        const shorted = _lock[pid] > 0;
        _ctx.fillStyle = shorted ? '#f87171' : '#4ade80';
        _ctx.fillText(shorted ? 'SHORT CIRCUIT!' : 'CIRCUIT COMPLETE!', w / 2, h * 0.5);
        _ctx.globalAlpha = 1;
    }
}

// ── End ──────────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = winnerId < 0
        ? `DRAW — ${_laps[0]} CIRCUITS EACH`
        : `P${winnerId + 1} WINS — ${_laps[winnerId]} CIRCUITS!`;
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
    _path = [[], []]; _cursor = [null, null];
    for (const k of Object.keys(_pointerOwner)) delete _pointerOwner[k];
}
