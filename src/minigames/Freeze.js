// ============================================================
// FREEZE — grandmother's footsteps, on ONE track, with an Eye that picks a side.
//
// The old version put each player on their own private lane with their own
// private copy of the same signal. You could not see how close your rival was,
// nothing you did touched them, and the only decision was "let go when the light
// changes" — a reaction test wearing a stealth costume.
//
// Three changes make it a duel:
//
//   1. ONE TRACK, ONE CROWN. The Crown sits on the centre line and both players
//      creep inward toward it from their own edge. Both tokens are on screen for
//      both players, so you can always see exactly how much road your rival has
//      left. That is the shared object the old version was missing.
//
//   2. THE EYE PICKS A SIDE. It does not simply say STOP to everybody. It wakes,
//      turns, and watches P1, or P2, or both. If it is not looking at you, you
//      are free to creep while your rival is pinned — so the phase that stops
//      them is the phase you profit from, and vice versa. Watching the gaze
//      turn is now the whole game.
//
//   3. NOISE HELPS YOUR RIVAL. Getting spotted knocks you back AND nudges the
//      other player forward: your scuffle covered their footsteps. One player's
//      mistake is directly the other's gain.
//
// Built to docs/MINIGAME_STANDARD.md. Face-off symmetric; the gaze is carried by
// the pupil's POSITION and a written label, not by colour alone.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// Measured with the bot playing unopposed: at 0.235 the track was crossed in
// ~10 s, under the standard's 15 s floor. At 0.135 a clean run is ~20 s and a
// scrappy one ~30 s, which is where this wants to sit.
const ADVANCE     = 0.135;  // progress per SECOND while creeping safely
const SETBACK     = 0.16;   // progress lost when spotted
const NOISE_GIFT  = 0.045;  // progress the OTHER player gains from your scuffle
const LOCKOUT     = 0.7;    // s frozen after being spotted
const SAFETY_TIME = 44;     // s cap; settles on whoever is further along

// Phase durations lerp from "generous" at the start to "tight" as the leader
// closes on the Crown, so the last stretch is the hard one.
const SLEEP = [1.75, 0.95];   // eye closed — everyone may move
const STIR  = [0.55, 0.30];   // eye opening, gaze visibly turning: the telegraph
const WATCH = [0.95, 1.45];   // eye open and locked on its target

// Who the Eye looks at when it opens. Both is the most common so the game still
// has shared STOP beats; the one-sided looks are what create the swings.
const GAZE_TABLE = ['both', 'both', 'p1', 'p2', 'p1', 'p2'];

// ── Module state (singleton — start() resets, _destroy() clears) ────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _phase = 'sleep';           // 'sleep' | 'stir' | 'watch'
let _phaseLeft = SLEEP[0];
let _gaze = 'both';             // who the NEXT/current watch is aimed at
let _gazeAnim = 0;              // 0..1 eyelid open amount, eased for the draw
let _progress = [0, 0];
let _holding  = [false, false];
let _locked   = [0, 0];         // remaining lockout seconds
let _caught   = [0, 0];         // caught-flash seconds
let _gift     = [0, 0];         // "+free step" flash seconds
let _pointers = [new Set(), new Set()];
let _botReleaseAt = Infinity;
let _stars = [];

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
    _last = 0; _t = 0;
    _phase = 'sleep'; _phaseLeft = SLEEP[0]; _gazeAnim = 0;
    _gaze = GAZE_TABLE[Math.floor(Math.random() * GAZE_TABLE.length)];
    _progress = [0, 0]; _holding = [false, false];
    _locked = [0, 0]; _caught = [0, 0]; _gift = [0, 0];
    _pointers = [new Set(), new Set()];
    _botReleaseAt = Infinity;
    _stars = [];
    registerMinigameCleanup(_destroy);   // R3
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
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
        'background:linear-gradient(180deg,#070a14 0%,#111a2e 45%,#0b1020 55%,#070a14 100%);';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Multi-touch safe: track pointer ids per half so a stray second finger on
    // one side can't release the first one's hold.
    const pidFor = e => (e.clientY < _overlay.clientHeight / 2 ? 1 : 0);
    const down = e => {
        if (_done) return;
        e.preventDefault();
        const p = pidFor(e);
        if (p === 1 && _isBot) return;
        _pointers[p].add(e.pointerId);
        _holding[p] = true;
    };
    const up = e => {
        if (_done) return;
        e.preventDefault();
        for (let p = 0; p < 2; p++) {
            if (p === 1 && _isBot) continue;
            if (_pointers[p].delete(e.pointerId) && _pointers[p].size === 0) _holding[p] = false;
        }
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _overlay.addEventListener('pointerleave', up);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', down));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', up));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', up));
    _cleanups.push(() => _overlay.removeEventListener('pointerleave', up));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'HOLD TO CREEP — FREEZE WHEN IT LOOKS AT YOU!';
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);   // R4
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    // Starfield for the corridor backdrop, regenerated to the new size.
    _stars = [];
    for (let i = 0; i < 46; i++) {
        _stars.push({ x: Math.random() * w, y: Math.random() * h,
                      r: 0.5 + Math.random() * 1.4, a: 0.15 + Math.random() * 0.4,
                      tw: Math.random() * Math.PI * 2 });
    }
}

// ── Loop (R1 — dt in seconds, capped) ───────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);
    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;

    if (_t >= SAFETY_TIME) { _finishByLead(); return; }
    _update(dt);
    if (_isBot) _botUpdate();
    _draw();
}

// Difficulty 0→1 follows the leader, so the pressure rises as the Crown nears.
function _diff() { return Math.max(_progress[0], _progress[1]); }
function _lerp(a, d) { return a[0] + (a[1] - a[0]) * d; }

// Is the Eye actually looking at this player right now?
function _watched(pid) {
    if (_phase !== 'watch') return false;
    return _gaze === 'both' || _gaze === (pid === 0 ? 'p1' : 'p2');
}

function _advancePhase() {
    const d = _diff();
    if (_phase === 'sleep') {
        // Choose the target BEFORE the telegraph, so the stir can point at it.
        _gaze = GAZE_TABLE[Math.floor(Math.random() * GAZE_TABLE.length)];
        _phase = 'stir'; _phaseLeft = _lerp(STIR, d);
        sfx('countdown');
    } else if (_phase === 'stir') {
        _phase = 'watch';
        _phaseLeft = _lerp(WATCH, d) * (0.85 + Math.random() * 0.3);
        sfx('react_go');
        // Anyone still creeping the instant the Eye locks on is spotted.
        for (let p = 0; p < 2; p++) if (_holding[p] && _locked[p] <= 0 && _watched(p)) _spot(p);
    } else {
        _phase = 'sleep';
        _phaseLeft = _lerp(SLEEP, d) * (0.8 + Math.random() * 0.4);
        _botReleaseAt = Infinity;
    }
}

function _spot(pid) {
    _progress[pid] = Math.max(0, _progress[pid] - SETBACK);
    _locked[pid] = LOCKOUT;
    _caught[pid] = 0.6;
    _holding[pid] = false;
    _pointers[pid].clear();
    // Your scuffle covers their footsteps — a mistake is directly their gain.
    const other = 1 - pid;
    _progress[other] = Math.min(1, _progress[other] + NOISE_GIFT);
    _gift[other] = 0.7;
    sfx('land_bad'); if (pid === 0) haptic([60, 40, 60]);
    if (_progress[other] >= 1) _finish(other);
}

function _update(dt) {
    _phaseLeft -= dt;
    if (_phaseLeft <= 0) _advancePhase();

    // Eyelid animation, eased toward the phase's target opening.
    const targetOpen = _phase === 'watch' ? 1 : _phase === 'stir' ? 0.45 : 0;
    _gazeAnim += (targetOpen - _gazeAnim) * Math.min(1, dt * 12);

    for (let p = 0; p < 2; p++) {
        _caught[p] = Math.max(0, _caught[p] - dt);
        _gift[p]   = Math.max(0, _gift[p] - dt);
        if (_locked[p] > 0) { _locked[p] -= dt; continue; }
        if (!_holding[p]) continue;
        if (_watched(p)) { _spot(p); continue; }        // moving while watched
        _progress[p] = Math.min(1, _progress[p] + ADVANCE * dt);
        if (_progress[p] >= 1) { _finish(p); return; }
    }

    const neu = document.getElementById('mg-neutral');
    if (neu) {
        neu.textContent =
            _phase === 'sleep' ? '😴 ASLEEP — GO!'
          : _phase === 'stir'  ? '⚠️ WAKING…'
          : _gaze === 'both'   ? '👁️ WATCHING BOTH — FREEZE!'
          : _gaze === 'p1'     ? '👁️ WATCHING P1 — P2 IS FREE!'
                               : '👁️ WATCHING P2 — P1 IS FREE!';
    }
}

// ── Bot (§5) ────────────────────────────────────────────────────────────────
//
// The bot plays the same read a human does: it creeps whenever the Eye is not
// aimed at it, and its reaction to the telegraph is the skill dial. A low-skill
// bot also fails to notice when a one-sided look leaves it free, so it wastes
// the phases it should be exploiting.
function _botUpdate() {
    if (_locked[1] > 0) { _holding[1] = false; return; }
    const aimedAtMe = _gaze === 'both' || _gaze === 'p2';

    if (_phase === 'sleep') {
        _holding[1] = true;
    } else if (_phase === 'stir') {
        if (!aimedAtMe) {
            // Free phase coming. A sharp bot keeps going; a weak one panics and
            // stops anyway, which is exactly the mistake a new player makes.
            _holding[1] = _botSkill > 0.4 ? true : Math.random() < 0.35;
        } else {
            if (_botReleaseAt === Infinity) {
                // Easy lands ~605 ms, past the 550 ms telegraph, so it genuinely
                // gets caught; hard lands ~185 ms and reliably makes it.
                const react = 80 + (1 - _botSkill) * 700 + Math.random() * 160;   // ms
                _botReleaseAt = performance.now() + react;
            }
            _holding[1] = performance.now() < _botReleaseAt;
        }
    } else {                                   // watch
        _holding[1] = !aimedAtMe && _botSkill > 0.35;
    }
}

// ── Draw ────────────────────────────────────────────────────────────────────
//
// One shared track down the middle of the screen with the Crown at the centre
// line. Both tokens are drawn for both players, so each of you can see exactly
// how much road the other has left.
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight, mid = h / 2;
    _ctx.clearRect(0, 0, w, h);

    // Backdrop
    for (const s of _stars) {
        s.tw += 0.03;
        _ctx.globalAlpha = s.a * (0.65 + 0.35 * Math.sin(s.tw));
        _ctx.fillStyle = '#cfe4ff';
        _ctx.beginPath(); _ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.globalAlpha = 1;

    const cx = w / 2;
    const startPad = h * 0.085;              // where each player's token begins
    const goalPad  = h * 0.10;               // how close to the middle the Crown is
    const p1Start = h - startPad, p1Goal = mid + goalPad;
    const p2Start = startPad,     p2Goal = mid - goalPad;

    // The track: one corridor, drawn full height.
    _ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    _ctx.lineWidth = Math.max(30, w * 0.20); _ctx.lineCap = 'round';
    _ctx.beginPath(); _ctx.moveTo(cx, p1Start); _ctx.lineTo(cx, p2Start); _ctx.stroke();

    // Rungs, so progress is legible without reading a number.
    _ctx.strokeStyle = 'rgba(255,255,255,0.055)'; _ctx.lineWidth = 2;
    for (let i = 1; i < 10; i++) {
        const y1 = p1Start + (p1Goal - p1Start) * (i / 10);
        const y2 = p2Start + (p2Goal - p2Start) * (i / 10);
        for (const y of [y1, y2]) {
            _ctx.beginPath();
            _ctx.moveTo(cx - w * 0.09, y); _ctx.lineTo(cx + w * 0.09, y); _ctx.stroke();
        }
    }

    _drawEye(cx, mid, w);

    // Tokens, both visible to both players.
    _drawToken(0, cx, p1Start + (p1Goal - p1Start) * _progress[0], w);
    _drawToken(1, cx, p2Start + (p2Goal - p2Start) * _progress[1], w);

    // Per-player HUD, each rotated to its owner's edge.
    _drawHud(0, w, h);
    _ctx.save(); _ctx.translate(w, h); _ctx.rotate(Math.PI); _drawHud(1, w, h); _ctx.restore();
}

// The Crown, and the Eye above it whose pupil says who is being watched.
function _drawEye(cx, mid, w) {
    const R = Math.min(w * 0.15, 74);

    // Crown on its pedestal, dead centre — the thing both of you want.
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.font = `${Math.round(R * 0.62)}px serif`;
    _ctx.fillText('👑', cx, mid);

    // Halo whose colour reinforces the phase (but never carries it alone).
    const col = _phase === 'watch' ? '#ef4444' : _phase === 'stir' ? '#f59e0b' : '#22c55e';
    _ctx.strokeStyle = col; _ctx.globalAlpha = 0.30 + 0.35 * _gazeAnim;
    _ctx.lineWidth = 3;
    _ctx.beginPath(); _ctx.arc(cx, mid, R * 0.92, 0, Math.PI * 2); _ctx.stroke();
    _ctx.globalAlpha = 1;

    // The Eye: a lens on the left of the Crown, big enough to read at a glance.
    const ex = cx - R * 1.35, ey = mid;
    if (_gazeAnim < 0.10) {
        // Properly shut, not a thin sliver — a closed lid reads as "asleep" at a
        // glance, which is the whole cue for "you may move".
        _ctx.strokeStyle = col; _ctx.lineWidth = 4; _ctx.lineCap = 'round';
        _ctx.beginPath();
        _ctx.arc(ex, ey - R * 0.16, R * 0.56, 0.16 * Math.PI, 0.84 * Math.PI);
        _ctx.stroke();
        for (let i = -1; i <= 1; i++) {           // lashes
            _ctx.beginPath();
            _ctx.moveTo(ex + i * R * 0.34, ey + R * 0.36);
            _ctx.lineTo(ex + i * R * 0.40, ey + R * 0.52);
            _ctx.stroke();
        }
    } else {
        _ctx.save();
        _ctx.beginPath();
        _ctx.ellipse(ex, ey, R * 0.62, R * 0.62 * _gazeAnim, 0, 0, Math.PI * 2);
        _ctx.fillStyle = '#f4f6ff'; _ctx.fill();
        _ctx.lineWidth = 3; _ctx.strokeStyle = col; _ctx.stroke();
        _ctx.clip();
        // Pupil position IS the message: down = watching P1, up = watching P2,
        // centred = watching both.
        const look = _gaze === 'p1' ? 1 : _gaze === 'p2' ? -1 : 0;
        const py = ey + look * R * 0.30 * _gazeAnim;
        _ctx.beginPath(); _ctx.arc(ex, py, R * 0.26, 0, Math.PI * 2);
        _ctx.fillStyle = '#12172a'; _ctx.fill();
        _ctx.restore();
    }

    // And in words, once per player. Both copies sit to the RIGHT of the Crown,
    // stacked either side of the centre line, so neither lands on the eye.
    const label = _phase === 'sleep' ? 'ASLEEP'
                : _phase === 'stir'  ? 'WAKING'
                : _gaze === 'both'   ? 'BOTH'
                : _gaze.toUpperCase();
    _ctx.font = '900 15px "Bebas Neue", sans-serif';
    _ctx.fillStyle = col;
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(label, cx + R * 1.15, mid + R * 0.34);
    _ctx.save();
    _ctx.translate(cx + R * 1.15, mid - R * 0.34); _ctx.rotate(Math.PI);
    _ctx.fillText(label, 0, 0);
    _ctx.restore();
}

function _drawToken(pid, cx, y, w) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    const r = Math.max(11, w * 0.042);
    const frozen = _locked[pid] > 0;
    const moving = _holding[pid] && !frozen && !_watched(pid);

    if (moving) {                                  // motion puff behind the token
        _ctx.globalAlpha = 0.22; _ctx.fillStyle = '#ffffff';
        const back = pid === 0 ? y + r * 1.5 : y - r * 1.5;
        _ctx.beginPath(); _ctx.arc(cx, back, r * 0.5, 0, Math.PI * 2); _ctx.fill();
        _ctx.globalAlpha = 1;
    }
    // Ring showing this player is currently pinned by the gaze.
    if (_watched(pid) && !frozen) {
        _ctx.strokeStyle = '#ef4444'; _ctx.lineWidth = 3; _ctx.globalAlpha = 0.8;
        _ctx.beginPath(); _ctx.arc(cx, y, r * 1.55, 0, Math.PI * 2); _ctx.stroke();
        _ctx.globalAlpha = 1;
    }
    _ctx.beginPath(); _ctx.arc(cx, y, r, 0, Math.PI * 2);
    _ctx.fillStyle = frozen ? '#78849b' : accent;
    _ctx.fill();
    _ctx.lineWidth = 3; _ctx.strokeStyle = 'rgba(255,255,255,0.55)'; _ctx.stroke();

    _ctx.fillStyle = '#fff'; _ctx.font = `900 ${Math.round(r * 0.95)}px "Bebas Neue", sans-serif`;
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(`P${pid + 1}`, cx, y + 1);

    if (_caught[pid] > 0) {
        _ctx.globalAlpha = Math.min(1, _caught[pid] * 2);
        _ctx.fillStyle = '#ef4444'; _ctx.font = '900 26px "Bebas Neue", sans-serif';
        _ctx.fillText('SPOTTED!', cx, pid === 0 ? y + r * 2.6 : y - r * 2.6);
        _ctx.globalAlpha = 1;
    }
    if (_gift[pid] > 0) {
        _ctx.globalAlpha = Math.min(1, _gift[pid] * 1.5);
        _ctx.fillStyle = '#4ade80'; _ctx.font = '900 20px "Bebas Neue", sans-serif';
        _ctx.fillText('THEY SLIPPED — FREE STEP', cx, pid === 0 ? y + r * 2.6 : y - r * 2.6);
        _ctx.globalAlpha = 1;
    }
}

// Drawn in the caller's transform, so calling it once plain and once rotated
// gives each player an upright copy at their own edge.
function _drawHud(pid, w, h) {
    const accent = pid === 0 ? '#ff5a5a' : '#5a9bff';
    _ctx.fillStyle = accent;
    _ctx.font = '900 20px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'left'; _ctx.textBaseline = 'bottom';
    _ctx.fillText(`P${pid + 1}  ${Math.round(_progress[pid] * 100)}%`, 14, h - 54);

    // A one-word instruction that is true for THIS player right now.
    const frozen = _locked[pid] > 0;
    const cue = frozen ? 'CAUGHT' : _watched(pid) ? 'FREEZE!' : 'GO!';
    _ctx.fillStyle = frozen ? '#94a3b8' : _watched(pid) ? '#ef4444' : '#4ade80';
    _ctx.font = '900 26px "Bebas Neue", sans-serif';
    _ctx.fillText(cue, 14, h - 78);
}

// ── End (R6) ────────────────────────────────────────────────────────────────
function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0 ? 'DRAW!' : `P${winnerId + 1} TAKES THE CROWN!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1500);
}

function _finishByLead() {
    _finish(_progress[0] > _progress[1] ? 0 : _progress[1] > _progress[0] ? 1 : -1);
}

// ── Cleanup (R3) ────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _pointers = [new Set(), new Set()];
    _stars = [];
    _last = 0; _t = 0;
}
