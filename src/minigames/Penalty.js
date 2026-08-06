// ============================================================
// PENALTY — the asymmetric one. One shoots, one keeps, then you swap.
//
// The roster's second structural gap: every other game has both players doing
// the same thing at the same time. Here the shooter drags to aim and releases to
// strike, while the keeper drags along their line and commits to a dive — and
// both decisions resolve at the same instant, so it is a genuine read of the
// other person rather than a test of your own hands.
//
// Unlike an abstract rock-paper-scissors it is physical: you aim at a place, you
// dive at a place, and you both get to watch the ball. Placement near a post is
// harder for the keeper to reach but easier to miss, so there is a real
// risk/reward in the aim itself.
//
// ROUNDS shots each way, alternating. Most goals wins; sudden death if level.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables. Positions are fractions of the canvas so it fits any screen. ──
const ROUNDS      = 3;      // shots each way
const SUDDEN_MAX  = 4;      // extra kicks (2 pairs) before a level match is a draw
const MATCH_TIME  = 62;     // s hard ceiling; settles on the score
const AIM_TIME    = 3.2;    // s the shooter has before the shot is taken for them
const FLIGHT      = 0.52;   // s of ball flight
const SETTLE      = 1.15;   // s to read the outcome before the next kick
const GOAL_W      = 0.86;   // goal width as a fraction of canvas width
const GOAL_H      = 0.20;   // goal height as a fraction of the shooter's half
const KEEPER_W    = 0.15;   // keeper's reach as a fraction of goal width
const POST_MISS   = 0.965;  // aim beyond this fraction of half-width hits the post
// The status pill floats at each player's outer edge, which is exactly where
// the goal sits — without this inset the mouth is drawn behind it.
const PAD_Y       = 48;     // css px reserved at the top and bottom

// ── Module state ────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;

let _score = [0, 0];
let _kick = 0;                  // 0..ROUNDS*2-1
let _shooter = 0;               // whose kick this is
let _phase = 'aim';             // 'aim' | 'flight' | 'settle' | 'over'
let _phaseT = 0;
let _aim = { x: 0.5, y: 0.5 };  // 0..1 within the goal mouth
let _aimAnchor = null;          // where the aim drag began, and the aim it began from
let _dragging = false;
let _keeper = 0.5;              // 0..1 along the goal line
let _keeperCommitted = null;    // where the keeper actually dived
let _ball = { x: 0.5, y: 1, from: null, to: null };
let _outcome = '';              // 'GOAL' | 'SAVED' | 'POST'
let _botAimTimer = null;
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
    _score = [0, 0]; _kick = 0; _shooter = 0;
    _phase = 'aim'; _phaseT = 0;
    _aim = { x: 0.5, y: 0.5 }; _aimAnchor = null; _keeper = 0.5; _keeperCommitted = null;
    _dragging = false; _outcome = ''; _last = 0; _elapsed = 0; _botAimTimer = null;
    registerMinigameCleanup(_destroy);   // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _beginKick();
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
        'background:linear-gradient(180deg,#0d2a18 0%,#12351f 50%,#0d2a18 100%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Both roles are steered from the player's own half — the shooter drags an
    // aim reticle, the keeper drags along their line — so neither has to reach
    // across the phone and the input split stays the usual one (R5).
    const halfOf = e => (e.clientY < _overlay.clientHeight / 2 ? 1 : 0);
    const onDown = e => {
        if (_done || _phase !== 'aim') return;
        e.preventDefault();
        const pid = halfOf(e);
        if (pid === 1 && _isBot) return;
        if (pid === _shooter) { _dragging = true; _beginAimDrag(e.clientX, e.clientY); }
        else                  { _setKeeper(e.clientX); }
        try { _overlay.setPointerCapture(e.pointerId); } catch (err) {}
    };
    const onMove = e => {
        if (_done || _phase !== 'aim') return;
        const pid = halfOf(e);
        if (pid === 1 && _isBot) return;
        if (pid === _shooter) { if (_dragging) { e.preventDefault(); _setAim(e.clientX, e.clientY); } }
        else                  { e.preventDefault(); _setKeeper(e.clientX); }
    };
    const onUp = e => {
        if (_done) return;
        try { _overlay.releasePointerCapture(e.pointerId); } catch (err) {}
        if (_phase !== 'aim') return;
        const pid = halfOf(e);
        if (pid === _shooter && _dragging && !(pid === 1 && _isBot)) {
            _dragging = false; _aimAnchor = null; _shoot();
        }
    };
    _overlay.addEventListener('pointerdown', onDown);
    _overlay.addEventListener('pointermove', onMove);
    _overlay.addEventListener('pointerup', onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));
    _cleanups.push(() => _overlay.removeEventListener('pointermove', onMove));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', onUp));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', onUp));

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
}

// Geometry: the goal always sits at the KEEPER's edge, so whoever is keeping is
// defending the mouth right in front of them.
function _goalRect() {
    const keeperTop = _shooter === 0;          // shooter at bottom → keeper at top
    const gw = _W * GOAL_W;
    const gh = _H * 0.5 * GOAL_H;
    const x = (_W - gw) / 2;
    const y = keeperTop ? PAD_Y + 10 : _H - PAD_Y - 10 - gh;
    return { x, y, w: gw, h: gh, keeperTop };
}

// ── Aiming ──────────────────────────────────────────────────────────────────
//
// The aim used to map the finger's ABSOLUTE screen position onto the goal
// rectangle. Horizontally that was survivable, because the goal is 86% of the
// screen width. Vertically it was unusable: the mouth is about 90 px tall and
// sits at the FAR end of the phone, so to aim at a top corner your thumb had to
// be inside your opponent's half, and every real thumb position clamped to 0 or
// 1. You could pick a side and nothing else.
//
// It is a relative drag now. Press anywhere in your half and the reticle moves
// from where it was by how far you have dragged, scaled so a comfortable thumb
// sweep covers the whole mouth. AIM_SPAN_* is that sweep, as a fraction of the
// screen.
const AIM_SPAN_X = 0.34;   // of screen width  = full left-to-right of the goal
const AIM_SPAN_Y = 0.20;   // of screen height = full bar-to-line of the goal

function _beginAimDrag(cx, cy) {
    _aimAnchor = { x: cx, y: cy, ax: _aim.x, ay: _aim.y };
}

function _setAim(cx, cy) {
    if (!_aimAnchor) { _beginAimDrag(cx, cy); return; }
    // P2 holds the phone upside-down, so their "right" and "up" are the screen's
    // left and down. Without this the aim ran backwards for one of the players.
    const flip = _shooter === 1 ? -1 : 1;
    const dx = (cx - _aimAnchor.x) * flip;
    const dy = (cy - _aimAnchor.y) * flip;
    _aim.x = Math.max(0, Math.min(1, _aimAnchor.ax + dx / (_W * AIM_SPAN_X)));
    _aim.y = Math.max(0, Math.min(1, _aimAnchor.ay + dy / (_H * AIM_SPAN_Y)));
}

// The keeper tracks their finger along the goal line — but the line is at THEIR
// edge and, for Player 2, the screen is turned around, so the raw x had to be
// mirrored or the keeper dived the wrong way every time.
function _setKeeper(cx) {
    const g = _goalRect();
    let t = (cx - g.x) / g.w;
    if (_keeperIsP2()) t = 1 - t;
    _keeper = Math.max(0, Math.min(1, t));
}

// Both players hold their own coordinates — "my left" — because that is what a
// drag has to feel like. The shot is resolved in ONE canonical frame instead, so
// the two are never compared while they mean opposite things. Screen space: 0 is
// the left of the goal as the phone lies.
function _keeperIsP2() { return _shooter === 0; }
function _aimScreenX()    { return _shooter === 1 ? 1 - _aim.x : _aim.x; }
function _keeperScreenX(v) {
    const k = v === undefined ? _keeper : v;
    return _keeperIsP2() ? 1 - k : k;
}

// ── Kick flow ───────────────────────────────────────────────────────────────
function _beginKick() {
    if (_done) return;
    _shooter = _kick % 2;
    _phase = 'aim'; _phaseT = 0;
    _outcome = ''; _keeperCommitted = null; _dragging = false;
    _aim = { x: 0.5, y: 0.45 };
    _aimAnchor = null;
    _keeper = 0.5;
    const g = _goalRect();
    _ball = { x: _W / 2, y: g.keeperTop ? _H * 0.74 : _H * 0.26, from: null, to: null };

    const neu = document.getElementById('mg-neutral');
    if (neu) {
        // Kept short: the status pill is one line and ellipsises anything longer.
        neu.textContent = `KICK ${_kick + 1} · P${_shooter + 1} SHOOTS · ${_score[0]}–${_score[1]}`;
    }
    sfx('countdown');

    // Bot roles. As keeper it drifts and commits late; as shooter it lines up
    // and fires within the aim window.
    if (_isBot) {
        if (_shooter === 1) {
            const delay = 900 + (1 - _botSkill) * 900 + Math.random() * 500;
            _botAimTimer = _after(() => {
                if (_done || _phase !== 'aim') return;
                // Aims wide of centre in proportion to skill, but a weak bot
                // overcooks it and finds the post.
                const side = Math.random() < 0.5 ? -1 : 1;
                const reach = 0.30 + _botSkill * 0.62 + (1 - _botSkill) * Math.random() * 0.34;
                _aim.x = 0.5 + side * Math.min(0.52, reach / 2);
                _aim.y = 0.25 + Math.random() * 0.6;
                _shoot();
            }, delay);
        }
    }
}

function _shoot() {
    if (_phase !== 'aim') return;
    _phase = 'flight'; _phaseT = 0;

    // The keeper commits at the moment of the strike — this is the read.
    if (_isBot && _shooter === 0) {
        // Bot keeper: guesses, weighted toward the shooter's current aim by
        // skill. At low skill it is close to a coin flip. Guessed in SCREEN
        // space and converted back, so it isn't diving at a mirrored target.
        const aimS = _aimScreenX();
        const guessS = Math.random() < (0.18 + _botSkill * 0.62)
            ? aimS + (Math.random() - 0.5) * (1 - _botSkill) * 0.55
            : Math.random();
        const clamped = Math.max(0, Math.min(1, guessS));
        _keeper = _keeperIsP2() ? 1 - clamped : clamped;
    }
    _keeperCommitted = _keeper;

    const g = _goalRect();
    const aimS = _aimScreenX();
    _ball.from = { x: _ball.x, y: _ball.y };
    _ball.to = { x: g.x + aimS * g.w, y: g.y + _aim.y * g.h };

    // Off the woodwork: aiming right at the very edge is the greedy shot.
    const edge = Math.abs(_aim.x - 0.5) * 2;
    if (edge > POST_MISS) _outcome = 'POST';
    else {
        const reach = KEEPER_W / 2 + 0.055;             // half the keeper's span
        _outcome = Math.abs(_keeperScreenX(_keeperCommitted) - aimS) <= reach ? 'SAVED' : 'GOAL';
    }
    sfx('boost'); haptic([18]);
}

function _resolveKick() {
    if (_outcome === 'GOAL') { _score[_shooter]++; sfx('coin_gain'); haptic('heavy'); }
    else sfx('land_bad');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `${_outcome === 'GOAL' ? '⚽ GOAL!' : _outcome === 'POST' ? '🥅 OFF THE POST!' : '🧤 SAVED!'}   P1 ${_score[0]} · ${_score[1]} P2`;
    _phase = 'settle'; _phaseT = 0;
}

function _nextKick() {
    _kick++;
    const done = _kick >= ROUNDS * 2;
    // Sudden death: keep alternating in pairs until somebody is ahead after an
    // equal number of kicks each.
    if (done && _score[0] === _score[1] && _kick < ROUNDS * 2 + SUDDEN_MAX) { _beginKick(); return; }
    if (done) { _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1); return; }
    _beginKick();
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _phaseT += dt;
    _elapsed += dt;

    // Hard ceiling. Sudden death can otherwise run the round well past the
    // arcade's time budget when neither player can convert.
    if (_elapsed >= MATCH_TIME) {
        _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
        return;
    }

    if (_phase === 'aim') {
        // The aim window is a ceiling, not a suggestion: run it out and the shot
        // is struck from wherever the reticle happens to be.
        if (_phaseT >= AIM_TIME) { _dragging = false; _shoot(); }
    } else if (_phase === 'flight') {
        const p = Math.min(1, _phaseT / FLIGHT);
        _ball.x = _ball.from.x + (_ball.to.x - _ball.from.x) * p;
        _ball.y = _ball.from.y + (_ball.to.y - _ball.from.y) * p;
        if (p >= 1) _resolveKick();
    } else if (_phase === 'settle') {
        if (_phaseT >= SETTLE) _nextKick();
    }
    _draw();
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const ctx = _ctx, w = _W, h = _H;
    ctx.clearRect(0, 0, w, h);
    const g = _goalRect();

    // Pitch markings
    ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.16, 0, Math.PI * 2); ctx.stroke();
    // Penalty box around the goal
    ctx.strokeRect(w * 0.05, g.keeperTop ? PAD_Y : h - PAD_Y - h * 0.28, w * 0.90, h * 0.28);

    // Goal frame
    ctx.strokeStyle = '#f1f5ff'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.strokeRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
        const x = g.x + (g.w / 10) * i;
        ctx.beginPath(); ctx.moveTo(x, g.y); ctx.lineTo(x, g.y + g.h); ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
        const y = g.y + (g.h / 4) * i;
        ctx.beginPath(); ctx.moveTo(g.x, y); ctx.lineTo(g.x + g.w, y); ctx.stroke();
    }

    // Keeper
    const kx = g.x + _keeperScreenX(_keeperCommitted ?? _keeper) * g.w;
    const kw = g.w * KEEPER_W, kh = g.h * 0.92;
    ctx.fillStyle = _shooter === 0 ? '#5a9bff' : '#ff5a5a';
    _roundRect(ctx, kx - kw / 2, g.y + (g.h - kh) / 2, kw, kh, 8);
    ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(kh * 0.34)}px "Bebas Neue", sans-serif`;
    ctx.fillText('🧤', kx, g.y + g.h / 2);

    // Aim reticle, only while the shooter is choosing
    if (_phase === 'aim') {
        const ax = g.x + _aimScreenX() * g.w, ay = g.y + _aim.y * g.h;
        ctx.strokeStyle = _shooter === 0 ? '#ff5a5a' : '#5a9bff';
        ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(ax, ay, Math.max(13, g.h * 0.22), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax - 12, ay); ctx.lineTo(ax + 12, ay);
        ctx.moveTo(ax, ay - 12); ctx.lineTo(ax, ay + 12);
        ctx.stroke();
        ctx.setLineDash([6, 6]); ctx.globalAlpha = 0.45; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(_ball.x, _ball.y); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;

        // Name the placement you are committing to, so the drag has a readable
        // result rather than being a guess at a dot's position.
        const side = _aim.x < 0.30 ? 'LEFT' : _aim.x > 0.70 ? 'RIGHT' : 'CENTRE';
        const hgt  = _aim.y < 0.38 ? 'HIGH' : _aim.y > 0.72 ? 'LOW' : 'MID';
        const risky = Math.abs(_aim.x - 0.5) * 2 > 0.88;
        ctx.save();
        if (_shooter === 1) { ctx.translate(_W, _H); ctx.rotate(Math.PI); }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '900 15px "Bebas Neue", sans-serif';
        ctx.fillStyle = risky ? '#fbbf24' : 'rgba(255,255,255,.72)';
        ctx.fillText(`${hgt} ${side}${risky ? '  ·  POST RISK' : ''}`, _W / 2, _H * 0.56);
        ctx.restore();
    }

    // Ball
    ctx.beginPath(); ctx.arc(_ball.x, _ball.y, Math.max(9, w * 0.028), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#233'; ctx.stroke();

    // Per-player HUD: role, score, and the aim clock — each upright at its edge
    _drawSide(0, w, h);
    ctx.save(); ctx.translate(w, h); ctx.rotate(Math.PI); _drawSide(1, w, h); ctx.restore();

    // Outcome banner, one copy per player
    if (_phase === 'settle' && _outcome) {
        for (let pid = 0; pid < 2; pid++) {
            ctx.save();
            if (pid === 1) { ctx.translate(w, h); ctx.rotate(Math.PI); }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '900 40px "Bebas Neue", sans-serif';
            ctx.fillStyle = _outcome === 'GOAL' ? '#4ade80' : _outcome === 'POST' ? '#fbbf24' : '#93c5fd';
            ctx.fillText(_outcome === 'GOAL' ? 'GOAL!' : _outcome === 'POST' ? 'OFF THE POST!' : 'SAVED!',
                         w / 2, h * 0.62);
            ctx.restore();
        }
    }
}

function _drawSide(pid, w, h) {
    const ctx = _ctx;
    const shooting = _shooter === pid;
    const color = pid === 0 ? '#ff5a5a' : '#5a9bff';
    // Sit ABOVE where the goal would be if this player were keeping, so the HUD
    // is in the same place on both kicks and never lands on the net.
    const goalTop = h - PAD_Y - 10 - (h * 0.5 * GOAL_H);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = '900 22px "Bebas Neue", sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(`P${pid + 1}  ${_score[pid]}`, 14, goalTop - 26);
    ctx.font = '800 12px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    const role = _phase === 'aim'
        ? (shooting ? `SHOOT — drag to aim, release to strike (${Math.ceil(Math.max(0, AIM_TIME - _phaseT))}s)`
                    : 'KEEP — slide to pick your dive')
        : (shooting ? 'SHOOTING' : 'KEEPING');
    ctx.fillText(role, 14, goalTop - 10);
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
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0
        ? `DRAW ${_score[0]}–${_score[1]}`
        : `P${winnerId + 1} WINS ${Math.max(..._score)}–${Math.min(..._score)}!`;
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
    _botAimTimer = null; _keeperCommitted = null; _aimAnchor = null;
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
