// ============================================================
// GRAND PRIX — one circuit, seen once, one pedal each.
//
// The whole track is on screen at all times, drawn as a closed loop from above
// with both cars running on it. Nobody scrolls, nobody has their own view, and
// "who is winning" is answered by looking at the picture — which is the entire
// point of two people sharing one phone.
//
// (The first version gave each player their own scrolling strip of road with a
// little ghost of the rival on it. Two private views of a shared race is a
// contradiction: you could not see the race, only your half of it.)
//
// There is no steering and no brake. Hold your half to open the throttle, let go
// to slow down. Every corner has a speed painted on it, and arriving over that
// speed spins you out for a second — so the skill is knowing when to lift, and
// braking early costs a tenth where braking late costs a second.
//
// The trailing car gets a slipstream, so one spin is not the race.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const LAPS        = 2;
const V_MAX       = 250;    // track units per second
const ACCEL       = 150;
const DRAG_OFF    = 210;    // deceleration with the throttle shut
const DRAG_ON     = 24;     // natural drag while accelerating (caps top speed)
const SPIN_MS     = 950;
const SLIP_GAIN   = 0.13;   // top-speed bonus for the trailing car
const SLIP_RANGE  = 220;    // track units within which the slipstream applies
const MATCH_TIME  = 70;     // s ceiling; furthest round the circuit takes it
const LANE_W      = 15;     // px between the two racing lines

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
let _track = null;          // { pts, len, cum, corners } — the closed circuit
let _cars = null;
let _held = [false, false];
let _botPlan = null;        // committed braking margin for the corner ahead
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── The circuit ─────────────────────────────────────────────────────────────
//
// Built as an explicit rounded rectangle — four straights and four arcs — rather
// than sampled off a superellipse. On a superellipse nothing is ever exactly
// straight, so measuring curvature back off the samples painted almost the whole
// circuit as a corner and left no straight to accelerate down. Here a straight
// has curvature zero because it IS a straight, and each corner's radius is known
// rather than inferred.
//
// The four corners get different radii, so a lap is four different problems
// instead of the same one four times.
const GRIP = 302;           // limit = sqrt(GRIP * radius); r=40 → 110, r=75 → 150

function _buildTrack(w, h) {
    const bw = w * 0.62, bh = h * 0.60;
    const x0 = (w - bw) / 2, y0 = (h - bh) / 2, x1 = x0 + bw, y1 = y0 + bh;
    // top-left, top-right, bottom-right, bottom-left
    const R = [Math.min(bw, bh) * 0.42, Math.min(bw, bh) * 0.22,
               Math.min(bw, bh) * 0.40, Math.min(bw, bh) * 0.20];

    const pts = [], rad = [];
    const STEP = 4.2;                                  // px between samples
    const push = (x, y, r) => { pts.push({ x, y }); rad.push(r); };

    // A straight from a to b, and an arc of radius r about (cx,cy).
    const line = (ax, ay, bx, by) => {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / STEP));
        for (let i = 0; i < n; i++) push(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, Infinity);
    };
    const arc = (cx, cy, r, a0, a1) => {
        const n = Math.max(2, Math.round(Math.abs(a1 - a0) * r / STEP));
        for (let i = 0; i < n; i++) {
            const a = a0 + (a1 - a0) * i / n;
            push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r);
        }
    };

    // Clockwise from the middle of the right-hand straight, so the start/finish
    // sits on a straight rather than mid-corner.
    const midY = (y0 + y1) / 2;
    line(x1, midY, x1, y1 - R[2]);
    arc(x1 - R[2], y1 - R[2], R[2], 0, Math.PI / 2);
    line(x1 - R[2], y1, x0 + R[3], y1);
    arc(x0 + R[3], y1 - R[3], R[3], Math.PI / 2, Math.PI);
    line(x0, y1 - R[3], x0, y0 + R[0]);
    arc(x0 + R[0], y0 + R[0], R[0], Math.PI, Math.PI * 1.5);
    line(x0 + R[0], y0, x1 - R[1], y0);
    arc(x1 - R[1], y0 + R[1], R[1], Math.PI * 1.5, Math.PI * 2);
    line(x1, y0 + R[1], x1, midY);

    const N = pts.length;
    const cum = [0];
    for (let i = 1; i <= N; i++) {
        const a = pts[i - 1], b = pts[i % N];
        cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
    }

    // The speed each sample can be taken at, from its known radius. Widened by a
    // few samples on the way in so the limit bites at the corner's mouth rather
    // than a car's length inside it.
    const raw = rad.map(r => r === Infinity ? Infinity : Math.max(90, Math.min(V_MAX - 25, Math.sqrt(GRIP * r))));
    const limit = raw.slice();
    for (let i = 0; i < N; i++) {
        let m = Infinity;
        for (let k = 0; k <= 5; k++) m = Math.min(m, raw[(i + k) % N]);
        limit[i] = m;
    }
    return { pts, cum, len: cum[N], limit, N };
}

// Position and heading a given distance around the loop.
function _at(d) {
    const { pts, cum, len, N } = _track;
    let s = ((d % len) + len) % len;
    // cum is monotonic, so a binary search is exact and cheap.
    let lo = 0, hi = N;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; (cum[mid] <= s ? lo = mid : hi = mid); }
    const a = pts[lo], b = pts[(lo + 1) % N];
    const seg = Math.max(1e-6, cum[lo + 1] - cum[lo]);
    const t = (s - cum[lo]) / seg;
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        ang: Math.atan2(b.y - a.y, b.x - a.x),
        i: lo,
    };
}

function _limitAt(d) { return _track.limit[_at(d).i]; }

// The next corner ahead that is slower than `v`, and how far away it is.
function _nextCorner(d, v) {
    const { len, N } = _track;
    const step = len / N;
    for (let k = 1; k < N; k++) {
        const dd = d + k * step;
        const lim = _limitAt(dd);
        if (lim < v) return { gap: k * step, limit: lim };
    }
    return null;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _cars = [0, 1].map(() => ({ d: 0, v: 0, spinUntil: 0, spin: 0, spins: 0, lap: 0, finished: 0 }));
    _held = [false, false];
    _botPlan = null;
    _last = 0; _elapsed = 0;
    registerMinigameCleanup(_destroy);           // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _say(`HOLD FOR GAS — ${LAPS} LAPS`);
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM (R2) ────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;' +
        'background:radial-gradient(ellipse at 50% 50%, #16321f 0%, #0a1710 78%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // The track is shared, so the only thing partitioned is the throttle: your
    // half of the screen is your pedal, wherever on it you press.
    const half = e => e.clientY < _overlay.clientHeight / 2 ? 1 : 0;
    const down = e => {
        if (_done) return;
        e.preventDefault();
        const pid = half(e);
        if (pid === 1 && _isBot) return;
        _held[pid] = true;
        if (pid === 0) haptic([8]);
    };
    const up = e => {
        if (_done) return;
        const pid = half(e);
        if (pid === 1 && _isBot) return;
        _held[pid] = false;
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _overlay.addEventListener('pointerleave', up);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown', down);
        _overlay.removeEventListener('pointerup', up);
        _overlay.removeEventListener('pointercancel', up);
        _overlay.removeEventListener('pointerleave', up);
    });

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);       // R4
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    // R1b: the status pill floats at both outer edges, so the circuit is built
    // inside an inset box rather than the raw viewport.
    _track = _buildTrack(_W, _H - 150);
    _track.pts.forEach(p => { p.y += 75; });
}

function _say(t) {
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = t;
}

// ── Physics (R1) ────────────────────────────────────────────────────────────
function _drive(pid, dt, now) {
    const c = _cars[pid];
    if (c.finished) return;

    if (now < c.spinUntil) { c.spin += dt * 13; c.v = 0; return; }
    c.spin = 0;

    const other = _cars[1 - pid];
    const behind = (other.lap * _track.len + other.d) - (c.lap * _track.len + c.d);
    const slip = (behind > 12 && behind < SLIP_RANGE) ? 1 + SLIP_GAIN : 1;

    if (_held[pid]) {
        c.v += ACCEL * dt;
        c.v -= DRAG_ON * dt * (c.v / (V_MAX * slip));
        c.v = Math.min(c.v, V_MAX * slip);
    } else {
        c.v = Math.max(0, c.v - DRAG_OFF * dt);
    }

    const before = c.d;
    c.d += c.v * dt;
    if (c.d >= _track.len) { c.d -= _track.len; c.lap++; if (c.lap < LAPS) sfx('countdown'); }

    // Over the limit anywhere in a corner and you're gone.
    const lim = _limitAt(c.d);
    if (lim !== Infinity && c.v > lim) {
        c.spinUntil = now + SPIN_MS;
        c.spins++;
        c.v = 0;
        c.d = before;
        sfx('land_bad');
        if (pid === 0) haptic([40, 60, 40]);
    }

    if (c.lap >= LAPS) { c.finished = _elapsed; sfx(pid === 0 ? 'mg_win' : 'mg_lose'); }
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// One pedal, same as the player. The skill is entirely in when it lifts: the
// braking MARGIN is committed once per corner while the braking DISTANCE is
// recomputed live from actual speed. Rolling the margin per frame made the
// throttle stutter at the randomness rate and both tiers measured identically;
// computing the distance once from top speed made it brake down every straight.
function _botStep(now) {
    if (!_isBot) return;
    const c = _cars[1];
    if (c.finished || now < c.spinUntil) { _held[1] = false; _botPlan = null; return; }

    const here = _limitAt(c.d);
    if (here !== Infinity) {
        _botPlan = null;
        const cushion = 6 + (1 - _botSkill) * 26;
        _held[1] = c.v < here - cushion;
        return;
    }
    const nc = _nextCorner(c.d, c.v);
    if (!nc) { _held[1] = true; _botPlan = null; return; }

    if (!_botPlan || Math.abs(_botPlan.limit - nc.limit) > 1 || nc.gap > _botPlan.gap + 40) {
        const late = Math.random() < (0.24 - _botSkill * 0.21);   // 19% easy → 6% hard
        _botPlan = {
            limit: nc.limit, gap: nc.gap,
            margin: late ? -22 : (3 + (1 - _botSkill) * 20 + Math.random() * 10),
        };
    }
    _botPlan.gap = nc.gap;
    const need = Math.max(0, (c.v * c.v - nc.limit * nc.limit) / (2 * DRAG_OFF));
    _held[1] = nc.gap > need + _botPlan.margin;
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    _botStep(now);
    _drive(0, dt, now);
    _drive(1, dt, now);

    if (_cars[0].finished && _cars[1].finished) {
        _finish(_cars[0].finished <= _cars[1].finished ? 0 : 1); return;
    }
    if (_cars[0].finished || _cars[1].finished) {
        const w = _cars[0].finished ? 0 : 1;
        if (_elapsed - _cars[w].finished > 2.2) { _finish(w); return; }
    }
    if (_elapsed >= MATCH_TIME) {
        const a = _cars[0].lap * _track.len + _cars[0].d;
        const b = _cars[1].lap * _track.len + _cars[1].d;
        _finish(Math.abs(a - b) < 6 ? -1 : (a > b ? 0 : 1));
        return;
    }
    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx;
    if (!_track) return;
    ctx.clearRect(0, 0, _W, _H);

    const ROAD = 44;
    const loop = () => {
        ctx.beginPath();
        _track.pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
    };

    // Verge, tarmac, centre line.
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    loop(); ctx.strokeStyle = '#1d3a24'; ctx.lineWidth = ROAD + 16; ctx.stroke();
    loop(); ctx.strokeStyle = '#24272f'; ctx.lineWidth = ROAD;      ctx.stroke();

    // Corner bands, painted onto the tarmac in the colour of the speed they
    // demand. Each corner is stroked as ONE polyline with butt caps: drawn as
    // separate round-capped segments, every cap blobbed over its neighbours and
    // the corners came out as a string of overlapping discs.
    const { pts, N } = _track;
    const runs = [];
    for (let i = 0; i < N; i++) {
        if (_track.limit[i] === Infinity) continue;
        const last = runs[runs.length - 1];
        if (last && last.end === i - 1) last.end = i;
        else runs.push({ start: i, end: i, limit: _track.limit[i] });
    }
    ctx.lineCap = 'butt';
    for (const r of runs) {
        // Red only for a corner somebody is actually bearing down on too fast.
        // Colouring on "is anyone anywhere over this limit" lit the whole
        // circuit red the moment either car got up to speed, which is no
        // warning at all.
        const entry = _track.cum[r.start];
        const hot = _cars.some(c => {
            if (c.v <= r.limit) return false;
            let gap = entry - c.d;
            if (gap < 0) gap += _track.len;
            return gap < 150;
        });
        ctx.strokeStyle = hot ? 'rgba(248,80,80,.38)' : 'rgba(251,191,36,.20)';
        ctx.lineWidth = ROAD;
        ctx.beginPath();
        for (let i = r.start; i <= r.end + 1; i++) {
            const p = pts[i % N];
            i === r.start ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }
    ctx.lineCap = 'round';

    // Dashed racing line.
    ctx.setLineDash([10, 14]);
    loop(); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish.
    const s = _at(0);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(s.ang);
    for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? '#fff' : '#111';
        ctx.fillRect(-4, -ROAD / 2 + k * (ROAD / 6), 8, ROAD / 6);
    }
    ctx.restore();

    // One speed board per corner, at its entry, set inside the loop where there
    // is always room.
    for (const r of runs) {
        const p = pts[r.start % N];
        const inward = Math.atan2(_H / 2 - p.y, _W / 2 - p.x);
        const bx = p.x + Math.cos(inward) * (ROAD / 2 + 27);
        const by = p.y + Math.sin(inward) * (ROAD / 2 + 27);
        ctx.fillStyle = 'rgba(251,191,36,.94)';
        _round(ctx, bx - 18, by - 11, 36, 22, 5); ctx.fill();
        ctx.fillStyle = '#231a02';
        ctx.font = '900 14px "Bebas Neue", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(r.limit)), bx, by);
    }

    // The cars, on their own racing line so they never hide each other.
    for (let i = 1; i >= 0; i--) _car(i, ROAD);

    _hud(0);
    ctx.save(); ctx.translate(_W, _H); ctx.rotate(Math.PI); _hud(1); ctx.restore();
}

function _car(pid, ROAD) {
    const ctx = _ctx, c = _cars[pid];
    const p = _at(c.d);
    const nx = Math.cos(p.ang + Math.PI / 2), ny = Math.sin(p.ang + Math.PI / 2);
    const lane = (pid === 0 ? -1 : 1) * LANE_W / 2;
    const x = p.x + nx * lane, y = p.y + ny * lane;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.ang + (c.spin || 0));
    const body = pid === 0 ? '#ff5a5a' : '#5a9bff';
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    _round(ctx, -13, -8, 26, 16, 5); ctx.fill();
    ctx.fillStyle = body;
    _round(ctx, -11, -6, 22, 12, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    _round(ctx, -2, -4, 7, 8, 2); ctx.fill();
    ctx.restore();

    // A ring while spinning, so the reason a car stopped is visible from the
    // other side of the table.
    if (performance.now() < c.spinUntil) {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 17 + Math.sin(performance.now() / 60) * 3, 0, Math.PI * 2); ctx.stroke();
    }
}

function _hud(pid) {
    const ctx = _ctx, c = _cars[pid];
    const spinning = performance.now() < c.spinUntil;
    const color = pid === 0 ? '#ff6b6b' : '#6bb0ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    ctx.font = '900 27px "Bebas Neue", sans-serif';
    ctx.fillStyle = spinning ? '#ef4444' : color;
    ctx.fillText(spinning ? 'SPUN OUT!' : `${Math.round(c.v)}`, _W / 2 - 52, _H - 96);
    ctx.font = '900 27px "Bebas Neue", sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(`LAP ${Math.min(LAPS, c.lap + 1)}/${LAPS}`, _W / 2 + 56, _H - 96);

    ctx.font = '800 11px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    if (!spinning) ctx.fillText('SPEED', _W / 2 - 52, _H - 76);

    // Throttle bar with the next corner's limit marked on the same scale.
    const bw = Math.min(_W * 0.60, 240), bx = (_W - bw) / 2, by = _H - 62;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    _round(ctx, bx, by, bw, 12, 6); ctx.fill();
    ctx.fillStyle = _held[pid] ? '#4ade80' : 'rgba(255,255,255,.30)';
    _round(ctx, bx, by, bw * Math.min(1, c.v / V_MAX), 12, 6); ctx.fill();
    const nc = _nextCorner(c.d, V_MAX);
    if (nc) {
        const lx = bx + bw * Math.min(1, nc.limit / V_MAX);
        ctx.fillStyle = c.v > nc.limit ? '#ef4444' : '#fbbf24';
        ctx.fillRect(lx - 1.5, by - 4, 3, 20);
    }
}

function _round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    _say(winnerId < 0 ? 'PHOTO FINISH — DEAD HEAT!' : `P${winnerId + 1} TAKES THE FLAG! 🏁`);
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    haptic('heavy');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _track = null; _cars = null; _held = [false, false]; _botPlan = null;
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
