// ============================================================
// STEADY HAND — a tracking race for TWO, THREE OR FOUR. A target
// drifts around your own zone; keep your finger on it to bank time.
// It speeds up as the round goes on. Most time-on-target after 22 s
// wins. Fills the dexterity category.
//
// LIVE (MG_PROFILE.live): every seat plays at once on a zone of its
// own. Nothing was ever shared but the clock — each player had a
// private target, a private finger and a private score — so the
// conversion is arrays sized to slotCount() and zones from
// MinigameLayout. It declares `roomy`: the target has to have
// somewhere to drift, and a quarter of a phone is not somewhere.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import * as Solo from './SoloArena.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const GAME_TIME = 22;     // s
const R_FRAC    = 0.11;   // target radius as fraction of min(w, halfH)
const SPEED0    = 0.22;   // target speed (fraction of halfH per s) at start
const SPEED_GROW= 0.05;   // +per second

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

// Per-player playfield, all in ZONE-local coords (0..zw, 0..zh).
let _n = 2;                                   // slots, not seats
let _tx = [], _ty = [], _vx = [], _vy = [];
let _fx = [], _fy = [];                       // finger position, or null
let _score = [];
let _bjx = [], _bjy = [];                     // bot finger jitter offset, per slot
let _zones = [];                              // one rect+rotation per slot
const _ptr = {};                              // pointerId → pid

const _cleanups = [];
const _timers   = [];

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _last = 0; _elapsed = 0;
    _score = new Array(_n).fill(0);
    _tx = new Array(_n).fill(0); _ty = new Array(_n).fill(0);
    _vx = new Array(_n).fill(0); _vy = new Array(_n).fill(0);
    _fx = new Array(_n).fill(null); _fy = new Array(_n).fill(null);
    _bjx = new Array(_n).fill(0);   _bjy = new Array(_n).fill(0);
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _initTargets();
        document.getElementById('mg-neutral').textContent = 'KEEP YOUR FINGER ON THE TARGET!';
        _af = requestAnimationFrame(_tick);
    }));
}

/** One player's playfield, in its own coordinates. Solo: the whole screen. */
function _field(pid) {
    if (Solo.isSolo()) return { w: _overlay.clientWidth, h: _overlay.clientHeight };
    const r = (_zones[pid] || _zones[0]).rect;
    return { w: r.w, h: r.h };
}

function _initTargets() {
    for (const pid of Solo.pids()) {
        const { w, h: hh } = _field(pid);
        _tx[pid] = w / 2; _ty[pid] = hh / 2;
        // The target has to set off in the same direction on every phone, or
        // the "same challenge" the scores are compared on is not the same
        // challenge. By index like everything else, even though there is only
        // one draw here — a rule with an exception in it is a rule somebody
        // will get wrong next time.
        const a = (Solo.isSolo() ? Solo.draw(pid) : Math.random()) * Math.PI * 2;
        const sp = SPEED0 * hh;
        _vx[pid] = Math.cos(a) * sp; _vy[pid] = Math.sin(a) * sp;
    }
    // Every bot starts with its finger on its own target. This used to name
    // slot 1, which above two seats left the second and third bots' fingers at
    // null for the whole round.
    for (const pid of Solo.pids()) {
        if (isBotSlot(pid)) { _fx[pid] = _tx[pid]; _fy[pid] = _ty[pid]; }
    }
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#14141f;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Convert a client point to a half + local coords (top half is rotated 180°).
    const localize = e => {
        // Alone on your own phone there is no other zone to be in: every touch
        // is yours and the coordinates are the screen's own.
        if (Solo.isSolo()) return { pid: 0, lx: e.clientX, ly: e.clientY };
        const r = _overlay.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const pid = _zoneAt(x, y);
        if (pid < 0) return { pid: -1, lx: 0, ly: 0 };
        const z = _zones[pid], zr = z.rect;
        // Into the zone's own frame; the far seats read theirs upside down.
        const lx = z.rot === 180 ? (zr.x + zr.w) - x : x - zr.x;
        const ly = z.rot === 180 ? (zr.y + zr.h) - y : y - zr.y;
        return { pid, lx, ly };
    };
    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const { pid, lx, ly } = localize(e);
        if (pid < 0 || isBotSlot(pid)) return;   // a bot's zone ignores fingers
        _ptr[e.pointerId] = pid;
        _fx[pid] = lx; _fy[pid] = ly;
    };
    const onMove = e => {
        const pid = _ptr[e.pointerId];
        if (pid === undefined) return;
        e.preventDefault();
        // The finger stays with the zone it started in even if it strays over
        // the line: dragging into a neighbour's quarter must not steal their
        // target, and letting `localize` re-decide would do exactly that.
        const l = localize(e);
        if (Solo.isSolo() || l.pid === pid) { _fx[pid] = l.lx; _fy[pid] = l.ly; }
    };
    const onUp = e => {
        const pid = _ptr[e.pointerId];
        if (pid === undefined) return;
        _fx[pid] = null; _fy[pid] = null;
        delete _ptr[e.pointerId];
    };
    _overlay.addEventListener('pointerdown', onDown);
    _overlay.addEventListener('pointermove', onMove);
    _overlay.addEventListener('pointerup', onUp);
    _overlay.addEventListener('pointercancel', onUp);
    _cleanups.push(() => {
        _overlay.removeEventListener('pointerdown', onDown);
        _overlay.removeEventListener('pointermove', onMove);
        _overlay.removeEventListener('pointerup', onUp);
        _overlay.removeEventListener('pointercancel', onUp);
    });

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    _zones = zonesFor(_n, w, h);
}

/** Which slot's zone contains this point, or -1. */
function _zoneAt(x, y) {
    for (let i = 0; i < _zones.length; i++) {
        const r = _zones[i].rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return -1;
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1/60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;

    const R = _radius();

    for (const pid of Solo.pids()) {
        const { w, h: hh } = _field(pid);
        const speed = (SPEED0 + SPEED_GROW * _elapsed) * hh;
        // Move + bounce target within margins.
        const m = R + 6;
        const v = Math.hypot(_vx[pid], _vy[pid]) || 1;
        _vx[pid] = _vx[pid] / v * speed; _vy[pid] = _vy[pid] / v * speed;
        _tx[pid] += _vx[pid] * dt; _ty[pid] += _vy[pid] * dt;
        if (_tx[pid] < m) { _tx[pid] = m; _vx[pid] = Math.abs(_vx[pid]); }
        if (_tx[pid] > w - m) { _tx[pid] = w - m; _vx[pid] = -Math.abs(_vx[pid]); }
        if (_ty[pid] < m) { _ty[pid] = m; _vy[pid] = Math.abs(_vy[pid]); }
        if (_ty[pid] > hh - m) { _ty[pid] = hh - m; _vy[pid] = -Math.abs(_vy[pid]); }
    }

    // Every bot's finger chases its own target with skill-scaled
    // responsiveness + jitter (§5). One per slot, not one for slot 1.
    for (const pid of Solo.pids()) {
        if (!isBotSlot(pid) || _fx[pid] === null) continue;
        const k = Math.min(1, (3 + _botSkill * 9) * dt);
        const amp = (1 - _botSkill) * R * 1.8;
        _bjx[pid] += (Math.random() - 0.5) * amp * 6 * dt;
        _bjy[pid] += (Math.random() - 0.5) * amp * 6 * dt;
        _bjx[pid] -= _bjx[pid] * 2 * dt; _bjy[pid] -= _bjy[pid] * 2 * dt;   // mean-revert
        _fx[pid] += ((_tx[pid] + _bjx[pid]) - _fx[pid]) * k;
        _fy[pid] += ((_ty[pid] + _bjy[pid]) - _fy[pid]) * k;
    }

    // Score time-on-target.
    for (const pid of Solo.pids()) {
        if (_fx[pid] === null) continue;
        if (Math.hypot(_fx[pid] - _tx[pid], _fy[pid] - _ty[pid]) <= R) _score[pid] += dt;
    }

    if (_elapsed >= GAME_TIME) {
        // Played across phones this is not a duel — it is one score, compared
        // afterwards with everybody else's. Tenths of a second, so the number
        // people are ranked on is a whole number.
        if (Solo.isSolo()) return _finishSolo();
        return _finish(_leader());
    }

    _draw(R);
}

/** Target radius. Every zone is the same size, so one number serves them all. */
function _radius() {
    const f = _field(0);
    return Math.min(f.w, f.h) * R_FRAC;
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw(R) {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);
    if (Solo.isSolo()) {
        // No divider, no second half, no rotation: the playfield is the screen.
        _drawHalf(0, w, h, R);
        const left = Math.max(0, GAME_TIME - _elapsed);
        // At the top, on its own band. The bottom belongs to the status strip,
        // which wraps to three lines on a narrow phone.
        _ctx.fillStyle = 'rgba(8,6,18,0.72)';
        _ctx.fillRect(0, 0, w, 46);
        _ctx.fillStyle = left < 4 ? '#ef4444' : 'rgba(255,255,255,0.75)';
        _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText(`${left.toFixed(1)}s`, w / 2, 31);
        return;
    }
    if (!_zones.length) _zones = zonesFor(_n, w, h);

    // Zone borders: the centre line at two, the cross between quarters at four.
    _ctx.strokeStyle = 'rgba(255,255,255,0.10)'; _ctx.lineWidth = 2;
    _zones.forEach(z => {
        const r = z.rect;
        _ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    });

    _zones.forEach((z, pid) => {
        const r = z.rect;
        _ctx.save();
        if (z.rot === 180) {
            // About the zone's own centre, so the playfield faces the player
            // sitting at that edge.
            _ctx.translate(r.x + r.w, r.y + r.h);
            _ctx.rotate(Math.PI);
        } else {
            _ctx.translate(r.x, r.y);
        }
        _drawHalf(pid, r.w, r.h, R);
        _ctx.restore();
    });

    // Shared clock, dead centre, upright for everybody.
    const left = Math.max(0, GAME_TIME - _elapsed);
    _ctx.fillStyle = 'rgba(8,6,18,0.72)';
    _ctx.beginPath(); _ctx.arc(w / 2, h / 2, 26, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = left < 4 ? '#ef4444' : 'rgba(255,255,255,0.7)';
    _ctx.font = '900 20px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(`${left.toFixed(1)}s`, w / 2, h / 2 + 1);
    _ctx.textBaseline = 'alphabetic';
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _drawHalf(pid, w, hh, R) {
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    const onTarget = _fx[pid] !== null && Math.hypot(_fx[pid] - _tx[pid], _fy[pid] - _ty[pid]) <= R;

    // Target
    _ctx.beginPath(); _ctx.arc(_tx[pid], _ty[pid], R, 0, Math.PI * 2);
    _ctx.fillStyle = onTarget ? 'rgba(74,222,128,0.30)' : 'rgba(255,255,255,0.06)';
    _ctx.fill();
    _ctx.lineWidth = 4; _ctx.strokeStyle = onTarget ? '#4ade80' : accent;
    _ctx.shadowColor = _ctx.strokeStyle; _ctx.shadowBlur = onTarget ? 18 : 8; _ctx.stroke(); _ctx.shadowBlur = 0;
    _ctx.beginPath(); _ctx.arc(_tx[pid], _ty[pid], 4, 0, Math.PI * 2); _ctx.fillStyle = _ctx.strokeStyle; _ctx.fill();

    // Finger marker
    if (_fx[pid] !== null) {
        _ctx.beginPath(); _ctx.arc(_fx[pid], _fy[pid], R * 0.45, 0, Math.PI * 2);
        _ctx.strokeStyle = accent; _ctx.lineWidth = 2.5; _ctx.stroke();
    }

    // Tag + score
    _ctx.fillStyle = accent;
    _ctx.font = '700 18px Nunito, sans-serif'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(Solo.isSolo() ? 'YOU' : _nameOf(pid), w / 2, hh * 0.10);
    _ctx.fillStyle = 'rgba(255,255,255,0.9)';
    _ctx.font = '900 26px "Bebas Neue", sans-serif';
    _ctx.fillText(`${_score[pid].toFixed(1)}s`, w / 2, hh * 0.18);
}

// ── End / cleanup ─────────────────────────────────────────────────────────────

/** Time held on target, in tenths — see SoloArena: higher is always better. */
export function soloScore() { return Math.round(_score[0] * 10); }

function _finishSolo() {
    if (_done) return;
    _done = true;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = `${_score[0].toFixed(1)}s ON TARGET`;
    sfx('mg_win');
    const banked = soloScore();
    _after(() => { _destroy(); Solo.soloFinish(banked); }, 1200);
}

/**
 * The outright leader, or -1 if the top is shared.
 *
 * The 0.15 s dead band the duel used is kept: two people who tracked the same
 * target for the same time to within a tenth and a half drew, and a fourth
 * decimal place deciding a round is not a result anybody can see.
 */
function _leader() {
    const best = Math.max(..._score);
    const top = _score.reduce((a, v, i) => (v > best - 0.15 ? a.concat(i) : a), []);
    return top.length === 1 ? top[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _scoreLine() {
    return _score.map((v, i) => `${_nameOf(i)} ${v.toFixed(1)}s`).join(' · ');
}

function _finish(winnerId) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) {
        neutral.textContent = winnerId < 0
            ? `DRAW! ${_scoreLine()}`
            : `${_nameOf(winnerId)} WINS! ${_scoreLine()}`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winnerId); }, 1500);
}

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    for (const k in _ptr) delete _ptr[k];
    _last = 0;
}
