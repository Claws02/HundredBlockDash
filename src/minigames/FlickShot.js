// Pong × Brick Breaker
// P1 (bottom, red) and P2 (top, blue) bounce the ball back and forth.
// Bricks in the center break on impact. Get the ball past the opponent's paddle to score.
// First to 3 points wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_SCORE  = 3;
const BALL_R     = 10;
const PAD_W      = 90;
const PAD_H      = 13;
const PAD_OFFSET = 30;    // paddle center distance from each edge
const PAD_SPEED  = 18;    // max px per frame the paddle can move
const BK_COLS    = 6;
const BK_ROWS    = 3;
const BK_H       = 18;
const BK_GAP     = 5;
const SPEED_BASE = 6.5;
const SPEED_CAP  = 12;
const MIN_VY     = SPEED_BASE * 0.55; // prevent near-horizontal ball

let _done = false, _scores = [0, 0], _onWin = null, _isBot = false;
let _canvas = null, _ctx = null, _overlay = null;
let _W = 0, _H = 0;
let _ball = null, _pads = null, _bricks = [];
let _af = null, _scoring = false, _serving = 0, _lastTime = 0;
let _scoreEls = [null, null], _neutralEl = null;
let _interPointTimer = null;
const _ptrMap = new Map();   // pointerId → player index (0 or 1)
const _cleanups = [];

// ── Overlay build ─────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0f172a;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    _overlay.appendChild(_canvas);

    // Score HUD pinned to top corners
    const hud = document.createElement('div');
    hud.style.cssText = `
        position:absolute;inset:0;pointer-events:none;
        display:flex;justify-content:space-between;align-items:flex-start;
        padding:6px 14px;box-sizing:border-box;
    `;
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);

    mg.appendChild(_overlay);
}

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.1rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

function _setup() {
    const r = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    _W = r.width; _H = r.height;
    _canvas.width  = Math.round(_W * dpr);
    _canvas.height = Math.round(_H * dpr);
    _ctx = _canvas.getContext('2d');
    _ctx.scale(dpr, dpr);

    // Pointer input: bottom half → P1, top half → P2
    const onDown = e => {
        e.preventDefault();
        const cr = _canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left;
        const cy = e.clientY - cr.top;
        const pid = cy > _H / 2 ? 0 : 1;
        _ptrMap.set(e.pointerId, pid);
        if (!(_isBot && pid === 1)) _pads[pid].targetX = cx;
    };
    const onMove = e => {
        e.preventDefault();
        if (!_ptrMap.has(e.pointerId)) return;
        const pid = _ptrMap.get(e.pointerId);
        if (_isBot && pid === 1) return;
        const cr = _canvas.getBoundingClientRect();
        _pads[pid].targetX = e.clientX - cr.left;
    };
    const onUp = e => _ptrMap.delete(e.pointerId);

    _canvas.addEventListener('pointerdown',   onDown);
    _canvas.addEventListener('pointermove',   onMove);
    _canvas.addEventListener('pointerup',     onUp);
    _canvas.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _canvas.removeEventListener('pointerdown',   onDown);
        _canvas.removeEventListener('pointermove',   onMove);
        _canvas.removeEventListener('pointerup',     onUp);
        _canvas.removeEventListener('pointercancel', onUp);
    });

    _pads = [
        { x: _W / 2, y: _H - PAD_OFFSET, targetX: _W / 2 }, // P1 bottom
        { x: _W / 2, y: PAD_OFFSET,      targetX: _W / 2 }, // P2 top
    ];
    _buildBricks();
    _launchBall();
}

function _destroy() {
    clearTimeout(_interPointTimer); _interPointTimer = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _canvas = null; _ctx = null; _scoreEls = [null, null];
    _ptrMap.clear();
}

export function destroy() { _done = true; _destroy(); }

// ── Game setup ────────────────────────────────────────────────────────────────
function _buildBricks() {
    _bricks = [];
    const bkW = (_W - (BK_COLS + 1) * BK_GAP) / BK_COLS;
    const totalH = BK_ROWS * (BK_H + BK_GAP) - BK_GAP;
    const startY = _H / 2 - totalH / 2;
    const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
    for (let row = 0; row < BK_ROWS; row++) {
        for (let col = 0; col < BK_COLS; col++) {
            _bricks.push({
                x:     BK_GAP + col * (bkW + BK_GAP),
                y:     startY + row * (BK_H + BK_GAP),
                w:     bkW,
                h:     BK_H,
                alive: true,
                color: COLORS[col % COLORS.length],
            });
        }
    }
}

function _launchBall() {
    _ball = { x: _W / 2, y: _H / 2, vx: 0, vy: 0 };
    const spread = Math.random() * 0.6 - 0.3; // radians from vertical
    const dir    = _serving === 0 ? 1 : -1;   // 1 = down toward P1, -1 = up toward P2
    _ball.vx = Math.sin(spread) * SPEED_BASE;
    _ball.vy = Math.cos(spread) * SPEED_BASE * dir;
    // Ensure minimum vertical speed
    if (Math.abs(_ball.vy) < MIN_VY) _ball.vy = Math.sign(_ball.vy) * MIN_VY;
    const spd = Math.hypot(_ball.vx, _ball.vy);
    _ball.vx = _ball.vx / spd * SPEED_BASE;
    _ball.vy = _ball.vy / spd * SPEED_BASE;
    _scoring = false;
}

// ── Public entry ──────────────────────────────────────────────────────────────
export function start(isBot, onWin) {
    if (!state.mgActive) return;
    cancelAnimationFrame(_af); _af = null;
    clearTimeout(_interPointTimer); _interPointTimer = null;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    _ptrMap.clear();
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _serving = 0; _scoring = false; _lastTime = 0;
    _neutralEl = document.getElementById('mg-neutral');

    [1, 2].forEach(pi => {
        const a = document.getElementById(`fs-arena-${pi}`);
        const s = document.getElementById(`fs-score-${pi}`);
        if (a) a.style.display = 'none';
        if (s) s.style.display = 'none';
    });

    _build();
    // Double rAF lets the browser lay out the canvas before we measure it
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _setup();
        if (_neutralEl) _neutralEl.textContent = 'BOUNCE IT PAST THEM!';
        _af = requestAnimationFrame(_tick);
    }));
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function _tick(now) {
    if (_done || !state.mgActive) return;
    const dt = _lastTime ? Math.min((now - _lastTime) / (1000 / 60), 3) : 1;
    _lastTime = now;
    if (!_scoring) _update(dt);
    _draw();
    _af = requestAnimationFrame(_tick);
}

function _update(dt) {
    // Move paddles toward touch target
    for (let pid = 0; pid < 2; pid++) {
        const pad = _pads[pid];
        if (_isBot && pid === 1) {
            // Bot: track ball with slight randomness
            pad.targetX = _ball.x + (Math.random() - 0.5) * 24;
        }
        const dx   = pad.targetX - pad.x;
        const step = Math.min(Math.abs(dx), PAD_SPEED * dt) * Math.sign(dx);
        pad.x = Math.max(PAD_W / 2, Math.min(_W - PAD_W / 2, pad.x + step));
    }

    // Move ball
    _ball.x += _ball.vx * dt;
    _ball.y += _ball.vy * dt;

    // Side wall bounces
    if (_ball.x - BALL_R < 0) {
        _ball.x = BALL_R;
        _ball.vx = Math.abs(_ball.vx);
        sfx('land_good');
    }
    if (_ball.x + BALL_R > _W) {
        _ball.x = _W - BALL_R;
        _ball.vx = -Math.abs(_ball.vx);
        sfx('land_good');
    }

    // Paddle collisions
    for (let pid = 0; pid < 2; pid++) {
        // Only collide when ball moving toward this paddle
        if (pid === 0 && _ball.vy <= 0) continue;  // P1 bottom: needs vy > 0
        if (pid === 1 && _ball.vy >= 0) continue;  // P2 top:    needs vy < 0

        const pad   = _pads[pid];
        const pL    = pad.x - PAD_W / 2;
        const pR    = pad.x + PAD_W / 2;
        const pTop  = pad.y - PAD_H / 2;
        const pBot  = pad.y + PAD_H / 2;

        if (_ball.x + BALL_R < pL || _ball.x - BALL_R > pR) continue;
        if (_ball.y + BALL_R < pTop || _ball.y - BALL_R > pBot) continue;

        // Push ball clear of paddle
        if (pid === 0) _ball.y = pTop - BALL_R;
        else           _ball.y = pBot + BALL_R;

        // Reflect + add spin based on hit offset from center
        const offset = (_ball.x - pad.x) / (PAD_W / 2); // -1..1
        _ball.vy = pid === 0 ? -Math.abs(_ball.vy) : Math.abs(_ball.vy);
        _ball.vx = offset * SPEED_BASE * 1.3;

        // Ensure minimum vy so ball doesn't go flat
        if (Math.abs(_ball.vy) < MIN_VY) _ball.vy = Math.sign(_ball.vy) * MIN_VY;

        // Speed cap
        const spd = Math.hypot(_ball.vx, _ball.vy);
        if (spd > SPEED_CAP) { _ball.vx *= SPEED_CAP / spd; _ball.vy *= SPEED_CAP / spd; }

        sfx('land_good');
    }

    // Brick collisions (circle vs AABB)
    for (const bk of _bricks) {
        if (!bk.alive) continue;
        const nearX = Math.max(bk.x, Math.min(_ball.x, bk.x + bk.w));
        const nearY = Math.max(bk.y, Math.min(_ball.y, bk.y + bk.h));
        const dx = _ball.x - nearX;
        const dy = _ball.y - nearY;
        if (dx * dx + dy * dy >= BALL_R * BALL_R) continue;

        bk.alive = false;
        // Bounce on the axis of least overlap
        const ox = BALL_R - Math.abs(dx);
        const oy = BALL_R - Math.abs(dy);
        if (ox < oy) _ball.vx = dx < 0 ? -Math.abs(_ball.vx) : Math.abs(_ball.vx);
        else          _ball.vy = dy < 0 ? -Math.abs(_ball.vy) : Math.abs(_ball.vy);

        sfx('coin_gain');
        break; // max one brick collision per frame
    }

    // Scoring: ball exits top or bottom
    if (_ball.y + BALL_R < 0)     _score(0); // past P2 → P1 scores
    else if (_ball.y - BALL_R > _H) _score(1); // past P1 → P2 scores
}

function _score(pid) {
    if (_scoring || _done) return;
    _scoring = true;
    _scores[pid]++;
    if (_scoreEls[pid]) _scoreEls[pid].textContent = `P${pid + 1}: ${_scores[pid]}`;
    sfx('mg_start');

    if (_neutralEl) _neutralEl.textContent = `P${pid + 1} SCORES!  ${_scores[0]}–${_scores[1]}`;

    if (_scores[pid] >= WIN_SCORE) {
        _done = true; state.mgActive = false;
        document.getElementById('minigame-layer').style.background = '';
        setTimeout(() => {
            cancelAnimationFrame(_af); _af = null;
            _destroy();
            [1, 2].forEach(pi => {
                const a = document.getElementById(`fs-arena-${pi}`);
                if (a) a.style.display = '';
            });
            _onWin(pid);
        }, 1200);
        return;
    }

    // Next serve goes toward the player who just got scored on (the loser)
    _serving = 1 - pid;

    _interPointTimer = setTimeout(() => {
        _interPointTimer = null;
        if (_done || !state.mgActive) return;
        _buildBricks();
        _launchBall();
        if (_neutralEl) _neutralEl.textContent = 'BOUNCE IT PAST THEM!';
    }, 1500);
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, _W, _H);

    // Center dashed divider
    _ctx.save();
    _ctx.setLineDash([8, 8]);
    _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.moveTo(0, _H / 2);
    _ctx.lineTo(_W, _H / 2);
    _ctx.stroke();
    _ctx.restore();

    // Bricks
    for (const bk of _bricks) {
        if (!bk.alive) continue;
        _ctx.fillStyle = bk.color;
        _rrect(bk.x, bk.y, bk.w, bk.h, 4);
        _ctx.fill();
        // Thin lighter highlight on top edge
        _ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        _ctx.lineWidth = 1;
        _ctx.beginPath();
        _ctx.moveTo(bk.x + 4, bk.y + 1);
        _ctx.lineTo(bk.x + bk.w - 4, bk.y + 1);
        _ctx.stroke();
    }

    // Paddles (with glow)
    const padColors = ['#fca5a5', '#93c5fd'];
    for (let pid = 0; pid < 2; pid++) {
        const pad = _pads[pid];
        _ctx.fillStyle = padColors[pid];
        _ctx.shadowColor = padColors[pid];
        _ctx.shadowBlur = 20;
        _rrect(pad.x - PAD_W / 2, pad.y - PAD_H / 2, PAD_W, PAD_H, PAD_H / 2);
        _ctx.fill();
        _ctx.shadowBlur = 0;
    }

    // Ball (with glow)
    _ctx.beginPath();
    _ctx.arc(_ball.x, _ball.y, BALL_R, 0, Math.PI * 2);
    _ctx.fillStyle = '#fff';
    _ctx.shadowColor = '#fff';
    _ctx.shadowBlur = 26;
    _ctx.fill();
    _ctx.shadowBlur = 0;
}

function _rrect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.lineTo(x + w - r, y);
    _ctx.arcTo(x + w, y,     x + w, y + r,     r);
    _ctx.lineTo(x + w, y + h - r);
    _ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    _ctx.lineTo(x + r, y + h);
    _ctx.arcTo(x,     y + h, x,      y + h - r, r);
    _ctx.lineTo(x,     y + r);
    _ctx.arcTo(x,     y,     x + r,  y,          r);
    _ctx.closePath();
}
