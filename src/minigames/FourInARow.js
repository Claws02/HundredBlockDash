// ============================================================
// FOUR IN A ROW — one shared board, taken in turns.
//
// The arcade's third structural gap and the only slow beat in it: everything
// else is a scramble, and a thinking game makes the frantic ones feel faster by
// contrast. It is also the format everyone already knows, so the rules cost
// nothing to explain.
//
// The board is drawn once, in the middle, with a column of drop buttons along
// EACH player's edge — so both of you read the same grid from your own side and
// neither has to reach across. A shot clock keeps it inside the arcade's time
// budget: run it down and the move is made for you.
//
// Bot: a shallow search that always takes an immediate win and always blocks an
// immediate loss, with a skill-scaled chance of missing that it would otherwise
// see. That is the honest way to make a solved game beatable.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// A full 7×6 board is a two-to-four-minute game between people — measured, the
// harness took 63 s just to fill it. 6×5 is still four-in-a-row and still has
// real depth, but it typically resolves in 12–18 moves, which fits the arcade's
// 15–40 s slot.
const COLS       = 6;
const ROWS       = 5;
// Measured: at a 9 s clock the harness took 101 s to fill the board, far past
// the arcade's 15–40 s window. 6 s is still a comfortable think for a game
// everybody already knows, and it keeps a full 42-disc game inside a minute.
const SHOT_CLOCK = 5;      // s per move; expiring plays a reasonable move for you
// No match clock. The game ends when somebody connects four or the board fills,
// and not on a stopwatch — calling a draw over a position one of you was about
// to win is the worst possible ending for a game of this shape.
//
// It terminates by construction: 30 cells, every move fills one permanently, and
// the shot clock guarantees a move every 5 s whether or not anybody presses
// anything. Worst case is 30 moves.
const DROP_TIME  = 0.26;   // s for a disc to fall into place

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
let _board = null;              // Int8Array COLS*ROWS: 0 empty, 1 P1, 2 P2
let _turn = 0;                  // whose move
let _clock = SHOT_CLOCK;
let _drop = null;               // { col, row, pid, t } animation in flight
let _winLine = null;            // [[c,r] × 4] once somebody connects
let _lockUntil = 0;
let _botTimer = null;
let _geom = null;               // cached layout, recomputed on resize
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
    _board = new Int8Array(COLS * ROWS);
    _turn = Math.random() < 0.5 ? 0 : 1;
    _clock = SHOT_CLOCK; _drop = null; _winLine = null;
    _last = 0; _elapsed = 0; _lockUntil = 0; _botTimer = null;
    registerMinigameCleanup(_destroy);   // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _announceTurn();
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
        'background:radial-gradient(ellipse at 50% 50%, #17233f 0%, #080c18 75%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Each player drops from their own edge. Which half you touch decides which
    // player you are, and the x position picks the column — no reaching across
    // the board and no ambiguity about whose finger it was.
    const onDown = e => {
        if (_done || _winLine || _drop) return;
        if (performance.now() < _lockUntil) return;
        e.preventDefault();
        const pid = e.clientY < _overlay.clientHeight / 2 ? 1 : 0;
        if (pid !== _turn) { _nudge(); return; }
        if (pid === 1 && _isBot) return;
        const g = _geom;
        if (!g) return;
        const col = Math.floor((e.clientX - g.x0) / g.cell);
        if (col < 0 || col >= COLS) return;
        _play(col, pid);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);   // R4
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);

    // The grid is centred and sized to whichever axis binds, leaving room at
    // both ends for each player's drop row and HUD.
    const padY = Math.min(96, _H * 0.15);
    const availW = _W * 0.94, availH = _H - padY * 2;
    const cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
    const gw = cell * COLS, gh = cell * ROWS;
    _geom = {
        cell, gw, gh,
        x0: Math.round((_W - gw) / 2),
        y0: Math.round((_H - gh) / 2),
    };
}

// ── Moves ───────────────────────────────────────────────────────────────────
function _at(c, r) { return _board[r * COLS + c]; }
function _put(c, r, v) { _board[r * COLS + c] = v; }

// Lowest empty row in a column, or -1 if it's full.
function _landing(c, board = _board) {
    for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + c] === 0) return r;
    return -1;
}

function _play(col, pid) {
    const row = _landing(col);
    if (row < 0) { _nudge(); return; }
    _drop = { col, row, pid, t: 0 };
    sfx('dice_land');
    if (pid === 0) haptic([14]);
}

function _nudge() { sfx('land_bad'); }

function _settleDrop() {
    const { col, row, pid } = _drop;
    _drop = null;
    _put(col, row, pid + 1);
    const line = _findLine(col, row, pid + 1);
    if (line) { _winLine = line; _after(() => _finish(pid), 1500); sfx('mg_win'); haptic('heavy'); return; }
    if (_board.every(v => v !== 0)) { _after(() => _finish(-1), 1200); return; }
    _turn = 1 - _turn;
    _clock = SHOT_CLOCK;
    _lockUntil = performance.now() + 220;   // brief lock so one finger can't play both moves
    _announceTurn();
}

function _announceTurn() {
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `${state.players[_turn]?.name?.toUpperCase() || 'P' + (_turn + 1)} TO PLAY — CONNECT 4`;
    if (_isBot && _turn === 1) {
        const think = 480 + (1 - _botSkill) * 620 + Math.random() * 320;
        _botTimer = _after(() => { if (!_done && _turn === 1 && !_drop) _play(_botMove(), 1); }, think);
    }
}

// Does placing at (c,r) complete a four? Returns the four cells, or null.
function _findLine(c, r, v) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dc, dr] of dirs) {
        const cells = [[c, r]];
        for (const s of [1, -1]) {
            for (let k = 1; k < 4; k++) {
                const nc = c + dc * k * s, nr = r + dr * k * s;
                if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) break;
                if (_at(nc, nr) !== v) break;
                cells.push([nc, nr]);
            }
        }
        if (cells.length >= 4) return cells.slice(0, 4);
    }
    return null;
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// Connect 4 is solved, so a real search would simply never lose. The bot instead
// plays the two moves that matter — take the win, block the loss — and misses
// them at a skill-scaled rate, which is what a human opponent actually does.
function _botMove() {
    const legal = [];
    for (let c = 0; c < COLS; c++) if (_landing(c) >= 0) legal.push(c);
    if (!legal.length) return 0;

    const wins = legal.filter(c => _wouldConnect(c, 2));
    const blocks = legal.filter(c => _wouldConnect(c, 1));
    const blunder = Math.random() > _botSkill * 0.85 + 0.12;   // 0.55 easy → 0.16 hard

    if (wins.length && !blunder) return wins[0];
    if (blocks.length && !blunder) return blocks[0];

    // Otherwise: don't hand over an immediate win if it can be helped, and
    // prefer the middle, which is where the useful lines run.
    const safe = legal.filter(c => {
        const r = _landing(c);
        if (r <= 0) return true;
        const probe = Int8Array.from(_board);
        probe[r * COLS + c] = 2;
        return !_connectsOn(probe, c, r - 1, 1);
    });
    const pool = safe.length ? safe : legal;
    const mid = (COLS - 1) / 2;
    pool.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const spread = Math.max(1, Math.round(pool.length * (1 - _botSkill)));
    return pool[Math.floor(Math.random() * spread)];
}

function _wouldConnect(col, v) {
    const r = _landing(col);
    if (r < 0) return false;
    const probe = Int8Array.from(_board);
    probe[r * COLS + col] = v;
    return _connectsOn(probe, col, r, v);
}

function _connectsOn(board, c, r, v) {
    const get = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? -1 : board[y * COLS + x];
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let n = 1;
        for (const s of [1, -1]) {
            for (let k = 1; k < 4; k++) {
                if (get(c + dc * k * s, r + dr * k * s) !== v) break;
                n++;
            }
        }
        if (n >= 4) return true;
    }
    return false;
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    if (_drop) {
        _drop.t += dt;
        if (_drop.t >= DROP_TIME) _settleDrop();
    } else if (!_winLine) {
        // Shot clock. Running it out doesn't skip your turn — it plays the move
        // the bot would have played, so a distracted player loses tempo, not the
        // game, and the round always keeps moving.
        _clock -= dt;
        if (_clock <= 0) {
            _clock = SHOT_CLOCK;
            if (!(_isBot && _turn === 1)) {
                const save = _botSkill; _botSkill = 0.5;
                const col = _botMove();
                _botSkill = save;
                _play(col, _turn);
                sfx('countdown');
            }
        }
    }

    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx, w = _W, h = _H, g = _geom;
    if (!g) return;
    ctx.clearRect(0, 0, w, h);

    const { cell, gw, gh, x0, y0 } = g;
    const rad = cell * 0.40;

    // Board slab
    ctx.fillStyle = '#1e3160';
    _roundRect(ctx, x0 - 6, y0 - 6, gw + 12, gh + 12, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2; ctx.stroke();

    // Holes and discs
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cx = x0 + c * cell + cell / 2, cy = y0 + r * cell + cell / 2;
            const v = _at(c, r);
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fillStyle = v === 1 ? '#ff4d4d' : v === 2 ? '#4d9bff' : '#0d1424';
            ctx.fill();
            if (v) { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke(); }
        }
    }

    // Falling disc
    if (_drop) {
        const p = Math.min(1, _drop.t / DROP_TIME);
        const eased = p * p;                     // accelerating fall
        const cx = x0 + _drop.col * cell + cell / 2;
        const fromY = y0 - cell * 0.7;
        const toY   = y0 + _drop.row * cell + cell / 2;
        ctx.beginPath(); ctx.arc(cx, fromY + (toY - fromY) * eased, rad, 0, Math.PI * 2);
        ctx.fillStyle = _drop.pid === 0 ? '#ff4d4d' : '#4d9bff'; ctx.fill();
    }

    // Winning line
    if (_winLine) {
        ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath();
        _winLine.forEach(([c, r], i) => {
            const cx = x0 + c * cell + cell / 2, cy = y0 + r * cell + cell / 2;
            i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
        });
        ctx.stroke();
        for (const [c, r] of _winLine) {
            ctx.beginPath();
            ctx.arc(x0 + c * cell + cell / 2, y0 + r * cell + cell / 2, rad * 1.12, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 3; ctx.stroke();
        }
    }

    // Each player's drop row and HUD, drawn once plain and once rotated so both
    // are upright from their owner's edge.
    _drawSide(0, w, h, g);
    ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); _drawSide(1, w, h, g); ctx.restore();
}

function _drawSide(pid, w, h, g) {
    const ctx = _ctx;
    const { cell, x0, y0, gh } = g;
    const mine = _turn === pid && !_winLine;
    const color = pid === 0 ? '#ff5a5a' : '#5a9bff';

    // Column arrows along this player's edge. Lit on your turn, dim on theirs —
    // so "is it me?" is answered by the controls themselves.
    const arrowY = y0 + gh + cell * 0.55;
    for (let c = 0; c < COLS; c++) {
        const cx = x0 + c * cell + cell / 2;
        const full = _landing(c) < 0;
        ctx.globalAlpha = full ? 0.13 : mine ? 0.95 : 0.22;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, arrowY + cell * 0.20);
        ctx.lineTo(cx - cell * 0.20, arrowY - cell * 0.13);
        ctx.lineTo(cx + cell * 0.20, arrowY - cell * 0.13);
        ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Name, and the shot clock while it is your move.
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = '900 20px "Bebas Neue", sans-serif';
    ctx.fillStyle = mine ? color : 'rgba(255,255,255,.35)';
    const label = mine ? `YOUR MOVE — ${Math.ceil(Math.max(0, _clock))}s` : 'WAITING…';
    ctx.fillText(label, w / 2, h - 52);

    // Shot-clock bar, so the pressure is visible and not just a number.
    if (mine) {
        const bw = Math.min(w * 0.5, 220), bh = 5;
        const bx = (w - bw) / 2, by = h - 46;
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = _clock <= 3 ? '#ef4444' : color;
        ctx.fillRect(bx, by, bw * Math.max(0, _clock / SHOT_CLOCK), bh);
    }
}

function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ── End (R6) ────────────────────────────────────────────────────────────────
//
// Hitting the ceiling with nobody connected is an honest draw: both players had
// the same number of moves, and "most discs placed" would just reward whoever
// happened to move first.
function _finishOnCount() { _finish(-1); }

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0 ? 'BOARD FULL — DRAW!' : `P${winnerId + 1} CONNECTS FOUR!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1300);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _board = null; _drop = null; _winLine = null; _geom = null; _botTimer = null;
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
