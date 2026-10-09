// ============================================================
// METEOR DODGE — evade / survival duel. Drag your pod left and right
// along the base of your half to dodge falling meteors. Three lives
// each; lose them all and you're out. If both survive 30 s, the most
// lives wins (ties broken by meteors dodged). The longer it runs the
// faster and thicker the storm gets, so a stalemate can't last.
//
// New verb for the roster: evade / survive. Built to
// docs/MINIGAME_STANDARD.md on the SnapStrike scaffold. Face-off
// symmetric with independent simultaneous drag per player (one finger
// each); meaning carried by position & motion, not colour (§4).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import * as Solo from './SoloArena.js';

// ── Tunables (all positions are 0..1 fractions of a half) ───────────────────────
const ROUND_TIME   = 30;
const START_LIVES  = 3;
const SHIP_Y       = 0.82;    // pod sits near the player's outer edge
const HIT_X        = 0.085;   // x overlap for a hit
const HIT_BAND     = 0.06;    // y band around the pod
// Thicker storm. At the old rate a player could sit still through most of a
// round and never be threatened, which made "dodge" an overstatement.
//
// Measured on the way to these numbers: at 0.68/0.28 the BOT died faster than a
// player who never moved at all. A storm dense enough that dodging is worse than
// standing still is not difficulty, it is noise — so this is the density that
// still rewards moving.
const SPAWN_HI     = 0.80;    // spawn interval at the start (s)
const SPAWN_LO     = 0.34;    // ...and at the end
const FALL_HI      = 0.30;    // fall speed at the start (frac/s)
const FALL_LO      = 0.62;    // ...and at the end
const INVULN       = 0.9;     // s of i-frames after a hit

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;

let _n       = 2;            // slots, not seats
let _ship    = [];
let _ptr     = [];
let _lives   = [];
let _dodges  = [];
let _inv     = [];
let _hitFx   = [];
let _meteors = [];
let _spawnT  = [];
let _zones   = [];           // one rect+rotation per slot, from MinigameLayout

const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}
function _gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
function _diff()  { return Math.min(1, _elapsed / ROUND_TIME); }

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Solo.isSolo() ? 1 : Math.max(2, Math.min(4, slotCount()));
    _last = 0; _elapsed = 0;
    _ship   = new Array(_n).fill(0.5);
    _ptr    = new Array(_n).fill(null);
    _lives  = new Array(_n).fill(START_LIVES);
    _dodges = new Array(_n).fill(0);
    _inv    = new Array(_n).fill(0);
    _hitFx  = new Array(_n).fill(0);
    _meteors = Array.from({ length: _n }, () => []);
    _spawnT = new Array(_n).fill(0.3);
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        document.getElementById('mg-neutral').textContent = 'DODGE THE METEORS! DRAG TO MOVE';
        sfx('go');
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0d0b18;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Alone on your own phone there is no other zone to be in.
    const pidAt = (x, y) => {
        if (Solo.isSolo()) return 0;
        for (let i = 0; i < _zones.length; i++) {
            const r = _zones[i].rect;
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
        }
        return -1;
    };
    // The ship's x is a FRACTION of its own zone, so the sim never knows how
    // wide the zone is. A far seat holds the screen upside down, so their
    // fraction runs the other way.
    const setShip = (pid, x) => {
        if (Solo.isSolo()) {
            _ship[0] = Math.max(0.06, Math.min(0.94, x / _overlay.clientWidth));
            return;
        }
        const z = _zones[pid], r = z.rect;
        const f = z.rot === 180 ? (r.x + r.w - x) / r.w : (x - r.x) / r.w;
        _ship[pid] = Math.max(0.06, Math.min(0.94, f));
    };

    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const rect = _overlay.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const pid = pidAt(x, y);
        if (pid < 0 || (!Solo.isSolo() && isBotSlot(pid))) return;
        if (_ptr[pid] !== null) return;                   // one finger per zone
        _ptr[pid] = e.pointerId;
        setShip(pid, x);
    };
    const onMove = e => {
        if (_done) return;
        const rect = _overlay.getBoundingClientRect();
        for (let pid = 0; pid < _n; pid++) {
            // The finger keeps the zone it started in: dragging across the line
            // must not fly a neighbour's ship.
            if (_ptr[pid] === e.pointerId) { setShip(pid, e.clientX - rect.left); e.preventDefault(); }
        }
    };
    const onUp = e => {
        for (let pid = 0; pid < _n; pid++) if (_ptr[pid] === e.pointerId) _ptr[pid] = null;
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

// ── Gameplay ────────────────────────────────────────────────────────────────
// Every device has to get the SAME storm — where each meteor falls, how big it
// is, how fast — or the scores being compared were earned against different
// games. Drawn BY INDEX rather than from a running stream: spawns happen on a
// timer inside an animation frame, so two phones consume a shared stream at
// different points and drift apart within seconds. The 6th meteor is the 6th
// meteor everywhere, whether it left at 4.9 seconds or 5.1.
let _spawned = 0;
function _rnd(k) { return Solo.isSolo() ? Solo.draw(_spawned * 4 + k) : Math.random(); }

function _spawn(pid) {
    _meteors[pid].push({
        x: 0.1 + _rnd(0) * 0.8,
        y: -0.04,
        r: 0.045 + _rnd(1) * 0.025,
        vy: (FALL_HI + (FALL_LO - FALL_HI) * _diff()) * (0.85 + _rnd(2) * 0.4),
    });
    _spawned++;
}

function _hit(pid) {
    if (_inv[pid] > 0) return;
    _lives[pid]--;
    _inv[pid] = INVULN;
    _hitFx[pid] = 0.45;
    sfx('land_bad'); haptic([80, 40, 80]);
    if (_lives[pid] > 0) return;
    if (Solo.isSolo()) { _finishSolo(); return; }
    // OUT, NOT BEATEN. At two seats losing your last life handed the round to
    // the other player, which is the same thing. Above two it is not: the
    // others are still flying, so the round only ends when ONE is left — or
    // when the clock runs out and the standings decide it.
    const alive = _lives.reduce((a, l, i) => (l > 0 ? a.concat(i) : a), []);
    if (alive.length === 1) _finish(alive[0]);
    else if (alive.length === 0) _finish(_leader());
}

/** Most lives, then most dodged. -1 if the top is shared. */
function _leader() {
    const rank = i => _lives[i] * 10000 + _dodges[i];
    const best = Math.max(...Array.from({ length: _n }, (_, i) => rank(i)));
    const top = [];
    for (let i = 0; i < _n; i++) if (rank(i) === best) top.push(i);
    return top.length === 1 ? top[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _updateSide(pid, dt) {
    if (_lives[pid] <= 0) return;      // out: the sky above a wreck goes quiet
    // spawn
    _spawnT[pid] -= dt;
    if (_spawnT[pid] <= 0) {
        _spawn(pid);
        _spawnT[pid] = SPAWN_HI + (SPAWN_LO - SPAWN_HI) * _diff() + _rnd(3) * 0.25;
    }
    // move + collide
    const arr = _meteors[pid];
    for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        m.y += m.vy * dt;
        if (Math.abs(m.y - SHIP_Y) < HIT_BAND && Math.abs(m.x - _ship[pid]) < HIT_X + m.r * 0.5) {
            _hit(pid); arr.splice(i, 1); continue;
        }
        if (m.y > 1.05) { arr.splice(i, 1); _dodges[pid]++; }
    }
    if (_inv[pid] > 0) _inv[pid] -= dt;
    if (_hitFx[pid] > 0) _hitFx[pid] -= dt;
}

function _botUpdate(pid, dt) {
    if (_lives[pid] <= 0) return;
    const s = _botSkill;
    const look = 0.2 + s * 0.5;          // hard looks further ahead
    let threat = null, best = 2;
    for (const m of _meteors[pid]) {
        const dy = SHIP_Y - m.y;
        if (dy > 0 && dy < look && Math.abs(m.x - _ship[pid]) < 0.22 && dy < best) { best = dy; threat = m; }
    }
    let desired;
    if (threat) {
        desired = threat.x > 0.5 ? threat.x - 0.26 : threat.x + 0.26;
        desired += (1 - s) * 0.18 * _gauss();
    } else {
        desired = 0.5 + (Math.random() - 0.5) * 0.04;
    }
    desired = Math.max(0.06, Math.min(0.94, desired));
    const spd = 0.7 + s * 1.0;
    const d = desired - _ship[pid];
    _ship[pid] += Math.sign(d) * Math.min(Math.abs(d), spd * dt);
}

// ── Loop ────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    _elapsed += dt;

    // One bot per slot. This used to fly slot 1 alone, so the third and fourth
    // ships would have sat dead centre taking every meteor.
    if (!Solo.isSolo()) {
        for (let pid = 0; pid < _n; pid++) if (isBotSlot(pid)) _botUpdate(pid, dt);
    }
    for (let pid = 0; pid < _n && !_done; pid++) _updateSide(pid, dt);

    if (!_done && Solo.isSolo() && _elapsed >= ROUND_TIME) { _finishSolo(); return; }
    if (!_done && _elapsed >= ROUND_TIME) { _finish(_leader()); return; }
    _draw();
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function _draw() {
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _ctx.clearRect(0, 0, w, h);

    if (Solo.isSolo()) {
        // No divider, no second half, no rotation: the sky is the whole screen.
        _drawHalf(0, w, h);
        // The clock goes in the same top band as the lives and the tally. The
        // bottom belongs to the status strip, which wraps to three lines on a
        // narrow phone and would sit straight on top of it.
        const left = Math.max(0, ROUND_TIME - _elapsed);
        _ctx.fillStyle = left < 5 ? '#ef4444' : 'rgba(255,255,255,0.75)';
        _ctx.font = '900 22px "Bebas Neue", sans-serif'; _ctx.textAlign = 'center';
        _ctx.fillText(`${left.toFixed(1)}s`, w / 2, 31);
        return;
    }

    if (!_zones.length) _zones = zonesFor(_n, w, h);

    _ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    _ctx.lineWidth = 2;
    _zones.forEach(z => {
        const r = z.rect;
        _ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    });

    _zones.forEach((z, pid) => {
        const r = z.rect;
        _ctx.save();
        // Meteors fall past the bottom of the zone before they are culled, so
        // the sky is clipped to its own quarter.
        _ctx.beginPath(); _ctx.rect(r.x, r.y, r.w, r.h); _ctx.clip();
        if (z.rot === 180) {
            _ctx.translate(r.x + r.w, r.y + r.h);
            _ctx.rotate(Math.PI);
        } else {
            _ctx.translate(r.x, r.y);
        }
        _drawHalf(pid, r.w, r.h);
        _ctx.restore();
    });

    // Shared clock, dead centre, upright for everybody.
    const left = Math.max(0, ROUND_TIME - _elapsed);
    _ctx.fillStyle = 'rgba(8,6,18,0.72)';
    _ctx.beginPath(); _ctx.arc(w / 2, h / 2, 24, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = left < 5 ? '#ef4444' : 'rgba(255,255,255,0.7)';
    _ctx.font = '900 18px "Bebas Neue", sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(`${left.toFixed(1)}s`, w / 2, h / 2 + 1);
    _ctx.textBaseline = 'alphabetic';
}

const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _drawHalf(pid, w, h) {
    const color = SLOT_ACCENT[pid] || '#ffffff';
    // A wrecked pod's sky is dimmed so it reads as out rather than as idle.
    if (_lives[pid] <= 0 && !Solo.isSolo()) _ctx.globalAlpha = 0.35;

    // Meteors
    for (const m of _meteors[pid]) {
        const cx = m.x * w, cy = m.y * h, r = m.r * w;
        _ctx.fillStyle = '#9ca3af';
        _ctx.strokeStyle = '#e5e7eb';
        _ctx.lineWidth = 2;
        _ctx.beginPath();
        for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const rr = r * (a % 2 ? 0.74 : 1);
            const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
            a === 0 ? _ctx.moveTo(px, py) : _ctx.lineTo(px, py);
        }
        _ctx.closePath(); _ctx.fill(); _ctx.stroke();
    }

    // Pod (blinks while invulnerable)
    if (!(_inv[pid] > 0 && Math.floor(_elapsed * 12) % 2)) {
        const sx = _ship[pid] * w, sy = SHIP_Y * h, r = Math.min(w, h) * 0.07;
        _ctx.fillStyle = color;
        _ctx.shadowColor = color; _ctx.shadowBlur = 14;
        _ctx.beginPath();
        _ctx.moveTo(sx, sy - r);
        _ctx.lineTo(sx + r, sy + r * 0.8);
        _ctx.lineTo(sx - r, sy + r * 0.8);
        _ctx.closePath(); _ctx.fill();
        _ctx.shadowBlur = 0;
    }

    // Lives and the tally.
    //
    // In a 1v1 half these sit near the centre divider, which is above the
    // player and out of the way. Full-screen that same spot is a fifth of the
    // way down the sky — directly in the meteors' path, with the pips and the
    // rocks drawn on top of each other. Alone they go to the very top, on their
    // own band, where nothing falls through them.
    if (Solo.isSolo()) {
        _ctx.fillStyle = 'rgba(8,6,18,0.72)';
        _ctx.fillRect(0, 0, w, 46);
        for (let i = 0; i < START_LIVES; i++) {
            _ctx.fillStyle = i < _lives[pid] ? color : 'rgba(255,255,255,0.18)';
            _ctx.beginPath(); _ctx.arc(22 + i * 24, 23, 8, 0, Math.PI * 2); _ctx.fill();
        }
        _ctx.fillStyle = 'rgba(255,255,255,0.62)';
        _ctx.font = '700 14px Nunito, sans-serif';
        _ctx.textAlign = 'right';
        _ctx.fillText(`dodged ${_dodges[pid]}`, w - 18, 28);
        _ctx.textAlign = 'center';
    } else {
        for (let i = 0; i < START_LIVES; i++) {
            _ctx.fillStyle = i < _lives[pid] ? color : 'rgba(255,255,255,0.18)';
            _ctx.beginPath(); _ctx.arc(w * 0.5 + (i - 1) * 26, h * 0.14, 8, 0, Math.PI * 2); _ctx.fill();
        }
        _ctx.fillStyle = 'rgba(255,255,255,0.55)';
        _ctx.font = '700 14px Nunito, sans-serif';
        _ctx.textAlign = 'center';
        _ctx.fillText(`${_nameOf(pid)} · dodged ${_dodges[pid]}`, w / 2, h * 0.26);
    }

    if (_hitFx[pid] > 0) {
        _ctx.fillStyle = `rgba(239,68,68,${0.30 * (_hitFx[pid] / 0.45)})`;
        _ctx.fillRect(0, 0, w, h);
    }
    if (_lives[pid] <= 0) {
        _ctx.fillStyle = '#ef4444';
        _ctx.font = '900 28px "Bebas Neue", sans-serif';
        _ctx.fillText('OUT!', w / 2, h * 0.55);
    }
    _ctx.globalAlpha = 1;
}

// ── End ───────────────────────────────────────────────────────────────────────

/**
 * Lives first, dodges as the tiebreak — the same order the 1v1 result uses,
 * folded into one number so the scores can be compared without the ranking
 * needing to know anything about this particular game.
 */
export function soloScore() { return _lives[0] * 1000 + _dodges[0]; }

function _finishSolo() {
    if (_done) return;
    _done = true;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = _lives[0] > 0
        ? `SURVIVED — ${_lives[0]} LIVES, ${_dodges[0]} DODGED`
        : `OUT — ${_dodges[0]} DODGED`;
    sfx(_lives[0] > 0 ? 'mg_win' : 'land_bad');
    const banked = soloScore();
    _after(() => { _destroy(); Solo.soloFinish(banked); }, 1400);
}

function _finish(winner) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) {
        const line = _lives.map((l, i) => `${_nameOf(i)} ${l}`).join(' · ');
        neutral.textContent = winner < 0 ? `DRAW — ${line}` : `${_nameOf(winner)} SURVIVES! ${line}`;
    }
    sfx(winner < 0 ? 'land_bad' : 'mg_win');
    _after(() => { _destroy(); _onWin(winner, null, _lives.map((l, i) => l * 10000 + _dodges[i])); }, 1500);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    _ctx = null; _canvas = null; _zones = [];
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _meteors = [[], []]; _spawned = 0;
}
