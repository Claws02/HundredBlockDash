// ============================================================
// PUCK — air hockey. One puck, one table, a goal at each end.
//
// The format the whole two-player-games genre is built on, and the one this
// roster had no version of. The FACE-OFF hold is already an air-hockey table:
// P1 at the bottom edge, P2 at the top, the phone flat between them. Drag your
// mallet anywhere in your own half; the puck bounces off the side walls and off
// whichever mallet gets to it.
//
// Everything interesting comes out of the physics rather than out of rules:
// striking on the move adds pace, the walls give you angles, and hanging back to
// guard your mouth costs you the counter-attack. Nothing to explain.
//
// First to WIN_GOALS, or most goals when the clock runs out.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables. Lengths are fractions of the table's SHORT side (its width), so
//    the game plays identically on any screen. Speeds are per SECOND (R1).
const WIN_GOALS    = 5;
const MATCH_TIME   = 42;     // s ceiling; settles on the score
const MALLET_R     = 0.085;  // of table width
const PUCK_R       = 0.055;
const GOAL_W       = 0.42;   // goal mouth as a fraction of table width
const PUCK_MAX     = 1.95;   // table-widths per second
const PUCK_MIN     = 0.10;   // below this the puck is nudged so play never dies
const FRICTION     = 0.35;   // velocity lost per second
const WALL_REST    = 0.94;
const STRIKE_BOOST = 1.30;   // how much of the mallet's own speed transfers
const RESET_PAUSE  = 900;    // ms between a goal and the face-off
// The status pill floats at each player's outer edge, and the goal mouth is at
// exactly that edge — without this inset the mouth is drawn behind the pill.
const PAD_Y        = 46;     // css px reserved at the top and bottom

// ── Module state (singleton — start() resets, _destroy() clears) ────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
let _W = 0, _H = 0;                       // css pixels
let _puck = { x: 0, y: 0, vx: 0, vy: 0 };
let _mallets = [                          // [P1 bottom, P2 top], in css pixels
    { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 },
];
let _score = [0, 0];
let _pointerOf = [null, null];            // pointerId currently steering each mallet
let _frozenUntil = 0;                     // face-off pause
let _flash = 0;                           // goal flash timer
let _flashSide = -1;
let _trail = [];
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
    _score = [0, 0]; _last = 0; _elapsed = 0; _flash = 0; _flashSide = -1;
    _pointerOf = [null, null]; _frozenUntil = 0; _trail = [];
    registerMinigameCleanup(_destroy);   // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _faceOff(Math.random() < 0.5 ? 0 : 1);
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM (R2) ────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;touch-action:none;background:#0b1523;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Input is partitioned by half (R5). Pointer capture keeps a mallet under
    // the finger even if the finger strays over the halfway line — the mallet
    // itself is still clamped to its own half below.
    const halfOf = e => (e.clientY < _overlay.clientHeight / 2 ? 1 : 0);
    const down = e => {
        if (_done) return;
        e.preventDefault();
        const pid = halfOf(e);
        if (pid === 1 && _isBot) return;
        if (_pointerOf[pid] !== null) return;
        _pointerOf[pid] = e.pointerId;
        try { _overlay.setPointerCapture(e.pointerId); } catch (err) {}
        _steer(pid, e.clientX, e.clientY);
    };
    const move = e => {
        if (_done) return;
        for (let pid = 0; pid < 2; pid++) {
            if (_pointerOf[pid] === e.pointerId) { e.preventDefault(); _steer(pid, e.clientX, e.clientY); }
        }
    };
    const up = e => {
        for (let pid = 0; pid < 2; pid++) if (_pointerOf[pid] === e.pointerId) _pointerOf[pid] = null;
        try { _overlay.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointermove', move);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', down));
    _cleanups.push(() => _overlay.removeEventListener('pointermove', move));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', up));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', up));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = `FIRST TO ${WIN_GOALS} GOALS!`;
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);   // R4
    const prevW = _W, prevH = _H;
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    if (prevW > 0 && prevH > 0) {          // keep the game state proportional
        const sx = _W / prevW, sy = _H / prevH;
        _puck.x *= sx; _puck.y *= sy;
        _mallets.forEach(m => { m.x *= sx; m.y *= sy; m.px *= sx; m.py *= sy; });
    } else {
        _mallets[0].x = _mallets[1].x = _W / 2;
        _mallets[0].y = _pb() - _H * 0.12; _mallets[1].y = _pt() + _H * 0.12;
        _mallets.forEach(m => { m.px = m.x; m.py = m.y; });
    }
}

// The playfield, inset from the screen edges so the goals aren't hidden behind
// the status pills.
function _pt()  { return PAD_Y; }
function _pb()  { return _H - PAD_Y; }
function _mid() { return (_pt() + _pb()) / 2; }

// A mallet may only travel in its owner's half, and never inside the walls.
function _steer(pid, cx, cy) {
    const r = MALLET_R * _W;
    const m = _mallets[pid];
    m.x = Math.max(r, Math.min(_W - r, cx));
    const top = pid === 0 ? _mid() + r : _pt() + r;
    const bot = pid === 0 ? _pb() - r  : _mid() - r;
    m.y = Math.max(top, Math.min(bot, cy));
}

function _faceOff(towardPid) {
    // Puck starts in the middle, drifting gently toward whoever conceded, so
    // there is always a moment to react rather than an instant scramble.
    _puck.x = _W / 2;
    _puck.y = _mid();
    const speed = 0.42 * _W;
    const ang = (towardPid === 0 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 0.9;
    _puck.vx = Math.cos(ang) * speed;
    _puck.vy = Math.sin(ang) * speed;
    _trail = [];
    _frozenUntil = performance.now() + RESET_PAUSE;
}

// ── Loop (R1) ───────────────────────────────────────────────────────────────
function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    if (_elapsed >= MATCH_TIME) { _finishOnScore(); return; }
    if (_isBot) _botSteer(dt);
    _physics(dt, now);
    _draw();
}

function _physics(dt, now) {
    // Mallet velocity, measured from actual movement — this is what makes
    // striking on the move add pace.
    for (const m of _mallets) {
        m.vx = (m.x - m.px) / Math.max(dt, 1e-4);
        m.vy = (m.y - m.py) / Math.max(dt, 1e-4);
        m.px = m.x; m.py = m.y;
    }

    _flash = Math.max(0, _flash - dt);
    if (now < _frozenUntil) return;        // face-off pause: mallets move, puck waits

    const pr = PUCK_R * _W, mr = MALLET_R * _W;

    // Substep so a fast puck can't tunnel through a mallet or a wall.
    const speed = Math.hypot(_puck.vx, _puck.vy);
    const sub = Math.min(8, Math.max(1, Math.ceil(speed * dt / (pr * 0.6))));
    const h = dt / sub;

    for (let s = 0; s < sub; s++) {
        _puck.x += _puck.vx * h;
        _puck.y += _puck.vy * h;

        // Side walls
        if (_puck.x - pr < 0)   { _puck.x = pr;      _puck.vx =  Math.abs(_puck.vx) * WALL_REST; _thud(); }
        if (_puck.x + pr > _W)  { _puck.x = _W - pr; _puck.vx = -Math.abs(_puck.vx) * WALL_REST; _thud(); }

        // End walls, with a goal mouth cut out of the middle of each.
        const gx0 = _W * (0.5 - GOAL_W / 2), gx1 = _W * (0.5 + GOAL_W / 2);
        const inMouth = _puck.x > gx0 && _puck.x < gx1;
        if (_puck.y - pr < _pt()) {
            if (inMouth) { _goal(0); return; }                       // into P2's net
            _puck.y = _pt() + pr; _puck.vy = Math.abs(_puck.vy) * WALL_REST; _thud();
        }
        if (_puck.y + pr > _pb()) {
            if (inMouth) { _goal(1); return; }                       // into P1's net
            _puck.y = _pb() - pr; _puck.vy = -Math.abs(_puck.vy) * WALL_REST; _thud();
        }

        // Mallets
        for (const m of _mallets) {
            const dx = _puck.x - m.x, dy = _puck.y - m.y;
            const d = Math.hypot(dx, dy);
            const min = pr + mr;
            if (d >= min || d === 0) continue;
            const nx = dx / d, ny = dy / d;
            // Push out of the overlap, then reflect and add the mallet's own
            // motion along the normal — the strike.
            _puck.x = m.x + nx * min;
            _puck.y = m.y + ny * min;
            const along = _puck.vx * nx + _puck.vy * ny;
            _puck.vx -= 2 * along * nx;
            _puck.vy -= 2 * along * ny;
            const mAlong = m.vx * nx + m.vy * ny;
            if (mAlong > 0) { _puck.vx += nx * mAlong * STRIKE_BOOST; _puck.vy += ny * mAlong * STRIKE_BOOST; }
            sfx('boost'); haptic([12]);
        }
    }

    // Friction, floor and ceiling on speed.
    const damp = Math.exp(-FRICTION * dt);
    _puck.vx *= damp; _puck.vy *= damp;
    let sp = Math.hypot(_puck.vx, _puck.vy);
    const max = PUCK_MAX * _W, min = PUCK_MIN * _W;
    if (sp > max) { _puck.vx = _puck.vx / sp * max; _puck.vy = _puck.vy / sp * max; }
    // A puck that has come to rest in a corner would stall the round out, so it
    // is always given just enough pace to be worth chasing.
    if (sp < min) {
        const ang = sp < 1e-3 ? Math.random() * Math.PI * 2 : Math.atan2(_puck.vy, _puck.vx);
        _puck.vx = Math.cos(ang) * min; _puck.vy = Math.sin(ang) * min;
    }

    _trail.push({ x: _puck.x, y: _puck.y });
    if (_trail.length > 12) _trail.shift();
}

let _lastThud = 0;
function _thud() {
    const now = performance.now();
    if (now - _lastThud < 60) return;     // don't machine-gun the sfx in substeps
    _lastThud = now;
    sfx('dice_land');
}

function _goal(scorerId) {
    _score[scorerId]++;
    _flash = 0.8; _flashSide = scorerId;
    sfx('coin_gain'); haptic('heavy');
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = `GOAL!   P1 ${_score[0]} · ${_score[1]} P2`;
    if (_score[scorerId] >= WIN_GOALS) { _finish(scorerId); return; }
    _faceOff(1 - scorerId);
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// Three dials that map to how a person actually plays: how far ahead it reads
// the puck, how fast its hand moves, and whether it commits to a strike or sits
// back on its goal line.
function _botSteer(dt) {
    const m = _mallets[1];
    const mr = MALLET_R * _W;
    const lead = 0.05 + _botSkill * 0.13;         // s of prediction
    const maxSpeed = (0.9 + _botSkill * 1.5) * _W;  // px/s the hand can travel
    const homeY = _pt() + (_pb() - _pt()) * 0.13;

    // Where the puck will be shortly.
    const px = _puck.x + _puck.vx * lead;
    const py = _puck.y + _puck.vy * lead;

    let tx, ty;
    const inMyHalf = _puck.y < _mid();
    const incoming = _puck.vy < 0 && _puck.y < _pt() + (_pb() - _pt()) * 0.62;
    if (inMyHalf && !incoming) {
        // ATTACK. Measured, the first version only ever defended — it returned
        // home whenever the puck was not coming at it, so it finished 0–0 even
        // against an opponent who never moved. If the puck is loose in its own
        // half it now gets BEHIND it and drives through, aiming at the far mouth.
        const goalX = _W / 2 + (Math.random() - 0.5) * _W * GOAL_W * 0.5;
        const ang = Math.atan2(_pb() - _puck.y, goalX - _puck.x);
        tx = _puck.x - Math.cos(ang) * mr * 1.15;
        ty = Math.max(_pt() + mr, Math.min(_mid() - mr, _puck.y - Math.sin(ang) * mr * 1.15));
    } else if (incoming) {
        // Meet it. A confident bot steps INTO the puck to add pace; a timid one
        // just interposes itself between the puck and the mouth.
        const commit = _botSkill > 0.45 && _puck.y < _pt() + (_pb() - _pt()) * 0.42;
        tx = Math.max(mr, Math.min(_W - mr, px));
        ty = commit ? Math.max(_pt() + mr, py - mr * 0.35)
                    : Math.max(_pt() + mr, Math.min(_mid() - mr, py + mr));
    } else {
        // Puck is in the other half and going away: hold the goal, shading to it.
        tx = _W / 2 + (px - _W / 2) * 0.35;
        ty = homeY;
    }
    // Aim error, so a weak bot mis-times the meeting point.
    tx += (1 - _botSkill) * _W * 0.16 * (Math.random() - 0.5);

    const dx = tx - m.x, dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
        const step = Math.min(d, maxSpeed * dt);
        _steer(1, m.x + (dx / d) * step, m.y + (dy / d) * step);
    }
}

// ── Draw ────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _W, h = _H, top = _pt(), bot = _pb(), mid = _mid();
    const ctx = _ctx;
    ctx.clearRect(0, 0, w, h);

    // Table, inset so the goal mouths clear the status pills at both edges.
    ctx.fillStyle = '#12233a'; ctx.fillRect(0, top, w, bot - top);
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 3;
    ctx.strokeRect(2, top + 2, w - 4, bot - top - 4);

    // Halfway line and centre circle
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, mid, w * 0.15, 0, Math.PI * 2); ctx.stroke();

    // Goal mouths, in each player's colour, with a crease arc
    const gx0 = w * (0.5 - GOAL_W / 2), gx1 = w * (0.5 + GOAL_W / 2);
    const paintGoal = (y, color, dir) => {
        ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
        ctx.globalAlpha = 0.30; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, y, w * 0.30, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    };
    paintGoal(top + 4, '#5a9bff', 1);   // P2 defends the top
    paintGoal(bot - 4, '#ff5a5a', -1);  // P1 defends the bottom

    // Puck trail, then the puck
    for (let i = 0; i < _trail.length; i++) {
        const t = _trail[i], a = (i + 1) / _trail.length;
        ctx.globalAlpha = a * 0.22;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(t.x, t.y, PUCK_R * w * a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Mallets
    for (let pid = 0; pid < 2; pid++) {
        const m = _mallets[pid], r = MALLET_R * w;
        const color = pid === 0 ? '#ff5a5a' : '#5a9bff';
        ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(m.x, m.y, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.30)'; ctx.fill();
    }

    // Puck last, so it is never hidden under a mallet
    const pr = PUCK_R * w;
    ctx.beginPath(); ctx.arc(_puck.x, _puck.y, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f7ff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#93a4c4'; ctx.stroke();

    // Score, one copy per player, each upright from that player's edge
    for (let pid = 0; pid < 2; pid++) {
        ctx.save();
        if (pid === 1) { ctx.translate(w, h); ctx.rotate(Math.PI); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.font = '900 30px "Bebas Neue", sans-serif';
        ctx.fillStyle = pid === 0 ? '#ff6b6b' : '#6ba7ff';
        ctx.fillText(`${_score[pid]}`, 16, h - PAD_Y - 22);
        ctx.font = '800 11px "Nunito", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.fillText(`YOU  ·  ${Math.ceil(Math.max(0, MATCH_TIME - _elapsed))}s LEFT`, 16, h - PAD_Y - 8);
        ctx.restore();
    }

    // Goal flash across the whole table
    if (_flash > 0) {
        ctx.globalAlpha = Math.min(0.5, _flash * 0.6);
        ctx.fillStyle = _flashSide === 0 ? '#ff5a5a' : '#5a9bff';
        ctx.fillRect(0, top, w, bot - top);
        ctx.globalAlpha = 1;
        for (let pid = 0; pid < 2; pid++) {
            ctx.save();
            if (pid === 1) { ctx.translate(w, h); ctx.rotate(Math.PI); }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '900 46px "Bebas Neue", sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText('GOAL!', w / 2, h * 0.72);
            ctx.restore();
        }
    }
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finishOnScore() {
    _finish(_score[0] > _score[1] ? 0 : _score[1] > _score[0] ? 1 : -1);
}

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
    _trail = []; _pointerOf = [null, null];
    _last = 0; _elapsed = 0; _W = 0; _H = 0;
}
