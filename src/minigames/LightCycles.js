// ============================================================
// LIGHT CYCLES — spatial denial. Two trails, one arena, no way to share.
//
// The roster's fourth structural gap (docs/MINIGAME_BACKLOG.md): a game you win
// by taking space away from the other player rather than by out-scoring them.
// Both cycles move continuously and leave a solid wall behind. Crash into any
// wall — yours, theirs, or the arena's — and you lose the round.
//
// Every metre you take is a metre they cannot have, which is about as direct as
// interaction gets. The read is instant from across the room: two lines, one
// stops.
//
// Steering is a floating joystick per half — the same control Sumo Spheres uses.
// It appears wherever your thumb lands and you push the direction you want to
// go: up, down, left, right, in real screen terms. The first version asked you
// to tap to the left or right OF YOUR CYCLE, relative to the way it was facing,
// which meant working out your own heading before every turn and inverting the
// whole control every time you drove downward. Absolute directions need no
// mental arithmetic and read the same for both players once their half is
// turned around.
//
// Best of 3 rounds. The arena shrinks each round so a stalemate can't run long,
// and each round opens with a brief grace period so one twitch at the start is
// never the whole match.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const WIN_ROUNDS  = 2;      // best of 3
const MAX_ROUNDS  = 3;
const CELL        = 26;     // grid cell size in css px (trail thickness)
const SPEED       = 5.4;    // cells per SECOND (R1)
const GRACE       = 0.9;    // s at round start where a crash is undone
// No round clock. A round ends when somebody crashes, full stop — cutting it
// off at 15 s and awarding it on floor area decided rounds that were still
// being played, and "more ground" is not what anybody thinks they are competing
// for while they are dodging a wall.
//
// It still terminates on its own: the grid is finite, every step fills a cell
// permanently, and the arena closes in a further two cells each round, so the
// space available strictly shrinks until a crash is forced.
const GAP         = 1250;   // ms between rounds
const MARGIN      = [0, 2, 4];   // cells of wall closed in, per round
const JOY_R       = 50;     // joystick base radius, css px

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;
let _W = 0, _H = 0, _cols = 0, _rows = 0, _ox = 0, _oy = 0;
let _n = 2;                       // slots, not seats
let _grid = null;                 // Int8Array: 0 empty, slot+1 = that slot's trail
let _cycles = [];                 // { cx, cy, dir, fx, fy, alive }
let _wins = [];
let _zones = [];                  // input quadrants — the ARENA stays whole
let _round = 0;
let _roundT = 0, _graceT = 0;
let _between = false;
let _margin = 0;
let _flash = 0, _flashMsg = '';
let _botCd = [];                  // one cooldown per bot
let _sticks = [];
const _cleanups = [];
const _timers   = [];

// Direction indices: 0 up, 1 right, 2 down, 3 left.
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];
const TRAIL       = ['#ff4d4d', '#4d9bff', '#4ade80', '#fbbf24'];
const HEAD        = ['#ff8080', '#80bcff', '#86efac', '#fde68a'];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _wins = new Array(_n).fill(0); _botCd = new Array(_n).fill(0);
    _round = 0; _last = 0; _between = false;
    _flash = 0; _flashMsg = ''; _sticks = [];
    registerMinigameCleanup(_destroy);   // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM (R2) ────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#05070f;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    _buildSticks();

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'STEER WITH YOUR STICK — DON\'T CRASH!';
}

// A floating joystick per player. The ring appears under the thumb and the knob
// swings around it; pushing past a dead zone picks the nearest of the four
// compass directions, in the player's own frame.
//
// THE ARENA IS NOT DIVIDED. This is the shape the layout module calls ARENA: one
// grid the size of the screen that everybody rides on, because carving it into
// quarters would make four private mazes rather than one contested space — and
// cutting the other rider off is the entire game. What IS divided is the INPUT:
// zonesFor() hands out a quadrant each, and a thumb in your quadrant steers your
// cycle. The trails still cross the whole screen.
function _buildSticks() {
    _sticks = [];
    const w = _overlay.clientWidth || window.innerWidth;
    const h = _overlay.clientHeight || window.innerHeight;
    const zones = zonesFor(_n, w, h);
    for (let pid = 0; pid < _n; pid++) {
        const color = SLOT_ACCENT[pid] || '#ffffff';
        const zr = zones[pid].rect;
        const far = zones[pid].rot === 180;

        const zone = document.createElement('div');
        zone.style.cssText = [
            'position:absolute;z-index:5;',
            `left:${zr.x}px;top:${zr.y}px;width:${zr.w}px;height:${zr.h}px;`,
        ].join('');

        const base = document.createElement('div');
        base.style.cssText = [
            'position:absolute;left:50%;top:calc(100% - 84px);transform:translate(-50%,-50%);',
            `width:${JOY_R * 2}px;height:${JOY_R * 2}px;border-radius:50%;`,
            'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.15);',
            'pointer-events:none;opacity:.35;',
            'transition:left .16s ease, top .16s ease, opacity .16s ease;',
        ].join('');
        const knob = document.createElement('div');
        knob.style.cssText = [
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            'width:42px;height:42px;border-radius:50%;pointer-events:none;',
            `background:${color};box-shadow:0 0 14px ${color};opacity:.88;`,
            'transition:transform .05s;',
        ].join('');
        base.appendChild(knob);
        zone.appendChild(base);
        _overlay.appendChild(zone);
        _sticks[pid] = { base, knob, zone, origin: null, pointerId: null };

        // The stick rests at the player's own outer edge, where their thumb is.
        const restTop = far ? '84px' : 'calc(100% - 84px)';

        const park = () => {
            const st = _sticks[pid];
            if (!st) return;
            st.base.style.transition = 'left .16s ease, top .16s ease, opacity .16s ease';
            st.base.style.left = '50%';
            st.base.style.top  = restTop;
            st.base.style.opacity = '.35';
            st.knob.style.transform = 'translate(-50%,-50%)';
            st.origin = null; st.pointerId = null;
        };
        base.style.top = restTop;

        const onDown = e => {
            const st = _sticks[pid];
            if (_done || !st || st.pointerId !== null) return;
            if (isBotSlot(pid)) return;
            e.preventDefault();
            try { zone.setPointerCapture(e.pointerId); } catch (err) {}
            const r = zone.getBoundingClientRect();
            const cx = Math.max(JOY_R, Math.min(r.width  - JOY_R, e.clientX - r.left));
            const cy = Math.max(JOY_R, Math.min(r.height - JOY_R, e.clientY - r.top));
            st.base.style.transition = 'opacity .1s ease';
            st.base.style.left = cx + 'px';
            st.base.style.top  = cy + 'px';
            st.base.style.opacity = '1';
            st.pointerId = e.pointerId;
            st.origin = { x: r.left + cx, y: r.top + cy };
        };
        const onMove = e => {
            const st = _sticks[pid];
            if (_done || !st || st.pointerId !== e.pointerId || !st.origin) return;
            e.preventDefault();
            let dx = e.clientX - st.origin.x, dy = e.clientY - st.origin.y;
            const dist = Math.hypot(dx, dy);
            const kOff = JOY_R - 21;
            const cl = dist > JOY_R ? JOY_R / dist : 1;
            st.knob.style.transform =
                `translate(calc(-50% + ${(dx * cl / JOY_R * kOff).toFixed(1)}px), ` +
                `calc(-50% + ${(dy * cl / JOY_R * kOff).toFixed(1)}px))`;
            // Dead zone, so resting a thumb doesn't steer.
            if (dist < JOY_R * 0.42) return;
            // The push direction IS the travel direction, for both players.
            //
            // P2's input used to be inverted on both axes on the reasoning that
            // their half is upside-down — but this arena is not split into
            // halves. It is ONE grid drawn once, unrotated, and both players are
            // looking at the same picture of it. So a thumb pushed toward a
            // patch of empty floor should send the cycle at that patch, whoever
            // pushed it. The inversion meant P2 pushing away from themselves
            // drove straight back at their own trail — every single time.
            const dir = Math.abs(dx) > Math.abs(dy)
                ? (dx > 0 ? 1 : 3)         // right : left
                : (dy > 0 ? 2 : 0);        // down  : up
            _steer(pid, dir);
        };
        const onUp = e => {
            const st = _sticks[pid];
            if (!st || st.pointerId !== e.pointerId) return;
            e.preventDefault();
            try { zone.releasePointerCapture(e.pointerId); } catch (err) {}
            park();
        };

        zone.addEventListener('pointerdown',   onDown);
        zone.addEventListener('pointermove',   onMove);
        zone.addEventListener('pointerup',     onUp);
        zone.addEventListener('pointercancel', onUp);
        _cleanups.push(() => {
            zone.removeEventListener('pointerdown',   onDown);
            zone.removeEventListener('pointermove',   onMove);
            zone.removeEventListener('pointerup',     onUp);
            zone.removeEventListener('pointercancel', onUp);
        });
    }
}

// Point the cycle at an absolute direction. Reversing into your own neck is
// ignored rather than punished — the same forgiveness the tap control had.
function _steer(pid, dir) {
    const c = _cycles[pid];
    if (!c || !c.alive || _between) return;
    if (dir === c.dir) return;
    if (dir === (c.dir + 2) % 4) return;          // no instant U-turn
    c.dir = dir;
    sfx('seq_lit');
    if (pid === 0) haptic([8]);
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);   // R4
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    _cols = Math.max(9, Math.floor(_W / CELL));
    _rows = Math.max(15, Math.floor(_H / CELL));
    _ox = Math.round((_W - _cols * CELL) / 2);
    _oy = Math.round((_H - _rows * CELL) / 2);
    if (!_grid || _grid.length !== _cols * _rows) _grid = new Int8Array(_cols * _rows);
}

// ── Rounds ──────────────────────────────────────────────────────────────────
function _startRound() {
    if (_done) return;
    _round++;
    _between = false;
    _roundT = 0;
    _graceT = GRACE;
    _margin = MARGIN[Math.min(_round - 1, MARGIN.length - 1)];
    _grid.fill(0);
    // Facing the middle from each end: P1 comes up from the bottom, P2 comes
    // down from the top, so the first contested ground is dead centre.
    // Offset lanes on purpose. Head-to-head in the same column meant that doing
    // nothing produced a mutual head-on crash every single round — a boring
    // default that made the opening about chicken rather than about space.
    // Started apart, the first decision is where to cut the other one off.
    // Everybody starts on an edge facing the middle, spread so the first
    // contested ground is dead centre and nobody begins in anybody's path.
    // Four riders take the four edges; three take three of them.
    const lo = i => Math.max(1 + _margin, i);
    const hi = i => Math.min(_cols - 2 - _margin, i);
    const loR = i => Math.max(1 + _margin, i);
    const hiR = i => Math.min(_rows - 2 - _margin, i);
    const STARTS = [
        () => ({ cx: lo(Math.floor(_cols * 0.32)), cy: hiR(_rows - 3 - _margin), dir: 0 }),  // bottom, up
        () => ({ cx: hi(Math.ceil(_cols * 0.68)),  cy: loR(_margin + 2),         dir: 2 }),  // top, down
        () => ({ cx: lo(_margin + 2),              cy: loR(Math.floor(_rows * 0.32)), dir: 1 }),  // left, right
        () => ({ cx: hi(_cols - 3 - _margin),      cy: hiR(Math.ceil(_rows * 0.68)),  dir: 3 }),  // right, left
    ];
    _cycles = Array.from({ length: _n }, (_, i) => ({ ...STARTS[i](), alive: true }));
    _cycles.forEach((c, i) => _set(c.cx, c.cy, i + 1));
    _flash = 0.9; _flashMsg = `ROUND ${_round}`;
    sfx('go');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `ROUND ${_round}   ${_wins.join(' · ')}`;
}

function _idx(x, y) { return y * _cols + x; }
function _get(x, y) {
    if (x < _margin || y < _margin || x >= _cols - _margin || y >= _rows - _margin) return -1;  // wall
    return _grid[_idx(x, y)];
}
function _set(x, y, v) { if (x >= 0 && y >= 0 && x < _cols && y < _rows) _grid[_idx(x, y)] = v; }

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _flash = Math.max(0, _flash - dt);

    if (!_between) {
        _roundT += dt;
        _graceT = Math.max(0, _graceT - dt);
        for (let pid = 0; pid < _n; pid++) if (isBotSlot(pid)) _botThink(pid, dt);
        _step(dt);
    }
    _draw();
}

// Movement is on a grid but the clock is real: accumulate fractional cells and
// advance whole ones, so speed is identical at 60 and 120 Hz.
let _acc = 0;
function _step(dt) {
    _acc += SPEED * dt;
    while (_acc >= 1) {
        _acc -= 1;
        const dead = [];
        // Every cycle moves at the same instant, so a head-on is a genuine
        // mutual crash rather than whoever the loop reached first.
        const next = _cycles.map(c => c.alive
            ? { x: c.cx + DX[c.dir], y: c.cy + DY[c.dir] }
            : null);
        for (let i = 0; i < _n; i++) {
            const c = _cycles[i], n = next[i];
            if (!c.alive || !n) continue;
            const cell = _get(n.x, n.y);
            // Head-on against ANY other rider, not just "the other one".
            let headOn = false;
            for (let j = 0; j < _n && !headOn; j++) {
                if (j === i || !next[j]) continue;
                if (n.x === next[j].x && n.y === next[j].y) headOn = true;
            }
            if (cell !== 0 || headOn) dead.push(i);
        }
        if (dead.length) {
            if (_graceT > 0) {
                // Grace period: bounce the offender's heading instead of ending
                // the round, so a mistimed first tap is not the whole match.
                dead.forEach(i => { _cycles[i].dir = (_cycles[i].dir + 2) % 4; });
                sfx('land_bad');
                return;
            }
            dead.forEach(i => { _cycles[i].alive = false; });
            // LAST ONE RIDING. At two seats a crash ended the round because it
            // left exactly one alive; above two it usually does not, and the
            // survivors carry on over the wreck's trail.
            const alive = _cycles.reduce((a, c, i) => (c.alive ? a.concat(i) : a), []);
            if (alive.length === 1) { _endRound(alive[0]); return; }
            if (alive.length === 0) { _endRound(-1); return; }
            sfx('land_bad');
        }
        for (let i = 0; i < _n; i++) {
            const c = _cycles[i], n = next[i];
            if (!c.alive || !n) continue;
            c.cx = n.x; c.cy = n.y;
            _set(c.cx, c.cy, i + 1);
        }
    }
}

function _endRound(winnerId, why) {
    if (_between || _done) return;
    _between = true;
    if (winnerId >= 0) _wins[winnerId]++;
    _flash = 1.4;
    // Both dying on the same tick isn't always a head-on — most often it's two
    // simultaneous wall crashes — so the wording covers either.
    _flashMsg = winnerId < 0 ? 'EVERYBODY CRASHED — NO SCORE'
              : `${_nameOf(winnerId)} TAKES ROUND ${_round}${why ? ' — ' + why : ''}`;
    sfx(winnerId < 0 ? 'land_bad' : 'coin_gain'); haptic('heavy');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `${_wins.join(' · ')}   —   BEST OF ${MAX_ROUNDS}`;

    if (winnerId >= 0 && _wins[winnerId] >= WIN_ROUNDS) { _after(() => _finish(winnerId), GAP); return; }
    if (_round >= MAX_ROUNDS) { _after(_finishOnScore, GAP); return; }
    _after(_startRound, GAP);
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// A one-step lookahead with a flood-fill tiebreak: of the headings that don't
// kill it, take the one that leaves it the most room. botSkill controls how
// often it bothers to look, how deep the room count goes, and how often it just
// picks at random instead.
function _botThink(pid, dt) {
    const c = _cycles[pid];
    if (!c || !c.alive) return;
    _botCd[pid] -= dt;
    if (_botCd[pid] > 0) return;
    _botCd[pid] = 0.09 + (1 - _botSkill) * 0.16;

    const options = [c.dir, (c.dir + 1) % 4, (c.dir + 3) % 4];
    const safe = options.filter(d => _get(c.cx + DX[d], c.cy + DY[d]) === 0);
    if (!safe.length) return;                       // doomed; ride it out

    if (Math.random() > _botSkill * 0.75 + 0.2) {   // sometimes just wanders
        c.dir = safe[Math.floor(Math.random() * safe.length)];
        return;
    }
    const budget = Math.round(40 + _botSkill * 260);
    let best = safe[0], bestRoom = -1;
    for (const d of safe) {
        const room = _room(c.cx + DX[d], c.cy + DY[d], budget);
        if (room > bestRoom) { bestRoom = room; best = d; }
    }
    // Prefer carrying straight on when it is no worse, so it draws clean walls
    // rather than jittering.
    if (safe.includes(c.dir) && _room(c.cx + DX[c.dir], c.cy + DY[c.dir], budget) >= bestRoom * 0.92) {
        best = c.dir;
    }
    c.dir = best;
}

// Bounded flood fill: how many free cells are reachable from here.
const _seen = new Set();
function _room(sx, sy, budget) {
    if (_get(sx, sy) !== 0) return 0;
    _seen.clear();
    const stack = [[sx, sy]];
    let n = 0;
    while (stack.length && n < budget) {
        const [x, y] = stack.pop();
        const k = y * _cols + x;
        if (_seen.has(k)) continue;
        if (_get(x, y) !== 0) continue;
        _seen.add(k); n++;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return n;
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx, w = _W, h = _H;
    ctx.clearRect(0, 0, w, h);

    // Arena floor, with the closed-in margin drawn as solid wall so the shrink
    // is visible rather than just felt.
    ctx.fillStyle = '#080c18';
    ctx.fillRect(_ox, _oy, _cols * CELL, _rows * CELL);
    if (_margin > 0) {
        ctx.fillStyle = 'rgba(120,140,190,.10)';
        const m = _margin * CELL, cw = _cols * CELL, ch = _rows * CELL;
        ctx.fillRect(_ox, _oy, cw, m);
        ctx.fillRect(_ox, _oy + ch - m, cw, m);
        ctx.fillRect(_ox, _oy, m, ch);
        ctx.fillRect(_ox + cw - m, _oy, m, ch);
    }
    ctx.strokeStyle = 'rgba(140,170,230,.30)'; ctx.lineWidth = 2;
    ctx.strokeRect(_ox + _margin * CELL + 1, _oy + _margin * CELL + 1,
                   (_cols - _margin * 2) * CELL - 2, (_rows - _margin * 2) * CELL - 2);

    // Trails
    for (let y = 0; y < _rows; y++) {
        for (let x = 0; x < _cols; x++) {
            const v = _grid[_idx(x, y)];
            if (!v) continue;
            ctx.fillStyle = TRAIL[v - 1] || '#ffffff';
            ctx.globalAlpha = 0.85;
            ctx.fillRect(_ox + x * CELL + 1, _oy + y * CELL + 1, CELL - 2, CELL - 2);
            ctx.globalAlpha = 1;
        }
    }

    // Heads, brighter, with a nose showing which way they are pointed
    for (let i = 0; i < _n; i++) {
        const c = _cycles[i];
        if (!c) continue;
        const color = HEAD[i] || '#ffffff';
        const x = _ox + c.cx * CELL, y = _oy + c.cy * CELL;
        ctx.fillStyle = c.alive ? color : '#5d6478';
        ctx.fillRect(x, y, CELL, CELL);
        if (c.alive) {
            ctx.fillStyle = '#ffffff';
            const nx = x + CELL / 2 + DX[c.dir] * CELL * 0.3;
            const ny = y + CELL / 2 + DY[c.dir] * CELL * 0.3;
            ctx.beginPath(); ctx.arc(nx, ny, CELL * 0.16, 0, Math.PI * 2); ctx.fill();
        }
    }

    // Grace shimmer, so "you can't die yet" is visible rather than a hidden rule
    if (_graceT > 0 && !_between) {
        ctx.globalAlpha = 0.10 + 0.10 * Math.sin(_roundT * 14);
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(_ox, _oy, _cols * CELL, _rows * CELL);
        ctx.globalAlpha = 1;
    }

    // Per-player HUD, each upright at its own control zone. The zone is where
    // that player is sitting, so their tally goes there rather than at a screen
    // edge that belongs to somebody else.
    if (!_zones.length) _zones = zonesFor(_n, w, h);
    _zones.forEach((z, pid) => {
        const r = z.rect;
        ctx.save();
        if (z.rot === 180) { ctx.translate(r.x + r.w, r.y + r.h); ctx.rotate(Math.PI); }
        else               { ctx.translate(r.x, r.y); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.font = '900 20px "Bebas Neue", sans-serif';
        ctx.fillStyle = SLOT_ACCENT[pid] || '#ffffff';
        const dead = _cycles[pid] && !_cycles[pid].alive;
        ctx.fillText(`${_nameOf(pid)}  ${_wins[pid]}${dead ? '  ✖' : ''}`, 10, 8);
        ctx.restore();
    });
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    ctx.font = '800 11px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.fillText(_graceT > 0 && !_between ? 'SAFE START…' : 'PUSH YOUR STICK TO STEER', w / 2, h - 8);

    // Round banner, one copy per player, upright in their own zone
    if (_flash > 0 && _flashMsg) {
        ctx.globalAlpha = Math.min(1, _flash);
        _zones.forEach(z => {
            const r = z.rect;
            ctx.save();
            if (z.rot === 180) { ctx.translate(r.x + r.w, r.y + r.h); ctx.rotate(Math.PI); }
            else               { ctx.translate(r.x, r.y); }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '900 20px "Bebas Neue", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(_flashMsg, r.w / 2, r.h * 0.5);
            ctx.restore();
        });
        ctx.globalAlpha = 1;
    }
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finishOnScore() { _finish(_leader()); }

/** The outright most rounds won, or -1 if the top is shared. */
function _leader() {
    const best = Math.max(..._wins);
    const top = _wins.reduce((a, v, i) => (v === best ? a.concat(i) : a), []);
    return top.length === 1 ? top[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0
        ? `DRAW — ${_wins.join('–')}`
        : `${_nameOf(winnerId)} WINS ${_wins.join('–')}!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win'); haptic('heavy');
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
    _grid = null; _cycles = []; _seen.clear(); _sticks = []; _zones = [];
    _last = 0; _acc = 0; _W = 0; _H = 0;
}
