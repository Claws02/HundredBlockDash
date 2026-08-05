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
// Steering is one thumb per player: tap or drag LEFT of your cycle to turn left,
// RIGHT to turn right, relative to the way you are facing. That keeps it to a
// single control on a phone half, and it works the same for both players once
// their half is rotated.
//
// Best of 3 rounds. The arena shrinks each round so a stalemate can't run long,
// and each round opens with a brief grace period so one twitch at the start is
// never the whole match.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const WIN_ROUNDS  = 2;      // best of 3
const MAX_ROUNDS  = 3;
const CELL        = 26;     // grid cell size in css px (trail thickness)
const SPEED       = 5.4;    // cells per SECOND (R1)
const GRACE       = 0.9;    // s at round start where a crash is undone
const ROUND_CAP   = 15;     // s per round; settles on who owns more ground
const GAP         = 1250;   // ms between rounds
const MARGIN      = [0, 2, 4];   // cells of wall closed in, per round

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0;
let _W = 0, _H = 0, _cols = 0, _rows = 0, _ox = 0, _oy = 0;
let _grid = null;                 // Int8Array: 0 empty, 1 P1 trail, 2 P2 trail
let _cycles = [];                 // { cx, cy, dir, fx, fy, alive }
let _wins = [0, 0];
let _round = 0;
let _roundT = 0, _graceT = 0;
let _between = false;
let _margin = 0;
let _flash = 0, _flashMsg = '';
let _botCd = 0;
const _cleanups = [];
const _timers   = [];

// Direction indices: 0 up, 1 right, 2 down, 3 left.
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _wins = [0, 0]; _round = 0; _last = 0; _between = false;
    _flash = 0; _flashMsg = ''; _botCd = 0;
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

    // One thumb per player. Where you touch, relative to your own cycle's
    // heading, is the turn — so the control is identical for both players once
    // their half is turned around, and there are no buttons to hunt for.
    const halfOf = e => (e.clientY < _overlay.clientHeight / 2 ? 1 : 0);
    const onDown = e => {
        if (_done || _between) return;
        e.preventDefault();
        const pid = halfOf(e);
        if (pid === 1 && _isBot) return;
        _turnToward(pid, e.clientX, e.clientY);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'TAP LEFT OR RIGHT OF YOUR CYCLE TO TURN!';
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
    _cycles = [
        { cx: Math.max(1, Math.floor(_cols * 0.32)), cy: _rows - 1 - _margin - 2, dir: 0, alive: true },
        { cx: Math.min(_cols - 2, Math.ceil(_cols * 0.68)), cy: _margin + 2,      dir: 2, alive: true },
    ];
    _cycles.forEach((c, i) => _set(c.cx, c.cy, i + 1));
    _flash = 0.9; _flashMsg = `ROUND ${_round}`;
    sfx('go');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `ROUND ${_round}   P1 ${_wins[0]} · ${_wins[1]} P2`;
}

function _idx(x, y) { return y * _cols + x; }
function _get(x, y) {
    if (x < _margin || y < _margin || x >= _cols - _margin || y >= _rows - _margin) return -1;  // wall
    return _grid[_idx(x, y)];
}
function _set(x, y, v) { if (x >= 0 && y >= 0 && x < _cols && y < _rows) _grid[_idx(x, y)] = v; }

// The touch point decides the turn, read in the cycle's own frame: a tap to the
// left of where you're heading turns you left, a tap to the right turns right.
// Reversing into your own neck is ignored rather than punished.
function _turnToward(pid, clientX, clientY) {
    const c = _cycles[pid];
    if (!c || !c.alive) return;
    const px = _ox + c.cx * CELL + CELL / 2;
    const py = _oy + c.cy * CELL + CELL / 2;
    const dx = clientX - px, dy = clientY - py;
    // Cross product of heading × touch tells you which side the touch is on.
    const cross = DX[c.dir] * dy - DY[c.dir] * dx;
    if (Math.abs(cross) < CELL * 0.35) return;      // dead ahead: no turn
    c.dir = cross > 0 ? (c.dir + 1) % 4 : (c.dir + 3) % 4;
    sfx('seq_lit');
    if (pid === 0) haptic([8]);
}

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
        if (_isBot) _botThink(dt);
        _step(dt);
        if (_roundT >= ROUND_CAP) _settleRoundOnGround();
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
        // Both cycles move at the same instant, so a head-on is a genuine draw.
        const next = _cycles.map(c => c.alive
            ? { x: c.cx + DX[c.dir], y: c.cy + DY[c.dir] }
            : null);
        for (let i = 0; i < 2; i++) {
            const c = _cycles[i], n = next[i];
            if (!c.alive || !n) continue;
            const cell = _get(n.x, n.y);
            const headOn = next[1 - i] && n.x === next[1 - i].x && n.y === next[1 - i].y;
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
            _endRound(dead.length === 2 ? -1 : 1 - dead[0]);
            return;
        }
        for (let i = 0; i < 2; i++) {
            const c = _cycles[i], n = next[i];
            if (!c.alive || !n) continue;
            c.cx = n.x; c.cy = n.y;
            _set(c.cx, c.cy, i + 1);
        }
    }
}

// If neither crashes inside the round cap, whoever claimed more ground wins it.
function _settleRoundOnGround() {
    let a = 0, b = 0;
    for (let i = 0; i < _grid.length; i++) { if (_grid[i] === 1) a++; else if (_grid[i] === 2) b++; }
    _endRound(a > b ? 0 : b > a ? 1 : -1, 'MORE GROUND');
}

function _endRound(winnerId, why) {
    if (_between || _done) return;
    _between = true;
    if (winnerId >= 0) _wins[winnerId]++;
    _flash = 1.4;
    // Both dying on the same tick isn't always a head-on — most often it's two
    // simultaneous wall crashes — so the wording covers either.
    _flashMsg = winnerId < 0 ? 'BOTH CRASHED — NO SCORE'
              : `P${winnerId + 1} TAKES ROUND ${_round}${why ? ' — ' + why : ''}`;
    sfx(winnerId < 0 ? 'land_bad' : 'coin_gain'); haptic('heavy');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `P1 ${_wins[0]} · ${_wins[1]} P2   —   BEST OF ${MAX_ROUNDS}`;

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
function _botThink(dt) {
    const c = _cycles[1];
    if (!c || !c.alive) return;
    _botCd -= dt;
    if (_botCd > 0) return;
    _botCd = 0.09 + (1 - _botSkill) * 0.16;

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
            ctx.fillStyle = v === 1 ? '#ff4d4d' : '#4d9bff';
            ctx.globalAlpha = 0.85;
            ctx.fillRect(_ox + x * CELL + 1, _oy + y * CELL + 1, CELL - 2, CELL - 2);
            ctx.globalAlpha = 1;
        }
    }

    // Heads, brighter, with a nose showing which way they are pointed
    for (let i = 0; i < 2; i++) {
        const c = _cycles[i];
        if (!c) continue;
        const color = i === 0 ? '#ff8080' : '#80bcff';
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

    // Per-player HUD, each upright at its own edge
    for (let pid = 0; pid < 2; pid++) {
        ctx.save();
        if (pid === 1) { ctx.translate(w, h); ctx.rotate(Math.PI); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.font = '900 22px "Bebas Neue", sans-serif';
        ctx.fillStyle = pid === 0 ? '#ff6b6b' : '#6ba7ff';
        ctx.fillText(`P${pid + 1}  ROUNDS ${_wins[pid]}`, 14, h - 54);
        ctx.font = '800 11px "Nunito", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.fillText(_graceT > 0 && !_between ? 'SAFE START…' : 'TAP LEFT / RIGHT TO TURN', 14, h - 40);
        ctx.restore();
    }

    // Round banner, one copy per player
    if (_flash > 0 && _flashMsg) {
        ctx.globalAlpha = Math.min(1, _flash);
        for (let pid = 0; pid < 2; pid++) {
            ctx.save();
            if (pid === 1) { ctx.translate(w, h); ctx.rotate(Math.PI); }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '900 24px "Bebas Neue", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(_flashMsg, w / 2, h * 0.70);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finishOnScore() {
    _finish(_wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1);
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0
        ? `DRAW — ${_wins[0]} EACH`
        : `P${winnerId + 1} WINS ${_wins[0]}–${_wins[1]}!`;
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
    _grid = null; _cycles = []; _seen.clear();
    _last = 0; _acc = 0; _W = 0; _H = 0;
}
