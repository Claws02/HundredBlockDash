// ============================================================
// MEMORY MATCH — one board, two players, taken in turns.
//
// The arcade's only HUDDLE game: the phone lies flat and both players lean in
// from the side rather than each holding an end. That matters — it is a second
// physical way to play, which does more for variety than another twitch game.
//
// 25 cards: twelve pairs and one lone JACKPOT. The odd card is what makes a 5×5
// board work at all, and it earns its place — turning it pays a bonus and hands
// you another look, so the middle of the board is worth gambling on.
//
// COIN GAME (R6b): every pair you turn is coins in your pocket, kept whether you
// win or lose. What you are racing for is the majority and the bonus.
//
// The faces are twelve shapes that are unchanged by a 180° rotation, so a card
// reads the same from either side of the table without drawing it twice. Shape,
// never colour alone (§4).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
const COLS        = 5;
const ROWS        = 5;
const PAIRS       = 12;              // 24 cards + 1 jackpot = 25
const COIN_PAIR   = 2;               // coins per matched pair
const COIN_JACK   = 6;               // the lone card's bonus
const MAX_PAYOUT  = 30;              // R6b cap, matching the other coin games
// Measured: at a 6 s clock and a 900 ms peek, a 25-card board ran to its
// ceiling every time — the turn overhead, not the thinking, was the game's
// length. Tightened, a full clear lands around 45 s.
//
// This is the roster's deliberate slow beat and it sits above the 15–40 s
// target in §3, as Four in a Row does at 52 s. That is a considered exception,
// not an oversight: a memory game with fewer cards is not a memory game.
const SHOT_CLOCK  = 4;               // s per move; expiring flips for you
const PEEK_MS     = 680;             // how long a non-matching pair stays face up
const MATCH_TIME  = 58;              // s ceiling

// Twelve faces, each drawn with 180° rotational symmetry.
const FACES = ['circle', 'ring', 'square', 'diamond', 'star4', 'star6',
               'hex', 'oct', 'plus', 'ex', 'bars', 'dots'];
const FACE_TINT = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee',
                   '#60a5fa', '#a78bfa', '#f472b6', '#fda4af', '#e2e8f0', '#94a3b8'];

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;
let _cards = null;          // [{ face, taken, up, flip }]
let _turn = 0;
let _sel = [];              // indices face-up this move
let _clock = SHOT_CLOCK;
let _busy = false;          // resolving a pair; input closed
let _pairs = [0, 0];
let _coins = [0, 0];
let _geom = null;
let _botMem = null;         // Map index → face, what the bot has "seen"
let _botTimer = null;
let _flashIdx = -1, _flashT = 0;
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
    _cards = _deal();
    _turn = Math.random() < 0.5 ? 0 : 1;
    _sel = []; _clock = SHOT_CLOCK; _busy = false;
    _pairs = [0, 0]; _coins = [0, 0];
    _botMem = new Map(); _botTimer = null;
    _flashIdx = -1; _flashT = 0;
    _last = 0; _elapsed = 0;
    registerMinigameCleanup(_destroy);           // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _announce();
        _af = requestAnimationFrame(_tick);
    }));
}

function _deal() {
    const pool = [];
    for (let i = 0; i < PAIRS; i++) { pool.push(i); pool.push(i); }
    pool.push(-1);                                  // the jackpot
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.map(face => ({ face, taken: false, up: false, flip: 0 }));
}

// ── DOM (R2) ────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;' +
        'background:radial-gradient(ellipse at 50% 50%, #1b2440 0%, #080b14 78%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // HUDDLE: both players reach the same board from the side, so a tap is not
    // partitioned by half. Whose move it is decides who the tap belongs to —
    // which is why the turn indicator is drawn at BOTH edges.
    const onDown = e => {
        if (_done || _busy) return;
        e.preventDefault();
        if (_isBot && _turn === 1) return;
        const g = _geom;
        if (!g) return;
        const c = Math.floor((e.clientX - g.x0) / g.cell);
        const r = Math.floor((e.clientY - g.y0) / g.cell);
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
        _pick(r * COLS + c);
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
    _dpr = Math.min(window.devicePixelRatio || 1, 2);       // R4
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);

    // R1b: both outer edges carry a HUD and the floating status pill, so the
    // grid is inset rather than centred on the raw viewport.
    const padY = Math.min(148, _H * 0.18);
    const cell = Math.floor(Math.min(_W * 0.95 / COLS, (_H - padY * 2) / ROWS));
    _geom = {
        cell,
        x0: Math.round((_W - cell * COLS) / 2),
        y0: Math.round((_H - cell * ROWS) / 2),
    };
}

// ── Moves ───────────────────────────────────────────────────────────────────
function _pick(i) {
    const card = _cards[i];
    if (!card || card.taken || card.up || _sel.length >= 2) return;
    card.up = true; card.flip = 0.0001;
    _sel.push(i);
    _botMem.set(i, card.face);          // the bot sees what everyone sees
    sfx('seq_lit');
    if (_turn === 0) haptic([10]);

    // The jackpot resolves on its own and does not use up your pair.
    if (card.face === -1) {
        _busy = true;
        _after(() => {
            if (_done) return;
            card.taken = true; card.up = false;
            _coins[_turn] += COIN_JACK;
            _flashIdx = i; _flashT = 0;
            _sel = _sel.filter(x => x !== i);
            _busy = false;
            _clock = SHOT_CLOCK;
            sfx('coin_gain'); haptic('heavy');
            _announce(`🪙 JACKPOT! +${COIN_JACK} — GO AGAIN`);
            if (_isBot && _turn === 1) _scheduleBot();
        }, 620);
        return;
    }

    if (_sel.length === 2) _resolve();
}

function _resolve() {
    _busy = true;
    const [a, b] = _sel;
    const hit = _cards[a].face === _cards[b].face;
    _after(() => {
        if (_done) return;
        if (hit) {
            _cards[a].taken = _cards[b].taken = true;
            _cards[a].up = _cards[b].up = false;
            _pairs[_turn]++;
            _coins[_turn] += COIN_PAIR;
            _botMem.delete(a); _botMem.delete(b);
            sfx('coin_gain'); haptic([18, 40, 18]);
            _sel = []; _busy = false; _clock = SHOT_CLOCK;
            if (_cards.every(c => c.taken)) { _finishOnScore(); return; }
            _announce('MATCH! GO AGAIN');
            if (_isBot && _turn === 1) _scheduleBot();
        } else {
            _cards[a].up = _cards[b].up = false;
            _cards[a].flip = 0.0001; _cards[b].flip = 0.0001;
            sfx('land_bad');
            _sel = []; _busy = false;
            _turn = 1 - _turn; _clock = SHOT_CLOCK;
            _announce();
        }
    }, hit ? 420 : PEEK_MS);
}

function _announce(msg) {
    const neu = document.getElementById('mg-neutral');
    if (!neu) return;
    const name = state.players[_turn]?.name?.toUpperCase() || `P${_turn + 1}`;
    neu.textContent = msg ? `${name} — ${msg}` : `${name}'S TURN — FIND A PAIR`;
    if (_isBot && _turn === 1 && !msg) _scheduleBot();
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// The bot's skill IS its memory. It remembers every card that has been turned,
// then forgets a skill-scaled share of them before each move — so an easy bot
// genuinely fumbles for pairs it has already seen, and a hard one punishes you
// for turning anything. No hidden information is ever used.
function _scheduleBot() {
    if (!_isBot || _done) return;
    if (_botTimer) { clearTimeout(_botTimer); _timers.splice(_timers.indexOf(_botTimer), 1); }
    const think = 380 + (1 - _botSkill) * 420 + Math.random() * 240;
    _botTimer = _after(() => {
        _botTimer = null;
        if (_done || _busy || _turn !== 1) return;
        _botMove();
    }, think);
}

function _botMove() {
    const hidden = [];
    for (let i = 0; i < _cards.length; i++) if (!_cards[i].taken && !_cards[i].up) hidden.push(i);
    if (!hidden.length) return;

    // What it still remembers this move.
    const recall = new Map();
    for (const [i, f] of _botMem) {
        if (_cards[i].taken) continue;
        if (Math.random() < 0.25 + _botSkill * 0.72) recall.set(i, f);
    }

    // A known pair, or the jackpot, is taken immediately.
    const byFace = new Map();
    let jack = -1;
    for (const [i, f] of recall) {
        if (f === -1) { jack = i; continue; }
        if (byFace.has(f)) {
            const j = byFace.get(f);
            _pick(j); _after(() => { if (!_done && !_cards[i].taken) _pick(i); }, 340);
            return;
        }
        byFace.set(f, i);
    }
    if (jack >= 0) { _pick(jack); return; }

    // Otherwise turn something unknown, and try to complete it from memory.
    const unknown = hidden.filter(i => !recall.has(i));
    const first = unknown.length ? unknown[Math.floor(Math.random() * unknown.length)]
                                 : hidden[Math.floor(Math.random() * hidden.length)];
    _pick(first);
    _after(() => {
        if (_done || _turn !== 1 || _busy || _sel.length !== 1) return;
        const want = _cards[first].face;
        let mate = -1;
        for (const [i, f] of recall) if (i !== first && f === want && !_cards[i].taken) { mate = i; break; }
        if (mate < 0) {
            const rest = hidden.filter(i => i !== first);
            mate = rest[Math.floor(Math.random() * rest.length)];
        }
        if (mate >= 0) _pick(mate);
    }, 280);
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    for (const c of _cards) if (c.flip > 0) { c.flip += dt * 6.5; if (c.flip >= 1) c.flip = 0; }
    if (_flashIdx >= 0) { _flashT += dt; if (_flashT > 0.9) _flashIdx = -1; }

    if (!_busy) {
        _clock -= dt;
        if (_clock <= 0) {
            _clock = SHOT_CLOCK;
            // Running the clock out doesn't skip you — it turns a card for you,
            // so the board always keeps moving and a distracted player only
            // loses the choice, not the turn.
            if (!(_isBot && _turn === 1)) {
                const hidden = [];
                for (let i = 0; i < _cards.length; i++) if (!_cards[i].taken && !_cards[i].up) hidden.push(i);
                if (hidden.length) { sfx('countdown'); _pick(hidden[Math.floor(Math.random() * hidden.length)]); }
            }
        }
    }

    if (_elapsed >= MATCH_TIME) { _finishOnScore(); return; }
    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx, g = _geom;
    if (!g) return;
    ctx.clearRect(0, 0, _W, _H);
    const { cell, x0, y0 } = g;
    const pad = cell * 0.06;

    for (let i = 0; i < _cards.length; i++) {
        const card = _cards[i];
        const cxi = i % COLS, cyi = Math.floor(i / COLS);
        const x = x0 + cxi * cell + pad, y = y0 + cyi * cell + pad;
        const w = cell - pad * 2, h = cell - pad * 2;

        if (card.taken) {
            if (_flashIdx === i) {
                ctx.globalAlpha = Math.max(0, 1 - _flashT / 0.9);
                ctx.strokeStyle = '#fcd34d'; ctx.lineWidth = 3;
                _round(ctx, x, y, w, h, 9); ctx.stroke();
                ctx.globalAlpha = 1;
            } else {
                ctx.fillStyle = 'rgba(255,255,255,.045)';
                _round(ctx, x, y, w, h, 9); ctx.fill();
            }
            continue;
        }

        // Flip: squash horizontally through the halfway point.
        const t = card.flip > 0 ? Math.abs(Math.cos(Math.min(1, card.flip) * Math.PI)) : 1;
        const showFace = card.flip > 0 ? (card.up ? card.flip > 0.5 : card.flip < 0.5) : card.up;
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(Math.max(0.04, t), 1);
        ctx.translate(-w / 2, -h / 2);

        if (showFace) {
            ctx.fillStyle = card.face === -1 ? '#3a2c08' : '#101a2e';
            _round(ctx, 0, 0, w, h, 9); ctx.fill();
            ctx.strokeStyle = card.face === -1 ? '#fcd34d' : 'rgba(255,255,255,.22)';
            ctx.lineWidth = 2; ctx.stroke();
            if (card.face === -1) _jackpot(ctx, w / 2, h / 2, Math.min(w, h) * 0.30);
            else _face(ctx, card.face, w / 2, h / 2, Math.min(w, h) * 0.30);
        } else {
            const grd = ctx.createLinearGradient(0, 0, w, h);
            grd.addColorStop(0, '#2b3f6e'); grd.addColorStop(1, '#1a2647');
            ctx.fillStyle = grd;
            _round(ctx, 0, 0, w, h, 9); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.10)';
            ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.20, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    _hud(0);
    ctx.save(); ctx.translate(_W, _H); ctx.rotate(Math.PI); _hud(1); ctx.restore();
}

// Twelve faces, every one unchanged by a half turn — so one drawing serves both
// players sitting on opposite sides of the table.
function _face(ctx, f, cx, cy, r) {
    const name = FACES[f % FACES.length];
    ctx.fillStyle = FACE_TINT[f % FACE_TINT.length];
    ctx.strokeStyle = FACE_TINT[f % FACE_TINT.length];
    ctx.lineWidth = Math.max(2.5, r * 0.22);
    ctx.lineCap = 'round';
    switch (name) {
        case 'circle': ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); break;
        case 'ring':   ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke(); break;
        case 'square': ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7); break;
        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
            ctx.closePath(); ctx.fill(); break;
        case 'star4': _star(ctx, cx, cy, r, r * 0.32, 4); ctx.fill(); break;
        case 'star6': _star(ctx, cx, cy, r, r * 0.46, 6); ctx.fill(); break;
        case 'hex':   _poly(ctx, cx, cy, r, 6); ctx.fill(); break;
        case 'oct':   _poly(ctx, cx, cy, r, 8); ctx.fill(); break;
        case 'plus':
            ctx.beginPath();
            ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
            ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
            ctx.stroke(); break;
        case 'ex':
            ctx.beginPath();
            ctx.moveTo(cx - r * 0.75, cy - r * 0.75); ctx.lineTo(cx + r * 0.75, cy + r * 0.75);
            ctx.moveTo(cx + r * 0.75, cy - r * 0.75); ctx.lineTo(cx - r * 0.75, cy + r * 0.75);
            ctx.stroke(); break;
        case 'bars':
            ctx.fillRect(cx - r, cy - r * 0.55, r * 2, r * 0.34);
            ctx.fillRect(cx - r, cy + r * 0.21, r * 2, r * 0.34); break;
        case 'dots':
            for (const [dx, dy] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
                ctx.beginPath(); ctx.arc(cx + dx * r * 0.55, cy + dy * r * 0.55, r * 0.28, 0, Math.PI * 2); ctx.fill();
            }
            break;
    }
}

function _jackpot(ctx, cx, cy, r) {
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#92700a'; ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
}

function _poly(ctx, cx, cy, r, n) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / n;
        i === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
                : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
}

function _star(ctx, cx, cy, r, ri, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const rad = i % 2 ? ri : r;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        i === 0 ? ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad)
                : ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
}

function _hud(pid) {
    const ctx = _ctx;
    const mine = _turn === pid;
    const color = pid === 0 ? '#ff5a5a' : '#5a9bff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // R1b: everything stays above the outer ~48 px, where the floating status
    // pill sits. The turn line was drawn at H-30 and was invisible behind it.
    ctx.font = '900 26px "Bebas Neue", sans-serif';
    ctx.fillStyle = mine ? color : 'rgba(255,255,255,.30)';
    ctx.fillText(`${_pairs[pid]} PAIRS`, _W / 2, _H - 118);

    ctx.font = '800 14px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = mine ? '#fcd34d' : 'rgba(252,211,77,.35)';
    ctx.fillText(`🪙 ${_coins[pid]}`, _W / 2, _H - 96);

    // Turn banner and shot clock, at each player's own edge — in HUDDLE both
    // players are looking at the same board, so "whose move is it" has to be
    // answered on both sides.
    ctx.font = '900 16px "Bebas Neue", sans-serif';
    ctx.fillStyle = mine ? color : 'rgba(255,255,255,.22)';
    ctx.fillText(mine ? `YOUR MOVE — ${Math.ceil(Math.max(0, _clock))}s` : 'WAITING…', _W / 2, _H - 72);

    if (mine) {
        const bw = Math.min(_W * 0.46, 200), bx = (_W - bw) / 2;
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(bx, _H - 60, bw, 4);
        ctx.fillStyle = _clock <= 2.5 ? '#ef4444' : color;
        ctx.fillRect(bx, _H - 60, bw * Math.max(0, _clock / SHOT_CLOCK), 4);
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

// ── End (R6 / R6b) ──────────────────────────────────────────────────────────
function _finishOnScore() {
    if (_pairs[0] === _pairs[1]) {
        // Level on pairs: the jackpot is the tie-break, which is what it is for.
        _finish(_coins[0] === _coins[1] ? -1 : (_coins[0] > _coins[1] ? 0 : 1));
        return;
    }
    _finish(_pairs[0] > _pairs[1] ? 0 : 1);
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) {
        neu.textContent = winnerId < 0
            ? `DEAD LEVEL — ${_pairs[0]} PAIRS EACH`
            : `P${winnerId + 1} WINS ${Math.max(..._pairs)}–${Math.min(..._pairs)} · 🪙 ${_coins[0]} · ${_coins[1]}`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    const payouts = [Math.min(_coins[0], MAX_PAYOUT), Math.min(_coins[1], MAX_PAYOUT)];
    _after(() => { _destroy(); _onWin(winnerId, payouts); }, 1400);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _cards = null; _geom = null; _botMem = null; _botTimer = null;
    _sel = []; _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
